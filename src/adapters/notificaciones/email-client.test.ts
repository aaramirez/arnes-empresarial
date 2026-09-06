import { describe, expect, it, vi } from "vitest";
import type { NotificacionesConfig } from "./config.js";
import { EmailApiError, type FetchFn, enviarEmail } from "./email-client.js";

const API_KEY = "re_super-secreto-123";

function makeConfig(overrides: Partial<NotificacionesConfig> = {}): NotificacionesConfig {
  return {
    apiKey: API_KEY,
    from: "arnes@localhost",
    apiUrl: "https://api.resend.com/emails",
    requestTimeoutMs: 10_000,
    ...overrides,
  };
}

function makeMensaje(overrides: Partial<{ to: string; subject: string; html: string }> = {}) {
  return {
    to: "destinatario@example.com",
    subject: "Asunto",
    html: "<p>hola</p>",
    ...overrides,
  };
}

function okResponse() {
  return {
    ok: true,
    status: 200,
    text: () => Promise.resolve("{}"),
  };
}

function errorResponse(status: number, bodyText: string) {
  return {
    ok: false,
    status,
    text: () => Promise.resolve(bodyText),
  };
}

describe("enviarEmail", () => {
  it("sends the exact URL, method, headers and body", async () => {
    const fetchFn: FetchFn = vi.fn().mockResolvedValue(okResponse());

    await enviarEmail({
      mensaje: makeMensaje(),
      config: makeConfig(),
      fetchFn,
    });

    expect(fetchFn).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "arnes@localhost",
          to: "destinatario@example.com",
          subject: "Asunto",
          html: "<p>hola</p>",
        }),
      }),
    );
  });

  it("passes an AbortSignal built from config.requestTimeoutMs as init.signal", async () => {
    const fetchFn: FetchFn = vi.fn().mockResolvedValue(okResponse());

    await enviarEmail({
      mensaje: makeMensaje(),
      config: makeConfig({ requestTimeoutMs: 5_000 }),
      fetchFn,
    });

    const [, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { signal?: AbortSignal },
    ];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("resolves with void on success and does not parse the response body", async () => {
    const fetchFn: FetchFn = vi.fn().mockResolvedValue(okResponse());

    const result = await enviarEmail({
      mensaje: makeMensaje(),
      config: makeConfig(),
      fetchFn,
    });

    expect(result).toBeUndefined();
  });

  it("never leaks the API key into the EmailApiError message on !response.ok", async () => {
    const fetchFn: FetchFn = vi
      .fn()
      .mockResolvedValue(errorResponse(422, '{"message":"Invalid `to` field"}'));

    await expect(
      enviarEmail({
        mensaje: makeMensaje(),
        config: makeConfig(),
        fetchFn,
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(EmailApiError);
      const apiError = error as EmailApiError;
      expect(apiError.message).not.toContain(API_KEY);
      return true;
    });
  });

  it("throws EmailApiError with reason 'http' and the exact status on !response.ok", async () => {
    const fetchFn: FetchFn = vi.fn().mockResolvedValue(errorResponse(422, '{"message":"Invalid"}'));

    await expect(
      enviarEmail({
        mensaje: makeMensaje(),
        config: makeConfig(),
        fetchFn,
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(EmailApiError);
      const apiError = error as EmailApiError;
      expect(apiError.reason).toBe("http");
      expect(apiError.status).toBe(422);
      return true;
    });
  });

  it("truncates a long provider error body in the message", async () => {
    const longBody = "x".repeat(1000);
    const fetchFn: FetchFn = vi.fn().mockResolvedValue(errorResponse(500, longBody));

    await expect(
      enviarEmail({
        mensaje: makeMensaje(),
        config: makeConfig(),
        fetchFn,
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(EmailApiError);
      const apiError = error as EmailApiError;
      expect(apiError.message.length).toBeLessThan(longBody.length);
      return true;
    });
  });

  it("classifies an abort by AbortSignal.timeout() as reason 'timeout' and never leaks the API key", async () => {
    const timeoutError = new Error("The operation was aborted due to timeout");
    timeoutError.name = "TimeoutError";
    const fetchFn: FetchFn = vi.fn().mockRejectedValue(timeoutError);

    await expect(
      enviarEmail({
        mensaje: makeMensaje(),
        config: makeConfig(),
        fetchFn,
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(EmailApiError);
      const apiError = error as EmailApiError;
      expect(apiError.reason).toBe("timeout");
      expect(apiError.message).not.toContain(API_KEY);
      return true;
    });
  });

  it("classifies a generic network throw as reason 'network' and never leaks the API key", async () => {
    const networkError = new Error("fetch failed");
    networkError.name = "TypeError";
    const fetchFn: FetchFn = vi.fn().mockRejectedValue(networkError);

    await expect(
      enviarEmail({
        mensaje: makeMensaje(),
        config: makeConfig(),
        fetchFn,
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(EmailApiError);
      const apiError = error as EmailApiError;
      expect(apiError.reason).toBe("network");
      expect(apiError.message).not.toContain(API_KEY);
      return true;
    });
  });
});
