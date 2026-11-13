"""Isolated Qt network sessions with encrypted cookie persistence."""
from __future__ import annotations
import base64
import hashlib
import json
import time
from urllib.parse import urlsplit
from PySide6.QtCore import QByteArray, QDateTime, QObject, QUrl
from PySide6.QtNetwork import QNetworkAccessManager, QNetworkCookie, QNetworkCookieJar, QNetworkProxy, QNetworkReply, QNetworkRequest
from PySide6.QtWebSockets import QWebSocket, QWebSocketProtocol

ORIGIN = "https://case-clicker.com"


def cookie_value(cookie):
    return {
        "name": bytes(cookie.name()).decode("utf-8"), "value": bytes(cookie.value()).decode("utf-8"),
        "domain": cookie.domain(), "path": cookie.path() or "/",
        "secure": cookie.isSecure(), "httpOnly": cookie.isHttpOnly(),
        **({"expirationDate": cookie.expirationDate().toSecsSinceEpoch()} if not cookie.isSessionCookie() else {}),
    }


def qt_cookie(value):
    cookie = QNetworkCookie(str(value["name"]).encode(), str(value["value"]).encode())
    cookie.setDomain(value.get("domain", "case-clicker.com"))
    cookie.setPath(value.get("path", "/"))
    cookie.setSecure(value.get("secure", True))
    cookie.setHttpOnly(value.get("httpOnly", False))
    if value.get("expirationDate") is not None:
        cookie.setExpirationDate(QDateTime.fromSecsSinceEpoch(int(value["expirationDate"])))
    return cookie


class CookieJar(QNetworkCookieJar):
    def __init__(self, session):
        super().__init__(session)
        self.session = session

    def setCookiesFromUrl(self, cookies, url):
        result = super().setCookiesFromUrl(cookies, url)
        if result:
            self.session.persist()
            if self.session.browser_profile:
                for cookie in cookies:
                    self.session.browser_profile.cookieStore().setCookie(cookie, url)
        return result


class Session(QObject):
    def __init__(self, partition, store, parent=None):
        super().__init__(parent)
        self.partition = partition
        self.store = store
        self.filename = hashlib.sha256(partition.encode()).hexdigest() + ".session"
        self.manager = QNetworkAccessManager(self)
        self.jar = CookieJar(self)
        self.manager.setCookieJar(self.jar)
        self.manager.setTransferTimeout(30000)
        self.browser_profile = None
        self.proxy = QNetworkProxy(QNetworkProxy.DefaultProxy)
        self.user_agent = "CasePilot-Qt/0.4.0"
        saved = self.store.read(self.filename)
        if saved:
            value = json.loads(saved)
            cookies = value if isinstance(value, list) else value["cookies"]
            if isinstance(value, dict) and isinstance(value.get("userAgent"), str):
                self.user_agent = value["userAgent"]
            self.jar.setAllCookies([qt_cookie(cookie) for cookie in cookies])

    def persist(self):
        cookies = [cookie_value(cookie) for cookie in self.jar.allCookies()
                   if cookie.isSessionCookie() or cookie.expirationDate().toSecsSinceEpoch() > time.time()]
        self.store.write(self.filename, json.dumps({"cookies": cookies, "userAgent": self.user_agent}).encode())

    def set_proxy(self, options):
        rule = options.get("proxyRules") if options.get("mode") == "fixed_servers" else None
        if not rule:
            self.proxy = QNetworkProxy(QNetworkProxy.DefaultProxy)
        else:
            parsed = urlsplit(rule)
            if parsed.scheme not in ("http", "socks5") or not parsed.hostname or not parsed.port or parsed.username or parsed.password:
                raise ValueError("Configuração de proxy inválida.")
            kind = QNetworkProxy.HttpProxy if parsed.scheme == "http" else QNetworkProxy.Socks5Proxy
            self.proxy = QNetworkProxy(kind, parsed.hostname, parsed.port)
        self.manager.setProxy(self.proxy)

    def profile(self):
        if self.browser_profile is None:
            from PySide6.QtWebEngineCore import QWebEngineProfile
            # Off-the-record Chromium profile. Session cookies are persisted only
            # through our OS-protected encrypted store, independently per account.
            self.browser_profile = QWebEngineProfile(self)
            self.user_agent = self.browser_profile.httpUserAgent()
            self.browser_profile.setPersistentCookiesPolicy(QWebEngineProfile.NoPersistentCookies)
            self.browser_profile.setHttpCacheType(QWebEngineProfile.MemoryHttpCache)
            self.browser_profile.cookieStore().cookieAdded.connect(self.browser_cookie_added)
            self.browser_profile.cookieStore().cookieRemoved.connect(self.browser_cookie_removed)
            for cookie in self.jar.allCookies():
                self.browser_profile.cookieStore().setCookie(cookie, QUrl(ORIGIN + (cookie.path() or "/")))
        return self.browser_profile

    def browser_cookie_added(self, cookie):
        self.jar.insertCookie(cookie)
        self.persist()

    def browser_cookie_removed(self, cookie):
        self.jar.deleteCookie(cookie)
        self.persist()

    def clear(self):
        self.jar.setAllCookies([])
        if self.browser_profile:
            self.browser_profile.cookieStore().deleteAllCookies()
            self.browser_profile.clearHttpCache()
        self.persist()


