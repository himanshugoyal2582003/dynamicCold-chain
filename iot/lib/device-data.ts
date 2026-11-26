export type DeviceStatus = 'online' | 'offline' | 'warning';
export type AnomalyType = 'normal' | 'temp_spike' | 'door_open' | 'compressor_failure' | 'rapid_defrost';

export interface IoTDevice {
  id: string;
  name: string;
  connectionNumber: string;
  productType: string;
  targetTemp: number;
  temp: number;
  humidity: number;
  battery: number;
  doorOpen: boolean;
  gps: {
    lat: number;
    lng: number;
    speed_kmh: number;
    heading: number;
  };
  powerOn: boolean;
  status: DeviceStatus;
  anomaly: AnomalyType;
  lastUpdated: string;
  lastPipelineResult?: {
    spoilageRisk: number;
    spoilageRiskLevel: string;
    rslHours: number;
    qualityRetentionPct: number;
    routeRecommendation: string;
    rerouteSuggested: boolean;
    nearestSafeMarket?: string | null;
    timestamp: string;
  } | null;
}

export const PRODUCT_OPTIONS = [
  { name: 'Dairy (Pasteurized Milk & Cream)', targetTemp: 3.5, critTemp: 8.0 },
  { name: 'Vaccines & Pharmaceuticals', targetTemp: 4.0, critTemp: 8.0 },
  { name: 'Fresh Seafood (Chilled)', targetTemp: 0.5, critTemp: 4.0 },
  { name: 'Frozen Meat & Poultry', targetTemp: -18.0, critTemp: -12.0 },
  { name: 'Fresh Berries & Produce', targetTemp: 2.0, critTemp: 7.0 },
];

function generateConnNumber(index?: number): string {
  const codes = ['4821', '9042', '1188', '7730', '3901', '6512', '8204', '5190'];
  if (index !== undefined && index < codes.length) {
    return `CONN-${codes[index]}`;
  }
  const random4Digits = Math.floor(1000 + Math.random() * 9000);
  return `CONN-${random4Digits}`;
}

export const initialDevices: IoTDevice[] = [
  {
    id: 'DEV-ESP32-01',
    name: 'ESP32 Sensor Unit #1 (Driver A)',
    connectionNumber: 'CONN-4821',
    productType: 'Dairy (Pasteurized Milk & Cream)',
    targetTemp: 3.5,
    temp: 3.6,
    humidity: 68,
    battery: 94,
    doorOpen: false,
    gps: { lat: 19.0760, lng: 72.8777, speed_kmh: 52.0, heading: 45 },
    powerOn: true,
    status: 'online',
    anomaly: 'normal',
    lastUpdated: 'Just now',
    lastPipelineResult: {
      spoilageRisk: 0.06,
      spoilageRiskLevel: 'LOW',
      rslHours: 120.0,
      qualityRetentionPct: 98.2,
      routeRecommendation: 'ROUTE OPTIMAL: Cargo quality pristine. Target destination on schedule.',
      rerouteSuggested: false,
      timestamp: new Date().toISOString(),
    },
  },
  {
    id: 'DEV-ESP32-02',
    name: 'ESP32 Sensor Unit #2 (Driver B)',
    connectionNumber: 'CONN-9042',
    productType: 'Frozen Meat & Poultry',
    targetTemp: -18.0,
    temp: -17.8,
    humidity: 74,
    battery: 88,
    doorOpen: false,
    gps: { lat: 19.2183, lng: 72.9781, speed_kmh: 60.5, heading: 90 },
    powerOn: true,
    status: 'online',
    anomaly: 'normal',
    lastUpdated: 'Just now',
    lastPipelineResult: {
      spoilageRisk: 0.05,
      spoilageRiskLevel: 'LOW',
      rslHours: 240.0,
      qualityRetentionPct: 99.1,
      routeRecommendation: 'ROUTE OPTIMAL: Cargo quality pristine. Target destination on schedule.',
      rerouteSuggested: false,
      timestamp: new Date().toISOString(),
    },
  },
  {
    id: 'DEV-ESP32-03',
    name: 'ESP32 Sensor Unit #3 (Driver C)',
    connectionNumber: 'CONN-1188',
    productType: 'Fresh Seafood (Chilled)',
    targetTemp: 0.5,
    temp: 2.1,
    humidity: 82,
    battery: 79,
    doorOpen: false,
    gps: { lat: 19.8762, lng: 75.3433, speed_kmh: 44.0, heading: 120 },
    powerOn: true,
    status: 'online',
    anomaly: 'normal',
    lastUpdated: 'Just now',
    lastPipelineResult: {
      spoilageRisk: 0.22,
      spoilageRiskLevel: 'LOW',
      rslHours: 42.0,
      qualityRetentionPct: 88.5,
      routeRecommendation: 'ROUTE OPTIMAL: Cargo quality pristine. Target destination on schedule.',
      rerouteSuggested: false,
      timestamp: new Date().toISOString(),
    },
  },
  {
    id: 'DEV-ESP32-04',
    name: 'ESP32 Sensor Unit #4 (Driver D)',
    connectionNumber: 'CONN-7730',
    productType: 'Vaccines & Pharmaceuticals',
    targetTemp: 4.0,
    temp: 5.2,
    humidity: 62,
    battery: 68,
    doorOpen: false,
    gps: { lat: 20.2961, lng: 85.8245, speed_kmh: 0, heading: 0 },
    powerOn: false,
    status: 'offline',
    anomaly: 'normal',
    lastUpdated: '10 min ago',
    lastPipelineResult: null,
  },
];

