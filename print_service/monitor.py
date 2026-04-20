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


def choose_pages(total_pages, pages_printed, copies, queue_delta, ok):
  tp = safe_int(total_pages, default=0)
  pp = safe_int(pages_printed, default=0)
  c = safe_int(copies, default=1)
  if c <= 0:
    c = 1
  qd = safe_int(queue_delta, default=0)
  if qd < 0:
    qd = 0
  base = max(tp, pp, 0)
  scaled = 0
  if tp > 0:
    scaled = tp * c
  elif pp > 0:
    scaled = pp * c
  pages = max(base, scaled, qd)
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
  if job_info and dev is None:
    try:
      c2 = job_info.get("Copies", None)
      if c2 is not None:
        c2 = int(c2)
        if c2 > 0:
          return c2
    except Exception:
      pass
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


def read_queue_total_pages(wmi_conn, printer_name):
  try:
    qs = wmi_conn.Win32_PerfFormattedData_Spooler_PrintQueue(Name=printer_name)
    if qs:
      v = getattr(qs[0], "TotalPagesPrinted", None)
      if v is not None:
        return safe_int(v, default=None)
  except Exception:
    pass
  try:
    qs = wmi_conn.Win32_PerfRawData_Spooler_PrintQueue(Name=printer_name)
    if qs:
      v = getattr(qs[0], "TotalPagesPrinted", None)
      if v is not None:
        return safe_int(v, default=None)
  except Exception:
    pass
  return None


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
      queue_base = read_queue_total_pages(wmi_conn, printer_name)

      row = {
        "printer_name": printer_name,
        "pages": 0,
        "pages_estimated": 0,
        "copies_requested": 1,
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
      t = threading.Thread(target=self._monitor_job_until_final, args=(wmi_conn, printer_name, spool_job_id, print_job_id, queue_base), daemon=True)
      t.start()
      self._threads.append(t)
    except Exception:
      return

  def _monitor_job_until_final(self, wmi_conn, printer_name, spool_job_id, print_job_id, queue_base):
    printer_handle = None
    last_pages = 0
    last_pages_per_copy = 0
    last_copies = 1
    last_flags = None
    last_type = "Desconocido"
    err_code = None
    err_streak = 0
    try:
      printer_handle = win32print.OpenPrinter(printer_name)
      try:
        pinfo = win32print.GetPrinter(printer_handle, 2)
      except Exception:
        pinfo = None
      started = time.time()

      while not self._stop.is_set():
        if time.time() - started > 300:
          break
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
          if copies > last_copies:
            last_copies = copies
          per_copy = max(total_pages, pages_printed, 0)
          if per_copy > last_pages_per_copy:
            last_pages_per_copy = per_copy
          pages = choose_pages(total_pages, pages_printed, copies, 0, ok=True)
          if pages > 0:
            last_pages = pages
          last_type = classify_print_type(job_info, pinfo)
          code = derive_error_code(flags, None)
          if code:
            if code == err_code:
              err_streak += 1
            else:
              err_code = code
              err_streak = 1
          else:
            err_code = None
            err_streak = 0
          time.sleep(self.poll_interval_s)
          continue

        printer_state = get_printer_error_state(wmi_conn, printer_name)
        final_error = derive_error_code(last_flags, printer_state)
        completed_ts = now_tz_iso()
        from .db import update_print_job, insert_event
        queue_delta = 0
        if queue_base is not None:
          best = 0
          for _ in range(8):
            queue_now = read_queue_total_pages(wmi_conn, printer_name)
            if queue_now is not None:
              d = queue_now - queue_base
              if d > best:
                best = d
            time.sleep(0.5)
          queue_delta = best

        if final_error is None and err_code and err_streak >= 3:
          final_error = err_code

        has_evidence = (queue_delta > 0) or (last_pages > 0) or (last_pages_per_copy > 0)
        if final_error in ("OFFLINE", "JOB_ERROR", "USER_INTERVENTION") and has_evidence:
          final_error = None

        ok = final_error is None
        final_pages = choose_pages(last_pages, last_pages, 1, queue_delta, ok)
        pages_per_copy = last_pages_per_copy or (1 if ok else 0)
        pages_estimated = 0
        if ok:
          pages_estimated = max(0, int(pages_per_copy)) * max(1, int(last_copies))
          if pages_estimated <= 0:
            pages_estimated = int(final_pages) if int(final_pages) > 0 else 1
        patch = {
          "pages": int(final_pages),
          "pages_estimated": int(pages_estimated),
          "copies_requested": int(last_copies) if ok else int(last_copies),
          "print_type": last_type,
          "ts_completed": completed_ts,
          "status": "completed" if ok else "failed",
          "error_code": final_error,
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

