/**
 * COBRA Team Authentication API
 * Vercel Serverless Function for team-based access and shared API keys
 *
 * Handles: User registration, login, team management, token usage tracking
 * Environment Variables:
 *   SUPABASE_URL: Supabase project URL
 *   SUPABASE_KEY: Supabase service role key (anon key for client calls)
 *   JWT_SECRET: Secret for signing JWT tokens
 *   ENCRYPTION_KEY: For encrypting shared API keys
 */

import crypto from 'crypto';

// ============================================================
// CONFIGURATION
// ============================================================

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';
const JWT_SECRET = process.env.JWT_SECRET || 'cobra-team-secret-key';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'cobra-encryption-key-32chars!!!!!!';

// Ensure encryption key is proper length
const getEncryptionKey = () => {
  let key = ENCRYPTION_KEY;
  if (key.length < 32) {
    key = key.padEnd(32, '0');
  }
  return key.slice(0, 32);
};

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

/**
 * Hash password using crypto.subtle (Web Crypto API)
 */
async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
}

/**
 * Verify password
 */
async function verifyPassword(password, hash) {
  const newHash = await hashPassword(password);
  return newHash === hash;
}

/**
 * Sign JWT token
 */
function signJWT(payload, expiresInSeconds = 86400) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({
    ...payload,
    iat: now,
    exp: now + expiresInSeconds
  })).toString('base64url');
  const message = `${header}.${body}`;

  const hmac = crypto.createHmac('sha256', JWT_SECRET);
  hmac.update(message);
  const signature = hmac.digest('base64url');

  return `${message}.${signature}`;
}

/**
 * Verify JWT token
 */
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

/**
 * Encrypt text for storage
 */
function encryptKey(text) {
  if (!text) return null;
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(key), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

/**
 * Decrypt text from storage
 */
function decryptKey(encryptedText) {
  if (!encryptedText) return null;
  try {
    const key = getEncryptionKey();
    const [ivHex, encrypted] = encryptedText.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(key), iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (e) {
    console.error('Decryption error:', e.message);
    return null;
  }
}

/**
 * Call Supabase API
 */
async function supabaseCall(method, endpoint, body = null) {
  const url = `${SUPABASE_URL}/rest/v1${endpoint}`;
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'apikey': SUPABASE_KEY
    }
  };

  if (body) options.body = JSON.stringify(body);

  const res = await fetch(url, options);
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.message || `Supabase error: ${res.status}`);
  }

  return data;
}

/**
 * Validate email format
 */
function isValidEmail(email) {
  return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}$/.test(email);
}

/**
 * Validate password strength
 */
function isValidPassword(password) {
  return password && password.length >= 8;
}

// ============================================================
// ACTION HANDLERS
// ============================================================

/**
 * REGISTER: Create new user account
 * Body: { email, password, name }
 */
async function handleRegister(req) {
  const { email, password, name } = req.body;

  if (!email || !password || !name) {
    return { status: 400, error: 'Missing required fields: email, password, name' };
  }

  if (!isValidEmail(email)) {
    return { status: 400, error: 'Invalid email format' };
  }

  if (!isValidPassword(password)) {
    return { status: 400, error: 'Password must be at least 8 characters' };
  }

  try {
    const passwordHash = await hashPassword(password);

    const result = await supabaseCall('POST', '/cobra_users', {
      email: email.toLowerCase(),
      password_hash: passwordHash,
      name: name.trim(),
      role: 'standard'
    });

    return {
      status: 201,
      data: {
        id: result[0]?.id,
        email: result[0]?.email,
        name: result[0]?.name,
        role: result[0]?.role
      }
    };
  } catch (error) {
    if (error.message.includes('unique')) {
      return { status: 409, error: 'Email already registered' };
    }
    return { status: 500, error: error.message };
  }
}

/**
 * LOGIN: Authenticate user and return JWT + team info
 * Body: { email, password }
 */
