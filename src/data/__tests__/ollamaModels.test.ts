import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchOllamaModels, clearOllamaModelCache } from '../ollamaModels'

beforeEach(() => {
  clearOllamaModelCache()
  vi.restoreAllMocks()
})

describe('fetchOllamaModels', () => {
  it('returns empty array on fetch failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network error'))
    const models = await fetchOllamaModels()
    expect(models).toEqual([])
  })

  it('returns empty array on non-ok response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 500 })
    )
    const models = await fetchOllamaModels()
    expect(models).toEqual([])
  })

  it('returns sorted model names on success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ models: [{ name: 'zeta' }, { name: 'alpha' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    const models = await fetchOllamaModels()
    expect(models).toEqual(['alpha', 'zeta'])
  })

  it('caches successful results', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ models: [{ name: 'model1' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    await fetchOllamaModels()
    await fetchOllamaModels()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('clearOllamaModelCache resets cache', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ models: [{ name: 'model1' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    await fetchOllamaModels()
    clearOllamaModelCache()
    await fetchOllamaModels()
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })
})
