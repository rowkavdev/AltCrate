"""OS-protected vault and atomic encrypted session persistence."""
from __future__ import annotations
import base64
import os
from pathlib import Path
import keyring
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def vault_key(*, fixture: bool = False) -> bytes:
    if fixture:
        return os.urandom(32)
    backend = keyring.get_keyring()
    if backend.priority <= 0 or not any(part in type(backend).__module__.lower() for part in ("macos", "windows", "secretservice", "kwallet")):
        raise RuntimeError("A proteção de credenciais do sistema não está disponível.")
    encoded = keyring.get_password("pt.casepilot.qt", "session-vault")
    if encoded is None:
        encoded = base64.b64encode(os.urandom(32)).decode("ascii")
        keyring.set_password("pt.casepilot.qt", "session-vault", encoded)
    key = base64.b64decode(encoded, validate=True)
    if len(key) != 32:
        raise RuntimeError("A chave de proteção de credenciais é inválida.")
    return key


class EncryptedStore:
    def __init__(self, directory: Path, key: bytes):
        self.directory = directory
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.cipher = AESGCM(key)

    def read(self, name: str) -> bytes | None:
        file = self.directory / name
        if not file.exists():
            return None
        data = file.read_bytes()
        if data[:4] != b"QTS1":
            raise RuntimeError("O ficheiro de sessão protegido é inválido.")
        return self.cipher.decrypt(data[4:16], data[16:], name.encode())

    def write(self, name: str, value: bytes):
        nonce = os.urandom(12)
        data = b"QTS1" + nonce + self.cipher.encrypt(nonce, value, name.encode())
        file = self.directory / name
        temporary = file.with_suffix(".tmp")
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, file)

    def remove(self, name: str):
        (self.directory / name).unlink(missing_ok=True)
