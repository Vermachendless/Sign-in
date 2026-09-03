import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext.tsx';
import { Eye, EyeOff, Lock, Mail, Building2, AlertCircle, ShieldAlert, CheckCircle2, ArrowRight } from 'lucide-react';

export const Login: React.FC = () => {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setErrorMessage('Please enter both email and password.');
      setErrorCode('VALIDATION_ERROR');
      return;
    }

    setErrorMessage(null);
    setErrorCode(null);
    setIsSubmitting(true);

    const result = await login(email.trim(), password);

    setIsSubmitting(false);
    if (!result.success) {
      setErrorMessage(result.error || 'Invalid email or password.');
      setErrorCode(result.code || 'INVALID_CREDENTIALS');
    }
  };

  const handleQuickFill = (demoEmail: string, demoPass: string) => {
    setEmail(demoEmail);
    setPassword(demoPass);
    setErrorMessage(null);
    setErrorCode(null);
  };

  return (
    <div className="min-h-screen bg-brand-bg flex flex-col justify-center py-12 sm:px-6 lg:px-8 selection:bg-brand-yellow selection:text-brand-black">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center px-4">
        {/* Brand Icon */}
        <div className="mx-auto w-14 h-14 rounded-2xl bg-brand-black flex items-center justify-center text-brand-yellow shadow-md border border-neutral-800 mb-4">
          <Building2 className="w-8 h-8 text-brand-yellow" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-brand-black">
          Office Access Management
        </h1>
        <p className="mt-1 text-sm text-brand-muted">
          Sign in to access your staff portal and record daily attendance
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md px-4 sm:px-0">
        <div className="bg-white py-8 px-6 sm:px-10 shadow-sm border border-brand-border rounded-2xl">
          {/* Error Alert */}
          {errorMessage && (
            <div
              id="login-error-alert"
              className={`mb-6 p-4 rounded-xl text-sm flex items-start gap-3 border ${
                errorCode === 'ACCOUNT_SUSPENDED'
                  ? 'bg-amber-50 border-amber-200 text-amber-900'
                  : 'bg-red-50 border-red-200 text-red-900'
              }`}
            >
              {errorCode === 'ACCOUNT_SUSPENDED' ? (
                <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              )}
              <div>
                <p className="font-semibold">
                  {errorCode === 'ACCOUNT_SUSPENDED' ? 'Account Suspended' : 'Authentication Failed'}
                </p>
                <p className="mt-0.5 text-xs sm:text-sm">{errorMessage}</p>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Email Input */}
            <div>
              <label htmlFor="login-email" className="block text-xs font-semibold text-brand-black uppercase tracking-wider mb-1.5">
                Work Email Address
              </label>
              <div className="relative rounded-lg shadow-2xs">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-brand-muted">
                  <Mail className="w-4 h-4" />
                </div>
                <input
                  id="login-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@company.com"
                  className="block w-full pl-10 pr-3 py-2.5 bg-brand-bg border border-brand-border rounded-lg text-sm text-brand-black placeholder:text-brand-muted/70 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-yellow focus:border-brand-yellow transition"
                />
              </div>
            </div>

            {/* Password Input */}
            <div>
              <label htmlFor="login-password" className="block text-xs font-semibold text-brand-black uppercase tracking-wider mb-1.5">
                Password
              </label>
              <div className="relative rounded-lg shadow-2xs">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-brand-muted">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="block w-full pl-10 pr-10 py-2.5 bg-brand-bg border border-brand-border rounded-lg text-sm text-brand-black placeholder:text-brand-muted/70 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-yellow focus:border-brand-yellow transition"
                />
                <button
                  type="button"
                  id="toggle-password-visibility"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-brand-muted hover:text-brand-black cursor-pointer"
                  title={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Submit Button (Primary Yellow) */}
            <button
              id="login-submit-btn"
              type="submit"
              disabled={isSubmitting}
              className="w-full mt-2 flex justify-center items-center gap-2 py-2.5 px-4 border border-transparent rounded-lg shadow-xs text-sm font-bold text-brand-black bg-brand-yellow hover:bg-brand-yellow-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-yellow disabled:opacity-50 disabled:cursor-not-allowed transition cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <div className="w-4 h-4 border-2 border-brand-black/30 border-t-brand-black rounded-full animate-spin" />
                  <span>Verifying credentials...</span>
                </>
              ) : (
                <>
                  <span>Sign In</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          {/* Quick Demo Test Accounts */}
          <div className="mt-8 pt-6 border-t border-brand-border">
            <p className="text-xs font-semibold text-brand-muted uppercase tracking-wider mb-3 text-center">
              Quick Test Accounts
            </p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <button
                type="button"
                id="demo-superadmin-btn"
                onClick={() => handleQuickFill('admin@example.com', 'AdminSecurePassword123!')}
                className="p-2.5 text-left rounded-xl bg-purple-50/70 hover:bg-purple-100/90 border border-purple-200 text-purple-900 transition cursor-pointer"
              >
                <div className="font-semibold text-purple-950 flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-purple-600 inline-block" />
                  Super Admin
                </div>
                <div className="text-[11px] text-purple-700 truncate">admin@example.com</div>
              </button>

              <button
                type="button"
                id="demo-admin-btn"
                onClick={() => handleQuickFill('manager@example.com', 'ManagerSecure123!')}
                className="p-2.5 text-left rounded-xl bg-amber-50/70 hover:bg-amber-100/90 border border-brand-yellow/50 text-amber-950 transition cursor-pointer"
              >
                <div className="font-semibold text-brand-black flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-brand-yellow inline-block" />
                  Admin
                </div>
                <div className="text-[11px] text-amber-800 truncate">manager@example.com</div>
              </button>

              <button
                type="button"
                id="demo-staff-btn"
                onClick={() => handleQuickFill('john.doe@example.com', 'StaffSecure123!')}
                className="p-2.5 text-left rounded-xl bg-emerald-50/70 hover:bg-emerald-100/90 border border-emerald-200 text-emerald-900 transition cursor-pointer"
              >
                <div className="font-semibold text-emerald-950 flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-600 inline-block" />
                  Staff (Active)
                </div>
                <div className="text-[11px] text-emerald-700 truncate">john.doe@example.com</div>
              </button>

              <button
                type="button"
                id="demo-suspended-btn"
                onClick={() => handleQuickFill('suspended.user@example.com', 'SuspendedPass123!')}
                className="p-2.5 text-left rounded-xl bg-rose-50/70 hover:bg-rose-100/90 border border-rose-200 text-rose-900 transition cursor-pointer"
              >
                <div className="font-semibold text-rose-950 flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-rose-600 inline-block" />
                  Staff (Suspended)
                </div>
                <div className="text-[11px] text-rose-700 truncate">suspended.user@example.com</div>
              </button>
            </div>
          </div>
        </div>

        <div className="mt-4 text-center text-xs text-brand-muted">
          <span>Protected by server-side rate limiting &amp; scrypt encryption</span>
        </div>
      </div>
    </div>
  );
};
