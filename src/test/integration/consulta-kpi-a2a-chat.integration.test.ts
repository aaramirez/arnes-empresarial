import { describe, expect, it, vi } from "vitest";
import type Database from "better-sqlite3";
import { openDatabase } from "../../adapters/memory/db.js";
import {
  confirmarVentaConComision,
  createCaso,
  createVentaConCaso,
  insertAccionEmpleado,
  upsertRolEmpleado,
} from "../../adapters/memory/repository.js";
import { createDelegacionA2AStore, createVentaStore } from "../../build-on-venta.js";
import { createOperacionesAdapter } from "../../adapters/operaciones/index.js";
import { OPERACIONES_MCP_SERVER_NAME, OPERACIONES_TOOL_NAME } from "../../core/operaciones/operaciones-contract.js";
import { ROL_ADMINISTRADOR, ROL_EMPLEADO, type RolEmpleado, type RolEmpleadoPort } from "../../core/auth/rol-contract.js";
import type { SesionEmpleado } from "../../core/auth/sesion.js";
import {
  DESTINO_A2A_KPI_INCIDENTE,
  type ClienteA2APort,
  type ResultadoA2A,
} from "../../core/agents/a2a-contract.js";
import { construirTareaDelegadaA2A } from "../../core/turn-selector/dispatch-delegation-a2a.js";
import {
  CONSULTAS_KPI,
  INSTRUCCION_CONSULTA_KPI,
  materialDeConsultaKpi,
} from "../../core/agents/consultas-kpi-catalogo.js";
import {
  COMANDO_CONSULTAR_KPI,
  RESULTADO_ATENDIDA,
  RESULTADO_NO_APLICABLE,
  RESULTADO_NO_AUTORIZADO,
} from "../../core/commands/registro-acciones-contract.js";
import { getSubagentDefinition } from "../../core/agents/definitions.js";
import {
  ejecutarOperacion,
  type EjecutarOperacionDeps,
  type EjecutarOperacionInput,
} from "../../core/operaciones/ejecutar-operacion.js";
import { OPERACION_CONSULTAR_KPI, type ConfirmacionOperacionPort } from "../../core/operaciones/operaciones-contract.js";
import type { DelegacionStorePort, DespacharDelegacionDeps } from "../../core/turn-selector/dispatch-delegation.js";
import type { SolicitudStorePort } from "../../core/solicitudes/solicitudes-contract.js";
import type { ReporteStorePort } from "../../core/ventas/reporte-contract.js";
import type { ConsultaVentaPropiaPort } from "../../core/ventas/consulta-venta-contract.js";
import type { ConsultaSolicitudPropiaPort } from "../../core/solicitudes/consulta-solicitud-propia-contract.js";
import type { SolicitudA2AEntranteStorePort } from "../../core/agents/a2a-entrante-contract.js";
import type { JustificacionDevolucionPort } from "../../core/ventas/justificacion-devolucion-contract.js";
import type { VentaNotifierPort } from "../../core/ventas/ventas-contract.js";

/**
 * `consulta-kpi-a2a-chat`, tarea 9.3 (tests 28-31, design §12.3) — VERIFICACION
 * DE PERSISTENCIA contra SQLite real (`:memory:`, migraciones reales).
 *
 * NACE VERDE, y se declara asi: no dirige comportamiento. Confirma en SQLite lo
 * que los unitarios de la tarea 9.1 ya dirigieron (28 por el 12(c) — `createCaso`
 * no aparece en el cuerpo—, 29 por el 17, 30 por el 15b, 31 por el 8 y el 9).
 * Sus dientes se prueban por mutacion en 12.2 (M12, M13).
 *
 * Reales: `db`, `delegacionA2AStore` (`createDelegacionA2AStore`), `registro`
 * (`insertAccionEmpleado`) y `rolPort` (sobre `roles_empleado` sembrado).
 * Dobles: `clienteA2A` (completa con una centinela unica) y, con `noUsado`, todo
 * lo que `consultar_kpi` no toca.
 *
 * El 401 sin sesion de `POST /operaciones` ya lo cubre `server.test.ts`; aca se
 * reverifica por lectura, no por ejecucion.
 */

