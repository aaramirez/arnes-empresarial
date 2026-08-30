import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import { Banner } from "./Banner.js";

describe("Banner", () => {
  it("renders a multi-line ASCII art banner with the tagline below it", () => {
    const { lastFrame } = render(<Banner />);

    const frame = lastFrame() ?? "";

    // The figlet-rendered "Light" ASCII art itself is not asserted glyph by
    // glyph (fragile across figlet versions/fonts) — just that whatever it
    // rendered spans more than a single line, i.e. it is actually banner-shaped
    // ASCII art and not a plain one-line string.
    expect(frame.split("\n").length).toBeGreaterThan(1);
    expect(frame).toContain("arnés empresarial de IA");
  });
});
