import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DelegacionA2ANoCompletadaError,
  DESTINO_A2A_KPI_INCIDENTE,
  DESTINO_A2A_RIESGO_CREDITO,
  DESTINOS_A2A,
  DestinoA2ADesconocidoError,
  type DestinoA2AClave,
  esEstadoTerminal,
  esTaskStateConocido,
  type MotivoDelegacionA2ANoCompletada,
  motivoDeEstadoTerminal,
  type ResultadoA2A,
  TASK_STATE_AUTH_REQUIRED,
  TASK_STATE_CANCELED,
  TASK_STATE_COMPLETED,
  TASK_STATE_FAILED,
  TASK_STATE_INPUT_REQUIRED,
  TASK_STATE_REJECTED,
  TASK_STATE_SUBMITTED,
  TASK_STATE_WORKING,
  type TaskState,
  TASK_STATES_CONOCIDOS,
} from "./a2a-contract.js";

describe("TASK_STATE_* constants", () => {
  it("las ocho constantes crudas tienen el valor literal del protocolo", () => {
    expect(TASK_STATE_SUBMITTED).toBe("TASK_STATE_SUBMITTED");
    expect(TASK_STATE_WORKING).toBe("TASK_STATE_WORKING");
    expect(TASK_STATE_COMPLETED).toBe("TASK_STATE_COMPLETED");
    expect(TASK_STATE_FAILED).toBe("TASK_STATE_FAILED");
    expect(TASK_STATE_CANCELED).toBe("TASK_STATE_CANCELED");
    expect(TASK_STATE_REJECTED).toBe("TASK_STATE_REJECTED");
    expect(TASK_STATE_INPUT_REQUIRED).toBe("TASK_STATE_INPUT_REQUIRED");
    expect(TASK_STATE_AUTH_REQUIRED).toBe("TASK_STATE_AUTH_REQUIRED");
  });
});

describe("TASK_STATES_CONOCIDOS", () => {
  it("son exactamente los ocho valores conocidos por el arnés, sin TASK_STATE_UNSPECIFIED", () => {
    expect(TASK_STATES_CONOCIDOS).toEqual([
      "TASK_STATE_SUBMITTED",
      "TASK_STATE_WORKING",
      "TASK_STATE_COMPLETED",
      "TASK_STATE_FAILED",
      "TASK_STATE_CANCELED",
      "TASK_STATE_REJECTED",
      "TASK_STATE_INPUT_REQUIRED",
      "TASK_STATE_AUTH_REQUIRED",
    ]);
    expect(TASK_STATES_CONOCIDOS).toHaveLength(8);
  });
});

describe("esEstadoTerminal", () => {
  it("exhaustivo sobre los ocho valores conocidos (ADR 73 pto 2)", () => {
    const veredictos: ReadonlyArray<readonly [TaskState, boolean]> = [
      [TASK_STATE_COMPLETED, true],
      [TASK_STATE_FAILED, true],
      [TASK_STATE_CANCELED, true],
      [TASK_STATE_REJECTED, true],
      [TASK_STATE_INPUT_REQUIRED, true],
      [TASK_STATE_AUTH_REQUIRED, true],
      [TASK_STATE_SUBMITTED, false],
      [TASK_STATE_WORKING, false],
    ];

    for (const [estado, esperado] of veredictos) {
      expect(esEstadoTerminal(estado)).toBe(esperado);
    }
  });
});

describe("esTaskStateConocido", () => {
  it("acepta los ocho valores conocidos", () => {
    for (const estado of TASK_STATES_CONOCIDOS) {
      expect(esTaskStateConocido(estado)).toBe(true);
    }
  });

  it("rechaza TASK_STATE_UNSPECIFIED (ADR 84 — el noveno valor real de la spec v1.0.0)", () => {
    expect(esTaskStateConocido("TASK_STATE_UNSPECIFIED")).toBe(false);
  });

  it("rechaza un string inventado", () => {
    expect(esTaskStateConocido("TASK_STATE_QUE_NO_EXISTE")).toBe(false);
  });
});

