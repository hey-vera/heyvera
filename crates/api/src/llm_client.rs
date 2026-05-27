use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::mpsc;
use std::process::Stdio;

#[derive(Debug, Clone, Serialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone)]
pub enum Provider {
    Claude,
    Openai,
}

impl Provider {
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "claude" | "anthropic" => Some(Self::Claude),
            "openai" | "codex" | "gpt" => Some(Self::Openai),
            _ => None,
        }
    }

    pub fn name(&self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Openai => "openai",
        }
    }

    pub fn default_model(&self) -> &'static str {
        match self {
            Self::Claude => "claude-sonnet-4-6",
            Self::Openai => "gpt-4.1-mini",
        }
    }
}

/// Stream a chat response using the CLI tools (BYOS — uses subscription auth).
/// Calls `claude` or `codex` as a subprocess, streaming output line by line.
pub async fn stream_chat_cli(
    provider: &Provider,
    model: Option<&str>,
    system_prompt: &str,
    user_message: &str,
    tx: mpsc::Sender<String>,
) -> Result<(), String> {
    match provider {
        Provider::Claude => stream_claude_cli(model, system_prompt, user_message, tx).await,
        Provider::Openai => stream_codex_cli(model, system_prompt, user_message, tx).await,
    }
}

async fn stream_claude_cli(
    model: Option<&str>,
    system_prompt: &str,
    user_message: &str,
    tx: mpsc::Sender<String>,
) -> Result<(), String> {
    let model = model.unwrap_or("claude-sonnet-4-6");

    let prompt = if system_prompt.is_empty() {
        user_message.to_string()
    } else {
        format!("{system_prompt}\n\n{user_message}")
    };

    let mut cmd = Command::new("claude");
    cmd.args([
        "-p",
        "--output-format", "stream-json",
        "--no-session-persistence",
        "--model", model,
    ])
    .arg(&prompt)
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| {
        format!("failed to spawn claude CLI: {e} — is the claude CLI installed and authenticated?")
    })?;

    let stdout = child.stdout.take().ok_or("failed to capture stdout")?;
    let reader = BufReader::new(stdout);
    let mut lines = reader.lines();

    while let Ok(Some(line)) = lines.next_line().await {
        if let Ok(event) = serde_json::from_str::<ClaudeStreamEvent>(&line) {
            match event {
                ClaudeStreamEvent::Assistant { message } => {
                    if let Some(content) = extract_claude_text(&message) {
                        if tx.send(content).await.is_err() {
                            break;
                        }
                    }
                }
                ClaudeStreamEvent::ContentBlockDelta { delta } => {
                    if let Some(text) = delta.get("text").and_then(|t| t.as_str()) {
                        if tx.send(text.to_string()).await.is_err() {
                            break;
                        }
                    }
                }
                ClaudeStreamEvent::Result { result } => {
                    if let Some(text) = extract_claude_text(&result) {
                        if tx.send(text).await.is_err() {
                            break;
                        }
                    }
                }
                _ => {}
            }
        }
    }

    let status = child.wait().await.map_err(|e| format!("claude process error: {e}"))?;
    if !status.success() {
        return Err(format!("claude exited with status {status}"));
    }
    Ok(())
}

async fn stream_codex_cli(
    model: Option<&str>,
    system_prompt: &str,
    user_message: &str,
    tx: mpsc::Sender<String>,
) -> Result<(), String> {
    let model = model.unwrap_or("gpt-4.1-mini");

    let prompt = if system_prompt.is_empty() {
        user_message.to_string()
    } else {
        format!("{system_prompt}\n\n{user_message}")
    };

    let mut cmd = Command::new("codex");
    cmd.args([
        "exec",
        "-c", &format!("model={model}"),
        "-c", "approval_policy=never",
    ])
    .arg(&prompt)
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| {
        format!("failed to spawn codex CLI: {e} — is the codex CLI installed and authenticated?")
    })?;

    let stdout = child.stdout.take().ok_or("failed to capture stdout")?;
    let reader = BufReader::new(stdout);
    let mut lines = reader.lines();

    while let Ok(Some(line)) = lines.next_line().await {
        let trimmed = line.trim();
        if !trimmed.is_empty() {
            if tx.send(format!("{trimmed}\n")).await.is_err() {
                break;
            }
        }
    }

    let status = child.wait().await.map_err(|e| format!("codex process error: {e}"))?;
    if !status.success() {
        return Err(format!("codex exited with status {status}"));
    }
    Ok(())
}

// --- BYOK direct API path (for users who bring their own API keys) ---

/// Stream a chat response using a raw API key (BYOK path).
/// Use with caution — this burns per-token credits.
pub async fn stream_chat_api(
    provider: &Provider,
    api_key: &str,
    model: Option<&str>,
    system_prompt: &str,
    messages: &[ChatMessage],
    tx: mpsc::Sender<String>,
) -> Result<(), String> {
    match provider {
        Provider::Claude => stream_anthropic_api(api_key, model, system_prompt, messages, tx).await,
        Provider::Openai => stream_openai_api(api_key, model, system_prompt, messages, tx).await,
    }
}

