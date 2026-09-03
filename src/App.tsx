import React from 'react';
import { AuthProvider, useAuth } from './context/AuthContext.tsx';
import { Login } from './components/Login.tsx';
import { Navbar } from './components/Navbar.tsx';
import { StaffDashboard } from './components/StaffDashboard.tsx';
import { AdminDashboard } from './components/AdminDashboard.tsx';
import { SuperAdminDashboard } from './components/SuperAdminDashboard.tsx';
import { UserRole } from './types/index.ts';
import { Building2 } from 'lucide-react';

const MainContent: React.FC = () => {
  const { user, isAuthenticated, isLoading } = useAuth();

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
    <div className="min-h-screen bg-brand-bg flex flex-col text-brand-black selection:bg-brand-yellow selection:text-brand-black">
      <Navbar />
      <main className="flex-1">
        {user.role === UserRole.SUPER_ADMIN && <SuperAdminDashboard />}
        {user.role === UserRole.ADMIN && <AdminDashboard />}
        {user.role === UserRole.STAFF && <StaffDashboard />}
      </main>
      <footer className="py-6 border-t border-brand-border text-center text-xs text-brand-muted bg-white">
        <p className="font-medium">
          Office Access &amp; Employee Attendance Management System &bull; <span className="text-brand-black font-semibold">Enterprise Suite</span>
        </p>
      </footer>
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
