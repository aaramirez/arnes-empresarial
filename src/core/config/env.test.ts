import { afterEach, describe, expect, it } from "vitest";
import { getAnthropicApiKey, MissingConfigError } from "./env.js";

describe("getAnthropicApiKey", () => {
  const original = process.env.ANTHROPIC_API_KEY;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = original;
    }
  });

  it("returns the value when the env var is set", () => {
    process.env.ANTHROPIC_API_KEY = "sk-test-123";

    expect(getAnthropicApiKey()).toBe("sk-test-123");
  });

  it("throws MissingConfigError when the env var is unset", () => {
    delete process.env.ANTHROPIC_API_KEY;

    expect(() => getAnthropicApiKey()).toThrow(MissingConfigError);
  });

  it("throws MissingConfigError when the env var is blank", () => {
    process.env.ANTHROPIC_API_KEY = "   ";

    expect(() => getAnthropicApiKey()).toThrow(MissingConfigError);
  });
});
