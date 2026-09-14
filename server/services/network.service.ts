import net from 'node:net';
import { Request } from 'express';
import { getDatabase } from '../db/index.ts';
import { auditService } from './audit.service.ts';
import { generateId } from '../utils/crypto.ts';
import { OfficeNetworkConfig } from '../../src/types/index.ts';

export interface NetworkVerificationResult {
  isOfficeNetwork: boolean;
  detectedIp: string;
  maskedDetectedIp: string;
  verificationMethod: 'OFFICE_IP';
  matchedRuleType?: 'ENVIRONMENT' | 'DATABASE_SETTINGS' | 'LOOPBACK' | 'NONE';
  proxyHeadersDetected: boolean;
  proxyHopCount: number;
  ipSource: 'x-forwarded-for' | 'req.ip' | 'socket.remoteAddress' | 'none';
}

/**
 * Checks if an IP address is a local loopback address (127.0.0.1, ::1, localhost, etc.)
 */
export function isLoopbackAddress(ip: string | undefined | null): boolean {
  if (!ip) return false;
  const clean = normalizeIp(ip);
  return clean === '127.0.0.1' || clean === '::1' || clean === 'localhost' || clean.startsWith('127.');
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
export function extractClientIp(req: Request): {
  ip: string;
  ipSource: 'x-forwarded-for' | 'req.ip' | 'socket.remoteAddress' | 'none';
  proxyHeadersDetected: boolean;
  proxyHopCount: number;
} {
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
      return { ip: clientIp, ipSource: 'x-forwarded-for', proxyHeadersDetected, proxyHopCount };
    }
  }

  // 2. Fallback to req.ip (Express with trust proxy enabled)
  if (req.ip) {
    const clientIp = normalizeIp(req.ip);
    return { ip: clientIp, ipSource: 'req.ip', proxyHeadersDetected, proxyHopCount };
  }

  // 3. Fallback to socket remoteAddress
  const socketIp = normalizeIp(req.socket?.remoteAddress || '127.0.0.1');
  return { ip: socketIp, ipSource: 'socket.remoteAddress', proxyHeadersDetected, proxyHopCount };
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
  const { ip: rawClientIp, ipSource, proxyHeadersDetected, proxyHopCount } = extractClientIp(req);
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
      ipSource: 'none',
    };
  }

  const { envIps, dbIps, allIps } = getApprovedOfficeIps();

  // Normalize approved IPs for comparison
  const normalizedApproved = new Set<string>();
  for (const ip of allIps) {
    const norm = normalizeIp(ip);
    if (norm) normalizedApproved.add(norm);
  }

  // In production, loopback addresses (127.0.0.1, ::1) must NEVER authorize office access
  const isProd = process.env.NODE_ENV === 'production';
  const isLoopbackClient = isLoopbackAddress(clientIp);

  if (isProd && isLoopbackClient) {
    return {
      isOfficeNetwork: false,
      detectedIp: clientIp,
      maskedDetectedIp,
      verificationMethod: 'OFFICE_IP',
      matchedRuleType: 'NONE',
      proxyHeadersDetected,
      proxyHopCount,
      ipSource,
    };
  }

  // Check direct match
  if (normalizedApproved.has(clientIp)) {
    // In production, even if a loopback somehow exists in configuration, reject it
    if (isProd && isLoopbackClient) {
      return {
        isOfficeNetwork: false,
        detectedIp: clientIp,
        maskedDetectedIp,
        verificationMethod: 'OFFICE_IP',
        matchedRuleType: 'NONE',
        proxyHeadersDetected,
        proxyHopCount,
        ipSource,
      };
    }

    const isEnvMatch = envIps.some((i) => normalizeIp(i) === clientIp);
    const isDbMatch = dbIps.some((i) => normalizeIp(i) === clientIp);
    return {
      isOfficeNetwork: true,
      detectedIp: clientIp,
      maskedDetectedIp,
      verificationMethod: 'OFFICE_IP',
      matchedRuleType: isLoopbackClient ? 'LOOPBACK' : isEnvMatch ? 'ENVIRONMENT' : isDbMatch ? 'DATABASE_SETTINGS' : 'ENVIRONMENT',
      proxyHeadersDetected,
      proxyHopCount,
      ipSource,
    };
  }

  // In non-production environments only, check if loopback equivalence was explicitly configured
  if (!isProd && isLoopbackClient) {
    const hasLoopbackApproved =
      normalizedApproved.has('127.0.0.1') || normalizedApproved.has('::1') || normalizedApproved.has('localhost');

    if (hasLoopbackApproved) {
      return {
        isOfficeNetwork: true,
        detectedIp: clientIp,
        maskedDetectedIp,
        verificationMethod: 'OFFICE_IP',
        matchedRuleType: 'LOOPBACK',
        proxyHeadersDetected,
        proxyHopCount,
        ipSource,
      };
    }
  }

  // Fail closed (e.g. if no matching IP or no valid office IP configured)
  return {
    isOfficeNetwork: false,
    detectedIp: clientIp,
    maskedDetectedIp,
    verificationMethod: 'OFFICE_IP',
    matchedRuleType: 'NONE',
    proxyHeadersDetected,
    proxyHopCount,
    ipSource,
  };
}

