import { describe, expect, it, vi } from "vitest";
import type Database from "better-sqlite3";
import { openDatabase } from "../../adapters/memory/db.js";
import { hashPassword, verificarPassword } from "../../adapters/crypto/password.js";
import {
  buildOnComandoEmpleado,
  createRolEmpleadoEscritor,
  type BuildOnComandoEmpleadoDeps,
} from "../../build-on-comando-empleado.js";
import { createVentaStore } from "../../build-on-venta.js";
import {
  ACCION_APROBAR,
  resolverEscalacionReembolso,
  type ResolverEscalacionDeps,
} from "../../core/ventas/resolver-escalacion-reembolso.js";
import { altaCredencialEmpleado } from "../../empleados.js";
import { ROL_ADMINISTRADOR, type RolEmpleado, type RolEmpleadoPort } from "../../core/auth/rol-contract.js";
import { type CredencialesEmpleadoPort } from "../../core/auth/credenciales-contract.js";
import { createHookEngine } from "../../core/hooks/hook-engine.js";
import {
  buscarCredencialEmpleado,
  buscarRolEmpleado,
  upsertRolEmpleado,
  createVentaConCaso,
  confirmarVentaConComision,
  escalarReembolso,
} from "../../adapters/memory/repository.js";
import { VENTA_ESTADO_REEMBOLSADA, type VentaNotifierPort } from "../../core/ventas/ventas-contract.js";
import type { SubmitPromptHandler, TuiTurnResult } from "../../adapters/tui/tui-port.js";
import type { VentasConfig } from "../../core/ventas/ventas-config.js";
import type { AuthConfig } from "../../core/auth/auth-config.js";
import type { SoporteResult } from "../../build-on-soporte.js";
import { ejecutarOperacion, type EjecutarOperacionDeps } from "../../core/operaciones/ejecutar-operacion.js";
import { OPERACION_RESOLVER_REEMBOLSO } from "../../core/operaciones/operaciones-contract.js";
import { crearConfirmacionOperacionesStore } from "../../adapters/web/confirmacion-operaciones-store.js";
import { getSubagentDefinition } from "../../core/agents/definitions.js";
import type { DelegacionStorePort, DespacharDelegacionDeps } from "../../core/turn-selector/dispatch-delegation.js";
import type { SolicitudStorePort } from "../../core/solicitudes/solicitudes-contract.js";
import type { ReporteStorePort } from "../../core/ventas/reporte-contract.js";
import type { ConsultaVentaPropiaPort } from "../../core/ventas/consulta-venta-contract.js";
import type { JustificacionDevolucionPort } from "../../core/ventas/justificacion-devolucion-contract.js";
import type { RegistroAccionesEmpleadoPort } from "../../core/commands/registro-acciones-contract.js";

