/**
 * COBRA Connectors Module
 * Provides integrations with external services via REST APIs
 * Each connector is a self-contained object with auth + CRUD operations
 */

const Connectors = {
  _registry: {},
  _configKey: 'fs_connectors_config',

  /**
   * Register a connector
   */
  register(connector) {
    if (!connector.id || !connector.name) {
      console.error('Invalid connector: missing id or name');
      return false;
    }
    this._registry[connector.id] = connector;
    console.log(`Registered connector: ${connector.name}`);
    return true;
  },

  /**
   * Get connector by id
   */
  get(id) {
    return this._registry[id] || null;
  },

  /**
   * List all registered connectors
   */
  list() {
    return Object.values(this._registry).map(c => ({
      id: c.id,
      name: c.name,
      type: c.type,
      configured: c.configured,
      description: c.description,
    }));
  },

  /**
   * Configure a connector (saves encrypted credentials)
   */
  async configure(id, config) {
    const connector = this.get(id);
    if (!connector) {
      throw new Error(`Connector not found: ${id}`);
    }

    // Validate required fields
    const requiredFields = connector.configSchema
      .filter(field => field.required)
      .map(field => field.key);

    for (const field of requiredFields) {
      if (!config[field]) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    // Encrypt and store config
    const encrypted = await CryptoUtils.encrypt(JSON.stringify(config));
    const allConfigs = (await chrome.storage.local.get(this._configKey))[this._configKey] || {};
    allConfigs[id] = encrypted;
    await chrome.storage.local.set({ [this._configKey]: allConfigs });

    // Update connector state
    connector.configured = true;
    connector.config = config;
    console.log(`Configured connector: ${id}`);
    return true;
  },

  /**
   * Execute a connector method
   */
  async execute(id, method, params = {}) {
    const connector = this.get(id);
    if (!connector) {
      throw new Error(`Connector not found: ${id}`);
    }
    if (!connector.configured) {
      throw new Error(`Connector not configured: ${id}`);
    }
    if (!connector.methods[method]) {
      throw new Error(`Method not found: ${method}`);
    }

    return connector.methods[method](params, connector.config);
  },

  /**
   * Test connector connectivity
   */
  async test(id) {
    const connector = this.get(id);
    if (!connector) {
      throw new Error(`Connector not found: ${id}`);
    }
    if (!connector.test) {
      return { success: true, message: 'No test method defined' };
    }
    return connector.test(connector.config);
  },

  /**
   * Load saved configs from storage
   */
  async init() {
    try {
      const allConfigs = (await chrome.storage.local.get(this._configKey))[this._configKey] || {};

      for (const [id, encrypted] of Object.entries(allConfigs)) {
        const connector = this.get(id);
        if (!connector) continue;

        try {
          const decrypted = await CryptoUtils.decrypt(encrypted);
          connector.config = JSON.parse(decrypted);
          connector.configured = true;
        } catch (e) {
          console.error(`Failed to decrypt config for ${id}:`, e);
        }
      }
      console.log('Connectors initialized');
    } catch (e) {
      console.error('Failed to init connectors:', e);
    }
  },

  /**
   * Get statistics
   */
  getStats() {
    const connectors = Object.values(this._registry);
    return {
      total: connectors.length,
      configured: connectors.filter(c => c.configured).length,
      byType: connectors.reduce((acc, c) => {
        acc[c.type] = (acc[c.type] || 0) + 1;
        return acc;
      }, {}),
    };
  },
};

/**
 * Validation utilities
 */
function validateEmail(email) {
  const emailRegex = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}$/;
  return emailRegex.test(email);
}

