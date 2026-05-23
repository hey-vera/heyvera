use std::collections::HashSet;
use std::process::Stdio;

use cortex_core::error::CortexError;
use cortex_core::failure::{WorkerFailureKind, WorkerFailureReport};
use cortex_core::protocol::{
    CheckEvidence, CommandEvidence, GitEvidence, StepOutput, WorkerEvidencePacket,
};
use cortex_core::provider::ProviderId;
use cortex_core::routing::RoutingDecision;
use cortex_core::task::TaskContract;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::mpsc;

use crate::stream::WorkerEvent;
use crate::worktree;

const REQUIRED_CHECK_TIMEOUT_SECS: u64 = 120;

pub struct StepExecution {
    pub step_id: String,
    pub attempt_id: String,
    pub lease_gen: i64,
}

pub struct Executor;

impl Executor {
    pub async fn execute(
        task: &TaskContract,
        decision: &RoutingDecision,
        step: &StepExecution,
        tx: mpsc::Sender<WorkerEvent>,
        working_dir: Option<&std::path::Path>,
    ) -> Result<i32, CortexError> {
        let (cmd, args) = build_command(decision)?;

        tx.send(WorkerEvent::Started {
            step_id: step.step_id.clone(),
            attempt_id: step.attempt_id.clone(),
            lease_gen: step.lease_gen,
            provider: decision.provider.to_string(),
            model: decision.model_id.clone(),
        })
        .await
        .ok();

        // Create an isolated worktree so parallel steps don't conflict.
        // If worktree creation fails (not a git repo, etc.), fall back to the
        // original working_dir — worktree isolation is best-effort.
        let mut worktree_guard = None;
        let effective_dir: Option<std::path::PathBuf> = if let Some(dir) = working_dir {
            match worktree::create_worktree(dir, &step.step_id) {
                Ok(guard) => {
                    let wt_path = guard.path().to_path_buf();
                    worktree_guard = Some(guard);
                    Some(wt_path)
                }
                Err(e) => {
                    tracing::debug!(
                        step_id = %step.step_id,
                        error = %e,
                        "worktree creation failed, falling back to direct execution"
                    );
                    Some(dir.to_path_buf())
                }
            }
        } else {
            None
        };
        let effective_dir_ref = effective_dir.as_deref();

        let mut command = Command::new(&cmd);
        command
            .args(&args)
            .arg(&task.objective)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        if let Some(dir) = effective_dir_ref {
            command.current_dir(dir);
        }

        let base_commit = get_git_head(effective_dir_ref);

        let result = Self::run_child(
            command,
            &cmd,
            step,
            &tx,
            decision,
            effective_dir_ref,
            base_commit,
            task,
            &mut worktree_guard,
        )
        .await;

        // Clean up the worktree regardless of success or failure.
        if let Some(mut guard) = worktree_guard {
            if let Err(e) = guard.cleanup() {
                tracing::warn!(error = %e, "worktree cleanup failed");
            }
        }

        result
    }

    /// Inner helper that spawns the child process, streams output, and emits
    /// the final Completed/Failed event. Factored out so that worktree cleanup
    /// in `execute()` runs unconditionally after this returns.
    async fn run_child(
        mut command: Command,
        cmd: &str,
        step: &StepExecution,
        tx: &mpsc::Sender<WorkerEvent>,
        decision: &RoutingDecision,
        effective_dir: Option<&std::path::Path>,
        base_commit: Option<String>,
        task: &TaskContract,
        worktree_guard: &mut Option<crate::worktree::WorktreeGuard>,
    ) -> Result<i32, CortexError> {
        let mut child = match command.spawn() {
            Ok(c) => c,
            Err(e) => {
                let failure = WorkerFailureReport {
                    kind: WorkerFailureKind::CliNotFound,
                    exit_code: None,
                    stderr_excerpt: Some(e.to_string()),
                    tool: Some(cmd.to_string()),
                };
                let _ = tx
                    .send(WorkerEvent::Failed {
                        step_id: step.step_id.clone(),
                        attempt_id: step.attempt_id.clone(),
                        lease_gen: step.lease_gen,
                        failure,
                    })
                    .await;
                return Err(CortexError::WorkerExecution(format!("{cmd}: {e}")));
            }
        };

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| CortexError::WorkerExecution("no stdout".into()))?;

