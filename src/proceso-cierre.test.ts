/**
 * Test-first (RED) de `src/proceso-cierre.ts` (`modo-headless-cierre-limpio`,
 * tarea 2.1, ADR 248/249 pto 4). El módulo bajo test (`./proceso-cierre.ts`)
 * TODAVÍA NO EXISTE en esta fase — `npm run typecheck` y
 * `npm test -- proceso-cierre` deben fallar los dos, a propósito.
 *
 * Esta primera tanda cubre SOLO modo y presupuesto (H2, H8, RD-121):
 *  - `esModoHeadless(env)`: `"1"` exacto ⇒ headless; ausente/""/blancos/"0"
 *    ⇒ TUI; cualquier otro valor ⇒ LANZA (falla cerrado, S-c).
 *  - `resolvePresupuestoCierreMs(deps)`: ausente/blanco ⇒ el default SIN
 *    evento; inválido (no numérico, ≤0, NaN, infinito) ⇒ el default Y UN
 *    evento `cierre-presupuesto-invalido`, SIN lanzar; numérico válido ⇒ ese
 *    valor.
 *  - Constantes: `PROCESO_LOG_CORRELATION_ID`, `DEFAULT_SHUTDOWN_TIMEOUT_MS`.
 *
 * `ProcesoLike` falso en toda la suite — CERO `process` real (R18).
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { logTurnEvent } from "./core/logging/turn-logger.js";
import type { ProcesoCierreDeps } from "./proceso-cierre.js";

/**
 * Doble mínimo de `logTurnEvent`, con la misma firma posicional, que junta
 * cada llamada en `eventos` en vez de escribir a disco. Misma idea que los
 * dobles de `deps` que ya usa `turn-logger.test.ts`.
 */
function crearLogEventEspia(): {
  readonly logEvent: typeof logTurnEvent;
  readonly eventos: { casoId: string; event: string; fields: Record<string, unknown> }[];
} {
  const eventos: { casoId: string; event: string; fields: Record<string, unknown> }[] = [];
  const logEvent: typeof logTurnEvent = (casoId, event, fields = {}) => {
    eventos.push({ casoId, event, fields: fields as Record<string, unknown> });
  };
  return { logEvent, eventos };
}

describe("proceso-cierre (modo-headless-cierre-limpio, tarea 2.1)", () => {
  describe("constantes", () => {
    it("PROCESO_LOG_CORRELATION_ID es 'proceso'", async () => {
      const { PROCESO_LOG_CORRELATION_ID } = await import("./proceso-cierre.js");
      expect(PROCESO_LOG_CORRELATION_ID).toBe("proceso");
    });

    it("DEFAULT_SHUTDOWN_TIMEOUT_MS es 70000 y es estrictamente mayor que 55500 (H9)", async () => {
      const { DEFAULT_SHUTDOWN_TIMEOUT_MS } = await import("./proceso-cierre.js");
      expect(DEFAULT_SHUTDOWN_TIMEOUT_MS).toBe(70_000);
      expect(DEFAULT_SHUTDOWN_TIMEOUT_MS).toBeGreaterThan(55_500);
    });
  });

  describe("esModoHeadless (H2, S-c)", () => {
    it("HARNESS_HEADLESS='1' exacto activa headless", async () => {
      const { esModoHeadless } = await import("./proceso-cierre.js");
      expect(esModoHeadless({ HARNESS_HEADLESS: "1" })).toBe(true);
    });

    it.each([
      ["ausente", undefined],
      ["vacío", ""],
      ["en blanco", "   "],
      ['"0"', "0"],
    ] as const)("HARNESS_HEADLESS %s ⇒ TUI (false)", async (_etiqueta, valor) => {
      const { esModoHeadless } = await import("./proceso-cierre.js");
      const env = valor === undefined ? {} : { HARNESS_HEADLESS: valor };
      expect(esModoHeadless(env)).toBe(false);
    });

    it.each(["true", "yes", "on", "2", "01", " 1", "1 "])(
      "HARNESS_HEADLESS=%j falla cerrado: lanza Error con el nombre, el valor y los admitidos",
      async (valor) => {
        const { esModoHeadless } = await import("./proceso-cierre.js");
        let error: unknown;
        try {
          esModoHeadless({ HARNESS_HEADLESS: valor });
        } catch (e) {
          error = e;
        }
        expect(error).toBeInstanceOf(Error);
        const mensaje = (error as Error).message;
        expect(mensaje).toContain("HARNESS_HEADLESS");
        expect(mensaje).toContain(`"${valor}"`);
        expect(mensaje).toContain("0");
        expect(mensaje).toContain("1");
      },
    );
  });

  describe("resolvePresupuestoCierreMs (H8, RD-121)", () => {
    it.each([
      ["ausente", undefined],
      ["vacío", ""],
      ["en blanco", "   "],
    ] as const)(
      "HARNESS_SHUTDOWN_TIMEOUT_MS %s ⇒ 70000 SIN evento",
      async (_etiqueta, valor) => {
        const { resolvePresupuestoCierreMs } = await import("./proceso-cierre.js");
        const { logEvent, eventos } = crearLogEventEspia();
        const env = valor === undefined ? {} : { HARNESS_SHUTDOWN_TIMEOUT_MS: valor };
        expect(resolvePresupuestoCierreMs({ env, logEvent })).toBe(70_000);
        expect(eventos).toHaveLength(0);
      },
    );

    it.each(["abc", "0", "-5", "NaN", "Infinity", "1e400", "10s"])(
      "HARNESS_SHUTDOWN_TIMEOUT_MS=%j inválido ⇒ 70000 Y 1 evento cierre-presupuesto-invalido, sin lanzar",
      async (valor) => {
        const { resolvePresupuestoCierreMs, PROCESO_LOG_CORRELATION_ID } = await import(
          "./proceso-cierre.js"
        );
        const { logEvent, eventos } = crearLogEventEspia();
        let resultado: number | undefined;
        expect(() => {
          resultado = resolvePresupuestoCierreMs({
            env: { HARNESS_SHUTDOWN_TIMEOUT_MS: valor },
            logEvent,
          });
        }).not.toThrow();
        expect(resultado).toBe(70_000);
        expect(eventos).toHaveLength(1);
        expect(eventos[0]?.casoId).toBe(PROCESO_LOG_CORRELATION_ID);
        expect(eventos[0]?.event).toBe("cierre-presupuesto-invalido");
        expect(eventos[0]?.fields).toMatchObject({ raw: valor });
      },
    );

    it("HARNESS_SHUTDOWN_TIMEOUT_MS='20000' ⇒ 20000", async () => {
      const { resolvePresupuestoCierreMs } = await import("./proceso-cierre.js");
      const { logEvent, eventos } = crearLogEventEspia();
      expect(
        resolvePresupuestoCierreMs({ env: { HARNESS_SHUTDOWN_TIMEOUT_MS: "20000" }, logEvent }),
      ).toBe(20_000);
      expect(eventos).toHaveLength(0);
    });
  });
});

