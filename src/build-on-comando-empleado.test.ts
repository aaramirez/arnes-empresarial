/**
 * Tests de `buildOnComandoEmpleado` (`tui-canal-empleado`, design.md §6,
 * §10.2). TDD con dobles — sin base real, sin SDK, sin scrypt: `store`,
 * `credenciales` y `registro` son objetos planos con `vi.fn()`, `onSubmit`
 * y `onSoporte` también. La atomicidad de los CAS y el SQL en sí ya están
 * cubiertos por `repository.test.ts` (tarea 4.1) y por `build-on-venta.test.ts`
 * (tarea 6.1, ADR 41) — este archivo verifica el RUTEO de los ocho
 * comandos, las dos ranuras del closure y el orden de evaluación (§6.3).
 */
import { describe, expect, it, vi } from "vitest";
import type Database from "better-sqlite3";
import { buildOnComandoEmpleado, type BuildOnComandoEmpleadoDeps } from "./build-on-comando-empleado.js";
import { COMANDOS } from "./core/commands/comando-empleado.js";
import {
  VENTA_ESTADO_CONFIRMADA,
  VENTA_ESTADO_REEMBOLSADA,
  type EscalacionListada,
  type Venta,
  type VentaStorePort,
} from "./core/ventas/ventas-contract.js";
import type { VentasConfig } from "./core/ventas/ventas-config.js";
import type { AuthConfig } from "./core/auth/auth-config.js";
import type { CredencialesEmpleadoPort } from "./core/auth/credenciales-contract.js";
import type { RegistroAccionesEmpleadoPort } from "./core/commands/registro-acciones-contract.js";
import {
  SOLICITUD_ESTADO_APROBADA,
  SOLICITUD_ESTADO_PENDIENTE,
  type SolicitudInterna,
  type SolicitudStorePort,
} from "./core/solicitudes/solicitudes-contract.js";
import type { DespacharDelegacionDeps } from "./core/turn-selector/dispatch-delegation.js";
import { getSubagentDefinition } from "./core/agents/definitions.js";
import { createHookEngine } from "./core/hooks/hook-engine.js";
import type { SoporteResult } from "./build-on-soporte.js";
import type { SubmitPromptHandler, TuiTurnResult } from "./adapters/tui/tui-port.js";

const TIMESTAMP = "2026-01-01T00:00:00.000Z";
const PASSWORD = "secreto-super-largo-123";

function fakeDb(): Database.Database {
  return {} as unknown as Database.Database;
}

function makeVenta(overrides: Partial<Venta> = {}): Venta {
  return {
    id: "venta-1",
    vendedorId: "vend-1",
    clienteId: "cliente-1",
    planNuevo: "plan-x",
    monto: 100,
    estado: VENTA_ESTADO_CONFIRMADA,
    casoId: "caso-1",
    tokenConfirmacion: "tok-1",
    createdAt: TIMESTAMP,
    ...overrides,
  };
}

function makeEscalacion(overrides: Partial<EscalacionListada> = {}): EscalacionListada {
  return {
    ventaId: "v-1",
    vendedorId: "vend-1",
    vendedorNombre: "Ana Vendedora",
    clienteId: "cliente-1",
    monto: 100,
    casoId: "caso-1",
    reaperturasPrevias: 0,
    ...overrides,
  };
}

function makeStore(overrides: Partial<VentaStorePort> = {}): VentaStorePort {
  return {
    crearVentaConCaso: vi.fn(() => makeVenta()),
    buscarVentaPorToken: vi.fn(() => undefined),
    confirmarVentaConComision: vi.fn(() => undefined),
    rechazarVenta: vi.fn(() => undefined),
    aprobarReembolso: vi.fn(() => undefined),
    escalarReembolso: vi.fn(() => undefined),
    listarReembolsosPendientes: vi.fn(() => []),
    listarReembolsosRechazados: vi.fn(() => []),
    aprobarEscalacionReembolso: vi.fn(() => undefined),
    rechazarEscalacionReembolso: vi.fn(() => undefined),
    reabrirEscalacionReembolso: vi.fn(() => undefined),
    ...overrides,
  };
}

function makeCredenciales(overrides: Partial<CredencialesEmpleadoPort> = {}): CredencialesEmpleadoPort {
  return {
    buscarCredencial: vi.fn(() => ({ empleadoId: "ana", passwordHash: "scrypt$hash" })),
    ...overrides,
  };
}

function makeRegistro(overrides: Partial<RegistroAccionesEmpleadoPort> = {}): RegistroAccionesEmpleadoPort {
  return {
    registrarAccion: vi.fn(),
    ...overrides,
  };
}

function makeConfig(overrides: Partial<VentasConfig> = {}): VentasConfig {
  return { comisionPorcentaje: 0.1, reembolsoUmbral: 500, tokenTtlHoras: 72, ...overrides };
}

function makeAuthConfig(overrides: Partial<AuthConfig> = {}): AuthConfig {
  return { sesionTtlMinutos: 30, ...overrides };
}

function makeSolicitudCreada(overrides: Partial<SolicitudInterna> = {}): SolicitudInterna {
  return {
    id: "sol-1",
    casoId: "caso-sol-1",
    solicitanteId: "ana",
    tipo: "vacaciones",
    detalle: "una semana en marzo",
    estado: SOLICITUD_ESTADO_PENDIENTE,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    ...overrides,
  };
}

