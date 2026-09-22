import { NextResponse } from 'next/server';
import { reconcileFromChain } from '@/lib/cookie/indexer';
import { isChainConfigured } from '@/lib/cookie/chain';

/**
 * POST /api/indexer/sync — reconcile on-chain accounts into Neon (§80). Safe to call repeatedly;
 * upserts are idempotent. In production, run on a schedule (cron) and/or after key transactions.
 */
export async function POST() {
  if (!isChainConfigured()) {
    return NextResponse.json({ error: 'Chain is not configured.' }, { status: 503 });
  }
  try {
    const counts = await reconcileFromChain();
    return NextResponse.json({ ok: true, ...counts });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