function validateHttpsUrl(urlString) {
  try {
    const url = new URL(urlString);
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Factory function to create connectors
 */
function createConnector(def) {
  return {
    id: def.id,
    name: def.name,
    type: def.type,
    description: def.description,
    configured: false,
    config: {},
    configSchema: def.configSchema || [],
    methods: def.methods || {},

    async execute(method, params) {
      if (!this.methods[method]) {
        throw new Error(`Method not found: ${method}`);
      }
      return this.methods[method](params, this.config);
    },

    test: def.test || null,
  };
}

// ============================================================================
// BUILT-IN CONNECTORS
// ============================================================================

// Email Connector (webhook-based)
Connectors.register(createConnector({
  id: 'email',
  name: 'Email',
  type: 'email',
  description: 'Send emails via webhook endpoint',
  configSchema: [
    { key: 'webhookUrl', label: 'Webhook URL', type: 'text', required: true, placeholder: 'https://api.example.com/email' },
  ],
  methods: {
    async send(params, config) {
      const { to, subject, body, attachments = [] } = params;
      if (!to || !subject || !body) {
        throw new Error('Missing required: to, subject, body');
      }

      // Validate email address
      if (!validateEmail(to)) {
        throw new Error('Invalid email address');
      }

      // Validate webhook URL is HTTPS
      if (!validateHttpsUrl(config.webhookUrl)) {
        throw new Error('Webhook URL must use HTTPS protocol');
      }

      const payload = { to, subject, body };
      if (attachments.length > 0) {
        payload.attachments = attachments.map(att => ({
          filename: att.filename,
          content: att.base64, // base64-encoded content
        }));
      }

      const response = await fetch(config.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Email send failed: ${response.statusText}`);
      }
      return { success: true, messageId: response.headers.get('x-message-id') };
    },

    async sendTemplate(params, config) {
      const { to, templateId, vars = {} } = params;
      if (!to || !templateId) {
        throw new Error('Missing required: to, templateId');
      }

      const payload = { to, templateId, variables: vars };
      const response = await fetch(`${config.webhookUrl}/template`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Template send failed: ${response.statusText}`);
      }
      return { success: true };
    },
  },
  test: async (config) => {
    try {
      const response = await fetch(config.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: 'test@example.com', subject: 'Test', body: 'Test email' }),
      });
      return { success: response.ok, status: response.status };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },
}));

// Webhook Connector (generic HTTP)
Connectors.register(createConnector({
  id: 'webhook',
  name: 'Webhook',
  type: 'webhook',
  description: 'Send data to generic HTTP webhook with retry',
  configSchema: [
    { key: 'url', label: 'Webhook URL', type: 'text', required: true, placeholder: 'https://example.com/webhook' },
    { key: 'method', label: 'HTTP Method', type: 'select', required: false, default: 'POST' },
    { key: 'authType', label: 'Auth Type', type: 'select', required: false, default: 'none', options: ['none', 'bearer', 'basic', 'api-key'] },
    { key: 'authValue', label: 'Auth Value', type: 'text', required: false, placeholder: 'token or credentials' },
  ],
  methods: {
    async send(params, config) {
      const { url = config.url, data, method = config.method || 'POST', headers = {} } = params;

      // Validate webhook URL is HTTPS
      if (!validateHttpsUrl(url)) {
        throw new Error('Webhook URL must use HTTPS protocol');
      }

      const finalHeaders = { 'Content-Type': 'application/json', ...headers };

      // Add authentication
      if (config.authType === 'bearer') {
        finalHeaders.Authorization = `Bearer ${config.authValue}`;
      } else if (config.authType === 'api-key') {
        finalHeaders['X-API-Key'] = config.authValue;
      } else if (config.authType === 'basic') {
        finalHeaders.Authorization = `Basic ${btoa(config.authValue)}`;
      }

      let retries = 1;
      let lastError = null;

      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          const response = await fetch(url, {
            method,
            headers: finalHeaders,
            body: JSON.stringify(data),
          });

          if (response.ok) {
            return { success: true, status: response.status };
          }

          if (response.status >= 500 && attempt < retries) {
            lastError = `Server error: ${response.status}`;
            await new Promise(r => setTimeout(r, 1000)); // Wait 1s before retry
            continue;
          }

          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        } catch (e) {
          lastError = e.message;
          if (attempt < retries) continue;
          throw new Error(lastError);
        }
      }
    },
  },
  test: async (config) => {
    try {
      const response = await fetch(config.url, {
        method: config.method || 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ test: true }),
      });
      return { success: true, status: response.status };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },
}));