function makeSolicitudStore(overrides: Partial<SolicitudStorePort> = {}): SolicitudStorePort {
  return {
    crearSolicitudConCaso: vi.fn(() => makeSolicitudCreada()),
    adjuntarDictamen: vi.fn(() => undefined),
    listarSolicitudesPendientes: vi.fn(() => []),
    aprobarSolicitud: vi.fn(() => undefined),
    rechazarSolicitud: vi.fn(() => undefined),
    ...overrides,
  };
}

function makeDespacharDeps(overrides: Partial<DespacharDelegacionDeps> = {}): DespacharDelegacionDeps {
  return {
    store: { crearDelegacion: vi.fn(), completarDelegacion: vi.fn() },
    invocar: vi.fn(async () => ({ responseText: "cumple las reglas", sdkSessionId: "sdk-validador" })),
    getSubagente: getSubagentDefinition,
    newId: () => "id-generado",
    now: () => TIMESTAMP,
    logEvent: vi.fn(),
    ...overrides,
  };
}

interface Reloj {
  ahora: string;
}

function makeDeps(
  reloj: Reloj,
  overrides: Partial<BuildOnComandoEmpleadoDeps> & { readonly writes?: string[] } = {},
): BuildOnComandoEmpleadoDeps {
  const { writes, ...rest } = overrides;
  const logDeps = { now: () => reloj.ahora, write: (line: string) => writes?.push(line) };
  return {
    onSubmit: vi.fn(async () => ({ responseText: "conversacional", agentLabel: "conversacional" })),
    onSoporte: vi.fn(async (): Promise<SoporteResult> => ({ casoId: "caso-soporte-1", respuesta: "listo" })),
    db: fakeDb(),
    ventasConfig: makeConfig(),
    authConfig: makeAuthConfig(),
    verificarPassword: vi.fn(() => true),
    dummyPasswordHash: "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    store: makeStore(),
    credenciales: makeCredenciales(),
    registro: makeRegistro(),
    solicitudStore: makeSolicitudStore(),
    despacharDeps: makeDespacharDeps(),
    hooks: createHookEngine(),
    now: () => reloj.ahora,
    logDeps,
    ...rest,
  };
}

async function login(
  handler: SubmitPromptHandler,
  empleadoId = "ana",
  password = PASSWORD,
): Promise<TuiTurnResult> {
  return handler(`/login ${empleadoId} ${password}`);
}

describe("buildOnComandoEmpleado — delegación al camino conversacional", () => {
  it("un texto sin '/' llega a onSubmit IDÉNTICO, con el mismo onAgentResolved, y el resultado se devuelve sin tocar", async () => {
    const reloj: Reloj = { ahora: TIMESTAMP };
    const sentinel: TuiTurnResult = { responseText: "respuesta del núcleo", agentLabel: "conversacional" };
    const onSubmit = vi.fn(async () => sentinel);
    const deps = makeDeps(reloj, { onSubmit });
    const handler = buildOnComandoEmpleado(deps);
    const onAgentResolved = vi.fn();

    const resultado = await handler("hola, ¿cómo estás?", onAgentResolved);

    expect(onSubmit).toHaveBeenCalledWith("hola, ¿cómo estás?", onAgentResolved);
    expect(resultado).toBe(sentinel);
  });
});

describe("buildOnComandoEmpleado — /ayuda y comandos malformados", () => {
  it("/ayuda responde con agentLabel sistema y cero llamadas a store/registro/onSoporte", async () => {
    const reloj: Reloj = { ahora: TIMESTAMP };
    const store = makeStore();
    const registro = makeRegistro();
    const onSoporte = vi.fn();
    const deps = makeDeps(reloj, { store, registro, onSoporte });
    const handler = buildOnComandoEmpleado(deps);

    const resultado = await handler("/ayuda");

    expect(resultado.agentLabel).toBe("sistema");
    expect(resultado.responseText).toContain("/login");
    expect(store.crearVentaConCaso).not.toHaveBeenCalled();
    expect(registro.registrarAccion).not.toHaveBeenCalled();
    expect(onSoporte).not.toHaveBeenCalled();
  });

  it("comando desconocido cae en ayuda/desconocido, con el primer token solo", async () => {
    const reloj: Reloj = { ahora: TIMESTAMP };
    const writes: string[] = [];
    const deps = makeDeps(reloj, { writes });
    const handler = buildOnComandoEmpleado(deps);

    const resultado = await handler("/logni ana secreto");

    expect(resultado.agentLabel).toBe("sistema");
    expect(resultado.responseText).toContain("/logni");
    expect(JSON.stringify(writes)).not.toContain("secreto");
  });

  it("argumentos faltantes ('/login ana') responde con el uso del comando", async () => {
    const reloj: Reloj = { ahora: TIMESTAMP };
    const deps = makeDeps(reloj);
    const handler = buildOnComandoEmpleado(deps);

    const resultado = await handler("/login ana");

    expect(resultado.agentLabel).toBe("sistema");
    expect(resultado.responseText).toContain("Uso:");
    expect(resultado.responseText).toContain("/login");
  });
});

