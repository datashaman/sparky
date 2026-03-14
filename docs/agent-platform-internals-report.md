# Reverse-Engineering the Agent Stack: What We Learned from Dissecting 15+ AI Agent Platforms

*An industry research report — March 2026*

---

## Executive Summary

We reverse-engineered, analyzed, and documented the internals of 15+ major AI agent platforms across six categories: OpenAI (ChatGPT, Operator, Deep Research), Google (Gemini, Project Mariner), Anthropic (Claude Code, Computer Use), Microsoft (Copilot, AutoGen), coding-focused agents (Cursor, Windsurf, Aider, Cline, Devin, Augment), and open-source frameworks (AutoGPT, CrewAI, LangGraph).

This report synthesizes publicly archived system prompts, reverse-engineered architectures, tool schemas, and operational patterns found across these platforms into actionable findings for anyone building AI agent systems.

**Key findings:**
- Every major platform uses multi-model architectures — cheaper models for validation, expensive models for reasoning
- The orchestration loop is converging on a minimal `while(tool_call)` pattern with ~50 lines of code
- Content-based edit matching (search/replace) has won over line-number-based diffs universally
- Aggressive checkpointing (every 3 actions) reduced complete failures by roughly half in [reported evaluations](https://openai.com/index/operator-system-card/)
- Dual-channel output (hidden reasoning + visible narration) is emerging as the standard UX pattern
- Independent monitor models for safety have [reported recall rates up to 99%](https://openai.com/index/operator-system-card/) on prompt injection detection benchmarks

---

## Table of Contents

1. [System Prompt Architecture](#1-system-prompt-architecture)
2. [Tool Design Patterns](#2-tool-design-patterns)
3. [Orchestration Loops](#3-orchestration-loops)
4. [Memory Systems](#4-memory-systems)
5. [Multi-Agent Coordination](#5-multi-agent-coordination)
6. [Browser & Computer Use Agents](#6-browser--computer-use-agents)
7. [Code Editing Strategies](#7-code-editing-strategies)
8. [Safety & Security Patterns](#8-safety--security-patterns)
9. [Error Handling & Recovery](#9-error-handling--recovery)
10. [Cross-Platform Comparison](#10-cross-platform-comparison)
11. [Actionable Recommendations](#11-actionable-recommendations)
12. [Sources](#12-sources)

---

## 1. System Prompt Architecture

### The Shift from Static to Dynamic Prompts

No major platform uses a single static system prompt anymore. The trend is toward dynamic, multi-layered prompt assembly:

**Claude Code** assembles **110+ string fragments** into a composite prompt based on environment, configuration, active tools, and session state. The final prompt routinely exceeds 24,000 tokens. Sections are conditionally included based on active features.

**GitHub Copilot** uses a **3-layer architecture**:
- Layer 1: Universal system rules (identity, policy, workflow)
- Layer 2: Environment context (OS, workspace, file paths)
- Layer 3: User request + metadata + autonomy reminder

**GPT-5** introduced a **channel system** separating hidden reasoning from visible output:
- `analysis` channel: Hidden planning, scratch work, Python execution
- `commentary` channel: Visible narration of what the agent is doing
- `final` channel: The completed response

**Gemini 2.5 Pro** uses three processing block types: `thought` (hidden reasoning), `python` (sandboxed execution), and `tool_code` (API calls). Additionally, it separates "chat mode" (brief exchanges) from "canvas/immersive mode" (content-rich structured outputs).

### Priority Layering

Claude Code loads context in priority order:
1. Organization policies (enterprise overrides)
2. Project rules (repository-level instructions)
3. User preferences (personal config)
4. Auto-learned patterns (agent memory)
5. Skill instructions (activated domain skills)
6. Contextual state (git status, directory snapshot)

This pattern — where organizational constraints override personal preferences, which override dynamic context — appears across all enterprise-facing platforms.

### Behavioral Steering Techniques

Rather than fine-tuning, platforms steer behavior through prompt engineering:

- **Typographic emphasis**: Claude Code uses ALL CAPS, "VERY IMPORTANT", "CRITICAL", "NEVER" for high-priority instructions
- **XML semantic tags**: `<system-reminder>`, `<good-example>`, `<bad-example>` create machine-parseable sections
- **Versioned personality configs**: ChatGPT uses `Personality: v2` tags, enabling A/B testing and rollback
- **Explicit workflow steps**: GitHub Copilot defines an 8-step agentic workflow (understand → investigate → plan → implement → debug → test → iterate → verify)
- **Autonomy reminders**: "You are an agent — you must keep going until the user's query is completely resolved" (GitHub Copilot)

### Prompt Boundary Vulnerabilities

- **Gemini**: When the verbatim system prompt appeared in the token stream during extraction, it caused a feedback loop — Gemini interpreted it as a new query, revealing fragile prompt boundary detection
- **Copilot**: System prompt extracted via Caesar cipher encoding (asking the model to output shifted by one letter) and Arabic-to-Latin transliteration
- **GPT-5**: Context poisoning vulnerability where the backend accepted unvalidated `role: "system"` messages from the client

**Universal lesson**: Assume prompt protection will be bypassed. Design systems that are safe even with full prompt disclosure. Never put secrets in system prompts.

---

## 2. Tool Design Patterns

### Primitive Composability Over Specialization

The most effective platforms provide a small set of composable primitives rather than dozens of task-specific tools:

**Claude Code's core toolkit** (covering nearly all developer workflows):
| Tool | Purpose |
|------|---------|
| Bash | Universal shell adapter |
| Read/Edit/Write | File operations |
| Glob/Grep | File and content search |
| Task/Agent | Sub-agent spawning |

**Cursor's 10 tools**:
`codebase_search`, `read_file`, `run_terminal_cmd`, `list_dir`, `grep_search`, `edit_file`, `file_search`, `delete_file`, `reapply`, `parallel_apply`

Both platforms demonstrate that a dozen well-designed primitives compose to cover virtually any workflow. The model handles the composition logic.

### Tool Schema Formats

Platforms use different schema formats, each with trade-offs:

| Platform | Format | Example |
|----------|--------|---------|
| OpenAI | TypeScript-like namespace declarations | `namespace canmore { type create_textdoc = ... }` |
| Gemini | OpenAPI-compatible JSON Schema | Standard `FunctionDeclaration` objects |
| Claude | XML-style tool definitions | Tool descriptions in system prompt |
| Cline | XML tool definitions in prompt | Includes when/how guidance |
| AutoGen | Python type hints + decorators | `@message_handler` routing |

**Important finding**: Gemini 2.5 Pro throws 500 errors on deeply nested parameter schemas. Keep schemas shallow — complex nested objects should be serialized to strings or split across simpler tools.

### Tool Discovery and Selection

**Gemini's `extensions` meta-tool** discovers other tools by name or function — a pattern that scales to large tool catalogs without loading all schemas into context.

**M365 Copilot** uses hierarchical skill matching with a **5-function candidate limit** across four matching stages:
1. Lexical match on function name
2. Semantic match on function description
3. Lexical match on action name (adds all action functions)
4. Semantic match on action name (adds all action functions)

The orchestrator selects up to 5 candidate functions from the combined results of these stages.

**Augment Code** made the counterintuitive decision to **remove grep entirely**, forcing the agent to use their semantic search engine. Their finding: "A weaker model with great context can outperform a stronger model with poor context." Curating the toolset guides agent behavior more effectively than instructions.

### Forcing Chain-of-Thought

Cursor requires an `explanation` parameter on every tool call, forcing the model to articulate reasoning before acting. AutoGPT enforces a structured JSON response with explicit `reasoning`, `plan`, and `criticism` fields. Both techniques measurably improve tool selection accuracy.

### Description-Driven Selection

Google's Agent Development Kit (ADK) selects tools based on **docstrings** — making tool descriptions load-bearing infrastructure, not documentation. This means tool descriptions should include parameter constraints, expected outputs, and when NOT to use the tool.

---

## 3. Orchestration Loops

### The Minimal Loop Pattern

The most effective orchestration pattern is remarkably simple — approximately 50 lines of code:

```
while response.stop_reason == "tool_use":
    for tool_call in response.tool_use_blocks:
        result = execute_tool(tool_call)
        append_tool_result(result)
    response = call_model(messages)
```

Claude Code, GitHub Copilot Agent Mode, and Operator all converge on this pattern. The runtime is deliberately "dumb"; all intelligence resides in the model and system prompt. Key properties:

- Single-threaded main loop with one flat message list
- Model-driven stopping (responds with text when done, not tool calls)
- `maxTurns` cap prevents runaway loops
- Permission checks happen inside `execute_tool()`

### Multi-Model Architectures

Every major platform uses multiple models for different purposes:

| Platform | Primary Model | Secondary Model(s) |
|----------|--------------|-------------------|
| ChatGPT | GPT-5 (reasoning) | Summarization model (chat history compression) |
| Operator | CUA model (actions) | Monitor model (safety, independently updatable) |
| Deep Research | o3 (reasoning) | o3-mini (chain-of-thought summarization) |
| Claude Code | Opus/Sonnet (reasoning) | Haiku (bash security validation) |
| Cursor | Frontier model (planning) | Fine-tuned Llama-3-70B (applying edits) |
| CrewAI | Primary LLM (reasoning) | Separate `function_calling_llm` (tool selection) |

The pattern is consistent: use the most capable model for reasoning, and cheaper/faster models for validation, summarization, and mechanical tasks.

### Continuous Reasoning Loops

M365 Copilot uses a continuous reasoning loop where the LLM is consulted repeatedly until it decides to generate a final response — rather than a fixed pipeline. This allows the agent to determine when it has gathered sufficient information, adapting to task complexity dynamically.

### Sub-Agent Isolation

Claude Code delegates specialized tasks to focused sub-agents that operate with:
- Clean, isolated context windows (preventing pollution of the main conversation)
- Limited tool whitelists (read-only tools for exploration, full tools for implementation)
- Independent `maxTurns` limits
- Condensed summary returns (typically 1,000-2,000 tokens)

This pattern enables parallel work and prevents context exhaustion on complex tasks.

---

## 4. Memory Systems

### The Six-Layer Model (ChatGPT)

ChatGPT's context window is populated with six distinct memory sections:

1. **Model Set Context** — User-managed memories via the `bio` tool. Timestamped. Highest precedence.
2. **Assistant Response Preferences** — Auto-inferred communication preferences with confidence scoring (~15 entries).
3. **Notable Past Conversation Topics** — Aggregated summaries of 8+ historical conversations.
4. **Helpful User Insights** — 12-14 data points: identity, profession, expertise, location.
5. **Recent Conversation Content** — ~40 recent chats. **User messages included, assistant responses excluded** (~50% token savings).
6. **User Interaction Metadata** — 12-17 telemetry points including intent-tag classifications.

### CrewAI's Four-Layer Architecture

The most sophisticated memory system in the open-source space:

| Layer | Backend | Purpose |
|-------|---------|---------|
| Short-term | ChromaDB + RAG | Current session context |
| Long-term | SQLite3 | Cross-session task outcomes ("what worked last time") |
| Entity | RAG | People, places, concepts encountered |
| Contextual | Integrated | Unified short+long-term view |

Uses **adaptive-depth recall**: composite scoring blending semantic similarity, recency, and importance — more sophisticated than pure similarity search.

### Persistent Agent Memory

Several platforms implement persistent memory that survives across sessions:

- **Claude Code**: Markdown files (`CLAUDE.md`, `MEMORY.md`) at organization, project, and user levels
- **Windsurf**: Structured memory entries with unique ID, title, content, corpus names, and tags
- **Devin**: Dedicated knowledge management system where feedback and common mistakes are codified
- **ChatGPT**: The `bio` tool writes timestamped entries to `model_set_context`

### Token-Efficient History Compression

ChatGPT's approach of keeping user messages but dropping assistant responses from history is a simple but effective optimization — roughly halving history token usage with minimal quality loss. The assistant's prior responses are usually less important than what the user actually asked.

---

## 5. Multi-Agent Coordination

### Google's Eight Design Patterns

Published via Google Cloud Architecture Center:

1. **Sequential Pipeline** — Linear chain, A→B→C
2. **Coordinator/Dispatcher** — Central router to specialists
3. **Parallel Fan-Out/Gather** — Spawn parallel agents, synthesizer aggregates
4. **Hierarchical Decomposition** — High-level agents delegate subtasks
5. **Generator and Critic** — Separate creation from validation
6. **Iterative Refinement** — Generator + critic + refiner loop until quality threshold
7. **Human-in-the-Loop** — Approval gates for consequential actions
8. **Composite** — Mix and match any patterns above

**Key finding**: The optimal coordination strategy is task-dependent. Financial reasoning benefits from centralized orchestration; web navigation performs better with decentralized strategies. Google's framework predicted optimal strategy with 87% accuracy.

### AutoGen's Swarm Pattern

The most influential multi-agent pattern — handoff-via-tool-call:

- **Decentralized**: No central orchestrator; each agent makes local decisions
- **Shared context**: All agents see full conversation history
- **Handoff as tool calls**: Delegation is just another function the model can call
- **Composable termination**: `TextMentionTermination("TERMINATE") | HandoffTermination(target="user")`

```python
def transfer_to_sales_agent() -> str:
    return sales_agent_topic_type
```

**Critical warning**: Parallel tool calls can cause multiple simultaneous handoffs → race conditions. Fix: `parallel_tool_calls=False`.

### CrewAI's Deterministic Backbone + Autonomous Steps

The recommended production pattern: a deterministic **Flow** dictates core logic, with individual steps leveraging different levels of autonomy — from a simple LLM call, to a single agent, to a full Crew. This gives predictability where needed and autonomy where it adds value.

### LangGraph's State Machine

LangGraph models workflows as directed graphs with:
- **Typed state** flowing through the graph (single source of truth)
- **Per-key reducers** specifying how state updates merge (overwrite, append, custom)
- **Conditional edges** routing based on state inspection
- **Send primitive** for dynamic fan-out (map-reduce patterns)
- **interrupt()** for first-class human-in-the-loop

Every super-step is checkpointed, enabling resume-from-failure and time-travel debugging.

---

## 6. Browser & Computer Use Agents

### Three Architectural Approaches

| Platform | Perception Method | Key Differentiator |
|----------|------------------|-------------------|
| OpenAI Operator | Screenshots only | Dual browser (visual + text) |
| Anthropic Computer Use | Screenshots only | Versioned action vocabulary |
| Google Project Mariner | **Screenshots + DOM** | Hybrid perception |

### Project Mariner: Hybrid DOM+Pixel Processing

Mariner simultaneously analyzes the **visible layout** (pixels) and the **underlying DOM** (code structure). This is architecturally superior to pure-screenshot approaches:

- Screenshots miss: accessibility attributes, hidden state, structural semantics
- DOM alone misses: visual layout, overlapping elements, rendered appearance
- Hybrid provides: robustness against visual ambiguity + structural awareness

### Operator: Dual-Browser Mode Switching

Operator maintains two specialized browsers:
- **Visual Browser**: For GUI interactions (forms, dynamic content). 91% form success but 2-3s delays on JS-heavy sites.
- **Text Browser**: For text extraction. 3x faster, 95% reliability, sub-second extraction.

Dynamic switching yields a **28% improvement** in overall completion rates.

### Operator: Performance Data (15,000+ tasks)

| Failure Type | Frequency | Best Mitigation |
|-------------|-----------|-----------------|
| Browser timeouts | 31% | 5-second post-navigation delays (67% reduction) |
| Authentication | 24% | Pre-authenticate at task start |
| JS rendering | 19% | Wait for DOM elements (61%→88% success) |
| Infrastructure | 12% | Exponential backoff (73% resolution) |

Default success rate: ~12.5%. With optimized checkpointing (**every 3 actions instead of 10**), error handling, and mode switching: **~80%**.

### Computer Use Action Vocabularies

Anthropic versions its action vocabulary:

| Version | Actions |
|---------|---------|
| `computer_20241022` | screenshot, left_click, type, key, mouse_move |
| `computer_20250124` | + scroll, drag, right/middle/double/triple_click, hold_key, wait |
| `computer_20251124` | + zoom (region inspection at full resolution) |

OpenAI batches actions — multiple actions per `computer_call`, executed sequentially before a new screenshot.

### Verification Pattern

All platforms converge on: **always capture a screenshot after every action and verify the result before proceeding**. Never assume an action succeeded. Anthropic's recommended prompt: "After each step, take a screenshot and carefully evaluate if you have achieved the right outcome."

---

## 7. Code Editing Strategies

### Universal Convergence: Content-Based Matching

Every successful coding agent has converged on **content-based matching over line-number-based diffs**:

| Platform | Primary Format | Speed Strategy |
|----------|---------------|----------------|
| Cursor | Full-file rewrite via custom model | Speculative edits (13x speedup) |
| Aider | Search/Replace blocks or Unified Diff | Layered fuzzy matching |
| Cline | Search/Replace blocks (Aider lineage) | XML tool calls |
| RooCode | Search/Replace + middle-out fuzzy | Levenshtein + indent preservation |
| Claude Code | Exact string match with re-read on failure | Edit-as-gather pattern |

### Cursor's Two-Stage Architecture (Most Novel)

1. **Stage 1 (Planning)**: Frontier model generates "sketches" — high-level edit intent
2. **Stage 2 (Applying)**: Fine-tuned Llama-3-70B translates sketches to full-file rewrites at ~1000 tokens/second

The speed breakthrough: **speculative edits** — since most output is identical to input, a deterministic algorithm speculates "draft tokens" for unchanged portions → 13x speedup over vanilla inference.

Cursor chose full-file rewrites over diffs for files <400 lines because LLMs struggle with diff formats (line numbers predicted too early, diffs underrepresented in training data).

### Aider's Repository Map (Most Token-Efficient)

Structural index via **tree-sitter AST parsing** extracting function signatures, class hierarchies, and import relationships. Optimized with **graph ranking** (PageRank-like):

- **98% reduction in token usage** vs full-codebase inclusion
- Default budget: 1,024 tokens
- A 1K-token structural map often outperforms sending 50K tokens of raw code

### Cursor's Codebase Indexing Pipeline

1. **AST-based chunking** (tree-sitter, not naive line splitting)
2. **Merkle tree** change detection (hash comparisons every 10 minutes)
3. **Embedding generation** server-side
4. **Turbopuffer** vector DB (embeddings + metadata, never raw source)
5. **Privacy-preserving retrieval** (file paths obfuscated client-side)

### Claude Code's Edit-as-Gather Pattern

Requiring exact string matching for edits transforms edit failures into automatic information-gathering triggers. When an edit fails (stale context), the model must re-read the file — creating a self-correcting loop without explicit error handling code.

### Layered Match Fallback

Aider implements progressive matching: exact match → stripped line endings → all whitespace trimmed. This robustness against formatting differences is essential for real-world codebases.

---

## 8. Safety & Security Patterns

### Multi-Model Safety

**Operator's Dual-Model Architecture**:
- Primary CUA model trained to identify and ignore prompt injections
- Independent monitor model watching for suspicious content
- Monitor achieved **99% recall, 90% precision** on prompt injection eval
- Monitor is **independently updatable** — improved from 79% to 99% recall in a single day

**Claude Code's Bash Security Pipeline**:
Every bash command triggers two separate LLM calls using a cheaper model (Haiku):
1. Command prefix detection (classifies type, flags injection patterns)
2. File path extraction (determines which files will be modified)

### Permission Models

**Claude Code's Six Tiers**:
| Mode | Behavior |
|------|----------|
| plan | Read-only |
| default | Ask before edits and shell |
| acceptEdits | Auto-approve writes; ask for shell |
| dontAsk | Auto-approve whitelisted tools |
| bypassPermissions | Skip all checks |

Uses glob patterns for tool-level granularity. Static analysis validates every tool call.

### Lifecycle Hooks

Claude Code fires deterministic hooks at defined injection points — **outside the LLM loop, at zero AI token cost**:
- `PreToolUse` / `PostToolUse` for validation and observability
- `PermissionRequest` for auto-approve/deny logic
- `PreCompact` for context injection before summarization

### Prompt Injection Defense

| Platform | Approach |
|----------|----------|
| Operator | Dedicated monitor model (99% recall) |
| Claude Computer Use | Screenshot classifier for injection detection |
| M365 Copilot | Pre-indexed web search (prevents exfiltration via crafted content) |
| Operator | Hard-coded pause for financial transactions |

### M365 Copilot Safety Stack
- Input filtering for prompt injection and jailbreaking
- Runtime guardrails analyzing every tool call
- Output filtering for harmful content
- Real-time tool poisoning detection
- Sensitivity label propagation (document permissions carry through)
- Full audit logging

### Universal Lessons

1. **Assume prompt protection will be bypassed** (Caesar cipher, language switching, encoding tricks)
2. **Never put secrets in system prompts**
3. **Hard-code human-in-the-loop gates** for irreversible actions (financial, deletion, external communication)
4. **Safety checks at multiple points**: input, runtime, and output
5. **Independently updatable safety models** allow rapid response to new attack vectors

---

## 9. Error Handling & Recovery

### Context Window Management

**Claude Code**: Auto-compaction triggers at ~95-98% of context window. Clears older tool outputs first, then summarizes conversation. `PreCompact` hooks inject critical context before summarization.

**CrewAI**: `respect_context_window=True` auto-summarizes when approaching token limits.

**ChatGPT**: Asymmetric compression — keeps user messages, drops assistant responses (~50% savings).

### Checkpointing

**LangGraph**: Every super-step checkpointed. Thread-based execution for multi-tenant isolation. Resume from failure via checkpoint ID. Supports topology migrations on completed threads.

**Operator**: Checkpointing every 3 actions (instead of 10) reduced complete failures by 52%.

### Retry Policies

| Platform | Strategy |
|----------|----------|
| LangGraph | `RetryPolicy` with `max_attempts`, `backoff_factor`, `retry_on` predicate — per-node configurable |
| CrewAI | `max_retry_limit` (default: 2) + `max_iter` (20) + `max_execution_time` |
| Cursor | "DO NOT loop more than 3 times" on linter errors |
| AutoGen | `max_retries_on_error` on CodeExecutorAgent |
| Operator | Exponential backoff resolves 73% of transient failures |

### Graceful Degradation

LangGraph's `RemainingSteps` managed value lets nodes proactively detect approaching recursion limits and degrade gracefully (summarize, return partial results, escalate to human) rather than crash.

### Failure Classification

Operator's empirical taxonomy from 15,000+ tasks provides a template:
- **Timeouts** (31%) → explicit waits, mode switching
- **Auth issues** (24%) → pre-authentication, token refresh
- **Rendering failures** (19%) → DOM element waiting, fallback modes
- **Infrastructure** (12%) → exponential backoff, circuit breakers

---

## 10. Cross-Platform Comparison

### Architecture Summary

| Platform | Orchestration | Tools | Memory | Safety |
|----------|--------------|-------|--------|--------|
| ChatGPT | Channel-based (analysis/commentary/final) | Namespace declarations | 6-layer profiling | Instruction hierarchy |
| Operator | Perception-action loop | computer_call actions | Screenshot history | Dual-model monitor |
| Deep Research | Clarify → plan → research → synthesize | Single meta-tool | Browsing history | Medium risk classification |
| Gemini | Three-block (thought/python/tool_code) | OpenAPI schemas + meta-discovery | Session state | Dynamic retrieval scoring |
| Project Mariner | Observe-Plan-Act with DOM+pixels | Browser actions | Per-task state | Hard-coded gates + sandbox |
| Claude Code | while(tool_call) + sub-agents | Composable primitives | Layered markdown files | 6-tier permissions + hooks |
| Computer Use | Screenshot verification loop | Versioned action vocabulary | Screenshot chain | Screenshot injection classifier |
| M365 Copilot | Continuous reasoning loop | Hierarchical skill matching | Graph + semantic index | Multi-point AI firewalls |
| AutoGen | Swarm handoff via tool calls | Agent-defined tools | Shared message context | OpenTelemetry tracing |
| Cursor | Two-stage (plan + apply) | 10 primitives + explanation field | Merkle-tree indexed RAG | User approval gating |
| Windsurf | AI Flow (real-time awareness) | Categorized tool groups | Structured persistent memory | 20-call cap per prompt |
| Aider | Iterative chat loop | Search/replace + repo map | Tree-sitter structural index | Layered match fallback |
| CrewAI | Crews (sequential/hierarchical) + Flows | Per-agent + per-task assignment | 4-layer (short/long/entity/contextual) | Retry + iteration caps |
| LangGraph | Directed state graph | Node functions | State + checkpoints + Store | RetryPolicy + graceful degradation |

### Convergence Points

These patterns have emerged independently across multiple platforms:

1. **Minimal orchestrator loop** — intelligence in the prompt, not the harness
2. **Multi-model architectures** — expensive model for reasoning, cheap for validation
3. **Content-based edit matching** — search/replace blocks, not line-number diffs
4. **Persistent memory across sessions** — markdown files, structured entries, or knowledge bases
5. **Human-in-the-loop at irreversible actions** — hard-coded gates, not model discretion
6. **Sub-agent isolation** — clean context windows for specialized tasks
7. **Checkpoint-based recovery** — persist state at every significant step
8. **Tool call opacity** — users see natural language, never tool names

### Divergence Points

These remain active areas of experimentation:

1. **Screenshot-only vs DOM+pixel perception** for browser agents
2. **Full-file rewrite vs surgical edits** for code modification
3. **Central orchestrator vs decentralized handoff** for multi-agent systems
4. **Flat vector memory vs multi-layer structured memory**
5. **Pre-loaded tools vs dynamic tool discovery**

---

## 11. Actionable Recommendations

### Architecture

1. **Keep the orchestrator minimal.** A `while(tool_call)` loop with permission checks is sufficient. Push all intelligence into the system prompt. The simpler your harness, the more it benefits from model improvements.

2. **Use multi-model architectures.** Route validation, summarization, and security classification to cheaper models. Reserve your most capable model for reasoning. This reduces cost 3-5x on ancillary operations.

3. **Separate hidden reasoning from visible output.** Use channels or blocks to let the agent think privately while narrating progress publicly. Users get transparency without information overload.

4. **Design primitive tools, not specialized ones.** A dozen composable primitives (shell, read, write, edit, search, sub-agent) cover virtually any workflow. Let the model handle composition.

### Memory

5. **Build multi-layer memory.** At minimum: working (current execution), session (conversation history), long-term (cross-session learnings), entity (structured knowledge about named things).

6. **Use composite scoring for retrieval.** Blend semantic similarity, recency, and importance — not just nearest-neighbor. Annotate importance at write time.

7. **Compress history asymmetrically.** Keep user messages, aggressively summarize or drop assistant responses. ~50% token savings with minimal quality loss.

### Multi-Agent

8. **Prefer handoff-via-tool-call.** Delegation as a tool call is simpler and more scalable than central orchestration. Agents only need to know their delegates, not the full topology.

9. **Use deterministic backbones with autonomous steps.** Hard-code the workflow structure; let agents be autonomous within individual steps. This gives predictability where needed and flexibility where it adds value.

10. **Disable parallel tool calls in multi-agent systems.** Multiple simultaneous handoffs cause race conditions. Accept the latency cost for correctness.

### Code Editing

11. **Use content-based matching, not line numbers.** Search/replace blocks with layered fallback (exact → whitespace-normalized → fuzzy) are the de facto standard.

12. **Build a structural index with tree-sitter.** A 1K-token AST-based repository map often outperforms 50K tokens of raw code for codebase awareness.

13. **Separate planning from application.** Use a frontier model for edit intent and a specialized model for mechanical application. Each can be optimized independently.

### Browser Agents

14. **Combine screenshot and DOM analysis.** Hybrid perception is strictly superior to either alone for web automation.

15. **Maintain dual browser modes.** Visual for interactive content, text for extraction. Dynamic switching yields ~28% improvement in completion rates.

16. **Checkpoint every 3 actions.** Not 10. Empirically reduces complete failures by 52%.

### Safety

17. **Deploy an independent monitor model.** A lightweight second model watching for prompt injection achieves 99% recall and can be updated independently of the primary model.

18. **Implement lifecycle hooks outside the LLM loop.** Linting, auditing, and policy enforcement at zero AI token cost.

19. **Hard-code gates for irreversible actions.** Don't rely on the model to decide when to pause. Classify actions by reversibility and enforce approval for financial, deletion, and external communication operations.

20. **Assume prompts will leak.** Design systems that are safe with full prompt disclosure. Never embed secrets.

### Error Handling

21. **Classify failures into categories with distinct handlers.** Timeouts, auth issues, rendering failures, and infrastructure problems each need different mitigation strategies.

22. **Set explicit retry caps in the system prompt.** "DO NOT loop more than 3 times" prevents infinite fix cycles that burn tokens and time.

23. **Use graceful degradation over hard crashes.** Expose remaining-step counts so agents can summarize, return partial results, or escalate to humans as limits approach.

---

## 12. Sources

### OpenAI
- ChatGPT 4o/GPT-5 leaked system prompts — LLMrefs, Simon Willison, Shinobi Security, asgeirtj/system_prompts_leaks
- ChatGPT memory architecture — Embrace The Red, TheBigPromptLibrary
- Operator system card and API docs — OpenAI
- Deep Research system prompt — jujumilk3/leaked-system-prompts, Xuanwo
- Deep Research system card (PDF) — OpenAI CDN
- CL4R1T4S leaked prompts collection — elder-plinius/CL4R1T4S

### Google
- Gemini 2.5 Pro system prompt leak — CL4R1T4S, not-a-robot.com
- Project Mariner — Google DeepMind, AllAboutAI, Programming Helper
- Eight multi-agent design patterns — Google Cloud Architecture Center, InfoQ
- ADK documentation — google.github.io/adk-docs
- Gemini API docs — ai.google.dev (function calling, grounding, code execution, deep research)
- Scaling principles — InfoQ

### Anthropic
- Claude Code internals — Kir Shatrov, PromptLayer, Sabrina.dev, Rubric Labs
- Claude Code system prompts — Piebald-AI/claude-code-system-prompts, GitHub
- cchistory tracking — mariozechner.at
- Claude Code permission system — kotrotsos/Medium
- Computer Use docs — platform.claude.com
- Anthropic quickstarts — GitHub
- Context engineering — anthropic.com/engineering

### Microsoft
- Copilot system prompt extraction — Zenity Labs, Knostic.ai
- M365 Copilot orchestrator — Microsoft Learn
- GitHub Copilot agent mode — DEV Community, VS Code Blog
- AutoGen framework — GitHub, official documentation
- Semantic Kernel — Microsoft DevBlogs, Microsoft Learn
- Runtime guardrails — Noma Security
- Reprompt attack — Varonis

### Coding Agents
- Cursor system prompt — ScriptedAlchemy/GitHub Gist, patmcguinness/Substack
- Cursor indexing pipeline — Engineer's Codex
- Cursor instant apply — cursor.com/blog
- Windsurf Cascade — DeepWiki, jujumilk3/leaked-system-prompts
- Cline system prompt — cline.bot/blog
- Aider architecture — aider.chat, simranchawla.com
- Continue.dev — docs.continue.dev
- Augment Code — augmentcode.com
- Devin — devin.ai
- Edit format comparison — fabianhertwig.com
- Diff formats — morphllm.com

### Open-Source Frameworks
- AutoGPT architecture — Maarten Grootendorst, Labellerr, official docs
- CrewAI agents and memory — official docs, SparkCo, crewai.com/blog
- LangGraph — official docs, DEV Community, DeepWiki
- Framework comparisons — Langfuse, Turing, MGX

---

*This report was compiled from publicly archived system prompts, reverse-engineered architectures, official documentation, security research, and open-source codebases. All findings reflect the state of these platforms as of March 2026. Sources include community-maintained prompt archives, vendor documentation, academic and industry blog posts, and open-source repositories. Readers should verify specific claims against original sources before making architectural decisions.*
