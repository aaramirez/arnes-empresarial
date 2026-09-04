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
 *
 * Variables recognized by this loading point (populated into `process.env`,
 * with no name registration required for dotenv itself to pick them up):
 * `ANTHROPIC_API_KEY` (read by `getAnthropicApiKey` below), plus the
 * `GRAPHIFY_*` variables consumed by `adapters/knowledge/config.ts`.
 *
 * `GITHUB_WEBHOOK_SECRET`, `GITHUB_TOKEN`, `WEBHOOK_PORT`, `WEBHOOK_PATH`,
 * `WEBHOOK_MAX_BODY_BYTES`, `GITHUB_API_BASE_URL`, and `BOARD_TIMEOUT_MS`
 * are also read from `process.env` after this module is imported. Their
 * parsing, validation, and defaults live in `resolveWebhookConfig`
 * (`adapters/webhooks/config.ts`) and `resolveBoardConfig`
 * (`adapters/board/config.ts`), not here — this module only guarantees
 * `.env` has been loaded before those adapters read `process.env` directly.
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
