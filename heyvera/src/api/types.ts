// ─── HeyVera social platform — shared TypeScript interfaces ──────────────────
// These interfaces define the contract for the Rust backend.

export interface Post {
  id: string;
  author: UserSummary;
  content: string;
  media?: MediaAttachment[];
  created_at: string;
  reply_count: number;
  repost_count: number;
  like_count: number;
  view_count: number;
  bookmarked: boolean;
  liked: boolean;
  reposted: boolean;
  reply_to?: string;
  quote_post?: Post;
  /** Present when the post was authored with a linked agent Page. */
  linked_agent?: {
    id: string;
    agent_name: string;
    agent_slug: string;
  };
}

export interface UserSummary {
  id: string;
  display_name: string;
  handle: string;
  avatar_url: string;
  verified: boolean;
}

export interface UserProfile extends UserSummary {
  banner_url: string;
  bio: string;
  location?: string;
  website?: string;
  joined_at: string;
  follower_count: number;
  following_count: number;
  post_count: number;
  is_following: boolean;
  is_followed_by: boolean;
}

export interface CreateUserProfileInput {
  display_name: string;
  handle: string;
  bio?: string;
  avatar_url?: string;
  banner_url?: string;
  location?: string;
  website?: string;
}

export interface UpdateUserProfileInput {
  display_name?: string;
  bio?: string;
  avatar_url?: string;
  banner_url?: string;
  location?: string;
  website?: string;
}

export interface MediaAttachment {
  id: string;
  type: 'image' | 'video' | 'gif';
  url: string;
  thumbnail_url?: string;
  width: number;
  height: number;
  alt_text?: string;
}

export interface Notification {
  id: string;
  type: 'like' | 'repost' | 'follow' | 'reply' | 'mention' | 'quote';
  actors: UserSummary[];
  post?: Post;
  created_at: string;
  read: boolean;
}

export interface Conversation {
  id: string;
  participants: UserSummary[];
  last_message: Message | null;
  unread_count: number;
  pinned: boolean;
}

export interface ConversationPage {
  conversations: Conversation[];
  next_cursor: string | null;
  has_more: boolean;
  total_unread_count: number;
}


export type MessageRequestBucket = 'inbox' | 'spam';

export interface MessageRequestSharedContext {
  sender_follows_you: boolean;
  you_follow_sender: boolean;
  shared_community_count: number;
}

export interface MessageRequest {
  id: string;
  state: 'pending';
  bucket: MessageRequestBucket;
  content: string;
  created_at: string;
  sender: UserSummary;
  shared_context: MessageRequestSharedContext;
}

export interface MessageRequestPage {
  requests: MessageRequest[];
  total_pending_count: number;
  next_cursor: string | null;
  has_more: boolean;
}

export interface PendingMessageRequestReceipt {
  id: string;
  state: 'pending' | 'closed';
  created_at: string;
}

export interface Message {
  id: string;
  sequence: number;
  client_message_id?: string | null;
  sender: UserSummary;
  content: string;
  created_at: string;
  read: boolean;
  read_by_profile_ids: string[];
}

export interface MessagePage {
  messages: Message[];
  next_cursor: string | null;
  has_more: boolean;
  sync_cursor: string | null;
}

export interface Community {
  id: string;
  name: string;
  description: string;
  banner_url?: string;
  member_count: number;
  is_member: boolean;
  created_at: string;
}

export interface TrendingTopic {
  id: string;
  category: string;
  name: string;
  post_count: number;
}

export interface FeedResponse {
  posts: Post[];
  cursor?: string;
  has_more: boolean;
}

export interface SearchResults {
  posts: Post[];
  users: UserSummary[];
  communities: Community[];
  cursor?: string;
}
