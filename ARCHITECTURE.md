# COBRA Team Authentication - Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     COBRA TEAM SYSTEM                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  BROWSER/EXTENSION LAYER                                         │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                                                             │    │
│  │  onboarding.js          team-auth.js                       │    │
│  │  ┌──────────────┐       ┌──────────────────────────────┐   │    │
│  │  │ Step 1 UI    │       │ Client Module               │   │    │
│  │  │ - API Key    │◄─────►│ - Token Storage             │   │    │
│  │  │ - Team Login │       │ - Access Control            │   │    │
│  │  │ - Register   │       │ - Usage Tracking            │   │    │
│  │  └──────────────┘       │ - Key Management            │   │    │
│  │                         └──────────────────────────────┘   │    │
│  │                                                             │    │
│  │  bg-chat.js                     admin.html                │    │
│  │  ┌──────────────┐       ┌──────────────────────────────┐   │    │
│  │  │ AI Chat      │       │ Admin Panel                  │   │    │
│  │  │ - Call API   │       │ - Login Form                 │   │    │
│  │  │ - Track Use  │       │ - Member Management          │   │    │
│  │  │ - Get Keys   │       │ - API Keys Management        │   │    │
│  │  │  (Team or    │       │ - Usage Dashboard            │   │    │
│  │  │   Personal)  │       │ - Statistics                 │   │    │
│  │  └──────────────┘       └──────────────────────────────┘   │    │
│  │                                                             │    │
│  └─────────────────────────────────────────────────────────┘    │
│           ▲                                           ▲             │
│           │                                           │             │
│           └──────────────────┬──────────────────────┘             │
│                              │                                     │
│                              │ HTTPS/Fetch                        │
│                              ▼                                     │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │                   VERCEL API LAYER                       │    │
│  ├──────────────────────────────────────────────────────────┤    │
│  │                                                           │    │
│  │  /api/team-auth.js (Serverless Function)               │    │
│  │  ┌──────────────────────────────────────────────────┐   │    │
│  │  │ 10 Actions:                                       │   │    │
│  │  │ - register (public)                               │   │    │
│  │  │ - login (public)                                  │   │    │
│  │  │ - admin-login (JWT required)                      │   │    │
│  │  │ - admin-add-member (JWT + admin)                 │   │    │
│  │  │ - admin-remove-member (JWT + admin)              │   │    │
│  │  │ - admin-list-members (JWT + admin)               │   │    │
│  │  │ - admin-set-keys (JWT + admin)                   │   │    │
│  │  │ - admin-get-keys (JWT + admin)                   │   │    │
│  │  │ - check-access (JWT required)                    │   │    │
│  │  │ - track-usage (JWT required)                     │   │    │
│  │  │                                                   │   │    │
│  │  │ Security:                                         │   │    │
│  │  │ - Password: SHA-256 hashing                      │   │    │
│  │  │ - Session: HS256 JWT signing                     │   │    │
│  │  │ - Keys: AES-256-CBC encryption                  │   │    │
│  │  │ - Input: Validation & sanitization              │   │    │
│  │  └──────────────────────────────────────────────────┘   │    │
│  │                                                           │    │
│  └──────────────────────────────────────────────────────────┘    │
│           ▲                                                         │
│           │ REST API Calls                                        │
│           ▼                                                         │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │                   SUPABASE LAYER                         │    │
│  ├──────────────────────────────────────────────────────────┤    │
│  │                                                           │    │
│  │  PostgreSQL Database with RLS                           │    │
│  │  ┌──────────────────────────────────────────────────┐   │    │
│  │  │ cobra_users                                       │   │    │
│  │  │ ├─ id (UUID)                                      │   │    │
│  │  │ ├─ email (unique)                                │   │    │
│  │  │ ├─ password_hash (SHA-256)                       │   │    │
│  │  │ ├─ name                                          │   │    │
│  │  │ └─ role (admin|team|invited|standard)           │   │    │
│  │  │                                                   │   │    │
│  │  │ cobra_team_settings                              │   │    │
│  │  │ ├─ id (UUID)                                      │   │    │
│  │  │ ├─ admin_user_id (FK)                            │   │    │
│  │  │ ├─ team_name                                     │   │    │
│  │  │ ├─ shared_openai_key (encrypted)                │   │    │
│  │  │ ├─ shared_anthropic_key (encrypted)            │   │    │
│  │  │ ├─ shared_gemini_key (encrypted)               │   │    │
│  │  │ ├─ shared_groq_key (encrypted)                 │   │    │
│  │  │ ├─ shared_eleven_key (encrypted)               │   │    │
│  │  │ └─ max_tokens_per_user                         │   │    │
│  │  │                                                   │   │    │
│  │  │ cobra_team_members                               │   │    │
│  │  │ ├─ id (UUID)                                      │   │    │
│  │  │ ├─ team_id (FK)                                  │   │    │
│  │  │ ├─ user_id (FK)                                  │   │    │
│  │  │ ├─ role (team|invited)                           │   │    │
│  │  │ ├─ token_limit (nullable)                        │   │    │
│  │  │ ├─ date_limit (for expiry)                      │   │    │
│  │  │ ├─ tokens_used (running count)                  │   │    │
│  │  │ └─ active (bool)                                │   │    │
│  │  │                                                   │   │    │
│  │  │ cobra_api_usage                                  │   │    │
│  │  │ ├─ id (UUID)                                      │   │    │
│  │  │ ├─ user_id (FK)                                  │   │    │
│  │  │ ├─ provider (openai|anthropic|gemini|groq|11labs) │   │    │
│  │  │ ├─ tokens_used (int)                             │   │    │
│  │  │ └─ timestamp                                     │   │    │
│  │  │                                                   │   │    │
│  │  │ All tables: Row-Level Security enabled           │   │    │
│  │  └──────────────────────────────────────────────────┘   │    │
│  │                                                           │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                     │
└─────────────────────────────────────────────────────────────────┘
```

## Data Flow Diagrams

### 1. Team Member Login Flow

```
User Opens Extension
    ↓
