import { useState } from "react";
import { linkAgent } from "../../api/social";
import type { LinkedAgent } from "../../api/social";

type LinkAgentFormProps = {
  getToken: () => Promise<string | null>;
  onLinked: (agent: LinkedAgent) => void;
  onCancel: () => void;
};

export function LinkAgentForm({ getToken, onLinked, onCancel }: LinkAgentFormProps) {
  const [agentName, setAgentName] = useState("");
  const [agentSlug, setAgentSlug] = useState("");
  const [agentKey, setAgentKey] = useState("");
  const [agentType, setAgentType] = useState("vera");
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLinking(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res = await linkAgent(token, {
        agentName: agentName.trim(),
        agentSlug: agentSlug.trim(),
        agentKey: agentKey.trim(),
        agentType,
      });
      onLinked(res.linkedAgent);
      setAgentName("");
      setAgentSlug("");
      setAgentKey("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Link failed");
    } finally {
      setLinking(false);
    }
  }

  return (
    <form className="identity-form" onSubmit={handleSubmit}>
      <div className="identity-form-field">
        <label className="identity-form-label" htmlFor="laf-name">
          Agent name
        </label>
        <input
          id="laf-name"
          className="identity-form-input"
          type="text"
          value={agentName}
          maxLength={80}
          required
          onChange={(e) => setAgentName(e.target.value)}
        />
      </div>

      <div className="identity-form-field">
        <label className="identity-form-label" htmlFor="laf-slug">
          Agent slug
        </label>
        <input
          id="laf-slug"
          className="identity-form-input"
          type="text"
          value={agentSlug}
          maxLength={60}
          required
          pattern="[a-z0-9-]+"
          title="Lowercase letters, numbers, and hyphens only"
          onChange={(e) => setAgentSlug(e.target.value)}
        />
      </div>

      <div className="identity-form-field">
        <label className="identity-form-label" htmlFor="laf-key">
          Agent key
        </label>
        <input
          id="laf-key"
          className="identity-form-input identity-form-mono"
          type="text"
          value={agentKey}
          maxLength={128}
          required
          onChange={(e) => setAgentKey(e.target.value)}
        />
      </div>

      <div className="identity-form-field">
        <label className="identity-form-label" htmlFor="laf-type">
          Agent type
        </label>
        <select
          id="laf-type"
          className="identity-form-input"
          value={agentType}
          onChange={(e) => setAgentType(e.target.value)}
        >
          <option value="vera">Vera</option>
          <option value="custom">Custom</option>
        </select>
      </div>

      {error && <p className="identity-form-error">{error}</p>}

      <div className="identity-form-actions">
        <button
          type="submit"
          className="button button-accent"
          disabled={linking}
        >
          {linking ? "Linking…" : "Link agent"}
        </button>
        <button
          type="button"
          className="button button-outline"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
