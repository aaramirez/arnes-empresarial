/**
 * Parses `NODE <label> [src=... loc=... community=...]` lines out of raw
 * `graphify query` stdout and accumulates the labels cited during a turn.
 *
 * Pure, no I/O (Hito 2, tarea 5): this module never touches the filesystem,
 * network, or a subprocess — it only transforms strings already produced by
 * `runGraphifyQuery` (see `graphify-cli.ts`). The core never sees a parsed
 * label; the only consumer is `--nodes` on `graphify save-result`
 * (design.md, section `cited-nodes.ts`).
 */

/**
 * Cap on how many distinct node labels a single turn can pass to
 * `graphify save-result --nodes`. Protects against Windows' ~32 KB hard
 * limit on total command-line length when a long answer plus many labels
 * would otherwise risk an intermittent `ENAMETOOLONG` (design.md §3.2).
 */
export const MAX_CITED_NODES = 20;

/** Matches a `NODE <label> [...]` line carrying a `src=/loc=/community=` metadata block. */
const NODE_WITH_METADATA_PATTERN = /^NODE\s+(.+?)\s+\[/;

/**
 * Fallback for a bare `NODE <label>` line with no (well-formed) metadata
 * block. The label itself is restricted to `[^[\]]` — never crossing into
 * either `[` or `]` — so a line like `"NODE Array[string]"` (no space before
 * `[`, so `NODE_WITH_METADATA_PATTERN` above does not match it) still yields
 * `Array` instead of swallowing `[string]` into the label. The trailing
 * optional `(?:\[.*)?` absorbs that leftover bracket content instead of
 * failing the whole match, while the plain "no bracket at all" case (the
 * common one) behaves exactly as before.
 *
 * Excluding only `[` from the character class (an earlier version of this
 * fix) left a hole: a line with a stray `]` and no preceding `[` (e.g.
 * `"NODE Foo]"`) would still match, capturing `"Foo]"` — a label containing
 * `]`. Excluding `]` too closes that hole: such a line no longer matches
 * this pattern at all (the class can't extend past the `]`, and the trailing
 * optional clause only ever starts with `\[`, never `]`), so it falls
 * through as ordinary non-`NODE` noise — the same documented behavior as any
 * other line that matches no `NODE` pattern.
 */
const NODE_WITHOUT_METADATA_PATTERN = /^NODE\s+([^[\]]+?)\s*(?:\[.*)?$/;

/**
 * Extracts the labels from `NODE <label> [src=... loc=... community=...]`
 * lines in raw `graphify query` stdout.
 *
 * - Lines with a metadata block match `NODE_WITH_METADATA_PATTERN`.
 * - Lines with a bare `NODE <label>` (no `[...]`) match the fallback
 *   `NODE_WITHOUT_METADATA_PATTERN`.
 * - Any other line (headers, truncation notices, stderr-looking noise) is
 *   ignored — it is not a cited node.
 * - Labels are deduplicated, preserving the order of first appearance.
 * - The result is cut at `MAX_CITED_NODES`.
 */
export function parseNodeLabels(stdout: string): readonly string[] {
  const labels: string[] = [];
  const seen = new Set<string>();

  for (const line of stdout.split("\n")) {
    const label =
      NODE_WITH_METADATA_PATTERN.exec(line)?.[1] ?? NODE_WITHOUT_METADATA_PATTERN.exec(line)?.[1];

    if (label === undefined || seen.has(label)) {
      continue;
    }

    seen.add(label);
    labels.push(label);

    if (labels.length >= MAX_CITED_NODES) {
      break;
    }
  }

  return labels;
}

/**
 * Per-turn accumulator of cited node labels. A turn can query the knowledge
 * base more than once (the model may call the tool several times); `record`
 * is meant to be called once per call, and `drain` once at turn close.
 */
export interface CitedNodesRecorder {
  /** Accumulates `labels`, deduplicating against everything recorded so far. */
  record(labels: readonly string[]): void;
  /**
   * Returns everything accumulated (deduplicated, cut at `MAX_CITED_NODES`
   * over the total) and clears the internal state. Idempotent: a second
   * call with no `record()` in between returns `[]`.
   */
  drain(): readonly string[];
}

/** Creates a fresh, empty `CitedNodesRecorder`. */
export function createCitedNodesRecorder(): CitedNodesRecorder {
  let accumulated: string[] = [];
  const seen = new Set<string>();

  return {
    record(labels) {
      for (const label of labels) {
        if (!seen.has(label)) {
          seen.add(label);
          accumulated.push(label);
        }
      }
    },
    drain() {
      const result = accumulated.slice(0, MAX_CITED_NODES);
      accumulated = [];
      seen.clear();
      return result;
    },
  };
}
