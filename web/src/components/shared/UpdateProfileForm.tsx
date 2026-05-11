import { useState } from "react";
import { updateProfile } from "../../api/social";
import type { Profile } from "../../api/social";

type UpdateProfileFormProps = {
  profile: Profile;
  getToken: () => Promise<string | null>;
  onSaved: (updated: Profile) => void;
};

export function UpdateProfileForm({
  profile,
  getToken,
  onSaved,
}: UpdateProfileFormProps) {
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [bio, setBio] = useState(profile.bio);
  const [location, setLocation] = useState(profile.location ?? "");
  const [websiteUrl, setWebsiteUrl] = useState(profile.websiteUrl ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res = await updateProfile(token, {
        displayName: displayName.trim() || undefined,
        bio: bio.trim() || undefined,
        location: location.trim() || undefined,
        websiteUrl: websiteUrl.trim() || undefined,
      });
      onSaved(res.profile);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="identity-form" onSubmit={handleSubmit}>
      <div className="identity-form-field">
        <label className="identity-form-label" htmlFor="upf-display-name">
          Display name
        </label>
        <input
          id="upf-display-name"
          className="identity-form-input"
          type="text"
          value={displayName}
          maxLength={80}
          onChange={(e) => setDisplayName(e.target.value)}
        />
      </div>

      <div className="identity-form-field">
        <label className="identity-form-label" htmlFor="upf-bio">
          Bio
        </label>
        <textarea
          id="upf-bio"
          className="identity-form-input identity-form-textarea"
          value={bio}
          maxLength={300}
          rows={3}
          onChange={(e) => setBio(e.target.value)}
        />
      </div>

      <div className="identity-form-field">
        <label className="identity-form-label" htmlFor="upf-location">
          Location
        </label>
        <input
          id="upf-location"
          className="identity-form-input"
          type="text"
          value={location}
          maxLength={100}
          onChange={(e) => setLocation(e.target.value)}
        />
      </div>

      <div className="identity-form-field">
        <label className="identity-form-label" htmlFor="upf-website">
          Website
        </label>
        <input
          id="upf-website"
          className="identity-form-input"
          type="url"
          value={websiteUrl}
          maxLength={200}
          onChange={(e) => setWebsiteUrl(e.target.value)}
        />
      </div>

      {error && <p className="identity-form-error">{error}</p>}
      {saved && <p className="identity-form-success">Profile updated.</p>}

      <button
        type="submit"
        className="button button-accent"
        disabled={saving}
      >
        {saving ? "Saving…" : "Save profile"}
      </button>
    </form>
  );
}
