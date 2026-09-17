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

/**
 * `ergonomia-canal-empleado`, tarea 3 (RD-105 resuelta en `design.md` §6):
 * las ocho reglas nuevas de turno/autor/hora, agregadas al final de
 * `CHAT_CSS` -- las cinco reglas vigentes (arriba) no se editan.
 */
describe("CHAT_CSS -- reglas de turno-empleado/turno-arnes/turno-hora/turno-autor (RD-105)", () => {
  it("define .turno con borde izquierdo, margen inferior y padding izquierdo", () => {
    expect(CHAT_CSS).toContain(".turno {\n  border-left: 3px solid transparent;\n  margin-bottom: 8px;\n  padding-left: 8px;\n}");
  });

  it("define .turno-hora con color, tabular-nums y margen derecho", () => {
    expect(CHAT_CSS).toContain(
      ".turno-hora {\n  color: #616161;\n  font-variant-numeric: tabular-nums;\n  margin-right: 8px;\n}",
    );
  });

  it("define .turno-autor en negrita con margen derecho", () => {
    expect(CHAT_CSS).toContain(".turno-autor {\n  font-weight: 600;\n  margin-right: 8px;\n}");
  });

  it("define .turno-texto como bloque", () => {
    expect(CHAT_CSS).toContain(".turno-texto {\n  display: block;\n}");
  });

  it("define el color de borde y de autor para .turno-empleado", () => {
    expect(CHAT_CSS).toContain(".turno-empleado { border-left-color: #1b5e20; }");
    expect(CHAT_CSS).toContain(".turno-empleado .turno-autor { color: #1b5e20; }");
  });

  it("define el color de borde y de autor para .turno-arnes", () => {
    expect(CHAT_CSS).toContain(".turno-arnes { border-left-color: #0d47a1; }");
    expect(CHAT_CSS).toContain(".turno-arnes .turno-autor { color: #0d47a1; }");
  });

  it("no asigna ningún color por atributo style inline -- el color entra por clase (ADR 222 pto 3)", () => {
    expect(CHAT_CSS).not.toMatch(/\sstyle\s*=/i);
  });
});
