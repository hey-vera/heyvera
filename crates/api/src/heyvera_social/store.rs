use core::future::Future;
use core::pin::Pin;

pub type StoreFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

pub trait AccountStore: Send + Sync {
    type Error;
    type Account;
    type AccountId: Send + Sync;
    type AccountHandle: Send + Sync;
    type CreateAccountInput: Send;
    type UpdateAccountInput: Send;
    type AccountListQuery: Send + Sync;
    type Page: Send;

    fn create_account<'a>(
        &'a self,
        input: Self::CreateAccountInput,
    ) -> StoreFuture<'a, Result<Self::Account, Self::Error>>;

    fn get_account<'a>(
        &'a self,
        account_id: &'a Self::AccountId,
    ) -> StoreFuture<'a, Result<Option<Self::Account>, Self::Error>>;

    fn get_account_by_handle<'a>(
        &'a self,
        handle: &'a Self::AccountHandle,
    ) -> StoreFuture<'a, Result<Option<Self::Account>, Self::Error>>;

    fn list_accounts<'a>(
        &'a self,
        query: &'a Self::AccountListQuery,
    ) -> StoreFuture<'a, Result<Self::Page, Self::Error>>;

    fn update_account<'a>(
        &'a self,
        account_id: &'a Self::AccountId,
        input: Self::UpdateAccountInput,
    ) -> StoreFuture<'a, Result<Self::Account, Self::Error>>;

    fn delete_account<'a>(
        &'a self,
        account_id: &'a Self::AccountId,
    ) -> StoreFuture<'a, Result<(), Self::Error>>;
}

pub trait ProfileStore: Send + Sync {
    type Error;
    type Profile;
    type AccountId: Send + Sync;
    type ProfileId: Send + Sync;
    type UpsertProfileInput: Send;
    type ProfileListQuery: Send + Sync;
    type Page: Send;

    fn get_profile<'a>(
        &'a self,
        profile_id: &'a Self::ProfileId,
    ) -> StoreFuture<'a, Result<Option<Self::Profile>, Self::Error>>;

    fn get_profile_by_account<'a>(
        &'a self,
        account_id: &'a Self::AccountId,
    ) -> StoreFuture<'a, Result<Option<Self::Profile>, Self::Error>>;

    fn upsert_profile<'a>(
        &'a self,
        account_id: &'a Self::AccountId,
        input: Self::UpsertProfileInput,
    ) -> StoreFuture<'a, Result<Self::Profile, Self::Error>>;

    fn list_profiles<'a>(
        &'a self,
        query: &'a Self::ProfileListQuery,
    ) -> StoreFuture<'a, Result<Self::Page, Self::Error>>;
}

pub trait PostStore: Send + Sync {
    type Error;
    type Post;
    type PostId: Send + Sync;
    type AccountId: Send + Sync;
    type CreatePostInput: Send;
    type UpdatePostInput: Send;
    type PostListQuery: Send + Sync;
    type Page: Send;

    fn create_post<'a>(
        &'a self,
        author_account_id: &'a Self::AccountId,
        input: Self::CreatePostInput,
    ) -> StoreFuture<'a, Result<Self::Post, Self::Error>>;

    fn get_post<'a>(
        &'a self,
        post_id: &'a Self::PostId,
    ) -> StoreFuture<'a, Result<Option<Self::Post>, Self::Error>>;

    fn list_posts<'a>(
        &'a self,
        query: &'a Self::PostListQuery,
    ) -> StoreFuture<'a, Result<Self::Page, Self::Error>>;

    fn update_post<'a>(
        &'a self,
        post_id: &'a Self::PostId,
        input: Self::UpdatePostInput,
    ) -> StoreFuture<'a, Result<Self::Post, Self::Error>>;

    fn delete_post<'a>(
        &'a self,
        post_id: &'a Self::PostId,
    ) -> StoreFuture<'a, Result<(), Self::Error>>;
}

pub trait FeedStore: Send + Sync {
    type Error;
    type FeedItem;
    type AccountId: Send + Sync;
    type ProfileId: Send + Sync;
    type PostId: Send + Sync;
    type FeedCursor: Send + Sync;
    type FeedRequest: Send + Sync;
    type FeedPage: Send;

