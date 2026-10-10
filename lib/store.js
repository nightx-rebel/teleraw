const { Redis } = require('@upstash/redis');

// Manual setup uses UPSTASH_REDIS_REST_*; the Vercel Marketplace integration uses KV_REST_API_*
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN,
});

module.exports = { redis };
