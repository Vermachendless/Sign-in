import { Router, Request, Response } from 'express';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '../middleware/auth.ts';
import { accessService } from '../services/access.service.ts';
import { sendSuccess, sendError, ApiErrorCode } from '../utils/apiResponse.ts';
import { extractClientIp } from '../services/network.service.ts';

const router = Router();

/**
 * POST /api/access/verify
 * Public / Reception Access Pass Verification Endpoint
 * Validates human-readable code or QR token against authoritative server state
 */
router.post('/verify', (req: Request, res: Response) => {
  try {
    const { code, token, consume } = req.body || {};
    const { ip: clientIp } = extractClientIp(req);
    const userAgent = req.headers['user-agent'] || 'Unknown';

    // Check optional authenticated user if present
    const authReq = req as AuthenticatedRequest;
    const actor = authReq.user || null;

    const result = accessService.verifyAccessPass({
      code,
      token,
      consumeUse: consume !== false, // default to consuming 1 use unless explicitly specified false
      ipAddress: clientIp,
      userAgent,
      actor,
    });

    if (!result.valid) {
      const statusCode = result.code === 'RATE_LIMITED' ? 429 : 400;
      return res.status(statusCode).json({
        success: false,
        valid: false,
        code: result.code || ApiErrorCode.VALIDATION_ERROR,
        message: result.message || 'Access verification failed.',
      });
    }

    return sendSuccess(res, {
      valid: true,
      passType: result.passType,
      displayCode: result.displayCode,
      event: result.event,
      validFrom: result.validFrom,
      validUntil: result.validUntil,
      remainingUses: result.remainingUses,
    });
  } catch (error) {
    console.error('[AccessRoutes] verify error:', error);
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'Internal error verifying access pass.');
  }
});

/**
 * GET /api/access/passes/:id
 * Retrieves pass details (ADMIN and SUPER_ADMIN only)
 */
router.get('/passes/:id', requireAuth, requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (!id) {
      return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, 'Access Pass ID is required.');
    }

    const pass = accessService.getPassById(id);
    if (!pass) {
      return sendError(res, 404, ApiErrorCode.NOT_FOUND, 'Access pass not found.');
    }

    return sendSuccess(res, pass);
  } catch (error) {
    console.error('[AccessRoutes] getPass error:', error);
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'Failed to retrieve access pass details.');
  }
});

/**
 * POST /api/access/passes/:id/revoke
 * Revokes an active access pass (ADMIN and SUPER_ADMIN only)
 */
router.post('/passes/:id/revoke', requireAuth, requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  try {
    const actor = req.user!;
    const { id } = req.params;
    const { reason } = req.body || {};

    if (!id) {
      return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, 'Access Pass ID is required.');
    }

    if (!reason || typeof reason !== 'string' || !reason.trim()) {
      return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, 'Revocation reason is required.');
    }

    const { ip: clientIp } = extractClientIp(req);
    const userAgent = req.headers['user-agent'] || 'Unknown';

    const result = accessService.revokeAccessPass(id, actor, reason, clientIp, userAgent);

    if (!result.success || !result.pass) {
      return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, result.error || 'Failed to revoke pass.');
    }

    return sendSuccess(res, result.pass);
  } catch (error) {
    console.error('[AccessRoutes] revokePass error:', error);
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'Internal error revoking access pass.');
  }
});

export default router;
