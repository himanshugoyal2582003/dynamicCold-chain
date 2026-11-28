export const MODEL_VERSION = 'thermal-mad-v1';
const MINUTE = 60_000;
export const WINDOW_MS = 30 * MINUTE;
export const MAX_SAMPLE_AGE_MS = 10 * MINUTE;
const MAX_GAP = 5 * MINUTE;
const MIN_BASELINE_WINDOWS = 8;

export interface ThermalSample {
  time: number;
  temperature: number;
  target: number;
  humidity: number;
  doorOpen: boolean | null;
}

export interface ThermalFeatures {
  samples: number;
  spanMinutes: number;
  closedSamples: number;
  doorCoverage: number;
  meanAbsoluteDeviation: number;
  closedDeviation: number | null;
  warmingRate: number | null;
  unconditionedDeviation: number | null;
  unconditionedWarmingRate: number | null;
  recoveryRate: number | null;
  recoverySegments: number;
  temperatureSpikes: number;
  humiditySpikes: number;
  flatlineMinutes: number;
}

const round = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, max: number) => Math.min(max, Math.max(0, n));

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function extractThermalFeatures(samples: ThermalSample[]): ThermalFeatures | null {
  if (samples.length < 8) return null;
  // Discard readings before the most recent interruption or configured setpoint change.
  let start = 0;
  for (let i = 1; i < samples.length; i++) {
    if (samples[i].time - samples[i - 1].time > MAX_GAP || samples[i].target !== samples[i - 1].target) start = i;
  }
  const recent = samples.slice(start);
  const span = (recent.at(-1)!.time - recent[0].time) / MINUTE;
  if (recent.length < 8 || span < 12) return null;
  const deviations = recent.map(s => s.temperature - s.target);
  const closed = recent.flatMap((s, i) => s.doorOpen === false ? [Math.abs(deviations[i])] : []);
  const contextMissing = recent.every(sample => sample.doorOpen !== true) && closed.length < 5;
  const slopes: number[] = [];
  const unconditionedSlopes: number[] = [];
  const recoveries: number[] = [];
  let recoverySegments = 0;
  let recoveryStart: number | null = null;
  let flatlineStart = 0;
  let flatlineMinutes = 0;
  let temperatureSpikes = 0;
  let humiditySpikes = 0;

  for (let i = 1; i < recent.length; i++) {
    const a = recent[i - 1], b = recent[i], next = recent[i + 1];
    if (a.temperature !== b.temperature || a.humidity !== b.humidity) flatlineStart = i;
    flatlineMinutes = Math.max(flatlineMinutes, (b.time - recent[flatlineStart].time) / MINUTE);

    // A brief reported door opening can explain a temperature or humidity reversal.
    if (next && next.time - a.time <= 4 * MINUTE &&
        a.doorOpen !== true && b.doorOpen !== true && next.doorOpen !== true) {
      if (Math.abs(b.temperature - a.temperature) >= 3 && Math.abs(next.temperature - a.temperature) <= 0.7) temperatureSpikes++;
      if (Math.abs(b.humidity - a.humidity) >= 15 && Math.abs(next.humidity - a.humidity) <= 4) humiditySpikes++;
    }
    const minutes = (b.time - a.time) / MINUTE;
    const slope = (deviations[i] - deviations[i - 1]) / minutes;
    if (contextMissing && a.doorOpen === null && b.doorOpen === null && minutes > 0) unconditionedSlopes.push(slope);

    if (b.doorOpen !== false) {
      recoveryStart = null;
      continue;
    }
    if (a.doorOpen === true && deviations[i] >= 0.75) recoveryStart = i;
    if (recoveryStart !== null) {
      const duration = (b.time - recent[recoveryStart].time) / MINUTE;
      if (duration >= 3) {
        recoveries.push((deviations[recoveryStart] - Math.max(0, deviations[i])) / duration);
        recoverySegments++;
        recoveryStart = null;
      }
    }
    if (a.doorOpen === false && minutes > 0) slopes.push(slope);
  }

  return {
    samples: recent.length,
    spanMinutes: round(span),
    closedSamples: closed.length,
    doorCoverage: round(recent.filter(s => s.doorOpen !== null).length / recent.length),
    meanAbsoluteDeviation: round(deviations.reduce((total, value) => total + Math.abs(value), 0) / recent.length),
    closedDeviation: closed.length >= 5 ? round(median(closed)) : null,
    warmingRate: slopes.length >= 5 ? round(median(slopes)) : null,
    unconditionedDeviation: contextMissing ? round(median(deviations.map(Math.abs))) : null,
    unconditionedWarmingRate: unconditionedSlopes.length >= 5 ? round(median(unconditionedSlopes)) : null,
    recoveryRate: recoveries.length ? round(median(recoveries)) : null,
    recoverySegments,
    temperatureSpikes,
    humiditySpikes,
    flatlineMinutes: round(flatlineMinutes),
  };
}

