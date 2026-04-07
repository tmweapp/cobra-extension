// Test JWT sign/verify functions from api/team-auth.js
// We extract the functions since the module uses ESM imports
const crypto = require('crypto');

const JWT_SECRET = 'test-secret-key';

// Replicate signJWT from api/team-auth.js (with expiration)
function signJWT(payload, expiresInSeconds = 86400) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({
    ...payload,
    iat: now,
    exp: now + expiresInSeconds,
  })).toString('base64url');
  const message = `${header}.${body}`;

  const hmac = crypto.createHmac('sha256', JWT_SECRET);
  hmac.update(message);
  const signature = hmac.digest('base64url');

  return `${message}.${signature}`;
}

function verifyJWT(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [headerB64, bodyB64, signatureB64] = parts;
    const message = `${headerB64}.${bodyB64}`;

    const hmac = crypto.createHmac('sha256', JWT_SECRET);
    hmac.update(message);
    const expectedSignature = hmac.digest('base64url');

    if (signatureB64 !== expectedSignature) return null;

    const payload = JSON.parse(Buffer.from(bodyB64, 'base64url').toString());

    // Check token expiration
    if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) {
      return null;
    }

    return payload;
  } catch (e) {
    return null;
  }
}

describe('JWT Functions', () => {
  describe('signJWT()', () => {
    test('produces a 3-part token', () => {
      const token = signJWT({ userId: '123', role: 'admin' });
      expect(token.split('.').length).toBe(3);
    });

    test('includes payload data', () => {
      const token = signJWT({ userId: '123' });
      const parts = token.split('.');
      const body = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
      expect(body.userId).toBe('123');
    });

    test('includes iat and exp', () => {
      const token = signJWT({ userId: '123' }, 3600);
      const parts = token.split('.');
      const body = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
      expect(body.iat).toBeDefined();
      expect(body.exp).toBeDefined();
      expect(body.exp - body.iat).toBe(3600);
    });

    test('default expiration is 24 hours', () => {
      const token = signJWT({ userId: '123' });
      const parts = token.split('.');
      const body = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
      expect(body.exp - body.iat).toBe(86400);
    });
  });

  describe('verifyJWT()', () => {
    test('verifies a valid token', () => {
      const token = signJWT({ userId: '123', role: 'team' });
      const payload = verifyJWT(token);
      expect(payload).not.toBeNull();
      expect(payload.userId).toBe('123');
      expect(payload.role).toBe('team');
    });

    test('returns null for tampered token', () => {
      const token = signJWT({ userId: '123' });
      // Tamper with the payload
      const parts = token.split('.');
      const tamperedBody = Buffer.from(JSON.stringify({ userId: '999', iat: 1, exp: 99999999999 })).toString('base64url');
      const tampered = `${parts[0]}.${tamperedBody}.${parts[2]}`;
      expect(verifyJWT(tampered)).toBeNull();
    });

    test('returns null for invalid format', () => {
      expect(verifyJWT('not.a.valid.token')).toBeNull();
      expect(verifyJWT('invalid')).toBeNull();
      expect(verifyJWT('')).toBeNull();
    });

    test('returns null for expired token', () => {
      // Create token that expires in 1 second
      const token = signJWT({ userId: '123' }, -1); // already expired
      expect(verifyJWT(token)).toBeNull();
    });

    test('accepts non-expired token', () => {
      const token = signJWT({ userId: '123' }, 3600);
      expect(verifyJWT(token)).not.toBeNull();
    });
  });

  describe('Token Security', () => {
    test('different payloads produce different tokens', () => {
      const t1 = signJWT({ userId: '1' });
      const t2 = signJWT({ userId: '2' });
      expect(t1).not.toBe(t2);
    });

    test('header specifies HS256', () => {
      const token = signJWT({ test: true });
      const header = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString());
      expect(header.alg).toBe('HS256');
      expect(header.typ).toBe('JWT');
    });
  });
});
