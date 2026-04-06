-- COBRA Team Authentication Schema
-- Supabase migration for team-based access and shared API keys

-- ============================================================
-- ENUM TYPES
-- ============================================================

CREATE TYPE user_role AS ENUM ('admin', 'team', 'invited', 'standard');

-- ============================================================
-- TABLE: cobra_users
-- Core user authentication and profile
-- ============================================================

CREATE TABLE cobra_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role user_role NOT NULL DEFAULT 'standard',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  last_login TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),

  CONSTRAINT email_format CHECK (email ~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}$')
);

CREATE INDEX idx_cobra_users_email ON cobra_users(email);
CREATE INDEX idx_cobra_users_role ON cobra_users(role);

-- ============================================================
-- TABLE: cobra_team_settings
-- Shared team configuration and encrypted API keys
-- ============================================================

CREATE TABLE cobra_team_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID NOT NULL REFERENCES cobra_users(id) ON DELETE CASCADE,
  team_name TEXT NOT NULL,

  -- Encrypted API keys (stored as encrypted text)
  shared_openai_key TEXT,
  shared_anthropic_key TEXT,
  shared_gemini_key TEXT,
  shared_groq_key TEXT,
  shared_eleven_key TEXT,

  -- Team settings
  max_tokens_per_user INT DEFAULT 100000,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX idx_cobra_team_settings_admin ON cobra_team_settings(admin_user_id);

-- ============================================================
-- TABLE: cobra_team_members
-- Team membership, roles, and usage limits
-- ============================================================

CREATE TABLE cobra_team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES cobra_team_settings(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES cobra_users(id) ON DELETE CASCADE,

  role TEXT NOT NULL DEFAULT 'team',  -- 'team' or 'invited'
  token_limit INT,  -- NULL means unlimited, uses team default
  date_limit TIMESTAMP WITH TIME ZONE,  -- expiry date for invited users

  tokens_used INT DEFAULT 0,
  active BOOLEAN DEFAULT true,

  invited_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  accepted_at TIMESTAMP WITH TIME ZONE,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),

  CONSTRAINT unique_team_member UNIQUE(team_id, user_id),
  CONSTRAINT valid_role CHECK (role IN ('team', 'invited'))
);

CREATE INDEX idx_cobra_team_members_team ON cobra_team_members(team_id);
CREATE INDEX idx_cobra_team_members_user ON cobra_team_members(user_id);
CREATE INDEX idx_cobra_team_members_active ON cobra_team_members(active);

-- ============================================================
-- TABLE: cobra_api_usage
-- Token usage tracking per user and provider
-- ============================================================

CREATE TABLE cobra_api_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES cobra_users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,  -- 'openai', 'anthropic', 'gemini', 'groq', 'elevenlabs'
  tokens_used INT NOT NULL,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT now(),

  CONSTRAINT valid_provider CHECK (provider IN ('openai', 'anthropic', 'gemini', 'groq', 'elevenlabs'))
);

CREATE INDEX idx_cobra_api_usage_user ON cobra_api_usage(user_id);
CREATE INDEX idx_cobra_api_usage_provider ON cobra_api_usage(provider);
CREATE INDEX idx_cobra_api_usage_timestamp ON cobra_api_usage(timestamp);

-- ============================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================

ALTER TABLE cobra_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE cobra_team_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE cobra_team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE cobra_api_usage ENABLE ROW LEVEL SECURITY;

-- cobra_users: Users can see their own record
CREATE POLICY "users_can_read_own_data" ON cobra_users
  FOR SELECT USING (auth.uid()::text = id::text);

-- cobra_users: Only allow inserts for registration (no auth check)
CREATE POLICY "users_can_register" ON cobra_users
  FOR INSERT WITH CHECK (true);

-- cobra_users: Users can update their own record
CREATE POLICY "users_can_update_own_data" ON cobra_users
  FOR UPDATE USING (auth.uid()::text = id::text);

-- cobra_team_settings: Admins can read/modify their own team
CREATE POLICY "admins_can_manage_team_settings" ON cobra_team_settings
  FOR ALL USING (admin_user_id = auth.uid());

-- cobra_team_settings: Team members can read their team settings (limited fields)
CREATE POLICY "team_members_can_read_settings" ON cobra_team_settings
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM cobra_team_members
      WHERE cobra_team_members.team_id = cobra_team_settings.id
      AND cobra_team_members.user_id = auth.uid()
      AND cobra_team_members.active = true
    )
  );

