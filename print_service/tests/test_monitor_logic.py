from print_service.monitor import derive_error_code, is_success


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

