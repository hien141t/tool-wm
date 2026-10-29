import os
import sys
import json
import secrets
import tempfile
import threading
from datetime import datetime
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

PORT = 8421
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
BRAIN_FILE = os.path.join(BASE_DIR, "ai_brain.json")
TOKEN_FILE = os.path.join(BASE_DIR, "bridge_token.txt")
MAX_BODY_SIZE = 10 * 1024 * 1024  # 10 MB

# --------------------------------------------------------------------------
# Sinh / đọc token khi khởi động
# --------------------------------------------------------------------------
def _load_or_create_token():
    if os.path.exists(TOKEN_FILE):
        with open(TOKEN_FILE, "r", encoding="utf-8") as f:
            tok = f.read().strip()
            if tok:
                return tok
    tok = secrets.token_urlsafe(32)
    with open(TOKEN_FILE, "w", encoding="utf-8") as f:
        f.write(tok)
    return tok

BRIDGE_TOKEN = _load_or_create_token()

# --------------------------------------------------------------------------
# Lock toàn cục để ghi file tuần tự
# --------------------------------------------------------------------------
write_lock = threading.Lock()

# --------------------------------------------------------------------------
# Danh sách origin được phép CORS
# --------------------------------------------------------------------------
ALLOWED_ORIGINS = ("http://127.0.0.1", "chrome-extension://")


def _is_allowed_origin(origin: str) -> bool:
    if not origin:
        return False
    for prefix in ALLOWED_ORIGINS:
        if origin.startswith(prefix):
            return True
    return False


class BrainSyncHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    # ------------------------------------------------------------------
    # CORS headers — chỉ reflect origin hợp lệ, không dùng *
    # ------------------------------------------------------------------
    def _send_cors(self):
        origin = self.headers.get("Origin", "")
        if _is_allowed_origin(origin):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Connection", "close")
        self.close_connection = True

    def _send_json_bytes(self, code, data_bytes):
        self.send_response(code)
        self._send_cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data_bytes)))
        self.end_headers()
        self.wfile.write(data_bytes)

    # ------------------------------------------------------------------
    # Xác thực Bearer token
    # ------------------------------------------------------------------
    def _check_auth(self) -> bool:
        auth = self.headers.get("Authorization", "")
        if not auth.startswith("Bearer "):
            return False
        return auth[len("Bearer "):].strip() == BRIDGE_TOKEN

    # ------------------------------------------------------------------
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
            # --- Xác thực token ---
            if not self._check_auth():
                self._send_json_bytes(401, b'{"error": "Unauthorized: invalid or missing token"}')
                return

            # --- Giới hạn body size ---
            content_length = int(self.headers.get("Content-Length", 0))
            if content_length > MAX_BODY_SIZE:
                self._send_json_bytes(413, b'{"error": "Payload too large (> 10 MB)"}')
                return

            try:
                body = self.rfile.read(content_length)
                parsed = json.loads(body.decode("utf-8"))

                # --- Validate schema cơ bản ---
                if not isinstance(parsed.get("version"), int):
                    self._send_json_bytes(400, b'{"error": "Bad Request: missing or invalid field \\"version\\" (int)"}')
                    return
                if "markovCounts" not in parsed and "weights" not in parsed:
                    self._send_json_bytes(400, b'{"error": "Bad Request: body must contain \\"markovCounts\\" or \\"weights\\""}')
                    return

                # --- Đọc revision hiện tại và tăng lên ---
                current_revision = 0
                if os.path.exists(BRAIN_FILE):
                    try:
                        with open(BRAIN_FILE, "r", encoding="utf-8") as f:
                            current_data = json.load(f)
                        current_revision = int(current_data.get("revision", 0))
                    except Exception:
                        current_revision = 0

                parsed["revision"] = current_revision + 1
                parsed["writerId"] = "bridge"
                parsed["savedAt"] = datetime.now().isoformat()

                # --- Ghi file nguyên tử với lock ---
                with write_lock:
                    brain_dir = os.path.dirname(BRAIN_FILE)
                    fd, temp_path = tempfile.mkstemp(dir=brain_dir, prefix='.brain_', suffix='.tmp')
                    try:
                        with os.fdopen(fd, 'w', encoding='utf-8') as f:
                            json.dump(parsed, f, ensure_ascii=False, indent=2)
                            f.flush()
                            os.fsync(f.fileno())
                        os.replace(temp_path, BRAIN_FILE)
                    finally:
                        if os.path.exists(temp_path):
                            try:
                                os.remove(temp_path)
                            except OSError:
                                pass

                self._send_json_bytes(200, json.dumps({"success": True, "saved": True, "revision": parsed["revision"]}).encode("utf-8"))

                now_str = datetime.now().strftime("%H:%M:%S")
                markov_cnt = len(parsed.get("markovCounts", {}))
                streak_cnt = len(parsed.get("streakStats", {}))
                rounds = parsed.get("stats", {}).get("totalRoundsObserved", 0)
                acc = parsed.get("stats", {}).get("accuracy", 0) * 100
                rev = parsed["revision"]
                print(f"[{now_str}] -> [AUTO-SAVE] Da luu vao ai_brain.json (rev={rev} | {rounds} van | {markov_cnt + streak_cnt} mau cau | {acc:.1f}%)")
                sys.stdout.flush()
                return

            except json.JSONDecodeError as e:
                self._send_json_bytes(400, json.dumps({"error": f"Invalid JSON: {e}"}).encode("utf-8"))
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
    print(f"Token file: {TOKEN_FILE}")
    print(f"Token (32-byte): {BRIDGE_TOKEN[:8]}... (an toan)")
    print("San sang nhan du lieu tu Extension (Moi khi co van moi se tu dong luu)...")
    sys.stdout.flush()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
