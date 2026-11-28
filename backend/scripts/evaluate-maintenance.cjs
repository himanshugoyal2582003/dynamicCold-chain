// Synthetic engineering benchmark. Labels describe injected behavior, never equipment failure.
const { assessThermalHealth, extractThermalFeatures } = require('../dist/maintenance/thermal-health');
const assert = require('node:assert/strict');

function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function syntheticWindow(seed, scenario) {
  const random = rng(seed);
  const offset = (random() - 0.5) * 0.45;
  const intensity = random();
  const target = [-18, 2, 4, 8][seed % 4];
  return Array.from({ length: 30 }, (_, minute) => {
    const doorOpen = ['healthy_door', 'slow_recovery'].includes(scenario) && minute >= 7 && minute <= 12;
    let delta = offset + Math.sin(minute * 0.7) * 0.12 + (random() - 0.5) * 0.14;
    let humidity = 65 + (random() - 0.5) * 2;
    if (scenario === 'warm_drift') delta += minute * (0.035 + intensity * 0.19);
    if (scenario === 'setpoint_offset') delta -= 1.1 + intensity * 3;
    if (scenario === 'healthy_door' || scenario === 'slow_recovery') {
      const peak = 0.9 + intensity * 2.4;
      if (doorOpen) delta += peak * (minute - 6) / 6;
      if (minute > 12) {
        delta += Math.max(0, peak - (minute - 13) *
          (scenario === 'slow_recovery' ? 0.02 + intensity * 0.06 : 0.28 + intensity * 0.20));
      }
    }
    if (scenario === 'spikes' && [8, 21].includes(minute)) {
      delta += 2.4 + intensity * 3.5;
      humidity += 11 + intensity * 14;
    }
    if (scenario === 'flatline' && minute >= 4) {
      delta = offset;
      humidity = 64;
    }
    return { time: minute * 60_000, temperature: target + delta, target, humidity, doorOpen };
  });
}

function metrics(rows, score, threshold) {
  let tp = 0, fp = 0, tn = 0, fn = 0;
  for (const row of rows) {
    const predicted = row[score] >= threshold;
    if (row.anomaly && predicted) tp++;
    else if (predicted) fp++;
    else if (row.anomaly) fn++;
    else tn++;
  }
  const positive = rows.filter(r => r.anomaly);
  const negative = rows.filter(r => !r.anomaly);
  let ranks = 0;
  for (const a of positive) for (const b of negative) {
    ranks += a[score] === b[score] ? 0.5 : Number(a[score] > b[score]);
  }
  const round = value => Number(value.toFixed(3));
  return {
    tp, fp, tn, fn,
    precision: round(tp / (tp + fp)), recall: round(tp / (tp + fn)),
    f1: round(2 * tp / (2 * tp + fp + fn)), accuracy: round((tp + tn) / rows.length),
    rocAuc: round(ranks / (positive.length * negative.length)),
  };
}

function evaluateSyntheticMaintenance() {
  // Calibration and evaluation have independent seeds. No feature from the held-out set enters calibration.
  const calibration = Array.from({ length: 48 }, (_, i) =>
    extractThermalFeatures(syntheticWindow(19 + i * 499, i % 2 ? 'healthy_door' : 'healthy')));
  const scenarios = ['healthy', 'healthy_door', 'warm_drift', 'setpoint_offset', 'slow_recovery', 'spikes', 'flatline'];
  const rows = scenarios.flatMap((scenario, index) => Array.from({ length: 50 }, (_, i) => {
    const features = extractThermalFeatures(syntheticWindow(160001 + index * 40009 + i * 613, scenario));
    const assessment = assessThermalHealth(features, calibration);
    const fixedRules = assessThermalHealth(features, []);
    assert.notEqual(assessment.score, null);
    return {
      scenario, anomaly: !scenario.startsWith('healthy'),
      scoreDeduction: 100 - assessment.score,
      fixedRuleDeduction: 100 - fixedRules.score,
      meanDeviation: features.meanAbsoluteDeviation,
    };
  }));
  return {
    synthetic: true, calibration: calibration.length, heldOut: rows.length,
    predictor: metrics(rows, 'scoreDeduction', 25),
    fixedRulesBaseline: metrics(rows, 'fixedRuleDeduction', 25),
    meanDeviationBaseline: metrics(rows, 'meanDeviation', 3),
    detectionsByScenario: Object.fromEntries(scenarios.map(scenario =>
      [scenario, rows.filter(row => row.scenario === scenario && row.scoreDeduction >= 25).length])),
  };
}

if (require.main === module) console.log(JSON.stringify(evaluateSyntheticMaintenance(), null, 2));
module.exports = { syntheticWindow, evaluateSyntheticMaintenance };
