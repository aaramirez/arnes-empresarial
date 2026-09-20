/**
 * Tests de `buildOnComandoEmpleado` (`tui-canal-empleado`, design.md §6,
 * §10.2). TDD con dobles — sin base real, sin SDK, sin scrypt: `store`,
 * `credenciales` y `registro` son objetos planos con `vi.fn()`, `onSubmit`
 * y `onSoporte` también. La atomicidad de los CAS y el SQL en sí ya están
 * cubiertos por `repository.test.ts` (tarea 4.1) y por `build-on-venta.test.ts`
 * (tarea 6.1, ADR 41) — este archivo verifica el RUTEO de los ocho
 * comandos, las dos ranuras del closure y el orden de evaluación (§6.3).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type Database from "better-sqlite3";
import {
  buildOnComandoEmpleado,
  createSolicitudStore,
  createSolicitudA2AEntranteStore,
  createRolEmpleadoEscritor,
  type BuildOnComandoEmpleadoDeps,
} from "./build-on-comando-empleado.js";
import { COMANDOS } from "./core/commands/comando-empleado.js";
import {
  VENTA_ESTADO_CONFIRMADA,
  type Venta,
  type VentaStorePort,
} from "./core/ventas/ventas-contract.js";
import type { VentasConfig } from "./core/ventas/ventas-config.js";
import type { AuthConfig } from "./core/auth/auth-config.js";
import type { CredencialesEmpleadoPort } from "./core/auth/credenciales-contract.js";
import {
  COMANDO_ASIGNAR_ROL,
  COMANDO_CONSULTAR_KPI,
  COMANDO_CREAR_EMPLEADO,
  COMANDO_REPORTE_COMISIONES,
  COMANDO_VER_SOLICITUDES_A2A,
  RESULTADO_ATENDIDA,
  RESULTADO_AUTODEGRADACION_PROHIBIDA,
  RESULTADO_EXITOSA,
  RESULTADO_FALLIDA,
  RESULTADO_NO_APLICABLE,
  RESULTADO_NO_AUTORIZADO,
  type RegistroAccionesEmpleadoPort,
} from "./core/commands/registro-acciones-contract.js";
import { ROL_ADMINISTRADOR, ROL_EMPLEADO, type RolEmpleado, type RolEmpleadoPort } from "./core/auth/rol-contract.js";
import { agruparReporteMensual, formatearReporteMensual } from "./core/ventas/reporte.js";
import type { ReporteStorePort } from "./core/ventas/reporte-contract.js";
import {
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
  TASK_STATE_SUBMITTED,
  TASK_STATE_WORKING,
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
  insertSolicitudA2AEntrante,
  buscarRolEmpleado,
  upsertRolEmpleado,
  insertCredencialEmpleado,
  buscarCredencialEmpleado,
} from "./adapters/memory/repository.js";

/**
 * `comandos-administracion-empleados`, tarea 5 — "comando de prueba
 * sintético" (Approach punto 1 de `proposal.md`): el gate genérico de
 * administrador se prueba ANTES de que exista ningún comando administrativo
 * real (`/asignar-rol`/`/crear-empleado` llegan en la PR3, bloqueada). Se
 * mockea SOLO `requiereAdministrador` (el resto del módulo queda real, vía
 * `importOriginal`) para fabricar, por test, que un tipo YA EXISTENTE
 * (`reporte_comisiones`) "requiere administrador" — sin tocar `DESCRIPTORES`
 * real, que hoy declara los dieciocho en `false` (tarea 2). Default `() =>
 * false`: idéntico al comportamiento real de hoy para CUALQUIER tipo, así
 * que el resto de las suites de este archivo (que no tocan este describe)
 * no se ven afectadas.
 */
const { requiereAdministradorMock } = vi.hoisted(() => ({
  requiereAdministradorMock: vi.fn((_tipo: string) => false),
}));
vi.mock("./core/commands/comando-empleado.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./core/commands/comando-empleado.js")>();
  return { ...actual, requiereAdministrador: requiereAdministradorMock };
});

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

/**
 * Default `administrador` (rol elevado) en `makeDeps`/`makeKpiDeps`, MISMO
 * molde/razón que `resolver-escalacion-reembolso.test.ts`: así los fixtures
 * existentes, que no ejercitan el gate de rol, siguen pasando sin tocar cada
 * `it`. Los tests nuevos del gate (rol base) pasan un `rolPort` explícito por
 * override. Sin default parameter: `undefined` explícito = ausencia de fila
 * (ADR 154 pto 5), no un valor por default de JS.
 */
