import { Router, Response } from 'express';
import {
  requireAuth,
  requireAdmin,
  requireSuperAdmin,
  AuthenticatedRequest,
} from '../middleware/auth.ts';
import { eventService } from '../services/event.service.ts';
import { accessService } from '../services/access.service.ts';
import { inviteeService } from '../services/invitee.service.ts';
import { sendSuccess, sendError, ApiErrorCode } from '../utils/apiResponse.ts';
import { extractClientIp } from '../services/network.service.ts';

const router = Router();

// All event routes require authentication
router.use(requireAuth);

/**
 * GET /api/events
 * Lists events with server-side role-based access filtering
 */
router.get('/', (req: AuthenticatedRequest, res: Response) => {
  try {
    const actor = req.user!;
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 20));
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;

    const result = eventService.listEvents(actor, {
      status,
      search,
      page,
      limit,
    });

    return sendSuccess(res, result);
  } catch (error) {
    console.error('[EventRoutes] listEvents error:', error);
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'Failed to retrieve event list.');
  }
});

/**
 * GET /api/events/:id
 * Retrieves single event details with creator and approver details
 */
router.get('/:id', (req: AuthenticatedRequest, res: Response) => {
  try {
    const actor = req.user!;
    const { id } = req.params;

    if (!id) {
      return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, 'Event ID parameter is required.');
    }

    const event = eventService.getEventById(id, actor);
    if (!event) {
      return sendError(res, 404, ApiErrorCode.NOT_FOUND, 'Event not found or access denied.');
    }

    return sendSuccess(res, event);
  } catch (error) {
    console.error('[EventRoutes] getEvent error:', error);
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'Failed to retrieve event details.');
  }
});

/**
 * POST /api/events
 * Creates a new event in DRAFT status (Requires ADMIN or SUPER_ADMIN)
 */
router.post('/', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  try {
    const actor = req.user!;
    const { title, description, location, startAt, endAt } = req.body || {};

    const { ip: clientIp } = extractClientIp(req);
    const userAgent = req.headers['user-agent'] || 'Unknown';

    const result = eventService.createEvent(
      actor,
      { title, description, location, startAt, endAt },
      clientIp,
      userAgent
    );

    if (!result.success || !result.event) {
      return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, result.error || 'Failed to create event.');
    }

    return sendSuccess(res, result.event, 201);
  } catch (error) {
    console.error('[EventRoutes] createEvent error:', error);
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'Internal error creating event.');
  }
});

/**
 * PATCH /api/events/:id
 * Updates an event (Requires ADMIN or SUPER_ADMIN)
 */
router.patch('/:id', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  try {
    const actor = req.user!;
    const { id } = req.params;
    const { title, description, location, startAt, endAt } = req.body || {};

    if (!id) {
      return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, 'Event ID parameter is required.');
    }

    const { ip: clientIp } = extractClientIp(req);
    const userAgent = req.headers['user-agent'] || 'Unknown';

    const result = eventService.updateEvent(
      id,
      actor,
      { title, description, location, startAt, endAt },
      clientIp,
      userAgent
    );

    if (!result.success || !result.event) {
      return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, result.error || 'Failed to update event.');
    }

    return sendSuccess(res, result.event);
  } catch (error) {
    console.error('[EventRoutes] updateEvent error:', error);
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'Internal error updating event.');
  }
});

/**
 * POST /api/events/:id/submit
 * Submits draft event for Super Admin approval (Requires ADMIN or SUPER_ADMIN)
 */
router.post('/:id/submit', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  try {
    const actor = req.user!;
    const { id } = req.params;

    if (!id) {
      return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, 'Event ID parameter is required.');
    }

    const { ip: clientIp } = extractClientIp(req);
    const userAgent = req.headers['user-agent'] || 'Unknown';

    const result = eventService.submitEvent(id, actor, clientIp, userAgent);

    if (!result.success || !result.event) {
      return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, result.error || 'Failed to submit event for approval.');
    }

    return sendSuccess(res, result.event);
  } catch (error) {
    console.error('[EventRoutes] submitEvent error:', error);
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'Internal error submitting event.');
  }
});

/**
 * POST /api/events/:id/withdraw
 * Withdraws a submitted event back to draft (Requires ADMIN or SUPER_ADMIN)
 */
