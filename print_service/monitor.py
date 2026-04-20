import os
import threading
import time
from datetime import datetime, timezone

import pythoncom
import wmi
import win32print


def now_tz_iso():
  return datetime.now(timezone.utc).isoformat(timespec="seconds")


def safe_int(x, default=0):
  try:
    v = int(x)
    return v
  except Exception:
    return default


def choose_pages(total_pages, pages_printed, copies, ok):
  tp = safe_int(total_pages, default=0)
  pp = safe_int(pages_printed, default=0)
  c = safe_int(copies, default=1)
  if c <= 0:
    c = 1
  base = max(tp, pp, 0)
  scaled = 0
  if tp > 0:
    scaled = tp * c
  elif pp > 0:
    scaled = pp * c
  pages = max(base, scaled)
  if pages > 0:
    return pages
  if ok:
    return 1
  return 0


def read_copies(job_info, printer_info=None):
  dev = None
  try:
    dev = job_info.get("pDevMode") if job_info else None
  except Exception:
    dev = None
  if dev is None and printer_info is not None:
    try:
      dev = printer_info.get("pDevMode")
    except Exception:
      dev = None
  try:
    c = getattr(dev, "Copies", None)
    if c is None:
      return 1
    c = int(c)
    return c if c > 0 else 1
  except Exception:
    return 1


def classify_print_type(job_info, printer_info=None):
  dev = None
  try:
    dev = job_info.get("pDevMode") if job_info else None
  except Exception:
    dev = None
  if dev is None and printer_info is not None:
    try:
      dev = printer_info.get("pDevMode")
    except Exception:
      dev = None
  try:
    color = getattr(dev, "Color", None)
    if color == 2:
      return "Color"
    if color == 1:
      return "BN"
  except Exception:
    pass
  return "Desconocido"


def get_printer_error_state(wmi_conn, printer_name):
  try:
    ps = wmi_conn.Win32_Printer(Name=printer_name)
    if not ps:
      return None
    p = ps[0]
    detected = getattr(p, "DetectedErrorState", None)
    status = getattr(p, "PrinterStatus", None)
    offline = getattr(p, "WorkOffline", None)
    return {"DetectedErrorState": detected, "PrinterStatus": status, "WorkOffline": offline}
  except Exception:
    return None


ERROR_STATE_MAP = {
  3: "LOW_PAPER",
  4: "NO_PAPER",
  5: "LOW_TONER",
  6: "NO_TONER",
  7: "DOOR_OPEN",
  8: "JAMMED",
  9: "OFFLINE",
  10: "SERVICE_REQUESTED",
  11: "OUTPUT_BIN_FULL",
}


def derive_error_code(job_status_flags, printer_state):
  try:
    if job_status_flags is not None:
      if job_status_flags & win32print.JOB_STATUS_PAPEROUT:
        return "NO_PAPER"
      if job_status_flags & win32print.JOB_STATUS_OFFLINE:
        return "OFFLINE"
      if job_status_flags & win32print.JOB_STATUS_ERROR:
        return "JOB_ERROR"
      if job_status_flags & win32print.JOB_STATUS_USER_INTERVENTION:
        return "USER_INTERVENTION"
  except Exception:
    pass

  if printer_state:
    det = printer_state.get("DetectedErrorState")
    if det in ERROR_STATE_MAP:
      return ERROR_STATE_MAP[det]
    if printer_state.get("WorkOffline") is True:
      return "OFFLINE"
  return None


def is_success(job_status_flags, printer_state, last_error_code):
  if last_error_code:
    return False
  try:
    if job_status_flags is not None:
      if job_status_flags & win32print.JOB_STATUS_PRINTED:
        return True
      if job_status_flags & (win32print.JOB_STATUS_ERROR | win32print.JOB_STATUS_PAPEROUT | win32print.JOB_STATUS_OFFLINE):
        return False
  except Exception:
    pass
  if printer_state:
    det = printer_state.get("DetectedErrorState")
    if det in ERROR_STATE_MAP and ERROR_STATE_MAP[det] in ("JAMMED", "NO_PAPER", "OFFLINE", "DOOR_OPEN", "OUTPUT_BIN_FULL"):
      return False
  return True


