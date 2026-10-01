import { Router, Response } from 'express';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth.ts';
import { visitorService } from '../services/visitor.service.ts';
import { sendSuccess, sendError, ApiErrorCode } from '../utils/apiResponse.ts';
import { extractClientIp } from '../services/network.service.ts';

const router = Router();

// All visitor routes require authentication
router.use(requireAuth);

/**
 * GET /api/visitor-visits
 * Lists visitor invitations
 * STAFF requests are strictly and automatically scoped to actor.id.
 * ADMIN and SUPER_ADMIN can inspect all visitors across the organization.
 */
router.get('/', (req: AuthenticatedRequest, res: Response) => {
  try {
    const actor = req.user!;
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 20));
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const date = typeof req.query.date === 'string' ? req.query.date : undefined;
    const hostStaffId = typeof req.query.hostStaffId === 'string' ? req.query.hostStaffId : undefined;

    const result = visitorService.listVisits(actor, {
      search,
      status,
      hostStaffId,
      date,
      page,
      limit,
    });

    return sendSuccess(res, {
      visits: result.visits,
      total: result.total,
      page: result.page,
      limit: result.limit,
      summary: result.summary,
    });
  } catch (error) {
    console.error('[VisitorRoutes] listVisits error:', error);
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'Failed to retrieve visitor invitations.');
  }
});

/**
 * POST /api/visitor-visits
 * Creates a visitor invitation
 * For STAFF users, hostStaffId is always authoritatively set to authenticatedUser.id
 */
router.post('/', (req: AuthenticatedRequest, res: Response) => {
  try {
    const actor = req.user!;
    const {
      visitorFullName,
      visitorPhone,
      visitorEmail,
      purpose,
      notes,
      visitDate,
      startTime,
      endTime,
      hostStaffId,
    } = req.body || {};

    const { ip: clientIp } = extractClientIp(req);
    const userAgent = req.headers['user-agent'] || 'Unknown';

    const result = visitorService.createVisit(
      actor,
      { visitorFullName, visitorPhone, visitorEmail, purpose, notes, visitDate, startTime, endTime },
      hostStaffId,
      clientIp,
      userAgent
    );

    if (!result.success || !result.visit) {
      const code = result.status === 409 ? ApiErrorCode.ALREADY_EXISTS : ApiErrorCode.VALIDATION_ERROR;
      return sendError(res, result.status || 400, code, result.error || 'Failed to create visitor invitation.');
    }

    return sendSuccess(res, result.visit, 201);
  } catch (error) {
    console.error('[VisitorRoutes] createVisit error:', error);
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'Internal error creating visitor invitation.');
  }
});

/**
 * GET /api/visitor-visits/:id
 * Retrieves single visitor invitation with cross-user authorization enforcement
 */
router.get('/:id', (req: AuthenticatedRequest, res: Response) => {
  try {
    const actor = req.user!;
    const { id } = req.params;

    if (!id) {
      return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, 'Visit ID parameter is required.');
    }

    const result = visitorService.getVisitById(id, actor);
    if (!result.success || !result.visit) {
      const code = result.status === 403 ? ApiErrorCode.FORBIDDEN : ApiErrorCode.NOT_FOUND;
      return sendError(res, result.status || 404, code, result.error || 'Visitor invitation not found.');
    }

    return sendSuccess(res, result.visit);
  } catch (error) {
    console.error('[VisitorRoutes] getVisitById error:', error);
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'Internal error retrieving visitor invitation.');
  }
});

/**
 * PATCH /api/visitor-visits/:id
 * Updates visitor invitation details with cross-user authorization enforcement
 */
