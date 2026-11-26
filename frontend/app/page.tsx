import React from 'react';
import Link from 'next/link';
import {
  Activity,
  ArrowRight,
  Cpu,
  MapPin,
  ShieldCheck,
  ThermometerSnowflake,
  Truck,
  Warehouse,
} from 'lucide-react';
import TruckHero from '@/components/hero/TruckHero';
import WarehouseNetworkMap from '@/components/hero/WarehouseNetworkMap';
import IotDeviceShowcase from '@/components/hero/IotDeviceShowcase';

const PILLARS = [
  {
    icon: ThermometerSnowflake,
    title: 'Continuous Reefer Telemetry',
    desc: 'Live ESP32 & DHT22 sensor ingestion across −30°C to +25°C cargo holds, with instant door-open, humidity, and thermal excursion alerts.',
  },
  {
    icon: Cpu,
    title: 'PyTorch SpoilageLSTM AI',
    desc: 'Sequence-based deep learning forecasts Remaining Shelf Life (RSL) and quality retention in real time, recommending safe cold-hub reroutes before spoilage.',
  },
  {
    icon: ShieldCheck,
    title: 'Dynamic InsuranceLSTM',
    desc: 'Usage-based cargo insurance pricing driven by actual thermal compliance, door-seal discipline, and verified trip history.',
  },
  {
    icon: Truck,
    title: 'Unified Fleet Dispatch',
    desc: 'Role-specific command portals for Administrators, Fleet Owners, and Drivers with live GPS sharing, route playback, and audit trails.',
  },
];

const PIPELINE = [
  {
    step: '01',
    title: 'Edge Sensor & GPS Ingest',
    detail: 'Hardware nodes and driver mobile GPS stream temperature, humidity, door state, and coordinates every 4 seconds.',
  },
  {
    step: '02',
    title: 'Dual-LSTM Risk & Pricing',
    detail: 'Our FastAPI PyTorch engine scores cargo spoilage risk, updates shelf-life hours, and recalculates dynamic insurance premiums.',
  },
  {
    step: '03',
    title: 'Warehouse-Aware Routing',
    detail: 'When a thermal excursion occurs, dispatchers and drivers see the nearest verified cold-storage hub across our 4,934-facility network.',
  },
];

