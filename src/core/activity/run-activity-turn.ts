/**
 * Orquestador del ciclo de un turno disparado por un evento externo
 * (Hito 3, tarea 5) — el componente más importante de la Unidad 1
 * (design.md §3.2).
 *
 * Envuelve `handleTurn` SIN importarlo ni modificarlo: recibe un `runTurn`
 * inyectado (`RunActivityTurnDeps.runTurn`), que el composition root cierra
 * sobre `handleTurn(casoId, prompt, deps)` más `createKnowledgeAdapter({
 * casoId })` (fix de R1). Es "el punto clave del hito" tal como lo describe
 * el diseño: el ciclo de actividad envuelve al Selector de Turno de Hito 1,
 * no lo invade.
 *
 * Imports permitidos: únicamente los otros módulos de `src/core/activity/`
 * (mismo dominio) — regla no negociable de `AGENTS.md`: `src/core/` nunca
 * importa de `src/adapters/*`, ni del SDK, ni de Node. Este archivo NO
 * importa `handle-turn.ts` (es lo que envuelve, sin conocerlo) ni
 * `keyed-queue.ts` (esa cola la usa el composition root, no este
 * orquestador).
 *
 * Contrato de propagación (design.md §3.2): PROPAGA cualquier error del
 * `store` (contrato: falla ruidosamente) y de `runTurn` (`TurnFailedError`
 * de `handleTurn`, entre otros). NUNCA propaga un error del `board`
 * (contrato: nunca rechaza) — ni siquiera si un adaptador con un bug, o un
 * doble de test deliberadamente mal comportado, rompe esa promesa: es
 * responsabilidad del `board`, pero este orquestador se mantiene robusto
 * igual, porque el estado canónico ya se persistió antes de tocar el
 * tablero.
 */
import {
  ESTADO_PENDIENTE_REVISION,
  type Actividad,
  type ActividadEstado,
  type ActivityBoardPort,
  type ActivityStorePort,
  type IncomingActivityEvent,
  type PullRequestMetadata,
  type Veredicto,
} from "./activity-contract.js";
import { buildActivityPrompt } from "./activity-prompt.js";
import { parseVeredicto, transicionarEstado } from "./transicion-estado.js";

/**
 * Valor idéntico a `CASO_ESTADO_ACTIVO` de `handle-turn.ts`. Duplicado a
 * propósito, no un descuido: este orquestador no importa `handle-turn.ts`
 * (ver module doc de arriba), y `casos.estado` es un TEXT abierto en el
 * esquema — `repository.ts` documenta explícitamente que el conjunto de
 * estados válidos es asunto del núcleo, no de un enum de columna. Duplicar
 * el literal es la opción que respeta el desacoplamiento que el diseño pide;
 * importar el módulo envuelto para ahorrarse una constante lo rompería.
 */
const CASO_ESTADO_ACTIVO = "activo";

/**
 * Resultado del turno tal como `handleTurn` lo devuelve (`HandleTurnResult`).
 * Declarado acá, estructuralmente idéntico, por la misma razón que
 * `handle-turn.ts` declara el suyo en vez de importar `TuiTurnResult`:
 * mantener el módulo desacoplado de quién se lo inyecta.
 */
export interface ActivityTurnOutcome {
  readonly responseText: string;
  readonly agentLabel: string;
}

export interface RunActivityTurnDeps {
  readonly store: ActivityStorePort;
  readonly board: ActivityBoardPort;
  /**
   * EL punto clave del hito. El composition root inyecta acá un closure que
   * (a) construye el Adaptador de Conocimiento PARA ESTE `casoId` — fix de
   * R1, spec `knowledge-query` — y (b) llama `handleTurn(casoId, prompt,
   * deps)`. `handle-turn.ts` NO se modifica ni recibe dependencias nuevas.
   */
  readonly runTurn: (casoId: string, prompt: string) => Promise<ActivityTurnOutcome>;
  /** `randomUUID` en producción; contador determinista en tests. */
  readonly newId: () => string;
  /** `() => new Date().toISOString()` en producción. */
  readonly now: () => string;
  /** Ya cerrado sobre `LogTurnEventDeps`; el núcleo no decide el destino del log. */
  readonly logEvent: (
    casoId: string,
    event: string,
    fields?: Readonly<Record<string, unknown>>,
  ) => void;
}

export interface RunActivityTurnResult {
  readonly actividadId: string;
  readonly casoId: string;
  readonly estadoAnterior: ActividadEstado;
  readonly estado: ActividadEstado;
  readonly veredicto: Veredicto;
  readonly responseText: string;
  /** `true` si esta invocación creó `caso`+`actividad`; `false` si reusó una existente. */
  readonly actividadCreada: boolean;
}

/**
 * `board.leerMetadatos` nunca debería lanzar (contrato de `ActivityBoardPort`),
 * pero esta envoltura lo blinda igual: un `board` mal comportado no puede
 * tirar abajo el turno completo por una operación puramente informativa que
 * ya degrada a `undefined` en su camino feliz.
 */
async function leerMetadatosSeguro(
  board: ActivityBoardPort,
  input: { proyectoId: string; referenciaExterna: string; casoId: string },
): Promise<PullRequestMetadata | undefined> {
  try {
    return await board.leerMetadatos(input);
  } catch {
    return undefined;
  }
}

/**
 * `board.publicarRevision`/`board.mirrorEstado` nunca deberían lanzar
 * (mismo contrato). Se ejecutan tras persistir el estado canónico (paso 7),
 * así que aunque un `board` viole su contrato, no hay nada que revertir: el
 * turno ya es válido, el tablero es cosmético.
 */
