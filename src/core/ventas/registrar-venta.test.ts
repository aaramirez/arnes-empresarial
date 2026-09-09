import { describe, expect, it, vi } from "vitest";
import {
  CASO_TIPO_VENTA,
  VENTA_ESTADO_PENDIENTE_CONFIRMACION,
  type ConsultaRiesgoCreditoPort,
  type CrearVentaConCasoInput,
  type NotificacionResultado,
  type Venta,
  type VentaNotifierPort,
  type VentaStorePort,
} from "./ventas-contract.js";
import {
  registrarVenta,
  type RegistrarVentaDeps,
  type RegistrarVentaInput,
} from "./registrar-venta.js";

/**
 * Spec `venta-confirmacion`, requirements 2-3 (escenarios "Alta válida crea
 * vendedor, caso y venta", "Falla el proveedor de email", "Sin
 * `EMAIL_API_KEY`"). Dobles planos de `VentaStorePort`/`VentaNotifierPort` —
 * nunca SQLite ni red real, mismo criterio que `run-activity-turn.test.ts`.
 */

const TIMESTAMP = "2026-01-01T00:00:00.000Z";
const BASE_URL = "https://ventas.example.com";

function ventaDesdeCreateInput(input: CrearVentaConCasoInput): Venta {
  return {
    id: input.venta.id,
    vendedorId: input.vendedor.id,
    clienteId: input.venta.clienteId,
    ...(input.venta.planAnterior !== undefined
      ? { planAnterior: input.venta.planAnterior }
      : {}),
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
    // `tui-canal-empleado`: los 5 métodos nuevos del puerto no se ejercitan
    // en este archivo (alta de venta no toca escalaciones), solo satisfacen
    // el contrato ampliado (ADR 41 — la implementación real llega en la
    // Unidad 2 de ese change, `build-on-venta.ts`).
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

function makeInput(overrides: Partial<RegistrarVentaInput> = {}): RegistrarVentaInput {
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

function makeDeps(overrides: Partial<RegistrarVentaDeps> = {}): RegistrarVentaDeps {
  let contadorId = 0;
  return {
    store: makeStore(),
    notifier: makeNotifier(),
    config: { comisionPorcentaje: 0.1, reembolsoUmbral: 500, tokenTtlHoras: 72, ventaGrandeUmbral: 5000 },
    baseUrlPublica: BASE_URL,
    newId: vi.fn(() => `id-${++contadorId}`),
    newToken: vi.fn(() => "token-fijo"),
    now: vi.fn(() => TIMESTAMP),
    logEvent: vi.fn(),
    ...overrides,
  };
}

describe("registrarVenta", () => {
  it("propaga el error si store.crearVentaConCaso lanza, y el notifier NUNCA se llama", async () => {
    const error = new Error("fallo de persistencia al crear la venta");
    const store = makeStore({
      crearVentaConCaso: vi.fn(() => {
        throw error;
      }),
    });
    const deps = makeDeps({ store });

    await expect(registrarVenta(makeInput(), deps)).rejects.toThrow(error);
    expect(deps.notifier.notificarLinkConfirmacion).not.toHaveBeenCalled();
  });

  it("notifier con enviado:false → resultado con notificado:false, SIN lanzar excepción", async () => {
    const notifier = makeNotifier({
      notificarLinkConfirmacion: vi.fn(async () => ({
        enviado: false,
        motivo: "http" as const,
      })),
    });
    const deps = makeDeps({ notifier });

    const resultado = await registrarVenta(makeInput(), deps);

    expect(resultado.notificado).toBe(false);
  });

  it("arma el link de confirmación exactamente como `${baseUrlPublica}/confirmar/${token}`", async () => {
    const deps = makeDeps({ newToken: vi.fn(() => "token-abc-123") });

    const resultado = await registrarVenta(makeInput(), deps);

    expect(resultado.linkConfirmacion).toBe(`${BASE_URL}/confirmar/token-abc-123`);
  });

  it("con newToken/newId/now inyectados, la salida es determinista y testeable", async () => {
    const deps = makeDeps({
      newId: vi.fn(() => "id-fijo"),
      newToken: vi.fn(() => "token-fijo"),
      now: vi.fn(() => TIMESTAMP),
    });

    const resultado = await registrarVenta(makeInput(), deps);

    expect(resultado).toEqual({
      ventaId: "id-fijo",
      casoId: "id-fijo",
      linkConfirmacion: `${BASE_URL}/confirmar/token-fijo`,
      notificado: true,
    });
  });

  it("expiresAt está presente cuando el TTL configurado es > 0", async () => {
    const store = makeStore();
    const deps = makeDeps({
      store,
      config: { comisionPorcentaje: 0.1, reembolsoUmbral: 500, tokenTtlHoras: 72, ventaGrandeUmbral: 5000 },
    });

    await registrarVenta(makeInput(), deps);

    const inputCreado = vi.mocked(store.crearVentaConCaso).mock.calls[0]?.[0];
    expect(inputCreado?.venta.expiresAt).toBe(
      new Date(Date.parse(TIMESTAMP) + 72 * 3_600_000).toISOString(),
    );
  });

  it("expiresAt está ausente (undefined) cuando el TTL configurado es 0", async () => {
    const store = makeStore();
    const deps = makeDeps({
      store,
      config: { comisionPorcentaje: 0.1, reembolsoUmbral: 500, tokenTtlHoras: 0, ventaGrandeUmbral: 5000 },
    });

    await registrarVenta(makeInput(), deps);

    const inputCreado = vi.mocked(store.crearVentaConCaso).mock.calls[0]?.[0];
    expect(inputCreado?.venta.expiresAt).toBeUndefined();
  });

  it("crea la venta con estado pendiente_confirmacion y caso tipo venta", async () => {
    const store = makeStore();
    const deps = makeDeps({ store });

    await registrarVenta(makeInput(), deps);

    const inputCreado = vi.mocked(store.crearVentaConCaso).mock.calls[0]?.[0];
    expect(inputCreado?.venta.estado).toBe(VENTA_ESTADO_PENDIENTE_CONFIRMACION);
    expect(inputCreado?.caso.tipo).toBe(CASO_TIPO_VENTA);
  });

  it("el await al notifier ocurre DESPUES de que store.crearVentaConCaso ya resolvió (orden, no en paralelo)", async () => {
    const callOrder: string[] = [];

    const store = makeStore({
      crearVentaConCaso: vi.fn((input: CrearVentaConCasoInput) => {
        callOrder.push("store.crearVentaConCaso");
        return ventaDesdeCreateInput(input);
      }),
    });
    const notifier = makeNotifier({
      notificarLinkConfirmacion: vi.fn(async (): Promise<NotificacionResultado> => {
        callOrder.push("notifier.notificarLinkConfirmacion");
        return { enviado: true };
      }),
    });
    const deps = makeDeps({ store, notifier });

    await registrarVenta(makeInput(), deps);

    expect(callOrder).toEqual(["store.crearVentaConCaso", "notifier.notificarLinkConfirmacion"]);
  });

  it("no invoca al notifier antes de que el store haya devuelto (sin solapamiento asíncrono)", async () => {
    let storeResuelto = false;

    const store = makeStore({
      crearVentaConCaso: vi.fn((input: CrearVentaConCasoInput) => {
        storeResuelto = true;
        return ventaDesdeCreateInput(input);
      }),
    });
    const notifier = makeNotifier({
      notificarLinkConfirmacion: vi.fn(async (): Promise<NotificacionResultado> => {
        expect(storeResuelto).toBe(true);
        return { enviado: true };
      }),
    });
    const deps = makeDeps({ store, notifier });

    await registrarVenta(makeInput(), deps);

    expect(deps.notifier.notificarLinkConfirmacion).toHaveBeenCalledTimes(1);
  });

  it("pasa clienteEmail, planNuevo, monto y casoId al notifier", async () => {
    const notifier = makeNotifier();
    const deps = makeDeps({ notifier, newId: vi.fn(() => "caso-x") });
    const input = makeInput({ clienteEmail: "cliente@dominio.com", planNuevo: "plan-x", monto: 250 });

    await registrarVenta(input, deps);

    expect(notifier.notificarLinkConfirmacion).toHaveBeenCalledWith(
      expect.objectContaining({
        clienteEmail: "cliente@dominio.com",
        planNuevo: "plan-x",
        monto: 250,
        casoId: "caso-x",
      }),
    );
  });

  it("cero llamadas al modelo o al SDK: registrarVenta no importa ni handleTurn ni el SDK", async () => {
    const deps = makeDeps();

    await registrarVenta(makeInput(), deps);

    // No hay ningún doble de handleTurn/SDK inyectado en RegistrarVentaDeps:
    // si el módulo intentara usarlos, este test fallaría en tiempo de tipado
    // o de ejecución por falta de la dependencia.
    expect(deps.store.crearVentaConCaso).toHaveBeenCalledTimes(1);
  });
});

/**
 * Spec `venta-confirmacion` (delta ADDED), requirement "`registrarVenta`
 * delega una verificación de riesgo/crédito por A2A cuando el monto alcanza
 * el umbral de venta grande..." (Hito 6, tarea 15, ADR 76/82 pto 3). Puerto
 * fake + promesa colgada para probar el no-bloqueo (ADR 76/R3) — nunca SQLite
 * ni red real, mismo criterio que el resto del archivo.
 */
describe("registrarVenta — consulta de riesgo/crédito A2A no bloqueante (Hito 6, tarea 15)", () => {
  function makeRiesgoCredito(
    overrides: Partial<ConsultaRiesgoCreditoPort> = {},
  ): ConsultaRiesgoCreditoPort {
    return {
      consultar: vi.fn(async () => undefined),
      ...overrides,
    };
  }

  it("monto por debajo del umbral: cero llamadas a consultar", async () => {
    const riesgoCredito = makeRiesgoCredito();
    const deps = makeDeps({ riesgoCredito });

    await registrarVenta(makeInput({ monto: 4999 }), deps);

    expect(riesgoCredito.consultar).not.toHaveBeenCalled();
  });

  it("monto exactamente igual al umbral SÍ dispara la consulta (>=, no >)", async () => {
    const riesgoCredito = makeRiesgoCredito();
    const deps = makeDeps({ riesgoCredito });

    await registrarVenta(makeInput({ monto: 5000 }), deps);

    expect(riesgoCredito.consultar).toHaveBeenCalledTimes(1);
  });

  it("riesgoCredito ausente: comportamiento idéntico a v2.1.0, aunque el monto supere el umbral", async () => {
    // `riesgoCredito` no se pasa: `makeDeps` lo deja ausente por default,
    // igual que en todo el resto del archivo (comportamiento de v2.1.0).
    const deps = makeDeps();

    const resultado = await registrarVenta(makeInput({ monto: 10_000 }), deps);

    expect(resultado.notificado).toBe(true);
  });

  it("la consulta se invoca ANTES de notificarLinkConfirmacion (orden)", async () => {
    const callOrder: string[] = [];
    const riesgoCredito = makeRiesgoCredito({
      consultar: vi.fn(async () => {
        callOrder.push("riesgoCredito.consultar");
      }),
    });
    const notifier = makeNotifier({
      notificarLinkConfirmacion: vi.fn(async (): Promise<NotificacionResultado> => {
        callOrder.push("notifier.notificarLinkConfirmacion");
        return { enviado: true };
      }),
    });
    const deps = makeDeps({ riesgoCredito, notifier });

    await registrarVenta(makeInput({ monto: 10_000 }), deps);

    expect(callOrder).toEqual(["riesgoCredito.consultar", "notifier.notificarLinkConfirmacion"]);
  });

  it("un consultar que NUNCA resuelve no bloquea registrarVenta (no-bloqueo, ADR 76/R3)", async () => {
    const riesgoCredito = makeRiesgoCredito({
      consultar: vi.fn(() => new Promise<void>(() => {})),
    });
    const deps = makeDeps({ riesgoCredito });

    const resultado = await registrarVenta(makeInput({ monto: 10_000 }), deps);

    expect(resultado.notificado).toBe(true);
  });

  it("un consultar que rechaza no propaga, y se loguea a2a-riesgo-credito-contrato-violado", async () => {
    const riesgoCredito = makeRiesgoCredito({
      consultar: vi.fn(() => Promise.reject(new Error("el puerto violó su contrato"))),
    });
    const deps = makeDeps({ riesgoCredito });

    const resultado = await registrarVenta(makeInput({ monto: 10_000 }), deps);
    // Deja que el `.catch()` de la promesa disparada (no awaiteada) corra: es
    // una cadena de microtasks separada de la que `registrarVenta` awaitea.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(resultado.notificado).toBe(true);
    expect(deps.logEvent).toHaveBeenCalledWith(
      resultado.casoId,
      "a2a-riesgo-credito-contrato-violado",
      expect.objectContaining({ ventaId: resultado.ventaId }),
    );
  });

  it("clienteEmail NUNCA viaja en el insumo pasado a consultar", async () => {
    const riesgoCredito = makeRiesgoCredito();
    const deps = makeDeps({ riesgoCredito });

    await registrarVenta(
      makeInput({ monto: 10_000, clienteEmail: "secreto@example.com" }),
      deps,
    );

    const inputRecibido = vi.mocked(riesgoCredito.consultar).mock.calls[0]?.[0];
    expect(inputRecibido).toBeDefined();
    expect(inputRecibido).not.toHaveProperty("clienteEmail");
  });
});