// Google Sheets Connector
Connectors.register(createConnector({
  id: 'google-sheets',
  name: 'Google Sheets',
  type: 'database',
  description: 'Read/write to Google Sheets via API',
  configSchema: [
    { key: 'apiKey', label: 'Google API Key (lettura)', type: 'password', required: true },
    { key: 'oauthToken', label: 'OAuth Token (scrittura, opzionale)', type: 'password', required: false },
    { key: 'spreadsheetId', label: 'Spreadsheet ID', type: 'text', required: true },
  ],
  methods: {
    async read(params, config) {
      const { spreadsheetId = config.spreadsheetId, range } = params;
      if (!range) throw new Error('Missing required: range');

      const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?key=${config.apiKey}`;
      const response = await fetch(url);
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(`Sheets read failed: ${err.error?.message || response.statusText}`);
      }

      const data = await response.json();
      return { success: true, values: data.values || [], range: data.range };
    },

    async write(params, config) {
      const { spreadsheetId = config.spreadsheetId, range, values } = params;
      if (!range || !values) throw new Error('Missing required: range, values');
      if (!config.oauthToken) throw new Error('OAuth token richiesto per scrittura. API key non sufficiente.');

      const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
      const response = await fetch(url, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.oauthToken}`,
        },
        body: JSON.stringify({ range, values }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(`Sheets write failed: ${err.error?.message || response.statusText}`);
      }
      return { success: true, updatedRange: (await response.json()).updatedRange };
    },

    async append(params, config) {
      const { spreadsheetId = config.spreadsheetId, range, values } = params;
      if (!range || !values) throw new Error('Missing required: range, values');
      if (!config.oauthToken) throw new Error('OAuth token richiesto per scrittura. API key non sufficiente.');

      const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.oauthToken}`,
        },
        body: JSON.stringify({ range, values }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(`Sheets append failed: ${err.error?.message || response.statusText}`);
      }
      return { success: true };
    },
  },
  test: async (config) => {
    try {
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(config.spreadsheetId)}?key=${config.apiKey}&fields=properties.title`;
      const response = await fetch(url);
      if (!response.ok) return { success: false, status: response.status };
      const data = await response.json();
      return { success: true, title: data.properties?.title };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },
}));

