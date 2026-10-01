import React, { useState, useEffect } from 'react';
import {
  X,
  UserPlus,
  Mail,
  Phone,
  Calendar,
  Clock,
  FileText,
  AlertCircle,
  RefreshCw,
  Ticket,
  UserCheck,
} from 'lucide-react';
import { VisitorVisitRecord, AccessPassRecord, UserRole } from '../../types/index.ts';
import { useAuth } from '../../context/AuthContext.tsx';

interface CreateVisitorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (newVisit: VisitorVisitRecord, generatedPass?: AccessPassRecord) => void;
}

export const CreateVisitorModal: React.FC<CreateVisitorModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const { user } = useAuth();

  // Default to today's date in Lagos
  const todayStr = new Date().toISOString().split('T')[0];

  const [visitorFullName, setVisitorFullName] = useState('');
  const [visitorEmail, setVisitorEmail] = useState('');
  const [visitorPhone, setVisitorPhone] = useState('');
  const [purpose, setPurpose] = useState('');
  const [notes, setNotes] = useState('');
  const [visitDate, setVisitDate] = useState(todayStr);
  const [startTime, setStartTime] = useState('10:00');
  const [endTime, setEndTime] = useState('12:00');
  const [hostStaffId, setHostStaffId] = useState('');
  const [staffList, setStaffList] = useState<{ id: string; name: string; department?: string }[]>([]);
  const [generatePassNow, setGeneratePassNow] = useState(true);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAdmin = user?.role === UserRole.ADMIN || user?.role === UserRole.SUPER_ADMIN;

  // Load staff list if Admin
  useEffect(() => {
    if (!isOpen || !isAdmin) return;

    fetch('/api/admin/staff')
      .then((res) => res.json())
      .then((json) => {
        if (json.success && Array.isArray(json.data)) {
          const list = json.data.map((s: any) => ({
            id: s.id,
            name: `${s.firstName} ${s.lastName}`,
            department: s.department,
          }));
          setStaffList(list);
          if (user?.id) setHostStaffId(user.id);
        }
      })
      .catch((err) => console.error('Failed to load staff list:', err));
  }, [isOpen, isAdmin, user?.id]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!visitorFullName.trim()) {
      setError('Visitor full name is required.');
      return;
    }
    if (!visitDate) {
      setError('Visit date is required.');
      return;
    }
    if (!startTime || !endTime) {
      setError('Start time and end time are required.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const payload: Record<string, any> = {
        visitorFullName: visitorFullName.trim(),
        visitDate,
        startTime,
        endTime,
        visitorEmail: visitorEmail.trim() || undefined,
        visitorPhone: visitorPhone.trim() || undefined,
        purpose: purpose.trim() || undefined,
        notes: notes.trim() || undefined,
      };

      if (isAdmin && hostStaffId) {
        payload.hostStaffId = hostStaffId;
      }

      // 1. Create Visitor Invitation
      const createRes = await fetch('/api/visitor-visits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const createJson = await createRes.json();
      if (!createRes.ok || !createJson.success) {
        throw new Error(createJson.message || 'Failed to create visitor invitation.');
      }

      const newVisit: VisitorVisitRecord = createJson.data;

      // 2. Generate access pass immediately if requested
      let generatedPass: AccessPassRecord | undefined;
      if (generatePassNow && newVisit.id) {
        const passRes = await fetch(`/api/visitor-visits/${newVisit.id}/access-pass`, {
          method: 'POST',
        });
        const passJson = await passRes.json();
        if (passRes.ok && passJson.success) {
          generatedPass = passJson.data.pass;
          newVisit.status = passJson.data.visit.status;
          newVisit.accessPassId = passJson.data.visit.accessPassId;
          newVisit.accessPass = generatedPass;
        }
      }

      // Reset form
      setVisitorFullName('');
      setVisitorEmail('');
      setVisitorPhone('');
      setPurpose('');
      setNotes('');
      setVisitDate(todayStr);
      setStartTime('10:00');
      setEndTime('12:00');
      setGeneratePassNow(true);

      onSuccess(newVisit, generatedPass);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error creating visitor invitation.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-xs z-70 flex items-center justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl border border-brand-border max-w-lg w-full shadow-2xl overflow-hidden my-8"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 border-b border-brand-border flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600">
              <UserPlus className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-brand-black">Create Visitor Invitation</h3>
              <p className="text-[11px] text-brand-muted">
                Host: <span className="font-semibold text-neutral-800">{user?.firstName} {user?.lastName}</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-brand-muted hover:text-brand-black hover:bg-neutral-100 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Error Notice */}
        {error && (
          <div className="mx-5 mt-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Host Staff Selector (Admins only) */}
          {isAdmin && staffList.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-brand-black mb-1">
                Visiting Staff Member (Host)
              </label>
              <div className="relative">
                <UserCheck className="w-3.5 h-3.5 text-neutral-400 absolute left-3 top-2.5" />
                <select
                  id="visitor-host-select"
                  value={hostStaffId}
                  onChange={(e) => setHostStaffId(e.target.value)}
                  className="w-full pl-8 pr-3 py-2 text-xs rounded-xl border border-brand-border bg-white text-neutral-800 font-medium focus:border-brand-black outline-hidden"
                >
                  {staffList.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} {s.department ? `(${s.department})` : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Visitor Full Name */}
          <div>
            <label className="block text-xs font-semibold text-brand-black mb-1">
              Visitor Full Name <span className="text-rose-500">*</span>
            </label>
            <input
              id="visitor-fullname-input"
              type="text"
              required
              value={visitorFullName}
              onChange={(e) => setVisitorFullName(e.target.value)}
              placeholder="e.g. Michael Smith"
              className="w-full px-3 py-2 text-xs rounded-xl border border-brand-border focus:border-brand-black focus:ring-1 focus:ring-brand-black outline-hidden"
            />
          </div>

          {/* Date & Time Window */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <div>
              <label className="block text-xs font-semibold text-brand-black mb-1">
                Visit Date <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <Calendar className="w-3.5 h-3.5 text-neutral-400 absolute left-3 top-2.5" />
                <input
                  id="visitor-date-input"
                  type="date"
                  required
                  value={visitDate}
                  onChange={(e) => setVisitDate(e.target.value)}
                  className="w-full pl-8 pr-2 py-2 text-xs rounded-xl border border-brand-border focus:border-brand-black outline-hidden"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-brand-black mb-1">
                Start Time <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <Clock className="w-3.5 h-3.5 text-neutral-400 absolute left-3 top-2.5" />
                <input
                  id="visitor-starttime-input"
                  type="time"
                  required
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-full pl-8 pr-2 py-2 text-xs rounded-xl border border-brand-border focus:border-brand-black outline-hidden"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-brand-black mb-1">
                End Time <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <Clock className="w-3.5 h-3.5 text-neutral-400 absolute left-3 top-2.5" />
                <input
                  id="visitor-endtime-input"
                  type="time"
                  required
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="w-full pl-8 pr-2 py-2 text-xs rounded-xl border border-brand-border focus:border-brand-black outline-hidden"
                />
              </div>
            </div>
          </div>

          {/* Email & Phone */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-brand-black mb-1">
                Visitor Email Address
              </label>
              <div className="relative">
                <Mail className="w-3.5 h-3.5 text-neutral-400 absolute left-3 top-2.5" />
                <input
                  id="visitor-email-input"
                  type="email"
                  value={visitorEmail}
                  onChange={(e) => setVisitorEmail(e.target.value)}
                  placeholder="visitor@company.com"
                  className="w-full pl-8 pr-3 py-2 text-xs rounded-xl border border-brand-border focus:border-brand-black focus:ring-1 focus:ring-brand-black outline-hidden"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-brand-black mb-1">
                Visitor Phone
              </label>
              <div className="relative">
                <Phone className="w-3.5 h-3.5 text-neutral-400 absolute left-3 top-2.5" />
                <input
                  id="visitor-phone-input"
                  type="tel"
                  value={visitorPhone}
                  onChange={(e) => setVisitorPhone(e.target.value)}
                  placeholder="+234 803 123 4567"
                  className="w-full pl-8 pr-3 py-2 text-xs rounded-xl border border-brand-border focus:border-brand-black focus:ring-1 focus:ring-brand-black outline-hidden"
                />
              </div>
            </div>
          </div>

          {/* Purpose of Visit */}
          <div>
            <label className="block text-xs font-semibold text-brand-black mb-1">
              Purpose of Visit
            </label>
            <input
              id="visitor-purpose-input"
              type="text"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder="e.g. Project Review Meeting / Client Consultation"
              className="w-full px-3 py-2 text-xs rounded-xl border border-brand-border focus:border-brand-black focus:ring-1 focus:ring-brand-black outline-hidden"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-semibold text-brand-black mb-1">
              Internal Notes / Security Instructions
            </label>
            <div className="relative">
              <FileText className="w-3.5 h-3.5 text-neutral-400 absolute left-3 top-2.5" />
              <textarea
                id="visitor-notes-input"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Escort required to 4th floor Conference Room B"
                className="w-full pl-8 pr-3 py-2 text-xs rounded-xl border border-brand-border focus:border-brand-black focus:ring-1 focus:ring-brand-black outline-hidden"
              />
            </div>
          </div>

          {/* Generate Pass Immediately Checkbox */}
          <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-xl flex items-start gap-2.5 cursor-pointer">
            <input
              id="visitor-generate-pass-checkbox"
              type="checkbox"
              checked={generatePassNow}
              onChange={(e) => setGeneratePassNow(e.target.checked)}
              className="mt-0.5 rounded border-amber-300 text-amber-600 focus:ring-amber-500"
            />
            <label htmlFor="visitor-generate-pass-checkbox" className="text-xs cursor-pointer select-none">
              <span className="font-bold text-amber-950 flex items-center gap-1.5">
                <Ticket className="w-3.5 h-3.5 text-amber-700" />
                Generate secure visitor access pass immediately
              </span>
              <span className="text-[11px] text-amber-800 block mt-0.5">
                Issues a unique QR code and human-readable visitor code (VIS-XXXX-XXXX) valid for this visit window.
              </span>
            </label>
          </div>

          {/* Actions */}
          <div className="pt-3 border-t border-brand-border flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-neutral-600 hover:text-brand-black rounded-xl transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              id="submit-visitor-btn"
              type="submit"
              disabled={loading}
              className="px-4 py-2 text-xs font-bold bg-brand-yellow hover:bg-brand-yellow-hover text-brand-black rounded-xl transition flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-50"
            >
              {loading ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Creating...</span>
                </>
              ) : (
                <>
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>Send Visitor Invitation</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
