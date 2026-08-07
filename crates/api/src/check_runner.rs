//! Phase A of the execution substrate: run verification checks in a container
//! the worker cannot reach.
//!
//! Task **V1** of `cortex/plan/VERIFIER.md`, second half. The contract lives in
//! [`cortex_core::verification`]; this is the implementation that makes a
//! verdict mean something.
//!
//! Every constraint below is load-bearing, so none of them are configurable:
//!
//! - **A fresh container per check.** No state survives from the worker, from
//!   another customer, or from a previous attempt.
//! - **`--network none`.** A check that can reach the network can fetch a
//!   passing result.
//! - **The tree is mounted read-only.** A check cannot edit its way to green.
//! - **No environment at all.** Not a filtered environment — an empty one. The
//!   runner gets a tree and a command, never provider keys, Clerk secrets, or
//!   the production database path.
//! - **The image digest is recorded on every execution.** "It passed" is only
//!   reproducible if *where* it passed is pinned.
//!
//! Phase B swaps this for Firecracker-class microVMs behind the same trait,
//! which is a deployment decision rather than a redesign.

use std::time::{Duration, Instant};

use bollard::container::{
    Config, CreateContainerOptions, LogsOptions, RemoveContainerOptions, StartContainerOptions,
    WaitContainerOptions,
};
use bollard::models::HostConfig;
use bollard::Docker;
use cortex_core::verification::{
    CheckExecution, CheckOutcome, CheckRunner, CheckSpec, RunnerError, TreeSnapshot,
};
use futures_util::StreamExt;
use sha2::{Digest, Sha256};

/// Where the delivered tree is mounted inside the container.
const WORKDIR: &str = "/work";
/// Bytes of output retained verbatim on the execution record. The full log is
/// digest-addressed and stored separately; this is what a dispute reads first.
const OUTPUT_TAIL_BYTES: usize = 16 * 1024;

const MEMORY_BYTES: i64 = 2 * 1024 * 1024 * 1024;
/// One full CPU: quota / period.
const CPU_QUOTA: i64 = 100_000;
const CPU_PERIOD: i64 = 100_000;
/// Enough for a test runner spawning workers, far short of a fork bomb.
const PIDS_LIMIT: i64 = 512;

pub struct ContainerCheckRunner {
    docker: Docker,
    /// Pinned by digest (`repo@sha256:…`), not by tag. A mutable tag would
    /// make every past receipt unreproducible the next time it moved.
    image: String,
}

impl ContainerCheckRunner {
    pub fn new(image: impl Into<String>) -> Result<Self, String> {
        let docker = Docker::connect_with_local_defaults()
            .map_err(|e| format!("failed to connect to Docker: {e}"))?;
        Ok(Self {
            docker,
            image: image.into(),
        })
    }

    fn container_config(&self, tree: &TreeSnapshot, check: &CheckSpec) -> Config<String> {
        Config {
            image: Some(self.image.clone()),
            cmd: Some(check.command.clone()),
            working_dir: Some(WORKDIR.to_string()),
            // Empty, not filtered. See the module docs.
            env: Some(Vec::new()),
            user: Some("sandbox".to_string()),
            network_disabled: Some(true),
            host_config: Some(HostConfig {
                binds: Some(vec![format!("{}:{}:ro", tree.path, WORKDIR)]),
                network_mode: Some("none".to_string()),
                memory: Some(MEMORY_BYTES),
                memory_swap: Some(MEMORY_BYTES),
                cpu_quota: Some(CPU_QUOTA),
                cpu_period: Some(CPU_PERIOD),
                pids_limit: Some(PIDS_LIMIT),
                cap_drop: Some(vec!["ALL".to_string()]),
                security_opt: Some(vec!["no-new-privileges:true".to_string()]),
                // The mount is read-only; make the rest of the filesystem so
                // too, so a check cannot cache a result for the next one.
                readonly_rootfs: Some(true),
                // Removal is explicit below, in every path including timeout,
                // so a leaked container is a bug rather than a race.
                auto_remove: Some(false),
                ..Default::default()
            }),
            ..Default::default()
        }
    }

    /// Best-effort teardown. A failure here cannot change a verdict — it is an
    /// operational problem, and the reaper is the backstop.
    async fn remove(&self, container_id: &str) {
        let opts = RemoveContainerOptions {
            force: true,
            v: true,
            ..Default::default()
        };
        if let Err(e) = self.docker.remove_container(container_id, Some(opts)).await {
            tracing::warn!(container_id, error = %e, "failed to remove check container");
        }
    }

    /// Collect stdout and stderr after the container exits, interleaved in the
    /// order Docker recorded them.
    async fn collect_output(&self, container_id: &str) -> String {
        let opts = LogsOptions::<String> {
            stdout: true,
            stderr: true,
            follow: false,
            ..Default::default()
        };
        let mut stream = self.docker.logs(container_id, Some(opts));
        let mut output = String::new();
        while let Some(item) = stream.next().await {
            match item {
                Ok(chunk) => output.push_str(&chunk.to_string()),
                Err(e) => {
                    tracing::warn!(container_id, error = %e, "log stream error while collecting check output");
                    break;
                }
            }
        }
        output
    }

