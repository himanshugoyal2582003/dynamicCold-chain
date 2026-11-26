'use client';

import dynamic from 'next/dynamic';

const FleetMap = dynamic(() => import('@/components/tracking/FleetMap'), {
  ssr: false,
  loading: () => (
    <div
      className="w-full h-[520px] rounded border flex items-center justify-center text-xs"
      style={{ background: '#F7F6F3', borderColor: 'var(--color-hairline)', color: 'var(--color-slate)' }}
    >
      Loading 4,934-warehouse GIS network map…
    </div>
  ),
});

export default function WarehouseNetworkMap() {
  return <FleetMap trucks={[]} height="520px" showWarehousesByDefault={true} />;
}
