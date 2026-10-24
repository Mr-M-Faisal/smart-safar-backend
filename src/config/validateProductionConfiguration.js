function validateProductionConfiguration(env = process.env) {
  if (env.NODE_ENV !== 'production') return;
  const failures = [];
  if ((env.JWT_SECRET || '').trim().length < 32) failures.push('JWT_SECRET must contain at least 32 characters.');
  if (!env.MONGO_URI?.trim()) failures.push('MONGO_URI is required.');
  const origins = (env.CORS_ORIGIN || '').split(',').map((value) => value.trim()).filter(Boolean);
  if (!origins.length || origins.includes('*')) failures.push('CORS_ORIGIN must contain one or more explicit frontend origins and cannot be *.');
  if (String(env.ALLOW_LOCAL_TEST_LOGIN || '').toLowerCase() === 'true') failures.push('ALLOW_LOCAL_TEST_LOGIN must be false in production.');
  if (failures.length) throw new Error(`Unsafe production configuration:\n- ${failures.join('\n- ')}`);
}

module.exports = validateProductionConfiguration;