router.post('/:id/withdraw', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  try {
    const actor = req.user!;
    const { id } = req.params;

    if (!id) {
      return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, 'Event ID parameter is required.');
    }

    const { ip: clientIp } = extractClientIp(req);
    const userAgent = req.headers['user-agent'] || 'Unknown';

    const result = eventService.withdrawEvent(id, actor, clientIp, userAgent);

    if (!result.success || !result.event) {
      return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, result.error || 'Failed to withdraw event.');
    }

    return sendSuccess(res, result.event);
  } catch (error) {
    console.error('[EventRoutes] withdrawEvent error:', error);
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'Internal error withdrawing event.');
  }
});

/**
 * POST /api/events/:id/approve
 * Approves a pending event (Strictly SUPER_ADMIN only)
 */
router.post('/:id/approve', requireSuperAdmin, (req: AuthenticatedRequest, res: Response) => {
  try {
    const actor = req.user!;
    const { id } = req.params;

    if (!id) {
      return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, 'Event ID parameter is required.');
    }

    const { ip: clientIp } = extractClientIp(req);
    const userAgent = req.headers['user-agent'] || 'Unknown';

    const result = eventService.approveEvent(id, actor, clientIp, userAgent);

    if (!result.success || !result.event) {
      return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, result.error || 'Failed to approve event.');
    }

    return sendSuccess(res, result.event);
  } catch (error) {
    console.error('[EventRoutes] approveEvent error:', error);
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'Internal error approving event.');
  }
});

/**
 * POST /api/events/:id/reject
 * Rejects a pending event with mandatory reason (Strictly SUPER_ADMIN only)
 */
router.post('/:id/reject', requireSuperAdmin, (req: AuthenticatedRequest, res: Response) => {
  try {
    const actor = req.user!;
    const { id } = req.params;
    const { reason } = req.body || {};

    if (!id) {
      return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, 'Event ID parameter is required.');
    }

    if (!reason || typeof reason !== 'string' || !reason.trim()) {
      return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, 'A valid rejection reason string is required.');
    }

    const { ip: clientIp } = extractClientIp(req);
    const userAgent = req.headers['user-agent'] || 'Unknown';

    const result = eventService.rejectEvent(id, actor, reason, clientIp, userAgent);

    if (!result.success || !result.event) {
      return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, result.error || 'Failed to reject event.');
    }

    return sendSuccess(res, result.event);
  } catch (error) {
    console.error('[EventRoutes] rejectEvent error:', error);
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'Internal error rejecting event.');
  }
});

/**
 * POST /api/events/:id/cancel
 * Cancels an event (Creator Admin or SUPER_ADMIN)
 */
router.post('/:id/cancel', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  try {
    const actor = req.user!;
    const { id } = req.params;

    if (!id) {
      return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, 'Event ID parameter is required.');
    }

    const { ip: clientIp } = extractClientIp(req);
    const userAgent = req.headers['user-agent'] || 'Unknown';

    const result = eventService.cancelEvent(id, actor, clientIp, userAgent);

    if (!result.success || !result.event) {
      return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, result.error || 'Failed to cancel event.');
    }

    return sendSuccess(res, result.event);
  } catch (error) {
    console.error('[EventRoutes] cancelEvent error:', error);
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'Internal error cancelling event.');
  }
});

/**
 * POST /api/events/:id/access-passes
 * Generates an event access pass for an APPROVED event (ADMIN and SUPER_ADMIN only)
 */
router.post('/:id/access-passes', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  try {
    const actor = req.user!;
    const { id } = req.params;
    const { maxUses, validFrom, validUntil } = req.body || {};

    if (!id) {
      return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, 'Event ID parameter is required.');
    }

    const { ip: clientIp } = extractClientIp(req);
    const userAgent = req.headers['user-agent'] || 'Unknown';

    const result = accessService.createEventAccessPass(
      actor,
      id,
      { maxUses, validFrom, validUntil },
      clientIp,
      userAgent
    );

    if (!result.success || !result.pass) {
      return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, result.error || 'Failed to create access pass.');
    }

    return sendSuccess(res, result.pass, 201);
  } catch (error) {
    console.error('[EventRoutes] createEventAccessPass error:', error);
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'Internal error generating event access pass.');
  }
});

