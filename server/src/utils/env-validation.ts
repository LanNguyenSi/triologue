// Environment variable validation - fail fast on startup
export const validateEnvironment = () => {
  const required = [
    'JWT_SECRET',
    'DATABASE_URL',
    'ICE_TOKEN',
    'LAVA_TOKEN'
  ];

  const optional = [
    'AI_OTHER_TOKEN',
    'REDIS_URL',
    'CLIENT_URL',
    'PORT'
  ];

  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:');
    missing.forEach(key => console.error(`   - ${key}`));
    console.error('\n💡 Copy .env.example to .env and fill in the values');
    process.exit(1);
  }

  console.log('✅ Environment validation passed');
  
  // Log optional variables that are missing (warnings, not errors)
  const missingOptional = optional.filter(key => !process.env[key]);
  if (missingOptional.length > 0) {
    console.warn('⚠️  Optional environment variables not set:');
    missingOptional.forEach(key => console.warn(`   - ${key} (using default)`));
  }
};