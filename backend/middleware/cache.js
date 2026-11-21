const redis = require('redis')
const { promisify } = require('util')

let client
let isRedisReady = false

async function initRedis() {
  try {
    client = redis.createClient({
      url: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
      socket: { connectTimeout: 3000, reconnectStrategy: retries => retries < 2 ? 250 : new Error('Redis unavailable') }
    })
    client.on('error', () => { isRedisReady = false })
    client.on('ready', () => { isRedisReady = true })
    await client.connect()
    isRedisReady = true
    console.log('✅ Redis connected')
  } catch (err) {
    console.warn('⚠️ Redis not available, falling back to in-memory cache')
    isRedisReady = false
    if (client?.isOpen) await client.disconnect()
  }
}

// in-memory fallback
const memoryCache = new Map()

const crypto = require('crypto')

const cacheMiddleware = (ttl = 30) => async (req, res, next) => {
  if (process.env.NODE_ENV === 'test') {
    return next()
  }
  // include method and a short hash of body for non-GET requests to avoid collisions
  let bodyHash = ''
  try {
    if (req.body && Object.keys(req.body).length > 0) {
      const str = JSON.stringify(req.body)
      bodyHash = crypto.createHash('md5').update(str).digest('hex').slice(0, 8)
    }
  } catch (e) {
    bodyHash = ''
  }

  const key = `cache:${req.method}:${req.originalUrl}${bodyHash ? ':' + bodyHash : ''}`

  try {
    if (isRedisReady && client) {
      const cached = await client.get(key)
      if (cached) {
        res.set('X-Cache', 'HIT')
        return res.json(JSON.parse(cached))
      }

      // hijack res.json to cache
      const origJson = res.json.bind(res)
      res.json = async (body) => {
        try { await client.setEx(key, ttl, JSON.stringify(body)) } catch (e) {}
        res.set('X-Cache', 'MISS')
        return origJson(body)
      }
      return next()
    }

    // memory fallback
    if (memoryCache.has(key)) {
      const entry = memoryCache.get(key)
      if (Date.now() < entry.expire) {
        res.set('X-Cache', 'HIT')
        return res.json(entry.value)
      }
      memoryCache.delete(key)
    }

    const origJson = res.json.bind(res)
    res.json = (body) => {
      memoryCache.set(key, { value: body, expire: Date.now() + ttl * 1000 })
      res.set('X-Cache', 'MISS')
      return origJson(body)
    }
    return next()
  } catch (err) {
    return next()
  }
}

module.exports = { initRedis, cacheMiddleware }
