/**
 * Tests for `buildOnVenta`/`createVentaStore` — ver el module doc de
 * `build-on-venta.ts` para el contrato completo (cuatro handlers síncronos
 * en su lógica de negocio pero uniformados a `Promise`, sin `KeyedQueue`,
 * SIN `try/catch` que trague ningún error del `store`).
 *
 * Molde de `build-on-activity.test.ts`: dobles planos de `VentaStorePort`
 * para los tests unitarios de wiring, y `openDatabase(":memory:")` real
 * (mismo `withDb` que `describe("createActivityStore", ...)`) para los
 * tests de `createVentaStore` y, sobre todo, para el test de concurrencia
 * — un CAS de verdad sobre SQLite real es la única forma honesta de probar
 * R4/§8, un doble de `VentaStorePort` no lo demostraría.
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type Database from "better-sqlite3";
import { buildOnVenta, createVentaStore, type BuildOnVentaDeps } from "./build-on-venta.js";
import {
  CASO_ESTADO_PENDIENTE_APROBACION_HUMANA,
  CASO_TIPO_VENTA,
  VENTA_ESTADO_PENDIENTE_CONFIRMACION,
  VENTA_ESTADO_REEMBOLSADA,
  VENTA_ESTADO_REEMBOLSO_PENDIENTE,
  VENTA_ESTADO_REEMBOLSO_RECHAZADO,
  type CrearVentaConCasoInput,
  type NotificacionResultado,
  type Venta,
  type VentaNotifierPort,
  type VentaStorePort,
} from "./core/ventas/ventas-contract.js";
import type { RegistrarVentaInput } from "./core/ventas/registrar-venta.js";
import { DECISION_CONFIRMAR } from "./core/ventas/confirmar-venta.js";
import type { VentasConfig } from "./core/ventas/ventas-config.js";
import { openDatabase } from "./adapters/memory/db.js";

const TIMESTAMP = "2026-01-01T00:00:00.000Z";
const BASE_URL = "https://ventas.example.com";

function ventaDesdeCreateInput(input: CrearVentaConCasoInput): Venta {
  return {
    id: input.venta.id,
    vendedorId: input.vendedor.id,
    clienteId: input.venta.clienteId,
    ...(input.venta.planAnterior !== undefined ? { planAnterior: input.venta.planAnterior } : {}),
    planNuevo: input.venta.planNuevo,
    monto: input.venta.monto,
    estado: input.venta.estado,
    casoId: input.caso.id,
    tokenConfirmacion: input.venta.tokenConfirmacion,
    createdAt: input.timestamp,
    ...(input.venta.expiresAt !== undefined ? { expiresAt: input.venta.expiresAt } : {}),
  };
}

function makeStore(overrides: Partial<VentaStorePort> = {}): VentaStorePort {
  return {
    crearVentaConCaso: vi.fn((input: CrearVentaConCasoInput) => ventaDesdeCreateInput(input)),
    buscarVentaPorToken: vi.fn(() => undefined),
    confirmarVentaConComision: vi.fn(() => undefined),
    rechazarVenta: vi.fn(() => undefined),
    aprobarReembolso: vi.fn(() => undefined),
    escalarReembolso: vi.fn(() => undefined),
    // Los 5 métodos de `tui-canal-empleado` (ADR 41) — nunca ejercitados por
    // los tests de wiring de `buildOnVenta` de más abajo, pero necesarios
    // para que el doble satisfaga `VentaStorePort` completo.
    listarReembolsosPendientes: vi.fn(() => []),
    listarReembolsosRechazados: vi.fn(() => []),
    aprobarEscalacionReembolso: vi.fn(() => undefined),
    rechazarEscalacionReembolso: vi.fn(() => undefined),
    reabrirEscalacionReembolso: vi.fn(() => undefined),
    ...overrides,
  };
}

function makeNotifier(overrides: Partial<VentaNotifierPort> = {}): VentaNotifierPort {
  return {
    notificarLinkConfirmacion: vi.fn(async (): Promise<NotificacionResultado> => ({ enviado: true })),
    ...overrides,
  };
}

function makeConfig(overrides: Partial<VentasConfig> = {}): VentasConfig {
  return { comisionPorcentaje: 0.1, reembolsoUmbral: 500, tokenTtlHoras: 72, ...overrides };
}

function makeAltaInput(overrides: Partial<RegistrarVentaInput> = {}): RegistrarVentaInput {
  return {
    vendedorId: "vendedor-1",
    vendedorNombre: "Ana Vendedora",
    clienteId: "cliente-opaco-1",
    clienteEmail: "cliente@example.com",
    planNuevo: "plan-premium",
    monto: 1000,
    ...overrides,
  };
}

/**
 * Nunca dereferenciado en los tests de wiring de abajo: `store` siempre va
 * inyectado, así que `deps.store ?? createVentaStore(db)` nunca evalúa el
 * fallback (mismo criterio que `fakeDb()` en `build-on-activity.test.ts`).
 */
