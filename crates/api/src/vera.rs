use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use soma_core::compaction::{self, CompactedVera, SignalProfile};
use soma_core::delegation::Capability;
use soma_core::envelope::SessionOutcome;
use soma_core::trust::{self, Interaction};
use soma_core::types::HeartId;
use soma_core::vera;

use cortex_core::routing::Intent;

pub fn heart_id_from_user(user_id: &str) -> HeartId {
    use sha2::{Sha256, Digest};
    let mut hasher = Sha256::new();
    hasher.update(b"soma-heart-v1:");
    hasher.update(user_id.as_bytes());
    let result = hasher.finalize();
    let mut id = [0u8; 32];
    id.copy_from_slice(&result);
    HeartId(id)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub struct VeraTracker {
    interactions: Mutex<Vec<Interaction>>,
    compacted: Mutex<Vec<CompactedVera>>,
    cortex_heart_id: HeartId,
}

#[derive(serde::Serialize)]
pub struct VeraSnapshot {
    pub total_interactions: usize,
    pub total_warmth: f64,
    pub active_hearts: u64,
    pub enrichment_ratio: f64,
    pub domains: Vec<DomainSnapshot>,
    pub compaction: CompactionSnapshot,
}

#[derive(serde::Serialize)]
pub struct DomainSnapshot {
    pub capability: String,
    pub warmth: f64,
    pub ignited: bool,
    pub interaction_count: usize,
}

#[derive(serde::Serialize)]
pub struct CompactionSnapshot {
    pub levels_computed: usize,
    pub latest: Option<CompactedVeraView>,
    pub history: Vec<CompactedVeraView>,
}

#[derive(Clone, serde::Serialize)]
pub struct CompactedVeraView {
    pub level: u32,
    pub vera: f64,
    pub coherence: f64,
    pub source_count: usize,
    pub consensus: f64,
    pub diversity: f64,
    pub stability: f64,
}

impl From<&CompactedVera> for CompactedVeraView {
    fn from(cv: &CompactedVera) -> Self {
        Self {
            level: cv.level,
            vera: cv.vera,
            coherence: cv.coherence,
            source_count: cv.source_count,
            consensus: cv.signal.consensus,
            diversity: cv.signal.diversity,
            stability: cv.signal.stability,
        }
    }
}

const COMPACTION_THRESHOLD: usize = 10;

impl VeraTracker {
    pub fn new(cortex_heart_id: HeartId) -> Self {
        Self {
            interactions: Mutex::new(Vec::new()),
            compacted: Mutex::new(Vec::new()),
            cortex_heart_id,
        }
    }

    pub fn record_interaction(
        &self,
        user_heart_id: HeartId,
        capability: Capability,
        soma_amount: u64,
        outcome: SessionOutcome,
        duration_ms: u64,
    ) {
        let interaction = Interaction {
            from: user_heart_id,
            to: self.cortex_heart_id,
            capability,
            soma_amount,
            outcome,
            timestamp: now_ms(),
            duration_ms,
            participant_count: 2,
            bilateral: true,
        };

        let should_compact = {
            let mut interactions = self.interactions.lock().unwrap();
            interactions.push(interaction);
            interactions.len() >= COMPACTION_THRESHOLD
        };

        if should_compact {
            self.run_compaction();
        }
    }

    fn run_compaction(&self) {
        let interactions: Vec<Interaction> = {
            let mut lock = self.interactions.lock().unwrap();
            std::mem::take(&mut *lock)
        };

        if interactions.is_empty() {
            return;
        }

        let now = now_ms();
        let distilled = compaction::distill(&interactions, now);

        tracing::info!(
            "vera compaction: {} interactions → level {} | vera={:.2} C={:.4} consensus={:.2} diversity={:.2} stability={:.2}",
            interactions.len(),
            distilled.level,
            distilled.vera,
            distilled.coherence,
            distilled.signal.consensus,
            distilled.signal.diversity,
            distilled.signal.stability,
        );

        let mut compacted = self.compacted.lock().unwrap();
        compacted.push(distilled);

        // If we have enough level-1 compactions, distill them into level 2
        let level1_count = compacted.iter().filter(|c| c.level == 1).count();
        if level1_count >= COMPACTION_THRESHOLD {
            let level1s: Vec<CompactedVera> = compacted
                .iter()
                .filter(|c| c.level == 1)
                .cloned()
                .collect();

            let level2 = compaction::distill_compacted(&level1s);

            tracing::info!(
                "vera compaction level 2: {} level-1s → vera={:.2} C={:.4} consensus={:.2}",
                level1s.len(),
                level2.vera,
                level2.coherence,
                level2.signal.consensus,
            );

            compacted.retain(|c| c.level != 1);
            compacted.push(level2);
        }
    }

    pub fn capability_for_intent(intent: Option<Intent>) -> Capability {
        match intent {
            Some(Intent::Explore) | Some(Intent::Review) => Capability::FileAccess,
            Some(Intent::Think) => Capability::Custom("Intelligence".into()),
            Some(Intent::Fix) | Some(Intent::Add) | Some(Intent::Refactor) | Some(Intent::Ship) => {
                Capability::CodeExecution
            }
            Some(Intent::Test) => Capability::Custom("Verification".into()),
            None => Capability::Custom("Conversation".into()),
        }
    }

    pub fn record_routed(&self, user_id: &str, intent: Intent) {
        self.record_interaction(
            heart_id_from_user(user_id),
            Self::capability_for_intent(Some(intent)),
            1,
            SessionOutcome::Success,
            0,
        );
    }

    pub fn record_step_completed(
        &self,
        user_id: &str,
        duration_ms: u64,
        exit_code: i32,
        intent: Option<Intent>,
    ) {
        let outcome = if exit_code == 0 {
            SessionOutcome::Success
        } else {
            SessionOutcome::Failure {
                error_class: format!("exit_{exit_code}"),
            }
        };
        self.record_interaction(
            heart_id_from_user(user_id),
            Self::capability_for_intent(intent),
            1,
            outcome,
            duration_ms,
        );
    }

    pub fn record_step_failed(&self, user_id: &str, failure_kind: &str, intent: Option<Intent>) {
        self.record_interaction(
            heart_id_from_user(user_id),
            Self::capability_for_intent(intent),
            1,
            SessionOutcome::Failure {
                error_class: failure_kind.to_string(),
            },
            0,
        );
    }

    pub fn record_conversation(&self, user_id: &str) {
        self.record_interaction(
            heart_id_from_user(user_id),
            Capability::Custom("Conversation".into()),
            1,
            SessionOutcome::Success,
            0,
        );
    }

    pub fn snapshot(&self) -> VeraSnapshot {
        let now = now_ms();

        let interactions = self.interactions.lock().unwrap();
        let compacted = self.compacted.lock().unwrap();

        let mut heart_ids = std::collections::HashSet::new();
        for i in interactions.iter() {
            heart_ids.insert(i.from);
            heart_ids.insert(i.to);
        }
        let active_hearts = heart_ids.len() as u64;

        let network = vera::compute_network(&interactions, active_hearts, now);

        let mut seen_capabilities: Vec<Capability> = Vec::new();
        for i in interactions.iter() {
            if !seen_capabilities.contains(&i.capability) {
                seen_capabilities.push(i.capability.clone());
            }
        }
        if seen_capabilities.is_empty() {
            seen_capabilities.push(Capability::CodeExecution);
        }

        let domains: Vec<DomainSnapshot> = seen_capabilities
            .iter()
            .map(|cap| {
                let warmth = trust::compute_warmth(&interactions, cap, now);
                let count = interactions.iter().filter(|i| i.capability == *cap).count();
                DomainSnapshot {
                    capability: match cap {
                        Capability::Custom(name) => name.clone(),
                        other => format!("{:?}", other),
                    },
                    warmth,
                    ignited: trust::is_ignited(&interactions, cap, now),
                    interaction_count: count,
                }
            })
            .collect();

        let history: Vec<CompactedVeraView> = compacted.iter().map(|cv| cv.into()).collect();
        let latest = history.last().cloned();

        VeraSnapshot {
            total_interactions: interactions.len(),
            total_warmth: network.total_warmth,
            active_hearts: network.active_hearts,
            enrichment_ratio: network.enrichment_ratio,
            domains,
            compaction: CompactionSnapshot {
                levels_computed: compacted.len(),
                latest,
                history,
            },
        }
    }

    /// Simulate diverse network traffic for testing the IB under realistic conditions.
    /// Interleaves agents like real traffic — different species observing at overlapping times.
    pub fn simulate_ecosystem(&self, agent_count: usize, interactions_per_agent: usize) {
        let capabilities = [
            Capability::CodeExecution,
            Capability::FileAccess,
            Capability::NetworkAccess,
            Capability::Custom("Intelligence".into()),
            Capability::Custom("Verification".into()),
            Capability::Custom("Conversation".into()),
        ];

        let mut success_count = 0u64;
        let mut fail_count = 0u64;

        // Interleave: round-robin across agents, not sequential bursts.
        // Real traffic arrives mixed — the hawk and the bug observe simultaneously.
        for round in 0..interactions_per_agent {
            for agent_idx in 0..agent_count {
                let user_id = format!("agent-{agent_idx:04}");
                let heart = heart_id_from_user(&user_id);
                let cap = &capabilities[agent_idx % capabilities.len()];

                let outcome = if round % 7 == 0 {
                    fail_count += 1;
                    SessionOutcome::Failure {
                        error_class: "simulated".into(),
                    }
                } else {
                    success_count += 1;
                    SessionOutcome::Success
                };

                self.record_interaction(
                    heart,
                    cap.clone(),
                    1,
                    outcome,
                    (round as u64 + 1) * 100,
                );
            }
        }

        tracing::info!(
            "ecosystem simulation: {} agents × {} interactions = {} total ({} success, {} fail)",
            agent_count,
            interactions_per_agent,
            agent_count * interactions_per_agent,
            success_count,
            fail_count,
        );
    }

    pub fn heart_trust(&self, heart_id: &HeartId, capability: &Capability) -> f64 {
        let now = now_ms();
        let interactions = self.interactions.lock().unwrap();
        let relevant: Vec<Interaction> = interactions
            .iter()
            .filter(|i| (i.from == *heart_id || i.to == *heart_id) && i.capability == *capability)
            .cloned()
            .collect();
        trust::compute_trust(&relevant, capability, now)
    }

    /// Personal vera view — what the user sees about their contribution
    /// and what's flowing back from the network.
    pub fn personal_view(&self, user_id: &str) -> PersonalVeraView {
        let heart = heart_id_from_user(user_id);
        let now = now_ms();
        let interactions = self.interactions.lock().unwrap();
        let compacted = self.compacted.lock().unwrap();

        let my_interactions: Vec<&Interaction> = interactions
            .iter()
            .filter(|i| i.from == heart || i.to == heart)
            .collect();

        let my_count = my_interactions.len();
        let total_count = interactions.len();

        // What I contributed — my co-creation across capabilities
        let mut my_capabilities: Vec<PersonalCapability> = Vec::new();
        let mut seen_caps: Vec<Capability> = Vec::new();
        for i in my_interactions.iter() {
            if !seen_caps.contains(&i.capability) {
                seen_caps.push(i.capability.clone());
            }
        }
        for cap in &seen_caps {
            let cap_interactions: Vec<Interaction> = my_interactions
                .iter()
                .filter(|i| i.capability == *cap)
                .cloned()
                .cloned()
                .collect();
            let warmth = trust::compute_warmth(&cap_interactions, cap, now);
            let count = cap_interactions.len();
            my_capabilities.push(PersonalCapability {
                name: match cap {
                    Capability::Custom(name) => name.clone(),
                    other => format!("{:?}", other),
                },
                interactions: count,
                warmth,
            });
        }

        // Network totals — what everyone is building together
        let mut all_hearts = std::collections::HashSet::new();
        for i in interactions.iter() {
            all_hearts.insert(i.from);
            all_hearts.insert(i.to);
        }
        let network_hearts = all_hearts.len() as u64;
        let network = vera::compute_network(&interactions, network_hearts, now);

        // What's flowing back — the compacted intelligence I benefit from
        let latest_compaction: Option<CompactedVeraView> = compacted.last().map(|cv| cv.into());
        let network_coherence = latest_compaction
            .as_ref()
            .map(|c| c.coherence)
            .unwrap_or(0.0);

        PersonalVeraView {
            your_heart: hex::encode(heart.0),
            your_interactions: my_count,
            your_capabilities: my_capabilities,
            network_interactions: total_count,
            network_hearts,
            network_warmth: network.total_warmth,
            network_coherence,
            enrichment_ratio: network.enrichment_ratio,
            flowing_back: FlowingBack {
                intelligence_level: if network_coherence > 0.5 {
                    "diamond".into()
                } else if network_coherence > 0.1 {
                    "growing".into()
                } else {
                    "seeding".into()
                },
                your_contribution_pct: if total_count > 0 {
                    (my_count as f64 / total_count as f64) * 100.0
                } else {
                    0.0
                },
                proof: format!(
                    "V = S × C² | C = {:.4} | {} interactions compacted | formula is public, data is bilateral, computation is deterministic",
                    network_coherence,
                    total_count,
                ),
            },
        }
    }
}

#[derive(serde::Serialize)]
pub struct PersonalVeraView {
    pub your_heart: String,
    pub your_interactions: usize,
    pub your_capabilities: Vec<PersonalCapability>,
    pub network_interactions: usize,
    pub network_hearts: u64,
    pub network_warmth: f64,
    pub network_coherence: f64,
    pub enrichment_ratio: f64,
    pub flowing_back: FlowingBack,
}

#[derive(serde::Serialize)]
pub struct PersonalCapability {
    pub name: String,
    pub interactions: usize,
    pub warmth: f64,
}

#[derive(serde::Serialize)]
pub struct FlowingBack {
    pub intelligence_level: String,
    pub your_contribution_pct: f64,
    pub proof: String,
}
