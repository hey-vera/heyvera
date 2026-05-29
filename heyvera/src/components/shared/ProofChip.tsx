type ProofChipProps = {
  label: string;
};

export function ProofChip({ label }: ProofChipProps) {
  return (
    <span className="proof-chip">
      <span className="proof-chip-icon" aria-hidden="true" />
      {label}
    </span>
  );
}
