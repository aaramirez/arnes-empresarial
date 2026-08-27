import { config as loadDotenv } from "dotenv";

/**
 * Single loading point for environment configuration.
 *
 * Populates `process.env` from a local `.env` file (if present) as a
 * side effect of importing this module. Existing `process.env` values are
 * never overwritten (dotenv's default behavior), so real shell/CI env vars
 * always win over `.env`.
 *
 * CRITICAL ORDERING CONSTRAINT: this module must be the FIRST import in the
 * application entrypoint, before anything that transitively imports
 * `@anthropic-ai/claude-agent-sdk`. The SDK does not read `.env` on its own
 * and reads `process.env.ANTHROPIC_API_KEY` as soon as it is loaded — if the
 * SDK module is evaluated first, setting the variable afterwards has no
 * effect on it.
 */
loadDotenv();

export class MissingConfigError extends Error {
  constructor(variable: string) {
    super(`Missing required environment variable: ${variable}`);
    this.name = "MissingConfigError";
  }
}

/**
 * Returns the Anthropic API key, validated to be present and non-blank.
 * Throws MissingConfigError otherwise.
 */
export function getAnthropicApiKey(): string {
  const value = process.env.ANTHROPIC_API_KEY;
  if (!value || value.trim() === "") {
    throw new MissingConfigError("ANTHROPIC_API_KEY");
  }
  return value;
}
