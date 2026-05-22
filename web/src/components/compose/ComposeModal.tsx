import { useState, useEffect, useCallback, useRef } from "react";
import { useAuthContext } from "../../hooks/useAuthContext";
import { createPost, fetchMyCommunities } from "../../api/social";
import type { LinkedAgent, Community } from "../../api/social";

type ComposeModalProps = {
  isOpen: boolean;
  onClose: () => void;
  replyToPostId?: string;
  defaultCommunityId?: string;
};

type AuthorMode = "person" | "agent";
type VisibilityMode = "public" | "followers";

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
            {replyToPostId ? "Reply" : "Compose post"}
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

        <div className="compose-modal-body">
          <textarea
            ref={textareaRef}
            className="compose-modal-textarea"
            placeholder="What is happening?"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            disabled={submitting}
            rows={6}
            aria-label="Post body"
          />

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

          {authorMode === "agent" && (
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
            </div>

            <button
              type="button"
              className="compose-modal-submit"
              onClick={() => {
                void handleSubmit();
              }}
              disabled={postDisabled}
            >
              {submitting ? "Posting..." : "Post"}
            </button>
          </div>

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
