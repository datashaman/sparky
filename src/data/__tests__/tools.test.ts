import { describe, it, expect } from 'vitest'
import { filterToolSchemas, TOOL_SCHEMAS, createToolCallHandler } from '../tools'

describe('TOOL_SCHEMAS', () => {
  it('has expected tool names', () => {
    const names = TOOL_SCHEMAS.map((t) => t.name)
    expect(names).toContain('read_file')
    expect(names).toContain('write_file')
    expect(names).toContain('edit_file')
    expect(names).toContain('glob')
    expect(names).toContain('grep')
    expect(names).toContain('bash')
    expect(names).toContain('use_skill')
    expect(names).toContain('ask_user')
  })

  it('each schema has name, description, and parameters', () => {
    for (const schema of TOOL_SCHEMAS) {
      expect(schema.name).toBeTruthy()
      expect(schema.description).toBeTruthy()
      expect(schema.parameters).toBeDefined()
    }
  })
})

describe('filterToolSchemas', () => {
  it('returns correct subset plus always-on tools', () => {
    const result = filterToolSchemas(['read', 'glob'])
    const names = result.map((t) => t.name)
    expect(names).toContain('read_file')
    expect(names).toContain('glob')
    expect(names).toContain('use_skill')
    expect(names).toContain('ask_user')
  })

  it('returns only always-on tools for empty input', () => {
    const result = filterToolSchemas([])
    expect(result).toHaveLength(2)
    const names = result.map((t) => t.name)
    expect(names).toContain('use_skill')
    expect(names).toContain('ask_user')
  })

  it('ignores unknown tool ids (always-on tools still included)', () => {
    const result = filterToolSchemas(['read', 'nonexistent'])
    expect(result).toHaveLength(3)
    const names = result.map((t) => t.name)
    expect(names).toContain('read_file')
    expect(names).toContain('use_skill')
    expect(names).toContain('ask_user')
  })

  it('returns all schemas when all ids provided', () => {
    const result = filterToolSchemas(['read', 'write', 'edit', 'glob', 'grep', 'bash', 'use_skill', 'ask_user'])
    expect(result).toHaveLength(8)
  })
})

describe('createToolCallHandler', () => {
  it('returns a function', () => {
    const handler = createToolCallHandler('/tmp/test')
    expect(typeof handler).toBe('function')
  })

  it('handler returns error for unknown tool', async () => {
    const handler = createToolCallHandler('/tmp/test')
    const result = await handler('unknown_tool', {})
    expect(result).toBe('Unknown tool: unknown_tool')
  })
})
