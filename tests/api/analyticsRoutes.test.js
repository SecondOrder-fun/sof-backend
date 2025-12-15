// tests/api/analyticsRoutes.test.js
// @vitest-environment node
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import fastify from 'fastify'

// Mock Supabase before imports
vi.mock('@/../backend/shared/supabaseClient.js', () => ({
  supabase: {},
  db: {},
}))

let app
let analyticsRoutes
let analyticsServiceModule

beforeAll(async () => {
  analyticsRoutes = (await import('@/../backend/fastify/routes/analyticsRoutes.js')).default
  analyticsServiceModule = await import('@/../backend/shared/analyticsService.js')

  app = fastify({ logger: false })
  await app.register(analyticsRoutes)
  await app.ready()
})

afterAll(async () => {
  if (app) await app.close()
})

describe('analyticsRoutes', () => {
  it('GET /strategy/:playerAddress requires address', async () => {
    const res = await app.inject({ method: 'GET', url: '/strategy/' })
    // Fastify will route mismatch; treat as 404 acceptable outcome
    expect([400, 404]).toContain(res.statusCode)
  })

  it('GET /strategy/:playerAddress returns performance', async () => {
    const mock = { roi: 1.23 }
    const spy = vi
      .spyOn(analyticsServiceModule.analyticsService, 'getStrategyPerformance')
      .mockResolvedValue(mock)

    const res = await app.inject({ method: 'GET', url: '/strategy/0xabc?timeframe=7d&limit=10' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.performance).toEqual(mock)
    spy.mockRestore()
  })

  it('GET /arbitrage/history returns history', async () => {
    const mock = [{ id: 1 }]
    const spy = vi
      .spyOn(analyticsServiceModule.analyticsService, 'getArbitrageHistory')
      .mockResolvedValue(mock)

    const res = await app.inject({ method: 'GET', url: '/arbitrage/history?limit=5' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.history).toEqual(mock)
    spy.mockRestore()
  })

  it('GET /user/:playerAddress returns analytics', async () => {
    const mock = { trades: 10 }
    const spy = vi
      .spyOn(analyticsServiceModule.analyticsService, 'getUserAnalytics')
      .mockResolvedValue(mock)

    const res = await app.inject({ method: 'GET', url: '/user/0xabc' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.analytics).toEqual(mock)
    spy.mockRestore()
  })
})
