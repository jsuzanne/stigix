import os
import time
import json
import random
import threading
import logging
from flask import Flask, Response, request, send_file, jsonify

# Initialize Flask App
app = Flask(__name__)
logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')

# --- Configuration & State ---
class AppState:
    def __init__(self):
        # Default config path
        self.config_path = os.environ.get('TARGET_CONFIG_PATH', '/app/config/target-config.json')
        if not os.path.exists(os.path.dirname(self.config_path)):
             # Fallback for local dev if /app/config doesn't exist
             self.config_path = 'target-config.json'

        self.mode = os.environ.get('APP_MODE', 'NORMAL')  # NORMAL, ALWAYS_SLOW, RANDOM_SLOW, LOOPING_SLOW
        self.slow_delay = float(os.environ.get('SLOW_DELAY_SECONDS', 5.0))
        self.loop_slow = float(os.environ.get('LOOP_SLOW_SECONDS', 60.0))
        self.loop_normal = float(os.environ.get('LOOP_NORMAL_SECONDS', 60.0))
        self.random_prob = float(os.environ.get('RANDOM_SLOW_PROBABILITY', 0.5))
        self.current_loop_state = 'NORMAL'  # For LOOPING_SLOW mode
        self.eicar_path = os.environ.get('EICAR_FILE_PATH', '/opt/sdwan-target/eicar.com.txt')
        
        # Load persisted config if available
        self.load()

    def load(self):
        if os.path.exists(self.config_path):
            try:
                with open(self.config_path, 'r') as f:
                    data = json.load(f)
                    self.mode = data.get('mode', self.mode)
                    self.slow_delay = float(data.get('slow_delay', self.slow_delay))
                    self.loop_slow = float(data.get('loop_slow', self.loop_slow))
                    self.loop_normal = float(data.get('loop_normal', self.loop_normal))
                    self.random_prob = float(data.get('random_prob', self.random_prob))
                    logging.info(f"Loaded config from {self.config_path}: {self.mode}")
            except Exception as e:
                logging.error(f"Error loading config: {e}")

    def save(self):
        try:
            data = {
                'mode': self.mode,
                'slow_delay': self.slow_delay,
                'loop_slow': self.loop_slow,
                'loop_normal': self.loop_normal,
                'random_prob': self.random_prob
            }
            with open(self.config_path, 'w') as f:
                json.dump(data, f, indent=4)
            logging.info(f"Saved config to {self.config_path}")
        except Exception as e:
            logging.error(f"Error saving config: {e}")

    def get_status(self):
        return {
            'mode': self.mode,
            'slow_delay': self.slow_delay,
            'loop_slow': self.loop_slow,
            'loop_normal': self.loop_normal,
            'random_prob': self.random_prob,
            'current_loop_state': self.current_loop_state if self.mode == 'LOOPING_SLOW' else 'N/A'
        }

state = AppState()

# --- Background Loop for LOOPING_SLOW ---
def background_looper():
    while True:
        if state.mode == 'LOOPING_SLOW':
            state.current_loop_state = 'SLOW'
            logging.info(f"Loop State: SLOW (for {state.loop_slow}s)")
            time.sleep(state.loop_slow)
            
            state.current_loop_state = 'NORMAL'
            logging.info(f"Loop State: NORMAL (for {state.loop_normal}s)")
            time.sleep(state.loop_normal)
        else:
            time.sleep(1)

# Start background thread
logging.info("Starting background looper thread...")
t = threading.Thread(target=background_looper, daemon=True)
t.start()

# --- Routes ---

@app.route('/ok')
def health_check():
    return "OK", 200

@app.route('/slow')
def slow_app():
    start_time = time.time()
    should_delay = False

    if state.mode == 'ALWAYS_SLOW':
        should_delay = True
    elif state.mode == 'RANDOM_SLOW':
        if random.random() < state.random_prob:
            should_delay = True
    elif state.mode == 'LOOPING_SLOW':
        if state.current_loop_state == 'SLOW':
            should_delay = True
    
    # NORMAL mode = no delay

    if should_delay:
        time.sleep(state.slow_delay)
        duration = time.time() - start_time
        return f"Slow response (Delayed {duration:.2f}s)", 200
    else:
        return "Fast response", 200

