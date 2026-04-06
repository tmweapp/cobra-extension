/**
 * COBRA Team Authentication Client Module
 * Handles: Token storage, access validation, usage tracking
 * Integrates with extension storage and bg-chat.js
 */

const TeamAuth = (() => {
  const API_BASE = 'https://wca-app.vercel.app/api/team-auth';

  // ============================================================
  // STORAGE MANAGEMENT
  // ============================================================

  /**
   * Save team auth token to extension storage
   */
  function saveToken(token) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ cobra_team_token: token }, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Get team auth token from storage
   */
  function getToken() {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get('cobra_team_token', (result) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(result.cobra_team_token || null);
        }
      });
    });
  }

  /**
   * Clear team auth token
   */
  function clearToken() {
    return new Promise((resolve, reject) => {
      chrome.storage.local.remove('cobra_team_token', () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Save shared keys to extension storage (in cobra_settings)
   */
  function saveSharedKeys(keys) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get('cobra_settings', (result) => {
        const settings = result.cobra_settings || {};

        // Store shared keys with a marker
        settings.teamOpenaiKey = keys.openai_key || null;
        settings.teamAnthropicKey = keys.anthropic_key || null;
        settings.teamGeminiKey = keys.gemini_key || null;
        settings.teamGroqKey = keys.groq_key || null;
        settings.teamElevenKey = keys.eleven_key || null;
        settings.fromTeam = true;

        chrome.storage.local.set({ cobra_settings: settings }, () => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve();
          }
        });
      });
    });
  }

  /**
   * Get effective API keys (user's own or team's shared)
   */
  async function getEffectiveKeys() {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get('cobra_settings', (result) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }

        const settings = result.cobra_settings || {};

        resolve({
          openai: settings.teamOpenaiKey || settings.openaiKey || null,
          anthropic: settings.teamAnthropicKey || settings.anthropicKey || null,
          gemini: settings.teamGeminiKey || settings.geminiKey || null,
          groq: settings.teamGroqKey || settings.groqKey || null,
          eleven: settings.teamElevenKey || settings.elevenKey || null
        });
      });
    });
  }

  // ============================================================
  // AUTHENTICATION
  // ============================================================

  /**
   * User login with email and password
   */
  async function login(email, password) {
    if (!email || !password) {
      throw new Error('Email and password required');
    }

    try {
      const res = await fetch(`${API_BASE}?action=login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        throw new Error(data.error || 'Login failed');
      }

      // Save token
      await saveToken(data.token);

      // Save shared keys if user is a team member
      if (data.team && data.shared_keys) {
        await saveSharedKeys(data.shared_keys);
      }

      return {
        success: true,
        token: data.token,
        user: data.user,
        team: data.team,
        shared_keys: data.shared_keys || {}
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Register new user
   */
  async function register(email, password, name) {
    if (!email || !password || !name) {
      throw new Error('Email, password, and name required');
    }

    try {
      const res = await fetch(`${API_BASE}?action=register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name })
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        throw new Error(data.error || 'Registration failed');
      }

      return {
        success: true,
        user: data
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Logout (clear token and shared keys)
   */
  async function logout() {
    await clearToken();

    return new Promise((resolve, reject) => {
      chrome.storage.local.get('cobra_settings', (result) => {
        const settings = result.cobra_settings || {};
        delete settings.teamOpenaiKey;
        delete settings.teamAnthropicKey;
        delete settings.teamGeminiKey;
        delete settings.teamGroqKey;
        delete settings.teamElevenKey;
        delete settings.fromTeam;

        chrome.storage.local.set({ cobra_settings: settings }, () => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve();
          }
        });
      });
    });
  }

  // ============================================================
  // ACCESS CONTROL
  // ============================================================

  /**
   * Check if user has valid token and is within limits
   */
  async function checkAccess() {
    const token = await getToken();

    if (!token) {
      return {
        valid: false,
        reason: 'No team token'
      };
    }

    try {
      const res = await fetch(`${API_BASE}?action=check-access&token=${encodeURIComponent(token)}`);
      const data = await res.json();

      if (!res.ok || data.error) {
        await clearToken();
        return {
          valid: false,
          reason: data.error || 'Token invalid'
        };
      }

      return {
        valid: true,
        user: data.user,
        team: data.team,
        shared_keys: data.shared_keys || {}
      };
    } catch (error) {
      return {
        valid: false,
        reason: error.message
      };
    }
  }

  /**
   * Check if user can use a provider (within token limits, not expired)
   */
  async function canUseProvider(provider) {
    const access = await checkAccess();

    if (!access.valid) {
      return {
        allowed: false,
        reason: access.reason
      };
    }

    const { team } = access;

    // Standard users have no limit
    if (!team) {
      return {
        allowed: true,
        unlimited: true
      };
    }

    // Check date limit
    if (team.date_limit && new Date(team.date_limit) < new Date()) {
      return {
        allowed: false,
        reason: 'Access expired'
      };
    }

    // Check token limit
    if (team.token_limit && team.tokens_used >= team.token_limit) {
      return {
        allowed: false,
        reason: `Token limit reached (${team.tokens_used}/${team.token_limit})`,
        tokens_used: team.tokens_used,
        token_limit: team.token_limit
      };
    }

    return {
      allowed: true,
      tokens_used: team.tokens_used,
      token_limit: team.token_limit,
      remaining: team.token_limit ? team.token_limit - team.tokens_used : null
    };
  }

  // ============================================================
  // USAGE TRACKING
  // ============================================================

  /**
   * Track token usage for a provider
   */
  async function trackUsage(provider, tokensUsed) {
    if (!provider || !tokensUsed) {
      console.warn('trackUsage: missing provider or tokensUsed');
      return false;
    }

    const token = await getToken();

    if (!token) {
      console.warn('trackUsage: no team token');
      return false;
    }

    try {
      const res = await fetch(`${API_BASE}?action=track-usage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          provider,
          tokens_used: parseInt(tokensUsed, 10)
        })
      });

      if (!res.ok) {
        console.error('trackUsage failed:', await res.text());
        return false;
      }

      return true;
    } catch (error) {
      console.error('trackUsage error:', error);
      return false;
    }
  }

  // ============================================================
  // SESSION MANAGEMENT
  // ============================================================

  /**
   * Get current session info
   */
  async function getSession() {
    const token = await getToken();

    if (!token) {
      return null;
    }

    const access = await checkAccess();

    if (!access.valid) {
      await clearToken();
      return null;
    }

    return {
      token,
      user: access.user,
      team: access.team,
      shared_keys: access.shared_keys
    };
  }

  /**
   * Check if user is a team member
   */
  async function isTeamMember() {
    const session = await getSession();
    return session && !!session.team;
  }

  // ============================================================
  // PUBLIC API
  // ============================================================

  return {
    // Authentication
    login,
    register,
    logout,

    // Access Control
    checkAccess,
    canUseProvider,
    isTeamMember,

    // Session
    getSession,
    getToken,
    saveToken,
    clearToken,

    // Keys
    getEffectiveKeys,
    saveSharedKeys,

    // Usage
    trackUsage,

    // Config
    setApiBase: (newBase) => {
      // Allow override of API base if needed
    }
  };
})();

// Export for use in bg-chat.js and other modules
if (typeof self !== 'undefined') {
  self.TeamAuth = TeamAuth;
}

// For module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TeamAuth;
}
