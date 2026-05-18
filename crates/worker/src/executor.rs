use std::process::Stdio;

use cortex_core::error::CortexError;
use cortex_core::provider::ProviderId;
use cortex_core::routing::RoutingDecision;
use cortex_core::task::TaskContract;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::mpsc;

use crate::stream::WorkerEvent;

pub struct Executor;

impl Executor {
    pub async fn execute(
        task: &TaskContract,
        decision: &RoutingDecision,
        tx: mpsc::Sender<WorkerEvent>,
        working_dir: Option<&std::path::Path>,
    ) -> Result<i32, CortexError> {
        let (cmd, args) = build_command(decision)?;

        tx.send(WorkerEvent::Started {
            task_id: task.id,
            provider: decision.provider.to_string(),
            model: decision.model_id.clone(),
        })
        .await
        .ok();

        let mut command = Command::new(&cmd);
        command
            .args(&args)
            .arg(&task.objective)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        if let Some(dir) = working_dir {
            command.current_dir(dir);
        }

        let mut child = command
            .spawn()
            .map_err(|e| CortexError::WorkerExecution(format!("{cmd}: {e}")))?;

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| CortexError::WorkerExecution("no stdout".into()))?;

        let task_id = task.id;
        let tx_lines = tx.clone();
        let provider = decision.provider;

        let reader_handle = tokio::spawn(async move {
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();
            let mut last_text = String::new();
            while let Ok(Some(line)) = lines.next_line().await {
                let output = match provider {
                    ProviderId::Claude => extract_claude_text(&line),
                    _ => Some(line),
                };
                if let Some(text) = output {
                    if text != last_text {
                        last_text.clone_from(&text);
                        let _ = tx_lines
                            .send(WorkerEvent::Output { task_id, line: text })
                            .await;
                    }
                }
            }
        });

        let status = child
            .wait()
            .await
            .map_err(|e| CortexError::WorkerExecution(e.to_string()))?;

        reader_handle.await.ok();

        let code = status.code().unwrap_or(-1);

        let event = if status.success() {
            WorkerEvent::Completed {
                task_id: task.id,
                exit_code: code,
            }
        } else {
            WorkerEvent::Failed {
                task_id: task.id,
                error: format!("process exited with code {code}"),
            }
        };
        tx.send(event).await.ok();

        Ok(code)
    }
}

fn extract_claude_text(line: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(line).ok()?;
    match v.get("type")?.as_str()? {
        "assistant" => {
            let content = v.get("message")?.get("content")?.as_array()?;
            let mut texts = Vec::new();
            for item in content {
                if item.get("type")?.as_str()? == "text" {
                    if let Some(t) = item.get("text").and_then(|t| t.as_str()) {
                        texts.push(t.to_string());
                    }
                }
            }
            if texts.is_empty() { None } else { Some(texts.join("")) }
        }
        "result" => {
            v.get("result").and_then(|r| r.as_str()).map(|s| s.to_string())
        }
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
        ProviderId::Gemini => Ok((
            "gemini".to_string(),
            vec![],
        )),
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