// Supabase Connector
Connectors.register(createConnector({
  id: 'supabase',
  name: 'Supabase',
  type: 'database',
  description: 'Direct database operations via Supabase',
  configSchema: [
    { key: 'projectUrl', label: 'Project URL', type: 'text', required: true, placeholder: 'https://xxx.supabase.co' },
    { key: 'apiKey', label: 'API Key', type: 'password', required: true },
  ],
  methods: {
    async insert(params, config) {
      const { table, data } = params;
      if (!table || !data) throw new Error('Missing required: table, data');

      const url = `${config.projectUrl}/rest/v1/${table}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'apikey': config.apiKey,
          'Authorization': `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation',
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) throw new Error(`Insert failed: ${response.statusText}`);
      return { success: true };
    },

    async select(params, config) {
      const { table, query = '*' } = params;
      if (!table) throw new Error('Missing required: table');

      const url = `${config.projectUrl}/rest/v1/${table}?select=${query}`;
      const response = await fetch(url, {
        headers: {
          'apikey': config.apiKey,
          'Authorization': `Bearer ${config.apiKey}`,
        },
      });

      if (!response.ok) throw new Error(`Select failed: ${response.statusText}`);
      return { success: true, data: await response.json() };
    },

    async update(params, config) {
      const { table, match, data } = params;
      if (!table || !match || !data) throw new Error('Missing required: table, match, data');

      const matchStr = Object.entries(match).map(([k, v]) => `${k}=eq.${v}`).join('&');
      const url = `${config.projectUrl}/rest/v1/${table}?${matchStr}`;
      const response = await fetch(url, {
        method: 'PATCH',
        headers: {
          'apikey': config.apiKey,
          'Authorization': `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation',
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) throw new Error(`Update failed: ${response.statusText}`);
      return { success: true };
    },

    async upsert(params, config) {
      const { table, data } = params;
      if (!table || !data) throw new Error('Missing required: table, data');

      const onConflict = params.onConflict || 'id';
      const url = `${config.projectUrl}/rest/v1/${table}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'apikey': config.apiKey,
          'Authorization': `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates,return=representation',
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) throw new Error(`Upsert failed: ${response.statusText}`);
      return { success: true };
    },
  },
  test: async (config) => {
    try {
      const response = await fetch(`${config.projectUrl}/rest/v1/`, {
        headers: {
          'apikey': config.apiKey,
          'Authorization': `Bearer ${config.apiKey}`,
        },
      });
      return { success: response.ok, status: response.status };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },
}));

// Slack Connector
Connectors.register(createConnector({
  id: 'slack',
  name: 'Slack',
  type: 'messaging',
  description: 'Send notifications to Slack',
  configSchema: [
    { key: 'webhookUrl', label: 'Webhook URL', type: 'text', required: true, placeholder: 'https://hooks.slack.com/services/...' },
  ],
  methods: {
    async send(params, config) {
      const { channel, text, blocks = [] } = params;

      const payload = {};
      if (channel) payload.channel = channel;
      if (text) payload.text = text;
      if (blocks.length > 0) {
        payload.blocks = blocks;
      } else if (text) {
        payload.blocks = [
          {
            type: 'section',
            text: { type: 'mrkdwn', text },
          },
        ];
      }

      const response = await fetch(config.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) throw new Error(`Slack send failed: ${response.statusText}`);
      return { success: true };
    },

    async sendFile(params, config) {
      const { channel, content, filename } = params;
      if (!channel || !content || !filename) {
        throw new Error('Missing required: channel, content, filename');
      }

      const payload = {
        channel,
        blocks: [
          {
            type: 'section',
            text: { type: 'mrkdwn', text: `_File: \`${filename}\`_` },
          },
          {
            type: 'section',
            text: { type: 'mrkdwn', text: `\`\`\`\n${content}\n\`\`\`` },
          },
        ],
      };

      const response = await fetch(config.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) throw new Error(`Slack file send failed: ${response.statusText}`);
      return { success: true };
    },
  },
  test: async (config) => {
    try {
      const response = await fetch(config.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'COBRA test message' }),
      });
      return { success: response.ok, status: response.status };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },
}));

// Custom REST Connector
Connectors.register(createConnector({
  id: 'custom-rest',
  name: 'Custom REST',
  type: 'api',
  description: 'Configurable REST API connector',
  configSchema: [
    { key: 'baseUrl', label: 'Base URL', type: 'text', required: true, placeholder: 'https://api.example.com' },
    { key: 'authType', label: 'Auth Type', type: 'select', required: false, default: 'none', options: ['none', 'bearer', 'api-key', 'basic'] },
    { key: 'authValue', label: 'Auth Value', type: 'text', required: false },
  ],
  methods: {
    async request(params, config) {
      const { method = 'GET', path, data, headers = {} } = params;

      const finalHeaders = { ...headers };
      if (config.authType === 'bearer') {
        finalHeaders.Authorization = `Bearer ${config.authValue}`;
      } else if (config.authType === 'api-key') {
        finalHeaders['X-API-Key'] = config.authValue;
      } else if (config.authType === 'basic') {
        finalHeaders.Authorization = `Basic ${btoa(config.authValue)}`;
      }

      const url = `${config.baseUrl}${path}`;
      const options = { method, headers: finalHeaders };
      if (data) {
        finalHeaders['Content-Type'] = 'application/json';
        options.body = JSON.stringify(data);
      }

      const response = await fetch(url, options);
      if (!response.ok) throw new Error(`Request failed: ${response.statusText}`);

      const contentType = response.headers.get('content-type');
      const responseData = contentType?.includes('application/json') ? await response.json() : await response.text();
      return { success: true, status: response.status, data: responseData };
    },
  },
  test: async (config) => {
    try {
      const response = await fetch(config.baseUrl);
      return { success: true, status: response.status };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },
}));

// Export to service worker global scope (MV3 compatible)
if (typeof self !== 'undefined') {
  self.Connectors = Connectors;
}
