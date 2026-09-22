use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};

pub mod errors;
pub mod events;
pub mod state;

use errors::BountyError;
use events::*;
use state::*;

// Placeholder program id — replace with your own after `anchor keys sync` (keeps Anchor.toml,
// this macro and the frontend's NEXT_PUBLIC_BOUNTIES_PROGRAM_ID in agreement).
declare_id!("5Pb9fVyi7t9b5wxDb6tJSNyZUbcuw1uqqacnCYUGq97j");

/// Cookie Bounties — the escrow authority for the marketplace.
///
/// Money invariants live here, not in the backend (§3, §5): the creator funds a bounty into a
/// program-owned escrow PDA in the same transaction that creates it, only the creator can approve,
/// approval releases the reward to the winning contributor, and a completed bounty can never be
/// paid or refunded again.
#[program]
pub mod cookie_bounties {
    use super::*;

    /// Create a bounty and fund its escrow atomically (§18–§20). The creator's wallet signs; the
    /// reward moves from the creator into the program-owned escrow PDA.
    pub fn create_and_fund_bounty(
        ctx: Context<CreateAndFundBounty>,
        bounty_id: u64,
        title: String,
        description_uri: String,
        category: BountyCategory,
        reward_amount: u64,
        deadline: i64,
    ) -> Result<()> {
        require!(reward_amount > 0, BountyError::InvalidReward);
        require!(title.len() <= MAX_TITLE_LEN, BountyError::TitleTooLong);
        require!(description_uri.len() <= MAX_URI_LEN, BountyError::UriTooLong);

        let now = Clock::get()?.unix_timestamp;
        require!(deadline > now, BountyError::InvalidDeadline);

        let bounty = &mut ctx.accounts.bounty;
        bounty.creator = ctx.accounts.creator.key();
        bounty.bounty_id = bounty_id;
        bounty.title = title;
        bounty.description_uri = description_uri;
        bounty.category = category.clone();
        bounty.reward_amount = reward_amount;
        bounty.deadline = deadline;
        bounty.status = BountyStatus::Active;
        bounty.submission_count = 0;
        bounty.winning_submission = None;
        bounty.created_at = now;
        bounty.bump = ctx.bumps.bounty;

        let escrow = &mut ctx.accounts.escrow;
        escrow.bounty = bounty.key();
        escrow.amount = reward_amount;
        escrow.bump = ctx.bumps.escrow;

        // Move the reward from the creator into the escrow PDA (on top of the account's rent).
        transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.creator.to_account_info(),
                    to: ctx.accounts.escrow.to_account_info(),
                },
            ),
            reward_amount,
        )?;

        emit!(BountyCreated {
            bounty: bounty.key(),
            creator: bounty.creator,
            bounty_id,
            category: format!("{:?}", category),
            reward_amount,
            deadline,
        });
        emit!(BountyFunded {
            bounty: bounty.key(),
            creator: bounty.creator,
            reward_amount,
        });
        Ok(())
    }

    /// Submit work against an active bounty before its deadline (§21).
    pub fn submit_work(ctx: Context<SubmitWork>, submission_uri: String) -> Result<()> {
        require!(submission_uri.len() <= MAX_URI_LEN, BountyError::UriTooLong);

        let now = Clock::get()?.unix_timestamp;
        let bounty = &mut ctx.accounts.bounty;
        require!(bounty.status == BountyStatus::Active, BountyError::BountyNotActive);
        require!(now <= bounty.deadline, BountyError::BountyExpired);

        let submission = &mut ctx.accounts.submission;
        submission.bounty = bounty.key();
        submission.contributor = ctx.accounts.contributor.key();
        submission.submission_id = bounty.submission_count as u64;
        submission.submission_uri = submission_uri;
        submission.submitted_at = now;
        submission.status = SubmissionStatus::Pending;
        submission.bump = ctx.bumps.submission;

        bounty.submission_count = bounty
            .submission_count
            .checked_add(1)
            .ok_or(BountyError::MathOverflow)?;

        emit!(SubmissionCreated {
            bounty: bounty.key(),
            submission: submission.key(),
            contributor: submission.contributor,
            submission_id: submission.submission_id,
        });
        Ok(())
    }

    /// Approve a submission and release the escrow to its contributor (§22–§24). Only the creator
    /// may call this; a completed bounty cannot be approved again (the `Completed` guard + the
    /// escrow being closed both prevent a second payout).
    pub fn approve_submission(ctx: Context<ApproveSubmission>) -> Result<()> {
        let bounty = &mut ctx.accounts.bounty;
        require!(
            bounty.status == BountyStatus::Active || bounty.status == BountyStatus::Reviewing,
            BountyError::BountyNotActive
        );
        require!(bounty.winning_submission.is_none(), BountyError::AlreadyCompleted);

        let submission = &mut ctx.accounts.submission;
        require!(
            submission.status == SubmissionStatus::Pending,
            BountyError::SubmissionNotPending
        );

        let reward = ctx.accounts.escrow.amount;

        // Move exactly the reward from the escrow PDA to the contributor. Valid because the escrow
        // is owned by this program. The escrow's leftover rent is returned to the creator by the
        // `close = creator` constraint after this handler runs.
        let escrow_ai = ctx.accounts.escrow.to_account_info();
        let contributor_ai = ctx.accounts.contributor.to_account_info();
        **escrow_ai.try_borrow_mut_lamports()? = escrow_ai
            .lamports()
            .checked_sub(reward)
            .ok_or(BountyError::InsufficientEscrow)?;
        **contributor_ai.try_borrow_mut_lamports()? = contributor_ai
            .lamports()
            .checked_add(reward)
            .ok_or(BountyError::MathOverflow)?;

        submission.status = SubmissionStatus::Approved;
        bounty.status = BountyStatus::Completed;
        bounty.winning_submission = Some(submission.key());

        emit!(SubmissionApproved {
            bounty: bounty.key(),
            submission: submission.key(),
            contributor: submission.contributor,
            reward_amount: reward,
        });
        Ok(())
    }

    /// Cancel an active bounty before any approval and refund the escrow to the creator (§25). The
    /// `close = creator` constraint returns the full escrow balance (reward + rent) to the creator.
    pub fn cancel_bounty(ctx: Context<CloseBounty>) -> Result<()> {
        let refund = ctx.accounts.escrow.amount;
        let bounty = &mut ctx.accounts.bounty;
        require!(bounty.status == BountyStatus::Active, BountyError::CannotCancel);
        require!(bounty.winning_submission.is_none(), BountyError::AlreadyCompleted);

        bounty.status = BountyStatus::Cancelled;

        emit!(BountyCancelled {
            bounty: bounty.key(),
            creator: bounty.creator,
            refund_amount: refund,
        });
        Ok(())
    }

    /// Refund an expired bounty that was never completed (§26–§27). Requires the deadline to have
    /// passed and no winner; `close = creator` returns the escrow to the creator.
    pub fn refund_bounty(ctx: Context<CloseBounty>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let refund = ctx.accounts.escrow.amount;
        let bounty = &mut ctx.accounts.bounty;
        require!(bounty.winning_submission.is_none(), BountyError::AlreadyCompleted);
        require!(
            bounty.status == BountyStatus::Active || bounty.status == BountyStatus::Reviewing,
            BountyError::BountyNotActive
        );
        require!(now > bounty.deadline, BountyError::NotExpired);

        bounty.status = BountyStatus::Expired;

        emit!(BountyRefunded {
            bounty: bounty.key(),
            creator: bounty.creator,
            refund_amount: refund,
        });
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(bounty_id: u64)]
pub struct CreateAndFundBounty<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        init,
        payer = creator,
        space = 8 + Bounty::INIT_SPACE,
        seeds = [b"bounty", creator.key().as_ref(), &bounty_id.to_le_bytes()],
        bump
    )]
    pub bounty: Account<'info, Bounty>,

    #[account(
        init,
        payer = creator,
        space = 8 + Escrow::INIT_SPACE,
        seeds = [b"escrow", bounty.key().as_ref()],
        bump
    )]
    pub escrow: Account<'info, Escrow>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SubmitWork<'info> {
    #[account(mut)]
    pub contributor: Signer<'info>,

    #[account(
        mut,
        seeds = [b"bounty", bounty.creator.as_ref(), &bounty.bounty_id.to_le_bytes()],
        bump = bounty.bump
    )]
    pub bounty: Account<'info, Bounty>,

    #[account(
        init,
        payer = contributor,
        space = 8 + Submission::INIT_SPACE,
        seeds = [b"submission", bounty.key().as_ref(), &(bounty.submission_count as u64).to_le_bytes()],
        bump
    )]
    pub submission: Account<'info, Submission>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ApproveSubmission<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        mut,
        has_one = creator @ BountyError::Unauthorized,
        seeds = [b"bounty", bounty.creator.as_ref(), &bounty.bounty_id.to_le_bytes()],
        bump = bounty.bump
    )]
    pub bounty: Account<'info, Bounty>,

    #[account(
        mut,
        constraint = submission.bounty == bounty.key() @ BountyError::SubmissionMismatch,
        seeds = [b"submission", bounty.key().as_ref(), &submission.submission_id.to_le_bytes()],
        bump = submission.bump
    )]
    pub submission: Account<'info, Submission>,

    #[account(
        mut,
        close = creator,
        constraint = escrow.bounty == bounty.key() @ BountyError::EscrowMismatch,
        seeds = [b"escrow", bounty.key().as_ref()],
        bump = escrow.bump
    )]
    pub escrow: Account<'info, Escrow>,

    /// The contributor being paid — must be the one on the submission.
    #[account(mut, address = submission.contributor @ BountyError::ContributorMismatch)]
    pub contributor: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CloseBounty<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        mut,
        has_one = creator @ BountyError::Unauthorized,
        seeds = [b"bounty", bounty.creator.as_ref(), &bounty.bounty_id.to_le_bytes()],
        bump = bounty.bump
    )]
    pub bounty: Account<'info, Bounty>,

    #[account(
        mut,
        close = creator,
        constraint = escrow.bounty == bounty.key() @ BountyError::EscrowMismatch,
        seeds = [b"escrow", bounty.key().as_ref()],
        bump = escrow.bump
    )]
    pub escrow: Account<'info, Escrow>,
}
