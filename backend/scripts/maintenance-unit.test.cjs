const assert = require('node:assert/strict');
const { test } = require('node:test');
const { assessThermalHealth, extractThermalFeatures } = require('../dist/maintenance/thermal-health');
const { evaluateSyntheticMaintenance, syntheticWindow } = require('./evaluate-maintenance.cjs');

test('insufficient, interrupted and changed setpoint windows withhold a score', () => {
  const normal = syntheticWindow(499, 'healthy');
  assert.equal(extractThermalFeatures(normal.slice(0, 7)), null);
  const withGap = normal.map((row, i) => ({ ...row, time: row.time + (i > 24 ? 15 * 60_000 : 0) }));
  assert.equal(extractThermalFeatures(withGap), null);
  const changed = normal.map((row, i) => ({ ...row, target: row.target + (i > 24 ? 1 : 0) }));
  assert.equal(extractThermalFeatures(changed), null);
  const unknown = extractThermalFeatures(normal.map(row => ({ ...row, doorOpen: null })));
  assert.equal(unknown.doorCoverage, 0);
  assert.equal(unknown.recoveryRate, null);
  assert.equal(unknown.closedDeviation, null);
  assert.equal(assessThermalHealth(unknown, []).severity, 'normal');
  const open = extractThermalFeatures(normal.map(row => ({ ...row, doorOpen: true })));
  assert.equal(assessThermalHealth(open, []).score, null);
});

test('door recovery slope measures actual elapsed time and differs from slow recovery', () => {
  const fast = extractThermalFeatures(syntheticWindow(1201, 'healthy_door'));
  const slow = extractThermalFeatures(syntheticWindow(1201, 'slow_recovery'));
  assert.equal(fast.recoverySegments, 1);
  assert.ok(fast.recoveryRate > 0.2);
  assert.ok(slow.recoveryRate < 0.1);
  assert.ok(assessThermalHealth(slow, []).factors.some(f => f.code === 'slow_post_door_recovery'));
  assert.equal(assessThermalHealth(fast, []).severity, 'normal');
});

test('post-door recovery credit ends at the configured setpoint', () => {
  const rows = syntheticWindow(1201, 'healthy_door');
  rows[13].temperature = rows[13].target + 1.5;
  rows[16].temperature = rows[16].target - 3;
  const features = extractThermalFeatures(rows);
  assert.equal(features.recoverySegments, 1);
  assert.equal(features.recoveryRate, 0.5);
});

test('brief reversals during observed door opening are not counted as sensor spikes', () => {
  const rows = syntheticWindow(1201, 'healthy');
  rows[11].doorOpen = true;
  rows[11].temperature += 4;
  rows[11].humidity += 20;
  const features = extractThermalFeatures(rows);
  assert.equal(features.temperatureSpikes, 0);
  assert.equal(features.humiditySpikes, 0);
  assert.equal(assessThermalHealth(features, []).severity, 'normal');
});

test('reversals and flatlines are separate sensor indicators with bounded explainable deductions', () => {
  const spikes = extractThermalFeatures(syntheticWindow(20591, 'spikes'));
  assert.ok(spikes.temperatureSpikes + spikes.humiditySpikes > 0);
  const flatline = extractThermalFeatures(syntheticWindow(20591, 'flatline'));
  assert.ok(flatline.flatlineMinutes >= 15);
  const pattern = assessThermalHealth(flatline, Array(12).fill(extractThermalFeatures(syntheticWindow(20591, 'healthy'))));
  assert.equal(pattern.baselineWindows, 12);
  assert.ok(pattern.factors.some(f => f.code === 'temperature_and_humidity_flatline'));
  assert.ok(pattern.factors.some(f => f.code === 'historical_flatlineMinutes'));
  assert.equal(pattern.score, Math.max(0, 100 - pattern.factors.reduce((sum, f) => sum + f.points, 0)));
});

test('short history applies fixed rules only and the largest MAD deviation explains a capped deduction', () => {
  const baseline = {
    ...extractThermalFeatures(syntheticWindow(501, 'healthy')),
    closedDeviation: 0,
    warmingRate: 0,
  };
  const current = { ...baseline, closedDeviation: 2, warmingRate: 0.3 };
  const shortHistory = assessThermalHealth(current, Array(7).fill(baseline));
  assert.equal(shortHistory.baselineWindows, 0);
  assert.equal(shortHistory.severity, 'warning');
  assert.ok(shortHistory.factors.every(factor => !factor.code.startsWith('historical_')));

  const matureHistory = assessThermalHealth(current, Array(8).fill(baseline));
  assert.equal(matureHistory.baselineWindows, 8);
  assert.deepEqual(matureHistory.factors.filter(factor => factor.code.startsWith('historical_')),
    [{ code: 'historical_warmingRate', points: 14, value: 12 }]);
});

test('held-out synthetic evaluation is deterministic and tracks baseline and false positives', () => {
  const result = evaluateSyntheticMaintenance();
  assert.deepEqual(result, evaluateSyntheticMaintenance());
  assert.equal(result.heldOut, 350);
  assert.ok(result.predictor.f1 > result.meanDeviationBaseline.f1);
  assert.ok(result.predictor.f1 > result.fixedRulesBaseline.f1);
  assert.ok(result.predictor.rocAuc >= 0.85);
  assert.ok(result.predictor.fp <= 10);
});
