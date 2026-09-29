import { getDatabase } from '../db/index.ts';
import { generateId } from '../utils/crypto.ts';
import { auditService } from './audit.service.ts';
import {
  EventRecord,
  EventStatus,
  CreateEventInput,
  UpdateEventInput,
  SafeUser,
  UserRole,
} from '../../src/types/index.ts';
import { COMPANY_TIMEZONE, formatDateInTimezone, formatTimeInTimezone } from '../utils/time.ts';

export class EventService {
  /**
   * Helper to format full date-time in the configured company timezone (Africa/Lagos)
   */
  public formatDateTime(isoString: string): string {
    try {
      const datePart = formatDateInTimezone(isoString, COMPANY_TIMEZONE);
      const timePart = formatTimeInTimezone(isoString, COMPANY_TIMEZONE);
      return `${datePart}, ${timePart}`;
    } catch {
      return isoString;
    }
  }

  /**
   * Validates event date-times
   */
  public validateEventDates(
    startAtStr: unknown,
    endAtStr: unknown
  ): { valid: boolean; error?: string; startIso?: string; endIso?: string } {
    if (!startAtStr || typeof startAtStr !== 'string' || !startAtStr.trim()) {
      return { valid: false, error: 'Start date and time is required.' };
    }
    if (!endAtStr || typeof endAtStr !== 'string' || !endAtStr.trim()) {
      return { valid: false, error: 'End date and time is required.' };
    }

    const startDate = new Date(startAtStr);
    const endDate = new Date(endAtStr);

    if (isNaN(startDate.getTime())) {
      return { valid: false, error: 'Start date/time is invalid or malformed.' };
    }
    if (isNaN(endDate.getTime())) {
      return { valid: false, error: 'End date/time is invalid or malformed.' };
    }

    const startYear = startDate.getFullYear();
    const endYear = endDate.getFullYear();
    if (startYear < 2000 || startYear > 2100 || endYear < 2000 || endYear > 2100) {
      return { valid: false, error: 'Event date year must be between 2000 and 2100.' };
    }

    if (endDate.getTime() <= startDate.getTime()) {
      return { valid: false, error: 'Event end time must be after the start time.' };
    }

    return {
      valid: true,
      startIso: startDate.toISOString(),
      endIso: endDate.toISOString(),
    };
  }

  /**
   * Create an event in DRAFT status
   */
  public createEvent(
    actor: SafeUser,
    input: CreateEventInput,
    ipAddress?: string,
    userAgent?: string
  ): { success: boolean; event?: EventRecord; error?: string } {
    if (actor.role === UserRole.STAFF) {
      return { success: false, error: 'Staff members are not authorized to create events.' };
    }

    const title = input.title?.trim();
    if (!title || title.length < 3) {
      return { success: false, error: 'Event title is required and must be at least 3 characters.' };
    }
    if (title.length > 200) {
      return { success: false, error: 'Event title must not exceed 200 characters.' };
    }

    const location = input.location?.trim();
    if (!location || location.length < 2) {
      return { success: false, error: 'Event location is required and must be at least 2 characters.' };
    }
    if (location.length > 200) {
      return { success: false, error: 'Event location must not exceed 200 characters.' };
    }

    const dateValidation = this.validateEventDates(input.startAt, input.endAt);
    if (!dateValidation.valid || !dateValidation.startIso || !dateValidation.endIso) {
      return { success: false, error: dateValidation.error || 'Invalid event schedule.' };
    }

    const db = getDatabase();
    const eventId = generateId();
    const now = new Date().toISOString();
    const description = input.description?.trim() || null;

    try {
      db.prepare(`
        INSERT INTO events (
          id, title, description, location, start_at, end_at, status,
          created_by, approved_by, approved_at, rejection_reason,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)
      `).run(
        eventId,
        title,
        description,
        location,
        dateValidation.startIso,
        dateValidation.endIso,
        EventStatus.DRAFT,
        actor.id,
        now,
        now
      );

      // Audit log event creation
      auditService.log({
        actorId: actor.id,
        action: 'EVENT_CREATED',
        ipAddress,
        userAgent,
        metadata: {
          eventId,
          title,
          status: EventStatus.DRAFT,
          location,
          startAt: dateValidation.startIso,
          endAt: dateValidation.endIso,
        },
      });

      const event = this.getEventById(eventId, actor);
      return { success: true, event: event || undefined };
    } catch (err) {
      console.error('[EventService] createEvent error:', err);
      return { success: false, error: 'Database error creating event record.' };
    }
  }

