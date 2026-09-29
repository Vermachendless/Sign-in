import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext.tsx';
import { Login } from './components/Login.tsx';
import { Sidebar, AppRoute } from './components/Sidebar.tsx';
import { Header } from './components/Header.tsx';
import { StaffDashboard } from './components/StaffDashboard.tsx';
import { AdminDashboard } from './components/AdminDashboard.tsx';
import { SuperAdminDashboard } from './components/SuperAdminDashboard.tsx';
import { EventsManagement } from './components/EventsManagement.tsx';
import { UserRole } from './types/index.ts';
import { Building2 } from 'lucide-react';

const MainContent: React.FC = () => {
  const { user, isAuthenticated, isLoading } = useAuth();
  const [currentRoute, setCurrentRoute] = useState<AppRoute>('today');
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('app_sidebar_collapsed') === 'true';
    } catch {
      return false;
    }
  });
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  // Toggle desktop collapsed state and persist to localStorage
  const handleToggleCollapse = () => {
    setIsCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('app_sidebar_collapsed', String(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  // Close mobile drawer on escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isMobileOpen) {
        setIsMobileOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isMobileOpen]);

  // Sanitize route based on role to strictly enforce RBAC in the UI
  useEffect(() => {
    if (!user) return;

    if (user.role === UserRole.STAFF) {
      if (currentRoute !== 'today' && currentRoute !== 'my-attendance') {
        setCurrentRoute('today');
      }
    } else if (user.role === UserRole.ADMIN) {
      if (
        currentRoute === 'office-networks' ||
        currentRoute === 'governance' ||
        currentRoute === 'my-attendance'
      ) {
        setCurrentRoute('today');
      }
    }
  }, [user, currentRoute]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-brand-bg flex flex-col items-center justify-center">
        <div className="w-14 h-14 rounded-2xl bg-brand-black flex items-center justify-center text-white shadow-lg mb-4 animate-pulse">
          <Building2 className="w-7 h-7 text-brand-yellow" />
        </div>
        <div className="w-6 h-6 border-2 border-brand-yellow border-t-transparent rounded-full animate-spin mb-2" />
        <p className="text-xs font-semibold text-brand-muted tracking-wide">Verifying session authenticity...</p>
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return <Login />;
  }

  return (
    <div className="min-h-screen bg-brand-bg flex text-brand-black selection:bg-brand-yellow selection:text-brand-black">
      {/* Global Collapsible / Responsive Sidebar */}
      <Sidebar
        currentRoute={currentRoute}
        onNavigate={setCurrentRoute}
        isCollapsed={isCollapsed}
        onToggleCollapse={handleToggleCollapse}
        isMobileOpen={isMobileOpen}
        onCloseMobile={() => setIsMobileOpen(false)}
      />

      {/* Main Content Area */}
      <div
        className={`flex-1 flex flex-col min-w-0 transition-all duration-300 ${
          isCollapsed ? 'lg:pl-20' : 'lg:pl-64'
        }`}
      >
        {/* Contextual Header */}
        <Header
          currentRoute={currentRoute}
          onOpenMobileMenu={() => setIsMobileOpen(true)}
        />

        {/* Dynamic Page Content */}
        <main className="flex-1 pb-10">
          {currentRoute === 'events' ? (
            <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
              <EventsManagement />
            </div>
          ) : (
            <>
              {user.role === UserRole.SUPER_ADMIN && (
                <SuperAdminDashboard
                  currentRoute={currentRoute}
                  onNavigate={setCurrentRoute}
                />
              )}
              {user.role === UserRole.ADMIN && (
                <AdminDashboard
                  currentRoute={currentRoute}
                  onNavigate={setCurrentRoute}
                />
              )}
              {user.role === UserRole.STAFF && (
                <StaffDashboard
                  currentRoute={currentRoute}
                  onNavigate={setCurrentRoute}
                />
              )}
            </>
          )}
        </main>

        {/* Global Footer */}
        <footer className="py-6 border-t border-brand-border text-center text-xs text-brand-muted bg-white shrink-0">
          <p className="font-medium">
            Office Access &amp; Employee Attendance Management System &bull; <span className="text-brand-black font-semibold">Enterprise Suite</span>
          </p>
        </footer>
      </div>
    </div>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <MainContent />
    </AuthProvider>
  );
}
