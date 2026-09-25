# Propuesta: enmascarar la contraseña en la TUI — `/login` y `/crear-empleado` dejan de mostrar la clave en claro

**Origen**: pedido del usuario. En la TUI (Ink), al tipear `/login <empleadoId> <password>` o `/crear-empleado <empleadoId> <password>`, la clave se ve en claro mientras se tipea y queda en el scrollback.

**Rama prevista**: `hito/v3.XX-enmascarar-password-en-tui`. El número está pendiente del checkpoint (ver punto 6). `v3.20` ya lo reserva `respaldo-y-durabilidad-sqlite` (`proposal.md:5`). La rama se crea **después** del checkpoint (AGENTS.md).

**No es un hito del Plan.** Es una corrección de seguridad de UX en un canal existente.

> **Nota de proceso**: este ejecutor no tiene shell, así que no pudo correr `graphify query` pese al hook. Todo lo afirmado se verificó con `Read`/`Grep` en esta fase.

**Numeración**: el ADR más alto del repo es el **299** (`operaciones-negocio-tui/design.md:15`). Este change abre en el **ADR 300**. El change hermano `reembolso-resta-monto-vendido-en-reporte` puede competir por ese número: **reverificarlo en `sdd-design`**.

---

## Intent

La clave hoy queda expuesta en tres superficies de `src/adapters/tui/App.tsx`:

| # | Superficie | Dónde |
|---|---|---|
| 1 | Borrador mientras se tipea | `PromptInput` dibuja `` `> ${draft}` `` (`:402-408`) |
| 2 | Línea `[hora] Vos: …` del turno | `TurnPrompt` (`:341-353`), usado en el turno pendiente (`:780`) y dentro de `<Static>` (`:769`). `<Static>` es scrollback permanente, así que **enmascarar al renderizar llega tarde**: hay que guardar ya enmascarado al crear el `TurnRecord` (`submitDraft`, `:596`) |
| 3 | Historial de flechas | `promptHistoryRef.current.push(prompt)` (`:586`) guarda la clave en claro, y ↑ la vuelve a mostrar |

**Qué NO cambia**: `onSubmit(prompt, …)` (`:625`) debe seguir recibiendo el texto **real**. Si no, `/login` deja de funcionar.

**Éxito**: en ningún momento del flujo la clave aparece en un frame de la TUI, y el comando sigue autenticando igual que hoy.

---

## Scope

### In Scope

- **Helper puro de enmascarado** en `src/core/commands/`. Usa el flag `secreto` de `DESCRIPTORES`, que hoy vale `true` sólo en `/login` (`comando-empleado.ts:208`) y en `/crear-empleado` (`:334`).
- **Tres cambios en `App.tsx`**:
  - `PromptInput` muestra el borrador enmascarado.
  - `TurnRecord.prompt` se guarda ya enmascarado.
  - Las líneas con secreto no se guardan en `promptHistoryRef`.
- **ADR 300**: reemplaza al ADR 21 en lo que prohibía enmascarar, y a la opción (a) de RD-81.
- **Actualizaciones de documentación**:
  - Comentario desactualizado de `comando-empleado.ts:113` (*"`true` SOLO para `/login`"*).
  - Riesgo 5 (R1) del arc42 (`ARC42_Harness_Empresarial.md:792-800`), cuya condición de disparo (*"que exista enmascarado de entrada en la TUI"*) se cumple con este change.
  - **Nota de reemplazo** (no reescritura) en `comandos-administracion-empleados/design.md:256`.
- Tests en TDD estricto: el Implementer escribe el test antes que el código.

### Out of Scope

- **CLI `src/empleados.ts`** (readline con `terminal: false`, `:147`). El eco de la terminal es el residual R14 que aceptó el ADR 33. Se documenta y no se toca.
- **Web**: `/login` ya usa `type="password"` (`chat-page.ts:84`), y el chat web no parsea `/crear-empleado`.
- **Logs, auditoría y respuesta del agente**: ya no filtran la clave (`build-on-comando-empleado.test.ts:568-569`, `:2670-2671`; `comando-empleado.test.ts:394-396`). No hay trabajo.
- **Rotación de contraseña desde la TUI** (`comandos-administracion-empleados/proposal.md:100`). Su condición de disparo queda cumplida, pero es otro change.
- **Change hermano `reembolso-resta-monto-vendido-en-reporte`**: pedido separado del mismo usuario.
- `tui-port.ts` (contrato I1), `start-tui.tsx` y `build-on-comando-empleado.ts`: **sin cambios**.

---

## Capabilities

### New Capabilities

- Ninguna.

### Modified Capabilities

