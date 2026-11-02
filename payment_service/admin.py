"""Optional owner login. Server-only password hashes and expiring installation-bound sessions."""
from contextlib import closing
import hashlib
import hmac
import re
import secrets
import time
from flask import jsonify
from werkzeug.security import check_password_hash

SESSION_SECONDS = 3600


def register_admin(app, settings, db, data, account, rate_limit):
    username = settings.get('CLEARPAGE_ADMIN_USERNAME', '').strip().casefold()
    password_hash = settings.get('CLEARPAGE_ADMIN_PASSWORD_HASH', '')
    if bool(username) != bool(password_hash):
        raise ValueError('Configure both admin username and password hash, or leave both unset.')
    if username and (not re.fullmatch(r'[a-z0-9@._+-]{3,100}', username)
                     or not re.fullmatch(r'scrypt:32768:8:1\$[A-Za-z0-9]{16}\$[a-f0-9]{128}', password_hash)):
        raise ValueError('Use the private admin setup tool to configure a valid password hash.')
    credential_id = hashlib.sha256((username + ':' + password_hash).encode()).hexdigest()
    with closing(db()) as connection, connection:
        connection.execute('''CREATE TABLE IF NOT EXISTS admin_sessions (
            token_hash TEXT PRIMARY KEY, installation TEXT NOT NULL,
            credential_id TEXT NOT NULL, expires INTEGER NOT NULL)''')

    def active(value, installation):
        token = value.get('admin_session')
        if not username or not isinstance(token, str) or not re.fullmatch('[a-f0-9]{64}', token):
            return None
        with closing(db()) as connection:
            row = connection.execute('SELECT expires FROM admin_sessions WHERE token_hash=? AND installation=? AND credential_id=? AND expires>?',
                (hashlib.sha256(token.encode()).hexdigest(), installation, credential_id, int(time.time()))).fetchone()
        return row['expires'] if row else None

    @app.post('/api/admin/login')
    def login():
        rate_limit('admin-login', 5)
        value = data()
        installation = account(value)
        supplied_user, password = value.get('username'), value.get('password')
        if (not username or not isinstance(supplied_user, str) or len(supplied_user)>100
                or not isinstance(password, str) or not 1<=len(password)<=200):
            return jsonify(error='Admin sign-in failed.'), 401
        # Run the password check even when the username is incorrect.
        valid_password = check_password_hash(password_hash, password)
        if not hmac.compare_digest(supplied_user.strip().casefold().encode(), username.encode()) or not valid_password:
            return jsonify(error='Admin sign-in failed.'), 401
        token = secrets.token_hex(32)
        expires = int(time.time()) + SESSION_SECONDS
        with closing(db()) as connection, connection:
            connection.execute('DELETE FROM admin_sessions WHERE expires<=? OR installation=?', (int(time.time()), installation))
            connection.execute('INSERT INTO admin_sessions VALUES (?, ?, ?, ?)',
                (hashlib.sha256(token.encode()).hexdigest(), installation, credential_id, expires))
        return jsonify(session=token, expires_at=expires)

    @app.post('/api/admin/logout')
    def logout():
        rate_limit('admin-logout', 30)
        value = data()
        installation = account(value)
        token = value.get('admin_session')
        if isinstance(token, str) and re.fullmatch('[a-f0-9]{64}', token):
            with closing(db()) as connection, connection:
                connection.execute('DELETE FROM admin_sessions WHERE token_hash=? AND installation=?',
                    (hashlib.sha256(token.encode()).hexdigest(), installation))
        return jsonify(ok=True)

    return active
