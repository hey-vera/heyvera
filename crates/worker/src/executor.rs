use std::collections::HashSet;

use cortex_core::error::CortexError;
use cortex_core::execution_job::{
    BackendKind, Blocked, BlockedReason, Budgets, EffortApplication, ExecutionJob, ModelRef,
    ResourceProfile, EXECUTION_JOB_VERSION,
};
use cortex_core::egress::EgressPlan;
use cortex_core::failure::{WorkerFailureKind, WorkerFailureReport};
use cortex_core::protocol::{
    CheckEvidence, CommandEvidence, GitEvidence, StepOutput, WorkerEvidencePacket,
};
use cortex_core::provider::ProviderId;
use cortex_core::routing::RoutingDecision;
use cortex_core::task::TaskContract;
use tokio::sync::mpsc;

use crate::sandbox::{OutputStream, SandboxExit, SandboxRequest, SandboxRunner};
use crate::stream::WorkerEvent;
use crate::worktree;

const REQUIRED_CHECK_TIMEOUT_SECS: u64 = 120;

pub struct StepExecution {
    pub step_id: String,
    pub attempt_id: String,
    pub lease_gen: i64,
    /// What the planner decided this step may reach.
    ///
    /// Carried rather than computed: the worker cannot see the repository the
    /// plan was made against, and a boundary that re-derives its own permission
    /// is a boundary that can disagree with the record of what was authorised.
    /// [`Default`] is `Deny`, so a caller that does not set it opens nothing.
    pub egress: EgressPlan,
}

/// How the provider was invoked, and what the backend did with the effort
/// request.
///
/// `effort_applied` is produced by the code that builds the invocation, not by
/// the caller that asked, which is what stops a CLI silently swallowing a level
/// it cannot honour.
struct BackendInvocation {
    program: String,
    args: Vec<String>,
    backend_kind: BackendKind,
    effort_applied: EffortApplication,
}

pub struct Executor;

impl Executor {
    /// Run one step inside a sandbox, or refuse.
    ///
    /// There is no path through this function that executes a provider CLI on
    /// the host. If the worktree cannot be created or the sandbox cannot be
    /// established, the step is [`WorkerEvent::Blocked`] and the provider is
    /// never invoked. That is the behavioural change: isolation used to be
    /// best-effort, and a failure to isolate silently became execution in the
    /// caller's directory with the worker's full environment.
    pub async fn execute<R: SandboxRunner>(
        task: &TaskContract,
        decision: &RoutingDecision,
        step: &StepExecution,
        tx: mpsc::Sender<WorkerEvent>,
        working_dir: &std::path::Path,
        runner: &R,
    ) -> Result<i32, CortexError> {
        let invocation = build_command(decision)?;

        // Build the job before announcing the start, so the announcement can
        // carry it. Nothing about the job depends on the workspace.
        let mut job = build_job(step, decision, runner, &invocation);
        job.record_effort_application(invocation.effort_applied.clone());

        tx.send(WorkerEvent::Started {
            step_id: step.step_id.clone(),
            attempt_id: step.attempt_id.clone(),
            lease_gen: step.lease_gen,
            provider: decision.provider.to_string(),
            model: decision.model_id.clone(),
            execution_job: Box::new(job.clone()),
        })
        .await
        .ok();

        // An isolated worktree is required, not attempted. There is no
        // fallback to `working_dir`.
        let mut worktree_guard = match worktree::create_worktree(working_dir, &step.step_id) {
            Ok(guard) => guard,
            Err(e) => {
                let blocked = Blocked::new(
                    BlockedReason::WorktreeUnavailable,
                    format!("could not create an isolated worktree: {e}"),
                );
                return Self::block(step, &tx, blocked).await;
            }
        };
        let workspace = worktree_guard.path().to_path_buf();

        let mut prompt_args = invocation.args.clone();
        prompt_args.push(build_task_prompt(task));
        let request = SandboxRequest::new(&workspace, &invocation.program, prompt_args);

        let base_commit = get_git_head(Some(workspace.as_path()));

        let result = Self::run_sandboxed(
            runner,
            &job,
            &request,
            step,
            &tx,
            decision,
            &workspace,
            base_commit,
            task,
            &mut worktree_guard,
        )
        .await;

        // Teardown of the workspace runs on every path, including refusal.
        if let Err(e) = worktree_guard.cleanup() {
            tracing::warn!(error = %e, "worktree cleanup failed");
        }

        result
    }

    /// Run a step in the default sandbox for this deployment.
    ///
    /// A runtime that cannot be reached is a [`BlockedReason::SandboxUnavailable`]
    /// refusal, not a reason to run the agent on the host. This is the entry
    /// point callers should use; [`execute`](Self::execute) stays generic so a
    /// microVM runner and the test doubles can be substituted.
    pub async fn execute_sandboxed(
        task: &TaskContract,
        decision: &RoutingDecision,
        step: &StepExecution,
        tx: mpsc::Sender<WorkerEvent>,
        working_dir: &std::path::Path,
    ) -> Result<i32, CortexError> {
        let runner = match crate::sandbox::ContainerSandbox::new(runner_image()) {
            Ok(runner) => runner,
            Err(blocked) => return Self::block(step, &tx, blocked).await,
        };
        Self::execute(task, decision, step, tx, working_dir, &runner).await
    }

    /// Emit a typed refusal and return without invoking anything.
    async fn block(
        step: &StepExecution,
        tx: &mpsc::Sender<WorkerEvent>,
        blocked: Blocked,
    ) -> Result<i32, CortexError> {
        tracing::warn!(
            step_id = %step.step_id,
            reason = blocked.reason.as_str(),
            detail = %blocked.detail,
            "step blocked; the provider was not invoked"
        );
        let message = blocked.to_string();
        tx.send(WorkerEvent::Blocked {
            step_id: step.step_id.clone(),
            attempt_id: step.attempt_id.clone(),
            lease_gen: step.lease_gen,
            blocked,
        })
        .await
        .ok();
        Err(CortexError::WorkerExecution(message))
    }

