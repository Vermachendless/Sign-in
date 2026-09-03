import { Router, Request, Response } from 'express';
import { verifyOfficeNetwork } from '../services/network.service.ts';
import { sendSuccess, sendError, ApiErrorCode } from '../utils/apiResponse.ts';

const router = Router();

/**
 * Development-Only Network Diagnostic Endpoint
 *
 * GET /api/dev/network-diagnostic
 *
 * Security Constraints:
 * 1. Blocked in production (NODE_ENV=production -> 404 Not Found)
 * 2. Does NOT reveal the configured list of office IPs
 * 3. Returns the detected client IP in masked format
 * 4. Documents how the detected IP was extracted through the reverse proxy chain
 */
router.get('/network-diagnostic', (req: Request, res: Response) => {
  // Strict environment check
  if (process.env.NODE_ENV === 'production') {
    return sendError(res, 404, ApiErrorCode.NOT_FOUND, 'Endpoint not found or disabled in production.');
  }

  const verification = verifyOfficeNetwork(req);

  return sendSuccess(res, {
    diagnostic: {
      status: 'active',
      environment: process.env.NODE_ENV || 'development',
      networkVerification: {
        isOfficeNetwork: verification.isOfficeNetwork,
        maskedDetectedIp: verification.maskedDetectedIp,
        verificationMethod: verification.verificationMethod,
        matchedSource: verification.isOfficeNetwork ? verification.matchedRuleType : null,
      },
      proxyEvaluation: {
        trustProxyEnabled: true,
        proxyHeadersDetected: verification.proxyHeadersDetected,
        forwardedHopsCount: verification.proxyHopCount,
      },
      ipResolutionDocumentation: {
        resolutionOrder: [
          '1. Parse leftmost IP in X-Forwarded-For header (Standard trusted reverse-proxy chain from Nginx/Cloud Run)',
          '2. Fallback to Express req.ip (evaluated via app.set("trust proxy", true))',
          '3. Fallback to underlying TCP socket remoteAddress',
        ],
        multipleIpsSupported: true,
        multipleIpsFormat: 'Comma-separated list in OFFICE_IPS environment variable or JSON array in system_settings database table',
      },
      timestamp: new Date().toISOString(),
    },
  });
});

export default router;