/**
 * Validates whether a string is a valid IPv4 or IPv6 address using node:net
 */
export function validateIpFormat(ip: string): boolean {
  if (!ip) return false;
  const clean = normalizeIp(ip);
  return net.isIP(clean) !== 0;
}

/**
 * Super Admin: Retrieves current office network configuration and evaluating client IP
 */
export function getOfficeNetworkSettings(req?: Request): OfficeNetworkConfig {
  const { envIps, dbIps, allIps } = getApprovedOfficeIps();
  let currentDetectedIp = '';
  let maskedDetectedIp = '';
  let isCurrentIpApproved = false;
  let isCurrentIpLoopback = false;
  let ruleType = 'NONE';
  let proxyHeadersDetected = false;
  let proxyHopCount = 0;

  if (req) {
    const verification = verifyOfficeNetwork(req);
    currentDetectedIp = verification.detectedIp;
    maskedDetectedIp = verification.maskedDetectedIp;
    isCurrentIpApproved = verification.isOfficeNetwork;
    isCurrentIpLoopback = isLoopbackAddress(verification.detectedIp);
    ruleType = verification.matchedRuleType || 'NONE';
    proxyHeadersDetected = verification.proxyHeadersDetected;
    proxyHopCount = verification.proxyHopCount;
  }

  return {
    approvedIps: Array.from(allIps),
    dbIps,
    envIps,
    currentDetectedIp,
    maskedDetectedIp,
    isCurrentIpApproved,
    isCurrentIpLoopback,
    ruleType,
    proxyHeadersDetected,
    proxyHopCount,
  };
}

/**
 * Super Admin: Adds an approved public IP to system_settings.approvedOfficeIPs with audit logging
 */
export function addApprovedOfficeIp(
  actorId: string,
  ipInput: string,
  clientIp?: string,
  userAgent?: string
): { success: boolean; approvedIps: string[]; dbIps: string[]; addedIp?: string; error?: string } {
  const clean = normalizeIp(ipInput);
  if (!clean || !validateIpFormat(clean)) {
    return {
      success: false,
      approvedIps: [],
      dbIps: [],
      error: 'Invalid IP address format. Must be a valid IPv4 or IPv6 address.',
    };
  }

  const isProd = process.env.NODE_ENV === 'production';
  if (isProd && isLoopbackAddress(clean)) {
    return {
      success: false,
      approvedIps: [],
      dbIps: [],
      error: 'Loopback addresses (127.0.0.1, ::1) cannot be configured as office networks in production.',
    };
  }

  const db = getDatabase();
  const { dbIps } = getApprovedOfficeIps();

  if (dbIps.includes(clean)) {
    const { allIps } = getApprovedOfficeIps();
    return {
      success: true,
      approvedIps: Array.from(allIps),
      dbIps,
      addedIp: clean,
    };
  }

  const updatedDbIps = [...dbIps, clean];
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO system_settings (id, key, value, description, updated_at, updated_by)
    VALUES (?, 'approvedOfficeIPs', ?, 'Approved public IP addresses for company office network Wi-Fi check-in', ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by
  `).run(generateId(), JSON.stringify(updatedDbIps), now, actorId);

  auditService.log({
    actorId,
    action: 'OFFICE_IP_ADDED',
    ipAddress: clientIp || null,
    userAgent: userAgent || null,
    metadata: {
      addedIp: clean,
      previousIps: dbIps,
      updatedIps: updatedDbIps,
    },
  });

  const { allIps } = getApprovedOfficeIps();

  return {
    success: true,
    approvedIps: Array.from(allIps),
    dbIps: updatedDbIps,
    addedIp: clean,
  };
}

/**
 * Super Admin: Removes an approved IP from system_settings.approvedOfficeIPs with audit logging
 */
export function removeApprovedOfficeIp(
  actorId: string,
  ipInput: string,
  clientIp?: string,
  userAgent?: string
): { success: boolean; approvedIps: string[]; dbIps: string[]; removedIp?: string; error?: string } {
  const clean = normalizeIp(ipInput);
  if (!clean) {
    return {
      success: false,
      approvedIps: [],
      dbIps: [],
      error: 'IP address to remove is required.',
    };
  }

  const db = getDatabase();
  const { dbIps } = getApprovedOfficeIps();

  const updatedDbIps = dbIps.filter((ip) => normalizeIp(ip) !== clean);
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO system_settings (id, key, value, description, updated_at, updated_by)
    VALUES (?, 'approvedOfficeIPs', ?, 'Approved public IP addresses for company office network Wi-Fi check-in', ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by
  `).run(generateId(), JSON.stringify(updatedDbIps), now, actorId);

  auditService.log({
    actorId,
    action: 'OFFICE_IP_REMOVED',
    ipAddress: clientIp || null,
    userAgent: userAgent || null,
    metadata: {
      removedIp: clean,
      previousIps: dbIps,
      updatedIps: updatedDbIps,
    },
  });

  const { allIps } = getApprovedOfficeIps();

  return {
    success: true,
    approvedIps: Array.from(allIps),
    dbIps: updatedDbIps,
    removedIp: clean,
  };
}
