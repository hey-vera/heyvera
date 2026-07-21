import { describe, expect, it } from 'vitest';
import { feedPostToPost, type FeedPost } from './social';

function makeFeedPost(overrides: Partial<FeedPost> = {}): FeedPost {
  return {
    id: 'post_1',
    body: 'Hello from the network',
    visibility: 'public',
    proofState: 'unproven',
    authorMode: 'person',
    replyToPostId: null,
    quotePostId: null,
    createdAt: '2026-07-01T12:00:00.000Z',
    updatedAt: '2026-07-01T12:00:00.000Z',
    author: {
      profileId: 'profile_abc',
      handle: 'vera',
      displayName: 'Vera User',
      avatar_url: 'https://cdn.example/avatar.png',
    },
    linkedAgent: null,
    likeCount: 3,
    repostCount: 1,
    bookmarkCount: 0,
    replyCount: 2,
    liked: true,
    bookmarked: false,
    reposted: true,
    ...overrides,
  };
}

describe('feedPostToPost', () => {
  it('maps author fields from FeedPost.author', () => {
    const post = feedPostToPost(makeFeedPost());

    expect(post.author).toEqual({
      id: 'profile_abc',
      display_name: 'Vera User',
      handle: 'vera',
      avatar_url: 'https://cdn.example/avatar.png',
      verified: false,
    });
  });

  it('maps body → content', () => {
    const post = feedPostToPost(makeFeedPost({ body: 'Pulse draft body' }));
    expect(post.content).toBe('Pulse draft body');
  });

  it('maps engagement counts and viewer flags', () => {
    const post = feedPostToPost(
      makeFeedPost({
        likeCount: 10,
        repostCount: 4,
        replyCount: 7,
        liked: true,
        bookmarked: true,
        reposted: false,
      }),
    );

    expect(post.like_count).toBe(10);
    expect(post.repost_count).toBe(4);
    expect(post.reply_count).toBe(7);
    expect(post.liked).toBe(true);
    expect(post.bookmarked).toBe(true);
    expect(post.reposted).toBe(false);
    expect(post.view_count).toBe(0);
  });

  it('defaults missing engagement and avatar fields', () => {
    const post = feedPostToPost(
      makeFeedPost({
        likeCount: undefined,
        repostCount: undefined,
        replyCount: undefined,
        liked: undefined,
        bookmarked: undefined,
        reposted: undefined,
        author: {
          profileId: 'p2',
          handle: 'agent',
          displayName: 'Agent',
        },
      }),
    );

    expect(post.like_count).toBe(0);
    expect(post.repost_count).toBe(0);
    expect(post.reply_count).toBe(0);
    expect(post.liked).toBe(false);
    expect(post.bookmarked).toBe(false);
    expect(post.reposted).toBe(false);
    expect(post.author.avatar_url).toBe('');
  });

  it('maps replyToPostId → reply_to', () => {
    const post = feedPostToPost(makeFeedPost({ replyToPostId: 'parent_9' }));
    expect(post.reply_to).toBe('parent_9');
  });

  it('maps media array when present on FeedPost', () => {
    const post = feedPostToPost(
      makeFeedPost({
        media: [
          {
            id: 'media_1',
            url: 'https://cdn.example/photo.jpg',
            mediaType: 'image',
            width: 800,
            height: 600,
            altText: 'A cat',
          },
          {
            id: 'media_2',
            url: 'https://cdn.example/clip.mp4',
            mediaType: 'video',
            thumbnailUrl: 'https://cdn.example/clip.jpg',
          },
        ],
      }),
    );

    expect(post.media).toEqual([
      {
        id: 'media_1',
        type: 'image',
        url: 'https://cdn.example/photo.jpg',
        thumbnail_url: undefined,
        width: 800,
        height: 600,
        alt_text: 'A cat',
      },
      {
        id: 'media_2',
        type: 'video',
        url: 'https://cdn.example/clip.mp4',
        thumbnail_url: 'https://cdn.example/clip.jpg',
        width: 0,
        height: 0,
        alt_text: undefined,
      },
    ]);
  });

  it('omits media when FeedPost has none', () => {
    const post = feedPostToPost(makeFeedPost({ media: undefined }));
    expect(post.media).toBeUndefined();
  });

  it('hides vanity views: missing viewCount maps to 0 (PostCard hides zeros)', () => {
    const without = feedPostToPost(makeFeedPost({ viewCount: undefined }));
    expect(without.view_count).toBe(0);

    const zero = feedPostToPost(makeFeedPost({ viewCount: 0 }));
    expect(zero.view_count).toBe(0);

    const real = feedPostToPost(makeFeedPost({ viewCount: 42 }));
    expect(real.view_count).toBe(42);
  });

  it('maps linkedAgent when present on FeedPost', () => {
    const post = feedPostToPost(
      makeFeedPost({
        linkedAgent: {
          id: 'agent_1',
          agentName: 'Vera Bot',
          agentSlug: 'vera-bot',
        },
      }),
    );
    expect(post.linked_agent).toEqual({
      id: 'agent_1',
      agent_name: 'Vera Bot',
      agent_slug: 'vera-bot',
    });
  });
});
