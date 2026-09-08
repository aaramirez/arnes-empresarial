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
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import {
  DEVELOPER_AGENT_ID,
  PLANNER_AGENT_ID,
  REVIEWER_AGENT_ID,
  construirDeveloperConEscritura,
} from "../agents/definitions.js";
import {
  TAREA_DELEGADA_MAX_CHARS,
  construirTareaDelegada,
  type InsumoDelegado,
} from "../agents/subagents.js";
import type { WorktreeAbierto, WorktreePort } from "../agents/worktree-contract.js";
import {
  crearPropuestaCambio,
  type CrearPropuestaResult,
} from "../propuestas/crear-propuesta-cambio.js";
import { PATCH_MAX_BYTES, type PropuestaStorePort } from "../propuestas/propuestas-contract.js";
import {
  despacharCadena,
  despacharDelegacion,
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
 * Dependencias de la escritura delegada del eslabón Developer (Hito 5.1,
 * tarea 30, design.md §5.8). Parámetro OPCIONAL de `despacharRevisionPorRoles`
 * — interruptor en `off` cuando está ausente (composition root, ADR 54):
 * ningún campo de acá se toca y el Developer es, byte por byte, el de
 * `v2.0.0`.
 *
 * `worktree`/`propuestas` son los puertos reales (`src/adapters/git/`,
 * `src/adapters/memory/`); `testRunnerMcpServers` cierra sobre el worktree ya
 * abierto para producir `Options["mcpServers"]` (tipo del SDK, mismo
 * precedente de import de tipo que `subagents.ts`/`turn-selector/
 * invoke-model.ts`). `newId`/`now`/`logEvent` son un juego PROPIO, separado
 * de `deps.newId`/`deps.now`/`deps.logEvent` (`DespacharDelegacionDeps`): en
 * producción el composition root cierra ambos juegos sobre las mismas
 * funciones (design.md §7.3), pero son puertos conceptualmente distintos —
 * éste fabrica los ids de worktree/propuesta, el otro sigue fabricando los
 * ids de `delegaciones`/`sesiones_agente` (ver el doc-comment de
 * `ejecutarDeveloperConEscritura` para por qué esa distinción importa).
 */
export interface EscrituraDelegadaDeps {
  readonly worktree: WorktreePort;
  readonly propuestas: PropuestaStorePort;
  readonly testRunnerMcpServers: (worktree: WorktreeAbierto) => Options["mcpServers"];
  readonly newId: () => string;
  readonly now: () => string;
  readonly logEvent: (
    casoId: string,
    event: string,
    fields?: Readonly<Record<string, unknown>>,
  ) => void;
}

/** Resultado del eslabón Developer en modo escritura: lo único que el Reviewer necesita. */
interface ResultadoDeveloperEscritura {
  readonly sesionSubagenteId: string;
  readonly material: string;
}

/**
 * Arma el `material` del Reviewer a partir del desenlace de
 * `crearPropuestaCambio` (ADR 70, cuatro desenlaces — el cuarto, que el store
 * tire, propaga antes de llegar acá porque `crearPropuestaCambio` no lo
 * atrapa).
 *
 * `"creada"`: el material es el patch **leído de vuelta de la base**
 * (`escritura.propuestas.obtenerPropuesta`), nunca `r.propuesta.patch` (el
 * objeto que `crearPropuestaCambio` ya tiene en memoria) — es exactamente la
 * garantía de ADR 59 pto 2 y del requirement "El Reviewer juzga el patch
 * persistido, nunca el worktree vivo": una variable en memoria no sirve como
 * evidencia de que la fila realmente se escribió. Si `patchBytes` excede
 * `TAREA_DELEGADA_MAX_CHARS` (tope en CARACTERES del Reviewer, no el tope en
 * BYTES del patch — la comparación es una heurística conservadora, no una
 * equivalencia, RD-15) se emite `propuesta-revision-parcial` y se deja que
 * `construirTareaDelegada` trunque con su invariante ya vigente de
 * `v2.0.0` — nada acá trunca el texto a mano.
 *
 * `"sin_cambios"` / `"rechazada_por_tamano"`: no hay fila que leer (ADR 70:
 * cero filas en ambos casos), así que el material NO es un patch — es el
 * texto en prosa que ya produjo el Developer más una línea explícita de por
 * qué no hay diff. El ciclo de revisión no se bloquea: el Reviewer sigue
 * emitiendo su única línea VEREDICTO sobre esa vista.
 */
function materialParaReviewer(
  resultado: CrearPropuestaResult,
  textoDeveloper: string,
  escritura: EscrituraDelegadaDeps,
  casoId: string,
): string {
  if (resultado.resultado === "sin_cambios") {
    return `${textoDeveloper}\n\n(Sin cambios: el Developer no generó ningún diff en el worktree.)`;
  }

  if (resultado.resultado === "rechazada_por_tamano") {
    return (
      `${textoDeveloper}\n\n` +
      `(Patch descartado: ${resultado.patchBytes} bytes supera el tope de ${PATCH_MAX_BYTES} bytes — no se persistió ninguna propuesta.)`
    );
  }

  const propuestaId = resultado.propuesta.id;
  const propuestaLeida = escritura.propuestas.obtenerPropuesta(propuestaId);
  if (propuestaLeida === undefined) {
    throw new Error(
      `cadena-revision: obtenerPropuesta("${propuestaId}") devolvió undefined justo después de crearla`,
    );
  }

  if (propuestaLeida.patchBytes > TAREA_DELEGADA_MAX_CHARS) {
    escritura.logEvent(casoId, "propuesta-revision-parcial", {
      propuestaId,
      patchBytes: propuestaLeida.patchBytes,
      topeTarea: TAREA_DELEGADA_MAX_CHARS,
    });
  }

  return propuestaLeida.patch;
}

/**
 * El eslabón Developer completo en modo escritura (design.md §4.1, pasos
 * a-e). No pasa por `despacharDelegacion` — necesita inyectarle `cwd` y
 * `mcpServers` a `deps.invocar`, campos que `despacharDelegacion` no
 * propaga — así que replica a mano sus mismos pasos a/c/e (crear la fila de
 * `delegaciones` ANTES de invocar, completarla DESPUÉS) usando `deps.store`/
 * `deps.newId`/`deps.now`/`deps.logEvent` (el MISMO `DespacharDelegacionDeps`
 * que usan Planner y Reviewer): así el `sesionSubagenteId` de este paso sigue
 * disponible como `sesionPadreId` del Reviewer, y la cadena de auditoría
 * completa (tres filas de `delegaciones`, spec `revision-pr-por-roles`) no se
 * rompe aunque el Developer haya ganado un camino de invocación distinto.
 *
 * `worktree.abrir`/`capturarDiff` PROPAGAN si fallan (contrato de
 * `WorktreePort`): el `try/finally` sólo envuelve el trabajo POSTERIOR a
 * `abrir` para garantizar `cerrar` incluso en ese caso — `cerrar` en sí NUNCA
 * rechaza (mismo contrato), así que un error de `capturarDiff` sale de esta
 * función tal cual, después de que el worktree ya se cerró.
 */
async function ejecutarDeveloperConEscritura(
  casoId: string,
  insumo: InsumoDelegado,
  sesionPadreId: string,
  deps: DespacharDelegacionDeps,
  escritura: EscrituraDelegadaDeps,
): Promise<ResultadoDeveloperEscritura> {
  const wt = await escritura.worktree.abrir({ casoId, id: escritura.newId() });

  try {
    const { agent, cwd } = construirDeveloperConEscritura(wt);
    const tareaDelegada = construirTareaDelegada(agent, insumo);
    const delegacionId = deps.newId();
    const createdAt = deps.now();

    deps.store.crearDelegacion({
      id: delegacionId,
      casoId,
      agentId: DEVELOPER_AGENT_ID,
      sesionPadreId,
      tareaDelegada,
      createdAt,
    });
    deps.logEvent(casoId, "delegacion-iniciada", {
      agentId: DEVELOPER_AGENT_ID,
      delegacionId,
      tareaChars: tareaDelegada.length,
    });

    const invocacion = await deps.invocar({
      agent,
      casoId,
      tareaDelegada,
      cwd,
      mcpServers: escritura.testRunnerMcpServers(wt),
    });

    const sesionSubagenteId = deps.newId();
    deps.store.completarDelegacion({
      delegacionId,
      sesion: {
        id: sesionSubagenteId,
        casoId,
        agentId: DEVELOPER_AGENT_ID,
        sdkSessionId: invocacion.sdkSessionId,
        createdAt: deps.now(),
      },
      resultado: invocacion.responseText,
    });
    deps.logEvent(casoId, "delegacion-completada", {
      agentId: DEVELOPER_AGENT_ID,
      delegacionId,
      sdkSessionId: invocacion.sdkSessionId,
      resultadoChars: invocacion.responseText.length,
      ...(invocacion.parentToolUseId !== undefined
        ? { parentToolUseId: invocacion.parentToolUseId }
        : {}),
    });

    const patch = await escritura.worktree.capturarDiff(wt);

    const resultado = crearPropuestaCambio(
      {
        casoId,
        delegacionId,
        baseCommit: wt.baseCommit,
        ramaWorktree: wt.rama,
        patch,
      },
      {
        store: escritura.propuestas,
        newId: escritura.newId,
        now: escritura.now,
        logEvent: escritura.logEvent,
      },
    );

    return {
      sesionSubagenteId,
      material: materialParaReviewer(resultado, invocacion.responseText, escritura, casoId),
    };
  } finally {
    await escritura.worktree.cerrar(wt);
  }
}

/**
 * Corre la cadena determinista Planner → Developer → Reviewer y adapta el
 * resultado al mismo `ActivityTurnOutcome` que devolvía el `runTurn` único de
 * `v1.4.0` — el paso 5 de `runActivityTurn` (tarea 12) inyecta esta función
 * SIN que los pasos 6-9 (`parseVeredicto` → `transicionarEstado` → ...)
 * cambien de forma (design.md §5.5).
 *
 * `escritura` AUSENTE (parámetro opcional, `undefined`): comportamiento
 * **idéntico, byte por byte, al de `v2.0.0`** — corre `despacharCadena` sobre
 * los tres eslabones tal cual, sin abrir worktree ni crear fila en
 * `propuestas_cambio` (design.md §5.8, spec `revision-pr-por-roles`,
 * escenario "Con la escritura delegada apagada, el eslabón se comporta como
 * en v2.0.0").
 *
 * `escritura` PRESENTE (Hito 5.1, tarea 30, design.md §4.1): el eslabón
 * Developer se reemplaza por `ejecutarDeveloperConEscritura` — abre worktree,
 * invoca con `cwd`/`mcpServers`, captura el diff, persiste (o no) la
 * propuesta, y cierra el worktree — **antes** de que se arme el eslabón del
 * Reviewer. El worktree ya no existe cuando el Reviewer opina: es el orden
 * (`cerrar` en el `finally` de un bloque que termina antes de invocar al
 * Reviewer), no una promesa. Planner y Reviewer siguen pasando por
 * `despacharDelegacion` sin cambios — sólo el paso intermedio cambia de
 * forma.
 *
 * En ambos caminos: toma el ÚLTIMO eslabón (Reviewer) y descarta los
 * anteriores — `responseText` es su `resultado`, `agentLabel` es
 * `REVIEWER_AGENT_ID`, siempre uno solo. No captura: si un eslabón (o
 * `worktree.abrir`/`capturarDiff`) falla, el error propaga tal cual.
 */
export async function despacharRevisionPorRoles(
  casoId: string,
  prompt: string,
  deps: DespacharDelegacionDeps,
  escritura?: EscrituraDelegadaDeps,
): Promise<ActivityTurnOutcome> {
  const eslabones = construirEslabonesRevision(prompt);

  if (escritura === undefined) {
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

  const [eslabonPlanner, eslabonDeveloper, eslabonReviewer] = eslabones as readonly [
    Eslabon,
    Eslabon,
    Eslabon,
  ];

  const planner = await despacharDelegacion(
    { casoId, agentId: eslabonPlanner.agentId, insumo: eslabonPlanner.insumo },
    deps,
  );

  const developer = await ejecutarDeveloperConEscritura(
    casoId,
    { instruccion: eslabonDeveloper.insumo.instruccion, material: planner.resultado },
    planner.sesionSubagenteId,
    deps,
    escritura,
  );

  const reviewer = await despacharDelegacion(
    {
      casoId,
      agentId: eslabonReviewer.agentId,
      insumo: { instruccion: eslabonReviewer.insumo.instruccion, material: developer.material },
      sesionPadreId: developer.sesionSubagenteId,
    },
    deps,
  );

  return {
    responseText: reviewer.resultado,
    agentLabel: REVIEWER_AGENT_ID,
  };
}
