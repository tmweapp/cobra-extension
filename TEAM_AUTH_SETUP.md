# COBRA Team Authentication System - Setup Guide

## Overview

The COBRA Team Authentication system enables team-based access with shared API keys, member management, and token usage tracking. Luca can now manage his COBRA team with ease.

## Files Created

### 1. Backend Files

#### `/sql/team-auth.sql`
- Supabase PostgreSQL migration file
- Creates 5 tables: `cobra_users`, `cobra_team_settings`, `cobra_team_members`, `cobra_api_usage`
- Includes Row Level Security (RLS) policies for data protection
- Utility functions for team management and usage tracking

#### `/api/team-auth.js`
- Vercel serverless function (single file, deployable)
- Handles 10 actions via query parameter `action`:
  - `register` - Create new user account
  - `login` - User authentication with JWT token
  - `admin-login` - Admin-only login
  - `admin-add-member` - Add team member
  - `admin-remove-member` - Remove team member
  - `admin-list-members` - List all team members with usage stats
  - `admin-set-keys` - Save encrypted shared API keys
  - `admin-get-keys` - Retrieve shared API keys (admin only)
  - `check-access` - Validate token and check limits
  - `track-usage` - Log token usage
- Uses bcrypt-style hashing for passwords (via crypto.subtle)
- JWT token signing/verification for session management
- AES-256-CBC encryption for API keys at rest

### 2. Frontend Files