function fakeDb(): Database.Database {
  return {} as unknown as Database.Database;
}

function makeDeps(overrides: Partial<BuildOnVentaDeps> = {}): BuildOnVentaDeps {
  return {
    db: fakeDb(),
    notifier: makeNotifier(),
    ventasConfig: makeConfig(),
    baseUrlPublica: BASE_URL,
    store: makeStore(),
    now: () => TIMESTAMP,
    ...overrides,
  };
}

describe("build-on-venta.ts — límite estructural (ADR 7 punto 4)", () => {
  it("el código fuente no importa el SDK, ni handleTurn, ni createKnowledgeAdapter", () => {
    const source = readFileSync(new URL("./build-on-venta.ts", import.meta.url), "utf8");

    // Escaneamos los `import ... from "..."` reales, no comentarios que
    // MENCIONEN estos nombres para documentar por qué el módulo no los usa
    // (el module doc de `build-on-venta.ts` los nombra explícitamente).
    const importLines = source
      .split("\n")
      .filter((line) => /^\s*import\b/.test(line))
      .join("\n");

    expect(importLines).not.toMatch(/@anthropic-ai\/claude-agent-sdk/);
    expect(importLines).not.toMatch(/handle-turn/);
    expect(importLines).not.toMatch(/knowledge\/index/);
    // `createKnowledgeAdapter` no tiene módulo propio con ese nombre — se
    // chequea como identificador importado, en vez de por ruta de archivo.
    expect(importLines).not.toMatch(/createKnowledgeAdapter/);
  });
});

describe("buildOnVenta — onConsultaVenta", () => {
  it("de una venta vencida (expiresAt <= ahora) devuelve undefined — aplica validarTokenConfirmacion ANTES de proyectar", async () => {
    const ventaVencida: Venta = {
      id: "venta-1",
      vendedorId: "vendedor-1",
      clienteId: "cliente-1",
      planNuevo: "plan-x",
      monto: 1000,
      estado: VENTA_ESTADO_PENDIENTE_CONFIRMACION,
      casoId: "caso-1",
      tokenConfirmacion: "token-vencido",
      createdAt: "2025-12-01T00:00:00.000Z",
      expiresAt: "2026-01-01T00:00:00.000Z",
    };
    const store = makeStore({ buscarVentaPorToken: vi.fn(() => ventaVencida) });
    const handlers = buildOnVenta(makeDeps({ store, now: () => "2026-01-02T00:00:00.000Z" }));

    const resultado = await handlers.onConsultaVenta("token-vencido");

    expect(resultado).toBeUndefined();
  });

  it("de un token inexistente devuelve undefined (mismo camino que vencida — R6, respuesta indistinguible)", async () => {
    const store = makeStore({ buscarVentaPorToken: vi.fn(() => undefined) });
    const handlers = buildOnVenta(makeDeps({ store }));

    const resultado = await handlers.onConsultaVenta("token-inexistente");

    expect(resultado).toBeUndefined();
  });

  it("de una venta válida proyecta a VentaPublica: SIN token, SIN casoId, SIN clienteId", async () => {
    const ventaValida: Venta = {
      id: "venta-1",
      vendedorId: "vendedor-1",
      clienteId: "cliente-1",
      planAnterior: "plan-basico",
      planNuevo: "plan-premium",
      monto: 2500,
      estado: VENTA_ESTADO_PENDIENTE_CONFIRMACION,
      casoId: "caso-1",
      tokenConfirmacion: "token-valido",
      createdAt: TIMESTAMP,
    };
    const store = makeStore({ buscarVentaPorToken: vi.fn(() => ventaValida) });
    const handlers = buildOnVenta(makeDeps({ store, now: () => TIMESTAMP }));

    const resultado = await handlers.onConsultaVenta("token-valido");

    expect(resultado).toEqual({
      planAnterior: "plan-basico",
      planNuevo: "plan-premium",
      monto: 2500,
    });
    expect(resultado).not.toHaveProperty("token");
    expect(resultado).not.toHaveProperty("casoId");
    expect(resultado).not.toHaveProperty("clienteId");
  });
});

