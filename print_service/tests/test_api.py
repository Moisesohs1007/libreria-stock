import os

from print_service import db as dbmod
from print_service.server import create_app


def test_api_lists_and_summarizes(tmp_path, monkeypatch):
  db_path = str(tmp_path / "api.sqlite3")
  monkeypatch.setenv("PRINT_DB_PATH", db_path)
  monkeypatch.setenv("PRINT_DISABLE_MONITOR", "1")

  conn = dbmod.connect(db_path)
  dbmod.init_db(conn)
  dbmod.insert_print_job(
    conn,
    {
      "printer_name": "P1",
      "pages": 10,
      "print_type": "BN",
      "ts_created": "2026-01-02T00:00:00+00:00",
      "ts_completed": "2026-01-02T00:00:10+00:00",
      "document": "Doc1",
      "user_id": "u1",
      "windows_owner": "u1",
      "windows_machine": "PC",
      "spool_job_id": 1,
      "status": "completed",
      "error_code": None,
      "raw_status": 0,
    },
  )
  dbmod.insert_print_job(
    conn,
    {
      "printer_name": "P1",
      "pages": 5,
      "print_type": "Color",
      "ts_created": "2026-01-03T00:00:00+00:00",
      "ts_completed": "2026-01-03T00:00:10+00:00",
      "document": "Doc2",
      "user_id": "u1",
      "windows_owner": "u1",
      "windows_machine": "PC",
      "spool_job_id": 2,
      "status": "completed",
      "error_code": None,
      "raw_status": 0,
    },
  )

  app, _socketio = create_app()
  client = app.test_client()

  r = client.get("/api/prints/summary")
  assert r.status_code == 200
  data = r.get_json()
  assert data["totals"]["pages_total"] == 15
  assert data["totals"]["pages_bn"] == 10
  assert data["totals"]["pages_color"] == 5

