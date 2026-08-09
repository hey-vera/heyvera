//! The first [`SandboxRunner`](super::SandboxRunner) implementation: a rootless
//! container, locked down.
//!
//! This is deliberately the *first* implementation and not the intended final
//! one. A container shares the host kernel, so against a kernel exploit it is a
//! resource boundary rather than a security boundary — and the threat model
//! here is model-authored code running next to other customers' source. The
//! job records [`IsolationClass::Container`] for exactly that reason: a receipt
//! must state the boundary that ran, not the one a reader would like to assume.
//!
//! Every constraint below is load-bearing, so none of them are configurable.

use std::time::Duration;

use bollard::container::{
    AttachContainerOptions, AttachContainerResults, Config, CreateContainerOptions,
    RemoveContainerOptions, StartContainerOptions, WaitContainerOptions,
};
use bollard::models::HostConfig;
use bollard::Docker;
use cortex_core::execution_job::{Blocked, BlockedReason, ExecutionJob, IsolationClass};
use futures_util::StreamExt;

use super::policy::{binds, effective_hosts, sanctioned_env, ungranted_hosts, WORKSPACE_MOUNT};
use super::{OutputStream, SandboxDriver, SandboxExit, SandboxLine, SandboxRequest, SandboxRunner};
use super::SandboxSession;

/// Unprivileged user inside the runner image. Matches the check runner's
/// image contract.
const SANDBOX_USER: &str = "sandbox";

pub struct ContainerSandbox {
    docker: Docker,
    /// Pinned by digest (`repo@sha256:…`) in production. Validation that it is
    /// a digest rather than a mutable tag belongs to the signed runner
    /// registry; this runner records whatever it was given so the receipt is
    /// honest either way.
    image: String,
}

impl ContainerSandbox {
    pub fn new(image: impl Into<String>) -> Result<Self, Blocked> {
        let docker = Docker::connect_with_local_defaults().map_err(|e| {
            Blocked::new(
                BlockedReason::SandboxUnavailable,
                format!("failed to connect to the container runtime: {e}"),
            )
        })?;
        Ok(Self {
            docker,
            image: image.into(),
        })
    }

    /// Build the container configuration.
    ///
    /// Deliberately an associated function taking the image rather than a
    /// method, so the hardening below is testable on every platform instead of
    /// only where a container runtime happens to be running. These assertions
    /// are the security boundary; they must not be the ones that get skipped.
    fn build_config(image: &str, job: &ExecutionJob, request: &SandboxRequest) -> Config<String> {
        let profile = &job.resource_profile;
        let hosts = effective_hosts(job);

        // Deny and "an allowlist nothing justifies" are the same thing here.
        // `none` is the only mode with no route out; an allowlist is enforced
        // by attaching the sandbox to a network whose egress rules name
        // exactly those hosts, which is provisioned per task and torn down
        // with it.
        let network_mode = if hosts.is_empty() {
            "none".to_string()
        } else {
            format!("cortex-egress-{}", job.attempt_id)
        };

        Config {
            image: Some(image.to_string()),
            cmd: Some(request.argv()),
            working_dir: Some(WORKSPACE_MOUNT.to_string()),
            // Empty, not filtered. See `policy::sanctioned_env`.
            env: Some(sanctioned_env()),
            user: Some(SANDBOX_USER.to_string()),
            network_disabled: Some(hosts.is_empty()),
            attach_stdout: Some(true),
            attach_stderr: Some(true),
            host_config: Some(HostConfig {
                // Exactly one mount: the worktree. No socket, no home, no root.
                binds: Some(binds(request)),
                network_mode: Some(network_mode),
                memory: Some(profile.memory_bytes),
                memory_swap: Some(profile.memory_bytes),
                cpu_quota: Some(profile.cpu_quota),
                cpu_period: Some(profile.cpu_period),
                pids_limit: Some(profile.pids_limit),
                cap_drop: Some(vec!["ALL".to_string()]),
                security_opt: Some(vec!["no-new-privileges:true".to_string()]),
                // The workspace mount stays writable; everything else does not,
                // so nothing can be cached into the image for the next task.
                readonly_rootfs: Some(true),
                privileged: Some(false),
                userns_mode: Some("host".to_string()),
                // Removal is explicit in every path including timeout and
                // kill, so a leaked sandbox is a bug rather than a race.
                auto_remove: Some(false),
                ..Default::default()
            }),
            ..Default::default()
        }
    }

