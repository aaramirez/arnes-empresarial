import { describe, expect, it } from "vitest";
import { CHAT_CSS, renderChatHtml } from "./chat-page.js";

/**
 * `chat-web-empleado`, tarea 8 (ADR 191 pto 1, ADR 200 pto 5) -- página
 * 100% estática. Sin `fs`: aserciones sobre el string devuelto.
 */
describe("renderChatHtml", () => {
  it("no contiene ningún <script> inline", () => {
    expect(renderChatHtml()).not.toMatch(/<script(?!\s+src=)/i);
  });

  it("no contiene ningún <style> inline ni atributos style=", () => {
    const html = renderChatHtml();
    expect(html).not.toMatch(/<style/i);
    expect(html).not.toMatch(/\sstyle\s*=/i);
  });

  it("referencia literalmente /chat/app.js con defer", () => {
    expect(renderChatHtml()).toMatch(/<script[^>]*src="\/chat\/app\.js"[^>]*defer/i);
  });

  it("referencia literalmente /chat/app.css por <link rel=stylesheet>", () => {
    expect(renderChatHtml()).toMatch(/<link[^>]*rel="stylesheet"[^>]*href="\/chat\/app\.css"/i);
  });

  it("es determinista -- dos invocaciones producen el mismo resultado (sin Date.now()/Math.random())", () => {
    expect(renderChatHtml()).toBe(renderChatHtml());
  });

  it("las dos secciones (login/chat) existen, conmutadas con el atributo hidden", () => {
    const html = renderChatHtml();
    expect(html).toContain('id="login-view"');
    expect(html).toContain('id="chat-view"');
    expect(html).toMatch(/id="chat-view"[^>]*hidden/);
  });
});

describe("CHAT_CSS", () => {
  it("preserva saltos de línea del texto plano con white-space: pre-wrap", () => {
    expect(CHAT_CSS).toContain("white-space: pre-wrap");
  });

  it("es un string no vacío", () => {
    expect(typeof CHAT_CSS).toBe("string");
    expect(CHAT_CSS.length).toBeGreaterThan(0);
  });
});
