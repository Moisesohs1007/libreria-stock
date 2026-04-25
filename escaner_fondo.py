import sys
import time
import threading
import os
import logging
from collections import deque
from flask import Flask, jsonify, Response, stream_with_context, request
from flask_cors import CORS
from pynput import keyboard

# Log (UTF-8)
_LOG_PATH = os.path.join(os.path.dirname(__file__), "escaner_auditoria.log")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(_LOG_PATH, encoding="utf-8"),
        logging.StreamHandler(sys.stdout),
    ],
)

# =============================================================================
# CONFIGURACIÓN — FILTRO TOTAL DE ESCÁNER
# =============================================================================
UMBRAL_HUMANO_MS = 0.08  # Si la tecla tarda más de 80ms, es un humano.
TIEMPO_ENTRE_TECLAS_SCANNER = 0.05 # Los escáneres suelen enviar cada 10-30ms.
SCAN_IDLE_S = 0.35
LIB_MIN_LEN = 12
MAX_ACCUM_S = 1.5
LISTENER_SUPPRESS = False

_EV_LOCK = threading.Lock()
_EV_COND = threading.Condition(_EV_LOCK)
_EV_SEQ = 0
_EV_CODE = None

_Q_LOCK = threading.Lock()
_Q = deque(maxlen=250)

class EscanerFiltroTotal:
    def __init__(self):
        self.buffer = ""
        self.ultimo_codigo = None
        self.ultimo_tiempo = 0
        self.lock = threading.Lock()
        self.timer_envio = None
        self.es_escaneo_activo = False
        self._leaked = False
        self._leaked_count = 0
        self._injecting = False
        self._controller = keyboard.Controller()
        self._scan_started = False
        self._scan_start_ts = 0.0
        self._last_char_ts = 0.0
        self._slow = False

    def reset(self):
        self.buffer = ""
        self.es_escaneo_activo = False
        self._leaked = False
        self._leaked_count = 0
        self._scan_started = False
        self._scan_start_ts = 0.0
        self._last_char_ts = 0.0
        self._slow = False
        if self.timer_envio:
            self.timer_envio.cancel()
            self.timer_envio = None

    def _inject_backspace(self, count=1):
        if not LISTENER_SUPPRESS:
            return
        if not count or count <= 0:
            return
        self._injecting = True
        try:
            for _ in range(int(count)):
                self._controller.press(keyboard.Key.backspace)
                self._controller.release(keyboard.Key.backspace)
        finally:
            self._injecting = False

    def _sanitize(self, raw: str) -> str:
        s = "".join(c for c in (raw or "") if c.isalnum() or c == "-")
        u = s.upper()
        i = u.find("LIB-")
        if 0 < i <= 6:
            s = s[i:]
        return s

    def _looks_like_scan(self, cleaned: str) -> bool:
        if not cleaned:
            return False
        u = cleaned.upper()
        if u.startswith("LIB-") and len(u) >= LIB_MIN_LEN:
            return True
        if cleaned.isdigit() and len(cleaned) >= 6:
            return True
        digits = sum(1 for c in cleaned if c.isdigit())
        return digits >= 4 and len(cleaned) >= 6

    def enviar_a_web(self):
        with self.lock:
            codigo = self._sanitize(self.buffer.strip())
            u = (codigo or "").upper()
            now = time.time()
            if u.startswith("LIB-") and len(u) < LIB_MIN_LEN and self._scan_start_ts and (now - self._scan_start_ts) < MAX_ACCUM_S:
                if self.timer_envio:
                    try:
                        self.timer_envio.cancel()
                    except Exception:
                        pass
                self.timer_envio = threading.Timer(SCAN_IDLE_S, self.enviar_a_web)
                self.timer_envio.daemon = True
                self.timer_envio.start()
                return

            fast_ok = (not self._slow) and (self._scan_start_ts > 0) and ((now - self._scan_start_ts) <= MAX_ACCUM_S)
            if (self._looks_like_scan(codigo) or (fast_ok and codigo.isdigit() and len(codigo) >= 4)) and len(codigo) >= 3:
                self.ultimo_codigo = codigo
                logging.info("ESCANER_CAPTURADO: %s", codigo)
                with _Q_LOCK:
                    try:
                        last = _Q[-1] if _Q else None
                        if last and last.get("codigo") == codigo and (time.time() - float(last.get("at") or 0)) < 0.25:
                            pass
                        else:
                            _Q.append({"codigo": codigo, "at": time.time()})
                    except Exception:
                        _Q.append({"codigo": codigo, "at": time.time()})
                global _EV_SEQ, _EV_CODE
                with _EV_COND:
                    _EV_SEQ += 1
                    _EV_CODE = codigo
                    _EV_COND.notify_all()
            else:
                if codigo:
                    logging.warning("DESCARTADO_CORTO: %s", codigo)
            self.reset()

    def procesar_tecla(self, key):
        if self._injecting and key == keyboard.Key.backspace:
            return True

        char = None
        try:
            if hasattr(key, 'char') and key.char:
                char = key.char
            elif hasattr(key, 'vk'):
                if 48 <= key.vk <= 57: char = chr(key.vk) # 0-9
                elif 96 <= key.vk <= 105: char = chr(key.vk - 48) # Numpad 0-9
                elif 65 <= key.vk <= 90: char = chr(key.vk) # A-Z
        except: pass

        if key in (keyboard.Key.enter, keyboard.Key.tab):
            cleaned = self._sanitize(self.buffer.strip())
            now = time.time()
            fast_ok = (not self._slow) and (self._scan_start_ts > 0) and ((now - self._scan_start_ts) <= MAX_ACCUM_S)
            if self.es_escaneo_activo or (self._looks_like_scan(cleaned) and len(cleaned) >= 3) or (fast_ok and cleaned.isdigit() and len(cleaned) >= 4):
                self.enviar_a_web()
                return False
            self.reset()
            return True

        if char:
            now = time.time()
            if not self.buffer:
                self._scan_start_ts = now
                self._last_char_ts = now
                self._slow = False
            else:
                dt = now - self._last_char_ts
                self._last_char_ts = now
                if dt > UMBRAL_HUMANO_MS:
                    self._slow = True
            self.buffer += char
            cleaned = self._sanitize(self.buffer)
            fast_ok = (not self._slow) and ((now - self._scan_start_ts) <= MAX_ACCUM_S)
            looks = self._looks_like_scan(cleaned) or (fast_ok and cleaned.isdigit() and len(cleaned) >= 4)

            if looks and not self.es_escaneo_activo:
                self.es_escaneo_activo = True
                self._scan_started = True
                if LISTENER_SUPPRESS and self._leaked_count:
                    self._inject_backspace(self._leaked_count)

            if looks or cleaned.upper().startswith("LIB-"):
                if self.timer_envio:
                    self.timer_envio.cancel()
                self.timer_envio = threading.Timer(SCAN_IDLE_S, self.enviar_a_web)
                self.timer_envio.daemon = True
                self.timer_envio.start()
                return False

            if not self._scan_started:
                self._leaked = True
                self._leaked_count += 1
                return True

            return False

        return True

