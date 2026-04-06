# COBRA Team Auth - Quick Start

## What Was Built

A complete team authentication system for COBRA with:
- Backend API on Vercel (handles all team operations)
- Supabase database with encrypted shared API keys
- Admin panel for team management
- Client-side module for token/key management
- Integrated onboarding flow ("Accesso Team" button)

## Files Overview

| File | Purpose | Size |
|------|---------|------|
| `/sql/team-auth.sql` | Supabase schema migration | 8.9 KB |
| `/api/team-auth.js` | Vercel serverless function | 23 KB |
| `/admin.html` | Admin panel (standalone HTML) | 26 KB |
| `/team-auth.js` | Extension client module | 11 KB |
| `/onboarding.js` | Updated with team login | 20 KB |

## 3-Step Deployment

### 1. Database (5 minutes)
```sql
-- Copy entire contents of /sql/team-auth.sql
-- Paste into Supabase → SQL Editor → New Query → Run
```

### 2. API (5 minutes)
```bash
# Set these environment variables in Vercel:
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-anon-key
JWT_SECRET=your-secure-random-string
ENCRYPTION_KEY=your-32-char-encryption-key
```

### 3. Test
```bash
# Test registration
curl -X POST https://your-vercel.vercel.app/api/team-auth?action=register \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@company.com","password":"Pass123!","name":"Admin"}'
```

## Create First Admin

```sql
-- In Supabase SQL Editor:
UPDATE cobra_users SET role = 'admin' WHERE email = 'admin@company.com';

INSERT INTO cobra_team_settings (admin_user_id, team_name, max_tokens_per_user)
SELECT id, 'Main Team', 100000 FROM cobra_users WHERE email = 'admin@company.com';
```

## Open Admin Panel

```
Open in browser: /admin.html (or host as static file)
Login with: admin@company.com / Pass123!
```

## How It Works

### User Flow
```
Extension Onboarding
├─ Traditional: Choose API Key → Done
└─ Team: Click "Accesso Team"
   ├─ Enter email/password
   ├─ Get team shared keys
   └─ Done
```

### Admin Flow
```
Admin Panel (admin.html)
├─ Login with admin credentials
├─ View members & usage stats
├─ Add member (email, role, limits)
├─ Set shared API keys (encrypted)
└─ Monitor token usage
```

### Technical Flow
```
Team Login Request
→ API validates credentials
→ Generates JWT token
→ Returns shared keys (decrypted)
→ Extension stores token in chrome.storage
→ Team keys merged into cobra_settings
→ bg-chat.js uses shared keys automatically
→ Usage tracked on every API call
```

## Key Features

✓ **Admins can**:
- Manage team members (add/remove)
- Set role (team member or invited)
- Configure token limits per user
- Set expiry dates for invited users
- Store & manage shared API keys
- View usage statistics

✓ **Team members can**:
- Login with email/password (no API keys needed)
- Access team's shared API keys automatically
- Use personal keys as fallback
- Have token usage tracked
- See remaining quota (if invited)

✓ **Security**:
- Passwords hashed (SHA-256)
- API keys encrypted (AES-256)
- JWT token validation
- Row-level security (RLS)
- Input validation & sanitization

## Configuration

### Change API Endpoint
In `/team-auth.js` and `/admin.html`:
```javascript
const API_BASE = 'https://your-vercel-url.vercel.app/api/team-auth';
```

### Customize Default Token Limit
In Supabase:
```sql
UPDATE cobra_team_settings SET max_tokens_per_user = 50000 WHERE team_name = 'Main Team';
```

### Change Encryption Key
Edit `/api/team-auth.js` → `getEncryptionKey()` function or set `ENCRYPTION_KEY` env var.

## Database Schema (Quick Look)

```
cobra_users
├─ id (UUID)
├─ email (unique)
├─ password_hash
├─ name
├─ role (admin|team|invited|standard)
└─ timestamps

cobra_team_settings
├─ id (UUID)
├─ admin_user_id (FK)
├─ team_name
├─ shared_openai_key (encrypted)
├─ shared_anthropic_key (encrypted)
├─ shared_gemini_key (encrypted)
├─ shared_groq_key (encrypted)
├─ shared_eleven_key (encrypted)
├─ max_tokens_per_user (default: 100000)
└─ timestamps

cobra_team_members
├─ id (UUID)
├─ team_id (FK)
├─ user_id (FK)
├─ role (team|invited)
├─ token_limit (nullable)
├─ date_limit (for invited)
├─ tokens_used (running count)
├─ active (bool)
└─ timestamps

cobra_api_usage
├─ id (UUID)
├─ user_id (FK)
├─ provider (openai|anthropic|gemini|groq|elevenlabs)
├─ tokens_used (int)
└─ timestamp
```

## Integration Checklist

- [ ] Run SQL migration in Supabase
- [ ] Deploy API to Vercel with env vars
- [ ] Create first admin user
- [ ] Open admin.html and login
- [ ] Add test team member
- [ ] Set shared API keys
- [ ] Test onboarding with "Accesso Team"
- [ ] Verify shared keys load in extension
- [ ] Update manifest to include team-auth.js
- [ ] Test usage tracking in bg-chat.js

## API Endpoints (10 Actions)

| Action | Method | Auth | Purpose |
|--------|--------|------|---------|
| `register` | POST | None | Create account |
| `login` | POST | None | User login |
| `admin-login` | POST | None | Admin login |
| `admin-add-member` | POST | JWT | Add user to team |
| `admin-remove-member` | POST | JWT | Deactivate member |
| `admin-list-members` | GET | JWT | View team members |
| `admin-set-keys` | POST | JWT | Save API keys |
| `admin-get-keys` | GET | JWT | Retrieve API keys |
| `check-access` | GET | JWT | Validate token |
| `track-usage` | POST | JWT | Log token consumption |

## Common Tasks

### Add Member Programmatically
```bash
curl -X POST 'https://your-vercel.vercel.app/api/team-auth?action=admin-add-member' \
  -H 'Content-Type: application/json' \
  -d '{
    "token": "eyJ...",
    "email": "newuser@company.com",
    "role": "team",
    "token_limit": 50000,
    "date_limit": "2026-12-31T23:59:59Z"
  }'
```

### Track Usage Programmatically
```javascript
// In bg-chat.js after API call:
if (self.TeamAuth) {
  await self.TeamAuth.trackUsage('openai', 150); // 150 tokens used
}
```

### Check If User Has Access
```javascript
const access = await self.TeamAuth.checkAccess();
if (access.valid) {
  console.log('User:', access.user);
  console.log('Team:', access.team);
  console.log('Shared keys:', access.shared_keys);
}
```

## Error Handling

### "Invalid credentials"
→ Check email/password are correct, user exists in database

### "Email already registered"
→ User account exists, use login instead of register

### "Admin access required"
→ User doesn't have admin role, update in Supabase

### "Access expired"
→ Invited user's date_limit passed, remove and re-add

### "Token limit reached"
→ Member exceeded quota, admin can increase limit

### "Decryption error"
→ ENCRYPTION_KEY mismatch, verify env var

## Next Steps

1. Deploy to production following "3-Step Deployment"
2. Create admin account and team
3. Test with real users
4. Monitor usage via admin panel
5. Add usage tracking to bg-chat.js
6. Consider rate limiting via Vercel middleware
7. Plan for token expiration in JWT

---

**Ready to deploy?** Start with Step 1: Database Migration!
