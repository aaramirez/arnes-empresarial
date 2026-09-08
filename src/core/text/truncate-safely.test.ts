import { describe, expect, it } from "vitest";
import { truncateHead, truncateTail } from "./truncate-safely.js";

describe("truncateHead", () => {
  it("returns text unchanged when it fits within maxChars", () => {
    expect(truncateHead("abc", 10)).toBe("abc");
  });

  it("cuts a plain-ASCII string at exactly maxChars", () => {
    expect(truncateHead("abcdefgh", 4)).toBe("abcd");
  });

  it("backs off one position instead of splitting a surrogate pair at the cut boundary", () => {
    // "😀" is a single emoji (a surrogate pair, 2 UTF-16 code units).
    const emoji = "😀";
    const text = "ab" + emoji + "cd"; // length 6: a b [hi lo] c d
    // Cutting at maxChars=3 would land right after the high surrogate,
    // orphaning it — the cut must back off to 2 instead.
    expect(truncateHead(text, 3)).toBe("ab");
  });

  it("keeps a full surrogate pair when the cut boundary falls after it", () => {
    const emoji = "😀";
    const text = "ab" + emoji + "cd";
    expect(truncateHead(text, 4)).toBe("ab" + emoji);
  });
});

describe("truncateTail", () => {
  it("returns text unchanged when it fits within maxChars", () => {
    expect(truncateTail("abc", 10)).toBe("abc");
  });

  it("keeps the last maxChars code units of a plain-ASCII string", () => {
    expect(truncateTail("abcdefgh", 4)).toBe("efgh");
  });

  it("advances the cut instead of splitting a surrogate pair at the start boundary", () => {
    const emoji = "😀";
    const text = "ab" + emoji + "cd"; // length 6: a b [hi lo] c d
    // Keeping the last 3 chars would start right at the low surrogate,
    // orphaning it — the cut must advance to drop the whole pair.
    expect(truncateTail(text, 3)).toBe("cd");
  });

  it("keeps a full surrogate pair when the cut boundary falls before it", () => {
    const emoji = "😀";
    const text = "ab" + emoji + "cd";
    expect(truncateTail(text, 4)).toBe(emoji + "cd");
  });
});
