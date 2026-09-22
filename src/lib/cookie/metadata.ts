import 'server-only';
import { eq } from 'drizzle-orm';
import { getDb, isDbConfigured } from '@/lib/db';
import { metadata as metadataTable } from '@/lib/db/schema';

/**
 * Off-chain metadata store (§29–§31). The rich content (full description, requirements, submission
 * notes) lives here; only its URI is written on-chain. Uses Neon when configured; otherwise an
 * in-process map so the create/submit flows work in local dev without a database.
 */

export interface BountyMetadata {
  title: string;
  description: string;
  requirements: string[];
  submitInstructions: string;
  category: string;
}

export interface SubmissionMetadata {
  description: string;
  links: string[];
  attachments: string[];
}

type StoredKind = 'bounty' | 'submission';

const memory = new Map<string, { kind: StoredKind; data: unknown }>();

/** Persist metadata and return its id. The on-chain URI is `${APP_URL}/api/metadata/{id}`. */
export async function storeMetadata(kind: StoredKind, data: unknown): Promise<string> {
  if (!isDbConfigured()) {
    const id = crypto.randomUUID();
    memory.set(id, { kind, data });
    return id;
  }
  const [row] = await getDb().insert(metadataTable).values({ kind, data }).returning({ id: metadataTable.id });
  return row.id;
}

export async function getMetadata(id: string): Promise<{ kind: string; data: unknown } | null> {
  if (!isDbConfigured()) {
    return memory.get(id) ?? null;
  }
  const [row] = await getDb().select().from(metadataTable).where(eq(metadataTable.id, id)).limit(1);
  return row ? { kind: row.kind, data: row.data } : null;
}

/** Build the absolute metadata URI stored on-chain for a given metadata id. */
export function metadataUri(id: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
  return `${base}/api/metadata/${id}`;
}