  /**
   * Retrieves single event by ID with RBAC check and user detail joins
   */
  public getEventById(eventId: string, actor: SafeUser): EventRecord | null {
    const db = getDatabase();

    const row = db.prepare(`
      SELECT 
        e.id,
        e.title,
        e.description,
        e.location,
        e.start_at as startAt,
        e.end_at as endAt,
        e.status,
        e.created_by as createdBy,
        e.approved_by as approvedBy,
        e.approved_at as approvedAt,
        e.rejection_reason as rejectionReason,
        e.created_at as createdAt,
        e.updated_at as updatedAt,
        (u.first_name || ' ' || u.last_name) as creatorName,
        u.email as creatorEmail,
        u.role as creatorRole,
        (au.first_name || ' ' || au.last_name) as approverName,
        au.email as approverEmail
      FROM events e
      LEFT JOIN users u ON e.created_by = u.id
      LEFT JOIN users au ON e.approved_by = au.id
      WHERE e.id = ?
    `).get(eventId) as unknown as (EventRecord & { startAt: string; endAt: string }) | undefined;

    if (!row) return null;

    // RBAC visibility enforcement
    if (actor.role === UserRole.STAFF) {
      // Staff can only view APPROVED events
      if (row.status !== EventStatus.APPROVED) {
        return null;
      }
    } else if (actor.role === UserRole.ADMIN) {
      // Admin can view their own events or any non-draft event
      if (row.createdBy !== actor.id && row.status === EventStatus.DRAFT) {
        return null;
      }
    }

    return {
      ...row,
      formattedStart: this.formatDateTime(row.startAt),
      formattedEnd: this.formatDateTime(row.endAt),
    };
  }

  /**
   * List events with role-based visibility, search, and status filters
   */
  public listEvents(
    actor: SafeUser,
    filters?: {
      status?: string;
      search?: string;
      page?: number;
      limit?: number;
    }
  ): { events: EventRecord[]; total: number; page: number; limit: number; totalPages: number } {
    const db = getDatabase();
    const page = Math.max(1, filters?.page || 1);
    const limit = Math.min(100, Math.max(1, filters?.limit || 20));
    const offset = (page - 1) * limit;

    let whereClause = '1=1';
    const params: (string | number | null)[] = [];

    // Role-based visibility constraint
    if (actor.role === UserRole.STAFF) {
      whereClause += ' AND e.status = ?';
      params.push(EventStatus.APPROVED);
    } else if (actor.role === UserRole.ADMIN) {
      // Admin can see their own draft events, or any event that has progressed beyond draft
      whereClause += ' AND (e.created_by = ? OR e.status != ?)';
      params.push(actor.id, EventStatus.DRAFT);
    }
    // Super Admin has unrestricted access to all events

    // Optional status filter
    if (filters?.status && filters.status !== 'ALL') {
      whereClause += ' AND e.status = ?';
      params.push(filters.status.toUpperCase().trim());
    }

    // Optional search term
    if (filters?.search && filters.search.trim()) {
      const term = `%${filters.search.trim()}%`;
      whereClause += ' AND (e.title LIKE ? OR e.location LIKE ? OR e.description LIKE ?)';
      params.push(term, term, term);
    }

    const countRow = db.prepare(`
      SELECT COUNT(*) as count
      FROM events e
      WHERE ${whereClause}
    `).get(...params) as { count: number } | undefined;

    const total = countRow ? Number(countRow.count) : 0;
    const totalPages = Math.ceil(total / limit) || 1;

    const queryParams = [...params, limit, offset];
    const rows = db.prepare(`
      SELECT 
        e.id,
        e.title,
        e.description,
        e.location,
        e.start_at as startAt,
        e.end_at as endAt,
        e.status,
        e.created_by as createdBy,
        e.approved_by as approvedBy,
        e.approved_at as approvedAt,
        e.rejection_reason as rejectionReason,
        e.created_at as createdAt,
        e.updated_at as updatedAt,
        (u.first_name || ' ' || u.last_name) as creatorName,
        u.email as creatorEmail,
        u.role as creatorRole,
        (au.first_name || ' ' || au.last_name) as approverName,
        au.email as approverEmail
      FROM events e
      LEFT JOIN users u ON e.created_by = u.id
      LEFT JOIN users au ON e.approved_by = au.id
      WHERE ${whereClause}
      ORDER BY e.start_at DESC
      LIMIT ? OFFSET ?
    `).all(...queryParams) as unknown as (EventRecord & { startAt: string; endAt: string })[];

    const formattedEvents = (rows || []).map((row) => ({
      ...row,
      formattedStart: this.formatDateTime(row.startAt),
      formattedEnd: this.formatDateTime(row.endAt),
    }));

    return {
      events: formattedEvents,
      total,
      page,
      limit,
      totalPages,
    };
  }