/**
 * `comandos-administracion-empleados`, tarea 12 — verificación del
 * entregable de PUNTA A PUNTA, contra código de producción REAL: `db`
 * SQLite real (`:memory:`, migraciones reales vía `openDatabase`), hash
 * `scrypt` real (`hashPassword`/`verificarPassword`, no un doble), `store`
 * de ventas real (`createVentaStore(db)`), y `rolPort`/`rolEscritor`/
 * `credenciales` reales (closures sobre `db`, MISMO molde que el default
 * interno de `buildOnComandoEmpleado`).
 *
 * NO es una prueba manual contra la TUI de Ink real (`start-tui.tsx`) — este
 * ejecutor no tiene forma de manejar un proceso interactivo de terminal.
 * Es, en cambio, el flujo de negocio COMPLETO ejercitado con las mismas
 * piezas de producción que la TUI monta (`buildOnComandoEmpleado`), sin
 * ningún doble en el camino crítico (autenticación, autorización,
 * escritura de credencial/rol, resolución de reembolso). Cubre,
 * explícitamente, los primeros dos bullets del criterio de verificación
 * manual de `tasks.md` tarea 12. Los bullets 3 (env vars de
 * `/estado-bot-prs`) y de `npm test`/`npm run typecheck` en verde ya están
 * cubiertos por el resto de la suite (`build-on-comando-empleado.test.ts`,
 * describe `/estado-bot-prs`) y por el propio `npm run typecheck` del
 * pipeline. El rollback del commit de la tarea 7/8 y la captura de una
 * sesión de TUI interactiva real quedan pendientes de verificación manual
 * humana — ver la nota final de este archivo.
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

function realDeps(db: Database.Database): BuildOnComandoEmpleadoDeps {
  const now = () => TIMESTAMP;
  return {
    onSubmit: vi.fn(async () => ({ responseText: "conversacional", agentLabel: "conversacional" })) as unknown as SubmitPromptHandler,
    onSoporte: vi.fn(async (): Promise<SoporteResult> => ({ casoId: "caso-soporte", respuesta: "listo" })),
    db,
    ventasConfig: {
      comisionPorcentaje: 0.1,
      reembolsoUmbral: 500,
      tokenTtlHoras: 72,
      ventaGrandeUmbral: 5000,
    } satisfies VentasConfig,
    authConfig: { sesionTtlMinutos: 0, sesionInactividadMinutos: 0 } satisfies AuthConfig,
    verificarPassword,
    dummyPasswordHash: hashPassword("dummy-password-para-timing"),
    hooks: createHookEngine(),
    now,
    store: createVentaStore(db),
    credenciales: realCredenciales(db),
    rolPort: realRolPort(db),
    rolEscritor: createRolEmpleadoEscritor(db),
  };
}

const TIMESTAMP = "2026-01-01T00:00:00.000Z";

async function login(handler: SubmitPromptHandler, empleadoId: string, password: string): Promise<TuiTurnResult> {
  return handler(`/login ${empleadoId} ${password}`);
}

/**
 * `EjecutarOperacionDeps` real para ejercitar `resolver_reembolso` a través
 * de `ejecutarOperacion` — el dispatcher REAL del canal conversacional
 * (aprobacion-conversacional-hitl, hallazgo Reviewer de test-coverage, Unit
 * 4). `store` y `rolPort` son closures reales sobre `db` (mismo molde que
 * `realRolPort` arriba); el resto de los campos son requeridos por el TIPO
 * de `EjecutarOperacionDeps` pero `ejecutarResolverReembolso` nunca los
 * invoca — cada uno es un doble que EXPLOTA si algún día se llama, para que
 * un cambio futuro que sí los toque no pase inadvertido en este test.
 */
function realEjecutarOperacionDepsParaReembolso(db: Database.Database): EjecutarOperacionDeps {
  function noUsado(nombre: string): () => never {
    return () => {
      throw new Error(`${nombre} no debería invocarse resolviendo resolver_reembolso`);
    };
  }

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
  const justificacion: JustificacionDevolucionPort = {
    registrar: noUsado("registrar"),
  };
  const delegacionStore: DelegacionStorePort = {
    crearDelegacion: noUsado("crearDelegacion"),
    completarDelegacion: noUsado("completarDelegacion"),
  };
  const despacharDeps: DespacharDelegacionDeps = {
    store: delegacionStore,
    invocar: noUsado("invocar"),
    getSubagente: getSubagentDefinition,
    newId: () => "id-no-usado",
    now: () => TIMESTAMP,
    logEvent: () => undefined,
  };
  const notifier: VentaNotifierPort = { notificarLinkConfirmacion: noUsado("notificarLinkConfirmacion") };
  const registro: RegistroAccionesEmpleadoPort = { registrarAccion: noUsado("registrarAccion") };

  return {
    store: createVentaStore(db),
    solicitudStore,
    config: { comisionPorcentaje: 0.1, reembolsoUmbral: 500, tokenTtlHoras: 72, ventaGrandeUmbral: 5000 },
    notifier,
    baseUrlPublica: "https://ventas.example.com",
    reporteStore,
    consultaVentaPropia,
    justificacion,
    despacharDeps,
    rolPort: realRolPort(db),
    registro,
    newId: () => "accion-1",
    newToken: () => "token-no-usado",
    now: () => TIMESTAMP,
    logEvent: () => undefined,
  };
}