#### `/admin.html`
- Standalone admin panel (single HTML file, no build required)
- IntelliFlow dark theme design (bg: #0A0A0D, cyan: #52BBFF, purple: #B24BFF)
- Glassmorphic UI with backdrop blur
- Features:
  - Admin login form (email + password)
  - Team members dashboard with stats
  - Add/remove members with role and limit management
  - API keys management (encrypt/decrypt for display)
  - Usage tracking and token limits
- Fully responsive design for desktop and tablet
- Accessible directly via browser

#### `/team-auth.js`
- Client-side module for the extension
- Manages team authentication and session
- Key methods:
  - `login(email, password)` - Authenticate with team
  - `logout()` - Clear token and team keys
  - `checkAccess()` - Validate token and get access info
  - `canUseProvider(provider)` - Check token limits before AI call
  - `trackUsage(provider, tokensUsed)` - Log token consumption
  - `getSession()` - Get current session info
  - `getEffectiveKeys()` - Get user's or team's keys
- Stores token in `chrome.storage.local.cobra_team_token`
- Merges team keys into `cobra_settings` on login
- Exported as `self.TeamAuth` for bg-chat.js access

#### `/onboarding.js` (Updated)
- Added "Accesso Team" button with divider to Step 1
- New team login flow:
  - Email + password form
  - Optional name field
  - Validates credentials against backend
  - Saves team token and shared keys
  - Completes onboarding with team setup
- Integrates seamlessly with existing API key setup
- Users can choose between:
  - Traditional API key setup (Step 1 → Step 2)
  - Team login (Step 1 → Team Login Form → Complete)

## Deployment Instructions

### Step 1: Deploy Supabase Migration

1. Go to [Supabase Dashboard](https://app.supabase.com)
2. Select your project
3. Go to **SQL Editor**
4. Click **New Query**
5. Paste the entire contents of `/sql/team-auth.sql`
6. Click **Run**
7. Verify all tables created successfully

### Step 2: Deploy API to Vercel

1. Create `api/team-auth.js` in your Vercel project (if not already there)
2. Set environment variables in Vercel dashboard:
   ```
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_KEY=your-anon-key-here
   JWT_SECRET=your-secure-random-secret-here
   ENCRYPTION_KEY=your-secure-32-char-key-here
   ```
3. Deploy to Vercel (automatic on push, or manual via CLI)
4. Test the endpoint:
   ```bash
   curl -X POST https://your-vercel-url.vercel.app/api/team-auth \
     -H "Content-Type: application/json" \
     -d '{"action":"register","email":"test@example.com","password":"password123","name":"Test User"}'
   ```

### Step 3: Add Files to Extension

1. Copy `/admin.html` to extension root
2. Copy `/team-auth.js` to extension root
3. Update `/onboarding.js` (already done in the version provided)
4. Verify extension loads correctly:
   - Open extension background script console
   - Check that `self.TeamAuth` is available

### Step 4: Create Admin Account

1. Open the extension and go through normal onboarding to create a standard user
2. Update that user to admin role in Supabase:
   ```sql
   UPDATE cobra_users SET role = 'admin' WHERE email = 'admin@example.com';
   ```
3. Create team settings for the admin:
   ```sql
   INSERT INTO cobra_team_settings (admin_user_id, team_name, max_tokens_per_user)
   VALUES (
     (SELECT id FROM cobra_users WHERE email = 'admin@example.com'),
     'My Team',
     100000
   );
   ```
4. Open `/admin.html` in browser and login with admin credentials

## Usage Flow

### For Admins

1. **Open admin panel**: Open `/admin.html` in browser
2. **Login**: Enter admin email and password
3. **Manage team**:
   - View all members and their usage stats
   - Add new members with role (team or invited) and limits
   - Set expiry dates for invited users
   - Remove members when needed
4. **Set shared keys**:
   - Click "Show Keys" to reveal API key fields
   - Enter shared OpenAI, Anthropic, Gemini, Groq, ElevenLabs keys
   - Keys are encrypted before storage
   - Click "Save Keys"
5. **Monitor usage**: Dashboard shows token count, member count, invited count

### For Team Members

1. **During onboarding**:
   - Click "Accesso Team" button
   - Enter team email and password
   - Get automatically added to team (if invited) or create new account
   - Shared keys auto-load into COBRA settings
2. **During chat**:
   - Uses team shared keys if available
   - Can always use personal API keys instead
   - Token usage auto-tracked
   - Cannot exceed team token limits (for invited users)
3. **From admin.html**:
   - Can see team usage stats
   - Can review shared keys (for own use)

## Data Structure

### cobra_users
- `id`: UUID (primary key)
- `email`: Text (unique)
- `password_hash`: Text (SHA-256)
- `name`: Text
- `role`: ENUM (admin, team, invited, standard)
- `created_at`, `last_login`, `updated_at`: Timestamps

### cobra_team_settings
- `id`: UUID (primary key)
- `admin_user_id`: UUID (foreign key)
- `team_name`: Text
- `shared_*_key`: Text (encrypted)
- `max_tokens_per_user`: Int (default 100000)
- `created_at`, `updated_at`: Timestamps

### cobra_team_members
- `id`: UUID (primary key)
- `team_id`, `user_id`: UUID (foreign keys)
- `role`: Text ('team' or 'invited')
- `token_limit`: Int (nullable, defaults to team max)
- `date_limit`: Timestamp (expiry for invited users)
- `tokens_used`: Int (running count)
- `active`: Boolean
- `invited_at`, `accepted_at`: Timestamps

### cobra_api_usage
- `id`: UUID (primary key)
- `user_id`: UUID (foreign key)
- `provider`: Text (openai, anthropic, gemini, groq, elevenlabs)
- `tokens_used`: Int
- `timestamp`: Timestamp

## API Endpoints

All endpoints use `POST` requests to:
```
https://wca-app.vercel.app/api/team-auth?action=<action>
```

### Public Actions (No Auth)
- `register`: Create new account
- `login`: User login

### Admin-Only Actions (Requires JWT Token)
- `admin-login`: Admin login
- `admin-add-member`: Add team member
- `admin-remove-member`: Remove team member
- `admin-list-members`: List all members
- `admin-set-keys`: Save shared keys
- `admin-get-keys`: Get shared keys

### Authenticated Actions (Requires JWT Token)
- `check-access`: Validate token and limits
- `track-usage`: Log token usage

## Security Features

1. **Password Hashing**: SHA-256 with crypto.subtle
2. **JWT Tokens**: HS256 signed with secret
3. **API Key Encryption**: AES-256-CBC at rest
4. **RLS Policies**: Row-level security on all tables
5. **Email Validation**: Format checking on registration
6. **Input Validation**: All inputs sanitized before database
7. **Token Expiration**: Can be implemented in JWT payload
8. **Rate Limiting**: Should be added via Vercel middleware

## Integration with bg-chat.js

To integrate usage tracking in bg-chat.js:

```javascript
// In callDirectAI or after API call
if (self.TeamAuth) {
  const tokensUsed = response.usage?.total_tokens || estimatedTokens;
  const provider = 'openai'; // or 'anthropic', 'gemini', etc.
  await self.TeamAuth.trackUsage(provider, tokensUsed);
}
```

To get effective keys before calling API:

```javascript
// Instead of just settings.openaiKey
const keys = await self.TeamAuth.getEffectiveKeys();
const apiKey = keys.openai; // Falls back to personal key if not team
```

## Environment Variables Required

### Vercel
```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-service-role-or-anon-key
JWT_SECRET=your-secure-secret-min-32-chars
ENCRYPTION_KEY=your-aes-key-32-chars-min
```

### Supabase
- Enable Row Level Security on all tables
- Create auth role for JWT verification (optional, using service role for now)

## Testing

### Test Registration
```bash
curl -X POST https://your-vercel-url.vercel.app/api/team-auth?action=register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "SecurePass123",
    "name": "Test User"
  }'
```

### Test Login
```bash
curl -X POST https://your-vercel-url.vercel.app/api/team-auth?action=login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "SecurePass123"
  }'
```

### Test Check Access
```bash
curl -X GET "https://your-vercel-url.vercel.app/api/team-auth?action=check-access&token=<your_jwt_token>"
```

## Troubleshooting

### "Invalid token" error
- Check JWT_SECRET is consistent between Vercel and token generation
- Verify token hasn't expired (no expiration in current implementation)
- Check token format: `header.payload.signature`

### "Decryption error" with API keys
- Verify ENCRYPTION_KEY is exactly 32 characters
- Check that encryption key is consistent between saves and retrieves
- Clear keys and re-enter them

### Team members not loading
- Verify RLS policies are enabled on cobra_team_members table
- Check that admin_user_id matches authenticated user
- Check browser console for network errors

### Shared keys not available to team members
- Verify team membership exists and active=true
- Check shared keys are actually saved (admin-set-keys)
- Verify decryption is working (test with admin-get-keys)

## Future Enhancements

1. **Token Expiration**: Add `exp` claim to JWT
2. **Refresh Tokens**: Implement refresh token rotation
3. **Rate Limiting**: Add Vercel middleware for abuse prevention
4. **Activity Logging**: Track admin actions and member logins
5. **Webhooks**: Notify on new invites or member removal
6. **API Key Rotation**: Automatic expiration of shared keys
7. **Audit Trail**: Complete history of team changes
8. **Multi-Team Support**: Allow users to be members of multiple teams

## Support

For issues or questions:
1. Check console errors in browser developer tools
2. Review Supabase logs for database errors
3. Check Vercel function logs for API errors
4. Verify all environment variables are set correctly

---

**System created for Luca @ COBRA Team**
**Last updated: April 5, 2026**
