import { describe, expect, it, vi } from "vitest";
import { CHAT_CLIENT_JS } from "./chat-client.js";

/**
 * `chat-web-empleado`, tarea 7 (ADR 191 pto 2, ADR 192, ADR 193, ADR 194,
 * ADR 200, ADR 204) -- cliente vanilla sin bundler ni dependencias nuevas.
 *
 * Dos familias de test, ninguna usa `fs` ni jsdom:
 *   1. Mecánico, sobre el STRING FUENTE de `CHAT_CLIENT_JS` (punto
 *      obligatorio 4/R2): sobrevive a cualquier refactor del asset.
 *   2. Funcional/negativo, ejecutando `CHAT_CLIENT_JS` vía `new Function`
 *      contra un doble de DOM escrito a mano (punto obligatorio 5, XSS; ADR
 *      191 pto 2 prohíbe jsdom incluso como devDependency).
 */

const IDENTIFICADORES_PROHIBIDOS = [
  "innerHTML",
  "outerHTML",
  "insertAdjacentHTML",
  "document.write",
  "eval",
  "new Function",
  "srcdoc",
  ".style",
  "cssText",
  "setAttribute",
];

describe("CHAT_CLIENT_JS -- ausencia mecánica de sumideros de HTML (punto obligatorio 4, R2)", () => {
  it.each(IDENTIFICADORES_PROHIBIDOS)("no contiene el identificador prohibido: %s", (identificador) => {
    expect(CHAT_CLIENT_JS).not.toContain(identificador);
  });

  it("sólo toca el entorno por identificadores libres document/fetch/setInterval/clearInterval (ADR 200 pto 3)", () => {
    expect(CHAT_CLIENT_JS).not.toContain("window.");
    expect(CHAT_CLIENT_JS).not.toContain("globalThis");
  });
});

/**
 * Doble de DOM escrito a mano -- sin jsdom (ADR 191 pto 2, que prohíbe
 * dependencias nuevas incluso en `devDependencies`).
 */
interface ElementoFake {
  value: string;
  disabled: boolean;
  hidden: boolean;
  className: string;
  textContent: string;
  children: ElementoFake[];
  addEventListener(tipo: string, manejador: (evento: unknown) => void): void;
  disparar(tipo: string, evento?: unknown): void;
  appendChild(hijo: ElementoFake): ElementoFake;
}

function crearElementoFake(inicial: Partial<ElementoFake> = {}): ElementoFake {
  const listeners: Record<string, Array<(evento: unknown) => void>> = {};
  return {
    value: "",
    disabled: false,
    hidden: false,
    className: "",
    textContent: "",
    children: [],
    ...inicial,
    addEventListener(tipo, manejador) {
      listeners[tipo] = listeners[tipo] ?? [];
      listeners[tipo]!.push(manejador);
    },
    disparar(tipo, evento = { preventDefault(): void {} }) {
      for (const manejador of listeners[tipo] ?? []) {
        manejador(evento);
      }
    },
    appendChild(hijo) {
      this.children.push(hijo);
      return hijo;
    },
  };
}

function crearElementosPorId(): Record<string, ElementoFake> {
  return {
    "login-view": crearElementoFake(),
    "chat-view": crearElementoFake({ hidden: true }),
    "empleado-id-input": crearElementoFake(),
    "password-input": crearElementoFake(),
    "login-boton": crearElementoFake(),
    "login-error": crearElementoFake(),
    mensajes: crearElementoFake(),
    "mensaje-textarea": crearElementoFake(),
    "enviar-boton": crearElementoFake(),
    "logout-boton": crearElementoFake(),
    "estado-mensaje": crearElementoFake(),
  };
}

function crearDocumentoFake(elementosPorId: Record<string, ElementoFake>): {
  elementosCreados: string[];
  getElementById(id: string): ElementoFake | undefined;
  createElement(tag: string): ElementoFake;
  createTextNode(texto: string): { textContent: string };
} {
  const elementosCreados: string[] = [];
  return {
    elementosCreados,
    getElementById: (id) => elementosPorId[id],
    createElement: (tag) => {
      elementosCreados.push(tag);
      return crearElementoFake();
    },
    createTextNode: (texto) => ({ textContent: texto }),
  };
}

