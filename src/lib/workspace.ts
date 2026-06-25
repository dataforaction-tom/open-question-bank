import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import {
  workspace,
  DEFAULT_WORKSPACE_ID,
  DEFAULT_WORKSPACE_SLUG,
  type Workspace,
} from '@/db/schema'

export { DEFAULT_WORKSPACE_ID, DEFAULT_WORKSPACE_SLUG }

/**
 * Workspace scoping seam (improvement plan, Phase 1).
 *
 * Every top-level read/write resolves the active workspace through here, so the multi-tenancy
 * decision stays cheap: today there is exactly one (the default) workspace; later, this resolver
 * is the single place that learns to pick a workspace from a slug / session, and every query is
 * already scoped. No query should reach `question`, `campaign`, or `dataset_version` without a
 * workspace id from this module.
 */

// The active-workspace id is stable for the process (one workspace today, and the default id is a
// fixed constant), so caching it avoids a lookup on every scoped query. Cleared only in tests.
let cachedActiveId: string | null = null

/** Resolve the active workspace row. Throws if the default workspace was never seeded. */
export async function getActiveWorkspace(): Promise<Workspace> {
  const [row] = await db
    .select()
    .from(workspace)
    .where(eq(workspace.slug, DEFAULT_WORKSPACE_SLUG))
    .limit(1)
  if (!row) {
    throw new Error(
      `No "${DEFAULT_WORKSPACE_SLUG}" workspace found. Run "npm run db:migrate" then "npm run db:seed".`,
    )
  }
  return row
}

/** Resolve (and cache) the active workspace id — the value threaded through scoped queries. */
export async function getActiveWorkspaceId(): Promise<string> {
  if (cachedActiveId) return cachedActiveId
  const ws = await getActiveWorkspace()
  cachedActiveId = ws.id
  return ws.id
}

/** Idempotently ensure the default workspace exists; used by the seed script. */
export async function ensureDefaultWorkspace(): Promise<Workspace> {
  const [row] = await db
    .insert(workspace)
    .values({ id: DEFAULT_WORKSPACE_ID, slug: DEFAULT_WORKSPACE_SLUG, name: 'Default workspace' })
    .onConflictDoNothing()
    .returning()
  return row ?? (await getActiveWorkspace())
}

/** Test hook: forget the cached active-workspace id (the integration suite resets the DB). */
export function resetWorkspaceCache(): void {
  cachedActiveId = null
}
