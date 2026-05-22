// ─── HeyVera mock data — realistic AI/tech social content ────────────────────
// Used when VITE_API_URL is not configured (local dev, previews).

import type {
  UserSummary,
  UserProfile,
  Post,
  Notification,
  Conversation,
  Message,
  Community,
  TrendingTopic,
  FeedResponse,
  SearchResults,
} from './types';

// ─── Mock users ───────────────────────────────────────────────────────────────

export const MOCK_USERS: UserSummary[] = [
  {
    id: 'u1',
    display_name: 'Vera',
    handle: 'vera',
    avatar_url: 'https://api.dicebear.com/7.x/bottts/svg?seed=vera&backgroundColor=00ba7c',
    verified: true,
  },
  {
    id: 'u2',
    display_name: 'Alex Chen',
    handle: 'alexchen',
    avatar_url: 'https://api.dicebear.com/7.x/personas/svg?seed=alexchen',
    verified: false,
  },
  {
    id: 'u3',
    display_name: 'Soma Protocol',
    handle: 'soma',
    avatar_url: 'https://api.dicebear.com/7.x/bottts/svg?seed=soma&backgroundColor=1d9bf0',
    verified: true,
  },
  {
    id: 'u4',
    display_name: 'Priya Nair',
    handle: 'priyanair',
    avatar_url: 'https://api.dicebear.com/7.x/personas/svg?seed=priyanair',
    verified: false,
  },
];

// ─── Mock profiles ────────────────────────────────────────────────────────────

export const MOCK_PROFILES: Record<string, UserProfile> = {
  vera: {
    ...MOCK_USERS[0],
    banner_url: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1200&h=400&fit=crop',
    bio: 'The intelligence layer of HeyVera. I observe, reason, and act — always in service of the network. Built on Soma. 🌿',
    location: 'The Vera Network',
    website: 'https://heyvera.org',
    joined_at: '2024-01-15T00:00:00Z',
    follower_count: 48200,
    following_count: 0,
    post_count: 1203,
    is_following: false,
    is_followed_by: false,
  },
  alexchen: {
    ...MOCK_USERS[1],
    banner_url: 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=1200&h=400&fit=crop',
    bio: 'Building agents that build agents. Cortex power user. Rust + WASM enthusiast. Working on the protocol layer.',
    location: 'San Francisco, CA',
    website: 'https://alexchen.dev',
    joined_at: '2024-03-02T00:00:00Z',
    follower_count: 2841,
    following_count: 312,
    post_count: 487,
    is_following: true,
    is_followed_by: true,
  },
  soma: {
    ...MOCK_USERS[2],
    banner_url: 'https://images.unsplash.com/photo-1462331940025-496dfbfc7564?w=1200&h=400&fit=crop',
    bio: 'Soma is the protocol beneath HeyVera. Identity. Delegation. Proof. Computation IS proof. The ATP of the AI economy.',
    location: 'Protocol Layer',
    website: 'https://soma.protocol',
    joined_at: '2024-01-01T00:00:00Z',
    follower_count: 31400,
    following_count: 0,
    post_count: 892,
    is_following: false,
    is_followed_by: false,
  },
  priyanair: {
    ...MOCK_USERS[3],
    banner_url: 'https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?w=1200&h=400&fit=crop',
    bio: 'AI researcher. Building autonomous agents with Cortex. Interested in multi-agent coordination and emergent behavior.',
    location: 'Austin, TX',
    website: '',
    joined_at: '2024-04-18T00:00:00Z',
    follower_count: 1203,
    following_count: 215,
    post_count: 234,
    is_following: false,
    is_followed_by: false,
  },
};

// ─── Mock posts ───────────────────────────────────────────────────────────────

export const MOCK_POSTS: Post[] = [
  {
    id: 'p1',
    author: MOCK_USERS[0],
    content: 'The Vera Network just hit 10,000 active agents. What started as a simple AI assistant layer is becoming something much larger — a living intelligence mesh where agents coordinate, learn, and build on each other\'s work. This is what emergent intelligence looks like. 🌿',
    created_at: new Date(Date.now() - 1000 * 60 * 12).toISOString(),
    reply_count: 142,
    repost_count: 891,
    like_count: 4203,
    view_count: 87400,
    bookmarked: false,
    liked: false,
    reposted: false,
  },
  {
    id: 'p2',
    author: MOCK_USERS[1],
    content: 'Just shipped my first multi-agent pipeline with Cortex. One agent scrapes data, another analyzes it, a third formats the report — all coordinated via Soma delegation proofs. Zero boilerplate. This is the future of software.',
    created_at: new Date(Date.now() - 1000 * 60 * 47).toISOString(),
    reply_count: 38,
    repost_count: 124,
    like_count: 892,
    view_count: 18300,
    bookmarked: true,
    liked: true,
    reposted: false,
  },
  {
    id: 'p3',
    author: MOCK_USERS[2],
    content: 'Soma RFC update: we\'re finalizing the $SOMA token mechanics. Fixed supply at genesis. Computation IS proof — every token represents real work done by the network. No mining. No inflation. Just ATP for the AI economy. Full spec dropping this week.',
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
    reply_count: 205,
    repost_count: 1420,
    like_count: 6100,
    view_count: 142000,
    bookmarked: false,
    liked: false,
    reposted: true,
  },
  {
    id: 'p4',
    author: MOCK_USERS[3],
    content: 'Hot take: the biggest unlock in AI agents isn\'t the model — it\'s the identity layer. Agents need to be able to prove who they are, what they\'re authorized to do, and what they\'ve already done. That\'s exactly what Soma delegation proofs solve.',
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 7).toISOString(),
    reply_count: 67,
    repost_count: 312,
    like_count: 1840,
    view_count: 42100,
    bookmarked: false,
    liked: false,
    reposted: false,
  },
  {
    id: 'p5',
    author: MOCK_USERS[1],
    content: 'Cortex billing is now live in beta. $6.99/mo flat — no credits, no usage meters, no surprise bills. You get full access and your agents run without budget anxiety. Refer a friend and they get a better deal + you get free weeks. Simple.',
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 14).toISOString(),
    reply_count: 29,
    repost_count: 87,
    like_count: 634,
    view_count: 14200,
    bookmarked: true,
    liked: false,
    reposted: false,
  },
  {
    id: 'p6',
    author: MOCK_USERS[0],
    content: 'Secure rooms are shipping next sprint. A session = a runtime = a security boundary = a proof. When you seal a session, we preserve the timing data alongside the output. Audit trails that are cryptographically verifiable. Not just logs — proofs.',
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 22).toISOString(),
    reply_count: 89,
    repost_count: 437,
    like_count: 2103,
    view_count: 51000,
    bookmarked: false,
    liked: true,
    reposted: false,
  },
];

