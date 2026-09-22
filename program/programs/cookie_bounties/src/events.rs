use anchor_lang::prelude::*;

/// Events the Neon indexer consumes to build the marketplace, activity feed and analytics (§28, §40).
#[event]
pub struct BountyCreated {
    pub bounty: Pubkey,
    pub creator: Pubkey,
    pub bounty_id: u64,
    pub category: String,
    pub reward_amount: u64,
    pub deadline: i64,
}

#[event]
pub struct BountyFunded {
    pub bounty: Pubkey,
    pub creator: Pubkey,
    pub reward_amount: u64,
}

#[event]
pub struct SubmissionCreated {
    pub bounty: Pubkey,
    pub submission: Pubkey,
    pub contributor: Pubkey,
    pub submission_id: u64,
}

#[event]
pub struct SubmissionApproved {
    pub bounty: Pubkey,
    pub submission: Pubkey,
    pub contributor: Pubkey,
    pub reward_amount: u64,
}

#[event]
pub struct BountyCancelled {
    pub bounty: Pubkey,
    pub creator: Pubkey,
    pub refund_amount: u64,
}

#[event]
pub struct BountyRefunded {
    pub bounty: Pubkey,
    pub creator: Pubkey,
    pub refund_amount: u64,
}
