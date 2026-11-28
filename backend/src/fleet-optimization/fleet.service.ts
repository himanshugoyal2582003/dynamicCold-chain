import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException,
  ServiceUnavailableException, UnauthorizedException,
} from '@nestjs/common';
import { sign, verify } from 'jsonwebtoken';
import { NeonService } from '../neon/neon.service';
import { Coordinates, RoutingService } from '../rescue/routing.service';
import { TripsService } from '../trips/trips.service';
import { planInput, profileInput, shipmentInput } from './fleet-input';
import { Choice, Demand, greedy, optimize } from './optimizer';

type Actor = { sub: string; role: string } | undefined;
type Shipment = Demand & {
  reference: string; cargoType: string; weightTons: number; origin: string; destination: string;
  originLat: number; originLng: number; destinationLat: number; destinationLng: number;
  shelfLifeUntil: string; handlingMinutes: number; synthetic: boolean;
};
type Truck = {
  id: string; plate: string; capacityTons: number; status: string; targetC: number;
  driverId: string | null; busy: boolean; rescue: boolean; profileRevision: number | null;
  cargoTypes: string[] | null; usableTons: number | null; profileTargetC: number | null; costPerKm: number | null; currency: string | null;
  latitude: number | null; longitude: number | null; synthetic: boolean | null; verifiedAt: string | null;
  healthScore: number | null; severity: string | null; healthAt: string | null; healthWindow: string | null;
};
export interface Quote extends Choice {
  driverId: string;
  distanceKm: number;
  deadheadKm: number;
  durationSeconds: number;
  deliveryAt: string;
  cost: number;
  reserveMinutes: number;
  reserveConsumed: number;
  healthScore: number;
  components: { cost: number; distance: number; duration: number; reserve: number; health: number };
}
type Route = { distanceKm: number; durationSeconds: number };
type Claims = {
  sub: string; role: string; owner: string; shipment: string; truck: string; driver: string;
  revision: number; window: string; duration: number; eta: string; exp: number;
};

const TRUCK_QUERY = `SELECT t.id, t.plate_number AS plate, t.capacity_tons::float8 AS "capacityTons", t.status,
  t.target_temp_c::float8 AS "targetC", p.target_c::float8 AS "profileTargetC",
  driver.id AS "driverId",
  EXISTS (SELECT 1 FROM trips x WHERE (x.truck_id=t.id OR x.user_id=driver.id)
    AND x.status IN ('ASSIGNED','IN_PROGRESS')) AS busy,
  EXISTS (SELECT 1 FROM rescue_events e WHERE e.truck_id=t.id
    AND e.status IN ('DETECTED','RECOMMENDED','PENDING_APPROVAL','APPROVED','REROUTING')) AS rescue,
  p.revision AS "profileRevision", p.cargo_types AS "cargoTypes", p.usable_tons::float8 AS "usableTons",
  p.cost_per_km::float8 AS "costPerKm", p.currency, p.latitude::float8, p.longitude::float8, p.synthetic,
  p.verified_at AS "verifiedAt", health.score AS "healthScore", health.severity,
  health.last_observed_at AS "healthAt", health.window_end::text AS "healthWindow"
  FROM trucks t LEFT JOIN fleet_dispatch_profiles p ON p.truck_id=t.id AND p.owner_id=t.owner_id
  LEFT JOIN LATERAL (SELECT d.id FROM users d WHERE d.truck_id=t.id AND d.owner_id=t.owner_id
    AND d.active AND d.role='truckUser'
    AND NOT EXISTS (SELECT 1 FROM trips x WHERE x.user_id=d.id AND x.status IN ('ASSIGNED','IN_PROGRESS'))
    ORDER BY d.id LIMIT 1) driver ON true
  LEFT JOIN LATERAL (SELECT a.score,a.severity,a.last_observed_at,a.window_end FROM maintenance_assessments a
    WHERE a.truck_id=t.id AND a.connection_number=upper(btrim(t.iot_connection_number)) AND a.target_c=t.target_temp_c
    ORDER BY a.window_end DESC LIMIT 1) health ON true
  WHERE t.owner_id=$1 AND t.active`;

