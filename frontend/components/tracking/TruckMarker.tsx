'use client';

/**
 * TruckMarker — pure HTML/color helpers for Leaflet DivIcon truck markers.
 *
 * This component does NOT import or create Leaflet markers.
 * It only generates the iconHtml string and statusColor used inside FleetMap.tsx.
 */

export type TruckStatus = 'available' | 'on_trip' | 'maintenance' | string;

export interface TruckMarkerProps {
  status: TruckStatus;
  plate_number: string;
  isSelected: boolean;
  isGpsLive: boolean;
}

export interface TruckMarkerResult {
  iconHtml: string;
  statusColor: string;
}

export function getStatusColor(status: TruckStatus): string {
  switch (status) {
    case 'available':   return '#2E7D5B';
    case 'on_trip':     return '#2F5D8A';
    case 'maintenance': return '#C9962B';
    default:            return '#5B6470';
  }
}

/**
 * Returns the full HTML string and status color for a Leaflet DivIcon truck marker.
 */
export function getTruckMarker({
  status,
  plate_number,
  isSelected,
  isGpsLive,
}: TruckMarkerProps): TruckMarkerResult {
  const statusColor = getStatusColor(status);

  const pulseHtml =
    status === 'on_trip' && isGpsLive
      ? `<div class="absolute -inset-1.5 rounded-full animate-ping opacity-30" style="background:${statusColor}"></div>`
      : '';

  const ringClass = isSelected
    ? 'scale-125 ring-2 ring-offset-2 ring-[#B08D3C]'
    : 'group-hover:scale-110';

  const iconHtml = `
    <div class="relative flex flex-col items-center cursor-pointer group" style="transform:translate(-50%,-50%);">
      ${pulseHtml}
      <div class="w-8 h-8 rounded-full flex items-center justify-center shadow-md transition-transform duration-200 ${ringClass}"
           style="background:${statusColor};border:2px solid #FFFFFF;">
        <span style="font-size:14px;">🚛</span>
      </div>
      <div class="mt-1 px-1.5 py-0.5 rounded shadow-sm text-[10px] font-mono font-bold whitespace-nowrap"
           style="background:#14171C;color:#FFFFFF;border:1px solid #E3E1DC;">
        ${plate_number}
      </div>
    </div>
  `;

  return { iconHtml, statusColor };
}
