import { Router, Response } from 'express';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth.ts';
import { receptionService } from '../services/reception.service.ts';
import { sendSuccess, sendError, ApiErrorCode } from '../utils/apiResponse.ts';
import { extractClientIp } from '../services/network.service.ts';
import { UserRole } from '../../src/types/index.ts';

const router = Router();

// All reception routes require authentication
router.use(requireAuth);

/**
 * Middleware: Enforce reception administrative capability (ADMIN or SUPER_ADMIN)
 * STAFF users must be blocked with 403 Forbidden.
 */
function requireReceptionAdmin(req: AuthenticatedRequest, res: Response, next: () => void) {
  if (!req.user || req.user.role === UserRole.STAFF) {
    return sendError(res, 403, ApiErrorCode.FORBIDDEN, 'Forbidden: Reception operations restricted to administrative staff.');
  }
  next();
}

router.use(requireReceptionAdmin);

/**
 * POST /api/reception/verify
 * Verifies access credential (code or QR token) without checking in or consuming uses
 */
router.post('/verify', (req: AuthenticatedRequest, res: Response) => {
  try {
    const actor = req.user!;
    const { accessCode, token } = req.body || {};
    const { ip: clientIp } = extractClientIp(req);
    const userAgent = req.headers['user-agent'] || 'Unknown';

    const result = receptionService.verifyCredential(
      actor,
      { accessCode, token },
      clientIp,
      userAgent
    );

    if (!result.success || !result.verification?.valid) {
      const statusCode = result.status || 400;
      return res.status(statusCode).json({
        success: false,
        valid: false,
        code: result.verification?.code || (result.status === 403 ? ApiErrorCode.FORBIDDEN : ApiErrorCode.VALIDATION_ERROR),
        message: result.error || result.verification?.message || 'Access verification failed.',
        data: result.verification,
      });
    }

    return sendSuccess(res, result.verification);
  } catch (error) {
    console.error('[ReceptionRoutes] verify error:', error);
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'Internal error verifying credential.');
  }
});

/**
 * POST /api/reception/check-in
 * Records physical arrival and transitions status to CHECKED_IN
 */
router.post('/check-in', (req: AuthenticatedRequest, res: Response) => {
  try {
    const actor = req.user!;
    const { accessPassId, accessCode, token } = req.body || {};
    const { ip: clientIp } = extractClientIp(req);
    const userAgent = req.headers['user-agent'] || 'Unknown';

    const result = receptionService.checkIn(
      actor,
      { accessPassId, accessCode, token },
      clientIp,
      userAgent
    );

    if (!result.success || !result.visit) {
      const code = result.status === 409
        ? ApiErrorCode.ALREADY_EXISTS
        : result.status === 403
        ? ApiErrorCode.FORBIDDEN
        : ApiErrorCode.VALIDATION_ERROR;
      return sendError(res, result.status || 400, code, result.error || 'Check-in failed.');
    }

    return sendSuccess(res, result.visit, 201);
  } catch (error) {
    console.error('[ReceptionRoutes] checkIn error:', error);
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'Internal error recording check-in.');
  }
});

/**
 * POST /api/reception/check-out
 * Records physical departure and transitions status to CHECKED_OUT
 */
router.post('/check-out', (req: AuthenticatedRequest, res: Response) => {
  try {
    const actor = req.user!;
    const { accessVisitId, accessPassId, accessCode } = req.body || {};
    const { ip: clientIp } = extractClientIp(req);
    const userAgent = req.headers['user-agent'] || 'Unknown';

    const result = receptionService.checkOut(
      actor,
      { accessVisitId, accessPassId, accessCode },
      clientIp,
      userAgent
    );

    if (!result.success || !result.visit) {
      const code = result.status === 404
        ? ApiErrorCode.NOT_FOUND
        : result.status === 403
        ? ApiErrorCode.FORBIDDEN
        : ApiErrorCode.VALIDATION_ERROR;
      return sendError(res, result.status || 400, code, result.error || 'Check-out failed.');
    }

    return sendSuccess(res, result.visit);
  } catch (error) {
    console.error('[ReceptionRoutes] checkOut error:', error);
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'Internal error recording check-out.');
  }
});

/**
 * GET /api/reception/active
 * Authoritative query for currently checked-in guests on premises
 */
router.get('/active', (req: AuthenticatedRequest, res: Response) => {
  try {
    const actor = req.user!;
    const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : undefined;

    const result = receptionService.listActive(actor, { search });

    if (!result.success) {
      return sendError(res, result.status || 400, ApiErrorCode.FORBIDDEN, result.error || 'Failed to retrieve active guests.');
    }

    return sendSuccess(res, {
      activeVisits: result.activeVisits,
      total: result.total,
    });
  } catch (error) {
    console.error('[ReceptionRoutes] listActive error:', error);
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'Internal error retrieving active guests.');
  }
});

/**
 * GET /api/reception/history
 * Historical reception access visits with pagination & search/filters
 */
router.get('/history', (req: AuthenticatedRequest, res: Response) => {
  try {
    const actor = req.user!;
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 20));
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const passType = typeof req.query.passType === 'string' ? req.query.passType : undefined;
    const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : undefined;
    const date = typeof req.query.date === 'string' ? req.query.date : undefined;
    const startDate = typeof req.query.startDate === 'string' ? req.query.startDate : undefined;
    const endDate = typeof req.query.endDate === 'string' ? req.query.endDate : undefined;

    const result = receptionService.listHistory(actor, {
      search,
      status,
      passType,
      date,
      startDate,
      endDate,
      page,
      limit,
    });

    if (!result.success) {
      return sendError(res, result.status || 400, ApiErrorCode.FORBIDDEN, result.error || 'Failed to retrieve access history.');
    }

    return sendSuccess(res, {
      visits: result.visits,
      total: result.total,
      page: result.page,
      limit: result.limit,
    });
  } catch (error) {
    console.error('[ReceptionRoutes] listHistory error:', error);
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'Internal error retrieving access history.');
  }
});

/**
 * GET /api/reception/summary
 * Summary metrics for reception dashboard
 */
router.get('/summary', (req: AuthenticatedRequest, res: Response) => {
  try {
    const actor = req.user!;
    const result = receptionService.getSummary(actor);

    if (!result.success) {
      return sendError(res, result.status || 400, ApiErrorCode.FORBIDDEN, result.error || 'Failed to retrieve reception summary.');
    }

    return sendSuccess(res, result.summary);
  } catch (error) {
    console.error('[ReceptionRoutes] getSummary error:', error);
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'Internal error retrieving reception summary.');
  }
});

export default router;
