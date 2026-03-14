# Agents and Skills

Sparky uses **skills** and **agents** to bring focused knowledge and specialized behavior into the issue-resolution pipeline. This document explains what each concept is, how they relate to the broader system, and how to create and configure them.

## Skills

A skill is a reusable body of knowledge written in markdown. When a plan step references a skill, its content is injected into the LLM's context so the model has the right domain knowledge at hand.

Skills are scoped to a workspace. Each skill has:

| Field | Description |
|---|---|
| **name** | Slug-format identifier (e.g. `react-best-practices`) |
| **description** | Short summary of what the skill covers |
| **content** | The markdown knowledge payload — coding guidelines, API references, conventions, etc. |
| **provider / model** | Optional overrides for the LLM provider and model used when this skill is active |

### Example

A skill named `react-best-practices` might contain component-naming conventions, hook usage rules, and performance guidelines. Any plan step that references this skill will have those guidelines available in context.

## Agents

An agent is a specialized AI worker with its own system prompt, model configuration, and restricted tool access. Agents can be assigned to specific plan steps so that focused expertise is brought to bear on tasks that benefit from it.

Each agent has:

| Field | Description |
|---|---|
| **name** | Slug-format identifier |
| **description** | Short summary of the agent's role |
| **content** | The system prompt that defines agent behavior |
| **provider / model** | Which LLM provider and model the agent uses (can differ from workspace defaults) |
| **max_turns** | Maximum number of tool-use turns (default 25) |
| **background** | Boolean flag — when true, the agent runs without direct user interaction |
| **skills** | Associated skills loaded into the agent's context (via `agent_skills`) |
| **tools** | Controls what the agent can do (via `agent_tools`) |

By default, agents have **read-only** tool access: `read`, `glob`, and `grep`. Granting `write`, `edit`, or `bash` gives the agent the ability to modify the codebase, so do so deliberately.

## How They Fit in the Pipeline

1. **Analysis** — The issue analysis step recommends skills and agents based on the issue content.
2. **Review and creation** — You review the recommendations and create the ones you want (or create custom ones from scratch).
3. **Planning** — The plan generator references skills and agents by name in individual plan steps.
4. **Execution** — For each step, the system loads the assigned agent's system prompt, injects the referenced skills into context, and restricts the available tools to the agent's configured set.

### The Issue LLM vs Agents

The "issue LLM" is the main controller. It handles most plan steps directly using the workspace's default provider and model. Agents are optional specialists — they are only invoked when a step explicitly names one.

Most steps should have `agent_name: null`, meaning the issue LLM handles them. Only delegate to an agent when specialization adds clear value (e.g. a dedicated security-review agent, or a test-writing agent with its own conventions).

## Creating Skills

1. Go to the **Skills** tab in the workspace sidebar.
2. Click **New Skill**.
3. Enter a **name** in lowercase-slug format (e.g. `django-models`).
4. Add a short **description**.
5. Write the skill **content** in markdown. This is the knowledge that gets injected into the LLM context, so make it practical and specific.
6. Save.

### Tips for writing good skills

- Focus on actionable, project-specific knowledge — not generic advice the model already knows.
- Include concrete examples: code patterns, naming conventions, file-structure expectations.
- Keep skills reasonably scoped. A single skill covering everything about your stack is harder to maintain and noisier in context than several focused skills.

## Creating Agents

1. Go to the **Agents** tab in the workspace sidebar.
2. Click **New Agent**.
3. Enter a **name** (slug format) and **description**.
4. Write the **system prompt** in the content field. This defines the agent's behavior, role, constraints, and expected output format.
5. Select a **provider** and **model**. Agents can use a different model from the workspace default — use a stronger model for reasoning-heavy agents and a faster model for straightforward tasks.
6. Set **max turns** (default 25). Lower this for simple, bounded tasks.
7. **Assign skills** — any skills the agent should have loaded into its context.
8. **Assign tools** — controls what the agent can do. Start with the read-only defaults and only add write/edit/bash when the agent genuinely needs them.
9. Save.

## Best Practices

- **Skill content should be specific.** Generic knowledge ("write clean code") wastes context. Project-specific conventions and patterns are where skills add the most value.
- **Agent system prompts should be precise.** Specify the agent's role, the constraints it should operate under, and the format of its output. Vague prompts produce vague results.
- **Grant only the tools an agent needs.** Read-only is the safe default. Only add write, edit, or bash access when the agent's job requires modifying files or running commands.
- **Use `background=true`** for agents that run without direct user interaction — typically agents handling automated or batch tasks.
- **Keep max_turns reasonable.** The default of 25 is fine for most tasks. Lower it for simple, focused work to avoid unnecessary loops. Raise it only for genuinely complex multi-step tasks.
- **Most steps don't need an agent.** The issue LLM handles the majority of work. Reserve agents for steps where focused expertise or different model capabilities provide a clear benefit.
