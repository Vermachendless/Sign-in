import type { Pool, PoolClient } from 'pg';
import { hashPassword, generateId } from '../utils/crypto.ts';

export interface PostgresSeedResult {
  superAdminCreated: boolean;
  superAdminEmail: string;
  settingsCount: number;
  message: string;
}

/**
 * Seeds a clean PostgreSQL database with only the initial Super Admin and base system settings.
 * Does NOT create mock staff, test attendance, dummy events, or fake visitors.
 */
export async function seedPostgresDatabase(client: Pool | PoolClient): Promise<PostgresSeedResult> {
  const isProduction = process.env.NODE_ENV === 'production';
  const now = new Date().toISOString();

  // 1. Resolve Super Admin credentials from environment variables
  const rawEmail = process.env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase();
  const rawPassword = process.env.INITIAL_ADMIN_PASSWORD;

  // Check if a SUPER_ADMIN already exists in the database
  const existingAdminCheck = await client.query(
    `SELECT id, email FROM users WHERE role = 'SUPER_ADMIN' LIMIT 1`
  );
  const existingSuperAdmin = existingAdminCheck.rows[0];

  let superAdminCreated = false;
  let activeAdminEmail = existingSuperAdmin?.email || '';

  if (!existingSuperAdmin) {
    if (!rawEmail || !rawPassword) {
      if (isProduction) {
        throw new Error(
          '[Seed FATAL] INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD environment variables are required to bootstrap the initial Super Admin in production.'
        );
      }
      console.warn(
        '[Seed NOTICE] INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD not set. Using local development fallback credentials.'
      );
    }

    const superAdminEmail = (rawEmail || 'admin@example.com').trim().toLowerCase();
    const superAdminPassword = rawPassword || 'AdminSecurePassword123!';
    const passwordHash = await hashPassword(superAdminPassword);
    const superAdminId = generateId();

    // Insert initial Super Admin
    await client.query(
      `
      INSERT INTO users (
        id, email, password_hash, first_name, last_name, phone, department, role, status, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'SUPER_ADMIN', 'ACTIVE', $8, $9)
      ON CONFLICT (LOWER(email)) DO NOTHING
      `,
      [
        superAdminId,
        superAdminEmail,
        passwordHash,
        'System',
        'Administrator',
        '+234 801 000 0001',
        'Executive IT',
        now,
        now,
      ]
    );

    // Record immutable audit log entry for the initial bootstrap
    await client.query(
      `
      INSERT INTO audit_logs (
        id, actor_id, action, target_user_id, ip_address, user_agent, metadata, created_at
      )
      VALUES ($1, $2, 'SYSTEM_SEED_INITIAL_SUPER_ADMIN', $3, '127.0.0.1', 'System/Bootstrap', $4, $5)
      `,
      [
        generateId(),
        superAdminId,
        superAdminId,
        JSON.stringify({ email: superAdminEmail, role: 'SUPER_ADMIN', seededAt: now }),
        now,
      ]
    );

    superAdminCreated = true;
    activeAdminEmail = superAdminEmail;
    console.log(`[Seed] Initial SUPER_ADMIN account configured: ${superAdminEmail}`);
  } else {
    console.log(`[Seed] SUPER_ADMIN account already exists (${existingSuperAdmin.email}). Skipping user creation.`);
  }

  // 2. Seed Base System Settings
  const initialOfficeIps = process.env.OFFICE_IPS
    ? process.env.OFFICE_IPS.split(',').map((s) => s.trim()).filter(Boolean)
    : [];

  const defaultSettings = [
    {
      key: 'approvedOfficeIPs',
      value: JSON.stringify(initialOfficeIps),
      description: 'Approved public IP addresses and CIDR subnets for company office network Wi-Fi check-in',
    },
    {
      key: 'workStartTime',
      value: '08:00',
      description: 'Standard work day start time (24h format HH:mm)',
    },
    {
      key: 'workEndTime',
      value: '17:00',
      description: 'Standard work day end time (24h format HH:mm)',
    },
    {
      key: 'lateGracePeriodMinutes',
      value: '10',
      description: 'Allowed grace period in minutes after workStartTime before attendance is marked LATE',
    },
    {
      key: 'timezone',
      value: 'Africa/Lagos',
      description: 'Company operational timezone',
    },
  ];

  let settingsCount = 0;
  for (const setting of defaultSettings) {
    await client.query(
      `
      INSERT INTO system_settings (id, key, value, description, updated_at)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (key) DO UPDATE SET
        value = CASE
          WHEN system_settings.value IS NULL OR system_settings.value = '' THEN EXCLUDED.value
          ELSE system_settings.value
        END,
        description = EXCLUDED.description,
        updated_at = EXCLUDED.updated_at
      `,
      [generateId(), setting.key, setting.value, setting.description, now]
    );
    settingsCount++;
  }

  console.log(`[Seed] Successfully initialized ${settingsCount} system configuration settings.`);

  return {
    superAdminCreated,
    superAdminEmail: activeAdminEmail,
    settingsCount,
    message: superAdminCreated
      ? `Clean production seed complete. Initial Super Admin created (${activeAdminEmail}).`
      : `Clean production seed complete. Super Admin preserved (${activeAdminEmail}).`,
  };
}
