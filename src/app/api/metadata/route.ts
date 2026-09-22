import { NextResponse } from 'next/server';
import { storeMetadata, metadataUri, type BountyMetadata, type SubmissionMetadata } from '@/lib/cookie/metadata';

/**
 * POST /api/metadata — store off-chain bounty/submission content and return the URI to record
 * on-chain (§29–§31, §75). The client uploads here before building the create/submit transaction.
 */
/** Reject oversized payloads so this open endpoint can't be used to dump large blobs into the DB. */
const MAX_BYTES = 8 * 1024;

export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > MAX_BYTES) {
    return NextResponse.json({ error: 'Payload too large.' }, { status: 413 });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const { kind, data } = (body ?? {}) as { kind?: string; data?: unknown };
  if (kind !== 'bounty' && kind !== 'submission') {
    return NextResponse.json({ error: 'kind must be "bounty" or "submission".' }, { status: 400 });
  }
  if (!data || typeof data !== 'object') {
    return NextResponse.json({ error: 'data is required.' }, { status: 400 });
  }

  // Light validation of the shapes we expect; extra fields are ignored.
  if (kind === 'bounty') {
    const d = data as Partial<BountyMetadata>;
    if (!d.title || !d.description) {
      return NextResponse.json({ error: 'bounty metadata needs a title and description.' }, { status: 400 });
    }
  } else {
    const d = data as Partial<SubmissionMetadata>;
    if (!Array.isArray(d.links)) {
      return NextResponse.json({ error: 'submission metadata needs a links array.' }, { status: 400 });
    }
  }

  const id = await storeMetadata(kind, data);
  return NextResponse.json({ id, uri: metadataUri(id) }, { status: 201 });
}
