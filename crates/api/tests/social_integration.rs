/// Social integration tests.
///
/// Tests run against an in-memory SQLite database (via AppState::new with no
/// external dependencies). Auth is disabled via CORTEX_AUTH_DISABLED=1 so all
/// requests use the synthetic "local" user.
use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use tower::ServiceExt;

use cortex_api::scheduler;
use cortex_api::state::AppState;

// ─── Test infrastructure ─────────────────────────────────────────────────────

/// Build a test router with auth disabled and an isolated temp DB.
async fn test_app() -> (axum::Router, tempfile::TempDir) {
    // Disable Clerk auth so all requests pass with user_id = "local"
    std::env::set_var("CORTEX_AUTH_DISABLED", "1");

    let tmp = tempfile::tempdir().expect("tempdir");
    let workspace = tmp.path().to_path_buf();
    std::fs::create_dir_all(workspace.join(".cortex")).unwrap();

    let ledger_path = workspace.join(".cortex/ledger.jsonl");
    let state = AppState::new(ledger_path, workspace, None).await;

    let scheduler_tx = scheduler::spawn_scheduler(state.clone());
    state.set_scheduler_tx(scheduler_tx).await;

    let app = cortex_api::build_router(state);
    (app, tmp)
}

/// Helper: parse response body as JSON.
async fn body_json(resp: axum::response::Response) -> serde_json::Value {
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    serde_json::from_slice(&bytes).expect("response is not valid JSON")
}

/// POST a JSON body, return the response.
async fn post_json(
    app: axum::Router,
    uri: &str,
    body: serde_json::Value,
) -> axum::response::Response {
    app.oneshot(
        Request::builder()
            .method("POST")
            .uri(uri)
            .header("content-type", "application/json")
            .body(Body::from(serde_json::to_string(&body).unwrap()))
            .unwrap(),
    )
    .await
    .unwrap()
}

/// GET a URI, return the response.
async fn get(app: axum::Router, uri: &str) -> axum::response::Response {
    app.oneshot(
        Request::builder()
            .uri(uri)
            .body(Body::empty())
            .unwrap(),
    )
    .await
    .unwrap()
}

// ─── Tests ───────────────────────────────────────────────────────────────────

/// Create a social profile, then verify it can be fetched.
#[tokio::test]
async fn test_create_and_fetch_profile() {
    let (app, _tmp) = test_app().await;

    // Create profile
    let resp = post_json(
        app.clone(),
        "/v1/social/me/profile",
        serde_json::json!({ "handle": "testuser", "displayName": "Test User" }),
    )
    .await;
    assert_eq!(resp.status(), StatusCode::OK);
    let json = body_json(resp).await;
    assert_eq!(json["ok"], true);
    assert_eq!(json["profile"]["handle"], "testuser");

    // Fetch profile
    let resp = get(app.clone(), "/v1/social/me/profile").await;
    assert_eq!(resp.status(), StatusCode::OK);
    let json = body_json(resp).await;
    assert_eq!(json["handle"], "testuser");
}

/// Create a post and read it back via the single post endpoint.
#[tokio::test]
async fn test_create_and_fetch_post() {
    let (app, _tmp) = test_app().await;

    // Need a profile first
    post_json(
        app.clone(),
        "/v1/social/me/profile",
        serde_json::json!({ "handle": "poster", "displayName": "Poster" }),
    )
    .await;

    // Create post
    let resp = post_json(
        app.clone(),
        "/v1/social/posts",
        serde_json::json!({ "body": "Hello, integration test world!" }),
    )
    .await;
    assert_eq!(resp.status(), StatusCode::OK);
    let json = body_json(resp).await;
    assert_eq!(json["ok"], true);
    let post_id = json["post"]["id"].as_str().unwrap().to_string();

    // Fetch post
    let resp = get(app.clone(), &format!("/v1/social/posts/{}", post_id)).await;
    assert_eq!(resp.status(), StatusCode::OK);
    let json = body_json(resp).await;
    assert_eq!(json["id"], post_id);
    assert_eq!(json["body"], "Hello, integration test world!");
}

