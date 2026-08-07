use serde::{Deserialize, Serialize};

/// Canonical audience values accepted at API and persistence boundaries.
/// Unknown legacy values are never treated as public.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PostAudience {
    #[serde(rename = "public")]
    Public,
    #[serde(rename = "followers")]
    Followers,
    #[serde(rename = "mutuals")]
    Mutuals,
    #[serde(rename = "guild")]
    Guild,
    #[serde(rename = "circle")]
    Circle,
    #[serde(rename = "author-only")]
    AuthorOnly,
}

impl PostAudience {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Public => "public",
            Self::Followers => "followers",
            Self::Mutuals => "mutuals",
            Self::Guild => "guild",
            Self::Circle => "circle",
            Self::AuthorOnly => "author-only",
        }
    }

    /// Parse persisted data. `private` is the sole supported legacy alias and is
    /// intentionally interpreted as the most restrictive canonical audience.
    pub fn from_storage(value: &str) -> Option<Self> {
        match value {
            "public" => Some(Self::Public),
            "followers" => Some(Self::Followers),
            "mutuals" => Some(Self::Mutuals),
            "guild" => Some(Self::Guild),
            "circle" => Some(Self::Circle),
            "author-only" | "private" => Some(Self::AuthorOnly),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PostAction {
    View,
    ViewThread,
    ViewMedia,
    Like,
    Bookmark,
    Reply,
    Quote,
    Repost,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PolicyDecision {
    Allow,
    /// Externally indistinguishable from a resource that does not exist.
    Conceal,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProfileVisibility {
    Public,
    SignedIn,
    Followers,
}

impl ProfileVisibility {
    pub fn from_storage(value: &str) -> Option<Self> {
        match value {
            "public" => Some(Self::Public),
            "signed_in" => Some(Self::SignedIn),
            "followers" => Some(Self::Followers),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProfileAction {
    View,
    Discover,
    ViewStats,
    ViewConnections,
    Follow,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProfilePolicyFacts {
    pub visibility: Option<ProfileVisibility>,
    pub owner_account_active: bool,
    pub viewer_present: bool,
    pub viewer_is_profile: bool,
    pub viewer_follows_profile: bool,
    pub blocked_either_direction: bool,
    pub show_in_search: bool,
}

pub fn authorize_profile(action: ProfileAction, facts: &ProfilePolicyFacts) -> PolicyDecision {
    if !facts.owner_account_active || facts.blocked_either_direction {
        return PolicyDecision::Conceal;
    }
    if facts.viewer_is_profile {
        return PolicyDecision::Allow;
    }
    let Some(visibility) = facts.visibility else {
        return PolicyDecision::Conceal;
    };
    let visible = match (action, visibility) {
        (ProfileAction::Follow, ProfileVisibility::Public) => facts.viewer_present,
        (ProfileAction::Follow, ProfileVisibility::SignedIn | ProfileVisibility::Followers) => {
            facts.viewer_present
        }
        (_, ProfileVisibility::Public) => true,
        (_, ProfileVisibility::SignedIn) => facts.viewer_present,
        (_, ProfileVisibility::Followers) => facts.viewer_follows_profile,
    };
    if !visible || (action == ProfileAction::Discover && !facts.show_in_search) {
        PolicyDecision::Conceal
    } else {
        PolicyDecision::Allow
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PostPolicyFacts {
    pub audience: Option<PostAudience>,
    pub owner_accounts_active: bool,
    pub deleted: bool,
    pub viewer_is_author: bool,
    pub viewer_follows_author: bool,
    pub author_follows_viewer: bool,
    pub blocked_either_direction: bool,
    pub author_has_protected_posts: bool,
    pub requires_guild_membership: bool,
    pub guild_member: bool,
    pub requires_circle_membership: bool,
    pub circle_member: bool,
}

impl Default for PostPolicyFacts {
    fn default() -> Self {
        Self {
            audience: Some(PostAudience::Public),
            owner_accounts_active: true,
            deleted: false,
            viewer_is_author: false,
            viewer_follows_author: false,
            author_follows_viewer: false,
            blocked_either_direction: false,
            author_has_protected_posts: false,
            requires_guild_membership: false,
            guild_member: false,
            requires_circle_membership: false,
            circle_member: false,
        }
    }
}

/// One fail-closed policy for every post read and interaction.
///
/// Mutes deliberately do not appear in these facts: mute is viewer-local ranking
/// and presentation state, never an authorization grant or denial.
pub fn authorize_post(action: PostAction, facts: &PostPolicyFacts) -> PolicyDecision {
    if !facts.owner_accounts_active || facts.deleted || facts.blocked_either_direction {
        return PolicyDecision::Conceal;
    }

    let Some(audience) = facts.audience else {
        return PolicyDecision::Conceal;
    };

    if !facts.viewer_is_author
        && ((facts.requires_guild_membership && !facts.guild_member)
            || (facts.requires_circle_membership && !facts.circle_member))
    {
        return PolicyDecision::Conceal;
    }

    let can_view = facts.viewer_is_author
        || match audience {
            PostAudience::Public => {
                !facts.author_has_protected_posts || facts.viewer_follows_author
            }
            PostAudience::Followers => facts.viewer_follows_author,
            PostAudience::Mutuals => facts.viewer_follows_author && facts.author_follows_viewer,
            PostAudience::Guild => facts.guild_member,
            PostAudience::Circle => facts.circle_member,
            PostAudience::AuthorOnly => false,
        };

    if !can_view {
        return PolicyDecision::Conceal;
    }

    // A quote/repost is redistribution. It is safe only when the source itself
    // is public and its author has not protected their posts.
    if matches!(action, PostAction::Quote | PostAction::Repost)
        && (audience != PostAudience::Public || facts.author_has_protected_posts)
    {
        return PolicyDecision::Conceal;
    }

    PolicyDecision::Allow
}

#[cfg(test)]
mod tests {
    use super::*;

    fn allowed(action: PostAction, facts: PostPolicyFacts) -> bool {
        authorize_post(action, &facts) == PolicyDecision::Allow
    }

    #[test]
    fn audience_matrix_is_exhaustive_and_fail_closed() {
        struct Case {
            name: &'static str,
            audience: Option<PostAudience>,
            author: bool,
            follows: bool,
            followed_by: bool,
            guild_member: bool,
            circle_member: bool,
            expected: bool,
        }

        let cases = [
            Case {
                name: "anonymous public",
                audience: Some(PostAudience::Public),
                author: false,
                follows: false,
                followed_by: false,
                guild_member: false,
                circle_member: false,
                expected: true,
            },
            Case {
                name: "stranger followers",
                audience: Some(PostAudience::Followers),
                author: false,
                follows: false,
                followed_by: false,
                guild_member: false,
                circle_member: false,
                expected: false,
            },
            Case {
                name: "follower followers",
                audience: Some(PostAudience::Followers),
                author: false,
                follows: true,
                followed_by: false,
                guild_member: false,
                circle_member: false,
                expected: true,
            },
            Case {
                name: "one way mutuals",
                audience: Some(PostAudience::Mutuals),
                author: false,
                follows: true,
                followed_by: false,
                guild_member: false,
                circle_member: false,
                expected: false,
            },
            Case {
                name: "mutual mutuals",
                audience: Some(PostAudience::Mutuals),
                author: false,
                follows: true,
                followed_by: true,
                guild_member: false,
                circle_member: false,
                expected: true,
            },
            Case {
                name: "outsider guild",
                audience: Some(PostAudience::Guild),
                author: false,
                follows: true,
                followed_by: true,
                guild_member: false,
                circle_member: false,
                expected: false,
            },
            Case {
                name: "member guild",
                audience: Some(PostAudience::Guild),
                author: false,
                follows: false,
                followed_by: false,
                guild_member: true,
                circle_member: false,
                expected: true,
            },
            Case {
                name: "outsider circle",
                audience: Some(PostAudience::Circle),
                author: false,
                follows: true,
                followed_by: true,
                guild_member: false,
                circle_member: false,
                expected: false,
            },
            Case {
                name: "member circle",
                audience: Some(PostAudience::Circle),
                author: false,
                follows: false,
                followed_by: false,
                guild_member: false,
                circle_member: true,
                expected: true,
            },
            Case {
                name: "stranger author only",
                audience: Some(PostAudience::AuthorOnly),
                author: false,
                follows: true,
                followed_by: true,
                guild_member: true,
                circle_member: true,
                expected: false,
            },
            Case {
                name: "author always sees",
                audience: Some(PostAudience::AuthorOnly),
                author: true,
                follows: false,
                followed_by: false,
                guild_member: false,
                circle_member: false,
                expected: true,
            },
            Case {
                name: "invalid legacy value",
                audience: None,
                author: false,
                follows: true,
                followed_by: true,
                guild_member: true,
                circle_member: true,
                expected: false,
            },
        ];

        for case in cases {
            let facts = PostPolicyFacts {
                audience: case.audience,
                viewer_is_author: case.author,
                viewer_follows_author: case.follows,
                author_follows_viewer: case.followed_by,
                guild_member: case.guild_member,
                circle_member: case.circle_member,
                ..Default::default()
            };
            assert_eq!(
                allowed(PostAction::View, facts),
                case.expected,
                "{}",
                case.name
            );
        }
    }

    #[test]
    fn blocks_and_deletion_override_every_audience_in_both_directions() {
        for audience in [
            PostAudience::Public,
            PostAudience::Followers,
            PostAudience::Mutuals,
            PostAudience::Guild,
            PostAudience::Circle,
            PostAudience::AuthorOnly,
        ] {
            let base = PostPolicyFacts {
                audience: Some(audience),
                viewer_is_author: true,
                viewer_follows_author: true,
                author_follows_viewer: true,
                guild_member: true,
                circle_member: true,
                ..Default::default()
            };
            assert!(!allowed(
                PostAction::View,
                PostPolicyFacts {
                    blocked_either_direction: true,
                    ..base.clone()
                }
            ));
            assert!(!allowed(
                PostAction::View,
                PostPolicyFacts {
                    deleted: true,
                    ..base
                }
            ));
        }
    }

    #[test]
    fn inactive_resource_owners_are_concealed_even_from_themselves() {
        assert!(!allowed(
            PostAction::View,
            PostPolicyFacts {
                owner_accounts_active: false,
                viewer_is_author: true,
                ..Default::default()
            }
        ));

        let profile = ProfilePolicyFacts {
            visibility: Some(ProfileVisibility::Public),
            owner_account_active: false,
            viewer_present: true,
            viewer_is_profile: true,
            viewer_follows_profile: true,
            blocked_either_direction: false,
            show_in_search: true,
        };
        assert_eq!(
            authorize_profile(ProfileAction::View, &profile),
            PolicyDecision::Conceal
        );
    }

    #[test]
    fn protected_posts_reduce_public_audience_to_followers() {
        let protected = PostPolicyFacts {
            author_has_protected_posts: true,
            ..Default::default()
        };
        assert!(!allowed(PostAction::View, protected.clone()));
        assert!(allowed(
            PostAction::View,
            PostPolicyFacts {
                viewer_follows_author: true,
                ..protected.clone()
            }
        ));
        assert!(allowed(
            PostAction::View,
            PostPolicyFacts {
                viewer_is_author: true,
                ..protected
            }
        ));
    }

    #[test]
    fn resource_membership_is_required_even_for_malformed_public_wrappers() {
        assert!(!allowed(
            PostAction::View,
            PostPolicyFacts {
                requires_guild_membership: true,
                ..Default::default()
            }
        ));
        assert!(allowed(
            PostAction::View,
            PostPolicyFacts {
                requires_guild_membership: true,
                guild_member: true,
                ..Default::default()
            }
        ));
        assert!(!allowed(
            PostAction::View,
            PostPolicyFacts {
                requires_circle_membership: true,
                ..Default::default()
            }
        ));
    }

    #[test]
    fn redistribution_requires_unprotected_public_source() {
        for action in [PostAction::Quote, PostAction::Repost] {
            assert!(allowed(action, PostPolicyFacts::default()));
            assert!(!allowed(
                action,
                PostPolicyFacts {
                    audience: Some(PostAudience::Followers),
                    viewer_follows_author: true,
                    ..Default::default()
                }
            ));
            assert!(!allowed(
                action,
                PostPolicyFacts {
                    author_has_protected_posts: true,
                    viewer_follows_author: true,
                    ..Default::default()
                }
            ));
        }
        assert!(allowed(
            PostAction::Like,
            PostPolicyFacts {
                audience: Some(PostAudience::Followers),
                viewer_follows_author: true,
                ..Default::default()
            }
        ));
        assert!(allowed(
            PostAction::Reply,
            PostPolicyFacts {
                audience: Some(PostAudience::Followers),
                viewer_follows_author: true,
                ..Default::default()
            }
        ));
        assert!(allowed(
            PostAction::Bookmark,
            PostPolicyFacts {
                audience: Some(PostAudience::Followers),
                viewer_follows_author: true,
                ..Default::default()
            }
        ));
    }

    #[test]
    fn persisted_parser_never_promotes_unknown_data_to_public() {
        assert_eq!(
            PostAudience::from_storage("private"),
            Some(PostAudience::AuthorOnly)
        );
        assert_eq!(PostAudience::from_storage("PUBLIC"), None);
        assert_eq!(PostAudience::from_storage("friends"), None);
    }

    #[test]
    fn profile_visibility_and_discovery_matrix_is_fail_closed() {
        let base = ProfilePolicyFacts {
            visibility: Some(ProfileVisibility::Public),
            owner_account_active: true,
            viewer_present: false,
            viewer_is_profile: false,
            viewer_follows_profile: false,
            blocked_either_direction: false,
            show_in_search: true,
        };
        assert_eq!(
            authorize_profile(ProfileAction::View, &base),
            PolicyDecision::Allow
        );
        assert_eq!(
            authorize_profile(
                ProfileAction::View,
                &ProfilePolicyFacts {
                    visibility: Some(ProfileVisibility::SignedIn),
                    ..base.clone()
                }
            ),
            PolicyDecision::Conceal
        );
        assert_eq!(
            authorize_profile(
                ProfileAction::Follow,
                &ProfilePolicyFacts {
                    visibility: Some(ProfileVisibility::Followers),
                    viewer_present: true,
                    ..base.clone()
                }
            ),
            PolicyDecision::Allow
        );
        assert_eq!(
            authorize_profile(
                ProfileAction::View,
                &ProfilePolicyFacts {
                    visibility: Some(ProfileVisibility::SignedIn),
                    viewer_present: true,
                    ..base.clone()
                }
            ),
            PolicyDecision::Allow
        );
        assert_eq!(
            authorize_profile(
                ProfileAction::View,
                &ProfilePolicyFacts {
                    visibility: Some(ProfileVisibility::Followers),
                    viewer_present: true,
                    ..base.clone()
                }
            ),
            PolicyDecision::Conceal
        );
        assert_eq!(
            authorize_profile(
                ProfileAction::View,
                &ProfilePolicyFacts {
                    visibility: Some(ProfileVisibility::Followers),
                    viewer_present: true,
                    viewer_follows_profile: true,
                    ..base.clone()
                }
            ),
            PolicyDecision::Allow
        );
        assert_eq!(
            authorize_profile(
                ProfileAction::Discover,
                &ProfilePolicyFacts {
                    show_in_search: false,
                    ..base.clone()
                }
            ),
            PolicyDecision::Conceal
        );
        assert_eq!(
            authorize_profile(
                ProfileAction::View,
                &ProfilePolicyFacts {
                    blocked_either_direction: true,
                    viewer_is_profile: true,
                    ..base.clone()
                }
            ),
            PolicyDecision::Conceal
        );
        assert_eq!(
            authorize_profile(
                ProfileAction::View,
                &ProfilePolicyFacts {
                    visibility: None,
                    ..base
                }
            ),
            PolicyDecision::Conceal
        );
    }
}