    /// Stream the sandbox, then emit the final Completed/Failed event.
    ///
    /// Factored out so that workspace teardown in `execute()` runs
    /// unconditionally after this returns.
    #[allow(clippy::too_many_arguments)]
    async fn run_sandboxed<R: SandboxRunner>(
        runner: &R,
        job: &ExecutionJob,
        request: &SandboxRequest,
        step: &StepExecution,
        tx: &mpsc::Sender<WorkerEvent>,
        decision: &RoutingDecision,
        workspace: &std::path::Path,
        base_commit: Option<String>,
        task: &TaskContract,
        worktree_guard: &mut crate::worktree::WorktreeGuard,
    ) -> Result<i32, CortexError> {
        let mut session = match runner.submit(job, request).await {
            Ok(session) => session,
            // The sandbox could not be established. The provider was never
            // invoked, and this is a refusal rather than a task failure.
            Err(blocked) => return Self::block(step, tx, blocked).await,
        };

        let step_id = step.step_id.clone();
        let attempt_id = step.attempt_id.clone();
        let lease_gen = step.lease_gen;
        let provider = decision.provider;

        let mut last_text = String::new();
        let mut collected_output: Vec<String> = Vec::new();
        let mut files_changed: HashSet<String> = HashSet::new();
        let mut usage: Option<(i64, i64)> = None;
        let mut stderr_text = String::new();

        while let Some(entry) = session.next_line().await {
            let line = entry.text;

            if entry.stream == OutputStream::Stderr {
                if stderr_text.len() < 500 {
                    if !stderr_text.is_empty() {
                        stderr_text.push('\n');
                    }
                    stderr_text.push_str(&line);
                }
                continue;
            }

            {
                // Extract text, files, and usage based on provider
                let output = match provider {
                    ProviderId::Claude => {
                        extract_claude_files(&line, &mut files_changed);
                        if let Some(u) = extract_claude_usage(&line) {
                            usage = Some(u);
                        }
                        extract_claude_text(&line)
                    }
                    ProviderId::Openai => {
                        extract_codex_files(&line, &mut files_changed);
                        if let Some(u) = extract_codex_usage(&line) {
                            usage = Some(u);
                        }
                        extract_codex_text(&line)
                    }
                    ProviderId::Gemini => {
                        extract_gemini_files(&line, &mut files_changed);
                        extract_gemini_text(&line)
                    }
                    // Unreachable in practice — build_command rejects Zen
                    // before a process exists — but total for the compiler.
                    ProviderId::Zen => Some(line.clone()),
                };
                if let Some(text) = output {
                    if text != last_text {
                        last_text.clone_from(&text);
                        if collected_output.len() < 50 {
                            collected_output.push(text.clone());
                        }
                        let _ = tx
                            .send(WorkerEvent::Output {
                                step_id: step_id.clone(),
                                attempt_id: attempt_id.clone(),
                                lease_gen,
                                line: text,
                            })
                            .await;
                    }
                }
            }
        }

        let parsed_files_changed: Vec<String> = files_changed.into_iter().collect();

        let exit = match session.wait().await {
            Ok(exit) => exit,
            // The runtime failed mid-run and we do not know what happened.
            // Guessing here would become an unverified delivery.
            Err(blocked) => return Self::block(step, tx, blocked).await,
        };

        let code = match exit {
            SandboxExit::Exited { code } => code,
            // The wall-clock cap fired. Cortex stopped; it did not silently
            // continue and it did not silently abandon.
            SandboxExit::BudgetExhausted => {
                tracing::warn!(
                    step_id = %step.step_id,
                    wall_clock_secs = job.budgets.wall_clock.as_secs(),
                    "sandbox reached its wall-clock budget and was torn down"
                );
                // Worded so `classify_exit` reaches ProcessTimeout: a budget
                // stop is a timeout, and must not be classified Unknown.
                if stderr_text.is_empty() {
                    stderr_text = "timeout: sandbox reached its wall-clock budget".to_string();
                }
                124
            }
            // Attributed to the stop, not to the customer's work.
            SandboxExit::Killed => {
                if stderr_text.is_empty() {
                    stderr_text = "sandbox was torn down on request".to_string();
                }
                137
            }
        };

        let effective_dir = Some(workspace);
        let mut worktree_guard = Some(&mut *worktree_guard);

        let event = if code == 0 {
            let summary = if collected_output.is_empty() {
                String::new()
            } else {
                let last_lines: Vec<&str> = collected_output
                    .iter()
                    .rev()
                    .take(5)
                    .collect::<Vec<_>>()
                    .into_iter()
                    .rev()
                    .map(|s| s.as_str())
                    .collect();
                last_lines.join("\n")
            };

            let check_evidence = if let Some(dir) = effective_dir {
                run_required_checks(task, dir, runner, job).await
            } else {
                Vec::new()
            };

            // Auto-commit any uncommitted changes left by the CLI tool.
            // Only for execute-tier tasks (not search/think) that actually
            // produced file changes.
            let mut branch_name: Option<String> = None;
            if let Some(guard) = worktree_guard.as_ref() {
                let is_execute_tier = task.tier == cortex_core::provider::Tier::Execute;
                if is_execute_tier && guard.has_uncommitted_changes() {
                    let precommit_git_evidence = effective_dir.and_then(|dir| {
                        worktree::collect_git_evidence(
                            dir,
                            base_commit.as_deref(),
                            Some(guard.branch_name()),
                        )
                    });
                    let changed_files = precommit_git_evidence
                        .as_ref()
                        .map(|evidence| evidence.changed_files.as_slice())
                        .unwrap_or(&[]);
                    let policy_violation = changed_files_have_policy_violation(
                        changed_files,
                        &task.allowed_paths,
                        &task.forbidden_paths,
                    );
                    let checks_passed = required_checks_allow_commit(&check_evidence);

                    if policy_violation || !checks_passed {
                        tracing::warn!(
                            step_id = %step.step_id,
                            policy_violation,
                            checks_passed,
                            "skipping auto-commit for work that cannot satisfy the dispatch contract"
                        );
                    } else {
                        let commit_msg = format!("cortex: {}", task.objective);
                        match guard.commit_changes(&commit_msg) {
                            Ok(Some(hash)) => {
                                tracing::info!(
                                    step_id = %step.step_id,
                                    commit = %hash,
                                    "auto-committed uncommitted changes"
                                );
                            }
                            Ok(None) => {
                                tracing::debug!(
                                    step_id = %step.step_id,
                                    "no staged changes after git add"
                                );
                            }
                            Err(e) => {
                                tracing::warn!(
                                    step_id = %step.step_id,
                                    error = %e,
                                    "auto-commit failed, changes may be lost"
                                );
                            }
                        }
                    }
                }
            }

            let head_commit = get_git_head(effective_dir);

            // If head moved from base, keep the branch for PR creation.
            let has_changes = match (&base_commit, &head_commit) {
                (Some(base), Some(head)) => base != head,
                _ => false,
            };
            if has_changes {
                if let Some(guard) = worktree_guard.as_mut() {
                    guard.set_keep_branch(true);
                    branch_name = Some(guard.branch_name().to_string());
                    tracing::info!(
                        step_id = %step.step_id,
                        branch = %branch_name.as_deref().unwrap_or("?"),
                        "branch preserved for PR creation"
                    );
                }
            }

            let git_evidence = effective_dir.and_then(|dir| {
                worktree::collect_git_evidence(
                    dir,
                    base_commit.as_deref(),
                    worktree_guard.as_ref().map(|guard| guard.branch_name()),
                )
            });
            let files_changed =
                completion_files_changed(git_evidence.as_ref(), parsed_files_changed.clone());

            let (tokens_in, tokens_out) = match usage {
                Some((i, o)) => (Some(i), Some(o)),
                None => (None, None),
            };
            let cost_estimate = tokens_in.and_then(|ti| {
                tokens_out.map(|to| {
                    cortex_core::usage::estimate_cost(
                        &decision.provider.to_string(),
                        &decision.model_id,
                        ti,
                        to,
                    )
                })
            });

            WorkerEvent::Completed {
                step_id: step.step_id.clone(),
                attempt_id: step.attempt_id.clone(),
                lease_gen: step.lease_gen,
                exit_code: code,
                base_commit: base_commit.clone(),
                head_commit,
                branch: branch_name,
                output: StepOutput {
                    summary: summary.clone(),
                    files_found: Vec::new(),
                    files_changed,
                    evidence: Some(WorkerEvidencePacket {
                        git: git_evidence,
                        command: CommandEvidence {
                            exit_code: code,
                            stdout_excerpt: excerpt_from_lines(&collected_output, 4_000),
                            stderr_excerpt: excerpt_from_text(&stderr_text, 2_000),
                            log_summary: if summary.is_empty() {
                                None
                            } else {
                                Some(summary)
                            },
                        },
                        checks: check_evidence,
                        parsed_files_changed,
                    }),
                    tokens_in,
                    tokens_out,
                    cost_estimate,
                    structured: serde_json::Value::Null,
                },
            }
        } else {
            let kind = classify_exit(code, &stderr_text);
            WorkerEvent::Failed {
                step_id: step.step_id.clone(),
                attempt_id: step.attempt_id.clone(),
                lease_gen: step.lease_gen,
                failure: WorkerFailureReport {
                    kind,
                    exit_code: Some(code),
                    stderr_excerpt: if stderr_text.is_empty() {
                        None
                    } else {
                        Some(stderr_text)
                    },
                    tool: Some(decision.provider.cli_name().to_string()),
                },
            }
        };
        tx.send(event).await.ok();

        Ok(code)
    }
}

