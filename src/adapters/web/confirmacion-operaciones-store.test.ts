/**
 * Tests de `crearConfirmacionOperacionesStore` (`aprobacion-conversacional-
 * hitl`, ADR 212/213/214, tarea 2). Implementa `ConfirmacionOperacionPort`
 * (`core/operaciones/operaciones-contract.ts`, tarea 1) con una ranura POR
 * EMPLEADO Y POR `dominio:itemId` (`Map<empleadoId, Map<llave, ...>>`) — a
 * diferencia de la ranura única previa, acá `cancelar_solicitud_interna`,
 * `resolver_reembolso` y `resolver_solicitud` conviven sin pisarse, y
 * `accion` entra como PREDICADO (ADR 213): una intención con `accion`
 * distinta sobre el mismo `dominio`/`itemId` reemplaza la ranura, nunca
 * ejecuta la acción vieja ni la nueva sin confirmar.
 *
 * ★ Punto obligatorio 1 de `tasks.md` (ADR 213): pendiente
 * `(E, reembolso, V1, rechazar)` + pedido posterior `(…, aprobar)` ⇒
 * `estaConfirmada` **`false`**, la ranura se sobreescribe con `aprobar` y NO
 * queda una segunda intención de `rechazar` viva.
 */
import { describe, expect, it } from "vitest";
import {
  DOMINIO_REEMBOLSO,
  DOMINIO_SOLICITUD,
  type LlaveConfirmacion,
} from "../../core/operaciones/operaciones-contract.js";
import {
  CONFIRMACIONES_PENDIENTES_MAX,
  crearConfirmacionOperacionesStore,
} from "./confirmacion-operaciones-store.js";

const LLAVE_SOLICITUD_1: LlaveConfirmacion = { dominio: DOMINIO_SOLICITUD, itemId: "sol-1", accion: "cancelar" };
const LLAVE_REEMBOLSO_V1_RECHAZAR: LlaveConfirmacion = { dominio: DOMINIO_REEMBOLSO, itemId: "V1", accion: "rechazar" };
const LLAVE_REEMBOLSO_V1_APROBAR: LlaveConfirmacion = { dominio: DOMINIO_REEMBOLSO, itemId: "V1", accion: "aprobar" };

