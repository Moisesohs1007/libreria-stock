import sys
import time
import threading
import os
from flask import Flask, jsonify
from flask_cors import CORS
from pynput import keyboard

# =============================================================================
# CONFIGURACIÓN — FILTRO TOTAL DE ESCÁNER
# =============================================================================
UMBRAL_HUMANO_MS = 0.08  # Si la tecla tarda más de 80ms, es un humano.
TIEMPO_ENTRE_TECLAS_SCANNER = 0.05 # Los escáneres suelen enviar cada 10-30ms.

class EscanerFiltroTotal:
    def __init__(self):
        self.buffer = ""
        self.ultimo_codigo = None
        self.ultimo_tiempo = 0
        self.lock = threading.Lock()
        self.timer_envio = None
        self.es_escaneo_activo = False

    def reset(self):
        self.buffer = ""
        self.es_escaneo_activo = False
        if self.timer_envio:
            self.timer_envio.cancel()
            self.timer_envio = None

    def enviar_a_web(self):
        with self.lock:
            codigo = "".join(c for c in self.buffer.strip() if c.isalnum() or c == '-')
            if len(codigo) >= 3:
                self.ultimo_codigo = codigo
                print(f"✅ ESCÁNER CAPTURADO: {codigo}")
            else:
                if codigo: print(f"❌ DESCARTADO (muy corto): {codigo}")
            self.reset()

    def procesar_tecla(self, key):
        ahora = time.time()
        delta = ahora - self.ultimo_tiempo
        self.ultimo_tiempo = ahora

        char = None
        try:
            if hasattr(key, 'char') and key.char:
                char = key.char
            elif hasattr(key, 'vk'):
                if 48 <= key.vk <= 57: char = chr(key.vk) # 0-9
                elif 96 <= key.vk <= 105: char = chr(key.vk - 48) # Numpad 0-9
                elif 65 <= key.vk <= 90: char = chr(key.vk) # A-Z
        except: pass

        # 1. Si es ENTER y hay algo en el buffer, enviamos
        if key == keyboard.Key.enter:
            if self.es_escaneo_activo or len(self.buffer) >= 3:
                self.enviar_a_web()
                return False # BLOQUEO: No envía el Enter a otras apps
            self.reset()
            return True # Deja pasar el Enter si es un humano

        if char:
            # 2. Si la tecla llega rápido o ya estamos en modo escaneo
            if delta < UMBRAL_HUMANO_MS or self.es_escaneo_activo:
                self.es_escaneo_activo = True
                self.buffer += char
                
                # Reiniciar el timer de envío cada vez que llega una tecla rápida
                if self.timer_envio: self.timer_envio.cancel()
                self.timer_envio = threading.Timer(0.2, self.enviar_a_web)
                self.timer_envio.start()
                
                return False # BLOQUEO TOTAL: No se escribe nada en Bloc de Notas
            else:
                # 3. Es lento, podría ser la primera tecla de un escáner o un humano
                self.buffer = char
                return True # Deja pasar la primera tecla (si las siguientes son rápidas, el buffer se completará)

        return True

filtro = EscanerFiltroTotal()

def on_press(key):
    return filtro.procesar_tecla(key)

app = Flask(__name__)
CORS(app)

@app.route("/poll")
def poll():
    with filtro.lock:
        res = filtro.ultimo_codigo
        filtro.ultimo_codigo = None
    return jsonify({"codigo": res})

@app.route("/status")
def status():
    return jsonify({"activo": True, "buffer": filtro.buffer if filtro.es_escaneo_activo else ""})

if __name__ == "__main__":
    import logging
    logging.getLogger("werkzeug").setLevel(logging.ERROR)
    
    # Iniciamos el listener con supresión obligatoria
    # Esto es lo que permite que el return False bloquee la tecla en Windows
    listener = keyboard.Listener(on_press=on_press, suppress=True)
    listener.start()
    
    print(">>> FILTRO DE ESCÁNER TOTAL ACTIVO (Puerto 7777) <<<")
    print(">>> Nota: Se recomienda ejecutar como ADMINISTRADOR. <<<")
    app.run(host="127.0.0.1", port=7777, debug=False)
