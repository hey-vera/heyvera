import React from "react";
import { ImagePlus, X } from "lucide-react";
import { SignInButton } from "@clerk/clerk-react";
import { useNavigate } from "react-router-dom";
import {
  ACTIVE_PAGE_STORAGE_KEY,
  createBrandPage,
  createPost,
  fetchMyCommunities,
  fetchMyProfile,
  listMyPages,
  resolveCreateAuthorship,
  uploadMediaFile,
  type CommunityMembership,
  type SocialPage,
} from "../../api/social";
import { useAuth } from "../../hooks/useAuth";
import {
  activePageAuthorshipNotice,
  postButtonAuthorshipHint,
} from "../../utils/activePageCopy";
import { ALLOWED_IMAGE_ACCEPT, validateImageFile } from "../../utils/imageUpload";
import { RightRail } from "./RightRail";
import { BottomBar } from "./BottomBar";
import { TopBar, type CreateAction } from "./TopBar";

const COMPOSE_MAX_CHARS = 280;

/** Dispatched after a successful shell compose so Home can prepend without refresh. */
export const HEYVERA_POST_CREATED_EVENT = "heyvera:post-created";

function readStoredPageId(): string | null {
  try {
    return typeof window !== "undefined" ? window.localStorage.getItem(ACTIVE_PAGE_STORAGE_KEY) : null;
  } catch {
    return null;
  }
}

function writeStoredPageId(pageId: string) {
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(ACTIVE_PAGE_STORAGE_KEY, pageId);
    }
  } catch {
    // ignore quota / private mode
  }
}

function pageLabel(page: SocialPage): string {
  const kindLabel =
    page.kind === "person" ? "Person" : page.kind === "agent" ? "Agent" : "Brand";
  return `${page.displayName} (@${page.handle}) · ${kindLabel}`;
}

interface AppShellProps {
  children: React.ReactNode;
  activeRoute: string;
}

