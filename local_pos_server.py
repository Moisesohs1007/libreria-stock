import os
import sys
import logging
from flask import Flask, jsonify, send_from_directory
from flask_cors import CORS

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

app = Flask(__name__)
CORS(app)


@app.route("/health")
def health():
    return jsonify({"ok": True, "web_dir": WEB_DIR, "log": LOG_PATH})


@app.route("/status")
def status():
    return jsonify({"ok": True, "mode": "pos_local", "web_dir": WEB_DIR})


@app.route("/")
def index():
    return send_from_directory(WEB_DIR, "index.html")


@app.route("/<path:path>")
def static_files(path):
    return send_from_directory(WEB_DIR, path)


def main():
    logging.getLogger("werkzeug").setLevel(logging.ERROR)
    os.makedirs(WEB_DIR, exist_ok=True)
    port = int(os.environ.get("LIBRERIA_POS_PORT", "8787"))
    host = os.environ.get("LIBRERIA_POS_HOST", "127.0.0.1")
    logging.info("INICIANDO_POS_LOCAL host=%s port=%s web=%s log=%s", host, port, WEB_DIR, LOG_PATH)
    app.run(host=host, port=port, debug=False)


if __name__ == "__main__":
    main()

