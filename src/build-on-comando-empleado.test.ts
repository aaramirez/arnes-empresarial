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
import {
  buildOnComandoEmpleado,
  createSolicitudStore,
  type BuildOnComandoEmpleadoDeps,
} from "./build-on-comando-empleado.js";
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
import {
  COMANDO_CONSULTAR_KPI,
  COMANDO_REPORTE_COMISIONES,
  RESULTADO_ATENDIDA,
  RESULTADO_FALLIDA,
  type RegistroAccionesEmpleadoPort,
} from "./core/commands/registro-acciones-contract.js";
import { agruparReporteMensual, formatearReporteMensual } from "./core/ventas/reporte.js";
import type { ReporteStorePort } from "./core/ventas/reporte-contract.js";
import {
  SOLICITUD_ESTADO_APROBADA,
  SOLICITUD_ESTADO_CANCELADA,
  SOLICITUD_ESTADO_PENDIENTE,
  SOLICITUD_TIPO_VACACIONES,
  type SolicitudInterna,
  type SolicitudStorePort,
} from "./core/solicitudes/solicitudes-contract.js";
import {
  LINEAS_PAGINA_PATCH,
  PROPUESTA_ESTADO_APLICADA,
  PROPUESTA_ESTADO_DESCARTADA,
  PROPUESTA_ESTADO_PENDIENTE,
  type PropuestaCambio,
  type PropuestaStorePort,
} from "./core/propuestas/propuestas-contract.js";
import {
  MOTIVO_PATCH_CONFLICTO,
  MOTIVO_PATCH_ERROR_GIT,
  type AplicarPatchPort,
  type ResultadoPatch,
} from "./core/agents/worktree-contract.js";
import type { DespacharDelegacionDeps } from "./core/turn-selector/dispatch-delegation.js";
import type { DelegacionA2AStorePort } from "./core/turn-selector/dispatch-delegation-a2a.js";
import {
  TASK_STATE_COMPLETED,
  type ClienteA2APort,
  type MotivoDelegacionA2ANoCompletada,
  type ResultadoA2A,
} from "./core/agents/a2a-contract.js";
import { getSubagentDefinition } from "./core/agents/definitions.js";
import { createHookEngine } from "./core/hooks/hook-engine.js";
import type { SoporteResult } from "./build-on-soporte.js";
import type { SubmitPromptHandler, TuiTurnResult } from "./adapters/tui/tui-port.js";
import { openDatabase } from "./adapters/memory/db.js";
import {
  createCaso,
  createVentaConCaso,
  confirmarVentaConComision,
  escalarReembolso,
  listComisionesPorPeriodo,
  listVentasEnReembolsoPendiente,
} from "./adapters/memory/repository.js";

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
  return {
    comisionPorcentaje: 0.1,
    reembolsoUmbral: 500,
    tokenTtlHoras: 72,
    ventaGrandeUmbral: 5000,
    ...overrides,
  };
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

function makePropuesta(overrides: Partial<PropuestaCambio> = {}): PropuestaCambio {
  return {
    id: "prop-1",
    casoId: "caso-prop-1",
    baseCommit: "abc1234",
    ramaWorktree: "harness/caso-prop-1-uuid",
    patch: "diff --git a/foo.ts b/foo.ts\n+++ una linea",
    patchBytes: 42,
    archivos: 1,
    lineasAgregadas: 1,
    lineasEliminadas: 0,
    estado: PROPUESTA_ESTADO_PENDIENTE,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    ...overrides,
  };
}

function makePropuestaStore(overrides: Partial<PropuestaStorePort> = {}): PropuestaStorePort {
  return {
    crearPropuesta: vi.fn(() => makePropuesta()),
    obtenerPropuesta: vi.fn(() => undefined),
    listarPropuestasPendientes: vi.fn(() => []),
    aplicarPropuesta: vi.fn(() => undefined),
    descartarPropuesta: vi.fn(() => undefined),
    ...overrides,
  };
}

/** Molde de `makeStore`/`makeSolicitudStore`: `verificar`/`aplicar` en verde por default (Hito 5.1, tarea 32). */
function makeAplicarPatch(overrides: Partial<AplicarPatchPort> = {}): AplicarPatchPort {
  return {
    verificar: vi.fn(async (): Promise<ResultadoPatch> => ({ ok: true })),
    aplicar: vi.fn(async (): Promise<ResultadoPatch> => ({ ok: true })),
    ...overrides,
  };
}

/** Molde de `makeStore`/`makeAplicarPatch`: éxito por default, contra `"kpi-incidente"` (Hito 6, tarea 20). */
function makeClienteA2A(overrides: Partial<ClienteA2APort> = {}): ClienteA2APort {
  return {
    baseUrlDe: vi.fn(() => "https://kpi.example.test"),
    delegar: vi.fn(
      async (): Promise<ResultadoA2A> => ({
        ok: true,
        a2aTaskId: "task-1",
        estado: TASK_STATE_COMPLETED,
        resultado: "todo en orden",
        agenteNombre: "Agente KPI",
        endpoint: "https://kpi.example.test/rpc",
      }),
    ),
    ...overrides,
  };
}

