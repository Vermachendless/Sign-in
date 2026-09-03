import React from 'react';
import { useAuth } from '../context/AuthContext.tsx';
import { UserRole } from '../types/index.ts';
import { ShieldCheck, LogOut, User as UserIcon, Building2, ShieldAlert, Shield } from 'lucide-react';

export const Navbar: React.FC = () => {
  const { user, logout } = useAuth();

  if (!user) return null;

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
    <header className="bg-brand-black border-b border-neutral-800 sticky top-0 z-40 shadow-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16 items-center">
          {/* Brand Logo & Name */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-brand-yellow flex items-center justify-center text-brand-black shadow-sm font-bold">
              <Building2 className="w-5 h-5 text-brand-black" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-base font-bold text-white tracking-tight">OfficeAccess</span>
                <span className="text-[10px] px-1.5 py-0.5 bg-brand-yellow/15 text-brand-yellow border border-brand-yellow/30 rounded font-bold uppercase tracking-wider">
                  Enterprise
                </span>
              </div>
              <p className="text-xs text-neutral-400 hidden sm:block">Attendance &amp; Access Management</p>
            </div>
          </div>

          {/* User Details & Sign Out */}
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="text-right hidden sm:block">
              <div className="flex items-center justify-end gap-2">
                <span className="text-sm font-semibold text-white">
                  {user.firstName} {user.lastName}
                </span>
                {getRoleBadge(user.role)}
              </div>
              <p className="text-xs text-neutral-400">{user.email} &bull; {user.department || 'General'}</p>
            </div>

            <div className="sm:hidden flex items-center">
              {getRoleBadge(user.role)}
            </div>

            <button
              id="logout-btn"
              onClick={() => logout()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-neutral-300 hover:text-white bg-neutral-900 hover:bg-neutral-800 border border-neutral-700 hover:border-brand-yellow/50 transition-colors cursor-pointer"
              title="Sign Out"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};