filtro = EscanerFiltroTotal()

def on_press(key):
    filtro.procesar_tecla(key)
    return True

app = Flask(__name__)
CORS(app)

@app.route("/", strict_slashes=False)
def root():
    return jsonify({
        "ok": True,
        "service": "escaner_fondo",
        "endpoints": ["/poll", "/drain", "/peek", "/clear", "/status", "/health", "/stream"],
        "log": _LOG_PATH,
        "suppress": LISTENER_SUPPRESS,
    })

@app.route("/poll", strict_slashes=False)
def poll():
    with filtro.lock:
        res = filtro.ultimo_codigo
        filtro.ultimo_codigo = None
    return jsonify({"codigo": res})

@app.route("/peek", strict_slashes=False)
def peek():
    with _Q_LOCK:
        items = list(_Q)
    return jsonify({"codes": items, "count": len(items)})

@app.route("/drain", strict_slashes=False)
def drain():
    limit = 250
    try:
        raw = request.args.get("limit")
        if raw:
            n = int(raw)
            if 1 <= n <= 250:
                limit = n
    except Exception:
        pass
    out = []
    with _Q_LOCK:
        while _Q and len(out) < limit:
            out.append(_Q.popleft())
    return jsonify({"codes": out, "count": len(out)})

@app.route("/clear", strict_slashes=False)
def clear():
    with _Q_LOCK:
        _Q.clear()
    with filtro.lock:
        filtro.ultimo_codigo = None
    return jsonify({"ok": True})

@app.route("/stream", strict_slashes=False)
def stream():
    def gen():
        last = 0
        while True:
            with _EV_COND:
                if last == 0:
                    last = _EV_SEQ
                if _EV_SEQ == last:
                    _EV_COND.wait(timeout=15.0)
                if _EV_SEQ == last:
                    yield ": keepalive\n\n"
                    continue
                last = _EV_SEQ
                code = _EV_CODE
            if code:
                yield f"data: {code}\n\n"
    return Response(stream_with_context(gen()), mimetype="text/event-stream", headers={"Cache-Control": "no-cache"})

@app.route("/status", strict_slashes=False)
def status():
    with _Q_LOCK:
        qlen = len(_Q)
    return jsonify({"activo": True, "buffer": filtro.buffer if filtro.es_escaneo_activo else "", "suppress": LISTENER_SUPPRESS, "queue": qlen})

@app.route("/health", strict_slashes=False)
def health():
    return jsonify({"ok": True, "log": _LOG_PATH, "suppress": LISTENER_SUPPRESS})

if __name__ == "__main__":
    logging.getLogger("werkzeug").setLevel(logging.ERROR)
    
    LISTENER_SUPPRESS = False
    listener = keyboard.Listener(on_press=on_press, suppress=False)
    listener.start()
    
    logging.info("INICIANDO_ESCANER_FONDO puerto=7777 script=%s cwd=%s log=%s suppress=%s", __file__, os.getcwd(), _LOG_PATH, LISTENER_SUPPRESS)
    try:
        app.run(host="127.0.0.1", port=7777, debug=False, threaded=True)
    except Exception:
        logging.exception("ERROR_FLASK_RUN")
        raise
