type LinkedAgentChipProps = {
  agentName: string;
  state: "Linked" | "Active" | "Local-first" | "Verified";
};

export function LinkedAgentChip({ agentName, state }: LinkedAgentChipProps) {
  return (
    <span className="linked-agent-chip">
      <span className="linked-agent-chip-dot" aria-hidden="true" />
      <span className="linked-agent-chip-name">{agentName}</span>
      <span className="linked-agent-chip-state">{state}</span>
    </span>
  );
}
