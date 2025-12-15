// tests/api/userRoutes.test.js
// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fastify from 'fastify'

let userRoutesPlugin

let app

beforeAll(async () => {
  const mod = await import('@/../backend/fastify/routes/userRoutes.js')
  userRoutesPlugin = mod.default || mod.userRoutes
  app = fastify({ logger: false })
  await app.register(userRoutesPlugin)
  await app.ready()
})

afterAll(async () => {
  if (app) await app.close()
})

describe('userRoutes (mocked)', () => {
  const existing = '0x1234567890123456789012345678901234567890'
  const missing = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'

  it('GET /profile/:id returns 404 for unknown user', async () => {
    const res = await app.inject({ method: 'GET', url: `/profile/${missing}` })
    expect(res.statusCode).toBe(404)
  })

  it('GET /profile/:id returns profile for known user', async () => {
    const res = await app.inject({ method: 'GET', url: `/profile/${existing}` })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.user).toBeDefined()
    expect(body.user.id).toBe(existing)
  })

  it('GET /:id/raffles validates user exists', async () => {
    const res = await app.inject({ method: 'GET', url: `/${missing}/raffles` })
    expect(res.statusCode).toBe(404)
  })

  it('GET /:id/raffles returns raffles for known user', async () => {
    const res = await app.inject({ method: 'GET', url: `/${existing}/raffles` })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(Array.isArray(body.raffles)).toBe(true)
  })

  it('GET /:id/infofi-positions validates user exists', async () => {
    const res = await app.inject({ method: 'GET', url: `/${missing}/infofi-positions` })
    expect(res.statusCode).toBe(404)
  })

  it('GET /:id/infofi-positions returns positions for known user', async () => {
    const res = await app.inject({ method: 'GET', url: `/${existing}/infofi-positions` })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(Array.isArray(body.positions)).toBe(true)
  })

  it('GET /:id/portfolio validates user exists', async () => {
    const res = await app.inject({ method: 'GET', url: `/${missing}/portfolio` })
    expect(res.statusCode).toBe(404)
  })

  it('GET /:id/portfolio returns portfolio for known user', async () => {
    const res = await app.inject({ method: 'GET', url: `/${existing}/portfolio` })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.portfolio).toBeDefined()
    expect(body.portfolio.totalValue).toBeDefined()
  })

  it('PUT /profile/:id updates profile fields for known user', async () => {
    const payload = { username: 'updated_name', bio: 'updated' }
    const res = await app.inject({ method: 'PUT', url: `/profile/${existing}`, payload })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.success).toBe(true)
    expect(body.user.username).toBe('updated_name')
    expect(body.user.bio).toBe('updated')
  })
})
