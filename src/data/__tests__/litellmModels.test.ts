import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchLitellmModels, clearLitellmModelCache } from '../litellmModels'

// Mock the getApiKey dependency
vi.mock('../../components/UserSettings', () => ({
  getApiKey: () => '',
}))

beforeEach(() => {
  clearLitellmModelCache()
  vi.restoreAllMocks()
})

describe('fetchLitellmModels', () => {
  it('returns empty array on fetch failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network error'))
    const models = await fetchLitellmModels()
    expect(models).toEqual([])
  })

  it('returns empty array on non-ok response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 500 })
    )
    const models = await fetchLitellmModels()
    expect(models).toEqual([])
  })

  it('returns sorted model ids on success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ data: [{ id: 'gpt-4' }, { id: 'claude-3' }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    )
    const models = await fetchLitellmModels()
    expect(models).toEqual(['claude-3', 'gpt-4'])
  })

  it('caches successful results', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: 'model1' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    await fetchLitellmModels()
    await fetchLitellmModels()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('clearLitellmModelCache resets cache', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: 'model1' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    await fetchLitellmModels()
    clearLitellmModelCache()
    await fetchLitellmModels()
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })
})
