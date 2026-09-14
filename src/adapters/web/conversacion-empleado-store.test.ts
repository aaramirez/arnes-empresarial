import { describe, expect, it } from "vitest";
import { crearConversacionEmpleadoStore } from "./conversacion-empleado-store.js";
import { CONVERSACION_INACTIVIDAD_MS, CONVERSACION_MAX_TURNOS } from "./config.js";

/**
 * chat-web-empleado, tarea 2. Molde de `confirmacion-operaciones-store.ts`
 * (ranura por clave) — acá la clave es el token de sesión HTTP, no el
 * `empleadoId`. `now`/`newId` inyectados para test sin reloj real (ADR 197).
 */

function crearRelojFake(inicial: string): { now: () => string; avanzar: (ms: number) => void } {
  let actual = Date.parse(inicial);
  return {
    now: () => new Date(actual).toISOString(),
    avanzar: (ms: number) => {
      actual += ms;
    },
  };
}

function crearIdsFake(prefijo: string): () => string {
  let contador = 0;
  return () => `${prefijo}-${++contador}`;
}

describe("crearConversacionEmpleadoStore — primer acceso y registrarTurno", () => {
  it("primer acceso a un token nuevo: casoAnterior() es undefined", () => {
    const store = crearConversacionEmpleadoStore();
    const conversacion = store.paraSesion("token-1");

    expect(conversacion.casoAnterior()).toBeUndefined();
  });

  it("tras registrarTurno('A'): casoAnterior() es 'A'", () => {
    const store = crearConversacionEmpleadoStore();
    const conversacion = store.paraSesion("token-1");

    conversacion.registrarTurno("A");

    expect(conversacion.casoAnterior()).toBe("A");
  });

  it("conversacionId() es estable entre accesos al mismo token, mientras no rote", () => {
    const store = crearConversacionEmpleadoStore();
    const primerAcceso = store.paraSesion("token-1").conversacionId();
    const segundoAcceso = store.paraSesion("token-1").conversacionId();

    expect(segundoAcceso).toBe(primerAcceso);
  });
});

describe("crearConversacionEmpleadoStore — rotación por inactividad (ADR 197)", () => {
  it("dos accesos separados por más de CONVERSACION_INACTIVIDAD_MS rotan: conversacionId cambia y casoAnterior() vuelve a undefined", () => {
    const reloj = crearRelojFake("2026-01-01T00:00:00.000Z");
    const store = crearConversacionEmpleadoStore({ now: reloj.now });

    const primerAcceso = store.paraSesion("token-1");
    const conversacionIdInicial = primerAcceso.conversacionId();
    primerAcceso.registrarTurno("A");

    reloj.avanzar(CONVERSACION_INACTIVIDAD_MS + 1);

    const segundoAcceso = store.paraSesion("token-1");

    expect(segundoAcceso.conversacionId()).not.toBe(conversacionIdInicial);
    expect(segundoAcceso.casoAnterior()).toBeUndefined();
  });

  it("un acceso justo antes del techo de inactividad NO rota", () => {
    const reloj = crearRelojFake("2026-01-01T00:00:00.000Z");
    const store = crearConversacionEmpleadoStore({ now: reloj.now });

    const primerAcceso = store.paraSesion("token-1");
    const conversacionIdInicial = primerAcceso.conversacionId();
    primerAcceso.registrarTurno("A");

    reloj.avanzar(CONVERSACION_INACTIVIDAD_MS - 1);

    const segundoAcceso = store.paraSesion("token-1");

    expect(segundoAcceso.conversacionId()).toBe(conversacionIdInicial);
    expect(segundoAcceso.casoAnterior()).toBe("A");
  });
});

describe("crearConversacionEmpleadoStore — rotación por techo de turnos (ADR 197)", () => {
  it("el turno CONVERSACION_MAX_TURNOS + 1 rota: conversacionId cambia y casoAnterior() vuelve a undefined", () => {
    const store = crearConversacionEmpleadoStore();
    const conversacion = store.paraSesion("token-1");
    const conversacionIdInicial = conversacion.conversacionId();

    for (let turno = 1; turno <= CONVERSACION_MAX_TURNOS; turno++) {
      conversacion.registrarTurno(`caso-${turno}`);
    }

    const accesoTrasTecho = store.paraSesion("token-1");
    expect(accesoTrasTecho.conversacionId()).toBe(conversacionIdInicial);
    expect(accesoTrasTecho.casoAnterior()).toBe(`caso-${CONVERSACION_MAX_TURNOS}`);

    accesoTrasTecho.registrarTurno(`caso-${CONVERSACION_MAX_TURNOS + 1}`);

    const accesoQueRota = store.paraSesion("token-1");
    expect(accesoQueRota.conversacionId()).not.toBe(conversacionIdInicial);
    expect(accesoQueRota.casoAnterior()).toBeUndefined();
  });
});

describe("crearConversacionEmpleadoStore — eliminar es idempotente", () => {
  it("token existente, inexistente y ya eliminado dan el mismo resultado — sin excepción", () => {
    const store = crearConversacionEmpleadoStore();
    store.paraSesion("token-1").registrarTurno("A");

    expect(() => store.eliminar("token-1")).not.toThrow();
    expect(() => store.eliminar("token-1")).not.toThrow();
    expect(() => store.eliminar("token-inexistente")).not.toThrow();

    // Tras eliminar, un nuevo acceso al mismo token arranca de cero (no hereda memoria previa).
    expect(store.paraSesion("token-1").casoAnterior()).toBeUndefined();
  });
});

describe("crearConversacionEmpleadoStore — aislamiento entre tokens (punto obligatorio 2)", () => {
  it("dos tokens distintos nunca comparten casoAnterior(), ni con registrarTurno intercalados", () => {
    const store = crearConversacionEmpleadoStore();
    const conversacionA = store.paraSesion("token-A");
    const conversacionB = store.paraSesion("token-B");

    conversacionA.registrarTurno("caso-A1");
    conversacionB.registrarTurno("caso-B1");
    conversacionA.registrarTurno("caso-A2");

    expect(store.paraSesion("token-A").casoAnterior()).toBe("caso-A2");
    expect(store.paraSesion("token-B").casoAnterior()).toBe("caso-B1");
    expect(store.paraSesion("token-A").conversacionId()).not.toBe(store.paraSesion("token-B").conversacionId());
  });

  it("newId inyectado produce conversacionId propio por token", () => {
    const ids = crearIdsFake("conv");
    const store = crearConversacionEmpleadoStore({ newId: ids });

    expect(store.paraSesion("token-A").conversacionId()).toBe("conv-1");
    expect(store.paraSesion("token-B").conversacionId()).toBe("conv-2");
  });
});
