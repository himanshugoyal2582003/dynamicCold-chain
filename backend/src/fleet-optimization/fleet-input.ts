import { BadRequestException } from '@nestjs/common';
import { Priority } from './optimizer';

export const PLAN_LIMIT = 12;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function uuid(value: unknown) {
  if (typeof value !== 'string' || !UUID.test(value)) throw new BadRequestException('Expected a valid identifier');
  return value.toLowerCase();
}

export function fields(value: unknown, keys: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !keys.includes(key))) throw new BadRequestException('Unexpected request fields');
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, max: number) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new BadRequestException(`Invalid ${label}`);
  return value.trim();
}

function number(value: unknown, label: string, min: number, max: number, decimals = 0) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max ||
      Number(value.toFixed(decimals)) !== value) throw new BadRequestException(`Invalid ${label} (${min} to ${max}, up to ${decimals} decimal places)`);
  return value;
}

function flag(value: unknown) {
  if (typeof value !== 'boolean') throw new BadRequestException('Specify whether these inputs are synthetic');
  return value;
}

function coordinates(lat: unknown, lng: unknown) {
  const latitude = number(lat, 'latitude', -90, 90, 6);
  const longitude = number(lng, 'longitude', -180, 180, 6);
  if (latitude === 0 && longitude === 0) throw new BadRequestException('Coordinate pair 0,0 is unsupported');
  return { latitude, longitude };
}

function future(value: unknown, label: string) {
  const date = text(value, label, 35);
  const instant = Date.parse(date);
  const year = Number(date.slice(0,4));
  const month = Number(date.slice(5,7));
  const day = Number(date.slice(8,10));
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(date) ||
      month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year,month,0)).getUTCDate() ||
      Number(date.slice(11,13)) > 23 ||
      !Number.isFinite(instant) || instant <= Date.now() || instant > Date.now() + 90 * 86400_000) {
    throw new BadRequestException(`${label} must be a timezone-qualified instant within 90 days`);
  }
  return new Date(instant).toISOString();
}

export function currency(value: unknown) {
  if (typeof value !== 'string' || !/^[A-Z]{3}$/.test(value)) throw new BadRequestException('Use a three-letter uppercase currency');
  return value;
}

export function shipmentInput(value: unknown) {
  const body = fields(value, ['reference','cargoType','weightTons','origin','destination','originLat','originLng',
    'destinationLat','destinationLng','deadline','shelfLifeUntil','handlingMinutes','priority','synthetic']);
  if (body.priority !== 'critical' && body.priority !== 'high' && body.priority !== 'standard') {
    throw new BadRequestException('Invalid shipment priority');
  }
  const pickup = coordinates(body.originLat, body.originLng);
  const dropoff = coordinates(body.destinationLat, body.destinationLng);
  if (pickup.latitude === dropoff.latitude && pickup.longitude === dropoff.longitude) {
    throw new BadRequestException('Pickup and delivery coordinates must differ');
  }
  return {
    reference: text(body.reference, 'reference', 80), cargoType: text(body.cargoType, 'cargo type', 100),
    weightTons: number(body.weightTons, 'shipment weight', 0.01, 999.99, 2),
    origin: text(body.origin, 'origin', 255), destination: text(body.destination, 'destination', 255),
    pickup, dropoff, deadline: future(body.deadline, 'Deadline'), shelfLifeUntil: future(body.shelfLifeUntil, 'Shelf life cutoff'),
    handlingMinutes: number(body.handlingMinutes, 'handling time', 0, 240), priority: body.priority as Priority,
    synthetic: flag(body.synthetic),
  };
}

export function profileInput(value: unknown) {
  const body = fields(value, ['cargoTypes','usableTons','targetC','costPerKm','currency','latitude','longitude','synthetic','confirmed']);
  if (!Array.isArray(body.cargoTypes) || !body.cargoTypes.length || body.cargoTypes.length > 12 || body.confirmed !== true) {
    throw new BadRequestException('Confirm the dispatch inputs and provide 1–12 compatible cargo types');
  }
  return {
    cargoTypes: [...new Set(body.cargoTypes.map(item => text(item, 'compatible cargo type', 100).toLowerCase()))],
    usableTons: number(body.usableTons, 'usable capacity', 0.01, 999.99, 2),
    targetC: number(body.targetC, 'confirmed setpoint', -30, 25, 2),
    costPerKm: number(body.costPerKm, 'distance rate', 0.0001, 100000, 4),
    currency: currency(body.currency), position: coordinates(body.latitude, body.longitude), synthetic: flag(body.synthetic),
  };
}

function selected(value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > PLAN_LIMIT) {
    throw new BadRequestException(`Select 1–${PLAN_LIMIT} unique records`);
  }
  const ids = value.map(uuid);
  if (new Set(ids).size !== ids.length) throw new BadRequestException('Duplicate selection');
  return ids;
}

export function planInput(value: unknown) {
  const body = fields(value, ['shipmentIds','truckIds','currency']);
  return { shipmentIds: selected(body.shipmentIds), truckIds: selected(body.truckIds), currency: currency(body.currency) };
}

export function approvalInput(value: unknown) {
  const body = fields(value, ['quote','confirmed']);
  if (body.confirmed !== true) throw new BadRequestException('Explicit confirmation is required');
  return text(body.quote, 'approval quote', 4000);
}