describe("buildOnComandoEmpleado — sin sesión", () => {
  it("los tres comandos privilegiados piden /login, sin tocar el store", async () => {
    const reloj: Reloj = { ahora: TIMESTAMP };
    const store = makeStore();
    const writes: string[] = [];
    const deps = makeDeps(reloj, { store, writes });
    const handler = buildOnComandoEmpleado(deps);

    for (const texto of ["/aprobar-reembolso", "/rechazar-reembolso v-1", "/reabrir-reembolso"]) {
      const resultado = await handler(texto);
      expect(resultado.agentLabel).toBe("sistema");
      expect(resultado.responseText).toContain("/login");
    }

    expect(store.listarReembolsosPendientes).not.toHaveBeenCalled();
    expect(store.listarReembolsosRechazados).not.toHaveBeenCalled();
    expect(JSON.stringify(writes)).toContain("comando-privilegiado-sin-sesion");
  });

  it("/soporte y /devolucion funcionan igual sin sesión, pero no dejan fila y loguean accion-empleado-sin-sesion", async () => {
    const reloj: Reloj = { ahora: TIMESTAMP };
    const registro = makeRegistro();
    const onSoporte = vi.fn(async (): Promise<SoporteResult> => ({ casoId: "caso-1", respuesta: "hola" }));
    const writes: string[] = [];
    const deps = makeDeps(reloj, { registro, onSoporte, writes });
    const handler = buildOnComandoEmpleado(deps);

    const rSoporte = await handler("/soporte necesito ayuda");
    expect(rSoporte).toEqual({ responseText: "hola", agentLabel: "soporte" });

    const rDevolucion = await handler("/devolucion token-inexistente");
    expect(rDevolucion.agentLabel).toBe("sistema");

    expect(registro.registrarAccion).not.toHaveBeenCalled();
    expect(JSON.stringify(writes)).toContain("accion-empleado-sin-sesion");
  });
});

describe("buildOnComandoEmpleado — /login", () => {
  it("exitoso: abre sesión, deja fila ('/login','exitosa') con venta_id/caso_id NULL", async () => {
    const reloj: Reloj = { ahora: TIMESTAMP };
    const registro = makeRegistro();
    const deps = makeDeps(reloj, { registro, verificarPassword: vi.fn(() => true) });
    const handler = buildOnComandoEmpleado(deps);

    const resultado = await login(handler);

    expect(resultado.responseText).toContain("Sesión abierta como ana");
    expect(registro.registrarAccion).toHaveBeenCalledTimes(1);
    const fila = vi.mocked(registro.registrarAccion).mock.calls[0]?.[0];
    expect(fila).toMatchObject({ comando: "/login", resultado: "exitosa", empleadoId: "ana" });
    expect(fila?.ventaId).toBeUndefined();
    expect(fila?.casoId).toBeUndefined();
  });

  it("fallido (password incorrecta) y fallido (empleado inexistente) dan el MISMO mensaje genérico, sin fila", async () => {
    const reloj: Reloj = { ahora: TIMESTAMP };
    const registro = makeRegistro();

    const deps1 = makeDeps(reloj, { registro, verificarPassword: vi.fn(() => false) });
    const r1 = await login(buildOnComandoEmpleado(deps1));

    const deps2 = makeDeps(reloj, {
      registro,
      credenciales: makeCredenciales({ buscarCredencial: vi.fn(() => undefined) }),
    });
    const r2 = await login(buildOnComandoEmpleado(deps2), "fantasma");

    expect(r1.responseText).toBe(r2.responseText);
    expect(r1.responseText).toContain("Credenciales inválidas");
    expect(registro.registrarAccion).not.toHaveBeenCalled();
  });

  it("fuga de secretos: ni la fila ni los eventos loguean la contraseña, tras un login exitoso y uno fallido", async () => {
    const reloj: Reloj = { ahora: TIMESTAMP };
    const registro = makeRegistro();
    const writes: string[] = [];
    const deps = makeDeps(reloj, { registro, writes, verificarPassword: vi.fn(() => false) });
    const handler = buildOnComandoEmpleado(deps);

    await login(handler, "ana", PASSWORD);
    await handler(`/login otro ${PASSWORD}-distinto`);

    const filas = vi.mocked(registro.registrarAccion).mock.calls.map((c) => c[0]);
    expect(JSON.stringify(filas)).not.toContain(PASSWORD);
    expect(JSON.stringify(writes)).not.toContain(PASSWORD);
  });
});

describe("buildOnComandoEmpleado — con sesión", () => {
  it("/soporte y /devolucion dejan fila con el empleado_id DE LA SESIÓN", async () => {
    const reloj: Reloj = { ahora: TIMESTAMP };
    const registro = makeRegistro();
    const store = makeStore({
      buscarVentaPorToken: vi.fn(() => makeVenta({ estado: VENTA_ESTADO_CONFIRMADA, monto: 100 })),
      aprobarReembolso: vi.fn(() => makeVenta({ estado: VENTA_ESTADO_REEMBOLSADA })),
    });
    const deps = makeDeps(reloj, { registro, store, verificarPassword: vi.fn(() => true) });
    const handler = buildOnComandoEmpleado(deps);

    await login(handler);
    await handler("/soporte necesito ayuda");
    await handler("/devolucion tok-1");

    const filas = vi.mocked(registro.registrarAccion).mock.calls.map((c) => c[0]);
    expect(filas.some((f) => f.comando === "/soporte" && f.empleadoId === "ana")).toBe(true);
    expect(filas.some((f) => f.comando === "/devolucion" && f.empleadoId === "ana" && f.resultado === "reembolsada")).toBe(
      true,
    );
  });
});