function respuestaJson(status: number, cuerpo: unknown): { ok: boolean; status: number; json: () => Promise<unknown> } {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(cuerpo),
  };
}

/**
 * `respuesta.ok` en `true` (ej. `200`) pero `json()` rechaza -- body JSON
 * malformado con status "exitoso" (proxy raro, gateway a medio cortar,
 * hallazgo Reviewer #2). El bug original dejaba este rechazo sin capturar.
 */
function respuestaJsonMalformado(status: number): { ok: boolean; status: number; json: () => Promise<unknown> } {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.reject(new Error("cuerpo JSON malformado")),
  };
}

/**
 * Doble determinista de `Date` (ADR 228 pto 2): un constructor que devuelve
 * un objeto explícito sobreescribe el `this` de `new`, así que `new Date()`
 * dentro del cliente entrega siempre esta hora fija -- cero reloj real en la
 * suite.
 */
function crearDateFake(hora: number, minuto: number): unknown {
  return function FakeDate(): { getHours(): number; getMinutes(): number } {
    return { getHours: () => hora, getMinutes: () => minuto };
  };
}

function montarCliente(
  fetchDouble: (...args: unknown[]) => unknown,
  dateDouble: unknown = crearDateFake(0, 0),
): {
  elementos: Record<string, ElementoFake>;
  documento: ReturnType<typeof crearDocumentoFake>;
} {
  const elementos = crearElementosPorId();
  const documento = crearDocumentoFake(elementos);
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- exactamente lo que ADR 200 pto 3 exige testear
  const fn = new Function("document", "fetch", "setInterval", "clearInterval", "Date", CHAT_CLIENT_JS) as (
    documento: unknown,
    fetch: unknown,
    setInterval: unknown,
    clearInterval: unknown,
    DateDouble: unknown,
  ) => void;
  fn(documento, fetchDouble, vi.fn(), vi.fn(), dateDouble);
  return { elementos, documento };
}

/** Avanza N ticks de microtask queue -- suficiente para cadenas de `.then` sin timers reales. */
async function tick(n = 6): Promise<void> {
  for (let i = 0; i < n; i += 1) {
    await Promise.resolve();
  }
}

async function loguear(elementos: Record<string, ElementoFake>): Promise<void> {
  elementos["empleado-id-input"]!.value = "emp-1";
  elementos["password-input"]!.value = "pass";
  elementos["login-boton"]!.disparar("click");
  await tick();
}

describe("CHAT_CLIENT_JS -- estructura del turno: tres nodos, clave cerrada de autor, hora vía Date (ADR 227, ADR 228)", () => {
  it("tras un envío exitoso, cada turno tiene 3 hijos con className turno-hora/turno-autor/turno-texto en ese orden", async () => {
    const fetchDouble = vi
      .fn()
      .mockResolvedValueOnce(respuestaJson(200, { token: "tok-1" }))
      .mockResolvedValueOnce(respuestaJson(200, { casoId: "c1", respuesta: "todo listo" }));
    const { elementos } = montarCliente(fetchDouble);
    await loguear(elementos);

    elementos["mensaje-textarea"]!.value = "hola";
    elementos["enviar-boton"]!.disparar("click");
    await tick();

    expect(elementos.mensajes!.children).toHaveLength(2);

    const turnoEmpleado = elementos.mensajes!.children[0]!;
    const turnoArnes = elementos.mensajes!.children[1]!;
    expect(turnoEmpleado.className).toBe("turno turno-empleado");
    expect(turnoArnes.className).toBe("turno turno-arnes");

    for (const turno of [turnoEmpleado, turnoArnes]) {
      expect(turno.children).toHaveLength(3);
      expect(turno.children[0]!.className).toBe("turno-hora");
      expect(turno.children[1]!.className).toBe("turno-autor");
      expect(turno.children[2]!.className).toBe("turno-texto");
    }
  });

  it("el autor está en TEXTO, no sólo en color (ADR 222 pto 5)", async () => {
    const fetchDouble = vi
      .fn()
      .mockResolvedValueOnce(respuestaJson(200, { token: "tok-1" }))
      .mockResolvedValueOnce(respuestaJson(200, { casoId: "c1", respuesta: "todo listo" }));
    const { elementos } = montarCliente(fetchDouble);
    await loguear(elementos);

    elementos["mensaje-textarea"]!.value = "hola";
    elementos["enviar-boton"]!.disparar("click");
    await tick();

    expect(elementos.mensajes!.children[0]!.children[1]!.textContent).toBe("Vos");
    expect(elementos.mensajes!.children[1]!.children[1]!.textContent).toBe("Arnés");
  });

  it("la hora tiene el formato exacto HH:MM -- el caso de un dígito prueba dosDigitos", async () => {
    const fetchDouble = vi
      .fn()
      .mockResolvedValueOnce(respuestaJson(200, { token: "tok-1" }))
      .mockResolvedValueOnce(respuestaJson(200, { casoId: "c1", respuesta: "todo listo" }));
    const { elementos } = montarCliente(fetchDouble, crearDateFake(9, 5));
    await loguear(elementos);

    elementos["mensaje-textarea"]!.value = "hola";
    elementos["enviar-boton"]!.disparar("click");
    await tick();

    expect(elementos.mensajes!.children[0]!.children[0]!.textContent).toBe("09:05");
  });

  it("ningún string dinámico del mensaje llega a className (ADR 227 pto 1)", async () => {
    const fetchDouble = vi
      .fn()
      .mockResolvedValueOnce(respuestaJson(200, { token: "tok-1" }))
      .mockResolvedValueOnce(respuestaJson(200, { casoId: "c1", respuesta: "turno-empleado" }));
    const { elementos } = montarCliente(fetchDouble);
    await loguear(elementos);

    elementos["mensaje-textarea"]!.value = "arnes";
    elementos["enviar-boton"]!.disparar("click");
    await tick();

    expect(elementos.mensajes!.children[0]!.className).toBe("turno turno-empleado");
    expect(elementos.mensajes!.children[1]!.className).toBe("turno turno-arnes");
  });
});

