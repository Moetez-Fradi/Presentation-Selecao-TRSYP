#include "ds_net.h"

#include <WiFi.h>
#include <sys/time.h>
#include <time.h>
#include "esp_idf_version.h"
#include "mbedtls/md.h"
#include "mqtt_client.h"

#include "root_cas.h"
#include "secrets.h"

// Works on arduino-esp32 2.x (ESP-IDF 4.4, what PlatformIO ships) and 3.x (ESP-IDF 5.x):
// only the MQTT config struct and the subscribe call differ.

namespace dsnet {

#define TOPIC(name) "trsyp/" STATION_ID "/" name
static const char *T_CMD = TOPIC("cmd");
static const char *T_EVT = TOPIC("evt");
static const char *T_STATUS = TOPIC("status");
static const char *T_RESULT = TOPIC("result");
static const char *T_ONLINE = TOPIC("online");

struct CmdMsg {
  char json[256];
};

static esp_mqtt_client_handle_t client = nullptr;
static QueueHandle_t cmdQueue = nullptr;
static volatile bool mqttUp = false;
static volatile uint32_t lastPingMs = 0;
static char clientId[48];

// ---------------------------------------------------------------------------

// ---- command authentication ---------------------------------------------
// Public brokers let anyone publish, so MQTT commands must be signed by the dashboard:
//   {"p":"<command JSON with ts>","s":"<hex HMAC-SHA256(PAIR_KEY, p)>"}
// Accepted only if the HMAC matches, ts is strictly newer than the last command, and
// (once NTP has set the clock) ts is within 30 s of now. USB serial stays unsigned.

static int64_t lastCmdTs = 0;

static int64_t nowMs() {
  struct timeval tv;
  gettimeofday(&tv, nullptr);
  return (int64_t)tv.tv_sec * 1000 + tv.tv_usec / 1000;
}

static bool hmacMatches(const char *p, size_t len, const char *sigHex) {
#ifdef PAIR_KEY
  uint8_t mac[32];
  const mbedtls_md_info_t *info = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
  if (mbedtls_md_hmac(info, (const uint8_t *)PAIR_KEY, strlen(PAIR_KEY), (const uint8_t *)p, len, mac)) return false;
  if (!sigHex || strlen(sigHex) != 64) return false;
  uint8_t diff = 0;  // constant-time compare
  for (int i = 0; i < 32; i++) {
    char h[3] = {sigHex[2 * i], sigHex[2 * i + 1], 0};
    diff |= mac[i] ^ (uint8_t)strtoul(h, nullptr, 16);
  }
  return diff == 0;
#else
  return true;
#endif
}

static void reject(const char *why) { Serial.printf("{\"evt\":\"net\",\"rejected\":\"%s\"}\n", why); }

static void queueCommand(const char *data, int len) {
  JsonDocument outer;
  if (deserializeJson(outer, data, len)) return reject("bad json");

  CmdMsg m;
#ifdef PAIR_KEY
  const char *p = outer["p"];
  if (!p) return reject("unsigned");
  size_t plen = strlen(p);
  if (plen >= sizeof(m.json)) return reject("too long");
  if (!hmacMatches(p, plen, outer["s"])) return reject("bad signature");
  JsonDocument cmd;
  if (deserializeJson(cmd, p, plen)) return reject("bad payload");
  int64_t ts = cmd["ts"] | (int64_t)0;
  bool clockSet = nowMs() > 1700000000000LL;
  if (ts <= lastCmdTs || (clockSet && llabs(ts - nowMs()) > 30000)) return reject("stale or replayed");
  lastCmdTs = ts;
  memcpy(m.json, p, plen + 1);
#else
  if (len >= (int)sizeof(m.json)) return;
  memcpy(m.json, data, len);
  m.json[len] = 0;
  JsonDocument cmd;
  deserializeJson(cmd, m.json);
#endif

  lastPingMs = millis();  // any valid message from the dashboard proves it is alive
  if (cmd["cmd"] == "ping") return;  // pings only feed the watchdog
  xQueueSend(cmdQueue, &m, 0);
}

static void onMqttEvent(void *, esp_event_base_t, int32_t eventId, void *eventData) {
  auto *e = static_cast<esp_mqtt_event_handle_t>(eventData);
  switch (static_cast<esp_mqtt_event_id_t>(eventId)) {
    case MQTT_EVENT_CONNECTED:
      mqttUp = true;
#if ESP_IDF_VERSION_MAJOR >= 5
      esp_mqtt_client_subscribe_single(client, T_CMD, 1);
#else
      esp_mqtt_client_subscribe(client, T_CMD, 1);
#endif
      esp_mqtt_client_enqueue(client, T_ONLINE, "true", 4, 1, 1, true);
      Serial.println("{\"evt\":\"net\",\"mqtt\":\"connected\"}");
      break;
    case MQTT_EVENT_DISCONNECTED:
      mqttUp = false;
      Serial.println("{\"evt\":\"net\",\"mqtt\":\"disconnected\"}");
      break;
    case MQTT_EVENT_DATA:
      // commands are small: ignore anything fragmented
      if (e->current_data_offset == 0 && e->data_len == e->total_data_len) queueCommand(e->data, e->data_len);
      break;
    case MQTT_EVENT_ERROR:
      if (e->error_handle && e->error_handle->error_type == MQTT_ERROR_TYPE_TCP_TRANSPORT)
        Serial.printf("{\"evt\":\"net\",\"mqtt\":\"tls_error\",\"code\":%d}\n", e->error_handle->esp_tls_last_esp_err);
      break;
    default:
      break;
  }
}

static void onWifiEvent(arduino_event_id_t event) {
  if (event == ARDUINO_EVENT_WIFI_STA_GOT_IP) {
    Serial.printf("{\"evt\":\"net\",\"wifi\":\"connected\",\"ip\":\"%s\",\"rssi\":%d}\n",
                  WiFi.localIP().toString().c_str(), WiFi.RSSI());
    configTime(0, 0, "pool.ntp.org", "time.google.com");
  } else if (event == ARDUINO_EVENT_WIFI_STA_DISCONNECTED) {
    Serial.println("{\"evt\":\"net\",\"wifi\":\"disconnected\"}");
  }
}

// Live data (status, dose, ack, error) is QoS 0. It goes through our own queue and a
// publisher task instead of the esp-mqtt outbox: the outbox gives every QoS 0 message
// msg_id 0 on ESP-IDF 4.4, so one-off messages such as acks could be dropped.
struct OutMsg {
  const char *topic;
  uint16_t len;
  bool retain;
  char buf[640];
};
static QueueHandle_t outQueue = nullptr;

static void publisherTask(void *) {
  static OutMsg m;
  for (;;) {
    if (xQueueReceive(outQueue, &m, portMAX_DELAY) != pdTRUE) continue;
    if (mqttUp) esp_mqtt_client_publish(client, m.topic, m.buf, m.len, 0, m.retain);
  }
}

void begin() {
  cmdQueue = xQueueCreate(8, sizeof(CmdMsg));
  outQueue = xQueueCreate(16, sizeof(OutMsg));
  xTaskCreatePinnedToCore(publisherTask, "mqtt_pub", 4096, nullptr, 2, nullptr, 0);

  WiFi.onEvent(onWifiEvent);
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);  // lower latency; the station is mains powered
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  snprintf(clientId, sizeof(clientId), "esp32-%s-%04x", STATION_ID, (unsigned)(ESP.getEfuseMac() & 0xffff));

