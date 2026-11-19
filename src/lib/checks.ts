import { item } from '@/lib/related';
import { call, graphql, type Env, type SdkClient } from '@/lib/sdk';
import type { DataTree } from '@/lib/transfer';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** A language the source has and the target lacks. */
export type MissingLanguage = {
  /** The language's name, as `fr-FR` or `da`. */
  code: string;
  /** What the notes call it: `French (fr-FR)`. */
  label: string;
  /** What `xmc.sites.createLanguage` takes to add it on the target. */
  body: { languageCode: string; regionCode?: string };
};

type Language = { name?: string | null; iso?: string | null; englishName?: string | null };

const codeOf = (l: Language) => l.name || l.iso || '';

// An empty list means the call told us nothing (every environment has at least its default language), not that
// there are no languages: saying "the target lacks them all" would be wrong.
async function languagesIn(client: SdkClient, env: Env): Promise<Language[]> {
  const { data } = await call<Language[]>(client, env, 'query', 'xmc.sites.listLanguages', {});
  const list = (Array.isArray(data) ? data : []).filter(codeOf);
  if (!list.length) throw new Error(`${env.name} listed no languages.`);
  return list;
}

/**
 * The languages the source has and the target lacks. The Content Transfer API has no language options, so versions in
 * those languages may not show on the target. This compares the environments, not the items.
 * ponytail: a per-item check (does a queued item have versions in a language the target lacks?) would cut noise once the
 * authoring API's per-language version query is verified; until then every language gap is reported.
 */
export async function scanLanguages(client: SdkClient, source: Env, target: Env): Promise<MissingLanguage[]> {
  const [mine, theirs] = await Promise.all([languagesIn(client, source), languagesIn(client, target)]);
  const has = new Set(theirs.map((l) => codeOf(l).toLowerCase()));
  return mine
    .filter((l) => !has.has(codeOf(l).toLowerCase()))
    .map((l) => {
      const code = codeOf(l);
      const [language, ...region] = code.split('-');
      // English name without its region ("French (France)" → "French"): the code already says which.
      const label = `${l.englishName?.replace(/\s*\(.*$/, '') || language} (${code})`;
      // ponytail: adds the language and region only. A custom region code (en-EU), fallback and spell checker aren't copied.
      return { code, label, body: { languageCode: l.iso || language, ...(region.length ? { regionCode: region.join('-') } : {}) } };
    });
}

/** A language that couldn't be added, and why. */
export type LanguageFailure = { label: string; error: string };

/** Adds the languages on the target one by one (`onProgress(n)` runs after the nth), and says which ones failed. */
export async function addLanguages(
  client: SdkClient,
  target: Env,
  languages: MissingLanguage[],
  onProgress?: (done: number) => void,
): Promise<LanguageFailure[]> {
  const failed: LanguageFailure[] = [];
  for (const [i, l] of languages.entries()) {
    try {
      await call(client, target, 'mutate', 'xmc.sites.createLanguage', { body: l.body });
    } catch (e) {
      failed.push({ label: l.label, error: message(e) });
    }
    onProgress?.(i + 1);
  }
  return failed;
}

/** A queued item that is locked on the target. */
export type LockedItem = { itemPath: string; lockedBy?: string };

/**
 * The queued items that are locked on the target, among the rows that overwrite (a "Keep what's there" row leaves a
 * locked item alone). One query. Reads the queued items only.
 * ponytail: the items below a "+ Everything below" row aren't read, so a locked descendant goes unreported.
 */
export async function scanLocks(client: SdkClient, target: Env, trees: DataTree[]): Promise<LockedItem[]> {
  const rows = trees.filter((t) => t.mergeStrategy !== 'KeepExistingItem');
  if (!rows.length) return [];
  const read = (await graphql(client, target, `query LocksOnTarget {\n${rows.map((t, i) => item(`i${i}`, 'path', t.itemPath, 'lock { isLocked lockedBy }')).join('\n')}\n}`, {})) ?? {};
  return rows.flatMap((t, i) => {
    const lock = read[`i${i}`]?.lock;
    return lock?.isLocked ? [{ itemPath: t.itemPath, lockedBy: lock.lockedBy || undefined }] : [];
  });
}

/** A queued item that sits in a workflow state that isn't final, on the source. */
export type UnapprovedItem = { itemPath: string; state: string };

/**
 * The queued items in a workflow state that isn't final on the source (an item with no workflow isn't listed). One query.
 * Reads the queued items only, in the default language and latest version.
 */
export async function scanWorkflow(client: SdkClient, source: Env, trees: DataTree[]): Promise<UnapprovedItem[]> {
  if (!trees.length) return [];
  const read = (await graphql(client, source, `query WorkflowOnSource {\n${trees.map((t, i) => item(`i${i}`, 'path', t.itemPath, 'workflow { workflowState { displayName final } }')).join('\n')}\n}`, {})) ?? {};
  return trees.flatMap((t, i) => {
    const state = read[`i${i}`]?.workflow?.workflowState;
    return state?.final === false ? [{ itemPath: t.itemPath, state: state.displayName || 'a non-final state' }] : [];
  });
}