/**
 * GET /api/events/:id/access-passes
 * Lists all generated access passes for an event (ADMIN and SUPER_ADMIN only)
 */
router.get('/:id/access-passes', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  try {
    const actor = req.user!;
    const { id } = req.params;

    if (!id) {
      return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, 'Event ID parameter is required.');
    }

    const result = accessService.listEventAccessPasses(id, actor);
    return sendSuccess(res, result);
  } catch (error) {
    console.error('[EventRoutes] listEventAccessPasses error:', error);
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'Internal error listing event access passes.');
  }
});

/**
 * Phase 6D — Event Invitees & Individual Event Access Routes
 */

/**
 * GET /api/events/:eventId/invitees
 * Lists invitees for an event with search, status filtering, and summary metrics (ADMIN and SUPER_ADMIN only)
 */
router.get('/:eventId/invitees', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  try {
    const actor = req.user!;
    const { eventId } = req.params;
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 20));
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;

    if (!eventId) {
      return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, 'Event ID parameter is required.');
    }

    const result = inviteeService.listInvitees(eventId, actor, { search, status, page, limit });
    if (!result.success) {
      return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, result.error || 'Failed to list invitees.');
    }

    return sendSuccess(res, {
      invitees: result.invitees,
      total: result.total,
      page: result.page,
      limit: result.limit,
      summary: result.summary,
    });
  } catch (error) {
    console.error('[EventRoutes] listInvitees error:', error);
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'Internal error retrieving event invitees.');
  }
});

/**
 * POST /api/events/:eventId/invitees
 * Adds an invitee to an APPROVED event (ADMIN and SUPER_ADMIN only)
 */
router.post('/:eventId/invitees', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  try {
    const actor = req.user!;
    const { eventId } = req.params;
    const { fullName, phone, email, organization, notes } = req.body || {};

    if (!eventId) {
      return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, 'Event ID parameter is required.');
    }

    const { ip: clientIp } = extractClientIp(req);
    const userAgent = req.headers['user-agent'] || 'Unknown';

    const result = inviteeService.createInvitee(
      eventId,
      actor,
      { fullName, phone, email, organization, notes },
      clientIp,
      userAgent
    );

    if (!result.success || !result.invitee) {
      const code = result.status === 409 ? ApiErrorCode.ALREADY_EXISTS : ApiErrorCode.VALIDATION_ERROR;
      return sendError(res, result.status || 400, code, result.error || 'Failed to create invitee.');
    }

    return sendSuccess(res, result.invitee, 201);
  } catch (error) {
    console.error('[EventRoutes] createInvitee error:', error);
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'Internal error creating invitee.');
  }
});

/**
 * GET /api/events/:eventId/invitees/:inviteeId
 * Retrieves single invitee by ID ensuring cross-event protection (ADMIN and SUPER_ADMIN only)
 */
router.get('/:eventId/invitees/:inviteeId', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  try {
    const actor = req.user!;
    const { eventId, inviteeId } = req.params;

    if (!eventId || !inviteeId) {
      return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, 'Event ID and Invitee ID parameters are required.');
    }

    const result = inviteeService.getInviteeById(eventId, inviteeId, actor);
    if (!result.success || !result.invitee) {
      const code = result.status === 403 ? ApiErrorCode.FORBIDDEN : ApiErrorCode.NOT_FOUND;
      return sendError(res, result.status || 404, code, result.error || 'Invitee not found.');
    }

    return sendSuccess(res, result.invitee);
  } catch (error) {
    console.error('[EventRoutes] getInviteeById error:', error);
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'Internal error retrieving invitee.');
  }
});

/**
 * PATCH /api/events/:eventId/invitees/:inviteeId
 * Updates invitee info (ADMIN and SUPER_ADMIN only)
 */
