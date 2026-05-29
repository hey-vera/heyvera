# Deferred Features

This document explicitly lists features that were deferred during the HeyVera production launch to maintain focus on core social platform functionality.

## Image/Video Processing Pipeline

**What:** Transcoding, thumbnail generation, and image optimization.

**Current state:** `media.rs` stores original files only. Users upload directly to R2/S3 with presigned URLs.

**Why deferred:** Launch scale doesn't justify the complexity. Original quality is acceptable for early users.

**When to revisit:** When media storage costs become significant OR user complaints about load times increase.

**Implementation notes:** Consider AWS Lambda/Cloudflare Workers for serverless processing. Imagekit, Cloudinary, or similar SaaS could handle transcoding. Thumbnails should be generated on-demand and cached.

## Malware/Content Scanning

**What:** Automated scanning of uploaded images and videos for malware, inappropriate content, or copyright violations.

**Current state:** No scanning pipeline. Relies on user reporting and manual moderation.

**Why deferred:** Launch scale and trusted early user base don't require automated scanning. Manual moderation is sufficient.

**When to revisit:** When user-generated content volume exceeds manual moderation capacity OR when open registration launches.

**Implementation notes:** Integrate with AWS Macie, Cloudflare Image Security, or similar. Consider Google Cloud Video Intelligence API for video content analysis.

## Real-time WebSocket Notifications

**What:** Live notifications, typing indicators, and real-time feed updates.

**Current state:** Polling-based notifications. Users refresh manually or rely on periodic API calls.

**Why deferred:** HTTP polling is simpler and sufficient for launch scale. WebSocket infrastructure adds operational complexity.

**When to revisit:** When user engagement metrics show users frequently refresh for new content OR when concurrent user count exceeds 1000+.

**Implementation notes:** Consider Socket.IO, native WebSockets, or Server-Sent Events (SSE). Redis pub/sub for multi-instance coordination.

## Advanced Search (Full-text Search Engine)

**What:** Advanced search across posts, profiles, and content with filters, sorting, and relevance ranking.

**Current state:** SQLite `LIKE` queries for basic text search. Limited to exact phrase matching.

**Why deferred:** SQLite full-text search is adequate for launch content volume. Complex search requires additional infrastructure.

**When to revisit:** When content volume exceeds SQLite's search performance OR when users request advanced search features (filters, faceted search, relevance ranking).

**Implementation notes:** Elasticsearch, Meilisearch, or Typesense for dedicated search. Consider Algolia for hosted solution. Implement search indexing pipeline.

## Background Job Queue

**What:** Asynchronous processing for email sending, webhook delivery, data exports, and cleanup tasks.

**Current state:** All operations are synchronous. Cleanup tasks run via cron scripts.

**Why deferred:** Current scale doesn't require async processing. Direct execution is simpler and more predictable.

**When to revisit:** When webhook delivery failures become frequent OR when operations like data exports time out.

**Implementation notes:** Consider Sidekiq (Ruby), Celery (Python), or custom Rust solution with Redis/PostgreSQL. BullMQ for Node.js components.

## Multi-region Deployment

**What:** Database replication, CDN, and compute across multiple geographic regions.

**Current state:** Single-region deployment. Cloudflare provides global CDN for static assets.

**Why deferred:** User base is primarily US-based. Single region provides adequate performance and simplifies operations.

**When to revisit:** When >20% of users are outside North America OR when latency complaints increase.

**Implementation notes:** Consider read replicas, eventual consistency patterns, and region-aware routing. Cloudflare Workers for edge compute.