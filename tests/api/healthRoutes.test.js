// tests/api/healthRoutes.test.js
// @vitest-environment node
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import fastify from 'fastify'

// Mock Supabase client before importing route
const mockFrom = vi.fn()
const mockSelect = vi.fn()
const mockLimit = vi.fn()

vi.mock('@/../backend/shared/supabaseClient.js', () => ({
  db: {
    client: {
      from: (...args) => mockFrom(...args),
    },
  },
}))

let app
let healthRoutes

beforeAll(async () => {
  // default happy-path mocks
  mockLimit.mockResolvedValue({ data: [], error: null })
  mockSelect.mockReturnValue({ limit: mockLimit })
  mockFrom.mockReturnValue({ select: mockSelect })

  // stub global fetch for RPC probe
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    status: 200,
    async json() {
      return { result: '0x539' } // 1337
    },
  })))

  healthRoutes = (await import('@/../backend/fastify/routes/healthRoutes.js')).default
  app = fastify({ logger: false })
  await app.register(healthRoutes, { prefix: '/api' })
  await app.ready()
})

afterAll(async () => {
  if (app) await app.close()
})

beforeEach(() => {
  vi.clearAllMocks()
  // reset defaults
  mockLimit.mockResolvedValue({ data: [], error: null })
  mockSelect.mockReturnValue({ limit: mockLimit })
  mockFrom.mockReturnValue({ select: mockSelect })
  globalThis.fetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ result: '0x539' }),
  })
})

describe('healthRoutes - /api/health', () => {
  it('returns OK when Supabase and RPC are healthy', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.status).toBe('OK')
    expect(body.checks.supabase.ok).toBe(true)
    expect(body.checks.rpc.ok).toBe(true)
    expect(typeof body.timestamp).toBe('string')
  })

  it('returns DEGRADED when RPC probe fails', async () => {
    globalThis.fetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.status).toBe('DEGRADED')
    expect(body.checks.rpc.ok).toBe(false)
  })

  it('returns DEGRADED when Supabase query throws', async () => {
    mockFrom.mockImplementation(() => { throw new Error('db down') })
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.status).toBe('DEGRADED')
    expect(body.checks.supabase.ok).toBe(false)
  })
})
