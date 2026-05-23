use std::collections::HashMap;

use serde_json::{json, Value};

use crate::db::{Database, RunStepSnapshot, StepDependencyEdge};

const TERMINAL_STATUSES: &[&str] = &["succeeded", "failed", "recovered", "cancelled", "skipped"];

pub fn build_run_step_payloads(db: &Database, run_id: &str) -> Vec<Value> {
    let snapshots = db.get_run_step_snapshots(run_id);
    let status_by_step: HashMap<String, String> = snapshots
        .iter()
        .map(|snapshot| (snapshot.id.clone(), snapshot.status.clone()))
        .collect();
    let blockers_by_step =
        dependency_blockers_by_step(&db.get_run_step_dependency_edges(run_id), &status_by_step);

    snapshots
        .into_iter()
        .map(|snapshot| {
            let blockers = blockers_by_step
                .get(&snapshot.id)
                .cloned()
                .unwrap_or_default();
            build_step_payload(snapshot, blockers)
        })
        .collect()
}

pub fn build_run_graph_payload(db: &Database, run_id: &str, steps: &[Value]) -> Value {
    let nodes: Vec<Value> = steps
        .iter()
        .filter_map(|step| {
            let id = step.get("id")?.as_str()?;
            let label = step
                .get("objective")
                .and_then(Value::as_str)
                .or_else(|| step.get("kind").and_then(Value::as_str))
                .unwrap_or(id);

            Some(json!({
                "id": id,
                "label": label,
                "status": step.get("status").cloned().unwrap_or(Value::Null),
                "kind": step.get("kind").cloned().unwrap_or(Value::Null),
                "work_kind": step.get("work_kind").cloned().unwrap_or(Value::Null),
                "tier": step.get("tier").cloned().unwrap_or(Value::Null),
                "risk": step.get("risk").cloned().unwrap_or(Value::Null),
                "verification_status": step.get("verification_status").cloned().unwrap_or(Value::Null),
            }))
        })
        .collect();

    let edges: Vec<Value> = db
        .get_run_step_dependency_edges(run_id)
        .into_iter()
        .map(|edge| {
            json!({
                "from": edge.depends_on_id,
                "to": edge.step_id,
                "edge_type": edge.edge_type,
            })
        })
        .collect();

    json!({
        "nodes": nodes,
        "edges": edges,
    })
}

fn build_step_payload(snapshot: RunStepSnapshot, blocked_by: Vec<Value>) -> Value {
    let status = snapshot.status.clone();
    let lease_stale = snapshot
        .lease_deadline
        .map(|deadline| {
            matches!(status.as_str(), "leased" | "running")
                && deadline < chrono::Utc::now().timestamp_millis()
        })
        .unwrap_or(false);
    let health = step_health(&snapshot, lease_stale, !blocked_by.is_empty());
    let files = snapshot
        .files_changed
        .and_then(|raw| serde_json::from_str::<Vec<String>>(&raw).ok());
    let recipe_seed = snapshot
        .recipe_seed_json
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok());

    let mut step = json!({
        "id": snapshot.id,
        "status": status,
        "predecessors": snapshot.predecessors,
        "attempt_count": snapshot.attempt_count,
        "max_attempts": snapshot.max_attempts,
        "lease_gen": snapshot.lease_gen,
        "lease_deadline": snapshot.lease_deadline,
        "assigned_worker": snapshot.assigned_worker,
        "lease_stale": lease_stale,
        "health": health,
        "blocked_by": blocked_by,
    });
    if let Some(attempt) = snapshot.latest_attempt {
        step["latest_attempt"] = json!({
            "attempt_number": attempt.attempt_number,
            "worker_id": attempt.worker_id,
            "lease_gen": attempt.lease_gen,
            "status": attempt.status,
            "provider": attempt.provider,
            "model": attempt.model,
            "started_at": attempt.started_at,
            "finished_at": attempt.finished_at,
            "failure_kind": attempt.failure_kind,
            "error_summary": attempt.error_summary,
        });
    }

    step["kind"] = json!(snapshot.kind);
    step["work_kind"] = json!(snapshot.work_kind);
    step["tier"] = json!(snapshot.tier);
    step["risk"] = json!(snapshot.risk);
    step["objective"] = json!(snapshot.objective);

    if let Some(output) = snapshot.output_summary {
        step["output_summary"] = json!(output);
    }
    if let Some(files) = files {
        step["files_changed"] = json!(files);
    }
    if let Some(error) = snapshot.last_error {
        step["last_error"] = json!(error);
    }
    if let Some(verifier) = snapshot.verifier_report {
        step["verification_status"] = json!(verifier.status);
        step["verifier_verdict"] = json!(verifier.verdict);
        step["verifier_report_id"] = json!(verifier.id);
    }
    if let Some(recipe_seed) = recipe_seed {
        step["recipe_seed"] = recipe_seed;
    }
    if let Some(work_contract) = snapshot.work_contract {
        if let Some(work_recipe) = work_contract.work_recipe {
            step["work_recipe"] = serde_json::to_value(work_recipe).unwrap_or(Value::Null);
        }
        step["acceptance_criteria"] = json!(work_contract.acceptance_criteria);
        step["required_checks"] = json!(work_contract.required_checks);
    }

    step
}

