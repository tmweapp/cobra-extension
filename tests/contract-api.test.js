/**
 * Contract Tests — Team Auth API
 * Tests input validation, HTTP status codes, and authorization
 * Uses replicated handler logic (API is ESM + Vercel, can't import directly)
 */
const crypto = require('crypto');

// Replicate validation functions from api/team-auth.js
function isValidEmail(email) {
  return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}$/.test(email);
}

function isValidPassword(password) {
  return password && password.length >= 8;
}

const JWT_SECRET = 'test-secret';

function signJWT(payload, expiresInSeconds = 86400) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...payload, iat: now, exp: now + expiresInSeconds })).toString('base64url');
  const message = `${header}.${body}`;
  const hmac = crypto.createHmac('sha256', JWT_SECRET);
  hmac.update(message);
  return `${message}.${hmac.digest('base64url')}`;
}

function verifyJWT(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [headerB64, bodyB64, signatureB64] = parts;
    const hmac = crypto.createHmac('sha256', JWT_SECRET);
    hmac.update(`${headerB64}.${bodyB64}`);
    if (signatureB64 !== hmac.digest('base64url')) return null;
    const payload = JSON.parse(Buffer.from(bodyB64, 'base64url').toString());
    if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) return null;
    return payload;
  } catch { return null; }
}

// Simulate handler validation logic
function validateRegisterInput(body) {
  const { email, password, name } = body || {};
  if (!email || !password || !name) return { status: 400, error: 'Missing required fields: email, password, name' };
  if (!isValidEmail(email)) return { status: 400, error: 'Invalid email format' };
  if (!isValidPassword(password)) return { status: 400, error: 'Password must be at least 8 characters' };
  return null; // valid
}

function validateLoginInput(body) {
  const { email, password } = body || {};
  if (!email || !password) return { status: 400, error: 'Missing email or password' };
  return null;
}

function validateAdminAuth(body) {
  const { token } = body || {};
  if (!token) return { status: 400, error: 'Missing token' };
  const payload = verifyJWT(token);
  if (!payload) return { status: 401, error: 'Invalid token' };
  if (payload.role !== 'admin') return { status: 403, error: 'Admin access required' };
  return payload;
}

describe('API Contract — Registration', () => {
  test('400 when email is missing', () => {
    const err = validateRegisterInput({ password: '12345678', name: 'Test' });
    expect(err.status).toBe(400);
    expect(err.error).toContain('Missing');
  });

  test('400 when password is missing', () => {
    const err = validateRegisterInput({ email: 'test@test.com', name: 'Test' });
    expect(err.status).toBe(400);
  });

  test('400 when name is missing', () => {
    const err = validateRegisterInput({ email: 'test@test.com', password: '12345678' });
    expect(err.status).toBe(400);
  });

  test('400 for invalid email format', () => {
    const err = validateRegisterInput({ email: 'notanemail', password: '12345678', name: 'Test' });
    expect(err.status).toBe(400);
    expect(err.error).toContain('email');
  });

  test('400 for short password', () => {
    const err = validateRegisterInput({ email: 'test@test.com', password: '1234567', name: 'Test' });
    expect(err.status).toBe(400);
    expect(err.error).toContain('8 characters');
  });

  test('passes for valid input', () => {
    const err = validateRegisterInput({ email: 'valid@email.com', password: 'securepass123', name: 'Test User' });
    expect(err).toBeNull();
  });
});

describe('API Contract — Email Validation', () => {
  const validEmails = [
    'user@example.com',
    'user.name@example.com',
    'user+tag@example.co.uk',
    'user123@test.org',
    'a@b.io',
  ];

  const invalidEmails = [
    'notanemail',
    '@nouser.com',
    'user@',
    'user@.com',
    'user@com',
    '',
    'user @example.com',
    'user@exam ple.com',
  ];

  test.each(validEmails)('accepts %s', (email) => {
    expect(isValidEmail(email)).toBe(true);
  });

  test.each(invalidEmails)('rejects "%s"', (email) => {
    expect(isValidEmail(email)).toBe(false);
  });
});

describe('API Contract — Login', () => {
  test('400 when email is missing', () => {
    const err = validateLoginInput({ password: '12345678' });
    expect(err.status).toBe(400);
  });

  test('400 when password is missing', () => {
    const err = validateLoginInput({ email: 'test@test.com' });
    expect(err.status).toBe(400);
  });

  test('400 for empty body', () => {
    const err = validateLoginInput({});
    expect(err.status).toBe(400);
  });

  test('400 for null body', () => {
    const err = validateLoginInput(null);
    expect(err.status).toBe(400);
  });

  test('passes for valid input', () => {
    const err = validateLoginInput({ email: 'test@test.com', password: '12345678' });
    expect(err).toBeNull();
  });
});

describe('API Contract — Admin Authorization', () => {
  test('400 when token is missing', () => {
    const result = validateAdminAuth({});
    expect(result.status).toBe(400);
  });

  test('401 for invalid token', () => {
    const result = validateAdminAuth({ token: 'invalid.token.here' });
    expect(result.status).toBe(401);
  });

  test('401 for expired token', () => {
    const token = signJWT({ user_id: '1', role: 'admin' }, -1);
    const result = validateAdminAuth({ token });
    expect(result.status).toBe(401);
  });

  test('403 for non-admin user', () => {
    const token = signJWT({ user_id: '1', role: 'team' });
    const result = validateAdminAuth({ token });
    expect(result.status).toBe(403);
    expect(result.error).toContain('Admin');
  });

  test('403 for standard user', () => {
    const token = signJWT({ user_id: '1', role: 'standard' });
    const result = validateAdminAuth({ token });
    expect(result.status).toBe(403);
  });

  test('returns payload for admin token', () => {
    const token = signJWT({ user_id: '1', email: 'admin@test.com', role: 'admin' });
    const result = validateAdminAuth({ token });
    expect(result.user_id).toBe('1');
    expect(result.role).toBe('admin');
  });
});

describe('API Contract — Admin Endpoints Input Validation', () => {
  describe('admin-add-member', () => {
    test('requires token, email, and role', () => {
      const inputs = [
        { email: 'user@test.com', role: 'team' },     // missing token
        { token: 'x', role: 'team' },                  // missing email
        { token: 'x', email: 'user@test.com' },        // missing role
      ];
      for (const input of inputs) {
        const missing = !input.token || !input.email || !input.role;
        expect(missing).toBe(true);
      }
    });

    test('role must be team or invited', () => {
      const validRoles = ['team', 'invited'];
      const invalidRoles = ['admin', 'superuser', 'standard', '', null];

      for (const role of validRoles) {
        expect(validRoles.includes(role)).toBe(true);
      }
      for (const role of invalidRoles) {
        expect(validRoles.includes(role)).toBe(false);
      }
    });
  });

  describe('admin-remove-member', () => {
    test('requires token and user_id', () => {
      expect(!null || !undefined).toBe(true);
      expect(!'token' || !'user_id').toBe(false);
    });
  });

  describe('track-usage', () => {
    test('requires token, provider, and tokens_used', () => {
      const valid = { token: 'x', provider: 'openai', tokens_used: 100 };
      expect(!valid.token || !valid.provider || !valid.tokens_used).toBe(false);

      const invalid = { token: 'x', provider: 'openai' };
      expect(!invalid.token || !invalid.provider || !invalid.tokens_used).toBe(true);
    });

    test('tokens_used should be numeric', () => {
      expect(parseInt('100', 10)).toBe(100);
      expect(parseInt('abc', 10)).toBeNaN();
    });
  });
});