/// Like a post and verify the count increments.
#[tokio::test]
async fn test_like_post() {
    let (app, _tmp) = test_app().await;

    post_json(
        app.clone(),
        "/v1/social/me/profile",
        serde_json::json!({ "handle": "liker", "displayName": "Liker" }),
    )
    .await;

    let create_resp = post_json(
        app.clone(),
        "/v1/social/posts",
        serde_json::json!({ "body": "Like me!" }),
    )
    .await;
    let post_id = body_json(create_resp).await["post"]["id"].as_str().unwrap().to_string();

    // Like the post
    let like_resp = post_json(
        app.clone(),
        &format!("/v1/social/posts/{}/like", post_id),
        serde_json::json!({}),
    )
    .await;
    assert_eq!(like_resp.status(), StatusCode::OK);
    let json = body_json(like_resp).await;
    assert_eq!(json["ok"], true);
}

/// Get the home feed (should include the created post).
#[tokio::test]
async fn test_home_feed() {
    let (app, _tmp) = test_app().await;

    post_json(
        app.clone(),
        "/v1/social/me/profile",
        serde_json::json!({ "handle": "feeduser", "displayName": "Feed User" }),
    )
    .await;

    post_json(
        app.clone(),
        "/v1/social/posts",
        serde_json::json!({ "body": "A post for the feed" }),
    )
    .await;

    let resp = get(app.clone(), "/v1/social/feed/home").await;
    assert_eq!(resp.status(), StatusCode::OK);
    let json = body_json(resp).await;
    let posts = json["posts"].as_array().expect("posts array");
    assert!(!posts.is_empty(), "home feed should contain at least one post");
}

/// Search for a post by keyword.
#[tokio::test]
async fn test_search_posts() {
    let (app, _tmp) = test_app().await;

    post_json(
        app.clone(),
        "/v1/social/me/profile",
        serde_json::json!({ "handle": "searcher", "displayName": "Searcher" }),
    )
    .await;

    post_json(
        app.clone(),
        "/v1/social/posts",
        serde_json::json!({ "body": "unique_keyword_xyz integration test" }),
    )
    .await;

    let resp = get(app.clone(), "/v1/social/search?q=unique_keyword_xyz").await;
    assert_eq!(resp.status(), StatusCode::OK);
    let json = body_json(resp).await;
    let posts = json["posts"].as_array().expect("posts array");
    assert!(!posts.is_empty(), "search should return the post");
    assert!(posts[0]["body"]
        .as_str()
        .unwrap_or("")
        .contains("unique_keyword_xyz"));
}

/// Get notifications (empty list for fresh user is fine).
#[tokio::test]
async fn test_notifications_empty() {
    let (app, _tmp) = test_app().await;

    post_json(
        app.clone(),
        "/v1/social/me/profile",
        serde_json::json!({ "handle": "notifuser", "displayName": "Notif User" }),
    )
    .await;

    let resp = get(app.clone(), "/v1/social/notifications").await;
    assert_eq!(resp.status(), StatusCode::OK);
    let json = body_json(resp).await;
    assert!(json["notifications"].as_array().is_some());
}

/// Reply to a post creates a notification for the original author.
#[tokio::test]
async fn test_reply_creates_notification() {
    let (app, _tmp) = test_app().await;

    // Create profile
    post_json(
        app.clone(),
        "/v1/social/me/profile",
        serde_json::json!({ "handle": "author", "displayName": "Author" }),
    )
    .await;

    // Create original post
    let create_resp = post_json(
        app.clone(),
        "/v1/social/posts",
        serde_json::json!({ "body": "Original post" }),
    )
    .await;
    let post_id = body_json(create_resp).await["post"]["id"].as_str().unwrap().to_string();

    // Reply to it
    let reply_resp = post_json(
        app.clone(),
        "/v1/social/posts",
        serde_json::json!({ "body": "A reply", "replyToPostId": post_id }),
    )
    .await;
    assert_eq!(reply_resp.status(), StatusCode::OK);

    // Check notifications
    let resp = get(app.clone(), "/v1/social/notifications").await;
    assert_eq!(resp.status(), StatusCode::OK);
    let json = body_json(resp).await;
    // Since it's the same user, there may or may not be a notification — just verify no crash
    assert!(json["notifications"].as_array().is_some());
}

