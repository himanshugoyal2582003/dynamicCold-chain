const assert = require('node:assert/strict');
const { test } = require('node:test');
const { forecast } = require('../dist/digital-twin/simulation');
const { parseSimulationInput } = require('../dist/digital-twin/simulation-input');

const input = {
  plannedMinutes: 120, delayMinutes: 0, ambientC: 30, ambientRiseC: 0, ambientRiseStart: 0,
  failureStart: 0, failureMinutes: 0, powerLossStart: 0, powerLossMinutes: 0,
  doorStart: 0, doorMinutes: 0, initialShelfLifeHours: 24, cargoTimeConstantMinutes: 90,
  cargoValue: 10000, currency: 'INR',
};
const seed = { airC: 4, targetC: 4 };

test('baseline and no-event scenario match, including at the reference temperature', () => {
  const baseline = forecast(seed, input, false);
  assert.deepEqual(baseline, forecast(seed, input, true));
  assert.equal(baseline.series.length, 121);
  assert.equal(baseline.arrival.cargoC, 4);
  assert.ok(Math.abs(baseline.arrival.remainingHours - 22) < 1e-10);
  assert.equal(baseline.modeledLoss, 833.33);
});

test('failure, power loss and door opening are bounded events and air leads cargo', () => {
  for (const prefix of ['failure', 'powerLoss', 'door']) {
    const result = forecast(seed, { ...input, [prefix + 'Start']: 10, [prefix + 'Minutes']: 20 }, true);
    assert.equal(result.series[10].airC, 4);
    assert.ok(result.series[11].airC > result.series[11].cargoC);
    assert.ok(result.series[30].airC > result.series[31].airC);
    assert.ok(result.modeledLoss > forecast(seed, input, false).modeledLoss);
  }
  const failure = forecast(seed, { ...input, failureMinutes: 120 }, true);
  const powerLoss = forecast(seed, { ...input, powerLossMinutes: 120 }, true);
  assert.ok(powerLoss.arrival.airC < failure.arrival.airC);
  assert.ok(Math.abs(failure.arrival.airC - (30 + (4 - 30) * Math.exp(-120 / 50))) < 1e-10);
});

test('ambient heat can exceed cooling capacity and delay changes only emergency arrival', () => {
  const scenario = { ...input, ambientC: 55, ambientRiseC: 20, ambientRiseStart: 15, delayMinutes: 60 };
  const baseline = forecast(seed, scenario, false);
  const emergency = forecast(seed, scenario, true);
  assert.equal(baseline.arrival.minute, 120);
  assert.equal(emergency.arrival.minute, 180);
  assert.deepEqual(emergency.series[15], baseline.series[15]);
  assert.ok(emergency.arrival.cargoC > baseline.arrival.cargoC);
  assert.ok(emergency.modeledLoss > baseline.modeledLoss);
  const delayedOnly = forecast(seed, { ...input, delayMinutes: 60 }, true);
  assert.deepEqual(delayedOnly.series[120], forecast(seed, input, false).arrival);
});

test('cold ambient can cool below setpoint and depleted cargo never recovers value', () => {
  const cold = forecast(seed, { ...input, ambientC: -30 }, false);
  assert.ok(cold.arrival.airC < 4);
  assert.ok(Math.abs(cold.arrival.remainingHours - 22) < 1e-10);
  const depleted = forecast(seed, { ...input, initialShelfLifeHours: 0.1, failureMinutes: 120 }, true);
  assert.equal(depleted.arrival.remainingHours, 0);
  assert.equal(depleted.modeledLoss, input.cargoValue);
  assert.equal(depleted.risk, 'depleted');
  assert.ok(depleted.series.every((point, i, series) => !i || point.qualityPct <= series[i - 1].qualityPct));
});

test('input rejects coercion, unsupported keys, malformed numbers and events outside the horizon', () => {
  assert.deepEqual(parseSimulationInput(input), input);
  for (const invalid of [
    null, [], { ...input, ambientC: '30' }, { ...input, plannedMinutes: 1.5 },
    { ...input, cargoValue: Infinity }, { ...input, currency: 'usd' },
    { ...input, doorStart: 120, doorMinutes: 2 }, { ...input, plannedMinutes: 721 },
    { ...input, triggerRescue: true }, { ...input, cargoTimeConstantMinutes: 0 },
  ]) assert.throws(() => parseSimulationInput(invalid), { status: 400 });
});
