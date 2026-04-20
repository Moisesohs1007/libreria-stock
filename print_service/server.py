import json
import os
from datetime import datetime

from flask import Flask, Response, jsonify, request
from flask_cors import CORS
from flask_socketio import SocketIO

from . import db as dbmod
from .exports import export_excel, export_pdf
from .filters import build_where
from .monitor import PrintMonitor, now_tz_iso


def _env_int(name, default):
  try:
    return int(os.environ.get(name, default))
  except Exception:
    return int(default)


def _get_token():
  t = os.environ.get("PRINT_API_TOKEN", "").strip()
  return t or None


def _require_token():
  token = _get_token()
  if not token:
    return None
  got = (request.headers.get("X-Print-Token") or "").strip()
  if got != token:
    return Response(status=401)
  return None


def _parse_limit_offset():
  limit = request.args.get("limit")
  offset = request.args.get("offset")
  lim = None
  off = None
  if limit is not None:
    lim = max(1, min(2000, int(limit)))
  if offset is not None:
    off = max(0, int(offset))
  return lim, off


def create_app():
  app = Flask(__name__)
  CORS(app)
  socketio = SocketIO(app, cors_allowed_origins="*")

  db_path = os.environ.get("PRINT_DB_PATH") or dbmod.default_db_path()
  conn = dbmod.connect(db_path)
  dbmod.init_db(conn)

  logo_path = os.environ.get("PRINT_LOGO_PATH")
  if not logo_path:
    root_logo = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "virgen.png"))
    logo_path = root_logo if os.path.exists(root_logo) else None

  def emit_update(print_job_id):
    try:
      socketio.emit("prints:finalized", {"id": int(print_job_id), "ts": now_tz_iso()})
    except Exception:
      pass

  disable_monitor = (os.environ.get("PRINT_DISABLE_MONITOR") or "").strip() == "1"
  if not disable_monitor:
    monitor = PrintMonitor(conn, on_finalized=emit_update, poll_interval_s=_env_int("PRINT_POLL_S", 1))
    monitor.start()

  @app.get("/api/prints/health")
  def health():
    err = _require_token()
    if err:
      return err
    return jsonify({"ok": True, "ts": now_tz_iso()})

  @app.get("/api/prints/meta")
  def meta():
    err = _require_token()
    if err:
      return err
    printers = dbmod.query_distinct(conn, "printer_name")
    users = dbmod.query_distinct(conn, "user_id")
    return jsonify({"printers": printers, "users": users})

  @app.get("/api/prints")
  def list_prints():
    err = _require_token()
    if err:
      return err
    try:
      where, params = build_where(request.args)
    except ValueError as e:
      return jsonify({"error": str(e)}), 400
    lim, off = _parse_limit_offset()
    rows = dbmod.query_print_jobs(conn, where, params, limit=lim, offset=off)
    totals = dbmod.query_totals(conn, where, params)
    return jsonify({"rows": rows, "totals": totals})

  @app.get("/api/prints/summary")
  def summary():
    err = _require_token()
    if err:
      return err
    try:
      where, params = build_where(request.args)
    except ValueError as e:
      return jsonify({"error": str(e)}), 400
    totals = dbmod.query_totals(conn, where, params)
    by_printer = dbmod.query_by_printer(conn, where, params)
    return jsonify({"totals": totals, "by_printer": by_printer})

  @app.get("/api/prints/my-summary")
  def my_summary():
    err = _require_token()
    if err:
      return err
    user_id = (request.args.get("user_id") or "").strip()
    if not user_id:
      return jsonify({"error": "user_id requerido"}), 400
    where = " AND (user_id=? OR user_id LIKE ?)"
    params = [user_id, f"{user_id}@%"]
    totals = dbmod.query_totals(conn, where, params)
    return jsonify({"user_id": user_id, "totals": totals})

  @app.delete("/api/prints/<int:print_id>")
  def delete_print(print_id):
    err = _require_token()
    if err:
      return err
    with dbmod.db_cursor(conn) as cur:
      cur.execute("DELETE FROM print_jobs WHERE id=?", (print_id,))
      ok = cur.rowcount > 0
    if ok:
      socketio.emit("prints:deleted", {"id": print_id, "ts": now_tz_iso()})
    return jsonify({"ok": ok})

  @app.get("/api/prints/export/excel")
  def export_xlsx():
    err = _require_token()
    if err:
      return err
    try:
      where, params = build_where(request.args)
    except ValueError as e:
      return jsonify({"error": str(e)}), 400
    rows = dbmod.query_print_jobs(conn, where, params, order_sql="ORDER BY id ASC", limit=20000)
    totals = dbmod.query_totals(conn, where, params)
    data = export_excel(rows, totals)
    fname = f"impresiones_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
    return Response(
      data,
      mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )

  @app.get("/api/prints/export/pdf")
  def export_pdf_endpoint():
    err = _require_token()
    if err:
      return err
    try:
      where, params = build_where(request.args)
    except ValueError as e:
      return jsonify({"error": str(e)}), 400
    rows = dbmod.query_print_jobs(conn, where, params, order_sql="ORDER BY id ASC", limit=5000)
    totals = dbmod.query_totals(conn, where, params)
    data = export_pdf(rows, totals, logo_path=logo_path)
    fname = f"impresiones_{datetime.now().strftime('%Y%m%d_%H%M%S')}.pdf"
    return Response(
      data,
      mimetype="application/pdf",
      headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )

  @app.get("/api/prints/config")
  def get_config():
    err = _require_token()
    if err:
      return err
    token_enabled = _get_token() is not None
    return jsonify(
      {
        "db_path": db_path,
        "token_enabled": token_enabled,
      }
    )

  @socketio.on("connect")
  def _ws_connect():
    return None

  @socketio.on("prints:ping")
  def _ws_ping(payload):
    socketio.emit("prints:pong", {"ts": now_tz_iso(), "echo": payload})

  return app, socketio


def main():
  app, socketio = create_app()
  host = os.environ.get("PRINT_HOST") or "0.0.0.0"
  port = _env_int("PRINT_PORT", 5056)
  socketio.run(app, host=host, port=port, allow_unsafe_werkzeug=True)


if __name__ == "__main__":
  main()

