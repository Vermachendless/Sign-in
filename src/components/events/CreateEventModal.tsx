import React, { useState } from 'react';
import {
  X,
  CalendarDays,
  MapPin,
  Clock,
  FileText,
  AlertTriangle,
  RefreshCw,
  Plus,
  Save,
  Check,
} from 'lucide-react';
import { EventRecord } from '../../types/index.ts';

interface CreateEventModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (event: EventRecord) => void;
  initialEvent?: EventRecord | null;
}

export const CreateEventModal: React.FC<CreateEventModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  initialEvent,
}) => {
  // Helper to split ISO into date and time
  const parseIsoToDateAndTime = (iso?: string | null) => {
    if (!iso) return { date: '', time: '09:00' };
    try {
      const d = new Date(iso);
      const dateStr = d.toISOString().split('T')[0];
      const hours = String(d.getHours()).padStart(2, '0');
      const minutes = String(d.getMinutes()).padStart(2, '0');
      return { date: dateStr, time: `${hours}:${minutes}` };
    } catch {
      return { date: '', time: '09:00' };
    }
  };

  // Get tomorrow's date for default
  const getDefaultDates = () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = tomorrow.toISOString().split('T')[0];
    return {
      startDate: dateStr,
      startTime: '09:00',
      endDate: dateStr,
      endTime: '17:00',
    };
  };

  const initialValues = initialEvent
    ? {
        title: initialEvent.title,
        description: initialEvent.description || '',
        location: initialEvent.location,
        ...(() => {
          const s = parseIsoToDateAndTime(initialEvent.startAt);
          const e = parseIsoToDateAndTime(initialEvent.endAt);
          return {
            startDate: s.date,
            startTime: s.time,
            endDate: e.date,
            endTime: e.time,
          };
        })(),
      }
    : {
        title: '',
        description: '',
        location: '',
        ...getDefaultDates(),
      };

  const [title, setTitle] = useState(initialValues.title);
  const [description, setDescription] = useState(initialValues.description);
  const [location, setLocation] = useState(initialValues.location);
  const [startDate, setStartDate] = useState(initialValues.startDate);
  const [startTime, setStartTime] = useState(initialValues.startTime);
  const [endDate, setEndDate] = useState(initialValues.endDate);
  const [endTime, setEndTime] = useState(initialValues.endTime);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  // Build ISO timestamps from date and time
  const constructIso = (date: string, time: string): string | null => {
    if (!date || !time) return null;
    try {
      const combined = new Date(`${date}T${time}:00`);
      if (isNaN(combined.getTime())) return null;
      return combined.toISOString();
    } catch {
      return null;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedTitle = title.trim();
    if (!trimmedTitle || trimmedTitle.length < 3) {
      setError('Event title must be at least 3 characters.');
      return;
    }

    const trimmedLocation = location.trim();
    if (!trimmedLocation || trimmedLocation.length < 2) {
      setError('Event location must be at least 2 characters.');
      return;
    }

    const startIso = constructIso(startDate, startTime);
    const endIso = constructIso(endDate, endTime);

    if (!startIso || !endIso) {
      setError('Please provide valid start and end dates and times.');
      return;
    }

    if (new Date(endIso).getTime() <= new Date(startIso).getTime()) {
      setError('Event end date/time must be strictly after the start date/time.');
      return;
    }

    setLoading(true);

    try {
      const url = initialEvent ? `/api/events/${initialEvent.id}` : '/api/events';
      const method = initialEvent ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: trimmedTitle,
          description: description.trim() || null,
          location: trimmedLocation,
          startAt: startIso,
          endAt: endIso,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.message || 'Failed to save event.');
      }

      onSuccess(json.data);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error submitting event form.');
    } finally {
      setLoading(false);
    }
  };

  // Preview formatted details
  const previewStart = constructIso(startDate, startTime);
  const previewEnd = constructIso(endDate, endTime);
  const isTimeOrderValid =
    previewStart && previewEnd && new Date(previewEnd).getTime() > new Date(previewStart).getTime();

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-xs z-60 flex items-center justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl border border-brand-border max-w-xl w-full shadow-2xl overflow-hidden my-8"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-6 border-b border-brand-border flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-neutral-900 text-brand-yellow flex items-center justify-center font-bold">
              <CalendarDays className="w-5 h-5 text-brand-yellow" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-brand-black">
                {initialEvent ? 'Edit Event Details' : 'Create New Event'}
              </h2>
              <p className="text-xs text-brand-muted">
                {initialEvent ? 'Update schedule and information' : 'Create a draft event to submit for approval'}
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

        {/* Error Alert */}
        {error && (
          <div className="mx-6 mt-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-xs">
          {/* Event Title */}
          <div>
            <label htmlFor="event-form-title" className="block font-semibold text-brand-black mb-1">
              Event Title <span className="text-rose-600">*</span>
            </label>
            <input
              id="event-form-title"
              type="text"
              required
              placeholder="e.g. Annual Executive Summit or Client Conference"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-brand-border bg-white text-brand-black text-sm focus:outline-hidden focus:ring-2 focus:ring-brand-yellow focus:border-brand-yellow"
            />
          </div>

          {/* Location */}
          <div>
            <label htmlFor="event-form-location" className="block font-semibold text-brand-black mb-1">
              Location / Venue <span className="text-rose-600">*</span>
            </label>
            <div className="relative">
              <MapPin className="w-4 h-4 text-brand-muted absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                id="event-form-location"
                type="text"
                required
                placeholder="e.g. Main Auditorium, Lagos Office Floor 4"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="w-full pl-9 pr-3.5 py-2.5 rounded-xl border border-brand-border bg-white text-brand-black text-sm focus:outline-hidden focus:ring-2 focus:ring-brand-yellow focus:border-brand-yellow"
              />
            </div>
          </div>

          {/* Date & Time Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Start Date & Time */}
            <div className="p-3.5 rounded-xl bg-brand-bg border border-brand-border space-y-2">
              <span className="font-semibold text-brand-black flex items-center gap-1.5 text-xs">
                <Clock className="w-3.5 h-3.5 text-brand-yellow" /> Start Schedule *
              </span>
              <div>
                <label className="block text-[11px] text-brand-muted mb-0.5">Start Date</label>
                <input
                  id="event-form-start-date"
                  type="date"
                  required
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-brand-border bg-white text-brand-black text-xs font-mono"
                />
              </div>
              <div>
                <label className="block text-[11px] text-brand-muted mb-0.5">Start Time</label>
                <input
                  id="event-form-start-time"
                  type="time"
                  required
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-brand-border bg-white text-brand-black text-xs font-mono"
                />
              </div>
            </div>

            {/* End Date & Time */}
            <div className="p-3.5 rounded-xl bg-brand-bg border border-brand-border space-y-2">
              <span className="font-semibold text-brand-black flex items-center gap-1.5 text-xs">
                <Clock className="w-3.5 h-3.5 text-brand-yellow" /> End Schedule *
              </span>
              <div>
                <label className="block text-[11px] text-brand-muted mb-0.5">End Date</label>
                <input
                  id="event-form-end-date"
                  type="date"
                  required
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-brand-border bg-white text-brand-black text-xs font-mono"
                />
              </div>
              <div>
                <label className="block text-[11px] text-brand-muted mb-0.5">End Time</label>
                <input
                  id="event-form-end-time"
                  type="time"
                  required
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-brand-border bg-white text-brand-black text-xs font-mono"
                />
              </div>
            </div>
          </div>

          {/* Description */}
          <div>
            <label htmlFor="event-form-description" className="block font-semibold text-brand-black mb-1">
              Description <span className="text-brand-muted font-normal">(Optional)</span>
            </label>
            <textarea
              id="event-form-description"
              rows={3}
              placeholder="Outline event agenda, expected attendees, or security briefing notes..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-brand-border bg-white text-brand-black text-xs focus:outline-hidden focus:ring-2 focus:ring-brand-yellow focus:border-brand-yellow"
            />
          </div>

          {/* Live Summary Preview */}
          <div className="p-3 rounded-xl bg-neutral-900 text-white border border-neutral-800">
            <div className="text-[11px] font-semibold text-brand-yellow uppercase tracking-wider mb-1">
              Event Summary Preview
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div>
                <span className="text-neutral-400 block">Title</span>
                <span className="font-semibold truncate block">{title || '(Untitled Event)'}</span>
              </div>
              <div>
                <span className="text-neutral-400 block">Location</span>
                <span className="font-semibold truncate block">{location || '(Unspecified)'}</span>
              </div>
              <div className="col-span-2">
                <span className="text-neutral-400 block">Schedule</span>
                <span className="font-mono text-neutral-200">
                  {startDate} {startTime} &rarr; {endDate} {endTime}
                </span>
                {!isTimeOrderValid && (
                  <span className="text-rose-400 block text-[10px] mt-0.5">
                    &bull; Warning: End time must follow start time
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="pt-3 border-t border-brand-border flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2.5 rounded-xl text-xs font-semibold text-brand-black hover:bg-neutral-100 transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              id="submit-event-btn"
              type="submit"
              disabled={loading || !title.trim() || !location.trim()}
              className="px-5 py-2.5 rounded-xl text-xs font-bold bg-brand-yellow hover:bg-brand-yellow-hover text-brand-black transition shadow-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <RefreshCw className="w-4 h-4 animate-spin text-brand-black" />
              ) : initialEvent ? (
                <Save className="w-4 h-4 text-brand-black" />
              ) : (
                <Plus className="w-4 h-4 text-brand-black" />
              )}
              <span>{loading ? 'Saving Event...' : initialEvent ? 'Update Event' : 'Save as Draft'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