fn classify_exit(code: i32, stderr: &str) -> WorkerFailureKind {
    let lower = stderr.to_lowercase();
    if lower.contains("not found") || lower.contains("command not found") {
        WorkerFailureKind::CliNotFound
    } else if lower.contains("not authenticated") || lower.contains("login") {
        WorkerFailureKind::CliNotAuthenticated
    } else if lower.contains("rate limit") || lower.contains("429") {
        WorkerFailureKind::CliRateLimited
    } else if lower.contains("timeout") {
        WorkerFailureKind::ProcessTimeout
    } else if code == 137 || code == -9 {
        WorkerFailureKind::ProcessKilled
    } else {
        WorkerFailureKind::Unknown
    }
}

fn extract_claude_text(line: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(line).ok()?;
    match v.get("type")?.as_str()? {
        "assistant" => {
            let content_val = v.get("message")?.get("content")?;
            // Handle content as a plain string
            if let Some(s) = content_val.as_str() {
                return if s.is_empty() {
                    None
                } else {
                    Some(s.to_string())
                };
            }
            // Handle content as an array of blocks
            let content = content_val.as_array()?;
            let mut texts = Vec::new();
            for item in content {
                if item.get("type").and_then(|t| t.as_str()) == Some("text") {
                    if let Some(t) = item.get("text").and_then(|t| t.as_str()) {
                        texts.push(t.to_string());
                    }
                }
            }
            if texts.is_empty() {
                None
            } else {
                Some(texts.join(""))
            }
        }
        "content_block_delta" => v
            .get("delta")
            .and_then(|d| d.get("text"))
            .and_then(|t| t.as_str())
            .map(|s| s.to_string()),
        "error" => {
            let msg = v
                .get("error")
                .and_then(|e| e.get("message"))
                .and_then(|m| m.as_str())
                .or_else(|| v.get("error").and_then(|e| e.as_str()))
                .unwrap_or("unknown error");
            Some(format!("[error] {msg}"))
        }
        "result" => v
            .get("result")
            .and_then(|r| r.as_str())
            .map(|s| s.to_string()),
        _ => None,
    }
}

fn build_command(decision: &RoutingDecision) -> Result<BackendInvocation, CortexError> {
    let (program, args) = match decision.provider {
        ProviderId::Claude => {
            let mut args = vec![
                "-p".to_string(),
                "--output-format".to_string(),
                "stream-json".to_string(),
                "--verbose".to_string(),
                "--no-session-persistence".to_string(),
            ];
            if !decision.model_id.is_empty() {
                args.push("--model".to_string());
                args.push(decision.model_id.clone());
            }
            ("claude".to_string(), args)
        }
        ProviderId::Openai => (
            "codex".to_string(),
            vec![
                "exec".to_string(),
                "-c".to_string(),
                format!("model={}", decision.model_id),
                "-c".to_string(),
                "approval_policy=never".to_string(),
            ],
        ),
        ProviderId::Gemini => {
            // This arm previously returned a bare `gemini` with no arguments,
            // which silently discarded the routed model: the router chose one
            // model and a different one ran. "Which model actually ran" has to
            // be unforgeable, so the model travels in the invocation.
            let mut args = Vec::new();
            if !decision.model_id.is_empty() {
                args.push("--model".to_string());
                args.push(decision.model_id.clone());
            }
            ("gemini".to_string(), args)
        }
        // API-only: the worker executes CLIs, and Zen has none. Routing must
        // send Zen work down the HTTP path, never to a worker.
        ProviderId::Zen => return Err(CortexError::ProviderNotAuthenticated(ProviderId::Zen)),
    };

    Ok(BackendInvocation {
        program,
        args,
        backend_kind: BackendKind::Cli,
        // None of these CLIs exposes a reasoning-effort control; they are
        // invoked with model flags only. Reporting `Unsupported` rather than
        // accepting the request is the whole point — a receipt must never
        // claim a level the backend did not apply. When effort-controlled work
        // needs a real dial, it goes down the HTTP path, and that routing
        // decision is made with this field rather than in spite of it.
        effort_applied: EffortApplication::NotRequested,
    })
}

/// Assemble the job for one attempt.
///
/// Every field is set, including the ones nothing populates yet, because the
/// job is the record of what ran and a field added later cannot describe work
/// that already happened.
fn build_job<R: SandboxRunner>(
    step: &StepExecution,
    decision: &RoutingDecision,
    runner: &R,
    invocation: &BackendInvocation,
) -> ExecutionJob {
    let mut job = ExecutionJob {
        job_id: uuid::Uuid::new_v4().to_string(),
        job_version: EXECUTION_JOB_VERSION,
        run_id: String::new(),
        step_id: step.step_id.clone(),
        attempt_id: step.attempt_id.clone(),
        lease_gen: step.lease_gen,
        // `catalog_version` stays None until a versioned catalog exists. The
        // identity is recorded now regardless.
        model_ref: ModelRef::uncatalogued(decision.model_id.clone()),
        backend_kind: invocation.backend_kind,
        // No effort dial yet. The field is present so the interface does not
        // need re-cutting when there is one.
        effort: None,
        effort_applied: invocation.effort_applied.clone(),
        // No quote persists a per-step budget yet, so only the wall clock
        // bounds this attempt. The runner logs that rather than treating an
        // unpriced job as a bounded one.
        budgets: Budgets::unquoted(),
        // Decided at plan time, against a repository this process cannot see.
        // Both halves come from the same derivation, which is what keeps the
        // allowlist from naming a host no grant justifies.
        network_policy: step.egress.network_policy.clone(),
        capability_grants: step.egress.capability_grants.clone(),
        context_bundle: None,
        quote_id: None,
        plan_receipt_id: None,
        image_ref: runner_image(),
        isolation_class: runner.isolation_class(),
        resource_profile: ResourceProfile::default(),
        // Filled in below from the policy above, so the receipt cannot drift
        // from what the runner will actually enforce.
        effective_egress: None,
        egress_mediator: None,
    };

    // What was *enforced*, derived from the job rather than asserted beside it.
    // This intersects the allowlist with the grants, so it records what the
    // sandbox will actually open — not what the planner asked for. The two
    // agree when the plan came from `derive_egress`; the intersection is what
    // makes them provably agree rather than assumed to.
    let endpoints = crate::sandbox::policy::effective_endpoints(&job);
    job.egress_mediator = if endpoints.is_empty() {
        None
    } else {
        Some(crate::sandbox::egress::mediator_image())
    };
    job.effective_egress = Some(endpoints.iter().map(|e| e.to_string()).collect());
    job
}

