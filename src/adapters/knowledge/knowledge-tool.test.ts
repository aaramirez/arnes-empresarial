import { describe, expect, it, vi } from "vitest";
import type { GraphifyConfig } from "./config.js";
import { GraphifyCliError, type GraphifyFailureReason } from "./graphify-cli.js";
import { createCitedNodesRecorder, parseNodeLabels } from "./cited-nodes.js";
import { handleKnowledgeQuery, type KnowledgeToolDeps } from "./knowledge-tool.js";

function makeConfig(overrides: Partial<GraphifyConfig> = {}): GraphifyConfig {
  return {
    bin: "graphify",
    graphPath: "graphify-out/graph.json",
    budget: 200,
    queryTimeoutMs: 15_000,
    ...overrides,
  };
}

function makeDeps(overrides: Partial<KnowledgeToolDeps> = {}): KnowledgeToolDeps {
  return {
    casoId: "caso-1",
    config: makeConfig(),
    recorder: createCitedNodesRecorder(),
    runQuery: vi.fn(),
    logEvent: vi.fn(),
    ...overrides,
  };
}

const STDOUT_WITH_RESULTS = [
  "Traversal: BFS depth=1 | Start: ['Vacaciones'] | 2 nodes found",
  "",
  "NODE Política de Vacaciones [src=docs/politicas.md loc=L10 community=1]",
  "NODE Manual del Empleado [src=docs/manual.md loc=L20 community=1]",
].join("\n");

const STDOUT_WITHOUT_RESULTS = "Traversal: BFS depth=1 | Start: ['Nada'] | 0 nodes found";

describe("handleKnowledgeQuery — rama con resultados", () => {
  it("returns the cite instruction followed by the raw stdout, untouched", async () => {
    const runQuery = vi.fn().mockResolvedValue(STDOUT_WITH_RESULTS);
    const deps = makeDeps({ runQuery });

    const result = await handleKnowledgeQuery("¿Cuál es la política de vacaciones?", deps);

    expect(result.content).toHaveLength(1);
    const text = result.content[0].text;
    expect(text).toContain(
      "INSTRUCCIÓN: respondé usando solo estos resultados del vault y CITÁ la fuente (src, y loc cuando exista) de cada dato que uses. Si no alcanzan para responder, decilo.",
    );
    expect(text).toContain(STDOUT_WITH_RESULTS);
    expect(text).toBe(
      "INSTRUCCIÓN: respondé usando solo estos resultados del vault y CITÁ la fuente (src, y loc cuando exista) de cada dato que uses. Si no alcanzan para responder, decilo.\n\n" +
        STDOUT_WITH_RESULTS,
    );
  });

  it("records the parsed labels into the recorder", async () => {
    const runQuery = vi.fn().mockResolvedValue(STDOUT_WITH_RESULTS);
    const recorder = createCitedNodesRecorder();
    const deps = makeDeps({ runQuery, recorder });

    await handleKnowledgeQuery("pregunta", deps);

    expect(recorder.drain()).toEqual(parseNodeLabels(STDOUT_WITH_RESULTS));
  });

  it("logs conocimiento-consulta-inicio with questionLength and conocimiento-consulta-ok with durationMs/nodes", async () => {
    const runQuery = vi.fn().mockResolvedValue(STDOUT_WITH_RESULTS);
    const logEvent = vi.fn();
    const deps = makeDeps({ runQuery, logEvent });
    const question = "¿Cuál es la política de vacaciones?";

    await handleKnowledgeQuery(question, deps);

    expect(logEvent).toHaveBeenCalledWith("conocimiento-consulta-inicio", {
      questionLength: question.length,
    });

    const okCall = logEvent.mock.calls.find((call) => call[0] === "conocimiento-consulta-ok");
    expect(okCall).toBeDefined();
    const fields = okCall![1] as { durationMs: number; nodes: number };
    expect(typeof fields.durationMs).toBe("number");
    expect(fields.nodes).toBe(parseNodeLabels(STDOUT_WITH_RESULTS).length);
  });
});