describe("crearConfirmacionOperacionesStore", () => {
  it("aísla la confirmación pendiente por empleado -- dos empleados distintos no se pisan", () => {
    const store = crearConfirmacionOperacionesStore();
    const confA = store.paraEmpleado("emp-a");
    const confB = store.paraEmpleado("emp-b");

    confA.marcarPendiente({
      ...LLAVE_SOLICITUD_1,
      casoId: "caso-solicitud-a",
      empleadoId: "emp-a",
      origenCasoId: "caso-turno-1",
    });
    confB.marcarPendiente({
      dominio: DOMINIO_SOLICITUD,
      itemId: "sol-2",
      accion: "cancelar",
      casoId: "caso-solicitud-b",
      empleadoId: "emp-b",
      origenCasoId: "caso-turno-2",
    });

    expect(confA.estaConfirmada(LLAVE_SOLICITUD_1, "emp-a", "caso-turno-nuevo")).toBe(true);
    expect(confB.estaConfirmada({ dominio: DOMINIO_SOLICITUD, itemId: "sol-2", accion: "cancelar" }, "emp-b", "caso-turno-nuevo")).toBe(
      true,
    );

    // Ninguna ranura ve la confirmación pendiente del otro empleado.
    expect(confA.estaConfirmada({ dominio: DOMINIO_SOLICITUD, itemId: "sol-2", accion: "cancelar" }, "emp-a", "caso-turno-nuevo")).toBe(
      false,
    );
    expect(confB.estaConfirmada(LLAVE_SOLICITUD_1, "emp-b", "caso-turno-nuevo")).toBe(false);
  });

  it("Dos empleados concurrentes nunca se pisan -- mismo dominio e ítem, empleados distintos", () => {
    const store = crearConfirmacionOperacionesStore();
    const confE1 = store.paraEmpleado("e1");
    const confE2 = store.paraEmpleado("e2");

    confE1.marcarPendiente({ ...LLAVE_REEMBOLSO_V1_APROBAR, casoId: "caso-1", empleadoId: "e1", origenCasoId: "turno-1" });
    confE2.marcarPendiente({ ...LLAVE_REEMBOLSO_V1_APROBAR, casoId: "caso-2", empleadoId: "e2", origenCasoId: "turno-2" });

    confE1.consumir(LLAVE_REEMBOLSO_V1_APROBAR);

    expect(confE1.estaConfirmada(LLAVE_REEMBOLSO_V1_APROBAR, "e1", "turno-nuevo")).toBe(false);
    // La confirmación pendiente de E2 sobre ese mismo ítem sigue intacta.
    expect(confE2.estaConfirmada(LLAVE_REEMBOLSO_V1_APROBAR, "e2", "turno-nuevo")).toBe(true);
  });

  it("Una confirmación de reembolso no pisa una de solicitud del mismo empleado", () => {
    const store = crearConfirmacionOperacionesStore();
    const conf = store.paraEmpleado("emp-a");

    conf.marcarPendiente({ ...LLAVE_SOLICITUD_1, casoId: "caso-solicitud", empleadoId: "emp-a", origenCasoId: "turno-1" });
    conf.marcarPendiente({ ...LLAVE_REEMBOLSO_V1_APROBAR, casoId: "caso-reembolso", empleadoId: "emp-a", origenCasoId: "turno-2" });

    // Ambas quedan pendientes de forma independiente.
    expect(conf.estaConfirmada(LLAVE_SOLICITUD_1, "emp-a", "turno-nuevo")).toBe(true);
    expect(conf.estaConfirmada(LLAVE_REEMBOLSO_V1_APROBAR, "emp-a", "turno-nuevo")).toBe(true);

    // Confirmar una no afecta el estado de la otra.
    conf.consumir(LLAVE_SOLICITUD_1);
    expect(conf.estaConfirmada(LLAVE_SOLICITUD_1, "emp-a", "turno-nuevo")).toBe(false);
    expect(conf.estaConfirmada(LLAVE_REEMBOLSO_V1_APROBAR, "emp-a", "turno-nuevo")).toBe(true);
  });

  it("una segunda invocación con el MISMO casoIdActual que la creó nunca coincide (autoconfirmación imposible)", () => {
    const store = crearConfirmacionOperacionesStore();
    const conf = store.paraEmpleado("emp-a");

    conf.marcarPendiente({ ...LLAVE_SOLICITUD_1, casoId: "caso-solicitud-a", empleadoId: "emp-a", origenCasoId: "caso-turno-1" });

    expect(conf.estaConfirmada(LLAVE_SOLICITUD_1, "emp-a", "caso-turno-1")).toBe(false);
  });

  it("un casoIdActual posterior (turno nuevo) sí coincide", () => {
    const store = crearConfirmacionOperacionesStore();
    const conf = store.paraEmpleado("emp-a");

    conf.marcarPendiente({ ...LLAVE_SOLICITUD_1, casoId: "caso-solicitud-a", empleadoId: "emp-a", origenCasoId: "caso-turno-1" });

    expect(conf.estaConfirmada(LLAVE_SOLICITUD_1, "emp-a", "caso-turno-2")).toBe(true);
  });

  it("sin confirmación pendiente, estaConfirmada es false", () => {
    const store = crearConfirmacionOperacionesStore();
    const conf = store.paraEmpleado("emp-nuevo");

    expect(conf.estaConfirmada(LLAVE_SOLICITUD_1, "emp-nuevo", "caso-turno-1")).toBe(false);
  });

  it("consumir limpia SOLO la ranura de esa llave -- una tercera invocación ya no coincide", () => {
    const store = crearConfirmacionOperacionesStore();
    const conf = store.paraEmpleado("emp-a");

    conf.marcarPendiente({ ...LLAVE_SOLICITUD_1, casoId: "caso-solicitud-a", empleadoId: "emp-a", origenCasoId: "caso-turno-1" });
    conf.consumir(LLAVE_SOLICITUD_1);

    expect(conf.estaConfirmada(LLAVE_SOLICITUD_1, "emp-a", "caso-turno-2")).toBe(false);
  });

  it("distinto itemId no coincide aunque el empleado y el turno posterior sean correctos", () => {
    const store = crearConfirmacionOperacionesStore();
    const conf = store.paraEmpleado("emp-a");

    conf.marcarPendiente({ ...LLAVE_SOLICITUD_1, casoId: "caso-solicitud-a", empleadoId: "emp-a", origenCasoId: "caso-turno-1" });

    expect(conf.estaConfirmada({ dominio: DOMINIO_SOLICITUD, itemId: "sol-distinta", accion: "cancelar" }, "emp-a", "caso-turno-2")).toBe(
      false,
    );
  });

  it("un itemId con ':' adentro no colisiona con otra llave (ADR 212 pto 3, no-ambigüedad del corte)", () => {
    const store = crearConfirmacionOperacionesStore();
    const conf = store.paraEmpleado("emp-a");

    // itemId "reembolso:V1" bajo dominio "solicitud" NO debe coincidir con
    // itemId "V1" bajo dominio "reembolso" — el corte `${dominio}:${itemId}`
    // no puede ser ambiguo aunque el itemId contenga ':'.
    conf.marcarPendiente({
      dominio: DOMINIO_SOLICITUD,
      itemId: "reembolso:V1",
      accion: "cancelar",
      casoId: "caso-ambiguo",
      empleadoId: "emp-a",
      origenCasoId: "turno-1",
    });

    expect(conf.estaConfirmada(LLAVE_REEMBOLSO_V1_APROBAR, "emp-a", "turno-nuevo")).toBe(false);
    expect(conf.estaConfirmada({ dominio: DOMINIO_SOLICITUD, itemId: "reembolso:V1", accion: "cancelar" }, "emp-a", "turno-nuevo")).toBe(
      true,
    );
  });

  it("★ ADR 213: confirmar con OTRA acción no ejecuta la acción original -- reemplaza la ranura, exige confirmación propia", () => {
    const store = crearConfirmacionOperacionesStore();
    const conf = store.paraEmpleado("emp-a");

    // Pendiente: rechazar el reembolso de V1, en el turno 1.
    conf.marcarPendiente({ ...LLAVE_REEMBOLSO_V1_RECHAZAR, casoId: "caso-1", empleadoId: "emp-a", origenCasoId: "turno-1" });

    // Turno posterior: pide APROBAR (no rechazar) el mismo ítem.
    expect(conf.estaConfirmada(LLAVE_REEMBOLSO_V1_APROBAR, "emp-a", "turno-2")).toBe(false);

    // Simula lo que hace el dispatcher cuando estaConfirmada() es false para
    // la acción nueva: vuelve a marcar pendiente con la acción nueva.
    conf.marcarPendiente({ ...LLAVE_REEMBOLSO_V1_APROBAR, casoId: "caso-2", empleadoId: "emp-a", origenCasoId: "turno-2" });

    // La ranura quedó REEMPLAZADA, no acumulada: la intención de "rechazar"
    // original ya no existe -- un turno futuro no puede confirmarla por error.
    expect(conf.estaConfirmada(LLAVE_REEMBOLSO_V1_RECHAZAR, "emp-a", "turno-3")).toBe(false);
    expect(conf.estaConfirmada(LLAVE_REEMBOLSO_V1_APROBAR, "emp-a", "turno-3")).toBe(true);
  });

  it("techo de CONFIRMACIONES_PENDIENTES_MAX evicta la MÁS VIEJA, nunca rechaza", () => {
    const store = crearConfirmacionOperacionesStore();
    const conf = store.paraEmpleado("emp-a");

    for (let i = 0; i < CONFIRMACIONES_PENDIENTES_MAX; i++) {
      conf.marcarPendiente({
        dominio: DOMINIO_SOLICITUD,
        itemId: `sol-${i}`,
        accion: "cancelar",
        casoId: `caso-${i}`,
        empleadoId: "emp-a",
        origenCasoId: `turno-${i}`,
      });
    }

    // Las 8 ranuras están vivas.
    for (let i = 0; i < CONFIRMACIONES_PENDIENTES_MAX; i++) {
      expect(conf.estaConfirmada({ dominio: DOMINIO_SOLICITUD, itemId: `sol-${i}`, accion: "cancelar" }, "emp-a", "turno-nuevo")).toBe(
        true,
      );
    }

    // La novena ranura entra sin rechazar -- evicta la más vieja (sol-0).
    conf.marcarPendiente({
      dominio: DOMINIO_SOLICITUD,
      itemId: "sol-nueva",
      accion: "cancelar",
      casoId: "caso-nueva",
      empleadoId: "emp-a",
      origenCasoId: "turno-nueva",
    });

    expect(conf.estaConfirmada({ dominio: DOMINIO_SOLICITUD, itemId: "sol-0", accion: "cancelar" }, "emp-a", "turno-nuevo")).toBe(false);
    expect(conf.estaConfirmada({ dominio: DOMINIO_SOLICITUD, itemId: "sol-nueva", accion: "cancelar" }, "emp-a", "turno-nuevo")).toBe(
      true,
    );
    // Las demás (sol-1..sol-7) siguen vivas -- sólo se evictó la más vieja.
    for (let i = 1; i < CONFIRMACIONES_PENDIENTES_MAX; i++) {
      expect(conf.estaConfirmada({ dominio: DOMINIO_SOLICITUD, itemId: `sol-${i}`, accion: "cancelar" }, "emp-a", "turno-nuevo")).toBe(
        true,
      );
    }
  });

  it("reescribir una llave YA existente en el techo no evicta ninguna ranura", () => {
    const store = crearConfirmacionOperacionesStore();
    const conf = store.paraEmpleado("emp-a");

    for (let i = 0; i < CONFIRMACIONES_PENDIENTES_MAX; i++) {
      conf.marcarPendiente({
        dominio: DOMINIO_SOLICITUD,
        itemId: `sol-${i}`,
        accion: "cancelar",
        casoId: `caso-${i}`,
        empleadoId: "emp-a",
        origenCasoId: `turno-${i}`,
      });
    }

    // Reescribe la MISMA llave (sol-0) ya en el techo -- no debe evictar nada.
    conf.marcarPendiente({
      dominio: DOMINIO_SOLICITUD,
      itemId: "sol-0",
      accion: "cancelar",
      casoId: "caso-0-actualizado",
      empleadoId: "emp-a",
      origenCasoId: "turno-0-actualizado",
    });

    // Las 8 ranuras originales siguen vivas, incluida sol-0.
    for (let i = 0; i < CONFIRMACIONES_PENDIENTES_MAX; i++) {
      expect(conf.estaConfirmada({ dominio: DOMINIO_SOLICITUD, itemId: `sol-${i}`, accion: "cancelar" }, "emp-a", "turno-nuevo")).toBe(
        true,
      );
    }
  });

  it("limpiarEmpleado borra TODAS las ranuras del empleado -- reembolso y solicitud a la vez", () => {
    const store = crearConfirmacionOperacionesStore();
    const conf = store.paraEmpleado("emp-a");

    conf.marcarPendiente({ ...LLAVE_SOLICITUD_1, casoId: "caso-solicitud", empleadoId: "emp-a", origenCasoId: "turno-1" });
    conf.marcarPendiente({ ...LLAVE_REEMBOLSO_V1_APROBAR, casoId: "caso-reembolso", empleadoId: "emp-a", origenCasoId: "turno-2" });

    store.limpiarEmpleado("emp-a");

    expect(conf.estaConfirmada(LLAVE_SOLICITUD_1, "emp-a", "turno-nuevo")).toBe(false);
    expect(conf.estaConfirmada(LLAVE_REEMBOLSO_V1_APROBAR, "emp-a", "turno-nuevo")).toBe(false);
  });

  it("limpiarEmpleado es idempotente sobre un empleado inexistente", () => {
    const store = crearConfirmacionOperacionesStore();

    expect(() => store.limpiarEmpleado("emp-nunca-existio")).not.toThrow();
    store.limpiarEmpleado("emp-nunca-existio");
    store.limpiarEmpleado("emp-nunca-existio");
  });

  it("limpiarEmpleado de un empleado no afecta las ranuras de otro", () => {
    const store = crearConfirmacionOperacionesStore();
    const confA = store.paraEmpleado("emp-a");
    const confB = store.paraEmpleado("emp-b");

    confA.marcarPendiente({ ...LLAVE_SOLICITUD_1, casoId: "caso-a", empleadoId: "emp-a", origenCasoId: "turno-1" });
    confB.marcarPendiente({ ...LLAVE_SOLICITUD_1, casoId: "caso-b", empleadoId: "emp-b", origenCasoId: "turno-2" });

    store.limpiarEmpleado("emp-a");

    expect(confA.estaConfirmada(LLAVE_SOLICITUD_1, "emp-a", "turno-nuevo")).toBe(false);
    expect(confB.estaConfirmada(LLAVE_SOLICITUD_1, "emp-b", "turno-nuevo")).toBe(true);
  });
});
