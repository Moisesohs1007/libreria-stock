import os
import sqlite3
from contextlib import contextmanager


SCHEMA = """
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS print_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  printer_name TEXT NOT NULL,
  pages INTEGER NOT NULL,
  pages_estimated INTEGER NOT NULL DEFAULT 0,
  copies_requested INTEGER NOT NULL DEFAULT 1,
  print_type TEXT NOT NULL,
  ts_created TEXT NOT NULL,
  ts_completed TEXT,
  document TEXT NOT NULL,
  user_id TEXT NOT NULL,
  windows_owner TEXT,
  windows_machine TEXT,
  spool_job_id INTEGER,
  status TEXT NOT NULL,
  error_code TEXT,
  raw_status INTEGER
);

CREATE INDEX IF NOT EXISTS idx_print_jobs_ts_created ON print_jobs(ts_created);
CREATE INDEX IF NOT EXISTS idx_print_jobs_ts_completed ON print_jobs(ts_completed);
CREATE INDEX IF NOT EXISTS idx_print_jobs_printer ON print_jobs(printer_name);
CREATE INDEX IF NOT EXISTS idx_print_jobs_user ON print_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_print_jobs_status ON print_jobs(status);

CREATE TABLE IF NOT EXISTS print_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  print_job_id INTEGER NOT NULL REFERENCES print_jobs(id) ON DELETE CASCADE,
  ts TEXT NOT NULL,
  event_type TEXT NOT NULL,
  details TEXT
);

CREATE INDEX IF NOT EXISTS idx_print_events_job ON print_events(print_job_id);
CREATE INDEX IF NOT EXISTS idx_print_events_ts ON print_events(ts);
"""

ALLOWED_PRINT_TYPES = {"BN", "Color", "Desconocido"}
ALLOWED_STATUSES = {"started", "completed", "failed"}


def _validate_row(row):
  printer = (row.get("printer_name") or "").strip()
  if not printer:
    raise ValueError("printer_name requerido")
  doc = (row.get("document") or "").strip()
  if not doc:
    raise ValueError("document requerido")
  user_id = (row.get("user_id") or "").strip()
  if not user_id:
    raise ValueError("user_id requerido")
  try:
    pages = int(row.get("pages", 0))
  except Exception:
    raise ValueError("pages inválido")
  if pages < 0:
    raise ValueError("pages no puede ser negativo")
  try:
    pages_est = int(row.get("pages_estimated", 0))
  except Exception:
    raise ValueError("pages_estimated inválido")
  if pages_est < 0:
    raise ValueError("pages_estimated no puede ser negativo")
  try:
    copies = int(row.get("copies_requested", 1))
  except Exception:
    raise ValueError("copies_requested inválido")
  if copies < 1:
    raise ValueError("copies_requested debe ser >= 1")
  ptype = row.get("print_type")
  if ptype not in ALLOWED_PRINT_TYPES:
    raise ValueError("print_type inválido")
  status = row.get("status")
  if status not in ALLOWED_STATUSES:
    raise ValueError("status inválido")
  ts_created = (row.get("ts_created") or "").strip()
  if not ts_created:
    raise ValueError("ts_created requerido")


def default_db_path():
  base = os.environ.get("PROGRAMDATA") or os.getcwd()
  return os.path.join(base, "LibreriaPrintMonitor", "print_jobs.sqlite3")


def ensure_db_dir(path):
  d = os.path.dirname(os.path.abspath(path))
  os.makedirs(d, exist_ok=True)


def connect(db_path):
  ensure_db_dir(db_path)
  conn = sqlite3.connect(db_path, check_same_thread=False)
  conn.row_factory = sqlite3.Row
  return conn


def init_db(conn):
  conn.executescript(SCHEMA)
  cur = conn.execute("PRAGMA table_info(print_jobs)")
  cols = {r[1] for r in cur.fetchall()}
  if "pages_estimated" not in cols:
    conn.execute("ALTER TABLE print_jobs ADD COLUMN pages_estimated INTEGER NOT NULL DEFAULT 0")
  if "copies_requested" not in cols:
    conn.execute("ALTER TABLE print_jobs ADD COLUMN copies_requested INTEGER NOT NULL DEFAULT 1")
  conn.commit()


@contextmanager
def db_cursor(conn):
  cur = conn.cursor()
  try:
    yield cur
    conn.commit()
  finally:
    cur.close()


def insert_print_job(conn, row):
  _validate_row(row)
  with db_cursor(conn) as cur:
    cur.execute(
      """
      INSERT INTO print_jobs (
        printer_name, pages, pages_estimated, copies_requested, print_type, ts_created, ts_completed,
        document, user_id, windows_owner, windows_machine, spool_job_id,
        status, error_code, raw_status
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      """,
      (
        row["printer_name"],
        row["pages"],
        row.get("pages_estimated", 0),
        row.get("copies_requested", 1),
        row["print_type"],
        row["ts_created"],
        row.get("ts_completed"),
        row["document"],
        row["user_id"],
        row.get("windows_owner"),
        row.get("windows_machine"),
        row.get("spool_job_id"),
        row["status"],
        row.get("error_code"),
        row.get("raw_status"),
      ),
    )
    return cur.lastrowid