  esp_mqtt_client_config_t cfg = {};
#if ESP_IDF_VERSION_MAJOR >= 5
  cfg.broker.address.uri = MQTT_URI;
  cfg.broker.verification.certificate = ROOT_CAS;
  // public brokers: no credentials at all (an empty username can be refused)
  if (strlen(MQTT_USER)) cfg.credentials.username = MQTT_USER;
  cfg.credentials.client_id = clientId;
  if (strlen(MQTT_PASS)) cfg.credentials.authentication.password = MQTT_PASS;
  cfg.session.keepalive = 15;
  cfg.session.last_will.topic = T_ONLINE;
  cfg.session.last_will.msg = "false";
  cfg.session.last_will.msg_len = 5;
  cfg.session.last_will.qos = 1;
  cfg.session.last_will.retain = 1;
  cfg.network.reconnect_timeout_ms = 3000;
  cfg.network.timeout_ms = 5000;
  cfg.buffer.size = 1536;
  cfg.buffer.out_size = 1024;
#else
  cfg.uri = MQTT_URI;
  cfg.cert_pem = ROOT_CAS;
  if (strlen(MQTT_USER)) cfg.username = MQTT_USER;
  cfg.client_id = clientId;
  if (strlen(MQTT_PASS)) cfg.password = MQTT_PASS;
  cfg.keepalive = 15;
  cfg.lwt_topic = T_ONLINE;
  cfg.lwt_msg = "false";
  cfg.lwt_msg_len = 5;
  cfg.lwt_qos = 1;
  cfg.lwt_retain = 1;
  cfg.reconnect_timeout_ms = 3000;
  cfg.network_timeout_ms = 5000;
  cfg.buffer_size = 1536;
  cfg.out_buffer_size = 1024;
#endif