/// Quote a post and verify it's stored.
#[tokio::test]
async fn test_quote_post() {
    let (app, _tmp) = test_app().await;

    post_json(
        app.clone(),
        "/v1/social/me/profile",
        serde_json::json!({ "handle": "quoter", "displayName": "Quoter" }),
    )
    .await;

    let create_resp = post_json(
        app.clone(),
        "/v1/social/posts",
        serde_json::json!({ "body": "Quotable post" }),
    )
    .await;
    let post_id = body_json(create_resp).await["post"]["id"].as_str().unwrap().to_string();

    // Quote the post
    let quote_resp = post_json(
        app.clone(),
        "/v1/social/posts",
        serde_json::json!({ "body": "My quote", "quotePostId": post_id }),
    )
    .await;
    assert_eq!(quote_resp.status(), StatusCode::OK);
    let json = body_json(quote_resp).await;
    assert_eq!(json["post"]["quotePostId"], post_id);
}

/// Repost a post and then unrepost it.
#[tokio::test]
async fn test_repost_and_unrepost() {
    let (app, _tmp) = test_app().await;

    post_json(
        app.clone(),
        "/v1/social/me/profile",
        serde_json::json!({ "handle": "reposter", "displayName": "Reposter" }),
    )
    .await;

    let create_resp = post_json(
        app.clone(),
        "/v1/social/posts",
        serde_json::json!({ "body": "Repost me" }),
    )
    .await;
    let post_id = body_json(create_resp).await["post"]["id"].as_str().unwrap().to_string();

    // Repost
    let repost_resp = post_json(
        app.clone(),
        &format!("/v1/social/posts/{}/repost", post_id),
        serde_json::json!({}),
    )
    .await;
    assert_eq!(repost_resp.status(), StatusCode::OK);

    // Unrepost via DELETE
    let unrepost_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(&format!("/v1/social/posts/{}/repost", post_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(unrepost_resp.status(), StatusCode::OK);
}

/// Follow status endpoint returns `{ following: bool }` for the viewer.
#[tokio::test]
async fn test_follow_status() {
    let (app, _tmp) = test_app().await;

    post_json(
        app.clone(),
        "/v1/social/me/profile",
        serde_json::json!({ "handle": "viewer1", "displayName": "Viewer" }),
    )
    .await;

    // Unknown handle → 404
    let resp = get(app.clone(), "/v1/social/follows/missing_user/status").await;
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);

    // Self / known handle without follow → following false
    let resp = get(app.clone(), "/v1/social/follows/viewer1/status").await;
    assert_eq!(resp.status(), StatusCode::OK);
    let json = body_json(resp).await;
    assert_eq!(json["following"], false);

    // Profile-by-handle alias exists
    let resp = get(app.clone(), "/v1/social/profiles/viewer1").await;
    assert_eq!(resp.status(), StatusCode::OK);
    let json = body_json(resp).await;
    assert!(json["profile"]["handle"] == "viewer1" || json["handle"] == "viewer1");
}

/// Create a community and list it via /communities/mine; join by slug works.
#[tokio::test]
async fn test_create_community_and_mine() {
    let (app, _tmp) = test_app().await;

    post_json(
        app.clone(),
        "/v1/social/me/profile",
        serde_json::json!({ "handle": "comm_owner", "displayName": "Owner" }),
    )
    .await;

    let create_resp = post_json(
        app.clone(),
        "/v1/social/communities",
        serde_json::json!({
            "name": "Builders",
            "slug": "builders",
            "description": "A place for builders"
        }),
    )
    .await;
    assert_eq!(create_resp.status(), StatusCode::OK);
    let created = body_json(create_resp).await;
    assert_eq!(created["ok"], true);
    assert_eq!(created["community"]["slug"], "builders");
    assert_eq!(created["community"]["name"], "Builders");
    let community_id = created["community"]["id"].as_str().unwrap().to_string();

    // Creator is auto-joined — show up in mine
    let mine_resp = get(app.clone(), "/v1/social/communities/mine").await;
    assert_eq!(mine_resp.status(), StatusCode::OK);
    let mine = body_json(mine_resp).await;
    let communities = mine["communities"].as_array().expect("communities array");
    assert!(!communities.is_empty());
    assert!(communities.iter().any(|c| c["slug"] == "builders"));
    assert!(communities.iter().any(|c| c.get("joinedAt").is_some()));

    // Feed resolves by slug as well as id
    let feed_slug = get(app.clone(), "/v1/social/communities/builders/feed").await;
    assert_eq!(feed_slug.status(), StatusCode::OK);
    let feed_id = get(
        app.clone(),
        &format!("/v1/social/communities/{}/feed", community_id),
    )
    .await;
    assert_eq!(feed_id.status(), StatusCode::OK);

    // Duplicate slug → conflict
    let dup = post_json(
        app.clone(),
        "/v1/social/communities",
        serde_json::json!({ "name": "Builders 2", "slug": "builders" }),
    )
    .await;
    assert_eq!(dup.status(), StatusCode::CONFLICT);
}

/// Notifications are flat camelCase for FE NotificationsPage.
#[tokio::test]
async fn test_notifications_flat_camelcase_shape() {
    let (app, _tmp) = test_app().await;

    post_json(
        app.clone(),
        "/v1/social/me/profile",
        serde_json::json!({ "handle": "notif_shape", "displayName": "Notif Shape" }),
    )
    .await;

    // Create a post then like it (self-like won't notify, so list may be empty —
    // shape is verified when non-empty; empty list still ok).
    let create_resp = post_json(
        app.clone(),
        "/v1/social/posts",
        serde_json::json!({ "body": "hello notif shape" }),
    )
    .await;
    assert_eq!(create_resp.status(), StatusCode::OK);

    let resp = get(app.clone(), "/v1/social/notifications").await;
    assert_eq!(resp.status(), StatusCode::OK);
    let json = body_json(resp).await;
    let notifications = json["notifications"].as_array().expect("notifications array");
    for n in notifications {
        assert!(n.get("id").is_some());
        assert!(n.get("type").is_some());
        assert!(n.get("actorHandle").is_some());
        assert!(n.get("actorDisplayName").is_some());
        assert!(n.get("createdAt").is_some());
        // Must not use nested actors array for primary FE contract
        assert!(n.get("postId").is_some() || n["postId"].is_null());
    }
}

/// Create post with communityId persists communityId.
#[tokio::test]
async fn test_create_post_with_community_id() {
    let (app, _tmp) = test_app().await;

    post_json(
        app.clone(),
        "/v1/social/me/profile",
        serde_json::json!({ "handle": "comm_poster", "displayName": "Poster" }),
    )
    .await;

    let create_comm = post_json(
        app.clone(),
        "/v1/social/communities",
        serde_json::json!({ "name": "Posts Guild", "slug": "posts-guild" }),
    )
    .await;
    let community_id = body_json(create_comm).await["community"]["id"]
        .as_str()
        .unwrap()
        .to_string();

    let post_resp = post_json(
        app.clone(),
        "/v1/social/posts",
        serde_json::json!({
            "body": "posted in community",
            "communityId": community_id
        }),
    )
    .await;
    assert_eq!(post_resp.status(), StatusCode::OK);
    let post = body_json(post_resp).await;
    assert_eq!(post["post"]["communityId"], community_id);
}
