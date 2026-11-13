"""Native transport checks against an in-process local fixture server only."""
import base64
import json
import os
import sys
import tempfile
import threading
import time
import unittest
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
from PySide6.QtCore import QCoreApplication, QEventLoop, QTimer
from PySide6.QtWidgets import QApplication
from PySide6.QtNetwork import QNetworkCookie

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from casepilot.network import NetworkBroker, qt_cookie
from casepilot.security import EncryptedStore

app = QApplication.instance() or QApplication([])


class Responses:
    def __init__(self):
        self.values = {}
        self.events = []

    def reply_native(self, identifier, result=None, error=None):
        self.values[identifier] = (result, error)

    def send(self, value):
        self.events.append(value)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        if self.path == "/slow":
            time.sleep(0.4)
        if self.path == "/redirect":
            self.send_response(302)
            self.send_header("Location", "/cookies")
            self.end_headers()
            return
        value = json.dumps({"cookie": self.headers.get("Cookie"), "method": "GET"}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        if self.path == "/set-cookie":
            self.send_header("Set-Cookie", "fixture=alpha; Path=/; HttpOnly")
        self.send_header("Content-Length", str(len(value)))
        self.end_headers()
        try:
            self.wfile.write(value)
        except BrokenPipeError:
            pass

    def do_POST(self):
        value = self.rfile.read(int(self.headers.get("Content-Length", "0")))
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(value)))
        self.end_headers()
        self.wfile.write(value)


def await_result(responses, identifier):
    loop = QEventLoop()
    timer = QTimer()
    timer.setInterval(5)
    timer.timeout.connect(lambda: loop.quit() if identifier in responses.values else None)
    timeout = QTimer()
    timeout.setSingleShot(True)
    timeout.timeout.connect(loop.quit)
    timer.start()
    timeout.start(3000)
    loop.exec()
    timer.stop()
    timeout.stop()
    if identifier not in responses.values:
        raise AssertionError("Native request timed out: " + identifier)
    return responses.values[identifier]


class NativeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.origin = "http://127.0.0.1:" + str(cls.server.server_port)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.key = os.urandom(32)
        self.store = EncryptedStore(Path(self.temporary.name), self.key)
        self.responses = Responses()
        self.network = NetworkBroker(self.responses, self.store, test_origins=[self.origin])

    def tearDown(self):
        for reply in self.network.replies.values():
            reply.abort()
        self.network.deleteLater()
        app.processEvents()
        self.temporary.cleanup()

    def fetch(self, identifier, path, *, partition="one", **patch):
        self.network.handle({"id": identifier, "method": "session.fetch", "args": {"partition": partition, "url": self.origin + path, **patch}})
        result, error = await_result(self.responses, identifier)
        if error:
            raise AssertionError(error)
        return json.loads(base64.b64decode(result["body"]))

    def test_real_qt_get_and_post(self):
        self.assertEqual(self.fetch("get", "/cookies")["method"], "GET")
        self.assertEqual(self.fetch("post", "/echo", method="POST", body='{"fixture":true}', headers={"content-type": "application/json"}), {"fixture": True})

    def test_cookies_are_isolated_and_omitted_for_public_fetch(self):
        self.fetch("set", "/set-cookie")
        self.assertEqual(self.fetch("private", "/cookies")["cookie"], "fixture=alpha")
        self.assertIsNone(self.fetch("other", "/cookies", partition="two")["cookie"])
        self.assertIsNone(self.fetch("public", "/cookies", credentials="omit")["cookie"])

    def test_cookie_storage_is_encrypted_and_restored(self):
        self.fetch("set", "/set-cookie")
        files = list(Path(self.temporary.name).glob("*.session"))
        self.assertEqual(len(files), 1)
        self.assertNotIn(b"alpha", files[0].read_bytes())
        self.assertEqual(files[0].stat().st_mode & 0o777, 0o600)
        other = NetworkBroker(self.responses, self.store, test_origins=[self.origin])
        cookies = other.session("one").jar.allCookies()
        self.assertEqual(bytes(cookies[0].value()), b"alpha")
        other.deleteLater()

    def test_redirect_error_is_not_followed(self):
        self.network.handle({"id": "redirect", "method": "session.fetch", "args": {"partition": "one", "url": self.origin + "/redirect", "redirect": "error"}})
        result, error = await_result(self.responses, "redirect")
        self.assertIsNone(result)
        self.assertIn("redirecionou", error)

    def test_native_request_can_be_cancelled(self):
        self.network.handle({"id": "slow", "method": "session.fetch", "args": {"partition": "one", "url": self.origin + "/slow"}})
        QTimer.singleShot(20, lambda: self.network.cancel("slow"))
        _, error = await_result(self.responses, "slow")
        self.assertIsNotNone(error)
        self.assertNotIn("slow", self.network.replies)

    def test_production_broker_rejects_other_origins(self):
        network = NetworkBroker(self.responses, self.store)
        for target in (self.origin, "https://evil.example/", "https://case-clicker.com.evil.example/", "http://case-clicker.com/", "https://user@case-clicker.com/"):
            with self.assertRaises(ValueError):
                network.allowed(target)
        network.allowed("https://case-clicker.com/api/me")
        network.allowed("wss://case-clicker.com/socket.io/", websocket=True)
        network.deleteLater()

    def test_tampered_session_is_rejected(self):
        self.store.write("test.session", b"fixture-session")
        file = Path(self.temporary.name) / "test.session"
        content = bytearray(file.read_bytes())
        content[-1] ^= 1
        file.write_bytes(content)
        with self.assertRaises(Exception):
            self.store.read("test.session")

    def test_domain_cookies_preserve_expiration_and_flags(self):
        value = {"name": "fixture", "value": "alpha", "domain": ".case-clicker.com", "path": "/api", "secure": True, "httpOnly": True, "expirationDate": 1900000000}
        cookie = qt_cookie(value)
        self.assertTrue(cookie.isSecure())
        self.assertTrue(cookie.isHttpOnly())
        self.assertEqual(cookie.expirationDate().toSecsSinceEpoch(), 1900000000)


if __name__ == "__main__":
    unittest.main()
