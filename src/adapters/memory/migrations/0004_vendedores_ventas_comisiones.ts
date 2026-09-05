/**
 * Esquema de ventas y comisiones (Hito 4). `ventas` se liga a `casos`
 * (Hito 1) por `caso_id` — no se reinventa la correlación, y ese mismo
 * `caso_id` es el handle de la escalación de reembolso (ADR 11 de la
 * propuesta), por eso no hace falta ninguna tabla ni columna nueva para el
 * HITL.
 *
 * DESVIACIÓN ÚNICA respecto del SQL del plan: `expires_at TEXT` (nullable) en
 * `ventas`. ADR 10 de la propuesta: el chequeo de estado cubre el replay, la
 * expiración cubre el link viejo-pero-válido reenviado desde una bandeja de
 * entrada; ninguna sustituye a la otra. Nullable a propósito, para que la
 * guarda se pueda desactivar por configuración (`VENTA_TOKEN_TTL_HORAS=0`)
 * sin migrar nada. La tabla se crea POR PRIMERA VEZ acá: no hay datos que
 * migrar ni consumidores que reconciliar. **Requiere aprobación explícita del
 * checkpoint humano.**
 *
 * `estado` queda TEXT abierto, SIN CHECK — mismo criterio que `repository.ts`
 * documenta para `casos.estado` ("intentionally an open string, not an enum")
 * y que 0003 repitió para `actividades`. Es lo que hace que el quinto valor
 * `'reembolso_pendiente'` (ADR 11) sea legal sin tocar el esquema. La lista
 * canónica vive en `core/ventas/ventas-contract.ts`.
 *
 * `cliente_id TEXT NOT NULL` SIN tabla y SIN FK — la única columna del
 * proyecto con ese tratamiento, tal como el plan la dejó, y la señal es
 * deliberada: identificador OPACO, sin gestión de clientes (R9, fuera de
 * alcance). El email del cliente NO tiene columna y NO se persiste (ADR 18).
 *
 * `monto REAL` se conserva del plan pese a R8 (punto flotante para dinero):
 * el redondeo explícito a 2 decimales vive en `calcularComision` (ADR 16) y
 * migrar a enteros de centavos sería una SEGUNDA desviación. Deuda
 * documentada.
 *
 * Todos los timestamps son ISO-8601 UTC (`new Date().toISOString()`).
 * `expires_at` se COMPARA lexicográficamente en SQL (§6.2), lo cual es
 * correcto SOLO por ese invariante — ADR 16, regla 3.
 */
export const migration0004VendedoresVentasComisiones = {
  id: "0004_vendedores_ventas_comisiones",
  sql: `
CREATE TABLE IF NOT EXISTS vendedores (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ventas (
  id TEXT PRIMARY KEY,
  vendedor_id TEXT NOT NULL REFERENCES vendedores(id),
  cliente_id TEXT NOT NULL,
  plan_anterior TEXT,
  plan_nuevo TEXT NOT NULL,
  monto REAL NOT NULL,
  estado TEXT NOT NULL,
  caso_id TEXT NOT NULL REFERENCES casos(id),
  token_confirmacion TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  confirmed_at TEXT,
  expires_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_ventas_vendedor ON ventas(vendedor_id);

CREATE TABLE IF NOT EXISTS comisiones (
  id TEXT PRIMARY KEY,
  venta_id TEXT NOT NULL REFERENCES ventas(id),
  vendedor_id TEXT NOT NULL REFERENCES vendedores(id),
  monto REAL NOT NULL,
  periodo TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_comisiones_periodo ON comisiones(periodo);
`,
};
