use anchor_lang::prelude::*;

/// Keep on-chain strings short — large content (full descriptions, submission notes) lives
/// off-chain and only its URI is stored here (§12, §29).
pub const MAX_TITLE_LEN: usize = 100;
pub const MAX_URI_LEN: usize = 200;

/// A funded task. The reward is held by the program's escrow PDA, not by any wallet or backend.
#[account]
#[derive(InitSpace)]
pub struct Bounty {
    /// The wallet that created and funded the bounty; the only signer allowed to approve/cancel/refund.
    pub creator: Pubkey,
    /// Creator-scoped monotonic id, part of the bounty PDA seed.
    pub bounty_id: u64,
    #[max_len(MAX_TITLE_LEN)]
    pub title: String,
    /// URI of the off-chain metadata (full description, requirements, submit instructions).
    #[max_len(MAX_URI_LEN)]
    pub description_uri: String,
    pub category: BountyCategory,
    /// Reward in COOK's smallest unit (9 decimals; 1 COOK = 1_000_000_000).
    pub reward_amount: u64,
    /// Unix timestamp after which submissions are rejected and a refund becomes possible.
    pub deadline: i64,
    pub status: BountyStatus,
    /// Number of submissions created; also the next submission's id.
    pub submission_count: u32,
    /// Set once, on approval — the paid submission.
    pub winning_submission: Option<Pubkey>,
    pub created_at: i64,
    pub bump: u8,
}

/// Program-owned account that custodies a single bounty's reward. Because it is owned by this
/// program, the program can move its lamports on approval/refund; no one can withdraw directly.
#[account]
#[derive(InitSpace)]
pub struct Escrow {
    pub bounty: Pubkey,
    /// Reward held (COOK smallest unit), on top of the account's rent.
    pub amount: u64,
    pub bump: u8,
}

/// A contributor's work against a bounty. Only the URI (off-chain proof) is stored on-chain.
#[account]
#[derive(InitSpace)]
pub struct Submission {
    pub bounty: Pubkey,
    pub contributor: Pubkey,
    pub submission_id: u64,
    #[max_len(MAX_URI_LEN)]
    pub submission_uri: String,
    pub submitted_at: i64,
    pub status: SubmissionStatus,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Debug, InitSpace)]
pub enum BountyStatus {
    Active,
    Reviewing,
    Completed,
    Cancelled,
    Expired,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Debug, InitSpace)]
pub enum SubmissionStatus {
    Pending,
    Approved,
    Rejected,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Debug, InitSpace)]
pub enum BountyCategory {
    Development,
    Design,
    Content,
    Community,
    Research,
    Marketing,
    Memes,
    Other,
}
