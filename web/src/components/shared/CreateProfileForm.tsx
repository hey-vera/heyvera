import { useState } from "react";
import { createProfile } from "../../api/social";

type CreateProfileFormProps = {
  getToken: () => Promise<string | null>;
  onProfileCreated?: () => void;
};

/**
 * Inline form for creating a new profile.
 * Shown when the user is signed in but has no profile.
 */
export function CreateProfileForm({
  getToken,
  onProfileCreated,
}: CreateProfileFormProps) {
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!handle.trim() || !displayName.trim() || submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      const token = await getToken();
      if (!token) {
        setError("Not authenticated");
        return;
      }

      await createProfile(token, {
        handle: handle.trim().toLowerCase(),
        displayName: displayName.trim(),
        bio: bio.trim() || undefined,
      });

      onProfileCreated?.();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create profile");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="create-profile-form" onSubmit={handleSubmit}>
      <div className="create-profile-heading">
        <strong>Create your profile</strong>
        <p className="create-profile-desc">
          Stake your identity on the Vera network.
        </p>
      </div>

      <div className="create-profile-fields">
        <label className="create-profile-label">
          <span>Handle</span>
          <input
            className="create-profile-input"
            type="text"
            placeholder="yourhandle"
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            maxLength={32}
            pattern="[a-z0-9][a-z0-9_-]{1,31}"
            title="2-32 lowercase letters, numbers, _ or -"
            required
            disabled={submitting}
          />
        </label>

        <label className="create-profile-label">
          <span>Display name</span>
          <input
            className="create-profile-input"
            type="text"
            placeholder="Your Name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={80}
            required
            disabled={submitting}
          />
        </label>

        <label className="create-profile-label">
          <span>Bio</span>
          <textarea
            className="create-profile-input create-profile-textarea"
            placeholder="A short bio (optional)"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            maxLength={280}
            rows={2}
            disabled={submitting}
          />
        </label>
      </div>

      <button
        type="submit"
        className="button button-primary create-profile-submit"
        disabled={!handle.trim() || !displayName.trim() || submitting}
      >
        {submitting ? "Creating..." : "Create Profile"}
      </button>

      {error && <p className="create-profile-error">{error}</p>}
    </form>
  );
}