/// The image the agent sandbox runs.
///
/// Distinct from the verification check runner's image: this one carries the
/// provider CLIs, and that one must not. Validating that this is a digest
/// rather than a mutable tag belongs to the signed runner registry; recording
/// whatever was configured is this crate's job, so the receipt is honest
/// either way.
pub fn runner_image() -> String {
    std::env::var("CORTEX_SANDBOX_IMAGE").unwrap_or_else(|_| "cortex/sandbox:dev".to_string())
}

fn build_task_prompt(task: &TaskContract) -> String {
    let mut lines = vec![
        "Cortex dispatch contract".to_string(),
        format!("Objective: {}", task.objective),
    ];

    if let Some(recipe) = &task.work_recipe {
        lines.push(format!("Work kind: {}", recipe.kind.as_str()));
        push_list(&mut lines, "Target paths", &recipe.target_paths);
    }

    push_list(&mut lines, "Allowed paths", &task.allowed_paths);
    push_list(&mut lines, "Forbidden paths", &task.forbidden_paths);

    if let Some(base) = &task.expected_base_commit {
        lines.push(format!("Expected base commit: {base}"));
    }

    if !task.required_checks.is_empty() {
        lines.push("Required checks:".to_string());
        for check in &task.required_checks {
            let requirement = if check.required {
                "required"
            } else {
                "optional"
            };
            lines.push(format!(
                "- {} ({requirement}): {}",
                check.name, check.command
            ));
        }
    }

    let acceptance_texts: Vec<String> = task
        .work_recipe
        .as_ref()
        .map(|recipe| {
            recipe
                .acceptance
                .iter()
                .map(|criterion| criterion.text.clone())
                .collect()
        })
        .unwrap_or_else(|| task.acceptance_criteria.clone());
    push_list(&mut lines, "Acceptance criteria", &acceptance_texts);

    if let Some(recipe) = &task.work_recipe {
        push_list(&mut lines, "Constraints", &recipe.constraints);
    }

    lines.push(
        "Follow the contract exactly. Report changed files and verification results.".to_string(),
    );
    lines.join("\n")
}

fn push_list(lines: &mut Vec<String>, label: &str, values: &[String]) {
    if values.is_empty() {
        return;
    }
    lines.push(format!("{label}:"));
    for value in values {
        lines.push(format!("- {value}"));
    }
}

pub fn check_cli_available(provider: ProviderId) -> bool {
    let cmd = provider.cli_name();
    std::process::Command::new("which")
        .arg(cmd)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

pub fn detect_available_providers() -> Vec<ProviderId> {
    [ProviderId::Claude, ProviderId::Openai, ProviderId::Gemini]
        .into_iter()
        .filter(|p| check_cli_available(*p))
        .collect()
}

/// Extract token usage from Claude's final `result` event in stream-json output.
/// The event looks like:
/// `{"type":"result","result":"...","is_error":false,"duration_ms":1234,"num_turns":1,
///   "usage":{"input_tokens":1234,"output_tokens":567,"cache_creation_input_tokens":0,
///            "cache_read_input_tokens":0}}`
fn extract_claude_usage(line: &str) -> Option<(i64, i64)> {
    let v: serde_json::Value = serde_json::from_str(line).ok()?;
    if v.get("type")?.as_str()? != "result" {
        return None;
    }
    let usage = v.get("usage")?;
    let base_input = usage.get("input_tokens")?.as_i64()?;
    let output = usage.get("output_tokens")?.as_i64()?;
    // Cache tokens count toward billing — add them to input total
    let cache_creation = usage
        .get("cache_creation_input_tokens")
        .and_then(|t| t.as_i64())
        .unwrap_or(0);
    let cache_read = usage
        .get("cache_read_input_tokens")
        .and_then(|t| t.as_i64())
        .unwrap_or(0);
    Some((base_input + cache_creation + cache_read, output))
}

/// Extract token usage from Codex CLI output.
/// Codex output format may vary; this is a best-effort extractor.
/// Returns None if the format isn't recognized.
fn extract_codex_usage(line: &str) -> Option<(i64, i64)> {
    let v: serde_json::Value = serde_json::from_str(line).ok()?;
    // Try common field names for token usage
    let input = v
        .get("usage")
        .and_then(|u| u.get("input_tokens").or_else(|| u.get("prompt_tokens")))
        .and_then(|t| t.as_i64())?;
    let output = v
        .get("usage")
        .and_then(|u| {
            u.get("output_tokens")
                .or_else(|| u.get("completion_tokens"))
        })
        .and_then(|t| t.as_i64())?;
    Some((input, output))
}

fn extract_claude_files(line: &str, files: &mut HashSet<String>) {
    let v: serde_json::Value = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(_) => return,
    };
    if v.get("type").and_then(|t| t.as_str()) != Some("assistant") {
        return;
    }
    let content = match v
        .get("message")
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_array())
    {
        Some(c) => c,
        None => return,
    };
    for item in content {
        if item.get("type").and_then(|t| t.as_str()) != Some("tool_use") {
            continue;
        }
        let name = item.get("name").and_then(|n| n.as_str()).unwrap_or("");
        let input = match item.get("input") {
            Some(i) => i,
            None => continue,
        };
        match name {
            "Write" | "Edit" | "Read" | "MultiEdit" => {
                if let Some(p) = input.get("file_path").and_then(|p| p.as_str()) {
                    files.insert(p.to_string());
                }
            }
            "Bash" => {
                if let Some(cmd) = input.get("command").and_then(|c| c.as_str()) {
                    extract_paths_from_command(cmd, files);
                }
            }
            _ => {}
        }
    }
}

/// Extract file paths from a shell command string.
/// Looks for tokens starting with `/` or `./` that look like file paths.
fn extract_paths_from_command(cmd: &str, files: &mut HashSet<String>) {
    for token in cmd.split_whitespace() {
        // Strip common shell operators/quotes from the token
        let cleaned = token.trim_matches(|c: char| c == '"' || c == '\'' || c == ';' || c == '|');
        if (cleaned.starts_with('/') || cleaned.starts_with("./")) && cleaned.len() > 1 {
            // Skip things that look like flags or common non-file paths
            if cleaned.starts_with("//") || cleaned == "./" {
                continue;
            }
            files.insert(cleaned.to_string());
        }
    }
}

/// Extract text from Codex CLI JSON-line output.
/// Codex emits `{"type":"message","content":[{"type":"text","text":"..."}]}` lines.
fn extract_codex_text(line: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(line).ok()?;
    if v.get("type")?.as_str()? != "message" {
        return None;
    }
    let content = v.get("content")?.as_array()?;
    let mut texts = Vec::new();
    for item in content {
        if item.get("type").and_then(|t| t.as_str()) == Some("text") {
            if let Some(t) = item.get("text").and_then(|t| t.as_str()) {
                texts.push(t.to_string());
            }
        }
    }
    if texts.is_empty() {
        None
    } else {
        Some(texts.join(""))
    }
}