async function handleLogin(req) {
  const { email, password } = req.body;

  if (!email || !password) {
    return { status: 400, error: 'Missing email or password' };
  }

  try {
    // Find user by email
    const users = await supabaseCall('GET', `/cobra_users?email=eq.${encodeURIComponent(email.toLowerCase())}`);

    if (!users || users.length === 0) {
      return { status: 401, error: 'Invalid credentials' };
    }

    const user = users[0];
    const isValid = await verifyPassword(password, user.password_hash);

    if (!isValid) {
      return { status: 401, error: 'Invalid credentials' };
    }

    // Update last login
    await supabaseCall('PATCH', `/cobra_users?id=eq.${user.id}`, {
      last_login: new Date().toISOString()
    });

    // Check if user is a team member
    let teamInfo = null;
    let sharedKeys = {};

    try {
      const memberships = await supabaseCall('GET', `/cobra_team_members?user_id=eq.${user.id}&active=eq.true`);

      if (memberships && memberships.length > 0) {
        const membership = memberships[0];

        // Fetch team settings
        const teams = await supabaseCall('GET', `/cobra_team_settings?id=eq.${membership.team_id}`);

        if (teams && teams.length > 0) {
          const team = teams[0];
          teamInfo = {
            team_id: team.id,
            team_name: team.team_name,
            role: membership.role,
            token_limit: membership.token_limit || team.max_tokens_per_user,
            date_limit: membership.date_limit,
            tokens_used: membership.tokens_used,
            active: membership.active
          };

          // Decrypt and include shared keys
          sharedKeys = {
            openai_key: decryptKey(team.shared_openai_key),
            anthropic_key: decryptKey(team.shared_anthropic_key),
            gemini_key: decryptKey(team.shared_gemini_key),
            groq_key: decryptKey(team.shared_groq_key),
            eleven_key: decryptKey(team.shared_eleven_key)
          };
        }
      }
    } catch (e) {
      console.error('Error fetching team info:', e.message);
      // Continue without team info - user can still login
    }

    // Generate JWT
    const token = signJWT({
      user_id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      team_id: teamInfo?.team_id || null
    });

    return {
      status: 200,
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role
        },
        team: teamInfo,
        shared_keys: sharedKeys
      }
    };
  } catch (error) {
    return { status: 500, error: error.message };
  }
}

/**
 * ADMIN-LOGIN: Same as LOGIN but checks for admin role
 * Body: { email, password }
 */
async function handleAdminLogin(req) {
  const result = await handleLogin(req);

  if (result.status !== 200) {
    return result;
  }

  const user = result.data?.user;

  if (user?.role !== 'admin') {
    return { status: 403, error: 'Admin access required' };
  }

  // Fetch admin's team settings
  try {
    const teams = await supabaseCall('GET', `/cobra_team_settings?admin_user_id=eq.${user.id}`);

    if (teams && teams.length > 0) {
      result.data.admin_team = {
        id: teams[0].id,
        team_name: teams[0].team_name,
        max_tokens_per_user: teams[0].max_tokens_per_user
      };
    }
  } catch (e) {
    console.error('Error fetching admin team:', e.message);
  }

  return result;
}

/**
 * ADMIN-ADD-MEMBER: Add user to team
 * Body: { token, email, role, token_limit, date_limit }
 */
