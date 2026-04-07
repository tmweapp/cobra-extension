/**
 * Playwright Global Setup for E2E Tests
 * Initializes environment before all tests run.
 */
module.exports = async (config) => {
  console.log('🚀 E2E Test Suite Starting...');
  console.log('Extension Path:', config.use.launchOptions.args[0]);

  // Clear any cached data if needed
  process.env.E2E_TEST_MODE = 'true';

  return async () => {
    console.log('✅ Global setup complete.');
  };
};
