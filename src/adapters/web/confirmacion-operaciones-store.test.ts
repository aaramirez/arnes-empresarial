/**
 * Tests de `crearConfirmacionOperacionesStore` (`operaciones-negocio-
 * conversacionales`, ADR 173 pto 4, tarea 8). Implementa
 * `ConfirmacionOperacionPort` (`core/operaciones/operaciones-contract.ts`,
 * tarea 1/5) con una ranura POR EMPLEADO (`Map<empleadoId, ...>`) — a
 * diferencia del slot único que basta para la TUI (un solo usuario
 * interactivo por proceso), acá N empleados concurrentes no pueden
 * pisarse la confirmación entre sí.
 *
 * ★ Punto 3 de la tabla de `tasks.md` (ADR 166 pto 3): dos `empleadoId`
 * distintos con confirmaciones pendientes simultáneas no se pisan; una
 * segunda invocación con el MISMO `casoIdActual` que la creó nunca coincide
 * (autoconfirmación estructuralmente imposible); un `casoIdActual`
 * POSTERIOR sí coincide.
 */
import { describe, expect, it } from "vitest";
import { crearConfirmacionOperacionesStore } from "./confirmacion-operaciones-store.js";

describe("crearConfirmacionOperacionesStore", () => {
  it("aísla la confirmación pendiente por empleado -- dos empleados distintos no se pisan", () => {
    const store = crearConfirmacionOperacionesStore();
    const confA = store.paraEmpleado("emp-a");
    const confB = store.paraEmpleado("emp-b");

    confA.marcarPendiente({
      solicitudId: "sol-1",
      casoId: "caso-solicitud-a",
      empleadoId: "emp-a",
      origenCasoId: "caso-turno-1",
    });
    confB.marcarPendiente({
      solicitudId: "sol-2",
      casoId: "caso-solicitud-b",
      empleadoId: "emp-b",
      origenCasoId: "caso-turno-2",
    });

    expect(confA.estaConfirmada("sol-1", "emp-a", "caso-turno-nuevo")).toBe(true);
    expect(confB.estaConfirmada("sol-2", "emp-b", "caso-turno-nuevo")).toBe(true);

    // Ninguna ranura ve la solicitud pendiente del otro empleado.
    expect(confA.estaConfirmada("sol-2", "emp-a", "caso-turno-nuevo")).toBe(false);
    expect(confB.estaConfirmada("sol-1", "emp-b", "caso-turno-nuevo")).toBe(false);
  });

  it("una segunda invocación con el MISMO casoIdActual que la creó nunca coincide (autoconfirmación imposible)", () => {
    const store = crearConfirmacionOperacionesStore();
    const conf = store.paraEmpleado("emp-a");

    conf.marcarPendiente({
      solicitudId: "sol-1",
      casoId: "caso-solicitud-a",
      empleadoId: "emp-a",
      origenCasoId: "caso-turno-1",
    });

    expect(conf.estaConfirmada("sol-1", "emp-a", "caso-turno-1")).toBe(false);
  });

  it("un casoIdActual posterior (turno nuevo) sí coincide", () => {
    const store = crearConfirmacionOperacionesStore();
    const conf = store.paraEmpleado("emp-a");

    conf.marcarPendiente({
      solicitudId: "sol-1",
      casoId: "caso-solicitud-a",
      empleadoId: "emp-a",
      origenCasoId: "caso-turno-1",
    });

    expect(conf.estaConfirmada("sol-1", "emp-a", "caso-turno-2")).toBe(true);
  });

  it("sin confirmación pendiente, estaConfirmada es false", () => {
    const store = crearConfirmacionOperacionesStore();
    const conf = store.paraEmpleado("emp-nuevo");

    expect(conf.estaConfirmada("sol-1", "emp-nuevo", "caso-turno-1")).toBe(false);
  });

  it("consumir limpia la ranura de ese empleado -- una tercera invocación ya no coincide", () => {
    const store = crearConfirmacionOperacionesStore();
    const conf = store.paraEmpleado("emp-a");

    conf.marcarPendiente({
      solicitudId: "sol-1",
      casoId: "caso-solicitud-a",
      empleadoId: "emp-a",
      origenCasoId: "caso-turno-1",
    });
    conf.consumir();

    expect(conf.estaConfirmada("sol-1", "emp-a", "caso-turno-2")).toBe(false);
  });

  it("distinto solicitudId no coincide aunque el empleado y el turno posterior sean correctos", () => {
    const store = crearConfirmacionOperacionesStore();
    const conf = store.paraEmpleado("emp-a");

    conf.marcarPendiente({
      solicitudId: "sol-1",
      casoId: "caso-solicitud-a",
      empleadoId: "emp-a",
      origenCasoId: "caso-turno-1",
    });

    expect(conf.estaConfirmada("sol-distinta", "emp-a", "caso-turno-2")).toBe(false);
  });
});