| Capability | Última versión vigente | Qué cambia |
|---|---|---|
| `autenticacion-empleado-tui` | `comandos-administracion-empleados/specs/autenticacion-empleado-tui/spec.md:9,27-30` | Sale de *Fuera de alcance* "enmascarado de la entrada en la TUI". Se modifica el scenario *"El residual de visibilidad en el transcripto…"* (hoy dice *"ADR 21 sin tocar"*). Se agrega el requirement de enmascarado en borrador, transcripto e historial. ★ `operaciones-negocio-tui` (`:28`) y `sesiones-web-persistentes` también tienen delta sobre esta capability: hay que combinarlos al archivar |
| `administracion-empleados-tui` | `comandos-administracion-empleados/specs/administracion-empleados-tui/spec.md:84-91` | El requirement *"La contraseña de alta es un residual documentado"* exige hoy **no** enmascarar. Pasa a exigir enmascarado y cambia el tratamiento del procedimiento de rotación (punto 5) |
| `comando-empleado-tui` | `operaciones-negocio-tui/specs/comando-empleado-tui/spec.md` | Requirement nuevo: el enmascarado se deriva del mismo parseo que `parsearComando` (mismo `trimStart`, match exacto y sensible a mayúsculas contra `DESCRIPTORES`, mismo corte de `splitPrimerEspacio`) y del flag `secreto` |

---

## Approach

La TUI importa de `core` un helper puro, `enmascararSecreto(texto)` (el nombre se define en design), y lo aplica en tres puntos. El texto real sólo viaja a `onSubmit`.

**Regla del helper**: aplica la misma normalización que el parser (`comando-empleado.ts:526-531`). Si el comando matchea un descriptor con `secreto: true`, reemplaza por `*` cada carácter posterior al separador que sigue al 2º token. Así cubre la clave con espacios internos que admiten `/login` (`:599`) y `idMasRestoObligatorioPayload` (`:493`). En cualquier otro caso, devuelve el texto intacto.

**Supuesto a confirmar en design**: Ink usa raw mode, así que la terminal no hace eco propio y basta con enmascarar lo que dibuja Ink.

| # | Decisión recomendada | Alternativa (sólo donde hay una bifurcación real) |
|---|---|---|
| **D1** | ADR 300 reemplaza al ADR 21 (sólo la prohibición de enmascarar) y a RD-81 (a). `tui-port.ts` no cambia | — |
| **D2** | **(a)** Helper en `src/core/commands/` junto al parser. Si falla, falla cerrado: un comando secreto nuevo queda cubierto sólo por marcar `secreto: true` | **(b)** Lista fija en el adapter: se desalinea del parser. **(c)** Inyectarlo por props desde `main.ts`: si se olvida el cableado, falla abierto |
| **D3** | El id se ve y la clave se muestra como un `*` por carácter con la **longitud real**. Sirve de feedback al usar backspace | Máscara fija: oculta la longitud, pero el usuario tipea a ciegas |
| **D4** | Las líneas con secreto **no se guardan** en el historial de ↑ (mínimo privilegio) | Guardarlas enmascaradas: ↑ traería asteriscos que ya no sirven para reenviar |
| **D5** | `TurnRecord.prompt` se guarda enmascarado al crearlo. Es obligatorio por `<Static>` | — |
| **D6** | Alcance: sólo la TUI | — |

---

## Affected Areas

| Área | Impacto | Descripción |
|---|---|---|
| `src/core/commands/comando-empleado.ts` (o un módulo hermano) | Modified/New | Helper puro, más el comentario de `:113` |
| `src/core/commands/*.test.ts` | Modified/New | Tabla de casos y un invariante contra `parsearComando` |
| `src/adapters/tui/App.tsx` | Modified | `PromptInput`, `submitDraft` (`:586`, `:596`). **Es el primer import de `core` en `src/adapters/tui`** |
| `src/adapters/tui/App.test.tsx` | Modified | Sólo tests **nuevos**: hoy tiene unas 27 referencias a `TurnPrompt`/`PromptInput`/historial, que usan prompts sin secreto |
| `docs/ARC42_Harness_Empresarial.md` | Modified | ADR 300, más la actualización del Riesgo 5 (R1) |
| `openspec/changes/comandos-administracion-empleados/design.md` | Modified | Nota de reemplazo junto a `:256` |
| `tui-port.ts`, `start-tui.tsx`, `build-on-comando-empleado.ts`, `src/adapters/web/*`, `src/empleados.ts` | **Sin cambios** | Si aparecen en el diff, el change se salió del alcance |

## Risks

