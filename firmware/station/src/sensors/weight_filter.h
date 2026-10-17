#pragma once
#include <math.h>

// Signal chain for load cell samples (all values in grams, after tare):
//   sample -> median of last 5     (throws away single-sample spikes)
//          -> adaptive EMA         (heavy smoothing when steady, fast when the load changes)
//          -> stability detector   (std dev of the last second of readings)
//          -> auto-zero tracking   (slowly cancels drift while the scale is empty)
class WeightFilter {
public:
  struct Config {
    float emaSlow = 0.10f;          // smoothing factor while steady (~1 s at 10 samples/s)
    float emaFast = 0.60f;          // smoothing factor while the load is changing
    float stepThresholdG = 3.0f;    // a jump bigger than this switches to fast mode
    float stableStdDevG = 0.3f;     // std dev below this counts as stable
    float zeroBandG = 1.0f;         // auto-zero only acts within +/- this
    float zeroTrackRate = 0.05f;    // share of the remaining drift removed per stable sample
    float displayDeadbandG = 0.2f;  // |weight| below this is shown as 0
  };

  WeightFilter() : WeightFilter(Config()) {}
  explicit WeightFilter(const Config& cfg) : cfg_(cfg) { reset(); }

  void reset() {
    medianCount_ = medianIdx_ = 0;
    histCount_ = histIdx_ = 0;
    ema_ = 0;
    zeroOffset_ = 0;
    stdDev_ = 0;
    stable_ = false;
    initialized_ = false;
  }

  void add(float grams) {
    medianBuf_[medianIdx_] = grams;
    medianIdx_ = (medianIdx_ + 1) % kMedianN;
    if (medianCount_ < kMedianN) medianCount_++;
    median_ = median();

    float x = median_ - zeroOffset_;
    if (!initialized_) {
      ema_ = x;
      initialized_ = true;
    } else {
      float alpha = fabsf(x - ema_) > cfg_.stepThresholdG ? cfg_.emaFast : cfg_.emaSlow;
      ema_ += alpha * (x - ema_);
    }

    hist_[histIdx_] = ema_;
    histIdx_ = (histIdx_ + 1) % kStableN;
    if (histCount_ < kStableN) histCount_++;
    stdDev_ = windowStdDev();
    stable_ = histCount_ == kStableN && stdDev_ < cfg_.stableStdDevG;

    if (stable_ && fabsf(ema_) < cfg_.zeroBandG) {
      float correction = ema_ * cfg_.zeroTrackRate;
      zeroOffset_ += correction;
      ema_ -= correction;
    }
  }

  // Filtered weight, rounded to 0.1 g, with the small band around zero shown as 0
  float weight() const {
    if (fabsf(ema_) < cfg_.displayDeadbandG) return 0.0f;
    return roundf(ema_ * 10.0f) / 10.0f;
  }

  float rawMedian() const { return median_; }
  float filtered() const { return ema_; }
  float stdDev() const { return stdDev_; }
  float zeroDrift() const { return zeroOffset_; }
  bool stable() const { return stable_; }

private:
  static const int kMedianN = 5;
  static const int kStableN = 10;

  float median() const {
    float sorted[kMedianN];
    for (int i = 0; i < medianCount_; i++) sorted[i] = medianBuf_[i];
    for (int i = 1; i < medianCount_; i++) {
      float v = sorted[i];
      int j = i - 1;
      while (j >= 0 && sorted[j] > v) {
        sorted[j + 1] = sorted[j];
        j--;
      }
      sorted[j + 1] = v;
    }
    return sorted[medianCount_ / 2];
  }

  float windowStdDev() const {
    float mean = 0;
    for (int i = 0; i < histCount_; i++) mean += hist_[i];
    mean /= histCount_;
    float var = 0;
    for (int i = 0; i < histCount_; i++) var += (hist_[i] - mean) * (hist_[i] - mean);
    return sqrtf(var / histCount_);
  }

  Config cfg_;
  float medianBuf_[kMedianN];
  int medianCount_, medianIdx_;
  float median_ = 0;
  float hist_[kStableN];
  int histCount_, histIdx_;
  float ema_, zeroOffset_, stdDev_;
  bool stable_, initialized_;
};