fn dependency_blockers_by_step(
    edges: &[StepDependencyEdge],
    status_by_step: &HashMap<String, String>,
) -> HashMap<String, Vec<Value>> {
    let mut blockers: HashMap<String, Vec<Value>> = HashMap::new();

    for edge in edges {
        let dependency_status = status_by_step
            .get(&edge.depends_on_id)
            .map(String::as_str)
            .unwrap_or("unknown");
        if dependency_satisfied(&edge.edge_type, dependency_status) {
            continue;
        }

        blockers
            .entry(edge.step_id.clone())
            .or_default()
            .push(json!({
                "id": edge.depends_on_id,
                "status": dependency_status,
                "edge_type": edge.edge_type,
            }));
    }

    blockers
}

fn dependency_satisfied(edge_type: &str, dependency_status: &str) -> bool {
    match edge_type {
        "completion_required" => TERMINAL_STATUSES.contains(&dependency_status),
        _ => dependency_status == "succeeded",
    }
}

fn step_health(snapshot: &RunStepSnapshot, lease_stale: bool, has_blockers: bool) -> &'static str {
    if lease_stale {
        return "lease_stale";
    }
    if snapshot
        .verifier_report
        .as_ref()
        .is_some_and(|verifier| verifier.status == "needs_evidence" || verifier.verdict == "fail")
    {
        return "verification_rejected";
    }
    if matches!(snapshot.status.as_str(), "leased" | "running") {
        return "in_progress";
    }
    if snapshot.status == "pending" && has_blockers {
        return "waiting_on_dependency";
    }
    if snapshot.attempt_count >= snapshot.max_attempts
        && !TERMINAL_STATUSES.contains(&snapshot.status.as_str())
    {
        return "attempts_exhausted";
    }
    if TERMINAL_STATUSES.contains(&snapshot.status.as_str()) {
        return "terminal";
    }
    "ready"
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::*;

    fn test_db(dir: &Path) -> Database {
        Database::open(&dir.join("cortex.sqlite"))
    }

    #[test]
    fn run_graph_payload_uses_typed_dependency_edges() {
        let dir = tempfile::tempdir().unwrap();
        let db = test_db(dir.path());
        let run_id = db.create_run_with_steps(
            "user_1",
            "ship cortex",
            "auto",
            &[],
            &[
                (
                    "step_a".to_string(),
                    "plan".to_string(),
                    "inspect".to_string(),
                    None,
                    "standard".to_string(),
                    "low".to_string(),
                    "Plan the change".to_string(),
                    1,
                ),
                (
                    "step_b".to_string(),
                    "execute".to_string(),
                    "modify".to_string(),
                    None,
                    "standard".to_string(),
                    "medium".to_string(),
                    "Apply the change".to_string(),
                    2,
                ),
            ],
            &[(
                "step_b".to_string(),
                "step_a".to_string(),
                "completion_required".to_string(),
            )],
        );

        let steps = build_run_step_payloads(&db, &run_id);
        let graph = build_run_graph_payload(&db, &run_id, &steps);

        assert_eq!(graph["nodes"].as_array().unwrap().len(), 2);
        assert_eq!(graph["edges"][0]["from"], "step_a");
        assert_eq!(graph["edges"][0]["to"], "step_b");
        assert_eq!(graph["edges"][0]["edge_type"], "completion_required");
    }

    #[test]
    fn run_step_payload_parses_files_changed_as_array() {
        let dir = tempfile::tempdir().unwrap();
        let db = test_db(dir.path());
        let run_id = db.create_run_with_steps(
            "user_1",
            "ship cortex",
            "auto",
            &[],
            &[(
                "step_a".to_string(),
                "execute".to_string(),
                "modify".to_string(),
                None,
                "standard".to_string(),
                "low".to_string(),
                "Apply the change".to_string(),
                1,
            )],
            &[],
        );
        let lease_gen = db.lease_step("step_a", "worker_1", 99_999).unwrap();
        db.record_attempt(
            "step_a",
            &run_id,
            1,
            "worker_1",
            lease_gen,
            Some("claude"),
            Some("opus"),
        );
        assert!(db.complete_step(
            "step_a",
            lease_gen,
            Some("done"),
            Some(r#"["src/main.rs"]"#),
            None,
            None,
        ));
        db.complete_attempt("step_a", lease_gen);

        let steps = build_run_step_payloads(&db, &run_id);

        assert_eq!(steps[0]["files_changed"][0], "src/main.rs");
        assert_eq!(steps[0]["attempt_count"], 1);
        assert_eq!(steps[0]["lease_gen"], lease_gen);
        assert_eq!(steps[0]["assigned_worker"], "worker_1");
        assert_eq!(steps[0]["lease_stale"], false);
        assert_eq!(steps[0]["health"], "terminal");
        assert_eq!(steps[0]["latest_attempt"]["attempt_number"], 1);
        assert_eq!(steps[0]["latest_attempt"]["worker_id"], "worker_1");
        assert_eq!(steps[0]["latest_attempt"]["status"], "succeeded");
    }

    #[test]
    fn run_step_payload_reports_unsatisfied_dependency_blockers() {
        let dir = tempfile::tempdir().unwrap();
        let db = test_db(dir.path());
        let run_id = db.create_run_with_steps(
            "user_1",
            "ship cortex",
            "auto",
            &[],
            &[
                (
                    "step_a".to_string(),
                    "execute".to_string(),
                    "modify".to_string(),
                    None,
                    "standard".to_string(),
                    "low".to_string(),
                    "Apply the change".to_string(),
                    1,
                ),
                (
                    "step_b".to_string(),
                    "test".to_string(),
                    "verify".to_string(),
                    None,
                    "standard".to_string(),
                    "low".to_string(),
                    "Verify the change".to_string(),
                    2,
                ),
            ],
            &[(
                "step_b".to_string(),
                "step_a".to_string(),
                "success_required".to_string(),
            )],
        );

        let steps = build_run_step_payloads(&db, &run_id);
        let blocked_step = steps
            .iter()
            .find(|step| step["id"] == "step_b")
            .expect("step_b should be present");

        assert_eq!(blocked_step["health"], "waiting_on_dependency");
        assert_eq!(blocked_step["blocked_by"][0]["id"], "step_a");
        assert_eq!(blocked_step["blocked_by"][0]["status"], "pending");
        assert_eq!(
            blocked_step["blocked_by"][0]["edge_type"],
            "success_required"
        );
    }
}
