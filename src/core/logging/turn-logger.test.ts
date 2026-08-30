import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFileLogWriter, logTurnEvent } from "./turn-logger.js";

describe("logTurnEvent", () => {
  it("writes a JSON line with casoId, event, the injected timestamp, and the extra fields", () => {
    const write = vi.fn();

    logTurnEvent(
      "caso-1",
      "turno-iniciado",
      { agentId: "agente-conversacional" },
      { now: () => "2026-08-28T00:00:00.000Z", write },
    );

    expect(write).toHaveBeenCalledTimes(1);
    const line = write.mock.calls[0]?.[0] as string;
    expect(JSON.parse(line)).toEqual({
      timestamp: "2026-08-28T00:00:00.000Z",
      casoId: "caso-1",
      event: "turno-iniciado",
      agentId: "agente-conversacional",
    });
  });

  it("writes casoId/event/timestamp without extra fields when fields is omitted", () => {
    const write = vi.fn();

    logTurnEvent("caso-1", "turno-iniciado", undefined, {
      now: () => "2026-08-28T00:00:00.000Z",
      write,
    });

    const line = write.mock.calls[0]?.[0] as string;
    expect(JSON.parse(line)).toEqual({
      timestamp: "2026-08-28T00:00:00.000Z",
      casoId: "caso-1",
      event: "turno-iniciado",
    });
  });

  it("keeps the positional casoId when fields includes a different casoId key", () => {
    const write = vi.fn();

    logTurnEvent(
      "caso-1",
      "turno-iniciado",
      { casoId: "caso-suplantado" },
      { now: () => "2026-08-28T00:00:00.000Z", write },
    );

    const line = write.mock.calls[0]?.[0] as string;
    expect(JSON.parse(line)).toEqual({
      timestamp: "2026-08-28T00:00:00.000Z",
      casoId: "caso-1",
      event: "turno-iniciado",
    });
  });

  it("keeps the injected now() timestamp when fields includes a different timestamp key", () => {
    const write = vi.fn();

    logTurnEvent(
      "caso-1",
      "turno-iniciado",
      { timestamp: "2000-01-01T00:00:00.000Z" },
      { now: () => "2026-08-28T00:00:00.000Z", write },
    );

    const line = write.mock.calls[0]?.[0] as string;
    expect(JSON.parse(line)).toEqual({
      timestamp: "2026-08-28T00:00:00.000Z",
      casoId: "caso-1",
      event: "turno-iniciado",
    });
  });

  describe("default deps", () => {
    // logTurnEvent with no `deps` argument still needs to produce a real,
    // parseable line — but it must not touch this repo's real
    // data/harness.log, so this test injects `write: vi.fn()` instead of
    // relying on DEFAULT_LOG_TURN_EVENT_DEPS's real file writer. The real
    // file writer itself (createFileLogWriter) is exercised for real below.
    it("writes a parseable JSON line with the expected casoId when fields/deps are omitted", () => {
      const write = vi.fn();

      logTurnEvent("caso-1", "turno-iniciado", undefined, {
        now: () => "2026-08-28T00:00:00.000Z",
        write,
      });

      expect(write).toHaveBeenCalledTimes(1);
      const line = write.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(line) as Record<string, unknown>;
      expect(parsed).toMatchObject({ casoId: "caso-1", event: "turno-iniciado" });
    });
  });
});

describe("createFileLogWriter", () => {
  // Real filesystem, same pattern src/adapters/memory/db.test.ts already
  // uses with mkdtempSync — never touches this repo's own data/ directory.
  let tempDir: string | undefined;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("creates missing parent directories and appends the line plus a trailing newline", () => {
    tempDir = mkdtempSync(join(tmpdir(), "harness-log-test-"));
    const filePath = join(tempDir, "nested", "sub", "harness.log");
    const write = createFileLogWriter(filePath);

    write('{"event":"a"}');
    write('{"event":"b"}');

    expect(readFileSync(filePath, "utf8")).toBe('{"event":"a"}\n{"event":"b"}\n');
  });

  it("swallows a write failure instead of throwing (a logging failure must never break a real turn)", () => {
    tempDir = mkdtempSync(join(tmpdir(), "harness-log-test-"));
    // A parent path segment that is a real FILE, not a directory, makes
    // mkdirSync(dirname(filePath)) throw ENOTDIR — a reliable, portable way
    // to force createFileLogWriter's write to fail.
    const blockerFile = join(tempDir, "blocker");
    writeFileSync(blockerFile, "not a directory");
    const filePath = join(blockerFile, "sub", "harness.log");
    const write = createFileLogWriter(filePath);

    expect(() => write('{"event":"a"}')).not.toThrow();
  });
});
