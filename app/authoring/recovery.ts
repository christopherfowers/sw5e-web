/**
 * The copy of the author's work that survives everything else.
 *
 * Somebody is going to paste four paragraphs out of a Discord thread into this
 * editor. Between that moment and the moment the service has the text, there
 * are half a dozen ways to lose it that have nothing to do with them: a closed
 * tab, a reload, a phone call and a battery, a session that expired while the
 * text was being typed, a service that is briefly unreachable. None of those is
 * an error the interface can report, because in every one of them there is no
 * interface left to report it.
 *
 * So the editor writes what is in it to `localStorage` as it goes, and reads it
 * back on the way in. That is the whole of this module.
 *
 * ## What it is not
 *
 * It is not a draft. The service owns drafts; they are shared, they are
 * reviewed, and they are what publishing works from. This is a private safety
 * net in one browser, and it is deliberately kept in a different place with a
 * different name so that nobody reads it as the second half of a
 * synchronisation scheme. When the two disagree, the editor asks — it never
 * silently prefers one, because "silently preferred the wrong one" is the exact
 * failure this exists to prevent.
 *
 * ## What it holds, and why that is acceptable
 *
 * Game rules text, on the machine of the person who typed it, in a store
 * readable only by this origin. It is the same material that is about to be
 * published to the public reference, so the risk of keeping it is small and the
 * cost of not keeping it is somebody's evening. It is cleared as soon as it is
 * no longer needed — on publish, and on discarding the draft — and entries older
 * than a fortnight are swept on the next write so a browser does not accumulate
 * them forever.
 *
 * ## Every operation can fail, and none of them may throw
 *
 * `localStorage` throws when the quota is full, and reading it throws outright
 * in a browser configured to block storage. An editor that could not open
 * because its safety net was unavailable would be a safety net that caused the
 * accident, so every call here is wrapped and answers as though there were
 * simply nothing stored.
 */

const PREFIX = "sw5e.authoring.recovery.";

/** Swept on write. Long enough to survive a weekend and an illness. */
const KEEP_FOR_MS = 14 * 24 * 60 * 60 * 1000;

export interface RecoveredWork {
  document: unknown;
  /** ISO-8601, so the editor can say how old the recovered copy is. */
  savedAt: string;
}

/**
 * The storage key for one document.
 *
 * A new document has no key yet, and its recovery entry is keyed by the type
 * alone. That means two unsaved new species share a slot, which is a real
 * limitation and the right trade: the alternative is an entry per tab that
 * nothing ever cleans up, and starting a second new species while a first is
 * unfinished is not a thing that happens in the middle of correcting a typo.
 */
export function recoveryKey(type: string, key: string): string {
  return `${PREFIX}${type}/${key}`;
}

/**
 * The store, or `null` where there is not one.
 *
 * Absent during the prerender, where there is no `window` at all — every module
 * in this app is imported by the build, and one that touched `localStorage` at
 * module scope would fail the build rather than the browser.
 */
function store(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Drops entries nobody is coming back for.
 *
 * Run on write rather than on a timer, because a timer would be a background
 * task in a tab whose only job is a form, and this costs one pass over a store
 * that holds a handful of keys.
 */
function sweep(storage: Storage, now: number): void {
  const doomed: string[] = [];

  for (let index = 0; index < storage.length; index += 1) {
    const name = storage.key(index);
    if (!name?.startsWith(PREFIX)) continue;

    try {
      const held = JSON.parse(storage.getItem(name) ?? "null") as RecoveredWork | null;
      const savedAt = held ? Date.parse(held.savedAt) : Number.NaN;
      // An entry with no readable timestamp is swept too: it is either corrupt
      // or written by a version of this code that no longer exists, and either
      // way it cannot be offered to anybody.
      if (Number.isNaN(savedAt) || now - savedAt > KEEP_FOR_MS) doomed.push(name);
    } catch {
      doomed.push(name);
    }
  }

  for (const name of doomed) {
    try {
      storage.removeItem(name);
    } catch {
      // Nothing useful to do. The entry stays and is swept again next time.
    }
  }
}

/** Keeps a copy of what is in the editor. Silently does nothing if it cannot. */
export function keepRecovery(type: string, key: string, document: unknown): void {
  const storage = store();
  if (!storage) return;

  const now = Date.now();
  sweep(storage, now);

  try {
    storage.setItem(
      recoveryKey(type, key),
      JSON.stringify({ document, savedAt: new Date(now).toISOString() }),
    );
  } catch {
    // Out of quota, or storage refused. The editor carries on; the copy on the
    // service is still the one that matters, and a failure to keep a spare must
    // never look like a failure to save.
  }
}

/** What was being typed here last time, or `null`. */
export function readRecovery(type: string, key: string): RecoveredWork | null {
  const storage = store();
  if (!storage) return null;

  try {
    const raw = storage.getItem(recoveryKey(type, key));
    if (!raw) return null;

    const held = JSON.parse(raw) as Partial<RecoveredWork> | null;
    if (!held || typeof held.savedAt !== "string") return null;
    if (!("document" in held)) return null;

    return { document: held.document, savedAt: held.savedAt };
  } catch {
    return null;
  }
}

/** Forgets the copy. Called once the work is somewhere that outlives this browser. */
export function forgetRecovery(type: string, key: string): void {
  const storage = store();
  if (!storage) return;

  try {
    storage.removeItem(recoveryKey(type, key));
  } catch {
    // See above: this is a spare copy, and failing to drop it is not a failure.
  }
}