  client = esp_mqtt_client_init(&cfg);
  esp_mqtt_client_register_event(client, MQTT_EVENT_ANY, onMqttEvent, nullptr);
  // the client retries by itself until Wi-Fi is up
  esp_mqtt_client_start(client);
}

// ---------------------------------------------------------------------------

static bool readSerialLine(JsonDocument &cmd) {
  static char buf[256];
  static size_t n = 0;
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\r') continue;
    if (c != '\n') {
      if (n < sizeof(buf) - 1) buf[n++] = c;
      continue;
    }
    buf[n] = 0;
    size_t len = n;
    n = 0;
    if (!len) continue;
    lastPingMs = millis();
    if (deserializeJson(cmd, buf, len)) continue;
    if (cmd["cmd"] == "ping") continue;
    if (cmd["cmd"] == "radio") {
      // diagnostic, USB only: {"cmd":"radio","on":false} to measure sensor noise without Wi-Fi
      bool on = cmd["on"] | true;
      if (on) {
        WiFi.mode(WIFI_STA);
        WiFi.begin(WIFI_SSID, WIFI_PASS);
      } else {
        WiFi.disconnect(true);
        WiFi.mode(WIFI_OFF);
      }
      Serial.printf("{\"evt\":\"net\",\"radio\":%s}\n", on ? "true" : "false");
      continue;
    }
    return true;
  }
  return false;
}

bool nextCommand(JsonDocument &cmd) {
  CmdMsg m;
  if (xQueueReceive(cmdQueue, &m, 0) == pdTRUE) {
    if (deserializeJson(cmd, m.json)) return false;
    return true;
  }
  return readSerialLine(cmd);
}

static void send(const char *topic, const JsonDocument &doc, int qos, bool retain, bool echo = true) {
  static char buf[768];
  size_t len = serializeJson(doc, buf, sizeof(buf));
  if (echo) {
    Serial.write(buf, len);
    Serial.write('\n');
  }
  if (!client) return;
  if (qos > 0) {
    // results: kept in the outbox and sent after a reconnect
    esp_mqtt_client_enqueue(client, topic, buf, len, qos, retain, true);
    return;
  }
  if (!mqttUp || len >= sizeof(OutMsg::buf)) return;  // live data is worthless once stale
  static OutMsg m;
  m.topic = topic;
  m.len = len;
  m.retain = retain;
  memcpy(m.buf, buf, len);
  xQueueSend(outQueue, &m, 0);  // never blocks the dosing loop; drops if the link is congested
}

void publishStatus(const JsonDocument &doc) { send(T_STATUS, doc, 0, true); }
void publishEvent(const JsonDocument &doc) { send(T_EVT, doc, 0, false); }
void publishResult(const JsonDocument &doc) { send(T_RESULT, doc, 1, true); }

void ack(const char *cmd, bool ok, const char *msg) {
  JsonDocument d;
  d["evt"] = "ack";
  d["cmd"] = cmd;
  d["ok"] = ok;
  if (msg) d["msg"] = msg;
  publishEvent(d);
}

void error(const char *code) {
  JsonDocument d;
  d["evt"] = "error";
  d["code"] = code;
  publishEvent(d);
}

bool wifiUp() { return WiFi.status() == WL_CONNECTED; }
bool brokerUp() { return mqttUp; }
uint32_t msSincePing() { return millis() - lastPingMs; }

String isoNow() {
  time_t now = time(nullptr);
  if (now < 1700000000) return String("+") + millis() + "ms";
  char buf[24];
  strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", gmtime(&now));
  return buf;
}

}  // namespace dsnet
