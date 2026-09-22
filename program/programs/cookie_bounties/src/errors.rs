use anchor_lang::prelude::*;

/// Program errors, worded so the frontend can surface them directly (§70).
#[error_code]
pub enum BountyError {
    #[msg("Reward must be greater than zero.")]
    InvalidReward,
    #[msg("Deadline must be in the future.")]
    InvalidDeadline,
    #[msg("Title is too long.")]
    TitleTooLong,
    #[msg("Metadata URI is too long.")]
    UriTooLong,
    #[msg("This bounty is not active.")]
    BountyNotActive,
    #[msg("This bounty has expired.")]
    BountyExpired,
    #[msg("This bounty has already been completed.")]
    AlreadyCompleted,
    #[msg("Only the bounty creator can perform this action.")]
    Unauthorized,
    #[msg("This submission does not belong to the bounty.")]
    SubmissionMismatch,
    #[msg("This submission is not pending.")]
    SubmissionNotPending,
    #[msg("The contributor account does not match the submission.")]
    ContributorMismatch,
    #[msg("The escrow does not belong to this bounty.")]
    EscrowMismatch,
    #[msg("The bounty has not expired yet.")]
    NotExpired,
    #[msg("The bounty cannot be cancelled after a submission is approved.")]
    CannotCancel,
    #[msg("Escrow has insufficient funds.")]
    InsufficientEscrow,
    #[msg("Arithmetic overflow.")]
    MathOverflow,
}