describe("motivoDeEstadoTerminal", () => {
  it("total sobre los cinco estados terminales de fracaso", () => {
    const casos: ReadonlyArray<
      readonly [
        Exclude<TaskState, "TASK_STATE_COMPLETED" | "TASK_STATE_SUBMITTED" | "TASK_STATE_WORKING">,
        MotivoDelegacionA2ANoCompletada,
      ]
    > = [
      [TASK_STATE_FAILED, "failed"],
      [TASK_STATE_CANCELED, "canceled"],
      [TASK_STATE_REJECTED, "rejected"],
      [TASK_STATE_INPUT_REQUIRED, "input-required"],
      [TASK_STATE_AUTH_REQUIRED, "auth-required"],
    ];

    for (const [estado, motivo] of casos) {
      expect(motivoDeEstadoTerminal(estado)).toBe(motivo);
    }
  });
});

describe("DESTINOS_A2A", () => {
  it("tiene exactamente dos elementos: riesgo-credito y kpi-incidente", () => {
    expect(DESTINOS_A2A).toEqual(["riesgo-credito", "kpi-incidente"]);
    expect(DESTINOS_A2A).toHaveLength(2);
  });

  it("las dos constantes individuales coinciden con las dos claves del registro", () => {
    expect(DESTINO_A2A_RIESGO_CREDITO).toBe("riesgo-credito");
    expect(DESTINO_A2A_KPI_INCIDENTE).toBe("kpi-incidente");
  });
});

describe("DestinoA2ADesconocidoError", () => {
  it("con una clave fuera del registro cerrado", () => {
    const error = new DestinoA2ADesconocidoError("clave-inventada");

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("DestinoA2ADesconocidoError");
    expect(error.message).toContain("clave-inventada");
  });
});

describe("DelegacionA2ANoCompletadaError", () => {
  it("expone reason, destinoClave, estado y delegacionId del input", () => {
    const destinoClave: DestinoA2AClave = "riesgo-credito";
    const error = new DelegacionA2ANoCompletadaError({
      reason: "timeout",
      destinoClave,
      estado: TASK_STATE_WORKING,
      delegacionId: "delegacion-1",
    });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("DelegacionA2ANoCompletadaError");
    expect(error.reason).toBe("timeout");
    expect(error.destinoClave).toBe("riesgo-credito");
    expect(error.estado).toBe(TASK_STATE_WORKING);
    expect(error.delegacionId).toBe("delegacion-1");
  });

  it("estado y delegacionId son opcionales", () => {
    const error = new DelegacionA2ANoCompletadaError({
      reason: "transporte",
      destinoClave: "kpi-incidente",
    });

    expect(error.estado).toBeUndefined();
    expect(error.delegacionId).toBeUndefined();
  });
});

describe("ResultadoA2A", () => {
  /** Ejercita las dos variantes en un switch exhaustivo — falla en compilación si falta una. */
  function describirResultado(resultado: ResultadoA2A): string {
    if (resultado.ok) {
      return `ok:${resultado.a2aTaskId}:${resultado.estado}`;
    }
    return `fallo:${resultado.reason}`;
  }

  it("la variante ok trae a2aTaskId, estado, resultado, agenteNombre y endpoint", () => {
    const resultado: ResultadoA2A = {
      ok: true,
      a2aTaskId: "task-1",
      estado: "TASK_STATE_COMPLETED",
      resultado: "texto de respuesta",
      agenteNombre: "Agente de Riesgo",
      endpoint: "https://ejemplo.test/jsonrpc",
    };

    expect(describirResultado(resultado)).toBe("ok:task-1:TASK_STATE_COMPLETED");
  });

  it("la variante de fallo trae reason y campos opcionales", () => {
    const resultado: ResultadoA2A = {
      ok: false,
      reason: "protocolo",
    };

    expect(describirResultado(resultado)).toBe("fallo:protocolo");
  });
});

describe("a2a-contract.ts source", () => {
  it("has no import statements — the core module must not import SDK, Node, or adapters", () => {
    const sourcePath = fileURLToPath(new URL("./a2a-contract.ts", import.meta.url));
    const source = readFileSync(sourcePath, "utf-8");

    expect(source).not.toMatch(/\bimport\b/);
  });
});