describe("buildOnComandoEmpleado — resolución de escalaciones en dos pasos", () => {
  function depsConEscalacionPendiente(reloj: Reloj, overrides: Partial<BuildOnComandoEmpleadoDeps> = {}) {
    const venta = makeEscalacion({ ventaId: "v-1", monto: 250, casoId: "caso-9" });
    const registro = makeRegistro();
    const store = makeStore({
      listarReembolsosPendientes: vi.fn(() => [venta]),
      aprobarEscalacionReembolso: vi.fn(() => makeVenta({ id: "v-1", estado: VENTA_ESTADO_REEMBOLSADA })),
    });
    return { deps: makeDeps(reloj, { store, registro, verificarPassword: vi.fn(() => true), ...overrides }), store, registro };
  }

  it("primer /aprobar-reembolso v-1: eco con el monto y CERO escrituras; segundo: ejecuta UNA vez", async () => {
    const reloj: Reloj = { ahora: TIMESTAMP };
    const { deps, store } = depsConEscalacionPendiente(reloj);
    const handler = buildOnComandoEmpleado(deps);
    await login(handler);

    const primero = await handler("/aprobar-reembolso v-1");
    expect(primero.responseText).toContain("250.00");
    expect(primero.responseText.toLowerCase()).toContain("confirm");
    expect(store.aprobarEscalacionReembolso).not.toHaveBeenCalled();

    const segundo = await handler("/aprobar-reembolso v-1");
    expect(store.aprobarEscalacionReembolso).toHaveBeenCalledTimes(1);
    expect(segundo.responseText).toContain("v-1");

    const tercero = await handler("/aprobar-reembolso v-1");
    expect(tercero.responseText.toLowerCase()).toContain("confirm");
    expect(store.aprobarEscalacionReembolso).toHaveBeenCalledTimes(1);
  });

  it("la confirmación NO sobrevive a /logout", async () => {
    const reloj: Reloj = { ahora: TIMESTAMP };
    const { deps, store } = depsConEscalacionPendiente(reloj);
    const handler = buildOnComandoEmpleado(deps);
    await login(handler);
    await handler("/aprobar-reembolso v-1");

    await handler("/logout");
    await login(handler);
    await handler("/aprobar-reembolso v-1");

    expect(store.aprobarEscalacionReembolso).not.toHaveBeenCalled();
  });

  it("la confirmación NO sobrevive a un /login (mismo o distinto empleado)", async () => {
    const reloj: Reloj = { ahora: TIMESTAMP };
    const { deps, store } = depsConEscalacionPendiente(reloj);
    const handler = buildOnComandoEmpleado(deps);
    await login(handler);
    await handler("/aprobar-reembolso v-1");

    await login(handler);
    await handler("/aprobar-reembolso v-1");

    expect(store.aprobarEscalacionReembolso).not.toHaveBeenCalled();
  });

  it("la confirmación NO sobrevive a un /login FALLIDO (cierra la sesión anterior)", async () => {
    const reloj: Reloj = { ahora: TIMESTAMP };
    const { deps, store } = depsConEscalacionPendiente(reloj);
    const handler = buildOnComandoEmpleado(deps);
    await login(handler);
    await handler("/aprobar-reembolso v-1");

    vi.mocked(deps.verificarPassword).mockReturnValueOnce(false);
    await handler(`/login ana ${PASSWORD}`);

    // Sin sesión ahora (login falló): el privilegiado pide /login, no ejecuta.
    const resultado = await handler("/aprobar-reembolso v-1");
    expect(resultado.responseText).toContain("/login");
    expect(store.aprobarEscalacionReembolso).not.toHaveBeenCalled();
  });

  it("la confirmación NO sobrevive a la expiración de la SESIÓN (reloj avanzado)", async () => {
    const reloj: Reloj = { ahora: TIMESTAMP };
    const { deps, store } = depsConEscalacionPendiente(reloj, { authConfig: makeAuthConfig({ sesionTtlMinutos: 1 }) });
    const handler = buildOnComandoEmpleado(deps);
    await login(handler);
    await handler("/aprobar-reembolso v-1");

    reloj.ahora = "2026-01-01T00:05:00.000Z"; // +5 min > TTL de sesión (1 min)
    const resultado = await handler("/aprobar-reembolso v-1");

    expect(resultado.responseText).toContain("/login");
    expect(store.aprobarEscalacionReembolso).not.toHaveBeenCalled();
  });

  it("la confirmación NO sobrevive a su propio vencimiento (2 min) con la sesión viva", async () => {
    const reloj: Reloj = { ahora: TIMESTAMP };
    const { deps, store } = depsConEscalacionPendiente(reloj);
    const handler = buildOnComandoEmpleado(deps);
    await login(handler);
    await handler("/aprobar-reembolso v-1");

    reloj.ahora = "2026-01-01T00:03:00.000Z"; // +3 min > TTL de confirmación (2 min), sesión (30 min) sigue viva
    const resultado = await handler("/aprobar-reembolso v-1");

    expect(resultado.responseText.toLowerCase()).toContain("confirm");
    expect(store.aprobarEscalacionReembolso).not.toHaveBeenCalled();
  });

  it("la confirmación NO sobrevive a su propia ejecución: un tercer comando idéntico vuelve a pedir confirmación", async () => {
    const reloj: Reloj = { ahora: TIMESTAMP };
    const { deps, store } = depsConEscalacionPendiente(reloj);
    const handler = buildOnComandoEmpleado(deps);
    await login(handler);
    await handler("/aprobar-reembolso v-1");
    await handler("/aprobar-reembolso v-1"); // ejecuta

    const tercero = await handler("/aprobar-reembolso v-1");
    expect(tercero.responseText.toLowerCase()).toContain("confirm");
    expect(store.aprobarEscalacionReembolso).toHaveBeenCalledTimes(1);
  });

  it("confirmación cruzada: preparo v-1, preparo v-2, confirmo v-1 -> eco de v-1 otra vez, sin ejecutar", async () => {
    const reloj: Reloj = { ahora: TIMESTAMP };
    const ventaV1 = makeEscalacion({ ventaId: "v-1", monto: 100, casoId: "caso-1" });
    const ventaV2 = makeEscalacion({ ventaId: "v-2", monto: 200, casoId: "caso-2" });
    const store = makeStore({
      listarReembolsosPendientes: vi.fn((filtro?: { readonly ventaId?: string }) =>
        filtro?.ventaId === "v-2" ? [ventaV2] : [ventaV1],
      ),
    });
    const deps = makeDeps(reloj, { store, verificarPassword: vi.fn(() => true) });
    const handler = buildOnComandoEmpleado(deps);
    await login(handler);

    await handler("/aprobar-reembolso v-1");
    await handler("/aprobar-reembolso v-2");
    const resultado = await handler("/aprobar-reembolso v-1");

    expect(resultado.responseText.toLowerCase()).toContain("confirm");
    expect(store.aprobarEscalacionReembolso).not.toHaveBeenCalled();
  });

  it("acción cruzada: preparo aprobar v-1, escribo rechazar v-1 -> eco del rechazo, NO ejecuta la aprobación", async () => {
    const reloj: Reloj = { ahora: TIMESTAMP };
    const venta = makeEscalacion({ ventaId: "v-1", monto: 100, casoId: "caso-1" });
    const store = makeStore({
      listarReembolsosPendientes: vi.fn(() => [venta]),
    });
    const deps = makeDeps(reloj, { store, verificarPassword: vi.fn(() => true) });
    const handler = buildOnComandoEmpleado(deps);
    await login(handler);

    await handler("/aprobar-reembolso v-1");
    const resultado = await handler("/rechazar-reembolso v-1");

    expect(resultado.responseText.toLowerCase()).toContain("confirm");
    expect(store.aprobarEscalacionReembolso).not.toHaveBeenCalled();
    expect(store.rechazarEscalacionReembolso).not.toHaveBeenCalled();
  });
});

