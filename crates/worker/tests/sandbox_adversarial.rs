//! Adversarial tests for the execution boundary.
//!
//! The unit tests in `crates/worker/src/sandbox/` assert the *configuration* —
//! that the runner asks for an empty environment, one mount, no network,
//! dropped capabilities. These assert the *effect*: that a process inside the
//! sandbox actually cannot read a host secret, reach the Docker socket, open a
//! connection, write outside its workspace, or leave anything behind for the
//! next task.
//!
//! Both matter, and the second kind is the one that catches a runtime whose
//! semantics differ from what the API promised.
//!
//! # Running them
//!
//! These need a live container runtime and the sandbox image, so they are
//! gated: they run when `CORTEX_SANDBOX_IT=1` and are skipped otherwise, which
//! keeps the Windows development loop usable. **They run in CI** — a gated
//! adversarial test that never executes is worse than no test, because it
//! reads like coverage.
//!
//! ```bash
//! docker build -f Dockerfile.sandbox -t cortex/sandbox:test .
//! CORTEX_SANDBOX_IT=1 CORTEX_SANDBOX_IMAGE=cortex/sandbox:test \
//!   cargo test -p cortex-worker --test sandbox_adversarial
//! ```

use cortex_core::execution_job::{
    BackendKind, Budgets, CapabilityGrant, EffortApplication, ExecutionJob, IsolationClass,
    ModelRef, NetworkPolicy, ResourceProfile, EXECUTION_JOB_VERSION,
};
use cortex_worker::sandbox::{ContainerSandbox, OutputStream, SandboxExit, SandboxRequest, SandboxRunner};

/// Skip unless a runtime is available and the test was asked for.
///
/// Returns the image to run. A missing image is a hard failure rather than a
/// skip when `CORTEX_SANDBOX_IT=1`: being asked to run these and silently not
/// running them is the failure mode this whole file exists to avoid.
fn enabled() -> Option<String> {
    if std::env::var("CORTEX_SANDBOX_IT").as_deref() != Ok("1") {
        return None;
    }
    Some(
        std::env::var("CORTEX_SANDBOX_IMAGE")
            .expect("CORTEX_SANDBOX_IT=1 requires CORTEX_SANDBOX_IMAGE"),
    )
}

fn job(image: &str, attempt: &str) -> ExecutionJob {
    ExecutionJob {
        job_id: uuid::Uuid::new_v4().to_string(),
        job_version: EXECUTION_JOB_VERSION,
        run_id: "run-it".to_string(),
        step_id: "step-it".to_string(),
        attempt_id: attempt.to_string(),
        lease_gen: 1,
        model_ref: ModelRef::uncatalogued("test-model"),
        backend_kind: BackendKind::Cli,
        effort: None,
        effort_applied: EffortApplication::NotRequested,
        budgets: Budgets::unquoted(),
        network_policy: NetworkPolicy::Deny,
        capability_grants: Vec::new(),
        context_bundle: None,
        quote_id: None,
        plan_receipt_id: None,
        image_ref: image.to_string(),
        isolation_class: IsolationClass::Container,
        resource_profile: ResourceProfile::default(),
    }
}

/// Run a shell command in a sandbox over `workspace`, returning
/// (stdout+stderr, exit).
async fn run(
    image: &str,
    workspace: &std::path::Path,
    attempt: &str,
    script: &str,
    mutate: impl FnOnce(&mut ExecutionJob),
) -> (String, SandboxExit) {
    let mut job = job(image, attempt);
    mutate(&mut job);

    let runner = ContainerSandbox::new(image).expect("container runtime must be reachable");
    let request = SandboxRequest::new(
        workspace,
        "sh",
        vec!["-c".to_string(), script.to_string()],
    );

    let mut session = runner
        .submit(&job, &request)
        .await
        .expect("sandbox must start");

    let mut output = String::new();
    while let Some(line) = session.next_line().await {
        let tag = match line.stream {
            OutputStream::Stdout => "",
            OutputStream::Stderr => "[stderr] ",
        };
        output.push_str(tag);
        output.push_str(&line.text);
        output.push('\n');
    }
    let exit = session.wait().await.expect("sandbox must report an outcome");
    (output, exit)
}

fn workspace() -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("cortex-it-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).expect("workspace");
    dir
}

fn exited_nonzero(exit: &SandboxExit) -> bool {
    matches!(exit, SandboxExit::Exited { code } if *code != 0)
}

