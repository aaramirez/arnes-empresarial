const HIGH_SURROGATE_START = 0xd800;
const HIGH_SURROGATE_END = 0xdbff;
const LOW_SURROGATE_START = 0xdc00;
const LOW_SURROGATE_END = 0xdfff;

/**
 * Truncates `text` to at most `maxChars` UTF-16 code units, the same way a
 * plain `text.slice(0, maxChars)` would — except it never splits a surrogate
 * pair (an emoji or any other character from a supplementary Unicode plane)
 * in half. A plain `slice` cuts by code unit count, so a cut that happens to
 * land exactly between a pair's high and low surrogate keeps the lone high
 * surrogate, corrupting the string. When the code unit right at the cut
 * boundary is a high surrogate, the cut backs off one position so that
 * dangling surrogate is dropped along with the rest of its pair.
 *
 * Keeps the HEAD of `text`. For keeping the TAIL instead, see
 * `truncateTail` below.
 *
 * Extracted from two identical private helpers (Reviewer finding, reuse):
 * `src/adapters/board/index.ts` and `src/adapters/knowledge/index.ts`.
 */
export function truncateHead(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  const boundaryCharCode = text.charCodeAt(maxChars - 1);
  const cutAt =
    boundaryCharCode >= HIGH_SURROGATE_START && boundaryCharCode <= HIGH_SURROGATE_END
      ? maxChars - 1
      : maxChars;
  return text.slice(0, cutAt);
}

/**
 * Mirror image of `truncateHead`: keeps the last `maxChars` UTF-16 code
 * units of `text` instead of the first. Here the surrogate-pair risk is at
 * the START of the kept slice — cutting right before a LOW surrogate would
 * leave it orphaned from its HIGH half, which precedes the cut. When that
 * happens, the cut point advances by one so the dangling surrogate is
 * dropped along with the rest of its pair.
 *
 * Extracted from `src/adapters/test-runner/test-runner-tool.ts`'s
 * `truncarConservandoCola` (Reviewer finding, reuse), which layers a
 * truncation-marker prefix and its own budget accounting on top of this raw
 * slicing — kept local to that module rather than folded in here, since
 * that behavior is specific to that one caller.
 */
export function truncateTail(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  let start = text.length - maxChars;
  const boundaryCharCode = text.charCodeAt(start);
  if (boundaryCharCode >= LOW_SURROGATE_START && boundaryCharCode <= LOW_SURROGATE_END) {
    start += 1;
  }
  return text.slice(start);
}