describe("buildOnVenta — los 4 handlers propagan el error del store (SIN try/catch que trague)", () => {
  it("onAltaVenta rechaza si store.crearVentaConCaso lanza", async () => {
    const error = new Error("fallo de persistencia al crear la venta");
    const store = makeStore({
      crearVentaConCaso: vi.fn(() => {
        throw error;
      }),
    });
    const handlers = buildOnVenta(makeDeps({ store }));

    await expect(handlers.onAltaVenta(makeAltaInput())).rejects.toThrow(error);
  });

  it("onConsultaVenta rechaza si store.buscarVentaPorToken lanza", async () => {
    const error = new Error("fallo de lectura por token");
    const store = makeStore({
      buscarVentaPorToken: vi.fn(() => {
        throw error;
      }),
    });
    const handlers = buildOnVenta(makeDeps({ store }));

    await expect(handlers.onConsultaVenta("token-x")).rejects.toThrow(error);
  });

  it("onDecisionVenta rechaza si store.buscarVentaPorToken lanza", async () => {
    const error = new Error("fallo de lectura por token");
    const store = makeStore({
      buscarVentaPorToken: vi.fn(() => {
        throw error;
      }),
    });
    const handlers = buildOnVenta(makeDeps({ store }));

    await expect(
      handlers.onDecisionVenta({ token: "token-x", decision: DECISION_CONFIRMAR }),
    ).rejects.toThrow(error);
  });

  it("onDevolucion rechaza si store.buscarVentaPorToken lanza", async () => {
    const error = new Error("fallo de lectura por token");
    const store = makeStore({
      buscarVentaPorToken: vi.fn(() => {
        throw error;
      }),
    });
    const handlers = buildOnVenta(makeDeps({ store }));

    await expect(handlers.onDevolucion({ token: "token-x" })).rejects.toThrow(error);
  });
});

