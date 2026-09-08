import os
import logging
from flask import Flask, Response, send_file, jsonify

app = Flask(__name__)
logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')

EICAR_FILE_PATH = os.environ.get('EICAR_FILE_PATH', '/opt/sdwan-target/eicar.com.txt')
EICAR_STRING = r"X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"
TARGET_PORT = int(os.environ.get('TARGET_HTTP_PORT', 8082))

@app.route('/eicar.com.txt')
def get_eicar():
    if os.path.exists(EICAR_FILE_PATH):
        try:
            logging.info(f"Serving EICAR from file: {EICAR_FILE_PATH}")
            return send_file(EICAR_FILE_PATH, mimetype='text/plain', as_attachment=True, download_name='eicar.com.txt')
        except Exception as e:
            logging.error(f"Error serving EICAR file: {e}")

    logging.info("Serving standard embedded EICAR string")
    return Response(
        EICAR_STRING,
        mimetype="text/plain",
        headers={"Content-Disposition": "attachment; filename=eicar.com.txt"}
    )

@app.route('/api/status')
@app.route('/health')
def get_status():
    return jsonify({
        'status': 'ready',
        'service': 'eicar_security_target',
        'port': TARGET_PORT,
        'eicar_endpoint': '/eicar.com.txt'
    })

@app.route('/favicon.ico')
def favicon():
    favicon_path = os.path.join(os.path.dirname(__file__), 'favicon.png')
    if os.path.exists(favicon_path):
        return send_file(favicon_path, mimetype='image/png')
    return "", 404

@app.route('/')
def index():
    html = f"""<!DOCTYPE html>
<html>
<head>
    <title>Stigix EICAR Security Target (Port {TARGET_PORT})</title>
    <style>
        body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #e2e8f0; padding: 40px; margin: 0; }}
        .card {{ background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 24px; max-width: 600px; margin: 0 auto; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); }}
        h1 {{ font-size: 20px; color: #38bdf8; margin-top: 0; }}
        .badge {{ display: inline-block; background: rgba(16,185,129,0.15); color: #34d399; border: 1px solid rgba(16,185,129,0.3); padding: 4px 10px; border-radius: 9999px; font-size: 12px; font-weight: bold; }}
        .link-box {{ background: #0f172a; border: 1px solid #334155; padding: 12px; border-radius: 8px; font-family: monospace; font-size: 13px; word-break: break-all; margin: 16px 0; }}
        a {{ color: #38bdf8; text-decoration: none; }}
        a:hover {{ text-decoration: underline; }}
        p {{ font-size: 13px; color: #94a3b8; line-height: 1.5; }}
    </style>
</head>
<body>
    <div class="card">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
            <h1>🛡️ Stigix EICAR Security Target</h1>
            <span class="badge">READY · PORT {TARGET_PORT}</span>
        </div>
        <p>This service provides the standardized EICAR anti-virus test file on TCP port {TARGET_PORT} for automated SASE / NGFW / IPS policy enforcement verification.</p>
        <div class="link-box">
            🛑 <a href="/eicar.com.txt">/eicar.com.txt</a>
        </div>
        <p style="font-size: 11px; opacity: 0.7;">API Health check: <a href="/api/status">/api/status</a></p>
    </div>
</body>
</html>
"""
    return html

if __name__ == '__main__':
    logging.info(f"Starting EICAR Security Target HTTP Server on port {TARGET_PORT}")
    app.run(host='0.0.0.0', port=TARGET_PORT, threaded=True)
