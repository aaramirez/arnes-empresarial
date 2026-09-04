import { describe, expect, it } from "vitest";
import { computeSignature, SIGNATURE_PREFIX, verifySignature } from "./signature.js";

const SECRET = "s3cr3t-webhook-secret";
const BODY = Buffer.from(JSON.stringify({ action: "opened", number: 42 }), "utf8");

describe("computeSignature", () => {
  it("prefixes the hex HMAC-SHA256 digest with SIGNATURE_PREFIX", () => {
    const signature = computeSignature(BODY, SECRET);

    expect(signature.startsWith(SIGNATURE_PREFIX)).toBe(true);
    expect(signature).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it("is deterministic for the same body and secret", () => {
    expect(computeSignature(BODY, SECRET)).toBe(computeSignature(BODY, SECRET));
  });
});

describe("verifySignature", () => {
  it("returns true when the signature was computed with the same secret", () => {
    const header = computeSignature(BODY, SECRET);

    expect(verifySignature(BODY, header, SECRET)).toBe(true);
  });

  it("returns false when the secret differs by a single byte", () => {
    const header = computeSignature(BODY, SECRET);
    const wrongSecret = SECRET.slice(0, -1) + (SECRET.at(-1) === "x" ? "y" : "x");

    expect(verifySignature(BODY, header, wrongSecret)).toBe(false);
  });

  it("returns false when the body differs by a single byte", () => {
    const header = computeSignature(BODY, SECRET);
    const tamperedBody = Buffer.from(BODY);
    tamperedBody[0] = (tamperedBody.at(0) ?? 0) ^ 0xff;

    expect(verifySignature(tamperedBody, header, SECRET)).toBe(false);
  });

  it("returns false when the header is absent (undefined)", () => {
    expect(verifySignature(BODY, undefined, SECRET)).toBe(false);
  });

  it("returns false when the header is an empty string", () => {
    expect(verifySignature(BODY, "", SECRET)).toBe(false);
  });

  it("returns false when the header arrives as an array", () => {
    const header = computeSignature(BODY, SECRET);

    expect(verifySignature(BODY, [header], SECRET)).toBe(false);
  });

  it("returns false and does not throw RangeError when the header has an unexpected length", () => {
    const shortHeader = "sha256=abcd";

    expect(() => verifySignature(BODY, shortHeader, SECRET)).not.toThrow();
    expect(verifySignature(BODY, shortHeader, SECRET)).toBe(false);
  });

  it("returns false and does not throw RangeError when the header is much longer than expected", () => {
    const longHeader = `sha256=${"a".repeat(200)}`;

    expect(() => verifySignature(BODY, longHeader, SECRET)).not.toThrow();
    expect(verifySignature(BODY, longHeader, SECRET)).toBe(false);
  });

  it("returns false when the sha256= prefix is missing, even with a valid hex digest", () => {
    const header = computeSignature(BODY, SECRET);
    const withoutPrefix = header.slice(SIGNATURE_PREFIX.length);

    expect(verifySignature(BODY, withoutPrefix, SECRET)).toBe(false);
  });
});
