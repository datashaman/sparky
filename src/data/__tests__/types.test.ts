import { describe, it, expect } from 'vitest'
import type { ExecutionPlanResult, CriticReview, LLMToolDef } from '../types'

describe('types (compile-time shape validation)', () => {
  it('ExecutionPlanResult has correct shape', () => {
    const plan: ExecutionPlanResult = {
      goal: 'Implement feature',
      steps: [
        {
          order: 1,
          title: 'Step 1',
          description: 'Do something',
          agent_name: null,
          skill_names: [],
          expected_output: 'output',
          depends_on: [],
        },
      ],
      success_criteria: 'Tests pass',
    }
    expect(plan.goal).toBe('Implement feature')
    expect(plan.steps).toHaveLength(1)
    expect(plan.success_criteria).toBe('Tests pass')
  })

  it('ExecutionPlanResult accepts optional critic_review', () => {
    const review: CriticReview = {
      verdict: 'pass',
      issues: [],
      summary: 'Looks good',
    }
    const plan: ExecutionPlanResult = {
      goal: 'Test',
      steps: [],
      success_criteria: 'Pass',
      critic_review: review,
    }
    expect(plan.critic_review?.verdict).toBe('pass')
  })

  it('LLMToolDef has correct shape', () => {
    const tool: LLMToolDef = {
      name: 'test_tool',
      description: 'A test tool',
      parameters: { type: 'object', properties: {} },
    }
    expect(tool.name).toBe('test_tool')
  })
})
