import React from 'react';
import Link from 'next/link';
import TruckHero from '@/components/hero/TruckHero';

export default function HomePage() {
  return (
    <main className="min-h-screen bg-paper flex flex-col justify-between p-6 md:p-12 selection:bg-gold selection:text-paper">
      {/* Top Header */}
      <header className="flex items-center justify-between border-b border-hairline pb-6">
        <div className="flex items-center space-x-3">
          <div className="w-4 h-4 bg-gold rounded-sm" />
          <span className="text-sm font-semibold tracking-widest text-ink uppercase">
            COLDCHAIN
          </span>
          <span className="text-xs text-slate tracking-wider pl-2 border-l border-hairline">
            FLEET PLATFORM
          </span>
        </div>

        <nav className="flex items-center space-x-4">
          <Link
            href="/login"
            className="px-5 py-2 text-sm text-ink border border-hairline hover:border-gold hover:text-gold transition-colors duration-200 rounded"
          >
            Sign in
          </Link>
        </nav>
      </header>

      {/* Hero Section */}
      <section className="my-auto py-12 max-w-4xl mx-auto w-full text-center md:text-left">
        <div className="space-y-4 max-w-xl">
          <span className="text-xs font-medium uppercase tracking-widest text-gold">
            Cold-Chain Integrity
          </span>
          <h1 className="text-4xl md:text-6xl font-light tracking-tight text-ink leading-tight font-serif">
            Every truck in your fleet, <br />
            <span className="italic font-normal">in one clear view.</span>
          </h1>
          <p className="text-slate text-base md:text-lg leading-relaxed pt-2 max-w-lg">
            Continuous temperature supervision, compliance tracking, and direct driver dispatching designed for elite logistics houses.
          </p>

          <div className="pt-4 flex items-center space-x-4 flex-wrap">
            <Link
              href="/login"
              className="px-6 py-3 bg-ink text-paper hover:bg-gold text-sm tracking-wide transition-colors duration-200 rounded font-medium shadow-sm"
            >
              Sign in to Portal
            </Link>
            <a
              href="http://localhost:3001"
              target="_blank"
              rel="noreferrer"
              className="px-6 py-3 border border-hairline text-sm text-slate hover:text-ink transition-colors duration-200 rounded"
            >
              Open IoT Portal
            </a>
            <a
              href="#services"
              className="px-6 py-3 text-sm text-slate hover:text-ink transition-colors duration-200"
            >
              System Overview &rarr;
            </a>
          </div>
        </div>

        {/* 3D Truck Animation */}
        <div className="mt-10">
          <TruckHero />
        </div>
      </section>

      {/* Footer / System Status */}
      <footer id="services" className="border-t border-hairline pt-6 flex flex-col md:flex-row items-center justify-between text-xs text-slate space-y-3 md:space-y-0">
        <div>
          <span>GLA University · Elite Avengers · Phase 1 Deployment</span>
        </div>
        <div className="flex items-center space-x-6">
          <span className="flex items-center space-x-2">
            <span className="w-2 h-2 rounded-full bg-status-available inline-block animate-pulse" />
            <span>Neon Cloud Postgres & Services Active</span>
          </span>
          <span>Terms & Privacy</span>
        </div>
      </footer>
    </main>
  );
}