    /// Teardown. Mandatory, and attempted on every path.
    async fn remove(docker: &Docker, id: &str) {
        let opts = RemoveContainerOptions {
            force: true,
            // Remove anonymous volumes too — a surviving volume is exactly the
            // leftover file that makes reuse a leak.
            v: true,
            ..Default::default()
        };
        if let Err(e) = docker.remove_container(id, Some(opts)).await {
            tracing::warn!(container_id = id, error = %e, "sandbox teardown failed");
        }
    }
}

impl SandboxRunner for ContainerSandbox {
    async fn submit(
        &self,
        job: &ExecutionJob,
        request: &SandboxRequest,
    ) -> Result<SandboxSession, Blocked> {
        // An allowlist entry no grant justifies is either a mistake or an
        // attempt. It is already excluded from the effective set; report it
        // rather than letting it pass unnoticed.
        let ungranted = ungranted_hosts(job);
        if !ungranted.is_empty() {
            tracing::warn!(
                attempt_id = %job.attempt_id,
                hosts = ?ungranted,
                "allowlist entries without a capability grant were dropped"
            );
        }

        if job.budgets.is_unquoted() {
            // `None` means no cap is enforced. Say so; do not let an unpriced
            // job look like a bounded one.
            tracing::info!(
                attempt_id = %job.attempt_id,
                wall_clock_secs = job.budgets.wall_clock.as_secs(),
                "job has no token or tool-call budget; only the wall clock bounds it"
            );
        }

        let name = format!("cortex-sbx-{}", uuid::Uuid::new_v4());
        let config = Self::build_config(&self.image, job, request);

        let created = self
            .docker
            .create_container(
                Some(CreateContainerOptions {
                    name: name.clone(),
                    ..Default::default()
                }),
                config,
            )
            .await
            .map_err(|e| {
                Blocked::new(
                    BlockedReason::SandboxUnavailable,
                    format!("failed to create sandbox: {e}"),
                )
            })?;
        let id = created.id;

        // Attach before start, so no output is lost between the two.
        let attached = match self
            .docker
            .attach_container(
                &id,
                Some(AttachContainerOptions::<String> {
                    stdout: Some(true),
                    stderr: Some(true),
                    stream: Some(true),
                    ..Default::default()
                }),
            )
            .await
        {
            Ok(attached) => attached,
            Err(e) => {
                Self::remove(&self.docker, &id).await;
                return Err(Blocked::new(
                    BlockedReason::SandboxUnavailable,
                    format!("failed to attach to sandbox: {e}"),
                ));
            }
        };

        if let Err(e) = self
            .docker
            .start_container(&id, None::<StartContainerOptions<String>>)
            .await
        {
            Self::remove(&self.docker, &id).await;
            return Err(Blocked::new(
                BlockedReason::SandboxUnavailable,
                format!("failed to start sandbox: {e}"),
            ));
        }

        let (session, driver) = SandboxSession::channel(id.clone(), IsolationClass::Container);
        let docker = self.docker.clone();
        let wall_clock = job.budgets.wall_clock;

        tokio::spawn(drive(docker, id, attached, driver, wall_clock));

        Ok(session)
    }

    fn isolation_class(&self) -> IsolationClass {
        IsolationClass::Container
    }
}