describe("createVentaStore — closures sobre repository.ts (molde de createActivityStore)", () => {
  function withDb<T>(fn: (db: Database.Database) => T): T {
    const db = openDatabase(":memory:");
    try {
      return fn(db);
    } finally {
      db.close();
    }
  }

  it("crearVentaConCaso: completa createdAt/updatedAt del caso con `timestamp` y traduce estado a VentaEstado", () => {
    withDb((db) => {
      const store = createVentaStore(db);
      const venta = store.crearVentaConCaso({
        vendedor: { id: "vendedor-1", nombre: "Ana Vendedora" },
        caso: { id: "caso-1", tipo: CASO_TIPO_VENTA, estado: "activo" },
        venta: {
          id: "venta-1",
          clienteId: "cliente-1",
          planNuevo: "plan-x",
          monto: 1000,
          estado: VENTA_ESTADO_PENDIENTE_CONFIRMACION,
          tokenConfirmacion: "token-1",
        },
        timestamp: TIMESTAMP,
      });

      expect(venta).toMatchObject({
        id: "venta-1",
        vendedorId: "vendedor-1",
        casoId: "caso-1",
        estado: VENTA_ESTADO_PENDIENTE_CONFIRMACION,
        createdAt: TIMESTAMP,
      });

      const encontrada = store.buscarVentaPorToken("token-1");
      expect(encontrada?.id).toBe("venta-1");
    });
  });

  it("buscarVentaPorToken: undefined si no existe", () => {
    withDb((db) => {
      const store = createVentaStore(db);
      expect(store.buscarVentaPorToken("no-existe")).toBeUndefined();
    });
  });

  it("lanza VentaEstadoInvalidoError si `ventas.estado` en la fila no está en VENTA_ESTADOS (corrupción de datos)", () => {
    withDb((db) => {
      const store = createVentaStore(db);
      store.crearVentaConCaso({
        vendedor: { id: "vendedor-1", nombre: "Ana Vendedora" },
        caso: { id: "caso-1", tipo: CASO_TIPO_VENTA, estado: "activo" },
        venta: {
          id: "venta-1",
          clienteId: "cliente-1",
          planNuevo: "plan-x",
          monto: 1000,
          estado: VENTA_ESTADO_PENDIENTE_CONFIRMACION,
          tokenConfirmacion: "token-1",
        },
        timestamp: TIMESTAMP,
      });
      // Simula corrupción real: `ventas.estado` es TEXT sin CHECK (migración
      // 0004), así que escribir directo por SQL es la única forma de producir
      // un valor inválido sin pasar por ninguna validación de escritura.
      db.prepare("UPDATE ventas SET estado = ? WHERE id = ?").run("estado_invalido", "venta-1");

      expect(() => store.buscarVentaPorToken("token-1")).toThrowError(/venta-1.*estado_invalido/s);
    });
  });

  /**
   * Los 5 closures nuevos de `tui-canal-empleado` (ADR 41): `createVentaStore`
   * delega a `listEscalacionesReembolso`/los tres CAS de
   * `repository.ts`, sin reimplementar SQL acá. La atomicidad y los bordes
   * del CAS ya están cubiertos por `repository.test.ts` (tarea 4.1); estos
   * tests solo verifican el WIRING: que el store arma el filtro correcto y
   * traduce `VentaRow` a `Venta` (estado literal) igual que los seis
   * métodos de Hito 4.
   */
  describe("createVentaStore — los 5 closures de tui-canal-empleado (ADR 41)", () => {
    it("listarReembolsosPendientes: devuelve las escalaciones en reembolso_pendiente", () => {
      withDb((db) => {
        const store = createVentaStore(db);
        store.crearVentaConCaso({
          vendedor: { id: "vendedor-1", nombre: "Ana Vendedora" },
          caso: { id: "caso-1", tipo: CASO_TIPO_VENTA, estado: CASO_ESTADO_PENDIENTE_APROBACION_HUMANA },
          venta: {
            id: "venta-1",
            clienteId: "cliente-1",
            planNuevo: "plan-x",
            monto: 1000,
            estado: VENTA_ESTADO_REEMBOLSO_PENDIENTE,
            tokenConfirmacion: "token-1",
          },
          timestamp: TIMESTAMP,
        });

        const items = store.listarReembolsosPendientes();

        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({ ventaId: "venta-1", casoId: "caso-1", monto: 1000 });
      });
    });

    it("listarReembolsosRechazados: devuelve las escalaciones en reembolso_rechazado", () => {
      withDb((db) => {
        const store = createVentaStore(db);
        store.crearVentaConCaso({
          vendedor: { id: "vendedor-1", nombre: "Ana Vendedora" },
          caso: { id: "caso-1", tipo: CASO_TIPO_VENTA, estado: CASO_ESTADO_PENDIENTE_APROBACION_HUMANA },
          venta: {
            id: "venta-1",
            clienteId: "cliente-1",
            planNuevo: "plan-x",
            monto: 1000,
            estado: VENTA_ESTADO_REEMBOLSO_RECHAZADO,
            tokenConfirmacion: "token-1",
          },
          timestamp: TIMESTAMP,
        });

        const items = store.listarReembolsosRechazados();

        expect(items).toHaveLength(1);
        expect(items[0]?.ventaId).toBe("venta-1");
      });
    });

    it("aprobarEscalacionReembolso: CAS reembolso_pendiente -> reembolsada, traduce el estado a VentaEstado", () => {
      withDb((db) => {
        const store = createVentaStore(db);
        store.crearVentaConCaso({
          vendedor: { id: "vendedor-1", nombre: "Ana Vendedora" },
          caso: { id: "caso-1", tipo: CASO_TIPO_VENTA, estado: CASO_ESTADO_PENDIENTE_APROBACION_HUMANA },
          venta: {
            id: "venta-1",
            clienteId: "cliente-1",
            planNuevo: "plan-x",
            monto: 1000,
            estado: VENTA_ESTADO_REEMBOLSO_PENDIENTE,
            tokenConfirmacion: "token-1",
          },
          timestamp: TIMESTAMP,
        });

        const resultado = store.aprobarEscalacionReembolso({
          ventaId: "venta-1",
          casoId: "caso-1",
          empleadoId: "ana",
          accionId: "accion-1",
          ahora: TIMESTAMP,
        });

        expect(resultado?.estado).toBe(VENTA_ESTADO_REEMBOLSADA);

        // El CAS ya no matchea: segunda llamada devuelve undefined, sin lanzar.
        const segunda = store.aprobarEscalacionReembolso({
          ventaId: "venta-1",
          casoId: "caso-1",
          empleadoId: "ana",
          accionId: "accion-2",
          ahora: TIMESTAMP,
        });
        expect(segunda).toBeUndefined();
      });
    });

    it("rechazarEscalacionReembolso: CAS reembolso_pendiente -> reembolso_rechazado", () => {
      withDb((db) => {
        const store = createVentaStore(db);
        store.crearVentaConCaso({
          vendedor: { id: "vendedor-1", nombre: "Ana Vendedora" },
          caso: { id: "caso-1", tipo: CASO_TIPO_VENTA, estado: CASO_ESTADO_PENDIENTE_APROBACION_HUMANA },
          venta: {
            id: "venta-1",
            clienteId: "cliente-1",
            planNuevo: "plan-x",
            monto: 1000,
            estado: VENTA_ESTADO_REEMBOLSO_PENDIENTE,
            tokenConfirmacion: "token-1",
          },
          timestamp: TIMESTAMP,
        });

        const resultado = store.rechazarEscalacionReembolso({
          ventaId: "venta-1",
          casoId: "caso-1",
          empleadoId: "beto",
          accionId: "accion-1",
          ahora: TIMESTAMP,
        });

        expect(resultado?.estado).toBe(VENTA_ESTADO_REEMBOLSO_RECHAZADO);
      });
    });

    it("reabrirEscalacionReembolso: CAS reembolso_rechazado -> reembolso_pendiente", () => {
      withDb((db) => {
        const store = createVentaStore(db);
        store.crearVentaConCaso({
          vendedor: { id: "vendedor-1", nombre: "Ana Vendedora" },
          caso: { id: "caso-1", tipo: CASO_TIPO_VENTA, estado: CASO_ESTADO_PENDIENTE_APROBACION_HUMANA },
          venta: {
            id: "venta-1",
            clienteId: "cliente-1",
            planNuevo: "plan-x",
            monto: 1000,
            estado: VENTA_ESTADO_REEMBOLSO_RECHAZADO,
            tokenConfirmacion: "token-1",
          },
          timestamp: TIMESTAMP,
        });

        const resultado = store.reabrirEscalacionReembolso({
          ventaId: "venta-1",
          casoId: "caso-1",
          empleadoId: "ana",
          accionId: "accion-1",
          ahora: TIMESTAMP,
        });

        expect(resultado?.estado).toBe(VENTA_ESTADO_REEMBOLSO_PENDIENTE);
      });
    });
  });
});

