import os
import sys
import json
from datetime import datetime
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

PORT = 8421
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
BRAIN_FILE = os.path.join(BASE_DIR, "ai_brain.json")

class BrainSyncHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _send_cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Connection", "close")
        self.close_connection = True

    def _send_json_bytes(self, code, data_bytes):
        self.send_response(code)
        self._send_cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data_bytes)))
        self.end_headers()
        self.wfile.write(data_bytes)

    def do_OPTIONS(self):
        self.send_response(200)
        self._send_cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        if self.path == "/brain" or self.path == "/":
            if os.path.exists(BRAIN_FILE):
                try:
                    with open(BRAIN_FILE, "r", encoding="utf-8") as f:
                        data = f.read()
                    self._send_json_bytes(200, data.encode("utf-8"))
                    return
                except Exception as e:
                    self._send_json_bytes(500, json.dumps({"error": str(e)}).encode("utf-8"))
                    return
            else:
                self._send_json_bytes(404, b'{"error": "ai_brain.json not found"}')
                return

        elif self.path == "/status":
            self._send_json_bytes(200, b'{"status": "running", "port": 8421}')
            return

        self.send_response(404)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_POST(self):
        if self.path == "/brain":
            try:
                length = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(length)
                parsed = json.loads(body.decode("utf-8"))

                with open(BRAIN_FILE, "w", encoding="utf-8") as f:
                    json.dump(parsed, f, ensure_ascii=False, indent=2)

                self._send_json_bytes(200, b'{"success": true, "saved": true}')

                now_str = datetime.now().strftime("%H:%M:%S")
                markov_cnt = len(parsed.get("markovCounts", {}))
                streak_cnt = len(parsed.get("streakStats", {}))
                rounds = parsed.get("stats", {}).get("totalRoundsObserved", 0)
                acc = parsed.get("stats", {}).get("accuracy", 0) * 100
                print(f"[{now_str}] -> [AUTO-SAVE] Da luu tu dong vao ai_brain.json ({rounds} van | {markov_cnt + streak_cnt} mau cau | Do chinh xac: {acc:.1f}%)")
                sys.stdout.flush()
                return
            except Exception as e:
                self._send_json_bytes(500, json.dumps({"error": str(e)}).encode("utf-8"))
                return

        self.send_response(404)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def log_message(self, format, *args):
        return

if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", PORT), BrainSyncHandler)
    server.daemon_threads = True
    print(f"=== WM Baccarat AI Sync Bridge dang chay tai http://127.0.0.1:{PORT} ===")
    print(f"Luu tu dong vao file: {BRAIN_FILE}")
    print("San sang nhan du lieu tu Extension (Moi khi co van moi se tu dong luu)...")
    sys.stdout.flush()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
