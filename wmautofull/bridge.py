import os
import sys
import json
from http.server import HTTPServer, BaseHTTPRequestHandler

PORT = 8421
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
BRAIN_FILE = os.path.join(BASE_DIR, "ai_brain.json")

class BrainSyncHandler(BaseHTTPRequestHandler):
    def _send_cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(200)
        self._send_cors()
        self.end_headers()

    def do_GET(self):
        if self.path == "/brain" or self.path == "/":
            if os.path.exists(BRAIN_FILE):
                try:
                    with open(BRAIN_FILE, "r", encoding="utf-8") as f:
                        data = f.read()
                    self.send_response(200)
                    self._send_cors()
                    self.send_header("Content-Type", "application/json; charset=utf-8")
                    self.end_headers()
                    self.wfile.write(data.encode("utf-8"))
                    return
                except Exception as e:
                    self.send_response(500)
                    self._send_cors()
                    self.end_headers()
                    self.wfile.write(json.dumps({"error": str(e)}).encode("utf-8"))
                    return
            else:
                self.send_response(404)
                self._send_cors()
                self.end_headers()
                self.wfile.write(b'{"error": "ai_brain.json not found"}')
                return

        elif self.path == "/status":
            self.send_response(200)
            self._send_cors()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"status": "running", "port": 8421}')
            return

        self.send_response(404)
        self.end_headers()

    def do_POST(self):
        if self.path == "/brain":
            try:
                length = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(length)
                parsed = json.loads(body.decode("utf-8"))

                with open(BRAIN_FILE, "w", encoding="utf-8") as f:
                    json.dump(parsed, f, ensure_ascii=False, indent=2)

                self.send_response(200)
                self._send_cors()
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(b'{"success": true, "saved": true}')
                print(f"[AI Sync Bridge] Da luu tu dong vao file: {BRAIN_FILE}")
                sys.stdout.flush()
                return
            except Exception as e:
                self.send_response(500)
                self._send_cors()
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode("utf-8"))
                return

        self.send_response(404)
        self.end_headers()

    def log_message(self, format, *args):
        return

if __name__ == "__main__":
    server = HTTPServer(("127.0.0.1", PORT), BrainSyncHandler)
    print(f"=== WM Baccarat AI Sync Bridge dang chay tai http://127.0.0.1:{PORT} ===")
    print(f"Luu tu dong vao file: {BRAIN_FILE}")
    sys.stdout.flush()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
