import { useCallback, useEffect, useRef, useState } from 'react';
import { ImagePlus, RefreshCw, Sparkles, X } from 'lucide-react';
import { listDrafts, approveDraft, rejectDraft, publishDraft } from '../../api/pulse';
import type { PulseDraft } from '../../api/pulse';
import { ALLOWED_IMAGE_ACCEPT } from '../../utils/imageUpload';

type ComposeTab = 'post' | 'agent-assist';

const TAB_LABELS: Record<ComposeTab, string> = {
  'post': 'Post',
  'agent-assist': 'Agent Assist',
};

const TAB_ORDER: ComposeTab[] = ['post', 'agent-assist'];

interface TabbedComposeProps {
  /** Current text content for the normal post compose */
  content: string;
  /** Update the compose text */
  onContentChange: (value: string) => void;
  /** Submit a normal post */
  onSubmitPost: () => void;
  /** Whether a post is currently being submitted (includes media upload) */
  posting: boolean;
  /** Notice/error string shown below compose */
  composeNotice: string | null;
  /** Auth token getter for Pulse API calls */
  getToken: () => Promise<string | null>;
  /** Whether the user is signed in */
  isSignedIn: boolean;
  /** Whether auth is enabled */
  authEnabled: boolean;
  /** Sign in button element (rendered externally to avoid coupling to Clerk) */
  signInButton?: React.ReactNode;
  /** Profile link element for "create profile" notice */
  profileLink?: React.ReactNode;
  /** Object URL for the selected image preview (parent owns File + upload) */
  imagePreviewUrl?: string | null;
  /** Parent validates + stores the picked file; called with a single File */
  onImagePick?: (file: File) => void;
  /** Clear selected image (revoke preview URL in parent) */
  onImageClear?: () => void;
}