export default function HomePage() {
  return (
    <div className="min-h-screen bg-paper text-ink selection:bg-gold selection:text-paper">
      {/* Top Header */}
      <header className="sticky top-0 z-30 bg-paper/95 backdrop-blur border-b border-hairline">
        <div className="max-w-7xl mx-auto px-6 md:px-10 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-4 h-4 bg-gold rounded-sm" />
            <span className="text-sm font-semibold tracking-widest text-ink uppercase">
              COLDCHAIN
            </span>
            <span className="hidden sm:inline text-xs text-slate tracking-wider pl-3 border-l border-hairline">
              FLEET INTELLIGENCE
            </span>
          </div>

          <nav className="flex items-center space-x-6 text-sm">
            <a href="#services" className="hidden md:inline text-slate hover:text-ink transition-colors">
              Capabilities
            </a>
            <a href="#hardware" className="hidden md:inline text-slate hover:text-ink transition-colors">
              Hardware
            </a>
            <a href="#network" className="hidden md:inline text-slate hover:text-ink transition-colors">
              Warehouse Map
            </a>
            <a href="#architecture" className="hidden md:inline text-slate hover:text-ink transition-colors">
              How It Works
            </a>
            <Link
              href="/login"
              className="px-5 py-2 text-sm text-ink border border-hairline hover:border-gold hover:text-gold transition-colors duration-200 rounded font-medium"
            >
              Sign in
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero Section */}
      <section className="max-w-7xl mx-auto px-6 md:px-10 pt-14 pb-16">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
          <div className="lg:col-span-6 space-y-5">
            <span className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-gold">
              <Activity className="w-3.5 h-3.5" />
              Enterprise Cold-Chain Logistics
            </span>
            <h1 className="text-4xl md:text-6xl font-light tracking-tight text-ink leading-[1.08] font-serif">
              Every truck in your fleet,{' '}
              <span className="italic font-normal">in one clear view.</span>
            </h1>
            <p className="text-slate text-base md:text-lg leading-relaxed max-w-xl">
              ColdChain combines live IoT reefer telemetry, PyTorch shelf-life prediction, usage-based cargo insurance, and a nationwide GIS network of 4,934 cold-storage facilities to protect temperature-sensitive freight from origin to dock.
            </p>

            <div className="pt-2 flex items-center gap-3 flex-wrap">
              <Link
                href="/login"
                className="inline-flex items-center gap-2 px-6 py-3 bg-ink text-paper hover:bg-gold text-sm tracking-wide transition-colors duration-200 rounded font-medium shadow-sm"
              >
                Sign in to Portal
                <ArrowRight className="w-4 h-4" />
              </Link>
              <a
                href="#network"
                className="px-6 py-3 border border-hairline text-sm text-ink hover:border-gold hover:text-gold transition-colors duration-200 rounded font-medium"
              >
                Explore 4,934 Warehouses
              </a>
              <a
                href="http://localhost:3001"
                target="_blank"
                rel="noreferrer"
                className="px-5 py-3 text-sm text-slate hover:text-ink transition-colors duration-200"
              >
                IoT Hardware Portal &rarr;
              </a>
            </div>
          </div>

          <div className="lg:col-span-6">
            <TruckHero />
          </div>
        </div>

        {/* Key Metrics Strip */}
        <div className="mt-14 grid grid-cols-2 md:grid-cols-4 gap-4 border-y border-hairline py-6">
          <div>
            <p className="text-2xl md:text-3xl font-serif font-semibold text-ink tabular-nums">4,934</p>
            <p className="text-xs text-slate uppercase tracking-wider mt-1">Mapped Cold Warehouses</p>
          </div>
          <div>
            <p className="text-2xl md:text-3xl font-serif font-semibold text-ink tabular-nums">4 sec</p>
            <p className="text-xs text-slate uppercase tracking-wider mt-1">Live Telemetry Cadence</p>
          </div>
          <div>
            <p className="text-2xl md:text-3xl font-serif font-semibold text-ink">Dual-LSTM</p>
            <p className="text-xs text-slate uppercase tracking-wider mt-1">Spoilage &amp; Insurance AI</p>
          </div>
          <div>
            <p className="text-2xl md:text-3xl font-serif font-semibold text-ink">−30°C / +25°C</p>
            <p className="text-xs text-slate uppercase tracking-wider mt-1">Supervised Thermal Range</p>
          </div>
        </div>
      </section>

      {/* What We Do / Capabilities */}
      <section id="services" className="max-w-7xl mx-auto px-6 md:px-10 py-16">
        <div className="max-w-2xl mb-10">
          <span className="text-xs font-medium uppercase tracking-widest text-gold">What We Do</span>
          <h2 className="text-3xl md:text-4xl font-serif font-light text-ink mt-2">
            End-to-end thermal supervision for pharmaceuticals, dairy, and frozen freight.
          </h2>
          <p className="text-slate text-sm md:text-base mt-3 leading-relaxed">
            Built for fleet operators who cannot afford silent compressor failures or unverified transit logs. Every vehicle, sensor, and shipment is audited in real time.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          {PILLARS.map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.title}
                className="p-6 rounded border border-hairline bg-white/70 hover:border-gold/60 transition-colors space-y-3"
              >
                <div className="w-10 h-10 rounded border border-hairline bg-paper flex items-center justify-center text-gold">
                  <Icon className="w-5 h-5" strokeWidth={1.75} />
                </div>
                <h3 className="text-base font-semibold text-ink">{item.title}</h3>
                <p className="text-xs md:text-sm text-slate leading-relaxed">{item.desc}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Hardware Showcase: ColdChain Sentinel X1 */}
      <section id="hardware" className="max-w-7xl mx-auto px-6 md:px-10 py-16 border-t border-hairline">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-10">
          <div className="max-w-2xl">
            <span className="text-xs font-medium uppercase tracking-widest text-gold">
              Hardware Telemetry Unit
            </span>
            <h2 className="text-3xl md:text-4xl font-serif font-light text-ink mt-2">
              ColdChain Sentinel X1 — Rugged Edge Gateway
            </h2>
            <p className="text-slate text-sm md:text-base mt-2 leading-relaxed">
              Purpose-built ESP32-S3 cold-chain node with dual-probe temperature sensing, magnetic door reed switch, 4G/LTE-M + GPS uplink, and a 72-hour LiFePO4 battery reserve.
            </p>
          </div>
          <a
            href="http://localhost:3001"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-ink text-paper hover:bg-gold transition-colors rounded text-sm font-medium shrink-0"
          >
            Launch Live IoT Simulator
            <ArrowRight className="w-4 h-4" />
          </a>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          <div className="lg:col-span-6 rounded border border-hairline bg-white/70 p-4 flex flex-col justify-between">
            <div className="relative w-full h-[360px] rounded overflow-hidden border border-hairline bg-[#F7F6F3]">
              <img
                src="/images/iot-device.jpg"
                alt="ColdChain Sentinel X1 IoT Sensor Gateway"
                className="w-full h-full object-cover"
              />
            </div>
            <div className="pt-4 grid grid-cols-3 gap-3 text-xs">
              <div className="p-2.5 rounded bg-paper border border-hairline">
                <p className="text-slate uppercase tracking-wider text-[10px]">Accuracy</p>
                <p className="font-semibold text-ink mt-0.5">±0.1°C PT1000</p>
              </div>
              <div className="p-2.5 rounded bg-paper border border-hairline">
                <p className="text-slate uppercase tracking-wider text-[10px]">Enclosure</p>
                <p className="font-semibold text-ink mt-0.5">IP67 Aluminum</p>
              </div>
              <div className="p-2.5 rounded bg-paper border border-hairline">
                <p className="text-slate uppercase tracking-wider text-[10px]">Reserve</p>
                <p className="font-semibold text-ink mt-0.5">72h LiFePO4</p>
              </div>
            </div>
          </div>

          <div className="lg:col-span-6 rounded border border-hairline bg-white/70 p-4 flex flex-col justify-between">
            <IotDeviceShowcase />
            <div className="pt-4 grid grid-cols-3 gap-3 text-xs">
              <div className="p-2.5 rounded bg-paper border border-hairline">
                <p className="text-slate uppercase tracking-wider text-[10px]">Uplink</p>
                <p className="font-semibold text-ink mt-0.5">LTE-M + LoRa</p>
              </div>
              <div className="p-2.5 rounded bg-paper border border-hairline">
                <p className="text-slate uppercase tracking-wider text-[10px]">Pairing</p>
                <p className="font-semibold text-ink mt-0.5">CONN-XXXX Code</p>
              </div>
              <div className="p-2.5 rounded bg-paper border border-hairline">
                <p className="text-slate uppercase tracking-wider text-[10px]">Cadence</p>
                <p className="font-semibold text-ink mt-0.5">4s Real-Time</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* National Cold-Storage Warehouse Network Map */}
      <section id="network" className="border-y border-hairline bg-white/60 py-16">
        <div className="max-w-7xl mx-auto px-6 md:px-10 space-y-6">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div className="max-w-2xl">
              <span className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-widest text-gold">
                <Warehouse className="w-3.5 h-3.5" />
                National Cold-Storage Infrastructure
              </span>
              <h2 className="text-3xl md:text-4xl font-serif font-light text-ink mt-2">
                4,934 verified cold warehouses across India.
              </h2>
              <p className="text-slate text-sm md:text-base mt-2 leading-relaxed">
                Click any facility marker on the map below to inspect its project name, state, district, and exact GIS coordinates used for emergency cold-hub rerouting.
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate">
              <MapPin className="w-4 h-4 text-gold" />
              <span>GIS Dataset: GeoIndia Cold-Storage Registry</span>
            </div>
          </div>

          <WarehouseNetworkMap />
        </div>
      </section>

      {/* How It Works / Architecture */}
      <section id="architecture" className="max-w-7xl mx-auto px-6 md:px-10 py-16">
        <div className="max-w-2xl mb-10">
          <span className="text-xs font-medium uppercase tracking-widest text-gold">How It Works</span>
          <h2 className="text-3xl md:text-4xl font-serif font-light text-ink mt-2">
            From sensor reading to dispatch decision in seconds.
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {PIPELINE.map((p) => (
            <div key={p.step} className="p-6 rounded border border-hairline bg-white/70 space-y-3">
              <span className="font-mono text-xs font-semibold text-gold tracking-widest">STEP {p.step}</span>
              <h3 className="text-lg font-semibold text-ink">{p.title}</h3>
              <p className="text-sm text-slate leading-relaxed">{p.detail}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Enterprise CTA */}
      <section className="max-w-7xl mx-auto px-6 md:px-10 pb-16">
        <div className="rounded border border-hairline bg-ink text-paper p-8 md:p-12 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="space-y-2 max-w-xl">
            <span className="text-xs uppercase tracking-widest text-gold font-medium">
              Fleet Operations Portal
            </span>
            <h2 className="text-2xl md:text-3xl font-serif font-light">
              Ready to monitor your fleet and protect every shipment?
            </h2>
            <p className="text-sm text-paper/75">
              Sign in as an Administrator, Fleet Owner, or Driver to dispatch routes, stream live telemetry, and review AI insurance scoring.
            </p>
          </div>
          <Link
            href="/login"
            className="inline-flex items-center gap-2 px-6 py-3 bg-gold text-ink hover:bg-paper transition-colors rounded text-sm font-semibold shrink-0"
          >
            Launch Control Portal
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-hairline bg-white/50">
        <div className="max-w-7xl mx-auto px-6 md:px-10 py-10 grid grid-cols-1 md:grid-cols-4 gap-8 text-xs text-slate">
          <div className="md:col-span-2 space-y-2">
            <div className="flex items-center space-x-2">
              <div className="w-3 h-3 bg-gold rounded-sm" />
              <span className="text-xs font-semibold tracking-widest text-ink uppercase">
                COLDCHAIN FLEET INTELLIGENCE
              </span>
            </div>
            <p className="max-w-md leading-relaxed">
              Enterprise refrigerated logistics, PyTorch shelf-life &amp; insurance modeling, and real-time GPS fleet orchestration.
            </p>
          </div>
          <div className="space-y-2">
            <p className="font-semibold text-ink uppercase tracking-wider">Platform</p>
            <div className="flex flex-col space-y-1.5">
              <a href="#services" className="hover:text-ink">Capabilities</a>
              <a href="#network" className="hover:text-ink">Warehouse Network</a>
              <a href="#architecture" className="hover:text-ink">Architecture</a>
            </div>
          </div>
          <div className="space-y-2">
            <p className="font-semibold text-ink uppercase tracking-wider">Portals</p>
            <div className="flex flex-col space-y-1.5">
              <Link href="/login" className="hover:text-ink">Control Portal Sign In</Link>
              <a href="http://localhost:3001" target="_blank" rel="noreferrer" className="hover:text-ink">
                IoT Hardware Simulator
              </a>
              <span className="flex items-center gap-2 pt-1">
                <span className="w-2 h-2 rounded-full bg-status-available inline-block animate-pulse" />
                <span>Neon Cloud Postgres Active</span>
              </span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
