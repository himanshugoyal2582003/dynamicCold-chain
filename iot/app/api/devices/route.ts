import { NextResponse } from 'next/server';
import {
  getDeviceStore,
  setDeviceStore,
  createNewDevice,
  initialDevices,
  IoTDevice,
} from '@/lib/device-data';
import { syncDeviceRegistry } from '@/lib/device-registry-sync';

export async function GET() {
  const devices = getDeviceStore();
  await syncDeviceRegistry(devices);
  const onlineCount = devices.filter((d) => d.powerOn && d.status !== 'offline').length;
  const warningCount = devices.filter((d) => d.status === 'warning').length;
  const avgTemp = devices.length
    ? (devices.reduce((acc, d) => acc + d.temp, 0) / devices.length).toFixed(1)
    : '0.0';

  return NextResponse.json({
    success: true,
    devices,
    summary: {
      totalDevices: devices.length,
      onlineCount,
      warningCount,
      avgTemp,
      availableConnections: devices
        .filter((d) => d.powerOn)
        .map((d) => ({
          id: d.id,
          name: d.name,
          connectionNumber: d.connectionNumber,
          temp: d.temp,
          productType: d.productType,
        })),
    },
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const store = getDeviceStore();

    // 1. Bulk set device count
    if (body.action === 'set_count' && typeof body.count === 'number') {
      const targetCount = Math.max(1, Math.min(12, body.count));
      while (store.length < targetCount) {
        createNewDevice({});
      }
      const removedDeviceIds = store.slice(targetCount).map((device) => device.id);
      if (store.length > targetCount) {
        store.splice(targetCount);
        setDeviceStore(store);
      }
      const devices = getDeviceStore();
      await syncDeviceRegistry(devices, removedDeviceIds);
      return NextResponse.json({ success: true, devices });
    }

    // 2. Reset to initial demo fleet
    if (body.action === 'reset_demo') {
      const reset = JSON.parse(JSON.stringify(initialDevices));
      const removedDeviceIds = store.filter((device) => !reset.some((candidate: IoTDevice) => candidate.id === device.id)).map((device) => device.id);
      setDeviceStore(reset);
      await syncDeviceRegistry(reset, removedDeviceIds);
      return NextResponse.json({ success: true, devices: reset });
    }

    // 3. Add single device
    const created = createNewDevice({
      name: body.name,
      productType: body.productType,
      targetTemp: body.targetTemp,
    });
    const devices = getDeviceStore();
    await syncDeviceRegistry(devices);
    return NextResponse.json({ success: true, device: created, devices });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { id, powerOn, anomaly, targetTemp } = body;
    const store = getDeviceStore();
    const device = store.find((d) => d.id === id);

    if (!device) {
      return NextResponse.json({ success: false, error: 'Device not found' }, { status: 404 });
    }

    if (typeof powerOn === 'boolean') {
      device.powerOn = powerOn;
      device.status = powerOn ? (device.anomaly !== 'normal' ? 'warning' : 'online') : 'offline';
    }

    if (anomaly) {
      device.anomaly = anomaly;
      if (anomaly === 'normal') {
        device.doorOpen = false;
        device.status = device.powerOn ? 'online' : 'offline';
      } else {
        device.status = 'warning';
      }
    }

    if (typeof targetTemp === 'number') {
      device.targetTemp = targetTemp;
    }

    setDeviceStore(store);
    await syncDeviceRegistry(store);
    return NextResponse.json({ success: true, device });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ success: false, error: 'id required' }, { status: 400 });
    }

    const store = getDeviceStore();
    const filtered = store.filter((d) => d.id !== id);
    setDeviceStore(filtered);
    await syncDeviceRegistry(filtered, [id]);

    return NextResponse.json({ success: true, devices: filtered });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 400 });
  }
}