describe("buildOnComandoEmpleado — ADR 40 (fila no transaccional no tumba el comando)", () => {
  it("/devolucion responde su resultado normal aunque registrarAccion lance, y emite accion-empleado-registro-fallido", async () => {
    const reloj: Reloj = { ahora: TIMESTAMP };
    const registro = makeRegistro({
      registrarAccion: vi.fn(() => {
        throw new Error("disco lleno");
      }),
    });
    const store = makeStore({
      buscarVentaPorToken: vi.fn(() => makeVenta({ estado: VENTA_ESTADO_CONFIRMADA, monto: 100 })),
      aprobarReembolso: vi.fn(() => makeVenta({ estado: VENTA_ESTADO_REEMBOLSADA })),
    });
    const writes: string[] = [];
    const deps = makeDeps(reloj, { registro, store, writes, verificarPassword: vi.fn(() => true) });
    const handler = buildOnComandoEmpleado(deps);
    await login(handler);

    const resultado = await handler("/devolucion tok-1");

    expect(resultado.responseText).toContain("reembolsada");
    expect(JSON.stringify(writes)).toContain("accion-empleado-registro-fallido");
  });
});

describe("buildOnComandoEmpleado — el guard de privilegio tiene UNA sola fuente de verdad", () => {
  /**
   * Reproduce el hallazgo: hoy el guard compara contra un `Set` hardcodeado
   * (`TIPOS_PRIVILEGIADOS`) en lugar de leer el campo `privilegiado` que
   * cada descriptor de `DESCRIPTORES` (comando-empleado.ts) ya expone. Si
   * un comando se marca `privilegiado: true` en `DESCRIPTORES` pero el
   * `Set` paralelo no se actualiza, el guard NO lo protege — "CERO
   * escrituras sin sesión" se rompe en silencio.
   *
   * Este test NO agrega un comando nuevo (el tipo `ComandoEmpleado["tipo"]`
   * es una unión cerrada): en cambio, muta en caliente el descriptor real
   * de `/logout` (hoy `privilegiado: false`) a `true` — el MISMO objeto que
   * usa el parser, porque `COMANDOS` es la misma referencia que
   * `DESCRIPTORES` puertas adentro. Si el guard consulta ese campo
   * directamente, un comando que pasa a ser privilegiado queda protegido
   * sin tocar `build-on-comando-empleado.ts`. Si el guard usa una lista
   * paralela, la mutación no tiene ningún efecto — RED.
   */
  it("si /logout pasara a privilegiado: true en DESCRIPTORES, el guard lo bloquearía sin tocar el guard", async () => {
    const descriptorLogout = COMANDOS.find((d) => d.nombre === "/logout");
    expect(descriptorLogout).toBeDefined();
    const original = descriptorLogout!.privilegiado;
    (descriptorLogout as { privilegiado: boolean }).privilegiado = true;

    try {
      const reloj: Reloj = { ahora: TIMESTAMP };
      const deps = makeDeps(reloj);
      const handler = buildOnComandoEmpleado(deps);

      const resultado = await handler("/logout");

      expect(resultado.responseText).toContain("sesión activa");
    } finally {
      (descriptorLogout as { privilegiado: boolean }).privilegiado = original;
    }
  });
});