  /**
   * Update an event (respecting strict lifecycle state rules)
   */
  public updateEvent(
    eventId: string,
    actor: SafeUser,
    input: UpdateEventInput,
    ipAddress?: string,
    userAgent?: string
  ): { success: boolean; event?: EventRecord; error?: string } {
    const db = getDatabase();
    const existing = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId) as
      | {
          id: string;
          title: string;
          description: string | null;
          location: string;
          start_at: string;
          end_at: string;
          status: EventStatus;
          created_by: string;
        }
      | undefined;

    if (!existing) {
      return { success: false, error: 'Event not found.' };
    }

    // Role & lifecycle edit rules:
    // PENDING_APPROVAL cannot be edited directly (must withdraw to DRAFT first)
    if (existing.status === EventStatus.PENDING_APPROVAL) {
      return {
        success: false,
        error: 'Event is awaiting Super Admin approval and cannot be modified. Withdraw the event to draft to make changes.',
      };
    }

    // APPROVED events cannot be edited by Admin
    if (existing.status === EventStatus.APPROVED && actor.role !== UserRole.SUPER_ADMIN) {
      return {
        success: false,
        error: 'Approved events cannot be modified by Admin.',
      };
    }

    // Terminal statuses cannot be edited
    if (
      existing.status === EventStatus.REJECTED ||
      existing.status === EventStatus.CANCELLED ||
      existing.status === EventStatus.COMPLETED
    ) {
      return {
        success: false,
        error: `Cannot edit an event in ${existing.status} status.`,
      };
    }

    // For DRAFT events, only the creator or a Super Admin can edit
    if (existing.status === EventStatus.DRAFT) {
      if (existing.created_by !== actor.id && actor.role !== UserRole.SUPER_ADMIN) {
        return { success: false, error: 'You are not authorized to edit this draft event.' };
      }
    }

    const title = input.title !== undefined ? input.title.trim() : existing.title;
    if (!title || title.length < 3) {
      return { success: false, error: 'Event title must be at least 3 characters.' };
    }
    if (title.length > 200) {
      return { success: false, error: 'Event title must not exceed 200 characters.' };
    }

    const location = input.location !== undefined ? input.location.trim() : existing.location;
    if (!location || location.length < 2) {
      return { success: false, error: 'Event location must be at least 2 characters.' };
    }
    if (location.length > 200) {
      return { success: false, error: 'Event location must not exceed 200 characters.' };
    }

    const startAt = input.startAt !== undefined ? input.startAt : existing.start_at;
    const endAt = input.endAt !== undefined ? input.endAt : existing.end_at;

    const dateValidation = this.validateEventDates(startAt, endAt);
    if (!dateValidation.valid || !dateValidation.startIso || !dateValidation.endIso) {
      return { success: false, error: dateValidation.error || 'Invalid event schedule.' };
    }

    const description = input.description !== undefined ? input.description?.trim() || null : existing.description;
    const now = new Date().toISOString();

