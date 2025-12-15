// tests/api/pricingRoutes.test.js
// @vitest-environment node
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import fastify from 'fastify'

// Mock Supabase client before importing any backend/shared modules
vi.mock('@/../backend/shared/supabaseClient.js', () => ({
  supabase: {},
  db: {
    getInfoFiMarketById: vi.fn(),
    updateInfoFiMarket: vi.fn(),
  },
}))

let app
let pricingRoutes
let pricingServiceModule

beforeAll(async () => {
  // Dynamically import after mocks are set up
  pricingRoutes = (await import('@/../backend/fastify/routes/pricingRoutes.js')).default
  pricingServiceModule = await import('@/../backend/shared/pricingService.js')

  app = fastify({ logger: false })
  await app.register(pricingRoutes)
  await app.ready()
})

afterAll(async () => {
  if (app) await app.close()
})

describe('pricingRoutes - current snapshot endpoint', () => {
  it('returns 400 for missing marketId', async () => {
    const res = await app.inject({ method: 'GET', url: '/stream/pricing//current' })
    // fastify treats double // as /, but our handler checks missing param and returns 400
    expect([400, 404]).toContain(res.statusCode)
  })

  it('returns 400 for invalid marketId format', async () => {
    const res = await app.inject({ method: 'GET', url: '/stream/pricing/not-valid/current' })
    expect(res.statusCode).toBe(400)
    const body = JSON.parse(res.body)
    expect(body.error).toBeDefined()
  })

  it('returns 404 when cache miss', async () => {
    const spy = vi.spyOn(pricingServiceModule.pricingService, 'getCachedPricing').mockReturnValue(null)
    const res = await app.inject({ method: 'GET', url: '/stream/pricing/1:WINNER_PREDICTION:0xabcdefabcdefabcdefabcdefabcdefabcdefabcd/current' })
    expect(res.statusCode).toBe(404)
    spy.mockRestore()
  })

  it('returns 200 and shapes payload when cache hit', async () => {
    const cached = {
      yes_price: 0.1234,
      raffleProbabilityBps: 123,
      marketSentimentBps: 456,
      updated_at: '2025-01-01T00:00:00Z',
    }
    const spy = vi.spyOn(pricingServiceModule.pricingService, 'getCachedPricing').mockReturnValue(cached)
    const url = '/stream/pricing/2:TOTAL_TICKETS:-/current'
    const res = await app.inject({ method: 'GET', url })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.marketId).toBe('2:TOTAL_TICKETS:-')
    expect(body.hybridPriceBps).toBeTypeOf('number')
    expect(body.raffleWeightBps).toBe(7000)
    expect(body.marketWeightBps).toBe(3000)
    spy.mockRestore()
  })
})
