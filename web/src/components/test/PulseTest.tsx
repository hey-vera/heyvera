import { useState } from "react";
import { useAuthContext } from "../../hooks/useAuthContext";
import { createDraft, listDrafts, type PulseDraft } from "../../api/pulse";

export function PulseTest() {
  const { getToken } = useAuthContext();
  const [drafts, setDrafts] = useState<PulseDraft[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const testCreateDraft = async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("No auth token");

      await createDraft(token, {
        body: "Test draft from frontend",
        visibility: "public",
        authorMode: "person",
      });

      // Reload drafts
      const result = await listDrafts(token);
      setDrafts(result.drafts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const loadDrafts = async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("No auth token");

      const result = await listDrafts(token);
      setDrafts(result.drafts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: "1rem", border: "1px solid #ccc", margin: "1rem" }}>
      <h3>Pulse API Test</h3>

      <div style={{ marginBottom: "1rem" }}>
        <button onClick={testCreateDraft} disabled={loading}>
          Create Test Draft
        </button>
        <button onClick={loadDrafts} disabled={loading} style={{ marginLeft: "0.5rem" }}>
          Load Drafts
        </button>
      </div>

      {loading && <p>Loading...</p>}
      {error && <p style={{ color: "red" }}>Error: {error}</p>}

      <div>
        <h4>Drafts ({drafts.length})</h4>
        {drafts.map((draft) => (
          <div key={draft.id} style={{
            padding: "0.5rem",
            border: "1px solid #eee",
            marginBottom: "0.5rem"
          }}>
            <p><strong>Status:</strong> {draft.status}</p>
            <p><strong>Body:</strong> {draft.body}</p>
            <p><strong>Created:</strong> {new Date(draft.createdAt).toLocaleString()}</p>
          </div>
        ))}
      </div>
    </div>
  );
}