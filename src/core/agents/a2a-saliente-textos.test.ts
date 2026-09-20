/**
 * Test de caracterización de `mensajeDeMotivoA2A` (visibilidad-a2a-entrante-
 * chat, tarea 1.3, ADR 240 pto 4). Sin test directo hoy en
 * `build-on-comando-empleado.test.ts` — solo cobertura indirecta vía el
 * handler de `/consultar-kpi`, que este change no toca.
 */
import { describe, expect, it } from "vitest";
import { mensajeDeMotivoA2A } from "./a2a-saliente-textos.js";
import type { MotivoDelegacionA2ANoCompletada } from "./a2a-contract.js";

describe("mensajeDeMotivoA2A (visibilidad-a2a-entrante-chat, tarea 1.3)", () => {
  const MOTIVOS: MotivoDelegacionA2ANoCompletada[] = [
    "failed",
    "canceled",
    "rejected",
    "input-required",
    "auth-required",
    "timeout",
    "transporte",
    "protocolo",
  ];

  it.each(MOTIVOS)("devuelve un mensaje no vacío para el motivo %s", (motivo) => {
    expect(mensajeDeMotivoA2A(motivo).length).toBeGreaterThan(0);
  });

  it("es total sobre los ocho motivos y ningún par comparte el mismo mensaje", () => {
    const mensajes = MOTIVOS.map((motivo) => mensajeDeMotivoA2A(motivo));
    expect(mensajes).toHaveLength(8);
    expect(new Set(mensajes).size).toBe(8);
  });
});