router.patch('/:id', (req: AuthenticatedRequest, res: Response) => {
  try {
    const actor = req.user!;
    const { id } = req.params;
    const {
      visitorFullName,
      visitorPhone,
      visitorEmail,
      purpose,
      notes,
      visitDate,
      startTime,
      endTime,
    } = req.body || {};

    if (!id) {
      return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, 'Visit ID parameter is required.');
    }

    const { ip: clientIp } = extractClientIp(req);
    const userAgent = req.headers['user-agent'] || 'Unknown';

    const result = visitorService.updateVisit(
      id,
      actor,
      { visitorFullName, visitorPhone, visitorEmail, purpose, notes, visitDate, startTime, endTime },
      clientIp,
      userAgent
    );

    if (!result.success || !result.visit) {
      const code = result.status === 403 ? ApiErrorCode.FORBIDDEN : ApiErrorCode.VALIDATION_ERROR;
      return sendError(res, result.status || 400, code, result.error || 'Failed to update visitor invitation.');
    }

    return sendSuccess(res, result.visit);
  } catch (error) {
    console.error('[VisitorRoutes] updateVisit error:', error);
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'Internal error updating visitor invitation.');
  }
});

/**
 * POST /api/visitor-visits/:id/access-pass
 * Generates individual VISITOR access pass using Phase 6C infrastructure
 */
router.post('/:id/access-pass', (req: AuthenticatedRequest, res: Response) => {
  try {
    const actor = req.user!;
    const { id } = req.params;

    if (!id) {
      return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, 'Visit ID parameter is required.');
    }

    const { ip: clientIp } = extractClientIp(req);
    const userAgent = req.headers['user-agent'] || 'Unknown';

    const result = visitorService.generateVisitorAccessPass(id, actor, clientIp, userAgent);

    if (!result.success || !result.visit || !result.pass) {
      const code = result.status === 403 ? ApiErrorCode.FORBIDDEN : ApiErrorCode.VALIDATION_ERROR;
      return sendError(res, result.status || 400, code, result.error || 'Failed to generate visitor access pass.');
    }

    return sendSuccess(res, { visit: result.visit, pass: result.pass }, 201);
  } catch (error) {
    console.error('[VisitorRoutes] generateVisitorAccessPass error:', error);
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'Internal error generating visitor access pass.');
  }
});

/**
 * POST /api/visitor-visits/:id/revoke-access
 * Revokes an active visitor access pass with cross-user authorization enforcement
 */
router.post('/:id/revoke-access', (req: AuthenticatedRequest, res: Response) => {
  try {
    const actor = req.user!;
    const { id } = req.params;
    const { reason } = req.body || {};

    if (!id) {
      return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, 'Visit ID parameter is required.');
    }

    const { ip: clientIp } = extractClientIp(req);
    const userAgent = req.headers['user-agent'] || 'Unknown';

    const result = visitorService.revokeVisitorAccess(id, actor, reason, clientIp, userAgent);

    if (!result.success || !result.visit) {
      const code = result.status === 403 ? ApiErrorCode.FORBIDDEN : ApiErrorCode.VALIDATION_ERROR;
      return sendError(res, result.status || 400, code, result.error || 'Failed to revoke visitor access.');
    }

    return sendSuccess(res, result.visit);
  } catch (error) {
    console.error('[VisitorRoutes] revokeVisitorAccess error:', error);
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'Internal error revoking visitor access.');
  }
});

/**
 * POST /api/visitor-visits/:id/cancel
 * Cancels a visitor invitation and revokes active pass with cross-user authorization enforcement
 */
router.post('/:id/cancel', (req: AuthenticatedRequest, res: Response) => {
  try {
    const actor = req.user!;
    const { id } = req.params;
    const { reason } = req.body || {};

    if (!id) {
      return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, 'Visit ID parameter is required.');
    }

    const { ip: clientIp } = extractClientIp(req);
    const userAgent = req.headers['user-agent'] || 'Unknown';

    const result = visitorService.cancelVisit(id, actor, reason, clientIp, userAgent);

    if (!result.success || !result.visit) {
      const code = result.status === 403 ? ApiErrorCode.FORBIDDEN : ApiErrorCode.VALIDATION_ERROR;
      return sendError(res, result.status || 400, code, result.error || 'Failed to cancel visitor invitation.');
    }

    return sendSuccess(res, result.visit);
  } catch (error) {
    console.error('[VisitorRoutes] cancelVisit error:', error);
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'Internal error cancelling visitor invitation.');
  }
});

export default router;
