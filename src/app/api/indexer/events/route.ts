import { NextResponse } from 'next/server';
import { recordTransaction, recordActivity } from '@/lib/cookie/indexer';

/**
 * POST /api/indexer/events — record a confirmed transaction and an activity entry (§37, §75).
 * The client calls this after Cookie Chain confirms a transaction so the feed updates immediately;
 * the periodic reconcile (`/api/indexer/sync`) remains the source of correctness.
 */
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const signature = typeof body.signature === 'string' ? body.signature : '';
  const type = typeof body.type === 'string' ? body.type : '';
  const bountyPubkey = typeof body.bountyPubkey === 'string' ? body.bountyPubkey : undefined;
  const wallet = typeof body.wallet === 'string' ? body.wallet : undefined;
  const eventType = typeof body.eventType === 'string' ? body.eventType : type;
  const metadata = body.metadata && typeof body.metadata === 'object' ? (body.metadata as Record<string, unknown>) : undefined;

  if (!signature || !type) {
    return NextResponse.json({ error: 'signature and type are required.' }, { status: 400 });
  }

  await recordTransaction({ signature, type, bountyPubkey, wallet });
  await recordActivity({ eventType, bountyPubkey, wallet, transactionSignature: signature, metadata });

  return NextResponse.json({ ok: true }, { status: 201 });
}
