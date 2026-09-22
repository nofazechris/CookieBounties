// Anchor deploy migration. Runs after `anchor deploy`. Kept minimal — bounties are created by
// users from the frontend, so there is no on-chain seeding to do here.
import * as anchor from "@coral-xyz/anchor";

module.exports = async function (provider: anchor.AnchorProvider) {
  anchor.setProvider(provider);
  // Add any one-time post-deploy setup here if the program grows a global config account.
};