const SHIPMENT_QUERY = `SELECT id, reference, cargo_type AS "cargoType", weight_tons::float8 AS "weightTons",
  origin, destination, origin_lat::float8 AS "originLat", origin_lng::float8 AS "originLng",
  destination_lat::float8 AS "destinationLat", destination_lng::float8 AS "destinationLng", deadline,
  shelf_life_until AS "shelfLifeUntil", handling_minutes AS "handlingMinutes", priority, synthetic
  FROM fleet_shipments WHERE owner_id=$1 AND trip_id IS NULL`;

const age = (instant: string | null, now: number) => instant === null ? Infinity : now - new Date(instant).getTime();
const round = (value: number) => Math.round(value * 100) / 100;

function truckIssue(truck: Truck, now: number) {
  if (truck.rescue) return 'Truck has an open rescue case';
  if (truck.status !== 'available' || truck.busy) return 'Truck is already committed or unavailable';
  if (!truck.driverId) return 'No available driver assigned to this truck and fleet';
  if (!truck.profileRevision) return 'Dispatch profile missing';
  if (truck.profileTargetC !== truck.targetC) return 'Truck setpoint changed since confirmation';
  if (age(truck.verifiedAt, now) > 30 * 60_000 || age(truck.verifiedAt, now) < -5000) return 'Dispatch profile needs reconfirmation';
  if (truck.usableTons! > truck.capacityTons) return 'Verified usable capacity exceeds fleet record';
  if (truck.healthScore === null || age(truck.healthAt, now) > 15 * 60_000 || age(truck.healthAt, now) < -5000) {
    return 'Current scored maintenance evidence is missing';
  }
  if (truck.severity !== 'normal' && truck.severity !== 'watch') return 'Maintenance severity blocks dispatch';
  return null;
}

@Injectable()
export class FleetService {
  private readonly planners = new Set<string>();

  constructor(private readonly neon: NeonService, private readonly routing: RoutingService, private readonly trips: TripsService) {}

  private async query<T>(statement: string, params: unknown[]): Promise<T[]> {
    const sql = this.neon.getSql();
    if (!sql) throw new ServiceUnavailableException('Database unavailable');
    try {
      return await sql(statement, params);
    } catch (error) {
      if ((error as { code?: string }).code === '42P01') throw new ServiceUnavailableException('Fleet planning schema is unavailable');
      throw error;
    }
  }

  async fleets(actor: Actor) {
    if (!actor) throw new UnauthorizedException();
    if (!['owner','admin'].includes(actor.role)) throw new ForbiddenException();
    const rows = await this.query<{ id: string; name: string }>(
      `SELECT fleet.id, fleet.name FROM users fleet WHERE fleet.active AND fleet.role='owner'
       AND EXISTS (SELECT 1 FROM users u WHERE u.id=$1 AND u.active AND u.role=$2
         AND (u.role='admin' OR fleet.id=u.id)) ORDER BY fleet.name,fleet.id`, [actor.sub,actor.role]);
    return { fleets: rows };
  }

  private async access(actor: Actor, ownerId: string) {
    if (!actor) throw new UnauthorizedException();
    if (!['owner','admin'].includes(actor.role)) throw new ForbiddenException();
    const [allowed] = await this.query(
      `SELECT 1 FROM users u JOIN users fleet ON fleet.id=$3 AND fleet.active AND fleet.role='owner'
       WHERE u.id=$1 AND u.active AND u.role=$2 AND (u.role='admin' OR fleet.id=u.id)`, [actor.sub,actor.role,ownerId]);
    if (!allowed) throw new NotFoundException('Fleet not found');
    return actor;
  }

  async resources(actor: Actor, ownerId: string) {
    await this.access(actor,ownerId);
    const [trucks, shipments] = await Promise.all([
      this.query<Truck>(TRUCK_QUERY + ' ORDER BY t.plate_number,t.id LIMIT 101',[ownerId]),
      this.query<Shipment>(SHIPMENT_QUERY + ' ORDER BY deadline,id LIMIT 101',[ownerId]),
    ]);
    const now = Date.now();
    return { trucks: trucks.slice(0,100).map(truck => ({ ...truck, issue: truckIssue(truck,now) })),
      shipments: shipments.slice(0,100), truncated: trucks.length > 100 || shipments.length > 100 };
  }

