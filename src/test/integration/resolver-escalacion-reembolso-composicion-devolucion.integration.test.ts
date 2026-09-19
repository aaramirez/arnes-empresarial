import { describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { openDatabase } from "../../adapters/memory/db.js";
import { createVentaStore } from "../../build-on-venta.js";
import {
  buscarRolEmpleado,
  buscarVentaPropiaPorId,
  confirmarVentaConComision,
  createVentaConCaso,
  insertJustificacionDevolucion,
  listVentasPropiasDeVendedor,
  upsertRolEmpleado,
} from "../../adapters/memory/repository.js";
import { solicitarDevolucion, type SolicitarDevolucionDeps } from "../../core/ventas/solicitar-devolucion.js";
import {
  ACCION_APROBAR,
  resolverEscalacionReembolso,
  type ResolverEscalacionDeps,
} from "../../core/ventas/resolver-escalacion-reembolso.js";
import { ROL_ADMINISTRADOR, type RolEmpleado, type RolEmpleadoPort } from "../../core/auth/rol-contract.js";
import type { ConsultaVentaPropiaPort } from "../../core/ventas/consulta-venta-contract.js";
import type { JustificacionDevolucionPort } from "../../core/ventas/justificacion-devolucion-contract.js";
import {
  VENTA_ESTADO_REEMBOLSADA,
  VENTA_ESTADO_REEMBOLSO_PENDIENTE,
  type VentaEstado,
} from "../../core/ventas/ventas-contract.js";

/**
 * `devolucion-sin-token-dos-personas`, tarea 17 (Slice 3, SOLA) — tests de
 * COMPOSICIÓN, contra código de producción REAL (`db` SQLite `:memory:`,
 * migraciones reales vía `openDatabase`, `store`/`consulta`/`justificacion`/
 * `rolPort` como closures reales sobre `db`, mismo molde que
 * `comandos-administracion-empleados-flujo.integration.test.ts`).
 *
 * ★ Esta suite NO agrega ni modifica una sola línea de
 * `resolver-escalacion-reembolso.ts` ni de `procesar-devolucion.ts` — prueba
 * que el predicado de autoaprobación del ADR 211/ADR 224 pto 4, ya existente
 * desde `v3.10`, cierra sin cambios las escalaciones nacidas del camino
 * NUEVO (`solicitar_devolucion`, ADR 223). Si algún día hiciera falta tocar
 * ese archivo para que esta suite pase, el mecanismo entero está mal
 * diseñado — eso es un hallazgo bloqueante para el checkpoint, no algo para
 * resolver acá (`proposal.md` Approach pto 3).
 *
 * Cada `it` abre su PROPIA `db` — sin estado compartido entre escenarios,
 * mismo criterio de aislamiento que el resto de `src/test/integration/`.
 */

const TIMESTAMP = "2026-01-01T00:00:00.000Z";

function realRolPort(db: Database.Database): RolEmpleadoPort {
  return {
    buscarRol: (empleadoId) => {
      const row = buscarRolEmpleado(db, empleadoId);
      return row ? (row.rol as RolEmpleado) : undefined;
    },
  };
}

/** Molde exacto del wiring inline de `build-on-operaciones-empleado.ts` (`consultaVentaPropia`). */
function realConsultaVentaPropia(db: Database.Database): ConsultaVentaPropiaPort {
  return {
    buscarPorId: (ventaId) => {
      const row = buscarVentaPropiaPorId(db, ventaId);
      return row ? { ...row, estado: row.estado as VentaEstado } : undefined;
    },
    listarDeVendedor: (filtro) =>
      listVentasPropiasDeVendedor(db, filtro).map((row) => ({ ...row, estado: row.estado as VentaEstado })),
  };
}

/** Molde exacto del wiring inline de `build-on-operaciones-empleado.ts` (`justificacion`). */
function realJustificacion(db: Database.Database): JustificacionDevolucionPort {
  return { registrar: (input) => insertJustificacionDevolucion(db, input) };
}

function realSolicitarDevolucionDeps(db: Database.Database, newId: () => string): SolicitarDevolucionDeps {
  return {
    consulta: realConsultaVentaPropia(db),
    justificacion: realJustificacion(db),
    store: createVentaStore(db),
    newId,
    now: () => TIMESTAMP,
    logEvent: () => undefined,
  };
}

function realResolverEscalacionDeps(db: Database.Database, newId: () => string): ResolverEscalacionDeps {
  return {
    store: createVentaStore(db),
    newId,
    now: () => TIMESTAMP,
    logEvent: () => undefined,
    rolPort: realRolPort(db),
  };
}

/** Venta ya `confirmada` — precondición real del CAS de `escalarReembolso` (`WHERE estado = 'confirmada'`). */
function seedVentaConfirmada(
  db: Database.Database,
  input: { readonly ventaId: string; readonly casoId: string; readonly vendedorId: string; readonly vendedorNombre: string },
): void {
  createVentaConCaso(db, {
    vendedor: { id: input.vendedorId, nombre: input.vendedorNombre },
    caso: {
      id: input.casoId,
      tipo: "venta",
      estado: "pendiente_confirmacion",
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
    },
    venta: {
      id: input.ventaId,
      clienteId: "cliente-1",
      planNuevo: "plan-x",
      monto: 1000,
      estado: "pendiente_confirmacion",
      tokenConfirmacion: `tok-${input.ventaId}`,
    },
    timestamp: TIMESTAMP,
  });
  confirmarVentaConComision(db, {
    ventaId: input.ventaId,
    comisionId: `comision-${input.ventaId}`,
    comisionMonto: 100,
    periodo: "2026-01",
    ahora: TIMESTAMP,
  });
}

/** Inicia y confirma `solicitarDevolucion` — deja la venta en `reembolso_pendiente`, con justificación escrita. */
function iniciarYConfirmarDevolucion(
  db: Database.Database,
  input: { readonly ventaId: string; readonly empleadoId: string },
): void {
  const deps = realSolicitarDevolucionDeps(db, () => `justificacion-${input.ventaId}`);
  const sesion = { empleadoId: input.empleadoId, iniciadaEn: TIMESTAMP };

  const eco = solicitarDevolucion(
    { ventaId: input.ventaId, motivo: "el cliente se arrepintió", confirmado: false, sesion },
    deps,
  );
  expect(eco.resultado).toBe("requiere_confirmacion");

  const confirmacion = solicitarDevolucion(
    { ventaId: input.ventaId, motivo: "el cliente se arrepintió", confirmado: true, sesion },
    deps,
  );
  expect(confirmacion.resultado).toBe("escalada");
}

function estadoVenta(db: Database.Database, ventaId: string): string {
  const row = db.prepare("SELECT estado FROM ventas WHERE id = ?").get(ventaId) as { estado: string };
  return row.estado;
}

function estadoCaso(db: Database.Database, casoId: string): string {
  const row = db.prepare("SELECT estado FROM casos WHERE id = ?").get(casoId) as { estado: string };
  return row.estado;
}

describe("Composición: resolver_reembolso cierra las escalaciones nacidas de solicitar_devolucion (devolucion-sin-token-dos-personas, tarea 17)", () => {
  it("E1 registra la venta, inicia y confirma solicitar_devolucion sobre ella → reembolso_pendiente, justificación persistida (no en registro_acciones_empleado)", () => {
    const db = openDatabase(":memory:");
    try {
      seedVentaConfirmada(db, { ventaId: "venta-1", casoId: "caso-1", vendedorId: "e1", vendedorNombre: "Empleado Uno" });

      iniciarYConfirmarDevolucion(db, { ventaId: "venta-1", empleadoId: "e1" });

      expect(estadoVenta(db, "venta-1")).toBe(VENTA_ESTADO_REEMBOLSO_PENDIENTE);
      expect(estadoCaso(db, "caso-1")).toBe("pendiente_aprobacion_humana");

      const justificacion = db
        .prepare("SELECT venta_id, motivo, solicitante_id FROM justificaciones_devolucion WHERE venta_id = ?")
        .get("venta-1") as { venta_id: string; motivo: string; solicitante_id: string };
      expect(justificacion.motivo).toBe("el cliente se arrepintió");
      expect(justificacion.solicitante_id).toBe("e1");
    } finally {
      db.close();
    }
  });

  it("E1 (rol elevado) invoca resolver_reembolso sobre SU PROPIA escalación → autoaprobacion_prohibida, CERO cambios en ventas/casos", () => {
    const db = openDatabase(":memory:");
    try {
      seedVentaConfirmada(db, { ventaId: "venta-1", casoId: "caso-1", vendedorId: "e1", vendedorNombre: "Empleado Uno" });
      upsertRolEmpleado(db, { empleadoId: "e1", rol: ROL_ADMINISTRADOR, ahora: TIMESTAMP });
      iniciarYConfirmarDevolucion(db, { ventaId: "venta-1", empleadoId: "e1" });

      const resolverDeps = realResolverEscalacionDeps(db, () => "accion-1");
      const sesionE1 = { empleadoId: "e1", iniciadaEn: TIMESTAMP };

      const eco = resolverEscalacionReembolso(
        { accion: ACCION_APROBAR, ventaId: "venta-1", confirmado: false, sesion: sesionE1 },
        resolverDeps,
      );
      expect(eco.resultado).toBe("requiere_confirmacion");

      const resultado = resolverEscalacionReembolso(
        { accion: ACCION_APROBAR, ventaId: "venta-1", confirmado: true, sesion: sesionE1 },
        resolverDeps,
      );

      expect(resultado.resultado).toBe("autoaprobacion_prohibida");
      // Releído de la DB, no sólo del `Result` — el predicado cortó ANTES del CAS.
      expect(estadoVenta(db, "venta-1")).toBe(VENTA_ESTADO_REEMBOLSO_PENDIENTE);
      expect(estadoCaso(db, "caso-1")).toBe("pendiente_aprobacion_humana");
    } finally {
      db.close();
    }
  });

  it("empleado base B (≠ E1, sin rol elevado) invoca resolver_reembolso sobre la escalación de E1 → no_autorizado", () => {
    const db = openDatabase(":memory:");
    try {
      seedVentaConfirmada(db, { ventaId: "venta-1", casoId: "caso-1", vendedorId: "e1", vendedorNombre: "Empleado Uno" });
      iniciarYConfirmarDevolucion(db, { ventaId: "venta-1", empleadoId: "e1" });
      // "b" SIN fila en `roles_empleado` ⇒ rol base por ausencia (ADR 154 pto 5).

      const resolverDeps = realResolverEscalacionDeps(db, () => "accion-1");
      const sesionB = { empleadoId: "b", iniciadaEn: TIMESTAMP };

      const resultado = resolverEscalacionReembolso(
        { accion: ACCION_APROBAR, ventaId: "venta-1", confirmado: true, sesion: sesionB },
        resolverDeps,
      );

      expect(resultado.resultado).toBe("no_autorizado");
      expect(estadoVenta(db, "venta-1")).toBe(VENTA_ESTADO_REEMBOLSO_PENDIENTE);
      expect(estadoCaso(db, "caso-1")).toBe("pendiente_aprobacion_humana");
    } finally {
      db.close();
    }
  });

  it("administrador A (≠ E1) invoca resolver_reembolso y confirma → ventas.estado = reembolsada", () => {
    const db = openDatabase(":memory:");
    try {
      seedVentaConfirmada(db, { ventaId: "venta-1", casoId: "caso-1", vendedorId: "e1", vendedorNombre: "Empleado Uno" });
      upsertRolEmpleado(db, { empleadoId: "a", rol: ROL_ADMINISTRADOR, ahora: TIMESTAMP });
      iniciarYConfirmarDevolucion(db, { ventaId: "venta-1", empleadoId: "e1" });

      const resolverDeps = realResolverEscalacionDeps(db, () => "accion-1");
      const sesionA = { empleadoId: "a", iniciadaEn: TIMESTAMP };

      const eco = resolverEscalacionReembolso(
        { accion: ACCION_APROBAR, ventaId: "venta-1", confirmado: false, sesion: sesionA },
        resolverDeps,
      );
      expect(eco.resultado).toBe("requiere_confirmacion");

      const resultado = resolverEscalacionReembolso(
        { accion: ACCION_APROBAR, ventaId: "venta-1", confirmado: true, sesion: sesionA },
        resolverDeps,
      );

      expect(resultado.resultado).toBe("aplicada");
      expect(estadoVenta(db, "venta-1")).toBe(VENTA_ESTADO_REEMBOLSADA);
      expect(estadoCaso(db, "caso-1")).toBe("resuelto");
    } finally {
      db.close();
    }
  });

  it("★ R6, colisión de identificadores: un vendedorId externo (POST /ventas) igual a un empleadoId real con rol elevado permite INICIAR pero NO cerrar — mismo autoaprobacion_prohibida que un vendedor interno", () => {
    const db = openDatabase(":memory:");
    try {
      // "e2" es, a la vez: (1) el `vendedorId` que usó `POST /ventas` para dar
      // de alta esta venta (tabla `vendedores`, SIN relación con
      // credenciales) y (2) el `empleadoId` de un empleado real, con rol
      // elevado (tabla `roles_empleado`). Coincidencia de STRING entre dos
      // tablas sin FK cruzada — NUNCA una identidad de dominio compartida
      // (`proposal.md` R6, riesgo de colisión de identificadores).
      seedVentaConfirmada(db, { ventaId: "venta-2", casoId: "caso-2", vendedorId: "e2", vendedorNombre: "Vendedor Externo E2" });
      upsertRolEmpleado(db, { empleadoId: "e2", rol: ROL_ADMINISTRADOR, ahora: TIMESTAMP });

      // E2 SÍ puede iniciar: `venta.vendedorId === sesion.empleadoId` (misma
      // cadena, "e2") satisface el gate "es dueño" de `solicitarDevolucion`.
      iniciarYConfirmarDevolucion(db, { ventaId: "venta-2", empleadoId: "e2" });
      expect(estadoVenta(db, "venta-2")).toBe(VENTA_ESTADO_REEMBOLSO_PENDIENTE);

      // E2 NO puede cerrarla: la MISMA comparación de string que habilitó la
      // iniciación es la que dispara la prohibición de autoaprobación acá —
      // el predicado no distingue "coincidencia externa" de "vendedor
      // interno", y no debe hacerlo: falla cerrado en el dinero (R6).
      const resolverDeps = realResolverEscalacionDeps(db, () => "accion-2");
      const sesionE2 = { empleadoId: "e2", iniciadaEn: TIMESTAMP };

      const resultado = resolverEscalacionReembolso(
        { accion: ACCION_APROBAR, ventaId: "venta-2", confirmado: true, sesion: sesionE2 },
        resolverDeps,
      );

      expect(resultado.resultado).toBe("autoaprobacion_prohibida");
      expect(estadoVenta(db, "venta-2")).toBe(VENTA_ESTADO_REEMBOLSO_PENDIENTE);
      expect(estadoCaso(db, "caso-2")).toBe("pendiente_aprobacion_humana");
    } finally {
      db.close();
    }
  });
});
