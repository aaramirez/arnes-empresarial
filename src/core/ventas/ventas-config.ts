/**
 * Configuración de REGLAS DE NEGOCIO de ventas (Hito 4, tarea 2). Vive en el
 * núcleo, no en un adaptador (ADR 17a): el porcentaje de comisión y el
 * umbral de reembolso son parámetros del negocio, no del transporte HTTP que
 * hoy los dispara.
 *
 * Por eso, y a diferencia de `resolveWebhookConfig`/`resolveBoardConfig`
 * (verificados), esta función:
 *  - NO hace `import "../config/env.js"` — no carga nada, no toca el mundo;
 *  - NO tiene default `= process.env` — el composition root le pasa el
 *    diccionario DESPUÉS de que `env.js` cargó `.env`;
 *  - NO lanza: devuelve un resultado discriminado con TODOS los errores
 *    juntos (ADR 17b).
 *
 * Es, literalmente, una función de un diccionario a un valor. Pura en el
 * sentido fuerte.
 */
export interface VentasConfig {
  /** Validado en `(0, 1]`. Spec `venta-confirmacion`: fuera de rango = error de arranque. */
  readonly comisionPorcentaje: number;
  /** Validado `> 0`. `monto < umbral` auto-aprueba; `>=` escala (spec `reembolso-evaluacion`). */
  readonly reembolsoUmbral: number;
  /** Horas. `0` = SIN vencimiento (`expires_at = NULL`) — el interruptor del ADR 10 de la propuesta. Default 72. */
  readonly tokenTtlHoras: number;
}

export const DEFAULT_COMISION_PORCENTAJE = 0.1;
export const DEFAULT_REEMBOLSO_UMBRAL = 500;
/** Seguro por defecto: sin configurar, el link vence en 3 días (R6). `0` desactiva la guarda explícitamente. */
export const DEFAULT_VENTA_TOKEN_TTL_HORAS = 72;

export type ResolveVentasConfigResult =
  | { readonly ok: true; readonly config: VentasConfig }
  | { readonly ok: false; readonly errores: readonly string[] };

/**
 * Devuelve `defaultValue` cuando `raw` está ausente o es cadena vacía (modo
 * de operación válido, no error). Cuando `raw` está presente pero no cumple
 * `esValido`, agrega un mensaje a `errores` con el nombre de la variable y
 * el valor recibido, y devuelve `defaultValue` (ignorado por el llamador
 * porque `ok` ya quedó en `false`).
 */
export function resolveNumeroValidado(
  nombreVar: string,
  raw: string | undefined,
  defaultValue: number,
  esValido: (parsed: number) => boolean,
  descripcion: string,
  errores: string[],
): number {
  if (raw === undefined || raw.trim() === "") {
    return defaultValue;
  }
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && esValido(parsed)) {
    return parsed;
  }
  errores.push(`${nombreVar} inválido: "${raw}" (debe ser ${descripcion})`);
  return defaultValue;
}

/**
 * | Env var | Campo | Default | Validación | Inválido |
 * |---|---|---|---|---|
 * | `COMISION_PORCENTAJE` | `comisionPorcentaje` | `0.1` | finito, `> 0`, `<= 1` | **ABORTA** |
 * | `REEMBOLSO_UMBRAL` | `reembolsoUmbral` | `500` | finito, `> 0` | **ABORTA** |
 * | `VENTA_TOKEN_TTL_HORAS` | `tokenTtlHoras` | `72` | entero finito, `>= 0` | **ABORTA** |
 *
 * Ausente o cadena vacía → default (no es un error: no configurar es un modo
 * válido). Presente pero inválido → error, con el nombre de la variable y el
 * valor recibido en el mensaje. Se acumulan TODOS antes de devolver.
 */
export function resolveVentasConfig(
  env: Readonly<Record<string, string | undefined>>,
): ResolveVentasConfigResult {
  const errores: string[] = [];

  const comisionPorcentaje = resolveNumeroValidado(
    "COMISION_PORCENTAJE",
    env.COMISION_PORCENTAJE,
    DEFAULT_COMISION_PORCENTAJE,
    (parsed) => parsed > 0 && parsed <= 1,
    "un número finito en (0, 1]",
    errores,
  );

  const reembolsoUmbral = resolveNumeroValidado(
    "REEMBOLSO_UMBRAL",
    env.REEMBOLSO_UMBRAL,
    DEFAULT_REEMBOLSO_UMBRAL,
    (parsed) => parsed > 0,
    "un número finito mayor a 0",
    errores,
  );

  const tokenTtlHoras = resolveNumeroValidado(
    "VENTA_TOKEN_TTL_HORAS",
    env.VENTA_TOKEN_TTL_HORAS,
    DEFAULT_VENTA_TOKEN_TTL_HORAS,
    (parsed) => Number.isInteger(parsed) && parsed >= 0,
    "un entero finito >= 0",
    errores,
  );

  if (errores.length > 0) {
    return { ok: false, errores };
  }

  return {
    ok: true,
    config: { comisionPorcentaje, reembolsoUmbral, tokenTtlHoras },
  };
}