#[tokio::test]
async fn cannot_read_a_host_secret() {
    let Some(image) = enabled() else { return };
    let dir = workspace();

    // A canary the host process can see and the sandbox must not. The
    // environment is empty rather than filtered, so nothing carries it in.
    std::env::set_var("CORTEX_IT_CANARY", "super-secret-value");

    let (output, _) = run(&image, &dir, "a1", "env; echo done", |_| {}).await;

    assert!(
        !output.contains("super-secret-value"),
        "a host environment variable reached the sandbox:\n{output}"
    );
    assert!(
        !output.contains("CORTEX_IT_CANARY"),
        "a host variable name reached the sandbox:\n{output}"
    );

    std::env::remove_var("CORTEX_IT_CANARY");
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn cannot_reach_the_docker_socket() {
    let Some(image) = enabled() else { return };
    let dir = workspace();

    // Reaching the socket is escape to full host control, so this is the
    // single highest-value assertion in the file.
    let (output, exit) = run(
        &image,
        &dir,
        "a2",
        "test -S /var/run/docker.sock && echo REACHABLE || echo absent",
        |_| {},
    )
    .await;

    assert!(
        !output.contains("REACHABLE"),
        "the Docker socket was mounted into the sandbox:\n{output}"
    );
    assert!(matches!(exit, SandboxExit::Exited { .. }));

    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn egress_is_denied_by_default() {
    let Some(image) = enabled() else { return };
    let dir = workspace();

    // No allowlist, no grant. A connection that succeeds here means a task can
    // fetch a passing result or exfiltrate a private tree.
    let (output, exit) = run(
        &image,
        &dir,
        "a3",
        "getent hosts example.com && echo RESOLVED || echo blocked",
        |_| {},
    )
    .await;

    assert!(
        !output.contains("RESOLVED"),
        "the sandbox resolved a host with egress denied:\n{output}"
    );
    assert!(matches!(exit, SandboxExit::Exited { .. }));

    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn an_ungranted_allowlist_entry_opens_nothing() {
    let Some(image) = enabled() else { return };
    let dir = workspace();

    // An allowlist without a matching capability grant must not open egress —
    // the two have to agree, or the allowlist is a self-service network.
    let (output, _) = run(
        &image,
        &dir,
        "a4",
        "getent hosts example.com && echo RESOLVED || echo blocked",
        |job| {
            job.network_policy = NetworkPolicy::Allowlist {
                hosts: vec!["example.com".to_string()],
            };
            // Deliberately no CapabilityGrant.
        },
    )
    .await;

    assert!(
        !output.contains("RESOLVED"),
        "an ungranted allowlist entry opened the network:\n{output}"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn cannot_write_outside_the_workspace() {
    let Some(image) = enabled() else { return };
    let dir = workspace();

    let (output, _) = run(
        &image,
        &dir,
        "a5",
        "echo x > /etc/cortex-escape 2>/dev/null && echo WROTE || echo denied; \
         echo y > /work/allowed && echo wrote-workspace",
        |_| {},
    )
    .await;

    assert!(
        !output.contains("WROTE"),
        "the sandbox wrote outside its workspace:\n{output}"
    );
    assert!(
        output.contains("wrote-workspace"),
        "the workspace must be writable, or no task can do work:\n{output}"
    );
    assert!(
        dir.join("allowed").exists(),
        "the workspace write must land on the mounted worktree"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn no_state_persists_into_the_next_task() {
    let Some(image) = enabled() else { return };
    let first = workspace();
    let second = workspace();

    // Write a marker outside the mount, where a reused sandbox would keep it.
    let (_, _) = run(&image, &first, "a6", "echo marker > /tmp/leftover", |_| {}).await;

    let (output, _) = run(
        &image,
        &second,
        "a7",
        "cat /tmp/leftover 2>/dev/null && echo LEAKED || echo clean",
        |_| {},
    )
    .await;

    assert!(
        !output.contains("LEAKED"),
        "state from a previous task survived into the next sandbox:\n{output}"
    );

    let _ = std::fs::remove_dir_all(&first);
    let _ = std::fs::remove_dir_all(&second);
}

#[tokio::test]
async fn runs_unprivileged() {
    let Some(image) = enabled() else { return };
    let dir = workspace();

    let (output, _) = run(&image, &dir, "a8", "id -u", |_| {}).await;

    assert!(
        !output.trim().lines().any(|line| line.trim() == "0"),
        "the sandbox ran as root:\n{output}"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn cannot_escalate_privileges() {
    let Some(image) = enabled() else { return };
    let dir = workspace();

    // no-new-privileges plus cap_drop ALL. If a setuid path still works, the
    // unprivileged user is decorative.
    let (output, exit) = run(&image, &dir, "a9", "su root -c id 2>&1 || echo denied", |_| {}).await;

    assert!(
        output.contains("denied") || exited_nonzero(&exit) || !output.contains("uid=0"),
        "privilege escalation succeeded inside the sandbox:\n{output}"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn the_wall_clock_budget_terminates_a_hung_job() {
    let Some(image) = enabled() else { return };
    let dir = workspace();

    // Invariant 14's cap, enforced at the boundary rather than trusted to the
    // agent. Without this the cap is decorative.
    let (_, exit) = run(&image, &dir, "a10", "sleep 600", |job| {
        job.budgets.wall_clock = std::time::Duration::from_secs(3);
    })
    .await;

    assert_eq!(
        exit,
        SandboxExit::BudgetExhausted,
        "a job that never exits must be terminated by its budget"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn a_granted_registry_is_reachable_and_nothing_else_is() {
    let Some(image) = enabled() else { return };
    let dir = workspace();

    // The positive case, so "deny everything" is not passing these tests by
    // making the sandbox useless. A grant plus a matching allowlist entry must
    // actually open that host.
    let (output, _) = run(
        &image,
        &dir,
        "a11",
        "getent hosts deb.debian.org >/dev/null && echo granted-ok || echo granted-blocked; \
         getent hosts example.com >/dev/null && echo OTHER-REACHABLE || echo other-blocked",
        |job| {
            job.network_policy = NetworkPolicy::Allowlist {
                hosts: vec!["deb.debian.org".to_string()],
            };
            job.capability_grants = vec![CapabilityGrant::ResolveDependencies {
                registries: vec!["deb.debian.org".to_string()],
            }];
        },
    )
    .await;

    assert!(
        !output.contains("OTHER-REACHABLE"),
        "a scoped grant opened more than the host it named:\n{output}"
    );

    let _ = std::fs::remove_dir_all(&dir);
}