describe("buildOnComandoEmpleado — /solicitar (alta de solicitud interna, Hito 5 tarea 22)", () => {
  it("sin sesión vigente se rechaza sin tocar solicitudStore ni despacharDeps.invocar", async () => {
    const reloj: Reloj = { ahora: TIMESTAMP };
    const solicitudStore = makeSolicitudStore();
    const despacharDeps = makeDespacharDeps();
    const deps = makeDeps(reloj, { solicitudStore, despacharDeps });
    const handler = buildOnComandoEmpleado(deps);

    const resultado = await handler('/solicitar vacaciones "una semana en marzo"');

    expect(resultado.agentLabel).toBe("sistema");
    expect(resultado.responseText).toContain("/login");
    expect(solicitudStore.crearSolicitudConCaso).not.toHaveBeenCalled();
    expect(despacharDeps.invocar).not.toHaveBeenCalled();
  });

  it("tipo desconocido: responde el aviso, sin crear nada, sin delegar y sin dejar fila de registro", async () => {
    const reloj: Reloj = { ahora: TIMESTAMP };
    const solicitudStore = makeSolicitudStore();
    const despacharDeps = makeDespacharDeps();
    const registro = makeRegistro();
    const deps = makeDeps(reloj, {
      solicitudStore,
      despacharDeps,
      registro,
      verificarPassword: vi.fn(() => true),
    });
    const handler = buildOnComandoEmpleado(deps);
    await login(handler);

    vi.mocked(registro.registrarAccion).mockClear(); // limpia la fila de /login del `login(handler)` de arriba

    const resultado = await handler('/solicitar reembolso-inventado "algo"');

    expect(resultado.agentLabel).toBe("sistema");
    expect(resultado.responseText).toContain("reembolso-inventado");
    expect(solicitudStore.crearSolicitudConCaso).not.toHaveBeenCalled();
    expect(despacharDeps.invocar).not.toHaveBeenCalled();
    expect(registro.registrarAccion).not.toHaveBeenCalled();
  });

  it("alta válida con dictamen exitoso: crea la solicitud, delega al validador y deja fila ('/solicitar','creada') con el caso_id real", async () => {
    const reloj: Reloj = { ahora: TIMESTAMP };
    const solicitudConDictamen = makeSolicitudCreada({ dictamen: "cumple las reglas" });
    const solicitudStore = makeSolicitudStore({
      crearSolicitudConCaso: vi.fn(() => makeSolicitudCreada()),
      adjuntarDictamen: vi.fn(() => solicitudConDictamen),
    });
    const invocar = vi.fn(async () => ({ responseText: "cumple las reglas", sdkSessionId: "sdk-validador" }));
    const despacharDeps = makeDespacharDeps({ invocar });
    const registro = makeRegistro();
    const deps = makeDeps(reloj, {
      solicitudStore,
      despacharDeps,
      registro,
      verificarPassword: vi.fn(() => true),
    });
    const handler = buildOnComandoEmpleado(deps);
    await login(handler);
    vi.mocked(registro.registrarAccion).mockClear(); // limpia la fila de /login

    const resultado = await handler('/solicitar vacaciones "una semana en marzo"');

    expect(solicitudStore.crearSolicitudConCaso).toHaveBeenCalledTimes(1);
    expect(invocar).toHaveBeenCalledTimes(1);
    expect(resultado.agentLabel).toBe("sistema");
    expect(resultado.responseText).toContain("sol-1");
    expect(resultado.responseText).toContain("cumple las reglas");

    expect(registro.registrarAccion).toHaveBeenCalledTimes(1);
    const fila = vi.mocked(registro.registrarAccion).mock.calls[0]?.[0];
    expect(fila).toMatchObject({
      comando: "/solicitar",
      resultado: "creada",
      casoId: "caso-sol-1",
      empleadoId: "ana",
    });
  });

  it("delegación al validador fallida: degrada a evento (ADR 40), igual responde 'creada' sin dictamen y deja fila", async () => {
    const reloj: Reloj = { ahora: TIMESTAMP };
    const solicitudStore = makeSolicitudStore();
    const despacharDeps = makeDespacharDeps({
      invocar: vi.fn(async () => {
        throw new Error("el validador no respondió");
      }),
    });
    const registro = makeRegistro();
    const deps = makeDeps(reloj, {
      solicitudStore,
      despacharDeps,
      registro,
      verificarPassword: vi.fn(() => true),
    });
    const handler = buildOnComandoEmpleado(deps);
    await login(handler);
    vi.mocked(registro.registrarAccion).mockClear(); // limpia la fila de /login

    const resultado = await handler('/solicitar vacaciones "una semana en marzo"');

    expect(resultado.agentLabel).toBe("sistema");
    expect(resultado.responseText).toContain("sol-1");
    expect(resultado.responseText).toContain("Sin dictamen");
    expect(solicitudStore.adjuntarDictamen).not.toHaveBeenCalled();
    expect(registro.registrarAccion).toHaveBeenCalledTimes(1);
    const fila = vi.mocked(registro.registrarAccion).mock.calls[0]?.[0];
    expect(fila).toMatchObject({ comando: "/solicitar", resultado: "creada", casoId: "caso-sol-1" });
  });
});

