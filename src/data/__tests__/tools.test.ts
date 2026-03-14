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
  it('returns correct subset for given tool ids (use_skill always included)', () => {
    const result = filterToolSchemas(['read', 'glob'])
    const names = result.map((t) => t.name)
    expect(names).toContain('read_file')
    expect(names).toContain('glob')
    expect(names).toContain('use_skill')
  })

  it('returns only use_skill for empty input', () => {
    const result = filterToolSchemas([])
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('use_skill')
  })

  it('ignores unknown tool ids (use_skill still included)', () => {
    const result = filterToolSchemas(['read', 'nonexistent'])
    expect(result).toHaveLength(2)
    expect(result[0].name).toBe('read_file')
    expect(result[1].name).toBe('use_skill')
  })

  it('returns all schemas when all ids provided', () => {
    const result = filterToolSchemas(['read', 'write', 'edit', 'glob', 'grep', 'bash', 'use_skill'])
    expect(result).toHaveLength(7)
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
