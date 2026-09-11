import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  esEstadoTerminal,
  TASK_STATE_AUTH_REQUIRED,
  TASK_STATE_CANCELED,
  TASK_STATE_COMPLETED,
  TASK_STATE_FAILED,
  TASK_STATE_INPUT_REQUIRED,
  TASK_STATE_REJECTED,
  TASK_STATE_SUBMITTED,
  TASK_STATE_WORKING,
  TASK_STATES_CONOCIDOS,
} from "./a2a-contract.js";
import {
  LIMITE_LISTADO_A2A_ENTRANTES,
  LINEAS_PAGINA_A2A,
  TASK_STATES_EN_CURSO,
  type EstadoSolicitudA2AEntrante,
  type SolicitudA2AEntranteStorePort,
  type SolicitudA2AEntranteVista,
} from "./a2a-entrante-contract.js";

describe("TASK_STATES_EN_CURSO", () => {
  it("recorre las ocho variantes de TASK_STATES_CONOCIDOS y particiona exactamente en SUBMITTED/WORKING (ADR 135)", () => {
    expect(TASK_STATES_CONOCIDOS).toHaveLength(8);

    for (const estado of TASK_STATES_CONOCIDOS) {
      const enCursoEsperado = estado === TASK_STATE_SUBMITTED || estado === TASK_STATE_WORKING;
      expect(TASK_STATES_EN_CURSO.includes(estado)).toBe(enCursoEsperado);
    }

    expect(TASK_STATES_EN_CURSO).toEqual([TASK_STATE_SUBMITTED, TASK_STATE_WORKING]);
  });

  it("INPUT_REQUIRED y AUTH_REQUIRED no están incluidos — son terminales de fracaso (ADR 73 pto 2)", () => {
    expect(TASK_STATES_EN_CURSO).not.toContain(TASK_STATE_INPUT_REQUIRED);
    expect(TASK_STATES_EN_CURSO).not.toContain(TASK_STATE_AUTH_REQUIRED);
    expect(TASK_STATES_EN_CURSO).not.toContain(TASK_STATE_COMPLETED);
    expect(TASK_STATES_EN_CURSO).not.toContain(TASK_STATE_FAILED);
    expect(TASK_STATES_EN_CURSO).not.toContain(TASK_STATE_CANCELED);
    expect(TASK_STATES_EN_CURSO).not.toContain(TASK_STATE_REJECTED);
  });
});

describe("a2a-entrante-contract.ts source — sin lista literal de estados en curso", () => {
  it("no contiene TASK_STATE_SUBMITTED ni TASK_STATE_WORKING como literales fuera de la derivación (ADR 135)", () => {
    const sourcePath = fileURLToPath(new URL("./a2a-entrante-contract.ts", import.meta.url));
    const source = readFileSync(sourcePath, "utf-8");

    // El archivo entero no debe mencionar ninguno de los dos nombres crudos:
    // la derivación usa `esEstadoTerminal` sobre `TASK_STATES_CONOCIDOS`, no
    // los identificadores `TASK_STATE_SUBMITTED`/`TASK_STATE_WORKING`. Si
    // mañana alguien agrega una lista literal (aunque sea "de apoyo"), este
    // test falla apenas el nombre aparece una sola vez.
    expect(source).not.toMatch(/TASK_STATE_SUBMITTED|TASK_STATE_WORKING/);
  });
});

describe("EstadoSolicitudA2AEntrante — guard de vocabulario (ADR 141, R5)", () => {
  it("conocido: true expone un TaskState real, válido para esEstadoTerminal", () => {
    const estado: EstadoSolicitudA2AEntrante = { conocido: true, valor: TASK_STATE_WORKING };

    expect(estado.conocido).toBe(true);
    if (estado.conocido) {
      expect(esEstadoTerminal(estado.valor)).toBe(false);
    }
  });

  it("conocido: false preserva el valor crudo tal cual, sin tipar como TaskState", () => {
    const estado: EstadoSolicitudA2AEntrante = { conocido: false, valor: "BASURA" };

    expect(estado.conocido).toBe(false);
    expect(estado.valor).toBe("BASURA");
  });

  // Chequeo de tipos en tiempo de compilación, no una prueba de comportamiento:
  // esta función nunca se invoca. La garantía la da `tsc --noEmit` al fallar
  // si el `@ts-expect-error` de abajo deja de ser necesario (molde de
  // `definitions.test.ts:203-210`). Sin narrowing previo por `estado.conocido`,
  // `estado.valor` es `TaskState | string` y `esEstadoTerminal` exige un
  // `TaskState` puro — el cast queda inexpresable, no sólo desaconsejado.
  function _chequeoDeTipos_esEstadoTerminalExigeNarrowingPorConocido(
    estado: EstadoSolicitudA2AEntrante,
  ): void {
    // @ts-expect-error — `estado.valor` sin discriminar por `conocido` es `TaskState | string`; `esEstadoTerminal` exige `TaskState`.
    esEstadoTerminal(estado.valor);
  }
});

describe("LIMITE_LISTADO_A2A_ENTRANTES", () => {
  it("es 20 — única fuente de verdad del tope de listado (ADR 140 pto 6)", () => {
    expect(LIMITE_LISTADO_A2A_ENTRANTES).toBe(20);
  });
});

describe("LINEAS_PAGINA_A2A", () => {
  it("es 80 — constante propia, no LINEAS_PAGINA_PATCH (ADR 142 pto 2)", () => {
    expect(LINEAS_PAGINA_A2A).toBe(80);
  });
});

describe("SolicitudA2AEntranteStorePort", () => {
  it("es inyectable y testeable con un doble plano, sin ninguna dependencia de better-sqlite3", () => {
    const vista: SolicitudA2AEntranteVista = {
      a2aTaskId: "task-1",
      estado: { conocido: true, valor: TASK_STATE_WORKING },
      origenTransporte: "203.0.113.7",
      mensajeRecibido: "hola",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    const doble: SolicitudA2AEntranteStorePort = {
      listarPorEstados: (filtro) =>
        filtro.estados.includes(TASK_STATE_WORKING)
          ? { items: [vista], hayMas: false }
          : { items: [], hayMas: false },
      obtenerPorTaskId: (a2aTaskId) => (a2aTaskId === vista.a2aTaskId ? vista : undefined),
    };

    expect(doble.listarPorEstados({ estados: TASK_STATES_EN_CURSO })).toEqual({
      items: [vista],
      hayMas: false,
    });
    expect(doble.obtenerPorTaskId("no-existe")).toBeUndefined();
  });

  it("el doble sólo expone los dos métodos de lectura declarados por la interfaz — ninguno de escritura", () => {
    const doble: SolicitudA2AEntranteStorePort = {
      listarPorEstados: () => ({ items: [], hayMas: false }),
      obtenerPorTaskId: () => undefined,
    };

    expect(Object.keys(doble).sort()).toEqual(["listarPorEstados", "obtenerPorTaskId"]);
  });
});
