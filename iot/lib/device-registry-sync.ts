import type { IoTDevice } from './device-data';

/** Sync the simulator registry server-to-server; the shared token stays server-only. */
export async function syncDeviceRegistry(devices: IoTDevice[], removedDeviceIds: string[] = []): Promise<void> {
  const secret = process.env.IOT_INGEST_SECRET;
  if (!secret) throw new Error('IOT_INGEST_SECRET must be configured in the IoT simulator environment.');
  const backend = (process.env.BACKEND_API_URL || 'http://localhost:4000').replace(/\/$/, '');
  const response = await fetch(`${backend}/api/iot/devices/registry-sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-iot-ingest-secret': secret },
    body: JSON.stringify({
      removedDeviceIds,
      devices: devices.map((device) => ({
        id: device.id,
        connectionNumber: device.connectionNumber,
        name: device.name,
        productType: device.productType,
        battery: device.battery,
        powerOn: device.powerOn,
        status: device.status,
      })),
    }),
    cache: 'no-store',
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Backend device registry sync failed (HTTP ${response.status})${detail ? `: ${detail.slice(0, 180)}` : '.'}`);
  }
}