  async createShipment(actor: Actor, ownerId: string, input: ReturnType<typeof shipmentInput>) {
    const user = await this.access(actor,ownerId);
    try {
      const [shipment] = await this.query(
        `INSERT INTO fleet_shipments(owner_id,reference,cargo_type,weight_tons,origin,destination,origin_lat,origin_lng,
          destination_lat,destination_lng,deadline,shelf_life_until,handling_minutes,priority,synthetic)
         SELECT fleet.id,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17
         FROM users u JOIN users fleet ON fleet.id=$3 AND fleet.active AND fleet.role='owner'
         WHERE u.id=$1 AND u.active AND u.role=$2 AND (u.role='admin' OR fleet.id=u.id) RETURNING id`,
        [user.sub,user.role,ownerId,input.reference,input.cargoType,input.weightTons,input.origin,input.destination,
          input.pickup.latitude,input.pickup.longitude,input.dropoff.latitude,input.dropoff.longitude,input.deadline,
          input.shelfLifeUntil,input.handlingMinutes,input.priority,input.synthetic]);
      if (!shipment) throw new NotFoundException();
      return shipment;
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw new ConflictException('Shipment reference already exists in this fleet');
      throw error;
    }
  }

  async saveProfile(actor: Actor, ownerId: string, truckId: string, input: ReturnType<typeof profileInput>) {
    const user = await this.access(actor,ownerId);
    const [updated] = await this.query(
      `INSERT INTO fleet_dispatch_profiles(truck_id,owner_id,cargo_types,usable_tons,target_c,cost_per_km,currency,latitude,longitude,synthetic)
       SELECT t.id,t.owner_id,$5,$6,t.target_temp_c,$7,$8,$9,$10,$11 FROM trucks t JOIN users u ON u.id=$1 AND u.active AND u.role=$2
         JOIN users fleet ON fleet.id=t.owner_id AND fleet.active AND fleet.role='owner'
       WHERE t.id=$4 AND t.owner_id=$3 AND t.active AND t.capacity_tons >= $6 AND t.target_temp_c=$12
         AND (u.role='admin' OR t.owner_id=u.id)
       ON CONFLICT(truck_id) DO UPDATE SET owner_id=excluded.owner_id,cargo_types=excluded.cargo_types,usable_tons=excluded.usable_tons,
         target_c=excluded.target_c,cost_per_km=excluded.cost_per_km,currency=excluded.currency,latitude=excluded.latitude,longitude=excluded.longitude,
         synthetic=excluded.synthetic,revision=fleet_dispatch_profiles.revision+1,verified_at=clock_timestamp()
       RETURNING truck_id`,
      [user.sub,user.role,ownerId,truckId,input.cargoTypes,input.usableTons,input.costPerKm,input.currency,
        input.position.latitude,input.position.longitude,input.synthetic,input.targetC]);
    if (!updated) throw new ConflictException('Truck unavailable, setpoint changed, or verified capacity exceeds the fleet record');
    return updated;
  }

  private pairIssue(shipment: Shipment, truck: Truck, currency: string, now: number) {
    if (Math.min(new Date(shipment.deadline).getTime(),new Date(shipment.shelfLifeUntil).getTime()) <= now) return 'Deadline or shelf-life cutoff passed';
    if (truck.synthetic !== null && shipment.synthetic !== truck.synthetic) return 'Synthetic and operational records cannot be paired';
    const issue = truckIssue(truck,now);
    if (issue) return issue;
    if (truck.currency !== currency) return 'Truck cost currency differs from plan currency';
    if (shipment.weightTons > truck.usableTons!) return 'Shipment exceeds verified truck capacity';
    if (!truck.cargoTypes!.includes(shipment.cargoType.toLowerCase())) return 'Cargo type is not verified for this truck';
    return null;
  }

  private quoteKey() {
    const key = process.env.JWT_SECRET;
    if (!key || key.length < 32) throw new ServiceUnavailableException('Approval signing is unavailable');
    return 'coldchain-fleet-quote:' + key;
  }