type Factor = { code: string; points: number; value: number };
export function assessThermalHealth(current: ThermalFeatures | null, history: ThermalFeatures[]) {
  const factors: Factor[] = [];
  function penalize(code: string, points: number, value: number) {
    if (points >= 1) factors.push({ code, points: Math.round(points), value: round(value) });
  }
  // Exclude windows spent with a reported open door unless there is sensor evidence.
  if (!current || (current.closedDeviation === null && current.unconditionedDeviation === null && !current.temperatureSpikes &&
    !current.humiditySpikes && current.flatlineMinutes < 15)) {
    return { score: null, severity: 'insufficient_data', factors, baselineWindows: 0 };
  }

  if (current.closedDeviation !== null) {
    penalize('closed_temperature_deviation', clamp((current.closedDeviation - 0.8) * 15, 45), current.closedDeviation);
  }
  if (current.warmingRate !== null) {
    penalize('closed_warming_trend', clamp((current.warmingRate - 0.03) * 180, 24), current.warmingRate);
  }
  if (current.unconditionedDeviation !== null) {
    penalize('temperature_deviation_unknown_door', clamp((current.unconditionedDeviation - 1.4) * 10, 24), current.unconditionedDeviation);
  }
  if (current.unconditionedWarmingRate !== null) {
    penalize('warming_trend_unknown_door', clamp((current.unconditionedWarmingRate - 0.06) * 120, 18), current.unconditionedWarmingRate);
  }
  if (current.recoveryRate !== null) {
    penalize('slow_post_door_recovery', clamp((0.10 - current.recoveryRate) * 140, 24), current.recoveryRate);
  }
  penalize('temperature_spikes', Math.min(45, current.temperatureSpikes * 23), current.temperatureSpikes);
  penalize('humidity_spikes', Math.min(35, current.humiditySpikes * 20), current.humiditySpikes);
  if (current.flatlineMinutes >= 15) penalize('temperature_and_humidity_flatline', 22, current.flatlineMinutes);

  // One-sided robust feature scores. Floors prevent near-zero MAD from amplifying quantization.
  const dimensions = [
    ['closedDeviation', 0.25, 1], ['warmingRate', 0.025, 1], ['recoveryRate', 0.03, -1],
    ['temperatureSpikes', 0.5, 1], ['humiditySpikes', 0.5, 1], ['flatlineMinutes', 3, 1],
  ] as const;
  let comparableWindows = 0;
  let strongest: { key: typeof dimensions[number][0]; robustZ: number } | undefined;
  for (const [key, floor, direction] of dimensions) {
    const observed = current[key];
    if (observed === null) continue;
    const historical = history.flatMap(feature => feature[key] === null ? [] : [feature[key]!]);
    if (historical.length < MIN_BASELINE_WINDOWS) continue;
    comparableWindows = Math.max(comparableWindows, historical.length);
    const center = median(historical);
    const mad = median(historical.map(value => Math.abs(value - center)));
    const robustZ = Math.max(0, direction * (observed - center) / Math.max(floor, 1.4826 * mad));
    if (!strongest || robustZ > strongest.robustZ) strongest = { key, robustZ };
  }
  // Correlated historical features share one penalty budget.
  if (strongest) {
    penalize(`historical_${strongest.key}`, clamp((strongest.robustZ - 3) * 4, 14), strongest.robustZ);
  }
  const score = Math.max(0, 100 - factors.reduce((total, factor) => total + factor.points, 0));
  return {
    score,
    severity: score <= 50 ? 'critical' : score <= 75 ? 'warning' : score <= 90 ? 'watch' : 'normal',
    factors: factors.sort((a, b) => b.points - a.points || a.code.localeCompare(b.code)),
    baselineWindows: comparableWindows,
  };
}
