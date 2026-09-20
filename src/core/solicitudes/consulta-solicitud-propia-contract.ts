/**
 * Puerto de consulta de una solicitud interna propia, de sólo lectura
 * (`consulta-solicitud-propia`, ADR 237, ADR 238, ADR 239).
 *
 * Molde: `consulta-venta-contract.ts` — un puerto de lectura APARTE, sin
 * ninguna de las escrituras con CAS de `SolicitudStorePort` (ADR 237 pto 1):
 * ese puerto sirve caminos de escritura y su listado es el input de esos
 * caminos ("lo que se puede resolver" = "lo pendiente"); mezclarle un filtro
 * de estado variable convierte un lector de precondición en uno genérico.
 * Importa SÓLO de `./solicitudes-contract.js` (vocabulario ya establecido).
 *
 * `buscarPorId` NO filtra por solicitante: el gate de alcance vive en el
 * núcleo (`consultar-solicitud-propia.ts`, ADR 238), y "ajena" tiene que ser
 * distinguible de "no existe".
 */
import type { SolicitudEstado, SolicitudTipo } from "./solicitudes-contract.js";

/**
 * Tope del listado sin argumento. Constante por LECTOR, no por dominio
 * (patrón vigente, ADR 208 pto 5): `LIMITE_LISTADO_SOLICITUDES` es el techo de
 * la cola de PENDIENTES y puede divergir de éste por razones legítimas.
 * ★ Valor DECLARADO del contrato: el adaptador duplica el 20 literal porque
 * `src/adapters/*` no importa `src/core/*` — lo que los mantiene sincronizados
 * es el test de esta constante, no el wiring (RD-114 pto 3).
 */
export const LIMITE_LISTADO_SOLICITUDES_PROPIAS = 20;

/**
 * Proyección de una solicitud interna PROPIA (ADR 239). Once campos: las doce
 * columnas de `solicitudes_internas` MENOS `updated_at` (metadato de fila, no
 * hecho de negocio). La garantía es ESTRUCTURAL (no hay campo donde ponerlo) Y
 * de SQL (`SOLICITUD_PROPIA_SELECT_COLUMNS` no lo nombra).
 */
export interface SolicitudPropia {
  readonly solicitudId: string;
  /** Para el gate del ADR 238, DENTRO del núcleo. El dispatcher no lo lee (test mecánico). */
  readonly solicitanteId: string;
  readonly casoId: string;
  readonly tipo: SolicitudTipo;
  readonly detalle: string;
  readonly estado: SolicitudEstado;
  /** `undefined` = el subagente validador no corrió o falló — la ausencia es la traza del fallo. */
  readonly dictamen?: string;
  readonly dictaminadaAt?: string;
  /** ★ `empleadoId` opaco, NUNCA nombre ni email (ADR 239). En una cancelación propia es el propio autor (ADR 131). */
  readonly resueltaPor?: string;
  readonly resueltaAt?: string;
  readonly createdAt: string;
}

export interface ConsultaSolicitudPropiaPort {
  /**
   * Por id, SIN filtro de solicitante: el gate de alcance vive en el núcleo
   * (ADR 238) y "ajena" tiene que ser distinguible de "no existe".
   * `undefined` si no existe.
   */
  buscarPorId(solicitudId: string): SolicitudPropia | undefined;
  /**
   * TODOS los estados del solicitante. ★ SIN filtro por `estados`, a propósito
   * (RD-114 pto 4): un solo consumidor, que los quiere todos — el parámetro
   * obligaría a SQL dinámico que nadie ejercería.
   * Orden `createdAt` DESC (historial, no cola de trabajo).
   * Default de `limite`: `LIMITE_LISTADO_SOLICITUDES_PROPIAS`.
   */
  listarDeSolicitante(filtro: {
    readonly solicitanteId: string;
    readonly limite?: number;
  }): readonly SolicitudPropia[];
}
