import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CASO_ESTADO_PENDIENTE_APROBACION_HUMANA,
  CASO_ESTADO_RESUELTO,
  MOTIVO_CAS,
  MOTIVO_NO_ENCONTRADA,
  type MotivoNoAplicableHitl,
  type ResolucionHitlResult,
} from "./hitl-contract.js";

describe("hitl-contract constants", () => {
  it("CASO_ESTADO_PENDIENTE_APROBACION_HUMANA es 'pendiente_aprobacion_humana'", () => {
    expect(CASO_ESTADO_PENDIENTE_APROBACION_HUMANA).toBe("pendiente_aprobacion_humana");
  });

  it("CASO_ESTADO_RESUELTO es 'resuelto'", () => {
    expect(CASO_ESTADO_RESUELTO).toBe("resuelto");
  });

  it("MOTIVO_NO_ENCONTRADA es 'no_encontrada'", () => {
    expect(MOTIVO_NO_ENCONTRADA).toBe("no_encontrada");
  });

  it("MOTIVO_CAS es 'cas'", () => {
    expect(MOTIVO_CAS).toBe("cas");
  });
});

describe("MotivoNoAplicableHitl", () => {
  it("acepta únicamente los dos literales declarados", () => {
    const motivos: readonly MotivoNoAplicableHitl[] = [MOTIVO_NO_ENCONTRADA, MOTIVO_CAS];

    expect(motivos).toEqual(["no_encontrada", "cas"]);
  });
});

describe("ResolucionHitlResult", () => {
  type Item = { readonly id: string };
  type Accion = "aprobar" | "rechazar";
  type EstadoFinal = "aprobada" | "rechazada";

  /** Ejercita las cuatro variantes en un switch exhaustivo — falla en compilación si falta una. */
  function describirResolucion(
    resolucion: ResolucionHitlResult<Item, Accion, EstadoFinal>,
  ): string {
    switch (resolucion.resultado) {
      case "listado":
        return `listado:${resolucion.items.length}`;
      case "requiere_confirmacion":
        return `requiere_confirmacion:${resolucion.item.id}`;
      case "aplicada":
        return `aplicada:${resolucion.item.id}:${resolucion.estadoFinal}`;
      case "no_aplicable":
        return `no_aplicable:${resolucion.motivo}`;
    }
  }

  it("la variante 'listado' trae accion e items", () => {
    const resolucion: ResolucionHitlResult<Item, Accion, EstadoFinal> = {
      resultado: "listado",
      accion: "aprobar",
      items: [{ id: "item-1" }],
    };

    expect(describirResolucion(resolucion)).toBe("listado:1");
  });

  it("la variante 'requiere_confirmacion' trae accion e item", () => {
    const resolucion: ResolucionHitlResult<Item, Accion, EstadoFinal> = {
      resultado: "requiere_confirmacion",
      accion: "aprobar",
      item: { id: "item-1" },
    };

    expect(describirResolucion(resolucion)).toBe("requiere_confirmacion:item-1");
  });

  it("la variante 'aplicada' trae accion, item y estadoFinal", () => {
    const resolucion: ResolucionHitlResult<Item, Accion, EstadoFinal> = {
      resultado: "aplicada",
      accion: "aprobar",
      item: { id: "item-1" },
      estadoFinal: "aprobada",
    };

    expect(describirResolucion(resolucion)).toBe("aplicada:item-1:aprobada");
  });

  it("la variante 'no_aplicable' trae accion y motivo, con itemId/casoId opcionales", () => {
    const resolucion: ResolucionHitlResult<Item, Accion, EstadoFinal> = {
      resultado: "no_aplicable",
      accion: "rechazar",
      motivo: MOTIVO_CAS,
    };

    expect(describirResolucion(resolucion)).toBe("no_aplicable:cas");

    const conIds: ResolucionHitlResult<Item, Accion, EstadoFinal> = {
      resultado: "no_aplicable",
      accion: "rechazar",
      motivo: MOTIVO_NO_ENCONTRADA,
      itemId: "item-1",
      casoId: "caso-1",
    };

    expect(conIds.itemId).toBe("item-1");
    expect(conIds.casoId).toBe("caso-1");
  });
});

describe("hitl-contract.ts source", () => {
  it("has no import statements — the core module must not import SDK, Node, or adapters", () => {
    const sourcePath = fileURLToPath(new URL("./hitl-contract.ts", import.meta.url));
    const source = readFileSync(sourcePath, "utf-8");

    expect(source).not.toMatch(/\bimport\b/);
  });
});
