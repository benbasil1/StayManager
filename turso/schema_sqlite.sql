-- StayManager: Supabase (Postgres) -> Turso (SQLite) schema
-- Notes:
--  * uuid / timestamptz / date / time columns are stored as TEXT (timestamps as UTC ISO-8601).
--  * boolean columns are INTEGER 0/1.
--  * id_doc_paths (text[]) is stored as a JSON array in TEXT.
--  * owner_id / user_id kept as plain TEXT: Supabase Auth (auth.users) does not exist in Turso.
--  * Row-Level Security policies are not part of SQLite; enforce access in your API code.

PRAGMA foreign_keys = ON;

CREATE TABLE properties (
  id                     TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  owner_id               TEXT NOT NULL,
  name                   TEXT NOT NULL,
  created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  voice_number           TEXT NOT NULL DEFAULT '',
  voice_aliases          TEXT NOT NULL DEFAULT '',
  address                TEXT NOT NULL DEFAULT '',
  locality               TEXT NOT NULL DEFAULT '',
  amenities              TEXT NOT NULL DEFAULT '',
  food_details           TEXT NOT NULL DEFAULT '',
  house_rules            TEXT NOT NULL DEFAULT '',
  deposit_note           TEXT NOT NULL DEFAULT '',
  owner_phone            TEXT NOT NULL DEFAULT '',
  visit_start            TEXT NOT NULL DEFAULT '09:00:00',
  visit_end              TEXT NOT NULL DEFAULT '17:00:00',
  visit_slot_minutes     INTEGER NOT NULL DEFAULT 30 CHECK (visit_slot_minutes >= 10 AND visit_slot_minutes <= 240),
  reservation_hold_hours INTEGER NOT NULL DEFAULT 48 CHECK (reservation_hold_hours >= 1 AND reservation_hold_hours <= 720)
);

CREATE TABLE rooms (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  room_no     TEXT NOT NULL,
  floor       INTEGER NOT NULL DEFAULT 1,
  price       INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE beds (
  id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  room_id      TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  label        TEXT NOT NULL,
  occupied     INTEGER NOT NULL DEFAULT 0 CHECK (occupied IN (0, 1)),
  vacant_since TEXT
);

CREATE TABLE tenants (
  id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  property_id  TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  bed_id       TEXT REFERENCES beds(id) ON DELETE SET NULL,
  name         TEXT NOT NULL,
  phone        TEXT NOT NULL DEFAULT '',
  whatsapp     TEXT NOT NULL DEFAULT '',
  email        TEXT NOT NULL DEFAULT '',
  rent_amount  INTEGER NOT NULL DEFAULT 0,
  deposit      INTEGER NOT NULL DEFAULT 0,
  move_in      TEXT NOT NULL DEFAULT (date('now')),
  move_out     TEXT,
  due_day      INTEGER NOT NULL DEFAULT 5 CHECK (due_day >= 1 AND due_day <= 28),
  notes        TEXT NOT NULL DEFAULT '',
  id_type      TEXT NOT NULL DEFAULT '',
  id_last4     TEXT NOT NULL DEFAULT '',
  id_doc_paths TEXT NOT NULL DEFAULT '[]',
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'left')),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  leaving_on   TEXT
);

CREATE TABLE bed_reservations (
  id             TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  property_id    TEXT NOT NULL REFERENCES properties(id),
  bed_id         TEXT REFERENCES beds(id) ON DELETE SET NULL,
  guest_name     TEXT NOT NULL DEFAULT '',
  guest_phone    TEXT NOT NULL DEFAULT '',
  move_in_date   TEXT,
  advance_amount INTEGER NOT NULL DEFAULT 0 CHECK (advance_amount >= 0),
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'cancelled', 'expired', 'converted')),
  source         TEXT NOT NULL DEFAULT 'app' CHECK (source IN ('app', 'voice')),
  call_id        TEXT,
  notes          TEXT NOT NULL DEFAULT '',
  expires_at     TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE calls (
  id               TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  property_id      TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  caller_name      TEXT NOT NULL DEFAULT 'Unknown caller',
  summary          TEXT NOT NULL DEFAULT '',
  intent           TEXT NOT NULL DEFAULT 'other' CHECK (intent IN ('bed_vacancy', 'room_vacancy', 'price_query', 'complaint', 'request', 'other')),
  sentiment        TEXT NOT NULL DEFAULT 'green' CHECK (sentiment IN ('green', 'orange', 'red')),
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  caller_phone     TEXT NOT NULL DEFAULT '',
  call_id          TEXT UNIQUE,
  transcript       TEXT NOT NULL DEFAULT '',
  needs_follow_up  INTEGER NOT NULL DEFAULT 0 CHECK (needs_follow_up IN (0, 1)),
  flags            TEXT NOT NULL DEFAULT ''
);