describe("comandos-administracion-empleados — flujo end-to-end contra código real (tarea 12, verificación del entregable)", () => {
  it("bootstrap por CLI (equivalente) → login → /crear-empleado → /asignar-rol → 'ana' aprueba un reembolso — el rol asignado por TUI surte el MISMO efecto que uno asignado por CLI, sin ningún paso adicional para 'ana'", async () => {
    const db = openDatabase(":memory:");
    try {
      // 1. Bootstrap del primer administrador — EQUIVALENTE a
      //    `npm run empleados:crear -- admin --rol administrador`: dos
      //    escrituras (alta de credencial + asignación de rol), ambas con
      //    las MISMAS funciones que invoca `main()` de `empleados.ts`.
      const altaAdmin = altaCredencialEmpleado(db, { empleadoId: "admin", password: "adminpass123", ahora: TIMESTAMP });
      expect(altaAdmin.ok).toBe(true);
      upsertRolEmpleado(db, { empleadoId: "admin", rol: ROL_ADMINISTRADOR, ahora: TIMESTAMP });

      // 2. Login del administrador en la TUI (una sola sesión para los dos comandos siguientes).
      const handlerAdmin = buildOnComandoEmpleado(realDeps(db));
      const loginResultado = await login(handlerAdmin, "admin", "adminpass123");
      expect(loginResultado.responseText.toLowerCase()).toContain("sesión abierta");

      // 3. /crear-empleado ana <password>
      const creado = await handlerAdmin("/crear-empleado ana password-de-ana-123");
      expect(creado.responseText.toLowerCase()).toContain("ana");
      expect(buscarCredencialEmpleado(db, "ana")).toBeDefined();

      // 4. /asignar-rol ana administrador
      const asignado = await handlerAdmin("/asignar-rol ana administrador");
      expect(asignado.responseText.toLowerCase()).toContain("administrador");
      expect(buscarRolEmpleado(db, "ana")).toMatchObject({ rol: ROL_ADMINISTRADOR });

      // 5. Semilla de una venta escalada a reembolso_pendiente, para que 'ana' la apruebe.
      createVentaConCaso(db, {
        vendedor: { id: "vend-1", nombre: "Vendedor Uno" },
        caso: { id: "caso-v1", tipo: "venta", estado: "pendiente_confirmacion", createdAt: TIMESTAMP, updatedAt: TIMESTAMP },
        venta: {
          id: "venta-1",
          clienteId: "cliente-1",
          planNuevo: "plan-x",
          monto: 1000,
          estado: "pendiente_confirmacion",
          tokenConfirmacion: "tok-venta-1",
        },
        timestamp: TIMESTAMP,
      });
      confirmarVentaConComision(db, {
        ventaId: "venta-1",
        comisionId: "comision-1",
        comisionMonto: 100,
        periodo: "2026-01",
        ahora: TIMESTAMP,
      });
      escalarReembolso(db, { ventaId: "venta-1", casoId: "caso-v1", ahora: TIMESTAMP });

      // 6. 'ana' hace login (SU primer login — no es "re-login", es su único
      //    login): el rol que le asignó el administrador por TUI ya es
      //    efectivo. La resolución de reembolso YA NO es un comando de TUI
      //    (aprobacion-conversacional-hitl, ADR 210 pto 1, tarea 14 —
      //    /aprobar-reembolso se dio de baja, se resuelve por conversación
      //    vía resolver_reembolso, ADR 206) — se ejercita acá directamente
      //    contra `resolverEscalacionReembolso` (el núcleo real), con el
      //    MISMO `store`/`rolPort` reales sobre `db` que usaría el
      //    dispatcher: prueba que el rol asignado por TUI surte el MISMO
      //    efecto también por ese camino, sin ningún paso adicional para 'ana'.
      const handlerAna = buildOnComandoEmpleado(realDeps(db));
      const loginAna = await login(handlerAna, "ana", "password-de-ana-123");
      expect(loginAna.responseText.toLowerCase()).toContain("sesión abierta");

      const resolverDeps: ResolverEscalacionDeps = {
        store: createVentaStore(db),
        newId: () => "accion-1",
        now: () => TIMESTAMP,
        logEvent: () => undefined,
        rolPort: realRolPort(db),
      };
      const sesionAna = { empleadoId: "ana", iniciadaEn: TIMESTAMP };

      const eco = resolverEscalacionReembolso(
        { accion: ACCION_APROBAR, ventaId: "venta-1", confirmado: false, sesion: sesionAna },
        resolverDeps,
      );
      expect(eco.resultado).toBe("requiere_confirmacion");

      const confirmacion = resolverEscalacionReembolso(
        { accion: ACCION_APROBAR, ventaId: "venta-1", confirmado: true, sesion: sesionAna },
        resolverDeps,
      );
      expect(confirmacion.resultado).toBe("aplicada");

      const venta = db.prepare("SELECT estado FROM ventas WHERE id = ?").get("venta-1") as { estado: string };
      expect(venta.estado).toBe(VENTA_ESTADO_REEMBOLSADA);
    } finally {
      db.close();
    }
  });

  it("un empleado con rol base: los dos comandos gateados (/crear-empleado, /asignar-rol) se rechazan; /estado-bot-prs responde igual que a un administrador", async () => {
    const db = openDatabase(":memory:");
    try {
      altaCredencialEmpleado(db, { empleadoId: "base", password: "basepass123", ahora: TIMESTAMP });
      // "base" SIN fila en roles_empleado ⇒ rol base por ausencia (ADR 154 pto 5).

      const handler = buildOnComandoEmpleado(realDeps(db));
      await login(handler, "base", "basepass123");

      const rechazoCrear = await handler("/crear-empleado otro passwordotro123");
      expect(rechazoCrear.responseText.toLowerCase()).toContain("administrador");
      expect(buscarCredencialEmpleado(db, "otro")).toBeUndefined();

      const rechazoAsignar = await handler("/asignar-rol base administrador");
      expect(rechazoAsignar.responseText.toLowerCase()).toContain("administrador");
      expect(buscarRolEmpleado(db, "base")).toBeUndefined();

      const estadoBot = await handler("/estado-bot-prs");
      expect(estadoBot.responseText.toLowerCase()).not.toContain("no estás autorizado");
      expect(estadoBot.responseText.toLowerCase()).not.toContain("requiere rol administrador");
    } finally {
      db.close();
    }
  });

  it("resolver_reembolso vía ejecutarOperacion (dispatcher real, dos turnos: eco + confirmación) — un rol leído de una DB real se respeta de punta a punta (hallazgo Reviewer, test-coverage, aprobacion-conversacional-hitl Unit 4)", async () => {
    const db = openDatabase(":memory:");
    try {
      // Rol base por AUSENCIA de fila en roles_empleado (ADR 154 pto 5) — sin
      // ningún doble de RolEmpleadoPort, la lectura es la fila (inexistente) real.
      altaCredencialEmpleado(db, { empleadoId: "base", password: "basepass123", ahora: TIMESTAMP });
      // Rol administrador vía la MISMA escritura que usa /asignar-rol (tarea 7
      // de comandos-administracion-empleados) — DB real, no un mock de rol.
      altaCredencialEmpleado(db, { empleadoId: "ana", password: "password-de-ana-123", ahora: TIMESTAMP });
      upsertRolEmpleado(db, { empleadoId: "ana", rol: ROL_ADMINISTRADOR, ahora: TIMESTAMP });

      createVentaConCaso(db, {
        vendedor: { id: "vend-1", nombre: "Vendedor Uno" },
        caso: { id: "caso-v1", tipo: "venta", estado: "pendiente_confirmacion", createdAt: TIMESTAMP, updatedAt: TIMESTAMP },
        venta: {
          id: "venta-1",
          clienteId: "cliente-1",
          planNuevo: "plan-x",
          monto: 1000,
          estado: "pendiente_confirmacion",
          tokenConfirmacion: "tok-venta-1",
        },
        timestamp: TIMESTAMP,
      });
      confirmarVentaConComision(db, {
        ventaId: "venta-1",
        comisionId: "comision-1",
        comisionMonto: 100,
        periodo: "2026-01",
        ahora: TIMESTAMP,
      });
      escalarReembolso(db, { ventaId: "venta-1", casoId: "caso-v1", ahora: TIMESTAMP });

      const ejecutarDeps = realEjecutarOperacionDepsParaReembolso(db);
      const confirmacionStore = crearConfirmacionOperacionesStore();

      // 1. Rol base ⇒ `no_autorizado`, a través del dispatcher REAL — no de
      //    `resolverEscalacionReembolso` invocada directamente (eso es lo que
      //    el hallazgo de test-coverage marcó como saltado): el `rolPort` que
      //    ve `ejecutarOperacion` lee la fila (ausente) de la DB real. Dos
      //    turnos: el gate de rol sólo se evalúa tras `confirmado: true`.
      const confirmacionBase = confirmacionStore.paraEmpleado("base");
      await ejecutarOperacion(
        {
          operacion: { operacion: OPERACION_RESOLVER_REEMBOLSO, accion: "aprobar", ventaId: "venta-1" },
          sesion: { empleadoId: "base", iniciadaEn: TIMESTAMP },
          confirmacion: confirmacionBase,
          casoIdActual: "caso-turno-base-1",
        },
        ejecutarDeps,
      );
      const rechazo = await ejecutarOperacion(
        {
          operacion: { operacion: OPERACION_RESOLVER_REEMBOLSO, accion: "aprobar", ventaId: "venta-1" },
          sesion: { empleadoId: "base", iniciadaEn: TIMESTAMP },
          confirmacion: confirmacionBase,
          casoIdActual: "caso-turno-base-2",
        },
        ejecutarDeps,
      );
      expect(rechazo).toContain("No estás autorizado");
      const ventaTrasRechazo = db.prepare("SELECT estado FROM ventas WHERE id = ?").get("venta-1") as {
        estado: string;
      };
      expect(ventaTrasRechazo.estado).not.toBe(VENTA_ESTADO_REEMBOLSADA);

      // 2. Rol administrador, leído de la MISMA DB real — dos turnos por el
      //    MISMO camino (`ejecutarOperacion`): eco (sin confirmar, casoId de
      //    turno 1) y confirmación (casoId de turno 2, nuevo — el predicado
      //    `origenCasoId !== casoIdActual` exige un turno posterior real).
      const sesionAna = { empleadoId: "ana", iniciadaEn: TIMESTAMP };
      const confirmacionAna = confirmacionStore.paraEmpleado("ana");

      const eco = await ejecutarOperacion(
        {
          operacion: { operacion: OPERACION_RESOLVER_REEMBOLSO, accion: "aprobar", ventaId: "venta-1" },
          sesion: sesionAna,
          confirmacion: confirmacionAna,
          casoIdActual: "caso-turno-1",
        },
        ejecutarDeps,
      );
      expect(eco).toContain("Vas a aprobar el reembolso de la venta venta-1");

      const resultado = await ejecutarOperacion(
        {
          operacion: { operacion: OPERACION_RESOLVER_REEMBOLSO, accion: "aprobar", ventaId: "venta-1" },
          sesion: sesionAna,
          confirmacion: confirmacionAna,
          casoIdActual: "caso-turno-2",
        },
        ejecutarDeps,
      );
      expect(resultado).toContain("Listo: el reembolso de la venta venta-1 quedó");
      expect(resultado).toContain(VENTA_ESTADO_REEMBOLSADA);

      const venta = db.prepare("SELECT estado FROM ventas WHERE id = ?").get("venta-1") as { estado: string };
      expect(venta.estado).toBe(VENTA_ESTADO_REEMBOLSADA);
    } finally {
      db.close();
    }
  });
});

