import { describe, expect, it, vi } from "vitest";
import type { BoardConfig } from "./config.js";
import {
  GithubApiError,
  type FetchFn,
  type FetchResponseLike,
  githubRequest,
  splitProyectoId,
} from "./github-client.js";

const TOKEN = "ghp_super-secreto-123";

function makeConfig(overrides: Partial<BoardConfig> = {}): BoardConfig {
  return {
    token: TOKEN,
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

describe("githubRequest", () => {
  it("sends the exact URL, method and fixed headers for a GET without body", async () => {
    const fetchFn: FetchFn = vi.fn().mockResolvedValue(okResponse({ id: 1 }));

    await githubRequest({
      method: "GET",
      path: "/repos/owner/repo/issues/1",
      config: makeConfig(),
      fetchFn,
    });

    expect(fetchFn).toHaveBeenCalledWith(
      "https://api.github.com/repos/owner/repo/issues/1",
      expect.objectContaining({
        method: "GET",
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "arnes-empresarial",
        },
      }),
    );
  });

  it("sends the exact URL, method, headers and body for a PATCH with body", async () => {
    const fetchFn: FetchFn = vi.fn().mockResolvedValue(okResponse({ id: 1 }));

    await githubRequest({
      method: "PATCH",
      path: "/repos/owner/repo/issues/1",
      body: { labels: ["aprobado"] },
      config: makeConfig(),
      fetchFn,
    });

    expect(fetchFn).toHaveBeenCalledWith(
      "https://api.github.com/repos/owner/repo/issues/1",
      expect.objectContaining({
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "arnes-empresarial",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ labels: ["aprobado"] }),
      }),
    );
  });

  it("omits Content-Type when there is no body", async () => {
    const fetchFn: FetchFn = vi.fn().mockResolvedValue(okResponse({}));

    await githubRequest({
      method: "GET",
      path: "/repos/owner/repo",
      config: makeConfig(),
      fetchFn,
    });

    const [, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { headers: Record<string, string> },
    ];
    expect(init.headers).not.toHaveProperty("Content-Type");
  });

  it("includes Content-Type: application/json when there is a body", async () => {
    const fetchFn: FetchFn = vi.fn().mockResolvedValue(okResponse({}));

    await githubRequest({
      method: "POST",
      path: "/repos/owner/repo/issues/1/comments",
      body: { body: "hola" },
      config: makeConfig(),
      fetchFn,
    });

    const [, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { headers: Record<string, string> },
    ];
    expect(init.headers["Content-Type"]).toBe("application/json");
  });

  it("never leaks the token into the GithubApiError message on !response.ok", async () => {
    const fetchFn: FetchFn = vi
      .fn()
      .mockResolvedValue(errorResponse(404, '{"message":"Not Found","documentation_url":"https://docs.github.com"}'));

    await expect(
      githubRequest({
        method: "GET",
        path: "/repos/owner/repo/issues/999",
        config: makeConfig(),
        fetchFn,
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(GithubApiError);
      const apiError = error as GithubApiError;
      expect(apiError.message).not.toContain(TOKEN);
      return true;
    });
  });

  it("throws GithubApiError with reason 'http' and the exact status on !response.ok", async () => {
    const fetchFn: FetchFn = vi.fn().mockResolvedValue(errorResponse(404, '{"message":"Not Found"}'));

    await expect(
      githubRequest({
        method: "GET",
        path: "/repos/owner/repo/issues/999",
        config: makeConfig(),
        fetchFn,
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(GithubApiError);
      const apiError = error as GithubApiError;
      expect(apiError.reason).toBe("http");
      expect(apiError.status).toBe(404);
      return true;
    });
  });

  it("classifies an abort by AbortSignal.timeout() as reason 'timeout'", async () => {
    const timeoutError = new Error("The operation was aborted due to timeout");
    timeoutError.name = "TimeoutError";
    const fetchFn: FetchFn = vi.fn().mockRejectedValue(timeoutError);

    await expect(
      githubRequest({
        method: "GET",
        path: "/repos/owner/repo",
        config: makeConfig(),
        fetchFn,
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(GithubApiError);
      expect((error as GithubApiError).reason).toBe("timeout");
      return true;
    });
  });

  it("classifies a generic network throw as reason 'network'", async () => {
    const networkError = new Error("fetch failed");
    networkError.name = "TypeError";
    const fetchFn: FetchFn = vi.fn().mockRejectedValue(networkError);

    await expect(
      githubRequest({
        method: "GET",
        path: "/repos/owner/repo",
        config: makeConfig(),
        fetchFn,
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(GithubApiError);
      expect((error as GithubApiError).reason).toBe("network");
      return true;
    });
  });

  it("passes an AbortSignal built from config.requestTimeoutMs as init.signal", async () => {
    const fetchFn: FetchFn = vi.fn().mockResolvedValue(okResponse({}));

    await githubRequest({
      method: "GET",
      path: "/repos/owner/repo",
      config: makeConfig({ requestTimeoutMs: 5_000 }),
      fetchFn,
    });

    const [, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { signal?: AbortSignal },
    ];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("resolves with the parsed JSON body on success", async () => {
    const fetchFn: FetchFn = vi.fn().mockResolvedValue(okResponse({ id: 42, title: "hola" }));

    const result = await githubRequest({
      method: "GET",
      path: "/repos/owner/repo/issues/1",
      config: makeConfig(),
      fetchFn,
    });

    expect(result).toEqual({ id: 42, title: "hola" });
  });
});

describe("splitProyectoId", () => {
  it("splits a valid 'owner/repo' into { owner, repo }", () => {
    expect(splitProyectoId("owner/repo")).toEqual({ owner: "owner", repo: "repo" });
  });

  it("throws GithubApiError('parse') when there is no slash", () => {
    expect(() => splitProyectoId("soloowner")).toThrowError(GithubApiError);
    try {
      splitProyectoId("soloowner");
    } catch (error) {
      expect((error as GithubApiError).reason).toBe("parse");
    }
  });

  it("throws GithubApiError('parse') when there is more than one slash", () => {
    expect(() => splitProyectoId("owner/repo/extra")).toThrowError(GithubApiError);
    try {
      splitProyectoId("owner/repo/extra");
    } catch (error) {
      expect((error as GithubApiError).reason).toBe("parse");
    }
  });

  it("throws GithubApiError('parse') when owner or repo is empty ('owner/', '/repo', 'owner//repo', '')", () => {
    for (const invalid of ["owner/", "/repo", "owner//repo", ""]) {
      expect(() => splitProyectoId(invalid)).toThrowError(GithubApiError);
      try {
        splitProyectoId(invalid);
      } catch (error) {
        expect((error as GithubApiError).reason).toBe("parse");
      }
    }
  });
});