async function handleAdminAddMember(req) {
  const { token, email, role, token_limit, date_limit } = req.body;

  if (!token || !email || !role) {
    return { status: 400, error: 'Missing token, email, or role' };
  }

  const payload = verifyJWT(token);
  if (!payload) {
    return { status: 401, error: 'Invalid token' };
  }

  if (payload.role !== 'admin') {
    return { status: 403, error: 'Admin access required' };
  }

  if (!['team', 'invited'].includes(role)) {
    return { status: 400, error: 'Role must be "team" or "invited"' };
  }

  try {
    // Find or create user
    let user = null;
    const existingUsers = await supabaseCall('GET', `/cobra_users?email=eq.${encodeURIComponent(email.toLowerCase())}`);

    if (existingUsers && existingUsers.length > 0) {
      user = existingUsers[0];
    } else {
      // Create user with temporary password
      const tempPassword = crypto.randomBytes(16).toString('hex');
      const passwordHash = await hashPassword(tempPassword);

      const newUsers = await supabaseCall('POST', '/cobra_users', {
        email: email.toLowerCase(),
        password_hash: passwordHash,
        name: email.split('@')[0],
        role: 'invited'
      });

      user = newUsers[0];
    }

    // Get admin's team
    const teams = await supabaseCall('GET', `/cobra_team_settings?admin_user_id=eq.${payload.user_id}`);
    if (!teams || teams.length === 0) {
      return { status: 404, error: 'Admin team not found' };
    }

    const team = teams[0];

    // Add member to team
    const members = await supabaseCall('POST', '/cobra_team_members', {
      team_id: team.id,
      user_id: user.id,
      role,
      token_limit: token_limit || null,
      date_limit: date_limit || null
    });

    return {
      status: 201,
      data: {
        id: members[0]?.id,
        email: user.email,
        name: user.name,
        role: members[0]?.role,
        token_limit: members[0]?.token_limit,
        date_limit: members[0]?.date_limit
      }
    };
  } catch (error) {
    if (error.message.includes('unique')) {
      return { status: 409, error: 'User already in team' };
    }
    return { status: 500, error: error.message };
  }
}

/**
 * ADMIN-REMOVE-MEMBER: Deactivate team member
 * Body: { token, user_id }
 */
async function handleAdminRemoveMember(req) {
  const { token, user_id } = req.body;

  if (!token || !user_id) {
    return { status: 400, error: 'Missing token or user_id' };
  }

  const payload = verifyJWT(token);
  if (!payload) {
    return { status: 401, error: 'Invalid token' };
  }

  if (payload.role !== 'admin') {
    return { status: 403, error: 'Admin access required' };
  }

  try {
    // Verify member belongs to admin's team
    const teams = await supabaseCall('GET', `/cobra_team_settings?admin_user_id=eq.${payload.user_id}`);
    if (!teams || teams.length === 0) {
      return { status: 404, error: 'Team not found' };
    }

    const team = teams[0];
    const members = await supabaseCall('GET', `/cobra_team_members?team_id=eq.${team.id}&user_id=eq.${user_id}`);

    if (!members || members.length === 0) {
      return { status: 404, error: 'Member not found' };
    }

    // Deactivate member
    await supabaseCall('PATCH', `/cobra_team_members?id=eq.${members[0].id}`, {
      active: false
    });

    return { status: 200, data: { message: 'Member removed' } };
  } catch (error) {
    return { status: 500, error: error.message };
  }
}

/**
 * ADMIN-LIST-MEMBERS: Get all team members
 * Body: { token }
 * Authorization: Bearer <jwt>
 */
async function handleAdminListMembers(req) {
  // Extract token from body or Authorization header, never from query string
  let token = req.body?.token;
  if (!token && req.headers?.authorization) {
    const match = req.headers.authorization.match(/^Bearer\s+(.+)$/);
    if (match) token = match[1];
  }

  if (!token) {
    return { status: 400, error: 'Missing token' };
  }

  const payload = verifyJWT(token);
  if (!payload) {
    return { status: 401, error: 'Invalid token' };
  }

  if (payload.role !== 'admin') {
    return { status: 403, error: 'Admin access required' };
  }

  try {
    const teams = await supabaseCall('GET', `/cobra_team_settings?admin_user_id=eq.${payload.user_id}`);
    if (!teams || teams.length === 0) {
      return { status: 404, error: 'Team not found' };
    }

    const team = teams[0];
    const members = await supabaseCall('GET', `/cobra_team_members?team_id=eq.${team.id}&order=invited_at.desc`);

    const memberList = (members || []).map(m => ({
      id: m.id,
      user_id: m.user_id,
      email: m.email || 'unknown',
      name: m.name || 'Unknown',
      role: m.role,
      token_limit: m.token_limit,
      date_limit: m.date_limit,
      tokens_used: m.tokens_used,
      active: m.active,
      invited_at: m.invited_at,
      accepted_at: m.accepted_at
    }));

    return {
      status: 200,
      data: {
        team_id: team.id,
        team_name: team.team_name,
        max_tokens_per_user: team.max_tokens_per_user,
        members: memberList
      }
    };
  } catch (error) {
    return { status: 500, error: error.message };
  }
}

