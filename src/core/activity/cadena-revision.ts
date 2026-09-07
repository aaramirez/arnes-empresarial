/**
 * Cadena de Revisión de PRs por Roles (Hito 5, tarea 11, design.md §5.5).
 *
 * Forma específica del bot de PRs de la cadena determinista genérica de
 * `despacho-delegacion` (`../turn-selector/dispatch-delegation.js`,
 * `despacharCadena`, tarea 8): fija los tres eslabones Planner → Developer →
 * Reviewer y adapta el resultado a `ActivityTurnOutcome`, el mismo tipo que
 * devolvía el `runTurn` único de `v1.4.0` (design.md §5.5: "Devuelve el
 * MISMO `ActivityTurnOutcome` que devolvía `runTurn`").
 *
 * **Que sólo el Reviewer emita `VEREDICTO_PREFIX` se garantiza por
 * construcción, no por prompt** (design.md §5.5): `VEREDICTO_PREFIX` solo
 * aparece en la instrucción del Reviewer, y `despacharRevisionPorRoles`
 * **descarta** las salidas intermedias (Planner, Developer) antes de
 * devolver — solo el `resultado` del último eslabón (Reviewer) llega al
 * `responseText` del outcome. Aunque el Planner alucinara una línea
 * `VEREDICTO:` en su respuesta, ese texto queda contenido en el `resultado`
 * de SU propio eslabón: `despacharCadena` lo usa como `material` del
 * Developer (nunca como veredicto), y el outcome devuelto ni siquiera lo
 * referencia.
 *
 * Nota de alcance declarada (nombres de constantes de rol): el pseudocódigo
 * de design.md §5.5 nombra `ROL_PLANNER`/`ROL_DEVELOPER`/`ROL_REVIEWER`
 * como constantes nuevas de este módulo. Las constantes reales ya existen —
 * `PLANNER_AGENT_ID`/`DEVELOPER_AGENT_ID`/`REVIEWER_AGENT_ID` de
 * `../agents/definitions.js` (tarea 5, ya commiteada) — con el mismo valor
 * (`"planner"`/`"developer"`/`"reviewer"`). Se reusan esas, en vez de
 * declarar un segundo juego de constantes duplicadas apuntando al mismo
 * string; el Reviewer puede objetar si prefería el nombre literal del
 * diseño.
 *
 * Import de `./run-activity-turn.js` (núcleo → núcleo, mismo dominio
 * `src/core/activity/`): solo el tipo `ActivityTurnOutcome`, ya declarado
 * por ese módulo — no crea una dependencia circular porque este archivo no
 * se importa desde `run-activity-turn.ts` (eso lo hace la tarea 12, en la
 * dirección opuesta).
 */
import {
  DEVELOPER_AGENT_ID,
  PLANNER_AGENT_ID,
  REVIEWER_AGENT_ID,
} from "../agents/definitions.js";
import {
  despacharCadena,
  type DelegacionAplicada,
  type DespacharDelegacionDeps,
  type Eslabon,
} from "../turn-selector/dispatch-delegation.js";
import { VEREDICTO_PREFIX, VEREDICTOS } from "./activity-contract.js";
import type { ActivityTurnOutcome } from "./run-activity-turn.js";

/**
 * PURA. Las tres instrucciones de la cadena de revisión, en orden fijo. La
 * instrucción del Reviewer es la ÚNICA que menciona `VEREDICTO_PREFIX` — así
 * el "un solo veredicto" (spec `revision-pr-por-roles`) es estructural, no
 * una esperanza sobre el prompt.
 *
 * `promptActividad` se usa TAL CUAL como `material` del primer eslabón
 * (Planner) — es el mismo prompt sintético que `buildActivityPrompt`
 * (`activity-prompt.ts`) ya arma. El `material` de los dos eslabones
 * siguientes es un placeholder: `despacharCadena` lo IGNORA y lo reemplaza
 * por el `resultado` (texto) del eslabón anterior (contrato de `Eslabon`,
 * documentado en `dispatch-delegation.ts`).
 */
export function construirEslabonesRevision(promptActividad: string): readonly Eslabon[] {
  return [
    {
      agentId: PLANNER_AGENT_ID,
      insumo: {
        instruccion:
          "Analizá el cambio de este PR y producí el plan de revisión: qué revisar, en qué archivos y con qué criterio. No emitas veredicto — esa es tarea exclusiva del Reviewer, más adelante en la cadena.",
        material: promptActividad,
      },
    },
    {
      agentId: DEVELOPER_AGENT_ID,
      insumo: {
        instruccion:
          "Ejecutá el plan de revisión recibido sobre el código: rastreá el impacto de cada ítem del plan (call sites, propagación) y producí hallazgos concretos. No emitas veredicto — esa es tarea exclusiva del Reviewer, más adelante en la cadena.",
        material: "(se reemplaza por el resultado del Planner — despacharCadena)",
      },
    },
    {
      agentId: REVIEWER_AGENT_ID,
      insumo: {
        instruccion:
          `Juzgá los hallazgos recibidos y emití el veredicto final de esta revisión. Terminá tu respuesta con una última línea exactamente con el formato \`${VEREDICTO_PREFIX} <valor>\`, donde <valor> es uno de: ${VEREDICTOS.join(", ")}. No re-investigues el código por tu cuenta.`,
        material: "(se reemplaza por el resultado del Developer — despacharCadena)",
      },
    },
  ];
}

/**
 * Corre la cadena determinista Planner → Developer → Reviewer
 * (`despacharCadena`) y adapta el resultado al mismo `ActivityTurnOutcome`
 * que devolvía el `runTurn` único de `v1.4.0` — el paso 5 de
 * `runActivityTurn` (tarea 12) inyecta esta función SIN que los pasos 6-9
 * (`parseVeredicto` → `transicionarEstado` → ...) cambien de forma
 * (design.md §5.5).
 *
 * Toma el ÚLTIMO eslabón de la cadena (Reviewer) y descarta los dos
 * anteriores: `responseText` es su `resultado`, `agentLabel` es
 * `REVIEWER_AGENT_ID` — nunca el id del Planner ni del Developer, aunque
 * `despacharCadena` fallara y devolviera resultados en otro orden (no puede:
 * `despacharCadena` es un fold secuencial sobre `eslabones`, siempre en el
 * orden que `construirEslabonesRevision` fija).
 *
 * No captura: si un eslabón falla, el error de `despacharCadena` propaga tal
 * cual (mismo contrato que la función que envuelve).
 */
export async function despacharRevisionPorRoles(
  casoId: string,
  prompt: string,
  deps: DespacharDelegacionDeps,
): Promise<ActivityTurnOutcome> {
  const eslabones = construirEslabonesRevision(prompt);

  const resultados = await despacharCadena(eslabones, { casoId }, deps);

  const [, , reviewer] = resultados as readonly [
    DelegacionAplicada,
    DelegacionAplicada,
    DelegacionAplicada,
  ];

  return {
    responseText: reviewer.resultado,
    agentLabel: REVIEWER_AGENT_ID,
  };
}
