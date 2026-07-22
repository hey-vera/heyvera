import { useState } from "react";
import { createCommunity } from "../../api/social";
import {
  PRIVATE_GUILD_CREATE_HINT,
  privateGuildShareHint,
} from "../../utils/guildVisibility";

type CreateCommunityFormProps = {
  getToken: () => Promise<string | null>;
  onCommunityCreated?: () => void;
};

/**
 * Small inline form for creating a community.
 * Toggles open/closed via a button.
 * Private option uses honest Discover/invite copy (Wave 9d).
 */
export function CreateCommunityForm({
  getToken,
  onCommunityCreated,
}: CreateCommunityFormProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** After private create: slug/id for manual share (no invite links). */
  const [shareNotice, setShareNotice] = useState<string | null>(null);

  if (!open) {
    return (
      <div className="create-community-wrap">
        {shareNotice && (
          <p
            className="create-community-share-notice"
            role="status"
            style={{
              marginBottom: 8,
              maxWidth: 360,
              fontSize: 12,
              lineHeight: 1.4,
              color: "var(--text-secondary)",
            }}
          >
            {shareNotice}
          </p>
        )}
        <button
          type="button"
          className="create-community-toggle"
          onClick={() => {
            setShareNotice(null);
            setOpen(true);
          }}
        >
          + Create Community
        </button>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !slug.trim() || submitting) return;

    setSubmitting(true);
    setError(null);
    setShareNotice(null);

    const submittedSlug = slug.trim().toLowerCase();
    const submittedVisibility = visibility;

    try {
      const token = await getToken();
      if (!token) {
        setError("Not authenticated");
        return;
      }

      const result = await createCommunity(token, {
        slug: submittedSlug,
        name: name.trim(),
        description: description.trim() || undefined,
        visibility: submittedVisibility,
      });

      setName("");
      setSlug("");
      setDescription("");
      setVisibility("public");
      setOpen(false);

      if (submittedVisibility === "private") {
        const created = result?.community;
        setShareNotice(
          privateGuildShareHint(
            created?.slug ?? submittedSlug,
            created?.id ?? null,
          ),
        );
      }

      onCommunityCreated?.();
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to create community",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="create-community-form" onSubmit={handleSubmit}>
      <input
        className="create-community-input"
        type="text"
        placeholder="Community name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={120}
        required
        disabled={submitting}
      />
      <input
        className="create-community-input"
        type="text"
        placeholder="slug (lowercase, no spaces)"
        value={slug}
        onChange={(e) => setSlug(e.target.value)}
        maxLength={63}
        pattern="[a-z0-9][a-z0-9-]{1,62}"
        required
        disabled={submitting}
      />
      <input
        className="create-community-input"
        type="text"
        placeholder="Description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        maxLength={1000}
        disabled={submitting}
      />

      <label className="create-community-visibility" style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: 13 }}>
        <span>Visibility</span>
        <select
          value={visibility}
          onChange={(e) => setVisibility(e.target.value === "private" ? "private" : "public")}
          disabled={submitting}
          className="create-community-input"
          aria-label="Community visibility"
        >
          <option value="public">Public</option>
          <option value="private">Private (unlisted from Discover)</option>
        </select>
      </label>

      {visibility === "private" && (
        <p
          className="create-community-private-hint"
          role="note"
          style={{
            margin: "0.25rem 0 0",
            fontSize: 12,
            lineHeight: 1.4,
            color: "var(--text-secondary)",
          }}
        >
          {PRIVATE_GUILD_CREATE_HINT}
        </p>
      )}

      <div className="create-community-actions">
        <button
          type="submit"
          className="button button-primary create-community-submit"
          disabled={!name.trim() || !slug.trim() || submitting}
        >
          {submitting ? "Creating..." : "Create"}
        </button>
        <button
          type="button"
          className="create-community-cancel"
          onClick={() => setOpen(false)}
          disabled={submitting}
        >
          Cancel
        </button>
      </div>

      {error && <p className="create-community-error">{error}</p>}
    </form>
  );
}
