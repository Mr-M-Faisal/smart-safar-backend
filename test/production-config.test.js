const { test } = require('node:test');
const assert = require('node:assert/strict');
const validateProductionConfiguration = require('../src/config/validateProductionConfiguration');

const safeProductionConfig = {
  NODE_ENV: 'production',
  JWT_SECRET: 'a-production-secret-that-is-at-least-32-characters',
  MONGO_URI: 'mongodb+srv://user:password@example.invalid/app',
  CORS_ORIGIN: 'https://app.example.com,https://www.example.com',
  ALLOW_LOCAL_TEST_LOGIN: 'false',
};

test('production configuration accepts explicit secure values', () => {
  assert.doesNotThrow(() => validateProductionConfiguration(safeProductionConfig));
});

test('production configuration reports every unsafe required value', () => {
  assert.throws(() => validateProductionConfiguration({
    NODE_ENV: 'production', JWT_SECRET: 'short', MONGO_URI: '', CORS_ORIGIN: '*', ALLOW_LOCAL_TEST_LOGIN: 'true',
  }), /JWT_SECRET.*MONGO_URI.*CORS_ORIGIN.*ALLOW_LOCAL_TEST_LOGIN/s);
});

test('development configuration is not subject to production checks', () => {
  assert.doesNotThrow(() => validateProductionConfiguration({ NODE_ENV: 'development' }));
});
