import React, { useState, useEffect, useCallback, useRef } from 'react';
import jsQR from 'jsqr';
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
  Camera,
  X,
  MapPin,
  Ticket,
  ChevronLeft,
  ChevronRight,
  ShieldAlert,
  ArrowRight,
} from 'lucide-react';
import {
  AccessVisitRecord,
  ReceptionSummaryMetrics,
  ReceptionVerificationResponse,
  PassType,
  AccessVisitStatus,
} from '../../types/index.ts';

type OperationalSection = 'active' | 'today-events' | 'today-visitors' | 'checked-out-today' | 'denied-today' | 'history';

export const ReceptionDashboard: React.FC = () => {
  // Verification State
  const [accessCodeInput, setAccessCodeInput] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationResult, setVerificationResult] = useState<ReceptionVerificationResponse | null>(null);
  const [verificationError, setVerificationError] = useState<string | null>(null);

  // Check-In / Check-Out Action State
  const [actionLoading, setActionLoading] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Operational Section View State
  const [currentSection, setCurrentSection] = useState<OperationalSection>('active');

  // Summary Metrics State
  const [summary, setSummary] = useState<ReceptionSummaryMetrics>({
    currentlyCheckedIn: 0,
    todayVisitors: 0,
    todayEventGuests: 0,
    checkedOutToday: 0,
    accessDeniedToday: 0,
  });

  // Active Occupancy List State (access_visits.status = 'CHECKED_IN')
  const [activeVisits, setActiveVisits] = useState<AccessVisitRecord[]>([]);
  const [activeSearch, setActiveSearch] = useState('');
  const [isLoadingActive, setIsLoadingActive] = useState(false);

  // Today's Event Guests List State
  const [todayEventVisits, setTodayEventVisits] = useState<AccessVisitRecord[]>([]);
  const [todayEventSearch, setTodayEventSearch] = useState('');
  const [isLoadingTodayEvents, setIsLoadingTodayEvents] = useState(false);

  // Today's Visitors List State
  const [todayStaffVisits, setTodayStaffVisits] = useState<AccessVisitRecord[]>([]);
  const [todayStaffSearch, setTodayStaffSearch] = useState('');
  const [isLoadingTodayStaff, setIsLoadingTodayStaff] = useState(false);

  // Checked Out Today List State
  const [checkedOutVisits, setCheckedOutVisits] = useState<AccessVisitRecord[]>([]);
  const [checkedOutSearch, setCheckedOutSearch] = useState('');
  const [isLoadingCheckedOut, setIsLoadingCheckedOut] = useState(false);

  // Denied Access Today List State
  const [deniedVisits, setDeniedVisits] = useState<AccessVisitRecord[]>([]);
  const [deniedSearch, setDeniedSearch] = useState('');
  const [isLoadingDenied, setIsLoadingDenied] = useState(false);

  // History List State
  const [historyVisits, setHistoryVisits] = useState<AccessVisitRecord[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historySearch, setHistorySearch] = useState('');
  const [historyStatusFilter, setHistoryStatusFilter] = useState<string>('');
  const [historyPassTypeFilter, setHistoryPassTypeFilter] = useState<string>('');
  const [historyStartDate, setHistoryStartDate] = useState<string>('');
  const [historyEndDate, setHistoryEndDate] = useState<string>('');
  const [historyPage, setHistoryPage] = useState<number>(1);
  const historyLimit = 15;
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  // Camera/QR scanning progressive enhancement state
  const [showQrModal, setShowQrModal] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manualModalInput, setManualModalInput] = useState('');
  const [isCameraActive, setIsCameraActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Get today's local date string YYYY-MM-DD
  const getTodayStr = () => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

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

  // Fetch active occupancy list (authoritative from access_visits WHERE status = 'CHECKED_IN')
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

  // Fetch Today's Event Guests
  const fetchTodayEvents = useCallback(async () => {
    setIsLoadingTodayEvents(true);
    try {
      const today = getTodayStr();
      const params = new URLSearchParams();
      params.append('passType', 'EVENT');
      params.append('date', today);
      params.append('limit', '50');
      if (todayEventSearch.trim()) params.append('search', todayEventSearch.trim());

      const res = await fetch(`/api/reception/history?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        if (data.data?.visits) {
          setTodayEventVisits(data.data.visits);
        }
      }
    } catch (err) {
      console.error('Failed to load today event guests:', err);
    } finally {
      setIsLoadingTodayEvents(false);
    }
  }, [todayEventSearch]);

  // Fetch Today's Staff Visitors
  const fetchTodayStaff = useCallback(async () => {
    setIsLoadingTodayStaff(true);
    try {
      const today = getTodayStr();
      const params = new URLSearchParams();
      params.append('passType', 'VISITOR');
      params.append('date', today);
      params.append('limit', '50');
      if (todayStaffSearch.trim()) params.append('search', todayStaffSearch.trim());

      const res = await fetch(`/api/reception/history?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        if (data.data?.visits) {
          setTodayStaffVisits(data.data.visits);
        }
      }
    } catch (err) {
      console.error('Failed to load today staff visitors:', err);
    } finally {
      setIsLoadingTodayStaff(false);
    }
  }, [todayStaffSearch]);

  // Fetch Checked Out Today
  const fetchCheckedOutToday = useCallback(async () => {
    setIsLoadingCheckedOut(true);
    try {
      const today = getTodayStr();
      const params = new URLSearchParams();
      params.append('status', 'CHECKED_OUT');
      params.append('date', today);
      params.append('limit', '50');
      if (checkedOutSearch.trim()) params.append('search', checkedOutSearch.trim());

      const res = await fetch(`/api/reception/history?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        if (data.data?.visits) {
          setCheckedOutVisits(data.data.visits);
        }
      }
    } catch (err) {
      console.error('Failed to load checked out guests:', err);
    } finally {
      setIsLoadingCheckedOut(false);
    }
  }, [checkedOutSearch]);

  // Fetch Denied Access Today
  const fetchDeniedToday = useCallback(async () => {
    setIsLoadingDenied(true);
    try {
      const today = getTodayStr();
      const params = new URLSearchParams();
      params.append('status', 'DENIED');
      params.append('date', today);
      params.append('limit', '50');
      if (deniedSearch.trim()) params.append('search', deniedSearch.trim());

      const res = await fetch(`/api/reception/history?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        if (data.data?.visits) {
          setDeniedVisits(data.data.visits);
        }
      }
    } catch (err) {
      console.error('Failed to load denied access logs:', err);
    } finally {
      setIsLoadingDenied(false);
    }
  }, [deniedSearch]);

  // Fetch General History List with pagination & filters
  const fetchHistory = useCallback(async (pageToFetch = historyPage) => {
    setIsLoadingHistory(true);
    try {
      const params = new URLSearchParams();
      params.append('page', String(pageToFetch));
      params.append('limit', String(historyLimit));
      if (historySearch.trim()) params.append('search', historySearch.trim());
      if (historyStatusFilter) params.append('status', historyStatusFilter);
      if (historyPassTypeFilter) params.append('passType', historyPassTypeFilter);
      if (historyStartDate) params.append('startDate', historyStartDate);
      if (historyEndDate) params.append('endDate', historyEndDate);

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
  }, [historyPage, historySearch, historyStatusFilter, historyPassTypeFilter, historyStartDate, historyEndDate]);

  // Refresh current view data
  const refreshActiveSection = useCallback(() => {
    fetchSummary();
    if (currentSection === 'active') fetchActiveVisits();
    else if (currentSection === 'today-events') fetchTodayEvents();
    else if (currentSection === 'today-visitors') fetchTodayStaff();
    else if (currentSection === 'checked-out-today') fetchCheckedOutToday();
    else if (currentSection === 'denied-today') fetchDeniedToday();
    else if (currentSection === 'history') fetchHistory(historyPage);
  }, [
    currentSection,
    fetchSummary,
    fetchActiveVisits,
    fetchTodayEvents,
    fetchTodayStaff,
    fetchCheckedOutToday,
    fetchDeniedToday,
    fetchHistory,
    historyPage,
  ]);

  // Initial load
  useEffect(() => {
    fetchSummary();
    fetchActiveVisits();
  }, [fetchSummary, fetchActiveVisits]);

  // Switch section side effects
  useEffect(() => {
    if (currentSection === 'active') fetchActiveVisits();
    else if (currentSection === 'today-events') fetchTodayEvents();
    else if (currentSection === 'today-visitors') fetchTodayStaff();
    else if (currentSection === 'checked-out-today') fetchCheckedOutToday();
    else if (currentSection === 'denied-today') fetchDeniedToday();
    else if (currentSection === 'history') fetchHistory(historyPage);
  }, [
    currentSection,
    fetchActiveVisits,
    fetchTodayEvents,
    fetchTodayStaff,
    fetchCheckedOutToday,
    fetchDeniedToday,
    fetchHistory,
    historyPage,
  ]);

  // Auto-dismiss action feedback
  useEffect(() => {
    if (actionFeedback) {
      const timer = setTimeout(() => setActionFeedback(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [actionFeedback]);

  // Handle Verify Credential (supports code or QR token)
  const handleVerify = async (codeToVerify?: string, tokenToVerify?: string) => {
    const rawCode = (codeToVerify || accessCodeInput).trim().toUpperCase();
    const rawToken = tokenToVerify?.trim();

    if (!rawCode && !rawToken) {
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
        body: JSON.stringify({
          accessCode: rawCode || undefined,
          token: rawToken || undefined,
        }),
      });

      const data = await res.json();

      if (res.ok && data.data?.valid) {
        setVerificationResult(data.data);
      } else {
        const errMessage =
          data.error?.message ||
          data.data?.denialReason ||
          data.data?.message ||
          data.message ||
          'Access verification denied: Invalid credential.';
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

  // Handle Explicit Check-In Confirmation
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
        if (currentSection === 'today-events') fetchTodayEvents();
        if (currentSection === 'today-visitors') fetchTodayStaff();
      } else {
        setActionFeedback({
          type: 'error',
          message: data.error?.message || data.message || 'Failed to complete check-in.',
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

  // Handle Explicit Check-Out
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
        if (currentSection === 'today-events') fetchTodayEvents();
        if (currentSection === 'today-visitors') fetchTodayStaff();
        if (currentSection === 'checked-out-today') fetchCheckedOutToday();
        if (currentSection === 'history') fetchHistory(historyPage);
      } else {
        setActionFeedback({
          type: 'error',
          message: data.error?.message || data.message || 'Failed to complete check-out.',
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

  // Progressive enhancement camera scanner lifecycle
  useEffect(() => {
    let active = true;
    let scanInterval: any = null;

    async function startCamera() {
      if (!showQrModal) return;
      setCameraError(null);
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error('Camera access is not supported by your current browser.');
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
        if (!active) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
        setIsCameraActive(true);

        // Frame scanner using BarcodeDetector if available, with jsQR fallback
        const hasBarcodeDetector = 'BarcodeDetector' in window;
        let barcodeDetector: any = null;
        if (hasBarcodeDetector) {
          try {
            barcodeDetector = new (window as any).BarcodeDetector({ formats: ['qr_code'] });
          } catch {}
        }

        scanInterval = setInterval(async () => {
          if (!videoRef.current || videoRef.current.readyState < 2) return;

          // 1. Try native BarcodeDetector if available
          if (barcodeDetector) {
            try {
              const barcodes = await barcodeDetector.detect(videoRef.current);
              if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
                handleScannedPayload(barcodes[0].rawValue.trim());
                return;
              }
            } catch {}
          }

          // 2. Offscreen Canvas + jsQR Fallback (pure client-side memory, never stored or uploaded)
          try {
            const video = videoRef.current;
            if (!video) return;
            let canvas = canvasRef.current;
            if (!canvas) {
              canvas = document.createElement('canvas');
              canvasRef.current = canvas;
            }
            if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
              canvas.width = video.videoWidth;
              canvas.height = video.videoHeight;
            }
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (ctx && canvas.width > 0 && canvas.height > 0) {
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
              const qrResult = jsQR(imageData.data, imageData.width, imageData.height, {
                inversionAttempts: 'dontInvert',
              });
              if (qrResult && qrResult.data) {
                handleScannedPayload(qrResult.data.trim());
              }
            }
          } catch {}
        }, 250);
      } catch (err: any) {
        setIsCameraActive(false);
        setCameraError(err.message || 'Camera permission denied or camera unavailable.');
      }
    }

    if (showQrModal) {
      startCamera();
    } else {
      stopCamera();
    }

    return () => {
      active = false;
      if (scanInterval) clearInterval(scanInterval);
      stopCamera();
    };
  }, [showQrModal]);

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setIsCameraActive(false);
  };

  const handleScannedPayload = (payload: string) => {
    stopCamera();
    setShowQrModal(false);
    let tokenToUse: string | undefined;
    let codeToUse: string | undefined;

    try {
      if (payload.includes('?') && (payload.includes('t=') || payload.includes('c='))) {
        const queryPart = payload.split('?')[1];
        const searchParams = new URLSearchParams(queryPart);
        tokenToUse = searchParams.get('t') || undefined;
        codeToUse = searchParams.get('c') || undefined;
      }
    } catch {}

    if (!tokenToUse && !codeToUse) {
      if (payload.startsWith('VIS-') || payload.startsWith('EVT-') || payload.startsWith('REC-')) {
        codeToUse = payload;
      } else if (payload.length >= 32) {
        tokenToUse = payload;
      } else {
        codeToUse = payload;
      }
    }

    handleVerify(codeToUse, tokenToUse);
  };

  const totalHistoryPages = Math.max(1, Math.ceil(historyTotal / historyLimit));

  return (
    <div className="space-y-8 max-w-6xl mx-auto pb-12">
      {/* Page Title & Status Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-brand-border">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-brand-black flex items-center gap-2.5">
            <span className="p-2 rounded-xl bg-brand-yellow text-brand-black border border-brand-yellow/60 shadow-sm">
              <ShieldCheck className="w-6 h-6 text-brand-black" />
            </span>
            Reception Desk &amp; Access Operations
          </h1>
          <p className="text-sm text-brand-muted mt-1">
            Authoritative physical reception desk: verify guest credentials, scan secure QR passes, and record arrivals.
          </p>
        </div>

        <button
          onClick={refreshActiveSection}
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

      {/* Operational Metric Cards (Clickable to switch sections directly) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
        {/* 1. Currently Checked In / Active Occupancy */}
        <button
          type="button"
          onClick={() => setCurrentSection('active')}
          className={`p-4 rounded-2xl border text-left transition-all ${
            currentSection === 'active'
              ? 'bg-emerald-50/70 border-emerald-400 ring-2 ring-emerald-500/20 shadow-md'
              : 'bg-white border-brand-border hover:border-slate-300 shadow-sm'
          }`}
        >
          <div className="flex items-center justify-between text-xs font-semibold text-brand-muted uppercase tracking-wider mb-2">
            <span>On Premises</span>
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
          </div>
          <div className="text-2xl font-black text-brand-black tracking-tight">
            {summary.currentlyCheckedIn}
          </div>
          <p className="text-[11px] text-emerald-700 font-semibold mt-1">Currently checked in</p>
        </button>

        {/* 2. Today's Event Guests */}
        <button
          type="button"
          onClick={() => setCurrentSection('today-events')}
          className={`p-4 rounded-2xl border text-left transition-all ${
            currentSection === 'today-events'
              ? 'bg-indigo-50/70 border-indigo-400 ring-2 ring-indigo-500/20 shadow-md'
              : 'bg-white border-brand-border hover:border-slate-300 shadow-sm'
          }`}
        >
          <div className="flex items-center justify-between text-xs font-semibold text-brand-muted uppercase tracking-wider mb-2">
            <span>Event Guests</span>
            <Ticket className="w-4 h-4 text-indigo-500" />
          </div>
          <div className="text-2xl font-black text-brand-black tracking-tight">
            {summary.todayEventGuests}
          </div>
          <p className="text-[11px] text-indigo-700 font-semibold mt-1">Today's event invitees</p>
        </button>

        {/* 3. Today's Visitors */}
        <button
          type="button"
          onClick={() => setCurrentSection('today-visitors')}
          className={`p-4 rounded-2xl border text-left transition-all ${
            currentSection === 'today-visitors'
              ? 'bg-amber-50/70 border-amber-400 ring-2 ring-amber-500/20 shadow-md'
              : 'bg-white border-brand-border hover:border-slate-300 shadow-sm'
          }`}
        >
          <div className="flex items-center justify-between text-xs font-semibold text-brand-muted uppercase tracking-wider mb-2">
            <span>Today Visitors</span>
            <Users className="w-4 h-4 text-amber-600" />
          </div>
          <div className="text-2xl font-black text-brand-black tracking-tight">
            {summary.todayVisitors}
          </div>
          <p className="text-[11px] text-amber-700 font-semibold mt-1">Staff visitor arrivals</p>
        </button>

        {/* 4. Checked Out Today */}
        <button
          type="button"
          onClick={() => setCurrentSection('checked-out-today')}
          className={`p-4 rounded-2xl border text-left transition-all ${
            currentSection === 'checked-out-today'
              ? 'bg-slate-100 border-slate-400 ring-2 ring-slate-500/20 shadow-md'
              : 'bg-white border-brand-border hover:border-slate-300 shadow-sm'
          }`}
        >
          <div className="flex items-center justify-between text-xs font-semibold text-brand-muted uppercase tracking-wider mb-2">
            <span>Departures</span>
            <UserMinus className="w-4 h-4 text-slate-500" />
          </div>
          <div className="text-2xl font-black text-brand-black tracking-tight">
            {summary.checkedOutToday}
          </div>
          <p className="text-[11px] text-slate-600 font-semibold mt-1">Checked out today</p>
        </button>

        {/* 5. Denied Access Today */}
        <button
          type="button"
          onClick={() => setCurrentSection('denied-today')}
          className={`p-4 rounded-2xl border text-left transition-all col-span-2 sm:col-span-1 ${
            currentSection === 'denied-today'
              ? 'bg-rose-50/70 border-rose-400 ring-2 ring-rose-500/20 shadow-md'
              : 'bg-white border-brand-border hover:border-slate-300 shadow-sm'
          }`}
        >
          <div className="flex items-center justify-between text-xs font-semibold text-brand-muted uppercase tracking-wider mb-2">
            <span>Denied Access</span>
            <XCircle className="w-4 h-4 text-rose-500" />
          </div>
          <div className="text-2xl font-black text-rose-600 tracking-tight">
            {summary.accessDeniedToday}
          </div>
          <p className="text-[11px] text-rose-600 font-semibold mt-1">Rejected attempts today</p>
        </button>
      </div>

      {/* Reception Verification Section */}
      <div className="bg-white rounded-2xl border border-brand-border shadow-sm overflow-hidden">
        <div className="p-6 border-b border-brand-border bg-slate-50/70">
          <div className="max-w-xl mx-auto text-center">
            <h2 className="text-lg font-bold text-brand-black tracking-tight flex items-center justify-center gap-2">
              <ShieldCheck className="w-5 h-5 text-brand-black" />
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
                  className="p-3 rounded-xl border border-brand-border bg-white text-brand-black hover:bg-slate-50 transition-colors shadow-sm flex items-center justify-center"
                >
                  <Camera className="w-4 h-4 text-brand-black" />
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* Verification Result Display Card */}
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

              {/* Guest & Visit Details (Safe Fields Only) */}
              {verificationResult.valid ? (
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
              ) : (
                <div className="my-4 p-4 rounded-xl bg-white border border-rose-200 flex items-start gap-3">
                  <ShieldAlert className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-sm font-bold text-rose-900">Access Reason: Denied</h4>
                    <p className="text-xs text-rose-700 mt-1">
                      {verificationResult.denialReason ||
                        verificationResult.message ||
                        'Credential validation failed. Entrance is not authorized.'}
                    </p>
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

      {/* Operational Sections Container */}
      <div className="bg-white rounded-2xl border border-brand-border shadow-sm overflow-hidden">
        {/* Navigation Tabs for all 5 Operational Sections + History */}
        <div className="flex overflow-x-auto border-b border-brand-border px-4 pt-2 bg-slate-50/70 gap-1.5 scrollbar-thin">
          {/* 1. Currently Checked In / Active Occupancy */}
          <button
            onClick={() => setCurrentSection('active')}
            className={`flex items-center gap-2 px-3.5 py-3 text-xs font-bold border-b-2 whitespace-nowrap transition-colors ${
              currentSection === 'active'
                ? 'border-brand-black text-brand-black bg-white -mb-px rounded-t-xl shadow-sm'
                : 'border-transparent text-brand-muted hover:text-brand-black'
            }`}
          >
            <Users className="w-4 h-4 text-emerald-600" />
            Currently Checked In
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
              {summary.currentlyCheckedIn}
            </span>
          </button>

          {/* 2. Today's Event Guests */}
          <button
            onClick={() => setCurrentSection('today-events')}
            className={`flex items-center gap-2 px-3.5 py-3 text-xs font-bold border-b-2 whitespace-nowrap transition-colors ${
              currentSection === 'today-events'
                ? 'border-brand-black text-brand-black bg-white -mb-px rounded-t-xl shadow-sm'
                : 'border-transparent text-brand-muted hover:text-brand-black'
            }`}
          >
            <Ticket className="w-4 h-4 text-indigo-600" />
            Today's Event Guests
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-800">
              {summary.todayEventGuests}
            </span>
          </button>

          {/* 3. Today's Visitors */}
          <button
            onClick={() => setCurrentSection('today-visitors')}
            className={`flex items-center gap-2 px-3.5 py-3 text-xs font-bold border-b-2 whitespace-nowrap transition-colors ${
              currentSection === 'today-visitors'
                ? 'border-brand-black text-brand-black bg-white -mb-px rounded-t-xl shadow-sm'
                : 'border-transparent text-brand-muted hover:text-brand-black'
            }`}
          >
            <Users className="w-4 h-4 text-amber-600" />
            Today's Visitors
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
              {summary.todayVisitors}
            </span>
          </button>

          {/* 4. Checked Out Today */}
          <button
            onClick={() => setCurrentSection('checked-out-today')}
            className={`flex items-center gap-2 px-3.5 py-3 text-xs font-bold border-b-2 whitespace-nowrap transition-colors ${
              currentSection === 'checked-out-today'
                ? 'border-brand-black text-brand-black bg-white -mb-px rounded-t-xl shadow-sm'
                : 'border-transparent text-brand-muted hover:text-brand-black'
            }`}
          >
            <UserMinus className="w-4 h-4 text-slate-500" />
            Checked Out Today
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700">
              {summary.checkedOutToday}
            </span>
          </button>

          {/* 5. Denied Access Today */}
          <button
            onClick={() => setCurrentSection('denied-today')}
            className={`flex items-center gap-2 px-3.5 py-3 text-xs font-bold border-b-2 whitespace-nowrap transition-colors ${
              currentSection === 'denied-today'
                ? 'border-brand-black text-brand-black bg-white -mb-px rounded-t-xl shadow-sm'
                : 'border-transparent text-brand-muted hover:text-brand-black'
            }`}
          >
            <XCircle className="w-4 h-4 text-rose-500" />
            Denied Access Today
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-700">
              {summary.accessDeniedToday}
            </span>
          </button>

          {/* 6. Full Access History Log */}
          <button
            onClick={() => setCurrentSection('history')}
            className={`flex items-center gap-2 px-3.5 py-3 text-xs font-bold border-b-2 whitespace-nowrap transition-colors ${
              currentSection === 'history'
                ? 'border-brand-black text-brand-black bg-white -mb-px rounded-t-xl shadow-sm'
                : 'border-transparent text-brand-muted hover:text-brand-black'
            }`}
          >
            <Clock className="w-4 h-4 text-brand-muted" />
            Full History Log
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700">
              {historyTotal}
            </span>
          </button>
        </div>

        {/* SECTION 1: Currently Checked In (Active Occupancy) */}
        {currentSection === 'active' && (
          <div className="p-6 space-y-4">
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
                Active Occupancy: {activeVisits.length} verified occupant{activeVisits.length === 1 ? '' : 's'} inside
              </span>
            </div>

            <div className="overflow-x-auto rounded-xl border border-brand-border">
              <table className="w-full text-left text-xs text-brand-black">
                <thead className="bg-slate-50 text-[11px] font-semibold text-brand-muted uppercase tracking-wider border-b border-brand-border">
                  <tr>
                    <th className="py-3 px-4">Guest Name</th>
                    <th className="py-3 px-4">Type</th>
                    <th className="py-3 px-4">Host / Event / Location</th>
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
                                : 'bg-amber-50 text-amber-700 border border-amber-200'
                            }`}
                          >
                            {v.passType}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-slate-700">
                          {v.passType === PassType.EVENT ? (
                            <div>
                              <div className="font-semibold">{v.eventTitle || v.hostOrEventTitle || 'Corporate Event'}</div>
                              {v.eventLocation && (
                                <div className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5">
                                  <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
                                  {v.eventLocation}
                                </div>
                              )}
                            </div>
                          ) : (
                            <div>
                              <div className="font-semibold">Host: {v.hostStaffName || v.hostOrEventTitle || 'Staff Member'}</div>
                              {v.purpose && (
                                <div className="text-[11px] text-slate-500 mt-0.5">Purpose: {v.purpose}</div>
                              )}
                            </div>
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

        {/* SECTION 2: Today's Event Guests */}
        {currentSection === 'today-events' && (
          <div className="p-6 space-y-4">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="relative w-full sm:w-72">
                <input
                  type="text"
                  value={todayEventSearch}
                  onChange={(e) => setTodayEventSearch(e.target.value)}
                  placeholder="Search event guests..."
                  className="w-full px-3.5 py-2 pl-9 rounded-xl border border-brand-border text-xs focus:outline-none focus:ring-2 focus:ring-brand-yellow/50"
                />
                <Search className="w-4 h-4 text-brand-muted absolute left-3 top-1/2 -translate-y-1/2" />
              </div>

              <span className="text-xs text-brand-muted font-medium">
                Today's Events: {todayEventVisits.length} guest arrival{todayEventVisits.length === 1 ? '' : 's'} recorded
              </span>
            </div>

            <div className="overflow-x-auto rounded-xl border border-brand-border">
              <table className="w-full text-left text-xs text-brand-black">
                <thead className="bg-slate-50 text-[11px] font-semibold text-brand-muted uppercase tracking-wider border-b border-brand-border">
                  <tr>
                    <th className="py-3 px-4">Invitee Name</th>
                    <th className="py-3 px-4">Organization</th>
                    <th className="py-3 px-4">Event &amp; Location</th>
                    <th className="py-3 px-4">Check-In</th>
                    <th className="py-3 px-4">Operator</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {isLoadingTodayEvents ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-brand-muted">
                        <RefreshCw className="w-5 h-5 animate-spin mx-auto text-brand-yellow mb-2" />
                        Loading today's event guests...
                      </td>
                    </tr>
                  ) : todayEventVisits.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-brand-muted">
                        <Ticket className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                        <p className="font-semibold text-sm text-slate-600">No event guests recorded today</p>
                        <p className="text-xs text-slate-400 mt-1">Arrivals for today's scheduled events will appear here.</p>
                      </td>
                    </tr>
                  ) : (
                    todayEventVisits.map((v) => (
                      <tr key={v.id} className="hover:bg-slate-50/60 transition-colors">
                        <td className="py-3.5 px-4 font-semibold text-brand-black">
                          {v.guestName || 'Guest'}
                        </td>
                        <td className="py-3.5 px-4 text-slate-500">
                          {v.guestOrganization || '—'}
                        </td>
                        <td className="py-3.5 px-4 text-slate-700">
                          <div className="font-semibold">{v.eventTitle || v.hostOrEventTitle || 'Corporate Event'}</div>
                          {v.eventLocation && (
                            <div className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5">
                              <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
                              {v.eventLocation}
                            </div>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-slate-600 font-mono text-[11px]">
                          {v.formattedCheckedInAt || '—'}
                        </td>
                        <td className="py-3.5 px-4 text-slate-500">
                          {v.checkedInByName || 'Desk'}
                        </td>
                        <td className="py-3.5 px-4">
                          <span
                            className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                              v.status === AccessVisitStatus.CHECKED_IN
                                ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                                : 'bg-slate-100 text-slate-700 border border-slate-300'
                            }`}
                          >
                            {v.status === AccessVisitStatus.CHECKED_IN && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />}
                            {v.status}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          {v.status === AccessVisitStatus.CHECKED_IN && (
                            <button
                              onClick={() => handleCheckOut(v.id, v.accessPassId)}
                              disabled={actionLoading}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-xs font-semibold text-slate-700 disabled:opacity-50"
                            >
                              Check Out
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* SECTION 3: Today's Visitors */}
        {currentSection === 'today-visitors' && (
          <div className="p-6 space-y-4">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="relative w-full sm:w-72">
                <input
                  type="text"
                  value={todayStaffSearch}
                  onChange={(e) => setTodayStaffSearch(e.target.value)}
                  placeholder="Search visitors or host staff..."
                  className="w-full px-3.5 py-2 pl-9 rounded-xl border border-brand-border text-xs focus:outline-none focus:ring-2 focus:ring-brand-yellow/50"
                />
                <Search className="w-4 h-4 text-brand-muted absolute left-3 top-1/2 -translate-y-1/2" />
              </div>

              <span className="text-xs text-brand-muted font-medium">
                Today's Visitors: {todayStaffVisits.length} visitor arrival{todayStaffVisits.length === 1 ? '' : 's'} recorded
              </span>
            </div>

            <div className="overflow-x-auto rounded-xl border border-brand-border">
              <table className="w-full text-left text-xs text-brand-black">
                <thead className="bg-slate-50 text-[11px] font-semibold text-brand-muted uppercase tracking-wider border-b border-brand-border">
                  <tr>
                    <th className="py-3 px-4">Visitor Name</th>
                    <th className="py-3 px-4">Host Staff</th>
                    <th className="py-3 px-4">Purpose</th>
                    <th className="py-3 px-4">Check-In</th>
                    <th className="py-3 px-4">Operator</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {isLoadingTodayStaff ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-brand-muted">
                        <RefreshCw className="w-5 h-5 animate-spin mx-auto text-brand-yellow mb-2" />
                        Loading today's visitors...
                      </td>
                    </tr>
                  ) : todayStaffVisits.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-brand-muted">
                        <Users className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                        <p className="font-semibold text-sm text-slate-600">No visitors recorded today</p>
                        <p className="text-xs text-slate-400 mt-1">Staff visitor arrivals will appear here once verified.</p>
                      </td>
                    </tr>
                  ) : (
                    todayStaffVisits.map((v) => (
                      <tr key={v.id} className="hover:bg-slate-50/60 transition-colors">
                        <td className="py-3.5 px-4 font-semibold text-brand-black">
                          {v.guestName || 'Visitor'}
                        </td>
                        <td className="py-3.5 px-4 font-medium text-slate-700">
                          {v.hostStaffName || v.hostOrEventTitle || 'Staff Member'}
                        </td>
                        <td className="py-3.5 px-4 text-slate-500">
                          {v.purpose || 'Official Visit'}
                        </td>
                        <td className="py-3.5 px-4 text-slate-600 font-mono text-[11px]">
                          {v.formattedCheckedInAt || '—'}
                        </td>
                        <td className="py-3.5 px-4 text-slate-500">
                          {v.checkedInByName || 'Desk'}
                        </td>
                        <td className="py-3.5 px-4">
                          <span
                            className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                              v.status === AccessVisitStatus.CHECKED_IN
                                ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                                : 'bg-slate-100 text-slate-700 border border-slate-300'
                            }`}
                          >
                            {v.status === AccessVisitStatus.CHECKED_IN && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />}
                            {v.status}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          {v.status === AccessVisitStatus.CHECKED_IN && (
                            <button
                              onClick={() => handleCheckOut(v.id, v.accessPassId)}
                              disabled={actionLoading}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-xs font-semibold text-slate-700 disabled:opacity-50"
                            >
                              Check Out
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* SECTION 4: Checked Out Today */}
        {currentSection === 'checked-out-today' && (
          <div className="p-6 space-y-4">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="relative w-full sm:w-72">
                <input
                  type="text"
                  value={checkedOutSearch}
                  onChange={(e) => setCheckedOutSearch(e.target.value)}
                  placeholder="Search departed guests..."
                  className="w-full px-3.5 py-2 pl-9 rounded-xl border border-brand-border text-xs focus:outline-none focus:ring-2 focus:ring-brand-yellow/50"
                />
                <Search className="w-4 h-4 text-brand-muted absolute left-3 top-1/2 -translate-y-1/2" />
              </div>

              <span className="text-xs text-brand-muted font-medium">
                Departures: {checkedOutVisits.length} completed departure{checkedOutVisits.length === 1 ? '' : 's'} recorded today
              </span>
            </div>

            <div className="overflow-x-auto rounded-xl border border-brand-border">
              <table className="w-full text-left text-xs text-brand-black">
                <thead className="bg-slate-50 text-[11px] font-semibold text-brand-muted uppercase tracking-wider border-b border-brand-border">
                  <tr>
                    <th className="py-3 px-4">Guest Name</th>
                    <th className="py-3 px-4">Pass Type</th>
                    <th className="py-3 px-4">Host / Event</th>
                    <th className="py-3 px-4">Check-In</th>
                    <th className="py-3 px-4">Check-Out</th>
                    <th className="py-3 px-4">Checked Out By</th>
                    <th className="py-3 px-4">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {isLoadingCheckedOut ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-brand-muted">
                        <RefreshCw className="w-5 h-5 animate-spin mx-auto text-brand-yellow mb-2" />
                        Loading departed guests...
                      </td>
                    </tr>
                  ) : checkedOutVisits.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-brand-muted">
                        <UserMinus className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                        <p className="font-semibold text-sm text-slate-600">No departures recorded today</p>
                        <p className="text-xs text-slate-400 mt-1">Guests who check out today will be listed here.</p>
                      </td>
                    </tr>
                  ) : (
                    checkedOutVisits.map((v) => (
                      <tr key={v.id} className="hover:bg-slate-50/60 transition-colors">
                        <td className="py-3.5 px-4 font-semibold text-brand-black">
                          <div>{v.guestName || 'Guest'}</div>
                          {v.guestOrganization && (
                            <div className="text-[11px] font-normal text-slate-400">{v.guestOrganization}</div>
                          )}
                        </td>
                        <td className="py-3.5 px-4">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${
                              v.passType === PassType.EVENT
                                ? 'bg-indigo-50 text-indigo-700'
                                : 'bg-amber-50 text-amber-700'
                            }`}
                          >
                            {v.passType}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 font-medium text-slate-700">
                          {v.hostOrEventTitle || '—'}
                        </td>
                        <td className="py-3.5 px-4 text-slate-600 font-mono text-[11px]">
                          {v.formattedCheckedInAt || '—'}
                        </td>
                        <td className="py-3.5 px-4 text-slate-600 font-mono text-[11px]">
                          {v.formattedCheckedOutAt || '—'}
                        </td>
                        <td className="py-3.5 px-4 text-slate-500 font-medium">
                          {v.checkedOutByName || 'Reception'}
                        </td>
                        <td className="py-3.5 px-4">
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-300">
                            CHECKED OUT
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

        {/* SECTION 5: Denied Access Today */}
        {currentSection === 'denied-today' && (
          <div className="p-6 space-y-4">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="relative w-full sm:w-72">
                <input
                  type="text"
                  value={deniedSearch}
                  onChange={(e) => setDeniedSearch(e.target.value)}
                  placeholder="Search denied credentials..."
                  className="w-full px-3.5 py-2 pl-9 rounded-xl border border-brand-border text-xs focus:outline-none focus:ring-2 focus:ring-brand-yellow/50"
                />
                <Search className="w-4 h-4 text-brand-muted absolute left-3 top-1/2 -translate-y-1/2" />
              </div>

              <span className="text-xs text-brand-muted font-medium">
                Denied Attempts: {deniedVisits.length} access denial{deniedVisits.length === 1 ? '' : 's'} recorded today
              </span>
            </div>

            <div className="overflow-x-auto rounded-xl border border-brand-border">
              <table className="w-full text-left text-xs text-brand-black">
                <thead className="bg-slate-50 text-[11px] font-semibold text-brand-muted uppercase tracking-wider border-b border-brand-border">
                  <tr>
                    <th className="py-3 px-4">Timestamp (Lagos)</th>
                    <th className="py-3 px-4">Code / Reference</th>
                    <th className="py-3 px-4">Safe Reason</th>
                    <th className="py-3 px-4">Desk Operator</th>
                    <th className="py-3 px-4">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {isLoadingDenied ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-brand-muted">
                        <RefreshCw className="w-5 h-5 animate-spin mx-auto text-brand-yellow mb-2" />
                        Loading denied access audit logs...
                      </td>
                    </tr>
                  ) : deniedVisits.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-12 text-center text-brand-muted">
                        <CheckCircle className="w-8 h-8 mx-auto text-emerald-400 mb-2" />
                        <p className="font-semibold text-sm text-slate-600">No access denials recorded today</p>
                        <p className="text-xs text-slate-400 mt-1">Any unauthorized or rejected attempts will be securely audited and shown here.</p>
                      </td>
                    </tr>
                  ) : (
                    deniedVisits.map((v) => (
                      <tr key={v.id} className="hover:bg-slate-50/60 transition-colors">
                        <td className="py-3.5 px-4 font-mono text-[11px] text-slate-700">
                          {v.formattedCheckedInAt || (v.createdAt ? new Date(v.createdAt).toLocaleTimeString() : '—')}
                        </td>
                        <td className="py-3.5 px-4">
                          <span className="font-mono text-xs font-bold text-slate-800">{v.displayCode || '—'}</span>
                        </td>
                        <td className="py-3.5 px-4 text-rose-700 font-medium">
                          {v.denialReason || 'Access verification denied'}
                        </td>
                        <td className="py-3.5 px-4 text-slate-600">
                          {v.checkedInByName || 'Desk Operator'}
                        </td>
                        <td className="py-3.5 px-4">
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-700 border border-rose-300">
                            <XCircle className="w-3 h-3" />
                            ACCESS DENIED
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

        {/* SECTION 6: Full Access History Log with Multi-Filters & Pagination */}
        {currentSection === 'history' && (
          <div className="p-6 space-y-4">
            {/* Filter controls */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="relative">
                <input
                  type="text"
                  value={historySearch}
                  onChange={(e) => {
                    setHistorySearch(e.target.value);
                    setHistoryPage(1);
                  }}
                  placeholder="Search guest or host..."
                  className="w-full px-3.5 py-2 pl-9 rounded-xl border border-brand-border text-xs focus:outline-none focus:ring-2 focus:ring-brand-yellow/50"
                />
                <Search className="w-4 h-4 text-brand-muted absolute left-3 top-1/2 -translate-y-1/2" />
              </div>

              <select
                value={historyStatusFilter}
                onChange={(e) => {
                  setHistoryStatusFilter(e.target.value);
                  setHistoryPage(1);
                }}
                className="w-full px-3 py-2 rounded-xl border border-brand-border text-xs focus:outline-none focus:ring-2 focus:ring-brand-yellow/50 bg-white"
              >
                <option value="">All Statuses</option>
                <option value="CHECKED_IN">Checked In (Active)</option>
                <option value="CHECKED_OUT">Checked Out</option>
                <option value="DENIED">Denied Access</option>
              </select>

              <select
                value={historyPassTypeFilter}
                onChange={(e) => {
                  setHistoryPassTypeFilter(e.target.value);
                  setHistoryPage(1);
                }}
                className="w-full px-3 py-2 rounded-xl border border-brand-border text-xs focus:outline-none focus:ring-2 focus:ring-brand-yellow/50 bg-white"
              >
                <option value="">All Pass Types</option>
                <option value="VISITOR">Visitor Passes</option>
                <option value="EVENT">Event Passes</option>
              </select>

              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={historyStartDate}
                  onChange={(e) => {
                    setHistoryStartDate(e.target.value);
                    setHistoryPage(1);
                  }}
                  title="Filter Date"
                  className="w-full px-2.5 py-2 rounded-xl border border-brand-border text-xs focus:outline-none focus:ring-2 focus:ring-brand-yellow/50 bg-white"
                />
                {(historySearch || historyStatusFilter || historyPassTypeFilter || historyStartDate) && (
                  <button
                    onClick={() => {
                      setHistorySearch('');
                      setHistoryStatusFilter('');
                      setHistoryPassTypeFilter('');
                      setHistoryStartDate('');
                      setHistoryEndDate('');
                      setHistoryPage(1);
                    }}
                    className="px-2.5 py-2 rounded-xl border border-slate-300 text-xs font-semibold text-slate-600 hover:bg-slate-100 shrink-0"
                    title="Clear Filters"
                  >
                    Reset
                  </button>
                )}
              </div>
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
                            <span
                              className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                v.passType === PassType.EVENT
                                  ? 'bg-indigo-50 text-indigo-700'
                                  : 'bg-amber-50 text-amber-700'
                              }`}
                            >
                              {v.passType}
                            </span>
                          </div>
                        </td>
                        <td className="py-3.5 px-4 font-medium text-slate-700">
                          {v.hostOrEventTitle || (v.denialReason ? <span className="text-rose-600 font-normal">{v.denialReason}</span> : '—')}
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

            {/* Pagination Controls */}
            {historyTotal > historyLimit && (
              <div className="flex items-center justify-between pt-2">
                <span className="text-xs text-slate-500">
                  Showing {(historyPage - 1) * historyLimit + 1}–{Math.min(historyPage * historyLimit, historyTotal)} of {historyTotal} records
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
                    disabled={historyPage <= 1}
                    className="p-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 transition-colors"
                    title="Previous page"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="text-xs font-semibold text-slate-700 px-2">
                    Page {historyPage} of {totalHistoryPages}
                  </span>
                  <button
                    onClick={() => setHistoryPage((p) => Math.min(totalHistoryPages, p + 1))}
                    disabled={historyPage >= totalHistoryPages}
                    className="p-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 transition-colors"
                    title="Next page"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* QR Camera Modal / Progressive Enhancement */}
      {showQrModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-brand-border max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-brand-border">
              <h3 className="font-bold text-brand-black flex items-center gap-2">
                <Camera className="w-5 h-5 text-brand-yellow" />
                Scan Access QR Credential
              </h3>
              <button
                onClick={() => {
                  stopCamera();
                  setShowQrModal(false);
                  setCameraError(null);
                }}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Video preview / Scanner box */}
            <div className="relative bg-slate-950 rounded-xl overflow-hidden min-h-[220px] flex flex-col items-center justify-center">
              <video
                ref={videoRef}
                playsInline
                autoPlay
                muted
                className={`w-full h-56 object-cover ${isCameraActive ? 'block' : 'hidden'}`}
              />

              {!isCameraActive && (
                <div className="p-8 text-center text-white flex flex-col items-center justify-center">
                  <QrCode className="w-14 h-14 text-brand-yellow mb-3 animate-pulse" />
                  <p className="text-xs text-slate-300 max-w-xs font-medium">
                    {cameraError ? cameraError : 'Initializing camera scanner...'}
                  </p>
                </div>
              )}

              {isCameraActive && (
                <div className="absolute inset-0 border-2 border-brand-yellow/60 rounded-xl pointer-events-none flex items-center justify-center">
                  <div className="w-44 h-44 border-2 border-dashed border-brand-yellow rounded-lg animate-pulse" />
                </div>
              )}
            </div>

            {/* Manual paste / code entry fallback within modal */}
            <div className="space-y-3 pt-1">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={manualModalInput}
                  onChange={(e) => setManualModalInput(e.target.value)}
                  placeholder="Or paste QR link / code here..."
                  className="flex-1 px-3 py-2 border border-slate-300 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-brand-yellow/50"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (manualModalInput.trim()) {
                      handleScannedPayload(manualModalInput.trim());
                    }
                  }}
                  disabled={!manualModalInput.trim()}
                  className="px-3 py-2 bg-brand-black text-white text-xs font-bold rounded-xl hover:bg-slate-800 disabled:opacity-50"
                >
                  Verify
                </button>
              </div>

              <p className="text-[11px] text-slate-400 text-center">
                Camera scanner processes QR credentials locally on-device. Frames are never stored or uploaded.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
