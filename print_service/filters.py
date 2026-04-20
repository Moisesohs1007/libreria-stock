from datetime import datetime


def _parse_iso(s):
  try:
    return datetime.fromisoformat(s)
  except Exception:
    return None


def build_where(args):
  where = ""
  params = []

  ts_from = args.get("from")
  ts_to = args.get("to")
  if ts_from:
    if _parse_iso(ts_from) is None:
      raise ValueError("Parámetro 'from' inválido (ISO8601)")
    where += " AND ts_created >= ?"
    params.append(ts_from)
  if ts_to:
    if _parse_iso(ts_to) is None:
      raise ValueError("Parámetro 'to' inválido (ISO8601)")
    where += " AND ts_created <= ?"
    params.append(ts_to)

  typ = args.get("type")
  if typ:
    if typ not in ("BN", "Color", "Desconocido"):
      raise ValueError("Parámetro 'type' inválido")
    where += " AND print_type = ?"
    params.append(typ)

  status = args.get("status")
  if status:
    where += " AND status = ?"
    params.append(status)

  printers = args.get("printers")
  if printers:
    ps = [p.strip() for p in printers.split(",") if p.strip()]
    if ps:
      where += " AND printer_name IN (" + ",".join(["?"] * len(ps)) + ")"
      params.extend(ps)

  users = args.get("users")
  if users:
    us = [u.strip() for u in users.split(",") if u.strip()]
    if us:
      where += " AND user_id IN (" + ",".join(["?"] * len(us)) + ")"
      params.extend(us)

  q = args.get("q")
  if q:
    q = q.strip()
    if q:
      where += " AND (document LIKE ? OR printer_name LIKE ? OR user_id LIKE ?)"
      like = f"%{q}%"
      params.extend([like, like, like])

  return where, params