/**
 * ADMIN-SET-KEYS: Save shared API keys
 * Body: { token, openai_key, anthropic_key, gemini_key, groq_key, eleven_key }
 */
async function handleAdminSetKeys(req) {
  const { token, openai_key, anthropic_key, gemini_key, groq_key, eleven_key } = req.body;

  if (!token) {
    return { status: 400, error: 'Missing token' };
  }

  const payload = verifyJWT(token);
  if (!payload) {
    return { status: 401, error: 'Invalid token' };
  }

  if (payload.role !== 'admin') {
    return { status: 403, error: 'Admin access required' };
  }

  try {
    const teams = await supabaseCall('GET', `/cobra_team_settings?admin_user_id=eq.${payload.user_id}`);
    if (!teams || teams.length === 0) {
      return { status: 404, error: 'Team not found' };
    }

    const team = teams[0];

    // Encrypt keys
    const encrypted = {
      shared_openai_key: encryptKey(openai_key),
      shared_anthropic_key: encryptKey(anthropic_key),
      shared_gemini_key: encryptKey(gemini_key),
      shared_groq_key: encryptKey(groq_key),
      shared_eleven_key: encryptKey(eleven_key)
    };

    // Update team settings
    await supabaseCall('PATCH', `/cobra_team_settings?id=eq.${team.id}`, {
      ...encrypted,
      updated_at: new Date().toISOString()
    });

    return { status: 200, data: { message: 'Keys saved' } };
  } catch (error) {
    return { status: 500, error: error.message };
  }
}

/**
 * ADMIN-GET-KEYS: Retrieve shared API keys
 * Body: { token }
 * Authorization: Bearer <jwt>
 */
async function handleAdminGetKeys(req) {
  // Extract token from body or Authorization header, never from query string
  let token = req.body?.token;
  if (!token && req.headers?.authorization) {
    const match = req.headers.authorization.match(/^Bearer\s+(.+)$/);
    if (match) token = match[1];
  }

  if (!token) {
    return { status: 400, error: 'Missing token' };
  }

  const payload = verifyJWT(token);
  if (!payload) {
    return { status: 401, error: 'Invalid token' };
  }

  if (payload.role !== 'admin') {
    return { status: 403, error: 'Admin access required' };
  }

  try {
    const teams = await supabaseCall('GET', `/cobra_team_settings?admin_user_id=eq.${payload.user_id}`);
    if (!teams || teams.length === 0) {
      return { status: 404, error: 'Team not found' };
    }

    const team = teams[0];

    return {
      status: 200,
      data: {
        openai_key: decryptKey(team.shared_openai_key),
        anthropic_key: decryptKey(team.shared_anthropic_key),
        gemini_key: decryptKey(team.shared_gemini_key),
        groq_key: decryptKey(team.shared_groq_key),
        eleven_key: decryptKey(team.shared_eleven_key)
      }
    };
  } catch (error) {
    return { status: 500, error: error.message };
  }
}

/**
 * CHECK-ACCESS: Validate token and return access info
 * Body: { token }
 * Authorization: Bearer <jwt>
 */
