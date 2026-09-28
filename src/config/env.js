const dotenv = require('dotenv');

dotenv.config();

const clientUrls = (process.env.CLIENT_URL || 'http://localhost:3000')
  .split(',')
  .map((url) => url.trim())
  .filter(Boolean);

// Central place for all environment variables
const config = {
  port: process.env.PORT || 5000,
  nodeEnv: process.env.NODE_ENV || 'development',
  mongoUri: process.env.MONGO_URI,
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET,
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    accessExpires: process.env.JWT_ACCESS_EXPIRES || '15m',
    refreshExpires: process.env.JWT_REFRESH_EXPIRES || '7d',
  },
  clientUrl: clientUrls[0],
  clientUrls,
  timezone: process.env.TIMEZONE || 'UTC',
  demoMode: process.env.DEMO_MODE === 'true',
  demo: {
    centerLat: Number(process.env.DEMO_CENTER_LAT || 31.5204),
    centerLng: Number(process.env.DEMO_CENTER_LNG || 74.3587),
    password: process.env.SEED_PASSWORD || 'Demo@12345',
  },
  ai: {
    // gemini | anthropic | none
    provider: (process.env.AI_PROVIDER || 'none').toLowerCase(),
    gemini: {
      apiKey: process.env.GEMINI_API_KEY || '',
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    },
    anthropic: {
      apiKey: process.env.ANTHROPIC_API_KEY || '',
      model: process.env.AI_MODEL || 'claude-haiku-4-5-20251001',
    },
  },
};

// Fail fast if critical variables are missing
if (!config.mongoUri) {
  throw new Error('MONGO_URI is not defined in .env');
}
if (!config.jwt.accessSecret || !config.jwt.refreshSecret) {
  throw new Error('JWT secrets are not defined in .env');
}

module.exports = config;