/// Pump output, enforce the wall clock, honour a kill, and tear down — in every
/// exit path.
async fn drive(
    docker: Docker,
    id: String,
    attached: AttachContainerResults,
    driver: SandboxDriver,
    wall_clock: Duration,
) {
    let SandboxDriver {
        output,
        exit,
        mut kill,
    } = driver;

    let AttachContainerResults {
        output: mut stream, ..
    } = attached;
    let output_task = {
        let output = output.clone();
        tokio::spawn(async move {
            while let Some(chunk) = stream.next().await {
                let Ok(chunk) = chunk else { break };
                let (stream_kind, bytes) = match chunk {
                    bollard::container::LogOutput::StdOut { message } => {
                        (OutputStream::Stdout, message)
                    }
                    bollard::container::LogOutput::StdErr { message } => {
                        (OutputStream::Stderr, message)
                    }
                    other => (OutputStream::Stdout, other.into_bytes()),
                };
                let text = String::from_utf8_lossy(&bytes).to_string();
                for line in text.lines() {
                    if output
                        .send(SandboxLine {
                            stream: stream_kind,
                            text: line.to_string(),
                        })
                        .await
                        .is_err()
                    {
                        return;
                    }
                }
            }
        })
    };
    drop(output);

    let mut wait = docker.wait_container(&id, None::<WaitContainerOptions<String>>);

    let outcome = tokio::select! {
        // Operator stop or breaker. The sandbox dies; the outcome is
        // attributed to the stop rather than to the customer's work.
        _ = &mut kill => SandboxExit::Killed,

        // Invariant 14's cap, enforced at the boundary rather than trusted to
        // the agent.
        _ = tokio::time::sleep(wall_clock) => SandboxExit::BudgetExhausted,

        waited = wait.next() => match waited {
            Some(Ok(response)) => SandboxExit::Exited { code: response.status_code as i32 },
            // The sandbox vanished or the runtime failed mid-wait. We do not
            // know what happened, and a guess here becomes an unverified
            // delivery — refuse instead.
            Some(Err(e)) => {
                output_task.abort();
                ContainerSandbox::remove(&docker, &id).await;
                let _ = exit.send(Err(Blocked::new(
                    BlockedReason::SandboxUnavailable,
                    format!("sandbox wait failed: {e}"),
                )));
                return;
            }
            None => {
                output_task.abort();
                ContainerSandbox::remove(&docker, &id).await;
                let _ = exit.send(Err(Blocked::new(
                    BlockedReason::SandboxUnavailable,
                    "sandbox wait stream ended without a status",
                )));
                return;
            }
        },
    };

    // Let buffered output drain before teardown, so a receipt shows what the
    // sandbox managed to print — including where it hung.
    let _ = tokio::time::timeout(Duration::from_secs(5), output_task).await;
    ContainerSandbox::remove(&docker, &id).await;
    let _ = exit.send(Ok(outcome));
}

#[cfg(test)]
mod tests {
    use super::*;
    use cortex_core::execution_job::{
        BackendKind, Budgets, CapabilityGrant, EffortApplication, ModelRef, NetworkPolicy,
        ResourceProfile, EXECUTION_JOB_VERSION,
    };

    fn job() -> ExecutionJob {
        ExecutionJob {
            job_id: "job-1".to_string(),
            job_version: EXECUTION_JOB_VERSION,
            run_id: "run-1".to_string(),
            step_id: "step-1".to_string(),
            attempt_id: "attempt-1".to_string(),
            lease_gen: 1,
            model_ref: ModelRef::uncatalogued("claude-opus-5"),
            backend_kind: BackendKind::Cli,
            effort: None,
            effort_applied: EffortApplication::NotRequested,
            budgets: Budgets::unquoted(),
            network_policy: NetworkPolicy::default(),
            capability_grants: Vec::new(),
            context_bundle: None,
            quote_id: None,
            plan_receipt_id: None,
            image_ref: "cortex/runner@sha256:abc".to_string(),
            isolation_class: IsolationClass::Container,
            resource_profile: ResourceProfile::default(),
        }
    }