describe("CHAT_CLIENT_JS -- XSS en negativo, reapuntado a la estructura de tres nodos (punto obligatorio 5, R2, R9)", () => {
  it("una respuesta con <script> y <img onerror> cae en el tercer nodo (turno-texto) como texto verbatim, cero elementos ejecutables", async () => {
    const fetchDouble = vi
      .fn()
      .mockResolvedValueOnce(respuestaJson(200, { token: "tok-1" }))
      .mockResolvedValueOnce(
        respuestaJson(200, {
          casoId: "c1",
          respuesta: '<script>alert(1)</script><img onerror="alert(2)">',
        }),
      );
    const { elementos, documento } = montarCliente(fetchDouble);
    await loguear(elementos);

    elementos["mensaje-textarea"]!.value = "hola";
    elementos["enviar-boton"]!.disparar("click");
    await tick();

    expect(documento.elementosCreados).not.toContain("script");
    expect(documento.elementosCreados).not.toContain("img");

    const ultimoTurno = elementos.mensajes!.children[elementos.mensajes!.children.length - 1]!;
    expect(ultimoTurno.children).toHaveLength(3);
    expect(ultimoTurno.children[2]!.textContent).toContain("<script>alert(1)</script>");
    expect(ultimoTurno.children[2]!.textContent).toContain('<img onerror="alert(2)">');
  });

  it("sólo se crean div y span -- ningún elemento HTML adicional (nuevo, en positivo)", async () => {
    const fetchDouble = vi
      .fn()
      .mockResolvedValueOnce(respuestaJson(200, { token: "tok-1" }))
      .mockResolvedValueOnce(
        respuestaJson(200, {
          casoId: "c1",
          respuesta: '<script>alert(1)</script><img onerror="alert(2)">',
        }),
      );
    const { elementos, documento } = montarCliente(fetchDouble);
    await loguear(elementos);

    elementos["mensaje-textarea"]!.value = "hola";
    elementos["enviar-boton"]!.disparar("click");
    await tick();

    expect(new Set(documento.elementosCreados)).toEqual(new Set(["div", "span"]));
  });
});

