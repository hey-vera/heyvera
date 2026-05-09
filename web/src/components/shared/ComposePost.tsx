import { useState } from "react";
import { createPost } from "../../api/social";
import type { FeedPost, LinkedAgent } from "../../api/social";

type AuthorMode = "person" | "agent" | "linked_pair";

type ComposePostProps = {
  getToken: () => Promise<string | null>;
  linkedAgents: LinkedAgent[];
  onPostCreated?: (post: FeedPost) => void;
};

/**
 * Inline compose box for creating new posts.
 * Only rendered when the user is signed in and has a profile.
 */
export function ComposePost({
  getToken,
  linkedAgents,
  onPostCreated,
}: ComposePostProps) {
  const [body, setBody] = useState("");
  const [authorMode, setAuthorMode] = useState<AuthorMode>("person");
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasAgents = linkedAgents.length > 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim() || submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      const token = await getToken();
      if (!token) {
        setError("Not authenticated");
        return;
      }

      const linkedAgentId =
        (authorMode === "agent" || authorMode === "linked_pair") && selectedAgentId
          ? selectedAgentId
          : undefined;

      const result = await createPost(token, {
        body: body.trim(),
        authorMode,
        linkedAgentId,
      });

      setBody("");
      setAuthorMode("person");
      setSelectedAgentId(null);
      onPostCreated?.(result.post);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create post");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="compose-post" onSubmit={handleSubmit}>
      <textarea
        className="compose-post-input"
        placeholder="What's happening on Vera?"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        maxLength={5000}
        disabled={submitting}
      />

      <div className="compose-post-controls">
        <div className="compose-post-mode">
          <select
            className="compose-post-select"
            value={authorMode}
            onChange={(e) => {
              const mode = e.target.value as AuthorMode;
              setAuthorMode(mode);
              if (mode === "person") setSelectedAgentId(null);
              else if (hasAgents && !selectedAgentId) {
                setSelectedAgentId(linkedAgents[0].id);
              }
            }}
            disabled={submitting}
          >
            <option value="person">As Person</option>
            {hasAgents && <option value="agent">As Agent</option>}
            {hasAgents && <option value="linked_pair">As Linked Pair</option>}
          </select>

          {(authorMode === "agent" || authorMode === "linked_pair") && hasAgents && (
            <select
              className="compose-post-select"
              value={selectedAgentId ?? ""}
              onChange={(e) => setSelectedAgentId(e.target.value || null)}
              disabled={submitting}
            >
              {linkedAgents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.agentName}
                </option>
              ))}
            </select>
          )}
        </div>

        <button
          type="submit"
          className="button button-primary compose-post-submit"
          disabled={!body.trim() || submitting}
        >
          {submitting ? "Posting..." : "Post"}
        </button>
      </div>

      {error && <p className="compose-post-error">{error}</p>}
    </form>
  );
}
