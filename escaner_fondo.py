import sys
import time
import threading
import os
import logging
from flask import Flask, jsonify, Response, stream_with_context
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

    def reset(self):
        self.buffer = ""
        self.es_escaneo_activo = False
        self._leaked = False
        self._leaked_count = 0
        self._scan_started = False
        self._scan_start_ts = 0.0
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

            if self._looks_like_scan(codigo) and len(codigo) >= 3:
                self.ultimo_codigo = codigo
                logging.info("ESCANER_CAPTURADO: %s", codigo)
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

        if key == keyboard.Key.enter:
            cleaned = self._sanitize(self.buffer.strip())
            if self.es_escaneo_activo or (self._looks_like_scan(cleaned) and len(cleaned) >= 3):
                self.enviar_a_web()
                return False
            self.reset()
            return True

        if char:
            if not self.buffer:
                self._scan_start_ts = time.time()
            self.buffer += char
            cleaned = self._sanitize(self.buffer)
            looks = self._looks_like_scan(cleaned)

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
        "endpoints": ["/poll", "/status", "/health", "/stream"],
        "log": _LOG_PATH,
        "suppress": LISTENER_SUPPRESS,
    })

@app.route("/poll", strict_slashes=False)
def poll():
    with filtro.lock:
        res = filtro.ultimo_codigo
        filtro.ultimo_codigo = None
    return jsonify({"codigo": res})

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
    return jsonify({"activo": True, "buffer": filtro.buffer if filtro.es_escaneo_activo else "", "suppress": LISTENER_SUPPRESS})

@app.route("/health", strict_slashes=False)
def health():
    return jsonify({"ok": True, "log": _LOG_PATH, "suppress": LISTENER_SUPPRESS})

if __name__ == "__main__":
    logging.getLogger("werkzeug").setLevel(logging.ERROR)
    
    try:
        want = os.environ.get("LIBRERIA_SCANNER_SUPPRESS", "0") == "1"
        LISTENER_SUPPRESS = bool(want)
        listener = keyboard.Listener(on_press=on_press, suppress=LISTENER_SUPPRESS)
        listener.start()
    except Exception:
        logging.exception("ERROR_INICIANDO_LISTENER suppress=%s", LISTENER_SUPPRESS)
        LISTENER_SUPPRESS = False
        listener = keyboard.Listener(on_press=on_press, suppress=False)
        listener.start()
    
    logging.info("INICIANDO_ESCANER_FONDO puerto=7777 script=%s cwd=%s log=%s suppress=%s", __file__, os.getcwd(), _LOG_PATH, LISTENER_SUPPRESS)
    try:
        app.run(host="127.0.0.1", port=7777, debug=False)
    except Exception:
        logging.exception("ERROR_FLASK_RUN")
        raise