  async plan(actor: Actor, ownerId: string, input: ReturnType<typeof planInput>) {
    const user = await this.access(actor,ownerId);
    if (this.planners.has(user.sub) || this.planners.size >= 2) {
      throw new ConflictException('Another fleet plan is running. Retry when it finishes');
    }
    this.planners.add(user.sub);
    try {
      const [shipments,trucks] = await Promise.all([
        this.query<Shipment>(SHIPMENT_QUERY + ' AND id=ANY($2::uuid[]) ORDER BY id',[ownerId,input.shipmentIds]),
        this.query<Truck>(TRUCK_QUERY + ' AND t.id=ANY($2::uuid[]) ORDER BY t.id',[ownerId,input.truckIds]),
      ]);
      if (shipments.length !== input.shipmentIds.length || trucks.length !== input.truckIds.length) {
        throw new NotFoundException('Selected records are no longer available in this fleet');
      }
      if (new Set(shipments.map(shipment => shipment.synthetic)).size !== 1) {
        throw new BadRequestException('Plan synthetic and operational shipments separately');
      }
      const reasons = new Map(shipments.map(shipment => [shipment.id, new Set<string>()]));
      const current = Date.now();
      const candidates = shipments.flatMap(shipment => trucks.flatMap(truck => {
        const issue = this.pairIssue(shipment,truck,input.currency,current);
        if (issue) { reasons.get(shipment.id)!.add(issue); return []; }
        return [{shipment,truck}];
      }));
      const routes = new Map<string, Promise<Route | null>>();
      const leg = (from: Coordinates, to: Coordinates) => {
        if (from.latitude === to.latitude && from.longitude === to.longitude) {
          return Promise.resolve({distanceKm:0,durationSeconds:0});
        }
        const key = [from.latitude,from.longitude,to.latitude,to.longitude].join(',');
        const cached = routes.get(key);
        if (cached) return cached;
        const result = this.routing.getRoute(from,to).then(route =>
          route.distanceKm > 0 && route.durationSeconds > 0 ? route : null, () => null);
        routes.set(key,result);
        return result;
      };
      const estimates: { shipment: Shipment; truck: Truck; pickup: Route | null; delivery: Route | null }[] = [];
      for (let i=0; i<candidates.length; i+=3) {
        if (Date.now()-current > 25_000) throw new ServiceUnavailableException('Road routing exceeded the planning budget. Select fewer records and retry');
        estimates.push(...await Promise.all(candidates.slice(i,i+3).map(async ({shipment,truck}) => {
          const origin = {latitude:shipment.originLat,longitude:shipment.originLng};
          const [pickup,delivery] = await Promise.all([
            leg({latitude:truck.latitude!,longitude:truck.longitude!},origin),
            leg(origin,{latitude:shipment.destinationLat,longitude:shipment.destinationLng}),
          ]);
          return {shipment,truck,pickup,delivery};
        })));
      }
      const now = Date.now();
      const quotes: Quote[] = estimates.flatMap(({shipment,truck,pickup,delivery}) => {
        const exclude = (reason: string) => { reasons.get(shipment.id)!.add(reason); return []; };
        const issue = this.pairIssue(shipment,truck,input.currency,now);
        if (issue) return exclude(issue);
        if (!pickup || !delivery) return exclude('Road route unavailable');
        const distanceKm = pickup.distanceKm + delivery.distanceKm;
        const durationSeconds = Math.ceil(pickup.durationSeconds + delivery.durationSeconds + shipment.handlingMinutes * 60);
        const eta = now + durationSeconds * 1000;
        if (eta > new Date(shipment.deadline).getTime()) return exclude('Estimated delivery misses deadline');
        const available = new Date(shipment.shelfLifeUntil).getTime() - now;
        if (eta >= new Date(shipment.shelfLifeUntil).getTime()) return exclude('Estimated delivery exhausts shelf-life reserve');
        return [{
          shipmentId:shipment.id, truckId:truck.id, driverId:truck.driverId!, score:0, distanceKm,
          deadheadKm:pickup.distanceKm, durationSeconds, deliveryAt:new Date(eta).toISOString(),
          cost:round(distanceKm * truck.costPerKm!), reserveMinutes:round((available-durationSeconds*1000)/60_000),
          reserveConsumed:durationSeconds*1000/available, healthScore:truck.healthScore!,
          components:{cost:0,distance:0,duration:0,reserve:0,health:0},
        }];
      });
      const maxima = { cost:Math.max(1,...quotes.map(item=>item.cost)), distance:Math.max(1,...quotes.map(item=>item.distanceKm)),
        duration:Math.max(1,...quotes.map(item=>item.durationSeconds)) };
      for (const quote of quotes) {
        quote.components = {
          cost: Math.round(3500 * quote.cost/maxima.cost), distance: Math.round(1000 * quote.distanceKm/maxima.distance),
          duration: Math.round(2000 * quote.durationSeconds/maxima.duration), reserve: Math.round(2000 * quote.reserveConsumed),
          health: Math.round(1500 * (1-quote.healthScore/100)),
        };
        quote.score = Object.values(quote.components).reduce((sum,value)=>sum+value,0);
      }
      const optimum = optimize(shipments,trucks.map(truck=>truck.id),quotes);
      const baseline = greedy(shipments,quotes);
      const summarize = (choices: Quote[]) => ({
        assigned: choices.length, distanceKm: round(choices.reduce((sum,item)=>sum+item.distanceKm,0)),
        durationMinutes:round(choices.reduce((sum,item)=>sum+item.durationSeconds/60,0)),
        cost:round(choices.reduce((sum,item)=>sum+item.cost,0)), score:choices.reduce((sum,item)=>sum+item.score,0),
        selectedUtilization:round(100*choices.length/trucks.length),
        priorities:Object.fromEntries(['critical','high','standard'].map(priority=>[
          priority, choices.filter(item=>shipments.find(s=>s.id===item.shipmentId)?.priority===priority).length,
        ])),
      });
      const synthetic = shipments[0].synthetic;
      const key = !synthetic && optimum.length ? this.quoteKey() : null;
      return {
        synthetic,currency:input.currency,computedAt:new Date(now).toISOString(),quoteExpiresAt:new Date(now+60_000).toISOString(),
        optimized:{...summarize(optimum), choices:optimum.map(quote=>{
          const truck = trucks.find(item=>item.id===quote.truckId)!;
          const token = key ? sign({ role:user.role,owner:ownerId,shipment:quote.shipmentId,truck:quote.truckId,
            driver:quote.driverId,revision:truck.profileRevision,window:truck.healthWindow,
            duration:quote.durationSeconds,eta:quote.deliveryAt,exp:Math.floor((now+60_000)/1000),
          },key,{algorithm:'HS256',subject:user.sub,audience:'fleet-approval'}) : null;
          return {...quote,token};
        })},
        baseline:{...summarize(baseline),choices:baseline},
        rankings:shipments.map(shipment=>({
          shipmentId:shipment.id,
          options:quotes.filter(item=>item.shipmentId===shipment.id).sort((a,b)=>a.score-b.score || a.truckId.localeCompare(b.truckId)),
          unassigned:!optimum.some(item=>item.shipmentId===shipment.id),
          reasons:[...reasons.get(shipment.id)!],
        })),
      };
    } finally { this.planners.delete(user.sub); }
  }

  async approve(actor: Actor, ownerId: string, token: string) {
    const user = await this.access(actor,ownerId);
    let claim: Claims;
    try {
      claim = verify(token,this.quoteKey(),{algorithms:['HS256'],audience:'fleet-approval',subject:user.sub}) as Claims;
    } catch {
      throw new ConflictException('The quote expired or is invalid. Re-run the plan');
    }
    if (claim.owner !== ownerId || claim.role !== user.role) throw new ConflictException('Quote belongs to another fleet or role');
    const [shipment] = await this.query<Shipment>(SHIPMENT_QUERY + ' AND id=$2 AND synthetic=false',[ownerId,claim.shipment]);
    if (!shipment) throw new ConflictException('Shipment is no longer pending');
    return this.trips.createTrip(user,{
      truck_id:claim.truck,user_id:claim.driver,origin:shipment.origin,destination:shipment.destination,
      cargo_type:shipment.cargoType,notes:`Fleet approval for shipment ${shipment.reference}. Estimated delivery reviewed at ${claim.eta}.`,
    },{ ownerId,shipmentId:claim.shipment,profileRevision:claim.revision,healthWindow:claim.window,
      durationSeconds:claim.duration,expiresAt:new Date(claim.exp*1000).toISOString() });
  }
}
