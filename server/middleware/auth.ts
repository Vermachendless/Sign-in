import { Request, Response, NextFunction } from 'express';
import { authService } from '../services/auth.service.ts';
import { sendError, ApiErrorCode } from '../utils/apiResponse.ts';
import { SafeUser, UserRole } from '../../src/types/index.ts';

// Extend Express Request interface cleanly
export interface AuthenticatedRequest extends Request {
  user?: SafeUser;
  sessionToken?: string;
}

/**
 * Extracts session token from HTTP-only cookie or Authorization Bearer header
 */
export function extractToken(req: Request): string | null {
  // 1. Check HTTP-only cookie
  if (req.cookies && req.cookies.session_token) {
    return req.cookies.session_token;
  }

  // 2. Check Authorization header
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7).trim();
  }

  return null;
}

/**
 * Authentication middleware that verifies session token and ensures user is active.
 * Rejects invalid, expired, or suspended sessions immediately.
 */
export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const token = extractToken(req);

  if (!token) {
    return sendError(res, 401, ApiErrorCode.UNAUTHORIZED, 'Authentication required.');
  }

  const result = authService.validateSession(token);

  if (!result.valid || !result.user) {
    const code = result.errorCode || ApiErrorCode.UNAUTHORIZED;
    const message = result.errorMessage || 'Invalid or expired session.';
    return sendError(res, 401, code, message);
  }

  // Attach safe user context and token to request
  req.user = result.user;
  req.sessionToken = token;

  next();
}

/**
 * Role-based access control middleware factory
 */
export function requireRole(...allowedRoles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return sendError(res, 401, ApiErrorCode.UNAUTHORIZED, 'Authentication required.');
    }

    if (!allowedRoles.includes(req.user.role)) {
      return sendError(
        res,
        403,
        ApiErrorCode.FORBIDDEN,
        `Access denied. Requires one of the following roles: ${allowedRoles.join(', ')}.`
      );
    }

    next();
  };
}

/**
 * Convenience RBAC middlewares
 */
export const requireSuperAdmin = requireRole(UserRole.SUPER_ADMIN);
export const requireAdmin = requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN);
export const requireStaff = requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.STAFF);
