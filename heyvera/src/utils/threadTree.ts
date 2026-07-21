import type { Post } from '../api/types';

/** Max visual indent depth; deeper replies still nest in data but render flat under the cap. */
export const MAX_VISUAL_DEPTH = 4;

export type ReplyTreeNode = {
  post: Post;
  depth: number;
  children: ReplyTreeNode[];
};

/**
 * Build a forest of reply trees from a flat list of posts that share a root.
 * Posts whose `reply_to` is the root become top-level nodes; nested replies
 * attach under their parent when present. Orphans (parent missing from the list
 * and not root) attach at the top level so nothing is dropped.
 *
 * Siblings are sorted by `created_at` ascending (stable id tiebreak).
 */
export function buildReplyTree(posts: Post[], rootId: string): ReplyTreeNode[] {
  const byParent = new Map<string, Post[]>();

  for (const post of posts) {
    const parentKey = post.reply_to ?? rootId;
    const bucket = byParent.get(parentKey);
    if (bucket) bucket.push(post);
    else byParent.set(parentKey, [post]);
  }

  const sortSiblings = (list: Post[]) =>
    [...list].sort((a, b) => {
      const ta = new Date(a.created_at).getTime();
      const tb = new Date(b.created_at).getTime();
      if (ta !== tb) return ta - tb;
      return a.id.localeCompare(b.id);
    });

  const knownIds = new Set(posts.map((p) => p.id));

  function buildChildren(parentId: string, depth: number): ReplyTreeNode[] {
    const kids = sortSiblings(byParent.get(parentId) ?? []);
    return kids.map((post) => ({
      post,
      depth,
      children: buildChildren(post.id, depth + 1),
    }));
  }

  const roots = buildChildren(rootId, 0);

  // Attach orphans (parent not root and not in the reply set) as top-level.
  const attached = new Set<string>();
  const walk = (nodes: ReplyTreeNode[]) => {
    for (const n of nodes) {
      attached.add(n.post.id);
      walk(n.children);
    }
  };
  walk(roots);

  const orphans = posts.filter((p) => {
    if (attached.has(p.id)) return false;
    const parent = p.reply_to;
    if (!parent || parent === rootId) return false;
    return !knownIds.has(parent);
  });

  for (const post of sortSiblings(orphans)) {
    roots.push({
      post,
      depth: 0,
      children: buildChildren(post.id, 1),
    });
    attached.add(post.id);
  }

  return roots;
}

export type FlattenedReply = {
  post: Post;
  depth: number;
  /** Visual indent depth (clamped to MAX_VISUAL_DEPTH). */
  visualDepth: number;
  isLastSibling: boolean;
};

/**
 * Depth-first flatten for render. `visualDepth` is min(depth, maxVisualDepth).
 */
export function flattenTreeForRender(
  tree: ReplyTreeNode[],
  maxVisualDepth: number = MAX_VISUAL_DEPTH,
): FlattenedReply[] {
  const out: FlattenedReply[] = [];

  function walk(nodes: ReplyTreeNode[]) {
    nodes.forEach((node, index) => {
      out.push({
        post: node.post,
        depth: node.depth,
        visualDepth: Math.min(node.depth, maxVisualDepth),
        isLastSibling: index === nodes.length - 1 && node.children.length === 0,
      });
      walk(node.children);
    });
  }

  walk(tree);
  return out;
}

/** Look up author handle for a parent post id (root or reply). */
export function parentHandleFor(
  replyTo: string | undefined,
  rootId: string,
  rootHandle: string,
  byId: Map<string, Post>,
): string | null {
  if (!replyTo) return null;
  if (replyTo === rootId) return rootHandle;
  const parent = byId.get(replyTo);
  return parent?.author.handle ?? null;
}
