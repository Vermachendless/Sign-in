import React, { useState } from 'react';
import {
  X,
  UserPlus,
  Mail,
  Phone,
  Building,
  FileText,
  AlertCircle,
  RefreshCw,
  Ticket,
} from 'lucide-react';
import { EventRecord, EventInviteeRecord, AccessPassRecord } from '../../types/index.ts';

interface AddInviteeModalProps {
  isOpen: boolean;
  event: EventRecord | null;
  onClose: () => void;
  onSuccess: (newInvitee: EventInviteeRecord, generatedPass?: AccessPassRecord) => void;
}

export const AddInviteeModal: React.FC<AddInviteeModalProps> = ({
  isOpen,
  event,
  onClose,
  onSuccess,
}) => {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [organization, setOrganization] = useState('');
  const [notes, setNotes] = useState('');
  const [generatePassNow, setGeneratePassNow] = useState(true);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen || !event) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) {
      setError('Full name is required.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // 1. Create Invitee
      const createRes = await fetch(`/api/events/${event.id}/invitees`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: fullName.trim(),
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          organization: organization.trim() || undefined,
          notes: notes.trim() || undefined,
        }),
      });

      const createJson = await createRes.json();
      if (!createRes.ok || !createJson.success) {
        throw new Error(createJson.message || 'Failed to add invitee.');
      }

      const newInvitee: EventInviteeRecord = createJson.data;

      // 2. Optionally generate access pass immediately
      let generatedPass: AccessPassRecord | undefined;
      if (generatePassNow && newInvitee.id) {
        const passRes = await fetch(`/api/events/${event.id}/invitees/${newInvitee.id}/access-pass`, {
          method: 'POST',
        });
        const passJson = await passRes.json();
        if (passRes.ok && passJson.success) {
          generatedPass = passJson.data.pass;
          newInvitee.status = passJson.data.invitee.status;
          newInvitee.accessPassId = passJson.data.invitee.accessPassId;
          newInvitee.accessPass = generatedPass;
        }
      }

      // Reset form
      setFullName('');
      setEmail('');
      setPhone('');
      setOrganization('');
      setNotes('');
      setGeneratePassNow(true);

      onSuccess(newInvitee, generatedPass);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error adding invitee.');
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
              <h3 className="font-bold text-sm text-brand-black">Add Event Invitee</h3>
              <p className="text-[11px] text-brand-muted truncate max-w-xs">{event.title}</p>
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
          {/* Full Name */}
          <div>
            <label className="block text-xs font-semibold text-brand-black mb-1">
              Full Name <span className="text-rose-500">*</span>
            </label>
            <input
              id="invitee-fullname-input"
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="e.g. Dr. Ngozi Okonjo"
              className="w-full px-3 py-2 text-xs rounded-xl border border-brand-border focus:border-brand-black focus:ring-1 focus:ring-brand-black outline-hidden"
            />
          </div>

          {/* Email & Phone Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-brand-black mb-1">
                Email Address
              </label>
              <div className="relative">
                <Mail className="w-3.5 h-3.5 text-neutral-400 absolute left-3 top-2.5" />
                <input
                  id="invitee-email-input"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="guest@example.com"
                  className="w-full pl-8 pr-3 py-2 text-xs rounded-xl border border-brand-border focus:border-brand-black focus:ring-1 focus:ring-brand-black outline-hidden"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-brand-black mb-1">
                Phone Number
              </label>
              <div className="relative">
                <Phone className="w-3.5 h-3.5 text-neutral-400 absolute left-3 top-2.5" />
                <input
                  id="invitee-phone-input"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+234 801 234 5678"
                  className="w-full pl-8 pr-3 py-2 text-xs rounded-xl border border-brand-border focus:border-brand-black focus:ring-1 focus:ring-brand-black outline-hidden"
                />
              </div>
            </div>
          </div>

          {/* Organization */}
          <div>
            <label className="block text-xs font-semibold text-brand-black mb-1">
              Organization / Company
            </label>
            <div className="relative">
              <Building className="w-3.5 h-3.5 text-neutral-400 absolute left-3 top-2.5" />
              <input
                id="invitee-org-input"
                type="text"
                value={organization}
                onChange={(e) => setOrganization(e.target.value)}
                placeholder="e.g. Federal Ministry of Finance / TechCorp"
                className="w-full pl-8 pr-3 py-2 text-xs rounded-xl border border-brand-border focus:border-brand-black focus:ring-1 focus:ring-brand-black outline-hidden"
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-semibold text-brand-black mb-1">
              Internal Notes / Special Instructions
            </label>
            <div className="relative">
              <FileText className="w-3.5 h-3.5 text-neutral-400 absolute left-3 top-2.5" />
              <textarea
                id="invitee-notes-input"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Keynote Speaker / VIP seating Level 2"
                className="w-full pl-8 pr-3 py-2 text-xs rounded-xl border border-brand-border focus:border-brand-black focus:ring-1 focus:ring-brand-black outline-hidden"
              />
            </div>
          </div>

          {/* Checkbox for Immediate Access Pass Generation */}
          <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-xl flex items-start gap-2.5 cursor-pointer">
            <input
              id="generate-pass-checkbox"
              type="checkbox"
              checked={generatePassNow}
              onChange={(e) => setGeneratePassNow(e.target.checked)}
              className="mt-0.5 rounded border-amber-300 text-amber-600 focus:ring-amber-500"
            />
            <label htmlFor="generate-pass-checkbox" className="text-xs cursor-pointer select-none">
              <span className="font-bold text-amber-950 flex items-center gap-1.5">
                <Ticket className="w-3.5 h-3.5 text-amber-700" />
                Generate individual access pass immediately
              </span>
              <span className="text-[11px] text-amber-800 block mt-0.5">
                Automatically issues a secure single-use access code &amp; QR pass valid for the duration of this event.
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
              id="submit-invitee-btn"
              type="submit"
              disabled={loading}
              className="px-4 py-2 text-xs font-bold bg-brand-yellow hover:bg-brand-yellow-hover text-brand-black rounded-xl transition flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-50"
            >
              {loading ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Adding...</span>
                </>
              ) : (
                <>
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>Add Invitee</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
