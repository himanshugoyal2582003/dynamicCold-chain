'use client';

import dynamic from 'next/dynamic';

const IotDevice3D = dynamic(() => import('@/components/hero/IotDevice3D'), {
  ssr: false,
  loading: () => (
    <div
      className="w-full h-[360px] rounded border flex items-center justify-center text-xs"
      style={{ background: '#F7F6F3', borderColor: 'var(--color-hairline)', color: 'var(--color-slate)' }}
    >
      Loading interactive 3D hardware model…
    </div>
  ),
});

export default function IotDeviceShowcase() {
  return <IotDevice3D />;
}
