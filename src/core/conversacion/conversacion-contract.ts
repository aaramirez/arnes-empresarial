/**
 * Contrato de memoria conversacional del empleado (`chat-web-empleado`, ADR
 * 196 pto 4, §13 de `design.md`). Sin imports — mismo criterio que
 * `operaciones-contract.ts`/`rol-contract.ts`/`sesion.ts`: puerto puro del
 * dominio, sin comportamiento propio, antes de que exista ningún adaptador.
 *
 * La "conversación" es un puntero al último `casoId` cerrado con éxito
 * (ADR 196 §1) — no una tabla ni un historial de mensajes; el historial
 * real lo tiene el SDK vía `options.resume`.
 */
export interface ConversacionEmpleadoPort {
  /**
   * `casoId` del último turno CERRADO CON ÉXITO de esta conversación, o
   * `undefined` si todavía no hubo ninguno. Nunca devuelve el `casoId` de un
   * turno que falló (ADR 196 pto 7).
   */
  casoAnterior(): string | undefined;
  /**
   * Registra `casoId` como el último turno cerrado con éxito. SÓLO se debe
   * llamar DESPUÉS de que el turno resolvió — nunca antes, nunca en el
   * `catch` de un turno fallido (ADR 196 pto 7).
   */
  registrarTurno(casoId: string): void;
  /** Id de correlación para logs y evidencia. NUNCA es el token de sesión (ADR 197 pto 3). */
  conversacionId(): string;
}
