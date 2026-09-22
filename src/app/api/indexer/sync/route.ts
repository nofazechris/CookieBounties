import { NextResponse } from 'next/server';
import { reconcileFromChain } from '@/lib/cookie/indexer';
import { isChainConfigured } from '@/lib/cookie/chain';

/**
 * Reconcile on-chain accounts into Neon (§80). Safe to call repeatedly — it reads the authoritative
 * chain state and upserts idempotently, so it can't inject false data; the worst a caller can do is
 * spend some RPC/DB work. POST is used by the app after actions; GET is the Vercel Cron entrypoint.
 *
 * Optional hardening: if CRON_SECRET is set, GET requests must present it as `Authorization: Bearer
 * <secret>` (Vercel Cron sends this automatically). POST stays open for the app's after-action sync.
 */
async function run() {
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

export async function POST() {
  return run();
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  return run();
}
