import React, { useState, useEffect, useCallback } from 'react';
import {
  ShieldCheck,
  QrCode,
  Search,
  CheckCircle,
  XCircle,
  AlertCircle,
  Clock,
  UserCheck,
  UserMinus,
  RefreshCw,
  Users,
  Calendar,
  Building,
  ArrowRight,
  Filter,
  Camera,
  X,
  MapPin,
  Ticket,
} from 'lucide-react';
import {
  AccessVisitRecord,
  ReceptionSummaryMetrics,
  ReceptionVerificationResponse,
  PassType,
  AccessVisitStatus,
} from '../../types/index.ts';

export const ReceptionDashboard: React.FC = () => {
  // Verification State
  const [accessCodeInput, setAccessCodeInput] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationResult, setVerificationResult] = useState<ReceptionVerificationResponse | null>(null);
  const [verificationError, setVerificationError] = useState<string | null>(null);

  // Check-In / Check-Out Action State
  const [actionLoading, setActionLoading] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Tabs & Views: 'active' (Currently On Premises) vs 'history'
  const [activeTab, setActiveTab] = useState<'active' | 'history'>('active');

  // Summary Metrics State
  const [summary, setSummary] = useState<ReceptionSummaryMetrics>({
    currentlyCheckedIn: 0,
    todayVisitors: 0,
    todayEventGuests: 0,
    checkedOutToday: 0,
    accessDeniedToday: 0,
  });

  // Active Occupancy List State
  const [activeVisits, setActiveVisits] = useState<AccessVisitRecord[]>([]);
  const [activeSearch, setActiveSearch] = useState('');
  const [isLoadingActive, setIsLoadingActive] = useState(false);

  // History List State
  const [historyVisits, setHistoryVisits] = useState<AccessVisitRecord[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historySearch, setHistorySearch] = useState('');
  const [historyStatusFilter, setHistoryStatusFilter] = useState<string>('');
  const [historyPassTypeFilter, setHistoryPassTypeFilter] = useState<string>('');
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  // Camera/QR scanning mock/modal state
  const [showQrModal, setShowQrModal] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  // Fetch summary metrics
  const fetchSummary = useCallback(async () => {
    try {
      const res = await fetch('/api/reception/summary');
      if (res.ok) {
        const data = await res.json();
        if (data.data) {
          setSummary(data.data);
        }
      }
    } catch (err) {
      console.error('Failed to load reception summary:', err);
    }
  }, []);

  // Fetch active occupancy list
  const fetchActiveVisits = useCallback(async () => {
    setIsLoadingActive(true);
    try {
      const query = activeSearch.trim() ? `?search=${encodeURIComponent(activeSearch.trim())}` : '';
      const res = await fetch(`/api/reception/active${query}`);
      if (res.ok) {
        const data = await res.json();
        if (data.data?.activeVisits) {
          setActiveVisits(data.data.activeVisits);
        }
      }
    } catch (err) {
      console.error('Failed to load active guests:', err);
    } finally {
      setIsLoadingActive(false);
    }
  }, [activeSearch]);

  // Fetch history list
  const fetchHistory = useCallback(async () => {
    setIsLoadingHistory(true);
    try {
      const params = new URLSearchParams();
      if (historySearch.trim()) params.append('search', historySearch.trim());
      if (historyStatusFilter) params.append('status', historyStatusFilter);
      if (historyPassTypeFilter) params.append('passType', historyPassTypeFilter);

      const res = await fetch(`/api/reception/history?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        if (data.data) {
          setHistoryVisits(data.data.visits || []);
          setHistoryTotal(data.data.total || 0);
        }
      }
    } catch (err) {
      console.error('Failed to load access history:', err);
    } finally {
      setIsLoadingHistory(false);
    }
  }, [historySearch, historyStatusFilter, historyPassTypeFilter]);

  // Initial load
  useEffect(() => {
    fetchSummary();
    fetchActiveVisits();
  }, [fetchSummary, fetchActiveVisits]);

  // Fetch history when history tab is activated
  useEffect(() => {
    if (activeTab === 'history') {
      fetchHistory();
    }
  }, [activeTab, fetchHistory]);

  // Auto-dismiss action feedback
  useEffect(() => {
    if (actionFeedback) {
      const timer = setTimeout(() => setActionFeedback(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [actionFeedback]);

  // Handle Verify Credential
  const handleVerify = async (codeToVerify?: string) => {
    const rawCode = (codeToVerify || accessCodeInput).trim().toUpperCase();
    if (!rawCode) {
      setVerificationError('Please enter an access code or scan a QR code.');
      return;
    }

    setIsVerifying(true);
    setVerificationError(null);
    setVerificationResult(null);
    setActionFeedback(null);

    try {
      const res = await fetch('/api/reception/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessCode: rawCode }),
      });

      const data = await res.json();

      if (res.ok && data.data?.valid) {
        setVerificationResult(data.data);
      } else {
        const errMessage = data.error?.message || data.data?.message || 'Access verification denied.';
        setVerificationError(errMessage);
        if (data.data) {
          setVerificationResult(data.data);
        }
        fetchSummary();
      }
    } catch (err: any) {
      setVerificationError(err.message || 'Network error verifying access credential.');
    } finally {
      setIsVerifying(false);
    }
  };

  // Handle Check-In Confirmation
  const handleConfirmCheckIn = async () => {
    if (!verificationResult?.passId) return;

    setActionLoading(true);
    setActionFeedback(null);

    try {
      const res = await fetch('/api/reception/check-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessPassId: verificationResult.passId }),
      });

      const data = await res.json();

      if (res.ok && data.data) {
        setActionFeedback({
          type: 'success',
          message: `Checked in successfully: ${verificationResult.guestName || 'Guest'} has entered the premises.`,
        });

        // Re-verify to update verification card state
        handleVerify(verificationResult.displayCode);
        fetchSummary();
        fetchActiveVisits();
      } else {
        setActionFeedback({
          type: 'error',
          message: data.error?.message || 'Failed to complete check-in.',
        });
      }
    } catch (err: any) {
      setActionFeedback({
        type: 'error',
        message: err.message || 'Network error processing check-in.',
      });
    } finally {
      setActionLoading(false);
    }
  };

  // Handle Check-Out
  const handleCheckOut = async (visitId?: string, passId?: string) => {
    const targetVisitId = visitId || verificationResult?.activeVisitId;
    const targetPassId = passId || verificationResult?.passId;

    if (!targetVisitId && !targetPassId) return;

    setActionLoading(true);
    setActionFeedback(null);

    try {
      const res = await fetch('/api/reception/check-out', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accessVisitId: targetVisitId || undefined,
          accessPassId: !targetVisitId ? targetPassId : undefined,
        }),
      });

      const data = await res.json();

      if (res.ok && data.data) {
        setActionFeedback({
          type: 'success',
          message: 'Guest checked out successfully.',
        });

        if (verificationResult?.displayCode) {
          handleVerify(verificationResult.displayCode);
        }
        fetchSummary();
        fetchActiveVisits();
        if (activeTab === 'history') fetchHistory();
      } else {
        setActionFeedback({
          type: 'error',
          message: data.error?.message || 'Failed to complete check-out.',
        });
      }
    } catch (err: any) {
      setActionFeedback({
        type: 'error',
        message: err.message || 'Network error processing check-out.',
      });
    } finally {
      setActionLoading(false);
    }
  };

  // Reset verification form
  const handleClearVerification = () => {
    setAccessCodeInput('');
    setVerificationResult(null);
    setVerificationError(null);
  };

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      {/* Page Title & Status Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-brand-border">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-brand-black flex items-center gap-2.5">
            <span className="p-2 rounded-xl bg-brand-yellow/20 text-brand-black border border-brand-yellow/40">
              <ShieldCheck className="w-6 h-6 text-brand-black" />
            </span>
            Reception Access Verification &amp; Check-In
          </h1>
          <p className="text-sm text-brand-muted mt-1">
            Authoritative physical reception desk: verify access passes, scan visitor QR codes, and record arrivals.
          </p>
        </div>

        <button
          onClick={() => {
            fetchSummary();
            if (activeTab === 'active') fetchActiveVisits();
            if (activeTab === 'history') fetchHistory();
          }}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-brand-border bg-white text-xs font-semibold text-brand-black hover:bg-slate-50 transition-colors shadow-sm self-start sm:self-auto"
        >
          <RefreshCw className="w-3.5 h-3.5 text-brand-muted" />
          Refresh Desk
        </button>
      </div>

      {/* Action Notification Feedback */}
      {actionFeedback && (
        <div
          className={`p-4 rounded-xl flex items-center gap-3 text-sm font-medium border shadow-sm animate-in fade-in slide-in-from-top-2 ${
            actionFeedback.type === 'success'
              ? 'bg-emerald-50 text-emerald-900 border-emerald-200'
              : 'bg-rose-50 text-rose-900 border-rose-200'
          }`}
        >
          {actionFeedback.type === 'success' ? (
            <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0" />
          ) : (
            <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
          )}
          <span className="flex-1">{actionFeedback.message}</span>
          <button
            onClick={() => setActionFeedback(null)}
            className="text-slate-400 hover:text-slate-600 p-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Metrics Banner */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
        <div className="bg-white p-4 rounded-2xl border border-brand-border shadow-sm">
          <div className="flex items-center justify-between text-xs font-semibold text-brand-muted uppercase tracking-wider mb-2">
            <span>On Premises</span>
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
          </div>
          <div className="text-2xl font-black text-brand-black tracking-tight">
            {summary.currentlyCheckedIn}
          </div>
          <p className="text-[11px] text-emerald-600 font-medium mt-1">Currently checked in</p>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-brand-border shadow-sm">
          <div className="flex items-center justify-between text-xs font-semibold text-brand-muted uppercase tracking-wider mb-2">
            <span>Today Visitors</span>
            <Users className="w-4 h-4 text-brand-muted" />
          </div>
          <div className="text-2xl font-black text-brand-black tracking-tight">
            {summary.todayVisitors}
          </div>
          <p className="text-[11px] text-brand-muted font-medium mt-1">Staff guest arrivals</p>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-brand-border shadow-sm">
          <div className="flex items-center justify-between text-xs font-semibold text-brand-muted uppercase tracking-wider mb-2">
            <span>Event Guests</span>
            <Ticket className="w-4 h-4 text-brand-muted" />
          </div>
          <div className="text-2xl font-black text-brand-black tracking-tight">
            {summary.todayEventGuests}
          </div>
          <p className="text-[11px] text-brand-muted font-medium mt-1">Approved event invitees</p>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-brand-border shadow-sm">
          <div className="flex items-center justify-between text-xs font-semibold text-brand-muted uppercase tracking-wider mb-2">
            <span>Departures</span>
            <UserMinus className="w-4 h-4 text-brand-muted" />
          </div>
          <div className="text-2xl font-black text-brand-black tracking-tight">
            {summary.checkedOutToday}
          </div>
          <p className="text-[11px] text-brand-muted font-medium mt-1">Checked out today</p>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-brand-border shadow-sm col-span-2 sm:col-span-1">
          <div className="flex items-center justify-between text-xs font-semibold text-brand-muted uppercase tracking-wider mb-2">
            <span>Denied Access</span>
            <XCircle className="w-4 h-4 text-rose-500" />
          </div>
          <div className="text-2xl font-black text-rose-600 tracking-tight">
            {summary.accessDeniedToday}
          </div>
          <p className="text-[11px] text-rose-500 font-medium mt-1">Rejected attempts today</p>
        </div>
      </div>

      {/* Reception Verification Section */}
      <div className="bg-white rounded-2xl border border-brand-border shadow-sm overflow-hidden">
        <div className="p-6 border-b border-brand-border bg-slate-50/60">
          <div className="max-w-xl mx-auto text-center">
            <h2 className="text-lg font-bold text-brand-black tracking-tight">
              Reception Credential Verification
            </h2>
            <p className="text-xs text-brand-muted mt-1">
              Enter the visitor's human-readable access code (VIS-XXXX-XXXX or EVT-XXXX-XXXX) or scan their secure QR pass.
            </p>

            {/* Input Form */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleVerify();
              }}
              className="mt-5 flex flex-col sm:flex-row items-center gap-3"
            >
              <div className="relative w-full flex-1">
                <input
                  type="text"
                  value={accessCodeInput}
                  onChange={(e) => {
                    setAccessCodeInput(e.target.value.toUpperCase());
                    setVerificationError(null);
                  }}
                  placeholder="e.g. VIS-ABCD-EFGH or EVT-WXYZ-1234"
                  className="w-full px-4 py-3 pl-10 rounded-xl border border-brand-border focus:outline-none focus:ring-2 focus:ring-brand-yellow/50 focus:border-brand-black text-sm font-mono tracking-wider font-semibold placeholder:font-sans placeholder:font-normal placeholder:tracking-normal bg-white"
                />
                <ShieldCheck className="w-4 h-4 text-brand-muted absolute left-3.5 top-1/2 -translate-y-1/2" />
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                <button
                  type="submit"
                  disabled={isVerifying || !accessCodeInput.trim()}
                  className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-brand-black text-white text-xs font-bold hover:bg-slate-800 disabled:opacity-50 transition-colors shadow-sm"
                >
                  {isVerifying ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin text-brand-yellow" />
                      Verifying...
                    </>
                  ) : (
                    <>
                      <CheckCircle className="w-4 h-4 text-brand-yellow" />
                      VERIFY ACCESS
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setShowQrModal(true)}
                  title="Scan QR Code via Camera"
                  className="p-3 rounded-xl border border-brand-border bg-white text-brand-black hover:bg-slate-50 transition-colors shadow-sm"
                >
                  <Camera className="w-4 h-4 text-brand-black" />
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* Verification Result Display */}
        {verificationResult && (
          <div className="p-6">
            <div
              className={`rounded-2xl border p-6 transition-all ${
                verificationResult.valid
                  ? 'bg-emerald-50/50 border-emerald-200'
                  : 'bg-rose-50/50 border-rose-200'
              }`}
            >
              {/* Header Status */}
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4 border-b border-slate-200">
                <div className="flex items-center gap-3">
                  <span
                    className={`p-2.5 rounded-xl border ${
                      verificationResult.valid
                        ? 'bg-emerald-100 text-emerald-700 border-emerald-300'
                        : 'bg-rose-100 text-rose-700 border-rose-300'
                    }`}
                  >
                    {verificationResult.valid ? (
                      <CheckCircle className="w-6 h-6 text-emerald-600" />
                    ) : (
                      <XCircle className="w-6 h-6 text-rose-600" />
                    )}
                  </span>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-brand-black text-white">
                        {verificationResult.passType || 'CREDENTIAL'}
                      </span>
                      <span className="font-mono text-sm font-bold text-brand-black">
                        {verificationResult.displayCode}
                      </span>
                    </div>
                    <h3 className="text-base font-bold text-brand-black mt-0.5">
                      {verificationResult.valid
                        ? 'Credential Authorized & Valid'
                        : verificationResult.denialReason || 'Access Denied'}
                    </h3>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {verificationResult.valid && (
                    <span
                      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${
                        verificationResult.isCheckedIn
                          ? 'bg-amber-100 text-amber-800 border-amber-300'
                          : verificationResult.isCheckedOut
                          ? 'bg-slate-100 text-slate-700 border-slate-300'
                          : 'bg-emerald-100 text-emerald-800 border-emerald-300'
                      }`}
                    >
                      <span
                        className={`w-2 h-2 rounded-full ${
                          verificationResult.isCheckedIn
                            ? 'bg-amber-500'
                            : verificationResult.isCheckedOut
                            ? 'bg-slate-400'
                            : 'bg-emerald-500'
                        }`}
                      />
                      {verificationResult.isCheckedIn
                        ? 'Currently Checked In'
                        : verificationResult.isCheckedOut
                        ? 'Already Checked Out'
                        : 'Awaiting Physical Arrival'}
                    </span>
                  )}
                  <button
                    onClick={handleClearVerification}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                    title="Dismiss"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Guest & Visit Details */}
              {verificationResult.valid && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 my-5 text-xs">
                  <div className="bg-white p-3.5 rounded-xl border border-slate-200">
                    <span className="text-slate-400 font-medium uppercase tracking-wider block text-[10px]">
                      Guest Name
                    </span>
                    <span className="text-sm font-bold text-brand-black mt-0.5 block">
                      {verificationResult.guestName || 'Valued Guest'}
                    </span>
                    {verificationResult.organization && (
                      <span className="text-slate-500 block mt-0.5">
                        {verificationResult.organization}
                      </span>
                    )}
                  </div>

                  <div className="bg-white p-3.5 rounded-xl border border-slate-200">
                    <span className="text-slate-400 font-medium uppercase tracking-wider block text-[10px]">
                      {verificationResult.passType === PassType.EVENT ? 'Event Details' : 'Host Staff Member'}
                    </span>
                    <span className="text-sm font-bold text-brand-black mt-0.5 block">
                      {verificationResult.passType === PassType.EVENT
                        ? verificationResult.eventTitle || 'Corporate Event'
                        : verificationResult.hostStaffName || 'Office Host'}
                    </span>
                    {verificationResult.eventLocation ? (
                      <span className="text-slate-500 flex items-center gap-1 mt-0.5">
                        <MapPin className="w-3 h-3 text-slate-400" />
                        {verificationResult.eventLocation}
                      </span>
                    ) : verificationResult.hostStaffDepartment ? (
                      <span className="text-slate-500 flex items-center gap-1 mt-0.5">
                        <Building className="w-3 h-3 text-slate-400" />
                        {verificationResult.hostStaffDepartment}
                      </span>
                    ) : null}
                  </div>

                  <div className="bg-white p-3.5 rounded-xl border border-slate-200 sm:col-span-2 lg:col-span-1">
                    <span className="text-slate-400 font-medium uppercase tracking-wider block text-[10px]">
                      Visit Validity Window
                    </span>
                    <span className="text-sm font-bold text-brand-black mt-0.5 block flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5 text-brand-muted" />
                      {verificationResult.visitDate || 'Today'}
                    </span>
                    {verificationResult.formattedValidRange && (
                      <span className="text-slate-500 flex items-center gap-1 mt-0.5 font-medium">
                        <Clock className="w-3 h-3 text-slate-400" />
                        {verificationResult.formattedValidRange}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Physical Check-In / Check-Out Actions */}
              {verificationResult.valid && (
                <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-slate-200">
                  <div className="text-xs text-slate-600">
                    {verificationResult.canCheckIn && (
                      <span className="text-emerald-700 font-semibold flex items-center gap-1">
                        <CheckCircle className="w-3.5 h-3.5" />
                        Verified: Press Confirm Check-In to record physical arrival at reception.
                      </span>
                    )}
                    {verificationResult.isCheckedIn && (
                      <span className="text-amber-800 font-medium">
                        Checked in at: {verificationResult.checkedInAt ? new Date(verificationResult.checkedInAt).toLocaleTimeString() : 'Earlier'}
                      </span>
                    )}
                    {verificationResult.isCheckedOut && (
                      <span className="text-slate-500">
                        Departure already recorded. No further physical check-ins permitted on this pass.
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {verificationResult.canCheckIn && (
                      <button
                        onClick={handleConfirmCheckIn}
                        disabled={actionLoading}
                        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 disabled:opacity-50 transition-colors shadow-sm"
                      >
                        {actionLoading ? (
                          <RefreshCw className="w-4 h-4 animate-spin" />
                        ) : (
                          <UserCheck className="w-4 h-4" />
                        )}
                        CONFIRM CHECK-IN
                      </button>
                    )}

                    {verificationResult.canCheckOut && (
                      <button
                        onClick={() => handleCheckOut()}
                        disabled={actionLoading}
                        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-brand-black text-white text-xs font-bold hover:bg-slate-800 disabled:opacity-50 transition-colors shadow-sm"
                      >
                        {actionLoading ? (
                          <RefreshCw className="w-4 h-4 animate-spin" />
                        ) : (
                          <UserMinus className="w-4 h-4" />
                        )}
                        RECORD CHECK-OUT
                      </button>
                    )}

                    <button
                      onClick={handleClearVerification}
                      className="px-4 py-2.5 rounded-xl border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                    >
                      Clear
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Error Banner when code is rejected */}
        {verificationError && !verificationResult && (
          <div className="p-6">
            <div className="rounded-2xl border border-rose-200 bg-rose-50/70 p-5 flex items-start gap-3.5">
              <XCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <h4 className="text-sm font-bold text-rose-900">Credential Verification Denied</h4>
                <p className="text-xs text-rose-700 mt-1">{verificationError}</p>
                <div className="mt-3 flex items-center gap-2">
                  <button
                    onClick={handleClearVerification}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-rose-200 text-rose-800 hover:bg-rose-50"
                  >
                    Try Another Code
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Tabs: Currently On Premises vs History */}
      <div className="bg-white rounded-2xl border border-brand-border shadow-sm overflow-hidden">
        {/* Tab Headers */}
        <div className="flex border-b border-brand-border px-6 pt-2 bg-slate-50/50">
          <button
            onClick={() => setActiveTab('active')}
            className={`flex items-center gap-2 px-4 py-3.5 text-xs font-bold border-b-2 transition-colors ${
              activeTab === 'active'
                ? 'border-brand-black text-brand-black bg-white -mb-px rounded-t-xl'
                : 'border-transparent text-brand-muted hover:text-brand-black'
            }`}
          >
            <Users className="w-4 h-4 text-emerald-600" />
            Currently On Premises
            <span className="ml-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
              {summary.currentlyCheckedIn}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('history')}
            className={`flex items-center gap-2 px-4 py-3.5 text-xs font-bold border-b-2 transition-colors ${
              activeTab === 'history'
                ? 'border-brand-black text-brand-black bg-white -mb-px rounded-t-xl'
                : 'border-transparent text-brand-muted hover:text-brand-black'
            }`}
          >
            <Clock className="w-4 h-4 text-brand-muted" />
            Access History Log
            <span className="ml-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700">
              {historyTotal}
            </span>
          </button>
        </div>

        {/* Tab 1: Currently On Premises */}
        {activeTab === 'active' && (
          <div className="p-6 space-y-4">
            {/* Search Filter */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="relative w-full sm:w-72">
                <input
                  type="text"
                  value={activeSearch}
                  onChange={(e) => setActiveSearch(e.target.value)}
                  placeholder="Search checked-in guests..."
                  className="w-full px-3.5 py-2 pl-9 rounded-xl border border-brand-border text-xs focus:outline-none focus:ring-2 focus:ring-brand-yellow/50"
                />
                <Search className="w-4 h-4 text-brand-muted absolute left-3 top-1/2 -translate-y-1/2" />
              </div>

              <span className="text-xs text-brand-muted font-medium">
                Showing {activeVisits.length} currently verified guest{activeVisits.length === 1 ? '' : 's'} inside
              </span>
            </div>

            {/* Active Table */}
            <div className="overflow-x-auto rounded-xl border border-brand-border">
              <table className="w-full text-left text-xs text-brand-black">
                <thead className="bg-slate-50 text-[11px] font-semibold text-brand-muted uppercase tracking-wider border-b border-brand-border">
                  <tr>
                    <th className="py-3 px-4">Guest Name</th>
                    <th className="py-3 px-4">Type</th>
                    <th className="py-3 px-4">Host / Event</th>
                    <th className="py-3 px-4">Check-In Time</th>
                    <th className="py-3 px-4">Checked In By</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {isLoadingActive ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-brand-muted">
                        <RefreshCw className="w-5 h-5 animate-spin mx-auto text-brand-yellow mb-2" />
                        Loading active guest occupancy...
                      </td>
                    </tr>
                  ) : activeVisits.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-12 text-center text-brand-muted">
                        <UserCheck className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                        <p className="font-semibold text-sm text-slate-600">No visitors currently on premises</p>
                        <p className="text-xs text-slate-400 mt-1">Verified check-ins will appear here in real time.</p>
                      </td>
                    </tr>
                  ) : (
                    activeVisits.map((v) => (
                      <tr key={v.id} className="hover:bg-slate-50/60 transition-colors">
                        <td className="py-3.5 px-4 font-semibold text-brand-black">
                          <div>{v.guestName || 'Guest'}</div>
                          {v.guestOrganization && (
                            <div className="text-[11px] font-normal text-slate-400">{v.guestOrganization}</div>
                          )}
                        </td>
                        <td className="py-3.5 px-4">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold ${
                              v.passType === PassType.EVENT
                                ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                                : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            }`}
                          >
                            {v.passType}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 font-medium text-slate-700">
                          <div>{v.hostOrEventTitle || '—'}</div>
                          {v.eventLocation && (
                            <div className="text-[11px] text-slate-400">{v.eventLocation}</div>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-slate-600 font-mono text-[11px]">
                          {v.formattedCheckedInAt || (v.checkedInAt ? new Date(v.checkedInAt).toLocaleTimeString() : '—')}
                        </td>
                        <td className="py-3.5 px-4 text-slate-500 font-medium">
                          {v.checkedInByName || 'Reception'}
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          <button
                            onClick={() => handleCheckOut(v.id, v.accessPassId)}
                            disabled={actionLoading}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-xs font-bold text-slate-800 transition-colors shadow-sm disabled:opacity-50"
                          >
                            <UserMinus className="w-3.5 h-3.5 text-slate-600" />
                            Check Out
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 2: Access History Log */}
        {activeTab === 'history' && (
          <div className="p-6 space-y-4">
            {/* Filters */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="relative">
                <input
                  type="text"
                  value={historySearch}
                  onChange={(e) => setHistorySearch(e.target.value)}
                  placeholder="Search guest or host..."
                  className="w-full px-3.5 py-2 pl-9 rounded-xl border border-brand-border text-xs focus:outline-none focus:ring-2 focus:ring-brand-yellow/50"
                />
                <Search className="w-4 h-4 text-brand-muted absolute left-3 top-1/2 -translate-y-1/2" />
              </div>

              <select
                value={historyStatusFilter}
                onChange={(e) => setHistoryStatusFilter(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-brand-border text-xs focus:outline-none focus:ring-2 focus:ring-brand-yellow/50 bg-white"
              >
                <option value="">All Statuses</option>
                <option value="CHECKED_IN">Checked In (Active)</option>
                <option value="CHECKED_OUT">Checked Out</option>
              </select>

              <select
                value={historyPassTypeFilter}
                onChange={(e) => setHistoryPassTypeFilter(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-brand-border text-xs focus:outline-none focus:ring-2 focus:ring-brand-yellow/50 bg-white"
              >
                <option value="">All Pass Types</option>
                <option value="VISITOR">Visitor Passes</option>
                <option value="EVENT">Event Passes</option>
              </select>
            </div>

            {/* History Table */}
            <div className="overflow-x-auto rounded-xl border border-brand-border">
              <table className="w-full text-left text-xs text-brand-black">
                <thead className="bg-slate-50 text-[11px] font-semibold text-brand-muted uppercase tracking-wider border-b border-brand-border">
                  <tr>
                    <th className="py-3 px-4">Guest</th>
                    <th className="py-3 px-4">Type &amp; Code</th>
                    <th className="py-3 px-4">Host / Event</th>
                    <th className="py-3 px-4">Check-In</th>
                    <th className="py-3 px-4">Check-Out</th>
                    <th className="py-3 px-4">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {isLoadingHistory ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-brand-muted">
                        <RefreshCw className="w-5 h-5 animate-spin mx-auto text-brand-yellow mb-2" />
                        Loading access visit history...
                      </td>
                    </tr>
                  ) : historyVisits.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-12 text-center text-brand-muted">
                        <Clock className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                        <p className="font-semibold text-sm text-slate-600">No access visits recorded</p>
                        <p className="text-xs text-slate-400 mt-1">Physical check-in and check-out logs will be recorded here.</p>
                      </td>
                    </tr>
                  ) : (
                    historyVisits.map((v) => (
                      <tr key={v.id} className="hover:bg-slate-50/60 transition-colors">
                        <td className="py-3.5 px-4 font-semibold text-brand-black">
                          <div>{v.guestName || 'Guest'}</div>
                          {v.guestOrganization && (
                            <div className="text-[11px] font-normal text-slate-400">{v.guestOrganization}</div>
                          )}
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-xs font-bold text-slate-800">{v.displayCode}</span>
                            <span className="text-[10px] font-semibold text-slate-400">({v.passType})</span>
                          </div>
                        </td>
                        <td className="py-3.5 px-4 font-medium text-slate-700">
                          {v.hostOrEventTitle || '—'}
                        </td>
                        <td className="py-3.5 px-4 text-slate-600 font-mono text-[11px]">
                          {v.formattedCheckedInAt || (v.checkedInAt ? new Date(v.checkedInAt).toLocaleString() : '—')}
                          {v.checkedInByName && (
                            <span className="text-[10px] text-slate-400 block font-sans">by {v.checkedInByName}</span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-slate-600 font-mono text-[11px]">
                          {v.formattedCheckedOutAt || (v.checkedOutAt ? new Date(v.checkedOutAt).toLocaleString() : '—')}
                          {v.checkedOutByName && (
                            <span className="text-[10px] text-slate-400 block font-sans">by {v.checkedOutByName}</span>
                          )}
                        </td>
                        <td className="py-3.5 px-4">
                          <span
                            className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                              v.status === AccessVisitStatus.CHECKED_IN
                                ? 'bg-amber-100 text-amber-800 border border-amber-300'
                                : v.status === AccessVisitStatus.CHECKED_OUT
                                ? 'bg-slate-100 text-slate-700 border border-slate-300'
                                : 'bg-rose-100 text-rose-800 border border-rose-300'
                            }`}
                          >
                            {v.status === AccessVisitStatus.CHECKED_IN && <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />}
                            {v.status}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* QR Camera Modal / Fallback */}
      {showQrModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-brand-border max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-brand-border">
              <h3 className="font-bold text-brand-black flex items-center gap-2">
                <Camera className="w-5 h-5 text-brand-yellow" />
                Scan Access QR Credential
              </h3>
              <button
                onClick={() => {
                  setShowQrModal(false);
                  setCameraError(null);
                }}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="bg-slate-900 rounded-xl p-8 text-center text-white flex flex-col items-center justify-center min-h-[220px]">
              <QrCode className="w-16 h-16 text-brand-yellow mb-3 animate-pulse" />
              <p className="text-xs text-slate-300 max-w-xs font-medium">
                Hold the visitor's secure QR pass in front of your camera or barcode scanner.
              </p>
              <div className="mt-4 px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-[11px] text-slate-400">
                Camera Scanner Mode Active
              </div>
            </div>

            <div className="pt-2 text-center">
              <p className="text-xs text-brand-muted mb-3">
                If camera permissions are unavailable in this environment, enter the human-readable code manually.
              </p>
              <button
                onClick={() => setShowQrModal(false)}
                className="w-full py-2.5 rounded-xl bg-brand-black text-white text-xs font-bold hover:bg-slate-800 transition-colors"
              >
                Enter Access Code Manually
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
