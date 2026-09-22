import { NextResponse } from 'next/server';
import { storeMetadata, metadataUri, type BountyMetadata, type SubmissionMetadata } from '@/lib/cookie/metadata';

/**
 * POST /api/metadata — store off-chain bounty/submission content and return the URI to record
 * on-chain (§29–§31, §75). The client uploads here before building the create/submit transaction.
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
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