/// Extract file changes from Codex CLI output.
/// Codex emits `{"type":"patch","path":"..."}` for file changes.
fn extract_codex_files(line: &str, files: &mut HashSet<String>) {
    let v: serde_json::Value = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(_) => return,
    };
    if v.get("type").and_then(|t| t.as_str()) == Some("patch") {
        if let Some(p) = v.get("path").and_then(|p| p.as_str()) {
            files.insert(p.to_string());
        }
    }
}

/// Extract text from Gemini CLI output.
/// Gemini CLI outputs plain text, so return the trimmed line as-is.
fn extract_gemini_text(line: &str) -> Option<String> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

/// Extract files from Gemini CLI output.
/// No structured file output format known yet — no-op.
fn extract_gemini_files(_line: &str, _files: &mut HashSet<String>) {
    // Gemini CLI doesn't emit structured file change events yet
}

fn get_git_head(working_dir: Option<&std::path::Path>) -> Option<String> {
    let mut cmd = std::process::Command::new("git");
    cmd.args(["rev-parse", "HEAD"]);
    if let Some(dir) = working_dir {
        cmd.current_dir(dir);
    }
    cmd.output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
}

fn completion_files_changed(
    git_evidence: Option<&GitEvidence>,
    parsed_files_changed: Vec<String>,
) -> Vec<String> {
    match git_evidence {
        Some(evidence) => evidence.changed_files.clone(),
        None => parsed_files_changed,
    }
}

fn required_checks_allow_commit(checks: &[CheckEvidence]) -> bool {
    checks
        .iter()
        .filter(|check| check.required)
        .all(|check| !check.timed_out && check.exit_code == Some(0))
}

fn changed_files_have_policy_violation(
    changed_files: &[String],
    allowed_paths: &[String],
    forbidden_paths: &[String],
) -> bool {
    changed_files.iter().any(|path| {
        let Ok(normalized) = normalize_repo_path(path) else {
            return true;
        };

        let forbidden = forbidden_paths.iter().any(|forbidden| {
            normalize_repo_path(forbidden)
                .map(|forbidden| path_matches_contract_path(&normalized, &forbidden))
                .unwrap_or(false)
        });
        if forbidden {
            return true;
        }

        if allowed_paths.is_empty() || allowed_paths.iter().any(|path| path.trim() == "*") {
            return false;
        }

        !allowed_paths.iter().any(|allowed| {
            normalize_repo_path(allowed)
                .map(|allowed| path_matches_contract_path(&normalized, &allowed))
                .unwrap_or(false)
        })
    })
}

fn path_matches_contract_path(path: &str, contract_path: &str) -> bool {
    if contract_path.is_empty() {
        return false;
    }

    path == contract_path || path.starts_with(&format!("{}/", contract_path.trim_end_matches('/')))
}

fn normalize_repo_path(path: &str) -> Result<String, ()> {
    let path = path.trim().replace('\\', "/");
    if path.is_empty() {
        return Err(());
    }

    let mut parts = Vec::new();
    for part in path.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                if parts.pop().is_none() {
                    return Err(());
                }
            }
            part => parts.push(part),
        }
    }

    if parts.is_empty() {
        Err(())
    } else {
        Ok(parts.join("/"))
    }
}

/// Run the contract's required checks as **diagnostics**, inside the sandbox.
///
/// These previously ran as `sh -lc` on the host, in the worktree the agent had
/// just written to. That is the same exposure as host-executing the agent
/// itself, and arguably a sharper one: a check command like `npm test` or
/// `make check` executes scripts the repository defines, so a task only had to
/// write a file to get host execution. It runs in the sandbox now.
///
/// The results remain worker-reported diagnostics. They cannot create a
/// verification badge or a positive routing reward — only independently
/// executed checks can do that.
async fn run_required_checks<R: SandboxRunner>(
    task: &TaskContract,
    working_dir: &std::path::Path,
    runner: &R,
    job: &ExecutionJob,
) -> Vec<CheckEvidence> {
    let mut results = Vec::new();

    for check in &task.required_checks {
        if check.command.trim().is_empty() {
            results.push(CheckEvidence {
                name: check.name.clone(),
                command: check.command.clone(),
                required: check.required,
                exit_code: None,
                stdout_excerpt: None,
                stderr_excerpt: Some("required check command is empty".to_string()),
                timed_out: false,
                duration_ms: 0,
            });
            continue;
        }

        let started = std::time::Instant::now();

        // A fresh sandbox per check, bounded by the check timeout rather than
        // by the attempt's budget.
        let mut check_job = job.clone();
        check_job.job_id = uuid::Uuid::new_v4().to_string();
        check_job.budgets.wall_clock =
            std::time::Duration::from_secs(REQUIRED_CHECK_TIMEOUT_SECS);

        let request = SandboxRequest::new(
            working_dir,
            "sh",
            vec!["-lc".to_string(), check.command.clone()],
        );

        let session = match runner.submit(&check_job, &request).await {
            Ok(session) => session,
            Err(blocked) => {
                // A check that could not be executed is not a check that
                // passed. Record why, and leave the exit code unset so
                // nothing downstream can read it as success.
                results.push(CheckEvidence {
                    name: check.name.clone(),
                    command: check.command.clone(),
                    required: check.required,
                    exit_code: None,
                    stdout_excerpt: None,
                    stderr_excerpt: Some(blocked.to_string()),
                    timed_out: false,
                    duration_ms: started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64,
                });
                continue;
            }
        };

        let (stdout, stderr, exit) = drain_check_session(session).await;
        let duration_ms = started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;

        match exit {
            Ok(SandboxExit::Exited { code }) => {
                results.push(CheckEvidence {
                    name: check.name.clone(),
                    command: check.command.clone(),
                    required: check.required,
                    exit_code: Some(code),
                    stdout_excerpt: excerpt_from_text(&stdout, 4_000),
                    stderr_excerpt: excerpt_from_text(&stderr, 4_000),
                    timed_out: false,
                    duration_ms,
                });
            }
            Ok(SandboxExit::BudgetExhausted) => {
                results.push(CheckEvidence {
                    name: check.name.clone(),
                    command: check.command.clone(),
                    required: check.required,
                    exit_code: None,
                    stdout_excerpt: excerpt_from_text(&stdout, 4_000),
                    stderr_excerpt: excerpt_from_text(&stderr, 4_000),
                    timed_out: true,
                    duration_ms,
                });
            }
            Ok(SandboxExit::Killed) => {
                results.push(CheckEvidence {
                    name: check.name.clone(),
                    command: check.command.clone(),
                    required: check.required,
                    exit_code: None,
                    stdout_excerpt: excerpt_from_text(&stdout, 4_000),
                    stderr_excerpt: Some("check sandbox was torn down on request".to_string()),
                    timed_out: false,
                    duration_ms,
                });
            }
            Err(blocked) => {
                results.push(CheckEvidence {
                    name: check.name.clone(),
                    command: check.command.clone(),
                    required: check.required,
                    exit_code: None,
                    stdout_excerpt: excerpt_from_text(&stdout, 4_000),
                    stderr_excerpt: Some(blocked.to_string()),
                    timed_out: false,
                    duration_ms,
                });
            }
        }
    }

    results
}