Onboarding Wizard (Step 1)
    ↓
[Choose Path]
    ├─ Traditional: API Key → Complete
    └─ Team Login: Click "Accesso Team"
        ↓
        Team Login Form
        ├─ Email input
        ├─ Password input
        └─ Optional name
        ↓
        POST /api/team-auth?action=login
        ├─ Find user by email
        ├─ Verify password (SHA-256)
        ├─ Generate JWT token
        ├─ Fetch team settings
        ├─ Decrypt shared keys
        └─ Return token + keys
        ↓
        Extension Stores:
        ├─ Token → chrome.storage.local.cobra_team_token
        ├─ Shared keys → cobra_settings.teamOpenai* etc.
        └─ Mark as team member → cobra_settings.fromTeam
        ↓
        Complete Onboarding
        ↓
        Available in bg-chat.js via self.TeamAuth
```

### 2. Admin Member Management Flow

```
Admin Opens admin.html
    ↓
Login Form
├─ Email + Password
└─ POST /api/team-auth?action=admin-login
    ├─ Verify user exists
    ├─ Verify password
    ├─ Verify user.role == 'admin'
    ├─ Fetch admin's team
    └─ Return token + team info
    ↓
Dashboard Displays
├─ Team members list
├─ Usage statistics
├─ Add member form
└─ Shared keys section
    ↓
Add New Member:
├─ Email input
├─ Role: team or invited
├─ Token limit (optional)
├─ Date limit (optional)
└─ POST /api/team-auth?action=admin-add-member
    ├─ Find or create user
    ├─ Add to cobra_team_members
    └─ Return member info
    ↓
Member Joins Team
├─ Gets cobra_team_members entry
├─ Can login with email/password
├─ Gets shared keys on login
└─ Has token/date limits applied
```

### 3. Usage Tracking Flow

```
User Calls AI API (in bg-chat.js)
    ↓
Get Effective Keys:
├─ Call self.TeamAuth.getEffectiveKeys()
├─ Returns: team keys or personal keys
└─ Use returned key for API call
    ↓
API Call Completes
├─ Extract tokens_used from response
└─ Call self.TeamAuth.trackUsage('openai', tokensUsed)
    ↓
POST /api/team-auth?action=track-usage
├─ Verify JWT token valid
├─ Log to cobra_api_usage table
└─ Update cobra_team_members.tokens_used
    ↓
Admin Sees Updated Stats
├─ admin.html dashboard refreshes
├─ Total tokens shown
├─ Per-member usage visible
└─ Can adjust limits if needed
```

### 4. Access Validation Flow

```
Before Using Shared Keys:
    ↓
Call self.TeamAuth.canUseProvider('openai')
    ↓
GET /api/team-auth?action=check-access?token=<jwt>
├─ Verify JWT signature
├─ Get user record
├─ Fetch team membership
├─ Check date_limit (not expired)
├─ Check token_limit (not exceeded)
└─ Return access status
    ↓
[Access Decision]
├─ allowed: true → Use team keys
├─ allowed: false → Use personal key or error
└─ reason: "Token limit reached" → Show user message
```

## Component Relationships

```
EXTENSION INTERNALS
│
├─ manifest.json
│  └─ includes: team-auth.js
│
├─ onboarding.js
│  └─ Calls: self.TeamAuth.login()
│
├─ team-auth.js (loaded in background)
│  ├─ Exposes: self.TeamAuth
│  ├─ Stores: chrome.storage.local
│  ├─ Fetches: Vercel API
│  └─ Used by: bg-chat.js, onboarding.js
│
├─ bg-chat.js
│  ├─ Gets keys from: self.TeamAuth.getEffectiveKeys()
│  ├─ Checks limits: self.TeamAuth.canUseProvider()
│  └─ Tracks use: self.TeamAuth.trackUsage()
│
└─ sidepanel.js, etc.
   └─ Can access team info via: self.TeamAuth


