import pytest

from print_service.filters import build_where


def test_build_where_dates_and_lists():
  args = {"from": "2026-01-01T00:00:00+00:00", "to": "2026-01-31T23:59:59+00:00", "printers": "P1,P2", "users": "u1"}
  where, params = build_where(args)
  assert "ts_created" in where
  assert "printer_name IN" in where
  assert "user_id IN" in where
  assert len(params) == 2 + 2 + 1


def test_invalid_type_rejected():
  with pytest.raises(ValueError):
    build_where({"type": "X"})

