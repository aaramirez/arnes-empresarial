import { migration0001CasosSesionesAgente } from "./0001_casos_sesiones_agente.js";
import { migration0002IdxSesionesCasoAgente } from "./0002_idx_sesiones_caso_agente.js";
import { migration0003ProyectosResponsablesActividades } from "./0003_proyectos_responsables_actividades.js";
import { migration0004VendedoresVentasComisiones } from "./0004_vendedores_ventas_comisiones.js";
import { migration0005RegistroAccionesEmpleado } from "./0005_registro_acciones_empleado.js";
import { migration0006CredencialesEmpleado } from "./0006_credenciales_empleado.js";
import { migration0007Delegaciones } from "./0007_delegaciones.js";
import { migration0008SolicitudesInternas } from "./0008_solicitudes_internas.js";
import { migration0009PropuestasCambio } from "./0009_propuestas_cambio.js";

/**
 * A single schema migration: a stable `id` (used to track whether it has
 * already been applied) plus the SQL to run.
 *
 * Migration convention: one file per migration under `migrations/`, named
 * `NNNN_short_description.ts` with a zero-padded sequential prefix so
 * ordering is obvious from the filename. Each file exports a single
 * `Migration` object. New migrations are appended to `migrations` below —
 * existing entries are never edited or reordered once committed, since
 * `runMigrations` tracks applied ids permanently in `schema_migrations`.
 */
export interface Migration {
  readonly id: string;
  readonly sql: string;
}

export const migrations: readonly Migration[] = [
  migration0001CasosSesionesAgente,
  migration0002IdxSesionesCasoAgente,
  migration0003ProyectosResponsablesActividades,
  migration0004VendedoresVentasComisiones,
  migration0005RegistroAccionesEmpleado,
  migration0006CredencialesEmpleado,
  migration0007Delegaciones,
  migration0008SolicitudesInternas,
  migration0009PropuestasCambio,
];