function makeRolPort(rol: RolEmpleado | undefined): RolEmpleadoPort {
  return { buscarRol: () => rol };
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
  return { sesionTtlMinutos: 30, sesionInactividadMinutos: 30, ...overrides };
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
    cancelarSolicitud: vi.fn(() => undefined),
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
    rolPort: makeRolPort(ROL_ADMINISTRADOR),
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
    /**
     * `autorizacion-empleado`, tarea 4.2 — default `administrador`, MISMO
     * criterio que `makeDeps`: estos tests ejercitan otras cosas (ADR 85,
     * ADR 121, confirmación pendiente), no el gate de rol. `db` es REAL acá,
     * así que sin este default caerían al rol base por ausencia de fila.
     */
    rolPort: makeRolPort(ROL_ADMINISTRADOR),
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

    for (const texto of ["/ver-propuesta", "/reporte-comisiones", "/estado-bot-prs"]) {
      const resultado = await handler(texto);
      expect(resultado.agentLabel).toBe("sistema");
      expect(resultado.responseText).toContain("/login");
    }

    expect(store.crearVentaConCaso).not.toHaveBeenCalled();
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
  it("/soporte deja fila con el empleado_id DE LA SESIÓN", async () => {
    const reloj: Reloj = { ahora: TIMESTAMP };
    const registro = makeRegistro();
    const deps = makeDeps(reloj, { registro, verificarPassword: vi.fn(() => true) });
    const handler = buildOnComandoEmpleado(deps);

    await login(handler);
    await handler("/soporte necesito ayuda");

    const filas = vi.mocked(registro.registrarAccion).mock.calls.map((c) => c[0]);
    expect(filas.some((f) => f.comando === "/soporte" && f.empleadoId === "ana")).toBe(true);
  });

  /**
   * `devolucion-sin-token-dos-personas`, tarea 22 (ADR 231 pto 4/§0.4 — ★
   * SEGUNDO escritor obligatorio, TUI). Sin este escritor, R16 queda
   * abierta: la ranura de la TUI seguiría venciendo por el TTL absoluto
   * viejo aunque `sesionInactividadMinutos` esté configurado.
   */
  it("★ sesión de TUI en uso continuo NO expira por inactividad (ADR 231, segundo escritor obligatorio)", async () => {
    const reloj: Reloj = { ahora: "2026-09-01T10:00:00.000Z" };
    const registro = makeRegistro();
    const deps = makeDeps(reloj, {
      registro,
      verificarPassword: vi.fn(() => true),
      // Tope absoluto DESACTIVADO a propósito, para aislar el efecto de la
      // inactividad: si este test fallara por el tope, no probaría nada.
      authConfig: makeAuthConfig({ sesionTtlMinutos: 0, sesionInactividadMinutos: 5 }),
    });
    const handler = buildOnComandoEmpleado(deps);

    await login(handler); // T+0: inactivaEn sellado en T+5min
    vi.mocked(registro.registrarAccion).mockClear();

    reloj.ahora = "2026-09-01T10:04:00.000Z"; // T+4min, dentro de la ventana ⇒ renueva a T+9min
    await handler("/soporte necesito ayuda");

    // T+8min desde el login: sin renovación, la ventana original (T+5min) ya
    // habría vencido. CON renovación (T+9min tras el uso anterior), sigue vigente.
    reloj.ahora = "2026-09-01T10:08:00.000Z";
    await handler("/soporte necesito ayuda de nuevo");

    const filas = vi.mocked(registro.registrarAccion).mock.calls.map((c) => c[0]);
    expect(filas.filter((f) => f.comando === "/soporte" && f.empleadoId === "ana")).toHaveLength(2);
  });

  it("sesión de TUI ociosa vence igual que hoy si no hay uso intermedio dentro de la ventana de inactividad", async () => {
    const reloj: Reloj = { ahora: "2026-09-01T10:00:00.000Z" };
    const registro = makeRegistro();
    const writes: string[] = [];
    const deps = makeDeps(reloj, {
      registro,
      writes,
      verificarPassword: vi.fn(() => true),
      authConfig: makeAuthConfig({ sesionTtlMinutos: 0, sesionInactividadMinutos: 5 }),
    });
    const handler = buildOnComandoEmpleado(deps);

    await login(handler); // T+0: inactivaEn sellado en T+5min
    vi.mocked(registro.registrarAccion).mockClear();

    reloj.ahora = "2026-09-01T10:06:00.000Z"; // T+6min, sin uso intermedio ⇒ vencida
    await handler("/soporte necesito ayuda");

    expect(registro.registrarAccion).not.toHaveBeenCalled();
    expect(JSON.stringify(writes)).toContain("sesion-expirada");
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

});

describe("buildOnComandoEmpleado — los CINCO comandos HITL se dieron de baja (aprobacion-conversacional-hitl, ADR 210 pto 1): /aprobar-solicitud y /rechazar-solicitud (tarea 10) + /aprobar-reembolso, /rechazar-reembolso y /reabrir-reembolso (tarea 14) — la resolución en dos pasos de Hito 5 tarea 23/§6.4 y los gates de rol de autorizacion-empleado tarea 4.2 quedan como registro histórico, ya no aplican: se resuelven por conversación vía la herramienta `operaciones` (resolver_solicitud/resolver_reembolso, ADR 206, ejecutar-operacion.test.ts). También cierra la nota de alcance de la tarea 22/tarea 12 sobre `ConfirmacionPendiente` ensanchada por dominio (ADR 55): con los cinco comandos HITL bajados, `dominio: \"propuesta\"` es la ÚNICA rama viva — no hay más ranura multi-dominio que probar.", () => {
  it.each([
    "/aprobar-solicitud sol-1",
    "/aprobar-solicitud",
    "/rechazar-solicitud sol-1",
    "/rechazar-solicitud",
    "/aprobar-reembolso v-1",
    "/aprobar-reembolso",
    "/rechazar-reembolso v-1",
    "/rechazar-reembolso",
    "/reabrir-reembolso v-1",
    "/reabrir-reembolso",
  ])(
    "%j cae en ayuda/desconocido, sin tocar solicitudStore ni el store de ventas",
    async (texto) => {
      const reloj: Reloj = { ahora: TIMESTAMP };
      const registro = makeRegistro();
      const solicitudStore = makeSolicitudStore();
      const store = makeStore();
      const deps = makeDeps(reloj, { solicitudStore, store, registro, verificarPassword: vi.fn(() => true) });
      const handler = buildOnComandoEmpleado(deps);
      await login(handler);
      vi.mocked(registro.registrarAccion).mockClear(); // limpia la fila de /login

      const resultado = await handler(texto);

      expect(resultado.agentLabel).toBe("sistema");
      expect(resultado.responseText).toContain(texto.split(" ")[0]);
      expect(solicitudStore.listarSolicitudesPendientes).not.toHaveBeenCalled();
      expect(solicitudStore.aprobarSolicitud).not.toHaveBeenCalled();
      expect(solicitudStore.rechazarSolicitud).not.toHaveBeenCalled();
      expect(store.listarReembolsosPendientes).not.toHaveBeenCalled();
      expect(store.listarReembolsosRechazados).not.toHaveBeenCalled();
      expect(store.aprobarEscalacionReembolso).not.toHaveBeenCalled();
      expect(store.rechazarEscalacionReembolso).not.toHaveBeenCalled();
      expect(store.reabrirEscalacionReembolso).not.toHaveBeenCalled();
      expect(registro.registrarAccion).not.toHaveBeenCalled();
    },
  );
});

describe("buildOnComandoEmpleado — invariante: comandos privilegiados de solo lectura no exigen rol elevado (autorizacion-empleado, tarea 4.2)", () => {
  it("/consultar-kpi responde con éxito para un empleado con rol BASE, con cualquier sesión vigente — sin condición de rol nueva", async () => {
    const db = openDatabase(":memory:");
    try {
      const reloj: Reloj = { ahora: TIMESTAMP };
      const clienteA2A = makeClienteA2A();
      const deps = makeKpiDeps(db, reloj, { clienteA2A, rolPort: makeRolPort(ROL_EMPLEADO) });
      const handler = buildOnComandoEmpleado(deps);
      await login(handler);

      const resultado = await handler("/consultar-kpi cuál fue el pico de latencia");

      expect(resultado.agentLabel).toBe("sistema");
      expect(resultado.responseText).toBe("todo en orden");
      expect(contarFilasRegistro(db, COMANDO_CONSULTAR_KPI)).toBe(1);
    } finally {
      db.close();
    }
  });

  it("/reporte-comisiones responde con éxito para un empleado con rol BASE, con cualquier sesión vigente — sin condición de rol nueva", async () => {
    const db = openDatabase(":memory:");
    try {
      const reloj: Reloj = { ahora: TIMESTAMP };
      const reporteStore = makeReporteStore();
      const deps = makeKpiDeps(db, reloj, { reporteStore, rolPort: makeRolPort(ROL_EMPLEADO) });
      const handler = buildOnComandoEmpleado(deps);
      await login(handler);

      const resultado = await handler("/reporte-comisiones 2026-08");

      expect(resultado.agentLabel).toBe("sistema");
      expect(resultado.responseText).toContain("Reporte de comisiones");
      expect(resultado.responseText.toLowerCase()).not.toContain("no estás autorizado");
    } finally {
      db.close();
    }
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

describe("buildOnComandoEmpleado — /estado-bot-prs (comandos-administracion-empleados, tarea 3, ADR 185)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function contarFilasTotales(db: Database.Database): number {
    const row = db.prepare("SELECT count(*) as total FROM registro_acciones_empleado").get() as { total: number };
    return row.total;
  }

  it("sin sesión pide /login, cero fila", async () => {
    const db = openDatabase(":memory:");
    try {
      const reloj: Reloj = { ahora: TIMESTAMP };
      const deps = makeKpiDeps(db, reloj, {});
      const handler = buildOnComandoEmpleado(deps);

      const resultado = await handler("/estado-bot-prs");

      expect(resultado.agentLabel).toBe("sistema");
      expect(resultado.responseText).toContain("/login");
      expect(contarFilasTotales(db)).toBe(0);
    } finally {
      db.close();
    }
  });

  it("rol BASE con sesión responde IGUAL que un administrador — no gateado (requiereAdministrador: false, sin consumidor todavía)", async () => {
    const dbAdmin = openDatabase(":memory:");
    const dbBase = openDatabase(":memory:");
    try {
      vi.stubEnv("GITHUB_WEBHOOK_SECRET", "s3cr3t");
      const reloj: Reloj = { ahora: TIMESTAMP };

      const depsAdmin = makeKpiDeps(dbAdmin, reloj, { rolPort: makeRolPort(ROL_ADMINISTRADOR) });
      const handlerAdmin = buildOnComandoEmpleado(depsAdmin);
      await login(handlerAdmin);
      const resultadoAdmin = await handlerAdmin("/estado-bot-prs");

      const depsBase = makeKpiDeps(dbBase, reloj, { rolPort: makeRolPort(ROL_EMPLEADO) });
      const handlerBase = buildOnComandoEmpleado(depsBase);
      await login(handlerBase);
      const resultadoBase = await handlerBase("/estado-bot-prs");

      expect(resultadoBase.responseText).toBe(resultadoAdmin.responseText);
      expect(resultadoBase.responseText.toLowerCase()).not.toContain("no estás autorizado");
    } finally {
      dbAdmin.close();
      dbBase.close();
    }
  });

  it("listener habilitado (GITHUB_WEBHOOK_SECRET seteado) ⇒ responde puerto y path", async () => {
    const db = openDatabase(":memory:");
    try {
      vi.stubEnv("GITHUB_WEBHOOK_SECRET", "s3cr3t");
      vi.stubEnv("WEBHOOK_PORT", "9999");
      vi.stubEnv("WEBHOOK_PATH", "/hooks/gh");
      const reloj: Reloj = { ahora: TIMESTAMP };
      const deps = makeKpiDeps(db, reloj, {});
      const handler = buildOnComandoEmpleado(deps);
      await login(handler);

      const resultado = await handler("/estado-bot-prs");

      expect(resultado.responseText).toContain("9999");
      expect(resultado.responseText).toContain("/hooks/gh");
      expect(resultado.responseText.toLowerCase()).not.toContain("deshabilitado");
    } finally {
      db.close();
    }
  });

  it("listener deshabilitado (sin GITHUB_WEBHOOK_SECRET) ⇒ responde 'deshabilitado (sin GITHUB_WEBHOOK_SECRET)'", async () => {
    const db = openDatabase(":memory:");
    try {
      vi.stubEnv("GITHUB_WEBHOOK_SECRET", "");
      const reloj: Reloj = { ahora: TIMESTAMP };
      const deps = makeKpiDeps(db, reloj, {});
      const handler = buildOnComandoEmpleado(deps);
      await login(handler);

      const resultado = await handler("/estado-bot-prs");

      expect(resultado.responseText).toContain("deshabilitado (sin GITHUB_WEBHOOK_SECRET)");
    } finally {
      db.close();
    }
  });

  it("GITHUB_TOKEN presente ⇒ 'presente', NUNCA el valor del token en el texto", async () => {
    const db = openDatabase(":memory:");
    try {
      vi.stubEnv("GITHUB_TOKEN", "ghp_secretoMuyLargo123");
      const reloj: Reloj = { ahora: TIMESTAMP };
      const deps = makeKpiDeps(db, reloj, {});
      const handler = buildOnComandoEmpleado(deps);
      await login(handler);

      const resultado = await handler("/estado-bot-prs");

      expect(resultado.responseText).toContain("presente");
      expect(resultado.responseText).not.toContain("ghp_secretoMuyLargo123");
    } finally {
      db.close();
    }
  });

  it("GITHUB_TOKEN ausente ⇒ 'ausente'", async () => {
    const db = openDatabase(":memory:");
    try {
      vi.stubEnv("GITHUB_TOKEN", "");
      const reloj: Reloj = { ahora: TIMESTAMP };
      const deps = makeKpiDeps(db, reloj, {});
      const handler = buildOnComandoEmpleado(deps);
      await login(handler);

      const resultado = await handler("/estado-bot-prs");

      expect(resultado.responseText).toContain("ausente");
    } finally {
      db.close();
    }
  });

  it("cero filas nuevas en registro_acciones_empleado — es una lectura, sin registrar()", async () => {
    const db = openDatabase(":memory:");
    try {
      vi.stubEnv("GITHUB_WEBHOOK_SECRET", "s3cr3t");
      vi.stubEnv("GITHUB_TOKEN", "ghp_x");
      const reloj: Reloj = { ahora: TIMESTAMP };
      const deps = makeKpiDeps(db, reloj, {});
      const handler = buildOnComandoEmpleado(deps);
      await login(handler);

      const antes = contarFilasTotales(db);
      await handler("/estado-bot-prs");
      const despues = contarFilasTotales(db);

      expect(despues).toBe(antes);
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

  it("cancelarSolicitud: transiciona una fila pendiente a cancelada sin lanzar (comando-cancelar-solicitud, tarea 7)", () => {
    withDb((db) => {
      const store = createSolicitudStore(db);
      const creada = store.crearSolicitudConCaso({
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

      let cancelada: SolicitudInterna | undefined;
      expect(() => {
        cancelada = store.cancelarSolicitud({
          solicitudId: creada.id,
          casoId: creada.casoId,
          empleadoId: "emp-1",
          accionId: "accion-1",
          ahora: TIMESTAMP,
        });
      }).not.toThrow();

      expect(cancelada?.estado).toBe(SOLICITUD_ESTADO_CANCELADA);
    });
  });
});

/**
 * `toPortSolicitudA2AEntrante`/`createSolicitudA2AEntranteStore`
 * (comando-visibilidad-a2a-entrante, tarea 4, ADR 141) — molde de la suite
 * `createSolicitudStore` de arriba: `toPortSolicitudA2AEntrante` NO se
 * exporta (mismo criterio que `toPortSolicitud`/`toPortPropuesta`, nunca
 * testeadas en forma directa en este archivo), así que se ejercita
 * INDIRECTAMENTE a través de `createSolicitudA2AEntranteStore(db)` sobre
 * SQLite real — mismo patrón que el test de
 * `SolicitudTipoEstadoInvalidoError` arriba (`:2264`), que tampoco llama a
 * `toPortSolicitud` en forma directa.
 */
describe("createSolicitudA2AEntranteStore / toPortSolicitudA2AEntrante (comando-visibilidad-a2a-entrante, tarea 4)", () => {
  function withDb<T>(fn: (db: Database.Database) => T): T {
    const db = openDatabase(":memory:");
    try {
      return fn(db);
    } finally {
      db.close();
    }
  }

  function seedA2AEntrante(
    db: Database.Database,
    overrides: { readonly id: string; readonly a2aTaskId: string; readonly estado: string },
  ): void {
    insertSolicitudA2AEntrante(db, {
      id: overrides.id,
      a2aTaskId: overrides.a2aTaskId,
      origenTransporte: "https://externo.example.test/rpc",
      mensajeRecibido: "hola",
      estado: overrides.estado,
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
    });
  }

  it("obtenerPorTaskId: estado 'BASURA' (no conocido) devuelve { conocido: false, valor: 'BASURA' } sin lanzar", () => {
    withDb((db) => {
      seedA2AEntrante(db, { id: "sol-a2a-1", a2aTaskId: "task-basura", estado: "BASURA" });
      const store = createSolicitudA2AEntranteStore(db);

      let vista: ReturnType<typeof store.obtenerPorTaskId>;
      expect(() => {
        vista = store.obtenerPorTaskId("task-basura");
      }).not.toThrow();

      expect(vista?.estado).toEqual({ conocido: false, valor: "BASURA" });
    });
  });

  it("obtenerPorTaskId: estado TASK_STATE_WORKING (conocido) devuelve { conocido: true, valor: 'TASK_STATE_WORKING' }", () => {
    withDb((db) => {
      seedA2AEntrante(db, { id: "sol-a2a-2", a2aTaskId: "task-working", estado: TASK_STATE_WORKING });
      const store = createSolicitudA2AEntranteStore(db);

      const vista = store.obtenerPorTaskId("task-working");

      expect(vista?.estado).toEqual({ conocido: true, valor: TASK_STATE_WORKING });
    });
  });

  it("R1 estructural: la vista nunca expone 'agenteExternoUrl' ni 'id', ni siquiera en runtime (ADR 139 pto 3)", () => {
    withDb((db) => {
      seedA2AEntrante(db, { id: "sol-a2a-3", a2aTaskId: "task-r1", estado: TASK_STATE_WORKING });
      const store = createSolicitudA2AEntranteStore(db);

      const vista = store.obtenerPorTaskId("task-r1");

      expect(vista).toBeDefined();
      expect("agenteExternoUrl" in (vista as object)).toBe(false);
      expect("id" in (vista as object)).toBe(false);
    });
  });

  it("listarPorEstados + obtenerPorTaskId: ida y vuelta sobre SQLite real con la tarea 3 (listSolicitudesA2AEntrantesPorEstado)", () => {
    withDb((db) => {
      seedA2AEntrante(db, { id: "sol-a2a-4", a2aTaskId: "task-en-curso", estado: TASK_STATE_WORKING });
      seedA2AEntrante(db, { id: "sol-a2a-5", a2aTaskId: "task-completada", estado: TASK_STATE_COMPLETED });
      const store = createSolicitudA2AEntranteStore(db);

      const listado = store.listarPorEstados({ estados: [TASK_STATE_WORKING] });

      expect(listado.hayMas).toBe(false);
      expect(listado.items).toHaveLength(1);
      expect(listado.items[0]?.a2aTaskId).toBe("task-en-curso");
      expect(listado.items[0]?.estado).toEqual({ conocido: true, valor: TASK_STATE_WORKING });

      const detalle = store.obtenerPorTaskId("task-completada");
      expect(detalle?.a2aTaskId).toBe("task-completada");
      expect(detalle?.estado).toEqual({ conocido: true, valor: TASK_STATE_COMPLETED });

      expect(store.obtenerPorTaskId("no-existe")).toBeUndefined();
    });
  });
});

/**
 * `/ver-solicitudes-a2a` — cableado del dispatcher (comando-visibilidad-a2a-
 * entrante, tarea 8, ADR 134/143). Molde de la suite `/consultar-kpi`
 * (Hito 6, tarea 20): `db` es un `openDatabase(":memory:")` REAL vía
 * `makeKpiDeps` — ni `registro` ni `solicitudA2AEntranteStore` se
 * sobreescriben, así que corren los defaults REALES de
 * `buildOnComandoEmpleado` (`insertAccionEmpleado(db, ...)` /
 * `createSolicitudA2AEntranteStore(db)`) — es la única forma de ejercitar
 * `registrar(...)` y `listSolicitudesA2AEntrantesPorEstado` de punta a
 * punta, tal como exige la tarea.
 */
describe("buildOnComandoEmpleado — /ver-solicitudes-a2a (comando-visibilidad-a2a-entrante, tarea 8)", () => {
  function seedA2A(
    db: Database.Database,
    overrides: {
      readonly id: string;
      readonly a2aTaskId: string;
      readonly estado: string;
      readonly updatedAt?: string;
      readonly casoId?: string;
    },
  ): void {
    insertSolicitudA2AEntrante(db, {
      id: overrides.id,
      a2aTaskId: overrides.a2aTaskId,
      origenTransporte: "https://externo.example.test/rpc",
      mensajeRecibido: "hola",
      estado: overrides.estado,
      ...(overrides.casoId !== undefined ? { casoId: overrides.casoId } : {}),
      createdAt: overrides.updatedAt ?? TIMESTAMP,
      updatedAt: overrides.updatedAt ?? TIMESTAMP,
    });
  }

  it("sin argumento, filtra por TASK_STATES_EN_CURSO a nivel handler (end-to-end sobre SQLite real)", async () => {
    const db = openDatabase(":memory:");
    try {
      const reloj: Reloj = { ahora: TIMESTAMP };
      seedA2A(db, { id: "sol-1", a2aTaskId: "task-submitted", estado: TASK_STATE_SUBMITTED });
      seedA2A(db, { id: "sol-2", a2aTaskId: "task-working", estado: TASK_STATE_WORKING });
      seedA2A(db, { id: "sol-3", a2aTaskId: "task-completed", estado: TASK_STATE_COMPLETED });
      const deps = makeKpiDeps(db, reloj, {});
      const handler = buildOnComandoEmpleado(deps);
      await login(handler);

      const resultado = await handler("/ver-solicitudes-a2a");

      expect(resultado.agentLabel).toBe("sistema");
      expect(resultado.responseText).toContain("task-submitted");
      expect(resultado.responseText).toContain("task-working");
      expect(resultado.responseText).not.toContain("task-completed");
    } finally {
      db.close();
    }
  });

  it("★ el caso del Hallazgo 2: una fila TASK_STATE_WORKING con updated_at viejo aparece PRIMERA en el listado sin argumento", async () => {
    const db = openDatabase(":memory:");
    try {
      const reloj: Reloj = { ahora: TIMESTAMP };
      // La huérfana: quedó en WORKING con updated_at de una sesión anterior
      // (proceso ya terminado, ej. taskkill /F) — es el escenario que motivó el change.
      seedA2A(db, {
        id: "sol-huerfana",
        a2aTaskId: "task-huerfana-vieja",
        estado: TASK_STATE_WORKING,
        updatedAt: "2020-01-01T00:00:00.000Z",
      });
      // La legítimamente en curso, más reciente.
      seedA2A(db, {
        id: "sol-viva",
        a2aTaskId: "task-viva-reciente",
        estado: TASK_STATE_WORKING,
        updatedAt: "2026-06-01T00:00:00.000Z",
      });
      const deps = makeKpiDeps(db, reloj, {});
      const handler = buildOnComandoEmpleado(deps);
      await login(handler);

      const resultado = await handler("/ver-solicitudes-a2a");

      const posicionHuerfana = resultado.responseText.indexOf("task-huerfana-vieja");
      const posicionViva = resultado.responseText.indexOf("task-viva-reciente");
      expect(posicionHuerfana).toBeGreaterThanOrEqual(0);
      expect(posicionViva).toBeGreaterThanOrEqual(0);
      // No basta con que las dos aparezcan: el orden es la garantía (updated_at ASC).
      expect(posicionHuerfana).toBeLessThan(posicionViva);
    } finally {
      db.close();
    }
  });

  it("auditoría: listado exitoso deja UNA fila /ver-solicitudes-a2a/atendida SIN caso_id", async () => {
    const db = openDatabase(":memory:");
    try {
      const reloj: Reloj = { ahora: TIMESTAMP };
      seedA2A(db, { id: "sol-1", a2aTaskId: "task-1", estado: TASK_STATE_WORKING });
      const deps = makeKpiDeps(db, reloj, {});
      const handler = buildOnComandoEmpleado(deps);
      await login(handler);

      await handler("/ver-solicitudes-a2a");

      expect(contarFilasRegistro(db, COMANDO_VER_SOLICITUDES_A2A)).toBe(1);
      const fila = db
        .prepare("SELECT resultado, caso_id FROM registro_acciones_empleado WHERE comando = ?")
        .get(COMANDO_VER_SOLICITUDES_A2A) as { resultado: string; caso_id: string | null };
      expect(fila.resultado).toBe(RESULTADO_ATENDIDA);
      expect(fila.caso_id).toBeNull();
    } finally {
      db.close();
    }
  });

  it("auditoría: detalle encontrado deja fila atendida CON caso_id", async () => {
    const db = openDatabase(":memory:");
    try {
      const reloj: Reloj = { ahora: TIMESTAMP };
      createCaso(db, {
        id: "caso-a2a-1",
        tipo: "consulta_kpi",
        estado: "activo",
        createdAt: TIMESTAMP,
        updatedAt: TIMESTAMP,
      });
      seedA2A(db, { id: "sol-1", a2aTaskId: "task-con-caso", estado: TASK_STATE_COMPLETED, casoId: "caso-a2a-1" });
      const deps = makeKpiDeps(db, reloj, {});
      const handler = buildOnComandoEmpleado(deps);
      await login(handler);

      const resultado = await handler("/ver-solicitudes-a2a task-con-caso");

      expect(resultado.responseText).toContain("task-con-caso");
      const fila = db
        .prepare("SELECT resultado, caso_id FROM registro_acciones_empleado WHERE comando = ?")
        .get(COMANDO_VER_SOLICITUDES_A2A) as { resultado: string; caso_id: string | null };
      expect(fila.resultado).toBe(RESULTADO_ATENDIDA);
      expect(fila.caso_id).toBe("caso-a2a-1");
    } finally {
      db.close();
    }
  });

  it("auditoría: id inexistente deja fila no_aplicable, responde sin lanzar", async () => {
    const db = openDatabase(":memory:");
    try {
      const reloj: Reloj = { ahora: TIMESTAMP };
      const deps = makeKpiDeps(db, reloj, {});
      const handler = buildOnComandoEmpleado(deps);
      await login(handler);

      let resultado: TuiTurnResult | undefined;
      await expect(async () => {
        resultado = await handler("/ver-solicitudes-a2a no-existe");
      }).not.toThrow();

      expect(resultado?.responseText).toBe("No existe ninguna solicitud A2A no-existe.");
      const fila = db
        .prepare("SELECT resultado, caso_id FROM registro_acciones_empleado WHERE comando = ?")
        .get(COMANDO_VER_SOLICITUDES_A2A) as { resultado: string; caso_id: string | null };
      expect(fila.resultado).toBe(RESULTADO_NO_APLICABLE);
      expect(fila.caso_id).toBeNull();
    } finally {
      db.close();
    }
  });

  it("auditoría: sin sesión vigente, cero filas (corta en la guarda de privilegio, antes del handler)", async () => {
    const db = openDatabase(":memory:");
    try {
      const reloj: Reloj = { ahora: TIMESTAMP };
      const deps = makeKpiDeps(db, reloj, {});
      const handler = buildOnComandoEmpleado(deps);

      const resultado = await handler("/ver-solicitudes-a2a");

      expect(resultado.agentLabel).toBe("sistema");
      expect(resultado.responseText).toContain("/login");
      expect(contarFilasRegistro(db, COMANDO_VER_SOLICITUDES_A2A)).toBe(0);
    } finally {
      db.close();
    }
  });

  it("lo que NO hace (ADR 134): ni casos ni delegaciones_a2a ganan filas en ninguno de los dos modos", async () => {
    const db = openDatabase(":memory:");
    try {
      const reloj: Reloj = { ahora: TIMESTAMP };
      seedA2A(db, { id: "sol-1", a2aTaskId: "task-1", estado: TASK_STATE_WORKING });
      const deps = makeKpiDeps(db, reloj, {});
      const handler = buildOnComandoEmpleado(deps);
      await login(handler);

      await handler("/ver-solicitudes-a2a");
      await handler("/ver-solicitudes-a2a task-1");
      await handler("/ver-solicitudes-a2a no-existe");

      expect(contarCasos(db)).toBe(0);
      const filaDelegaciones = db.prepare("SELECT count(*) as total FROM delegaciones_a2a").get() as {
        total: number;
      };
      expect(filaDelegaciones.total).toBe(0);
    } finally {
      db.close();
    }
  });


  it("lo que NO hace (ADR 134): el handler no es `async` (inspección de firma, molde manejarVerPropuesta)", () => {
    const source = readFileSync(new URL("./build-on-comando-empleado.ts", import.meta.url), "utf8");

    expect(source).toContain("function manejarVerSolicitudesA2A(");
    expect(source).not.toContain("async function manejarVerSolicitudesA2A(");
  });
});

/**
 * `comandos-administracion-empleados`, tarea 5 (ADR 175/183 parte 2, RD-84)
 * — el gate genérico de `administrador` en el dispatcher, paso 6.5: DESPUÉS
 * de la guarda de sesión existente (paso 6, sin cambios) y ANTES del
 * `switch`. Comando de prueba sintético (Approach punto 1 de
 * `proposal.md`): `requiereAdministrador` fabricado a `true` para el tipo
 * YA EXISTENTE `reporte_comisiones`, vía el mock de módulo de arriba — sin
 * tocar `DESCRIPTORES` real, que hoy declara los dieciocho en `false`.
 */
describe("buildOnComandoEmpleado — gate de administrador, comando sintético (comandos-administracion-empleados, tarea 5, ADR 183/RD-84)", () => {
  afterEach(() => {
    requiereAdministradorMock.mockImplementation(() => false);
  });

  it("rol base ⇒ rechazado con mensaje de rol administrador, el handler real NO corre, fila no_autorizado", async () => {
    requiereAdministradorMock.mockImplementation((tipo: string) => tipo === "reporte_comisiones");
    const reloj: Reloj = { ahora: TIMESTAMP };
    const registro = makeRegistro();
    const reporteStore = makeReporteStore();
    const deps = makeDeps(reloj, { registro, reporteStore, rolPort: makeRolPort(ROL_EMPLEADO) });
    const handler = buildOnComandoEmpleado(deps);
    await login(handler);
    vi.mocked(registro.registrarAccion).mockClear(); // limpia la fila de /login

    const resultado = await handler("/reporte-comisiones 2026-08");

    expect(resultado.responseText.toLowerCase()).toContain("administrador");
    expect(reporteStore.listComisionesPorPeriodo).not.toHaveBeenCalled();
    expect(registro.registrarAccion).toHaveBeenCalledTimes(1);
    const fila = vi.mocked(registro.registrarAccion).mock.calls[0]?.[0];
    expect(fila).toMatchObject({
      comando: COMANDO_REPORTE_COMISIONES,
      resultado: RESULTADO_NO_AUTORIZADO,
      empleadoId: "ana",
    });
  });

  it("rol administrador ⇒ el gate deja pasar y el handler real corre", async () => {
    requiereAdministradorMock.mockImplementation((tipo: string) => tipo === "reporte_comisiones");
    const reloj: Reloj = { ahora: TIMESTAMP };
    const reporteStore = makeReporteStore();
    const deps = makeDeps(reloj, { reporteStore, rolPort: makeRolPort(ROL_ADMINISTRADOR) });
    const handler = buildOnComandoEmpleado(deps);
    await login(handler);

    const resultado = await handler("/reporte-comisiones 2026-08");

    expect(resultado.responseText.toLowerCase()).not.toContain("requiere rol administrador");
    expect(reporteStore.listComisionesPorPeriodo).toHaveBeenCalled();
  });

  it("sin sesión: el rechazo es por sesión (guarda de privilegio, paso 6), el rol NUNCA se consulta", async () => {
    requiereAdministradorMock.mockImplementation((tipo: string) => tipo === "reporte_comisiones");
    const reloj: Reloj = { ahora: TIMESTAMP };
    const rolPort: RolEmpleadoPort = { buscarRol: vi.fn(makeRolPort(ROL_EMPLEADO).buscarRol) };
    const deps = makeDeps(reloj, { rolPort });
    const handler = buildOnComandoEmpleado(deps);

    const resultado = await handler("/reporte-comisiones 2026-08");

    expect(resultado.responseText).toContain("/login");
    expect(rolPort.buscarRol).not.toHaveBeenCalled();
  });
});

/**
 * `comandos-administracion-empleados`, tarea 6 (ADR 180, RD-82) —
 * `createRolEmpleadoEscritor`, MISMO molde exportado que
 * `createSolicitudStore`/`createSolicitudA2AEntranteStore` (arriba en este
 * mismo archivo): permite probar el adaptador por defecto de `rolEscritor`
 * contra un `db` real de SQLite en memoria SIN necesitar un comando real que
 * lo consuma todavía (`/asignar-rol` llega recién en la PR3, bloqueada).
 * `Deps.rolEscritor` es la costura opcional (molde `credenciales`/`rolPort`)
 * — `buildOnComandoEmpleado` construye este mismo adaptador como default
 * cuando `deps.rolEscritor` está ausente.
 */
describe("createRolEmpleadoEscritor (comandos-administracion-empleados, tarea 6, ADR 180/RD-82)", () => {
  it("asignarRol llama a upsertRolEmpleado con los tres campos exactos — verificado leyendo con buscarRolEmpleado", () => {
    const db = openDatabase(":memory:");
    try {
      const escritor = createRolEmpleadoEscritor(db);

      const resultado = escritor.asignarRol({ empleadoId: "ana", rol: ROL_ADMINISTRADOR, ahora: TIMESTAMP });

      expect(resultado).toBeUndefined();
      const fila = buscarRolEmpleado(db, "ana");
      expect(fila).toMatchObject({ empleadoId: "ana", rol: ROL_ADMINISTRADOR, createdAt: TIMESTAMP, updatedAt: TIMESTAMP });
    } finally {
      db.close();
    }
  });

  it("Deps.rolEscritor es opcional: buildOnComandoEmpleado se construye sin pasarlo, sin romper ningún fake existente", () => {
    const reloj: Reloj = { ahora: TIMESTAMP };
    const deps = makeDeps(reloj, {}); // sin rolEscritor — molde `credenciales`/`rolPort`
    expect(() => buildOnComandoEmpleado(deps)).not.toThrow();
  });
});

/**
 * `comandos-administracion-empleados`, tarea 7 (ADR 175 pto 4, 177, 182,
 * 184) — `/asignar-rol`, gateado por administrador (tarea 5), escribiendo
 * con `rolEscritor` (tarea 6). `db` REAL (`openDatabase(":memory:")`, no un
 * doble): `credenciales`/`rolPort`/`rolEscritor` quedan en sus defaults
 * REALES (closures sobre `db`) para que el gate lea el rol recién escrito
 * sin re-login — ver el último test, "efecto sin re-login". `registro` SÍ
 * es un doble (`makeRegistro`), para poder aserir sobre las filas de
 * auditoría con `vi.fn()`. `requiereAdministradorMock` (mock de módulo,
 * arriba en este archivo) se fuerza a `true` para `"asignar_rol"` en cada
 * test — el descriptor real YA declara `requiereAdministrador: true` (tarea
 * 7), pero el mock global de este archivo reemplaza la función entera, así
 * que hay que hacerlo explícito por test, mismo criterio que el describe de
 * la tarea 5.
 */
describe("buildOnComandoEmpleado — /asignar-rol (comandos-administracion-empleados, tarea 7, ADR 175 pto 4, 177, 182, 184)", () => {
  afterEach(() => {
    requiereAdministradorMock.mockImplementation(() => false);
  });

  /**
   * `credenciales`/`rolPort` REALES (closures sobre `db`, `exactOptionalPropertyTypes`
   * no permite pasar `undefined` explícito para "volver" al default interno
   * de `buildOnComandoEmpleado`) — MISMO molde inline que ese default,
   * duplicado a propósito acá para no depender de exportar los closures
   * internos solo para testear.
   */
  function realCredenciales(db: Database.Database): CredencialesEmpleadoPort {
    return {
      buscarCredencial: (empleadoId) => {
        const row = buscarCredencialEmpleado(db, empleadoId);
        return row ? { empleadoId: row.empleadoId, passwordHash: row.passwordHash } : undefined;
      },
    };
  }

  function realRolPort(db: Database.Database): RolEmpleadoPort {
    return {
      buscarRol: (empleadoId) => {
        const row = buscarRolEmpleado(db, empleadoId);
        return row ? (row.rol as RolEmpleado) : undefined;
      },
    };
  }

  function realDeps(
    db: Database.Database,
    reloj: Reloj,
    overrides: Partial<BuildOnComandoEmpleadoDeps> = {},
  ): BuildOnComandoEmpleadoDeps {
    return makeKpiDeps(db, reloj, {
      credenciales: realCredenciales(db),
      rolPort: realRolPort(db),
      authConfig: makeAuthConfig({ sesionTtlMinutos: 0 }),
      registro: makeRegistro(),
      ...overrides,
    });
  }

  it("administrador asciende a otro empleado ⇒ queda administrador, escrito por rolEscritor (upsertRolEmpleado), fila exitosa", async () => {
    requiereAdministradorMock.mockImplementation((tipo: string) => tipo === "asignar_rol");
    const db = openDatabase(":memory:");
    try {
      const reloj: Reloj = { ahora: TIMESTAMP };
      insertCredencialEmpleado(db, { empleadoId: "admin", passwordHash: "scrypt$hash", ahora: TIMESTAMP });
      upsertRolEmpleado(db, { empleadoId: "admin", rol: ROL_ADMINISTRADOR, ahora: TIMESTAMP });
      insertCredencialEmpleado(db, { empleadoId: "ana", passwordHash: "scrypt$hash", ahora: TIMESTAMP });
      const registro = makeRegistro();
      const deps = realDeps(db, reloj, { registro });
      const handler = buildOnComandoEmpleado(deps);
      await login(handler, "admin");
      vi.mocked(registro.registrarAccion).mockClear(); // limpia la fila de /login

      const resultado = await handler("/asignar-rol ana administrador");

      expect(resultado.responseText.toLowerCase()).toContain("administrador");
      expect(buscarRolEmpleado(db, "ana")).toMatchObject({ empleadoId: "ana", rol: ROL_ADMINISTRADOR });
      expect(registro.registrarAccion).toHaveBeenCalledTimes(1);
      const fila = vi.mocked(registro.registrarAccion).mock.calls[0]?.[0];
      expect(fila).toMatchObject({ comando: COMANDO_ASIGNAR_ROL, resultado: RESULTADO_EXITOSA, empleadoId: "admin" });
    } finally {
      db.close();
    }
  });

  it("asignar rol a un empleadoId sin credencial ⇒ falla, sin fila huérfana en roles_empleado", async () => {
    requiereAdministradorMock.mockImplementation((tipo: string) => tipo === "asignar_rol");
    const db = openDatabase(":memory:");
    try {
      const reloj: Reloj = { ahora: TIMESTAMP };
      insertCredencialEmpleado(db, { empleadoId: "admin", passwordHash: "scrypt$hash", ahora: TIMESTAMP });
      upsertRolEmpleado(db, { empleadoId: "admin", rol: ROL_ADMINISTRADOR, ahora: TIMESTAMP });
      const deps = realDeps(db, reloj);
      const handler = buildOnComandoEmpleado(deps);
      await login(handler, "admin");

      const resultado = await handler("/asignar-rol bob administrador");

      expect(resultado.responseText.toLowerCase()).toContain("bob");
      expect(buscarRolEmpleado(db, "bob")).toBeUndefined();
    } finally {
      db.close();
    }
  });

  it("rol base ejecuta /asignar-rol ⇒ rechazado por el gate (tarea 5), sin cambio en roles_empleado, fila no_autorizado", async () => {
    requiereAdministradorMock.mockImplementation((tipo: string) => tipo === "asignar_rol");
    const db = openDatabase(":memory:");
    try {
      const reloj: Reloj = { ahora: TIMESTAMP };
      insertCredencialEmpleado(db, { empleadoId: "ana", passwordHash: "scrypt$hash", ahora: TIMESTAMP });
      // "ana" SIN fila en roles_empleado ⇒ rol base por ausencia (ADR 154 pto 5).
      insertCredencialEmpleado(db, { empleadoId: "bob", passwordHash: "scrypt$hash", ahora: TIMESTAMP });
      const registro = makeRegistro();
      const deps = realDeps(db, reloj, { registro });
      const handler = buildOnComandoEmpleado(deps);
      await login(handler, "ana");
      vi.mocked(registro.registrarAccion).mockClear();

      const resultado = await handler("/asignar-rol bob administrador");

      expect(resultado.responseText.toLowerCase()).toContain("administrador");
      expect(buscarRolEmpleado(db, "bob")).toBeUndefined();
      expect(registro.registrarAccion).toHaveBeenCalledTimes(1);
      const fila = vi.mocked(registro.registrarAccion).mock.calls[0]?.[0];
      expect(fila).toMatchObject({ comando: COMANDO_ASIGNAR_ROL, resultado: RESULTADO_NO_AUTORIZADO, empleadoId: "ana" });
    } finally {
      db.close();
    }
  });

  it("★ único administrador intenta degradarse a sí mismo ⇒ rechazado sin conteo, rol sigue administrador, fila autodegradacion_prohibida (ADR 182)", async () => {
    requiereAdministradorMock.mockImplementation((tipo: string) => tipo === "asignar_rol");
    const db = openDatabase(":memory:");
    try {
      const reloj: Reloj = { ahora: TIMESTAMP };
      insertCredencialEmpleado(db, { empleadoId: "admin", passwordHash: "scrypt$hash", ahora: TIMESTAMP });
      upsertRolEmpleado(db, { empleadoId: "admin", rol: ROL_ADMINISTRADOR, ahora: TIMESTAMP });
      const registro = makeRegistro();
      const deps = realDeps(db, reloj, { registro });
      const handler = buildOnComandoEmpleado(deps);
      await login(handler, "admin");
      vi.mocked(registro.registrarAccion).mockClear();

      const resultado = await handler("/asignar-rol admin empleado");

      expect(resultado.responseText.toLowerCase()).toContain("no podés");
      expect(buscarRolEmpleado(db, "admin")).toMatchObject({ rol: ROL_ADMINISTRADOR });
      expect(registro.registrarAccion).toHaveBeenCalledTimes(1);
      const fila = vi.mocked(registro.registrarAccion).mock.calls[0]?.[0];
      expect(fila).toMatchObject({
        comando: COMANDO_ASIGNAR_ROL,
        resultado: RESULTADO_AUTODEGRADACION_PROHIBIDA,
        empleadoId: "admin",
      });
    } finally {
      db.close();
    }
  });

  it("con dos administradores, uno degrada al otro ⇒ éxito, sin restricción de auto-degradación (no aplica: son empleados distintos)", async () => {
    requiereAdministradorMock.mockImplementation((tipo: string) => tipo === "asignar_rol");
    const db = openDatabase(":memory:");
    try {
      const reloj: Reloj = { ahora: TIMESTAMP };
      insertCredencialEmpleado(db, { empleadoId: "admin1", passwordHash: "scrypt$hash", ahora: TIMESTAMP });
      upsertRolEmpleado(db, { empleadoId: "admin1", rol: ROL_ADMINISTRADOR, ahora: TIMESTAMP });
      insertCredencialEmpleado(db, { empleadoId: "admin2", passwordHash: "scrypt$hash", ahora: TIMESTAMP });
      upsertRolEmpleado(db, { empleadoId: "admin2", rol: ROL_ADMINISTRADOR, ahora: TIMESTAMP });
      const deps = realDeps(db, reloj);
      const handler = buildOnComandoEmpleado(deps);
      await login(handler, "admin1");

      const resultado = await handler("/asignar-rol admin2 empleado");

      expect(resultado.responseText.toLowerCase()).not.toContain("no podés");
      expect(buscarRolEmpleado(db, "admin2")).toMatchObject({ rol: ROL_EMPLEADO });
    } finally {
      db.close();
    }
  });

  it("quitarle el rol a un administrador tiene efecto SIN re-login (sesión sin expiraEn, SESION_TTL_MINUTOS=0, ADR 154 pto 1) — el rol se lee por puerto en cada comando, nunca se cachea en la sesión", async () => {
    requiereAdministradorMock.mockImplementation(
      (tipo: string) => tipo === "asignar_rol" || tipo === "reporte_comisiones",
    );
    const db = openDatabase(":memory:");
    try {
      const reloj: Reloj = { ahora: TIMESTAMP };
      insertCredencialEmpleado(db, { empleadoId: "admin1", passwordHash: "scrypt$hash", ahora: TIMESTAMP });
      upsertRolEmpleado(db, { empleadoId: "admin1", rol: ROL_ADMINISTRADOR, ahora: TIMESTAMP });
      insertCredencialEmpleado(db, { empleadoId: "admin2", passwordHash: "scrypt$hash", ahora: TIMESTAMP });
      upsertRolEmpleado(db, { empleadoId: "admin2", rol: ROL_ADMINISTRADOR, ahora: TIMESTAMP });

      // Dos dispatchers distintos, mismo `db` — dos terminales de la TUI.
      const handlerAdmin1 = buildOnComandoEmpleado(realDeps(db, reloj));
      const reporteStore = makeReporteStore();
      const handlerAdmin2 = buildOnComandoEmpleado(realDeps(db, reloj, { reporteStore }));

      // admin2 abre sesión ANTES de ser degradado — sesión sin expiraEn (TTL 0).
      await login(handlerAdmin2, "admin2");
      const antes = await handlerAdmin2("/reporte-comisiones 2026-08");
      expect(antes.responseText.toLowerCase()).not.toContain("administrador");
      expect(reporteStore.listComisionesPorPeriodo).toHaveBeenCalled();

      // admin1 degrada a admin2 — admin2 NUNCA vuelve a hacer /login.
      await login(handlerAdmin1, "admin1");
      await handlerAdmin1("/asignar-rol admin2 empleado");
      expect(buscarRolEmpleado(db, "admin2")).toMatchObject({ rol: ROL_EMPLEADO });

      // admin2 sigue con la MISMA sesión (sin re-login) — el gate lo rechaza igual.
      vi.mocked(reporteStore.listComisionesPorPeriodo).mockClear();
      const despues = await handlerAdmin2("/reporte-comisiones 2026-08");
      expect(despues.responseText.toLowerCase()).toContain("administrador");
      expect(reporteStore.listComisionesPorPeriodo).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  });
});

/**
 * `comandos-administracion-empleados`, tarea 8 (ADR 174, 181, 184) —
 * `/crear-empleado`, gateado por administrador (tarea 5), reusando
 * `altaCredencialEmpleado` (tarea 1, `src/empleados.ts`) — el MISMO molde
 * de `db` real y `credenciales`/`rolPort` reales que el describe de
 * `/asignar-rol` de arriba (`realCredenciales`/`realRolPort`, declaradas en
 * ESE describe — se redeclaran acá, más chico, porque `describe` no
 * comparte scope léxico entre bloques hermanos).
 */
describe("buildOnComandoEmpleado — /crear-empleado (comandos-administracion-empleados, tarea 8, ADR 174, 181, 184)", () => {
  afterEach(() => {
    requiereAdministradorMock.mockImplementation(() => false);
  });

  function realCredenciales(db: Database.Database): CredencialesEmpleadoPort {
    return {
      buscarCredencial: (empleadoId) => {
        const row = buscarCredencialEmpleado(db, empleadoId);
        return row ? { empleadoId: row.empleadoId, passwordHash: row.passwordHash } : undefined;
      },
    };
  }

  function realRolPort(db: Database.Database): RolEmpleadoPort {
    return {
      buscarRol: (empleadoId) => {
        const row = buscarRolEmpleado(db, empleadoId);
        return row ? (row.rol as RolEmpleado) : undefined;
      },
    };
  }

  function realDeps(
    db: Database.Database,
    reloj: Reloj,
    overrides: Partial<BuildOnComandoEmpleadoDeps> & { readonly writes?: string[] } = {},
  ): BuildOnComandoEmpleadoDeps {
    return makeKpiDeps(db, reloj, {
      credenciales: realCredenciales(db),
      rolPort: realRolPort(db),
      authConfig: makeAuthConfig({ sesionTtlMinutos: 0 }),
      registro: makeRegistro(),
      ...overrides,
    });
  }

  it("administrador da de alta un empleado nuevo ⇒ fila con password_hash scrypt, DISTINTO del texto en claro, fila exitosa con ambos empleados identificables", async () => {
    requiereAdministradorMock.mockImplementation((tipo: string) => tipo === "crear_empleado");
    const db = openDatabase(":memory:");
    try {
      const reloj: Reloj = { ahora: TIMESTAMP };
      insertCredencialEmpleado(db, { empleadoId: "admin", passwordHash: "scrypt$hash", ahora: TIMESTAMP });
      upsertRolEmpleado(db, { empleadoId: "admin", rol: ROL_ADMINISTRADOR, ahora: TIMESTAMP });
      const registro = makeRegistro();
      const deps = realDeps(db, reloj, { registro });
      const handler = buildOnComandoEmpleado(deps);
      await login(handler, "admin");
      vi.mocked(registro.registrarAccion).mockClear();

      const resultado = await handler(`/crear-empleado ana ${PASSWORD}`);

      expect(resultado.responseText.toLowerCase()).toContain("ana");
      const fila = buscarCredencialEmpleado(db, "ana");
      expect(fila).toBeDefined();
      expect(fila?.passwordHash).not.toBe(PASSWORD);
      expect(fila?.passwordHash.startsWith("scrypt$")).toBe(true);
      expect(registro.registrarAccion).toHaveBeenCalledTimes(1);
      const accion = vi.mocked(registro.registrarAccion).mock.calls[0]?.[0];
      expect(accion).toMatchObject({ comando: COMANDO_CREAR_EMPLEADO, resultado: RESULTADO_EXITOSA, empleadoId: "admin" });
    } finally {
      db.close();
    }
  });

  it("alta duplicada ⇒ rechazo, password_hash de la fila existente SIN cambio", async () => {
    requiereAdministradorMock.mockImplementation((tipo: string) => tipo === "crear_empleado");
    const db = openDatabase(":memory:");
    try {
      const reloj: Reloj = { ahora: TIMESTAMP };
      insertCredencialEmpleado(db, { empleadoId: "admin", passwordHash: "scrypt$hash", ahora: TIMESTAMP });
      upsertRolEmpleado(db, { empleadoId: "admin", rol: ROL_ADMINISTRADOR, ahora: TIMESTAMP });
      insertCredencialEmpleado(db, { empleadoId: "ana", passwordHash: "scrypt$hash-original", ahora: TIMESTAMP });
      const deps = realDeps(db, reloj);
      const handler = buildOnComandoEmpleado(deps);
      await login(handler, "admin");

      const resultado = await handler(`/crear-empleado ana ${PASSWORD}`);

      expect(resultado.responseText.toLowerCase()).toContain("ana");
      expect(buscarCredencialEmpleado(db, "ana")?.passwordHash).toBe("scrypt$hash-original");
    } finally {
      db.close();
    }
  });

  it("rol base ejecuta /crear-empleado ⇒ rechazado por el gate (tarea 5), NINGUNA fila en credenciales_empleado, fila de auditoría con resultado de rechazo por autorización", async () => {
    requiereAdministradorMock.mockImplementation((tipo: string) => tipo === "crear_empleado");
    const db = openDatabase(":memory:");
    try {
      const reloj: Reloj = { ahora: TIMESTAMP };
      insertCredencialEmpleado(db, { empleadoId: "ana", passwordHash: "scrypt$hash", ahora: TIMESTAMP });
      // "ana" SIN fila en roles_empleado ⇒ rol base por ausencia (ADR 154 pto 5).
      const registro = makeRegistro();
      const deps = realDeps(db, reloj, { registro });
      const handler = buildOnComandoEmpleado(deps);
      await login(handler, "ana");
      vi.mocked(registro.registrarAccion).mockClear();

      const resultado = await handler(`/crear-empleado bob ${PASSWORD}`);

      expect(resultado.responseText.toLowerCase()).toContain("administrador");
      expect(buscarCredencialEmpleado(db, "bob")).toBeUndefined();
      expect(registro.registrarAccion).toHaveBeenCalledTimes(1);
      const fila = vi.mocked(registro.registrarAccion).mock.calls[0]?.[0];
      expect(fila).toMatchObject({ comando: COMANDO_CREAR_EMPLEADO, resultado: RESULTADO_NO_AUTORIZADO, empleadoId: "ana" });
    } finally {
      db.close();
    }
  });

  /**
   * ★ Invariante de contraseña, EXTENDIDO del molde de la suite de `/login`
   * (arriba, "fallido (password incorrecta) y fallido (empleado
   * inexistente) dan el MISMO mensaje genérico, sin fila"): la contraseña
   * tipeada NUNCA aparece en ninguna fila de `registro_acciones_empleado`
   * ni en ningún evento de `logTurnEvent` emitido durante el comando — ni
   * completa, ni como prefijo, ni su longitud. `AccionEmpleado` no tiene
   * estructuralmente ningún campo para una longitud (garantía del tipo,
   * `registro-acciones-contract.test.ts`), así que basta con verificar que
   * el texto completo de la contraseña no aparece en ningún lado.
   */
  it("★ la contraseña NUNCA aparece en registro_acciones_empleado ni en ningún evento de log emitido por /crear-empleado — ni completa, ni como prefijo", async () => {
    requiereAdministradorMock.mockImplementation((tipo: string) => tipo === "crear_empleado");
    const db = openDatabase(":memory:");
    try {
      const reloj: Reloj = { ahora: TIMESTAMP };
      insertCredencialEmpleado(db, { empleadoId: "admin", passwordHash: "scrypt$hash", ahora: TIMESTAMP });
      upsertRolEmpleado(db, { empleadoId: "admin", rol: ROL_ADMINISTRADOR, ahora: TIMESTAMP });
      const registro = makeRegistro();
      const writes: string[] = [];
      const deps = realDeps(db, reloj, { registro, writes });
      const handler = buildOnComandoEmpleado(deps);
      await login(handler, "admin");

      await handler(`/crear-empleado ana ${PASSWORD}`);
      // Alta duplicada — segundo camino de código, mismo invariante.
      await handler(`/crear-empleado ana ${PASSWORD}`);

      const filas = vi.mocked(registro.registrarAccion).mock.calls.map((c) => c[0]);
      expect(JSON.stringify(filas)).not.toContain(PASSWORD);
      expect(JSON.stringify(writes)).not.toContain(PASSWORD);
    } finally {
      db.close();
    }
  });
});
