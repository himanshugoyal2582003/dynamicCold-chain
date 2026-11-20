'use client';

import dynamic from 'next/dynamic';

/**
 * SSR-safe wrapper for FleetMap.
 * Use this in any page that imports the map — it disables server-side rendering
 * so Leaflet (which requires `window`) is only loaded in the browser.
 */
export const FleetMapLoader = dynamic(() => import('./FleetMap'), { ssr: false });

export type { MapTruck } from './FleetMap';

export default FleetMapLoader;