def update_print_job(conn, print_job_id, patch):
  if "pages" in patch:
    try:
      patch["pages"] = int(patch["pages"])
    except Exception:
      raise ValueError("pages inválido")
    if patch["pages"] < 0:
      raise ValueError("pages no puede ser negativo")
  if "pages_estimated" in patch:
    try:
      patch["pages_estimated"] = int(patch["pages_estimated"])
    except Exception:
      raise ValueError("pages_estimated inválido")
    if patch["pages_estimated"] < 0:
      raise ValueError("pages_estimated no puede ser negativo")
  if "copies_requested" in patch:
    try:
      patch["copies_requested"] = int(patch["copies_requested"])
    except Exception:
      raise ValueError("copies_requested inválido")
    if patch["copies_requested"] < 1:
      raise ValueError("copies_requested debe ser >= 1")
  if "print_type" in patch and patch["print_type"] not in ALLOWED_PRINT_TYPES:
    raise ValueError("print_type inválido")
  if "status" in patch and patch["status"] not in ALLOWED_STATUSES:
    raise ValueError("status inválido")
  keys = list(patch.keys())
  if not keys:
    return
  sets = ", ".join([f"{k}=?" for k in keys])
  values = [patch[k] for k in keys] + [print_job_id]
  with db_cursor(conn) as cur:
    cur.execute(f"UPDATE print_jobs SET {sets} WHERE id=?", values)


def insert_event(conn, print_job_id, ts, event_type, details=None):
  with db_cursor(conn) as cur:
    cur.execute(
      "INSERT INTO print_events (print_job_id, ts, event_type, details) VALUES (?,?,?,?)",
      (print_job_id, ts, event_type, details),
    )


def query_print_jobs(conn, where_sql, params, order_sql="ORDER BY id DESC", limit=None, offset=None):
  sql = f"SELECT * FROM print_jobs WHERE 1=1 {where_sql} {order_sql}"
  if limit is not None:
    sql += " LIMIT ?"
    params = list(params) + [int(limit)]
  if offset is not None:
    sql += " OFFSET ?"
    params = list(params) + [int(offset)]
  cur = conn.execute(sql, params)
  return [dict(r) for r in cur.fetchall()]


def query_totals(conn, where_sql, params):
  cur = conn.execute(
    f"""
    SELECT
      COALESCE(SUM(CASE WHEN status='completed' THEN pages ELSE 0 END), 0) AS pages_total,
      COALESCE(SUM(CASE WHEN status='completed' AND print_type='BN' THEN pages ELSE 0 END), 0) AS pages_bn,
      COALESCE(SUM(CASE WHEN status='completed' AND print_type='Color' THEN pages ELSE 0 END), 0) AS pages_color,
      COALESCE(SUM(CASE WHEN status='completed' THEN pages_estimated ELSE 0 END), 0) AS pages_total_estimated,
      COALESCE(SUM(CASE WHEN status='completed' AND print_type='BN' THEN pages_estimated ELSE 0 END), 0) AS pages_bn_estimated,
      COALESCE(SUM(CASE WHEN status='completed' AND print_type='Color' THEN pages_estimated ELSE 0 END), 0) AS pages_color_estimated,
      COALESCE(SUM(CASE WHEN status LIKE 'failed%%' THEN 1 ELSE 0 END), 0) AS failed_jobs,
      COALESCE(SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END), 0) AS completed_jobs
    FROM print_jobs
    WHERE 1=1 {where_sql}
    """,
    params,
  )
  return dict(cur.fetchone())


def query_by_printer(conn, where_sql, params):
  cur = conn.execute(
    f"""
    SELECT
      printer_name,
      COALESCE(SUM(CASE WHEN status='completed' THEN pages ELSE 0 END), 0) AS pages_total,
      COALESCE(SUM(CASE WHEN status='completed' AND print_type='BN' THEN pages ELSE 0 END), 0) AS pages_bn,
      COALESCE(SUM(CASE WHEN status='completed' AND print_type='Color' THEN pages ELSE 0 END), 0) AS pages_color,
      COALESCE(SUM(CASE WHEN status='completed' THEN pages_estimated ELSE 0 END), 0) AS pages_total_estimated,
      COALESCE(SUM(CASE WHEN status='completed' AND print_type='BN' THEN pages_estimated ELSE 0 END), 0) AS pages_bn_estimated,
      COALESCE(SUM(CASE WHEN status='completed' AND print_type='Color' THEN pages_estimated ELSE 0 END), 0) AS pages_color_estimated,
      COALESCE(SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END), 0) AS jobs_completed,
      COALESCE(SUM(CASE WHEN status LIKE 'failed%%' THEN 1 ELSE 0 END), 0) AS jobs_failed
    FROM print_jobs
    WHERE 1=1 {where_sql}
    GROUP BY printer_name
    ORDER BY pages_total DESC, printer_name ASC
    """,
    params,
  )
  return [dict(r) for r in cur.fetchall()]


def query_distinct(conn, field):
  cur = conn.execute(f"SELECT DISTINCT {field} AS v FROM print_jobs WHERE {field} IS NOT NULL AND {field}<>'' ORDER BY v ASC")
  return [r["v"] for r in cur.fetchall()]