describe("buildOnVenta + createVentaStore sobre SQLite real — cierre de R4/§8", () => {
  let db: Database.Database | undefined;

  afterEach(() => {
    db?.close();
    db = undefined;
  });

  it("dos onDecisionVenta concurrentes (confirmar) sobre el MISMO token, sin await entre medio → exactamente una comisión", async () => {
    db = openDatabase(":memory:");
    const store = createVentaStore(db);
    const venta = store.crearVentaConCaso({
      vendedor: { id: "vendedor-1", nombre: "Ana Vendedora" },
      caso: { id: "caso-1", tipo: CASO_TIPO_VENTA, estado: "activo" },
      venta: {
        id: "venta-1",
        clienteId: "cliente-1",
        planNuevo: "plan-premium",
        monto: 1000,
        estado: VENTA_ESTADO_PENDIENTE_CONFIRMACION,
        tokenConfirmacion: "token-carrera",
      },
      timestamp: TIMESTAMP,
    });

    const handlers = buildOnVenta({
      db,
      notifier: makeNotifier(),
      ventasConfig: makeConfig(),
      baseUrlPublica: BASE_URL,
      now: () => "2026-01-01T01:00:00.000Z",
    });

    // Deliberadamente SIN `await` entre las dos invocaciones: el cuerpo
    // síncrono de `resolverDecisionVenta` (incluido el `UPDATE ... RETURNING`
    // del CAS) debe correr por completo en cada llamada ANTES de que el
    // event loop ceda — ver el módulo doc de `build-on-venta.ts`.
    const p1 = handlers.onDecisionVenta({ token: "token-carrera", decision: DECISION_CONFIRMAR });
    const p2 = handlers.onDecisionVenta({ token: "token-carrera", decision: DECISION_CONFIRMAR });

    const [r1, r2] = await Promise.all([p1, p2]);

    const resultados = [r1.resultado, r2.resultado].sort();
    expect(resultados).toEqual(["confirmada", "no_aplicable"]);

    const fila = db
      .prepare("SELECT COUNT(*) as total FROM comisiones WHERE venta_id = ?")
      .get(venta.id) as { total: number };
    expect(fila.total).toBe(1);
  });
});
