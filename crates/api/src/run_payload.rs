use serde_json::{json, Value};

use crate::db::Database;

pub fn build_run_step_payloads(db: &Database, run_id: &str) -> Vec<Value> {
    db.get_all_step_statuses(run_id)
        .iter()
        .map(|(sid, status)| build_step_payload(db, sid, status))
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

fn build_step_payload(db: &Database, sid: &str, status: &str) -> Value {
    let details = db.get_step_details(sid);
    let predecessors = db.get_step_predecessors(sid);
    let output = db.get_step_output_summary(sid);
    let files = db
        .get_step_files_changed(sid)
        .and_then(|raw| serde_json::from_str::<Vec<String>>(&raw).ok());
    let error = db.get_step_last_error(sid);
    let verifier = db.get_latest_verifier_report(sid);
    let recipe_seed = db
        .get_step_recipe_seed_json(sid)
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok());
    let work_contract = db.get_latest_step_work_contract(sid);

    let mut step = json!({
        "id": sid,
        "status": status,
        "predecessors": predecessors,
    });

    if let Some((kind, work_kind, tier, risk, objective)) = details {
        step["kind"] = json!(kind);
        step["work_kind"] = json!(work_kind);
        step["tier"] = json!(tier);
        step["risk"] = json!(risk);
        step["objective"] = json!(objective);
    }
    if let Some(output) = output {
        step["output_summary"] = json!(output);
    }
    if let Some(files) = files {
        step["files_changed"] = json!(files);
    }
    if let Some(error) = error {
        step["last_error"] = json!(error);
    }
    if let Some(verifier) = verifier {
        step["verification_status"] = json!(verifier.status);
        step["verifier_verdict"] = json!(verifier.verdict);
        step["verifier_report_id"] = json!(verifier.id);
    }
    if let Some(recipe_seed) = recipe_seed {
        step["recipe_seed"] = recipe_seed;
    }
    if let Some(work_contract) = work_contract {
        if let Some(work_recipe) = work_contract.work_recipe {
            step["work_recipe"] = serde_json::to_value(work_recipe).unwrap_or(Value::Null);
        }
        step["acceptance_criteria"] = json!(work_contract.acceptance_criteria);
        step["required_checks"] = json!(work_contract.required_checks);
    }

    step
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
        assert!(db.complete_step(
            "step_a",
            lease_gen,
            Some("done"),
            Some(r#"["src/main.rs"]"#),
            None,
            None,
        ));

        let steps = build_run_step_payloads(&db, &run_id);

        assert_eq!(steps[0]["files_changed"][0], "src/main.rs");
    }
}