| # | Riesgo | Prob. | Mitigación |
|---|---|---|---|
| R1 ★ | Enmascarado y parser se desalinean, se enmascara de menos y hay fuga | Media | Mismo módulo, mismo `splitPrimerEspacio` y mismo flag. Casos de prueba con doble espacio, espacios al inicio, espacios internos, tab y clave ausente. Invariante: si `parsearComando` extrae un `password`, la salida desde ese punto es sólo `*` |
| R2 | Un typo (`/logni ana secreto`, `/Login …`) no matchea ningún descriptor y la clave se ve | Cierta | Residual declarado: enmascarar "lo que se parece a login" sería adivinar. Un test fija ese comportamiento. La respuesta de ayuda ya no repite la clave (`comando-empleado.test.ts:394-396`) |
| R3 | Se revierte una decisión escrita (ADR 21 / RD-81 (a)) | Cierta | Ya estaba prevista (`tui-canal-empleado/proposal.md:63,576`; arc42 `:800`). Queda en el ADR 300 explícito e I1 no se toca |
| R4 | Primer import de `core` en `src/adapters/tui` | Baja | La dirección adapter → core está permitida. AGENTS.md sólo prohíbe core → adapters |
| R5 | `App.test.tsx` es denso (unas 27 referencias) | Media | Sólo se agregan tests, y los existentes siguen verdes sin editarlos |
| R6 | `onSubmit` recibe el texto enmascarado y `/login` se rompe | Baja, impacto alto | Un test afirma que `onSubmit` recibe `/login ana secreto` intacto |
| R7 | El CLI sigue haciendo eco de la clave | Cierta | Fuera de alcance (ADR 33). Se documenta |
| R8 | Choque con el change hermano en el número de ADR, el número de hito o el arc42 | Media | Reverificar en `sdd-design` y ordenar el merge en el checkpoint |
| R9 | El administrador sigue conociendo la clave inicial que tipeó | Cierta | Punto 5 del checkpoint |

## Rollback Plan

1. `git revert` de los commits del change. No hay migraciones, variables de entorno ni dependencias npm nuevas, así que no queda nada que deshacer en la base.
2. El helper es aditivo y puro. Revertir sólo `App.tsx` devuelve exactamente el comportamiento actual.
3. Si se revierte, el ADR 300 queda marcado *revertido* en el arc42 y el Riesgo 5 (R1) vuelve a su procedimiento obligatorio.

## Dependencies

- Checkpoint humano (AGENTS.md) que apruebe el ADR 300 **antes** de `sdd-spec`/`sdd-design`.
- Sin dependencias npm nuevas.

## Success Criteria

- [ ] Mientras se tipea `/login ana secreto`, el frame muestra `> /login ana *******`, y `lastFrame()` nunca contiene `secreto` en ningún momento del flujo: borrador, turno pendiente y `<Static>`.
- [ ] Lo mismo con `/crear-empleado ana secreto-largo-123`.
- [ ] `onSubmit` recibe el texto intacto y el login funciona.
- [ ] ↑ después de un `/login` no vuelve a mostrar esa línea.
- [ ] El texto libre y los comandos sin secreto se ven igual que hoy (regresión).
- [ ] Un test fija el residual del typo (`/logni ana secreto` visible).
- [ ] El diff no toca los archivos marcados como *Sin cambios*.
- [ ] Quedaron actualizados el ADR 300, el arc42, la nota de reemplazo y `:113`.
- [ ] `npm test` y `npm run typecheck` pasan, con TDD estricto.

## Estimación vs presupuesto de review (400 líneas)

| Bloque | Líneas est. |
|---|---|
| Helper y sus tests | ≈ 70-100 |
| `App.tsx` y tests nuevos | ≈ 60-90 |
| Documentación (ADR 300, arc42, nota, comentario) | ≈ 30-50 |
| **Total** | **≈ 150-240** |

**Riesgo de superar las 400 líneas: Bajo.** Entra en un solo PR.

## Qué necesita el checkpoint

1. **ADR 300**: ¿se levanta el ADR 21 y RD-81 (a) por escrito? (recomendado: sí).
2. **D2, dónde vive el helper**: (a) en core, (b) lista en el adapter o (c) por props (recomendado: **(a)**).
3. **D3, cómo se ve la máscara**: longitud real o fija (recomendado: **longitud real**).
4. **D4, historial de ↑**: no guardar o guardar enmascarado (recomendado: **no guardar**).
5. **Procedimiento de rotación** de `comandos-administracion-empleados/design.md:256` y arc42 `:798`: ¿se **elimina** o se baja de *obligatorio* a *recomendado*? Recomendado: **bajarlo a recomendado**. El transcripto ya no muestra la clave, pero el administrador la sigue conociendo (R9).
6. **Número de hito y orden de merge** frente a `reembolso-resta-monto-vendido-en-reporte`: recomendado el próximo minor libre al mergear (`v3.21` si `respaldo-y-durabilidad-sqlite` conserva `v3.20`).
7. **R2, el typo**: ¿aceptás el residual de la clave visible cuando el comando está mal tipeado?