/**
 * Test-first (RED) de `manejarErrorNoCapturado` (tarea 2.4, ADR 250, H6).
 * `salir: vi.fn()` — el `process.exit` real JAMÁS se toca. Sin cierre
 * ordenado: la política no recibe ni invoca ningún `close`/`db`.
 */
describe("manejarErrorNoCapturado (modo-headless-cierre-limpio, tarea 2.4, ADR 250)", () => {
  function crearDeps(): {
    readonly logEvent: typeof logTurnEvent;
    readonly eventos: { casoId: string; event: string; fields: Record<string, unknown> }[];
    readonly escribirError: ReturnType<typeof vi.fn<(linea: string) => void>>;
    readonly salir: ReturnType<typeof vi.fn<(codigo: number) => void>>;
  } {
    const { logEvent, eventos } = crearLogEventEspia();
    return {
      logEvent,
      eventos,
      escribirError: vi.fn<(linea: string) => void>(),
      salir: vi.fn<(codigo: number) => void>(),
    };
  }

  it.each([
    ["unhandledRejection", "boom"],
    ["uncaughtException", "kaput"],
  ] as const)("con Error y tipo %s: loguea, escribe y sale con 1", async (tipo, mensaje) => {
    const { manejarErrorNoCapturado, PROCESO_LOG_CORRELATION_ID } = await import(
      "./proceso-cierre.js"
    );
    const { logEvent, eventos, escribirError, salir } = crearDeps();

    manejarErrorNoCapturado(new Error(mensaje), tipo, { logEvent, escribirError, salir });

    expect(eventos).toHaveLength(1);
    expect(eventos[0]?.casoId).toBe(PROCESO_LOG_CORRELATION_ID);
    expect(eventos[0]?.event).toBe("proceso-error-no-capturado");
    expect(eventos[0]?.fields).toMatchObject({ tipo });
    expect(eventos[0]?.fields.message).toContain(mensaje);
    expect(escribirError).toHaveBeenCalledTimes(1);
    expect(salir).toHaveBeenCalledTimes(1);
    expect(salir).toHaveBeenCalledWith(1);
  });

  it.each([["cadena"], [undefined], [null], [{ a: 1 }]])(
    "motivo no-Error (%j): no lanza, evento con representación textual, sale con 1",
    async (motivo) => {
      const { manejarErrorNoCapturado } = await import("./proceso-cierre.js");
      const { logEvent, eventos, escribirError, salir } = crearDeps();

      expect(() => {
        manejarErrorNoCapturado(motivo, "unhandledRejection", { logEvent, escribirError, salir });
      }).not.toThrow();

      expect(eventos).toHaveLength(1);
      expect(eventos[0]?.event).toBe("proceso-error-no-capturado");
      expect(typeof eventos[0]?.fields.message).toBe("string");
      expect(salir).toHaveBeenCalledWith(1);
    },
  );

  it("si logEvent lanza, igual se invoca escribirError y salir(1)", async () => {
    const { manejarErrorNoCapturado } = await import("./proceso-cierre.js");
    const escribirError = vi.fn<(linea: string) => void>();
    const salir = vi.fn<(codigo: number) => void>();
    const logEvent: typeof logTurnEvent = () => {
      throw new Error("logger roto");
    };

    expect(() => {
      manejarErrorNoCapturado(new Error("boom"), "unhandledRejection", {
        logEvent,
        escribirError,
        salir,
      });
    }).not.toThrow();

    expect(escribirError).toHaveBeenCalledTimes(1);
    expect(salir).toHaveBeenCalledWith(1);
  });

  it("si escribirError lanza, igual se invoca salir(1)", async () => {
    const { manejarErrorNoCapturado } = await import("./proceso-cierre.js");
    const { logEvent, salir } = crearDeps();
    const escribirError = vi.fn<(linea: string) => void>(() => {
      throw new Error("stderr roto");
    });

    expect(() => {
      manejarErrorNoCapturado(new Error("boom"), "unhandledRejection", {
        logEvent,
        escribirError,
        salir,
      });
    }).not.toThrow();

    expect(salir).toHaveBeenCalledWith(1);
  });

  it("si logEvent Y escribirError lanzan, salir(1) igual corre y ninguna excepción escapa", async () => {
    const { manejarErrorNoCapturado } = await import("./proceso-cierre.js");
    const salir = vi.fn<(codigo: number) => void>();
    const logEvent: typeof logTurnEvent = () => {
      throw new Error("logger roto");
    };
    const escribirError = (): void => {
      throw new Error("stderr roto");
    };

    expect(() => {
      manejarErrorNoCapturado(new Error("boom"), "unhandledRejection", {
        logEvent,
        escribirError,
        salir,
      });
    }).not.toThrow();

    expect(salir).toHaveBeenCalledWith(1);
  });

  it("no recibe ni invoca ningún close/db: la política no toma dependencias de cierre ordenado", async () => {
    const { manejarErrorNoCapturado } = await import("./proceso-cierre.js");
    const { logEvent, escribirError, salir } = crearDeps();

    // Firma de tres parámetros: error, tipo, deps — sin un cuarto parámetro
    // de adaptadores/db. Si la firma cambiara para aceptar cierre ordenado,
    // este test (por aridad) fallaría.
    expect(manejarErrorNoCapturado.length).toBeLessThanOrEqual(3);

    manejarErrorNoCapturado(new Error("boom"), "uncaughtException", {
      logEvent,
      escribirError,
      salir,
    });
    expect(salir).toHaveBeenCalledWith(1);
  });
});

