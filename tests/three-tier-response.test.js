/**
 * Tests for ThreeTierResponse module
 * Coverage: ~20+ tests
 */

const ThreeTierResponse = require('../three-tier-response.js');

describe('ThreeTierResponse', () => {

  // ====================== PROMPT BUILDING ======================

  test('should build three-tier prompt', () => {
    const system = 'You are helpful';
    const user = 'Explain quantum computing';

    const { systemPrompt, userPrompt } = ThreeTierResponse.buildThreeTierPrompt(system, user);

    expect(systemPrompt).toContain('You are helpful');
    expect(systemPrompt).toContain('synthetic');
    expect(systemPrompt).toContain('summary');
    expect(systemPrompt).toContain('full');
    expect(userPrompt).toContain('Explain quantum computing');
  });

  test('should add instruction to system prompt', () => {
    const { systemPrompt } = ThreeTierResponse.buildThreeTierPrompt('Base system', 'user message');

    expect(systemPrompt).toContain('JSON');
    expect(systemPrompt).toContain('synthetic');
    expect(systemPrompt).toContain('summary');
    expect(systemPrompt).toContain('full');
  });

  test('should include previous context in enhanced prompt', () => {
    const { userPrompt } = ThreeTierResponse.buildThreeTierPrompt(
      'system',
      'Follow up message',
      { previousContext: 'Previous discussion about AI' }
    );

    expect(userPrompt).toContain('Context:');
    expect(userPrompt).toContain('Previous discussion about AI');
    expect(userPrompt).toContain('Follow up message');
  });

  test('should include metadata in prompt', () => {
    const metadata = { topic: 'science', tone: 'technical' };
    const { userPrompt } = ThreeTierResponse.buildThreeTierPrompt(
      'system',
      'message',
      { metadata }
    );

    expect(userPrompt).toContain('Metadata');
    expect(userPrompt).toContain('science');
  });

  test('should handle empty context gracefully', () => {
    const { userPrompt } = ThreeTierResponse.buildThreeTierPrompt(
      'system',
      'message',
      {}
    );

    expect(userPrompt).toContain('message');
  });

  // ====================== JSON PARSING ======================

  test('should parse valid three-tier JSON response', () => {
    const json = JSON.stringify({
      synthetic: 'Quick answer',
      summary: 'Detailed but concise summary',
      full: 'Complete response with all details'
    });

    const parsed = ThreeTierResponse.parseThreeTierResponse(json);

    expect(parsed.synthetic).toBe('Quick answer');
    expect(parsed.summary).toBe('Detailed but concise summary');
    expect(parsed.full).toBe('Complete response with all details');
    expect(parsed._parsed).toBe(true);
  });

  test('should handle JSON with markdown code blocks', () => {
    const json = `\`\`\`json
{
  "synthetic": "Quick",
  "summary": "Medium",
  "full": "Full response"
}
\`\`\``;

    const parsed = ThreeTierResponse.parseThreeTierResponse(json);

    expect(parsed.synthetic).toBe('Quick');
    expect(parsed.summary).toBe('Medium');
    expect(parsed.full).toBe('Full response');
    expect(parsed._parsed).toBe(true);
  });

  test('should handle JSON with plain backticks', () => {
    const json = `\`\`\`
{
  "synthetic": "s",
  "summary": "m",
  "full": "f"
}
\`\`\``;

    const parsed = ThreeTierResponse.parseThreeTierResponse(json);

    expect(parsed.synthetic).toBe('s');
    expect(parsed._parsed).toBe(true);
  });

  test('should validate JSON structure', () => {
    const invalid = JSON.stringify({
      synthetic: 'Quick',
      summary: 'Medium'
      // Missing 'full'
    });

    const parsed = ThreeTierResponse.parseThreeTierResponse(invalid);

    // Should fallback, not throw
    expect(parsed._parsed).toBe(false);
    expect(parsed.synthetic).toBeDefined();
    expect(parsed.full).toBeDefined();
  });

  test('should require non-empty strings in JSON', () => {
    const invalid = JSON.stringify({
      synthetic: '',
      summary: 'Medium',
      full: 'Full'
    });

    const parsed = ThreeTierResponse.parseThreeTierResponse(invalid);

    // Should fallback
    expect(parsed._parsed).toBe(false);
  });

  // ====================== FALLBACK PARSING ======================

  test('should fallback to heuristic parsing on JSON error', () => {
    const malformedJson = '{ invalid json }';

    const parsed = ThreeTierResponse.parseThreeTierResponse(malformedJson);

    expect(parsed._parsed).toBe(false);
    expect(parsed.synthetic).toBeDefined();
    expect(parsed.summary).toBeDefined();
    expect(parsed.full).toBe('{ invalid json }');
  });

  test('should extract first sentence as synthetic', () => {
    const text = 'First sentence here. Second sentence. Third.';

    const parsed = ThreeTierResponse.parseThreeTierResponse(text);

    expect(parsed.synthetic).toContain('First sentence');
    expect(parsed.synthetic).not.toContain('Second sentence');
  });

  test('should extract first three sentences as summary', () => {
    const text = 'One. Two. Three. Four. Five.';

    const parsed = ThreeTierResponse.parseThreeTierResponse(text);

    expect(parsed.summary).toContain('One');
    expect(parsed.summary).toContain('Three');
  });

  test('should handle text with various sentence delimiters', () => {
    const text = 'First! Second? Third.';

    const parsed = ThreeTierResponse.parseThreeTierResponse(text);

    expect(parsed.synthetic.length).toBeGreaterThan(0);
    expect(parsed.summary.length).toBeGreaterThan(0);
  });

  test('should cap synthetic length', () => {
    const veryLongFirst = 'x'.repeat(200) + '. Short second.';

    const parsed = ThreeTierResponse.parseThreeTierResponse(veryLongFirst);

    expect(parsed.synthetic.length).toBeLessThanOrEqual(103); // 100 + "..."
  });

  test('should cap summary length', () => {
    const longText = ('Long sentence. '.repeat(50)) + 'Final.';

    const parsed = ThreeTierResponse.parseThreeTierResponse(longText);

    expect(parsed.summary.length).toBeLessThanOrEqual(300);
  });

  test('should handle text without sentences', () => {
    const noSentences = 'justtext';

    const parsed = ThreeTierResponse.parseThreeTierResponse(noSentences);

    expect(parsed.synthetic.length).toBeGreaterThan(0);
    expect(parsed.full).toBe('justtext');
  });

  test('should provide fallback for empty input', () => {
    const parsed = ThreeTierResponse.parseThreeTierResponse('');

    expect(parsed.synthetic.length).toBeGreaterThan(0);
    expect(parsed.summary.length).toBeGreaterThan(0);
    expect(parsed.full).toBeDefined();
  });

  test('should handle null/undefined input', () => {
    const parsed1 = ThreeTierResponse.parseThreeTierResponse(null);
    const parsed2 = ThreeTierResponse.parseThreeTierResponse(undefined);

    expect(parsed1.synthetic).toBeDefined();
    expect(parsed2.full).toBeDefined();
  });

  // ====================== VALIDATION ======================

  test('should validate three-tier structure', () => {
    const valid = {
      synthetic: 'Quick',
      summary: 'Medium',
      full: 'Full'
    };

    const result = ThreeTierResponse.validateThreeTier(valid);

    expect(result).toBe(true);
  });

  test('should reject incomplete structure', () => {
    const invalid = {
      synthetic: 'Quick',
      summary: 'Medium'
    };

    const result = ThreeTierResponse.validateThreeTier(invalid);

    expect(result).toBe(false);
  });

  test('should reject empty strings', () => {
    const invalid = {
      synthetic: '',
      summary: 'Medium',
      full: 'Full'
    };

    const result = ThreeTierResponse.validateThreeTier(invalid);

    expect(result).toBe(false);
  });

  test('should reject non-objects', () => {
    expect(ThreeTierResponse.validateThreeTier(null)).toBe(false);
    expect(ThreeTierResponse.validateThreeTier('string')).toBe(false);
    expect(ThreeTierResponse.validateThreeTier(123)).toBe(false);
  });

  // ====================== TOKEN VALIDATION ======================

  test('should validate token limits', () => {
    const response = {
      synthetic: 'Quick answer',
      summary: 'A bit longer summary here',
      full: 'Very comprehensive response with lots of detail'
    };

    const validation = ThreeTierResponse.validateTokenLimits(response);

    expect(validation).toHaveProperty('valid');
    expect(validation).toHaveProperty('syntheticTokens');
    expect(validation).toHaveProperty('summaryTokens');
    expect(validation).toHaveProperty('fullTokens');
    expect(validation).toHaveProperty('violations');
  });

  test('should accept responses within limits', () => {
    const response = {
      synthetic: 'Quick',
      summary: 'Medium summary',
      full: 'Full response here'
    };

    const validation = ThreeTierResponse.validateTokenLimits(response);

    expect(validation.valid).toBe(true);
  });

  test('should detect synthetic token violation', () => {
    const response = {
      synthetic: 'x'.repeat(300),
      summary: 'Medium',
      full: 'Full'
    };

    const validation = ThreeTierResponse.validateTokenLimits(response, {
      syntheticMax: 50
    });

    expect(validation.violations.synthetic).toBe(true);
  });

  test('should detect summary token violation', () => {
    const response = {
      synthetic: 'Quick',
      summary: 'x'.repeat(1000),
      full: 'Full'
    };

    const validation = ThreeTierResponse.validateTokenLimits(response, {
      summaryMax: 100
    });

    expect(validation.violations.summary).toBe(true);
  });

  test('should use default limits', () => {
    const response = {
      synthetic: 'Short',
      summary: 'Medium',
      full: 'Full response'
    };

    const validation = ThreeTierResponse.validateTokenLimits(response);

    expect(validation.syntheticTokens).toBeGreaterThanOrEqual(0);
    expect(validation.summaryTokens).toBeGreaterThanOrEqual(0);
    expect(validation.fullTokens).toBeGreaterThanOrEqual(0);
  });

  // ====================== EDGE CASES ======================

  test('should handle special characters', () => {
    const special = {
      synthetic: 'Hi 你好 مرحبا 🎉',
      summary: 'Multiple languages: English, Chinese, Arabic, Emoji',
      full: 'Special <script>alert("xss")</script> characters here'
    };

    const validation = ThreeTierResponse.validateThreeTier(special);

    expect(validation).toBe(true);
  });

  test('should handle very long responses', () => {
    const response = {
      synthetic: 'Quick',
      summary: 'x'.repeat(500),
      full: 'x'.repeat(50000)
    };

    const parsed = ThreeTierResponse.parseThreeTierResponse(JSON.stringify(response));

    expect(parsed.full.length).toBeGreaterThan(1000);
  });

  test('should estimate tokens consistently', () => {
    const text = 'Hello world test';
    const tokens1 = ThreeTierResponse._estimateTokens(text);
    const tokens2 = ThreeTierResponse._estimateTokens(text);

    expect(tokens1).toBe(tokens2);
  });

  test('should estimate zero tokens for empty', () => {
    expect(ThreeTierResponse._estimateTokens('')).toBe(0);
    expect(ThreeTierResponse._estimateTokens(null)).toBe(0);
  });
});