describe("handleKnowledgeQuery — rama vacía", () => {
  it("returns the exact SIN RESULTADOS text when there are zero NODE lines", async () => {
    const runQuery = vi.fn().mockResolvedValue(STDOUT_WITHOUT_RESULTS);
    const deps = makeDeps({ runQuery });

    const result = await handleKnowledgeQuery("pregunta sin match", deps);

    expect(result.content[0].text).toBe(
      "SIN RESULTADOS: la base de conocimiento no devolvió coincidencias. Decíselo al empleado en vez de inventar una respuesta.",
    );
  });

  it("does not call recorder.record", async () => {
    const runQuery = vi.fn().mockResolvedValue(STDOUT_WITHOUT_RESULTS);
    const record = vi.fn();
    const recorder = { record, drain: vi.fn().mockReturnValue([]) };
    const deps = makeDeps({ runQuery, recorder });

    await handleKnowledgeQuery("pregunta sin match", deps);

    expect(record).not.toHaveBeenCalled();
  });

  it("logs conocimiento-consulta-vacia with durationMs", async () => {
    const runQuery = vi.fn().mockResolvedValue(STDOUT_WITHOUT_RESULTS);
    const logEvent = vi.fn();
    const deps = makeDeps({ runQuery, logEvent });

    await handleKnowledgeQuery("pregunta sin match", deps);

    const emptyCall = logEvent.mock.calls.find((call) => call[0] === "conocimiento-consulta-vacia");
    expect(emptyCall).toBeDefined();
    const fields = emptyCall![1] as { durationMs: number };
    expect(typeof fields.durationMs).toBe("number");
  });
});

describe("handleKnowledgeQuery — rama degradada", () => {
  it.each([
    ["not-found", "el binario de consulta no está disponible"],
    ["timeout", "la consulta tardó demasiado"],
    ["exit-code", "la consulta falló"],
    ["unknown", "error desconocido"],
  ] as const)(
    "reason=%s produces a NO HAY CONOCIMIENTO DISPONIBLE text with a readable motivo and logs the exact reason",
    async (reason: GraphifyFailureReason, expectedMotivo: string) => {
      const error = new GraphifyCliError(reason, "query", { some: "raw error" });
      const runQuery = vi.fn().mockRejectedValue(error);
      const logEvent = vi.fn();
      const deps = makeDeps({ runQuery, logEvent });

      const result = await handleKnowledgeQuery("pregunta", deps);

      expect(result.content[0].text).toBe(
        `NO HAY CONOCIMIENTO DISPONIBLE: ${expectedMotivo}. Respondé con lo que tengas de la conversación y aclará explícitamente que no pudiste consultar la base de conocimiento.`,
      );

      const errorCall = logEvent.mock.calls.find((call) => call[0] === "conocimiento-consulta-error");
      expect(errorCall).toBeDefined();
      const fields = errorCall![1] as { reason: string; durationMs: number };
      expect(fields.reason).toBe(reason);
      expect(typeof fields.durationMs).toBe("number");
    },
  );

  it("treats a rejection that is not a GraphifyCliError as reason unknown", async () => {
    const runQuery = vi.fn().mockRejectedValue(new Error("boom"));
    const logEvent = vi.fn();
    const deps = makeDeps({ runQuery, logEvent });

    const result = await handleKnowledgeQuery("pregunta", deps);

    expect(result.content[0].text).toBe(
      "NO HAY CONOCIMIENTO DISPONIBLE: error desconocido. Respondé con lo que tengas de la conversación y aclará explícitamente que no pudiste consultar la base de conocimiento.",
    );
    const errorCall = logEvent.mock.calls.find((call) => call[0] === "conocimiento-consulta-error");
    expect(errorCall![1]).toMatchObject({ reason: "unknown" });
  });

  it("never rejects, even when runQuery throws synchronously instead of returning a rejected promise", async () => {
    const runQuery = vi.fn(() => {
      throw new GraphifyCliError("timeout", "query", { killed: true });
    }) as unknown as KnowledgeToolDeps["runQuery"];
    const deps = makeDeps({ runQuery });

    await expect(handleKnowledgeQuery("pregunta", deps)).resolves.toEqual({
      content: [
        {
          type: "text",
          text:
            "NO HAY CONOCIMIENTO DISPONIBLE: la consulta tardó demasiado. Respondé con lo que tengas de la conversación y aclará explícitamente que no pudiste consultar la base de conocimiento.",
        },
      ],
    });
  });

  it("never rejects on a synchronous throw that is not a GraphifyCliError either", async () => {
    const runQuery = vi.fn(() => {
      throw new Error("unexpected synchronous failure");
    }) as unknown as KnowledgeToolDeps["runQuery"];
    const deps = makeDeps({ runQuery });

    await expect(handleKnowledgeQuery("pregunta", deps)).resolves.toMatchObject({
      content: [{ type: "text", text: expect.stringContaining("NO HAY CONOCIMIENTO DISPONIBLE") }],
    });
  });
});