async function handleCheckAccess(req) {
  // Extract token from body or Authorization header, never from query string
  let token = req.body?.token;
  if (!token && req.headers?.authorization) {
    const match = req.headers.authorization.match(/^Bearer\s+(.+)$/);
    if (match) token = match[1];
  }

  if (!token) {
    return { status: 400, error: 'Missing token' };
  }

  const payload = verifyJWT(token);
  if (!payload) {
    return { status: 401, error: 'Invalid token' };
  }

  try {
    // Get user info
    const users = await supabaseCall('GET', `/cobra_users?id=eq.${payload.user_id}`);
    if (!users || users.length === 0) {
      return { status: 404, error: 'User not found' };
    }

    const user = users[0];
    let sharedKeys = {};
    let teamInfo = null;

    // Check for team membership
    const memberships = await supabaseCall('GET', `/cobra_team_members?user_id=eq.${payload.user_id}&active=eq.true`);

    if (memberships && memberships.length > 0) {
      const membership = memberships[0];
      const teams = await supabaseCall('GET', `/cobra_team_settings?id=eq.${membership.team_id}`);

      if (teams && teams.length > 0) {
        const team = teams[0];

        // Check if user is still within date limit
        if (membership.date_limit && new Date(membership.date_limit) < new Date()) {
          return { status: 403, error: 'Access expired' };
        }

        teamInfo = {
          team_id: team.id,
          team_name: team.team_name,
          role: membership.role,
          token_limit: membership.token_limit || team.max_tokens_per_user,
          date_limit: membership.date_limit,
          tokens_used: membership.tokens_used,
          active: membership.active
        };

        sharedKeys = {
          openai_key: decryptKey(team.shared_openai_key),
          anthropic_key: decryptKey(team.shared_anthropic_key),
          gemini_key: decryptKey(team.shared_gemini_key),
          groq_key: decryptKey(team.shared_groq_key),
          eleven_key: decryptKey(team.shared_eleven_key)
        };
      }
    }

    return {
      status: 200,
      data: {
        valid: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role
        },
        team: teamInfo,
        shared_keys: sharedKeys
      }
    };
  } catch (error) {
    return { status: 500, error: error.message };
  }
}

/**
 * TRACK-USAGE: Log token usage
 * Body: { token, provider, tokens_used }
 */
async function handleTrackUsage(req) {
  const { token, provider, tokens_used } = req.body;

  if (!token || !provider || !tokens_used) {
    return { status: 400, error: 'Missing token, provider, or tokens_used' };
  }

  const payload = verifyJWT(token);
  if (!payload) {
    return { status: 401, error: 'Invalid token' };
  }

  try {
    // Log usage
    await supabaseCall('POST', '/cobra_api_usage', {
      user_id: payload.user_id,
      provider,
      tokens_used: parseInt(tokens_used, 10),
      timestamp: new Date().toISOString()
    });

    // Update team member's tokens_used if they're a team member
    const memberships = await supabaseCall('GET', `/cobra_team_members?user_id=eq.${payload.user_id}&active=eq.true`);

    if (memberships && memberships.length > 0) {
      const membership = memberships[0];
      const newTotal = (membership.tokens_used || 0) + parseInt(tokens_used, 10);

      await supabaseCall('PATCH', `/cobra_team_members?id=eq.${membership.id}`, {
        tokens_used: newTotal
      });
    }

    return { status: 200, data: { message: 'Usage tracked' } };
  } catch (error) {
    return { status: 500, error: error.message };
  }
}

// ============================================================
// MAIN HANDLER
// ============================================================

export default async function handler(req, res) {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(200).end();
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Content-Type', 'application/json');

  const action = req.query.action || req.body?.action;

  if (!action) {
    return res.status(400).json({ error: 'Missing action parameter' });
  }

  let result = { status: 400, error: 'Unknown action' };

  try {
    switch (action) {
      case 'register':
        result = await handleRegister(req);
        break;
      case 'login':
        result = await handleLogin(req);
        break;
      case 'admin-login':
        result = await handleAdminLogin(req);
        break;
      case 'admin-add-member':
        result = await handleAdminAddMember(req);
        break;
      case 'admin-remove-member':
        result = await handleAdminRemoveMember(req);
        break;
      case 'admin-list-members':
        result = await handleAdminListMembers(req);
        break;
      case 'admin-set-keys':
        result = await handleAdminSetKeys(req);
        break;
      case 'admin-get-keys':
        result = await handleAdminGetKeys(req);
        break;
      case 'check-access':
        result = await handleCheckAccess(req);
        break;
      case 'track-usage':
        result = await handleTrackUsage(req);
        break;
      default:
        result = { status: 400, error: `Unknown action: ${action}` };
    }
  } catch (error) {
    console.error(`Action ${action} failed:`, error);
    result = { status: 500, error: error.message || 'Internal server error' };
  }

  const { status, data, error } = result;

  if (error) {
    return res.status(status || 500).json({ error });
  }

  return res.status(status || 200).json(data || {});
}