describe("CHAT_CLIENT_JS -- el token nunca se filtra en un error de red (punto obligatorio 7, ADR 193)", () => {
  it("un error de red no muestra el token ni lo pasa a console.*", async () => {
    const consoleSpies = (["log", "error", "warn", "info", "debug"] as const).map((metodo) =>
      vi.spyOn(console, metodo).mockImplementation(() => undefined),
    );
    try {
      const fetchDouble = vi
        .fn()
        .mockResolvedValueOnce(respuestaJson(200, { token: "token-secreto-de-prueba" }))
        .mockRejectedValueOnce(new Error("network down"));
      const { elementos } = montarCliente(fetchDouble);
      await loguear(elementos);

      elementos["mensaje-textarea"]!.value = "hola";
      elementos["enviar-boton"]!.disparar("click");
      await tick();

      expect(elementos["estado-mensaje"]!.textContent).not.toContain("token-secreto-de-prueba");
      for (const spy of consoleSpies) {
        expect(spy).not.toHaveBeenCalled();
      }
    } finally {
      for (const spy of consoleSpies) {
        spy.mockRestore();
      }
    }
  });
});

describe("CHAT_CLIENT_JS -- estado de espera explícito (ADR 194)", () => {
  it("el envío se deshabilita mientras el turno está en curso y no dispara un segundo fetch", async () => {
    let resolverOperaciones!: (valor: unknown) => void;
    const promesaOperaciones = new Promise((resolve) => {
      resolverOperaciones = resolve;
    });
    const fetchDouble = vi
      .fn()
      .mockResolvedValueOnce(respuestaJson(200, { token: "tok-1" }))
      .mockReturnValueOnce(promesaOperaciones);
    const { elementos } = montarCliente(fetchDouble);
    await loguear(elementos);

    elementos["mensaje-textarea"]!.value = "hola";
    elementos["enviar-boton"]!.disparar("click");
    await tick();

    expect(elementos["enviar-boton"]!.disabled).toBe(true);

    elementos["enviar-boton"]!.disparar("click");
    await tick();
    expect(fetchDouble).toHaveBeenCalledTimes(2);

    resolverOperaciones(respuestaJson(200, { casoId: "c1", respuesta: "listo" }));
    await tick();

    expect(elementos["enviar-boton"]!.disabled).toBe(false);
  });
});

describe("CHAT_CLIENT_JS -- tabla de errores (ADR 204), sin leer body.error", () => {
  it.each([
    [400, "El mensaje no pudo procesarse. Revisá el texto e intentá de nuevo."],
    [502, "El arnés no pudo completar la operación. Probá de nuevo en un momento."],
    [
      504,
      "La operación tardó demasiado y no se completó. No sabemos si llegó a aplicarse — verificá antes de reintentar.",
    ],
  ])("código %i produce el texto literal exacto de ADR 204", async (status, textoEsperado) => {
    const jsonSpy = vi.fn();
    const fetchDouble = vi
      .fn()
      .mockResolvedValueOnce(respuestaJson(200, { token: "tok-1" }))
      .mockResolvedValueOnce({ ok: false, status, json: jsonSpy });
    const { elementos } = montarCliente(fetchDouble);
    await loguear(elementos);

    elementos["mensaje-textarea"]!.value = "hola";
    elementos["enviar-boton"]!.disparar("click");
    await tick();

    expect(elementos["estado-mensaje"]!.textContent).toBe(textoEsperado);
    expect(jsonSpy).not.toHaveBeenCalled();
  });

  it("un error de red (fetch rechaza) produce 'No hubo respuesta del servidor.'", async () => {
    const fetchDouble = vi
      .fn()
      .mockResolvedValueOnce(respuestaJson(200, { token: "tok-1" }))
      .mockRejectedValueOnce(new Error("down"));
    const { elementos } = montarCliente(fetchDouble);
    await loguear(elementos);

    elementos["mensaje-textarea"]!.value = "hola";
    elementos["enviar-boton"]!.disparar("click");
    await tick();

    expect(elementos["estado-mensaje"]!.textContent).toBe("No hubo respuesta del servidor.");
  });

  it("401 conserva el texto escrito, vuelve a login y NO reenvía solo tras un nuevo login", async () => {
    const fetchDouble = vi
      .fn()
      .mockResolvedValueOnce(respuestaJson(200, { token: "tok-1" }))
      .mockResolvedValueOnce({ ok: false, status: 401, json: vi.fn() })
      .mockResolvedValueOnce(respuestaJson(200, { token: "tok-2" }));
    const { elementos } = montarCliente(fetchDouble);
    await loguear(elementos);

    elementos["mensaje-textarea"]!.value = "mensaje importante";
    elementos["enviar-boton"]!.disparar("click");
    await tick();

    expect(elementos["chat-view"]!.hidden).toBe(true);
    expect(elementos["login-view"]!.hidden).toBe(false);

    elementos["login-boton"]!.disparar("click");
    await tick();

    expect(elementos["mensaje-textarea"]!.value).toBe("mensaje importante");
    expect(fetchDouble).toHaveBeenCalledTimes(3);
  });
});

