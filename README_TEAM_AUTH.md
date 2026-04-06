# COBRA Team Authentication System

Welcome! This is the complete COBRA team authentication backend system for Luca. Everything is production-ready.

## What You Got

A complete team authentication system with:
- Backend API on Vercel (serverless)
- Supabase PostgreSQL database
- Admin panel for managing teams
- Client-side module for the extension
- Updated onboarding with "Accesso Team" flow
- Complete documentation

## Quick Navigation

### Start Here
- **[TEAM_AUTH_QUICK_START.md](TEAM_AUTH_QUICK_START.md)** - 3-step deployment (30 minutes)
- **[DELIVERABLES.txt](DELIVERABLES.txt)** - What's included, features, testing

### Detailed Guides
- **[TEAM_AUTH_SETUP.md](TEAM_AUTH_SETUP.md)** - Complete setup with troubleshooting
- **[ARCHITECTURE.md](ARCHITECTURE.md)** - System design, data flows, security

### The Code
- **[/sql/team-auth.sql](sql/team-auth.sql)** - Database schema (run in Supabase)
- **[/api/team-auth.js](api/team-auth.js)** - Backend API (deploy to Vercel)
- **[admin.html](admin.html)** - Admin dashboard (standalone HTML)
- **[team-auth.js](team-auth.js)** - Extension client module
- **[onboarding.js](onboarding.js)** - Updated with "Accesso Team" button

## The 3-Step Deployment

1. **Supabase** (5 min): Run SQL migration
2. **Vercel** (10 min): Deploy API with env vars
3. **Extension** (5 min): Copy team-auth.js, test onboarding

See [TEAM_AUTH_QUICK_START.md](TEAM_AUTH_QUICK_START.md) for step-by-step.

## Key Features

### Admins
- Login and manage team members
- Set token limits and expiry dates
- Store and manage shared API keys (5 providers)
- View usage statistics
- Add/remove team members

### Team Members
- Login with email + password (no API keys needed)
- Automatically get team's shared keys
- Can use personal keys as fallback
- Token usage auto-tracked
- Token/date limits enforced

### Security
- SHA-256 password hashing
- HS256 JWT tokens
- AES-256-CBC key encryption
- Row-level security (RLS)
- Input validation on everything

## File Structure

```
firescrape-extension/
├── sql/
│   └── team-auth.sql              (Database schema)
├── api/
│   └── team-auth.js               (Backend API)
├── team-auth.js                   (Client module)
├── admin.html                      (Admin panel)
├── onboarding.js                  (Updated)
├── README_TEAM_AUTH.md            (This file)
├── TEAM_AUTH_QUICK_START.md       (Quick guide)
├── TEAM_AUTH_SETUP.md             (Detailed setup)
├── ARCHITECTURE.md                (System design)
└── DELIVERABLES.txt               (Complete manifest)
```

## Environment Variables (Vercel)

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-anon-key-here
JWT_SECRET=your-secure-secret-32-chars-min
ENCRYPTION_KEY=your-aes-key-32-chars-min
```

## API Endpoint

```
https://wca-app.vercel.app/api/team-auth?action=<action>
```

10 actions: `register`, `login`, `admin-login`, `admin-add-member`, `admin-remove-member`, `admin-list-members`, `admin-set-keys`, `admin-get-keys`, `check-access`, `track-usage`

## Integration Points

### In Onboarding
Users see "Accesso Team" button on Step 1, click it to login with team credentials.

### In Extension
```javascript
// Access team auth module
self.TeamAuth.login(email, password)
self.TeamAuth.checkAccess()
self.TeamAuth.trackUsage(provider, tokens)
self.TeamAuth.getEffectiveKeys()
```

### In Admin Panel
Open `admin.html` in browser, login with admin credentials, manage everything.

## Testing

1. Deploy SQL to Supabase
2. Deploy API to Vercel
3. Create admin user in database
4. Open admin.html and login
5. Add test member
6. Test "Accesso Team" in onboarding

## Troubleshooting

See [TEAM_AUTH_SETUP.md](TEAM_AUTH_SETUP.md) for common issues and solutions.

## Support

- **Quick answers**: [TEAM_AUTH_QUICK_START.md](TEAM_AUTH_QUICK_START.md)
- **Detailed help**: [TEAM_AUTH_SETUP.md](TEAM_AUTH_SETUP.md)
- **How it works**: [ARCHITECTURE.md](ARCHITECTURE.md)
- **Everything listed**: [DELIVERABLES.txt](DELIVERABLES.txt)

## Next Steps

1. Read [TEAM_AUTH_QUICK_START.md](TEAM_AUTH_QUICK_START.md)
2. Deploy SQL to Supabase
3. Deploy API to Vercel
4. Create first admin account
5. Test admin panel
6. Integrate with extension
7. Enjoy your team system!

---

**System Version**: 1.0
**Status**: Production-Ready
**Created**: April 5, 2026
**For**: Luca (COBRA Team)

Questions? Everything is documented. Start with the quick start guide!
