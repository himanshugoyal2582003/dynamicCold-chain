import { NextResponse } from 'next/server';
import { getDeviceStore, setDeviceStore, stepDeviceSimulation, IoTDevice } from '@/lib/device-data';
import { syncDeviceRegistry } from '@/lib/device-registry-sync';

const AIML_API_URL = process.env.AIML_API_URL || 'http://localhost:8000/api/iot/process';
const AIML_SERVICE_TOKEN = process.env.AIML_SERVICE_TOKEN;

async function streamSingleDevice(device: IoTDevice) {
  // 1. Advance device simulation step
  stepDeviceSimulation(device);

  if (!device.powerOn) {
    return {
      deviceId: device.id,
      connectionNumber: device.connectionNumber,
      skipped: true,
      reason: 'Device powered off',
    };
  }

  // 2. Package raw telemetry
  const rawPayload = {
    device_id: device.id,
    connection_number: device.connectionNumber,
    device_name: device.name,
    product_type: device.productType,
    temperature: device.temp,
    target_temp: device.targetTemp,
    humidity: device.humidity,
    battery: device.battery,
    door_open: device.doorOpen,
    gps_lat: device.gps.lat,
    gps_lng: device.gps.lng,
    speed_kmh: device.gps.speed_kmh,
    status: device.status,
    timestamp: new Date().toISOString(),
  };

  // 3. Send raw data to AI/ML prediction engine
  let enrichedResult: any = null;
  let pipelineSuccess = false;

  try {
    const aiRes = await fetch(AIML_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(AIML_SERVICE_TOKEN ? { 'x-service-token': AIML_SERVICE_TOKEN } : {}),
      },
      body: JSON.stringify(rawPayload),
    });

    if (aiRes.ok) {
      enrichedResult = await aiRes.json();
      pipelineSuccess = true;
    }
  } catch (err: any) {
    console.warn(`[IoT -> AI/ML Pipeline] AI Service unreachable: ${err.message}`);
  }

  // 4. Fallback calculation if AI-ML service is offline
  if (!enrichedResult) {
    const tempDiff = Math.max(0, device.temp - device.targetTemp);
    const mockRisk = Math.min(0.99, Math.max(0.05, tempDiff * 0.12 + (device.doorOpen ? 0.3 : 0)));
    enrichedResult = {
      spoilage_risk: Math.round(mockRisk * 100) / 100,
      spoilage_risk_level: mockRisk > 0.6 ? 'HIGH' : mockRisk > 0.3 ? 'MODERATE' : 'LOW',
      shelf_life_remaining_hours: Math.round(Math.max(2, 72 / (1 + tempDiff * 0.5))),
      quality_retention_pct: Math.round(Math.max(5, 100 - mockRisk * 80)),
      route_recommendation: mockRisk > 0.5 ? 'Reroute to nearest cold depot' : 'Route optimal',
      reroute_suggested: mockRisk > 0.5,
      timestamp: new Date().toISOString(),
    };
  }

  // 5. Update device state with latest AI prediction
  device.lastPipelineResult = {
    spoilageRisk: enrichedResult.spoilage_risk,
    spoilageRiskLevel: enrichedResult.spoilage_risk_level,
    rslHours: enrichedResult.shelf_life_remaining_hours,
    qualityRetentionPct: enrichedResult.quality_retention_pct,
    routeRecommendation: enrichedResult.route_recommendation,
    rerouteSuggested: Boolean(enrichedResult.reroute_suggested),
    nearestSafeMarket: enrichedResult.nearest_safe_market || null,
    timestamp: enrichedResult.timestamp,
  };

  return {
    deviceId: device.id,
    connectionNumber: device.connectionNumber,
    rawPayload,
    enrichedResult,
    pipelineSuccess,
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const store = getDeviceStore();
    await syncDeviceRegistry(store);
    const { deviceId } = body;

    if (deviceId) {
      const target = store.find((d) => d.id === deviceId);
      if (!target) {
        return NextResponse.json({ success: false, error: 'Device not found' }, { status: 404 });
      }
      const result = await streamSingleDevice(target);
      setDeviceStore(store);
      return NextResponse.json({ success: true, result, device: target });
    }

    // Stream all active/powered-on devices
    const results = [];
    for (const d of store) {
      if (d.powerOn) {
        const res = await streamSingleDevice(d);
        results.push(res);
      }
    }

    setDeviceStore(store);
    return NextResponse.json({
      success: true,
      processedCount: results.length,
      results,
      devices: store,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