/**
 * Test-first (RED) de `esperarSenalDeCierre` + `finalizarCierreHeadless`
 * (tarea 2.6, ADR 248/249, H3-H8). `ProcesoLike` falso que captura handlers
 * (el `process` real NUNCA se toca) + reloj falso (`vi.useFakeTimers`).
 * Cada test parte de un módulo FRESCO (`vi.resetModules`) porque el estado
 * de fase/handlers/watchdog vive en el módulo.
 */
describe("esperarSenalDeCierre + finalizarCierreHeadless (modo-headless-cierre-limpio, tarea 2.6)", () => {
  const EVENTOS_DE_PROCESO = [
    "SIGTERM",
    "SIGINT",
    "unhandledRejection",
    "uncaughtException",
  ] as const;

  function crearProcesoFalso(): {
    readonly proceso: import("./proceso-cierre.js").ProcesoLike;
    readonly on: ReturnType<typeof vi.fn>;
    readonly off: ReturnType<typeof vi.fn>;
    readonly emitir: (evento: (typeof EVENTOS_DE_PROCESO)[number], arg?: unknown) => void;
  } {
    const handlers = new Map<string, Set<(arg?: unknown) => void>>();
    const on = vi.fn((evento: string, handler: (arg?: unknown) => void) => {
      const conjunto = handlers.get(evento) ?? new Set();
      conjunto.add(handler);
      handlers.set(evento, conjunto);
      return undefined;
    });
    const off = vi.fn((evento: string, handler: (arg?: unknown) => void) => {
      handlers.get(evento)?.delete(handler);
      return undefined;
    });
    const proceso = { on, off } as unknown as import("./proceso-cierre.js").ProcesoLike;
    const emitir = (evento: (typeof EVENTOS_DE_PROCESO)[number], arg?: unknown): void => {
      for (const handler of [...(handlers.get(evento) ?? [])]) {
        handler(arg);
      }
    };
    return { proceso, on, off, emitir };
  }

  function crearArmarDesarmarReales(): {
    readonly armarTimer: ReturnType<typeof vi.fn<(fn: () => void, ms: number) => unknown>>;
    readonly desarmarTimer: ReturnType<typeof vi.fn<(handle: unknown) => void>>;
  } {
    const armarTimer = vi.fn<(fn: () => void, ms: number) => unknown>((fn, ms) =>
      setTimeout(fn, ms),
    );
    const desarmarTimer = vi.fn<(handle: unknown) => void>((handle) => {
      clearTimeout(handle as ReturnType<typeof setTimeout>);
    });
    return { armarTimer, desarmarTimer };
  }

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("importar el módulo no registra listeners; esperarSenalDeCierre registra los 4 (R18)", async () => {
    const mod = await import("./proceso-cierre.js");
    const { proceso, on } = crearProcesoFalso();
    expect(on).toHaveBeenCalledTimes(0);

    const { logEvent } = crearLogEventEspia();
    const { armarTimer, desarmarTimer } = crearArmarDesarmarReales();
    void mod.esperarSenalDeCierre({ proceso, logEvent, env: {}, armarTimer, desarmarTimer, salir: vi.fn() });

    expect(on).toHaveBeenCalledTimes(4);
    const eventosRegistrados = on.mock.calls.map((llamada) => llamada[0]);
    expect(new Set(eventosRegistrados)).toEqual(new Set(EVENTOS_DE_PROCESO));
  });

  it("SIGTERM resuelve la promesa con la señal, loguea cierre-senal-recibida, nunca rechaza", async () => {
    const mod = await import("./proceso-cierre.js");
    const { proceso, emitir } = crearProcesoFalso();
    const { logEvent, eventos } = crearLogEventEspia();
    const { armarTimer, desarmarTimer } = crearArmarDesarmarReales();

    const promesa = mod.esperarSenalDeCierre({
      proceso,
      logEvent,
      env: {},
      armarTimer,
      desarmarTimer,
      salir: vi.fn(),
    });
    emitir("SIGTERM");

    await expect(promesa).resolves.toBe("SIGTERM");
    const recibidas = eventos.filter((e) => e.event === "cierre-senal-recibida");
    expect(recibidas).toHaveLength(1);
    expect(recibidas[0]?.fields).toMatchObject({ senal: "SIGTERM" });
  });

  it("tres SIGTERM seguidos: una sola resolución, salir nunca llamado, 2 cierre-senal-repetida; la 2.ª no acorta ni fuerza", async () => {
    const mod = await import("./proceso-cierre.js");
    const { proceso, emitir } = crearProcesoFalso();
    const { logEvent, eventos } = crearLogEventEspia();
    const { armarTimer, desarmarTimer } = crearArmarDesarmarReales();
    const salir = vi.fn();

    let resueltoCon: string | undefined;
    void mod
      .esperarSenalDeCierre({ proceso, logEvent, env: {}, armarTimer, desarmarTimer, salir })
      .then((senal) => {
        resueltoCon = senal;
      });

    emitir("SIGTERM");
    await Promise.resolve();
    emitir("SIGTERM");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(salir).not.toHaveBeenCalled();
    emitir("SIGTERM");
    await Promise.resolve();

    expect(resueltoCon).toBe("SIGTERM");
    expect(salir).not.toHaveBeenCalled();
    const repetidas = eventos.filter((e) => e.event === "cierre-senal-repetida");
    expect(repetidas).toHaveLength(2);
  });

  it("SIGINT seguido de SIGTERM produce un solo cierre", async () => {
    const mod = await import("./proceso-cierre.js");
    const { proceso, emitir } = crearProcesoFalso();
    const { logEvent, eventos } = crearLogEventEspia();
    const { armarTimer, desarmarTimer } = crearArmarDesarmarReales();

    let resueltoCon: string | undefined;
    void mod
      .esperarSenalDeCierre({ proceso, logEvent, env: {}, armarTimer, desarmarTimer, salir: vi.fn() })
      .then((senal) => {
        resueltoCon = senal;
      });

    emitir("SIGINT");
    await Promise.resolve();
    emitir("SIGTERM");
    await Promise.resolve();

    expect(resueltoCon).toBe("SIGINT");
    const repetidas = eventos.filter((e) => e.event === "cierre-senal-repetida");
    expect(repetidas).toHaveLength(1);
  });

  it("watchdog: no vence a 69999 ms; vence a 70000 ms con cierre-presupuesto-excedido{presupuestoMs, senal} y salir(1) una vez", async () => {
    const mod = await import("./proceso-cierre.js");
    const { proceso, emitir } = crearProcesoFalso();
    const { logEvent, eventos } = crearLogEventEspia();
    const { armarTimer, desarmarTimer } = crearArmarDesarmarReales();
    const salir = vi.fn();

    void mod.esperarSenalDeCierre({ proceso, logEvent, env: {}, armarTimer, desarmarTimer, salir });
    emitir("SIGTERM");

    await vi.advanceTimersByTimeAsync(69_999);
    expect(salir).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(salir).toHaveBeenCalledTimes(1);
    expect(salir).toHaveBeenCalledWith(1);
    const excedidos = eventos.filter((e) => e.event === "cierre-presupuesto-excedido");
    expect(excedidos).toHaveLength(1);
    expect(excedidos[0]?.fields).toMatchObject({ presupuestoMs: 70_000, senal: "SIGTERM" });

    // El handle devuelto por armarTimer se pasó tal cual a desarmarTimer cuando el watchdog venció
    // (el vencimiento mismo no desarma; se verifica en el test de finalizarCierreHeadless de abajo).
    expect(armarTimer).toHaveBeenCalledTimes(1);
  });

  it("watchdog con HARNESS_SHUTDOWN_TIMEOUT_MS=20000: vence a los 20000 ms con presupuestoMs:20000", async () => {
    const mod = await import("./proceso-cierre.js");
    const { proceso, emitir } = crearProcesoFalso();
    const { logEvent, eventos } = crearLogEventEspia();
    const { armarTimer, desarmarTimer } = crearArmarDesarmarReales();
    const salir = vi.fn();

    void mod.esperarSenalDeCierre({
      proceso,
      logEvent,
      env: { HARNESS_SHUTDOWN_TIMEOUT_MS: "20000" },
      armarTimer,
      desarmarTimer,
      salir,
    });
    emitir("SIGTERM");

    await vi.advanceTimersByTimeAsync(19_999);
    expect(salir).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(salir).toHaveBeenCalledWith(1);
    const excedidos = eventos.filter((e) => e.event === "cierre-presupuesto-excedido");
    expect(excedidos).toHaveLength(1);
    expect(excedidos[0]?.fields).toMatchObject({ presupuestoMs: 20_000 });
  });

  it("finalizarCierreHeadless: desarma el watchdog (handle intacto), quita los 4 listeners, salir(0) una vez, cierre-completado, sin timers pendientes", async () => {
    const mod = await import("./proceso-cierre.js");
    const { proceso, off, emitir } = crearProcesoFalso();
    const { logEvent, eventos } = crearLogEventEspia();
    const { armarTimer, desarmarTimer } = crearArmarDesarmarReales();
    const salir = vi.fn();
    const deps = { proceso, logEvent, env: {}, armarTimer, desarmarTimer, salir };

    void mod.esperarSenalDeCierre(deps);
    emitir("SIGTERM");
    mod.finalizarCierreHeadless(deps);

    await vi.advanceTimersByTimeAsync(60_000);

    expect(salir).toHaveBeenCalledTimes(1);
    expect(salir).toHaveBeenCalledWith(0);
    expect(off).toHaveBeenCalledTimes(4);
    const completados = eventos.filter((e) => e.event === "cierre-completado");
    expect(completados).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);

    // El handle que armarTimer devolvió para el watchdog se pasó tal cual a desarmarTimer.
    const handleArmado = armarTimer.mock.results[0]?.value;
    expect(desarmarTimer).toHaveBeenCalledWith(handleArmado);
  });

  it("finalizarCierreHeadless SIN esperarSenalDeCierre previa (TUI): no-op; llamarla dos veces sigue siendo no-op", async () => {
    const mod = await import("./proceso-cierre.js");
    const { proceso, off } = crearProcesoFalso();
    const { logEvent } = crearLogEventEspia();
    const { armarTimer, desarmarTimer } = crearArmarDesarmarReales();
    const salir = vi.fn();
    const deps = { proceso, logEvent, env: {}, armarTimer, desarmarTimer, salir };

    mod.finalizarCierreHeadless(deps);
    expect(off).toHaveBeenCalledTimes(0);
    expect(salir).toHaveBeenCalledTimes(0);

    mod.finalizarCierreHeadless(deps);
    expect(off).toHaveBeenCalledTimes(0);
    expect(salir).toHaveBeenCalledTimes(0);
  });

  it("una falla no capturada en headless delega en manejarErrorNoCapturado (salir(1)), incluso durante un cierre en curso", async () => {
    const mod = await import("./proceso-cierre.js");
    const { proceso, emitir } = crearProcesoFalso();
    const { logEvent, eventos } = crearLogEventEspia();
    const { armarTimer, desarmarTimer } = crearArmarDesarmarReales();
    const salir = vi.fn();

    void mod.esperarSenalDeCierre({ proceso, logEvent, env: {}, armarTimer, desarmarTimer, salir });
    // Cierre en curso (tras la señal), y AHORA llega una falla no capturada.
    emitir("SIGTERM");
    emitir("unhandledRejection", new Error("boom"));

    expect(salir).toHaveBeenCalledWith(1);
    const fallas = eventos.filter((e) => e.event === "proceso-error-no-capturado");
    expect(fallas).toHaveLength(1);
    expect(fallas[0]?.fields).toMatchObject({ tipo: "unhandledRejection" });

    emitir("uncaughtException", new Error("kaput"));
    const fallas2 = eventos.filter((e) => e.event === "proceso-error-no-capturado");
    expect(fallas2).toHaveLength(2);
  });

  /**
   * Test-first (RED) de la enmienda post-evidencia (`modo-headless-cierre-limpio`,
   * tarea 2.7a, H-1/H-2, design §0.7b y §8, spec H1 ampliado + H13).
   * `armarAncla`/`desarmarAncla`/`ANCLA_INTERVALO_MS` y el evento
   * `cierre-esperando-senal` TODAVÍA NO EXISTEN: `npm run typecheck` y
   * `npm test -- proceso-cierre` deben fallar los dos, a propósito.
   *
   * Motivo (medido, evidencia-manual.md H-1): un handler de señal NO mantiene
   * vivo el event loop en Node (`process.on("SIGTERM", …); await new
   * Promise(() => {})` sale con código 13). Sin un handle ref'd propio, el
   * proceso headless sin ningún listener de red moría solo a los ~0,8 s.
   *
   * ★ Los relojes son falsos (`vi.useFakeTimers` del `beforeEach` de arriba):
   * un intervalo NO se vacía nunca, así que ningún test de este bloque puede
   * usar `vi.runAllTimers()` — siempre `advanceTimersByTimeAsync`.
   */
  describe("ancla del event loop y marcador cierre-esperando-senal (tarea 2.7a, H-1/H-2)", () => {
    /**
     * Molde LITERAL de `crearArmarDesarmarReales`: `vi.fn` que envuelven el
     * `setInterval`/`clearInterval` (falsos bajo `vi.useFakeTimers`) para que
     * `vi.getTimerCount()` siga siendo significativo.
     */
    function crearAnclaReal(): {
      readonly armarAncla: ReturnType<typeof vi.fn<() => unknown>>;
      readonly desarmarAncla: ReturnType<typeof vi.fn<(handle: unknown) => void>>;
    } {
      const armarAncla = vi.fn<() => unknown>(() => setInterval(() => {}, 60_000));
      const desarmarAncla = vi.fn<(handle: unknown) => void>((handle) => {
        clearInterval(handle as ReturnType<typeof setInterval>);
      });
      return { armarAncla, desarmarAncla };
    }

    function armarDeps(): {
      readonly deps: Partial<ProcesoCierreDeps>;
      readonly emitir: ReturnType<typeof crearProcesoFalso>["emitir"];
      readonly on: ReturnType<typeof crearProcesoFalso>["on"];
      readonly eventos: ReturnType<typeof crearLogEventEspia>["eventos"];
      readonly armarTimer: ReturnType<typeof crearArmarDesarmarReales>["armarTimer"];
      readonly armarAncla: ReturnType<typeof crearAnclaReal>["armarAncla"];
      readonly desarmarAncla: ReturnType<typeof crearAnclaReal>["desarmarAncla"];
      readonly salir: ReturnType<typeof vi.fn<(codigo: number) => void>>;
    } {
      const { proceso, on, emitir } = crearProcesoFalso();
      const { logEvent, eventos } = crearLogEventEspia();
      const { armarTimer, desarmarTimer } = crearArmarDesarmarReales();
      const { armarAncla, desarmarAncla } = crearAnclaReal();
      const salir = vi.fn<(codigo: number) => void>();
      // Anotado como `Partial<ProcesoCierreDeps>` A PROPÓSITO: es lo que hace
      // fallar el typecheck mientras `armarAncla`/`desarmarAncla` no existan.
      const deps: Partial<ProcesoCierreDeps> = {
        proceso,
        logEvent,
        env: {},
        armarTimer,
        desarmarTimer,
        armarAncla,
        desarmarAncla,
        salir,
      };
      return { deps, emitir, on, eventos, armarTimer, armarAncla, desarmarAncla, salir };
    }

    it("(test 25) esperarSenalDeCierre arma UN ancla (el watchdog todavía no); la 1.ª señal la desarma con el handle exacto y arma el watchdog: siempre hay >= 1 timer", async () => {
      const mod = await import("./proceso-cierre.js");
      const { deps, emitir, armarTimer, armarAncla, desarmarAncla } = armarDeps();

      void mod.esperarSenalDeCierre(deps);

      expect(armarAncla).toHaveBeenCalledTimes(1);
      expect(armarTimer).toHaveBeenCalledTimes(0);
      expect(desarmarAncla).toHaveBeenCalledTimes(0);
      // Antes de la señal: el ANCLA sostiene el loop.
      expect(vi.getTimerCount()).toBeGreaterThanOrEqual(1);

      emitir("SIGTERM");

      const handleDelAncla = armarAncla.mock.results[0]?.value;
      expect(handleDelAncla).toBeDefined();
      expect(desarmarAncla).toHaveBeenCalledTimes(1);
      expect(desarmarAncla).toHaveBeenCalledWith(handleDelAncla);
      // El BATON: tras la señal el ancla ya no está, pero el WATCHDOG toma la posta.
      expect(armarTimer).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBeGreaterThanOrEqual(1);

      mod.finalizarCierreHeadless(deps);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("(test 25b) finalizarCierreHeadless tras la señal no lanza aunque el ancla ya esté desarmada (a lo sumo 2 llamadas en total)", async () => {
      const mod = await import("./proceso-cierre.js");
      const { deps, emitir, armarAncla, desarmarAncla } = armarDeps();

      void mod.esperarSenalDeCierre(deps);
      emitir("SIGTERM");

      expect(() => mod.finalizarCierreHeadless(deps)).not.toThrow();
      expect(armarAncla).toHaveBeenCalledTimes(1);
      expect(desarmarAncla.mock.calls.length).toBeGreaterThanOrEqual(1);
      expect(desarmarAncla.mock.calls.length).toBeLessThanOrEqual(2);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("(test 25b) finalizarCierreHeadless SIN esperarSenalDeCierre previa (TUI) no toca el ancla: 0 llamadas a armarAncla y a desarmarAncla", async () => {
      const mod = await import("./proceso-cierre.js");
      const { deps, armarAncla, desarmarAncla } = armarDeps();

      mod.finalizarCierreHeadless(deps);

      expect(armarAncla).toHaveBeenCalledTimes(0);
      expect(desarmarAncla).toHaveBeenCalledTimes(0);
    });

    it("(test 25b) la 2.ª señal no desarma el ancla otra vez: desarmarAncla sigue en 1", async () => {
      const mod = await import("./proceso-cierre.js");
      const { deps, emitir, desarmarAncla } = armarDeps();

      void mod.esperarSenalDeCierre(deps);
      emitir("SIGTERM");
      emitir("SIGINT");

      expect(desarmarAncla).toHaveBeenCalledTimes(1);
    });

    it("(test 25c, mecánico sobre el fuente) proceso-cierre.ts no contiene el método que desreferencia un timer: el ancla y el watchdog DEBEN ser ref'd", () => {
      // Patrón por CONCATENACIÓN (corrección (d) de la 3.2): el propio test no debe encontrarse a sí mismo.
      const patronProhibido = "un" + "ref";
      const fuente = readFileSync(new URL("./proceso-cierre.ts", import.meta.url), "utf8");

      expect(fuente).not.toContain(patronProhibido);
    });

    it("(test 25d) ANCLA_INTERVALO_MS es 60000 y, sin inyectar, el default arma un intervalo real que NO llama a salir aunque pasen tres periodos", async () => {
      const mod = await import("./proceso-cierre.js");
      const { proceso, emitir } = crearProcesoFalso();
      const { logEvent } = crearLogEventEspia();
      const salir = vi.fn<(codigo: number) => void>();

      expect(mod.ANCLA_INTERVALO_MS).toBe(60_000);

      // SIN `armarAncla`/`desarmarAncla`: corren los defaults (`setInterval`/`clearInterval`, falsos bajo el reloj falso).
      void mod.esperarSenalDeCierre({ proceso, logEvent, env: {}, salir });
      expect(vi.getTimerCount()).toBe(1);

      await vi.advanceTimersByTimeAsync(3 * mod.ANCLA_INTERVALO_MS);
      expect(salir).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(1);

      emitir("SIGTERM");
      // Baton: sale el ancla, entra el watchdog (`setTimeout` por defecto).
      expect(vi.getTimerCount()).toBe(1);

      mod.finalizarCierreHeadless({ proceso, logEvent, env: {}, salir });
      expect(vi.getTimerCount()).toBe(0);
      expect(salir).toHaveBeenCalledWith(0);
    });

    it("(test 26) UN evento cierre-esperando-senal con el presupuesto efectivo por defecto (70000)", async () => {
      const mod = await import("./proceso-cierre.js");
      const { deps, eventos } = armarDeps();

      void mod.esperarSenalDeCierre(deps);

      const marcadores = eventos.filter((e) => e.event === "cierre-esperando-senal");
      expect(marcadores).toHaveLength(1);
      expect(marcadores[0]?.casoId).toBe(mod.PROCESO_LOG_CORRELATION_ID);
      expect(marcadores[0]?.fields).toMatchObject({ presupuestoMs: 70_000 });
    });

    it("(test 26) con HARNESS_SHUTDOWN_TIMEOUT_MS=20000 el marcador lleva presupuestoMs 20000", async () => {
      const mod = await import("./proceso-cierre.js");
      const { deps, eventos } = armarDeps();

      void mod.esperarSenalDeCierre({ ...deps, env: { HARNESS_SHUTDOWN_TIMEOUT_MS: "20000" } });

      const marcadores = eventos.filter((e) => e.event === "cierre-esperando-senal");
      expect(marcadores).toHaveLength(1);
      expect(marcadores[0]?.fields).toMatchObject({ presupuestoMs: 20_000 });
    });

    it("(test 26) el marcador es lo ÚLTIMO del armado: su índice en un log de llamadas compartido es posterior a los 4 `on` y a armarAncla", async () => {
      const mod = await import("./proceso-cierre.js");
      const llamadas: string[] = [];
      const proceso = {
        on: (evento: string): void => {
          llamadas.push(`on:${evento}`);
        },
        off: (): void => {},
      } as unknown as import("./proceso-cierre.js").ProcesoLike;
      const logEvent: typeof logTurnEvent = (_casoId, event) => {
        llamadas.push(`log:${event}`);
      };
      const deps: Partial<ProcesoCierreDeps> = {
        proceso,
        logEvent,
        env: {},
        armarAncla: () => {
          llamadas.push("armarAncla");
          return undefined;
        },
        desarmarAncla: () => {},
        salir: vi.fn(),
      };

      void mod.esperarSenalDeCierre(deps);

      const indiceMarcador = llamadas.indexOf("log:cierre-esperando-senal");
      expect(indiceMarcador).toBeGreaterThanOrEqual(0);
      expect(llamadas.filter((l) => l.startsWith("on:"))).toHaveLength(4);
      expect(llamadas.indexOf("armarAncla")).toBeGreaterThanOrEqual(0);
      // Es la ÚLTIMA llamada del armado: nada de lo registrado viene después.
      expect(indiceMarcador).toBe(llamadas.length - 1);
    });

    it("(test 26) sin llamar a esperarSenalDeCierre (TUI) no hay ningún marcador", async () => {
      const mod = await import("./proceso-cierre.js");
      const { deps, eventos } = armarDeps();

      mod.finalizarCierreHeadless(deps);

      expect(eventos.filter((e) => e.event === "cierre-esperando-senal")).toHaveLength(0);
    });

    it("(test 26) el marcador sigue en 1 tras dos señales (las repeticiones quedan en cierre-senal-repetida)", async () => {
      const mod = await import("./proceso-cierre.js");
      const { deps, emitir, eventos } = armarDeps();

      void mod.esperarSenalDeCierre(deps);
      emitir("SIGTERM");
      emitir("SIGTERM");

      expect(eventos.filter((e) => e.event === "cierre-esperando-senal")).toHaveLength(1);
      expect(eventos.filter((e) => e.event === "cierre-senal-repetida")).toHaveLength(1);
    });

    it("(test 26) un logEvent que lanza en el marcador NO impide el registro: el arranque no depende del log (molde H6)", async () => {
      const mod = await import("./proceso-cierre.js");
      const { deps, on, emitir } = armarDeps();
      let intentosDelMarcador = 0;
      const logEvent: typeof logTurnEvent = (_casoId, event) => {
        if (event === "cierre-esperando-senal") {
          intentosDelMarcador += 1;
          throw new Error("logger roto");
        }
      };

      let promesa: Promise<string> | undefined;
      expect(() => {
        promesa = mod.esperarSenalDeCierre({ ...deps, logEvent });
      }).not.toThrow();

      // Se INTENTÓ publicar el marcador (y el log lanzó), y aun así los 4 handlers están y la señal resuelve.
      expect(intentosDelMarcador).toBe(1);
      expect(on).toHaveBeenCalledTimes(4);
      emitir("SIGTERM");
      await expect(promesa).resolves.toBe("SIGTERM");
    });
  });
});