const AHORA = "2026-09-13T10:00:00.000Z";
const CASO_TURNO = "caso-turno-kpi";
const CLAVE = CONSULTAS_KPI[0];
const CENTINELA = "CENTINELA-KPI-9d41c7e2";
const ADMIN: SesionEmpleado = { empleadoId: "admin-1", iniciadaEn: AHORA };
const EMPLEADO: SesionEmpleado = { empleadoId: "emp-1", iniciadaEn: AHORA };

function realRolPort(db: Database.Database): RolEmpleadoPort {
  return {
    buscarRol: (empleadoId) => {
      const row = db.prepare("SELECT rol FROM roles_empleado WHERE empleado_id = ?").get(empleadoId) as
        | { rol: string }
        | undefined;
      return row ? (row.rol as RolEmpleado) : undefined;
    },
  };
}

function noUsado(nombre: string): () => never {
  return () => {
    throw new Error(`${nombre} no deberia invocarse en consultar_kpi`);
  };
}

function makeClienteA2A(resultado: string = `KPI: ${CENTINELA}`) {
  const respuesta: ResultadoA2A = {
    ok: true,
    a2aTaskId: "task-externa-1",
    estado: "TASK_STATE_COMPLETED",
    resultado,
    agenteNombre: "Agente KPI",
    endpoint: "https://agente.example/rpc",
  };
  const delegar = vi.fn<ClienteA2APort["delegar"]>(async () => respuesta);
  const clienteA2A: ClienteA2APort = { baseUrlDe: () => "https://agente.example", delegar };
  return { clienteA2A, delegar };
}

function realDepsParaConsultaKpi(
  db: Database.Database,
  overrides: Partial<EjecutarOperacionDeps> = {},
): EjecutarOperacionDeps {
  const solicitudStore: SolicitudStorePort = {
    crearSolicitudConCaso: noUsado("crearSolicitudConCaso"),
    adjuntarDictamen: noUsado("adjuntarDictamen"),
    listarSolicitudesPendientes: noUsado("listarSolicitudesPendientes"),
    aprobarSolicitud: noUsado("aprobarSolicitud"),
    rechazarSolicitud: noUsado("rechazarSolicitud"),
    cancelarSolicitud: noUsado("cancelarSolicitud"),
  };
  const reporteStore: ReporteStorePort = {
    listComisionesPorPeriodo: noUsado("listComisionesPorPeriodo"),
    listVentasEnReembolsoPendiente: noUsado("listVentasEnReembolsoPendiente"),
  };
  const consultaVentaPropia: ConsultaVentaPropiaPort = {
    buscarPorId: noUsado("buscarPorId"),
    listarDeVendedor: noUsado("listarDeVendedor"),
  };
  const consultaSolicitudPropia: ConsultaSolicitudPropiaPort = {
    buscarPorId: noUsado("buscarPorId"),
    listarDeSolicitante: noUsado("listarDeSolicitante"),
  };
  const solicitudA2AEntrante: SolicitudA2AEntranteStorePort = {
    listarPorEstados: noUsado("listarPorEstados"),
    obtenerPorTaskId: noUsado("obtenerPorTaskId"),
  };
  const justificacion: JustificacionDevolucionPort = { registrar: noUsado("registrar") };
  const delegacionStore: DelegacionStorePort = {
    crearDelegacion: noUsado("crearDelegacion"),
    completarDelegacion: noUsado("completarDelegacion"),
  };
  const despacharDeps: DespacharDelegacionDeps = {
    store: delegacionStore,
    invocar: noUsado("invocar"),
    getSubagente: getSubagentDefinition,
    newId: () => "id-no-usado",
    now: () => AHORA,
    logEvent: () => undefined,
  };
  const notifier: VentaNotifierPort = { notificarLinkConfirmacion: noUsado("notificarLinkConfirmacion") };
  let contador = 0;

  return {
    store: createVentaStore(db),
    solicitudStore,
    config: { comisionPorcentaje: 0.1, reembolsoUmbral: 500, tokenTtlHoras: 72, ventaGrandeUmbral: 5000 },
    notifier,
    baseUrlPublica: "https://ventas.example.com",
    reporteStore,
    consultaVentaPropia,
    consultaSolicitudPropia,
    solicitudA2AEntrante,
    justificacion,
    delegacionA2AStore: createDelegacionA2AStore(db),
    despacharDeps,
    rolPort: realRolPort(db),
    registro: { registrarAccion: (accion) => insertAccionEmpleado(db, accion) },
    newId: () => `id-${++contador}`,
    newToken: () => "token-no-usado",
    now: () => AHORA,
    logEvent: () => undefined,
    ...overrides,
  };
}

