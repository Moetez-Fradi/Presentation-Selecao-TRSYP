/** Animated link diagram: station ⇄ TLS broker ⇄ phone / projector. Packets travel along the wires. */
export default function Arch({ step }: { step: number }) {
  const up = 'M300 300 C 420 300, 480 300, 600 300'
  const toPhone = 'M800 300 C 900 300, 930 190, 1040 190'
  const toProj = 'M800 300 C 900 300, 930 410, 1040 410'
  const cmd = 'M1040 190 C 930 190, 900 300, 800 300 L 600 300 C 480 300, 420 300, 300 300'
  const dot = (path: string, cls: string, dur: number, begin = 0) => (
    <circle r="7" className={cls}>
      <animateMotion dur={`${dur}s`} begin={`${begin}s`} repeatCount="indefinite" path={path} />
    </circle>
  )
  return (
    <svg className="arch" viewBox="0 0 1200 600" role="img" aria-label="ESP32 to TLS broker to phone and projector">
      <path d={up} className="wire" />
      <path d={toPhone} className="wire" />
      <path d={toProj} className="wire" />

      {dot(up, 'pk', 1.6)}
      {dot(up, 'pk', 1.6, 0.8)}
      {dot(toPhone, 'pk', 1.4, 0.3)}
      {dot(toProj, 'pk', 1.4, 0.7)}
      {step >= 1 && dot(cmd, 'pk-cmd', 2.6)}

      <g className="node">
        <rect x="60" y="230" width="240" height="140" rx="14" />
        <text x="180" y="290" className="n-title">ESP32 station</text>
        <text x="180" y="320" className="n-sub">control loop · safety</text>
        <text x="180" y="345" className="n-sub">watchdog 5 s → motor off</text>
      </g>
      <g className="node node-accent">
        <rect x="600" y="230" width="200" height="140" rx="14" />
        <text x="700" y="290" className="n-title">TLS broker</text>
        <text x="700" y="320" className="n-sub">MQTT pub / sub</text>
      </g>
      <g className="node">
        <rect x="1040" y="130" width="130" height="120" rx="14" />
        <text x="1105" y="185" className="n-title">Phone</text>
        <text x="1105" y="212" className="n-sub">controls</text>
      </g>
      <g className="node">
        <rect x="1040" y="350" width="130" height="120" rx="14" />
        <text x="1105" y="405" className="n-title">Projector</text>
        <text x="1105" y="432" className="n-sub">watches</text>
      </g>

      <text x="450" y="280" className="w-lbl">mqtts :8883</text>
      <text x="925" y="160" className="w-lbl">wss :8884</text>

      <g className={`chips ${step >= 0 ? 'on' : ''}`}>
        <text x="700" y="420" className="chip">retained status · offline detection (LWT) · QoS 1 results</text>
      </g>
      <g className={`chips ${step >= 1 ? 'on' : ''}`}>
        <text x="700" y="470" className="chip chip-accent">◆ every command HMAC-SHA256 signed · replays rejected</text>
      </g>
    </svg>
  )
}
