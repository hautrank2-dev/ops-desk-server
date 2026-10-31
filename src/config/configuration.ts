export default () => ({
  port: parseInt(process.env.PORT ?? '3000', 10) || 3000,
  database: {
    host: process.env.DATABASE_HOST || 'localhost',
    port: parseInt(process.env.DATABASE_PORT ?? '3000', 10) || 3000,
  },
  cloudinary: {
    name: process.env.CLOUDINARY_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    apiSecret: process.env.CLOUDINARY_API_SECRET,
  },
  jwtSecret: process.env.JWT_SECRET,
  ai: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: process.env.AI_MODEL || 'claude-sonnet-5-5',
    fastModel: process.env.AI_FAST_MODEL || 'claude-haiku-5-5',
    hfToken: process.env.HF_TOKEN,
    // effort/maxTokens dùng từ Phase 1 (chat) và Phase 3 (suggest fix)
    effortChat: 'medium',
    effortFix: 'high',
    maxTokens: 16000,
  },
});