/// Collect a check sandbox's output and outcome.
async fn drain_check_session(
    mut session: crate::sandbox::SandboxSession,
) -> (String, String, Result<SandboxExit, Blocked>) {
    let mut stdout = String::new();
    let mut stderr = String::new();
    while let Some(line) = session.next_line().await {
        let target = match line.stream {
            OutputStream::Stdout => &mut stdout,
            OutputStream::Stderr => &mut stderr,
        };
        if !target.is_empty() {
            target.push('\n');
        }
        target.push_str(&line.text);
    }
    let exit = session.wait().await;
    (stdout, stderr, exit)
}


fn excerpt_from_lines(lines: &[String], max_chars: usize) -> Option<String> {
    excerpt_from_text(&lines.join("\n"), max_chars)
}

fn excerpt_from_text(text: &str, max_chars: usize) -> Option<String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return None;
    }
    if trimmed.chars().count() <= max_chars {
        return Some(trimmed.to_string());
    }
    Some(trimmed.chars().take(max_chars).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_claude_content_block_delta() {
        let line = r#"{"type":"content_block_delta","delta":{"text":"Hello world"}}"#;
        let result = extract_claude_text(line);
        assert_eq!(result, Some("Hello world".to_string()));

        // Missing text field
        let line2 = r#"{"type":"content_block_delta","delta":{"type":"input_json_delta"}}"#;
        assert_eq!(extract_claude_text(line2), None);
    }

    #[test]
    fn task_prompt_includes_work_recipe_contract() {
        let mut task = TaskContract::new(
            "update lifecycle handling".to_string(),
            cortex_core::provider::Tier::Execute,
            cortex_core::routing::RiskLevel::Medium,
        )
        .with_dispatch_contract(
            vec!["crates/api/src/ws.rs".to_string()],
            Some("abc123".to_string()),
        );
        task.required_checks = vec![cortex_core::task::RequiredCheck {
            name: "cargo:check".to_string(),
            command: "cargo check -p cortex-api".to_string(),
            required: true,
        }];
        task.work_recipe = Some(cortex_core::task::WorkRecipe {
            version: 1,
            kind: cortex_core::task::WorkKind::Modify,
            objective: task.objective.clone(),
            target_paths: task.allowed_paths.clone(),
            required_checks: task.required_checks.clone(),
            acceptance: vec![cortex_core::task::AcceptanceCriterion {
                id: "required-check-cargo:check".to_string(),
                text: "Required check `cargo:check` passes".to_string(),
                verification: cortex_core::task::AcceptanceVerification::RequiredCheck {
                    check_name: "cargo:check".to_string(),
                },
            }],
            constraints: vec!["risk=Medium".to_string()],
        });

        let prompt = build_task_prompt(&task);

        assert!(prompt.contains("Objective: update lifecycle handling"));
        assert!(prompt.contains("Work kind: modify"));
        assert!(prompt.contains("- crates/api/src/ws.rs"));
        assert!(prompt.contains("Expected base commit: abc123"));
        assert!(prompt.contains("- cargo:check (required): cargo check -p cortex-api"));
        assert!(prompt.contains("Required check `cargo:check` passes"));
    }

    #[test]
    fn task_prompt_falls_back_without_work_recipe() {
        let mut task = TaskContract::new(
            "inspect the repo".to_string(),
            cortex_core::provider::Tier::Search,
            cortex_core::routing::RiskLevel::Low,
        );
        task.acceptance_criteria = vec!["Summarize the relevant files".to_string()];

        let prompt = build_task_prompt(&task);

        assert!(prompt.contains("Objective: inspect the repo"));
        assert!(prompt.contains("Summarize the relevant files"));
        assert!(!prompt.contains("Work kind:"));
    }

    #[test]
    fn test_claude_error_event() {
        let line = r#"{"type":"error","error":{"message":"rate limit exceeded"}}"#;
        let result = extract_claude_text(line);
        assert_eq!(result, Some("[error] rate limit exceeded".to_string()));

        // Error as plain string
        let line2 = r#"{"type":"error","error":"something went wrong"}"#;
        let result2 = extract_claude_text(line2);
        assert_eq!(result2, Some("[error] something went wrong".to_string()));
    }

    #[test]
    fn test_claude_string_content() {
        let line = r#"{"type":"assistant","message":{"content":"plain text response"}}"#;
        let result = extract_claude_text(line);
        assert_eq!(result, Some("plain text response".to_string()));
    }

    #[test]
    fn test_claude_multi_edit_files() {
        let line = r#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"MultiEdit","input":{"file_path":"/src/main.rs","edits":[]}},{"type":"tool_use","name":"Write","input":{"file_path":"/src/lib.rs"}}]}}"#;
        let mut files = HashSet::new();
        extract_claude_files(line, &mut files);
        assert!(files.contains("/src/main.rs"));
        assert!(files.contains("/src/lib.rs"));
        assert_eq!(files.len(), 2);
    }

    #[test]
    fn test_claude_bash_file_extraction() {
        let line = r#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"cat /etc/config.toml && cp ./src/foo.rs /tmp/out"}}]}}"#;
        let mut files = HashSet::new();
        extract_claude_files(line, &mut files);
        assert!(files.contains("/etc/config.toml"));
        assert!(files.contains("./src/foo.rs"));
        assert!(files.contains("/tmp/out"));
    }

    #[test]
    fn test_claude_files_dedup() {
        let line = r#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Write","input":{"file_path":"/src/main.rs"}},{"type":"tool_use","name":"Edit","input":{"file_path":"/src/main.rs"}}]}}"#;
        let mut files = HashSet::new();
        extract_claude_files(line, &mut files);
        assert_eq!(files.len(), 1);
        assert!(files.contains("/src/main.rs"));
    }

    #[test]
    fn test_claude_cache_usage() {
        let line = r#"{"type":"result","result":"done","usage":{"input_tokens":1000,"output_tokens":500,"cache_creation_input_tokens":200,"cache_read_input_tokens":300}}"#;
        let result = extract_claude_usage(line);
        // 1000 + 200 + 300 = 1500 total input tokens
        assert_eq!(result, Some((1500, 500)));
    }

    #[test]
    fn test_claude_usage_no_cache() {
        let line = r#"{"type":"result","result":"done","usage":{"input_tokens":1000,"output_tokens":500}}"#;
        let result = extract_claude_usage(line);
        assert_eq!(result, Some((1000, 500)));
    }

    #[test]
    fn test_codex_text_extraction() {
        let line = r#"{"type":"message","content":[{"type":"text","text":"Hello from Codex"}]}"#;
        let result = extract_codex_text(line);
        assert_eq!(result, Some("Hello from Codex".to_string()));

        // Non-message type should return None
        let line2 = r#"{"type":"patch","path":"foo.rs"}"#;
        assert_eq!(extract_codex_text(line2), None);
    }

    #[test]
    fn test_codex_file_extraction() {
        let line = r#"{"type":"patch","path":"src/main.rs"}"#;
        let mut files = HashSet::new();
        extract_codex_files(line, &mut files);
        assert!(files.contains("src/main.rs"));
        assert_eq!(files.len(), 1);
    }

    #[test]
    fn test_gemini_plain_text() {
        assert_eq!(
            extract_gemini_text("Hello from Gemini"),
            Some("Hello from Gemini".to_string())
        );
        assert_eq!(
            extract_gemini_text("  trimmed  "),
            Some("trimmed".to_string())
        );
        assert_eq!(extract_gemini_text(""), None);
        assert_eq!(extract_gemini_text("   "), None);
    }

    #[test]
    fn test_gemini_files_noop() {
        let mut files = HashSet::new();
        extract_gemini_files("anything", &mut files);
        assert!(files.is_empty());
    }

    #[test]
    fn test_completion_files_changed_prefers_git_evidence() {
        let evidence = GitEvidence {
            changed_files: vec!["src/git.rs".to_string()],
            ..Default::default()
        };
        let parsed = vec!["src/stdout.rs".to_string()];

        assert_eq!(
            completion_files_changed(Some(&evidence), parsed),
            vec!["src/git.rs"]
        );
    }

    #[test]
    fn test_completion_files_changed_uses_parsed_fallback_without_git() {
        let parsed = vec!["src/stdout.rs".to_string()];

        assert_eq!(completion_files_changed(None, parsed.clone()), parsed);
    }

    #[test]
    fn required_checks_block_commit_when_required_check_fails() {
        let checks = vec![CheckEvidence {
            name: "build".into(),
            command: "npm run build".into(),
            required: true,
            exit_code: Some(1),
            stdout_excerpt: None,
            stderr_excerpt: Some("failed".into()),
            timed_out: false,
            duration_ms: 10,
        }];

        assert!(!required_checks_allow_commit(&checks));
    }

    #[test]
    fn optional_failed_checks_do_not_block_commit() {
        let checks = vec![CheckEvidence {
            name: "optional".into(),
            command: "npm run lint".into(),
            required: false,
            exit_code: Some(1),
            stdout_excerpt: None,
            stderr_excerpt: Some("failed".into()),
            timed_out: false,
            duration_ms: 10,
        }];

        assert!(required_checks_allow_commit(&checks));
    }

    #[test]
    fn changed_files_outside_allowed_paths_block_commit() {
        let changed = vec!["src/main.rs".to_string(), "docs/readme.md".to_string()];
        let allowed = vec!["src".to_string()];

        assert!(changed_files_have_policy_violation(&changed, &allowed, &[]));
    }

    #[test]
    fn forbidden_paths_block_commit_even_when_allowed() {
        let changed = vec!["src/secrets.env".to_string()];
        let allowed = vec!["src".to_string()];
        let forbidden = vec!["src/secrets.env".to_string()];

        assert!(changed_files_have_policy_violation(
            &changed, &allowed, &forbidden
        ));
    }

    #[test]
    fn allowed_paths_permit_nested_changes() {
        let changed = vec!["src/api/routes.rs".to_string()];
        let allowed = vec!["src".to_string()];

        assert!(!changed_files_have_policy_violation(
            &changed,
            &allowed,
            &[]
        ));
    }

    // --- Sandbox boundary regressions ---
    //
    // These are the tests that must fail if the fallback ever comes back.

    use crate::sandbox::SandboxSession;
    use cortex_core::execution_job::IsolationClass;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    /// A runner that records every submission and never runs anything.
    ///
    /// The submission counter is the point: several tests assert not on what
    /// the sandbox returned, but that it was never asked in the first place.
    struct SpyRunner {
        submissions: Arc<AtomicUsize>,
        outcome: SpyOutcome,
    }

    #[derive(Clone, Copy)]
    enum SpyOutcome {
        /// Refuse, the way a runtime that cannot start a sandbox does.
        Refuse(BlockedReason),
        /// Accept, print nothing, and exit with this code.
        Exit(i32),
    }

    impl SpyRunner {
        fn new(outcome: SpyOutcome) -> (Self, Arc<AtomicUsize>) {
            let submissions = Arc::new(AtomicUsize::new(0));
            (
                Self {
                    submissions: Arc::clone(&submissions),
                    outcome,
                },
                submissions,
            )
        }
    }

    impl SandboxRunner for SpyRunner {
        async fn submit(
            &self,
            _job: &ExecutionJob,
            _request: &SandboxRequest,
        ) -> Result<SandboxSession, Blocked> {
            self.submissions.fetch_add(1, Ordering::SeqCst);
            match self.outcome {
                SpyOutcome::Refuse(reason) => Err(Blocked::new(reason, "spy runner refused")),
                SpyOutcome::Exit(code) => {
                    let (session, driver) =
                        SandboxSession::channel("spy", IsolationClass::Container);
                    drop(driver.output);
                    let _ = driver.exit.send(Ok(SandboxExit::Exited { code }));
                    Ok(session)
                }
            }
        }

        fn isolation_class(&self) -> IsolationClass {
            IsolationClass::Container
        }
    }

    fn spy_task() -> TaskContract {
        TaskContract::new(
            "do the thing".to_string(),
            cortex_core::provider::Tier::Execute,
            cortex_core::routing::RiskLevel::Low,
        )
    }

    fn spy_decision(provider: ProviderId, model: &str) -> RoutingDecision {
        RoutingDecision {
            provider,
            tier: cortex_core::provider::Tier::Execute,
            model_id: model.to_string(),
            rationale: Vec::new(),
            score: 1.0,
            alternatives_considered: Vec::new(),
        }
    }

    fn spy_step() -> StepExecution {
        StepExecution {
            step_id: format!("step-{}", uuid::Uuid::new_v4()),
            attempt_id: "attempt-1".to_string(),
            lease_gen: 3,
            egress: EgressPlan::deny(),
        }
    }

    /// A step whose planner granted the crates.io registry.
    fn spy_step_with_egress(plan: EgressPlan) -> StepExecution {
        StepExecution {
            egress: plan,
            ..spy_step()
        }
    }

    /// A directory that is definitively not a git repository.
    fn non_repo_dir() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("cortex-sbx-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    #[tokio::test]
    async fn worktree_failure_blocks_and_does_not_fall_back() {
        // The exact behaviour that used to live at executor.rs:49-70: worktree
        // creation failing and execution silently continuing in the caller's
        // directory. It must now refuse, and it must refuse before the sandbox
        // is even asked.
        let dir = non_repo_dir();
        let (runner, submissions) = SpyRunner::new(SpyOutcome::Exit(0));
        let (tx, mut rx) = mpsc::channel(16);
        let step = spy_step();

        let result = Executor::execute(
            &spy_task(),
            &spy_decision(ProviderId::Claude, "claude-opus-5"),
            &step,
            tx,
            &dir,
            &runner,
        )
        .await;

        assert!(
            result.is_err(),
            "a step that cannot be isolated must not succeed"
        );
        assert_eq!(
            submissions.load(Ordering::SeqCst),
            0,
            "nothing may be executed when the workspace cannot be isolated"
        );

        let mut saw_blocked = false;
        while let Ok(event) = rx.try_recv() {
            if let WorkerEvent::Blocked { blocked, .. } = event {
                assert_eq!(blocked.reason, BlockedReason::WorktreeUnavailable);
                saw_blocked = true;
            }
        }
        assert!(saw_blocked, "the refusal must be reported, not swallowed");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn sandbox_failure_blocks_and_does_not_invoke_cli() {
        // A refusing sandbox must produce Blocked rather than Failed. The
        // distinction matters: Failed is a fact about the customer's code,
        // Blocked is a fact about Cortex.
        let (runner, _) = SpyRunner::new(SpyOutcome::Refuse(BlockedReason::SandboxUnavailable));
        let (tx, mut rx) = mpsc::channel(16);
        let step = spy_step();
        let decision = spy_decision(ProviderId::Claude, "claude-opus-5");
        let invocation = build_command(&decision).unwrap();
        let job = build_job(&step, &decision, &runner, &invocation);
        let request = SandboxRequest::new(std::env::temp_dir(), "claude", Vec::new());

        let refused = runner.submit(&job, &request).await;
        let blocked = refused.err().expect("the spy runner refuses");
        assert_eq!(blocked.reason, BlockedReason::SandboxUnavailable);

        let result = Executor::block(&step, &tx, blocked).await;
        assert!(result.is_err());

        match rx.try_recv().expect("a blocked event") {
            WorkerEvent::Blocked { blocked, .. } => {
                assert_eq!(blocked.reason, BlockedReason::SandboxUnavailable);
            }
            other => panic!("expected Blocked, got {other:?}"),
        }
    }

    #[test]
    fn gemini_invocation_carries_the_routed_model() {
        // The regression at executor.rs:520 — a bare `gemini` with no model,
        // so the router picked one model and another one ran.
        let invocation = build_command(&spy_decision(ProviderId::Gemini, "gemini-3-pro"))
            .expect("gemini is a CLI provider");
        assert_eq!(invocation.program, "gemini");
        assert!(
            invocation
                .args
                .windows(2)
                .any(|w| w == ["--model", "gemini-3-pro"]),
            "the routed model must reach the invocation, got {:?}",
            invocation.args
        );
    }

    #[test]
    fn every_cli_invocation_carries_its_model() {
        for (provider, model) in [
            (ProviderId::Claude, "claude-opus-5"),
            (ProviderId::Openai, "gpt-5"),
            (ProviderId::Gemini, "gemini-3-pro"),
        ] {
            let invocation = build_command(&spy_decision(provider, model)).expect("cli provider");
            let rendered = invocation.args.join(" ");
            assert!(
                rendered.contains(model),
                "{provider:?} dropped its routed model: {rendered}"
            );
        }
    }

    #[test]
    fn cli_backend_does_not_claim_an_effort_it_cannot_apply() {
        // Invariant 10: a receipt never claims a setting the backend did not
        // apply. These CLIs have no effort control, so the job must not carry
        // an applied level.
        let invocation = build_command(&spy_decision(ProviderId::Claude, "claude-opus-5")).unwrap();
        assert_eq!(invocation.backend_kind, BackendKind::Cli);
        assert_eq!(invocation.effort_applied.applied_level(), None);
    }

    #[test]
    fn the_job_carries_the_plan_s_egress_rather_than_the_worker_s_opinion() {
        // The worker cannot see the repository the plan was made against, so it
        // must not decide this for itself. What arrives on the frame is what
        // ends up on the job, and `effective_egress` is the intersection of the
        // allowlist with the grants — so it records what the sandbox will
        // actually open, not what was asked for.
        let manifests = cortex_core::egress::EcosystemManifests {
            cargo: true,
            ..Default::default()
        };
        let plan = cortex_core::egress::derive_egress(&manifests, true);
        let step = spy_step_with_egress(plan.clone());
        let decision = spy_decision(ProviderId::Claude, "claude-opus-5");
        let (runner, _) = SpyRunner::new(SpyOutcome::Exit(0));

        let job = build_job(&step, &decision, &runner, &build_command(&decision).unwrap());

        assert_eq!(job.network_policy, plan.network_policy);
        assert_eq!(job.capability_grants, plan.capability_grants);

        let effective = job.effective_egress.expect("effective egress is recorded");
        assert!(
            effective.iter().any(|e| e.starts_with("index.crates.io:")),
            "a cargo grant must reach the sparse index, got {effective:?}"
        );
        assert!(
            !effective.iter().any(|e| e.contains("registry.npmjs.org")),
            "a cargo-only grant must not reach npm, got {effective:?}"
        );
        // A job that opens something needs a mediator; one that opens nothing
        // must not stand one up.
        assert!(job.egress_mediator.is_some());
    }

    #[test]
    fn a_denied_plan_opens_nothing_and_stands_up_no_mediator() {
        let step = spy_step_with_egress(EgressPlan::deny());
        let decision = spy_decision(ProviderId::Claude, "claude-opus-5");
        let (runner, _) = SpyRunner::new(SpyOutcome::Exit(0));

        let job = build_job(&step, &decision, &runner, &build_command(&decision).unwrap());

        assert!(job.effective_egress.expect("recorded").is_empty());
        assert!(job.egress_mediator.is_none());
    }

    #[test]
    fn job_carries_the_full_field_set_at_dispatch() {
        // Fields nothing populates yet must still be present, so the interface
        // does not need re-cutting when they are.
        let (runner, _) = SpyRunner::new(SpyOutcome::Exit(0));
        let decision = spy_decision(ProviderId::Claude, "claude-opus-5");
        let step = spy_step();
        let job = build_job(&step, &decision, &runner, &build_command(&decision).unwrap());

        assert_eq!(job.job_version, EXECUTION_JOB_VERSION);
        assert_eq!(job.attempt_id, "attempt-1");
        assert_eq!(job.lease_gen, 3);
        assert_eq!(job.model_ref.catalog_id, "claude-opus-5");
        assert_eq!(job.model_ref.catalog_version, None);
        assert_eq!(job.backend_kind, BackendKind::Cli);
        assert_eq!(job.effort, None);
        assert_eq!(
            job.network_policy,
            cortex_core::execution_job::NetworkPolicy::Deny
        );
        assert!(job.capability_grants.is_empty());
        assert_eq!(job.context_bundle, None);
        assert_eq!(job.quote_id, None);
        assert_eq!(job.plan_receipt_id, None);
        assert_eq!(job.isolation_class, IsolationClass::Container);
        assert!(!job.image_ref.is_empty());
        assert!(!job.resource_profile.profile_version.is_empty());
        // Unquoted, but never unbounded.
        assert!(job.budgets.is_unquoted());
        assert_eq!(job.budgets.wall_clock, Budgets::DEFAULT_WALL_CLOCK);
    }

    #[test]
    fn a_check_that_could_not_run_is_not_a_check_that_passed() {
        // A blocked check records no exit code, so nothing downstream can read
        // it as success and auto-commit on the strength of it.
        let blocked_check = CheckEvidence {
            name: "cargo:test".to_string(),
            command: "cargo test".to_string(),
            required: true,
            exit_code: None,
            stdout_excerpt: None,
            stderr_excerpt: Some("blocked (sandbox_unavailable): no runtime".to_string()),
            timed_out: false,
            duration_ms: 0,
        };
        assert!(!required_checks_allow_commit(&[blocked_check]));
    }
}
