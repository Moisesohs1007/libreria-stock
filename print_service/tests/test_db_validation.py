import pytest

from print_service import db as dbmod


def test_insert_rejects_negative_pages(tmp_path):
  conn = dbmod.connect(str(tmp_path / "t.sqlite3"))
  dbmod.init_db(conn)
  row = {
    "printer_name": "P1",
    "pages": -1,
    "print_type": "BN",
    "ts_created": "2026-01-01T00:00:00+00:00",
    "ts_completed": None,
    "document": "Doc",
    "user_id": "u1",
    "windows_owner": "u1",
    "windows_machine": "PC",
    "spool_job_id": 1,
    "status": "started",
    "error_code": None,
    "raw_status": None,
  }
  with pytest.raises(ValueError):
    dbmod.insert_print_job(conn, row)


def test_update_rejects_negative_pages(tmp_path):
  conn = dbmod.connect(str(tmp_path / "t.sqlite3"))
  dbmod.init_db(conn)
  row = {
    "printer_name": "P1",
    "pages": 0,
    "print_type": "Desconocido",
    "ts_created": "2026-01-01T00:00:00+00:00",
    "ts_completed": None,
    "document": "Doc",
    "user_id": "u1",
    "windows_owner": "u1",
    "windows_machine": "PC",
    "spool_job_id": 1,
    "status": "started",
    "error_code": None,
    "raw_status": None,
  }
  pid = dbmod.insert_print_job(conn, row)
  with pytest.raises(ValueError):
    dbmod.update_print_job(conn, pid, {"pages": -5})

