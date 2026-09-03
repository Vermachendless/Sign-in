import { Router, Response } from 'express';
import { authService } from '../services/auth.service.ts';
import { requireAuth, requireAdmin, requireSuperAdmin, AuthenticatedRequest } from '../middleware/auth.ts';
import { authRateLimiter } from '../middleware/rateLimit.ts';
import { sendSuccess, sendError, ApiErrorCode } from '../utils/apiResponse.ts';

const router = Router();

/**
 * Cookie configuration helper
 */
function getCookieOptions() {
  const isProduction = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax' as const,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: '/',
  };
}

/**
 * POST /api/auth/login
 * Public endpoint for staff & administrator login with rate limiting
 */
router.post('/login', authRateLimiter, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { email, password } = req.body || {};

    if (!email || typeof email !== 'string' || !password || typeof password !== 'string') {
      return sendError(
        res,
        400,
        ApiErrorCode.VALIDATION_ERROR,
        'Please provide a valid email and password.'
      );
    }

    const ipAddress = (req.ip || req.socket.remoteAddress || '127.0.0.1').replace('::ffff:', '');
    const userAgent = req.headers['user-agent'] || 'Unknown';

    const result = await authService.login(email, password, ipAddress, userAgent);

    if (!result.success || !result.user || !result.token) {
      const statusCode = result.errorCode === 'ACCOUNT_SUSPENDED' ? 403 : 401;
      return sendError(
        res,
        statusCode,
        result.errorCode || ApiErrorCode.INVALID_CREDENTIALS,
        result.errorMessage || 'Invalid email or password.'
      );
    }

    // Set secure HTTP-only session cookie
    res.cookie('session_token', result.token, getCookieOptions());

    return sendSuccess(res, {
      user: result.user,
      token: result.token,
    });
  } catch (error) {
    console.error('[AuthRoutes] Login error:', error);
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'An unexpected error occurred during login.');
  }
});

/**
 * POST /api/auth/logout
 * Invalidate current session and clear cookie
 */
router.post('/logout', (req: AuthenticatedRequest, res: Response) => {
  try {
    const token = req.cookies?.session_token || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.substring(7) : null);
    const ipAddress = (req.ip || req.socket.remoteAddress || '127.0.0.1').replace('::ffff:', '');
    const userAgent = req.headers['user-agent'] || 'Unknown';

    if (token) {
      authService.logout(token, ipAddress, userAgent);
    }

    res.clearCookie('session_token', { path: '/' });
    return sendSuccess(res, { message: 'Logged out successfully.' });
  } catch (error) {
    console.error('[AuthRoutes] Logout error:', error);
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'An error occurred during logout.');
  }
});

/**
 * GET /api/auth/me
 * Retrieves current active user profile from live session
 */
router.get('/me', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  return sendSuccess(res, {
    user: req.user,
  });
});

/**
 * GET /api/auth/test/admin-check
 * Protected route to verify ADMIN RBAC
 */
router.get('/test/admin-check', requireAuth, requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  return sendSuccess(res, {
    message: 'Authorized for Admin access.',
    role: req.user?.role,
  });
});

/**
 * GET /api/auth/test/super-admin-check
 * Protected route to verify SUPER_ADMIN RBAC
 */
router.get('/test/super-admin-check', requireAuth, requireSuperAdmin, (req: AuthenticatedRequest, res: Response) => {
  return sendSuccess(res, {
    message: 'Authorized for Super Admin access.',
    role: req.user?.role,
  });
});

export default router;