        let stderr = child.stderr.take();

        let step_id = step.step_id.clone();
        let attempt_id = step.attempt_id.clone();
        let lease_gen = step.lease_gen;
        let tx_lines = tx.clone();
        let provider = decision.provider;

        let reader_handle = tokio::spawn(async move {
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();
            let mut last_text = String::new();
            let mut collected_output = Vec::new();
            let mut files_changed = HashSet::new();
            let mut usage: Option<(i64, i64)> = None;
            while let Ok(Some(line)) = lines.next_line().await {
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
                };
                if let Some(text) = output {
                    if text != last_text {
                        last_text.clone_from(&text);
                        if collected_output.len() < 50 {
                            collected_output.push(text.clone());
                        }
                        let _ = tx_lines
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
            let files_vec: Vec<String> = files_changed.into_iter().collect();
            (collected_output, files_vec, usage)
        });

        let stderr_handle = tokio::spawn(async move {
            if let Some(stderr) = stderr {
                let reader = BufReader::new(stderr);
                let mut lines = reader.lines();
                let mut collected = String::new();
                while let Ok(Some(line)) = lines.next_line().await {
                    if collected.len() < 500 {
                        if !collected.is_empty() {
                            collected.push('\n');
                        }
                        collected.push_str(&line);
                    }
                }
                collected
            } else {
                String::new()
            }
        });

        let status = child
            .wait()
            .await
            .map_err(|e| CortexError::WorkerExecution(e.to_string()))?;

        let (collected_output, parsed_files_changed, usage) = reader_handle
            .await
            .unwrap_or_else(|_| (Vec::new(), Vec::new(), None));
        let stderr_text = stderr_handle.await.unwrap_or_default();

        let code = status.code().unwrap_or(-1);

        let event = if status.success() {
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
                run_required_checks(task, dir).await
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

fn build_command(decision: &RoutingDecision) -> Result<(String, Vec<String>), CortexError> {
    match decision.provider {
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
            Ok(("claude".to_string(), args))
        }
        ProviderId::Openai => Ok((
            "codex".to_string(),
            vec![
                "exec".to_string(),
                "-c".to_string(),
                format!("model={}", decision.model_id),
                "-c".to_string(),
                "approval_policy=never".to_string(),
            ],
        )),
        ProviderId::Gemini => Ok(("gemini".to_string(), vec![])),
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

async fn run_required_checks(
    task: &TaskContract,
    working_dir: &std::path::Path,
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
        let mut command = Command::new("sh");
        command
            .arg("-lc")
            .arg(&check.command)
            .current_dir(working_dir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let output = tokio::time::timeout(
            std::time::Duration::from_secs(REQUIRED_CHECK_TIMEOUT_SECS),
            command.output(),
        )
        .await;

        let duration_ms = started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;
        match output {
            Ok(Ok(output)) => {
                results.push(CheckEvidence {
                    name: check.name.clone(),
                    command: check.command.clone(),
                    required: check.required,
                    exit_code: output.status.code(),
                    stdout_excerpt: excerpt_from_text(
                        &String::from_utf8_lossy(&output.stdout),
                        4_000,
                    ),
                    stderr_excerpt: excerpt_from_text(
                        &String::from_utf8_lossy(&output.stderr),
                        4_000,
                    ),
                    timed_out: false,
                    duration_ms,
                });
            }
            Ok(Err(err)) => {
                results.push(CheckEvidence {
                    name: check.name.clone(),
                    command: check.command.clone(),
                    required: check.required,
                    exit_code: None,
                    stdout_excerpt: None,
                    stderr_excerpt: Some(format!("failed to run required check: {err}")),
                    timed_out: false,
                    duration_ms,
                });
            }
            Err(_) => {
                results.push(CheckEvidence {
                    name: check.name.clone(),
                    command: check.command.clone(),
                    required: check.required,
                    exit_code: None,
                    stdout_excerpt: None,
                    stderr_excerpt: Some(format!(
                        "required check timed out after {REQUIRED_CHECK_TIMEOUT_SECS}s"
                    )),
                    timed_out: true,
                    duration_ms,
                });
            }
        }
    }

    results
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
}
