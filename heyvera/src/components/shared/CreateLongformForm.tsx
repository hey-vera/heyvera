import { useState } from "react";
import { createLongform } from "../../api/social";

type CreateLongformFormProps = {
  getToken: () => Promise<string | null>;
  onLongformCreated?: () => void;
};

/**
 * Simple longform entry creation form.
 * Toggles open/closed via a "Write" button.
 */
export function CreateLongformForm({
  getToken,
  onLongformCreated,
}: CreateLongformFormProps) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [body, setBody] = useState("");
  const [formatType, setFormatType] = useState("essay");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button
        type="button"
        className="create-longform-toggle"
        onClick={() => setOpen(true)}
      >
        Write
      </button>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !body.trim() || submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      const token = await getToken();
      if (!token) {
        setError("Not authenticated");
        return;
      }

      await createLongform(token, {
        title: title.trim(),
        summary: summary.trim() || undefined,
        body: body.trim(),
        formatType,
      });

      setTitle("");
      setSummary("");
      setBody("");
      setFormatType("essay");
      setOpen(false);
      onLongformCreated?.();
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to create longform entry",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="create-longform-form" onSubmit={handleSubmit}>
      <input
        className="create-longform-input"
        type="text"
        placeholder="Title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={200}
        required
        disabled={submitting}
      />
      <input
        className="create-longform-input"
        type="text"
        placeholder="Summary (optional)"
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
        maxLength={500}
        disabled={submitting}
      />
      <textarea
        className="create-longform-input create-longform-body"
        placeholder="Write your essay, broadcast, or journal entry..."
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={8}
        maxLength={50000}
        required
        disabled={submitting}
      />

      <div className="create-longform-row">
        <select
          className="create-longform-select"
          value={formatType}
          onChange={(e) => setFormatType(e.target.value)}
          disabled={submitting}
        >
          <option value="essay">Essay</option>
          <option value="broadcast">Broadcast</option>
          <option value="research_log">Research Log</option>
          <option value="journal">Journal</option>
          <option value="thread">Thread</option>
          <option value="note">Note</option>
        </select>

        <div className="create-longform-actions">
          <button
            type="submit"
            className="button button-primary create-longform-submit"
            disabled={!title.trim() || !body.trim() || submitting}
          >
            {submitting ? "Publishing..." : "Publish"}
          </button>
          <button
            type="button"
            className="create-longform-cancel"
            onClick={() => setOpen(false)}
            disabled={submitting}
          >
            Cancel
          </button>
        </div>
      </div>

      {error && <p className="create-longform-error">{error}</p>}
    </form>
  );
}