class NetworkBroker(QObject):
    def __init__(self, bridge, store, parent=None, *, test_origins=()):
        super().__init__(parent)
        self.bridge = bridge
        self.store = store
        self.sessions = {}
        self.replies = {}
        self.sockets = {}
        self.test_origins = set(test_origins)

    def session(self, partition):
        if not isinstance(partition, str) or not partition or len(partition) > 200:
            raise ValueError("Sessão de conta inválida.")
        if partition not in self.sessions:
            self.sessions[partition] = Session(partition, self.store, self)
        return self.sessions[partition]

    def allowed(self, url, *, websocket=False):
        parsed = urlsplit(url)
        expected_scheme = "wss" if websocket else "https"
        allowed_hosts = {"case-clicker.com", "ws.case-clicker.com"} if websocket else {"case-clicker.com"}
        if parsed.scheme == expected_scheme and parsed.hostname in allowed_hosts and parsed.port in (None, 443) and not parsed.username:
            return
        origin = f"{parsed.scheme}://{parsed.netloc}"
        if origin in self.test_origins:
            return
        raise ValueError("A ligação não pertence ao site do jogo.")

    def handle(self, message):
        identifier, method, args = message["id"], message["method"], message.get("args", {})
        if method == "session.fetch":
            self.fetch(identifier, args)
            return
        if method.startswith("socket."):
            self.socket_request(identifier, method, args)
            return
        ses = self.session(args["partition"])
        result = None
        if method == "session.proxy":
            ses.set_proxy(args["options"])
        elif method == "session.closeConnections":
            ses.manager.clearConnectionCache()
        elif method == "session.clear":
            ses.clear()
        elif method == "session.clearCache":
            ses.manager.clearAccessCache()
            if ses.browser_profile:
                ses.browser_profile.clearHttpCache()
        elif method == "cookies.get":
            filter_ = args.get("filter", {})
            url = QUrl(filter_.get("url", ORIGIN))
            result = [cookie_value(cookie) for cookie in ses.jar.cookiesForUrl(url)]
            if filter_.get("name"):
                result = [cookie for cookie in result if cookie["name"] == filter_["name"]]
        elif method == "cookies.set":
            value = args["cookie"]
            self.allowed(value.get("url", ORIGIN))
            cookie = qt_cookie(value)
            if cookie.domain().lstrip(".") != "case-clicker.com":
                raise ValueError("Domínio do cookie inválido.")
            ses.jar.insertCookie(cookie)
            if ses.browser_profile:
                ses.browser_profile.cookieStore().setCookie(cookie, QUrl(value.get("url", ORIGIN)))
            ses.persist()
        elif method == "cookies.remove":
            self.allowed(args["url"])
            for cookie in ses.jar.cookiesForUrl(QUrl(args["url"])):
                if bytes(cookie.name()).decode() == args["name"]:
                    ses.jar.deleteCookie(cookie)
                    if ses.browser_profile:
                        ses.browser_profile.cookieStore().deleteCookie(cookie)
            ses.persist()
        elif method == "cookies.flush":
            ses.persist()
        else:
            raise ValueError("Operação de rede desconhecida.")
        self.bridge.reply_native(identifier, result)

    def fetch(self, identifier, args):
        self.allowed(args["url"])
        ses = self.session(args["partition"])
        request = QNetworkRequest(QUrl(args["url"]))
        request.setRawHeader(b"User-Agent", ses.user_agent.encode())
        for name, value in args.get("headers", {}).items():
            if name.lower() in ("host", "cookie", "authorization"):
                raise ValueError("Cabeçalho de sessão inválido.")
            request.setRawHeader(name.encode(), str(value).encode())
        policy = QNetworkRequest.ManualRedirectPolicy if args.get("redirect") in ("error", "manual") else QNetworkRequest.SameOriginRedirectPolicy
        request.setAttribute(QNetworkRequest.RedirectPolicyAttribute, policy)
        if args.get("credentials") == "omit":
            request.setAttribute(QNetworkRequest.CookieLoadControlAttribute, QNetworkRequest.Manual)
            request.setAttribute(QNetworkRequest.CookieSaveControlAttribute, QNetworkRequest.Manual)
        body = args.get("body") or ""
        if not isinstance(body, str):
            raise ValueError("Corpo do pedido inválido.")
        reply = ses.manager.sendCustomRequest(request, args.get("method", "GET").encode(), QByteArray(body.encode()))
        self.replies[identifier] = reply
        reply.finished.connect(lambda: self._finish(identifier, reply, args))

    def _finish(self, identifier, reply, args):
        self.replies.pop(identifier, None)
        status = reply.attribute(QNetworkRequest.HttpStatusCodeAttribute)
        if status is None:
            self.bridge.reply_native(identifier, error="Não foi possível contactar o site: " + reply.errorString())
        elif 300 <= status < 400 and args.get("redirect") == "error":
            self.bridge.reply_native(identifier, error="O site redirecionou o pedido; confirma a sessão antes de continuar.")
        else:
            self.bridge.reply_native(identifier, {
                "status": status, "statusText": reply.attribute(QNetworkRequest.HttpReasonPhraseAttribute) or "",
                "headers": [[bytes(name).decode("latin1"), bytes(value).decode("latin1")] for name, value in reply.rawHeaderPairs()],
                "body": base64.b64encode(bytes(reply.readAll())).decode("ascii"),
            })
        reply.deleteLater()

    def cancel(self, identifier):
        reply = self.replies.get(identifier)
        if reply:
            reply.abort()

    def socket_request(self, identifier, method, args):
        socket_id = args["id"]
        if method == "socket.open":
            self.allowed(args["url"], websocket=True)
            ses = self.session(args["partition"])
            socket = QWebSocket(ORIGIN, QWebSocketProtocol.VersionLatest, self)
            socket.setProxy(ses.proxy)
            self.sockets[socket_id] = socket
            def notify(event, **payload):
                self.bridge.send({"type": "native-event", "kind": "socket", "id": socket_id, "event": event, **payload})
            socket.connected.connect(lambda: notify("open"))
            socket.textMessageReceived.connect(lambda data: notify("message", data=data))
            socket.binaryMessageReceived.connect(lambda data: notify("message", data=base64.b64encode(bytes(data)).decode("ascii"), binary=True))
            socket.errorOccurred.connect(lambda _: notify("error", reason=socket.errorString()))
            def closed():
                notify("close", code=socket.closeCode().value, reason=socket.closeReason())
                self.sockets.pop(socket_id, None)
                socket.deleteLater()
            socket.disconnected.connect(closed)
            request = QNetworkRequest(QUrl(args["url"]))
            request.setRawHeader(b"Origin", ORIGIN.encode())
            request.setRawHeader(b"User-Agent", ses.user_agent.encode())
            https_url = QUrl(args["url"].replace("wss://", "https://", 1))
            cookies = ses.jar.cookiesForUrl(https_url)
            if cookies:
                request.setRawHeader(b"Cookie", b"; ".join(bytes(cookie.name()) + b"=" + bytes(cookie.value()) for cookie in cookies))
            if args.get("protocols"):
                request.setRawHeader(b"Sec-WebSocket-Protocol", ", ".join(args["protocols"]).encode())
            socket.open(request)
        else:
            socket = self.sockets.get(socket_id)
            if socket:
                if method == "socket.send":
                    if args.get("binary"):
                        socket.sendBinaryMessage(QByteArray(base64.b64decode(args["data"])))
                    else:
                        socket.sendTextMessage(args["data"])
                elif method == "socket.close":
                    socket.close()
                else:
                    raise ValueError("Operação de socket desconhecida.")
        self.bridge.reply_native(identifier)
