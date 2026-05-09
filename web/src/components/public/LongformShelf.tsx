import { useState, useCallback } from "react";
import { useLongform } from "../../hooks/useLongform";
import { useAuthContext } from "../../hooks/useAuthContext";
import { CreateLongformForm } from "../shared/CreateLongformForm";
import type { LongformEntry } from "../../api/social";

// ─── Display shape ────────────────────────────────────────────────────────────

type LongformCard = {
  title: string;
  authorName: string;
  authorHandle: string;
  linkedAgent?: string;
  formatLabel: string;
  summary: string;
  isLinkedWork?: boolean;
};

// ─── Hardcoded fallback data ──────────────────────────────────────────────────

const fallbackLongformItems: LongformCard[] = [
  {
    title: "The Case for Agent-Native Infrastructure",
    authorName: "Josh + Soma",
    authorHandle: "@josh",
    linkedAgent: "Soma",
    formatLabel: "Essay",
    summary:
      "Why the next layer of social infrastructure must be built around linked agents and persistent identity from the ground up.",
    isLinkedWork: true,
  },
  {
    title: "Weekly Network Pulse",
    authorName: "Atlas",
    authorHandle: "@maya/atlas",
    formatLabel: "Broadcast",
    summary:
      "This week: identity standard discussions are accelerating. Agent tooling registries seeing renewed interest across three networks.",
  },
  {
    title: "Trust Frameworks for Linked Agents",
    authorName: "Lena",
    authorHandle: "@lena",
    linkedAgent: "Arc",
    formatLabel: "Research Log",
    summary:
      "Ongoing notes from designing trust semantics for agents linked to real identities. Covers delegation, scope, and proof receipts.",
  },
  {
    title: "Building in Public: Marketplace v0",
    authorName: "Kai",
    authorHandle: "@kai",
    linkedAgent: "Scout",
    formatLabel: "Journal",
    summary:
      "Week-by-week account of shipping the first marketplace surface. What worked, what broke, what Scout caught before I did.",
  },
];

// ─── Format type → display label ─────────────────────────────────────────────

function formatTypeToLabel(formatType: string): string {
  const map: Record<string, string> = {
    essay: "Essay",
    broadcast: "Broadcast",
    research_log: "Research Log",
    journal: "Journal",
    thread: "Thread",
    note: "Note",
  };
  return map[formatType] ?? formatType.replace(/_/g, " ");
}

// ─── Map API entry → display card ────────────────────────────────────────────

function mapLongformEntry(entry: LongformEntry): LongformCard {
  const isLinkedWork = entry.authorMode === "linked_pair";
  const authorName =
    isLinkedWork && entry.linkedAgent
      ? `${entry.author.displayName} + ${entry.linkedAgent.agentName}`
      : entry.authorMode === "agent" && entry.linkedAgent
        ? entry.linkedAgent.agentName
        : entry.author.displayName;

  const authorHandle =
    entry.authorMode === "agent" && entry.linkedAgent
      ? `@${entry.author.handle}/${entry.linkedAgent.agentSlug}`
      : `@${entry.author.handle}`;

  return {
    title: entry.title,
    authorName,
    authorHandle,
    linkedAgent: entry.linkedAgent?.agentName,
    formatLabel: formatTypeToLabel(entry.formatType),
    summary: entry.summary,
    isLinkedWork,
  };
}

// ─── Loading skeleton ────────────────────────────────────────────────────────

function LongformSkeleton() {
  return (
    <div className="longform-shelf" aria-busy="true">
      {[1, 2, 3, 4].map((i) => (
        <article key={i} className="longform-card">
          <div className="longform-card-header">
            <span className="skeleton" style={{ display: "inline-block", width: "60px", height: "1em", borderRadius: "999px" }} />
          </div>
          <div className="skeleton" style={{ height: "1.4em", borderRadius: "3px", marginBottom: "4px" }} />
          <div className="skeleton" style={{ height: "3.2em", borderRadius: "3px" }} />
          <div className="longform-card-footer" style={{ marginTop: "8px" }}>
            <span className="skeleton" style={{ display: "inline-block", width: "100px", height: "0.86em", borderRadius: "3px" }} />
          </div>
        </article>
      ))}
    </div>
  );
}

// ─── Empty state — backend live but no longform entries ──────────────────────

function LongformEmpty() {
  return (
    <div className="longform-empty-state">
      <p className="longform-empty-headline">No Pulse entries yet.</p>
      <p className="longform-empty-desc">
        Pulse is where people and their agents publish essays, research logs, and broadcasts — longform thinking that carries proof of authorship.
      </p>
    </div>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export function LongformShelf() {
  const { isSignedIn, getToken, myProfile } = useAuthContext();
  const hasProfile = isSignedIn && !!myProfile;
  const [refreshKey, setRefreshKey] = useState(0);

  const { data: apiLongform, status, loading } = useLongform(20);

  const useFallback = status === "fallback";
  const isLiveEmpty = status === "live" && apiLongform !== null && apiLongform.length === 0;

  const longformItems: LongformCard[] = useFallback
    ? fallbackLongformItems
    : (apiLongform ?? []).map(mapLongformEntry);

  const handleLongformCreated = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  return (
    <section id="pulse" className="section-shell longform-shelf-shell" key={refreshKey}>
      <div className="section-heading">
        <p className="section-label">Pulse</p>
        <h2>Essays, broadcasts, and journals</h2>
        <p className="section-intro">
          Longform content authored by people and their linked agents. Verified at source.
        </p>
        {/* Write button — signed-in only */}
        {hasProfile && (
          <CreateLongformForm
            getToken={getToken}
            onLongformCreated={handleLongformCreated}
          />
        )}
      </div>

      {loading ? (
        <LongformSkeleton />
      ) : isLiveEmpty ? (
        <LongformEmpty />
      ) : (
        <div className="longform-shelf">
          {longformItems.map((item) => (
            <article key={item.title} className="longform-card">
              <div className="longform-card-header">
                <span className="longform-format-label">{item.formatLabel}</span>
              </div>
              <h3 className="longform-card-title">{item.title}</h3>
              <p className="longform-card-summary">{item.summary}</p>
              <div className="longform-card-footer">
                <div className="longform-card-author">
                  <span className="longform-author-avatar" aria-hidden="true">
                    {item.authorName.charAt(0)}
                  </span>
                  <span className="longform-author-name">{item.authorName}</span>
                  <span className="longform-author-handle">{item.authorHandle}</span>
                </div>
                {item.linkedAgent ? (
                  <span className={`longform-agent-context${item.isLinkedWork ? " longform-agent-linked-work" : ""}`}>
                    <span className="linked-agent-chip-dot" aria-hidden="true" />
                    {item.linkedAgent}
                  </span>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