@app.route('/eicar.com.txt')
def get_eicar():
    # Option 2: File on disk
    if os.path.exists(state.eicar_path):
        logging.info(f"Serving EICAR from file: {state.eicar_path}")
        try:
            return send_file(state.eicar_path, mimetype='text/plain', as_attachment=True, download_name='eicar.com.txt')
        except Exception as e:
            logging.error(f"Error serving file: {e}")
            pass # Fallback to string

    # Option 1: Embedded String
    logging.info("Serving embedded EICAR string")
    EICAR_STRING = r"X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"
    return Response(
        EICAR_STRING,
        mimetype="text/plain",
        headers={"Content-Disposition": "attachment; filename=eicar.com.txt"}
    )

@app.route('/favicon.ico')
def favicon():
    favicon_path = os.path.join(os.path.dirname(__file__), 'favicon.png')
    if os.path.exists(favicon_path):
        return send_file(favicon_path, mimetype='image/png')
    return "", 404


@app.route('/')
def index():
    # Simple HTML UI
    html = f"""
    <html>
    <head>
        <title>SD-WAN HTTP Target</title>
        <style>
            body {{ font-family: sans-serif; padding: 20px; max-width: 800px; margin: 0 auto; }}
            .card {{ border: 1px solid #ccc; padding: 15px; margin-bottom: 20px; border-radius: 5px; }}
            h1 {{ color: #333; }}
            button {{ padding: 10px 15px; margin-right: 10px; cursor: pointer; }}
            .status {{ font-weight: bold; color: #0066cc; }}
            .active {{ background-color: #e0f0ff; border-color: #0066cc; }}
        </style>
    </head>
    <body>
        <h1>SD-WAN HTTP Target Control</h1>
        
        <div class="card">
            <h2>Current Status</h2>
            <p>Mode: <span class="status">{state.mode}</span></p>
            <p>Loop State: {state.current_loop_state if state.mode == 'LOOPING_SLOW' else 'N/A'}</p>
            <p>Configured Delay: {state.slow_delay}s</p>
        </div>

        <div class="card">
            <h2>Change Mode</h2>
            <p>Select a mode to verify SD-WAN policy switching:</p>
            <button onclick="setMode('NORMAL')">NORMAL (Fast)</button>
            <button onclick="setMode('ALWAYS_SLOW')">ALWAYS_SLOW</button>
            <button onclick="setMode('RANDOM_SLOW')">RANDOM_SLOW</button>
            <button onclick="setMode('LOOPING_SLOW')">LOOPING_SLOW</button>
        </div>

        <div class="card">
            <h2>Test Links</h2>
            <ul>
                <li><a href="/ok" target="_blank">/ok (Health Check)</a></li>
                <li><a href="/slow" target="_blank">/slow (Variable Latency)</a></li>
                <li><a href="/eicar.com.txt">/eicar.com.txt (Security Test)</a></li>
                <li><a href="https://github.com/jsuzanne/stigix/blob/main/docs/TARGET_CAPABILITIES.md" target="_blank">📚 Help / Documentation</a></li>
            </ul>
        </div>

        <script>
            function setMode(mode) {{
                fetch('/set-mode?mode=' + mode)
                    .then(r => r.text())
                    .then(() => window.location.reload());
            }}
        </script>
    </body>
    </html>
    """
    return html

@app.route('/api/status')
def get_json_status():
    return jsonify(state.get_status())

@app.route('/set-mode')
def set_mode():
    new_mode = request.args.get('mode')
    if new_mode in ['NORMAL', 'ALWAYS_SLOW', 'RANDOM_SLOW', 'LOOPING_SLOW']:
        state.mode = new_mode
        state.save() # Persist changes
        logging.info(f"Mode switched to: {state.mode}")
        return f"Mode set to {state.mode}", 200
    return "Invalid mode", 400

if __name__ == '__main__':
    port = int(os.environ.get('TARGET_HTTP_PORT', 8082))
    logging.info(f"Starting HTTP Server on port {port}")
    app.run(host='0.0.0.0', port=port, threaded=True)