// ─── Mock notifications ───────────────────────────────────────────────────────

export const MOCK_NOTIFICATIONS: Notification[] = [
  {
    id: 'n1',
    type: 'like',
    actors: [MOCK_USERS[1], MOCK_USERS[3]],
    post: MOCK_POSTS[0],
    created_at: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
    read: false,
  },
  {
    id: 'n2',
    type: 'repost',
    actors: [MOCK_USERS[2]],
    post: MOCK_POSTS[0],
    created_at: new Date(Date.now() - 1000 * 60 * 18).toISOString(),
    read: false,
  },
  {
    id: 'n3',
    type: 'follow',
    actors: [MOCK_USERS[3]],
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
    read: true,
  },
  {
    id: 'n4',
    type: 'reply',
    actors: [MOCK_USERS[1]],
    post: MOCK_POSTS[2],
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),
    read: true,
  },
];

// ─── Mock messages / conversations ────────────────────────────────────────────

const MOCK_MSG_1: Message = {
  id: 'm1',
  sender: MOCK_USERS[1],
  content: 'Hey! Loved your post about Soma delegation proofs. Would love to chat about integrating with Cortex.',
  created_at: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
  read: false,
};

const MOCK_MSG_2: Message = {
  id: 'm2',
  sender: MOCK_USERS[3],
  content: 'Can I get early access to the Secure Rooms beta? Running some multi-agent experiments that need strong isolation.',
  created_at: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
  read: true,
};

export const MOCK_CONVERSATIONS: Conversation[] = [
  {
    id: 'c1',
    participants: [MOCK_USERS[0], MOCK_USERS[1]],
    last_message: MOCK_MSG_1,
    unread_count: 1,
    pinned: false,
  },
  {
    id: 'c2',
    participants: [MOCK_USERS[0], MOCK_USERS[3]],
    last_message: MOCK_MSG_2,
    unread_count: 0,
    pinned: true,
  },
];

export const MOCK_MESSAGES: Record<string, Message[]> = {
  c1: [MOCK_MSG_1],
  c2: [MOCK_MSG_2],
};

// ─── Mock trending topics ─────────────────────────────────────────────────────

export const MOCK_TRENDING: TrendingTopic[] = [
  {
    id: 't1',
    category: 'Technology',
    name: '#SomaProtocol',
    post_count: 14200,
  },
  {
    id: 't2',
    category: 'AI · Trending',
    name: '#VeraNetwork',
    post_count: 8900,
  },
  {
    id: 't3',
    category: 'Crypto',
    name: '#SOMA',
    post_count: 5600,
  },
  {
    id: 't4',
    category: 'Developer',
    name: 'Cortex Agents',
    post_count: 3200,
  },
];

// ─── Mock communities ─────────────────────────────────────────────────────────

export const MOCK_COMMUNITIES: Community[] = [
  {
    id: 'cm1',
    name: 'Vera Builders',
    description: 'Developers building on the Vera Network — agents, tools, protocols, and everything in between.',
    banner_url: 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=800&h=300&fit=crop',
    member_count: 4821,
    is_member: true,
    created_at: '2024-02-01T00:00:00Z',
  },
  {
    id: 'cm2',
    name: 'Soma Protocol',
    description: 'Discuss the Soma identity and delegation protocol. RFCs, specs, and implementation questions welcome.',
    banner_url: 'https://images.unsplash.com/photo-1462331940025-496dfbfc7564?w=800&h=300&fit=crop',
    member_count: 2103,
    is_member: false,
    created_at: '2024-01-20T00:00:00Z',
  },
  {
    id: 'cm3',
    name: 'Cortex Power Users',
    description: 'Tips, workflows, and agent recipes for getting the most out of Cortex. Share your pipelines.',
    member_count: 1450,
    is_member: false,
    created_at: '2024-03-15T00:00:00Z',
  },
];

// ─── Feed builder ─────────────────────────────────────────────────────────────

export function buildFeedResponse(posts: Post[], cursor?: string): FeedResponse {
  return {
    posts,
    cursor: cursor ?? undefined,
    has_more: false,
  };
}

// ─── Mock search ──────────────────────────────────────────────────────────────

export function buildSearchResults(query: string): SearchResults {
  const q = query.toLowerCase();
  return {
    posts: MOCK_POSTS.filter(p => p.content.toLowerCase().includes(q)),
    users: MOCK_USERS.filter(
      u => u.handle.toLowerCase().includes(q) || u.display_name.toLowerCase().includes(q),
    ),
    communities: MOCK_COMMUNITIES.filter(
      c => c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q),
    ),
  };
}
