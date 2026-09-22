import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { PublicKey, Keypair, LAMPORTS_PER_SOL, SystemProgram } from "@solana/web3.js";
import { assert } from "chai";
import { CookieBounties } from "../target/types/cookie_bounties";

/**
 * Cookie Bounties program tests (§90–§91).
 *
 * COOK is the native token (9 decimals, lamport-equivalent on this SVM chain), so the escrow holds
 * native lamports. The headline test is the full escrow round-trip: create + fund → submit →
 * approve → contributor paid, escrow closed. The rest are the money-safety negatives (§72).
 */
describe("cookie_bounties", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.CookieBounties as Program<CookieBounties>;
  const creator = provider.wallet as anchor.Wallet;

  const REWARD = new BN(2 * LAMPORTS_PER_SOL); // 2 COOK
  const DAY = 24 * 60 * 60;

  async function airdrop(pubkey: PublicKey, sol = 5) {
    const sig = await provider.connection.requestAirdrop(pubkey, sol * LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(sig);
  }

  function pdas(bountyId: BN, creatorKey: PublicKey) {
    const [bounty] = PublicKey.findProgramAddressSync(
      [Buffer.from("bounty"), creatorKey.toBuffer(), bountyId.toArrayLike(Buffer, "le", 8)],
      program.programId,
    );
    const [escrow] = PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), bounty.toBuffer()],
      program.programId,
    );
    return { bounty, escrow };
  }

  function submissionPda(bounty: PublicKey, submissionId: BN) {
    const [submission] = PublicKey.findProgramAddressSync(
      [Buffer.from("submission"), bounty.toBuffer(), submissionId.toArrayLike(Buffer, "le", 8)],
      program.programId,
    );
    return submission;
  }

  const future = () => new BN(Math.floor(Date.now() / 1000) + 2 * DAY);

  it("runs the full escrow round-trip: create + fund → submit → approve → paid", async () => {
    const bountyId = new BN(1);
    const { bounty, escrow } = pdas(bountyId, creator.publicKey);
    const contributor = Keypair.generate();
    await airdrop(contributor.publicKey);

    await program.methods
      .createAndFundBounty(bountyId, "Create a Cookie Chain meme", "ipfs://meta", { memes: {} }, REWARD, future())
      .accounts({ creator: creator.publicKey, bounty, escrow, systemProgram: SystemProgram.programId })
      .rpc();

    // Escrow now holds the reward (plus rent).
    const escrowLamports = await provider.connection.getBalance(escrow);
    assert.isAtLeast(escrowLamports, REWARD.toNumber(), "escrow funded with the reward");

    const submission = submissionPda(bounty, new BN(0));
    await program.methods
      .submitWork("ipfs://work")
      .accounts({ contributor: contributor.publicKey, bounty, submission, systemProgram: SystemProgram.programId })
      .signers([contributor])
      .rpc();

    const before = await provider.connection.getBalance(contributor.publicKey);
    await program.methods
      .approveSubmission()
      .accounts({
        creator: creator.publicKey,
        bounty,
        submission,
        escrow,
        contributor: contributor.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    const after = await provider.connection.getBalance(contributor.publicKey);

    assert.equal(after - before, REWARD.toNumber(), "contributor received exactly the reward");
    assert.equal(await provider.connection.getBalance(escrow), 0, "escrow closed to zero");

    const bountyAcct = await program.account.bounty.fetch(bounty);
    assert.deepEqual(bountyAcct.status, { completed: {} });
    assert.isNotNull(bountyAcct.winningSubmission);
  });

  it("rejects a second approval (no double payout)", async () => {
    const bountyId = new BN(2);
    const { bounty, escrow } = pdas(bountyId, creator.publicKey);
    const contributor = Keypair.generate();
    await airdrop(contributor.publicKey);

    await program.methods
      .createAndFundBounty(bountyId, "Second bounty", "ipfs://meta", { development: {} }, REWARD, future())
      .accounts({ creator: creator.publicKey, bounty, escrow, systemProgram: SystemProgram.programId })
      .rpc();

    const submission = submissionPda(bounty, new BN(0));
    await program.methods
      .submitWork("ipfs://work")
      .accounts({ contributor: contributor.publicKey, bounty, submission, systemProgram: SystemProgram.programId })
      .signers([contributor])
      .rpc();

    await program.methods
      .approveSubmission()
      .accounts({ creator: creator.publicKey, bounty, submission, escrow, contributor: contributor.publicKey, systemProgram: SystemProgram.programId })
      .rpc();

    // Second approval must fail — the escrow account no longer exists (closed) and the bounty is Completed.
    let failed = false;
    try {
      await program.methods
        .approveSubmission()
        .accounts({ creator: creator.publicKey, bounty, submission, escrow, contributor: contributor.publicKey, systemProgram: SystemProgram.programId })
        .rpc();
    } catch {
      failed = true;
    }
    assert.isTrue(failed, "second approval rejected");
  });

  it("rejects approval by a non-creator (unauthorized)", async () => {
    const bountyId = new BN(3);
    const { bounty, escrow } = pdas(bountyId, creator.publicKey);
    const contributor = Keypair.generate();
    const attacker = Keypair.generate();
    await airdrop(contributor.publicKey);
    await airdrop(attacker.publicKey);

    await program.methods
      .createAndFundBounty(bountyId, "Third bounty", "ipfs://meta", { design: {} }, REWARD, future())
      .accounts({ creator: creator.publicKey, bounty, escrow, systemProgram: SystemProgram.programId })
      .rpc();

    const submission = submissionPda(bounty, new BN(0));
    await program.methods
      .submitWork("ipfs://work")
      .accounts({ contributor: contributor.publicKey, bounty, submission, systemProgram: SystemProgram.programId })
      .signers([contributor])
      .rpc();

    let failed = false;
    try {
      await program.methods
        .approveSubmission()
        .accounts({ creator: attacker.publicKey, bounty, submission, escrow, contributor: contributor.publicKey, systemProgram: SystemProgram.programId })
        .signers([attacker])
        .rpc();
    } catch {
      failed = true;
    }
    assert.isTrue(failed, "non-creator approval rejected");
  });

  it("refunds the creator after cancel", async () => {
    const bountyId = new BN(4);
    const { bounty, escrow } = pdas(bountyId, creator.publicKey);

    await program.methods
      .createAndFundBounty(bountyId, "Cancellable", "ipfs://meta", { other: {} }, REWARD, future())
      .accounts({ creator: creator.publicKey, bounty, escrow, systemProgram: SystemProgram.programId })
      .rpc();

    await program.methods
      .cancelBounty()
      .accounts({ creator: creator.publicKey, bounty, escrow })
      .rpc();

    assert.equal(await provider.connection.getBalance(escrow), 0, "escrow returned to creator");
    const bountyAcct = await program.account.bounty.fetch(bounty);
    assert.deepEqual(bountyAcct.status, { cancelled: {} });
  });
});
