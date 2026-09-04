import { describe, expect, it } from "vitest";
import {
  RESULTADO_REEMBOLSO_AUTO_APROBADO,
  RESULTADO_REEMBOLSO_ESCALADO,
  evaluarReembolso,
} from "./reembolso.js";

describe("evaluarReembolso", () => {
  it("monto estrictamente menor al umbral → auto_aprobado", () => {
    expect(evaluarReembolso(499, 500)).toBe(RESULTADO_REEMBOLSO_AUTO_APROBADO);
  });

  it("monto igual al umbral → escalado (el borde: >=, no >)", () => {
    // Spec reembolso-evaluacion, Requirement "Escalación humana por encima
    // del umbral": "Un monto MAYOR O IGUAL a REEMBOLSO_UMBRAL SHALL
    // transicionar... a 'reembolso_pendiente'". La celda más importante del
    // hito: monto === umbral NO auto-aprueba.
    expect(evaluarReembolso(500, 500)).toBe(RESULTADO_REEMBOLSO_ESCALADO);
  });

  it("monto mayor al umbral → escalado", () => {
    expect(evaluarReembolso(501, 500)).toBe(RESULTADO_REEMBOLSO_ESCALADO);
  });
});