async fn stream_anthropic_api(
    api_key: &str,
    model: Option<&str>,
    system_prompt: &str,
    messages: &[ChatMessage],
    tx: mpsc::Sender<String>,
) -> Result<(), String> {
    use futures_util::StreamExt;

    let client = reqwest::Client::new();
    let model = model.unwrap_or("claude-haiku-4-5");

    let api_messages: Vec<serde_json::Value> = messages
        .iter()
        .map(|m| serde_json::json!({"role": m.role, "content": m.content}))
        .collect();

    let body = serde_json::json!({
        "model": model,
        "max_tokens": 4096,
        "system": system_prompt,
        "messages": api_messages,
        "stream": true,
    });

    let resp = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("anthropic request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        tracing::error!(provider = "anthropic", %status, "API error: {body}");
        let user_msg = match status.as_u16() {
            401 => "Invalid API key — check your Anthropic key in Settings.",
            429 => "Rate limited by Anthropic — try again in a moment.",
            _ => "Anthropic API returned an error. Check your key and try again.",
        };
        return Err(user_msg.to_string());
    }

    let mut stream = resp.bytes_stream();
    let mut buffer = String::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("stream error: {e}"))?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(line_end) = buffer.find('\n') {
            let line = buffer[..line_end].to_string();
            buffer = buffer[line_end + 1..].to_string();

            if let Some(data) = line.strip_prefix("data: ") {
                if data.trim() == "[DONE]" {
                    return Ok(());
                }
                if let Ok(event) = serde_json::from_str::<serde_json::Value>(data) {
                    if event.get("type").and_then(|t| t.as_str()) == Some("content_block_delta") {
                        if let Some(text) = event.pointer("/delta/text").and_then(|t| t.as_str()) {
                            if tx.send(text.to_string()).await.is_err() {
                                return Ok(());
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(())
}

async fn stream_openai_api(
    api_key: &str,
    model: Option<&str>,
    system_prompt: &str,
    messages: &[ChatMessage],
    tx: mpsc::Sender<String>,
) -> Result<(), String> {
    use futures_util::StreamExt;

    let client = reqwest::Client::new();
    let model = model.unwrap_or("gpt-4.1-mini");

    let mut api_messages = vec![serde_json::json!({"role": "system", "content": system_prompt})];
    for m in messages {
        api_messages.push(serde_json::json!({"role": m.role, "content": m.content}));
    }

    let body = serde_json::json!({
        "model": model,
        "messages": api_messages,
        "stream": true,
    });

    let resp = client
        .post("https://api.openai.com/v1/chat/completions")
        .header("Authorization", format!("Bearer {api_key}"))
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("openai request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        tracing::error!(provider = "openai", %status, "API error: {body}");
        let user_msg = match status.as_u16() {
            401 => "Invalid API key — check your OpenAI key in Settings.",
            429 => "Rate limited by OpenAI — try again in a moment.",
            _ => "OpenAI API returned an error. Check your key and try again.",
        };
        return Err(user_msg.to_string());
    }

    let mut stream = resp.bytes_stream();
    let mut buffer = String::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("stream error: {e}"))?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(line_end) = buffer.find('\n') {
            let line = buffer[..line_end].to_string();
            buffer = buffer[line_end + 1..].to_string();

            if let Some(data) = line.strip_prefix("data: ") {
                if data.trim() == "[DONE]" {
                    return Ok(());
                }
                if let Ok(event) = serde_json::from_str::<serde_json::Value>(data) {
                    if let Some(content) = event.pointer("/choices/0/delta/content").and_then(|t| t.as_str()) {
                        if tx.send(content.to_string()).await.is_err() {
                            return Ok(());
                        }
                    }
                }
            }
        }
    }

    Ok(())
}

// --- Claude stream-json event types ---

#[derive(Deserialize)]
#[serde(tag = "type")]
enum ClaudeStreamEvent {
    #[serde(rename = "assistant")]
    Assistant { message: serde_json::Value },
    #[serde(rename = "content_block_delta")]
    ContentBlockDelta { delta: serde_json::Value },
    #[serde(rename = "result")]
    Result { result: serde_json::Value },
    #[serde(other)]
    Other,
}

fn extract_claude_text(value: &serde_json::Value) -> Option<String> {
    if let Some(text) = value.as_str() {
        return Some(text.to_string());
    }
    if let Some(content) = value.get("content") {
        if let Some(arr) = content.as_array() {
            let text: String = arr.iter()
                .filter_map(|block| block.get("text").and_then(|t| t.as_str()))
                .collect::<Vec<_>>()
                .join("");
            if !text.is_empty() {
                return Some(text);
            }
        }
    }
    None
}