    fn execution(
        &self,
        check: &CheckSpec,
        outcome: CheckOutcome,
        exit_code: Option<i32>,
        started: Instant,
        output: &str,
    ) -> CheckExecution {
        CheckExecution {
            spec_id: check.id.clone(),
            exit_code,
            outcome,
            duration_ms: started.elapsed().as_millis() as u64,
            output_digest: digest_of(output),
            output_tail: tail_of(output, OUTPUT_TAIL_BYTES),
            runner_image: self.image.clone(),
        }
    }
}

impl CheckRunner for ContainerCheckRunner {
    async fn run(
        &self,
        tree: &TreeSnapshot,
        check: &CheckSpec,
    ) -> Result<CheckExecution, RunnerError> {
        if check.command.is_empty() {
            return Err(RunnerError::InvalidSpec(format!(
                "check {} has an empty command",
                check.id
            )));
        }

        let started = Instant::now();
        let name = format!("cortex-check-{}", uuid::Uuid::new_v4());
        let config = self.container_config(tree, check);

        let create = self
            .docker
            .create_container(
                Some(CreateContainerOptions {
                    name: name.clone(),
                    ..Default::default()
                }),
                config,
            )
            .await
            .map_err(|e| RunnerError::SnapshotFailed {
                tree_hash: tree.tree_hash.clone(),
                reason: format!("failed to create check container: {e}"),
            })?;
        let container_id = create.id;

        if let Err(e) = self
            .docker
            .start_container(&container_id, None::<StartContainerOptions<String>>)
            .await
        {
            self.remove(&container_id).await;
            return Err(RunnerError::ExecutionFailed(format!(
                "failed to start check container: {e}"
            )));
        }

        let mut wait = self
            .docker
            .wait_container(&container_id, None::<WaitContainerOptions<String>>);
        let waited = tokio::time::timeout(Duration::from_secs(check.timeout_secs), wait.next()).await;

        // Timeout is a verdict about the work, not about us: a hung test is
        // the defect the customer is paying to be protected from. Collect what
        // it managed to print before tearing it down, so the receipt shows
        // where it hung.
        let Ok(waited) = waited else {
            let output = self.collect_output(&container_id).await;
            self.remove(&container_id).await;
            return Ok(self.execution(check, CheckOutcome::TimedOut, None, started, &output));
        };

        let exit_code = match waited {
            Some(Ok(response)) => response.status_code,
            // The container vanished, or Docker failed mid-wait. We genuinely
            // do not know what happened to the check, so this is ours to
            // absorb — INCONCLUSIVE, never a charge and never a refund.
            Some(Err(e)) => {
                self.remove(&container_id).await;
                return Err(RunnerError::ExecutionFailed(format!(
                    "wait failed for check {}: {e}",
                    check.id
                )));
            }
            None => {
                self.remove(&container_id).await;
                return Err(RunnerError::ExecutionFailed(format!(
                    "wait stream ended without a status for check {}",
                    check.id
                )));
            }
        };

        let output = self.collect_output(&container_id).await;
        self.remove(&container_id).await;

        let outcome = if exit_code == 0 {
            CheckOutcome::Passed
        } else {
            CheckOutcome::Failed
        };

        Ok(self.execution(
            check,
            outcome,
            Some(exit_code as i32),
            started,
            &output,
        ))
    }

    fn runner_image(&self) -> &str {
        &self.image
    }
}

/// `sha256:…` over the full output, so a retained tail can be shown to be a
/// genuine excerpt of what actually ran.
fn digest_of(output: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(output.as_bytes());
    format!("sha256:{:x}", hasher.finalize())
}

/// Last `limit` bytes, cut at a character boundary and marked when truncated.
fn tail_of(output: &str, limit: usize) -> String {
    if output.len() <= limit {
        return output.to_string();
    }
    let mut start = output.len() - limit;
    while start < output.len() && !output.is_char_boundary(start) {
        start += 1;
    }
    format!("…[truncated]\n{}", &output[start..])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn digest_is_stable_and_content_addressed() {
        assert_eq!(digest_of("ok"), digest_of("ok"));
        assert_ne!(digest_of("ok"), digest_of("ok "));
        assert!(digest_of("").starts_with("sha256:"));
    }

    #[test]
    fn short_output_is_kept_whole() {
        assert_eq!(tail_of("test result: ok", 1024), "test result: ok");
    }

    #[test]
    fn long_output_is_tailed_and_marked() {
        let output = "a".repeat(100);
        let tail = tail_of(&output, 10);
        assert!(tail.starts_with("…[truncated]\n"));
        assert!(tail.ends_with(&"a".repeat(10)));
    }

    #[test]
    fn tail_never_splits_a_character() {
        // Multi-byte characters, cut at a boundary that lands mid-character.
        let output = "é".repeat(50);
        let tail = tail_of(&output, 11);
        assert!(tail.len() >= "…[truncated]\n".len());
        // The point of the test: this must not panic on a byte-index slice,
        // and the result must be valid UTF-8 by construction.
        assert!(tail.chars().count() > 0);
    }
}
