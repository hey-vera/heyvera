import { LinkedAgentChip } from "./LinkedAgentChip";
import { ProofChip } from "./ProofChip";

type PublicIdentityCardProps = {
  displayName: string;
  handle: string;
  roleLine: string;
  agentName: string;
  agentState: "Linked" | "Active" | "Local-first" | "Verified";
  proofLabel: string;
  statusLine: string;
  compact?: boolean;
  proofState?: string;
  continuityState?: string;
};

export function PublicIdentityCard({
  displayName,
  handle,
  roleLine,
  agentName,
  agentState,
  proofLabel,
  statusLine,
  compact,
  proofState,
  continuityState,
}: PublicIdentityCardProps) {
  const monogram = displayName.charAt(0).toUpperCase();

  return (
    <div className={`identity-card${compact ? " identity-card-compact" : ""}`}>
      <div className="identity-card-avatar" aria-hidden="true">
        {monogram}
      </div>
      <div className="identity-card-body">
        <div className="identity-card-header">
          <strong className="identity-card-name">{displayName}</strong>
          <span className="identity-card-handle">{handle}</span>
        </div>
        <p className="identity-card-role">{roleLine}</p>
        <div className="identity-card-chips">
          <LinkedAgentChip agentName={agentName} state={agentState} />
          <ProofChip label={proofLabel} />
        </div>
        {(proofState || continuityState) && (
          <div className="profile-detail-trust-chips">
            {proofState && (
              <span className="profile-detail-trust-chip">proof: {proofState}</span>
            )}
            {continuityState && (
              <span className="profile-detail-trust-chip">continuity: {continuityState}</span>
            )}
          </div>
        )}
        <p className="identity-card-status">{statusLine}</p>
      </div>
    </div>
  );
}
