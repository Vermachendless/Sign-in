import { Request, Response, NextFunction } from 'express';
import { sendError, ApiErrorCode } from '../utils/apiResponse.ts';

interface RateLimitRecord {
  count: number;
  resetTime: number;
}

const loginAttempts = new Map<string, RateLimitRecord>();

// Clean up stale IP records periodically (every 5 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of loginAttempts.entries()) {
    if (now > record.resetTime) {
      loginAttempts.delete(ip);
    }
  }
}, 5 * 60 * 1000);

/**
 * Rate limiter middleware for authentication routes.
 * Limits login attempts to max 15 requests per 1 minute window per IP address.
 */
export function authRateLimiter(req: Request, res: Response, next: NextFunction) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown-ip';
  const now = Date.now();
  const windowMs = 60 * 1000; // 1 minute window
  const maxAttempts = 15;

  const record = loginAttempts.get(ip);

  if (!record || now > record.resetTime) {
    loginAttempts.set(ip, {
      count: 1,
      resetTime: now + windowMs,
    });
    return next();
  }

  record.count += 1;

  if (record.count > maxAttempts) {
    const retryAfterSec = Math.ceil((record.resetTime - now) / 1000);
    res.setHeader('Retry-After', retryAfterSec.toString());
    return sendError(
      res,
      429,
      ApiErrorCode.RATE_LIMITED,
      `Too many authentication attempts. Please try again in ${retryAfterSec} seconds.`
    );
  }

  return next();
}