describe("buildOnComandoEmpleado — ADR 55 (ConfirmacionPendiente ensanchada por dominio, ranura única)", () => {
  /**
   * Nota de alcance declarada (tarea 22, mismo criterio que la tarea 12
   * diferido a la tarea 14 y la tarea 20 diferido el error de typecheck):
   * el texto de `tasks.md` tarea 22 pide "armar una confirmación de
   * reembolso y después una de `/solicitar` pisa la ranura única (test
   * explícito del ADR 55)". Verificado contra design.md §4.2: `/solicitar`
   * es de UN SOLO PASO (sesión vigente exigida, sin eco/confirmación) y
   * NUNCA construye ni compara `confirmacionPendiente` — a diferencia de
   * `/devolucion`, que tampoco la toca. La rama `dominio: "solicitud"` de
   * la unión (ADR 55) la escriben `/aprobar-solicitud`/`/rechazar-solicitud`
   * (tarea 23, todavía sin implementar); no hay forma de construir un
   * `confirmacionPendiente` real con `dominio: "solicitud"` sin ese caso de
   * uso. Por eso este test verifica lo que el código REALMENTE hace hoy:
   * una confirmación de reembolso pendiente SOBREVIVE intacta a un
   * `/solicitar` de por medio (dominios distintos, `/solicitar` no toca la
   * ranura) — y de paso confirma que el ensanchamiento del tipo no
   * regresionó el camino `dominio: "reembolso"`. El test cruzado real
   * ("armar un reembolso y después una SOLICITUD pisa la ranura") queda
   * para la tarea 23, cuando `dominio: "solicitud"` tenga un escritor real.
   */
  it("una confirmación de reembolso pendiente sobrevive a un /solicitar exitoso de por medio", async () => {
    const reloj: Reloj = { ahora: TIMESTAMP };
    const venta = makeEscalacion({ ventaId: "v-1", monto: 250, casoId: "caso-9" });
    const store = makeStore({
      listarReembolsosPendientes: vi.fn(() => [venta]),
      aprobarEscalacionReembolso: vi.fn(() => makeVenta({ id: "v-1", estado: VENTA_ESTADO_REEMBOLSADA })),
    });
    const solicitudStore = makeSolicitudStore();
    const despacharDeps = makeDespacharDeps();
    const deps = makeDeps(reloj, { store, solicitudStore, despacharDeps, verificarPassword: vi.fn(() => true) });
    const handler = buildOnComandoEmpleado(deps);
    await login(handler);

    const eco = await handler("/aprobar-reembolso v-1");
    expect(eco.responseText.toLowerCase()).toContain("confirm");

    await handler('/solicitar vacaciones "una semana en marzo"');

    const confirmacion = await handler("/aprobar-reembolso v-1");
    expect(store.aprobarEscalacionReembolso).toHaveBeenCalledTimes(1);
    expect(confirmacion.responseText).toContain("v-1");
  });
});

