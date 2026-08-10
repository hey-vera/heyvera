//! What a registry grant *means*, and who decides a step gets one.
//!
//! Enforcement lives at the sandbox edge in `cortex-worker`. This module is the
//! half that has to be shared, for a reason worth stating: the planning path
//! issues the grant and names the allowlist, and the worker refuses any
//! allowlist entry no grant justifies. Those two ends must agree about what
//! `"npm"` expands to. If each kept its own table they would agree until one of
//! them was edited, and the failure mode is silent — the sandbox opens strictly
//! less than the planner believed, so a task fails looking like a broken
//! network rather than like a policy mismatch.
//!
//! So the table lives here, once, and both ends read it.

use serde::{Deserialize, Serialize};

use crate::execution_job::{CapabilityGrant, NetworkPolicy};

/// What a registry name expands to.
///
/// A grant names a registry; **we** decide what that name reaches. This is what
/// "package-registry access means exactly the registry" is in code: a task
/// cannot widen its own grant by naming an extra hostname, because a name this
/// table does not know expands to nothing.
///
/// Every host here is required for the ecosystem's default client to resolve
/// and download a dependency, and nothing here is required for anything else.
pub const REGISTRIES: &[(&str, &[&str])] = &[
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

/// The hosts a registry name justifies, or `None` if we do not know the name.
///
/// A raw hostname is accepted when it is one this table already knows — so a
/// grant of `crates.io` still means `crates.io` — but a hostname the table has
/// never heard of justifies nothing.
pub fn expand_registry(name: &str) -> Option<Vec<String>> {
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

/// Which dependency manifests a repository actually contains.
///
/// Deliberately separate from `check_derivation::EcosystemFacts`, which decides
/// what must *pass*. The two questions have different answers — a repo with a
/// `go.mod` needs the Go module proxy but contributes nothing to the check
/// floor — and keeping them apart means a change to what egress opens cannot
/// change what verification requires, or the reverse.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct EcosystemManifests {
    pub cargo: bool,
    pub npm: bool,
    pub pypi: bool,
    pub go: bool,
}

impl EcosystemManifests {
    pub fn is_empty(&self) -> bool {
        !self.cargo && !self.npm && !self.pypi && !self.go
    }

    /// The registry aliases these manifests justify, in a stable order.
    fn registries(&self) -> Vec<String> {
        let mut names = Vec::new();
        if self.cargo {
            names.push("crates".to_string());
        }
        if self.npm {
            names.push("npm".to_string());
        }
        if self.pypi {
            names.push("pypi".to_string());
        }
        if self.go {
            names.push("go".to_string());
        }
        names
    }
}

/// A grant and the allowlist that carries it, decided at plan time.
///
/// Both halves travel together because the worker requires both: a grant with
/// no allowlist entry opens nothing, and an allowlist entry with no grant is
/// refused and reported. Deriving them in one function is what keeps them from
/// disagreeing.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct EgressPlan {
    pub network_policy: NetworkPolicy,
    pub capability_grants: Vec<CapabilityGrant>,
}

impl EgressPlan {
    /// The plan that opens nothing. This is the default, and it is what every
    /// path that cannot positively justify a grant must return.
    pub fn deny() -> Self {
        Self {
            network_policy: NetworkPolicy::Deny,
            capability_grants: Vec::new(),
        }
    }

    pub fn is_deny(&self) -> bool {
        self.network_policy.is_deny()
    }

    /// The registry aliases granted, for a receipt or a log line.
    pub fn granted_registries(&self) -> Vec<String> {
        self.capability_grants
            .iter()
            .flat_map(|grant| match grant {
                CapabilityGrant::ResolveDependencies { registries } => registries.clone(),
                CapabilityGrant::ReadSecret { .. } => Vec::new(),
            })
            .collect()
    }
}

