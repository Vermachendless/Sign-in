import { Request } from 'express';
import { getDatabase } from '../db/index.ts';

export interface NetworkVerificationResult {
  isOfficeNetwork: boolean;
  detectedIp: string;
  maskedDetectedIp: string;
  verificationMethod: 'OFFICE_IP';
  matchedRuleType?: 'ENVIRONMENT' | 'DATABASE_SETTINGS' | 'LOOPBACK' | 'NONE';
  proxyHeadersDetected: boolean;
  proxyHopCount: number;
}

/**
 * Normalizes an IP address by trimming whitespace, lowercasing, and stripping IPv6-mapped IPv4 prefix (::ffff:)
 */
export function normalizeIp(ip: string | undefined | null): string {
  if (!ip) return '';
  let clean = ip.trim().toLowerCase();
  if (clean.startsWith('::ffff:')) {
    clean = clean.substring(7);
  }
  return clean;
}

/**
 * Mask an IPv4 or IPv6 address for secure display/logging
 * Example IPv4: 102.129.144.52 -> 102.129.***.52
 * Example IPv6: 2a00:1450:4009:820::200e -> 2a00:1450:****:****::200e
 */
export function maskIpAddress(ip: string): string {
  if (!ip) return '***';

  // Normalize IPv6 mapped IPv4
  const cleanIp = normalizeIp(ip);

  // IPv4 masking
  if (cleanIp.includes('.')) {
    const segments = cleanIp.split('.');
    if (segments.length === 4) {
      return `${segments[0]}.${segments[1]}.***.${segments[3]}`;
    }
  }

  // IPv6 masking
  if (cleanIp.includes(':')) {
    const segments = cleanIp.split(':');
    if (segments.length >= 3) {
      return `${segments[0]}:${segments[1]}:****:****:${segments[segments.length - 1]}`;
    }
  }

  return `${cleanIp.substring(0, 3)}***`;
}

/**
 * Extract real client IP address from request, taking proxy configurations into account
 */
export function extractClientIp(req: Request): { ip: string; proxyHeadersDetected: boolean; proxyHopCount: number } {
  let proxyHeadersDetected = false;
  let proxyHopCount = 0;

  // 1. Check x-forwarded-for header (populated by Cloud Run, Cloudflare, Nginx, Vercel)
  const forwardedFor = req.headers['x-forwarded-for'];
  if (forwardedFor) {
    proxyHeadersDetected = true;
    const ips = (Array.isArray(forwardedFor) ? forwardedFor.join(',') : forwardedFor)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    proxyHopCount = ips.length;

    // The leftmost IP is the original client IP in a standard trusted proxy chain
    if (ips.length > 0 && ips[0]) {
      const clientIp = normalizeIp(ips[0]);
      return { ip: clientIp, proxyHeadersDetected, proxyHopCount };
    }
  }

  // 2. Fallback to req.ip (Express with trust proxy enabled)
  if (req.ip) {
    const clientIp = normalizeIp(req.ip);
    return { ip: clientIp, proxyHeadersDetected, proxyHopCount };
  }

  // 3. Fallback to socket remoteAddress
  const socketIp = normalizeIp(req.socket?.remoteAddress || '127.0.0.1');
  return { ip: socketIp, proxyHeadersDetected, proxyHopCount };
}

/**
 * Retrieve the set of approved office IPs from environment variables and database settings
 */
