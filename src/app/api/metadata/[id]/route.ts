import { NextResponse } from 'next/server';
import { getMetadata } from '@/lib/cookie/metadata';

/** GET /api/metadata/[id] — resolve the off-chain content behind an on-chain metadata URI. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const record = await getMetadata(id);
  if (!record) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }
  return NextResponse.json(record);
}
