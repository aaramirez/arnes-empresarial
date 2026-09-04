import { describe, expect, it } from "vitest";
import {
  ESTADO_APROBADO,
  ESTADO_OBSERVADO,
  ESTADO_PENDIENTE_REVISION,
  ESTADO_RESUELTO,
} from "../../core/activity/activity-contract.js";
import { ESTADO_LABELS, MANAGED_LABELS, labelForEstado, mergeLabels } from "./labels.js";

describe("ESTADO_LABELS / labelForEstado", () => {
  it("maps pendiente_revision to necesita-revision", () => {
    expect(ESTADO_LABELS[ESTADO_PENDIENTE_REVISION]).toBe("necesita-revision");
    expect(labelForEstado(ESTADO_PENDIENTE_REVISION)).toBe("necesita-revision");
  });

  it("maps observado to observaciones-pendientes", () => {
    expect(ESTADO_LABELS[ESTADO_OBSERVADO]).toBe("observaciones-pendientes");
    expect(labelForEstado(ESTADO_OBSERVADO)).toBe("observaciones-pendientes");
  });

  it("maps resuelto to resuelto", () => {
    expect(ESTADO_LABELS[ESTADO_RESUELTO]).toBe("resuelto");
    expect(labelForEstado(ESTADO_RESUELTO)).toBe("resuelto");
  });

  it("maps aprobado to aprobado", () => {
    expect(ESTADO_LABELS[ESTADO_APROBADO]).toBe("aprobado");
    expect(labelForEstado(ESTADO_APROBADO)).toBe("aprobado");
  });
});

describe("MANAGED_LABELS", () => {
  it("contains exactly the 4 managed labels, no duplicates or missing", () => {
    expect(MANAGED_LABELS).toHaveLength(4);
    expect(new Set(MANAGED_LABELS).size).toBe(4);
    expect([...MANAGED_LABELS].sort()).toEqual(
      [
        "necesita-revision",
        "observaciones-pendientes",
        "resuelto",
        "aprobado",
      ].sort(),
    );
  });
});

describe("mergeLabels", () => {
  it("removes ALL managed labels present, even when multiple co-exist (dirty case)", () => {
    const result = mergeLabels(
      ["necesita-revision", "observaciones-pendientes"],
      ESTADO_APROBADO,
    );

    expect(result).toEqual(["aprobado"]);
  });

  it("adds the label for the new estado", () => {
    const result = mergeLabels(["bug"], ESTADO_APROBADO);

    expect(result).toContain(ESTADO_LABELS[ESTADO_APROBADO]);
  });

  it("preserves foreign labels in their relative order (full array via toEqual)", () => {
    const result = mergeLabels(["bug", "necesita-revision", "docs"], ESTADO_APROBADO);

    expect(result).toEqual(["bug", "docs", "aprobado"]);
  });

  it("is idempotent when applied twice with the same estado", () => {
    const once = mergeLabels(["bug", "necesita-revision", "docs"], ESTADO_APROBADO);
    const twice = mergeLabels(once, ESTADO_APROBADO);

    expect(twice).toEqual(once);
  });

  it("returns only the new estado's label for an empty labels list", () => {
    const result = mergeLabels([], ESTADO_RESUELTO);

    expect(result).toEqual(["resuelto"]);
  });
});
