/**
 * Product banner for the TUI adapter (I1) — post-Hito 1.0 polish.
 *
 * Renders "Light" — the harness's user-facing product name inside this
 * adapter (see this task's spec for why: it is a TUI-only branding label,
 * not a rename of the `arnes-empresarial` npm package or repo) — as large
 * ASCII art via `figlet`, plus a one-line tagline underneath. Shown once, at
 * the top of `App`'s render tree, not per turn.
 *
 * `figlet.textSync` is synchronous (uses figlet's bundled fonts, no async
 * font loading), so this component needs no loading state. It is computed
 * once at module load, into `ASCII_ART_LINES` below, not inside the
 * component body: `Banner` takes no props, so nothing it depends on ever
 * changes between renders, but `App` re-renders on every keystroke/submit/
 * settle — computing it in the component body would rerun `figlet.textSync`
 * on every one of those re-renders instead of just the first mount.
 *
 * The ASCII art is split on `\n` and rendered as one `<Text>` per line
 * inside a `flexDirection="column"` `Box`, instead of a single `<Text>`
 * containing embedded newlines — the more reliable pattern in Ink, whose
 * `<Text>` is not guaranteed to preserve embedded line breaks the same way
 * across every terminal/renderer combination that multiple sibling `<Text>`
 * elements are.
 */

import { Box, Text } from "ink";
import figlet from "figlet";
import type { ReactElement } from "react";

const TAGLINE = "arnés empresarial de IA";
const ASCII_ART_LINES = figlet.textSync("Light", { font: "Standard" }).split("\n");

// Exported so `App.tsx` can size a bottom-padding spacer around the banner
// without importing `figlet` itself or duplicating this computation — see
// `App.tsx`'s "pad up to the terminal height" module doc note.
export const BANNER_LINE_COUNT = ASCII_ART_LINES.length + 1;

export function Banner(): ReactElement {
  return (
    <Box flexDirection="column">
      {ASCII_ART_LINES.map((line, index) => (
        // eslint-disable-next-line react/no-array-index-key -- figlet output
        // lines have no stable identity of their own, and the line order
        // never changes after this synchronous render.
        <Text key={index}>{line}</Text>
      ))}
      <Text dimColor>{TAGLINE}</Text>
    </Box>
  );
}
