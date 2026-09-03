import { Request, Response, NextFunction } from 'express';

/**
 * Express security middleware setting critical HTTP security headers
 * and removing server fingerprinting.
 */
export function securityHeaders(req: Request, res: Response, next: NextFunction) {
  // Prevent browser MIME-sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Clickjacking defense
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');

  // Prevent XSS reflection
  res.setHeader('X-XSS-Protection', '1; mode=block');

  // Referrer policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Disable server identification
  res.removeHeader('X-Powered-By');

  next();
}
