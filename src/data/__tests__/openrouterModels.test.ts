import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchOpenRouterModels, clearOpenRouterModelCache } from '../openrouterModels'

beforeEach(() => {
  clearOpenRouterModelCache()
  vi.restoreAllMocks()
})

describe('fetchOpenRouterModels', () => {
  it('returns empty array on fetch failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network error'))
    const models = await fetchOpenRouterModels()
    expect(models).toEqual([])
  })

  it('returns empty array on non-ok response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 500 })
    )
    const models = await fetchOpenRouterModels()
    expect(models).toEqual([])
  })

  it('returns sorted model ids on success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ data: [{ id: 'openai/gpt-4' }, { id: 'anthropic/claude' }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    )
    const models = await fetchOpenRouterModels()
    expect(models).toEqual(['anthropic/claude', 'openai/gpt-4'])
  })

  it('caches successful results', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: 'model1' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    await fetchOpenRouterModels()
    await fetchOpenRouterModels()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('clearOpenRouterModelCache resets cache', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: 'model1' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    await fetchOpenRouterModels()
    clearOpenRouterModelCache()
    await fetchOpenRouterModels()
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })
})
