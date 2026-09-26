import { describe, expect, it } from "vitest";
import { extraerTokensComando, tokensComandoInexistentes } from "./comandos-en-texto.js";

describe("extraerTokensComando", () => {
  it.each([
    "src/core/agents",
    "./activity-contract.js",
    "../commands",
    "https://example.com/aprobar",
    "y/o",
    "`Write`/`Edit`",
    "~/datos",
    "año/mes",
  ])("no confunde %j con un comando (rutas, URLs y alternativas)", (texto) => {
    expect(extraerTokensComando(texto)).toEqual([]);
  });

  it("reconoce completo un comando vigente con dígitos", () => {
    expect(extraerTokensComando("usá /ver-solicitudes-a2a para verlas")).toEqual(["/ver-solicitudes-a2a"]);
  });

  it.each([
    ["(/login)", "/login"],
    ["«/ayuda»", "/ayuda"],
    ["\n/soporte", "/soporte"],
  ])("reconoce el comando en %j", (texto, token) => {
    expect(extraerTokensComando(texto)).toEqual([token]);
  });

  it("dos llamadas seguidas sobre el mismo texto dan el mismo resultado (sin estado de la bandera g)", () => {
    const texto = "usá /login y después /ayuda";
    expect(extraerTokensComando(texto)).toEqual(["/login", "/ayuda"]);
    expect(extraerTokensComando(texto)).toEqual(["/login", "/ayuda"]);
  });
});

describe("tokensComandoInexistentes", () => {
  it("devuelve sólo los tokens que no están en el conjunto de nombres válidos", () => {
    expect(tokensComandoInexistentes("usá /aprobar-solicitud o /login", new Set(["/login"]))).toEqual([
      "/aprobar-solicitud",
    ]);
  });
});
