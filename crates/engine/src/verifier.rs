use cortex_core::contamination::{EvidenceSignal, EvidenceSource, SignalTier};
use cortex_core::protocol::StepOutput;
use cortex_core::routing::RiskLevel;
use cortex_core::task::TaskContract;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::evidence_floor::{check_floor, FloorVerdict};
use crate::risk::classify_risk;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct VerifierWorkContract {
    pub task_id: Option<Uuid>,
    pub objective: String,
    pub risk: RiskLevel,
    pub acceptance_criteria: Vec<String>,
    pub allowed_paths: Vec<String>,
    pub expected_base_commit: Option<String>,
}

impl VerifierWorkContract {
    pub fn from_task_contract(
        task: &TaskContract,
        allowed_paths: Vec<String>,
        expected_base_commit: Option<String>,
    ) -> Self {
        Self {
            task_id: Some(task.id),
            objective: task.objective.clone(),
            risk: task.risk,
            acceptance_criteria: task.acceptance_criteria.clone(),
            allowed_paths,
            expected_base_commit,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StructuredStepEvidence {
    pub step_id: Option<String>,
    pub attempt_id: Option<String>,
    pub summary: String,
    pub exit_code: Option<i32>,
    pub files_changed: Vec<String>,
    pub base_commit: Option<String>,
    pub head_commit: Option<String>,
    pub commands: Vec<CommandEvidence>,
    pub checks: Vec<CheckEvidence>,
    pub signals: Vec<EvidenceSignal>,
}

impl StructuredStepEvidence {
    pub fn from_step_output(
        output: StepOutput,
        exit_code: i32,
        base_commit: Option<String>,
        head_commit: Option<String>,
    ) -> Self {
        Self {
            step_id: None,
            attempt_id: None,
            summary: output.summary,
            exit_code: Some(exit_code),
            files_changed: output.files_changed,
            base_commit,
            head_commit,
            commands: Vec::new(),
            checks: Vec::new(),
            signals: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct VerifierInput {
    pub contract: VerifierWorkContract,
    pub evidence: StructuredStepEvidence,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CommandEvidence {
    pub command: String,
    pub exit_code: Option<i32>,
    pub summary: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CheckEvidence {
    pub name: String,
    pub status: CheckStatus,
    pub summary: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CheckStatus {
    Passed,
    Failed,
    Skipped,
    Unknown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VerifierVerdict {
    Success,
    NeedsEvidence,
    Failed,
    Blocked,
}

impl VerifierVerdict {
    pub fn is_success(&self) -> bool {
        matches!(self, Self::Success)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VerifierNextAction {
    Accept,
    AddEvidence,
    FixAndRetry,
    RebaseAndRetry,
    NarrowScope,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct VerifierReport {
    pub verdict: VerifierVerdict,
    pub risk: RiskLevel,
    pub evidence_signals: Vec<EvidenceSignal>,
    pub evidence_floor: VerifierFloorSummary,
    pub allowed_path_violations: Vec<AllowedPathViolation>,
    pub command_summary: CommandSummary,
    pub check_summary: CheckSummary,
    pub acceptance_coverage: AcceptanceCoverage,
    pub stale_base_notes: Vec<StaleBaseNote>,
    pub next_action: VerifierNextAction,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct VerifierFloorSummary {
    pub satisfied: bool,
    pub signals_met: Vec<String>,
    pub missing: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AllowedPathViolation {
    pub path: String,
    pub reason: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CommandSummary {
    pub total: usize,
    pub succeeded: usize,
    pub failed: usize,
    pub unknown: usize,
    pub failures: Vec<CommandFailure>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CommandFailure {
    pub command: String,
    pub exit_code: Option<i32>,
    pub summary: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CheckSummary {
    pub total: usize,
    pub passed: usize,
    pub failed: usize,
    pub skipped: usize,
    pub unknown: usize,
    pub failures: Vec<CheckFailure>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CheckFailure {
    pub name: String,
    pub summary: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AcceptanceCoverage {
    pub evaluated: bool,
    pub total: usize,
    pub covered: usize,
    pub uncovered: Vec<String>,
    pub note: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct StaleBaseNote {
    pub expected_base_commit: Option<String>,
    pub observed_base_commit: Option<String>,
    pub note: String,
}

pub fn verify_step(input: VerifierInput) -> VerifierReport {
    verify_contract_evidence(&input.contract, &input.evidence)
}

pub fn verify_contract_evidence(
    contract: &VerifierWorkContract,
    evidence: &StructuredStepEvidence,
) -> VerifierReport {
    let risk = observed_risk(contract.risk, &evidence.files_changed);
    let mut evidence_signals = evidence.signals.clone();
    evidence_signals.extend(signals_from_evidence(evidence));

    let evidence_floor = summarize_floor(check_floor(risk, &evidence_signals));
    let allowed_path_violations =
        find_allowed_path_violations(&contract.allowed_paths, &evidence.files_changed);
    let command_summary = summarize_commands(&evidence.commands);
    let check_summary = summarize_checks(&evidence.checks);
    let acceptance_coverage =
        placeholder_acceptance_coverage(&contract.acceptance_criteria);
    let stale_base_notes = stale_base_notes(contract, evidence);

    let (verdict, next_action) = decide_verdict(
        evidence.exit_code,
        &allowed_path_violations,
        &command_summary,
        &check_summary,
        &evidence_floor,
        &stale_base_notes,
    );

    VerifierReport {
        verdict,
        risk,
        evidence_signals,
        evidence_floor,
        allowed_path_violations,
        command_summary,
        check_summary,
        acceptance_coverage,
        stale_base_notes,
        next_action,
    }
}

pub fn find_allowed_path_violations(
    allowed_paths: &[String],
    changed_paths: &[String],
) -> Vec<AllowedPathViolation> {
    if allowed_paths.is_empty() || allowed_paths.iter().any(|p| p.trim() == "*") {
        return Vec::new();
    }

    let normalized_allowed: Vec<String> = allowed_paths
        .iter()
        .filter_map(|path| normalize_repo_path(path).ok())
        .collect();

    changed_paths
        .iter()
        .filter_map(|path| {
            let normalized = match normalize_repo_path(path) {
                Ok(path) => path,
                Err(reason) => {
                    return Some(AllowedPathViolation {
                        path: path.clone(),
                        reason,
                    });
                }
            };

            if normalized_allowed
                .iter()
                .any(|allowed| path_matches_allowed(&normalized, allowed))
            {
                None
            } else {
                Some(AllowedPathViolation {
                    path: path.clone(),
                    reason: "changed path is outside the allowed path contract".into(),
                })
            }
        })
        .collect()
}

pub fn summarize_commands(commands: &[CommandEvidence]) -> CommandSummary {
    let mut summary = CommandSummary {
        total: commands.len(),
        succeeded: 0,
        failed: 0,
        unknown: 0,
        failures: Vec::new(),
    };

    for command in commands {
        match command.exit_code {
            Some(0) => summary.succeeded += 1,
            Some(_) => {
                summary.failed += 1;
                summary.failures.push(CommandFailure {
                    command: command.command.clone(),
                    exit_code: command.exit_code,
                    summary: command.summary.clone(),
                });
            }
            None => summary.unknown += 1,
        }
    }

    summary
}

pub fn summarize_checks(checks: &[CheckEvidence]) -> CheckSummary {
    let mut summary = CheckSummary {
        total: checks.len(),
        passed: 0,
        failed: 0,
        skipped: 0,
        unknown: 0,
        failures: Vec::new(),
    };

    for check in checks {
        match check.status {
            CheckStatus::Passed => summary.passed += 1,
            CheckStatus::Failed => {
                summary.failed += 1;
                summary.failures.push(CheckFailure {
                    name: check.name.clone(),
                    summary: check.summary.clone(),
                });
            }
            CheckStatus::Skipped => summary.skipped += 1,
            CheckStatus::Unknown => summary.unknown += 1,
        }
    }

    summary
}

fn decide_verdict(
    exit_code: Option<i32>,
    allowed_path_violations: &[AllowedPathViolation],
    command_summary: &CommandSummary,
    check_summary: &CheckSummary,
    evidence_floor: &VerifierFloorSummary,
    stale_base_notes: &[StaleBaseNote],
) -> (VerifierVerdict, VerifierNextAction) {
    if !stale_base_notes.is_empty() {
        return (VerifierVerdict::Blocked, VerifierNextAction::RebaseAndRetry);
    }

    if !allowed_path_violations.is_empty() {
        return (VerifierVerdict::Blocked, VerifierNextAction::NarrowScope);
    }

    if exit_code.is_some_and(|code| code != 0)
        || command_summary.failed > 0
        || check_summary.failed > 0
    {
        return (VerifierVerdict::Failed, VerifierNextAction::FixAndRetry);
    }

    if !evidence_floor.satisfied {
        return (VerifierVerdict::NeedsEvidence, VerifierNextAction::AddEvidence);
    }

    (VerifierVerdict::Success, VerifierNextAction::Accept)
}

fn observed_risk(contract_risk: RiskLevel, changed_paths: &[String]) -> RiskLevel {
    let changed: Vec<&str> = changed_paths.iter().map(String::as_str).collect();
    contract_risk.max(classify_risk(&changed))
}

fn summarize_floor(verdict: FloorVerdict) -> VerifierFloorSummary {
    match verdict {
        FloorVerdict::Satisfied { signals_met } => VerifierFloorSummary {
            satisfied: true,
            signals_met,
            missing: Vec::new(),
        },
        FloorVerdict::Blocked { missing, .. } => VerifierFloorSummary {
            satisfied: false,
            signals_met: Vec::new(),
            missing,
        },
    }
}

fn signals_from_evidence(evidence: &StructuredStepEvidence) -> Vec<EvidenceSignal> {
    let mut signals = Vec::new();

    if evidence.exit_code == Some(0) {
        signals.push(EvidenceSignal::new(
            SignalTier::HardObjective,
            EvidenceSource::RuntimeBehavior,
            None,
            None,
            1.0,
            "step process exited successfully",
        ));
    }

    for command in &evidence.commands {
        if command.exit_code == Some(0) {
            signals.push(EvidenceSignal::new(
                SignalTier::HardObjective,
                source_for_command(&command.command),
                None,
                None,
                1.0,
                format!("command passed: {}", command.command),
            ));
        }
    }

    for check in &evidence.checks {
        if check.status == CheckStatus::Passed {
            signals.push(EvidenceSignal::new(
                SignalTier::HardObjective,
                source_for_command(&check.name),
                None,
                None,
                1.0,
                format!("check passed: {}", check.name),
            ));
        }
    }

    signals
}

fn source_for_command(command: &str) -> EvidenceSource {
    let lower = command.to_lowercase();
    if lower.contains("lint") || lower.contains("clippy") {
        EvidenceSource::Linter
    } else if lower.contains("test") || lower.contains("spec") {
        EvidenceSource::ExistingTestSuite
    } else if lower.contains("build") || lower.contains("check") || lower.contains("cargo") {
        EvidenceSource::CompilerOutput
    } else {
        EvidenceSource::RuntimeBehavior
    }
}

fn stale_base_notes(
    contract: &VerifierWorkContract,
    evidence: &StructuredStepEvidence,
) -> Vec<StaleBaseNote> {
    match (&contract.expected_base_commit, &evidence.base_commit) {
        (Some(expected), Some(observed)) if expected != observed => vec![StaleBaseNote {
            expected_base_commit: Some(expected.clone()),
            observed_base_commit: Some(observed.clone()),
            note: "step ran against a different base commit than the work contract expected".into(),
        }],
        (Some(expected), None) => vec![StaleBaseNote {
            expected_base_commit: Some(expected.clone()),
            observed_base_commit: None,
            note: "work contract expected a base commit but step evidence did not report one".into(),
        }],
        _ => Vec::new(),
    }
}

fn placeholder_acceptance_coverage(criteria: &[String]) -> AcceptanceCoverage {
    AcceptanceCoverage {
        evaluated: false,
        total: criteria.len(),
        covered: 0,
        uncovered: criteria.to_vec(),
        note: "acceptance coverage is reserved for a later semantic matcher".into(),
    }
}

fn path_matches_allowed(path: &str, allowed: &str) -> bool {
    if allowed.is_empty() {
        return false;
    }

    path == allowed || path.starts_with(&format!("{}/", allowed.trim_end_matches('/')))
}

fn normalize_repo_path(path: &str) -> Result<String, String> {
    let path = path.trim().replace('\\', "/");
    if path.is_empty() {
        return Err("path is empty".into());
    }

    let mut parts = Vec::new();
    for part in path.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                if parts.pop().is_none() {
                    return Err("path escapes the workspace".into());
                }
            }
            part => parts.push(part),
        }
    }

    if parts.is_empty() {
        Err("path is empty after normalization".into())
    } else {
        Ok(parts.join("/"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn contract() -> VerifierWorkContract {
        VerifierWorkContract {
            task_id: None,
            objective: "change engine verifier".into(),
            risk: RiskLevel::Low,
            acceptance_criteria: vec!["tests pass".into()],
            allowed_paths: vec!["crates/engine/src".into()],
            expected_base_commit: None,
        }
    }

    fn evidence() -> StructuredStepEvidence {
        StructuredStepEvidence {
            step_id: Some("step-1".into()),
            attempt_id: Some("attempt-1".into()),
            summary: "done".into(),
            exit_code: Some(0),
            files_changed: vec!["crates/engine/src/verifier.rs".into()],
            base_commit: None,
            head_commit: Some("abc123".into()),
            commands: vec![CommandEvidence {
                command: "cargo test -p cortex-engine verifier".into(),
                exit_code: Some(0),
                summary: None,
            }],
            checks: Vec::new(),
            signals: Vec::new(),
        }
    }

    #[test]
    fn allowed_path_violation_blocks_report() {
        let mut evidence = evidence();
        evidence.files_changed = vec!["crates/api/src/ws.rs".into()];

        let report = verify_contract_evidence(&contract(), &evidence);

        assert_eq!(report.verdict, VerifierVerdict::Blocked);
        assert_eq!(report.next_action, VerifierNextAction::NarrowScope);
        assert_eq!(report.allowed_path_violations.len(), 1);
        assert_eq!(
            report.allowed_path_violations[0].path,
            "crates/api/src/ws.rs"
        );
    }

    #[test]
    fn failed_command_causes_non_success_verdict() {
        let mut evidence = evidence();
        evidence.commands = vec![CommandEvidence {
            command: "cargo test -p cortex-engine".into(),
            exit_code: Some(101),
            summary: Some("test failure".into()),
        }];

        let report = verify_contract_evidence(&contract(), &evidence);

        assert_eq!(report.verdict, VerifierVerdict::Failed);
        assert!(!report.verdict.is_success());
        assert_eq!(report.next_action, VerifierNextAction::FixAndRetry);
        assert_eq!(report.command_summary.failed, 1);
    }
}
