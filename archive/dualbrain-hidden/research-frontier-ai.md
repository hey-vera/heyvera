I’ll ground this in current primary sources where possible, especially for framework and model details that have shifted through 2025-2026. I’m using the OpenAI docs skill for OpenAI-specific claims, then I’ll cross-check the broader ecosystem from official docs and papers.
exec
/bin/bash -lc "sed -n '1,220p' /home/runner/workspace/.replit-tools/.codex-persistent/skills/.system/openai-docs/SKILL.md" in /home/runner/workspace
 exited 1 in 0ms:
bwrap: Unexpected capabilities but not setuid, old file caps config?
exec
/bin/bash -c "sed -n '1,220p' /home/runner/workspace/.replit-tools/.codex-persistent/skills/.system/openai-docs/SKILL.md" in /home/runner/workspace
 exited 1 in 0ms:
bwrap: Unexpected capabilities but not setuid, old file caps config?
web search: 
web search: OpenAI Agents SDK Swarm successor Responses API official Agents SDK 2025
web search: 
web search: LangGraph official docs multi-agent latest 2026 supervisor swarm
web search: 
web search: LOTUS AI programming model official compound AI systems 2025
web search: 
web search: Google Agent2Agent protocol official specification 2025 Linux Foundation
web search: 
web search: Devin AI coding agent production architecture official 2025 cognition
web search: 
web search: Augment Code agent official docs context engine multi file 2025
web search: 
web search: self-improving AI agents modify prompts routing architecture outcomes 2025 paper
web search: 
web search: Google DeepMind AlphaEvolve evolutionary coding agent May 2025 official
web search: 
web search: OpenAI o3 o4-mini tools reasoning models Responses API official April 2025
web search: 
web search: LOTUS AI query engine Stanford official 2025 language model programming
web search: 
web search: Google Antigravity official agentic development platform November 2025
codex
**Frontier AI Agent Orchestration And Multi-Agent Systems, 2025-2026**
As of May 19, 2026, the agent ecosystem has moved from “LLM plus tools” demos toward production runtimes: stateful graphs, durable task execution, tool governance, model routing, observability, and controlled autonomy. The most important lesson for Cortex, a Rust-based Brain/Worker orchestration engine routing across Claude, GPT, and Gemini, is this: do not build “a swarm of chatbots.” Build a deterministic orchestration kernel that can host agentic behavior under strict state, budget, identity, memory, and evaluation boundaries.
The frontier pattern is compound AI: multiple models, retrievers, tools, caches, sandboxes, policies, and evaluators arranged into a runtime. Berkeley’s compound AI framing defines these systems as tasks solved by “multiple interacting components” including model calls, retrievers, and tools, not a single monolithic model call ([BAIR](https://bair.berkeley.edu/blog/2024/02/18/compound-ai-systems/)). That framing is now the right mental model for Cortex.
**1. Latest Multi-Agent Frameworks**
OpenAI’s experimental Swarm has effectively given way to the OpenAI Agents SDK and Responses API stack. OpenAI’s March 2025 agent platform introduced the Responses API, built-in tools such as web search, file search, and computer use, plus an Agents SDK with tracing ([OpenAI](https://openai.com/index/new-tools-for-building-agents/), [Agents SDK docs](https://platform.openai.com/docs/guides/agents-sdk/)). Architecturally, OpenAI’s important contribution is not “multi-agent chat.” It is a typed handoff model: agents have instructions, tools, guardrails, and can hand off to specialized agents. The SDK treats handoffs as first-class control-flow operations rather than ordinary tool calls. The current JS SDK docs also distinguish input/output guardrails from tool guardrails, which matters because handoffs travel through a special path ([OpenAI guardrails](https://openai.github.io/openai-agents-js/guides/guardrails/)).
For Cortex: copy the control-plane idea, not the SDK surface. Represent handoffs as typed runtime transitions with policy checks, audit events, and resumable state. A handoff should produce a structured `TaskEnvelope`: goal, constraints, allowed tools, current artifacts, budget, deadline, escalation rules, and required output schema.
Anthropic’s agent work centers on Claude Code and the Claude Agent SDK. Anthropic describes the Agent SDK as infrastructure derived from Claude Code, intended for building agents on top of that same foundation ([Anthropic engineering](https://www.anthropic.com/engineering/building-agents-with-the-claude-agent-sdk/), [Claude Agent SDK TypeScript docs](https://docs.claude.com/en/docs/claude-code/sdk/sdk-typescript)). Claude Code’s production lessons are especially relevant: long-running coding agents need file-system awareness, permissioning, tool approval, subagents, repository instructions, and tight feedback from tests. The “agent manifest” pattern, such as `CLAUDE.md` and similar repo instruction files, has become a de facto way to bind local operating rules to a codebase.
For Cortex: implement a first-class “manifest loader.” Do not flatten every instruction into one prompt. Parse project, organization, task, and user rules into layered policy objects with precedence and provenance. Every worker invocation should know which rules were active and why.
Google’s ecosystem has split into three relevant branches. First, Google ADK is a code-first framework for multi-agent applications, with official docs for multi-agent patterns such as sequential, parallel, and hierarchical agents ([ADK](https://adk.dev/), [multi-agent docs](https://google.github.io/adk-docs/agents/multi-agents/)). Second, Google DeepMind’s AlphaEvolve shows a different kind of agent: an evolutionary coding system that generates, evaluates, and improves algorithms using objective functions ([DeepMind AlphaEvolve](https://deepmind.google/discover/blog/alphaevolve-a-gemini-powered-coding-agent-for-designing-advanced-algorithms/)). Third, Google Antigravity, announced in November 2025, positions the IDE as an agent-first development platform ([Google Developers](https://developers.googleblog.com/build-with-google-antigravity-our-new-agentic-development-platform/)).
For Cortex: ADK’s lesson is topology; AlphaEvolve’s lesson is evaluator-driven search; Antigravity’s lesson is workspace control. Cortex should support topologies, but keep them declarative. The Brain should compile a topology into a runtime graph, not ask an LLM to improvise coordination at every turn.
Microsoft AutoGen v0.4 is notable for its rewrite around scale, extensibility, robustness, and asynchronous event-driven architecture ([Microsoft Research](https://www.microsoft.com/en-us/research/blog/autogen-v0-4-reimagining-the-foundation-of-agentic-ai-for-scale-extensibility-and-robustness/)). AutoGen’s strongest architectural signal is that production multi-agent systems need a lower-level core runtime and higher-level conversational abstractions. The framework separates agent runtime mechanics from user-friendly AgentChat APIs.
For Cortex: keep a small Rust core for scheduling, state, persistence, events, and permissions. Build higher-level agent DSLs on top. Do not bury orchestration semantics inside prompt templates.
LangGraph remains the most influential open-source orchestration primitive because it treats agent workflows as stateful graphs. Its API reference emphasizes persistent checkpointing, state stores, deployed graph APIs, supervisor libraries, and swarm-style handoff libraries ([LangGraph reference](https://reference.langchain.com/python/langgraph/overview), [LangGraph supervisor](https://changelog.langchain.com/announcements/langgraph-supervisor-a-library-for-hierarchical-multi-agent-systems)). Its architectural advantage is explicit state transitions. Its weakness is complexity: graph code can become hard to reason about unless topology, state schema, and observability are disciplined.
For Cortex: borrow LangGraph’s durable state machine model. Each worker step should be replayable from an event log. Each edge should have a typed condition, not a prose-only routing prompt.
CrewAI’s 2025-2026 direction emphasizes “Flows” as an event-driven orchestration layer that can mix deterministic steps, functions, LLM calls, and full crews ([CrewAI Flows](https://www.crewai.com/crewai-flows)). That is an important correction to early multi-agent hype: not every step should be autonomous. Real production systems combine deterministic workflow with pockets of agency.
For Cortex: define three execution modes: deterministic node, model node, and agent node. Most production work should be deterministic plus model calls; autonomous subagents should be reserved for open-ended exploration, coding, research, negotiation, or recovery.
Emerging pattern: the best frameworks are converging on five concepts: durable state, explicit handoffs, tool governance, observability, and mixed deterministic/agentic control flow. “Many agents talking” is not the core. The core is a runtime that can safely let models act.
**2. Self-Improving AI Systems**
Self-improving agent systems are real, but the production-safe version is narrower than the mythology. The practical form is not recursive self-improvement of the whole system. It is measured adaptation of prompts, routing, memory, tool choice, and task decomposition based on evaluations.
DSPy is the clearest production-relevant example. It treats LM systems as programs with signatures and modules, then uses optimizers to tune prompts, demonstrations, and sometimes weights against metrics ([DSPy](https://dspy.ai/), [Berkeley DSPy project](https://sky.cs.berkeley.edu/project/dspy/)). DSPy optimizers such as MIPRO, Bootstrap variants, GEPA, and SIMBA show how improvement should work: define a metric, collect examples, compile better instructions or demonstrations, validate against held-out sets, then deploy.
ADAS, Automated Design of Agentic Systems, pushes further. It defines agentic systems in code and uses a meta-agent to discover better agent designs ([arXiv](https://arxiv.org/abs/2408.08435)). SwarmAgentic extends this direction by optimizing agent functionality and collaboration jointly through language-driven exploration ([arXiv](https://arxiv.org/abs/2506.15672)). DeepMind’s AlphaEvolve is the most operationally persuasive variant: generate code candidates, run hard evaluators, keep winners, mutate, and repeat ([DeepMind](https://deepmind.google/discover/blog/alphaevolve-a-gemini-powered-coding-agent-for-designing-advanced-algorithms/)).
For Cortex, self-improvement should be implemented as an offline and gated optimization loop:
1. Capture traces: prompts, model, tools, cost, latency, errors, human corrections, final outcome.
2. Classify failures: routing failure, missing context, wrong tool, bad plan, hallucinated fact, stale memory, unsafe action, weak model.
3. Generate candidate changes: prompt patch, route rule, tool schema change, memory policy change, topology change.
4. Evaluate on a regression suite.
5. Canary release with rollback.
6. Promote only if it improves task-specific metrics without violating cost, latency, or safety budgets.
Constitutional AI for orchestration should be treated as policy architecture. Anthropic’s Constitutional AI idea is usually discussed at the model alignment layer, but the orchestration version is: every agent action is judged against a constitution of system principles. For Cortex, this constitution should not be just a prompt. It should be executable policy:
- Allowed/forbidden tool classes by task.
- Data exfiltration constraints.
- Spend limits.
- Human approval thresholds.
- Provider-specific privacy routing.
- Sandboxing requirements.
- “Stop and ask” conditions.
- Refusal/escalation behavior.
The Brain can ask a model to reason with the constitution, but enforcement must live outside the model. Use policy-as-code for hard gates and model-based critique for soft gates.
**3. Agent-To-Agent Communication Protocols**
Agent-to-agent communication in 2026 has three layers: tool/data protocols, agent interoperability protocols, and coordination memory.
MCP, the Model Context Protocol, has become the dominant standard for connecting agents to tools and data. The official spec positions it as a standardized way for AI systems to access external tools, resources, and prompts ([MCP spec](https://modelcontextprotocol.io/specification/2025-11-25/basic), [2025-03 spec](https://modelcontextprotocol.io/specification/2025-03-26/index)). Its adoption by coding tools matters because it externalizes capabilities: search, database access, docs, CI, observability, ticketing, and repo intelligence can all be presented as tools.
A2A, Agent2Agent, is Google’s protocol for agent interoperability, transferred to the Linux Foundation in June 2025 ([Linux Foundation](https://www.linuxfoundation.org/press/linux-foundation-launches-the-agent2agent-protocol-project-to-enable-secure-intelligent-communication-between-ai-agents?hs_amp=true)). MCP is mostly agent-to-tool/context. A2A is agent-to-agent collaboration. Cortex should support both eventually, but with different trust assumptions. MCP servers are capability providers. A2A peers are semi-autonomous actors with identity, intent, and possible conflicting policies.
Coordination patterns are older than LLMs, but they are reappearing:
- Blackboard systems: agents read and write to shared state. Good for research, coding, incident response, and planning, but requires conflict control.
- Shared memory: vector, relational, and artifact stores. Useful only when memories have provenance, TTL, confidence, and scope.
- Stigmergy: agents coordinate indirectly by modifying the environment, such as issues, files, tasks, or status boards.
- Market-based coordination: agents bid for tasks based on confidence, cost, latency, or specialization.
- Supervisor routing: one Brain delegates to Workers.
- Swarm handoff: peer agents transfer control.
For Cortex, the best default is not free-form chat between agents. Use a typed blackboard plus event log. Workers should communicate by publishing artifacts:
```text
Artifact {
  id,
  type: Plan | Finding | Patch | TestResult | Memory | Decision | Question,
  producer_agent,
  model,
  input_refs,
  confidence,
  evidence_refs,
  ttl,
  visibility_scope,
  schema_version
}
```
The Brain can route based on artifacts. Workers should not need to inspect each other’s hidden chain-of-thought. They need outputs, evidence, state diffs, and constraints.
Market-based routing is especially promising for Cortex. A cheap router or small model can ask candidate workers for a compact bid: expected success, required tools, estimated tokens, risk class, and whether human approval is needed. The Brain chooses the worker or runs parallel workers when uncertainty justifies cost.
**4. Autonomous Coding Agents In Production**
The leading coding agents are converging on the same architecture: deep codebase context, tool execution, terminal/test loops, multi-file patching, persistent task state, and human approval for risky actions.
Devin popularized the autonomous “software engineer” pattern: its own shell, editor, browser, planning loop, and long-running task execution. Cognition’s public positioning emphasized solving real GitHub issues and operating in mature repositories. Devin 2.0 reportedly moved toward an IDE for human-agent collaboration. The architectural lesson is workspace ownership: a coding agent needs an isolated environment, not just autocomplete.
Cursor Agent’s docs describe Agent mode as suited for complex features and refactors, with autonomous exploration and multi-file edits; Cursor also indexes the codebase with embeddings ([Cursor Agent docs](https://docs.cursor.com/agent), [Cursor codebase indexing](https://docs.cursor.com/chat/codebase)). Cursor 2.0 introduced multi-agent operation using git worktrees or remote machines to prevent file conflicts ([Cursor changelog](https://cursor.com/changelog/2-0/)). That is a major production insight: parallel coding agents should not share one mutable checkout.
Claude Code’s strength is terminal-native agency with strong codebase and tool loops. Its Agent SDK opens that infrastructure to developers ([Anthropic](https://www.anthropic.com/engineering/building-agents-with-the-claude-agent-sdk/)). Codex, OpenAI’s coding agent line, similarly emphasizes CLI, IDE, cloud, and longer-running software tasks, though the exact product surface has shifted rapidly. The stable architectural direction is an app server or agent server backing multiple clients: CLI, IDE extension, web UI, and automation.
Augment differentiates around its Context Engine. Its docs say the Context Engine can be plugged into agents such as Claude Code, Codex, and Gemini CLI via MCP, providing codebase semantic search ([Augment context services](https://docs.augmentcode.com/context-services/overview), [Augment Agent](https://docs.augmentcode.com/using-augment/agent)). The lesson is that context retrieval is a product moat. The best coding agent is often the one with the best repo map.
Cline’s open-source model is important for safety. Its repository describes a VS Code agent that can edit files, execute commands, use a browser, and requires permission for every file change and terminal command ([Cline GitHub](https://github.com/cline/cline), [Cline docs](https://docs.cline.bot/introduction/overview)). That is slower than full autonomy, but safer for local environments.
Windsurf Cascade exposes another frontier pattern: a specialized planning agent continuously refines the long-term plan while the selected model focuses on short-term actions ([Windsurf docs](https://docs.windsurf.com/windsurf/cascade)). This split is valuable. Long-horizon planning and immediate tool execution are different cognitive workloads.
For Cortex: the coding-agent architecture should be:
- Brain owns task decomposition, budget, risk, and acceptance criteria.
- Planner maintains a living plan and revises it after observations.
- Worker operates in an isolated workspace, ideally a git worktree/container.
- Context service provides repo maps, symbols, embeddings, dependency graph, docs, and recent diffs.
- Tool proxy mediates shell, file edits, network, browser, package manager, and VCS.
- Verifier runs tests, lint, typecheck, build, and semantic checks.
- Reviewer agent critiques the diff against requirements and repo rules.
- Human approval gates destructive commands, secrets, migrations, deploys, and broad rewrites.
The best agents handle multi-file work by maintaining an artifact graph, not by stuffing all files into context. They search, read, patch, test, observe errors, patch again, and preserve a compact task memory.
**5. Frontier Inference Optimization**
Cortex should treat inference as a scheduling problem, not just an API call.
Speculative decoding remains important for self-hosted or provider-side serving: a smaller draft model proposes tokens, a larger model verifies them. A 2025 survey covers speculative decoding and generation-refinement techniques ([Hugging Face paper page](https://huggingface.co/papers/2502.19732)). For Cortex using hosted Claude/GPT/Gemini APIs, speculative decoding is mostly provider-internal. But the same idea applies at the system level: cheap workers draft plans, expensive models verify or execute.
Mixture-of-agents and cascade architectures are more actionable. A cascade uses cheap models first and escalates only when needed. A mixture can run multiple models or agents in parallel and aggregate. The key is not blind majority vote; it is task-aware routing plus verifier selection.
RouteLLM shows how to route between weaker and stronger models using preference data to optimize cost-quality tradeoffs ([arXiv](https://arxiv.org/abs/2406.18665), [Hugging Face](https://huggingface.co/routellm)). RouterEval’s 2025 benchmark highlights model-level scaling: better routers matter more as the candidate model pool grows ([arXiv](https://arxiv.org/abs/2503.10657)). For Cortex, routing should be learned from traces: task type, required tools, context length, latency target, previous failures, user tier, and quality sensitivity.
Semantic caching is also now mature enough to implement, but carefully. 2025 work on category-aware semantic caching argues that thresholds, TTLs, and quotas should vary by query category because code, conversation, and volatile facts have different repetition and staleness patterns ([Hugging Face paper page](https://huggingface.co/papers/2510.26835)). SmartCache extends this to multi-turn contexts and KV-cache-aware serving ([NeurIPS 2025](https://papers.nips.cc/paper_files/paper/2025/hash/fb74b63d225f846e6032bf3e3ab0f4ec-Abstract-Conference.html)).
For Cortex: implement four caches:
- Exact response cache for deterministic prompts and tool schemas.
- Semantic cache for low-risk, stable, repeated queries.
- Retrieval cache for code/doc search results.
- Plan cache for recurring task decompositions.
Never semantic-cache high-risk tasks such as billing, security, production deploys, or current factual claims without validation.
Long-context optimization matters because Gemini’s long contexts and other frontier models invite waste. Long context is not memory. It is an expensive transport. Cortex should use context budgets: include only relevant artifacts, compress history into structured summaries, and preserve raw evidence outside the prompt.
**6. Compound AI Systems**
Berkeley Gorilla and the Berkeley Function Calling Leaderboard are important because tool use is the substrate of agents. BFCL evaluates whether models can call functions accurately, including multi-turn and relevance scenarios ([BFCL](https://gorilla.cs.berkeley.edu/blogs/8_berkeley_function_calling_leaderboard.html), [leaderboard](https://gorilla.cs.berkeley.edu/leaderboard.html?trk=public_post_comment-text)). Gorilla’s broader work connects LLMs to APIs with retrieval and function-calling specialization.
DSPy matters because it turns prompting into compilation. For Cortex, DSPy-like optimization can tune worker prompts, router prompts, and evaluator prompts against trace-derived datasets.
LOTUS is a newer example of declarative AI data processing. It implements a semantic operator model for text, document, structured, and unstructured data processing ([LOTUS](https://lotus-data.github.io/)). The key architectural lesson is that AI calls can be operators in a query plan. For Cortex, this suggests a future “agent query planner”: tasks compile into operations such as retrieve, classify, extract, rank, synthesize, verify, and act.
A good Cortex architecture should therefore look less like a chatbot framework and more like a distributed query/workflow engine:
```text
User Task
  -> Brain: classify, risk-score, budget
  -> Planner: produce typed DAG
  -> Router: choose model/worker/tool policy per node
  -> Workers: execute nodes with bounded autonomy
  -> Blackboard: persist artifacts and state
  -> Verifiers: evaluate outputs
  -> Optimizer: learn from traces offline
```
**7. Bleeding-Edge Capabilities**
Tool and computer-use agents are now mainstream. OpenAI’s Responses API includes hosted tools such as web search, file search, and computer use ([OpenAI tools](https://platform.openai.com/docs/guides/tools?api-mode=responses)). o3 and o4-mini extended reasoning models into tool use, including web, Python, files, images, and other tools ([OpenAI o3/o4-mini](https://openai.com/index/introducing-o3-and-o4-mini/), [system card](https://openai.com/index/o3-o4-mini-system-card)). This is a major shift: reasoning and acting are no longer separate product categories.
Multimodal agents are also becoming normal. o3/o4-mini reason over images; Gemini 2.5 and later Gemini lines emphasize multimodal reasoning; DeepMind’s SIMA 2 and Genie 3 point toward embodied and simulated-environment agents ([SIMA 2](https://deepmind.google/en/blog/sima-2-an-agent-that-plays-reasons-and-learns-with-you-in-virtual-3d-worlds/), [Genie 3](https://deepmind.google/blog/genie-3-a-new-frontier-for-world-models/)). For Cortex, multimodal support should be an artifact type, not a special case. Images, videos, browser screenshots, logs, traces, PDFs, and UI states should all enter the blackboard with metadata and tool affordances.
Reasoning models are useful but not universally best. They are slower, costlier, and sometimes weaker at strict structured tool calling than non-reasoning models. Cortex should route reasoning models to tasks with planning depth, ambiguous constraints, math, architecture, security analysis, or multi-step debugging. Use cheaper fast models for extraction, classification, summarization, and simple tool calls.
Long context, such as Gemini’s million-token-class context windows, changes retrieval strategy but does not eliminate it. The right design is hierarchical context: full corpus in storage, retrieved evidence in working context, compressed task state in memory, and raw artifacts linked by ID.
Distillation for routing is one of Cortex’s biggest opportunities. A small local or cheap hosted classifier can learn to predict: “Claude Opus for architecture review,” “GPT reasoning model for math/tool synthesis,” “Gemini long-context for giant document/codebase ingestion,” “cheap model for classification,” and “parallel run because confidence is low.” RouteLLM is the right conceptual template.
**What Cortex Should Build**
Cortex should build a Rust orchestration kernel with these primitives.
First, a typed event-sourced runtime. Every model call, tool call, handoff, artifact write, policy decision, and human approval should be an event. This gives replay, observability, debugging, billing, and self-improvement data.
Second, a declarative topology layer. Support supervisor, hierarchical, sequential, parallel, debate/review, swarm handoff, and evaluator-search patterns. Topologies should compile to a state machine. Do not let agent topology exist only inside prompts.
Third, a Brain/Worker contract. The Brain owns decomposition, routing, policy, budgets, and final acceptance. Workers own bounded execution. Workers receive explicit scopes: allowed tools, max cost, max wall time, artifact inputs, and output schema.
Fourth, a context and memory substrate. Use SQLite/Postgres-style relational metadata plus object storage for artifacts plus vector indexes for semantic retrieval. Memory records need provenance, TTL, confidence, owner, and invalidation. Never store unscoped “memories” as universal truth.
Fifth, provider abstraction without lowest-common-denominator blindness. Claude, GPT, and Gemini have different strengths and APIs. Cortex should expose a normalized internal interface but preserve provider-specific capabilities: reasoning effort, tool modes, long context, cache controls, JSON/schema constraints, computer use, file search, and safety settings.
Sixth, policy-as-code. Build an orchestration constitution enforced by the runtime: tool permissions, data boundaries, human approval, spend limits, network access, secret handling, and deploy constraints. Let models advise on policy interpretation, but do not let them enforce hard gates.
Seventh, routing and cascades. Start with deterministic route rules and logging. Add learned routing once traces exist. Use cheap-first cascades, but allow direct frontier routing for high-risk or high-value tasks. Track regret: when cheap routing caused escalation or failure.
Eighth, verifier-first autonomy. Every serious worker output should have acceptance checks: tests, schema validation, diff review, citation verification, factual freshness checks, or human signoff. AlphaEvolve’s lesson is that autonomy scales when evaluation is objective.
Ninth, isolated execution. For coding and computer-use workers, use containers, worktrees, filesystem sandboxes, network controls, and explicit destructive-action approvals. Cursor’s worktree isolation and Cline’s approval model are both worth copying.
Tenth, an optimization lab. Cortex should continuously mine traces into eval sets. Prompt, route, topology, and memory changes should go through offline evaluation and canary rollout. This is the safe version of self-improvement.
The strategic bet: Cortex should not compete with LangGraph, AutoGen, CrewAI, or vendor SDKs as a Python framework. It should be the durable, provider-neutral, Rust control plane underneath them: an orchestration engine that can run Claude, GPT, Gemini, MCP tools, A2A peers, coding sandboxes, verifiers, and learned routers with production-grade state and governance.
**Frontier AI Agent Orchestration And Multi-Agent Systems, 2025-2026**
As of May 19, 2026, the agent ecosystem has moved from “LLM plus tools” demos toward production runtimes: stateful graphs, durable task execution, tool governance, model routing, observability, and controlled autonomy. The most important lesson for Cortex, a Rust-based Brain/Worker orchestration engine routing across Claude, GPT, and Gemini, is this: do not build “a swarm of chatbots.” Build a deterministic orchestration kernel that can host agentic behavior under strict state, budget, identity, memory, and evaluation boundaries.
The frontier pattern is compound AI: multiple models, retrievers, tools, caches, sandboxes, policies, and evaluators arranged into a runtime. Berkeley’s compound AI framing defines these systems as tasks solved by “multiple interacting components” including model calls, retrievers, and tools, not a single monolithic model call ([BAIR](https://bair.berkeley.edu/blog/2024/02/18/compound-ai-systems/)). That framing is now the right mental model for Cortex.
**1. Latest Multi-Agent Frameworks**
OpenAI’s experimental Swarm has effectively given way to the OpenAI Agents SDK and Responses API stack. OpenAI’s March 2025 agent platform introduced the Responses API, built-in tools such as web search, file search, and computer use, plus an Agents SDK with tracing ([OpenAI](https://openai.com/index/new-tools-for-building-agents/), [Agents SDK docs](https://platform.openai.com/docs/guides/agents-sdk/)). Architecturally, OpenAI’s important contribution is not “multi-agent chat.” It is a typed handoff model: agents have instructions, tools, guardrails, and can hand off to specialized agents. The SDK treats handoffs as first-class control-flow operations rather than ordinary tool calls. The current JS SDK docs also distinguish input/output guardrails from tool guardrails, which matters because handoffs travel through a special path ([OpenAI guardrails](https://openai.github.io/openai-agents-js/guides/guardrails/)).
For Cortex: copy the control-plane idea, not the SDK surface. Represent handoffs as typed runtime transitions with policy checks, audit events, and resumable state. A handoff should produce a structured `TaskEnvelope`: goal, constraints, allowed tools, current artifacts, budget, deadline, escalation rules, and required output schema.
Anthropic’s agent work centers on Claude Code and the Claude Agent SDK. Anthropic describes the Agent SDK as infrastructure derived from Claude Code, intended for building agents on top of that same foundation ([Anthropic engineering](https://www.anthropic.com/engineering/building-agents-with-the-claude-agent-sdk/), [Claude Agent SDK TypeScript docs](https://docs.claude.com/en/docs/claude-code/sdk/sdk-typescript)). Claude Code’s production lessons are especially relevant: long-running coding agents need file-system awareness, permissioning, tool approval, subagents, repository instructions, and tight feedback from tests. The “agent manifest” pattern, such as `CLAUDE.md` and similar repo instruction files, has become a de facto way to bind local operating rules to a codebase.
For Cortex: implement a first-class “manifest loader.” Do not flatten every instruction into one prompt. Parse project, organization, task, and user rules into layered policy objects with precedence and provenance. Every worker invocation should know which rules were active and why.
Google’s ecosystem has split into three relevant branches. First, Google ADK is a code-first framework for multi-agent applications, with official docs for multi-agent patterns such as sequential, parallel, and hierarchical agents ([ADK](https://adk.dev/), [multi-agent docs](https://google.github.io/adk-docs/agents/multi-agents/)). Second, Google DeepMind’s AlphaEvolve shows a different kind of agent: an evolutionary coding system that generates, evaluates, and improves algorithms using objective functions ([DeepMind AlphaEvolve](https://deepmind.google/discover/blog/alphaevolve-a-gemini-powered-coding-agent-for-designing-advanced-algorithms/)). Third, Google Antigravity, announced in November 2025, positions the IDE as an agent-first development platform ([Google Developers](https://developers.googleblog.com/build-with-google-antigravity-our-new-agentic-development-platform/)).
For Cortex: ADK’s lesson is topology; AlphaEvolve’s lesson is evaluator-driven search; Antigravity’s lesson is workspace control. Cortex should support topologies, but keep them declarative. The Brain should compile a topology into a runtime graph, not ask an LLM to improvise coordination at every turn.
Microsoft AutoGen v0.4 is notable for its rewrite around scale, extensibility, robustness, and asynchronous event-driven architecture ([Microsoft Research](https://www.microsoft.com/en-us/research/blog/autogen-v0-4-reimagining-the-foundation-of-agentic-ai-for-scale-extensibility-and-robustness/)). AutoGen’s strongest architectural signal is that production multi-agent systems need a lower-level core runtime and higher-level conversational abstractions. The framework separates agent runtime mechanics from user-friendly AgentChat APIs.
For Cortex: keep a small Rust core for scheduling, state, persistence, events, and permissions. Build higher-level agent DSLs on top. Do not bury orchestration semantics inside prompt templates.
LangGraph remains the most influential open-source orchestration primitive because it treats agent workflows as stateful graphs. Its API reference emphasizes persistent checkpointing, state stores, deployed graph APIs, supervisor libraries, and swarm-style handoff libraries ([LangGraph reference](https://reference.langchain.com/python/langgraph/overview), [LangGraph supervisor](https://changelog.langchain.com/announcements/langgraph-supervisor-a-library-for-hierarchical-multi-agent-systems)). Its architectural advantage is explicit state transitions. Its weakness is complexity: graph code can become hard to reason about unless topology, state schema, and observability are disciplined.
For Cortex: borrow LangGraph’s durable state machine model. Each worker step should be replayable from an event log. Each edge should have a typed condition, not a prose-only routing prompt.
CrewAI’s 2025-2026 direction emphasizes “Flows” as an event-driven orchestration layer that can mix deterministic steps, functions, LLM calls, and full crews ([CrewAI Flows](https://www.crewai.com/crewai-flows)). That is an important correction to early multi-agent hype: not every step should be autonomous. Real production systems combine deterministic workflow with pockets of agency.
For Cortex: define three execution modes: deterministic node, model node, and agent node. Most production work should be deterministic plus model calls; autonomous subagents should be reserved for open-ended exploration, coding, research, negotiation, or recovery.
Emerging pattern: the best frameworks are converging on five concepts: durable state, explicit handoffs, tool governance, observability, and mixed deterministic/agentic control flow. “Many agents talking” is not the core. The core is a runtime that can safely let models act.
**2. Self-Improving AI Systems**
Self-improving agent systems are real, but the production-safe version is narrower than the mythology. The practical form is not recursive self-improvement of the whole system. It is measured adaptation of prompts, routing, memory, tool choice, and task decomposition based on evaluations.
DSPy is the clearest production-relevant example. It treats LM systems as programs with signatures and modules, then uses optimizers to tune prompts, demonstrations, and sometimes weights against metrics ([DSPy](https://dspy.ai/), [Berkeley DSPy project](https://sky.cs.berkeley.edu/project/dspy/)). DSPy optimizers such as MIPRO, Bootstrap variants, GEPA, and SIMBA show how improvement should work: define a metric, collect examples, compile better instructions or demonstrations, validate against held-out sets, then deploy.
ADAS, Automated Design of Agentic Systems, pushes further. It defines agentic systems in code and uses a meta-agent to discover better agent designs ([arXiv](https://arxiv.org/abs/2408.08435)). SwarmAgentic extends this direction by optimizing agent functionality and collaboration jointly through language-driven exploration ([arXiv](https://arxiv.org/abs/2506.15672)). DeepMind’s AlphaEvolve is the most operationally persuasive variant: generate code candidates, run hard evaluators, keep winners, mutate, and repeat ([DeepMind](https://deepmind.google/discover/blog/alphaevolve-a-gemini-powered-coding-agent-for-designing-advanced-algorithms/)).
For Cortex, self-improvement should be implemented as an offline and gated optimization loop:
1. Capture traces: prompts, model, tools, cost, latency, errors, human corrections, final outcome.
2. Classify failures: routing failure, missing context, wrong tool, bad plan, hallucinated fact, stale memory, unsafe action, weak model.
3. Generate candidate changes: prompt patch, route rule, tool schema change, memory policy change, topology change.
4. Evaluate on a regression suite.
5. Canary release with rollback.
6. Promote only if it improves task-specific metrics without violating cost, latency, or safety budgets.
Constitutional AI for orchestration should be treated as policy architecture. Anthropic’s Constitutional AI idea is usually discussed at the model alignment layer, but the orchestration version is: every agent action is judged against a constitution of system principles. For Cortex, this constitution should not be just a prompt. It should be executable policy:
- Allowed/forbidden tool classes by task.
- Data exfiltration constraints.
- Spend limits.
- Human approval thresholds.
- Provider-specific privacy routing.
- Sandboxing requirements.
- “Stop and ask” conditions.
- Refusal/escalation behavior.
The Brain can ask a model to reason with the constitution, but enforcement must live outside the model. Use policy-as-code for hard gates and model-based critique for soft gates.
**3. Agent-To-Agent Communication Protocols**
Agent-to-agent communication in 2026 has three layers: tool/data protocols, agent interoperability protocols, and coordination memory.
MCP, the Model Context Protocol, has become the dominant standard for connecting agents to tools and data. The official spec positions it as a standardized way for AI systems to access external tools, resources, and prompts ([MCP spec](https://modelcontextprotocol.io/specification/2025-11-25/basic), [2025-03 spec](https://modelcontextprotocol.io/specification/2025-03-26/index)). Its adoption by coding tools matters because it externalizes capabilities: search, database access, docs, CI, observability, ticketing, and repo intelligence can all be presented as tools.
A2A, Agent2Agent, is Google’s protocol for agent interoperability, transferred to the Linux Foundation in June 2025 ([Linux Foundation](https://www.linuxfoundation.org/press/linux-foundation-launches-the-agent2agent-protocol-project-to-enable-secure-intelligent-communication-between-ai-agents?hs_amp=true)). MCP is mostly agent-to-tool/context. A2A is agent-to-agent collaboration. Cortex should support both eventually, but with different trust assumptions. MCP servers are capability providers. A2A peers are semi-autonomous actors with identity, intent, and possible conflicting policies.
Coordination patterns are older than LLMs, but they are reappearing:
- Blackboard systems: agents read and write to shared state. Good for research, coding, incident response, and planning, but requires conflict control.
- Shared memory: vector, relational, and artifact stores. Useful only when memories have provenance, TTL, confidence, and scope.
- Stigmergy: agents coordinate indirectly by modifying the environment, such as issues, files, tasks, or status boards.
- Market-based coordination: agents bid for tasks based on confidence, cost, latency, or specialization.
- Supervisor routing: one Brain delegates to Workers.
- Swarm handoff: peer agents transfer control.
For Cortex, the best default is not free-form chat between agents. Use a typed blackboard plus event log. Workers should communicate by publishing artifacts:
```text
Artifact {
  id,
  type: Plan | Finding | Patch | TestResult | Memory | Decision | Question,
  producer_agent,
  model,
  input_refs,
  confidence,
  evidence_refs,
  ttl,
  visibility_scope,
  schema_version
}
```
The Brain can route based on artifacts. Workers should not need to inspect each other’s hidden chain-of-thought. They need outputs, evidence, state diffs, and constraints.
Market-based routing is especially promising for Cortex. A cheap router or small model can ask candidate workers for a compact bid: expected success, required tools, estimated tokens, risk class, and whether human approval is needed. The Brain chooses the worker or runs parallel workers when uncertainty justifies cost.
**4. Autonomous Coding Agents In Production**
The leading coding agents are converging on the same architecture: deep codebase context, tool execution, terminal/test loops, multi-file patching, persistent task state, and human approval for risky actions.
Devin popularized the autonomous “software engineer” pattern: its own shell, editor, browser, planning loop, and long-running task execution. Cognition’s public positioning emphasized solving real GitHub issues and operating in mature repositories. Devin 2.0 reportedly moved toward an IDE for human-agent collaboration. The architectural lesson is workspace ownership: a coding agent needs an isolated environment, not just autocomplete.
Cursor Agent’s docs describe Agent mode as suited for complex features and refactors, with autonomous exploration and multi-file edits; Cursor also indexes the codebase with embeddings ([Cursor Agent docs](https://docs.cursor.com/agent), [Cursor codebase indexing](https://docs.cursor.com/chat/codebase)). Cursor 2.0 introduced multi-agent operation using git worktrees or remote machines to prevent file conflicts ([Cursor changelog](https://cursor.com/changelog/2-0/)). That is a major production insight: parallel coding agents should not share one mutable checkout.
Claude Code’s strength is terminal-native agency with strong codebase and tool loops. Its Agent SDK opens that infrastructure to developers ([Anthropic](https://www.anthropic.com/engineering/building-agents-with-the-claude-agent-sdk/)). Codex, OpenAI’s coding agent line, similarly emphasizes CLI, IDE, cloud, and longer-running software tasks, though the exact product surface has shifted rapidly. The stable architectural direction is an app server or agent server backing multiple clients: CLI, IDE extension, web UI, and automation.
Augment differentiates around its Context Engine. Its docs say the Context Engine can be plugged into agents such as Claude Code, Codex, and Gemini CLI via MCP, providing codebase semantic search ([Augment context services](https://docs.augmentcode.com/context-services/overview), [Augment Agent](https://docs.augmentcode.com/using-augment/agent)). The lesson is that context retrieval is a product moat. The best coding agent is often the one with the best repo map.
Cline’s open-source model is important for safety. Its repository describes a VS Code agent that can edit files, execute commands, use a browser, and requires permission for every file change and terminal command ([Cline GitHub](https://github.com/cline/cline), [Cline docs](https://docs.cline.bot/introduction/overview)). That is slower than full autonomy, but safer for local environments.
Windsurf Cascade exposes another frontier pattern: a specialized planning agent continuously refines the long-term plan while the selected model focuses on short-term actions ([Windsurf docs](https://docs.windsurf.com/windsurf/cascade)). This split is valuable. Long-horizon planning and immediate tool execution are different cognitive workloads.
For Cortex: the coding-agent architecture should be:
- Brain owns task decomposition, budget, risk, and acceptance criteria.
- Planner maintains a living plan and revises it after observations.
- Worker operates in an isolated workspace, ideally a git worktree/container.
- Context service provides repo maps, symbols, embeddings, dependency graph, docs, and recent diffs.
- Tool proxy mediates shell, file edits, network, browser, package manager, and VCS.
- Verifier runs tests, lint, typecheck, build, and semantic checks.
- Reviewer agent critiques the diff against requirements and repo rules.
- Human approval gates destructive commands, secrets, migrations, deploys, and broad rewrites.
The best agents handle multi-file work by maintaining an artifact graph, not by stuffing all files into context. They search, read, patch, test, observe errors, patch again, and preserve a compact task memory.
**5. Frontier Inference Optimization**
Cortex should treat inference as a scheduling problem, not just an API call.
Speculative decoding remains important for self-hosted or provider-side serving: a smaller draft model proposes tokens, a larger model verifies them. A 2025 survey covers speculative decoding and generation-refinement techniques ([Hugging Face paper page](https://huggingface.co/papers/2502.19732)). For Cortex using hosted Claude/GPT/Gemini APIs, speculative decoding is mostly provider-internal. But the same idea applies at the system level: cheap workers draft plans, expensive models verify or execute.
Mixture-of-agents and cascade architectures are more actionable. A cascade uses cheap models first and escalates only when needed. A mixture can run multiple models or agents in parallel and aggregate. The key is not blind majority vote; it is task-aware routing plus verifier selection.
RouteLLM shows how to route between weaker and stronger models using preference data to optimize cost-quality tradeoffs ([arXiv](https://arxiv.org/abs/2406.18665), [Hugging Face](https://huggingface.co/routellm)). RouterEval’s 2025 benchmark highlights model-level scaling: better routers matter more as the candidate model pool grows ([arXiv](https://arxiv.org/abs/2503.10657)). For Cortex, routing should be learned from traces: task type, required tools, context length, latency target, previous failures, user tier, and quality sensitivity.
Semantic caching is also now mature enough to implement, but carefully. 2025 work on category-aware semantic caching argues that thresholds, TTLs, and quotas should vary by query category because code, conversation, and volatile facts have different repetition and staleness patterns ([Hugging Face paper page](https://huggingface.co/papers/2510.26835)). SmartCache extends this to multi-turn contexts and KV-cache-aware serving ([NeurIPS 2025](https://papers.nips.cc/paper_files/paper/2025/hash/fb74b63d225f846e6032bf3e3ab0f4ec-Abstract-Conference.html)).
For Cortex: implement four caches:
- Exact response cache for deterministic prompts and tool schemas.
- Semantic cache for low-risk, stable, repeated queries.
- Retrieval cache for code/doc search results.
- Plan cache for recurring task decompositions.
Never semantic-cache high-risk tasks such as billing, security, production deploys, or current factual claims without validation.
Long-context optimization matters because Gemini’s long contexts and other frontier models invite waste. Long context is not memory. It is an expensive transport. Cortex should use context budgets: include only relevant artifacts, compress history into structured summaries, and preserve raw evidence outside the prompt.
**6. Compound AI Systems**
Berkeley Gorilla and the Berkeley Function Calling Leaderboard are important because tool use is the substrate of agents. BFCL evaluates whether models can call functions accurately, including multi-turn and relevance scenarios ([BFCL](https://gorilla.cs.berkeley.edu/blogs/8_berkeley_function_calling_leaderboard.html), [leaderboard](https://gorilla.cs.berkeley.edu/leaderboard.html?trk=public_post_comment-text)). Gorilla’s broader work connects LLMs to APIs with retrieval and function-calling specialization.
DSPy matters because it turns prompting into compilation. For Cortex, DSPy-like optimization can tune worker prompts, router prompts, and evaluator prompts against trace-derived datasets.
LOTUS is a newer example of declarative AI data processing. It implements a semantic operator model for text, document, structured, and unstructured data processing ([LOTUS](https://lotus-data.github.io/)). The key architectural lesson is that AI calls can be operators in a query plan. For Cortex, this suggests a future “agent query planner”: tasks compile into operations such as retrieve, classify, extract, rank, synthesize, verify, and act.
A good Cortex architecture should therefore look less like a chatbot framework and more like a distributed query/workflow engine:
```text
User Task
  -> Brain: classify, risk-score, budget
  -> Planner: produce typed DAG
  -> Router: choose model/worker/tool policy per node
  -> Workers: execute nodes with bounded autonomy
  -> Blackboard: persist artifacts and state
  -> Verifiers: evaluate outputs
  -> Optimizer: learn from traces offline
```
**7. Bleeding-Edge Capabilities**
Tool and computer-use agents are now mainstream. OpenAI’s Responses API includes hosted tools such as web search, file search, and computer use ([OpenAI tools](https://platform.openai.com/docs/guides/tools?api-mode=responses)). o3 and o4-mini extended reasoning models into tool use, including web, Python, files, images, and other tools ([OpenAI o3/o4-mini](https://openai.com/index/introducing-o3-and-o4-mini/), [system card](https://openai.com/index/o3-o4-mini-system-card)). This is a major shift: reasoning and acting are no longer separate product categories.
Multimodal agents are also becoming normal. o3/o4-mini reason over images; Gemini 2.5 and later Gemini lines emphasize multimodal reasoning; DeepMind’s SIMA 2 and Genie 3 point toward embodied and simulated-environment agents ([SIMA 2](https://deepmind.google/en/blog/sima-2-an-agent-that-plays-reasons-and-learns-with-you-in-virtual-3d-worlds/), [Genie 3](https://deepmind.google/blog/genie-3-a-new-frontier-for-world-models/)). For Cortex, multimodal support should be an artifact type, not a special case. Images, videos, browser screenshots, logs, traces, PDFs, and UI states should all enter the blackboard with metadata and tool affordances.
Reasoning models are useful but not universally best. They are slower, costlier, and sometimes weaker at strict structured tool calling than non-reasoning models. Cortex should route reasoning models to tasks with planning depth, ambiguous constraints, math, architecture, security analysis, or multi-step debugging. Use cheaper fast models for extraction, classification, summarization, and simple tool calls.
Long context, such as Gemini’s million-token-class context windows, changes retrieval strategy but does not eliminate it. The right design is hierarchical context: full corpus in storage, retrieved evidence in working context, compressed task state in memory, and raw artifacts linked by ID.
Distillation for routing is one of Cortex’s biggest opportunities. A small local or cheap hosted classifier can learn to predict: “Claude Opus for architecture review,” “GPT reasoning model for math/tool synthesis,” “Gemini long-context for giant document/codebase ingestion,” “cheap model for classification,” and “parallel run because confidence is low.” RouteLLM is the right conceptual template.
**What Cortex Should Build**
Cortex should build a Rust orchestration kernel with these primitives.
First, a typed event-sourced runtime. Every model call, tool call, handoff, artifact write, policy decision, and human approval should be an event. This gives replay, observability, debugging, billing, and self-improvement data.
Second, a declarative topology layer. Support supervisor, hierarchical, sequential, parallel, debate/review, swarm handoff, and evaluator-search patterns. Topologies should compile to a state machine. Do not let agent topology exist only inside prompts.
Third, a Brain/Worker contract. The Brain owns decomposition, routing, policy, budgets, and final acceptance. Workers own bounded execution. Workers receive explicit scopes: allowed tools, max cost, max wall time, artifact inputs, and output schema.
Fourth, a context and memory substrate. Use SQLite/Postgres-style relational metadata plus object storage for artifacts plus vector indexes for semantic retrieval. Memory records need provenance, TTL, confidence, owner, and invalidation. Never store unscoped “memories” as universal truth.
Fifth, provider abstraction without lowest-common-denominator blindness. Claude, GPT, and Gemini have different strengths and APIs. Cortex should expose a normalized internal interface but preserve provider-specific capabilities: reasoning effort, tool modes, long context, cache controls, JSON/schema constraints, computer use, file search, and safety settings.
Sixth, policy-as-code. Build an orchestration constitution enforced by the runtime: tool permissions, data boundaries, human approval, spend limits, network access, secret handling, and deploy constraints. Let models advise on policy interpretation, but do not let them enforce hard gates.
Seventh, routing and cascades. Start with deterministic route rules and logging. Add learned routing once traces exist. Use cheap-first cascades, but allow direct frontier routing for high-risk or high-value tasks. Track regret: when cheap routing caused escalation or failure.
Eighth, verifier-first autonomy. Every serious worker output should have acceptance checks: tests, schema validation, diff review, citation verification, factual freshness checks, or human signoff. AlphaEvolve’s lesson is that autonomy scales when evaluation is objective.
Ninth, isolated execution. For coding and computer-use workers, use containers, worktrees, filesystem sandboxes, network controls, and explicit destructive-action approvals. Cursor’s worktree isolation and Cline’s approval model are both worth copying.
Tenth, an optimization lab. Cortex should continuously mine traces into eval sets. Prompt, route, topology, and memory changes should go through offline evaluation and canary rollout. This is the safe version of self-improvement.
The strategic bet: Cortex should not compete with LangGraph, AutoGen, CrewAI, or vendor SDKs as a Python framework. It should be the durable, provider-neutral, Rust control plane underneath them: an orchestration engine that can run Claude, GPT, Gemini, MCP tools, A2A peers, coding sandboxes, verifiers, and learned routers with production-grade state and governance.
