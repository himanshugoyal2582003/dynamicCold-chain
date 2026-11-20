export class UpdateLocationDto {
  latitude: number;
  longitude: number;
  accuracy_m?: number;
  speed_kmh?: number;
  heading?: number;
  timestamp: string; // ISO 8601 string

  static validate(body: any): { dto: UpdateLocationDto; error?: string } {
    const dto = new UpdateLocationDto();

    const lat = Number(body.latitude);
    const lon = Number(body.longitude);

    if (body.latitude === undefined || body.latitude === null || isNaN(lat)) {
      return { dto, error: 'latitude is required and must be a number' };
    }
    if (lat < -90 || lat > 90) {
      return { dto, error: 'latitude must be between -90 and 90' };
    }

    if (body.longitude === undefined || body.longitude === null || isNaN(lon)) {
      return { dto, error: 'longitude is required and must be a number' };
    }
    if (lon < -180 || lon > 180) {
      return { dto, error: 'longitude must be between -180 and 180' };
    }

    if (!body.timestamp || typeof body.timestamp !== 'string') {
      return { dto, error: 'timestamp is required and must be an ISO 8601 string' };
    }
    const ts = new Date(body.timestamp);
    if (isNaN(ts.getTime())) {
      return { dto, error: 'timestamp must be a valid ISO 8601 string' };
    }

    dto.latitude = lat;
    dto.longitude = lon;
    dto.timestamp = body.timestamp;

    if (body.accuracy_m !== undefined && body.accuracy_m !== null) {
      dto.accuracy_m = Number(body.accuracy_m);
    }
    if (body.speed_kmh !== undefined && body.speed_kmh !== null) {
      dto.speed_kmh = Number(body.speed_kmh);
    }
    if (body.heading !== undefined && body.heading !== null) {
      dto.heading = Number(body.heading);
    }

    return { dto };
  }
}
