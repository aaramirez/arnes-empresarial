import { describe, expect, it, vi } from "vitest";
import { ESTADO_APROBADO, ESTADO_RESUELTO } from "../../core/activity/activity-contract.js";
import type { BoardConfig } from "./config.js";
import { MAX_CHANGED_FILES, MAX_COMMENT_CHARS } from "./config.js";
import type { FetchFn, FetchResponseLike } from "./github-client.js";
import { createBoardAdapter, createNoopBoardAdapter } from "./index.js";

const PROYECTO_ID = "owner/repo";
const REF = "42";
const CASO_ID = "caso-1";

function makeConfig(overrides: Partial<BoardConfig> = {}): BoardConfig {
  return {
    token: "ghp_super-secreto-123",
    apiBaseUrl: "https://api.github.com",
    requestTimeoutMs: 10_000,
    userAgent: "arnes-empresarial",
    ...overrides,
  };
}

function okResponse(body: unknown): FetchResponseLike {
  return {
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

function errorResponse(status: number, bodyText: string): FetchResponseLike {
  return {
    ok: false,
    status,
    text: () => Promise.resolve(bodyText),
  };
}

interface LoggedCall {
  readonly casoId: string;
  readonly event: string;
  readonly fields: Readonly<Record<string, unknown>> | undefined;
}

function makeLogEvent(): {
  readonly logEvent: (casoId: string, event: string, fields?: Readonly<Record<string, unknown>>) => void;
  readonly calls: LoggedCall[];
} {
  const calls: LoggedCall[] = [];
  return {
    logEvent: (casoId, event, fields) => {
      calls.push({ casoId, event, fields });
    },
    calls,
  };
}

describe("createNoopBoardAdapter (sin GITHUB_TOKEN)", () => {
  it("createBoardAdapter con token vacio delega en el no-op: fetchFn nunca se llama", async () => {
    const { logEvent, calls } = makeLogEvent();
    const fetchFn: FetchFn = vi.fn();

    const board = createBoardAdapter({ logEvent, config: makeConfig({ token: "" }), fetchFn });

    const metadatos = await board.leerMetadatos({ proyectoId: PROYECTO_ID, referenciaExterna: REF, casoId: CASO_ID });
    await board.publicarRevision({ proyectoId: PROYECTO_ID, referenciaExterna: REF, texto: "hola", casoId: CASO_ID });
    await board.mirrorEstado({ proyectoId: PROYECTO_ID, referenciaExterna: REF, estado: ESTADO_APROBADO, casoId: CASO_ID });

    expect(metadatos).toBeUndefined();
    expect(fetchFn).not.toHaveBeenCalled();
    expect(calls).toHaveLength(3);
    expect(calls.every((call) => call.event === "tablero-deshabilitado")).toBe(true);
  });

  it("loguea tablero-deshabilitado con el campo operacion correcto por metodo", async () => {
    const { logEvent, calls } = makeLogEvent();
    const board = createNoopBoardAdapter(logEvent);

    await board.leerMetadatos({ proyectoId: PROYECTO_ID, referenciaExterna: REF, casoId: CASO_ID });
    await board.publicarRevision({ proyectoId: PROYECTO_ID, referenciaExterna: REF, texto: "hola", casoId: CASO_ID });
    await board.mirrorEstado({ proyectoId: PROYECTO_ID, referenciaExterna: REF, estado: ESTADO_APROBADO, casoId: CASO_ID });

    expect(calls[0]).toEqual({ casoId: CASO_ID, event: "tablero-deshabilitado", fields: { operacion: "leerMetadatos" } });
    expect(calls[1]).toEqual({ casoId: CASO_ID, event: "tablero-deshabilitado", fields: { operacion: "publicarRevision" } });
    expect(calls[2]).toEqual({ casoId: CASO_ID, event: "tablero-deshabilitado", fields: { operacion: "mirrorEstado" } });
  });

  it("publicarRevision y mirrorEstado resuelven sin error en el no-op", async () => {
    const board = createNoopBoardAdapter(() => {});

    await expect(
      board.publicarRevision({ proyectoId: PROYECTO_ID, referenciaExterna: REF, texto: "hola", casoId: CASO_ID }),
    ).resolves.toBeUndefined();
    await expect(
      board.mirrorEstado({ proyectoId: PROYECTO_ID, referenciaExterna: REF, estado: ESTADO_APROBADO, casoId: CASO_ID }),
    ).resolves.toBeUndefined();
  });
});

describe("createBoardAdapter — contrato 'nunca rechaza'", () => {
  it("mirrorEstado con fetchFn que rechaza resuelve igual y loguea tablero-actualizacion-fallida con reason", async () => {
    const { logEvent, calls } = makeLogEvent();
    const fetchFn: FetchFn = vi.fn().mockRejectedValue(new Error("network down"));

    const board = createBoardAdapter({ logEvent, config: makeConfig(), fetchFn });

    await expect(
      board.mirrorEstado({ proyectoId: PROYECTO_ID, referenciaExterna: REF, estado: ESTADO_APROBADO, casoId: CASO_ID }),
    ).resolves.toBeUndefined();

    const fallo = calls.find((call) => call.event === "tablero-actualizacion-fallida");
    expect(fallo).toBeDefined();
    expect(fallo?.fields?.reason).toBeDefined();
  });

  it("publicarRevision con fetchFn que rechaza resuelve igual y loguea tablero-comentario-fallido con reason", async () => {
    const { logEvent, calls } = makeLogEvent();
    const fetchFn: FetchFn = vi.fn().mockRejectedValue(new Error("network down"));

    const board = createBoardAdapter({ logEvent, config: makeConfig(), fetchFn });

    await expect(
      board.publicarRevision({ proyectoId: PROYECTO_ID, referenciaExterna: REF, texto: "hola", casoId: CASO_ID }),
    ).resolves.toBeUndefined();

    const fallo = calls.find((call) => call.event === "tablero-comentario-fallido");
    expect(fallo).toBeDefined();
    expect(fallo?.fields?.reason).toBeDefined();
  });

  it("leerMetadatos con fetchFn que rechaza resuelve con undefined (no lanza)", async () => {
    const { logEvent } = makeLogEvent();
    const fetchFn: FetchFn = vi.fn().mockRejectedValue(new Error("network down"));

    const board = createBoardAdapter({ logEvent, config: makeConfig(), fetchFn });

    await expect(
      board.leerMetadatos({ proyectoId: PROYECTO_ID, referenciaExterna: REF, casoId: CASO_ID }),
    ).resolves.toBeUndefined();
  });
});

describe("createBoardAdapter.mirrorEstado", () => {
  it("camino feliz: GET de labels + PATCH con mergeLabels(...), loguea tablero-actualizado", async () => {
    const { logEvent, calls } = makeLogEvent();
    const fetchFn: FetchFn = vi
      .fn()
      .mockResolvedValueOnce(okResponse({ labels: [{ name: "bug" }, { name: "necesita-revision" }] }))
      .mockResolvedValueOnce(okResponse({}));

    const board = createBoardAdapter({ logEvent, config: makeConfig(), fetchFn });

    await board.mirrorEstado({
      proyectoId: PROYECTO_ID,
      referenciaExterna: REF,
      estado: ESTADO_APROBADO,
      responsableId: "octocat",
      casoId: CASO_ID,
    });

    expect(fetchFn).toHaveBeenCalledTimes(2);

    const [getUrl, getInit] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { method: string }];
    expect(getUrl).toBe("https://api.github.com/repos/owner/repo/issues/42");
    expect(getInit.method).toBe("GET");

    const [patchUrl, patchInit] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[1] as [
      string,
      { method: string; body?: string },
    ];
    expect(patchUrl).toBe("https://api.github.com/repos/owner/repo/issues/42");
    expect(patchInit.method).toBe("PATCH");
    const patchBody = JSON.parse(patchInit.body ?? "{}") as { labels: string[]; assignees?: string[] };
    expect(patchBody.labels).toEqual(["bug", "aprobado"]);
    expect(patchBody.assignees).toEqual(["octocat"]);

    const actualizado = calls.find((call) => call.event === "tablero-actualizado");
    expect(actualizado).toBeDefined();
    expect(actualizado?.fields).toEqual({ estado: ESTADO_APROBADO, label: "aprobado", assignee: "octocat" });
  });

  it("omite assignees por completo (no assignees: []) cuando no hay responsableId", async () => {
    const { logEvent } = makeLogEvent();
    const fetchFn: FetchFn = vi
      .fn()
      .mockResolvedValueOnce(okResponse({ labels: [] }))
      .mockResolvedValueOnce(okResponse({}));

    const board = createBoardAdapter({ logEvent, config: makeConfig(), fetchFn });

    await board.mirrorEstado({
      proyectoId: PROYECTO_ID,
      referenciaExterna: REF,
      estado: ESTADO_RESUELTO,
      casoId: CASO_ID,
    });

    const [, patchInit] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[1] as [string, { body?: string }];
    const patchBody = JSON.parse(patchInit.body ?? "{}") as Record<string, unknown>;
    expect(patchBody).not.toHaveProperty("assignees");
  });

  it("si el GET de labels falla, igual hace el PATCH con mergeLabels([], estado) y loguea tablero-labels-no-leidos", async () => {
    const { logEvent, calls } = makeLogEvent();
    const fetchFn: FetchFn = vi
      .fn()
      .mockResolvedValueOnce(errorResponse(500, "boom"))
      .mockResolvedValueOnce(okResponse({}));

    const board = createBoardAdapter({ logEvent, config: makeConfig(), fetchFn });

    await board.mirrorEstado({
      proyectoId: PROYECTO_ID,
      referenciaExterna: REF,
      estado: ESTADO_APROBADO,
      casoId: CASO_ID,
    });

    expect(fetchFn).toHaveBeenCalledTimes(2);

    const [, patchInit] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[1] as [string, { body?: string }];
    const patchBody = JSON.parse(patchInit.body ?? "{}") as { labels: string[] };
    expect(patchBody.labels).toEqual(["aprobado"]);

    const noLeidos = calls.find((call) => call.event === "tablero-labels-no-leidos");
    expect(noLeidos).toBeDefined();
    expect(noLeidos?.fields?.reason).toBeDefined();

    // Decision documentada: el PATCH sí tuvo éxito, así que ADEMÁS se loguea
    // tablero-actualizado (no es un reemplazo del evento de falla).
    const actualizado = calls.find((call) => call.event === "tablero-actualizado");
    expect(actualizado).toBeDefined();
  });
});

describe("createBoardAdapter.publicarRevision", () => {
  it("trunca el texto a MAX_COMMENT_CHARS en el body del POST", async () => {
    const { logEvent, calls } = makeLogEvent();
    const fetchFn: FetchFn = vi.fn().mockResolvedValue(okResponse({}));
    const textoLargo = "a".repeat(MAX_COMMENT_CHARS + 500);

    const board = createBoardAdapter({ logEvent, config: makeConfig(), fetchFn });

    await board.publicarRevision({ proyectoId: PROYECTO_ID, referenciaExterna: REF, texto: textoLargo, casoId: CASO_ID });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { method: string; body?: string },
    ];
    expect(url).toBe("https://api.github.com/repos/owner/repo/issues/42/comments");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body ?? "{}") as { body: string };
    expect(body.body).toHaveLength(MAX_COMMENT_CHARS);
    expect(body.body).toBe("a".repeat(MAX_COMMENT_CHARS));

    const publicado = calls.find((call) => call.event === "tablero-comentario-publicado");
    expect(publicado).toBeDefined();
    expect(publicado?.fields).toEqual({ chars: MAX_COMMENT_CHARS });
  });

  it("no trunca un texto mas corto que el limite", async () => {
    const { logEvent } = makeLogEvent();
    const fetchFn: FetchFn = vi.fn().mockResolvedValue(okResponse({}));

    const board = createBoardAdapter({ logEvent, config: makeConfig(), fetchFn });

    await board.publicarRevision({ proyectoId: PROYECTO_ID, referenciaExterna: REF, texto: "hola mundo", casoId: CASO_ID });

    const [, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { body?: string }];
    const body = JSON.parse(init.body ?? "{}") as { body: string };
    expect(body.body).toBe("hola mundo");
  });
});