CREATE TABLE complaints (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  property_id     TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  tenant_name     TEXT NOT NULL,
  message         TEXT NOT NULL,
  category        TEXT NOT NULL DEFAULT 'General',
  priority        TEXT NOT NULL DEFAULT 'low' CHECK (priority IN ('low', 'medium', 'high')),
  kind            TEXT NOT NULL DEFAULT 'complaint' CHECK (kind IN ('request', 'query', 'complaint')),
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved')),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  caller_phone    TEXT,
  notified_status TEXT
);

CREATE TABLE feedback (
  id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  user_id    TEXT NOT NULL,
  user_email TEXT,
  kind       TEXT NOT NULL DEFAULT 'idea' CHECK (kind IN ('bug', 'idea', 'praise', 'other')),
  message    TEXT NOT NULL CHECK (length(message) >= 3 AND length(message) <= 2000),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE payments (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE RESTRICT,
  tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  amount      INTEGER NOT NULL CHECK (amount > 0),
  paid_on     TEXT NOT NULL DEFAULT (date('now')),
  for_month   TEXT NOT NULL,
  method      TEXT NOT NULL DEFAULT 'UPI',
  note        TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  proof_path  TEXT
);

CREATE TABLE property_staff (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  name        TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE visits (
  id               TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  property_id      TEXT NOT NULL REFERENCES properties(id),
  visitor_name     TEXT NOT NULL DEFAULT '',
  visitor_phone    TEXT NOT NULL DEFAULT '',
  visit_at         TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 30,
  status           TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled', 'no_show')),
  source           TEXT NOT NULL DEFAULT 'app' CHECK (source IN ('app', 'voice')),
  call_id          TEXT,
  notes            TEXT NOT NULL DEFAULT '',
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE webhook_secrets (
  name       TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Files (ID photos, payment screenshots). Bytes are kept apart from the other tables so lists stay fast.
-- (The API also creates this table on first use if it is missing.)
CREATE TABLE files (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  tenant_id   TEXT,
  name        TEXT NOT NULL DEFAULT '',
  mime        TEXT NOT NULL,
  size        INTEGER NOT NULL,
  data        BLOB NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_files_property ON files(property_id);
CREATE INDEX idx_files_owner    ON files(owner_id);

-- Helpful indexes on foreign keys (SQLite does not create these automatically)
CREATE INDEX idx_rooms_property        ON rooms(property_id);
CREATE INDEX idx_beds_room             ON beds(room_id);
CREATE INDEX idx_tenants_property      ON tenants(property_id);
CREATE INDEX idx_tenants_bed           ON tenants(bed_id);
CREATE INDEX idx_reservations_property ON bed_reservations(property_id);
CREATE INDEX idx_reservations_bed      ON bed_reservations(bed_id);
CREATE INDEX idx_calls_property        ON calls(property_id);
CREATE INDEX idx_complaints_property   ON complaints(property_id);
CREATE INDEX idx_payments_property     ON payments(property_id);
CREATE INDEX idx_payments_tenant       ON payments(tenant_id);
CREATE INDEX idx_staff_property        ON property_staff(property_id);
CREATE UNIQUE INDEX property_staff_uniq ON property_staff(property_id, lower(email));
CREATE INDEX idx_visits_property       ON visits(property_id);

-- bed_status: rewritten for SQLite (Postgres LATERAL join -> correlated subquery)
CREATE VIEW bed_status AS
SELECT
  b.id            AS bed_id,
  r.property_id   AS property_id,
  r.id            AS room_id,
  r.room_no       AS room_no,
  r.floor         AS floor,
  r.price         AS price,
  b.label         AS label,
  b.occupied      AS occupied,
  b.vacant_since  AS vacant_since,
  res.id          AS reservation_id,
  res.guest_name  AS reserved_for,
  res.status      AS reservation_status,
  res.expires_at  AS reservation_expires_at,
  CASE WHEN b.occupied = 0 AND res.id IS NULL THEN 1 ELSE 0 END AS is_free
FROM beds b
JOIN rooms r ON r.id = b.room_id
LEFT JOIN bed_reservations res ON res.id = (
  SELECT x.id
  FROM bed_reservations x
  WHERE x.bed_id = b.id
    AND (x.status = 'confirmed'
         OR (x.status = 'pending'
             AND (x.expires_at IS NULL OR x.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))))
  ORDER BY x.created_at DESC
  LIMIT 1
);
