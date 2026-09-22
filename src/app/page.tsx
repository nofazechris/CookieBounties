import { listBounties, listActivity } from "@/lib/cookie/service";
import { CookieBountiesApp } from "@/components/cookie/CookieBountiesApp";

// Read the board fresh on each request so newly-indexed on-chain bounties appear without a rebuild.
// With no database configured this simply re-reads the in-repo seed (cheap).
export const dynamic = "force-dynamic";

/**
 * Home route. Reads the bounty board + activity feed on the server (from Postgres when configured,
 * otherwise the in-repo seed) and hands them to the client app, which owns the wallet/escrow flow.
 */
export default async function Home() {
  const [bounties, activity] = await Promise.all([listBounties(), listActivity()]);
  return <CookieBountiesApp initialBounties={bounties} initialActivity={activity} />;
}