function makeConfirmacion(): ConfirmacionOperacionPort {
  return { estaConfirmada: () => false, marcarPendiente: () => undefined, consumir: () => undefined };
}

function inputConsulta(consultaId: string, sesion: SesionEmpleado = ADMIN): EjecutarOperacionInput {
  return {
    operacion: { operacion: OPERACION_CONSULTAR_KPI, consultaId } as EjecutarOperacionInput["operacion"],
    sesion,
    confirmacion: makeConfirmacion(),
    casoIdActual: CASO_TURNO,
  };
}

/** DB con un administrador, un empleado sin privilegios, el caso del turno y una venta con comision (para que las instantaneas no comparen tablas vacias). */
function sembrar(): Database.Database {
  const db = openDatabase(":memory:");
  upsertRolEmpleado(db, { empleadoId: ADMIN.empleadoId, rol: ROL_ADMINISTRADOR, ahora: AHORA });
  upsertRolEmpleado(db, { empleadoId: EMPLEADO.empleadoId, rol: ROL_EMPLEADO, ahora: AHORA });
  createCaso(db, { id: CASO_TURNO, tipo: "soporte", estado: "abierto", createdAt: AHORA, updatedAt: AHORA });
  createVentaConCaso(db, {
    vendedor: { id: "vend-1", nombre: "Vendedor Uno" },
    caso: { id: "caso-v1", tipo: "venta", estado: "pendiente_confirmacion", createdAt: AHORA, updatedAt: AHORA },
    venta: {
      id: "venta-1",
      clienteId: "cliente-1",
      planNuevo: "plan-x",
      monto: 1000,
      estado: "pendiente_confirmacion",
      tokenConfirmacion: "tok-venta-1",
    },
    timestamp: AHORA,
  });
  confirmarVentaConComision(db, {
    ventaId: "venta-1",
    comisionId: "comision-1",
    comisionMonto: 100,
    periodo: "2026-09",
    ahora: AHORA,
  });
  return db;
}

function tablasDeUsuario(db: Database.Database): string[] {
  return (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as { name: string }[]
  ).map((fila) => fila.name);
}

/** Volcado completo (todas las columnas, `updated_at` incluido) de una tabla, en orden estable. */
function volcado(db: Database.Database, tabla: string): string {
  return JSON.stringify(db.prepare(`SELECT * FROM "${tabla}" ORDER BY rowid`).all());
}

