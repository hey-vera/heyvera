//! What a sandbox is allowed to see, reach, and consume.
//!
//! The rules here are the ones that would otherwise be spread across an
//! implementation and quietly relaxed one commit at a time.

use std::path::{Path, PathBuf};

use cortex_core::execution_job::{CapabilityGrant, ExecutionJob};

/// Where the workspace is mounted inside the sandbox. Fixed, so a command
/// built for one runtime is valid in the next one.
pub const WORKSPACE_MOUNT: &str = "/work";

/// Everything the runner needs to start a job that the job itself does not
/// describe: the tree to work in and the command to run.
///
/// The job says *what policy applies*; the request says *what to run*. Keeping
/// them apart is what stops a caller smuggling an argument past a policy.
pub struct SandboxRequest {
    /// Host path of the isolated worktree. Mounted read-write at
    /// [`WORKSPACE_MOUNT`] and nowhere else.
    pub workspace: PathBuf,
    /// Program to execute inside the sandbox.
    pub program: String,
    /// Arguments, including the task prompt.
    pub args: Vec<String>,
}

impl SandboxRequest {
    pub fn new(workspace: impl AsRef<Path>, program: impl Into<String>, args: Vec<String>) -> Self {
        Self {
            workspace: workspace.as_ref().to_path_buf(),
            program: program.into(),
            args,
        }
    }

    /// The full argv, as the sandbox will see it.
    pub fn argv(&self) -> Vec<String> {
        let mut argv = Vec::with_capacity(self.args.len() + 1);
        argv.push(self.program.clone());
        argv.extend(self.args.iter().cloned());
        argv
    }
}

/// The environment handed to the sandbox.
///
/// It is empty, and it is empty on purpose. A filtered environment is a
/// denylist somebody has to keep correct forever; the first variable anyone
/// forgets is the one that leaks. Nothing the agent legitimately needs arrives
/// this way: the workspace is a mount, the model is an argument, and Git
/// credentials belong to the runner service rather than to the model process.
pub fn sanctioned_env() -> Vec<String> {
    Vec::new()
}

/// Hosts the sandbox may reach, derived from the policy *and* the grants.
///
/// A capability grant to resolve dependencies is what justifies a registry
/// being reachable; the allowlist is what makes it reachable. Both must agree,
/// so a grant without an allowlist entry opens nothing and an allowlist entry
/// without a grant is reported by [`ungranted_hosts`].
pub fn effective_hosts(job: &ExecutionJob) -> Vec<String> {
    if job.network_policy.is_deny() {
        return Vec::new();
    }

    let granted = granted_registries(job);
    job.network_policy
        .allowed_hosts()
        .iter()
        .filter(|host| granted.iter().any(|registry| registry == *host))
        .cloned()
        .collect()
}

/// Allowlist entries that no capability grant justifies.
///
/// These are not silently dropped — [`effective_hosts`] already excludes them,
/// and a caller reports them, because an allowlist entry nobody granted is
/// either a mistake or an attempt.
pub fn ungranted_hosts(job: &ExecutionJob) -> Vec<String> {
    let granted = granted_registries(job);
    job.network_policy
        .allowed_hosts()
        .iter()
        .filter(|host| !granted.iter().any(|registry| registry == *host))
        .cloned()
        .collect()
}

fn granted_registries(job: &ExecutionJob) -> Vec<String> {
    job.capability_grants
        .iter()
        .flat_map(|grant| match grant {
            CapabilityGrant::ResolveDependencies { registries } => registries.clone(),
            CapabilityGrant::ReadSecret { .. } => Vec::new(),
        })
        .collect()
}

/// Whether the runtime must be asked for a network at all.
///
/// Deny and "an allowlist that nothing justifies" are the same thing at the
/// boundary: no network.
pub fn needs_network(job: &ExecutionJob) -> bool {
    !effective_hosts(job).is_empty()
}

/// The mount set. Exactly one entry, read-write, and never the host root, the
/// Docker socket, the home directory, or the production database.
pub fn binds(request: &SandboxRequest) -> Vec<String> {
    vec![format!(
        "{}:{}:rw",
        request.workspace.display(),
        WORKSPACE_MOUNT
    )]
}

#[cfg(test)]
mod tests {
    use super::*;
    use cortex_core::execution_job::{
        BackendKind, Budgets, EffortApplication, ExecutionJob, IsolationClass, ModelRef,
        NetworkPolicy, ResourceProfile, EXECUTION_JOB_VERSION,
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

    #[test]
    fn environment_is_empty_not_filtered() {
        // The case this prevents: a provider key, a Clerk secret, or the
        // production database path reaching a sandbox because a denylist
        // missed it.
        assert!(sanctioned_env().is_empty());
    }

    #[test]
    fn default_job_gets_no_network() {
        // Asserts the default, not just the explicit case.
        assert!(!needs_network(&job()));
        assert!(effective_hosts(&job()).is_empty());
    }

    #[test]
    fn allowlist_without_a_grant_opens_nothing() {
        let mut job = job();
        job.network_policy = NetworkPolicy::Allowlist {
            hosts: vec!["evil.example.com".to_string()],
        };
        assert!(effective_hosts(&job).is_empty());
        assert!(!needs_network(&job));
        assert_eq!(ungranted_hosts(&job), ["evil.example.com"]);
    }

    #[test]
    fn grant_and_allowlist_together_open_exactly_the_registry() {
        let mut job = job();
        job.network_policy = NetworkPolicy::Allowlist {
            hosts: vec!["crates.io".to_string(), "evil.example.com".to_string()],
        };
        job.capability_grants = vec![CapabilityGrant::ResolveDependencies {
            registries: vec!["crates.io".to_string()],
        }];

        assert_eq!(effective_hosts(&job), ["crates.io"]);
        assert_eq!(ungranted_hosts(&job), ["evil.example.com"]);
        assert!(needs_network(&job));
    }

    #[test]
    fn a_secret_grant_does_not_open_the_network() {
        // Reading a secret is delivered by the runner, not fetched by the
        // sandbox. Conflating the two would make every secret a network hole.
        let mut job = job();
        job.network_policy = NetworkPolicy::Allowlist {
            hosts: vec!["vault.internal".to_string()],
        };
        job.capability_grants = vec![CapabilityGrant::ReadSecret {
            secret_id: "s-1".to_string(),
        }];
        assert!(effective_hosts(&job).is_empty());
    }

    #[test]
    fn workspace_is_the_only_mount() {
        // Catches a Docker socket, a home directory, or the host root being
        // added to the mount set.
        let request = SandboxRequest::new("/tmp/wt", "claude", vec!["-p".to_string()]);
        let binds = binds(&request);
        assert_eq!(binds.len(), 1);
        assert!(binds[0].ends_with(":/work:rw"));
        assert!(!binds[0].contains("docker.sock"));
    }

    #[test]
    fn argv_puts_the_program_first() {
        let request = SandboxRequest::new(
            "/tmp/wt",
            "claude",
            vec!["--model".to_string(), "opus".to_string()],
        );
        assert_eq!(request.argv(), ["claude", "--model", "opus"]);
    }
}
