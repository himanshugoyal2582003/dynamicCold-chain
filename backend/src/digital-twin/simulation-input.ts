import { BadRequestException } from '@nestjs/common';
import { SimulationInput } from './simulation';

const LIMITS = {
  plannedMinutes: [1, 720],
  delayMinutes: [0, 720],
  ambientC: [-50, 55],
  ambientRiseC: [0, 30],
  ambientRiseStart: [0, 1439],
  failureStart: [0, 1439],
  failureMinutes: [0, 1440],
  powerLossStart: [0, 1439],
  powerLossMinutes: [0, 1440],
  doorStart: [0, 1439],
  doorMinutes: [0, 1440],
  initialShelfLifeHours: [0.1, 8760],
  cargoTimeConstantMinutes: [5, 360],
  cargoValue: [0, 100_000_000],
} as const;

export function parseSimulationInput(value: unknown): SimulationInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('A simulation input object is required');
  }
  const body = value as Record<string, unknown>;
  const allowed = new Set([...Object.keys(LIMITS), 'currency']);
  if (Object.keys(body).some(key => !allowed.has(key))) {
    throw new BadRequestException('Unexpected simulation input field');
  }
  const numbers = {} as Record<keyof typeof LIMITS, number>;
  for (const key of Object.keys(LIMITS) as (keyof typeof LIMITS)[]) {
    const [min, max] = LIMITS[key];
    const number = body[key];
    if (typeof number !== 'number' || !Number.isFinite(number) || number < min || number > max ||
        ((key.endsWith('Start') || key.endsWith('Minutes')) && !Number.isInteger(number))) {
      throw new BadRequestException(`Invalid ${key}. Expected ${min} to ${max}`);
    }
    numbers[key] = number;
  }
  if (typeof body.currency !== 'string' || !/^[A-Z]{3}$/.test(body.currency)) {
    throw new BadRequestException('Currency must be a three-letter uppercase code');
  }
  const horizon = numbers.plannedMinutes + numbers.delayMinutes;
  for (const [start, minutes] of [
    [numbers.failureStart, numbers.failureMinutes],
    [numbers.powerLossStart, numbers.powerLossMinutes],
    [numbers.doorStart, numbers.doorMinutes],
    [numbers.ambientRiseStart, numbers.ambientRiseC],
  ]) {
    if (minutes > 0 && start >= horizon) throw new BadRequestException('Enabled scenarios must start before arrival');
  }
  return { ...numbers, currency: body.currency };
}