export function TabbedCompose({
  content,
  onContentChange,
  onSubmitPost,
  posting,
  composeNotice,
  getToken,
  isSignedIn,
  authEnabled,
  signInButton,
  profileLink,
  imagePreviewUrl = null,
  onImagePick,
  onImageClear,
}: TabbedComposeProps) {
  const [activeTab, setActiveTab] = useState<ComposeTab>('post');

  return (
    <div className="border-b" style={{ borderColor: 'var(--border-primary)' }}>
      {/* Tab bar */}
      <div className="flex border-b" style={{ borderColor: 'var(--border-primary)' }}>
        {TAB_ORDER.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className="flex-1 py-3 text-[14px] font-medium transition-colors hover-overlay"
            style={{ color: activeTab === tab ? 'var(--text-primary)' : 'var(--text-secondary)' }}
          >
            <span className="relative inline-block">
              {TAB_LABELS[tab]}
              {activeTab === tab && (
                <span
                  className="absolute -bottom-[13px] left-0 right-0 h-[3px] rounded-full"
                  style={{ backgroundColor: 'var(--accent)' }}
                />
              )}
            </span>
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="px-4 py-3">
        {activeTab === 'post' && (
          <PostTab
            content={content}
            onContentChange={onContentChange}
            onSubmitPost={onSubmitPost}
            posting={posting}
            composeNotice={composeNotice}
            signInButton={signInButton}
            profileLink={profileLink}
            imagePreviewUrl={imagePreviewUrl}
            onImagePick={onImagePick}
            onImageClear={onImageClear}
          />
        )}
        {activeTab === 'agent-assist' && (
          <AgentAssistTab
            getToken={getToken}
            isSignedIn={isSignedIn}
            authEnabled={authEnabled}
          />
        )}
      </div>
    </div>
  );
}

/* ─── Tab 1: Post (existing compose behavior + one image attach) ────────────── */

function PostTab({
  content,
  onContentChange,
  onSubmitPost,
  posting,
  composeNotice,
  signInButton,
  profileLink,
  imagePreviewUrl,
  onImagePick,
  onImageClear,
}: {
  content: string;
  onContentChange: (value: string) => void;
  onSubmitPost: () => void;
  posting: boolean;
  composeNotice: string | null;
  signInButton?: React.ReactNode;
  profileLink?: React.ReactNode;
  imagePreviewUrl: string | null;
  onImagePick?: (file: File) => void;
  onImageClear?: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const hasImage = Boolean(imagePreviewUrl);
  const canPost = (content.trim().length > 0 || hasImage) && !posting;
  const imageAttachEnabled = typeof onImagePick === 'function';

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    // Allow re-picking the same file after clear.
    event.target.value = '';
    if (!file || !onImagePick) return;
    onImagePick(file);
  };

  return (
    <div className="flex gap-3">
      <div
        className="h-10 w-10 flex-shrink-0 rounded-full"
        style={{ backgroundColor: 'var(--border-primary)' }}
      />
      <div className="flex-1">
        <textarea
          value={content}
          onChange={(event) => onContentChange(event.target.value.slice(0, 280))}
          placeholder="Share something with the network"
          rows={2}
          disabled={posting}
          className="w-full resize-none bg-transparent text-[20px] leading-normal outline-none disabled:opacity-70"
          style={{ color: 'var(--text-primary)' }}
        />

        {imagePreviewUrl && (
          <div
            className="relative mt-3 overflow-hidden rounded-2xl border"
            style={{ borderColor: 'var(--border-primary)' }}
          >
            <img
              src={imagePreviewUrl}
              alt="Selected attachment"
              className="max-h-[240px] w-full object-cover"
            />
            {onImageClear && (
              <button
                type="button"
                onClick={onImageClear}
                disabled={posting}
                className="absolute right-2 top-2 rounded-full p-1.5 disabled:opacity-50"
                style={{
                  backgroundColor: 'color-mix(in srgb, var(--bg-primary) 80%, transparent)',
                  color: 'var(--text-primary)',
                }}
                aria-label="Remove image"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        )}

        <div
          className="mt-2 flex items-center justify-between border-t pt-2"
          style={{ borderColor: 'var(--border-primary)' }}
        >
          <div className="flex items-center gap-2">
            {imageAttachEnabled && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ALLOWED_IMAGE_ACCEPT}
                  className="hidden"
                  onChange={handleFileChange}
                  disabled={posting}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={posting}
                  className="flex items-center gap-1.5 rounded-full px-2 py-1 text-[13px] font-medium transition-colors hover-overlay disabled:opacity-50"
                  style={{ color: 'var(--accent)' }}
                  aria-label="Add image"
                >
                  <ImagePlus className="h-4 w-4" aria-hidden="true" />
                  Image
                </button>
              </>
            )}
            <span
              className="text-[13px]"
              style={{ color: content.length > 260 ? 'var(--color-danger)' : 'var(--text-secondary)' }}
            >
              {content.length}/280
            </span>
          </div>

          <button
            type="button"
            onClick={onSubmitPost}
            disabled={!canPost}
            className="rounded-full px-4 py-1.5 text-[15px] font-bold transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            style={{ backgroundColor: 'var(--accent)', color: 'var(--bg-primary)' }}
          >
            {posting ? 'Posting' : 'Post'}
          </button>
        </div>

        {composeNotice && (
          <div
            className="mt-3 flex flex-wrap items-center gap-3 text-[13px]"
            role="alert"
            style={{ color: 'var(--color-danger)' }}
          >
            <span>{composeNotice}</span>
            {composeNotice === 'Sign in to post.' && signInButton}
            {composeNotice === 'Create your profile before posting.' && profileLink}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Tab 2: Agent Assist (Pulse draft/approve workflow) ───────────────────── */

function AgentAssistTab({
  getToken,
  isSignedIn,
  authEnabled,
}: {
  getToken: () => Promise<string | null>;
  isSignedIn: boolean;
  authEnabled: boolean;
}) {
  const [drafts, setDrafts] = useState<PulseDraft[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const loadDrafts = useCallback(async () => {
    if (!isSignedIn || !authEnabled) return;

    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) return;
      const result = await listDrafts(token, 'pending');
      setDrafts(result.drafts);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load drafts');
    } finally {
      setLoading(false);
    }
  }, [getToken, isSignedIn, authEnabled]);

  useEffect(() => {
    void loadDrafts();
  }, [loadDrafts]);

  const handleApprove = async (draftId: string) => {
    setActionLoading(draftId);
    try {
      const token = await getToken();
      if (!token) return;
      await approveDraft(token, draftId);
      await publishDraft(token, draftId);
      setDrafts((current) => current.filter((d) => d.id !== draftId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve draft');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDismiss = async (draftId: string) => {
    setActionLoading(draftId);
    try {
      const token = await getToken();
      if (!token) return;
      await rejectDraft(token, draftId, 'Dismissed by user');
      setDrafts((current) => current.filter((d) => d.id !== draftId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to dismiss draft');
    } finally {
      setActionLoading(null);
    }
  };

  if (!authEnabled || !isSignedIn) {
    return (
      <div className="flex flex-col items-center py-6 text-center">
        <Sparkles className="mb-3 h-8 w-8" style={{ color: 'var(--text-secondary)' }} />
        <p className="text-[15px]" style={{ color: 'var(--text-secondary)' }}>
          Sign in to see AI-generated drafts
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6" role="status">
        <div
          className="h-6 w-6 animate-spin rounded-full border-2 border-transparent"
          style={{ borderTopColor: 'var(--accent)', borderRightColor: 'var(--border-primary)' }}
        />
        <span className="ml-3 text-[13px]" style={{ color: 'var(--text-secondary)' }}>
          Loading drafts
        </span>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4" style={{ color: 'var(--accent)' }} />
          <span className="text-[14px] font-medium" style={{ color: 'var(--text-primary)' }}>
            AI Drafts
          </span>
        </div>
        <button
          type="button"
          onClick={() => void loadDrafts()}
          className="rounded-full p-1.5 transition-colors hover-overlay"
          style={{ color: 'var(--text-secondary)' }}
          aria-label="Refresh drafts"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {error && (
        <p className="mb-3 text-[13px]" style={{ color: 'var(--color-danger, #F4212E)' }}>
          {error}
        </p>
      )}

      {drafts.length === 0 ? (
        <div className="flex flex-col items-center py-6 text-center">
          <p className="text-[15px] font-medium" style={{ color: 'var(--text-primary)' }}>
            No AI drafts yet
          </p>
          <p className="mt-1 text-[13px]" style={{ color: 'var(--text-secondary)' }}>
            When your AI agent creates draft posts, they will appear here for your review.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {drafts.map((draft) => (
            <div
              key={draft.id}
              className="rounded-xl border p-3"
              style={{
                borderColor: 'var(--border-primary)',
                backgroundColor: 'var(--bg-elevated)',
              }}
            >
              <p
                className="mb-3 text-[15px] leading-relaxed"
                style={{ color: 'var(--text-primary)' }}
              >
                {draft.body}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleApprove(draft.id)}
                  disabled={actionLoading === draft.id}
                  className="rounded-full px-3 py-1 text-[13px] font-bold transition-opacity hover:opacity-90 disabled:opacity-50"
                  style={{ backgroundColor: 'var(--accent)', color: 'var(--bg-primary)' }}
                >
                  {actionLoading === draft.id ? 'Publishing...' : 'Approve & Post'}
                </button>
                <button
                  type="button"
                  onClick={() => void handleDismiss(draft.id)}
                  disabled={actionLoading === draft.id}
                  className="rounded-full border px-3 py-1 text-[13px] font-bold transition-colors hover-overlay disabled:opacity-50"
                  style={{ borderColor: 'var(--border-secondary)', color: 'var(--text-primary)' }}
                >
                  Dismiss
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default TabbedCompose;