describe("CHAT_CLIENT_JS -- rechazo no capturado de respuesta.json() (hallazgo Reviewer #2, ALTO)", () => {
  it("manejarEnvio: body JSON malformado con status 200 no deja enVuelo trabado -- pasa a estado de error", async () => {
    const fetchDouble = vi
      .fn()
      .mockResolvedValueOnce(respuestaJson(200, { token: "tok-1" }))
      .mockResolvedValueOnce(respuestaJsonMalformado(200));
    const { elementos } = montarCliente(fetchDouble);
    await loguear(elementos);

    elementos["mensaje-textarea"]!.value = "hola";
    elementos["enviar-boton"]!.disparar("click");
    await tick();

    expect(elementos["estado-mensaje"]!.textContent).toBe("No hubo respuesta del servidor.");
    expect(elementos["enviar-boton"]!.disabled).toBe(false);
    expect(elementos["mensaje-textarea"]!.disabled).toBe(false);
  });

  it("manejarLogin: body JSON malformado con status 200 muestra el error de red, sin quedar colgado", async () => {
    const fetchDouble = vi.fn().mockResolvedValueOnce(respuestaJsonMalformado(200));
    const { elementos } = montarCliente(fetchDouble);

    elementos["empleado-id-input"]!.value = "emp-1";
    elementos["password-input"]!.value = "pass";
    elementos["login-boton"]!.disparar("click");
    await tick();

    expect(elementos["login-error"]!.textContent).toBe("No hubo respuesta del servidor.");
    expect(elementos["chat-view"]!.hidden).toBe(true);
  });
});

describe("CHAT_CLIENT_JS -- forma inesperada del body de /operaciones (hallazgo Reviewer 2da ronda #2)", () => {
  it.each([
    ["objeto vacío", {}],
    ["null", null],
  ])(
    "manejarEnvio: body %s (sin .respuesta string) no escribe ningún turno y conserva el texto para reintentar",
    async (_label, cuerpo) => {
      const fetchDouble = vi
        .fn()
        .mockResolvedValueOnce(respuestaJson(200, { token: "tok-1" }))
        .mockResolvedValueOnce(respuestaJson(200, cuerpo));
      const { elementos } = montarCliente(fetchDouble);
      await loguear(elementos);

      elementos["mensaje-textarea"]!.value = "hola";
      elementos["enviar-boton"]!.disparar("click");
      await tick();

      expect(elementos.mensajes!.children).toHaveLength(0);
      expect(elementos["mensaje-textarea"]!.value).toBe("hola");
      expect(elementos["estado-mensaje"]!.textContent).toBe("No hubo respuesta del servidor.");
      expect(elementos["enviar-boton"]!.disabled).toBe(false);
    },
  );
});

describe("CHAT_CLIENT_JS -- logout", () => {
  it("llama POST /logout con el token Bearer y vuelve a la vista de login", async () => {
    const fetchDouble = vi
      .fn()
      .mockResolvedValueOnce(respuestaJson(200, { token: "tok-1" }))
      .mockResolvedValueOnce(respuestaJson(204, undefined));
    const { elementos } = montarCliente(fetchDouble);
    await loguear(elementos);

    elementos["logout-boton"]!.disparar("click");
    await tick();

    const [ultimaRuta, ultimasOpciones] = (fetchDouble as ReturnType<typeof vi.fn>).mock.calls[1] as [
      string,
      { method?: string; headers?: Record<string, string> },
    ];
    expect(ultimaRuta).toBe("/logout");
    expect(ultimasOpciones.method).toBe("POST");
    expect(elementos["chat-view"]!.hidden).toBe(true);
    expect(elementos["login-view"]!.hidden).toBe(false);
  });
});
