import os
import sys
import time
import threading
import logging
from flask import Flask, jsonify, send_from_directory
from flask_cors import CORS
from pynput import keyboard

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.path.join(BASE_DIR, "web")
LOG_DIR = os.path.join(BASE_DIR, "logs")
os.makedirs(LOG_DIR, exist_ok=True)
LOG_PATH = os.path.join(LOG_DIR, "pos_local.log")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_PATH, encoding="utf-8"),
        logging.StreamHandler(sys.stdout),
    ],
)

UMBRAL_HUMANO_MS = 0.08


class Scanner:
    def __init__(self):
        self.buffer = ""
        self.lock = threading.Lock()
        self.timer = None
        self.last_ts = 0.0
        self.ultimo_codigo = None
        self._injecting = False
        self._controller = keyboard.Controller()
        self._leaked_count = 0
        self._scan_started = False
        self._active = False

    def reset(self):
        self.buffer = ""
        self._leaked_count = 0
        self._scan_started = False
        self._active = False
        if self.timer:
            try:
                self.timer.cancel()
            except Exception:
                pass
            self.timer = None

    def _inject_backspace(self, count: int):
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
        if u.startswith("LIB-") and len(u) >= 7:
            return True
        if cleaned.isdigit() and len(cleaned) >= 6:
            return True
        digits = sum(1 for c in cleaned if c.isdigit())
        return digits >= 4 and len(cleaned) >= 6

    def _emit(self):
        with self.lock:
            codigo = self._sanitize(self.buffer.strip())
            if self._looks_like_scan(codigo) and len(codigo) >= 3:
                self.ultimo_codigo = codigo
                logging.info("ESCANER_CAPTURADO: %s", codigo)
            else:
                if codigo:
                    logging.warning("DESCARTADO: %s", codigo)
            self.reset()

    def on_press(self, key):
        if self._injecting and key == keyboard.Key.backspace:
            return True

        now = time.time()
        delta = now - self.last_ts if self.last_ts else 0.0
        self.last_ts = now

        if key == keyboard.Key.enter:
            cleaned = self._sanitize(self.buffer.strip())
            if self._active or (self._looks_like_scan(cleaned) and len(cleaned) >= 3):
                self._emit()
                return False
            self.reset()
            return True

        char = None
        try:
            if hasattr(key, "char") and key.char:
                char = key.char
            elif hasattr(key, "vk"):
                if 48 <= key.vk <= 57:
                    char = chr(key.vk)
                elif 96 <= key.vk <= 105:
                    char = chr(key.vk - 48)
                elif 65 <= key.vk <= 90:
                    char = chr(key.vk)
        except Exception:
            char = None

        if not char:
            return True

        self.buffer += char
        cleaned = self._sanitize(self.buffer)
        looks = self._looks_like_scan(cleaned)

        if looks and not self._active:
            self._active = True
            self._scan_started = True
            if self._leaked_count:
                self._inject_backspace(self._leaked_count)

        if looks or (delta and delta < UMBRAL_HUMANO_MS):
            if self.timer:
                try:
                    self.timer.cancel()
                except Exception:
                    pass
            self.timer = threading.Timer(0.25, self._emit)
            self.timer.start()
            return False

        if not self._scan_started:
            self._leaked_count += 1
            return True

        return False


scanner = Scanner()

app = Flask(__name__)
CORS(app)


@app.route("/health")
def health():
    return jsonify({"ok": True, "web_dir": WEB_DIR, "log": LOG_PATH})


@app.route("/status")
def status():
    with scanner.lock:
        return jsonify({"activo": True, "buffer": scanner.buffer if scanner._active else ""})


@app.route("/poll")
def poll():
    with scanner.lock:
        res = scanner.ultimo_codigo
        scanner.ultimo_codigo = None
    return jsonify({"codigo": res})


@app.route("/")
def index():
    return send_from_directory(WEB_DIR, "index.html")


@app.route("/<path:path>")
def static_files(path):
    return send_from_directory(WEB_DIR, path)


def main():
    logging.getLogger("werkzeug").setLevel(logging.ERROR)
    os.makedirs(WEB_DIR, exist_ok=True)
    listener = keyboard.Listener(on_press=scanner.on_press, suppress=True)
    listener.start()
    port = int(os.environ.get("LIBRERIA_POS_PORT", "8787"))
    host = os.environ.get("LIBRERIA_POS_HOST", "127.0.0.1")
    logging.info("INICIANDO_POS_LOCAL host=%s port=%s web=%s log=%s", host, port, WEB_DIR, LOG_PATH)
    app.run(host=host, port=port, debug=False)


if __name__ == "__main__":
    main()

