import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  KNOWLEDGE_MCP_SERVER_NAME,
  KNOWLEDGE_TOOL_NAME,
  KNOWLEDGE_TOOL_QUALIFIED_NAME,
  type KnowledgeFeedbackPort,
} from "./knowledge-contract.js";

describe("knowledge-contract constants", () => {
  it("names the MCP server 'knowledge'", () => {
    expect(KNOWLEDGE_MCP_SERVER_NAME).toBe("knowledge");
  });

  it("names the tool 'query_knowledge_base'", () => {
    expect(KNOWLEDGE_TOOL_NAME).toBe("query_knowledge_base");
  });

  it("qualifies the tool name as 'mcp__knowledge__query_knowledge_base'", () => {
    expect(KNOWLEDGE_TOOL_QUALIFIED_NAME).toBe("mcp__knowledge__query_knowledge_base");
  });
});

describe("KnowledgeFeedbackPort", () => {
  it("is satisfied by an object implementing saveTurnResult(input): Promise<void>", async () => {
    const port: KnowledgeFeedbackPort = {
      async saveTurnResult(input) {
        expect(input.casoId).toBe("caso-1");
        expect(input.question).toBe("¿cuál es la política?");
        expect(input.answer).toBe("la respuesta");
      },
      discardPendingCitations() {},
    };

    await expect(
      port.saveTurnResult({
        casoId: "caso-1",
        question: "¿cuál es la política?",
        answer: "la respuesta",
      }),
    ).resolves.toBeUndefined();
  });

  it("is satisfied by an object implementing discardPendingCitations(): void", () => {
    let discarded = false;
    const port: KnowledgeFeedbackPort = {
      async saveTurnResult() {},
      discardPendingCitations() {
        discarded = true;
      },
    };

    port.discardPendingCitations();

    expect(discarded).toBe(true);
  });
});

describe("knowledge-contract.ts source", () => {
  it("has no import statements — the core module must not import SDK, Node, or adapters", () => {
    const sourcePath = fileURLToPath(new URL("./knowledge-contract.ts", import.meta.url));
    const source = readFileSync(sourcePath, "utf-8");

    expect(source).not.toMatch(/\bimport\b/);
  });
});
