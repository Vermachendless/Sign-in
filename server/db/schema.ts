export const DB_SCHEMA_SQL = `
-- Users table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  phone TEXT,
  department TEXT,
  role TEXT NOT NULL CHECK(role IN ('SUPER_ADMIN', 'ADMIN', 'STAFF')),
  status TEXT NOT NULL CHECK(status IN ('ACTIVE', 'SUSPENDED', 'REMOVED')) DEFAULT 'ACTIVE',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Sessions table
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL,
  expires_at TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL
);

-- Audit logs table (Immutable)
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_id TEXT REFERENCES users(id),
  action TEXT NOT NULL,
  target_user_id TEXT REFERENCES users(id),
  ip_address TEXT,
  user_agent TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL
);

-- System settings table
CREATE TABLE IF NOT EXISTS system_settings (
  id TEXT PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  value TEXT NOT NULL,
  description TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT REFERENCES users(id)
);

-- Attendance records table (prepared for Phase 2)
CREATE TABLE IF NOT EXISTS attendance (
  id TEXT PRIMARY KEY,
  staff_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  check_in TEXT,
  check_out TEXT,
  check_in_ip TEXT,
  check_out_ip TEXT,
  check_in_user_agent TEXT,
  check_out_user_agent TEXT,
  check_in_verification_method TEXT,
  check_out_verification_method TEXT,
  status TEXT NOT NULL,
  override_reason TEXT,
  override_admin_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(staff_id, date)
);

-- Events table (Phase 6B)
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  location TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELLED', 'COMPLETED')) DEFAULT 'DRAFT',
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  approved_by TEXT REFERENCES users(id),
  approved_at TEXT,
  rejection_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Access passes table (Phase 6C)
CREATE TABLE IF NOT EXISTS access_passes (
  id TEXT PRIMARY KEY,
  pass_type TEXT NOT NULL CHECK(pass_type IN ('EVENT', 'VISITOR')),
  event_id TEXT REFERENCES events(id) ON DELETE CASCADE,
  host_staff_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  token_hash TEXT UNIQUE NOT NULL,
  display_code TEXT UNIQUE NOT NULL COLLATE NOCASE,
  valid_from TEXT NOT NULL,
  valid_until TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('ACTIVE', 'REVOKED', 'EXPIRED', 'EXHAUSTED')) DEFAULT 'ACTIVE',
  max_uses INTEGER,
  use_count INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revoked_at TEXT,
  revoked_by TEXT REFERENCES users(id),
  revoke_reason TEXT
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_id ON audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);

CREATE INDEX IF NOT EXISTS idx_attendance_staff_id ON attendance(staff_id);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date);
CREATE INDEX IF NOT EXISTS idx_attendance_staff_date ON attendance(staff_id, date);

CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
CREATE INDEX IF NOT EXISTS idx_events_created_by ON events(created_by);
CREATE INDEX IF NOT EXISTS idx_events_start_at ON events(start_at);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);

CREATE INDEX IF NOT EXISTS idx_access_passes_token_hash ON access_passes(token_hash);
CREATE INDEX IF NOT EXISTS idx_access_passes_display_code ON access_passes(display_code);
CREATE INDEX IF NOT EXISTS idx_access_passes_status ON access_passes(status);
CREATE INDEX IF NOT EXISTS idx_access_passes_valid_until ON access_passes(valid_until);
CREATE INDEX IF NOT EXISTS idx_access_passes_event_id ON access_passes(event_id);
CREATE INDEX IF NOT EXISTS idx_access_passes_host_staff_id ON access_passes(host_staff_id);

-- Event invitees table (Phase 6D)
CREATE TABLE IF NOT EXISTS event_invitees (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  phone TEXT,
  email TEXT COLLATE NOCASE,
  organization TEXT,
  notes TEXT,
  status TEXT NOT NULL CHECK(status IN ('INVITED', 'ACCESS_ISSUED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED')) DEFAULT 'INVITED',
  access_pass_id TEXT REFERENCES access_passes(id) ON DELETE SET NULL,
  invited_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_event_invitees_event_id ON event_invitees(event_id);
CREATE INDEX IF NOT EXISTS idx_event_invitees_status ON event_invitees(status);
CREATE INDEX IF NOT EXISTS idx_event_invitees_access_pass_id ON event_invitees(access_pass_id);
CREATE INDEX IF NOT EXISTS idx_event_invitees_email ON event_invitees(email);

-- Visitor visits table (Phase 6E)
CREATE TABLE IF NOT EXISTS visitor_visits (
  id TEXT PRIMARY KEY,
  host_staff_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  visitor_full_name TEXT NOT NULL,
  visitor_phone TEXT,
  visitor_email TEXT COLLATE NOCASE,
  purpose TEXT,
  notes TEXT,
  valid_from TEXT NOT NULL,
  valid_until TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('PENDING', 'ACCESS_ISSUED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'EXPIRED')) DEFAULT 'PENDING',
  access_pass_id TEXT REFERENCES access_passes(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  cancelled_at TEXT,
  cancelled_by TEXT REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_visitor_visits_host_staff_id ON visitor_visits(host_staff_id);
CREATE INDEX IF NOT EXISTS idx_visitor_visits_status ON visitor_visits(status);
CREATE INDEX IF NOT EXISTS idx_visitor_visits_access_pass_id ON visitor_visits(access_pass_id);
CREATE INDEX IF NOT EXISTS idx_visitor_visits_valid_from ON visitor_visits(valid_from);
CREATE INDEX IF NOT EXISTS idx_visitor_visits_valid_until ON visitor_visits(valid_until);
CREATE INDEX IF NOT EXISTS idx_visitor_visits_visitor_email ON visitor_visits(visitor_email);

-- Access visits / reception attendance table (Phase 6F)
CREATE TABLE IF NOT EXISTS access_visits (
  id TEXT PRIMARY KEY,
  access_pass_id TEXT NOT NULL REFERENCES access_passes(id) ON DELETE CASCADE,
  pass_type TEXT NOT NULL CHECK(pass_type IN ('EVENT', 'VISITOR')),
  event_invitee_id TEXT REFERENCES event_invitees(id) ON DELETE SET NULL,
  visitor_visit_id TEXT REFERENCES visitor_visits(id) ON DELETE SET NULL,
  checked_in_at TEXT,
  checked_in_by TEXT REFERENCES users(id),
  checked_out_at TEXT,
  checked_out_by TEXT REFERENCES users(id),
  status TEXT NOT NULL CHECK(status IN ('VERIFIED', 'CHECKED_IN', 'CHECKED_OUT', 'DENIED', 'CANCELLED')),
  denial_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_access_visits_access_pass_id ON access_visits(access_pass_id);
CREATE INDEX IF NOT EXISTS idx_access_visits_pass_type ON access_visits(pass_type);
CREATE INDEX IF NOT EXISTS idx_access_visits_event_invitee_id ON access_visits(event_invitee_id);
CREATE INDEX IF NOT EXISTS idx_access_visits_visitor_visit_id ON access_visits(visitor_visit_id);
CREATE INDEX IF NOT EXISTS idx_access_visits_status ON access_visits(status);
CREATE INDEX IF NOT EXISTS idx_access_visits_checked_in_at ON access_visits(checked_in_at);
CREATE INDEX IF NOT EXISTS idx_access_visits_checked_out_at ON access_visits(checked_out_at);
`;
