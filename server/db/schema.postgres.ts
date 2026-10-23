import type { Pool, PoolClient } from 'pg';

export const POSTGRES_SCHEMA_SQL = `
-- 1. Users Table
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  password_hash TEXT NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  phone VARCHAR(50),
  department VARCHAR(100),
  role VARCHAR(30) NOT NULL CHECK (role IN ('SUPER_ADMIN', 'ADMIN', 'STAFF')),
  status VARCHAR(30) NOT NULL CHECK (status IN ('ACTIVE', 'SUSPENDED', 'REMOVED')) DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_users_status ON users (status);
CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);

-- 2. Sessions Table
CREATE TABLE IF NOT EXISTS sessions (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(128) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  ip_address VARCHAR(64),
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions (token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions (expires_at);

-- 3. Audit Logs Table (Immutable Audit Trail)
CREATE TABLE IF NOT EXISTS audit_logs (
  id VARCHAR(64) PRIMARY KEY,
  actor_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(100) NOT NULL,
  target_user_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
  ip_address VARCHAR(64),
  user_agent TEXT,
  metadata TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_id ON audit_logs (actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs (action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs (created_at);

-- 4. System Settings Table
CREATE TABLE IF NOT EXISTS system_settings (
  id VARCHAR(64) PRIMARY KEY,
  key VARCHAR(100) NOT NULL UNIQUE,
  value TEXT NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_system_settings_key ON system_settings (key);

-- 5. Attendance Records Table
CREATE TABLE IF NOT EXISTS attendance (
  id VARCHAR(64) PRIMARY KEY,
  staff_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date VARCHAR(10) NOT NULL,
  check_in TIMESTAMPTZ,
  check_out TIMESTAMPTZ,
  check_in_ip VARCHAR(64),
  check_out_ip VARCHAR(64),
  check_in_user_agent TEXT,
  check_out_user_agent TEXT,
  check_in_verification_method VARCHAR(50),
  check_out_verification_method VARCHAR(50),
  status VARCHAR(50) NOT NULL,
  override_reason TEXT,
  override_admin_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_attendance_staff_date UNIQUE (staff_id, date)
);

CREATE INDEX IF NOT EXISTS idx_attendance_staff_id ON attendance (staff_id);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance (date);
CREATE INDEX IF NOT EXISTS idx_attendance_staff_date ON attendance (staff_id, date);

-- 6. Events Table
CREATE TABLE IF NOT EXISTS events (
  id VARCHAR(64) PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  location VARCHAR(255) NOT NULL,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  status VARCHAR(50) NOT NULL CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELLED', 'COMPLETED')) DEFAULT 'DRAFT',
  created_by VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  approved_by VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_events_status ON events (status);
CREATE INDEX IF NOT EXISTS idx_events_created_by ON events (created_by);
CREATE INDEX IF NOT EXISTS idx_events_start_at ON events (start_at);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events (created_at);

-- 7. Access Passes Table
CREATE TABLE IF NOT EXISTS access_passes (
  id VARCHAR(64) PRIMARY KEY,
  pass_type VARCHAR(20) NOT NULL CHECK (pass_type IN ('EVENT', 'VISITOR')),
  event_id VARCHAR(64) REFERENCES events(id) ON DELETE CASCADE,
  host_staff_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
  token_hash VARCHAR(128) NOT NULL UNIQUE,
  display_code VARCHAR(64) NOT NULL UNIQUE,
  valid_from TIMESTAMPTZ NOT NULL,
  valid_until TIMESTAMPTZ NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('ACTIVE', 'REVOKED', 'EXPIRED', 'EXHAUSTED')) DEFAULT 'ACTIVE',
  max_uses INTEGER,
  use_count INTEGER NOT NULL DEFAULT 0,
  created_by VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TIMESTAMPTZ,
  revoked_by VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
  revoke_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_access_passes_token_hash ON access_passes (token_hash);
CREATE INDEX IF NOT EXISTS idx_access_passes_display_code ON access_passes (display_code);
CREATE INDEX IF NOT EXISTS idx_access_passes_status ON access_passes (status);
CREATE INDEX IF NOT EXISTS idx_access_passes_valid_until ON access_passes (valid_until);
CREATE INDEX IF NOT EXISTS idx_access_passes_event_id ON access_passes (event_id);
CREATE INDEX IF NOT EXISTS idx_access_passes_host_staff_id ON access_passes (host_staff_id);

-- 8. Event Invitees Table
CREATE TABLE IF NOT EXISTS event_invitees (
  id VARCHAR(64) PRIMARY KEY,
  event_id VARCHAR(64) NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  full_name VARCHAR(255) NOT NULL,
  phone VARCHAR(50),
  email VARCHAR(255),
  organization VARCHAR(255),
  notes TEXT,
  status VARCHAR(30) NOT NULL CHECK (status IN ('INVITED', 'ACCESS_ISSUED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED')) DEFAULT 'INVITED',
  access_pass_id VARCHAR(64) REFERENCES access_passes(id) ON DELETE SET NULL,
  invited_by VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_event_invitees_event_id ON event_invitees (event_id);
CREATE INDEX IF NOT EXISTS idx_event_invitees_status ON event_invitees (status);
CREATE INDEX IF NOT EXISTS idx_event_invitees_access_pass_id ON event_invitees (access_pass_id);
CREATE INDEX IF NOT EXISTS idx_event_invitees_email ON event_invitees (email);

-- 9. Visitor Visits Table
CREATE TABLE IF NOT EXISTS visitor_visits (
  id VARCHAR(64) PRIMARY KEY,
  host_staff_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  visitor_full_name VARCHAR(255) NOT NULL,
  visitor_phone VARCHAR(50),
  visitor_email VARCHAR(255),
  purpose TEXT,
  notes TEXT,
  valid_from TIMESTAMPTZ NOT NULL,
  valid_until TIMESTAMPTZ NOT NULL,
  status VARCHAR(30) NOT NULL CHECK (status IN ('PENDING', 'ACCESS_ISSUED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'EXPIRED')) DEFAULT 'PENDING',
  access_pass_id VARCHAR(64) REFERENCES access_passes(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cancelled_at TIMESTAMPTZ,
  cancelled_by VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_visitor_visits_host_staff_id ON visitor_visits (host_staff_id);
CREATE INDEX IF NOT EXISTS idx_visitor_visits_status ON visitor_visits (status);
CREATE INDEX IF NOT EXISTS idx_visitor_visits_access_pass_id ON visitor_visits (access_pass_id);
CREATE INDEX IF NOT EXISTS idx_visitor_visits_valid_from ON visitor_visits (valid_from);
CREATE INDEX IF NOT EXISTS idx_visitor_visits_valid_until ON visitor_visits (valid_until);
CREATE INDEX IF NOT EXISTS idx_visitor_visits_visitor_email ON visitor_visits (visitor_email);

-- 10. Access Visits Table (Reception Check-in / Check-out Attendance Log)
CREATE TABLE IF NOT EXISTS access_visits (
  id VARCHAR(64) PRIMARY KEY,
  access_pass_id VARCHAR(64) NOT NULL REFERENCES access_passes(id) ON DELETE CASCADE,
  pass_type VARCHAR(20) NOT NULL CHECK (pass_type IN ('EVENT', 'VISITOR')),
  event_invitee_id VARCHAR(64) REFERENCES event_invitees(id) ON DELETE SET NULL,
  visitor_visit_id VARCHAR(64) REFERENCES visitor_visits(id) ON DELETE SET NULL,
  checked_in_at TIMESTAMPTZ,
  checked_in_by VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
  checked_out_at TIMESTAMPTZ,
  checked_out_by VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
  status VARCHAR(30) NOT NULL CHECK (status IN ('VERIFIED', 'CHECKED_IN', 'CHECKED_OUT', 'DENIED', 'CANCELLED')),
  denial_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_access_visits_access_pass_id ON access_visits (access_pass_id);
CREATE INDEX IF NOT EXISTS idx_access_visits_pass_type ON access_visits (pass_type);
CREATE INDEX IF NOT EXISTS idx_access_visits_event_invitee_id ON access_visits (event_invitee_id);
CREATE INDEX IF NOT EXISTS idx_access_visits_visitor_visit_id ON access_visits (visitor_visit_id);
CREATE INDEX IF NOT EXISTS idx_access_visits_status ON access_visits (status);
CREATE INDEX IF NOT EXISTS idx_access_visits_checked_in_at ON access_visits (checked_in_at);
CREATE INDEX IF NOT EXISTS idx_access_visits_checked_out_at ON access_visits (checked_out_at);

-- 11. Notifications Table (Phase 3A)
CREATE TABLE IF NOT EXISTS notifications (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  metadata TEXT,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications (user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created_at ON notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications (user_id, is_read);
`;

/**
 * Executes the PostgreSQL DDL schema against a pg.Pool or pg.PoolClient.
 */
export async function initializePostgresSchema(client: Pool | PoolClient): Promise<void> {
  await client.query(POSTGRES_SCHEMA_SQL);
}
