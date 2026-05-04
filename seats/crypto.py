import base64
import hashlib
import json
import secrets

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


CRYPTO_SCHEMA = 'fuckseats-e2ee-v1'
RSA_KEY_SIZE = 2048
AES_KEY_SIZE = 32
GCM_NONCE_SIZE = 12


def _b64encode(value):
    return base64.b64encode(value).decode('ascii')


def _b64decode(value):
    return base64.b64decode(str(value or '').encode('ascii'))


def compute_key_id(public_key_pem):
    digest = hashlib.sha256(str(public_key_pem or '').encode('utf-8')).hexdigest()
    return f'k-{digest[:32]}'


def generate_rsa_keypair():
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=RSA_KEY_SIZE)
    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode('utf-8')
    public_pem = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode('utf-8')
    return {
        'key_id': compute_key_id(public_pem),
        'private_key_pem': private_pem,
        'public_key_pem': public_pem,
    }


def load_public_key(public_key_pem):
    return serialization.load_pem_public_key(str(public_key_pem or '').encode('utf-8'))


def load_private_key(private_key_pem):
    return serialization.load_pem_private_key(str(private_key_pem or '').encode('utf-8'), password=None)


def encrypt_payload(payload, recipient_public_key_pem, sender_key_id=None):
    plaintext = json.dumps(payload, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    aes_key = secrets.token_bytes(AES_KEY_SIZE)
    nonce = secrets.token_bytes(GCM_NONCE_SIZE)
    ciphertext = AESGCM(aes_key).encrypt(nonce, plaintext, None)
    encrypted_key = load_public_key(recipient_public_key_pem).encrypt(
        aes_key,
        padding.OAEP(
            mgf=padding.MGF1(algorithm=hashes.SHA256()),
            algorithm=hashes.SHA256(),
            label=None,
        ),
    )
    envelope = {
        'schema': CRYPTO_SCHEMA,
        'alg': 'RSA-OAEP-256/AES-256-GCM',
        'encrypted_key': _b64encode(encrypted_key),
        'nonce': _b64encode(nonce),
        'ciphertext': _b64encode(ciphertext),
    }
    if sender_key_id:
        envelope['sender_key_id'] = str(sender_key_id)
    return envelope


def decrypt_payload(envelope, recipient_private_key_pem):
    if not isinstance(envelope, dict):
        raise ValueError('加密信封格式错误')
    if str(envelope.get('schema') or '') != CRYPTO_SCHEMA:
        raise ValueError('不支持的加密协议版本')
    encrypted_key = _b64decode(envelope.get('encrypted_key'))
    nonce = _b64decode(envelope.get('nonce'))
    ciphertext = _b64decode(envelope.get('ciphertext'))
    aes_key = load_private_key(recipient_private_key_pem).decrypt(
        encrypted_key,
        padding.OAEP(
            mgf=padding.MGF1(algorithm=hashes.SHA256()),
            algorithm=hashes.SHA256(),
            label=None,
        ),
    )
    plaintext = AESGCM(aes_key).decrypt(nonce, ciphertext, None)
    return json.loads(plaintext.decode('utf-8'))