function cuenta(db: Database.Database, tabla: string): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM "${tabla}"`).get() as { n: number }).n;
}

function conteos(db: Database.Database) {
  return {
    delegaciones: cuenta(db, "delegaciones_a2a"),
    casos: cuenta(db, "casos"),
    registro: cuenta(db, "registro_acciones_empleado"),
  };
}

type FilaDelegacion = {
  id: string;
  caso_id: string;
  destino_clave: string;
  estado: string;
  tarea_delegada: string;
  resultado: string | null;
};
type FilaAccion = Record<string, unknown> & { id: string; caso_id: string | null };

describe("consulta-kpi-a2a-chat — persistencia contra SQLite real (tarea 9.3, tests 28-31; nace verde por criterio declarado, design §12.3)", () => {
  it("test 28 — el administrador deja +1 delegacion y +1 auditoria con el caso del turno, sin caso propio ni escritura de negocio", async () => {
    const db = sembrar();
    try {
      const { clienteA2A, delegar } = makeClienteA2A(`KPI: ${CENTINELA}`);
      const negocio = ["ventas", "solicitudes_internas", "solicitudes_a2a_entrantes", "comisiones"];
      const antes = Object.fromEntries(negocio.map((t) => [t, volcado(db, t)]));
      const antesConteos = conteos(db);

      const texto = await ejecutarOperacion(inputConsulta(CLAVE), realDepsParaConsultaKpi(db, { clienteA2A }));

      expect(texto).toContain(CENTINELA);
      for (const tabla of negocio) {
        expect(volcado(db, tabla), `${tabla} no debe cambiar`).toBe(antes[tabla]);
      }
      const despues = conteos(db);
      expect(despues.casos).toBe(antesConteos.casos);
      expect(despues.delegaciones).toBe(antesConteos.delegaciones + 1);
      expect(despues.registro).toBe(antesConteos.registro + 1);

      const tareaEnviada = delegar.mock.calls[0]?.[0].tarea;
      expect(tareaEnviada).toBe(
        construirTareaDelegadaA2A(DESTINO_A2A_KPI_INCIDENTE, {
          instruccion: INSTRUCCION_CONSULTA_KPI,
          material: materialDeConsultaKpi(CLAVE),
        }),
      );

      const delegaciones = db.prepare("SELECT * FROM delegaciones_a2a").all() as FilaDelegacion[];
      expect(delegaciones).toHaveLength(1);
      const delegacion = delegaciones[0] as FilaDelegacion;
      expect(delegacion.destino_clave).toBe("kpi-incidente");
      expect(delegacion.caso_id).toBe(CASO_TURNO);
      expect(delegacion.estado).toBe("TASK_STATE_COMPLETED");
      expect(delegacion.tarea_delegada).toBe(tareaEnviada);
      expect(delegacion.resultado).toBe(`KPI: ${CENTINELA}`);

      const acciones = db
        .prepare("SELECT * FROM registro_acciones_empleado WHERE comando = ?")
        .all(COMANDO_CONSULTAR_KPI) as FilaAccion[];
      expect(acciones).toHaveLength(1);
      const accion = acciones[0] as FilaAccion;
      expect(accion["comando"]).toBe("/consultar-kpi");
      expect(accion["resultado"]).toBe(RESULTADO_ATENDIDA);
      expect(accion["empleado_id"]).toBe(ADMIN.empleadoId);
      expect(accion.caso_id).toBe(delegacion.caso_id);
      expect(accion["venta_id"]).toBeNull();
      expect(accion["propuesta_id"]).toBeNull();
      // El conjunto de columnas es el vigente de `AccionEmpleado` (spec: la fila no tiene un campo para la clave ni el resultado).
      expect(Object.keys(accion).sort()).toEqual(
        ["caso_id", "comando", "empleado_id", "id", "ocurrido_at", "propuesta_id", "resultado", "venta_id"].sort(),
      );
      const filaSerializada = JSON.stringify(accion);
      expect(filaSerializada).not.toContain(CENTINELA);
      expect(filaSerializada).not.toContain(CLAVE);
    } finally {
      db.close();
    }
  });

  it("test 29 — un resultado de 5000 caracteres con centinela unica sobrevive integro SOLO en delegaciones_a2a.resultado, revisando TODAS las tablas", async () => {
    const db = sembrar();
    try {
      const resultado = `${CENTINELA}${"k".repeat(5000 - CENTINELA.length)}`;
      expect(resultado).toHaveLength(5000);
      const { clienteA2A } = makeClienteA2A(resultado);

      await ejecutarOperacion(inputConsulta(CLAVE), realDepsParaConsultaKpi(db, { clienteA2A }));

      const conCentinela: string[] = [];
      for (const tabla of tablasDeUsuario(db)) {
        if (volcado(db, tabla).includes(CENTINELA)) {
          conCentinela.push(tabla);
        }
      }
      expect(conCentinela).toEqual(["delegaciones_a2a"]);
      const fila = db.prepare("SELECT resultado FROM delegaciones_a2a").get() as { resultado: string };
      expect(fila.resultado).toBe(resultado);
    } finally {
      db.close();
    }
  });

  it("test 30 — dos invocaciones en un turno dejan dos delegaciones y dos auditorias, ids distintos y el mismo caso (RD-118, R18 aceptado)", async () => {
    const db = sembrar();
    try {
      const { clienteA2A, delegar } = makeClienteA2A();
      const deps = realDepsParaConsultaKpi(db, { clienteA2A });
      const antes = conteos(db);

      await ejecutarOperacion(inputConsulta(CLAVE), deps);
      await ejecutarOperacion(inputConsulta(CLAVE), deps);

      expect(delegar).toHaveBeenCalledTimes(2);
      const despues = conteos(db);
      expect(despues.delegaciones).toBe(antes.delegaciones + 2);
      expect(despues.registro).toBe(antes.registro + 2);
      expect(despues.casos).toBe(antes.casos);

      const delegaciones = db.prepare("SELECT id, caso_id FROM delegaciones_a2a").all() as FilaDelegacion[];
      expect(new Set(delegaciones.map((d) => d.id)).size).toBe(2);
      expect(new Set(delegaciones.map((d) => d.caso_id))).toEqual(new Set([CASO_TURNO]));
      const acciones = db
        .prepare("SELECT id, caso_id FROM registro_acciones_empleado WHERE comando = ?")
        .all(COMANDO_CONSULTAR_KPI) as FilaAccion[];
      expect(new Set(acciones.map((a) => a.id)).size).toBe(2);
      expect(new Set(acciones.map((a) => a.caso_id))).toEqual(new Set([CASO_TURNO]));
    } finally {
      db.close();
    }
  });

  describe("test 31 — apagado, rol, clave y rechazo del borde, por CONTEO", () => {
    it("sin clienteA2A (apagado): ningun conteo cambia, ni siquiera la auditoria", async () => {
      const db = sembrar();
      try {
        const antes = conteos(db);
        await ejecutarOperacion(inputConsulta(CLAVE), realDepsParaConsultaKpi(db));
        expect(conteos(db)).toEqual(antes);
      } finally {
        db.close();
      }
    });

    it("empleado sin rol administrador: delegaciones y casos no cambian, la auditoria gana UNA fila no_autorizado", async () => {
      const db = sembrar();
      try {
        const { clienteA2A, delegar } = makeClienteA2A();
        const antes = conteos(db);

        await ejecutarOperacion(inputConsulta(CLAVE, EMPLEADO), realDepsParaConsultaKpi(db, { clienteA2A }));

        const despues = conteos(db);
        expect(delegar).not.toHaveBeenCalled();
        expect(despues.delegaciones).toBe(antes.delegaciones);
        expect(despues.casos).toBe(antes.casos);
        expect(despues.registro).toBe(antes.registro + 1);
        const fila = db
          .prepare("SELECT resultado, empleado_id FROM registro_acciones_empleado WHERE comando = ?")
          .get(COMANDO_CONSULTAR_KPI) as { resultado: string; empleado_id: string };
        expect(fila).toEqual({ resultado: RESULTADO_NO_AUTORIZADO, empleado_id: EMPLEADO.empleadoId });
      } finally {
        db.close();
      }
    });

    it("clave fuera del catalogo forzada al dispatcher: UNA fila no_aplicable y nada mas", async () => {
      const db = sembrar();
      try {
        const { clienteA2A, delegar } = makeClienteA2A();
        const antes = conteos(db);

        await ejecutarOperacion(inputConsulta("clave-inventada"), realDepsParaConsultaKpi(db, { clienteA2A }));

        const despues = conteos(db);
        expect(delegar).not.toHaveBeenCalled();
        expect(despues.delegaciones).toBe(antes.delegaciones);
        expect(despues.casos).toBe(antes.casos);
        expect(despues.registro).toBe(antes.registro + 1);
        const fila = db
          .prepare("SELECT resultado FROM registro_acciones_empleado WHERE comando = ?")
          .get(COMANDO_CONSULTAR_KPI) as { resultado: string };
        expect(fila.resultado).toBe(RESULTADO_NO_APLICABLE);
      } finally {
        db.close();
      }
    });

    it("consultaId ausente rechazado por la validacion del adaptador: ningun conteo cambia y el dispatcher no corre", async () => {
      const db = sembrar();
      try {
        const { clienteA2A, delegar } = makeClienteA2A();
        const deps = realDepsParaConsultaKpi(db, { clienteA2A });
        const ejecutar = vi.fn((input: EjecutarOperacionInput) => ejecutarOperacion(input, deps));
        const adapter = createOperacionesAdapter({
          casoId: CASO_TURNO,
          sesion: ADMIN,
          confirmacion: makeConfirmacion(),
          ejecutar,
        });
        const server = adapter.mcpServers[OPERACIONES_MCP_SERVER_NAME] as unknown as {
          readonly instance: {
            readonly _registeredTools: Record<string, { readonly handler: (args: unknown, extra: unknown) => Promise<unknown> }>;
          };
        };
        const herramienta = server.instance._registeredTools[OPERACIONES_TOOL_NAME];
        if (herramienta === undefined) {
          throw new Error(`test setup error: tool "${OPERACIONES_TOOL_NAME}" was not registered`);
        }
        const antes = conteos(db);

        await herramienta.handler({ operacion: OPERACION_CONSULTAR_KPI }, {});

        expect(ejecutar).not.toHaveBeenCalled();
        expect(delegar).not.toHaveBeenCalled();
        expect(conteos(db)).toEqual(antes);
      } finally {
        db.close();
      }
    });
  });
});
