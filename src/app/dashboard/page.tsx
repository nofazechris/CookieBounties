import { listBounties, listActivity } from "@/lib/cookie/service";
import { CookieBountiesApp } from "@/components/cookie/CookieBountiesApp";

// Read the board fresh each request so newly-indexed bounties show up without a rebuild.
export const dynamic = "force-dynamic";

/**
 * /dashboard — the creator dashboard, landing on "My bounties" filtered to the connected wallet
 * (toggle to all). Same app shell as home, just opened on a different screen.
 */
export default async function Dashboard() {
  const [bounties, activity] = await Promise.all([listBounties(), listActivity()]);
  return <CookieBountiesApp initialBounties={bounties} initialActivity={activity} initialScreen="my-bounties" />;
}