    try {
      db.prepare(`
        UPDATE events
        SET title = ?, description = ?, location = ?, start_at = ?, end_at = ?, updated_at = ?
        WHERE id = ?
      `).run(
        title,
        description,
        location,
        dateValidation.startIso,
        dateValidation.endIso,
        now,
        eventId
      );

      auditService.log({
        actorId: actor.id,
        action: 'EVENT_UPDATED',
        ipAddress,
        userAgent,
        metadata: {
          eventId,
          title,
          status: existing.status,
          previousTitle: existing.title,
        },
      });

      const updated = this.getEventById(eventId, actor);
      return { success: true, event: updated || undefined };
    } catch (err) {
      console.error('[EventService] updateEvent error:', err);
      return { success: false, error: 'Database error updating event.' };
    }
  }

  /**
   * Submit event for approval: DRAFT -> PENDING_APPROVAL
   */
  public submitEvent(
    eventId: string,
    actor: SafeUser,
    ipAddress?: string,
    userAgent?: string
  ): { success: boolean; event?: EventRecord; error?: string } {
    if (actor.role === UserRole.STAFF) {
      return { success: false, error: 'Staff members cannot submit events.' };
    }

    const db = getDatabase();
    const existing = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId) as
      | {
          id: string;
          title: string;
          status: EventStatus;
          created_by: string;
        }
      | undefined;

    if (!existing) {
      return { success: false, error: 'Event not found.' };
    }

    if (existing.created_by !== actor.id && actor.role !== UserRole.SUPER_ADMIN) {
      return { success: false, error: 'Only the creator or a Super Admin can submit this event for approval.' };
    }

    if (existing.status !== EventStatus.DRAFT) {
      return {
        success: false,
        error: `Cannot submit event with status ${existing.status}. Only DRAFT events can be submitted.`,
      };
    }

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE events
      SET status = ?, updated_at = ?
      WHERE id = ?
    `).run(EventStatus.PENDING_APPROVAL, now, eventId);

    auditService.log({
      actorId: actor.id,
      action: 'EVENT_SUBMITTED_FOR_APPROVAL',
      ipAddress,
      userAgent,
      metadata: {
        eventId,
        title: existing.title,
        previousStatus: EventStatus.DRAFT,
        newStatus: EventStatus.PENDING_APPROVAL,
      },
    });

    const updated = this.getEventById(eventId, actor);
    return { success: true, event: updated || undefined };
  }

  /**
   * Withdraw submitted event: PENDING_APPROVAL -> DRAFT
   */
  public withdrawEvent(
    eventId: string,
    actor: SafeUser,
    ipAddress?: string,
    userAgent?: string
  ): { success: boolean; event?: EventRecord; error?: string } {
    if (actor.role === UserRole.STAFF) {
      return { success: false, error: 'Staff members cannot withdraw events.' };
    }

    const db = getDatabase();
    const existing = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId) as
      | {
          id: string;
          title: string;
          status: EventStatus;
          created_by: string;
        }
      | undefined;

    if (!existing) {
      return { success: false, error: 'Event not found.' };
    }

    if (existing.created_by !== actor.id && actor.role !== UserRole.SUPER_ADMIN) {
      return { success: false, error: 'Only the creator or a Super Admin can withdraw this event.' };
    }

    if (existing.status !== EventStatus.PENDING_APPROVAL) {
      return {
        success: false,
        error: `Cannot withdraw event with status ${existing.status}. Only PENDING_APPROVAL events can be withdrawn.`,
      };
    }

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE events
      SET status = ?, updated_at = ?
      WHERE id = ?
    `).run(EventStatus.DRAFT, now, eventId);

    auditService.log({
      actorId: actor.id,
      action: 'EVENT_WITHDRAWN_TO_DRAFT',
      ipAddress,
      userAgent,
      metadata: {
        eventId,
        title: existing.title,
        previousStatus: EventStatus.PENDING_APPROVAL,
        newStatus: EventStatus.DRAFT,
      },
    });

    const updated = this.getEventById(eventId, actor);
    return { success: true, event: updated || undefined };
  }

  /**
   * Super Admin approves event: PENDING_APPROVAL -> APPROVED
   */
  public approveEvent(
    eventId: string,
    actor: SafeUser,
    ipAddress?: string,
    userAgent?: string
  ): { success: boolean; event?: EventRecord; error?: string } {
    if (actor.role !== UserRole.SUPER_ADMIN) {
      return { success: false, error: 'Only Super Administrators are authorized to approve events.' };
    }

    const db = getDatabase();
    const existing = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId) as
      | {
          id: string;
          title: string;
          status: EventStatus;
        }
      | undefined;

    if (!existing) {
      return { success: false, error: 'Event not found.' };
    }

    if (existing.status !== EventStatus.PENDING_APPROVAL) {
      return {
        success: false,
        error: `Cannot approve event with status ${existing.status}. Only events in PENDING_APPROVAL status can be approved.`,
      };
    }

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE events
      SET status = ?, approved_by = ?, approved_at = ?, rejection_reason = NULL, updated_at = ?
      WHERE id = ?
    `).run(EventStatus.APPROVED, actor.id, now, now, eventId);

    auditService.log({
      actorId: actor.id,
      action: 'EVENT_APPROVED',
      ipAddress,
      userAgent,
      metadata: {
        eventId,
        title: existing.title,
        previousStatus: EventStatus.PENDING_APPROVAL,
        newStatus: EventStatus.APPROVED,
        approvedBy: actor.id,
        approvedAt: now,
      },
    });

    const updated = this.getEventById(eventId, actor);
    return { success: true, event: updated || undefined };
  }

  /**
   * Super Admin rejects event: PENDING_APPROVAL -> REJECTED (requires reason)
   */
  public rejectEvent(
    eventId: string,
    actor: SafeUser,
    reason: string,
    ipAddress?: string,
    userAgent?: string
  ): { success: boolean; event?: EventRecord; error?: string } {
    if (actor.role !== UserRole.SUPER_ADMIN) {
      return { success: false, error: 'Only Super Administrators are authorized to reject events.' };
    }

    const trimmedReason = reason?.trim();
    if (!trimmedReason || trimmedReason.length < 3) {
      return {
        success: false,
        error: 'A rejection reason is required and must be at least 3 characters long.',
      };
    }

    const db = getDatabase();
    const existing = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId) as
      | {
          id: string;
          title: string;
          status: EventStatus;
        }
      | undefined;

    if (!existing) {
      return { success: false, error: 'Event not found.' };
    }

    if (existing.status !== EventStatus.PENDING_APPROVAL) {
      return {
        success: false,
        error: `Cannot reject event with status ${existing.status}. Only events in PENDING_APPROVAL status can be rejected.`,
      };
    }

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE events
      SET status = ?, approved_by = ?, approved_at = ?, rejection_reason = ?, updated_at = ?
      WHERE id = ?
    `).run(EventStatus.REJECTED, actor.id, now, trimmedReason, now, eventId);

    auditService.log({
      actorId: actor.id,
      action: 'EVENT_REJECTED',
      ipAddress,
      userAgent,
      metadata: {
        eventId,
        title: existing.title,
        previousStatus: EventStatus.PENDING_APPROVAL,
        newStatus: EventStatus.REJECTED,
        rejectedBy: actor.id,
        rejectedAt: now,
        rejectionReason: trimmedReason,
      },
    });

    const updated = this.getEventById(eventId, actor);
    return { success: true, event: updated || undefined };
  }

  /**
   * Cancel event: DRAFT / PENDING_APPROVAL / APPROVED -> CANCELLED
   */
  public cancelEvent(
    eventId: string,
    actor: SafeUser,
    ipAddress?: string,
    userAgent?: string
  ): { success: boolean; event?: EventRecord; error?: string } {
    if (actor.role === UserRole.STAFF) {
      return { success: false, error: 'Staff members cannot cancel events.' };
    }

    const db = getDatabase();
    const existing = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId) as
      | {
          id: string;
          title: string;
          status: EventStatus;
          created_by: string;
        }
      | undefined;

    if (!existing) {
      return { success: false, error: 'Event not found.' };
    }

    if (existing.created_by !== actor.id && actor.role !== UserRole.SUPER_ADMIN) {
      return { success: false, error: 'Only the event creator or a Super Admin can cancel this event.' };
    }

    if (existing.status === EventStatus.COMPLETED) {
      return { success: false, error: 'Completed events cannot be cancelled.' };
    }

    if (existing.status === EventStatus.CANCELLED) {
      return { success: false, error: 'Event is already cancelled.' };
    }

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE events
      SET status = ?, updated_at = ?
      WHERE id = ?
    `).run(EventStatus.CANCELLED, now, eventId);

    auditService.log({
      actorId: actor.id,
      action: 'EVENT_CANCELLED',
      ipAddress,
      userAgent,
      metadata: {
        eventId,
        title: existing.title,
        previousStatus: existing.status,
        newStatus: EventStatus.CANCELLED,
      },
    });

    const updated = this.getEventById(eventId, actor);
    return { success: true, event: updated || undefined };
  }
}

export const eventService = new EventService();
