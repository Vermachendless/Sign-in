import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext.tsx';
import { UserRole } from '../types/index.ts';
import {
  Menu,
  Clock,
  LogOut,
  User as UserIcon,
  ShieldAlert,
  Shield,
  ChevronRight,
} from 'lucide-react';
import { AppRoute } from './Sidebar.tsx';

interface HeaderProps {
  currentRoute: AppRoute;
  onOpenMobileMenu: () => void;
}

export const Header: React.FC<HeaderProps> = ({ currentRoute, onOpenMobileMenu }) => {
  const { user, logout } = useAuth();
  const [currentTime, setCurrentTime] = useState<string>('');

  useEffect(() => {
    const updateTime = () => {
      try {
        const formatted = new Intl.DateTimeFormat('en-US', {
          timeZone: 'Africa/Lagos',
          weekday: 'short',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true,
        }).format(new Date());
        setCurrentTime(formatted);
      } catch {
        setCurrentTime(new Date().toLocaleTimeString());
      }
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  if (!user) return null;

  const getBreadcrumb = (): { section: string; title: string } => {
    switch (currentRoute) {
      case 'today':
        return { section: 'Overview', title: 'Today Overview' };
      case 'attendance':
      case 'my-attendance':
        return { section: 'Attendance', title: user.role === UserRole.STAFF ? 'My Attendance History' : 'Live Attendance' };
      case 'reports':
        return { section: 'Attendance', title: 'Reports & Exports' };
      case 'staff':
      case 'users-roles':
        return { section: 'People', title: 'Staff Directory & Roles' };
      case 'events':
        return { section: 'Access & Events', title: 'Event Management & Approvals' };
      case 'reception':
        return { section: 'Access & Reception', title: 'Reception Desk & Check-In' };
      case 'visitors':
        return { section: 'People', title: 'Visitor Management & Invitations' };
      case 'my-visitors':
        return { section: 'Access', title: 'My Visitor Access & Invitations' };
      case 'office-networks':
        return { section: 'Administration', title: 'Office Networks & Attendance Access' };
      case 'audit-logs':
        return { section: 'Administration', title: 'System Audit Logs' };
      case 'governance':
      case 'security':
        return { section: 'Administration', title: user.role === UserRole.SUPER_ADMIN ? 'Executive Governance & Settings' : 'Security & RBAC Diagnostics' };
      default:
        return { section: 'Dashboard', title: 'Overview' };
    }
  };

  const breadcrumb = getBreadcrumb();

  const getRoleBadge = (role: UserRole) => {
    switch (role) {
      case UserRole.SUPER_ADMIN:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-semibold bg-purple-950/80 text-purple-200 border border-purple-700/60">
            <ShieldAlert className="w-3 h-3 text-purple-400" />
            Super Admin
          </span>
        );
      case UserRole.ADMIN:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-semibold bg-neutral-900 text-brand-yellow border border-brand-yellow/40">
            <Shield className="w-3 h-3 text-brand-yellow" />
            Admin
          </span>
        );
      case UserRole.STAFF:
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-semibold bg-emerald-950/80 text-emerald-300 border border-emerald-700/60">
            <UserIcon className="w-3 h-3 text-emerald-400" />
            Staff
          </span>
        );
    }
  };

  return (
    <header className="bg-white border-b border-brand-border sticky top-0 z-30 shadow-xs h-16 shrink-0">
      <div className="h-full px-4 sm:px-6 flex items-center justify-between">
        {/* Left: Mobile Drawer Trigger + Breadcrumb */}
        <div className="flex items-center gap-3">
          <button
            id="mobile-sidebar-toggle-btn"
            onClick={onOpenMobileMenu}
            className="lg:hidden p-2 rounded-xl text-brand-black hover:bg-neutral-100 transition cursor-pointer"
            title="Open navigation menu"
            aria-label="Open navigation menu"
          >
            <Menu className="w-5 h-5 text-brand-black" />
          </button>

          <div className="flex items-center gap-2 text-xs">
            <span className="text-brand-muted font-medium hidden sm:inline">{breadcrumb.section}</span>
            <ChevronRight className="w-3.5 h-3.5 text-neutral-300 hidden sm:inline" />
            <span className="font-bold text-brand-black sm:text-sm tracking-tight">{breadcrumb.title}</span>
          </div>
        </div>

        {/* Right: Live Office Time & User Info */}
        <div className="flex items-center gap-3 sm:gap-5">
          {/* Office Time */}
          <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-brand-bg border border-brand-border text-xs text-brand-black">
            <Clock className="w-3.5 h-3.5 text-brand-yellow shrink-0" />
            <div className="flex items-center gap-1.5 font-mono">
              <span className="font-semibold">{currentTime || 'Africa/Lagos'}</span>
            </div>
          </div>

          {/* User Details */}
          <div className="hidden sm:flex flex-col text-right">
            <div className="flex items-center justify-end gap-2">
              <span className="text-xs font-bold text-brand-black">
                {user.firstName} {user.lastName}
              </span>
              {getRoleBadge(user.role)}
            </div>
            <span className="text-[11px] text-brand-muted">{user.email}</span>
          </div>

          <div className="sm:hidden flex items-center">
            {getRoleBadge(user.role)}
          </div>

          {/* Logout Button */}
          <button
            id="logout-btn"
            onClick={() => logout()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-neutral-700 hover:text-white bg-neutral-100 hover:bg-neutral-900 border border-neutral-300 hover:border-neutral-900 transition-colors cursor-pointer"
            title="Sign Out"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Logout</span>
          </button>
        </div>
      </div>
    </header>
  );
};