router.patch('/:eventId/invitees/:inviteeId', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  try {
    const actor = req.user!;
    const { eventId, inviteeId } = req.params;
    const { fullName, phone, email, organization, notes } = req.body || {};

    if (!eventId || !inviteeId) {
      return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, 'Event ID and Invitee ID parameters are required.');
    }

    const { ip: clientIp } = extractClientIp(req);
    const userAgent = req.headers['user-agent'] || 'Unknown';

    const result = inviteeService.updateInvitee(
      eventId,
      inviteeId,
      actor,
      { fullName, phone, email, organization, notes },
      clientIp,
      userAgent
    );

    if (!result.success || !result.invitee) {
      const code = result.status === 409 ? ApiErrorCode.ALREADY_EXISTS : ApiErrorCode.VALIDATION_ERROR;
      return sendError(res, result.status || 400, code, result.error || 'Failed to update invitee.');
    }

    return sendSuccess(res, result.invitee);
  } catch (error) {
    console.error('[EventRoutes] updateInvitee error:', error);
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'Internal error updating invitee.');
  }
});

/**
 * POST /api/events/:eventId/invitees/:inviteeId/access-pass
 * Generates individual EVENT access pass for an invitee (ADMIN and SUPER_ADMIN only)
 */
router.post('/:eventId/invitees/:inviteeId/access-pass', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  try {
    const actor = req.user!;
    const { eventId, inviteeId } = req.params;

    if (!eventId || !inviteeId) {
      return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, 'Event ID and Invitee ID parameters are required.');
    }

    const { ip: clientIp } = extractClientIp(req);
    const userAgent = req.headers['user-agent'] || 'Unknown';

    const result = inviteeService.generateInviteeAccessPass(
      eventId,
      inviteeId,
      actor,
      clientIp,
      userAgent
    );

    if (!result.success || !result.invitee || !result.pass) {
      return sendError(res, result.status || 400, ApiErrorCode.VALIDATION_ERROR, result.error || 'Failed to generate invitee access pass.');
    }

    return sendSuccess(res, { invitee: result.invitee, pass: result.pass }, 201);
  } catch (error) {
    console.error('[EventRoutes] generateInviteeAccessPass error:', error);
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'Internal error generating invitee access pass.');
  }
});

/**
 * POST /api/events/:eventId/invitees/:inviteeId/revoke-access
 * Revokes an invitee's active access pass (ADMIN and SUPER_ADMIN only)
 */
router.post('/:eventId/invitees/:inviteeId/revoke-access', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  try {
    const actor = req.user!;
    const { eventId, inviteeId } = req.params;
    const { reason } = req.body || {};

    if (!eventId || !inviteeId) {
      return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, 'Event ID and Invitee ID parameters are required.');
    }

    const { ip: clientIp } = extractClientIp(req);
    const userAgent = req.headers['user-agent'] || 'Unknown';

    const result = inviteeService.revokeInviteeAccess(
      eventId,
      inviteeId,
      actor,
      reason,
      clientIp,
      userAgent
    );

    if (!result.success || !result.invitee) {
      return sendError(res, result.status || 400, ApiErrorCode.VALIDATION_ERROR, result.error || 'Failed to revoke invitee access.');
    }

    return sendSuccess(res, result.invitee);
  } catch (error) {
    console.error('[EventRoutes] revokeInviteeAccess error:', error);
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'Internal error revoking invitee access.');
  }
});

/**
 * POST /api/events/:eventId/invitees/:inviteeId/cancel
 * Cancels an invitee and revokes any active pass (ADMIN and SUPER_ADMIN only)
 */
router.post('/:eventId/invitees/:inviteeId/cancel', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  try {
    const actor = req.user!;
    const { eventId, inviteeId } = req.params;
    const { reason } = req.body || {};

    if (!eventId || !inviteeId) {
      return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, 'Event ID and Invitee ID parameters are required.');
    }

    const { ip: clientIp } = extractClientIp(req);
    const userAgent = req.headers['user-agent'] || 'Unknown';

    const result = inviteeService.cancelInvitee(
      eventId,
      inviteeId,
      actor,
      reason,
      clientIp,
      userAgent
    );

    if (!result.success || !result.invitee) {
      return sendError(res, result.status || 400, ApiErrorCode.VALIDATION_ERROR, result.error || 'Failed to cancel invitee.');
    }

    return sendSuccess(res, result.invitee);
  } catch (error) {
    console.error('[EventRoutes] cancelInvitee error:', error);
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'Internal error cancelling invitee.');
  }
});

export default router;