-- cobra_team_members: Admins can manage members
CREATE POLICY "admins_can_manage_members" ON cobra_team_members
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM cobra_team_settings
      WHERE cobra_team_settings.id = cobra_team_members.team_id
      AND cobra_team_settings.admin_user_id = auth.uid()
    )
  );

-- cobra_team_members: Members can read their own membership
CREATE POLICY "members_can_read_own_membership" ON cobra_team_members
  FOR SELECT USING (user_id = auth.uid());

-- cobra_api_usage: Users can log their own usage
CREATE POLICY "users_can_log_usage" ON cobra_api_usage
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- cobra_api_usage: Users can read their own usage
CREATE POLICY "users_can_read_own_usage" ON cobra_api_usage
  FOR SELECT USING (user_id = auth.uid());

-- cobra_api_usage: Admins can read team usage
CREATE POLICY "admins_can_read_team_usage" ON cobra_api_usage
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM cobra_team_members tm
      JOIN cobra_team_settings cts ON tm.team_id = cts.id
      WHERE tm.user_id = cobra_api_usage.user_id
      AND cts.admin_user_id = auth.uid()
    )
  );

-- ============================================================
-- UTILITY FUNCTIONS
-- ============================================================

-- Get user's team info if they're a team member
CREATE OR REPLACE FUNCTION get_user_team_info(user_id UUID)
RETURNS TABLE (
  team_id UUID,
  team_name TEXT,
  role TEXT,
  token_limit INT,
  date_limit TIMESTAMP WITH TIME ZONE,
  tokens_used INT,
  active BOOLEAN
) AS $$
SELECT
  cts.id,
  cts.team_name,
  ctm.role,
  ctm.token_limit,
  ctm.date_limit,
  ctm.tokens_used,
  ctm.active
FROM cobra_team_members ctm
JOIN cobra_team_settings cts ON ctm.team_id = cts.id
WHERE ctm.user_id = user_id AND ctm.active = true
LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER;

-- Get all team members for a team (for admins)
CREATE OR REPLACE FUNCTION get_team_members(team_id UUID)
RETURNS TABLE (
  id UUID,
  email TEXT,
  name TEXT,
  role TEXT,
  token_limit INT,
  date_limit TIMESTAMP WITH TIME ZONE,
  tokens_used INT,
  active BOOLEAN,
  invited_at TIMESTAMP WITH TIME ZONE,
  accepted_at TIMESTAMP WITH TIME ZONE
) AS $$
SELECT
  cu.id,
  cu.email,
  cu.name,
  ctm.role,
  ctm.token_limit,
  ctm.date_limit,
  ctm.tokens_used,
  ctm.active,
  ctm.invited_at,
  ctm.accepted_at
FROM cobra_team_members ctm
JOIN cobra_users cu ON ctm.user_id = cu.id
WHERE ctm.team_id = team_id
ORDER BY ctm.invited_at DESC;
$$ LANGUAGE sql SECURITY DEFINER;

-- Calculate total tokens used by a user in the current month
CREATE OR REPLACE FUNCTION get_user_monthly_tokens(user_id UUID)
RETURNS INT AS $$
SELECT COALESCE(SUM(tokens_used), 0)::INT
FROM cobra_api_usage
WHERE cobra_api_usage.user_id = user_id
AND timestamp >= date_trunc('month', now())
AND timestamp < date_trunc('month', now()) + interval '1 month';
$$ LANGUAGE sql SECURITY DEFINER;

-- Check if user has exceeded their token limit
CREATE OR REPLACE FUNCTION check_user_token_limit(user_id UUID)
RETURNS TABLE (
  has_exceeded BOOLEAN,
  tokens_used INT,
  token_limit INT,
  remaining_tokens INT
) AS $$
SELECT
  (ctm.tokens_used >= COALESCE(ctm.token_limit, cts.max_tokens_per_user)) as has_exceeded,
  ctm.tokens_used,
  COALESCE(ctm.token_limit, cts.max_tokens_per_user) as token_limit,
  GREATEST(0, COALESCE(ctm.token_limit, cts.max_tokens_per_user) - ctm.tokens_used) as remaining_tokens
FROM cobra_team_members ctm
JOIN cobra_team_settings cts ON ctm.team_id = cts.id
WHERE ctm.user_id = user_id AND ctm.active = true;
$$ LANGUAGE sql SECURITY DEFINER;