describe("buildOnComandoEmpleado — resolución de solicitudes en dos pasos (Hito 5, tarea 23)", () => {
  function depsConSolicitudPendiente(reloj: Reloj, overrides: Partial<BuildOnComandoEmpleadoDeps> = {}) {
    const solicitud = makeSolicitudCreada({ id: "sol-1", casoId: "caso-sol-9" });
    const registro = makeRegistro();
    const solicitudStore = makeSolicitudStore({
      listarSolicitudesPendientes: vi.fn(() => [solicitud]),
      aprobarSolicitud: vi.fn(() => makeSolicitudCreada({ id: "sol-1", estado: SOLICITUD_ESTADO_APROBADA })),
      rechazarSolicitud: vi.fn(() => makeSolicitudCreada({ id: "sol-1", estado: "rechazada" })),
    });
    return {
      deps: makeDeps(reloj, { solicitudStore, registro, verificarPassword: vi.fn(() => true), ...overrides }),
      solicitudStore,
      registro,
    };
  }

  it("primer /aprobar-solicitud sol-1: eco y CERO escrituras; segundo: aplica el CAS sin registrar desde este archivo", async () => {
    const reloj: Reloj = { ahora: TIMESTAMP };
    const { deps, solicitudStore, registro } = depsConSolicitudPendiente(reloj);
    const handler = buildOnComandoEmpleado(deps);
    await login(handler);
    vi.mocked(registro.registrarAccion).mockClear(); // limpia la fila de /login

    const primero = await handler("/aprobar-solicitud sol-1");
    expect(primero.responseText.toLowerCase()).toContain("confirm");
    expect(solicitudStore.aprobarSolicitud).not.toHaveBeenCalled();
    expect(registro.registrarAccion).not.toHaveBeenCalled();

    const segundo = await handler("/aprobar-solicitud sol-1");
    expect(solicitudStore.aprobarSolicitud).toHaveBeenCalledTimes(1);
    expect(segundo.responseText).toContain("sol-1");
    expect(segundo.responseText).toContain("aprobada");
    // La fila ya viajó DENTRO de la transacción del repository (tarea 19) —
    // este archivo NO debe emitir una escritura extra.
    expect(registro.registrarAccion).not.toHaveBeenCalled();

    const tercero = await handler("/aprobar-solicitud sol-1");
    expect(tercero.responseText.toLowerCase()).toContain("confirm");
    expect(solicitudStore.aprobarSolicitud).toHaveBeenCalledTimes(1);
  });

  it("sin sesión vigente, /aprobar-solicitud y /rechazar-solicitud se rechazan sin tocar solicitudStore", async () => {
    const reloj: Reloj = { ahora: TIMESTAMP };
    const solicitudStore = makeSolicitudStore();
    const deps = makeDeps(reloj, { solicitudStore });
    const handler = buildOnComandoEmpleado(deps);

    for (const texto of ["/aprobar-solicitud", "/rechazar-solicitud sol-1"]) {
      const resultado = await handler(texto);
      expect(resultado.agentLabel).toBe("sistema");
      expect(resultado.responseText).toContain("/login");
    }

    expect(solicitudStore.listarSolicitudesPendientes).not.toHaveBeenCalled();
    expect(solicitudStore.aprobarSolicitud).not.toHaveBeenCalled();
    expect(solicitudStore.rechazarSolicitud).not.toHaveBeenCalled();
  });

  it("CAS no matcheado (la solicitud ya no está pendiente): responde no_aplicable y registra la fila FUERA de la transacción", async () => {
    const reloj: Reloj = { ahora: TIMESTAMP };
    const solicitud = makeSolicitudCreada({ id: "sol-1", casoId: "caso-sol-9" });
    const registro = makeRegistro();
    const solicitudStore = makeSolicitudStore({
      listarSolicitudesPendientes: vi.fn(() => [solicitud]),
      rechazarSolicitud: vi.fn(() => undefined), // el CAS no matcheó
    });
    const deps = makeDeps(reloj, { solicitudStore, registro, verificarPassword: vi.fn(() => true) });
    const handler = buildOnComandoEmpleado(deps);
    await login(handler);
    vi.mocked(registro.registrarAccion).mockClear(); // limpia la fila de /login

    await handler("/rechazar-solicitud sol-1"); // eco
    const resultado = await handler("/rechazar-solicitud sol-1"); // confirma -> el CAS pierde

    expect(resultado.responseText.toLowerCase()).toContain("no se aplicó");
    expect(registro.registrarAccion).toHaveBeenCalledTimes(1);
    const fila = vi.mocked(registro.registrarAccion).mock.calls[0]?.[0];
    expect(fila).toMatchObject({
      comando: "/rechazar-solicitud",
      resultado: "no_aplicable",
      casoId: "caso-sol-9",
      empleadoId: "ana",
    });
  });

  it("/aprobar-solicitud sin id lista las pendientes, sin escrituras", async () => {
    const reloj: Reloj = { ahora: TIMESTAMP };
    const solicitud = makeSolicitudCreada({ id: "sol-2", detalle: "gasto de viaje" });
    const registro = makeRegistro();
    const solicitudStore = makeSolicitudStore({ listarSolicitudesPendientes: vi.fn(() => [solicitud]) });
    const deps = makeDeps(reloj, { solicitudStore, registro, verificarPassword: vi.fn(() => true) });
    const handler = buildOnComandoEmpleado(deps);
    await login(handler);
    vi.mocked(registro.registrarAccion).mockClear(); // limpia la fila de /login

    const resultado = await handler("/aprobar-solicitud");

    expect(resultado.responseText).toContain("sol-2");
    expect(resultado.responseText).toContain("gasto de viaje");
    expect(solicitudStore.aprobarSolicitud).not.toHaveBeenCalled();
    expect(registro.registrarAccion).not.toHaveBeenCalled();
  });

  it("solicitudId inexistente responde que no hay ninguna solicitud, sin escrituras", async () => {
    const reloj: Reloj = { ahora: TIMESTAMP };
    const registro = makeRegistro();
    const solicitudStore = makeSolicitudStore({ listarSolicitudesPendientes: vi.fn(() => []) });
    const deps = makeDeps(reloj, { solicitudStore, registro, verificarPassword: vi.fn(() => true) });
    const handler = buildOnComandoEmpleado(deps);
    await login(handler);
    vi.mocked(registro.registrarAccion).mockClear(); // limpia la fila de /login

    const resultado = await handler("/aprobar-solicitud fantasma");

    expect(resultado.responseText).toContain("fantasma");
    expect(registro.registrarAccion).not.toHaveBeenCalled();
  });

  it("una confirmación de reembolso pendiente es PISADA por una de /aprobar-solicitud de por medio (ADR 55, deferred de la tarea 22)", async () => {
    const reloj: Reloj = { ahora: TIMESTAMP };
    const venta = makeEscalacion({ ventaId: "v-1", monto: 250, casoId: "caso-9" });
    const store = makeStore({
      listarReembolsosPendientes: vi.fn(() => [venta]),
      aprobarEscalacionReembolso: vi.fn(() => makeVenta({ id: "v-1", estado: VENTA_ESTADO_REEMBOLSADA })),
    });
    const solicitud = makeSolicitudCreada({ id: "sol-1", casoId: "caso-sol-9" });
    const solicitudStore = makeSolicitudStore({ listarSolicitudesPendientes: vi.fn(() => [solicitud]) });
    const deps = makeDeps(reloj, { store, solicitudStore, verificarPassword: vi.fn(() => true) });
    const handler = buildOnComandoEmpleado(deps);
    await login(handler);

    const ecoReembolso = await handler("/aprobar-reembolso v-1");
    expect(ecoReembolso.responseText.toLowerCase()).toContain("confirm");

    const ecoSolicitud = await handler("/aprobar-solicitud sol-1");
    expect(ecoSolicitud.responseText.toLowerCase()).toContain("confirm");

    // La ranura única quedó con dominio "solicitud": repetir el reembolso
    // vuelve a pedir eco (no coincide), no ejecuta.
    const confirmacionReembolso = await handler("/aprobar-reembolso v-1");
    expect(confirmacionReembolso.responseText.toLowerCase()).toContain("confirm");
    expect(store.aprobarEscalacionReembolso).not.toHaveBeenCalled();
  });
});