export function getApprovedOfficeIps(): { envIps: string[]; dbIps: string[]; allIps: Set<string> } {
  const envIps: string[] = [];
  const dbIps: string[] = [];
  const allIps = new Set<string>();

  // 1. Read from OFFICE_IPS or OFFICE_IP environment variables (supports comma-separated list)
  const envOfficeIpsRaw = process.env.OFFICE_IPS || process.env.OFFICE_IP || '';
  if (envOfficeIpsRaw) {
    const parsed = envOfficeIpsRaw
      .split(',')
      .map((ip) => normalizeIp(ip))
      .filter(Boolean);
    for (const ip of parsed) {
      if (!allIps.has(ip)) {
        envIps.push(ip);
        allIps.add(ip);
      }
    }
  }

  // 2. Read from system_settings table in database
  try {
    const db = getDatabase();
    const row = db.prepare('SELECT value FROM system_settings WHERE key = ?').get('approvedOfficeIPs') as
      | { value: string }
      | undefined;

    if (row && row.value) {
      try {
        const parsed = JSON.parse(row.value);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (typeof item === 'string') {
              const clean = normalizeIp(item);
              if (clean && !allIps.has(clean)) {
                dbIps.push(clean);
                allIps.add(clean);
              }
            }
          }
        }
      } catch {
        // If stored as plain string or comma-separated string
        const items = row.value.split(',').map((s) => normalizeIp(s)).filter(Boolean);
        for (const clean of items) {
          if (clean && !allIps.has(clean)) {
            dbIps.push(clean);
            allIps.add(clean);
          }
        }
      }
    }
  } catch (err) {
    console.error('[NetworkService] Error reading office IPs from database:', err);
  }

  return { envIps, dbIps, allIps };
}

/**
 * Verifies if an incoming HTTP request originates from an approved office IP/network
 */
export function verifyOfficeNetwork(req: Request): NetworkVerificationResult {
  const { ip: rawClientIp, proxyHeadersDetected, proxyHopCount } = extractClientIp(req);
  const clientIp = normalizeIp(rawClientIp);
  const maskedDetectedIp = maskIpAddress(clientIp);

  if (!clientIp) {
    return {
      isOfficeNetwork: false,
      detectedIp: '',
      maskedDetectedIp: '***',
      verificationMethod: 'OFFICE_IP',
      matchedRuleType: 'NONE',
      proxyHeadersDetected,
      proxyHopCount,
    };
  }

  const { envIps, dbIps, allIps } = getApprovedOfficeIps();

  // Normalize approved IPs for comparison
  const normalizedApproved = new Set<string>();
  for (const ip of allIps) {
    const norm = normalizeIp(ip);
    if (norm) normalizedApproved.add(norm);
  }

  // Check direct match
  if (normalizedApproved.has(clientIp)) {
    const isEnvMatch = envIps.some((i) => normalizeIp(i) === clientIp);
    const isDbMatch = dbIps.some((i) => normalizeIp(i) === clientIp);
    return {
      isOfficeNetwork: true,
      detectedIp: clientIp,
      maskedDetectedIp,
      verificationMethod: 'OFFICE_IP',
      matchedRuleType: isEnvMatch ? 'ENVIRONMENT' : isDbMatch ? 'DATABASE_SETTINGS' : 'ENVIRONMENT',
      proxyHeadersDetected,
      proxyHopCount,
    };
  }

  // Check loopback equivalence (e.g. localhost, 127.0.0.1, ::1)
  const isLoopbackClient = clientIp === '127.0.0.1' || clientIp === '::1' || clientIp === 'localhost';
  const hasLoopbackApproved =
    normalizedApproved.has('127.0.0.1') || normalizedApproved.has('::1') || normalizedApproved.has('localhost');

  if (isLoopbackClient && hasLoopbackApproved) {
    return {
      isOfficeNetwork: true,
      detectedIp: clientIp,
      maskedDetectedIp,
      verificationMethod: 'OFFICE_IP',
      matchedRuleType: 'LOOPBACK',
      proxyHeadersDetected,
      proxyHopCount,
    };
  }

  // Fail closed
  return {
    isOfficeNetwork: false,
    detectedIp: clientIp,
    maskedDetectedIp,
    verificationMethod: 'OFFICE_IP',
    matchedRuleType: 'NONE',
    proxyHeadersDetected,
    proxyHopCount,
  };
}
