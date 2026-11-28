'use client';

import { useAuth } from '@/lib/auth';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ReactNode } from 'react';
import {
  AlertTriangle,
  Activity,
  Building2,
  ClipboardList,
  FlaskConical,
  GitFork,
  History,
  LayoutDashboard,
  MapPin,
  Route,
  Shield,
  Truck,
  User,
  Wrench,
} from 'lucide-react';

interface NavItem {
  href: string;
  label: string;
  icon: string;
}

function renderNavIcon(item: NavItem, className: string) {
  const [path, query] = item.href.split('?');
  if (query?.includes('tab=insurance') || path.endsWith('/insurance')) {
    return <Shield className={className} strokeWidth={1.8} />;
  }
  if (path.endsWith('/tracking')) return <MapPin className={className} strokeWidth={1.8} />;
  if (path.endsWith('/trips')) return <Route className={className} strokeWidth={1.8} />;
  if (path.endsWith('/owners')) return <Building2 className={className} strokeWidth={1.8} />;
  if (path.endsWith('/users') || path.endsWith('/drivers')) return <User className={className} strokeWidth={1.8} />;
  if (path.endsWith('/activity')) return <ClipboardList className={className} strokeWidth={1.8} />;
  if (path.endsWith('/history')) return <History className={className} strokeWidth={1.8} />;
  if (path.endsWith('/maintenance')) return <Wrench className={className} strokeWidth={1.8} />;
  if (path.endsWith('/digital-twin')) return <FlaskConical className={className} strokeWidth={1.8} />;
  if (path.endsWith('/fleet-optimization')) return <GitFork className={className} strokeWidth={1.8} />;
  if (path.endsWith('/telemetry-delivery')) return <Activity className={className} strokeWidth={1.8} />;
  if (path.endsWith('/issues')) return <AlertTriangle className={className} strokeWidth={1.8} />;
  if (path === '/admin') return <LayoutDashboard className={className} strokeWidth={1.8} />;
  return <Truck className={className} strokeWidth={1.8} />;
}

interface DashboardLayoutProps {
  children: ReactNode;
  navItems: NavItem[];
  title: string;
  roleLabel: string;
}

export default function DashboardLayout({ children, navItems: baseNavItems, title, roleLabel }: DashboardLayoutProps) {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const navItems = user && (user.role === 'admin' || user.role === 'owner')
    ? [...baseNavItems, { href: `/${user.role}/maintenance`, label: 'Maintenance', icon: '' },
      { href: `/${user.role}/digital-twin`, label: 'Digital Twin', icon: '' },
      { href: `/${user.role}/fleet-optimization`, label: 'Fleet Optimization', icon: '' },
      ...(user.role === 'admin' ? [
        { href: '/admin/telemetry-delivery', label: 'Telemetry Delivery', icon: '' },
      ] : [])]
    : baseNavItems;
  const isActive = (href: string) => {
    const [itemPath, itemQuery] = href.split('?');
    if (pathname === '/admin/telemetry-delivery') return itemPath === pathname;
    if (pathname === '/admin/fleet-optimization' || pathname === '/owner/fleet-optimization') return itemPath === pathname;
    if (pathname === '/admin/digital-twin' || pathname === '/owner/digital-twin') return itemPath === pathname;
    if (pathname === '/admin/maintenance' || pathname === '/owner/maintenance') return itemPath === pathname;
    const searchParams = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search);
    if (pathname === itemPath && itemQuery) {
      return new URLSearchParams(itemQuery).toString() === searchParams.toString();
    }
    if (pathname === itemPath) {
      return !(itemPath === '/owner' && searchParams.get('tab') === 'insurance');
    }
    return pathname.startsWith(itemPath + '/') &&
      !(itemPath === '/owner' && pathname.startsWith('/owner/drivers'));
  };

  return (
    <div className="min-h-screen flex" style={{ background: 'var(--color-ivory)' }}>
      {/* Sidebar */}
      <aside
        className="no-print fixed inset-y-0 left-0 z-40 hidden h-dvh w-64 flex-col overflow-y-auto border-r md:flex"
        style={{
          background: 'var(--color-paper)',
          borderColor: 'var(--color-hairline)',
        }}
      >
        {/* Logo */}
        <div className="p-6 border-b" style={{ borderColor: 'var(--color-hairline)' }}>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-3 h-3 rounded-sm" style={{ background: 'var(--color-gold)' }} />
            <span className="text-xs font-semibold tracking-widest uppercase" style={{ color: 'var(--color-ink)' }}>
              COLDCHAIN
            </span>
          </div>
          <p className="text-xs ml-5" style={{ color: 'var(--color-slate)' }}>{roleLabel}</p>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-3 space-y-1">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={item.href.includes('?') || (item.href === '/owner' && pathname === '/owner')
                ? (event) => {
                    event.preventDefault();
                    window.location.assign(item.href);
                  }
                : undefined}
              className={`sidebar-link ${isActive(item.href) ? 'active' : ''}`}
              aria-current={/\/(maintenance|digital-twin|fleet-optimization|telemetry-delivery)$/.test(item.href) && isActive(item.href) ? 'page' : undefined}
            >
              {renderNavIcon(item, 'w-4 h-4 shrink-0')}
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>

        {/* User footer */}
        <div className="mt-auto shrink-0 p-4 border-t" style={{ borderColor: 'var(--color-hairline)' }}>
          <p className="text-xs font-medium mb-1" style={{ color: 'var(--color-ink)' }}>{user?.name}</p>
          <p className="text-xs mb-3" style={{ color: 'var(--color-slate)' }}>{user?.email}</p>
          <button onClick={() => logout()} className="btn-ghost w-full text-xs">Sign out</button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex min-h-screen min-w-0 flex-1 flex-col pb-16 md:pb-0 md:pl-64">
        {/* Mobile header */}
        <header
          className="no-print md:hidden flex items-center justify-between p-4 border-b"
          style={{ background: 'var(--color-paper)', borderColor: 'var(--color-hairline)' }}
        >
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-sm" style={{ background: 'var(--color-gold)' }} />
            <span className="text-xs font-semibold tracking-widest uppercase">COLDCHAIN</span>
          </div>
          <button onClick={() => logout()} className="btn-ghost text-xs">Sign out</button>
        </header>

        {/* Page header */}
        <div
          className="px-4 py-4 border-b sm:px-6 sm:py-5"
          style={{ background: 'var(--color-paper)', borderColor: 'var(--color-hairline)' }}
        >
          <h1 className="text-xl font-semibold" style={{ color: 'var(--color-ink)' }}>{title}</h1>
        </div>

        {/* Page body */}
        <main className="min-w-0 flex-1 p-4 sm:p-6">{children}</main>

        {/* Mobile bottom nav */}
        <nav
          className="no-print fixed inset-x-0 bottom-0 z-40 flex overflow-x-auto border-t md:hidden"
          style={{ background: 'var(--color-paper)', borderColor: 'var(--color-hairline)' }}
        >
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={item.href.includes('?') || (item.href === '/owner' && pathname === '/owner')
                ? (event) => {
                    event.preventDefault();
                    window.location.assign(item.href);
                  }
                : undefined}
              className="flex min-w-[76px] flex-1 flex-col items-center py-2 text-[11px] leading-tight gap-1"
              style={{ color: isActive(item.href) ? 'var(--color-gold)' : 'var(--color-slate)' }}
              aria-current={/\/(maintenance|digital-twin|fleet-optimization|telemetry-delivery)$/.test(item.href) && isActive(item.href) ? 'page' : undefined}
            >
              {renderNavIcon(item, 'w-5 h-5 shrink-0')}
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}
