import { describe, expect, it, vi } from "vitest";
import {
  PATCH_MAX_BYTES,
  PROPUESTA_ESTADO_PENDIENTE,
  type CrearPropuestaInput,
  type PropuestaCambio,
  type PropuestaStorePort,
  type ResolucionPropuestaInput,
} from "./propuestas-contract.js";
import { crearPropuestaCambio } from "./crear-propuesta-cambio.js";

/**
 * Hito 5.1, tarea 19 (§5.6 — `crear-propuesta-cambio.ts`). Doble de
 * `PropuestaStorePort` — molde exacto de `crearStoreFalso` de
 * `propuestas-contract.test.ts` (tarea 17), envuelto en `vi.fn()` para poder
 * assertar `.not.toHaveBeenCalled()` en los dos desenlaces de rechazo
 * temprano (ADR 70, ADR 58 pto 3).
 */

function makeNewId(): () => string {
  let contador = 0;
  return () => `id-${contador++}`;
}

function makePropuestaStore(): PropuestaStorePort {
  return {
    crearPropuesta: vi.fn((input: CrearPropuestaInput): PropuestaCambio => ({
      id: input.id,
      casoId: input.casoId,
      ...(input.delegacionId !== undefined ? { delegacionId: input.delegacionId } : {}),
      baseCommit: input.baseCommit,
      ramaWorktree: input.ramaWorktree,
      patch: input.patch,
      patchBytes: input.resumen.patchBytes,
      archivos: input.resumen.archivos,
      lineasAgregadas: input.resumen.lineasAgregadas,
      lineasEliminadas: input.resumen.lineasEliminadas,
      estado: PROPUESTA_ESTADO_PENDIENTE,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    })),
    obtenerPropuesta: vi.fn(() => undefined),
    listarPropuestasPendientes: vi.fn(() => []),
    aplicarPropuesta: vi.fn((_input: ResolucionPropuestaInput) => undefined),
    descartarPropuesta: vi.fn((_input: ResolucionPropuestaInput) => undefined),
  };
}

describe("crearPropuestaCambio", () => {
  it("patch vacío tras trim() ⇒ 'sin_cambios', cero filas, evento propuesta-sin-cambios, store NO llamado", () => {
    const store = makePropuestaStore();
    const logEvent = vi.fn();

    const resultado = crearPropuestaCambio(
      {
        casoId: "caso-1",
        baseCommit: "abc123",
        ramaWorktree: "harness/caso-1-uuid",
        patch: "   \n\t  ",
      },
      { store, newId: makeNewId(), now: () => "2026-09-07T00:00:00.000Z", logEvent },
    );

    expect(resultado).toEqual({ resultado: "sin_cambios" });
    expect(store.crearPropuesta).not.toHaveBeenCalled();
    expect(logEvent).toHaveBeenCalledTimes(1);
    expect(logEvent).toHaveBeenCalledWith("caso-1", "propuesta-sin-cambios", {
      rama: "harness/caso-1-uuid",
    });
  });

  it("patch con solo espacios/whitespace (nunca un patch de solo espacios reales) también da 'sin_cambios', no 'rechazada_por_tamano'", () => {
    const store = makePropuestaStore();
    const logEvent = vi.fn();

    const resultado = crearPropuestaCambio(
      { casoId: "caso-1", baseCommit: "abc123", ramaWorktree: "harness/caso-1-uuid", patch: "" },
      { store, newId: makeNewId(), now: () => "2026-09-07T00:00:00.000Z", logEvent },
    );

    expect(resultado).toEqual({ resultado: "sin_cambios" });
    expect(store.crearPropuesta).not.toHaveBeenCalled();
  });

  it("patch > 65_536 bytes ⇒ 'rechazada_por_tamano', cero filas, evento con patchBytes, store NO llamado", () => {
    const store = makePropuestaStore();
    const logEvent = vi.fn();
    const patchGigante = "a".repeat(PATCH_MAX_BYTES + 1);

    const resultado = crearPropuestaCambio(
      { casoId: "caso-1", baseCommit: "abc123", ramaWorktree: "harness/caso-1-uuid", patch: patchGigante },
      { store, newId: makeNewId(), now: () => "2026-09-07T00:00:00.000Z", logEvent },
    );

    expect(resultado).toEqual({
      resultado: "rechazada_por_tamano",
      patchBytes: PATCH_MAX_BYTES + 1,
    });
    expect(store.crearPropuesta).not.toHaveBeenCalled();
    expect(logEvent).toHaveBeenCalledTimes(1);
    expect(logEvent).toHaveBeenCalledWith("caso-1", "propuesta-rechazada-por-tamano", {
      patchBytes: PATCH_MAX_BYTES + 1,
      topeBytes: PATCH_MAX_BYTES,
    });
  });

  it("patch válido ⇒ 'creada' con la fila completa devuelta por el store, en el orden trim → resumirPatch → tope → store.crearPropuesta", () => {
    const store = makePropuestaStore();
    const logEvent = vi.fn();
    const patch = "  diff --git a/a.ts b/a.ts\n+contenido nuevo\n-linea vieja\n  ";

    const resultado = crearPropuestaCambio(
      {
        casoId: "caso-1",
        delegacionId: "delegacion-1",
        baseCommit: "abc123",
        ramaWorktree: "harness/caso-1-uuid",
        patch,
      },
      { store, newId: makeNewId(), now: () => "2026-09-07T00:00:00.000Z", logEvent },
    );

    expect(store.crearPropuesta).toHaveBeenCalledTimes(1);
    const inputCreado = vi.mocked(store.crearPropuesta).mock.calls[0]![0];
    // El patch persistido es el YA TRIMEADO (trim ocurre antes que store.crearPropuesta).
    expect(inputCreado.patch).toBe(patch.trim());
    expect(inputCreado.casoId).toBe("caso-1");
    expect(inputCreado.delegacionId).toBe("delegacion-1");
    expect(inputCreado.baseCommit).toBe("abc123");
    expect(inputCreado.ramaWorktree).toBe("harness/caso-1-uuid");
    expect(inputCreado.resumen).toEqual({
      patchBytes: patch.trim().length,
      archivos: 1,
      lineasAgregadas: 1,
      lineasEliminadas: 1,
    });

    expect(resultado.resultado).toBe("creada");
    if (resultado.resultado !== "creada") throw new Error("esperaba 'creada'");
    expect(resultado.propuesta.id).toBe(inputCreado.id);
    expect(resultado.propuesta.estado).toBe(PROPUESTA_ESTADO_PENDIENTE);
    expect(resultado.propuesta.patch).toBe(patch.trim());

    expect(logEvent).toHaveBeenCalledTimes(1);
    expect(logEvent).toHaveBeenCalledWith("caso-1", "propuesta-creada", {
      propuestaId: inputCreado.id,
      patchBytes: patch.trim().length,
      archivos: 1,
      lineasAgregadas: 1,
      lineasEliminadas: 1,
    });
  });

  it("delegacionId ausente no viaja como undefined explícito al store (exactOptionalPropertyTypes)", () => {
    const store = makePropuestaStore();
    const logEvent = vi.fn();

    crearPropuestaCambio(
      {
        casoId: "caso-1",
        baseCommit: "abc123",
        ramaWorktree: "harness/caso-1-uuid",
        patch: "diff --git a/a.ts b/a.ts\n+x\n",
      },
      { store, newId: makeNewId(), now: () => "2026-09-07T00:00:00.000Z", logEvent },
    );

    const inputCreado = vi.mocked(store.crearPropuesta).mock.calls[0]![0];
    expect("delegacionId" in inputCreado).toBe(false);
  });
});