async function ejecutarEfectoDeTableroSeguro(operacion: () => Promise<void>): Promise<void> {
  try {
    await operacion();
  } catch {
    // Deliberadamente silencioso: el contrato de `ActivityBoardPort` es
    // "nunca rechaza, nunca lanza". Si un `board` real o un doble de test lo
    // viola, es un bug de esa implementación — el orquestador no debe
    // propagar ni loguear acá encima del logging que el propio adaptador ya
    // hace puertas adentro.
  }
}

/**
 * Ciclo completo de un turno disparado por un evento externo. Ver el module
 * doc de arriba para el contrato de propagación.
 *
 * Secuencia exacta (design.md §3.2):
 *  1. `store.findActividadPorReferencia`.
 *  2a. Si NO existe → `store.createCasoConActividad` (una transacción) →
 *      `actividad-creada`.
 *  2b. Si existe → se REUSA, incluido su `casoId` → `actividad-reusada`.
 *  3. `board.leerMetadatos` — nunca lanza; `undefined` degrada.
 *  4. `buildActivityPrompt`.
 *  5. `runTurn(actividad.casoId, prompt)` — propaga si falla, sin llamar a
 *     nada más después.
 *  6. `parseVeredicto` → `transicionarEstado`.
 *  7. `store.updateActividadEstado` — SIEMPRE, aunque el estado no cambie.
 *     Propaga si falla.
 *  8. `board.publicarRevision`.
 *  9. `board.mirrorEstado`.
 *
 * 7 ANTES de 8-9, sin excepción: el estado canónico se persiste primero, el
 * espejo va después.
 */
export async function runActivityTurn(
  evento: IncomingActivityEvent,
  deps: RunActivityTurnDeps,
): Promise<RunActivityTurnResult> {
  const { store, board, runTurn, newId, now, logEvent } = deps;

  const actividadExistente = store.findActividadPorReferencia({
    proyectoId: evento.proyectoId,
    referenciaExterna: evento.referenciaExterna,
  });

  let actividad: Actividad;
  let actividadCreada: boolean;

  if (actividadExistente === undefined) {
    const timestamp = now();
    const casoId = newId();
    const actividadId = newId();

    actividad = store.createCasoConActividad({
      proyecto: {
        id: evento.proyectoId,
        nombre: evento.proyectoNombre,
        repoUrl: evento.repoUrl,
      },
      ...(evento.responsableId !== undefined
        ? { responsable: { id: evento.responsableId } }
        : {}),
      caso: {
        id: casoId,
        tipo: evento.tipo,
        estado: CASO_ESTADO_ACTIVO,
      },
      actividad: {
        id: actividadId,
        tipo: evento.tipo,
        referenciaExterna: evento.referenciaExterna,
        estado: ESTADO_PENDIENTE_REVISION,
      },
      timestamp,
    });
    actividadCreada = true;

    logEvent(actividad.casoId, "actividad-creada", {
      proyectoId: evento.proyectoId,
      referenciaExterna: evento.referenciaExterna,
      actividadId: actividad.id,
      deliveryId: evento.deliveryId,
    });
  } else {
    actividad = actividadExistente;
    actividadCreada = false;

    logEvent(actividad.casoId, "actividad-reusada", {
      proyectoId: evento.proyectoId,
      referenciaExterna: evento.referenciaExterna,
      actividadId: actividad.id,
      deliveryId: evento.deliveryId,
    });
  }

  const estadoAnterior = actividad.estado;

  const metadatos = await leerMetadatosSeguro(board, {
    proyectoId: evento.proyectoId,
    referenciaExterna: evento.referenciaExterna,
    casoId: actividad.casoId,
  });

  const prompt = buildActivityPrompt(actividad, {
    ...(metadatos !== undefined ? { metadatos } : {}),
    ...(evento.comentarioDisparador !== undefined
      ? { comentarioDisparador: evento.comentarioDisparador }
      : {}),
    estadoActual: actividad.estado,
    titulo: evento.titulo,
    cuerpo: evento.cuerpo,
  });

  // Propaga sin llamar a nada más después: ni store.updateActividadEstado
  // ni ningún método del board se invocan si esto rechaza.
  const resultado = await runTurn(actividad.casoId, prompt);

  const veredicto = parseVeredicto(resultado.responseText);
  const estado = transicionarEstado(actividad.estado, veredicto);

  // Paso 7: SIEMPRE, aunque `estado === estadoAnterior` — deja traza de que
  // hubo un turno. Propaga si falla (contrato del store).
  const actividadActualizada = store.updateActividadEstado({
    actividadId: actividad.id,
    estado,
    ...(actividad.responsableId !== undefined
      ? { responsableId: actividad.responsableId }
      : {}),
    updatedAt: now(),
  });

  // Pasos 8-9: SIEMPRE después de 7, nunca antes. El board nunca propaga.
  await ejecutarEfectoDeTableroSeguro(() =>
    board.publicarRevision({
      proyectoId: evento.proyectoId,
      referenciaExterna: evento.referenciaExterna,
      texto: resultado.responseText,
      casoId: actividad.casoId,
    }),
  );

  await ejecutarEfectoDeTableroSeguro(() =>
    board.mirrorEstado({
      proyectoId: evento.proyectoId,
      referenciaExterna: evento.referenciaExterna,
      estado,
      ...(actividadActualizada.responsableId !== undefined
        ? { responsableId: actividadActualizada.responsableId }
        : {}),
      casoId: actividad.casoId,
    }),
  );

  return {
    actividadId: actividad.id,
    casoId: actividad.casoId,
    estadoAnterior,
    estado,
    veredicto,
    responseText: resultado.responseText,
    actividadCreada,
  };
}
