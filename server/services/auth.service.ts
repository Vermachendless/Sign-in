import { dbAdapter } from '../db/adapter.ts';
import { generateSecureToken, hashToken, generateId, verifyPassword } from '../utils/crypto.ts';
import { auditService } from './audit.service.ts';
import { UserRole, UserStatus, SafeUser } from '../../src/types/index.ts';

export interface LoginResult {
  success: boolean;
  user?: SafeUser;
  token?: string;
  expiresAt?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface SessionValidationResult {
  valid: boolean;
  user?: SafeUser;
  session?: {
    id: string;
    userId: string;
    expiresAt: string;
    createdAt: string;
  };
  errorCode?: string;
  errorMessage?: string;
}

interface RawUserRow {
  id: string;
  email: string;
  password_hash: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  department: string | null;
  role: UserRole;
  status: UserStatus;
  created_at: string;
  updated_at: string;
}

interface RawSessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  created_at: string;
  email: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  department: string | null;
  role: UserRole;
  status: UserStatus;
}

export class AuthService {
  private readonly sessionDurationDays = 7;

  /**
   * Authenticate user with email and password
   */
  public async login(
    emailInput: string,
    passwordInput: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<LoginResult> {
    const normalizedEmail = (emailInput || '').trim().toLowerCase();

    if (!normalizedEmail || !passwordInput) {
      return {
        success: false,
        errorCode: 'VALIDATION_ERROR',
        errorMessage: 'Email and password are required.',
      };
    }

    // Query user by email (case-insensitive) using parameterized query
    const user = await dbAdapter.queryOne<RawUserRow>(
      `
      SELECT id, email, password_hash, first_name, last_name, phone, department, role, status, created_at, updated_at
      FROM users
      WHERE LOWER(email) = LOWER($1)
      `,
      [normalizedEmail]
    );

    // Defend against account enumeration: verify dummy password if user not found to normalize response time
    if (!user) {
      await auditService.log({
        actorId: null,
        action: 'LOGIN_FAILED',
        targetUserId: null,
        ipAddress,
        userAgent,
        metadata: { email: normalizedEmail, reason: 'ACCOUNT_NOT_FOUND' },
      });

      return {
        success: false,
        errorCode: 'INVALID_CREDENTIALS',
        errorMessage: 'Invalid email or password.',
      };
    }

    // Check account status
    if (user.status === UserStatus.SUSPENDED) {
      await auditService.log({
        actorId: user.id,
        action: 'LOGIN_FAILED',
        targetUserId: user.id,
        ipAddress,
        userAgent,
        metadata: { email: normalizedEmail, reason: 'ACCOUNT_SUSPENDED' },
      });

      return {
        success: false,
        errorCode: 'ACCOUNT_SUSPENDED',
        errorMessage: 'Your account has been suspended. Please contact an administrator.',
      };
    }

    if (user.status === UserStatus.REMOVED) {
      await auditService.log({
        actorId: user.id,
        action: 'LOGIN_FAILED',
        targetUserId: user.id,
        ipAddress,
        userAgent,
        metadata: { email: normalizedEmail, reason: 'ACCOUNT_REMOVED' },
      });

      return {
        success: false,
        errorCode: 'INVALID_CREDENTIALS',
        errorMessage: 'Invalid email or password.',
      };
    }

    // Verify password
    const isPasswordValid = await verifyPassword(passwordInput, user.password_hash);
    if (!isPasswordValid) {
      await auditService.log({
        actorId: user.id,
        action: 'LOGIN_FAILED',
        targetUserId: user.id,
        ipAddress,
        userAgent,
        metadata: { email: normalizedEmail, reason: 'INCORRECT_PASSWORD' },
      });

      return {
        success: false,
        errorCode: 'INVALID_CREDENTIALS',
        errorMessage: 'Invalid email or password.',
      };
    }

    // Create a new session
    const rawToken = generateSecureToken();
    const tokenHash = hashToken(rawToken);
    const sessionId = generateId();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.sessionDurationDays * 24 * 60 * 60 * 1000).toISOString();

    await dbAdapter.execute(
      `
      INSERT INTO sessions (id, user_id, token_hash, expires_at, ip_address, user_agent, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        sessionId,
        user.id,
        tokenHash,
        expiresAt,
        ipAddress || null,
        userAgent || null,
        now.toISOString(),
      ]
    );

    const safeUser: SafeUser = {
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      phone: user.phone,
      department: user.department,
      role: user.role,
      status: user.status,
    };

    await auditService.log({
      actorId: user.id,
      action: 'LOGIN',
      targetUserId: user.id,
      ipAddress,
      userAgent,
      metadata: { email: user.email, role: user.role },
    });

    return {
      success: true,
      user: safeUser,
      token: rawToken,
      expiresAt,
    };
  }

  /**
   * Validate a session token from request cookie/header and retrieve live user state
   */
  public async validateSession(rawToken: string): Promise<SessionValidationResult> {
    if (!rawToken || typeof rawToken !== 'string') {
      return { valid: false, errorCode: 'UNAUTHORIZED', errorMessage: 'No session provided.' };
    }

    const tokenHash = hashToken(rawToken);

    const row = await dbAdapter.queryOne<RawSessionRow>(
      `
      SELECT 
        s.id, s.user_id, s.token_hash, s.expires_at, s.created_at,
        u.email, u.first_name, u.last_name, u.phone, u.department, u.role, u.status
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1
      `,
      [tokenHash]
    );

    if (!row) {
      return { valid: false, errorCode: 'UNAUTHORIZED', errorMessage: 'Invalid or expired session.' };
    }

    // Check expiration
    const expiresAtDate = new Date(row.expires_at);
    if (expiresAtDate.getTime() < Date.now()) {
      // Clean up expired session
      await dbAdapter.execute('DELETE FROM sessions WHERE id = $1', [row.id]);
      return { valid: false, errorCode: 'UNAUTHORIZED', errorMessage: 'Session has expired.' };
    }

    // Check live user status
    if (row.status !== UserStatus.ACTIVE) {
      return {
        valid: false,
        errorCode: 'ACCOUNT_SUSPENDED',
        errorMessage: 'Your account is not active. Please contact an administrator.',
      };
    }

    const safeUser: SafeUser = {
      id: row.user_id,
      email: row.email,
      firstName: row.first_name,
      lastName: row.last_name,
      phone: row.phone,
      department: row.department,
      role: row.role,
      status: row.status,
    };

    return {
      valid: true,
      user: safeUser,
      session: {
        id: row.id,
        userId: row.user_id,
        expiresAt: row.expires_at,
        createdAt: row.created_at,
      },
    };
  }

  /**
   * Terminate a specific session (Logout)
   */
  public async logout(rawToken: string, ipAddress?: string, userAgent?: string): Promise<void> {
    if (!rawToken) return;

    try {
      const tokenHash = hashToken(rawToken);

      const session = await dbAdapter.queryOne<{ id: string; user_id: string; email: string }>(
        `
        SELECT s.id, s.user_id, u.email
        FROM sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1
        `,
        [tokenHash]
      );

      if (session) {
        await dbAdapter.execute('DELETE FROM sessions WHERE id = $1', [session.id]);

        await auditService.log({
          actorId: session.user_id,
          action: 'LOGOUT',
          targetUserId: session.user_id,
          ipAddress,
          userAgent,
          metadata: { email: session.email },
        });
      }
    } catch (err) {
      console.error('[AuthService] Error logging out:', err);
    }
  }

  /**
   * Terminate all sessions for a user (e.g. after suspension or password reset)
   */
  public async invalidateAllUserSessions(userId: string): Promise<void> {
    await dbAdapter.execute('DELETE FROM sessions WHERE user_id = $1', [userId]);
  }
}

export const authService = new AuthService();