/**
 * ★ Nota de verificación manual — lo que este archivo NO puede cubrir:
 *
 * 1. **Captura real de una sesión interactiva de la TUI de Ink**
 *    (`start-tui.tsx`) tipeando los comandos a mano — este ejecutor no
 *    tiene un terminal interactivo disponible. Los dos tests de arriba
 *    ejercitan el MISMO `buildOnComandoEmpleado` que la TUI monta, con
 *    `db`/hash/store reales — la única superficie no cubierta es el
 *    renderizado de Ink en sí (que ningún test de este repo cubre tampoco,
 *    ver Concepto Transversal de testing del arc42).
 * 2. **Rollback del commit de la tarea 7 (o 8)** — verificar que, tras un
 *    `git revert`/`git reset` real de ese commit, `/asignar-rol` (o
 *    `/crear-empleado`) desaparece de `DESCRIPTORES`/`/ayuda` y cae en
 *    `ayudaDesconocido`, y que ningún dato ya escrito (credenciales, roles)
 *    queda inválido. Esto exige un commit real en la rama, que este
 *    ejecutor no crea (`AGENTS.md`: el commit y el push los ejecuta siempre
 *    el humano) — pendiente de verificación manual real, después de que el
 *    humano commitee las tareas 7-11.
 *
 * `/estado-bot-prs` con y sin `GITHUB_WEBHOOK_SECRET`/`GITHUB_TOKEN`
 * configurados, y la invariante de que nunca imprime el valor, ya están
 * cubiertos por `build-on-comando-empleado.test.ts` (describe
 * `/estado-bot-prs`, comandos-administracion-empleados tarea 3) — no se
 * duplican acá.
 */
