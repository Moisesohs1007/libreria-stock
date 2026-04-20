from print_service.monitor import choose_pages, derive_error_code, is_success


def test_jam_detected_marks_failure():
  printer_state = {"DetectedErrorState": 8, "PrinterStatus": None, "WorkOffline": False}
  err = derive_error_code(None, printer_state)
  assert err == "JAMMED"
  assert is_success(None, printer_state, err) is False


def test_success_without_error():
  printer_state = {"DetectedErrorState": 2, "PrinterStatus": None, "WorkOffline": False}
  err = derive_error_code(None, printer_state)
  assert err is None
  assert is_success(None, printer_state, err) is True


def test_choose_pages_prefers_reported_counts():
  assert choose_pages(5, 0, 1, 0, True) == 5
  assert choose_pages(0, 3, 1, 0, True) == 3
  assert choose_pages(2, 7, 1, 0, True) == 7


def test_choose_pages_unknown_pages_success_defaults_to_one():
  assert choose_pages(0, 0, 1, 0, True) == 1
  assert choose_pages(None, None, 1, 0, True) == 1


def test_choose_pages_unknown_pages_failure_defaults_to_zero():
  assert choose_pages(0, 0, 1, 0, False) == 0


def test_choose_pages_accounts_for_copies_when_driver_reports_per_copy():
  assert choose_pages(1, 1, 2, 0, True) == 2
  assert choose_pages(2, 0, 3, 0, True) == 6


def test_choose_pages_accepts_queue_delta_as_fallback():
  assert choose_pages(1, 1, 1, 2, True) == 2

