from collections import OrderedDict
from urllib.parse import urlsplit
from PySide6.QtCore import QObject, Signal, QUrl
from PySide6.QtGui import QPixmap
from PySide6.QtNetwork import QNetworkAccessManager, QNetworkRequest


class ImageLoader(QObject):
    loaded = Signal(str)
    def __init__(self, parent=None):
        super().__init__(parent)
        self.manager = QNetworkAccessManager(self)
        self.cache = OrderedDict()
        self.pending = set()

    def get(self, url):
        if not url:
            return None
        if url in self.cache:
            self.cache.move_to_end(url)
            return self.cache[url]
        parsed = urlsplit(url)
        if parsed.scheme != "https" or parsed.hostname not in ("case-clicker.com", "cdn.case-clicker.com", "steamcommunity-a.akamaihd.net") or parsed.username or url in self.pending:
            return None
        self.pending.add(url)
        request = QNetworkRequest(QUrl(url))
        request.setAttribute(QNetworkRequest.RedirectPolicyAttribute, QNetworkRequest.SameOriginRedirectPolicy)
        request.setTransferTimeout(15000)
        reply = self.manager.get(request)
        reply.downloadProgress.connect(lambda received, _: reply.abort() if received > 5 * 1024 * 1024 else None)
        def done():
            self.pending.discard(url)
            image = QPixmap()
            if not reply.error() and image.loadFromData(reply.readAll()):
                from PySide6.QtCore import Qt
                self.cache[url] = image.scaled(256, 256, Qt.KeepAspectRatio, Qt.SmoothTransformation)
            else:
                self.cache[url] = None
            while len(self.cache) > 256:
                self.cache.popitem(last=False)
            reply.deleteLater()
            self.loaded.emit(url)
        reply.finished.connect(done)
        return None
