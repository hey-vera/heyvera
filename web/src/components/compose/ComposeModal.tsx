import { useState, useEffect, useCallback, useRef } from "react";
import { useAuthContext } from "../../hooks/useAuthContext";
import { createPost, fetchMyCommunities } from "../../api/social";
import {
  createDraft,
  listDrafts,
  approveDraft,
  rejectDraft,
  publishDraft,
  type PulseDraft
} from "../../api/pulse";
import type { LinkedAgent, Community } from "../../api/social";

type ComposeModalProps = {
  isOpen: boolean;
  onClose: () => void;
  replyToPostId?: string;
  defaultCommunityId?: string;
};

type AuthorMode = "person" | "agent";
type VisibilityMode = "public" | "followers";
type ComposeMode = "post" | "agent-assist" | "bot-post";

const MAX_CHAR_COUNT = 500;
const WARNING_CHAR_COUNT = 450;
const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

export function ComposeModal({
  isOpen,
  onClose,
  replyToPostId,
  defaultCommunityId,
}: ComposeModalProps) {
  const { getToken, linkedAgents, triggerRefresh } = useAuthContext();
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const modalRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const [body, setBody] = useState("");
  const [authorMode, setAuthorMode] = useState<AuthorMode>("person");
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [visibility, setVisibility] = useState<VisibilityMode>("public");
  const [communities, setCommunities] = useState<Community[]>([]);
  const [selectedCommunityId, setSelectedCommunityId] = useState(defaultCommunityId ?? "");
  const [communitiesLoading, setCommunitiesLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Compose modes state
  const [composeMode, setComposeMode] = useState<ComposeMode>("post");
  const [drafts, setDrafts] = useState<PulseDraft[]>([]);
  const [draftsLoading, setDraftsLoading] = useState(false);
  // const [selectedDraft, setSelectedDraft] = useState<PulseDraft | null>(null);
  const [showDraftManager, setShowDraftManager] = useState(false);

  const hasAgents = linkedAgents.length > 0;
  const characterCount = body.length;
  const isNearLimit = characterCount >= WARNING_CHAR_COUNT && characterCount <= MAX_CHAR_COUNT;
  const isOverLimit = characterCount > MAX_CHAR_COUNT;
  const requiresAgent = authorMode === "agent";
  const missingAgent = requiresAgent && !selectedAgentId;
  const trimmedBody = body.trim();
  const postDisabled = !trimmedBody || missingAgent || isOverLimit || submitting;

  const resetState = useCallback(() => {
    setBody("");
    setAuthorMode("person");
    setSelectedAgentId("");
    setVisibility("public");
    setSelectedCommunityId("");
    setCommunities([]);
    setCommunitiesLoading(false);
    setSubmitting(false);
    setError(null);
    setComposeMode("post");
    setDrafts([]);
    setDraftsLoading(false);
    // setSelectedDraft(null);
    setShowDraftManager(false);
  }, []);

  const handleClose = useCallback(() => {
    resetState();
    onClose();
  }, [onClose, resetState]);

  useEffect(() => {
    if (!isOpen) return;

    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    const timeoutId = window.setTimeout(() => {
      textareaRef.current?.focus();
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
      previousFocusRef.current?.focus();
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      resetState();
      return;
    }

    let cancelled = false;

    async function loadCommunities() {
      setCommunitiesLoading(true);

      try {
        const token = await getToken();
        if (!token) {
          if (!cancelled) {
            setCommunities([]);
          }
          return;
        }

        const result = await fetchMyCommunities(token);
        if (!cancelled) {
          setCommunities(result.communities);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setCommunities([]);
          setError(
            err instanceof Error
              ? err.message
              : "Failed to load your communities",
          );
        }
      } finally {
        if (!cancelled) {
          setCommunitiesLoading(false);
        }
      }
    }

    void loadCommunities();

    return () => {
      cancelled = true;
    };
  }, [getToken, isOpen, resetState]);

  // Load drafts when switching to agent-assist mode
  useEffect(() => {
    if (!isOpen || composeMode !== "agent-assist") return;

    let cancelled = false;

    async function loadDrafts() {
      setDraftsLoading(true);
      setError(null);

      try {
        const token = await getToken();
        if (!token) {
          if (!cancelled) {
            setDrafts([]);
          }
          return;
        }

        const result = await listDrafts(token);
        if (!cancelled) {
          setDrafts(result.drafts);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setDrafts([]);
          setError(
            err instanceof Error
              ? err.message
              : "Failed to load drafts",
          );
        }
      } finally {
        if (!cancelled) {
          setDraftsLoading(false);
        }
      }
    }

    void loadDrafts();

    return () => {
      cancelled = true;
    };
  }, [getToken, isOpen, composeMode]);

  useEffect(() => {
    if (!isOpen || !hasAgents) return;
    if (authorMode === "agent" && !selectedAgentId) {
      setSelectedAgentId(linkedAgents[0]?.id ?? "");
    }
  }, [authorMode, hasAgents, isOpen, linkedAgents, selectedAgentId]);

  useEffect(() => {
    if (!selectedAgentId) return;
    if (!linkedAgents.some((agent) => agent.id === selectedAgentId)) {
      setSelectedAgentId("");
    }
  }, [linkedAgents, selectedAgentId]);

  const trapFocus = useCallback((event: KeyboardEvent) => {
    if (event.key !== "Tab" || !modalRef.current) return;

    const focusableElements = Array.from(
      modalRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    );

    if (focusableElements.length === 0) {
      event.preventDefault();
      return;
    }

    const first = focusableElements[0];
    const last = focusableElements[focusableElements.length - 1];
    const activeElement = document.activeElement;

    if (event.shiftKey && activeElement === first) {
      event.preventDefault();
      last.focus();
      return;
    }

    if (!event.shiftKey && activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }, []);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      handleClose();
      return;
    }

    trapFocus(event);
  }, [handleClose, trapFocus]);

  useEffect(() => {
    if (!isOpen) return;

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleKeyDown, isOpen]);

  const handleOverlayMouseDown = useCallback((event: MouseEvent) => {
    if (event.target === overlayRef.current) {
      handleClose();
    }
  }, [handleClose]);

  useEffect(() => {
    const overlay = overlayRef.current;
    if (!isOpen || !overlay) return;

    overlay.addEventListener("mousedown", handleOverlayMouseDown);
    return () => {
      overlay.removeEventListener("mousedown", handleOverlayMouseDown);
    };
  }, [handleOverlayMouseDown, isOpen]);

  const handleSubmit = useCallback(async () => {
    if (postDisabled) return;
    if (requiresAgent && !hasAgents) {
      setError("No linked agents are available for agent mode.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const token = await getToken();
      if (!token) {
        throw new Error("Not authenticated");
      }

      // Handle Agent Assist mode (create draft)
      if (composeMode === "agent-assist") {
        const draftPayload = {
          body: trimmedBody,
          visibility,
          authorMode,
          linkedAgentId: authorMode === "agent" ? selectedAgentId : undefined,
        };

        await createDraft(token, draftPayload);
        setBody(""); // Clear form
        // Reload drafts
        const result = await listDrafts(token);
        setDrafts(result.drafts);
        setShowDraftManager(true); // Switch to draft manager view
        setSubmitting(false);
        return;
      }

      // Handle direct posting (existing logic)
      const payload: {
        body: string;
        visibility: string;
        authorMode: string;
        linkedAgentId?: string;
        replyToPostId?: string;
        communityId?: string;
      } = {
        body: trimmedBody,
        visibility,
        authorMode,
      };

      if (authorMode === "agent" && selectedAgentId) {
        payload.linkedAgentId = selectedAgentId;
      }
      if (replyToPostId) {
        payload.replyToPostId = replyToPostId;
      }
      if (selectedCommunityId) {
        payload.communityId = selectedCommunityId;
      }

      await createPost(token, payload);
      triggerRefresh();
      handleClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create post");
      setSubmitting(false);
    }
  }, [
    authorMode,
    composeMode,
    getToken,
    handleClose,
    hasAgents,
    postDisabled,
    replyToPostId,
    requiresAgent,
    selectedAgentId,
    selectedCommunityId,
    submitting,
    trimmedBody,
    triggerRefresh,
    visibility,
  ]);

  const handleApproveDraft = useCallback(async (draft: PulseDraft) => {
    try {
      const token = await getToken();
      if (!token) {
        throw new Error("Not authenticated");
      }

      await approveDraft(token, draft.id);
      // Reload drafts
      const result = await listDrafts(token);
      setDrafts(result.drafts);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to approve draft");
    }
  }, [getToken]);

  const handleRejectDraft = useCallback(async (draft: PulseDraft, reason?: string) => {
    try {
      const token = await getToken();
      if (!token) {
        throw new Error("Not authenticated");
      }

      await rejectDraft(token, draft.id, reason);
      // Reload drafts
      const result = await listDrafts(token);
      setDrafts(result.drafts);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to reject draft");
    }
  }, [getToken]);

  const handlePublishDraft = useCallback(async (draft: PulseDraft) => {
    try {
      const token = await getToken();
      if (!token) {
        throw new Error("Not authenticated");
      }

      await publishDraft(token, draft.id);
      triggerRefresh();
      // Reload drafts
      const result = await listDrafts(token);
      setDrafts(result.drafts);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to publish draft");
    }
  }, [getToken, triggerRefresh]);

  if (!isOpen) return null;

  return (
    <div
      ref={overlayRef}
      className="compose-modal-overlay"
      aria-hidden={false}
      role="presentation"
    >
      <div
        ref={modalRef}
        className="compose-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="compose-modal-title"
      >
        <div className="compose-modal-header">
          <h2 id="compose-modal-title" className="compose-modal-title">
            {replyToPostId ? "Reply" : "Compose"}
          </h2>
          <button
            type="button"
            className="compose-modal-close"
            onClick={handleClose}
            disabled={submitting}
            aria-label="Close compose modal"
          >
            ×
          </button>
        </div>

        {/* Tab Navigation */}
        {!replyToPostId && (
          <div className="compose-modal-tabs">
            <button
              type="button"
              className={`compose-modal-tab ${composeMode === "post" ? "compose-modal-tab-active" : ""}`}
              onClick={() => {
                setComposeMode("post");
                setShowDraftManager(false);
                setError(null);
              }}
              disabled={submitting}
            >
              Post
            </button>
            <button
              type="button"
              className={`compose-modal-tab ${composeMode === "agent-assist" ? "compose-modal-tab-active" : ""}`}
              onClick={() => {
                setComposeMode("agent-assist");
                setShowDraftManager(false);
                setError(null);
              }}
              disabled={submitting}
            >
              Agent Assist
            </button>
            <button
              type="button"
              className={`compose-modal-tab ${composeMode === "bot-post" ? "compose-modal-tab-active" : ""}`}
              onClick={() => {
                setComposeMode("bot-post");
                setShowDraftManager(false);
                setError(null);
              }}
              disabled={submitting}
              title="Fully automated agent posting"
            >
              Bot Post
            </button>
          </div>
        )}

        <div className="compose-modal-body">
          {/* Bot Post Tab - Fully Automated */}
          {composeMode === "bot-post" && (
            <div className="compose-modal-bot-post">
              <div className="compose-modal-bot-info">
                <p>🤖 Let your agent create and post content automatically!</p>
                <p>Your agent will generate posts based on your topics and style preferences.</p>

                <div className="compose-modal-bot-controls">
                  <div className="compose-modal-form-group">
                    <label htmlFor="bot-topic">What should your agent post about?</label>
                    <input
                      id="bot-topic"
                      type="text"
                      placeholder="e.g., 'Share insights about AI development'"
                      className="compose-modal-input"
                      disabled={submitting}
                    />
                  </div>

                  <button
                    type="button"
                    className="compose-modal-submit"
                    disabled={submitting}
                  >
                    {submitting ? "Generating..." : "Generate & Post"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Agent Assist Tab - Draft Manager */}
          {composeMode === "agent-assist" && showDraftManager && (
            <div className="compose-modal-draft-manager">
              <div className="compose-modal-draft-header">
                <h3>Your Drafts</h3>
                <button
                  type="button"
                  className="compose-modal-new-draft-button"
                  onClick={() => setShowDraftManager(false)}
                >
                  + New Draft
                </button>
              </div>

              {draftsLoading && (
                <p className="compose-modal-status">Loading drafts...</p>
              )}

              {!draftsLoading && drafts.length === 0 && (
                <div className="compose-modal-empty-state">
                  <p>No drafts yet. Create your first agent-assisted post!</p>
                  <button
                    type="button"
                    className="compose-modal-new-draft-button"
                    onClick={() => setShowDraftManager(false)}
                  >
                    Create Draft
                  </button>
                </div>
              )}

              {!draftsLoading && drafts.length > 0 && (
                <div className="compose-modal-draft-list">
                  {drafts.map((draft) => (
                    <div key={draft.id} className="compose-modal-draft-item">
                      <div className="compose-modal-draft-content">
                        <p className="compose-modal-draft-body">{draft.body}</p>
                        <div className="compose-modal-draft-meta">
                          <span className={`compose-modal-draft-status compose-modal-draft-status-${draft.status}`}>
                            {draft.status}
                          </span>
                          <span className="compose-modal-draft-date">
                            {new Date(draft.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                      <div className="compose-modal-draft-actions">
                        {draft.status === "pending" && (
                          <>
                            <button
                              type="button"
                              className="compose-modal-draft-action compose-modal-draft-approve"
                              onClick={() => handleApproveDraft(draft)}
                            >
                              ✓ Approve
                            </button>
                            <button
                              type="button"
                              className="compose-modal-draft-action compose-modal-draft-reject"
                              onClick={() => handleRejectDraft(draft)}
                            >
                              ✗ Reject
                            </button>
                          </>
                        )}
                        {draft.status === "approved" && (
                          <button
                            type="button"
                            className="compose-modal-draft-action compose-modal-draft-publish"
                            onClick={() => handlePublishDraft(draft)}
                          >
                            📤 Publish
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Post Tab & Agent Assist Draft Composer */}
          {(composeMode === "post" || (composeMode === "agent-assist" && !showDraftManager)) && (
            <>
              <textarea
                ref={textareaRef}
                className="compose-modal-textarea"
                placeholder={
                  composeMode === "agent-assist"
                    ? "Describe your post idea for agent assistance..."
                    : "What is happening?"
                }
                value={body}
                onChange={(event) => setBody(event.target.value)}
                disabled={submitting}
                rows={6}
                aria-label={composeMode === "agent-assist" ? "Draft body" : "Post body"}
              />
            </>
          )}

          {(composeMode === "post" || (composeMode === "agent-assist" && !showDraftManager)) && (
            <div className="compose-modal-row compose-modal-row-author">
              <span className="compose-modal-label">Author mode</span>
              <div className="compose-modal-toggle-group" role="group" aria-label="Author mode">
                <button
                  type="button"
                  className={`compose-modal-toggle${authorMode === "person" ? " compose-modal-toggle-active" : ""}`}
                  onClick={() => {
                    setAuthorMode("person");
                    setError(null);
                  }}
                  disabled={submitting}
                >
                  Person
                </button>
                <button
                  type="button"
                  className={`compose-modal-toggle${authorMode === "agent" ? " compose-modal-toggle-active" : ""}`}
                  onClick={() => {
                    setAuthorMode("agent");
                    if (!selectedAgentId && linkedAgents[0]) {
                      setSelectedAgentId(linkedAgents[0].id);
                    }
                    setError(null);
                  }}
                  disabled={submitting || !hasAgents}
                  title={hasAgents ? undefined : "Link an agent to post in agent mode"}
                >
                  Agent
                </button>
              </div>
            </div>
          )}

          {authorMode === "agent" && (composeMode === "post" || (composeMode === "agent-assist" && !showDraftManager)) && (
            <label className="compose-modal-field">
              <span className="compose-modal-label">Linked agent</span>
              <select
                className="compose-modal-select"
                value={selectedAgentId}
                onChange={(event) => setSelectedAgentId(event.target.value)}
                disabled={submitting || !hasAgents}
                aria-label="Pick a linked agent"
              >
                <option value="">
                  {hasAgents ? "Choose an agent" : "No linked agents available"}
                </option>
                {linkedAgents.map((agent: LinkedAgent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.agentName}
                  </option>
                ))}
              </select>
            </label>
          )}

          {(composeMode === "post" || (composeMode === "agent-assist" && !showDraftManager)) && (
            <label className="compose-modal-field">
              <span className="compose-modal-label">Community</span>
              <select
                className="compose-modal-select"
                value={selectedCommunityId}
                onChange={(event) => setSelectedCommunityId(event.target.value)}
                disabled={submitting || communitiesLoading}
                aria-label="Target a community"
              >
                <option value="">No community</option>
                {communities.map((community: Community) => (
                  <option key={community.id} value={community.id}>
                    {community.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          {(composeMode === "post" || (composeMode === "agent-assist" && !showDraftManager)) && (
            <div className="compose-modal-row compose-modal-row-visibility">
              <span className="compose-modal-label">Visibility</span>
              <div className="compose-modal-toggle-group" role="group" aria-label="Post visibility">
                <button
                  type="button"
                  className={`compose-modal-toggle${visibility === "public" ? " compose-modal-toggle-active" : ""}`}
                  onClick={() => setVisibility("public")}
                  disabled={submitting}
                >
                  Public
                </button>
                <button
                  type="button"
                  className={`compose-modal-toggle${visibility === "followers" ? " compose-modal-toggle-active" : ""}`}
                  onClick={() => setVisibility("followers")}
                  disabled={submitting}
                >
                  Followers only
                </button>
              </div>
            </div>
          )}

          {(composeMode === "post" || (composeMode === "agent-assist" && !showDraftManager)) && (
            <div className="compose-modal-row compose-modal-row-attachments">
              <span className="compose-modal-label">Media</span>
              <button
                type="button"
                className="compose-modal-media-button"
                disabled
                title="Coming soon"
              >
                Attach media
              </button>
            </div>
          )}

          {(composeMode === "post" || (composeMode === "agent-assist" && !showDraftManager)) && (
            <div className="compose-modal-footer">
              <div className="compose-modal-footer-meta">
                <span
                  className={[
                    "compose-modal-counter",
                    isNearLimit ? "compose-modal-counter-warning" : "",
                    isOverLimit ? "compose-modal-counter-danger" : "",
                  ].filter(Boolean).join(" ")}
                  aria-live="polite"
                >
                  {characterCount}/{MAX_CHAR_COUNT}
                </span>
                {communitiesLoading && (
                  <span className="compose-modal-status">Loading communities...</span>
                )}
                {composeMode === "agent-assist" && !showDraftManager && (
                  <button
                    type="button"
                    className="compose-modal-drafts-link"
                    onClick={() => setShowDraftManager(true)}
                  >
                    View drafts ({drafts.length})
                  </button>
                )}
              </div>

              <button
                type="button"
                className="compose-modal-submit"
                onClick={() => {
                  void handleSubmit();
                }}
                disabled={postDisabled}
              >
                {submitting
                  ? composeMode === "agent-assist"
                    ? "Creating draft..."
                    : "Posting..."
                  : composeMode === "agent-assist"
                  ? "Create Draft"
                  : "Post"}
              </button>
            </div>
          )}

          {missingAgent && (
            <p className="compose-modal-error">
              Choose a linked agent before posting in agent mode.
            </p>
          )}
          {error && <p className="compose-modal-error">{error}</p>}
        </div>
      </div>
    </div>
  );
}