class PrintMonitor:
  def __init__(self, db_conn, on_finalized=None, poll_interval_s=1.0):
    self.db_conn = db_conn
    self.on_finalized = on_finalized
    self.poll_interval_s = float(poll_interval_s)
    self._stop = threading.Event()
    self._threads = []
    self._machine = os.environ.get("COMPUTERNAME") or ""

  def start(self):
    t = threading.Thread(target=self._run_watcher, daemon=True)
    t.start()
    self._threads.append(t)

  def stop(self):
    self._stop.set()

  def _run_watcher(self):
    pythoncom.CoInitialize()
    try:
      w = wmi.WMI()
      watcher = w.Win32_PrintJob.watch_for("creation")
      while not self._stop.is_set():
        try:
          job = watcher(timeout_ms=1000)
          if not job:
            continue
          self._handle_created_job(w, job)
        except Exception:
          continue
    finally:
      pythoncom.CoUninitialize()

  def _handle_created_job(self, wmi_conn, wmi_job):
    try:
      spool_name = getattr(wmi_job, "Name", "") or ""
      printer_name = spool_name.split(",")[0].strip() if spool_name else "Impresora"
      spool_job_id = safe_int(getattr(wmi_job, "JobId", None), default=None)
      document = (getattr(wmi_job, "Document", None) or "").strip() or "Sin nombre"
      owner = (getattr(wmi_job, "Owner", None) or "").strip() or "Desconocido"
      user_id = f"{owner}@{self._machine}" if self._machine else owner
      created_ts = now_tz_iso()

      row = {
        "printer_name": printer_name,
        "pages": 0,
        "print_type": "Desconocido",
        "ts_created": created_ts,
        "ts_completed": None,
        "document": document,
        "user_id": user_id,
        "windows_owner": owner,
        "windows_machine": self._machine,
        "spool_job_id": spool_job_id,
        "status": "started",
        "error_code": None,
        "raw_status": None,
      }
      from .db import insert_print_job, insert_event
      print_job_id = insert_print_job(self.db_conn, row)
      insert_event(self.db_conn, print_job_id, created_ts, "JOB_CREATED", None)
      t = threading.Thread(target=self._monitor_job_until_final, args=(wmi_conn, printer_name, spool_job_id, print_job_id), daemon=True)
      t.start()
      self._threads.append(t)
    except Exception:
      return

  def _monitor_job_until_final(self, wmi_conn, printer_name, spool_job_id, print_job_id):
    printer_handle = None
    last_pages = 0
    last_flags = None
    last_type = "Desconocido"
    last_error = None
    try:
      printer_handle = win32print.OpenPrinter(printer_name)
      try:
        pinfo = win32print.GetPrinter(printer_handle, 2)
      except Exception:
        pinfo = None

      while not self._stop.is_set():
        job_info = None
        try:
          if spool_job_id is not None:
            job_info = win32print.GetJob(printer_handle, spool_job_id, 2)
        except Exception:
          job_info = None

        if job_info:
          flags = safe_int(job_info.get("Status", None), default=None)
          last_flags = flags
          total_pages = safe_int(job_info.get("TotalPages", None), default=0)
          pages_printed = safe_int(job_info.get("PagesPrinted", None), default=0)
          copies = read_copies(job_info, pinfo)
          pages = choose_pages(total_pages, pages_printed, copies, ok=True)
          if pages > 0:
            last_pages = pages
          last_type = classify_print_type(job_info, pinfo)
          last_error = derive_error_code(flags, None)
          if last_error:
            break
          try:
            if flags is not None and (flags & win32print.JOB_STATUS_PRINTED):
              break
          except Exception:
            pass
          time.sleep(self.poll_interval_s)
          continue

        printer_state = get_printer_error_state(wmi_conn, printer_name)
        last_error = last_error or derive_error_code(last_flags, printer_state)
        ok = is_success(last_flags, printer_state, last_error)
        completed_ts = now_tz_iso()
        from .db import update_print_job, insert_event
        final_pages = choose_pages(last_pages, last_pages, 1, ok)
        patch = {
          "pages": int(final_pages),
          "print_type": last_type,
          "ts_completed": completed_ts,
          "status": "completed" if ok else "failed",
          "error_code": last_error,
          "raw_status": last_flags,
        }

        update_print_job(self.db_conn, print_job_id, patch)
        insert_event(self.db_conn, print_job_id, completed_ts, "JOB_FINALIZED", patch.get("error_code"))
        if self.on_finalized:
          try:
            self.on_finalized(print_job_id)
          except Exception:
            pass
        return
    finally:
      try:
        if printer_handle is not None:
          win32print.ClosePrinter(printer_handle)
      except Exception:
        pass

