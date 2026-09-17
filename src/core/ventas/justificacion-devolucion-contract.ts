/**
 * Puerto de la justificación de una devolución sin token
 * (`devolucion-sin-token-dos-personas`, ADR 228 pto 5-6, RD-106, tarea 8).
 *
 * APPEND-ONLY, a propósito (**R13**): una sola operación, `registrar`. Sin
 * `update`, sin `delete`, sin búsqueda por `motivo` — el `motivo` no es, y no
 * puede ser, una clave de búsqueda. La tabla real (`justificaciones_
 * devolucion`, migración `0014`) vive en `src/adapters/memory/`, tarea 9.
 *
 * Molde: `consulta-venta-contract.ts` — un puerto propio, chico, sin las
 * operaciones de `VentaStorePort`. Sin imports salvo nada (mismo criterio
 * "sin imports" de `consulta-venta-contract.ts`, que no necesita ninguno
 * ajeno a `VentaEstado`; este archivo no necesita ni ese).
 */

/**
 * Tope del `motivo` — DUPLICA a propósito `MAX_STRING_LENGTH` de
 * `validar-operacion.ts` (ADR 228 pto 5): dos capas, la del borde
 * conversacional (256, genérico para todo string) y esta, la del núcleo
 * (256, específica de `motivo`). Un `motivo` de 300 caracteres ni siquiera
 * llega al dispatcher — pero si algún día un llamador nuevo evita el borde
 * (p. ej. un caso de uso interno), esta capa sigue sosteniendo el tope.
 */
export const MOTIVO_MAX_LENGTH = 256;

/**
 * APPEND-ONLY (R13): una sola operación, sin efecto de negocio propio — se
 * persiste ANTES del CAS de `escalarReembolso` (ADR 228 pto 4), nunca
 * después. `solicitanteId` no es campo de búsqueda acá: es dato de la fila,
 * correlacionable por `ventaId`/`casoId` desde afuera (auditoría manual, no
 * un índice de este puerto).
 */
export interface JustificacionDevolucionPort {
  registrar(input: {
    readonly id: string;
    readonly ventaId: string;
    readonly casoId: string;
    readonly solicitanteId: string;
    readonly motivo: string;
    readonly solicitadaAt: string;
  }): void;
}