describe("createBoardAdapter.leerMetadatos", () => {
  it("nunca pide el diff: ningun header Accept incluye el media type de diff de GitHub", async () => {
    const { logEvent } = makeLogEvent();
    const fetchFn: FetchFn = vi
      .fn()
      .mockResolvedValueOnce(okResponse({ title: "t", body: "b", user: { login: "octocat" } }))
      .mockResolvedValueOnce(okResponse([{ filename: "a.ts" }]));

    const board = createBoardAdapter({ logEvent, config: makeConfig(), fetchFn });

    await board.leerMetadatos({ proyectoId: PROYECTO_ID, referenciaExterna: REF, casoId: CASO_ID });

    const allCalls = (fetchFn as ReturnType<typeof vi.fn>).mock.calls as Array<
      [string, { headers: Record<string, string> }]
    >;
    expect(allCalls.length).toBeGreaterThan(0);
    for (const [, init] of allCalls) {
      expect(init.headers.Accept).not.toContain("diff");
    }
  });

  it("camino feliz: mapea los 2 GETs a PullRequestMetadata", async () => {
    const { logEvent } = makeLogEvent();
    const fetchFn: FetchFn = vi
      .fn()
      .mockResolvedValueOnce(okResponse({ title: "Mi PR", body: "Descripcion", user: { login: "octocat" } }))
      .mockResolvedValueOnce(okResponse([{ filename: "a.ts" }, { filename: "b.ts" }]));

    const board = createBoardAdapter({ logEvent, config: makeConfig(), fetchFn });

    const metadatos = await board.leerMetadatos({ proyectoId: PROYECTO_ID, referenciaExterna: REF, casoId: CASO_ID });

    expect(metadatos).toEqual({
      titulo: "Mi PR",
      cuerpo: "Descripcion",
      autor: "octocat",
      archivosCambiados: ["a.ts", "b.ts"],
      archivosTruncados: false,
    });

    const [firstUrl] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(firstUrl).toBe("https://api.github.com/repos/owner/repo/pulls/42");
    const [secondUrl] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[1] as [string];
    expect(secondUrl).toBe(`https://api.github.com/repos/owner/repo/pulls/42/files?per_page=${MAX_CHANGED_FILES}`);
  });

  it("si el primer GET falla, devuelve undefined SIN intentar el segundo GET", async () => {
    const { logEvent } = makeLogEvent();
    const fetchFn: FetchFn = vi.fn().mockResolvedValueOnce(errorResponse(404, "not found"));

    const board = createBoardAdapter({ logEvent, config: makeConfig(), fetchFn });

    const metadatos = await board.leerMetadatos({ proyectoId: PROYECTO_ID, referenciaExterna: REF, casoId: CASO_ID });

    expect(metadatos).toBeUndefined();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("si el primer GET OK pero el segundo falla, devuelve metadatos con archivosCambiados: []", async () => {
    const { logEvent } = makeLogEvent();
    const fetchFn: FetchFn = vi
      .fn()
      .mockResolvedValueOnce(okResponse({ title: "t", body: "b", user: { login: "octocat" } }))
      .mockResolvedValueOnce(errorResponse(500, "boom"));

    const board = createBoardAdapter({ logEvent, config: makeConfig(), fetchFn });

    const metadatos = await board.leerMetadatos({ proyectoId: PROYECTO_ID, referenciaExterna: REF, casoId: CASO_ID });

    expect(metadatos).toEqual({
      titulo: "t",
      cuerpo: "b",
      autor: "octocat",
      archivosCambiados: [],
      archivosTruncados: false,
    });
  });

  it("archivosTruncados es true cuando files.length >= MAX_CHANGED_FILES", async () => {
    const { logEvent } = makeLogEvent();
    const archivos = Array.from({ length: MAX_CHANGED_FILES }, (_, i) => ({ filename: `f${i}.ts` }));
    const fetchFn: FetchFn = vi
      .fn()
      .mockResolvedValueOnce(okResponse({ title: "t", body: "b", user: { login: "octocat" } }))
      .mockResolvedValueOnce(okResponse(archivos));

    const board = createBoardAdapter({ logEvent, config: makeConfig(), fetchFn });

    const metadatos = await board.leerMetadatos({ proyectoId: PROYECTO_ID, referenciaExterna: REF, casoId: CASO_ID });

    expect(metadatos?.archivosTruncados).toBe(true);
  });

  it("archivosTruncados es false cuando files.length < MAX_CHANGED_FILES", async () => {
    const { logEvent } = makeLogEvent();
    const archivos = [{ filename: "a.ts" }, { filename: "b.ts" }];
    const fetchFn: FetchFn = vi
      .fn()
      .mockResolvedValueOnce(okResponse({ title: "t", body: "b", user: { login: "octocat" } }))
      .mockResolvedValueOnce(okResponse(archivos));

    const board = createBoardAdapter({ logEvent, config: makeConfig(), fetchFn });

    const metadatos = await board.leerMetadatos({ proyectoId: PROYECTO_ID, referenciaExterna: REF, casoId: CASO_ID });

    expect(metadatos?.archivosTruncados).toBe(false);
  });
});
