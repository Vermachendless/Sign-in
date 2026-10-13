import { dbAdapter } from '../db/adapter.ts';
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
  public async createEvent(
    actor: SafeUser,
    input: CreateEventInput,
    ipAddress?: string,
    userAgent?: string
  ): Promise<{ success: boolean; event?: EventRecord; error?: string }> {
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

    const eventId = generateId();
    const now = new Date().toISOString();
    const description = input.description?.trim() || null;

    try {
      await dbAdapter.execute(
        `
        INSERT INTO events (
          id, title, description, location, start_at, end_at, status,
          created_by, approved_by, approved_at, rejection_reason,
          created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, NULL, NULL, $9, $10)
        `,
        [
          eventId,
          title,
          description,
          location,
          dateValidation.startIso,
          dateValidation.endIso,
          EventStatus.DRAFT,
          actor.id,
          now,
          now,
        ]
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

      const event = await this.getEventById(eventId, actor);
      return { success: true, event: event || undefined };
    } catch (err) {
      console.error('[EventService] createEvent error:', err);
      return { success: false, error: 'Database error creating event record.' };
    }
  }

  /**
   * Retrieves single event by ID with RBAC check and user detail joins
   */
  public async getEventById(eventId: string, actor: SafeUser): Promise<EventRecord | null> {
    const row = await dbAdapter.queryOne<any>(
      `
      SELECT 
        e.id,
        e.title,
        e.description,
        e.location,
        e.start_at as "startAt",
        e.end_at as "endAt",
        e.status,
        e.created_by as "createdBy",
        e.approved_by as "approvedBy",
        e.approved_at as "approvedAt",
        e.rejection_reason as "rejectionReason",
        e.created_at as "createdAt",
        e.updated_at as "updatedAt",
        (u.first_name || ' ' || u.last_name) as "creatorName",
        u.email as "creatorEmail",
        u.role as "creatorRole",
        (au.first_name || ' ' || au.last_name) as "approverName",
        au.email as "approverEmail"
      FROM events e
      LEFT JOIN users u ON e.created_by = u.id
      LEFT JOIN users au ON e.approved_by = au.id
      WHERE e.id = $1
      `,
      [eventId]
    );

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
  public async listEvents(
    actor: SafeUser,
    filters?: {
      status?: string;
      search?: string;
      page?: number;
      limit?: number;
    }
  ): Promise<{ events: EventRecord[]; total: number; page: number; limit: number; totalPages: number }> {
    const page = Math.max(1, filters?.page || 1);
    const limit = Math.min(100, Math.max(1, filters?.limit || 20));
    const offset = (page - 1) * limit;

    let whereClause = '1=1';
    const params: (string | number | null)[] = [];
    let pIdx = 1;

    // Role-based visibility constraint
    if (actor.role === UserRole.STAFF) {
      whereClause += ` AND e.status = $${pIdx++}`;
      params.push(EventStatus.APPROVED);
    } else if (actor.role === UserRole.ADMIN) {
      whereClause += ` AND (e.created_by = $${pIdx++} OR e.status != $${pIdx++})`;
      params.push(actor.id, EventStatus.DRAFT);
    }

    // Optional status filter
    if (filters?.status && filters.status !== 'ALL') {
      whereClause += ` AND e.status = $${pIdx++}`;
      params.push(filters.status.toUpperCase().trim());
    }

    // Optional search term
    if (filters?.search && filters.search.trim()) {
      const term = `%${filters.search.trim()}%`;
      whereClause += ` AND (e.title LIKE $${pIdx++} OR e.location LIKE $${pIdx++} OR e.description LIKE $${pIdx++})`;
      params.push(term, term, term);
    }

    const countRow = await dbAdapter.queryOne<{ count: number }>(
      `
      SELECT COUNT(*) as count
      FROM events e
      WHERE ${whereClause}
      `,
      [...params]
    );

    const total = countRow ? Number(countRow.count) : 0;
    const totalPages = Math.ceil(total / limit) || 1;

    const queryParams = [...params, limit, offset];
    const limitPlaceholder = `$${pIdx++}`;
    const offsetPlaceholder = `$${pIdx++}`;

    const rows = await dbAdapter.query<any>(
      `
      SELECT 
        e.id,
        e.title,
        e.description,
        e.location,
        e.start_at as "startAt",
        e.end_at as "endAt",
        e.status,
        e.created_by as "createdBy",
        e.approved_by as "approvedBy",
        e.approved_at as "approvedAt",
        e.rejection_reason as "rejectionReason",
        e.created_at as "createdAt",
        e.updated_at as "updatedAt",
        (u.first_name || ' ' || u.last_name) as "creatorName",
        u.email as "creatorEmail",
        u.role as "creatorRole",
        (au.first_name || ' ' || au.last_name) as "approverName",
        au.email as "approverEmail"
      FROM events e
      LEFT JOIN users u ON e.created_by = u.id
      LEFT JOIN users au ON e.approved_by = au.id
      WHERE ${whereClause}
      ORDER BY e.start_at DESC
      LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}
      `,
      queryParams
    );

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
  public async updateEvent(
    eventId: string,
    actor: SafeUser,
    input: UpdateEventInput,
    ipAddress?: string,
    userAgent?: string
  ): Promise<{ success: boolean; event?: EventRecord; error?: string }> {
    const existing = await dbAdapter.queryOne<{
      id: string;
      title: string;
      description: string | null;
      location: string;
      start_at: string;
      end_at: string;
      status: EventStatus;
      created_by: string;
    }>('SELECT * FROM events WHERE id = $1', [eventId]);

    if (!existing) {
      return { success: false, error: 'Event not found.' };
    }

    // Role & lifecycle edit rules:
    if (existing.status === EventStatus.PENDING_APPROVAL) {
      return {
        success: false,
        error: 'Event is awaiting Super Admin approval and cannot be modified. Withdraw the event to draft to make changes.',
      };
    }

    if (existing.status === EventStatus.APPROVED && actor.role !== UserRole.SUPER_ADMIN) {
      return {
        success: false,
        error: 'Approved events cannot be modified by Admin.',
      };
    }

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
      await dbAdapter.execute(
        `
        UPDATE events
        SET title = $1, description = $2, location = $3, start_at = $4, end_at = $5, updated_at = $6
        WHERE id = $7
        `,
        [
          title,
          description,
          location,
          dateValidation.startIso,
          dateValidation.endIso,
          now,
          eventId,
        ]
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

      const updated = await this.getEventById(eventId, actor);
      return { success: true, event: updated || undefined };
    } catch (err) {
      console.error('[EventService] updateEvent error:', err);
      return { success: false, error: 'Database error updating event.' };
    }
  }

  /**
   * Submit event for approval: DRAFT -> PENDING_APPROVAL
   */
  public async submitEvent(
    eventId: string,
    actor: SafeUser,
    ipAddress?: string,
    userAgent?: string
  ): Promise<{ success: boolean; event?: EventRecord; error?: string }> {
    if (actor.role === UserRole.STAFF) {
      return { success: false, error: 'Staff members cannot submit events.' };
    }

    const existing = await dbAdapter.queryOne<{
      id: string;
      title: string;
      status: EventStatus;
      created_by: string;
    }>('SELECT id, title, status, created_by FROM events WHERE id = $1', [eventId]);

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
    await dbAdapter.execute(
      `
      UPDATE events
      SET status = $1, updated_at = $2
      WHERE id = $3
      `,
      [EventStatus.PENDING_APPROVAL, now, eventId]
    );

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

    const updated = await this.getEventById(eventId, actor);
    return { success: true, event: updated || undefined };
  }

  /**
   * Withdraw submitted event: PENDING_APPROVAL -> DRAFT
   */
  public async withdrawEvent(
    eventId: string,
    actor: SafeUser,
    ipAddress?: string,
    userAgent?: string
  ): Promise<{ success: boolean; event?: EventRecord; error?: string }> {
    if (actor.role === UserRole.STAFF) {
      return { success: false, error: 'Staff members cannot withdraw events.' };
    }

    const existing = await dbAdapter.queryOne<{
      id: string;
      title: string;
      status: EventStatus;
      created_by: string;
    }>('SELECT id, title, status, created_by FROM events WHERE id = $1', [eventId]);

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
    await dbAdapter.execute(
      `
      UPDATE events
      SET status = $1, updated_at = $2
      WHERE id = $3
      `,
      [EventStatus.DRAFT, now, eventId]
    );

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

    const updated = await this.getEventById(eventId, actor);
    return { success: true, event: updated || undefined };
  }

  /**
   * Super Admin approves event: PENDING_APPROVAL -> APPROVED
   */
  public async approveEvent(
    eventId: string,
    actor: SafeUser,
    ipAddress?: string,
    userAgent?: string
  ): Promise<{ success: boolean; event?: EventRecord; error?: string }> {
    if (actor.role !== UserRole.SUPER_ADMIN) {
      return { success: false, error: 'Only Super Administrators are authorized to approve events.' };
    }

    const existing = await dbAdapter.queryOne<{
      id: string;
      title: string;
      status: EventStatus;
    }>('SELECT id, title, status FROM events WHERE id = $1', [eventId]);

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
    await dbAdapter.execute(
      `
      UPDATE events
      SET status = $1, approved_by = $2, approved_at = $3, rejection_reason = NULL, updated_at = $4
      WHERE id = $5
      `,
      [EventStatus.APPROVED, actor.id, now, now, eventId]
    );

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

    const updated = await this.getEventById(eventId, actor);
    return { success: true, event: updated || undefined };
  }

  /**
   * Super Admin rejects event: PENDING_APPROVAL -> REJECTED (requires reason)
   */
  public async rejectEvent(
    eventId: string,
    actor: SafeUser,
    reason: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<{ success: boolean; event?: EventRecord; error?: string }> {
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

    const existing = await dbAdapter.queryOne<{
      id: string;
      title: string;
      status: EventStatus;
    }>('SELECT id, title, status FROM events WHERE id = $1', [eventId]);

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
    await dbAdapter.execute(
      `
      UPDATE events
      SET status = $1, approved_by = $2, approved_at = $3, rejection_reason = $4, updated_at = $5
      WHERE id = $6
      `,
      [EventStatus.REJECTED, actor.id, now, trimmedReason, now, eventId]
    );

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

    const updated = await this.getEventById(eventId, actor);
    return { success: true, event: updated || undefined };
  }

  /**
   * Cancel event: DRAFT / PENDING_APPROVAL / APPROVED -> CANCELLED
   */
  public async cancelEvent(
    eventId: string,
    actor: SafeUser,
    ipAddress?: string,
    userAgent?: string
  ): Promise<{ success: boolean; event?: EventRecord; error?: string }> {
    if (actor.role === UserRole.STAFF) {
      return { success: false, error: 'Staff members cannot cancel events.' };
    }

    const existing = await dbAdapter.queryOne<{
      id: string;
      title: string;
      status: EventStatus;
      created_by: string;
    }>('SELECT id, title, status, created_by FROM events WHERE id = $1', [eventId]);

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
    await dbAdapter.execute(
      `
      UPDATE events
      SET status = $1, updated_at = $2
      WHERE id = $3
      `,
      [EventStatus.CANCELLED, now, eventId]
    );

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

    const updated = await this.getEventById(eventId, actor);
    return { success: true, event: updated || undefined };
  }
}

export const eventService = new EventService();
