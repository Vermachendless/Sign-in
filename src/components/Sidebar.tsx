import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext.tsx';
import { UserRole } from '../types/index.ts';
import {
  Building2,
  LayoutDashboard,
  Clock,
  FileBarChart,
  Users,
  UserRoundCheck,
  CalendarDays,
  Ticket,
  BadgeCheck,
  Network,
  Shield,
  ClipboardList,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
  X,
  MoreVertical,
  User as UserIcon,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';

export type AppRoute =
  | 'today'
  | 'attendance'
  | 'my-attendance'
  | 'reports'
  | 'staff'
  | 'visitors'
  | 'my-visitors'
  | 'reception'
  | 'events'
  | 'office-networks'
  | 'users-roles'
  | 'audit-logs'
  | 'governance'
  | 'security';

interface NavItem {
  id: AppRoute | string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
  isUpcoming?: boolean;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

interface SidebarProps {
  currentRoute: AppRoute;
  onNavigate: (route: AppRoute) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  isMobileOpen: boolean;
  onCloseMobile: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentRoute,
  onNavigate,
  isCollapsed,
  onToggleCollapse,
  isMobileOpen,
  onCloseMobile,
}) => {
  const { user, logout } = useAuth();
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [hoveredItem, setHoveredItem] = useState<{ id: string; label: string; section: string; upcoming?: boolean } | null>(null);
  const [showProfileModal, setShowProfileModal] = useState(false);

  if (!user) return null;

  // Build role-based navigation structure
  const getNavSections = (): NavSection[] => {
    if (user.role === UserRole.STAFF) {
      return [
        {
          title: 'OVERVIEW',
          items: [
            {
              id: 'today',
              label: 'Today',
              icon: LayoutDashboard,
            },
          ],
        },
        {
          title: 'ATTENDANCE',
          items: [
            {
              id: 'my-attendance',
              label: 'My Attendance',
              icon: Clock,
            },
          ],
        },
        {
          title: 'ACCESS',
          items: [
            {
              id: 'my-visitors',
              label: 'My Visitor Access',
              icon: BadgeCheck,
            },
          ],
        },
      ];
    }

    if (user.role === UserRole.ADMIN) {
      return [
        {
          title: 'OVERVIEW',
          items: [
            {
              id: 'today',
              label: 'Today',
              icon: LayoutDashboard,
            },
          ],
        },
        {
          title: 'ATTENDANCE',
          items: [
            {
              id: 'attendance',
              label: 'Attendance',
              icon: Clock,
            },
            {
              id: 'reports',
              label: 'Reports',
              icon: FileBarChart,
            },
          ],
        },
        {
          title: 'PEOPLE',
          items: [
            {
              id: 'staff',
              label: 'Staff Management',
              icon: Users,
            },
            {
              id: 'visitors',
              label: 'Visitors',
              icon: UserRoundCheck,
            },
          ],
        },
        {
          title: 'ACCESS & EVENTS',
          items: [
            {
              id: 'reception',
              label: 'Reception Desk',
              icon: ShieldCheck,
            },
            {
              id: 'events',
              label: 'Events',
              icon: CalendarDays,
            },
            {
              id: 'event-access-upcoming',
              label: 'Event Access',
              icon: Ticket,
              badge: 'Phase 6B',
              isUpcoming: true,
            },
          ],
        },
        {
          title: 'ADMINISTRATION',
          items: [
            {
              id: 'audit-logs',
              label: 'Audit Logs',
              icon: ClipboardList,
            },
            {
              id: 'security',
              label: 'Security & RBAC',
              icon: Shield,
            },
          ],
        },
      ];
    }

    // SUPER_ADMIN
    return [
      {
        title: 'OVERVIEW',
        items: [
          {
            id: 'today',
            label: 'Today',
            icon: LayoutDashboard,
          },
        ],
      },
      {
        title: 'ATTENDANCE',
        items: [
          {
            id: 'attendance',
            label: 'Attendance',
            icon: Clock,
          },
          {
            id: 'reports',
            label: 'Reports',
            icon: FileBarChart,
          },
        ],
      },
      {
        title: 'PEOPLE',
        items: [
          {
            id: 'staff',
            label: 'Staff Management',
            icon: Users,
          },
          {
            id: 'visitors',
            label: 'Visitors',
            icon: UserRoundCheck,
          },
        ],
      },
      {
        title: 'ACCESS & EVENTS',
        items: [
          {
            id: 'reception',
            label: 'Reception Desk',
            icon: ShieldCheck,
          },
          {
            id: 'events',
            label: 'Events',
            icon: CalendarDays,
          },
          {
            id: 'event-access-upcoming',
            label: 'Event Access',
            icon: Ticket,
            badge: 'Phase 6B',
            isUpcoming: true,
          },
          {
            id: 'visitors',
            label: 'Visitor Access',
            icon: BadgeCheck,
          },
        ],
      },
      {
        title: 'ADMINISTRATION',
        items: [
          {
            id: 'office-networks',
            label: 'Office Networks',
            icon: Network,
          },
          {
            id: 'users-roles',
            label: 'Users & Roles',
            icon: Shield,
          },
          {
            id: 'audit-logs',
            label: 'Audit Logs',
            icon: ClipboardList,
          },
          {
            id: 'governance',
            label: 'Settings',
            icon: Settings,
          },
        ],
      },
    ];
  };

  const navSections = getNavSections();

  const handleItemClick = (item: NavItem) => {
    if (item.isUpcoming) return;
    onNavigate(item.id as AppRoute);
    onCloseMobile();
  };

  const getUserInitials = () => {
    const first = user.firstName ? user.firstName[0].toUpperCase() : '';
    const last = user.lastName ? user.lastName[0].toUpperCase() : '';
    return `${first}${last}` || 'OA';
  };

  const getRoleLabel = () => {
    switch (user.role) {
      case UserRole.SUPER_ADMIN:
        return 'Super Admin';
      case UserRole.ADMIN:
        return 'Administrator';
      case UserRole.STAFF:
      default:
        return 'Staff Member';
    }
  };

  return (
    <>
      {/* Mobile Backdrop */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-xs z-40 lg:hidden transition-opacity"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}

      {/* Main Sidebar Element */}
      <aside
        id="app-global-sidebar"
        className={`fixed top-0 bottom-0 left-0 z-50 flex flex-col bg-brand-black text-white border-r border-neutral-800 transition-all duration-300 ease-in-out select-none
          ${isMobileOpen ? 'translate-x-0 w-72' : '-translate-x-full lg:translate-x-0'}
          ${isCollapsed ? 'lg:w-20' : 'lg:w-64'}
        `}
      >
        {/* Brand Header */}
        <div className="h-16 flex items-center justify-between px-4 border-b border-neutral-800 shrink-0">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="w-10 h-10 rounded-xl bg-brand-yellow flex items-center justify-center text-brand-black font-bold shrink-0 shadow-xs">
              <Building2 className="w-5 h-5 text-brand-black" />
            </div>

            {(!isCollapsed || isMobileOpen) && (
              <div className="min-w-0 transition-opacity duration-200">
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-white tracking-tight text-sm truncate">OfficeAccess</span>
                  <span className="text-[9px] px-1 py-0.2 bg-brand-yellow/15 text-brand-yellow border border-brand-yellow/30 rounded font-bold uppercase tracking-wider">
                    PRO
                  </span>
                </div>
                <p className="text-[11px] text-neutral-400 truncate">Attendance &amp; Access</p>
              </div>
            )}
          </div>

          {/* Desktop Collapse / Mobile Close Button */}
          <div className="flex items-center">
            {/* Mobile close button */}
            <button
              onClick={onCloseMobile}
              className="lg:hidden p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition cursor-pointer"
              title="Close menu"
            >
              <X className="w-5 h-5" />
            </button>

            {/* Desktop collapse toggle */}
            <button
              onClick={onToggleCollapse}
              className="hidden lg:flex p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-900 border border-neutral-800 transition cursor-pointer"
              title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              id="sidebar-collapse-toggle-btn"
            >
              {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Navigation Sections */}
        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-6 scrollbar-thin scrollbar-thumb-neutral-800">
          {navSections.map((section) => (
            <div key={section.title} className="space-y-1">
              {/* Section Header */}
              {(!isCollapsed || isMobileOpen) ? (
                <div className="px-3 text-[10px] font-bold text-neutral-400 tracking-wider uppercase mb-1.5">
                  {section.title}
                </div>
              ) : (
                <div className="h-2 w-full flex items-center justify-center my-1">
                  <div className="w-4 h-0.5 bg-neutral-800 rounded-full" />
                </div>
              )}

              {/* Section Items */}
              {section.items.map((item) => {
                const Icon = item.icon;
                const isActive = currentRoute === item.id;
                const isUpcoming = item.isUpcoming;

                return (
                  <div
                    key={item.id}
                    className="relative"
                    onMouseEnter={() =>
                      isCollapsed &&
                      setHoveredItem({
                        id: item.id,
                        label: item.label,
                        section: section.title,
                        upcoming: item.isUpcoming,
                      })
                    }
                    onMouseLeave={() => setHoveredItem(null)}
                  >
                    <button
                      id={`sidebar-nav-${item.id}`}
                      onClick={() => handleItemClick(item)}
                      disabled={isUpcoming}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs transition-all relative ${
                        isActive
                          ? 'bg-brand-yellow text-brand-black font-bold shadow-xs'
                          : isUpcoming
                          ? 'text-neutral-500 hover:text-neutral-400 cursor-not-allowed opacity-60'
                          : 'text-neutral-300 hover:text-white hover:bg-neutral-900 font-medium cursor-pointer'
                      } ${isCollapsed && !isMobileOpen ? 'justify-center px-0' : ''}`}
                    >
                      <Icon
                        className={`w-4 h-4 shrink-0 ${
                          isActive
                            ? 'text-brand-black'
                            : isUpcoming
                            ? 'text-neutral-500'
                            : 'text-neutral-400'
                        }`}
                      />

                      {(!isCollapsed || isMobileOpen) && (
                        <div className="flex-1 flex items-center justify-between min-w-0">
                          <span className="truncate">{item.label}</span>
                          {item.badge && (
                            <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400 border border-neutral-700 uppercase tracking-wide">
                              {item.badge}
                            </span>
                          )}
                        </div>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* Collapsed Tooltip (Desktop Only) */}
        {isCollapsed && !isMobileOpen && hoveredItem && (
          <div className="fixed left-22 z-60 px-3 py-1.5 bg-neutral-900 text-white rounded-lg border border-neutral-700 shadow-xl text-xs whitespace-nowrap pointer-events-none animate-in fade-in zoom-in-95 duration-100">
            <div className="font-semibold text-brand-yellow">{hoveredItem.label}</div>
            <div className="text-[10px] text-neutral-400">{hoveredItem.section}</div>
            {hoveredItem.upcoming && (
              <span className="mt-1 inline-block text-[9px] bg-amber-950 text-amber-300 border border-amber-800 px-1 rounded">
                Upcoming
              </span>
            )}
          </div>
        )}

        {/* User Account Section at Bottom */}
        <div className="p-3 border-t border-neutral-800 bg-neutral-950/60 relative">
          <div className="flex items-center justify-between gap-2 p-2 rounded-xl hover:bg-neutral-900 transition">
            <div
              className="flex items-center gap-3 min-w-0 flex-1 cursor-pointer"
              onClick={() => setShowProfileModal(true)}
              title="View Profile"
            >
              <div className="w-9 h-9 rounded-xl bg-neutral-900 border border-neutral-700 flex items-center justify-center font-bold text-xs text-brand-yellow shrink-0">
                {getUserInitials()}
              </div>

              {(!isCollapsed || isMobileOpen) && (
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-white text-xs truncate">
                    {user.firstName} {user.lastName}
                  </div>
                  <div className="text-[11px] text-neutral-400 truncate flex items-center gap-1">
                    <span>{getRoleLabel()}</span>
                  </div>
                </div>
              )}
            </div>

            {(!isCollapsed || isMobileOpen) && (
              <div className="relative">
                <button
                  id="sidebar-account-menu-trigger"
                  onClick={() => setAccountMenuOpen(!accountMenuOpen)}
                  className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition cursor-pointer"
                  title="Account Options"
                >
                  <MoreVertical className="w-4 h-4" />
                </button>

                {accountMenuOpen && (
                  <div
                    className="absolute bottom-full right-0 mb-2 w-48 bg-neutral-900 border border-neutral-800 rounded-xl shadow-xl py-1 z-60 text-xs"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="px-3 py-2 border-b border-neutral-800">
                      <p className="text-white font-semibold truncate">{user.firstName} {user.lastName}</p>
                      <p className="text-neutral-400 text-[11px] truncate">{user.email}</p>
                    </div>

                    <button
                      onClick={() => {
                        setShowProfileModal(true);
                        setAccountMenuOpen(false);
                      }}
                      className="w-full text-left px-3 py-2 text-neutral-300 hover:text-white hover:bg-neutral-800 flex items-center gap-2 cursor-pointer"
                    >
                      <UserIcon className="w-3.5 h-3.5 text-neutral-400" />
                      <span>User Profile</span>
                    </button>

                    {(user.role === UserRole.SUPER_ADMIN || user.role === UserRole.ADMIN) && (
                      <button
                        onClick={() => {
                          onNavigate(user.role === UserRole.SUPER_ADMIN ? 'governance' : 'security');
                          setAccountMenuOpen(false);
                          onCloseMobile();
                        }}
                        className="w-full text-left px-3 py-2 text-neutral-300 hover:text-white hover:bg-neutral-800 flex items-center gap-2 cursor-pointer"
                      >
                        <Settings className="w-3.5 h-3.5 text-neutral-400" />
                        <span>System Settings</span>
                      </button>
                    )}

                    <div className="border-t border-neutral-800 my-1" />

                    <button
                      id="sidebar-account-logout-btn"
                      onClick={() => logout()}
                      className="w-full text-left px-3 py-2 text-rose-400 hover:text-rose-300 hover:bg-neutral-800 flex items-center gap-2 cursor-pointer"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>Log Out</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Quick collapsed logout button */}
          {isCollapsed && !isMobileOpen && (
            <button
              onClick={() => logout()}
              className="mt-2 w-full py-1.5 flex justify-center items-center text-neutral-400 hover:text-rose-400 hover:bg-neutral-900 rounded-lg transition cursor-pointer"
              title="Sign Out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          )}
        </div>
      </aside>

      {/* User Profile Modal */}
      {showProfileModal && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-xs z-70 flex items-center justify-center p-4"
          onClick={() => setShowProfileModal(false)}
        >
          <div
            className="bg-white rounded-2xl border border-brand-border p-6 max-w-md w-full shadow-2xl text-brand-black"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-4 border-b border-brand-border mb-4">
              <div className="flex items-center gap-2">
                <div className="w-10 h-10 rounded-xl bg-neutral-900 text-brand-yellow flex items-center justify-center font-bold">
                  {getUserInitials()}
                </div>
                <div>
                  <h3 className="font-bold text-base text-brand-black">{user.firstName} {user.lastName}</h3>
                  <p className="text-xs text-brand-muted">{getRoleLabel()}</p>
                </div>
              </div>
              <button
                onClick={() => setShowProfileModal(false)}
                className="p-1.5 rounded-lg text-brand-muted hover:text-brand-black hover:bg-neutral-100 transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 rounded-xl bg-brand-bg border border-brand-border">
                <span className="text-brand-muted block text-[11px] mb-0.5">Email Address</span>
                <span className="font-semibold text-brand-black">{user.email}</span>
              </div>

              <div className="p-3 rounded-xl bg-brand-bg border border-brand-border">
                <span className="text-brand-muted block text-[11px] mb-0.5">Department</span>
                <span className="font-semibold text-brand-black">{user.department || 'General Administration'}</span>
              </div>

              <div className="p-3 rounded-xl bg-brand-bg border border-brand-border">
                <span className="text-brand-muted block text-[11px] mb-0.5">Security Role &amp; Privileges</span>
                <div className="flex items-center justify-between mt-1">
                  <span className="font-bold text-brand-black">{user.role}</span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-neutral-900 text-brand-yellow">
                    {user.status}
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={() => setShowProfileModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-neutral-100 hover:bg-neutral-200 text-brand-black transition cursor-pointer"
              >
                Close
              </button>
              <button
                onClick={() => logout()}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-neutral-900 hover:bg-neutral-800 text-brand-yellow transition cursor-pointer"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