EXTERNAL SYSTEMS
│
├─ Vercel (API Hosting)
│  └─ /api/team-auth.js
│     ├─ Authenticates users
│     ├─ Manages team structure
│     ├─ Encrypts/decrypts keys
│     └─ Validates access
│
└─ Supabase (Database)
   ├─ Stores: Users, teams, members
   ├─ Stores: Encrypted API keys
   ├─ Tracks: Usage statistics
   └─ Enforces: Row-level security
```

## Security Architecture

```
PASSWORD SECURITY
├─ User enters password
├─ Hash with SHA-256 (via crypto.subtle)
├─ Store hash in cobra_users.password_hash
└─ On login: Hash input, compare with stored hash

JWT TOKEN SECURITY
├─ After login: Generate JWT with HS256
├─ Payload: { user_id, email, name, role, team_id, iat }
├─ Sign with JWT_SECRET (Vercel env var)
├─ Store in: chrome.storage.local.cobra_team_token
├─ Send in: Query param or Authorization header
└─ Verify signature on every request

API KEY ENCRYPTION
├─ Admin enters shared API key
├─ Encrypt with AES-256-CBC
├─ Use random IV each time
├─ Format: "<iv_hex>:<encrypted_hex>"
├─ Store in: cobra_team_settings.shared_*_key
├─ Decrypt only when needed (admin retrieval or member login)
└─ Never expose encrypted format to frontend

RLS POLICIES
├─ cobra_users: Users see own record only
├─ cobra_team_settings: Admin sees all team data
├─ cobra_team_members: Members see own membership
├─ cobra_api_usage: Users see own usage only
└─ Admin can see team usage via special query

INPUT VALIDATION
├─ Email: Regex validation (RFC-style)
├─ Password: Min 8 chars
├─ Name: Length check
├─ Provider: Whitelist check
├─ Token limit: Positive int
└─ All strings: Trim & sanitize
```

## Database Query Patterns

### 1. User Login
```sql
SELECT * FROM cobra_users
WHERE email = ?
LIMIT 1;
```

### 2. Find Team Member
```sql
SELECT ctm.*, cts.id as team_id
FROM cobra_team_members ctm
JOIN cobra_team_settings cts ON ctm.team_id = cts.id
WHERE ctm.user_id = ? AND ctm.active = true
LIMIT 1;
```

### 3. Get Shared Keys
```sql
SELECT shared_openai_key, shared_anthropic_key,
       shared_gemini_key, shared_groq_key, shared_eleven_key
FROM cobra_team_settings
WHERE id = ?;
```

### 4. Log Usage
```sql
INSERT INTO cobra_api_usage (user_id, provider, tokens_used, timestamp)
VALUES (?, ?, ?, NOW());

UPDATE cobra_team_members
SET tokens_used = tokens_used + ?
WHERE user_id = ? AND active = true;
```

### 5. List Team Members
```sql
SELECT cu.id, cu.email, cu.name, ctm.role, ctm.token_limit,
       ctm.date_limit, ctm.tokens_used, ctm.active,
       ctm.invited_at, ctm.accepted_at
FROM cobra_team_members ctm
JOIN cobra_users cu ON ctm.user_id = cu.id
WHERE ctm.team_id = ?
ORDER BY ctm.invited_at DESC;
```

## Error Handling Strategy

```
Frontend (Extension/Admin Panel)
    ↓
[Try API Call]
    ↓
[Check Response Status]
    ├─ 200-299: Success → Use data
    ├─ 400-499: Client error
    │  ├─ 400: Missing fields → Show form error
    │  ├─ 401: Invalid token → Clear storage, redirect to login
    │  ├─ 403: Permission denied → Show access denied message
    │  └─ 409: Conflict → Show "already exists" message
    └─ 500-599: Server error → Show retry message
    ↓
Backend (Vercel API)
    ↓
[Execute Action]
    ↓
[Catch Errors]
    ├─ Validation: Return 400 + message
    ├─ Auth: Return 401 + reason
    ├─ DB: Catch specific errors
    │  ├─ Unique constraint → Return 409
    │  ├─ Foreign key → Return 404
    │  └─ Other → Return 500
    ├─ Crypto: Return 500 + log error
    └─ Network: Return 503 + retry info
    ↓
Response { status, data | error }
```

## Scalability Considerations

1. **Database**:
   - Indexes on frequently queried columns
   - RLS policies prevent full table scans
   - Archival strategy for old usage records

2. **API**:
   - Stateless Vercel functions (auto-scales)
   - Rate limiting via Vercel middleware
   - Token caching strategy for repeated checks

3. **Storage**:
   - JWT tokens don't require server storage
   - Encryption keys in environment (not database)
   - Usage data can be archived after 90 days

4. **Client**:
   - Token cached in chrome.storage (survives restarts)
   - Shared keys cached in cobra_settings
   - Periodic check-access calls for validation

---

**Architecture Version**: 1.0
**Last Updated**: April 5, 2026
**For**: COBRA Team Authentication System