export function AppShell({ children, activeRoute }: AppShellProps) {
  const navigate = useNavigate();
  const { authEnabled, isSignedIn, getToken } = useAuth();
  const isMessagesRoute = activeRoute === "/messages";
  const isWideRoute =
    isMessagesRoute || activeRoute === "/videos" || activeRoute === "/live" || activeRoute === "/longform";
  const [composeOpen, setComposeOpen] = React.useState(false);
  const [composeText, setComposeText] = React.useState("");
  const [composeToken, setComposeToken] = React.useState<string | null>(null);
  const [isPosting, setIsPosting] = React.useState(false);
  const [isCheckingComposeAccess, setIsCheckingComposeAccess] = React.useState(false);
  const [composeGate, setComposeGate] = React.useState<"signed_out" | "profile_required" | null>(null);
  const [composeError, setComposeError] = React.useState<string | null>(null);
  const [imageFile, setImageFile] = React.useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = React.useState<string | null>(null);
  const [myCommunities, setMyCommunities] = React.useState<CommunityMembership[]>([]);
  const [selectedCommunityId, setSelectedCommunityId] = React.useState<string>("");
  const [myPages, setMyPages] = React.useState<SocialPage[]>([]);
  const [selectedPageId, setSelectedPageId] = React.useState<string>("");
  const [showNewBrand, setShowNewBrand] = React.useState(false);
  const [brandName, setBrandName] = React.useState("");
  const [brandSlug, setBrandSlug] = React.useState("");
  const [creatingBrand, setCreatingBrand] = React.useState(false);
  /** listMyPages failed — show honest person fallback, never silent void. */
  const [pagesLoadFailed, setPagesLoadFailed] = React.useState(false);
  /** Brand was just created and remains selected — stronger authorship notice. */
  const [brandJustCreated, setBrandJustCreated] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  const remainingChars = COMPOSE_MAX_CHARS - composeText.length;
  const canPost = (composeText.trim().length > 0 || Boolean(imageFile)) && !isPosting;
  const selectedPage = myPages.find((p) => p.id === selectedPageId) ?? myPages[0] ?? null;
  const authorshipNotice = activePageAuthorshipNotice({
    pagesLoadFailed,
    pageKind: selectedPage?.kind,
    brandJustCreated,
  });
  const postHint = postButtonAuthorshipHint({
    pagesLoadFailed,
    pageKind: selectedPage?.kind,
    brandJustCreated,
  });

  const handleNavigate = (route: string) => {
    navigate(route);
  };

  const clearImage = () => {
    if (imagePreviewUrl) {
      URL.revokeObjectURL(imagePreviewUrl);
    }
    setImageFile(null);
    setImagePreviewUrl(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const resetCompose = () => {
    setComposeText("");
    setComposeToken(null);
    setComposeGate(null);
    setComposeError(null);
    setIsPosting(false);
    setIsCheckingComposeAccess(false);
    setSelectedCommunityId("");
    setShowNewBrand(false);
    setBrandName("");
    setBrandSlug("");
    setCreatingBrand(false);
    setPagesLoadFailed(false);
    setBrandJustCreated(false);
    clearImage();
  };

  const closeCompose = () => {
    setComposeOpen(false);
    resetCompose();
  };

  const applyPages = (pages: SocialPage[]) => {
    setMyPages(pages);
    const stored = readStoredPageId();
    const match = pages.find((p) => p.id === stored);
    const fallback = pages.find((p) => p.isDefault) ?? pages[0];
    const next = match ?? fallback;
    if (next) {
      setSelectedPageId(next.id);
    } else {
      setSelectedPageId("");
    }
  };

  const openCompose = async () => {
    setComposeError(null);

    if (!authEnabled || !isSignedIn) {
      setComposeGate("signed_out");
      setComposeOpen(true);
      return;
    }

    setIsCheckingComposeAccess(true);
    try {
      const token = await getToken();
      if (!token) {
        setComposeGate("signed_out");
        setComposeOpen(true);
        return;
      }

      await fetchMyProfile(token);
      setComposeGate(null);
      setComposeToken(token);
      setComposeOpen(true);
      // Optional guild picker — only when /communities/mine works.
      try {
        const mine = await fetchMyCommunities(token);
        setMyCommunities(mine.communities ?? []);
      } catch {
        setMyCommunities([]);
      }
      // Page selector — person + agents + brands.
      try {
        const pagesRes = await listMyPages(token);
        setPagesLoadFailed(false);
        setBrandJustCreated(false);
        applyPages(pagesRes.pages ?? []);
      } catch {
        // Honest fallback: still compose as person; never leave active Page silent.
        setMyPages([]);
        setSelectedPageId("");
        setPagesLoadFailed(true);
        setBrandJustCreated(false);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (
        msg.includes("404") ||
        msg.toLowerCase().includes("not found") ||
        msg.toLowerCase().includes("no profile")
      ) {
        setComposeGate("profile_required");
      } else {
        setComposeError("We could not verify your profile. Try again.");
      }
      setComposeOpen(true);
    } finally {
      setIsCheckingComposeAccess(false);
    }
  };

  const onPickImage = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    if (!file) return;

    const validationError = validateImageFile(file);
    if (validationError) {
      setComposeError(validationError);
      clearImage();
      return;
    }

    if (imagePreviewUrl) {
      URL.revokeObjectURL(imagePreviewUrl);
    }
    setImageFile(file);
    setImagePreviewUrl(URL.createObjectURL(file));
    setComposeError(null);
  };

  const handleCreateAction = (action: CreateAction) => {
    if (action === "post") {
      void openCompose();
      return;
    }
    if (action === "video") {
      navigate("/videos");
      return;
    }
    // Automate → Pulse surface (drafts); full Agents product remains WIP in the switcher.
    navigate("/ai");
  };

  const handleSelectPage = (pageId: string) => {
    if (pageId === "__new_brand__") {
      setShowNewBrand(true);
      return;
    }
    setSelectedPageId(pageId);
    writeStoredPageId(pageId);
    setShowNewBrand(false);
    setBrandJustCreated(false);
  };

  const handleCreateBrand = async () => {
    if (!composeToken || creatingBrand) return;
    const displayName = brandName.trim();
    const slug = brandSlug
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);
    if (!displayName || slug.length < 2) {
      setComposeError("Brand name and a 2+ character slug are required.");
      return;
    }
    setCreatingBrand(true);
    setComposeError(null);
    try {
      const res = await createBrandPage(composeToken, { slug, displayName });
      const page = res.page;
      const nextPages = [...myPages.filter((p) => p.id !== page.id), page];
      // Keep person first, then agents, then brands.
      nextPages.sort((a, b) => {
        const order = { person: 0, agent: 1, brand: 2 } as const;
        return order[a.kind] - order[b.kind];
      });
      setMyPages(nextPages);
      // Keep brand selected but surface strong honesty: posts still as person.
      setSelectedPageId(page.id);
      writeStoredPageId(page.id);
      setBrandJustCreated(true);
      setPagesLoadFailed(false);
      setShowNewBrand(false);
      setBrandName("");
      setBrandSlug("");
    } catch (err) {
      setComposeError(err instanceof Error ? err.message : "Could not create brand page.");
    } finally {
      setCreatingBrand(false);
    }
  };

  const handleSubmitPost = async () => {
    if (!canPost || composeGate) return;

    setIsPosting(true);
    setComposeError(null);

    try {
      const token = composeToken!;
      const mediaIds: string[] = [];

      if (imageFile) {
        const uploaded = await uploadMediaFile(token, imageFile);
        mediaIds.push(uploaded.mediaId);
      }

      const authorship = selectedPage
        ? resolveCreateAuthorship(selectedPage)
        : ({ authorMode: "person" } as const);

      const result = await createPost(token, {
        body: composeText.trim(),
        authorMode: authorship.authorMode,
        ...("linkedAgentId" in authorship && authorship.linkedAgentId
          ? { linkedAgentId: authorship.linkedAgentId }
          : {}),
        ...("pageId" in authorship && authorship.pageId
          ? { pageId: authorship.pageId }
          : {}),
        ...(mediaIds.length > 0 ? { mediaIds } : {}),
        ...(selectedCommunityId ? { communityId: selectedCommunityId } : {}),
      });

      if (selectedPage) {
        writeStoredPageId(selectedPage.id);
      }

      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent(HEYVERA_POST_CREATED_EVENT, {
            detail: { post: result.post },
          }),
        );
      }
      closeCompose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Post failed. Try again.";
      setComposeError(msg);
      setIsPosting(false);
    }
  };

  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--bg-primary)" }}>
      <TopBar
        activeRoute={activeRoute}
        onNavigate={handleNavigate}
        onCreateAction={handleCreateAction}
        onProfileClick={() => handleNavigate("/profile")}
      />

      <div
        className={
          isWideRoute
            ? "mx-auto grid w-full max-w-[1225px] grid-cols-[1fr]"
            : "mx-auto grid w-full max-w-[1000px] grid-cols-[1fr] lg:grid-cols-[minmax(0,640px)_320px]"
        }
      >
        <main
          className="w-full min-w-0"
          style={{
            borderLeft: isWideRoute ? "none" : "1px solid var(--border-primary)",
            borderRight: isWideRoute ? "none" : "1px solid var(--border-primary)",
            minHeight: "100vh",
          }}
        >
          {children}
        </main>

        {!isWideRoute && (
          <div className="hidden min-w-0 lg:block lg:w-[320px]">
            <RightRail />
          </div>
        )}
      </div>

      <BottomBar
        activeRoute={activeRoute}
        onNavigate={handleNavigate}
        onCompose={() => void openCompose()}
      />

      {composeOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-12 sm:pt-16"
          style={{ backgroundColor: "color-mix(in srgb, var(--bg-primary) 60%, transparent)" }}
          onClick={closeCompose}
          role="presentation"
        >
          <div
            className="w-full max-w-[600px] overflow-hidden rounded-2xl"
            style={{ backgroundColor: "var(--bg-primary)", border: "1px solid var(--border-primary)" }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Create post"
          >
            <div
              className="flex items-center justify-between px-4 py-3"
              style={{ borderBottom: "1px solid var(--border-primary)" }}
            >
              <button
                onClick={closeCompose}
                className="rounded-full p-2 transition-colors hover-overlay"
                style={{ color: "var(--text-primary)" }}
                aria-label="Close compose"
                type="button"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
              <div className="flex max-w-[70%] flex-col items-end gap-0.5">
                {postHint && !composeGate && (
                  <span
                    className="text-right text-[11px] leading-snug"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {postHint}
                  </span>
                )}
                <button
                  className="rounded-full px-5 py-1.5 text-sm font-bold transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
                  style={{ backgroundColor: "var(--accent)", color: "var(--bg-primary)" }}
                  disabled={!canPost || Boolean(composeGate)}
                  onClick={() => void handleSubmitPost()}
                  type="button"
                  title={postHint ?? undefined}
                >
                  {isPosting ? "Posting" : "Post"}
                </button>
              </div>
            </div>
            {composeGate ? (
              <ComposeGate
                gate={composeGate}
                authEnabled={authEnabled}
                onCreateProfile={() => {
                  closeCompose();
                  navigate("/profile");
                }}
              />
            ) : (
              <div className="px-4 pb-4 pt-3">
                {myPages.length > 0 && (
                  <label
                    className="mb-3 flex flex-col gap-1 text-[13px]"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    <span>Post as Page</span>
                    <select
                      value={selectedPageId}
                      onChange={(e) => handleSelectPage(e.target.value)}
                      disabled={isPosting || isCheckingComposeAccess || creatingBrand}
                      className="rounded-lg border px-3 py-2 text-[14px] outline-none focus:border-[var(--accent)]"
                      style={{
                        borderColor: "var(--border-primary)",
                        backgroundColor: "var(--bg-elevated)",
                        color: "var(--text-primary)",
                      }}
                      aria-label="Choose Page to post as"
                    >
                      {myPages.map((p) => (
                        <option key={p.id} value={p.id}>
                          {pageLabel(p)}
                        </option>
                      ))}
                      <option value="__new_brand__">+ New brand page…</option>
                    </select>
                    {authorshipNotice && (
                      <span
                        className="text-[12px] leading-snug"
                        style={{ color: "var(--text-secondary)" }}
                        role="status"
                      >
                        {authorshipNotice}
                      </span>
                    )}
                  </label>
                )}

                {myPages.length === 0 && pagesLoadFailed && authorshipNotice && (
                  <p
                    className="mb-3 text-[12px] leading-snug"
                    style={{ color: "var(--text-secondary)" }}
                    role="status"
                  >
                    {authorshipNotice}
                  </p>
                )}

                {showNewBrand && (
                  <div
                    className="mb-3 rounded-xl border p-3"
                    style={{ borderColor: "var(--border-primary)", backgroundColor: "var(--bg-elevated)" }}
                  >
                    <p className="mb-2 text-[13px] font-bold" style={{ color: "var(--text-primary)" }}>
                      New brand page
                    </p>
                    <input
                      type="text"
                      value={brandName}
                      onChange={(e) => {
                        setBrandName(e.target.value);
                        if (!brandSlug || brandSlug === brandName.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").slice(0, 40)) {
                          setBrandSlug(
                            e.target.value
                              .toLowerCase()
                              .replace(/[^a-z0-9_-]+/g, "-")
                              .replace(/^-+|-+$/g, "")
                              .slice(0, 40),
                          );
                        }
                      }}
                      placeholder="Display name"
                      disabled={creatingBrand || isPosting}
                      className="mb-2 w-full rounded-lg border px-3 py-2 text-[14px] outline-none focus:border-[var(--accent)]"
                      style={{
                        borderColor: "var(--border-primary)",
                        backgroundColor: "var(--bg-primary)",
                        color: "var(--text-primary)",
                      }}
                    />
                    <input
                      type="text"
                      value={brandSlug}
                      onChange={(e) =>
                        setBrandSlug(
                          e.target.value
                            .toLowerCase()
                            .replace(/[^a-z0-9_-]+/g, "-")
                            .slice(0, 40),
                        )
                      }
                      placeholder="slug"
                      disabled={creatingBrand || isPosting}
                      className="mb-2 w-full rounded-lg border px-3 py-2 text-[14px] outline-none focus:border-[var(--accent)]"
                      style={{
                        borderColor: "var(--border-primary)",
                        backgroundColor: "var(--bg-primary)",
                        color: "var(--text-primary)",
                      }}
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => void handleCreateBrand()}
                        disabled={creatingBrand || isPosting}
                        className="rounded-full px-4 py-1.5 text-[13px] font-bold disabled:opacity-50"
                        style={{ backgroundColor: "var(--accent)", color: "var(--bg-primary)" }}
                      >
                        {creatingBrand ? "Creating…" : "Create"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowNewBrand(false);
                          const fallback = myPages.find((p) => p.isDefault) ?? myPages[0];
                          if (fallback) setSelectedPageId(fallback.id);
                        }}
                        disabled={creatingBrand}
                        className="rounded-full px-4 py-1.5 text-[13px] font-medium"
                        style={{ color: "var(--text-secondary)" }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                <textarea
                  placeholder={
                    isCheckingComposeAccess ? "Checking profile..." : "Share something with the network"
                  }
                  autoFocus
                  className="w-full resize-none border-none bg-transparent text-xl outline-none placeholder:text-[var(--text-secondary)]"
                  style={{ color: "var(--text-primary)", minHeight: "144px" }}
                  value={composeText}
                  onChange={(event) => {
                    setComposeText(event.target.value.slice(0, COMPOSE_MAX_CHARS));
                    setComposeError(null);
                  }}
                  maxLength={COMPOSE_MAX_CHARS}
                  disabled={isPosting || isCheckingComposeAccess}
                />

                {imagePreviewUrl && (
                  <div
                    className="relative mt-3 overflow-hidden rounded-2xl border"
                    style={{ borderColor: "var(--border-primary)" }}
                  >
                    <img
                      src={imagePreviewUrl}
                      alt="Selected attachment"
                      className="max-h-[280px] w-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={clearImage}
                      disabled={isPosting}
                      className="absolute right-2 top-2 rounded-full p-1.5"
                      style={{
                        backgroundColor: "color-mix(in srgb, var(--bg-primary) 80%, transparent)",
                        color: "var(--text-primary)",
                      }}
                      aria-label="Remove image"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                )}

                {composeError && (
                  <p className="mt-2 text-sm" style={{ color: "var(--color-danger)" }}>
                    {composeError}
                  </p>
                )}

                {myCommunities.length > 0 && (
                  <label className="mt-3 flex flex-col gap-1 text-[13px]" style={{ color: "var(--text-secondary)" }}>
                    <span>Post to guild (optional)</span>
                    <select
                      value={selectedCommunityId}
                      onChange={(e) => setSelectedCommunityId(e.target.value)}
                      disabled={isPosting || isCheckingComposeAccess}
                      className="rounded-lg border px-3 py-2 text-[14px] outline-none focus:border-[var(--accent)]"
                      style={{
                        borderColor: "var(--border-primary)",
                        backgroundColor: "var(--bg-elevated)",
                        color: "var(--text-primary)",
                      }}
                      aria-label="Choose guild"
                    >
                      <option value="">Personal feed</option>
                      {myCommunities.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                <div
                  className="mt-3 flex items-center justify-between pt-3"
                  style={{ borderTop: "1px solid var(--border-primary)" }}
                >
                  <div className="flex items-center gap-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept={ALLOWED_IMAGE_ACCEPT}
                      className="hidden"
                      onChange={onPickImage}
                      disabled={isPosting || isCheckingComposeAccess}
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isPosting || isCheckingComposeAccess}
                      className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors hover-overlay disabled:opacity-50"
                      style={{ color: "var(--accent)" }}
                      aria-label="Add image"
                    >
                      <ImagePlus className="h-4 w-4" aria-hidden="true" />
                      Image
                    </button>
                  </div>
                  <span
                    className="text-sm tabular-nums"
                    style={{ color: remainingChars <= 20 ? "var(--color-danger)" : "var(--text-secondary)" }}
                    aria-live="polite"
                  >
                    {remainingChars}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ComposeGate({
  gate,
  authEnabled,
  onCreateProfile,
}: {
  gate: "signed_out" | "profile_required";
  authEnabled: boolean;
  onCreateProfile: () => void;
}) {
  if (gate === "profile_required") {
    return (
      <div className="px-6 py-10">
        <h2 className="text-[23px] font-bold leading-tight" style={{ color: "var(--text-primary)" }}>
          Create your profile first
        </h2>
        <p className="mt-2 text-[15px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>
          Your sign-in is ready. HeyVera still needs a profile so posts have a name, handle, and identity.
        </p>
        <button
          type="button"
          onClick={onCreateProfile}
          className="mt-5 rounded-full px-5 py-2 text-[15px] font-bold transition-opacity hover:opacity-90"
          style={{ backgroundColor: "var(--accent)", color: "#000" }}
        >
          Create profile
        </button>
      </div>
    );
  }

  return (
    <div className="px-6 py-10">
      <h2 className="text-[23px] font-bold leading-tight" style={{ color: "var(--text-primary)" }}>
        Sign in to post
      </h2>
      <p className="mt-2 text-[15px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>
        Sign in with Clerk, then create your HeyVera profile.
      </p>
      {authEnabled ? (
        <SignInButton mode="modal">
          <button
            type="button"
            className="mt-5 rounded-full px-5 py-2 text-[15px] font-bold transition-opacity hover:opacity-90"
            style={{ backgroundColor: "var(--accent)", color: "#000" }}
          >
            Sign in
          </button>
        </SignInButton>
      ) : (
        <p className="mt-4 text-[13px]" style={{ color: "var(--text-secondary)" }}>
          Sign-in is not configured for this environment.
        </p>
      )}
    </div>
  );
}
