import { getDatabase } from './index.ts';
import { hashPassword, generateId } from '../utils/crypto.ts';

export async function seedDatabase() {
  const db = getDatabase();
  const now = new Date().toISOString();

  // 1. Seed Initial Super Admin
  const superAdminEmail = (process.env.INITIAL_ADMIN_EMAIL || 'admin@example.com').toLowerCase().trim();
  const superAdminPassword = process.env.INITIAL_ADMIN_PASSWORD || 'AdminSecurePassword123!';

  const existingSuperAdmin = db.prepare('SELECT id FROM users WHERE email = ?').get(superAdminEmail);
  if (!existingSuperAdmin) {
    const passwordHash = await hashPassword(superAdminPassword);
    const superAdminId = generateId();

    db.prepare(`
      INSERT INTO users (id, email, password_hash, first_name, last_name, phone, department, role, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'SUPER_ADMIN', 'ACTIVE', ?, ?)
    `).run(
      superAdminId,
      superAdminEmail,
      passwordHash,
      'System',
      'Administrator',
      '+234 801 000 0001',
      'Executive IT',
      now,
      now
    );

    // Initial audit log for seed
    db.prepare(`
      INSERT INTO audit_logs (id, actor_id, action, target_user_id, ip_address, user_agent, metadata, created_at)
      VALUES (?, ?, 'SYSTEM_SEED_INITIAL_SUPER_ADMIN', ?, '127.0.0.1', 'System/Bootstrap', ?, ?)
    `).run(
      generateId(),
      superAdminId,
      superAdminId,
      JSON.stringify({ email: superAdminEmail, role: 'SUPER_ADMIN' }),
      now
    );

    console.log(`[Seed] Created initial SUPER_ADMIN account: ${superAdminEmail}`);
  }

  // 2. Seed Default Sample Admin (Operations Manager)
  const managerEmail = 'manager@example.com';
  const existingManager = db.prepare('SELECT id FROM users WHERE email = ?').get(managerEmail);
  if (!existingManager) {
    const passwordHash = await hashPassword('ManagerSecure123!');
    db.prepare(`
      INSERT INTO users (id, email, password_hash, first_name, last_name, phone, department, role, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'ADMIN', 'ACTIVE', ?, ?)
    `).run(
      generateId(),
      managerEmail,
      passwordHash,
      'Operations',
      'Manager',
      '+234 802 000 0002',
      'Operations',
      now,
      now
    );
    console.log(`[Seed] Created demo ADMIN account: ${managerEmail}`);
  }

  // 3. Seed Sample Staff (John Doe - Active)
  const staff1Email = 'john.doe@example.com';
  const existingStaff1 = db.prepare('SELECT id FROM users WHERE email = ?').get(staff1Email) as { id: string } | undefined;
  let staff1Id = existingStaff1?.id;

  if (!existingStaff1) {
    const passwordHash = await hashPassword('StaffSecure123!');
    staff1Id = generateId();
    db.prepare(`
      INSERT INTO users (id, email, password_hash, first_name, last_name, phone, department, role, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'STAFF', 'ACTIVE', ?, ?)
    `).run(
      staff1Id,
      staff1Email,
      passwordHash,
      'John',
      'Doe',
      '+234 803 000 0003',
      'Engineering',
      now,
      now
    );
    console.log(`[Seed] Created demo STAFF account: ${staff1Email}`);
  }

  if (staff1Id) {
    // Seed historical attendance for demo staff (John Doe) for previous days
    const pastAttendance1 = '2026-09-01';
    const pastAttendance2 = '2026-08-31';

    db.prepare(`
      INSERT OR IGNORE INTO attendance (
        id, staff_id, date, check_in, check_out, check_in_ip, check_out_ip,
        check_in_verification_method, check_out_verification_method, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      generateId(),
      staff1Id,
      pastAttendance1,
      '2026-09-01T08:37:00.000Z',
      '2026-09-01T17:04:00.000Z',
      '102.129.144.1',
      '102.129.144.1',
      'OFFICE_IP',
      'OFFICE_IP',
      'CHECKED_OUT',
      '2026-09-01T08:37:00.000Z',
      '2026-09-01T17:04:00.000Z'
    );

    db.prepare(`
      INSERT OR IGNORE INTO attendance (
        id, staff_id, date, check_in, check_out, check_in_ip, check_out_ip,
        check_in_verification_method, check_out_verification_method, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      generateId(),
      staff1Id,
      pastAttendance2,
      '2026-08-31T08:45:00.000Z',
      '2026-08-31T17:19:00.000Z',
      '102.129.144.1',
      '102.129.144.1',
      'OFFICE_IP',
      'OFFICE_IP',
      'CHECKED_OUT',
      '2026-08-31T08:45:00.000Z',
      '2026-08-31T17:19:00.000Z'
    );
  }

  // 4. Seed Sample Staff (Jane Smith - Active)
  const staff2Email = 'jane.smith@example.com';
  const existingStaff2 = db.prepare('SELECT id FROM users WHERE email = ?').get(staff2Email);
  if (!existingStaff2) {
    const passwordHash = await hashPassword('StaffSecure123!');
    db.prepare(`
      INSERT INTO users (id, email, password_hash, first_name, last_name, phone, department, role, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'STAFF', 'ACTIVE', ?, ?)
    `).run(
      generateId(),
      staff2Email,
      passwordHash,
      'Jane',
      'Smith',
      '+234 804 000 0004',
      'Finance & Accounting',
      now,
      now
    );
    console.log(`[Seed] Created demo STAFF account: ${staff2Email}`);
  }

  // 5. Seed Suspended Staff (for testing suspension rejection)
  const suspendedEmail = 'suspended.user@example.com';
  const existingSuspended = db.prepare('SELECT id FROM users WHERE email = ?').get(suspendedEmail);
  if (!existingSuspended) {
    const passwordHash = await hashPassword('SuspendedPass123!');
    db.prepare(`
      INSERT INTO users (id, email, password_hash, first_name, last_name, phone, department, role, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'STAFF', 'SUSPENDED', ?, ?)
    `).run(
      generateId(),
      suspendedEmail,
      passwordHash,
      'Suspended',
      'Employee',
      '+234 805 000 0005',
      'Logistics',
      now,
      now
    );
    console.log(`[Seed] Created demo SUSPENDED account: ${suspendedEmail}`);
  }

  // 6. Seed System Settings
  // In production, office IPs must be configured via environment (OFFICE_IPS) or explicit Super Admin settings
  const initialOfficeIps = process.env.OFFICE_IPS
    ? process.env.OFFICE_IPS.split(',').map((s) => s.trim()).filter(Boolean)
    : [];

  const defaultSettings = [
    {
      key: 'approvedOfficeIPs',
      value: JSON.stringify(initialOfficeIps),
      description: 'Approved public IP addresses for company office network Wi-Fi check-in',
    },
    {
      key: 'workStartTime',
      value: '08:00',
      description: 'Standard work day start time (24h format)',
    },
    {
      key: 'workEndTime',
      value: '17:00',
      description: 'Standard work day end time (24h format)',
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

  const insertSetting = db.prepare(`
    INSERT INTO system_settings (id, key, value, description, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      description = excluded.description,
      updated_at = excluded.updated_at
    WHERE system_settings.value IS NULL OR system_settings.value = '' OR system_settings.key = 'approvedOfficeIPs'
  `);

  for (const setting of defaultSettings) {
    insertSetting.run(generateId(), setting.key, setting.value, setting.description, now);
  }
}
