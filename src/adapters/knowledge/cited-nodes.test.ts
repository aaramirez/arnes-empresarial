import { describe, expect, it } from "vitest";
import { createCitedNodesRecorder, MAX_CITED_NODES, parseNodeLabels } from "./cited-nodes.js";

/**
 * Fixture real, capturado en vivo contra este repo (Paso 0, Hito 2 tarea 5).
 *
 * Comando: `graphify query "adaptador de conocimiento" --graph graphify-out/graph.json --budget 200`
 * Fecha de captura: 2026-08-31.
 *
 * Es el stdout literal (sin editar salvo el recorte por budget que el propio
 * comando ya aplica) — confirma el formato `NODE <label> [src=... loc=...
 * community=...]` documentado en exploration.md líneas 13-17 y design.md
 * (sección `cited-nodes.ts`). Incluye además una línea de encabezado y una
 * línea de truncado, ninguna de las cuales empieza con `NODE`: sirven también
 * para el caso "ruido de stdout ignorado".
 */
const REAL_GRAPHIFY_QUERY_STDOUT = `Traversal: BFS depth=2 | Start: ['Adaptador de Conocimiento', 'Adaptador A2A', 'Adaptador TUI'] | 31 nodes found

NODE Hito 1: Esqueleto conversacional [src=docs/Plan_Implementacion_Harness_Empresarial.md loc=L75 community=2]
NODE Hitos [src=docs/Plan_Implementacion_Harness_Empresarial.md loc=L73 community=2]
NODE Escenario de ejecución 1: Turno conversacional básico [src=docs/ARC42_Harness_Empresarial.md loc=L374 community=2]
NODE Ensamblador de Contexto (1.2) [src=docs/ARC42_Harness_Empresarial.md loc=None community=2]
NODE Adaptador A2A [src=docs/ARC42_Harness_Empresarial.md loc=None community=2]
NODE Adaptador de Memoria Compartida [src=docs/ARC42_Harness_Empresarial.md loc=None community=2]
... (truncated — 25 more nodes cut by ~200-token budget. Narrow with context_filter=['call'] or use get_node for a specific symbol)`;

describe("parseNodeLabels", () => {
  it("extracts labels from the real graphify query stdout fixture", () => {
    expect(parseNodeLabels(REAL_GRAPHIFY_QUERY_STDOUT)).toEqual([
      "Hito 1: Esqueleto conversacional",
      "Hitos",
      "Escenario de ejecución 1: Turno conversacional básico",
      "Ensamblador de Contexto (1.2)",
      "Adaptador A2A",
      "Adaptador de Memoria Compartida",
    ]);
  });

  it("extracts a label from a NODE line without a metadata block, via the fallback pattern", () => {
    const stdout = "NODE Política de Vacaciones";

    expect(parseNodeLabels(stdout)).toEqual(["Política de Vacaciones"]);
  });

  it("ignores lines that do not start with NODE", () => {
    const stdout = [
      "Traversal: BFS depth=2 | Start: ['X'] | 3 nodes found",
      "NODE Manual del Empleado [src=docs/manual.md loc=L10 community=1]",
      "some other stderr-looking noise",
      "... (truncated — more nodes cut)",
    ].join("\n");

    expect(parseNodeLabels(stdout)).toEqual(["Manual del Empleado"]);
  });

  it("dedupes repeated labels, keeping the position of the first occurrence", () => {
    const stdout = [
      "NODE Manual del Empleado [src=docs/manual.md loc=L10 community=1]",
      "NODE Política de Vacaciones [src=docs/politicas.md loc=L20 community=2]",
      "NODE Manual del Empleado [src=docs/manual.md loc=L10 community=1]",
    ].join("\n");

    expect(parseNodeLabels(stdout)).toEqual(["Manual del Empleado", "Política de Vacaciones"]);
  });

  it(`cuts at MAX_CITED_NODES (${MAX_CITED_NODES}) when there are more unique labels`, () => {
    const total = MAX_CITED_NODES + 5;
    const lines = Array.from(
      { length: total },
      (_, i) => `NODE Nodo ${i} [src=docs/x.md loc=L${i} community=1]`,
    );

    const result = parseNodeLabels(lines.join("\n"));

    expect(result).toHaveLength(MAX_CITED_NODES);
    expect(result).toEqual(Array.from({ length: MAX_CITED_NODES }, (_, i) => `Nodo ${i}`));
  });
});

describe("createCitedNodesRecorder", () => {
  it("accumulates labels across multiple record() calls", () => {
    const recorder = createCitedNodesRecorder();

    recorder.record(["A", "B"]);
    recorder.record(["C"]);

    expect(recorder.drain()).toEqual(["A", "B", "C"]);
  });

  it("dedupes across record() calls and cuts at MAX_CITED_NODES on the accumulated total", () => {
    const recorder = createCitedNodesRecorder();
    const first = Array.from({ length: MAX_CITED_NODES }, (_, i) => `Nodo ${i}`);
    const second = [first[0]!, "Nodo extra 1", "Nodo extra 2"];

    recorder.record(first);
    recorder.record(second);

    const drained = recorder.drain();
    expect(drained).toHaveLength(MAX_CITED_NODES);
    expect(drained).toEqual(first);
  });

  it("drain() is idempotent: a second call without a record() in between returns []", () => {
    const recorder = createCitedNodesRecorder();
    recorder.record(["A", "B"]);

    const firstDrain = recorder.drain();
    const secondDrain = recorder.drain();

    expect(firstDrain).toEqual(["A", "B"]);
    expect(secondDrain).toEqual([]);
  });

  it("record() after a drain() starts a fresh accumulation", () => {
    const recorder = createCitedNodesRecorder();
    recorder.record(["A"]);
    recorder.drain();

    recorder.record(["B"]);

    expect(recorder.drain()).toEqual(["B"]);
  });
});
