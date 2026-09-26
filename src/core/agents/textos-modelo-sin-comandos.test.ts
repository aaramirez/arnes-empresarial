import { describe, expect, it } from "vitest";
import { tokensComandoInexistentes } from "../../test/comandos-en-texto.js";
import { COMANDOS } from "../commands/comando-empleado.js";
import { buildOperacionesEmpleadoPrompt, buildSoportePrompt } from "../ventas/soporte-prompt.js";
import { buildSolicitudA2APrompt } from "./a2a-entrante-prompt.js";
import {
  construirAgenteEmpleadoOperaciones,
  construirDeveloperConEscritura,
  listAgentDefinitions,
  listSubagentDefinitions,
  type AgentDefinition,
} from "./definitions.js";
import type { WorktreeAbierto } from "./worktree-contract.js";

/**
 * Guarda anti-deriva (ADR 303, v3.22, generaliza la guarda del ADR 302):
 * ningún texto fijo que el núcleo le entrega al modelo nombra un comando de la
 * TUI que no esté en `COMANDOS`. Quien baje un comando y lo deje nombrado en
 * un prompt ve esta guarda en rojo en el mismo PR. Ante un falso positivo se
 * reformula el texto, no se afloja el patrón (`src/test/comandos-en-texto.ts`).
 *
 * Fuera de la guarda (Deuda 14): skills, descripciones de tools de
 * `src/adapters/*` y `buildActivityPrompt`. La instrucción de delegación al
 * validador se verifica en `crear-solicitud-interna.test.ts`.
 */

const WORKTREE_FALSO: WorktreeAbierto = {
  casoId: "caso-guarda",
  ruta: "/ruta/falsa",
  rama: "harness/caso-guarda",
  baseCommit: "0".repeat(40),
};

interface FuenteDeTexto {
  readonly id: string;
  readonly textos: readonly { readonly id: string; readonly texto: string }[];
}

function fuenteDeAgente(id: string, agente: AgentDefinition): FuenteDeTexto {
  return {
    id,
    textos: [
      { id: `${id}:description`, texto: agente.description },
      { id: `${id}:systemPrompt`, texto: agente.systemPrompt },
    ],
  };
}

function inventario(): FuenteDeTexto[] {
  return [
    ...listAgentDefinitions().map((a) => fuenteDeAgente(a.id, a)),
    ...listSubagentDefinitions().map((a) => fuenteDeAgente(a.id, a)),
    fuenteDeAgente("empleado-operaciones", construirAgenteEmpleadoOperaciones()),
    fuenteDeAgente("developer-con-escritura", construirDeveloperConEscritura(WORKTREE_FALSO).agent),
    { id: "soporte", textos: [{ id: "soporte", texto: buildSoportePrompt("consulta de prueba") }] },
    {
      id: "operaciones-empleado",
      textos: [{ id: "operaciones-empleado", texto: buildOperacionesEmpleadoPrompt("consulta de prueba") }],
    },
    { id: "a2a-entrante", textos: [{ id: "a2a-entrante", texto: buildSolicitudA2APrompt("texto de prueba") }] },
  ];
}

describe("textos de agente del núcleo sin comandos inexistentes (ADR 303)", () => {
  it("el inventario no es vacío: diez fuentes con id distinto y diecisiete textos no vacíos", () => {
    const fuentes = inventario();
    const textos = fuentes.flatMap((f) => f.textos);

    expect(fuentes).toHaveLength(10);
    expect(new Set(fuentes.map((f) => f.id)).size).toBe(10);
    expect(textos).toHaveLength(17);
    for (const { id, texto } of textos) {
      expect({ id, vacio: texto.trim() === "" }).toEqual({ id, vacio: false });
    }
  });

  it("ningún texto de agente del núcleo nombra un comando que no existe", () => {
    const nombresValidos = new Set(COMANDOS.map((c) => c.nombre));

    for (const { id, texto } of inventario().flatMap((f) => f.textos)) {
      expect({ id, inexistentes: tokensComandoInexistentes(texto, nombresValidos) }).toEqual({
        id,
        inexistentes: [],
      });
    }
  });
});
