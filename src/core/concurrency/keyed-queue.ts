/**
 * Cola de serialización por clave (Hito 3, tarea 2, ADR 8).
 *
 * Lo que serializa este hito es el ciclo lógico `leer actividad → await del
 * modelo → escribir actividad` por `proyecto_id`: `better-sqlite3` es
 * síncrono, así que dos sentencias SQL nunca se interleavan dentro del
 * proceso — el peligro real es el `await` del medio (invocar al modelo o al
 * tablero). Genérico por clave `string`, no por `proyecto_id`: el
 * composition root (`build-on-activity.ts`) es quien elige esa clave.
 *
 * Sin imports — ni de Node, ni del SDK, ni de adaptadores.
 */

export interface KeyedQueue {
  /**
   * Encola `task` bajo `key` y devuelve una promesa con SU resultado.
   *
   * Garantías (cada una con test propio en `keyed-queue.test.ts`):
   * 1. ORDEN: si `run(k, a)` se llama antes que `run(k, b)`, `b` no empieza
   *    hasta que la promesa de `a` se asienta (resuelva o rechace).
   * 2. AISLAMIENTO POR CLAVE: `run(k1, ...)` nunca espera a `run(k2, ...)`.
   * 3. NO CONTAGIO: si `a` rechaza, `b` corre igual. La cadena interna se
   *    construye con `.then(noop, noop)`, así que un rechazo nunca envenena
   *    la cola ni produce un `unhandledRejection`; el rechazo real se
   *    entrega ÚNICAMENTE al caller de `run(k, a)`.
   * 4. SIN FUGA (R6): al asentarse la última tarea de una clave, la entrada
   *    se BORRA del mapa. El borrado es condicional por IDENTIDAD — solo se
   *    borra si la cola actual de esa clave sigue siendo la promesa que
   *    acaba de terminar. Sin ese chequeo, una tarea nueva encolada
   *    mientras la anterior terminaba se borraría del mapa y la siguiente
   *    arrancaría en paralelo, rompiendo la garantía 1.
   */
  run<T>(key: string, task: () => Promise<T>): Promise<T>;

  /** Claves con trabajo en vuelo. Existe para que el test de la garantía 4 pueda afirmar `size === 0`. */
  readonly size: number;
}

export function createKeyedQueue(): KeyedQueue {
  const tails = new Map<string, Promise<void>>();

  return {
    run<T>(key: string, task: () => Promise<T>): Promise<T> {
      const previousTail = tails.get(key) ?? Promise.resolve();

      // El resultado real que el caller recibe: corre `task` recién cuando
      // la cadena previa de esa clave se asentó, sin importar si se asentó
      // resolviendo o rechazando (garantía 1).
      const result = previousTail.then(task, task);

      // La cadena interna del mapa nunca debe rechazar — solo existe para
      // saber CUÁNDO siguió la clave, no CON QUÉ. Cualquier resultado de
      // `result` (éxito o rechazo) se convierte acá en una promesa
      // resuelta, así que un `task` que rechaza no envenena el `tail` de la
      // clave ni produce un `unhandledRejection` (garantía 3): el rechazo
      // real ya viaja por separado en `result`, hacia el caller de `run`.
      //
      // El borrado por IDENTIDAD (garantía 4, R6) vive en el MISMO
      // manejador — no en un `.then` encadenado aparte — para que se
      // ejecute en el mismo tick en que `result` se asienta, antes de que
      // cualquier `await` externo sobre `result` retome el control. Un
      // `.then` adicional encadenado sobre `newTail` corre un tick después,
      // lo que dejaría una ventana donde `size` todavía cuenta una clave ya
      // asentada. Comparar por identidad contra `newTail` (no borrar a
      // ciegas) es lo que evita que una tarea nueva encolada bajo la misma
      // clave, mientras esta se asienta, se pise: si `tails.get(key)` ya
      // apunta a otra entrada, esta hoja no toca el mapa.
      const newTail: Promise<void> = result.then(
        () => {
          if (tails.get(key) === newTail) {
            tails.delete(key);
          }
        },
        () => {
          if (tails.get(key) === newTail) {
            tails.delete(key);
          }
        },
      );
      tails.set(key, newTail);

      return result;
    },

    get size(): number {
      return tails.size;
    },
  };
}