/// Decide the egress for one step.
///
/// Two conditions, both required, and the order they are checked in is the
/// argument:
///
/// 1. **The step must be able to change the tree.** A Search, Think, Review or
///    Gate step reads and reasons; it never resolves a dependency. Granting it
///    a registry would open a network for work that has no use for one, which
///    is exactly the "just in case" grant that makes an allowlist decorative.
/// 2. **The repository must actually use the ecosystem.** A grant is justified
///    by a manifest on disk, not by a guess about what a task might want. A
///    repository with no `Cargo.toml` gets no route to crates.io no matter what
///    the task says it needs.
///
/// Anything else is [`EgressPlan::deny`]. There is no argument that can widen
/// this from inside the task: the input is the repository and the step kind,
/// neither of which the task authors.
pub fn derive_egress(manifests: &EcosystemManifests, step_changes_tree: bool) -> EgressPlan {
    if !step_changes_tree || manifests.is_empty() {
        return EgressPlan::deny();
    }

    let registries = manifests.registries();
    let mut hosts: Vec<String> = registries
        .iter()
        .filter_map(|name| expand_registry(name))
        .flatten()
        .collect();
    hosts.sort();
    hosts.dedup();

    // Belt and braces: if the table somehow expanded nothing, deny rather than
    // emit an `Allowlist { hosts: [] }`, which reads as a policy that permits
    // something and permits nothing.
    if hosts.is_empty() {
        return EgressPlan::deny();
    }

    EgressPlan {
        network_policy: NetworkPolicy::Allowlist { hosts },
        capability_grants: vec![CapabilityGrant::ResolveDependencies { registries }],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn all() -> EcosystemManifests {
        EcosystemManifests {
            cargo: true,
            npm: true,
            pypi: true,
            go: true,
        }
    }

    #[test]
    fn every_registry_alias_expands() {
        for (alias, hosts) in REGISTRIES {
            let expanded = expand_registry(alias).expect("alias must expand");
            assert_eq!(expanded.len(), hosts.len(), "{alias} expanded oddly");
        }
    }

    #[test]
    fn a_hostname_the_table_knows_expands_to_itself() {
        assert_eq!(
            expand_registry("crates.io"),
            Some(vec!["crates.io".to_string()])
        );
        // Case and whitespace are normalised, not treated as a new name.
        assert_eq!(
            expand_registry("  Registry.NPMJS.org "),
            Some(vec!["registry.npmjs.org".to_string()])
        );
    }

    #[test]
    fn a_hostname_the_table_does_not_know_justifies_nothing() {
        assert_eq!(expand_registry("evil.example.com"), None);
        assert_eq!(expand_registry(""), None);
        // A near-miss on a known host is still unknown — no suffix matching.
        assert_eq!(expand_registry("registry.npmjs.org.evil.com"), None);
    }

    #[test]
    fn a_read_only_step_gets_nothing_however_rich_the_repo_is() {
        let plan = derive_egress(&all(), false);
        assert!(plan.is_deny());
        assert!(plan.capability_grants.is_empty());
    }

    #[test]
    fn an_empty_repo_gets_nothing_however_writable_the_step_is() {
        let plan = derive_egress(&EcosystemManifests::default(), true);
        assert!(plan.is_deny());
        assert!(plan.capability_grants.is_empty());
    }

    #[test]
    fn a_cargo_repo_gets_crates_and_only_crates() {
        let manifests = EcosystemManifests {
            cargo: true,
            ..Default::default()
        };
        let plan = derive_egress(&manifests, true);

        assert_eq!(plan.granted_registries(), vec!["crates".to_string()]);
        let hosts = plan.network_policy.allowed_hosts();
        assert!(hosts.contains(&"index.crates.io".to_string()));
        assert!(hosts.contains(&"static.crates.io".to_string()));
        assert!(
            !hosts.contains(&"registry.npmjs.org".to_string()),
            "a cargo repo must not reach npm"
        );
    }

    #[test]
    fn a_polyglot_repo_gets_each_ecosystem_once() {
        let plan = derive_egress(&all(), true);
        let hosts = plan.network_policy.allowed_hosts();

        let mut sorted = hosts.to_vec();
        sorted.sort();
        sorted.dedup();
        assert_eq!(sorted.len(), hosts.len(), "hosts must be deduplicated");

        // Every granted alias is represented, and nothing beyond the table.
        assert_eq!(plan.granted_registries().len(), 4);
        for host in hosts {
            assert!(
                REGISTRIES.iter().any(|(_, known)| known.contains(&host.as_str())),
                "{host} is not in the registry table"
            );
        }
    }

    #[test]
    fn the_allowlist_is_exactly_what_the_grants_justify() {
        // The property the worker enforces, asserted from the planning side:
        // every host in the allowlist is expanded from a granted alias, so
        // `ungranted_hosts` on the worker has nothing to report.
        let plan = derive_egress(&all(), true);
        let justified: Vec<String> = plan
            .granted_registries()
            .iter()
            .filter_map(|name| expand_registry(name))
            .flatten()
            .collect();

        for host in plan.network_policy.allowed_hosts() {
            assert!(justified.contains(host), "{host} is allowed but not granted");
        }
    }

    #[test]
    fn the_default_plan_denies() {
        assert!(EgressPlan::default().is_deny());
        assert!(EgressPlan::default().capability_grants.is_empty());
    }
}