    fn request() -> SandboxRequest {
        SandboxRequest::new("/tmp/wt", "claude", vec!["-p".to_string()])
    }

    fn config_of(job: &ExecutionJob) -> Config<String> {
        ContainerSandbox::build_config("cortex/runner@sha256:abc", job, &request())
    }

    #[test]
    fn resource_bounds_are_all_set() {
        // An unbounded sandbox can take down the host. Every limit must have a
        // value, not a default that means "unlimited".
        let job = job();
        let host = config_of(&job).host_config.expect("host config");
        assert_eq!(host.memory, Some(job.resource_profile.memory_bytes));
        assert_eq!(host.memory_swap, Some(job.resource_profile.memory_bytes));
        assert_eq!(host.cpu_quota, Some(job.resource_profile.cpu_quota));
        assert_eq!(host.pids_limit, Some(job.resource_profile.pids_limit));
    }

    #[test]
    fn runs_unprivileged_with_a_readonly_root() {
        let host = config_of(&job()).host_config.expect("host config");
        assert_eq!(host.privileged, Some(false));
        assert_eq!(host.readonly_rootfs, Some(true));
        assert_eq!(host.cap_drop, Some(vec!["ALL".to_string()]));
        assert_eq!(
            host.security_opt,
            Some(vec!["no-new-privileges:true".to_string()])
        );
        assert_eq!(config_of(&job()).user, Some(SANDBOX_USER.to_string()));
    }

    #[test]
    fn environment_is_empty() {
        // Catches a provider credential reaching the sandbox — the case that
        // can spend Cortex's own money.
        assert_eq!(config_of(&job()).env, Some(Vec::new()));
    }

    #[test]
    fn only_the_workspace_is_mounted() {
        let host = config_of(&job()).host_config.expect("host config");
        let binds = host.binds.expect("binds");
        assert_eq!(binds.len(), 1);
        assert!(binds[0].ends_with(":/work:rw"));
        assert!(!binds.iter().any(|b| b.contains("docker.sock")));
    }

    #[test]
    fn network_is_denied_by_default() {
        let config = config_of(&job());
        assert_eq!(config.network_disabled, Some(true));
        assert_eq!(
            config.host_config.expect("host config").network_mode,
            Some("none".to_string())
        );
    }

    #[test]
    fn ungranted_allowlist_still_gets_no_network() {
        // An allowlist entry without a capability grant must not open egress.
        let mut job = job();
        job.network_policy = NetworkPolicy::Allowlist {
            hosts: vec!["evil.example.com".to_string()],
        };
        let config = config_of(&job);
        assert_eq!(config.network_disabled, Some(true));
        assert_eq!(
            config.host_config.expect("host config").network_mode,
            Some("none".to_string())
        );
    }

    #[test]
    fn granted_allowlist_uses_a_per_attempt_network() {
        // Scoped to the attempt, so it is torn down with it and cannot be
        // reached by the next task.
        let mut job = job();
        job.network_policy = NetworkPolicy::Allowlist {
            hosts: vec!["crates.io".to_string()],
        };
        job.capability_grants = vec![CapabilityGrant::ResolveDependencies {
            registries: vec!["crates.io".to_string()],
        }];
        let config = config_of(&job);
        assert_eq!(config.network_disabled, Some(false));
        assert_eq!(
            config.host_config.expect("host config").network_mode,
            Some("cortex-egress-attempt-1".to_string())
        );
    }

    #[test]
    fn the_command_is_the_request_argv() {
        assert_eq!(
            config_of(&job()).cmd,
            Some(vec!["claude".to_string(), "-p".to_string()])
        );
    }

    #[test]
    fn teardown_is_never_automatic() {
        // auto_remove would race the log drain and hide where a sandbox hung.
        let host = config_of(&job()).host_config.expect("host config");
        assert_eq!(host.auto_remove, Some(false));
    }
}
