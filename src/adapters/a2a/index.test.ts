import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { A2AConfig, DestinoA2AConfig } from "./config.js";

/**
 * `index.ts` (Hito 6, tarea 6, design.md §6.3) — la fachada `createA2AAdapter`.
 * Molde de `notificaciones/index.test.ts`: estos tests son sobre el CABLEADO
 * (config + client cerrados sobre `ClienteA2APort`, defaults inyectables),
 * no sobre el protocolo JSON-RPC en sí — eso ya está cubierto por
 * `client.test.ts` (tareas 4-5). Por eso `./client.js` se mockea acá: nada
 * de lo que sigue necesita el comportamiento real de `delegarTarea`.
 *
 * R8 (`cliente-a2a-jsonrpc`, "No existe una firma pública por la que...
 * inyectar una URL de destino arbitraria") se verifica por inspección de las
 * firmas/valores del módulo — mismo criterio que la aserción de
 * cero-imports de `a2a-contract.test.ts` — no por un grep de texto libre.
 */

vi.mock("./client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./client.js")>();
  return { ...actual, delegarTarea: vi.fn() };
});

vi.mock("./config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config.js")>();
  return { ...actual, resolveA2AConfig: vi.fn(actual.resolveA2AConfig) };
});

const { delegarTarea } = await import("./client.js");
const { resolveA2AConfig } = await import("./config.js");
const { createA2AAdapter } = await import("./index.js");

const mockedDelegarTarea = vi.mocked(delegarTarea);
const mockedResolveA2AConfig = vi.mocked(resolveA2AConfig);

function makeConfig(overrides: Partial<A2AConfig> = {}): A2AConfig {
  return {
    requestTimeoutMs: 10_000,
    pollIntervalMs: 1_500,
    taskTimeoutMs: 120_000,
    destinos: { "riesgo-credito": undefined, "kpi-incidente": undefined },
    ...overrides,
  };
}

const DESTINO_CONFIGURADO: DestinoA2AConfig = { baseUrl: "https://agente.example.com" };

afterEach(() => {
  vi.clearAllMocks();
});

describe("index.ts — R8: ninguna función exportada acepta una URL como parámetro", () => {
  it("el único símbolo exportado del módulo es createA2AAdapter", () => {
    const sourcePath = fileURLToPath(new URL("./index.ts", import.meta.url));
    const source = readFileSync(sourcePath, "utf-8");

    const exportados = [...source.matchAll(/^export (?:async )?function (\w+)|^export const (\w+)/gm)].map(
      ([, fn, cn]) => fn ?? cn,
    );

    expect(exportados).toEqual(["createA2AAdapter"]);
  });

  it("createA2AAdapter tiene aridad 1: recibe un único objeto de dependencias, nunca una URL posicional", () => {
    expect(createA2AAdapter).toHaveLength(1);
  });

  it("el fuente de index.ts no declara ningún parámetro de tipo string suelto para url/baseUrl/endpoint", () => {
    const sourcePath = fileURLToPath(new URL("./index.ts", import.meta.url));
    const source = readFileSync(sourcePath, "utf-8");

    expect(source).not.toMatch(/\b(url|baseUrl|endpoint)\s*:\s*string\b/i);
  });
});

describe("createA2AAdapter — baseUrlDe: síncrono, sin I/O", () => {
  it("lee el registro ya resuelto sin disparar fetch, para claves configuradas y sin configurar", () => {
    const fetchFn = vi.fn();
    const config = makeConfig({
      destinos: { "riesgo-credito": DESTINO_CONFIGURADO, "kpi-incidente": undefined },
    });

    const adapter = createA2AAdapter({ config, fetchFn, logEvent: vi.fn() });
    const resultado = adapter.baseUrlDe("riesgo-credito");

    expect(resultado).toBe("https://agente.example.com");
    expect(adapter.baseUrlDe("kpi-incidente")).toBeUndefined();
    expect(fetchFn).not.toHaveBeenCalled();
    expect(resultado).not.toBeInstanceOf(Promise);
  });
});

