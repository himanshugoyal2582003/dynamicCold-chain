import { ReactNode } from 'react';

interface BadgeProps {
  status: string;
  children?: ReactNode;
}

const STATUS_MAP: Record<string, string> = {
  available: 'badge-available',
  on_trip: 'badge-on-trip',
  maintenance: 'badge-maintenance',
  issue: 'badge-issue',
  open: 'badge-open',
  investigating: 'badge-investigating',
  resolved: 'badge-resolved',
  ASSIGNED: 'badge-available',
  IN_PROGRESS: 'badge-on-trip',
  COMPLETED: 'badge-resolved',
  CANCELLED: 'badge-issue',
};

export function StatusBadge({ status }: BadgeProps) {
  const safeStatus = typeof status === 'string' && status.trim() ? status : 'available';
  const cls = STATUS_MAP[safeStatus] || 'badge-available';
  const label = safeStatus.replace(/_/g, ' ');
  return (
    <span
      className={`${cls} inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wide`}
    >
      {label}
    </span>
  );
}

interface MetricCardProps {
  label: string;
  value: number | string;
  icon: string;
  accent?: string;
}

export function MetricCard({ label, value, icon, accent }: MetricCardProps) {
  return (
    <div className="card flex items-start gap-4">
      <div
        className="w-10 h-10 rounded flex items-center justify-center text-lg flex-shrink-0"
        style={{ background: accent ? `${accent}18` : 'var(--color-ivory)', color: accent || 'var(--color-gold)' }}
      >
        {icon}
      </div>
      <div>
        <p className="text-2xl font-semibold tabular-nums" style={{ color: 'var(--color-ink)' }}>
          {value}
        </p>
        <p className="text-xs uppercase tracking-wider mt-0.5" style={{ color: 'var(--color-slate)' }}>
          {label}
        </p>
      </div>
    </div>
  );
}

export function Spinner() {
  return (
    <div className="flex items-center justify-center py-12">
      <div
        className="w-6 h-6 border-2 rounded-full animate-spin"
        style={{ borderColor: 'var(--color-hairline)', borderTopColor: 'var(--color-gold)' }}
      />
    </div>
  );
}

export function EmptyState({ message, icon = '📭' }: { message: string; icon?: string }) {
  return (
    <div className="text-center py-16">
      <div className="text-4xl mb-3">{icon}</div>
      <p className="text-sm" style={{ color: 'var(--color-slate)' }}>{message}</p>
    </div>
  );
}

export function ErrorAlert({ message }: { message: string }) {
  return (
    <div
      className="rounded p-3 text-sm"
      style={{ background: '#F9E0E1', color: 'var(--status-issue)', border: '1px solid #e8c5c6' }}
    >
      {message}
    </div>
  );
}

export function SuccessAlert({ message }: { message: string }) {
  return (
    <div
      className="rounded p-3 text-sm"
      style={{ background: '#DDEEE8', color: 'var(--status-available)', border: '1px solid #b8d9cc' }}
    >
      {message}
    </div>
  );
}

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export function Modal({ title, onClose, children }: ModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(20,23,28,0.45)' }}>
      <div className="card w-full max-w-md max-h-[90vh] overflow-y-auto" style={{ boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold" style={{ color: 'var(--color-ink)' }}>{title}</h2>
          <button onClick={onClose} className="text-xl leading-none" style={{ color: 'var(--color-slate)' }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function FormField({
  label, name, type = 'text', value, onChange, placeholder, required, helper,
}: {
  label: string; name: string; type?: string; value: string;
  onChange: (v: string) => void; placeholder?: string; required?: boolean; helper?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--color-slate)' }}>
        {label}{required && <span style={{ color: 'var(--status-issue)' }}> *</span>}
      </label>
      {type === 'select' ? null : (
        <input
          type={type}
          name={name}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          required={required}
          className="input-field"
        />
      )}
      {helper && <p className="text-xs" style={{ color: 'var(--color-slate)' }}>{helper}</p>}
    </div>
  );
}

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

export function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

export function isExpiringSoon(dateStr: string | null | undefined): boolean {
  if (!dateStr) return false;
  const diff = new Date(dateStr).getTime() - Date.now();
  return diff > 0 && diff < 7 * 24 * 60 * 60 * 1000;
}

export function isExpired(dateStr: string | null | undefined): boolean {
  if (!dateStr) return false;
  return new Date(dateStr).getTime() < Date.now();
}
