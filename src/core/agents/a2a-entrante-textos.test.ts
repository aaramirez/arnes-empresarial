/**
 * Suite mudada de `build-on-comando-empleado.test.ts` (visibilidad-a2a-
 * entrante-chat, tarea 1.1, ADR 240 pto 1). Verbatim salvo import, texto del
 * `describe` y un `TIMESTAMP` local — cero aserciones editadas (R3).
 */
import { describe, expect, it } from "vitest";
import { formatearListadoSolicitudesA2A, formatearDetalleSolicitudA2A } from "./a2a-entrante-textos.js";
import {
  LINEAS_PAGINA_A2A,
  type ListadoSolicitudesA2AEntrantes,
  type SolicitudA2AEntranteVistaEmpleado,
} from "./a2a-entrante-contract.js";
import { TASK_STATE_WORKING } from "./a2a-contract.js";

const TIMESTAMP = "2026-01-01T00:00:00.000Z";

describe("a2a-entrante-textos: formatearListadoSolicitudesA2A / formatearDetalleSolicitudA2A (visibilidad-a2a-entrante-chat, tarea 1.1)", () => {
  function makeVistaA2A(overrides: Partial<SolicitudA2AEntranteVistaEmpleado> = {}): SolicitudA2AEntranteVistaEmpleado {
    return {
      a2aTaskId: "task-1",
      estado: { conocido: true, valor: TASK_STATE_WORKING },
      origenTransporte: "https://externo.example.test/rpc",
      mensajeRecibido: "hola, este es el mensaje recibido",
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
      ...overrides,
    };
  }

  it("R1, mitad de texto: ni el listado ni el detalle imprimen 'agente' como rótulo — los dos usan 'origen de transporte'", () => {
    const vista = makeVistaA2A({ resultado: "resultado sin nada raro" });
    const listado: ListadoSolicitudesA2AEntrantes = { items: [vista], hayMas: false };

    const textoListado = formatearListadoSolicitudesA2A(listado);
    const textoDetalle = formatearDetalleSolicitudA2A(vista);

    expect(textoListado).not.toContain("agente");
    expect(textoListado).toContain("origen de transporte");
    expect(textoDetalle).not.toContain("agente");
    expect(textoDetalle).toContain("origen de transporte");
  });

  it("formatearDetalleSolicitudA2A: un resultado con más de LINEAS_PAGINA_A2A líneas muestra solo la primera página y avisa que hay más", () => {
    const totalLineas = LINEAS_PAGINA_A2A + 15;
    const lineasResultado = Array.from({ length: totalLineas }, (_, i) => `linea ${i}`);
    const vista = makeVistaA2A({ resultado: lineasResultado.join("\n") });

    const texto = formatearDetalleSolicitudA2A(vista);

    expect(texto).toContain("linea 0");
    expect(texto).toContain(`linea ${LINEAS_PAGINA_A2A - 1}`);
    expect(texto).not.toContain(`linea ${LINEAS_PAGINA_A2A}`);
    expect(texto).not.toContain(`linea ${totalLineas - 1}`);
    // La nota de truncado avisa cuántas líneas hay en total, sin literal fijado por diseño.
    expect(texto).toContain(String(totalLineas));
  });

  it("formatearDetalleSolicitudA2A: 'resultado' ausente ⇒ la sección se omite por completo (ni vacía, ni 'undefined')", () => {
    const vista = makeVistaA2A();
    expect("resultado" in vista).toBe(false);

    const texto = formatearDetalleSolicitudA2A(vista);

    expect(texto).not.toContain("undefined");
    expect(texto).not.toContain("resultado:");
  });

  it("formatearListadoSolicitudesA2A: listado vacío devuelve exactamente el texto fijo", () => {
    const listado: ListadoSolicitudesA2AEntrantes = { items: [], hayMas: false };

    expect(formatearListadoSolicitudesA2A(listado)).toBe("No hay solicitudes A2A entrantes en curso.");
  });

  it("formatearListadoSolicitudesA2A: hayMas === true agrega una nota de truncado al final", () => {
    const listado: ListadoSolicitudesA2AEntrantes = { items: [makeVistaA2A()], hayMas: true };

    const texto = formatearListadoSolicitudesA2A(listado);

    expect(texto).toContain("task-1");
    expect(texto.toLowerCase()).toMatch(/mostrando|hay más/);
  });
});