    fn home_feed<'a>(
        &'a self,
        account_id: &'a Self::AccountId,
        request: &'a Self::FeedRequest,
    ) -> StoreFuture<'a, Result<Self::FeedPage, Self::Error>>;

    fn profile_feed<'a>(
        &'a self,
        profile_id: &'a Self::ProfileId,
        request: &'a Self::FeedRequest,
    ) -> StoreFuture<'a, Result<Self::FeedPage, Self::Error>>;

    fn thread_feed<'a>(
        &'a self,
        root_post_id: &'a Self::PostId,
        request: &'a Self::FeedRequest,
    ) -> StoreFuture<'a, Result<Self::FeedPage, Self::Error>>;
}

pub trait SocialActionStore: Send + Sync {
    type Error;
    type AccountId: Send + Sync;
    type PostId: Send + Sync;
    type Follow;
    type Like;
    type Repost;
    type Bookmark;
    type FollowListQuery: Send + Sync;
    type PostActionListQuery: Send + Sync;
    type Page: Send;

    fn follow_account<'a>(
        &'a self,
        follower_account_id: &'a Self::AccountId,
        subject_account_id: &'a Self::AccountId,
    ) -> StoreFuture<'a, Result<Self::Follow, Self::Error>>;

    fn unfollow_account<'a>(
        &'a self,
        follower_account_id: &'a Self::AccountId,
        subject_account_id: &'a Self::AccountId,
    ) -> StoreFuture<'a, Result<(), Self::Error>>;

    fn list_followers<'a>(
        &'a self,
        account_id: &'a Self::AccountId,
        query: &'a Self::FollowListQuery,
    ) -> StoreFuture<'a, Result<Self::Page, Self::Error>>;

    fn list_following<'a>(
        &'a self,
        account_id: &'a Self::AccountId,
        query: &'a Self::FollowListQuery,
    ) -> StoreFuture<'a, Result<Self::Page, Self::Error>>;

    fn like_post<'a>(
        &'a self,
        account_id: &'a Self::AccountId,
        post_id: &'a Self::PostId,
    ) -> StoreFuture<'a, Result<Self::Like, Self::Error>>;

    fn unlike_post<'a>(
        &'a self,
        account_id: &'a Self::AccountId,
        post_id: &'a Self::PostId,
    ) -> StoreFuture<'a, Result<(), Self::Error>>;

    fn repost_post<'a>(
        &'a self,
        account_id: &'a Self::AccountId,
        post_id: &'a Self::PostId,
    ) -> StoreFuture<'a, Result<Self::Repost, Self::Error>>;

    fn unrepost_post<'a>(
        &'a self,
        account_id: &'a Self::AccountId,
        post_id: &'a Self::PostId,
    ) -> StoreFuture<'a, Result<(), Self::Error>>;

    fn bookmark_post<'a>(
        &'a self,
        account_id: &'a Self::AccountId,
        post_id: &'a Self::PostId,
    ) -> StoreFuture<'a, Result<Self::Bookmark, Self::Error>>;

    fn remove_bookmark<'a>(
        &'a self,
        account_id: &'a Self::AccountId,
        post_id: &'a Self::PostId,
    ) -> StoreFuture<'a, Result<(), Self::Error>>;

    fn list_post_likes<'a>(
        &'a self,
        post_id: &'a Self::PostId,
        query: &'a Self::PostActionListQuery,
    ) -> StoreFuture<'a, Result<Self::Page, Self::Error>>;

    fn list_post_reposts<'a>(
        &'a self,
        post_id: &'a Self::PostId,
        query: &'a Self::PostActionListQuery,
    ) -> StoreFuture<'a, Result<Self::Page, Self::Error>>;
}

pub trait HeyVeraSocialStore:
    AccountStore + ProfileStore + PostStore + FeedStore + SocialActionStore
{
}

impl<T> HeyVeraSocialStore for T where
    T: AccountStore + ProfileStore + PostStore + FeedStore + SocialActionStore
{
}
