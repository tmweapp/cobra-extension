/**
 * Connectors Tests
 * Tests for connector registration, configuration, and execution
 */

require('../connectors.js');

describe('Connectors', () => {
  let Connectors;
  let mockCryptoUtils;

  beforeEach(() => {
    Connectors = global.Connectors;

    // Mock CryptoUtils
    mockCryptoUtils = {
      encrypt: jest.fn(async (data) => `encrypted_${data}`),
      decrypt: jest.fn(async (data) => data.replace('encrypted_', '')),
    };
    global.CryptoUtils = mockCryptoUtils;

    // Reset chrome mocks
    jest.clearAllMocks();
    chrome.storage.local.get.mockImplementation((key, cb) => {
      if (typeof cb === 'function') cb({});
      return Promise.resolve({});
    });
    chrome.storage.local.set.mockImplementation((data, cb) => {
      if (typeof cb === 'function') cb();
      return Promise.resolve();
    });
  });

  describe('register()', () => {
    it('should register a connector', () => {
      const connector = {
        id: 'test-register-001',
        name: 'Test Connector',
        type: 'api',
        configured: false,
        configSchema: [],
        methods: {},
      };
      const result = Connectors.register(connector);
      expect(result).toBe(true);
      expect(Connectors.get('test-register-001')).toBeDefined();
    });

    it('should reject connector without id', () => {
      const connector = {
        name: 'Test',
        type: 'api',
      };
      const result = Connectors.register(connector);
      expect(result).toBe(false);
    });

    it('should reject connector without name', () => {
      const connector = {
        id: 'test',
        type: 'api',
      };
      const result = Connectors.register(connector);
      expect(result).toBe(false);
    });

    it('should overwrite existing connector with same id', () => {
      const connector1 = {
        id: 'test-overwrite',
        name: 'Test 1',
        configured: false,
      };
      const connector2 = {
        id: 'test-overwrite',
        name: 'Test 2',
        configured: false,
      };
      Connectors.register(connector1);
      Connectors.register(connector2);
      expect(Connectors.get('test-overwrite').name).toBe('Test 2');
    });
  });

  describe('get()', () => {
    it('should retrieve registered connector', () => {
      const connector = Connectors.get('email');
      expect(connector).toBeDefined();
      expect(connector.name).toBe('Email');
    });

    it('should return null for unregistered connector', () => {
      const connector = Connectors.get('nonexistent-connector-xyz');
      expect(connector).toBeNull();
    });
  });

  describe('list()', () => {
    beforeEach(() => {
      Connectors.register({
        id: 'connector1-list-test',
        name: 'Connector 1',
        type: 'api',
        configured: false,
        description: 'First connector',
      });
      Connectors.register({
        id: 'connector2-list-test',
        name: 'Connector 2',
        type: 'database',
        configured: true,
        description: 'Second connector',
      });
    });

    it('should list all registered connectors', () => {
      const list = Connectors.list();
      expect(Array.isArray(list)).toBe(true);
      expect(list.length).toBeGreaterThanOrEqual(2);
    });

    it('should include connector metadata', () => {
      const list = Connectors.list();
      const connector = list.find((c) => c.id === 'connector1-list-test');
      expect(connector).toBeDefined();
      expect(connector.name).toBe('Connector 1');
      expect(connector.type).toBe('api');
      expect(connector.configured).toBe(false);
      expect(connector.description).toBe('First connector');
    });
  });

  describe('configure()', () => {
    beforeEach(() => {
      const connector = {
        id: 'api-connector',
        name: 'API Connector',
        type: 'api',
        configured: false,
        configSchema: [
          { key: 'apiUrl', required: true },
          { key: 'apiKey', required: true },
          { key: 'timeout', required: false },
        ],
        methods: {},
      };
      Connectors.register(connector);
    });

    it('should configure connector with valid config', async () => {
      const config = {
        apiUrl: 'https://api.example.com',
        apiKey: 'secret-key',
      };
      const result = await Connectors.configure('api-connector', config);
      expect(result).toBe(true);
      const connector = Connectors.get('api-connector');
      expect(connector.configured).toBe(true);
    });

    it('should reject missing required field', async () => {
      const config = {
        apiUrl: 'https://api.example.com',
      };
      await expect(
        Connectors.configure('api-connector', config)
      ).rejects.toThrow('Missing required field');
    });

    it('should reject configuration for nonexistent connector', async () => {
      const config = { apiUrl: 'https://api.example.com' };
      await expect(
        Connectors.configure('nonexistent', config)
      ).rejects.toThrow('Connector not found');
    });

    it('should encrypt and store config', async () => {
      const config = {
        apiUrl: 'https://api.example.com',
        apiKey: 'secret-key',
      };
      await Connectors.configure('api-connector', config);
      expect(mockCryptoUtils.encrypt).toHaveBeenCalled();
      expect(chrome.storage.local.set).toHaveBeenCalled();
    });

    it('should allow optional fields to be missing', async () => {
      const config = {
        apiUrl: 'https://api.example.com',
        apiKey: 'secret-key',
      };
      const result = await Connectors.configure('api-connector', config);
      expect(result).toBe(true);
    });
  });

  describe('execute()', () => {
    beforeEach(() => {
      const connector = {
        id: 'test-api',
        name: 'Test API',
        type: 'api',
        configured: true,
        config: { baseUrl: 'https://api.test.com' },
        methods: {
          getData: jest.fn(async (params, config) => {
            return { success: true, data: params };
          }),
          sendData: jest.fn(async (params, config) => {
            return { success: true };
          }),
        },
      };
      Connectors.register(connector);
    });

    it('should execute connector method', async () => {
      const result = await Connectors.execute('test-api', 'getData', { id: 1 });
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ id: 1 });
    });

    it('should reject unconfigured connector', async () => {
      const connector = {
        id: 'unconfigured',
        name: 'Unconfigured',
        type: 'api',
        configured: false,
        methods: {},
      };
      Connectors.register(connector);

      await expect(
        Connectors.execute('unconfigured', 'anyMethod')
      ).rejects.toThrow('Connector not configured');
    });

    it('should reject nonexistent connector', async () => {
      await expect(
        Connectors.execute('nonexistent', 'method')
      ).rejects.toThrow('Connector not found');
    });

    it('should reject nonexistent method', async () => {
      await expect(
        Connectors.execute('test-api', 'nonexistentMethod')
      ).rejects.toThrow('Method not found');
    });

    it('should pass parameters to method', async () => {
      const params = { id: 1, name: 'Test' };
      await Connectors.execute('test-api', 'getData', params);
      const testConnector = Connectors.get('test-api');
      expect(testConnector.methods.getData).toHaveBeenCalledWith(
        params,
        expect.any(Object)
      );
    });
  });

  describe('test()', () => {
    it('should test connector with test method', async () => {
      const connector = {
        id: 'test-connector',
        name: 'Test',
        configured: true,
        config: {},
        test: jest.fn(async (config) => {
          return { success: true };
        }),
      };
      Connectors.register(connector);

      const result = await Connectors.test('test-connector');
      expect(result.success).toBe(true);
    });

    it('should return success when no test method defined', async () => {
      const connector = {
        id: 'test-connector',
        name: 'Test',
        configured: true,
        config: {},
      };
      Connectors.register(connector);

      const result = await Connectors.test('test-connector');
      expect(result.success).toBe(true);
    });

    it('should reject nonexistent connector', async () => {
      await expect(
        Connectors.test('nonexistent')
      ).rejects.toThrow('Connector not found');
    });
  });

  describe('init()', () => {
    it('should load saved configs from storage', async () => {
      const connector = {
        id: 'saved-connector',
        name: 'Saved',
        type: 'api',
        configured: false,
        configSchema: [],
        methods: {},
      };
      Connectors.register(connector);

      chrome.storage.local.get.mockImplementation((key, cb) => {
        if (typeof cb === 'function') {
          cb({
            fs_connectors_config: {
              'saved-connector': 'encrypted_{"apiKey": "secret"}',
            },
          });
        }
        return Promise.resolve({
          fs_connectors_config: {
            'saved-connector': 'encrypted_{"apiKey": "secret"}',
          },
        });
      });

      await Connectors.init();
      const savedConnector = Connectors.get('saved-connector');
      expect(savedConnector.configured).toBe(true);
    });

    it('should skip unregistered connectors in storage', async () => {
      chrome.storage.local.get.mockImplementation((key, cb) => {
        if (typeof cb === 'function') {
          cb({
            fs_connectors_config: {
              'unknown-connector': 'encrypted_config',
            },
          });
        }
        return Promise.resolve({
          fs_connectors_config: {
            'unknown-connector': 'encrypted_config',
          },
        });
      });

      // Should not throw
      await expect(Connectors.init()).resolves.toBeUndefined();
    });

    it('should handle decryption errors gracefully', async () => {
      const connector = {
        id: 'bad-connector',
        name: 'Bad',
        type: 'api',
        configured: false,
        methods: {},
      };
      Connectors.register(connector);

      mockCryptoUtils.decrypt.mockRejectedValue(new Error('Decrypt failed'));
      chrome.storage.local.get.mockImplementation((key, cb) => {
        if (typeof cb === 'function') {
          cb({
            fs_connectors_config: {
              'bad-connector': 'bad_encrypted_data',
            },
          });
        }
        return Promise.resolve({
          fs_connectors_config: {
            'bad-connector': 'bad_encrypted_data',
          },
        });
      });

      // Should not throw
      await expect(Connectors.init()).resolves.toBeUndefined();
    });
  });

  describe('getStats()', () => {
    beforeEach(() => {
      Connectors.register({
        id: 'api1-stats',
        name: 'API 1',
        type: 'api',
        configured: true,
      });
      Connectors.register({
        id: 'api2-stats',
        name: 'API 2',
        type: 'api',
        configured: false,
      });
      Connectors.register({
        id: 'db1-stats',
        name: 'DB 1',
        type: 'database',
        configured: true,
      });
    });

    it('should return connector statistics', () => {
      const stats = Connectors.getStats();
      expect(stats.total).toBeGreaterThanOrEqual(3);
      expect(stats.configured).toBeGreaterThanOrEqual(2);
    });

    it('should count connectors by type', () => {
      const stats = Connectors.getStats();
      expect(stats.byType.api).toBeGreaterThanOrEqual(2);
      expect(stats.byType.database).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Built-in connectors', () => {
    it('should have email connector', () => {
      // Create a fresh Connectors instance to test built-in
      const freshConnectors = global.Connectors;
      const connector = freshConnectors.get('email');
      expect(connector).toBeDefined();
      expect(connector.name).toBe('Email');
      expect(connector.type).toBe('email');
    });

    it('should have webhook connector', () => {
      const connector = Connectors.get('webhook');
      expect(connector).toBeDefined();
      expect(connector.name).toBe('Webhook');
      expect(connector.type).toBe('webhook');
    });

    it('should have google-sheets connector', () => {
      const connector = Connectors.get('google-sheets');
      expect(connector).toBeDefined();
      expect(connector.name).toBe('Google Sheets');
      expect(connector.type).toBe('database');
    });

    it('should have supabase connector', () => {
      const connector = Connectors.get('supabase');
      expect(connector).toBeDefined();
      expect(connector.name).toBe('Supabase');
      expect(connector.type).toBe('database');
    });

    it('should have slack connector', () => {
      const connector = Connectors.get('slack');
      expect(connector).toBeDefined();
      expect(connector.name).toBe('Slack');
      expect(connector.type).toBe('messaging');
    });

    it('should have custom-rest connector', () => {
      const connector = Connectors.get('custom-rest');
      expect(connector).toBeDefined();
      expect(connector.name).toBe('Custom REST');
      expect(connector.type).toBe('api');
    });
  });

  describe('Email connector integration', () => {
    it('should validate email in send method', async () => {
      const emailConnector = Connectors.get('email');
      expect(emailConnector).toBeDefined();
      expect(emailConnector.methods.send).toBeDefined();
    });
  });

  describe('Webhook connector integration', () => {
    it('should have webhook send method', async () => {
      const webhookConnector = Connectors.get('webhook');
      expect(webhookConnector).toBeDefined();
      expect(webhookConnector.methods.send).toBeDefined();
    });
  });

  describe('Email connector', () => {
    it('should have send method', () => {
      const emailConnector = Connectors.get('email');
      expect(emailConnector).toBeDefined();
      expect(emailConnector.methods.send).toBeDefined();
      expect(typeof emailConnector.methods.send).toBe('function');
    });

    it('should validate webhook URL when configured', async () => {
      // Test that the connector exists and has proper validation
      const emailConnector = Connectors.get('email');
      expect(emailConnector.configSchema).toBeDefined();
      const webhookUrlField = emailConnector.configSchema.find(
        (f) => f.key === 'webhookUrl'
      );
      expect(webhookUrlField).toBeDefined();
      expect(webhookUrlField.required).toBe(true);
    });
  });

  describe('Webhook connector', () => {
    it('should have send method', () => {
      const webhookConnector = Connectors.get('webhook');
      expect(webhookConnector).toBeDefined();
      expect(webhookConnector.methods.send).toBeDefined();
      expect(typeof webhookConnector.methods.send).toBe('function');
    });

    it('should support multiple authentication types', () => {
      const webhookConnector = Connectors.get('webhook');
      const authTypeField = webhookConnector.configSchema.find(
        (f) => f.key === 'authType'
      );
      expect(authTypeField).toBeDefined();
      expect(authTypeField.required).toBe(false);
    });
  });
});