// In-memory global state for the Next.js server runtime
declare global {
  // eslint-disable-next-line no-var
  var __coldChainIotDevices: IoTDevice[] | undefined;
}

export function getDeviceStore(): IoTDevice[] {
  if (!global.__coldChainIotDevices) {
    global.__coldChainIotDevices = JSON.parse(JSON.stringify(initialDevices));
  }
  return global.__coldChainIotDevices!;
}

export function setDeviceStore(devices: IoTDevice[]) {
  global.__coldChainIotDevices = devices;
}

export function createNewDevice(params: {
  name?: string;
  productType?: string;
  targetTemp?: number;
}): IoTDevice {
  const store = getDeviceStore();
  const nextNum = store.length + 1;
  const prod = PRODUCT_OPTIONS.find((p) => p.name === params.productType) || PRODUCT_OPTIONS[0];
  const existingIds = new Set(store.map((d) => d.id));
  const existingConns = new Set(store.map((d) => d.connectionNumber));

  let idSuffix = nextNum;
  while (existingIds.has(`DEV-ESP32-${String(idSuffix).padStart(2, '0')}`)) {
    idSuffix++;
  }

  let conn = generateConnNumber(store.length);
  while (existingConns.has(conn)) {
    conn = generateConnNumber();
  }

  const validTargetTemp =
    typeof params.targetTemp === 'number' && Number.isFinite(params.targetTemp)
      ? params.targetTemp
      : prod.targetTemp;

  const newDevice: IoTDevice = {
    id: `DEV-ESP32-${String(idSuffix).padStart(2, '0')}`,
    name: params.name || `ESP32 Sensor Unit #${idSuffix}`,
    connectionNumber: conn,
    productType: prod.name,
    targetTemp: validTargetTemp,
    temp: validTargetTemp,
    humidity: 65 + Math.floor(Math.random() * 10),
    battery: 95 - Math.floor(Math.random() * 10),
    doorOpen: false,
    gps: {
      lat: 19.0760 + (Math.random() - 0.5) * 0.2,
      lng: 72.8777 + (Math.random() - 0.5) * 0.2,
      speed_kmh: 45 + Math.floor(Math.random() * 20),
      heading: Math.floor(Math.random() * 360),
    },
    powerOn: true,
    status: 'online',
    anomaly: 'normal',
    lastUpdated: 'Just created',
    lastPipelineResult: null,
  };

  store.push(newDevice);
  setDeviceStore(store);
  return newDevice;
}

export function stepDeviceSimulation(device: IoTDevice): IoTDevice {
  if (!device.powerOn) {
    device.status = 'offline';
    device.lastUpdated = 'Powered off';
    return device;
  }

  // Small random walk for temperature depending on anomaly
  let tempDelta = (Math.random() - 0.48) * 0.2;
  let targetHumidDelta = (Math.random() - 0.5) * 1.0;

  switch (device.anomaly) {
    case 'temp_spike':
      tempDelta = 1.2 + Math.random() * 0.8;
      device.temp = Math.min(28.0, device.temp + tempDelta);
      device.status = 'warning';
      break;
    case 'door_open':
      device.doorOpen = true;
      tempDelta = 0.8 + Math.random() * 0.5;
      device.temp = Math.min(22.0, device.temp + tempDelta);
      device.humidity = Math.min(95, device.humidity + 3);
      device.status = 'warning';
      break;
    case 'compressor_failure':
      tempDelta = 1.5 + Math.random() * 1.0;
      device.temp = Math.min(32.0, device.temp + tempDelta);
      device.status = 'warning';
      break;
    case 'rapid_defrost':
      device.temp = Math.min(12.0, device.temp + 0.9);
      device.status = 'warning';
      break;
    case 'normal':
    default:
      device.doorOpen = false;
      const diff = device.targetTemp - device.temp;
      device.temp = device.temp + diff * 0.15 + (Math.random() - 0.5) * 0.1;
      device.status = 'online';
      break;
  }

  device.temp = Math.round(device.temp * 10) / 10;
  device.humidity = Math.max(30, Math.min(99, Math.round((device.humidity + targetHumidDelta) * 10) / 10));
  device.battery = Math.max(5, Math.round((device.battery - 0.02) * 10) / 10);

  // Slight GPS motion
  device.gps.lat = Math.round((device.gps.lat + (Math.random() - 0.49) * 0.001) * 10000) / 10000;
  device.gps.lng = Math.round((device.gps.lng + (Math.random() - 0.49) * 0.001) * 10000) / 10000;
  device.lastUpdated = 'Just now';

  return device;
}