describe("createA2AAdapter — cierra config.ts + client.ts sobre ClienteA2APort", () => {
  it("delegar resuelve el destino por clave y llama a delegarTarea con el destino y los deps completos", async () => {
    const config = makeConfig({
      destinos: { "riesgo-credito": DESTINO_CONFIGURADO, "kpi-incidente": undefined },
    });
    const logEvent = vi.fn();
    const fetchFn = vi.fn();
    const resultadoEsperado = {
      ok: true as const,
      a2aTaskId: "task-1",
      estado: "TASK_STATE_COMPLETED" as const,
      resultado: "listo",
      agenteNombre: "Agente de Riesgo",
      endpoint: "https://agente.example.com/jsonrpc",
    };
    mockedDelegarTarea.mockResolvedValue(resultadoEsperado);

    const adapter = createA2AAdapter({ config, fetchFn, logEvent });
    const resultado = await adapter.delegar({ clave: "riesgo-credito", tarea: "verificar riesgo", casoId: "caso-1" });

    expect(resultado).toBe(resultadoEsperado);
    expect(mockedDelegarTarea).toHaveBeenCalledTimes(1);
    const [input, deps] = mockedDelegarTarea.mock.calls[0]!;
    expect(input).toEqual({
      destino: DESTINO_CONFIGURADO,
      clave: "riesgo-credito",
      tarea: "verificar riesgo",
      casoId: "caso-1",
    });
    expect(deps.config).toBe(config);
    expect(deps.fetchFn).toBe(fetchFn);
    expect(deps.logEvent).toBe(logEvent);
    expect(typeof deps.ahoraMs).toBe("function");
    expect(typeof deps.dormir).toBe("function");
    expect(typeof deps.newMessageId).toBe("function");
  });

  it("config default: resolveA2AConfig() se llama cuando no se pasa config explícito", () => {
    createA2AAdapter({ logEvent: vi.fn() });

    expect(mockedResolveA2AConfig).toHaveBeenCalledTimes(1);
    expect(mockedResolveA2AConfig).toHaveBeenCalledWith();
  });

  it("no llama a resolveA2AConfig() cuando se pasa config explícito", () => {
    createA2AAdapter({ config: makeConfig(), logEvent: vi.fn() });

    expect(mockedResolveA2AConfig).not.toHaveBeenCalled();
  });

  it("usa los defaults reales cuando no se pasan explícitos: fetchFn=globalThis.fetch, ahoraMs=Date.now, dormir=setTimeout envuelto, newMessageId=randomUUID", async () => {
    const originalFetch = globalThis.fetch;
    const fakeFetch = vi.fn();
    globalThis.fetch = fakeFetch as unknown as typeof fetch;

    try {
      const config = makeConfig({
        destinos: { "riesgo-credito": DESTINO_CONFIGURADO, "kpi-incidente": undefined },
      });
      mockedDelegarTarea.mockResolvedValue({ ok: false, reason: "protocolo" });

      const adapter = createA2AAdapter({ config, logEvent: vi.fn() });
      await adapter.delegar({ clave: "riesgo-credito", tarea: "t", casoId: "caso-1" });

      const [, deps] = mockedDelegarTarea.mock.calls[0]!;
      expect(deps.fetchFn).toBe(fakeFetch);
      expect(deps.ahoraMs).toBe(Date.now);

      const dormirResult = deps.dormir(0);
      expect(dormirResult).toBeInstanceOf(Promise);
      await dormirResult;

      const idGenerado = deps.newMessageId();
      expect(idGenerado).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("delegar sobre un destino no configurado no crashea: devuelve {ok:false, reason:'protocolo'} sin llamar a delegarTarea", async () => {
    const config = makeConfig({ destinos: { "riesgo-credito": undefined, "kpi-incidente": undefined } });

    const adapter = createA2AAdapter({ config, logEvent: vi.fn() });
    const resultado = await adapter.delegar({ clave: "riesgo-credito", tarea: "t", casoId: "caso-1" });

    expect(resultado).toEqual({ ok: false, reason: "protocolo" });
    expect(mockedDelegarTarea).not.toHaveBeenCalled();
  });
});
