CREATE TABLE sessions (
  id              TEXT PRIMARY KEY,
  date            TEXT NOT NULL,
  day_id          TEXT NOT NULL,
  program_version INTEGER,
  status          TEXT NOT NULL,
  data            TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  seq             INTEGER NOT NULL
);
CREATE INDEX sessions_seq ON sessions(seq);
CREATE INDEX sessions_date ON sessions(date);

CREATE TABLE programs (
  version    INTEGER PRIMARY KEY AUTOINCREMENT,
  json       TEXT NOT NULL,
  source     TEXT NOT NULL,
  note       TEXT,
  created_at TEXT NOT NULL,
  active     INTEGER NOT NULL DEFAULT 0
);
-- At most one active program.
CREATE UNIQUE INDEX programs_one_active ON programs(active) WHERE active = 1;
