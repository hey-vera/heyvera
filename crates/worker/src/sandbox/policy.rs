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
/// The port an allowlist entry permits when it does not name one.
///
/// 443 and only 443. An entry that names a host but no port is an allowlist for
/// every service on that host — an SSH daemon, a database, an internal admin
/// port — which is not what anyone means by "let this task reach the registry".
pub const DEFAULT_EGRESS_PORT: u16 = 443;

/// What a registry name expands to.
///
/// A grant names a registry; **we** decide what that name reaches. This is what
/// "package-registry access means exactly the registry" is in code: the task
/// cannot widen its own grant by naming an extra hostname, because a name this
/// table does not know expands to nothing.
///
/// Every host here is required for the ecosystem's default client to resolve
/// and download a dependency, and nothing here is required for anything else.
const REGISTRIES: &[(&str, &[&str])] = &[
    // `npm install` resolves metadata and tarballs from the same host.
    ("npm", &["registry.npmjs.org"]),
    // cargo reads the sparse index from index.crates.io and downloads .crate
    // files from static.crates.io. crates.io itself is the API, used by
    // `cargo publish` and `cargo search`.
    (
        "crates",
        &["index.crates.io", "static.crates.io", "crates.io"],
    ),
    // pip resolves from pypi.org and downloads wheels from the file host.
    ("pypi", &["pypi.org", "files.pythonhosted.org"]),
    // The module proxy serves modules; the checksum database is what makes a
    // module verifiable, so granting one without the other breaks `go mod`.
    ("go", &["proxy.golang.org", "sum.golang.org"]),
];

/// A host and the port it is permitted on. Both halves matter: the port is not
/// a detail of the host, it is half of what was granted.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct Endpoint {
    pub host: String,
    pub port: u16,
}

impl std::fmt::Display for Endpoint {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}:{}", self.host, self.port)
    }
}

impl Endpoint {
    /// Parse an allowlist entry. `host` means `host:443`; `host:80` means what
    /// it says. A malformed port is rejected rather than defaulted, because a
    /// typo that silently becomes 443 is a policy nobody wrote.
    fn parse(entry: &str) -> Option<Self> {
        let entry = entry.trim().to_ascii_lowercase();
        if entry.is_empty() {
            return None;
        }
        match entry.rsplit_once(':') {
            Some((host, port)) => Some(Self {
                host: host.to_string(),
                port: port.parse().ok()?,
            }),
            None => Some(Self {
                host: entry,
                port: DEFAULT_EGRESS_PORT,
            }),
        }
    }
}

/// The hosts a registry name justifies, or `None` if we do not know the name.
///
/// A raw hostname is accepted when it is one this table already knows — so a
/// grant of `crates.io` still means `crates.io` — but a hostname the table has
/// never heard of justifies nothing and is reported by [`unknown_registries`].
fn expand_registry(name: &str) -> Option<Vec<String>> {
    let name = name.trim().to_ascii_lowercase();
    if let Some((_, hosts)) = REGISTRIES.iter().find(|(alias, _)| *alias == name) {
        return Some(hosts.iter().map(|host| host.to_string()).collect());
    }
    if REGISTRIES
        .iter()
        .any(|(_, hosts)| hosts.iter().any(|host| *host == name))
    {
        return Some(vec![name]);
    }
    None
}

/// Registry names in the grants that we do not recognise.
///
/// Not silently ignored: a grant naming an unknown registry is a mistake or an
/// attempt, and the caller refuses the job rather than quietly running it with
/// less access than was asked for. A job that reaches less than its author
/// believed fails in a way that looks like a broken network.
pub fn unknown_registries(job: &ExecutionJob) -> Vec<String> {
    job.capability_grants
        .iter()
        .flat_map(|grant| match grant {
            CapabilityGrant::ResolveDependencies { registries } => registries.clone(),
            CapabilityGrant::ReadSecret { .. } => Vec::new(),
        })
        .filter(|name| expand_registry(name).is_none())
        .collect()
}

/// A capability grant to resolve dependencies is what justifies a registry
/// being reachable; the allowlist is what makes it reachable. Both must agree,
/// so a grant without an allowlist entry opens nothing and an allowlist entry
/// without a grant is reported by [`ungranted_hosts`].
pub fn effective_endpoints(job: &ExecutionJob) -> Vec<Endpoint> {
    if job.network_policy.is_deny() {
        return Vec::new();
    }

    let granted = granted_hosts(job);
    let mut endpoints: Vec<Endpoint> = job
        .network_policy
        .allowed_hosts()
        .iter()
        .filter_map(|entry| Endpoint::parse(entry))
        .filter(|endpoint| granted.iter().any(|host| *host == endpoint.host))
        .collect();
    endpoints.sort();
    endpoints.dedup();
    endpoints
}

/// The host names of [`effective_endpoints`], for callers that only need the
/// names.
pub fn effective_hosts(job: &ExecutionJob) -> Vec<String> {
    effective_endpoints(job)
        .into_iter()
        .map(|endpoint| endpoint.host)
        .collect()
}

/// Allowlist entries that no capability grant justifies.
///
/// These are not silently dropped — [`effective_endpoints`] already excludes
/// them, and a caller reports them, because an allowlist entry nobody granted
/// is either a mistake or an attempt.
pub fn ungranted_hosts(job: &ExecutionJob) -> Vec<String> {
    let granted = granted_hosts(job);
    job.network_policy
        .allowed_hosts()
        .iter()
        .filter(|entry| match Endpoint::parse(entry) {
            Some(endpoint) => !granted.iter().any(|host| *host == endpoint.host),
            // An unparseable entry justifies nothing and is worth reporting.
            None => true,
        })
        .cloned()
        .collect()
}

fn granted_hosts(job: &ExecutionJob) -> Vec<String> {
    job.capability_grants
        .iter()
        .flat_map(|grant| match grant {
            CapabilityGrant::ResolveDependencies { registries } => registries
                .iter()
                .filter_map(|name| expand_registry(name))
                .flatten()
                .collect::<Vec<_>>(),
            CapabilityGrant::ReadSecret { .. } => Vec::new(),
        })
        .collect()
}

/// Whether the runtime must be asked for a network at all.
///
/// Deny and "an allowlist that nothing justifies" are the same thing at the
/// boundary: no network.
pub fn needs_network(job: &ExecutionJob) -> bool {
    !effective_endpoints(job).is_empty()
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
            effective_egress: Some(Vec::new()),
            egress_mediator: None,
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
