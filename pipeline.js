/**
 * Pipeline Module for COBRA
 * Orchestration layer that ties TaskRunner, FileManager, Connectors, Agent, and Brain together
 * Pipelines are JSON definitions that describe complete workflows
 */

const Pipeline = {
  _dbName: 'COBRAPipelines',
  _dbVersion: 1,
  _storeName: 'pipelines',
  _db: null,
  _executionHistory: [],

  /**
   * Pre-built pipeline templates
   */
  templates: {
    'logistics-scraper': {
      id: 'logistics-scraper',
      name: 'Logistics Company Scraper',
      description: 'Scrape sites → analyze → extract companies → save to Supabase → export CSV',
      variables: {
        country: { type: 'string', default: 'DE', label: 'Country code' },
        maxPages: { type: 'number', default: 10, label: 'Max pages to scrape' },
      },
      stages: [
        {
          id: 'search',
          type: 'scrape',
          params: {
            url: 'https://www.google.com/search?q={{country}}+logistics+companies',
          },
        },
        {
          id: 'analyze',
          type: 'brain-think',
          params: {
            prompt: 'Extract company names, emails, and phone numbers from: {{stages.search.markdown}}',
          },
          transform: { pick: ['analysis.companies'] },
        },
        {
          id: 'filter',
          type: 'transform',
          params: {
            operation: 'filter',
            field: 'country',
            value: '{{country}}',
          },
        },
        {
          id: 'save_db',
          type: 'connector',
          params: {
            connector: 'supabase',
            method: 'upsert',
            table: 'companies',
            data: '{{stages.filter}}',
          },
        },
        {
          id: 'export',
          type: 'download',
          params: {
            format: 'csv',
            filename: 'companies-{{country}}-{{now}}.csv',
            data: '{{stages.filter}}',
          },
        },
      ],
    },

    'contact-finder': {
      id: 'contact-finder',
      name: 'Contact Finder',
      description: 'Navigate → snapshot → analyze → extract contacts → email report',
      variables: {
        websiteUrl: { type: 'string', label: 'Website URL' },
        recipientEmail: { type: 'string', label: 'Email for report' },
      },
      stages: [
        {
          id: 'navigate',
          type: 'agent',
          params: {
            action: 'navigate',
            url: '{{websiteUrl}}',
          },
        },
        {
          id: 'snapshot',
          type: 'scrape',
          params: {},
        },
        {
          id: 'analyze',
          type: 'brain-think',
          params: {
            prompt: 'Find all email addresses, phone numbers, and contact forms on this page: {{stages.snapshot.markdown}}',
          },
          transform: { pick: ['analysis.contacts'] },
        },
        {
          id: 'notify',
          type: 'connector',
          params: {
            connector: 'email',
            method: 'send',
            to: '{{recipientEmail}}',
            subject: 'Contact info found on {{websiteUrl}}',
            body: 'Contacts: {{stages.analyze}}',
          },
        },
      ],
    },

    'site-monitor': {
      id: 'site-monitor',
      name: 'Site Monitor',
      description: 'Batch scrape URLs → compare with previous data → notify changes via webhook',
      variables: {
        urls: { type: 'array', label: 'URLs to monitor' },
        webhookUrl: { type: 'string', label: 'Webhook URL for notifications' },
      },
      stages: [
        {
          id: 'scrape_batch',
          type: 'batch',
          params: {
            items: '{{urls}}',
          },
          stages: [
            {
              id: 'scrape_item',
              type: 'scrape',
              params: {
                url: '{{item}}',
              },
            },
          ],
        },
        {
          id: 'analyze_changes',
          type: 'brain-think',
          params: {
            prompt: 'Compare current content with previous snapshots and identify changes: {{stages.scrape_batch}}',
          },
        },
        {
          id: 'notify_webhook',
          type: 'connector',
          params: {
            connector: 'webhook',
            method: 'send',
            url: '{{webhookUrl}}',
            data: '{{stages.analyze_changes}}',
          },
        },
      ],
    },
  },

  /**
   * Initialize IndexedDB connection
   */
  async _getDb() {
    if (this._db) return this._db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this._dbName, this._dbVersion);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this._db = request.result;
        resolve(this._db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(this._storeName)) {
          db.createObjectStore(this._storeName, { keyPath: 'id' });
        }
      };
    });
  },

  /**
   * Save a pipeline definition to IndexedDB
   */
  async save(pipelineDef) {
    this.validate(pipelineDef);
    const db = await this._getDb();
    const store = db.transaction(this._storeName, 'readwrite').objectStore(this._storeName);
    const timestamp = new Date().toISOString();
    const toSave = { ...pipelineDef, savedAt: timestamp };
    return new Promise((resolve, reject) => {
      const request = store.put(toSave);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(toSave);
    });
  },

  /**
   * Load a pipeline by ID
   */
  async load(pipelineId) {
    const db = await this._getDb();
    const store = db.transaction(this._storeName, 'readonly').objectStore(this._storeName);
    return new Promise((resolve, reject) => {
      const request = store.get(pipelineId);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result || null);
    });
  },

  /**
   * List all pipelines
   */
  async list() {
    const db = await this._getDb();
    const store = db.transaction(this._storeName, 'readonly').objectStore(this._storeName);
    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  },

  /**
   * Delete a pipeline
   */
  async remove(pipelineId) {
    const db = await this._getDb();
    const store = db.transaction(this._storeName, 'readwrite').objectStore(this._storeName);
    return new Promise((resolve, reject) => {
      const request = store.delete(pipelineId);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(true);
    });
  },

  /**
   * Execute a pipeline
   * Converts pipeline definition to TaskRunner steps and executes
   */
  async execute(pipelineId, variables = {}) {
    const pipeline = await this.load(pipelineId);
    if (!pipeline) throw new Error(`Pipeline not found: ${pipelineId}`);

    const startTime = Date.now();
    const executionId = `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    try {
      // Merge default variables with provided ones
      const context = this._initContext(pipeline.variables, variables);

      // Compile pipeline to TaskRunner steps
      const steps = this._compile(pipeline.stages, context);

      // Execute via TaskRunner (assuming TaskRunner is available globally)
      if (!globalThis.TaskRunner) {
        throw new Error('TaskRunner module not loaded');
      }

      const result = await globalThis.TaskRunner.executeBatch(steps);

      const execution = {
        executionId,
        pipelineId,
        status: 'completed',
        startTime,
        endTime: Date.now(),
        duration: Date.now() - startTime,
        result,
        variables,
      };

      this._executionHistory.push(execution);
      return execution;
    } catch (error) {
      const execution = {
        executionId,
        pipelineId,
        status: 'failed',
        startTime,
        endTime: Date.now(),
        duration: Date.now() - startTime,
        error: error.message,
        variables,
      };

      this._executionHistory.push(execution);
      throw error;
    }
  },

  /**
   * Initialize execution context with variables
   */
  _initContext(variableDefs = {}, providedValues = {}) {
    const context = {
      stages: {},
      variables: {},
      now: new Date().toISOString(),
      date: new Date().toLocaleDateString(),
      random: Math.random().toString(36).substr(2, 9),
    };

    // Apply variable defaults
    Object.entries(variableDefs).forEach(([key, def]) => {
      context.variables[key] = providedValues[key] !== undefined ? providedValues[key] : def.default;
    });

    return context;
  },

  /**
   * Compile pipeline stages into TaskRunner steps
   */
  _compile(stages, context) {
    const steps = [];

    const processStages = (stageList, parentPath = '') => {
      stageList.forEach((stage) => {
        const stagePath = parentPath ? `${parentPath}.${stage.id}` : stage.id;

        if (stage.type === 'forEach') {
          // Expand forEach into multiple copies of sub-stages
          const items = this._resolveVars(stage.params.items, context);
          if (Array.isArray(items)) {
            items.forEach((item, index) => {
              const itemContext = { ...context, item, itemIndex: index };
              if (stage.stages) {
                processStages(stage.stages, stagePath);
              }
            });
          }
        } else if (stage.type === 'if') {
          // Evaluate condition and pick branch
          const condition = this._evaluateCondition(stage.condition, context);
          if (condition && stage.then) {
            processStages(stage.then, parentPath);
          } else if (!condition && stage.else) {
            processStages(stage.else, parentPath);
          }
        } else if (stage.type === 'batch') {
          // Handle batch processing
          const items = this._resolveVars(stage.params.items, context);
          if (Array.isArray(items)) {
            items.forEach((item, index) => {
              const itemContext = { ...context, item, itemIndex: index };
              if (stage.stages) {
                processStages(stage.stages, stagePath);
              }
            });
          }
        } else {
          // Regular stage - convert to TaskRunner task
          const task = this._stageToTask(stage, context, stagePath);
          steps.push(task);
        }
      });
    };

    processStages(stages);
    return steps;
  },

  /**
   * Convert a pipeline stage to a TaskRunner task
   */
  _stageToTask(stage, context, stagePath) {
    const resolvedParams = {};
    Object.entries(stage.params || {}).forEach(([key, value]) => {
      resolvedParams[key] = this._resolveVars(value, context);
    });

    const task = {
      id: stage.id,
      stagePath,
      type: stage.type,
      params: resolvedParams,
    };

    // Store result in context for downstream stages
    task.onComplete = (result) => {
      context.stages[stage.id] = result;
    };

    return task;
  },

  /**
   * Resolve variables in a value
   * Handles: {{variable}}, {{stages.search.markdown}}, {{item.name}}, {{now}}, {{date}}, {{random}}
   */
  _resolveVars(value, context) {
    if (value === null || value === undefined) return value;
    if (typeof value !== 'string') return value;

    return value.replace(/\{\{([^}]+)\}\}/g, (match, expression) => {
      const trimmed = expression.trim();

      // Try simple variable
      if (context.variables[trimmed] !== undefined) {
        return context.variables[trimmed];
      }

      // Try built-in variables
      if (trimmed === 'now') return context.now;
      if (trimmed === 'date') return context.date;
      if (trimmed === 'random') return context.random;

      // Try nested path: stages.search.markdown
      const parts = trimmed.split('.');
      let current = context;
      for (const part of parts) {
        if (current && typeof current === 'object' && part in current) {
          current = current[part];
        } else {
          return match; // Return original if path not found
        }
      }

      return current !== undefined ? String(current) : match;
    });
  },

  /**
   * Evaluate condition for if/else stages using safe expression parser
   * Supports: ==, !=, >, <, >=, <=, &&, ||, true, false, null
   */
  _evaluateCondition(condition, context) {
    if (!condition) return false;

    // Resolve variables in condition
    const resolved = this._resolveVars(condition, context);

    try {
      return this._safeExpressionEvaluator(resolved);
    } catch (e) {
      console.warn('Failed to evaluate condition:', condition, e);
      return false;
    }
  },

  /**
   * Safe expression evaluator - only handles comparison and logical operators
   */
  _safeExpressionEvaluator(expr) {
    if (!expr || typeof expr !== 'string') return false;

    // Tokenize the expression
    const tokens = this._tokenizeExpression(expr);

    // Parse and evaluate using recursive descent parser
    const parser = { pos: 0, tokens };
    const result = this._parseOrExpressionWithParser(parser);

    if (parser.pos !== parser.tokens.length) {
      throw new Error('Invalid expression: unexpected tokens at end');
    }

    return result;
  },

  /**
   * Tokenize expression into safe tokens
   */
  _tokenizeExpression(expr) {
    const tokens = [];
    let i = 0;

    while (i < expr.length) {
      if (/\s/.test(expr[i])) {
        i++; // Skip whitespace
        continue;
      }

      // Handle strings
      if (expr[i] === '"' || expr[i] === "'") {
        const quote = expr[i];
        let value = '';
        i++;
        while (i < expr.length && expr[i] !== quote) {
          value += expr[i];
          i++;
        }
        if (i < expr.length) i++; // Skip closing quote
        tokens.push({ type: 'string', value });
        continue;
      }

      // Handle numbers
      if (/\d/.test(expr[i])) {
        let value = '';
        while (i < expr.length && /\d/.test(expr[i])) {
          value += expr[i];
          i++;
        }
        tokens.push({ type: 'number', value: Number(value) });
        continue;
      }

      // Handle operators and keywords
      if (expr.substr(i, 3) === '===') {
        tokens.push({ type: 'operator', value: '==' });
        i += 3;
      } else if (expr.substr(i, 2) === '==') {
        tokens.push({ type: 'operator', value: '==' });
        i += 2;
      } else if (expr.substr(i, 2) === '!=') {
        tokens.push({ type: 'operator', value: '!=' });
        i += 2;
      } else if (expr.substr(i, 2) === '>=') {
        tokens.push({ type: 'operator', value: '>=' });
        i += 2;
      } else if (expr.substr(i, 2) === '<=') {
        tokens.push({ type: 'operator', value: '<=' });
        i += 2;
      } else if (expr.substr(i, 2) === '&&') {
        tokens.push({ type: 'logical', value: '&&' });
        i += 2;
      } else if (expr.substr(i, 2) === '||') {
        tokens.push({ type: 'logical', value: '||' });
        i += 2;
      } else if (expr[i] === '>') {
        tokens.push({ type: 'operator', value: '>' });
        i++;
      } else if (expr[i] === '<') {
        tokens.push({ type: 'operator', value: '<' });
        i++;
      } else if (expr[i] === '!') {
        tokens.push({ type: 'logical', value: '!' });
        i++;
      } else if (expr[i] === '(') {
        tokens.push({ type: 'paren', value: '(' });
        i++;
      } else if (expr[i] === ')') {
        tokens.push({ type: 'paren', value: ')' });
        i++;
      } else if (expr.substr(i, 4) === 'true') {
        tokens.push({ type: 'boolean', value: true });
        i += 4;
      } else if (expr.substr(i, 5) === 'false') {
        tokens.push({ type: 'boolean', value: false });
        i += 5;
      } else if (expr.substr(i, 4) === 'null') {
        tokens.push({ type: 'null', value: null });
        i += 4;
      } else {
        throw new Error(`Invalid token: ${expr[i]}`);
      }
    }

    return tokens;
  },

  /**
   * Recursive descent parser for OR expressions
   */
  _parseOrExpressionWithParser(parser) {
    let result = this._parseAndExpressionWithParser(parser);

    while (parser.pos < parser.tokens.length && parser.tokens[parser.pos]?.type === 'logical' && parser.tokens[parser.pos]?.value === '||') {
      parser.pos++;
      result = result || this._parseAndExpressionWithParser(parser);
    }

    return result;
  },

  /**
   * Parse AND expressions
   */
  _parseAndExpressionWithParser(parser) {
    let result = this._parseComparisonExpressionWithParser(parser);

    while (parser.pos < parser.tokens.length && parser.tokens[parser.pos]?.type === 'logical' && parser.tokens[parser.pos]?.value === '&&') {
      parser.pos++;
      result = result && this._parseComparisonExpressionWithParser(parser);
    }

    return result;
  },

  /**
   * Parse comparison expressions
   */
  _parseComparisonExpressionWithParser(parser) {
    let left = this._parsePrimaryExpressionWithParser(parser);

    if (parser.pos < parser.tokens.length && parser.tokens[parser.pos]?.type === 'operator') {
      const op = parser.tokens[parser.pos].value;
      parser.pos++;
      const right = this._parsePrimaryExpressionWithParser(parser);

      switch (op) {
        case '==': return left == right;
        case '!=': return left != right;
        case '>': return left > right;
        case '<': return left < right;
        case '>=': return left >= right;
        case '<=': return left <= right;
        default: throw new Error(`Unknown operator: ${op}`);
      }
    }

    return left;
  },

  /**
   * Parse primary expressions (values, parentheses)
   */
  _parsePrimaryExpressionWithParser(parser) {
    if (parser.pos >= parser.tokens.length) {
      throw new Error('Unexpected end of expression');
    }

    const token = parser.tokens[parser.pos];

    if (token.type === 'paren' && token.value === '(') {
      parser.pos++;
      const result = this._parseOrExpressionWithParser(parser);
      if (parser.pos >= parser.tokens.length || parser.tokens[parser.pos]?.value !== ')') {
        throw new Error('Missing closing parenthesis');
      }
      parser.pos++;
      return result;
    } else if (token.type === 'logical' && token.value === '!') {
      parser.pos++;
      return !this._parsePrimaryExpressionWithParser(parser);
    } else if (token.type === 'boolean' || token.type === 'null' || token.type === 'string' || token.type === 'number') {
      parser.pos++;
      return token.value;
    } else {
      throw new Error(`Unexpected token: ${JSON.stringify(token)}`);
    }
  },

  /**
   * Transform data based on transform rules
   */
  _transform(data, transform) {
    if (!transform) return data;

    let result = data;

    // pick: extract specific fields
    if (transform.pick) {
      const picked = {};
      transform.pick.forEach((field) => {
        const parts = field.split('.');
        let current = data;
        for (const part of parts) {
          current = current?.[part];
        }
        picked[field] = current;
      });
      result = picked;
    }

    // filter: filter array by condition
    if (transform.filter && Array.isArray(result)) {
      result = result.filter(transform.filter);
    }

    // map: transform array items
    if (transform.map && Array.isArray(result)) {
      result = result.map(transform.map);
    }

    return result;
  },

  /**
   * Get execution history
   */
  async getHistory(pipelineId = null) {
    if (pipelineId) {
      return this._executionHistory.filter((e) => e.pipelineId === pipelineId);
    }
    return this._executionHistory;
  },

  /**
   * Validate a pipeline definition
   */
  validate(pipelineDef) {
    if (!pipelineDef.id || !pipelineDef.name || !pipelineDef.stages) {
      throw new Error('Pipeline must have id, name, and stages');
    }

    if (!Array.isArray(pipelineDef.stages) || pipelineDef.stages.length === 0) {
      throw new Error('Pipeline must have at least one stage');
    }

    // Validate each stage
    pipelineDef.stages.forEach((stage, index) => {
      if (!stage.id || !stage.type) {
        throw new Error(`Stage ${index} must have id and type`);
      }

      const validTypes = [
        'scrape',
        'crawl',
        'batch',
        'map',
        'extract',
        'transform',
        'brain-think',
        'agent',
        'connector',
        'download',
        'forEach',
        'if',
      ];
      if (!validTypes.includes(stage.type)) {
        throw new Error(`Invalid stage type: ${stage.type}`);
      }

      // Validate conditional stages
      if (stage.type === 'if' && !stage.condition) {
        throw new Error(`If stage ${stage.id} must have a condition`);
      }

      // Validate forEach
      if (stage.type === 'forEach' && !stage.params?.items) {
        throw new Error(`forEach stage ${stage.id} must have items parameter`);
      }
    });

    return true;
  },

  /**
   * Get pipeline statistics
   */
  async getStats() {
    const pipelines = await this.list();
    const history = this._executionHistory;

    const stats = {
      totalPipelines: pipelines.length,
      totalExecutions: history.length,
      successfulExecutions: history.filter((e) => e.status === 'completed').length,
      failedExecutions: history.filter((e) => e.status === 'failed').length,
      averageDuration:
        history.length > 0
          ? Math.round(history.reduce((sum, e) => sum + e.duration, 0) / history.length)
          : 0,
      templates: Object.keys(this.templates),
    };

    return stats;
  },

  /**
   * Clear execution history
   */
  clearHistory() {
    this._executionHistory = [];
  },
};

// Export to service worker global scope (MV3 compatible)
if (typeof self !== 'undefined') {
  self.Pipeline = Pipeline;
}
