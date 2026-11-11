'use client';

import { useAuth } from '@/lib/auth';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ReactNode } from 'react';

interface NavItem {
  href: string;
  label: string;
  icon: string;
}

interface DashboardLayoutProps {
  children: ReactNode;
  navItems: NavItem[];
  title: string;
  roleLabel: string;
}

export default function DashboardLayout({ children, navItems, title, roleLabel }: DashboardLayoutProps) {
  const { user, logout } = useAuth();
  const pathname = usePathname();

  return (
    <div className="min-h-screen flex" style={{ background: 'var(--color-ivory)' }}>
      {/* Sidebar */}
      <aside
        className="hidden md:flex flex-col w-64 border-r"
        style={{
          background: 'var(--color-paper)',
          borderColor: 'var(--color-hairline)',
          minHeight: '100vh',
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
              className={`sidebar-link ${pathname === item.href || pathname.startsWith(item.href + '/') ? 'active' : ''}`}
            >
              <span className="text-base">{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>

        {/* User footer */}
        <div className="p-4 border-t" style={{ borderColor: 'var(--color-hairline)' }}>
          <p className="text-xs font-medium mb-1" style={{ color: 'var(--color-ink)' }}>{user?.name}</p>
          <p className="text-xs mb-3" style={{ color: 'var(--color-slate)' }}>{user?.email}</p>
          <button onClick={() => logout()} className="btn-ghost w-full text-xs">Sign out</button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-h-screen">
        {/* Mobile header */}
        <header
          className="md:hidden flex items-center justify-between p-4 border-b"
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
          className="px-6 py-5 border-b"
          style={{ background: 'var(--color-paper)', borderColor: 'var(--color-hairline)' }}
        >
          <h1 className="text-xl font-semibold" style={{ color: 'var(--color-ink)' }}>{title}</h1>
        </div>

        {/* Page body */}
        <main className="flex-1 p-6">{children}</main>

        {/* Mobile bottom nav */}
        <nav
          className="md:hidden flex border-t"
          style={{ background: 'var(--color-paper)', borderColor: 'var(--color-hairline)' }}
        >
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex-1 flex flex-col items-center py-3 text-xs gap-1"
              style={{ color: pathname === item.href ? 'var(--color-gold)' : 'var(--color-slate)' }}
            >
              <span className="text-lg">{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}
