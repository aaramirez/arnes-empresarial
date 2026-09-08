/**
 * Alta de propuesta de cambio con tope de tamaño y desenlace "sin cambios"
 * (Hito 5.1, tarea 19, design.md §5.6, ADR 58 pto 3, ADR 70).
 *
 * **Síncrono a propósito**: `PropuestaStorePort.crearPropuesta` es síncrono
 * (mismo criterio que `VentaStorePort`/`SolicitudStorePort` — `better-sqlite3`
 * lo es), y esta función no hace ningún I/O propio, sólo orquesta.
 *
 * Orden interno, NO NEGOCIABLE (design.md §5.6): `trim` → `resumirPatch` →
 * **tope** → recién ahí `store.crearPropuesta`. Nunca se persiste primero y
 * se valida después.
 *
 *  1. `input.patch.trim()` — un diff vacío (nada que escribir en el turno)
 *     es un desenlace propio (`"sin_cambios"`, ADR 70), no una propuesta de
 *     cero bytes: sin este paso, `''` satisface `patch TEXT NOT NULL` en
 *     SQLite y persistiría una fila vacía que igual "aplica" sin cambiar
 *     nada — falla silenciosa con la base en verde.
 *  2. `resumirPatch(patchTrim)` (`./resumir-patch.js`, tarea 18) — cuenta
 *     bytes UTF-8 reales y los contadores del patch YA trimeado, para que
 *     el tope se evalúe sobre el mismo texto que se persiste.
 *  3. Tope: `resumen.patchBytes > PATCH_MAX_BYTES` (65 536, `propuestas-
 *     contract.ts`) ⇒ `"rechazada_por_tamano"`. RECHAZO, no truncado (ADR 58
 *     pto 3): un patch de +1000 líneas de diff no es revisable, y truncarlo
 *     produciría un patch inaplicable (`git apply` fallaría a mitad de hunk).
 *  4. Sólo si pasa el tope: `store.crearPropuesta(...)`. Si el store tira,
 *     la función NO atrapa el error — falla ruidosa: sin fila no hay
 *     evidencia (mismo contrato documentado en `PropuestaStorePort`).
 *
 * Los dos rechazos tempranos (`sin_cambios`, `rechazada_por_tamano`) emiten
 * un evento y devuelven sin tocar el store — **cero filas** en ambos casos
 * (design.md §8: `propuesta-sin-cambios` con `rama`; `propuesta-rechazada-
 * por-tamano` con `patchBytes` + `topeBytes`; nunca se loguea el patch).
 *
 * Imports: `./propuestas-contract.js`, `./resumir-patch.js` — núcleo → núcleo
 * (regla de `AGENTS.md`: `src/core/` nunca importa de `src/adapters/*`, ni
 * del SDK, ni de Node).
 */
import { PATCH_MAX_BYTES, type PropuestaCambio, type PropuestaStorePort } from "./propuestas-contract.js";
import { resumirPatch } from "./resumir-patch.js";

export interface CrearPropuestaCambioInput {
  readonly casoId: string;
  readonly delegacionId?: string;
  readonly baseCommit: string;
  readonly ramaWorktree: string;
  readonly patch: string;
}

export interface CrearPropuestaCambioDeps {
  readonly store: PropuestaStorePort;
  readonly newId: () => string;
  readonly now: () => string;
  readonly logEvent: (casoId: string, event: string, fields?: Readonly<Record<string, unknown>>) => void;
}

export type CrearPropuestaResult =
  | { readonly resultado: "creada"; readonly propuesta: PropuestaCambio }
  | { readonly resultado: "sin_cambios" } // ADR 70
  | { readonly resultado: "rechazada_por_tamano"; readonly patchBytes: number }; // ADR 58 pto 3

export function crearPropuestaCambio(
  input: CrearPropuestaCambioInput,
  deps: CrearPropuestaCambioDeps,
): CrearPropuestaResult {
  const patchTrim = input.patch.trim();

  if (patchTrim === "") {
    deps.logEvent(input.casoId, "propuesta-sin-cambios", { rama: input.ramaWorktree });
    return { resultado: "sin_cambios" };
  }

  const resumen = resumirPatch(patchTrim);

  if (resumen.patchBytes > PATCH_MAX_BYTES) {
    deps.logEvent(input.casoId, "propuesta-rechazada-por-tamano", {
      patchBytes: resumen.patchBytes,
      topeBytes: PATCH_MAX_BYTES,
    });
    return { resultado: "rechazada_por_tamano", patchBytes: resumen.patchBytes };
  }

  const propuesta = deps.store.crearPropuesta({
    id: deps.newId(),
    casoId: input.casoId,
    ...(input.delegacionId !== undefined ? { delegacionId: input.delegacionId } : {}),
    baseCommit: input.baseCommit,
    ramaWorktree: input.ramaWorktree,
    patch: patchTrim,
    resumen,
    createdAt: deps.now(),
  });

  deps.logEvent(input.casoId, "propuesta-creada", {
    propuestaId: propuesta.id,
    patchBytes: resumen.patchBytes,
    archivos: resumen.archivos,
    lineasAgregadas: resumen.lineasAgregadas,
    lineasEliminadas: resumen.lineasEliminadas,
  });

  return { resultado: "creada", propuesta };
}