/** Molde de `makeStore`: dos métodos, ninguno transaccional (Hito 6, tarea 20). */
function makeDelegacionA2AStore(overrides: Partial<DelegacionA2AStorePort> = {}): DelegacionA2AStorePort {
  return {
    crearDelegacionA2A: vi.fn(),
    actualizarDelegacionA2A: vi.fn(),
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
    propuestaStore: makePropuestaStore(),
    aplicarPatch: makeAplicarPatch(),
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

/**
 * Molde de `makeBaseDeps` (`build-on-soporte.test.ts`): `db` es un
 * `openDatabase(":memory:")` REAL (Hito 6, tarea 20), no un doble — porque
 * `manejarConsultarKpi` llama `createCaso(db, ...)` directo sobre
 * `repository.ts`, igual que `buildOnSoporte`. `registro`, `clienteA2A` y
 * `delegacionA2AStore` NO tienen default acá a propósito: quedan en los
 * defaults REALES de `buildOnComandoEmpleado` (closure sobre `db` /
 * `createDelegacionA2AStore(db)` / ausente) salvo que el test los
 * sobreescriba — `clienteA2A` ausente por default es exactamente el
 * escenario "A2A apagado".
 */
function makeKpiDeps(
  db: Database.Database,
  reloj: Reloj,
  overrides: Partial<BuildOnComandoEmpleadoDeps> & { readonly writes?: string[] } = {},
): BuildOnComandoEmpleadoDeps {
  const { writes, ...rest } = overrides;
  const logDeps = { now: () => reloj.ahora, write: (line: string) => writes?.push(line) };
  return {
    onSubmit: vi.fn(async () => ({ responseText: "conversacional", agentLabel: "conversacional" })),
    onSoporte: vi.fn(async (): Promise<SoporteResult> => ({ casoId: "caso-soporte-1", respuesta: "listo" })),
    db,
    ventasConfig: makeConfig(),
    authConfig: makeAuthConfig(),
    verificarPassword: vi.fn(() => true),
    dummyPasswordHash: "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    store: makeStore(),
    credenciales: makeCredenciales(),
    solicitudStore: makeSolicitudStore(),
    propuestaStore: makePropuestaStore(),
    aplicarPatch: makeAplicarPatch(),
    despacharDeps: makeDespacharDeps(),
    hooks: createHookEngine(),
    now: () => reloj.ahora,
    logDeps,
    ...rest,
  };
}

function contarFilasRegistro(db: Database.Database, comando: string): number {
  const row = db
    .prepare("SELECT count(*) as total FROM registro_acciones_empleado WHERE comando = ?")
    .get(comando) as { total: number };
  return row.total;
}

function contarCasos(db: Database.Database): number {
  const row = db.prepare("SELECT count(*) as total FROM casos").get() as { total: number };
  return row.total;
}

/** Molde de `makeStore`/`makeSolicitudStore`: spy en las dos lecturas (comando-reporte-comisiones, tarea 4). */
function makeReporteStore(overrides: Partial<ReporteStorePort> = {}): ReporteStorePort {
  return {
    listComisionesPorPeriodo: vi.fn(() => []),
    listVentasEnReembolsoPendiente: vi.fn(() => []),
    ...overrides,
  };
}

/** Snapshot de las tres tablas de negocio — usado para afirmar que `/reporte-comisiones` no escribe nada de negocio. */
function snapshotTablasNegocio(db: Database.Database): {
  readonly ventas: unknown;
  readonly comisiones: unknown;
  readonly casos: unknown;
} {
  return {
    ventas: db.prepare("SELECT * FROM ventas ORDER BY id").all(),
    comisiones: db.prepare("SELECT * FROM comisiones ORDER BY id").all(),
    casos: db.prepare("SELECT * FROM casos ORDER BY id").all(),
  };
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

describe("buildOnComandoEmpleado — /ver-propuesta (Hito 5.1, tarea 31, ADR 60 pto 1, ADR 69)", () => {
  /**
   * Nota de alcance declarada (tarea 31, mismo criterio que la nota de la
   * tarea 22 más arriba): `ConfirmacionPendiente` gana acá la tercera rama
   * `dominio: "propuesta"` — ensancha el TIPO, verificado por
   * `npx tsc --noEmit` sobre todo el archivo — pero `manejarVerPropuesta` es
   * de UN SOLO PASO, sin confirmación, y NUNCA construye ni compara esa
   * rama (igual que `/solicitar` con `dominio: "solicitud"` en su momento).
   * No existe, dentro del alcance de esta tarea, ningún comando que ESCRIBA
   * `confirmacionPendiente` con `dominio: "propuesta"` — ese escritor real
   * es `manejarResolucionPropuesta` (`/aplicar-propuesta`/`/descartar-propuesta`),
   * explícitamente diferido a la tarea 32. El test cruzado real ("armar una
   * confirmación de propuesta pisa una de reembolso/solicitud, y viceversa")
   * queda para esa tarea, cuando la rama tenga un escritor real — acá se
   * verifica lo que SÍ es alcanzable hoy: `/ver-propuesta` nunca toca la
   * ranura, así que una confirmación de OTRO dominio sobrevive intacta a un
   * `/ver-propuesta` de por medio.
   */
  it("sin sesión vigente se rechaza sin tocar propuestaStore", async () => {
    const reloj: Reloj = { ahora: TIMESTAMP };
    const propuestaStore = makePropuestaStore();
    const deps = makeDeps(reloj, { propuestaStore });
    const handler = buildOnComandoEmpleado(deps);

    const resultado = await handler("/ver-propuesta");

    expect(resultado.agentLabel).toBe("sistema");
    expect(resultado.responseText).toContain("/login");
    expect(propuestaStore.listarPropuestasPendientes).not.toHaveBeenCalled();
    expect(propuestaStore.obtenerPropuesta).not.toHaveBeenCalled();
  });

  it("sin propuestaId lista las pendientes (vía listarPropuestasPendientes, acotado por LIMITE_LISTADO_PROPUESTAS), cero escrituras", async () => {
    const reloj: Reloj = { ahora: TIMESTAMP };
    const propuesta = makePropuesta({ id: "prop-9", casoId: "caso-9", archivos: 3, lineasAgregadas: 20, lineasEliminadas: 5 });
    const registro = makeRegistro();
    const propuestaStore = makePropuestaStore({ listarPropuestasPendientes: vi.fn(() => [propuesta]) });
    const deps = makeDeps(reloj, { propuestaStore, registro, verificarPassword: vi.fn(() => true) });
    const handler = buildOnComandoEmpleado(deps);
    await login(handler);
    vi.mocked(registro.registrarAccion).mockClear(); // limpia la fila de /login

    const resultado = await handler("/ver-propuesta");

    expect(propuestaStore.listarPropuestasPendientes).toHaveBeenCalledTimes(1);
    // Sin límite explícito: el default (LIMITE_LISTADO_PROPUESTAS) vive del
    // lado del store, mismo criterio que `/aprobar-solicitud` sin id.
    expect(propuestaStore.listarPropuestasPendientes).toHaveBeenCalledWith();
    expect(resultado.responseText).toContain("prop-9");
    expect(resultado.responseText).toContain("caso-9");
    expect(resultado.responseText).toContain("3");
    expect(resultado.responseText).toContain("estado");
    expect(propuestaStore.obtenerPropuesta).not.toHaveBeenCalled();
    expect(registro.registrarAccion).not.toHaveBeenCalled();
  });

  it("sin propuestaId y sin pendientes: responde que no hay propuestas, cero escrituras", async () => {
    const reloj: Reloj = { ahora: TIMESTAMP };
    const propuestaStore = makePropuestaStore({ listarPropuestasPendientes: vi.fn(() => []) });
    const registro = makeRegistro();
    const deps = makeDeps(reloj, { propuestaStore, registro, verificarPassword: vi.fn(() => true) });
    const handler = buildOnComandoEmpleado(deps);
    await login(handler);
    vi.mocked(registro.registrarAccion).mockClear();

    const resultado = await handler("/ver-propuesta");

    expect(resultado.responseText.toLowerCase()).toContain("no hay");
    expect(registro.registrarAccion).not.toHaveBeenCalled();
  });

  it("con propuestaId inexistente: responde que no existe, sin tocar listarPropuestasPendientes ni registro", async () => {
    const reloj: Reloj = { ahora: TIMESTAMP };
    const registro = makeRegistro();
    const propuestaStore = makePropuestaStore({ obtenerPropuesta: vi.fn(() => undefined) });
    const deps = makeDeps(reloj, { propuestaStore, registro, verificarPassword: vi.fn(() => true) });
    const handler = buildOnComandoEmpleado(deps);
    await login(handler);
    vi.mocked(registro.registrarAccion).mockClear();

    const resultado = await handler("/ver-propuesta fantasma");

    expect(resultado.responseText).toContain("fantasma");
    expect(resultado.responseText.toLowerCase()).toContain("no existe");
    expect(propuestaStore.obtenerPropuesta).toHaveBeenCalledWith("fantasma");
    expect(propuestaStore.listarPropuestasPendientes).not.toHaveBeenCalled();
    expect(registro.registrarAccion).not.toHaveBeenCalled();
  });

  it("con propuestaId existente: muestra resumen (archivos, +/-, baseCommit, estado) + el patch completo si entra en una página", async () => {
    const reloj: Reloj = { ahora: TIMESTAMP };
    const propuesta = makePropuesta({
      id: "prop-1",
      casoId: "caso-1",
      baseCommit: "deadbee",
      archivos: 2,
      lineasAgregadas: 10,
      lineasEliminadas: 4,
      estado: PROPUESTA_ESTADO_PENDIENTE,
      patch: "diff --git a/x.ts b/x.ts\n+una linea agregada",
    });
    const registro = makeRegistro();
    const propuestaStore = makePropuestaStore({ obtenerPropuesta: vi.fn(() => propuesta) });
    const deps = makeDeps(reloj, { propuestaStore, registro, verificarPassword: vi.fn(() => true) });
    const handler = buildOnComandoEmpleado(deps);
    await login(handler);
    vi.mocked(registro.registrarAccion).mockClear();

    const resultado = await handler("/ver-propuesta prop-1");

    expect(propuestaStore.obtenerPropuesta).toHaveBeenCalledWith("prop-1");
    expect(resultado.responseText).toContain("prop-1");
    expect(resultado.responseText).toContain("caso-1");
    expect(resultado.responseText).toContain("deadbee");
    expect(resultado.responseText).toContain("2");
    expect(resultado.responseText).toContain(PROPUESTA_ESTADO_PENDIENTE);
    expect(resultado.responseText).toContain("diff --git a/x.ts b/x.ts");
    expect(resultado.responseText).toContain("una linea agregada");
    expect(registro.registrarAccion).not.toHaveBeenCalled();
  });

  it("patch con más de LINEAS_PAGINA_PATCH líneas: muestra solo la primera página y avisa que hay más", async () => {
    const reloj: Reloj = { ahora: TIMESTAMP };
    const totalLineas = LINEAS_PAGINA_PATCH + 15;
    const lineasPatch = Array.from({ length: totalLineas }, (_, i) => `+linea ${i}`);
    const propuesta = makePropuesta({ id: "prop-grande", patch: lineasPatch.join("\n") });
    const propuestaStore = makePropuestaStore({ obtenerPropuesta: vi.fn(() => propuesta) });
    const deps = makeDeps(reloj, { propuestaStore, verificarPassword: vi.fn(() => true) });
    const handler = buildOnComandoEmpleado(deps);
    await login(handler);

    const resultado = await handler("/ver-propuesta prop-grande");

    expect(resultado.responseText).toContain("linea 0");
    expect(resultado.responseText).toContain(`linea ${LINEAS_PAGINA_PATCH - 1}`);
    expect(resultado.responseText).not.toContain(`linea ${LINEAS_PAGINA_PATCH}`);
    expect(resultado.responseText).not.toContain(`linea ${totalLineas - 1}`);
    // La nota de truncado avisa cuántas líneas hay en total, sin literal fijado por diseño.
    expect(resultado.responseText).toContain(String(totalLineas));
  });

  it("una confirmación de reembolso pendiente sobrevive a un /ver-propuesta de por medio (no toca la ranura)", async () => {
    const reloj: Reloj = { ahora: TIMESTAMP };
    const venta = makeEscalacion({ ventaId: "v-1", monto: 250, casoId: "caso-9" });
    const store = makeStore({
      listarReembolsosPendientes: vi.fn(() => [venta]),
      aprobarEscalacionReembolso: vi.fn(() => makeVenta({ id: "v-1", estado: VENTA_ESTADO_REEMBOLSADA })),
    });
    const propuestaStore = makePropuestaStore();
    const deps = makeDeps(reloj, { store, propuestaStore, verificarPassword: vi.fn(() => true) });
    const handler = buildOnComandoEmpleado(deps);
    await login(handler);

    const eco = await handler("/aprobar-reembolso v-1");
    expect(eco.responseText.toLowerCase()).toContain("confirm");

    await handler("/ver-propuesta");

    const confirmacion = await handler("/aprobar-reembolso v-1");
    expect(store.aprobarEscalacionReembolso).toHaveBeenCalledTimes(1);
    expect(confirmacion.responseText).toContain("v-1");
  });
});

describe("buildOnComandoEmpleado — resolución de propuestas en dos pasos (Hito 5.1, tarea 32, ADR 64, ADR 65)", () => {
  function depsConPropuestaPendiente(reloj: Reloj, overrides: Partial<BuildOnComandoEmpleadoDeps> = {}) {
    const propuesta = makePropuesta({
      id: "prop-1",
      casoId: "caso-prop-9",
      baseCommit: "deadbee",
      archivos: 2,
      lineasAgregadas: 10,
      lineasEliminadas: 3,
    });
    const registro = makeRegistro();
    const propuestaStore = makePropuestaStore({
      listarPropuestasPendientes: vi.fn(() => [propuesta]),
      obtenerPropuesta: vi.fn(() => propuesta),
      aplicarPropuesta: vi.fn(
        (): PropuestaCambio => ({ ...propuesta, estado: PROPUESTA_ESTADO_APLICADA }),
      ),
      descartarPropuesta: vi.fn(
        (): PropuestaCambio => ({ ...propuesta, estado: PROPUESTA_ESTADO_DESCARTADA, motivo: "no me convence" }),
      ),
    });
    const aplicarPatch = makeAplicarPatch();
    return {
      deps: makeDeps(reloj, { propuestaStore, registro, aplicarPatch, verificarPassword: vi.fn(() => true), ...overrides }),
      propuestaStore,
      registro,
      aplicarPatch,
      propuesta,
    };
  }

  it("sin sesión vigente, /aplicar-propuesta y /descartar-propuesta se rechazan sin tocar propuestaStore ni aplicarPatch", async () => {
    const reloj: Reloj = { ahora: TIMESTAMP };
    const propuestaStore = makePropuestaStore();
    const aplicarPatch = makeAplicarPatch();
    const deps = makeDeps(reloj, { propuestaStore, aplicarPatch });
    const handler = buildOnComandoEmpleado(deps);

    for (const texto of ["/aplicar-propuesta prop-1", "/descartar-propuesta prop-1 no convence"]) {
      const resultado = await handler(texto);
      expect(resultado.agentLabel).toBe("sistema");
      expect(resultado.responseText).toContain("/login");
    }

    expect(propuestaStore.obtenerPropuesta).not.toHaveBeenCalled();
    expect(propuestaStore.aplicarPropuesta).not.toHaveBeenCalled();
    expect(propuestaStore.descartarPropuesta).not.toHaveBeenCalled();
    expect(aplicarPatch.verificar).not.toHaveBeenCalled();
    expect(aplicarPatch.aplicar).not.toHaveBeenCalled();
  });

  it("primer /aplicar-propuesta prop-1: eco con base_commit y archivos, CERO escrituras", async () => {
    const reloj: Reloj = { ahora: TIMESTAMP };
    const { deps, propuestaStore, registro, aplicarPatch } = depsConPropuestaPendiente(reloj);
    const handler = buildOnComandoEmpleado(deps);
    await login(handler);
    vi.mocked(registro.registrarAccion).mockClear(); // limpia la fila de /login

    const primero = await handler("/aplicar-propuesta prop-1");

    expect(primero.responseText.toLowerCase()).toContain("confirm");
    expect(primero.responseText).toContain("deadbee");
    expect(primero.responseText).toContain("prop-1");
    expect(propuestaStore.aplicarPropuesta).not.toHaveBeenCalled();
    expect(aplicarPatch.verificar).not.toHaveBeenCalled();
    expect(aplicarPatch.aplicar).not.toHaveBeenCalled();
    expect(registro.registrarAccion).not.toHaveBeenCalled();
  });

  it("segundo /aplicar-propuesta: git apply --check ANTES, la transacción CAS (commit) DESPUÉS, y recién ahí git apply real (ADR 64)", async () => {
    const reloj: Reloj = { ahora: TIMESTAMP };
    const orden: string[] = [];
    const propuesta = makePropuesta({ id: "prop-1", casoId: "caso-prop-9", baseCommit: "deadbee" });
    const propuestaStore = makePropuestaStore({
      listarPropuestasPendientes: vi.fn(() => [propuesta]),
      obtenerPropuesta: vi.fn(() => propuesta),
      aplicarPropuesta: vi.fn((): PropuestaCambio => {
        orden.push("cas-commit");
        return { ...propuesta, estado: PROPUESTA_ESTADO_APLICADA };
      }),
    });
    const aplicarPatch = makeAplicarPatch({
      verificar: vi.fn(async (): Promise<ResultadoPatch> => {
        orden.push("verificar");
        return { ok: true };
      }),
      aplicar: vi.fn(async (): Promise<ResultadoPatch> => {
        orden.push("aplicar");
        return { ok: true };
      }),
    });
    const registro = makeRegistro();
    const deps = makeDeps(reloj, { propuestaStore, aplicarPatch, registro, verificarPassword: vi.fn(() => true) });
    const handler = buildOnComandoEmpleado(deps);
    await login(handler);
    vi.mocked(registro.registrarAccion).mockClear();

    await handler("/aplicar-propuesta prop-1"); // eco
    const resultado = await handler("/aplicar-propuesta prop-1"); // confirma

    expect(orden).toEqual(["verificar", "cas-commit", "aplicar"]);
    expect(resultado.responseText).toContain("prop-1");
    expect(resultado.responseText.toLowerCase()).toContain("aplicada");
    // La fila ya viajó DENTRO de la transacción del repository (tarea 15) —
    // este archivo NO debe emitir una escritura extra.
    expect(registro.registrarAccion).not.toHaveBeenCalled();
  });

  it("--check que falla: evento propuesta-conflicto, CERO escrituras y el estado de la propuesta queda intacto", async () => {
    const reloj: Reloj = { ahora: TIMESTAMP };
    const writes: string[] = [];
    const propuesta = makePropuesta({ id: "prop-1", casoId: "caso-prop-9", baseCommit: "deadbee" });
    const propuestaStore = makePropuestaStore({
      listarPropuestasPendientes: vi.fn(() => [propuesta]),
      obtenerPropuesta: vi.fn(() => propuesta),
    });
    const aplicarPatch = makeAplicarPatch({
      verificar: vi.fn(
        async (): Promise<ResultadoPatch> => ({ ok: false, motivo: MOTIVO_PATCH_CONFLICTO, detalle: "patch does not apply" }),
      ),
    });
    const registro = makeRegistro();
    const deps = makeDeps(reloj, { propuestaStore, aplicarPatch, registro, writes, verificarPassword: vi.fn(() => true) });
    const handler = buildOnComandoEmpleado(deps);
    await login(handler);
    vi.mocked(registro.registrarAccion).mockClear();

    await handler("/aplicar-propuesta prop-1"); // eco
    const resultado = await handler("/aplicar-propuesta prop-1"); // confirma -> --check falla

    expect(resultado.responseText.toLowerCase()).toContain("conflicto");
    expect(resultado.responseText).toContain("deadbee");
    expect(propuestaStore.aplicarPropuesta).not.toHaveBeenCalled();
    expect(aplicarPatch.aplicar).not.toHaveBeenCalled();
    expect(registro.registrarAccion).not.toHaveBeenCalled();
    expect(JSON.stringify(writes)).toContain("propuesta-conflicto");
  });

  it("otro empleado ya resolvió la propuesta ENTRE el eco y la confirmación: NO corre git apply --check (filtra por pendiente antes, no por obtenerPropuesta sin filtro), mensaje 'ya no está pendiente' en vez de 'conflicto' (code review, Hito 5.1 completo)", async () => {
    const reloj: Reloj = { ahora: TIMESTAMP };
    const propuestaPendiente = makePropuesta({
      id: "prop-1",
      casoId: "caso-prop-9",
      baseCommit: "deadbee",
      estado: PROPUESTA_ESTADO_PENDIENTE,
    });
    // `obtenerPropuesta` (sin filtro de estado) SIGUE devolviendo la fila —
    // ya fue resuelta por otra persona mientras tanto — para reproducir la
    // carrera exacta que reporta el finding: un lookup sin filtro de estado
    // vería esta fila como "existente" aunque ya no esté pendiente.
    const propuestaYaAplicada: PropuestaCambio = { ...propuestaPendiente, estado: PROPUESTA_ESTADO_APLICADA };
    let llamadasListar = 0;
    const propuestaStore = makePropuestaStore({
      // 1ª llamada (eco, vía `resolverPropuestaCambio`): SIGUE pendiente.
      // 2ª llamada (confirma): otra persona ya la resolvió — vacío.
      listarPropuestasPendientes: vi.fn(() => {
        llamadasListar += 1;
        return llamadasListar === 1 ? [propuestaPendiente] : [];
      }),
      obtenerPropuesta: vi.fn(() => propuestaYaAplicada),
    });
    const aplicarPatch = makeAplicarPatch({
      verificar: vi.fn(
        async (): Promise<ResultadoPatch> => ({ ok: false, motivo: MOTIVO_PATCH_CONFLICTO, detalle: "ya fue aplicada" }),
      ),
    });
    const registro = makeRegistro();
    const deps = makeDeps(reloj, { propuestaStore, aplicarPatch, registro, verificarPassword: vi.fn(() => true) });
    const handler = buildOnComandoEmpleado(deps);
    await login(handler);
    vi.mocked(registro.registrarAccion).mockClear();

    await handler("/aplicar-propuesta prop-1"); // eco: todavía pendiente
    const resultado = await handler("/aplicar-propuesta prop-1"); // confirma: la carrera ya se perdió

    expect(aplicarPatch.verificar).not.toHaveBeenCalled();
    expect(propuestaStore.aplicarPropuesta).not.toHaveBeenCalled();
    expect(resultado.responseText.toLowerCase()).toContain("no está pendiente");
    expect(resultado.responseText.toLowerCase()).not.toContain("conflicto");
    expect(registro.registrarAccion).not.toHaveBeenCalled();
  });

  it("--check pasa pero el CAS pierde la carrera (otro empleado ya la resolvió): no_aplicable, registra FUERA de transacción, NO llama a git apply", async () => {
    const reloj: Reloj = { ahora: TIMESTAMP };
    const propuesta = makePropuesta({ id: "prop-1", casoId: "caso-prop-9" });
    const propuestaStore = makePropuestaStore({
      listarPropuestasPendientes: vi.fn(() => [propuesta]),
      obtenerPropuesta: vi.fn(() => propuesta),
      aplicarPropuesta: vi.fn(() => undefined), // el CAS no matcheó
    });
    const aplicarPatch = makeAplicarPatch();
    const registro = makeRegistro();
    const deps = makeDeps(reloj, { propuestaStore, aplicarPatch, registro, verificarPassword: vi.fn(() => true) });
    const handler = buildOnComandoEmpleado(deps);
    await login(handler);
    vi.mocked(registro.registrarAccion).mockClear();

    await handler("/aplicar-propuesta prop-1"); // eco
    const resultado = await handler("/aplicar-propuesta prop-1"); // confirma -> check pasa, CAS pierde

    expect(aplicarPatch.verificar).toHaveBeenCalledTimes(1);
    expect(aplicarPatch.aplicar).not.toHaveBeenCalled();
    expect(resultado.responseText.toLowerCase()).toContain("no se aplicó");
    expect(registro.registrarAccion).toHaveBeenCalledTimes(1);
    const fila = vi.mocked(registro.registrarAccion).mock.calls[0]?.[0];
    expect(fila).toMatchObject({
      comando: "/aplicar-propuesta",
      resultado: "no_aplicable",
      casoId: "caso-prop-9",
      empleadoId: "ana",
    });
  });

  it("git apply real falla DESPUÉS del commit: evento propuesta-apply-fallido y mensaje explícito al humano (RD-13)", async () => {
    const reloj: Reloj = { ahora: TIMESTAMP };
    const writes: string[] = [];
    const propuesta = makePropuesta({ id: "prop-1", casoId: "caso-prop-9", baseCommit: "deadbee" });
    const propuestaStore = makePropuestaStore({
      listarPropuestasPendientes: vi.fn(() => [propuesta]),
      obtenerPropuesta: vi.fn(() => propuesta),
      aplicarPropuesta: vi.fn((): PropuestaCambio => ({ ...propuesta, estado: PROPUESTA_ESTADO_APLICADA })),
    });
    const aplicarPatch = makeAplicarPatch({
      aplicar: vi.fn(
        async (): Promise<ResultadoPatch> => ({ ok: false, motivo: MOTIVO_PATCH_ERROR_GIT, detalle: "working tree dirty" }),
      ),
    });
    const registro = makeRegistro();
    const deps = makeDeps(reloj, { propuestaStore, aplicarPatch, registro, writes, verificarPassword: vi.fn(() => true) });
    const handler = buildOnComandoEmpleado(deps);
    await login(handler);
    vi.mocked(registro.registrarAccion).mockClear();

    await handler("/aplicar-propuesta prop-1"); // eco
    const resultado = await handler("/aplicar-propuesta prop-1"); // confirma -> CAS comitea, apply falla

    expect(propuestaStore.aplicarPropuesta).toHaveBeenCalledTimes(1); // el commit SÍ ocurrió
    expect(resultado.responseText.toLowerCase()).toContain("aplicada");
    expect(resultado.responseText.toLowerCase()).toContain("no cambió");
    expect(JSON.stringify(writes)).toContain("propuesta-apply-fallido");
  });

  it("segundo /descartar-propuesta con motivo: transacción CAS a descartada, SIN tocar aplicarPatch", async () => {
    const reloj: Reloj = { ahora: TIMESTAMP };
    const { deps, propuestaStore, registro, aplicarPatch } = depsConPropuestaPendiente(reloj);
    const handler = buildOnComandoEmpleado(deps);
    await login(handler);
    vi.mocked(registro.registrarAccion).mockClear();

    await handler("/descartar-propuesta prop-1 no me convence"); // eco
    const resultado = await handler("/descartar-propuesta prop-1 no me convence"); // confirma

    expect(propuestaStore.descartarPropuesta).toHaveBeenCalledTimes(1);
    expect(propuestaStore.descartarPropuesta).toHaveBeenCalledWith(
      expect.objectContaining({ propuestaId: "prop-1", motivo: "no me convence" }),
    );
    expect(resultado.responseText).toContain("prop-1");
    expect(resultado.responseText.toLowerCase()).toContain("descartada");
    expect(propuestaStore.obtenerPropuesta).not.toHaveBeenCalled();
    expect(aplicarPatch.verificar).not.toHaveBeenCalled();
    expect(aplicarPatch.aplicar).not.toHaveBeenCalled();
    expect(registro.registrarAccion).not.toHaveBeenCalled();
  });

  it("una confirmación de reembolso pendiente es PISADA por una de /aplicar-propuesta de por medio, y viceversa (ADR 55, test cruzado real de la tarea 32)", async () => {
    const reloj: Reloj = { ahora: TIMESTAMP };
    const venta = makeEscalacion({ ventaId: "v-1", monto: 250, casoId: "caso-9" });
    const store = makeStore({
      listarReembolsosPendientes: vi.fn(() => [venta]),
      aprobarEscalacionReembolso: vi.fn(() => makeVenta({ id: "v-1", estado: VENTA_ESTADO_REEMBOLSADA })),
    });
    const propuesta = makePropuesta({ id: "prop-1", casoId: "caso-prop-9" });
    const propuestaStore = makePropuestaStore({ listarPropuestasPendientes: vi.fn(() => [propuesta]) });
    const deps = makeDeps(reloj, { store, propuestaStore, verificarPassword: vi.fn(() => true) });
    const handler = buildOnComandoEmpleado(deps);
    await login(handler);

    const ecoReembolso = await handler("/aprobar-reembolso v-1");
    expect(ecoReembolso.responseText.toLowerCase()).toContain("confirm");

    const ecoPropuesta = await handler("/aplicar-propuesta prop-1");
    expect(ecoPropuesta.responseText.toLowerCase()).toContain("confirm");

    // La ranura única quedó con dominio "propuesta": repetir el reembolso
    // vuelve a pedir eco (no coincide), no ejecuta.
    const confirmacionReembolso = await handler("/aprobar-reembolso v-1");
    expect(confirmacionReembolso.responseText.toLowerCase()).toContain("confirm");
    expect(store.aprobarEscalacionReembolso).not.toHaveBeenCalled();
  });
});

/**
 * `/consultar-kpi <consulta>` (Hito 6, tarea 20, ADR 85, design.md §5.7.3).
 * Espejo de las tres suites: `db` REAL (`openDatabase(":memory:")`, molde de
 * `build-on-soporte.test.ts`) porque `manejarConsultarKpi` llama `createCaso`
 * directo; `ClienteA2APort`/`DelegacionA2AStorePort` FAKE (molde de
 * `makeAplicarPatch`/`makePropuestaStore`), sin red ni SQLite del lado A2A.
 */
describe("buildOnComandoEmpleado — /consultar-kpi (Hito 6, tarea 20, ADR 85)", () => {
  it("sin sesión vigente pide /login, sin tocar clienteA2A ni crear caso", async () => {
    const db = openDatabase(":memory:");
    try {
      const reloj: Reloj = { ahora: TIMESTAMP };
      const clienteA2A = makeClienteA2A();
      const delegacionA2AStore = makeDelegacionA2AStore();
      const deps = makeKpiDeps(db, reloj, { clienteA2A, delegacionA2AStore });
      const handler = buildOnComandoEmpleado(deps);

      const resultado = await handler("/consultar-kpi cuál fue el pico de latencia");

      expect(resultado.agentLabel).toBe("sistema");
      expect(resultado.responseText).toContain("/login");
      expect(clienteA2A.baseUrlDe).not.toHaveBeenCalled();
      expect(clienteA2A.delegar).not.toHaveBeenCalled();
      expect(delegacionA2AStore.crearDelegacionA2A).not.toHaveBeenCalled();
      expect(contarCasos(db)).toBe(0);
    } finally {
      db.close();
    }
  });

  it("clienteA2A ausente responde que está desactivado, sin crear caso ni fila en delegaciones_a2a", async () => {
    const db = openDatabase(":memory:");
    try {
      const reloj: Reloj = { ahora: TIMESTAMP };
      const deps = makeKpiDeps(db, reloj, {}); // sin clienteA2A: A2A "apagado"
      const handler = buildOnComandoEmpleado(deps);
      await login(handler);

      const resultado = await handler("/consultar-kpi qué tal el uptime");

      expect(resultado.agentLabel).toBe("sistema");
      expect(resultado.responseText.toLowerCase()).toContain("desactivad");
      expect(contarCasos(db)).toBe(0);
      expect(contarFilasRegistro(db, COMANDO_CONSULTAR_KPI)).toBe(0);
      const fila = db.prepare("SELECT count(*) as total FROM delegaciones_a2a").get() as { total: number };
      expect(fila.total).toBe(0);
    } finally {
      db.close();
    }
  });

  it("éxito: responseText es el texto del agente externo y deja una fila atendida en registro_acciones_empleado", async () => {
    const db = openDatabase(":memory:");
    try {
      const reloj: Reloj = { ahora: TIMESTAMP };
      const clienteA2A = makeClienteA2A({
        delegar: vi.fn(
          async (): Promise<ResultadoA2A> => ({
            ok: true,
            a2aTaskId: "task-99",
            estado: TASK_STATE_COMPLETED,
            resultado: "el pico de latencia fue a las 14:00",
            agenteNombre: "Agente KPI",
            endpoint: "https://kpi.example.test/rpc",
          }),
        ),
      });
      const deps = makeKpiDeps(db, reloj, { clienteA2A });
      const handler = buildOnComandoEmpleado(deps);
      await login(handler);

      const resultado = await handler("/consultar-kpi cuál fue el pico de latencia");

      expect(resultado.agentLabel).toBe("sistema");
      expect(resultado.responseText).toBe("el pico de latencia fue a las 14:00");
      expect(contarCasos(db)).toBe(1);
      const fila = db
        .prepare("SELECT resultado FROM registro_acciones_empleado WHERE comando = ?")
        .get(COMANDO_CONSULTAR_KPI) as { resultado: string } | undefined;
      expect(fila?.resultado).toBe(RESULTADO_ATENDIDA);
    } finally {
      db.close();
    }
  });

  it("el turno ESPERA la respuesta del agente externo — la promesa no resuelve antes (camino síncrono del ADR 74)", async () => {
    const db = openDatabase(":memory:");
    try {
      const reloj: Reloj = { ahora: TIMESTAMP };
      let resolverDelegar: ((r: ResultadoA2A) => void) | undefined;
      const clienteA2A = makeClienteA2A({
        delegar: vi.fn(
          () =>
            new Promise<ResultadoA2A>((resolve) => {
              resolverDelegar = resolve;
            }),
        ),
      });
      const deps = makeKpiDeps(db, reloj, { clienteA2A });
      const handler = buildOnComandoEmpleado(deps);
      await login(handler);

      let resuelto = false;
      const promesa = handler("/consultar-kpi qué tal el uptime").then((r) => {
        resuelto = true;
        return r;
      });

      // Flushea varias tandas de microtasks: la promesa NO debe resolver
      // hasta que `resolverDelegar` se invoque explícitamente más abajo.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(resuelto).toBe(false);

      resolverDelegar?.({
        ok: true,
        a2aTaskId: "task-1",
        estado: TASK_STATE_COMPLETED,
        resultado: "todo en orden",
        agenteNombre: "Agente KPI",
        endpoint: "https://kpi.example.test/rpc",
      });
      const resultado = await promesa;

      expect(resuelto).toBe(true);
      expect(resultado.responseText).toBe("todo en orden");
    } finally {
      db.close();
    }
  });

  it("los ocho motivos de fracaso dan mensajes distintos entre sí, y siempre RESULTADO_FALLIDA", async () => {
    const MOTIVOS: readonly MotivoDelegacionA2ANoCompletada[] = [
      "failed",
      "canceled",
      "rejected",
      "input-required",
      "auth-required",
      "timeout",
      "transporte",
      "protocolo",
    ];
    const mensajes = new Set<string>();

    for (const reason of MOTIVOS) {
      const db = openDatabase(":memory:");
      try {
        const reloj: Reloj = { ahora: TIMESTAMP };
        const clienteA2A = makeClienteA2A({
          delegar: vi.fn(async (): Promise<ResultadoA2A> => ({ ok: false, reason })),
        });
        const deps = makeKpiDeps(db, reloj, { clienteA2A });
        const handler = buildOnComandoEmpleado(deps);
        await login(handler);

        const resultado = await handler("/consultar-kpi qué tal el uptime");

        mensajes.add(resultado.responseText);
        const fila = db
          .prepare("SELECT resultado FROM registro_acciones_empleado WHERE comando = ?")
          .get(COMANDO_CONSULTAR_KPI) as { resultado: string } | undefined;
        expect(fila?.resultado).toBe(RESULTADO_FALLIDA);
      } finally {
        db.close();
      }
    }

    expect(mensajes.size).toBe(MOTIVOS.length);
  });

  it("un throw NO tipado (no DelegacionA2ANoCompletadaError) igual responde, vía toErrorMessage", async () => {
    const db = openDatabase(":memory:");
    try {
      const reloj: Reloj = { ahora: TIMESTAMP };
      const clienteA2A = makeClienteA2A();
      const delegacionA2AStore = makeDelegacionA2AStore({
        crearDelegacionA2A: vi.fn(() => {
          throw new Error("la base rechazó la escritura");
        }),
      });
      const deps = makeKpiDeps(db, reloj, { clienteA2A, delegacionA2AStore });
      const handler = buildOnComandoEmpleado(deps);
      await login(handler);

      const resultado = await handler("/consultar-kpi qué tal el uptime");

      expect(resultado.agentLabel).toBe("sistema");
      expect(resultado.responseText).toContain("la base rechazó la escritura");
      expect(clienteA2A.delegar).not.toHaveBeenCalled();
      const fila = db
        .prepare("SELECT resultado FROM registro_acciones_empleado WHERE comando = ?")
        .get(COMANDO_CONSULTAR_KPI) as { resultado: string } | undefined;
      expect(fila?.resultado).toBe(RESULTADO_FALLIDA);
    } finally {
      db.close();
    }
  });

  it("createCaso que tira (colisión de id) igual responde, sin intentar delegar", async () => {
    const db = openDatabase(":memory:");
    try {
      const reloj: Reloj = { ahora: TIMESTAMP };
      createCaso(db, {
        id: "id-colision",
        tipo: "otro",
        estado: "activo",
        createdAt: TIMESTAMP,
        updatedAt: TIMESTAMP,
      });
      const clienteA2A = makeClienteA2A();
      const deps = makeKpiDeps(db, reloj, { clienteA2A, newId: () => "id-colision" });
      const handler = buildOnComandoEmpleado(deps);
      await login(handler);

      const resultado = await handler("/consultar-kpi qué tal el uptime");

      expect(resultado.agentLabel).toBe("sistema");
      expect(resultado.responseText.length).toBeGreaterThan(0);
      expect(clienteA2A.baseUrlDe).not.toHaveBeenCalled();
      expect(clienteA2A.delegar).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  });

  it("con un detalle crudo del adaptador (simulando un authToken filtrado), el valor no aparece en responseText ni en logEvent", async () => {
    const db = openDatabase(":memory:");
    try {
      const reloj: Reloj = { ahora: TIMESTAMP };
      const writes: string[] = [];
      const SECRETO = "super-secret-token-xyz";
      const clienteA2A = makeClienteA2A({
        delegar: vi.fn(
          async (): Promise<ResultadoA2A> => ({
            ok: false,
            reason: "protocolo",
            detalle: `Authorization: Bearer ${SECRETO}`,
          }),
        ),
      });
      const deps = makeKpiDeps(db, reloj, { clienteA2A, writes });
      const handler = buildOnComandoEmpleado(deps);
      await login(handler);
      writes.length = 0; // limpia lo que dejó /login

      const resultado = await handler("/consultar-kpi qué tal el uptime");

      expect(resultado.responseText).not.toContain(SECRETO);
      expect(JSON.stringify(writes)).not.toContain(SECRETO);
    } finally {
      db.close();
    }
  });
});

/**
 * `/reporte-comisiones [periodo]` (comando-reporte-comisiones, tarea 4,
 * ADR 117, 121, 123, 124). Mismo molde de fixture que `/consultar-kpi`
 * (`makeKpiDeps`, `db` REAL): `manejarReporteComisiones` lee vía
 * `reporteStore` (default: closure sobre `listComisionesPorPeriodo`/
 * `listVentasEnReembolsoPendiente`, `repository.ts`) — sin doble hay que
 * ejercitar el SQL real para la igualdad byte a byte (§6 de `design.md`).
 */
describe("buildOnComandoEmpleado — /reporte-comisiones (comando-reporte-comisiones, tarea 4)", () => {
  /** Venta CONFIRMADA + su comisión, mismo molde que `repository.test.ts` (`createVentaConCaso` + `confirmarVentaConComision`). */
  function seedComisionConfirmada(
    db: Database.Database,
    input: {
      readonly ventaId: string;
      readonly vendedorId: string;
      readonly vendedorNombre: string;
      readonly clienteId: string;
      readonly monto: number;
      readonly comisionMonto: number;
      readonly periodo: string;
      readonly casoId: string;
    },
  ): void {
    createVentaConCaso(db, {
      vendedor: { id: input.vendedorId, nombre: input.vendedorNombre },
      caso: { id: input.casoId, tipo: "venta", estado: "pendiente_confirmacion", createdAt: TIMESTAMP, updatedAt: TIMESTAMP },
      venta: {
        id: input.ventaId,
        clienteId: input.clienteId,
        planNuevo: "plan-x",
        monto: input.monto,
        estado: "pendiente_confirmacion",
        tokenConfirmacion: `tok-${input.ventaId}`,
      },
      timestamp: TIMESTAMP,
    });
    confirmarVentaConComision(db, {
      ventaId: input.ventaId,
      comisionId: `comision-${input.ventaId}`,
      comisionMonto: input.comisionMonto,
      periodo: input.periodo,
      ahora: TIMESTAMP,
    });
  }

  /** Venta escalada a `reembolso_pendiente` (con su comisión ya generada) — mismo molde que `repository.test.ts` (`escalarReembolso`). */
  function seedVentaReembolsoPendiente(
    db: Database.Database,
    input: {
      readonly ventaId: string;
      readonly vendedorId: string;
      readonly vendedorNombre: string;
      readonly clienteId: string;
      readonly monto: number;
      readonly periodo: string;
      readonly casoId: string;
    },
  ): void {
    seedComisionConfirmada(db, { ...input, comisionMonto: input.monto * 0.1 });
    escalarReembolso(db, { ventaId: input.ventaId, casoId: input.casoId, ahora: TIMESTAMP });
  }

  it("sin sesión pide /login, cero lecturas (spy en reporteStore) y cero fila", async () => {
    const db = openDatabase(":memory:");
    try {
      const reloj: Reloj = { ahora: TIMESTAMP };
      const reporteStore = makeReporteStore();
      const deps = makeKpiDeps(db, reloj, { reporteStore });
      const handler = buildOnComandoEmpleado(deps);

      const resultado = await handler("/reporte-comisiones 2026-08");

      expect(resultado.agentLabel).toBe("sistema");
      expect(resultado.responseText).toContain("/login");
      expect(reporteStore.listComisionesPorPeriodo).not.toHaveBeenCalled();
      expect(reporteStore.listVentasEnReembolsoPendiente).not.toHaveBeenCalled();
      expect(contarFilasRegistro(db, COMANDO_REPORTE_COMISIONES)).toBe(0);
    } finally {
      db.close();
    }
  });

  it("con sesión y periodo inválido responde el mensaje de uso, cero lecturas, cero fila", async () => {
    const db = openDatabase(":memory:");
    try {
      const reloj: Reloj = { ahora: TIMESTAMP };
      const reporteStore = makeReporteStore();
      const deps = makeKpiDeps(db, reloj, { reporteStore });
      const handler = buildOnComandoEmpleado(deps);
      await login(handler);

      const resultado = await handler("/reporte-comisiones 2026-13");

      expect(resultado.agentLabel).toBe("sistema");
      expect(resultado.responseText).toBe("Periodo inválido. Formato esperado: YYYY-MM.");
      expect(reporteStore.listComisionesPorPeriodo).not.toHaveBeenCalled();
      expect(reporteStore.listVentasEnReembolsoPendiente).not.toHaveBeenCalled();
      expect(contarFilasRegistro(db, COMANDO_REPORTE_COMISIONES)).toBe(0);
    } finally {
      db.close();
    }
  });

  it("con sesión y periodo válido sin datos: 'sin comisiones en el periodo' y fila atendida con venta_id/caso_id NULL", async () => {
    const db = openDatabase(":memory:");
    try {
      const reloj: Reloj = { ahora: TIMESTAMP };
      const deps = makeKpiDeps(db, reloj, {}); // reporteStore default: closure real sobre `db`, vacío
      const handler = buildOnComandoEmpleado(deps);
      await login(handler);

      const resultado = await handler("/reporte-comisiones 2026-08");

      expect(resultado.agentLabel).toBe("sistema");
      expect(resultado.responseText).toContain("Reporte de comisiones - periodo 2026-08");
      expect(resultado.responseText).toContain("sin comisiones en el periodo");
      const fila = db
        .prepare("SELECT resultado, venta_id, caso_id FROM registro_acciones_empleado WHERE comando = ?")
        .get(COMANDO_REPORTE_COMISIONES) as { resultado: string; venta_id: string | null; caso_id: string | null } | undefined;
      expect(fila?.resultado).toBe(RESULTADO_ATENDIDA);
      expect(fila?.venta_id).toBeNull();
      expect(fila?.caso_id).toBeNull();
    } finally {
      db.close();
    }
  });

  it("sin argumento, reporta el mes corriente con el reloj inyectado (no el reloj real)", async () => {
    const db = openDatabase(":memory:");
    try {
      const reloj: Reloj = { ahora: "2026-09-10T12:00:00.000Z" };
      const deps = makeKpiDeps(db, reloj, {});
      const handler = buildOnComandoEmpleado(deps);
      await login(handler);

      const resultado = await handler("/reporte-comisiones");

      expect(resultado.responseText).toContain("Reporte de comisiones - periodo 2026-09");
    } finally {
      db.close();
    }
  });

  it("ventas/comisiones/casos quedan idénticas antes y después, en cualquier desenlace", async () => {
    const db = openDatabase(":memory:");
    try {
      seedComisionConfirmada(db, {
        ventaId: "venta-inv-1",
        vendedorId: "vend-inv-1",
        vendedorNombre: "Ana Invariante",
        clienteId: "cliente-inv-1",
        monto: 100,
        comisionMonto: 10,
        periodo: "2026-08",
        casoId: "caso-inv-1",
      });
      const reloj: Reloj = { ahora: TIMESTAMP };
      const deps = makeKpiDeps(db, reloj, {});
      const handler = buildOnComandoEmpleado(deps);

      const antesSinSesion = snapshotTablasNegocio(db);
      await handler("/reporte-comisiones 2026-08");
      expect(snapshotTablasNegocio(db)).toEqual(antesSinSesion);

      await login(handler);

      const antesInvalido = snapshotTablasNegocio(db);
      await handler("/reporte-comisiones 2026-13");
      expect(snapshotTablasNegocio(db)).toEqual(antesInvalido);

      const antesValido = snapshotTablasNegocio(db);
      await handler("/reporte-comisiones 2026-08");
      expect(snapshotTablasNegocio(db)).toEqual(antesValido);
    } finally {
      db.close();
    }
  });

  it("igualdad byte a byte: el mismo responseText que agruparReporteMensual+formatearReporteMensual sobre la misma base (Success Criteria proposal.md:227)", async () => {
    const db = openDatabase(":memory:");
    try {
      seedComisionConfirmada(db, {
        ventaId: "venta-byte-1",
        vendedorId: "vend-byte-1",
        vendedorNombre: "Ana Byte",
        clienteId: "cliente-byte-1",
        monto: 100,
        comisionMonto: 10,
        periodo: "2026-08",
        casoId: "caso-byte-1",
      });
      seedComisionConfirmada(db, {
        ventaId: "venta-byte-2",
        vendedorId: "vend-byte-2",
        vendedorNombre: "Beto Byte",
        clienteId: "cliente-byte-2",
        monto: 200,
        comisionMonto: 25,
        periodo: "2026-08",
        casoId: "caso-byte-2",
      });
      seedVentaReembolsoPendiente(db, {
        ventaId: "venta-byte-3",
        vendedorId: "vend-byte-3",
        vendedorNombre: "Cami Byte",
        clienteId: "cliente-byte-3",
        monto: 300,
        periodo: "2026-08",
        casoId: "caso-byte-3",
      });

      const reloj: Reloj = { ahora: TIMESTAMP };
      const deps = makeKpiDeps(db, reloj, {});
      const handler = buildOnComandoEmpleado(deps);
      await login(handler);

      const resultado = await handler("/reporte-comisiones 2026-08");
      const salidaA = resultado.responseText;

      const comisiones = listComisionesPorPeriodo(db, "2026-08");
      const reembolsosPendientes = listVentasEnReembolsoPendiente(db);
      const reporte = agruparReporteMensual({ periodo: "2026-08", comisiones, reembolsosPendientes });
      const salidaB = formatearReporteMensual(reporte);

      expect(salidaA).toBe(salidaB);
    } finally {
      db.close();
    }
  });
});

describe("createSolicitudStore", () => {
  function withDb<T>(fn: (db: Database.Database) => T): T {
    const db = openDatabase(":memory:");
    try {
      return fn(db);
    } finally {
      db.close();
    }
  }

  it("adjuntarDictamen: no lanza SolicitudTipoEstadoInvalidoError cuando la fila tiene estado 'cancelada' (ADR 133, hallazgo 3)", () => {
    withDb((db) => {
      const store = createSolicitudStore(db);
      store.crearSolicitudConCaso({
        caso: { id: "caso-1", tipo: "solicitud_interna", estado: SOLICITUD_ESTADO_PENDIENTE },
        solicitud: {
          id: "sol-1",
          solicitanteId: "emp-1",
          tipo: SOLICITUD_TIPO_VACACIONES,
          detalle: "detalle",
          estado: SOLICITUD_ESTADO_PENDIENTE,
        },
        timestamp: TIMESTAMP,
      });
      // Simula la transición real de `cancelarSolicitudInterna` (tarea 6, todavía
      // no implementada) escribiendo directo por SQL — sólo el `estado`, mismo
      // criterio que `build-on-activity.test.ts` para forzar un valor sin pasar
      // por ningún CAS.
      db.prepare("UPDATE solicitudes_internas SET estado = ? WHERE id = ?").run(SOLICITUD_ESTADO_CANCELADA, "sol-1");

      expect(() =>
        store.adjuntarDictamen({ solicitudId: "sol-1", dictamen: "ok", ahora: TIMESTAMP }),
      ).not.toThrow();
    });
  });
});
