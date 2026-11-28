export const MODEL_VERSION = 'thermal-q10-v1';

export interface SimulationInput {
  plannedMinutes: number;
  delayMinutes: number;
  ambientC: number;
  ambientRiseC: number;
  ambientRiseStart: number;
  failureStart: number;
  failureMinutes: number;
  powerLossStart: number;
  powerLossMinutes: number;
  doorStart: number;
  doorMinutes: number;
  initialShelfLifeHours: number;
  cargoTimeConstantMinutes: number;
  cargoValue: number;
  currency: string;
}

export interface SimulationSeed {
  airC: number;
  targetC: number;
}

function approach(value: number, equilibrium: number, ratePerMinute: number) {
  return equilibrium + (value - equilibrium) * Math.exp(-ratePerMinute);
}

export function forecast(seed: SimulationSeed, input: SimulationInput, emergency: boolean) {
  const arrivalMinute = input.plannedMinutes + (emergency ? input.delayMinutes : 0);
  let airC = seed.airC;
  let cargoC = seed.airC;
  let remainingHours = input.initialShelfLifeHours;
  let peakCargoC = cargoC;
  const point = (minute: number) => ({
    minute,
    airC,
    cargoC,
    remainingHours,
    qualityPct: 100 * remainingHours / input.initialShelfLifeHours,
  });
  const series = [point(0)];
  for (let minute = 0; minute < arrivalMinute; minute++) {
    const active = (start: number, length: number) => emergency && minute >= start && minute < start + length;
    const powerLost = active(input.powerLossStart, input.powerLossMinutes);
    const failed = active(input.failureStart, input.failureMinutes);
    const doorOpen = active(input.doorStart, input.doorMinutes);
    const ambientC = input.ambientC + (emergency && minute >= input.ambientRiseStart ? input.ambientRiseC : 0);
    const conductance = doorOpen ? 1 / 8 : powerLost ? 1 / 75 : 1 / 50;
    const coolingCPerMinute = powerLost || failed ? 0 : 1.2;
    const passiveAir = approach(airC, ambientC, conductance);
    const cooledAir = approach(airC, ambientC - coolingCPerMinute / conductance, conductance);
    const nextAir = Math.min(passiveAir, Math.max(seed.targetC, cooledAir));
    const nextCargo = approach(cargoC, (airC + nextAir) / 2, 1 / input.cargoTimeConstantMinutes);
    const midpointCargo = (cargoC + nextCargo) / 2;
    const degradationRate = 2 ** (Math.max(0, midpointCargo - seed.targetC) / 10);
    remainingHours = Math.max(0, remainingHours - degradationRate / 60);
    airC = nextAir;
    cargoC = nextCargo;
    peakCargoC = Math.max(peakCargoC, cargoC);
    series.push(point(minute + 1));
  }
  const arrival = series[arrivalMinute];
  return {
    series,
    arrival,
    peakCargoC,
    modeledLoss: Math.round(input.cargoValue * (1 - arrival.qualityPct / 100) * 100) / 100,
    risk: remainingHours === 0 ? 'depleted' : arrival.qualityPct <= 25 ? 'low_reserve' : 'reserve_available',
  };
}
