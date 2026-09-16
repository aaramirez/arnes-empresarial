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
import { VENTA_ESTADO_REEMBOLSADA } from "../../core/ventas/ventas-contract.js";
import type { SubmitPromptHandler, TuiTurnResult } from "../../adapters/tui/tui-port.js";
import type { VentasConfig } from "../../core/ventas/ventas-config.js";
import type { AuthConfig } from "../../core/auth/auth-config.js";
import type { SoporteResult } from "../../build-on-soporte.js";

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
    authConfig: { sesionTtlMinutos: 0 } satisfies AuthConfig,
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
