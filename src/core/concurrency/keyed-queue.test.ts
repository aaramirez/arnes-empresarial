import { describe, expect, it } from "vitest";
import { createKeyedQueue } from "./keyed-queue.js";

/**
 * Spec `activity-webhook-turn`:
 * - "Dos eventos casi simultáneos del mismo proyecto" (orden + no piso de
 *   estado — cubierto acá a nivel de cola pura, sin I/O real).
 * - "La cola no filtra memoria" (garantía 4, R6).
 *
 * Todas las pruebas usan promesas controladas ("deferred") para forzar el
 * interleaving exacto que las garantías de `KeyedQueue` (design.md §3.3)
 * describen, sin depender de temporizadores reales.
 */

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("KeyedQueue — garantía 1: orden por clave", () => {
  it("no empieza la segunda tarea de una clave hasta que la primera se asienta", async () => {
    const queue = createKeyedQueue();
    const order: string[] = [];
    const first = createDeferred<void>();

    const resultA = queue.run("proyecto-1", async () => {
      order.push("a-start");
      await first.promise;
      order.push("a-end");
    });

    const resultB = queue.run("proyecto-1", async () => {
      order.push("b-start");
    });

    // "a" arrancó, "b" todavía no — sigue esperando a que "a" se asiente.
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(["a-start"]);

    first.resolve();
    await resultA;
    await resultB;

    expect(order).toEqual(["a-start", "a-end", "b-start"]);
  });
});

describe("KeyedQueue — garantía 2: aislamiento por clave", () => {
  it("run(k1, ...) nunca espera a run(k2, ...)", async () => {
    const queue = createKeyedQueue();
    const order: string[] = [];
    const blockedOnKey1 = createDeferred<void>();

    const resultKey1 = queue.run("proyecto-1", async () => {
      order.push("k1-start");
      await blockedOnKey1.promise;
      order.push("k1-end");
    });

    const resultKey2 = queue.run("proyecto-2", async () => {
      order.push("k2-start");
      order.push("k2-end");
    });

    // proyecto-2 corre y termina sin que proyecto-1 se haya asentado.
    await resultKey2;
    expect(order).toEqual(["k1-start", "k2-start", "k2-end"]);

    blockedOnKey1.resolve();
    await resultKey1;
    expect(order).toEqual(["k1-start", "k2-start", "k2-end", "k1-end"]);
  });
});

describe("KeyedQueue — garantía 3: un rechazo no contagia", () => {
  it("si 'a' rechaza, 'b' corre igual, y el rechazo solo llega al caller de 'a'", async () => {
    const queue = createKeyedQueue();
    const order: string[] = [];

    const resultA = queue.run<void>("proyecto-1", async () => {
      order.push("a");
      throw new Error("falla de a");
    });
    const resultB = queue.run("proyecto-1", async () => {
      order.push("b");
    });

    await expect(resultA).rejects.toThrow("falla de a");
    await expect(resultB).resolves.toBeUndefined();
    expect(order).toEqual(["a", "b"]);
  });

  it("no produce un unhandledRejection — la cadena interna nunca queda con una promesa rechazada sin capturar", async () => {
    const queue = createKeyedQueue();

    // Si `run` internamente encadenara con `.then` (sin manejar el rechazo)
    // en vez de `.then(noop, noop)`, este `catch` no alcanzaría a atajarlo
    // antes de que el runtime marque un unhandledRejection. Ejecutamos varias
    // tareas encadenadas, alguna rechazando, para ejercitar la cadena.
    const resultA = queue.run<void>("proyecto-1", async () => {
      throw new Error("falla de a");
    });
    const resultB = queue.run<number>("proyecto-1", async () => 42);
    const resultC = queue.run<void>("proyecto-1", async () => {
      throw new Error("falla de c");
    });

    await expect(resultA).rejects.toThrow("falla de a");
    await expect(resultB).resolves.toBe(42);
    await expect(resultC).rejects.toThrow("falla de c");
  });
});

describe("KeyedQueue — garantía 4: sin fuga de memoria (R6)", () => {
  it("size vuelve a 0 tras asentarse todo", async () => {
    const queue = createKeyedQueue();

    expect(queue.size).toBe(0);

    await queue.run("proyecto-1", async () => "ok-1");
    expect(queue.size).toBe(0);

    await Promise.all([
      queue.run("proyecto-1", async () => "a"),
      queue.run("proyecto-2", async () => "b"),
      queue.run("proyecto-1", async () => {
        throw new Error("falla");
      }).catch(() => undefined),
    ]);

    expect(queue.size).toBe(0);
  });

  it("caso borde: encolar una tarea nueva mientras la anterior está terminando no rompe el orden (chequeo de identidad, R6)", async () => {
    const queue = createKeyedQueue();
    const order: string[] = [];
    const releaseFirst = createDeferred<void>();

    // "first" arranca y queda pendiente en `releaseFirst`.
    const firstResult = queue.run("proyecto-1", async () => {
      order.push("first-start");
      await releaseFirst.promise;
      order.push("first-end");
    });

    // Dejamos que "first" arranque de verdad.
    await Promise.resolve();
    await Promise.resolve();

    // Liberamos "first" — su promesa empieza a asentarse ahora mismo — y
    // SIN esperar a que termine de asentarse, encolamos "second" en la misma
    // clave. Si el borrado de la entrada del mapa no fuera por identidad,
    // "second" podría arrancar en paralelo con el tramo final de "first".
    releaseFirst.resolve();
    const secondResult = queue.run("proyecto-1", async () => {
      order.push("second-start");
    });

    await firstResult;
    await secondResult;

    expect(order).toEqual(["first-start", "first-end", "second-start"]);
    expect(queue.size).toBe(0);
  });
});
