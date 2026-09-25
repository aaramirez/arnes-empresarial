# Diseño técnico: `enmascarar-password-en-tui` — la clave de `/login` y `/crear-empleado` deja de verse en la TUI

**Change**: `enmascarar-password-en-tui` · **Propuesta**: `proposal.md` (D1-D6, R1-R9) · **Specs delta**: `specs/comando-empleado-tui`, `specs/autenticacion-empleado-tui`, `specs/administracion-empleados-tui`.

**Numeración**: este diseño **abre ADR 300 y RD-172**. Techo reverificado con `Grep` sobre `openspec/`, `docs/` y `src/` **en esta fase**: el ADR más alto es **299** (`operaciones-negocio-tui/design.md:5,107`) y la RD más alta es **RD-171** (misma fuente). `ADR 3xx` sólo aparece en los artefactos de este change. `respaldo-y-durabilidad-sqlite` usa ADR 232, 247 y 259-262 (rango reservado del hito 4.0): **no choca**. El hermano `reembolso-resta-monto-vendido-en-reporte` **todavía no tiene carpeta**: si se planifica antes de que este change mergee, va a encontrar el mismo techo (299) y reclamar el 300 → ver R8 y §9.

> **Nota de proceso**: este ejecutor no tiene shell, así que no pudo correr `graphify query` pese al hook. Todo `archivo:línea` de abajo se verificó con `Read`/`Grep` en esta fase sobre `main` (`2195a17`).

**Dependencia de checkpoint**: las decisiones marcadas **[CP]** son las *recomendadas* de la propuesta. Este diseño se apoya en ellas; si el checkpoint elige otra, cambia la sección indicada (RD-172).

---

## 0. Hallazgos de esta fase

| # | Hallazgo | Consecuencia de diseño |
|---|---|---|
| **H1** ★ | El supuesto de la propuesta (*"Ink usa raw mode, no hay eco de terminal"*) vale **sólo con el prompt libre**. Mientras hay un turno `pending`, `useInput` corre con `isActive: false` (`App.tsx:709`) e Ink llama `stdin.setRawMode(false)` (`node_modules/ink/build/hooks/use-input.js:33-38`, `components/App.js:126-127`). Lo que se tipee durante *"Pensando..."* lo **ecoa la tty**, por fuera de Ink | Residual nuevo **R10**, declarado y fuera de alcance (§8). Pregunta para el checkpoint (§10) |
| **H2** | *"Enmascarar al renderizar llega tarde por `<Static>`"* (propuesta, Intent #2) **no es exacto**: `<Static>` ejecuta su función hija al volcar el ítem, así que enmascarar dentro de `TurnPrompt` también saldría enmascarado | La decisión D5 **no cambia**, pero cambia su razón: la clave **no debe vivir en el estado `history`** durante toda la sesión (mínimo privilegio), y los dos caminos de render leen el mismo registro. Guardar enmascarado es la garantía a nivel de dato |
| **H3** | `submitDraft` hace `trim()` antes de todo (`App.tsx:579`). El "texto real" que recibe `onSubmit` ya es el borrador recortado, igual que hoy | La máscara del eco se calcula sobre **ese mismo** string recortado |
| **H4** | `splitPrimerEspacio` hace `trim()` de bordes del resto (`comando-empleado.ts:440`) y devuelve strings, no posiciones | No se puede reusar tal cual: la máscara necesita posiciones sobre el texto original y el spec exige enmascarar también los espacios de cola (ADR 300 pto 3) |
| **H5** | `comando-empleado.ts` tiene **cero imports**. `src/adapters/tui/**` hoy no importa nada de `src/core/` y `src/core/` no importa ningún adapter (ambos verificados con `Grep`). El único test de arquitectura (`src/adapters/ops/arquitectura.test.ts:45-80`) gobierna **sólo** `adapters/ops` | El import nuevo no arrastra dependencias transitivas ni rompe ningún candado. `adapters/web` ya importa `core` en muchos archivos |
| **H6** | El doc-comment de `App.tsx` **no cita el ADR 21** (0 coincidencias). Lo que describe la conducta vieja es `:183-189` (*"`submitDraft` always appends the sent prompt"*) y el comentario de `TurnRecord` (`:285-287`) | Esos dos puntos se actualizan (§5). La prohibición del ADR 21 vive en `tui-canal-empleado/proposal.md:107` (pto 4) y en el arc42 `:794,800` |
| **H7** | **RD-81 es un número colisionado**: en `consultas-negocio-a2a-entrante` es "puertos angostos" y en `comandos-administracion-empleados` es "cómo entra la contraseña" | Se cita siempre con prefijo, como recomienda la Deuda 11 del arc42 (`:898`): *RD-81 (comandos-administracion-empleados)*. Lo mismo para *ADR 21 (tui-canal-empleado)* |
| **H8** | Backspace borra **una unidad UTF-16** (`draftRef.current.slice(0, -1)`, `App.tsx:656`) | Ésa es la unidad de "longitud" de la máscara (ADR 300 pto 4) |

---

## 1. Enfoque técnico

Una función pura nueva, `enmascararSecreto(texto)`, vive en `src/core/commands/comando-empleado.ts`, al lado del parser, y lee el flag `secreto` de `DESCRIPTORES`. `App.tsx` la importa y la aplica en tres puntos: el render del borrador, el `TurnRecord` que se crea en `submitDraft` y el filtro del historial de flechas. El texto real sigue viajando **sólo** a `onSubmit`.

Sin cambios: `tui-port.ts` (contrato I1), `start-tui.tsx`, `build-on-comando-empleado.ts`, `main.ts`, `src/adapters/web/**`, `src/empleados.ts`.

---

## 2. ADR 300 — La TUI enmascara el secreto de los comandos `secreto: true`

> Redactado para copiarse tal cual al arc42 (sección *Decisiones de Diseño*) cuando el Reviewer cierre. **No se edita el arc42 en esta fase.**

**Reemplaza a**: el **pto 4 del ADR 21 (tui-canal-empleado)**, *sólo* en lo que respecta a `App.tsx` (*"Cero cambios en `tui-port.ts`, `App.tsx` y `start-tui.tsx`"*, `tui-canal-empleado/proposal.md:107`), y a la **opción (a) de RD-81 (comandos-administracion-empleados)** (contraseña de alta visible en el transcripto). El resto del ADR 21 (dispatcher por prefijo, parser puro en `src/core/commands/`, contrato I1 intacto) **sigue vigente**.

**Contexto.** El ADR 21 dejó a `App.tsx` intocable. La consecuencia fue R14 (la clave de `/login` visible en el transcripto propio) y, desde v3.7, el Riesgo 5 (R1) del arc42 (`:792-800`): la clave de **otra** persona visible tras `/crear-empleado`, aceptada con rotación obligatoria por CLI. Ambos documentos dejaron escrita la condición de disparo, *"que exista enmascarado de entrada en la TUI"* (arc42 `:800`, `tui-canal-empleado/proposal.md:63`). Este change la cumple.

**Decisión.**

1. `App.tsx` puede cambiar para enmascarar. `tui-port.ts` y `start-tui.tsx` **no** cambian.
2. Qué se enmascara lo decide una función pura del núcleo, `enmascararSecreto`. Se deriva del flag `secreto` de `DESCRIPTORES` y de la misma normalización que `parsearComando`. La TUI no mantiene ninguna lista propia de comandos: un comando nuevo con `secreto: true` queda cubierto sin tocar la TUI (**falla cerrado**).
3. **Forma**: se conserva el texto hasta el espacio separador posterior al id, inclusive. Cada unidad posterior, incluidos los espacios internos y de cola, pasa a `*`. Ejemplo: `/login ana s3cr et` → `/login ana *******`. **[CP D3]**
4. **Longitud**: se cuenta en unidades UTF-16 (`String.prototype.length`), la misma unidad que borra backspace (H8).
5. **Superficies**:
   - El borrador se dibuja enmascarado.
   - `TurnRecord.prompt` se guarda ya enmascarado al crearse (D5, razón corregida en H2).
   - La línea con secreto **no entra** al historial ↑/↓. **[CP D4]**
   - `onSubmit` sigue recibiendo el texto real.
6. **Alcance**: sólo la TUI (D6). El CLI `empleados:crear` queda fuera (R14, ADR 33) y la web ya usa `type="password"`.
7. El Riesgo 5 (R1) del arc42 se reescribe. Deja de ser *"contraseña visible en el transcripto"* y queda como residual reducido: el administrador conoce la clave inicial (R9), un comando mal tipeado no se enmascara (R2) y existe el eco durante un turno pendiente (R10). La rotación por CLI pasa de **obligatoria** a **recomendada**. **[CP punto 5]**

| Opción | Tradeoff | Veredicto |
|---|---|---|
| **Máscara en el núcleo, derivada de `secreto`, aplicada por `App.tsx`** | Primer import `core` → `adapters/tui` (permitido, H5) | ★ **Elegida** |
| Mantener el ADR 21 (no enmascarar) | La condición de disparo escrita ya se cumplió | Rechazada |
| Lista fija de comandos en el adapter | Se desalinea del parser en silencio (R1) | Rechazada |
| Inyectar la función por props desde `main.ts` | Si se olvida el cableado, **falla abierto**: sin error y con la clave visible | Rechazada (§4) |
| Prompt de contraseña en dos pasos (`/login ana` y después una entrada oculta, estilo `sudo`) | No filtra ni la longitud, pero agrega un modo con estado a `App.tsx` y un protocolo nuevo sobre I1 | Rechazada: es mucho más grande que el problema |

**Consecuencias.**

- `src/adapters/tui/App.tsx` importa de `src/core/` por primera vez. La dirección está permitida; `core` → `adapters` sigue prohibido.
- Se reescribe el Riesgo 5 (R1) del arc42 y se agrega una nota de reemplazo en `comandos-administracion-empleados/design.md:256`.
- Residuales declarados: R2, R7, R9 y R10 (§8).
- **Reversible**: revertir los commits devuelve exactamente el comportamiento previo. No hay migraciones.

---

## 3. El helper puro (`src/core/commands/comando-empleado.ts`)

### 3.1 Decisiones

| Tema | Opción | Tradeoff | Veredicto |
|---|---|---|---|
| **Ubicación** | **Mismo archivo que el parser** | Lee `DESCRIPTORES` (privado) directamente. Sigue el molde de `esComandoPrivilegiado`/`requiereAdministrador`/`nombreComando` (*"ÚNICA fuente de verdad"* junto al parser). El archivo ya es largo (~650 líneas) | ★ **Elegida** |
| | Archivo propio `enmascarar-secreto.ts` que lee `COMANDOS` (ya exportado, con `nombre` y `secreto`) | Archivo chico, sin exponer internos; pero aleja la regla de corte del parser que tiene que imitar | Rechazada. Es aceptable si el Reviewer prefiere archivos chicos: la paridad la cubre igual el test |
| **Reuso de `splitPrimerEspacio`** | **(a) Helper posicional propio, con las mismas primitivas** (`trimStart`, `indexOf(" ")`) **y paridad garantizada por test** (§7) | Hay dos implementaciones del corte, pero el parser no se toca | ★ **Elegida** |
| | (b) Refactor: `splitPrimerEspacio` devuelve también `inicioResto` y la usan ambos | Una sola fuente del corte, pero toca la función que usan las 13 ramas del parser. Además, la máscara igual necesita lógica de posiciones propia, porque el `trim` final descarta los espacios de cola que hay que enmascarar (H4) | Rechazada: agrega riesgo sin eliminar la duplicación |
| | (c) Derivar la máscara del resultado de `parsearComando` (`password` al final de `trimEnd()`) | Paridad por construcción, pero deja visible el espacio extra antes de la clave (contradice el scenario `  /login  ana ***` del spec) y ata la TUI al **nombre** del campo (`password`): un secreto futuro con otro nombre fallaría abierto | Rechazada como implementación. **Se usa como oráculo del test de paridad** |
| **Espacios** | **Conservar el prefijo y los separadores hasta el separador posterior al id; enmascarar todo lo que sigue, incluidos los espacios de cola** | Mientras se tipea `s3cr et`, dejar visible el espacio de cola revelaría *"la clave termina en espacio"*. El parser recorta esos espacios al enviar, así que ocultarlos no cuesta nada. Es lo que dice el spec, literal | ★ **Elegida** |
| **Unidad de longitud** | **Unidades UTF-16** | Un emoji se ve como `**`. Es consistente con backspace (`slice(0,-1)`, H8), con `.length === ` del spec y con el parser. Una clave a medio borrar puede quedar con un surrogate suelto: la máscara lo tapa en vez de dibujarlo roto | ★ **Elegida** |
| | Code points (`Array.from`) | Un emoji se ve como un `*`, pero el primer backspace sobre un emoji no cambia el frame (queda un surrogate suelto que sigue contando como 1) y se rompe la igualdad `.length` del spec | Rechazada |
| **Predicado del historial** | **`contieneSecreto(texto)` estructural** (hay un tramo secreto no vacío) | Tapa el caso borde de una clave hecha sólo de `*` (`/login ana ***`): ahí `enmascararSecreto(x) === x` y el predicado `!==` la guardaría en ↑ | ★ **Elegida**. Exige un ajuste mínimo de redacción en el spec (§10) |
| | `enmascararSecreto(x) !== x` | Una función exportada menos, pero falla abierto en ese caso borde | Rechazada |

### 3.2 Contrato

```ts
/** Nombres de los comandos `secreto: true`, calculado UNA vez (molde de `DESCRIPTOR_POR_TIPO`). Privado. */
const NOMBRES_SECRETOS: ReadonlySet<string> = new Set(
  DESCRIPTORES.filter((d) => d.secreto).map((d) => d.nombre),
);

/** Privado. Índice (en `texto`) donde empieza el tramo secreto, o `undefined`. Misma normalización que `parsearComando`. */
function inicioTramoSecreto(texto: string): number | undefined {
  const inicio = texto.length - texto.trimStart().length;   // = trimStart de parsearComando (:527,531)
  const linea = texto.slice(inicio);
  const finComando = linea.indexOf(" ");                     // = 1er splitPrimerEspacio (:435)
  if (finComando === -1 || !NOMBRES_SECRETOS.has(linea.slice(0, finComando))) return undefined;
  const resto = linea.slice(finComando + 1);
  const inicioId = resto.length - resto.trimStart().length;  // = trim de bordes del resto (:440)
  const finId = resto.indexOf(" ", inicioId);                // = 2º splitPrimerEspacio (:599 / :493)
  return finId === -1 ? undefined : inicio + finComando + 1 + finId + 1;
}

/** PURA (ADR 300). Misma longitud que `texto`; intacto si no hay tramo secreto. Idempotente. */
export function enmascararSecreto(texto: string): string;
/** PURA (ADR 300). `true` ⇔ hay tramo secreto no vacío. Lo usa el historial de la TUI. */
export function contieneSecreto(texto: string): boolean;
```

**Exports nuevos: sólo esos dos.** `DESCRIPTORES`, `Forma` y `splitPrimerEspacio` siguen privados.

La igualdad con el parser es **por construcción en la posición del id**. El único desvío es deliberado y va del lado seguro: si el primer espacio posterior al id cae dentro de los espacios de cola, el parser dice *"sin clave"* y la máscara tapa esos espacios (`/login ana  ` → `/login ana *`). Es sobre-enmascarar espacios, nunca sub-enmascarar la clave.

---

## 4. Cambios en `src/adapters/tui/App.tsx`

**Import directo vs inyección.** Se importa `enmascararSecreto`/`contieneSecreto` directamente desde `../../core/commands/comando-empleado.js`.

- **Import directo** (★ elegido): la máscara no depende de ningún cableado y falla cerrado. El costo es que `App.tsx` deja de ser agnóstico de la gramática de comandos. Es un acoplamiento a una función pura sin dependencias (H5), no al dispatcher.
- **Inyección por props** (`<App mask={...}>` desde `main.ts`/`start-tui.tsx`): `App` sigue siendo agnóstico, pero hay que tocar `start-tui.tsx` (fuera de alcance) y **falla abierto**: sin la prop, la clave se ve y ningún tipo lo impide, salvo que la prop sea obligatoria. En ese caso, los ~30 `render(<App …/>)` de los tests también cambian. Rechazada.

| # | Punto | Cambio | Decisión |
|---|---|---|---|
| 1 | `PromptInput` (`:402-408`) | Dibuja `` `> ${enmascararSecreto(draft)}` ``. La prop `draft` sigue siendo el texto **real**; `draftRef`/`draft` no cambian | La máscara va **dentro** de `PromptInput`, no en el sitio de llamada: todo render del borrador pasa por ella, incluso un llamador futuro, y permite un test directo por props. El test existente `PromptInput({ draft: "hola" })` (`App.test.tsx:1033`) sigue verde. Alternativa rechazada: `draft={enmascararSecreto(draft)}` en `App` (un llamador nuevo que lo olvide falla abierto) |
| 2 | `submitDraft` (`:579-600`) | `const visible = enmascararSecreto(prompt)` sobre el prompt **ya recortado** (H3). El `TurnRecord` se crea con `prompt: visible` y `onSubmit(prompt, …)` recibe el real | `TurnRecord.prompt` conserva el nombre y se le actualiza el comentario (*"ya enmascarado, ADR 300"*); renombrarlo no suma nada. `TurnPrompt` **no** enmascara al renderizar: el dato ya es seguro por construcción, y así queda **un** solo invariante que testear |
| 3 | Historial (`:586`) | `if (!contieneSecreto(prompt)) promptHistoryRef.current.push(prompt);`. `historyIndexRef.current = null` se sigue ejecutando **siempre** | **[CP D4]** |
| 4 | ↑/↓ (`navigateHistory`, `:510-554`) | **Sin cambios**. Una línea con secreto nunca llega a `entries`. Un borrador con clave **no enviado** sí puede quedar en `draftBeforeHistoryRef` al apretar ↑: vive en memoria como `draftRef`, y al volver con ↓ se dibuja enmascarado por el punto 1 | — |
| 5 | Doc-comments | Párrafo nuevo *"Secret masking (ADR 300)"* en el module doc; reescritura de `:183-189` (*"always appends"* → *"except lines with a secret"*); comentarios de `TurnRecord` (`:285`) y de `PromptInput` (`:380`) | H6 |

```ts
// submitDraft — diff lógico
const prompt = draftRef.current.trim();
if (prompt.length === 0) return;
const visible = enmascararSecreto(prompt);          // ADR 300
if (!contieneSecreto(prompt)) promptHistoryRef.current.push(prompt);
historyIndexRef.current = null;
// …
setHistory((previous) => [...previous, { id, prompt: visible, status: "pending", timestamp }]);
// …
onSubmit(prompt, onAgentResolved)                   // texto REAL, sin cambios
```

---

## 5. Flujo

```
tecla ─► useInput ─► draftRef (REAL) ─► setDraft ─► PromptInput ─► enmascararSecreto ─► "> /login ana ****"
                                            │
Enter ─► submitDraft ─► prompt = draftRef.trim()   (REAL)
                          ├─► contieneSecreto? ── no ─► promptHistoryRef.push(prompt)
                          │                     └ sí ─► (no se guarda)
                          ├─► TurnRecord{ prompt: enmascararSecreto(prompt) } ─► TurnPrompt (pendiente) ─► <Static>
                          └─► onSubmit(prompt REAL) ─► buildOnComandoEmpleado ─► parsearComando ─► login / crear_empleado
```

Lo único que ve el texto real después del Enter es `onSubmit`. Aguas abajo, logs y auditoría ya excluyen la clave (tests existentes, §7).

---

## 6. Archivos

| Archivo | Acción | Detalle | Líneas est. |
|---|---|---|---|
| `src/core/commands/comando-empleado.ts` | Modificar | `NOMBRES_SECRETOS`, `inicioTramoSecreto`, `enmascararSecreto`, `contieneSecreto` y sus doc-comments. Se corrige el comentario de `:113` (*"`true` SOLO para `/login`"* → `/login` y `/crear-empleado`, consumido además por la máscara de la TUI, ADR 300) | +35-45 |
| `src/core/commands/comando-empleado.test.ts` | Modificar (sólo agregar) | `describe` nuevo (§7, U1-U7) | +70-90 |
| `src/adapters/tui/App.tsx` | Modificar | Import, `PromptInput`, `submitDraft` y doc-comments (§4) | +20-35 |
| `src/adapters/tui/App.test.tsx` | Modificar (sólo agregar) | `describe` nuevo (§7, T1-T8) | +80-110 |
| `docs/ARC42_Harness_Empresarial.md` | Modificar | ADR 300 (§2) y reescritura del Riesgo 5 (R1) `:792-800` | +25-35 |
| `openspec/changes/comandos-administracion-empleados/design.md` | Modificar | Nota de reemplazo junto a `:256` (no se reescribe): *"Reemplazado por ADR 300 (`enmascarar-password-en-tui`): la contraseña ya no se ve en el transcripto; la rotación pasa a recomendada, porque el administrador sigue conociendo la clave inicial (R9)"* | +2-4 |
| `docs/progreso/v3.XX-enmascarar-password-en-tui/` | Crear | Evidencia manual en una terminal real (§7) | +20-30 |
| `tui-port.ts`, `start-tui.tsx`, `build-on-comando-empleado.ts`, `main.ts`, `src/adapters/web/**`, `src/empleados.ts` | **Sin cambio** | Si aparecen en el diff, el change se salió del alcance | 0 |

**Total estimado: ≈ 250-350 líneas** (≈ 150-200 sin contar los tests de UI). Es más que la propuesta (150-240) porque la paridad y los frames se testean en serio, pero sigue **por debajo de 400**: entra en **un solo PR**.

Specs base: `openspec/specs/` está vacío (sólo `.gitkeep`) y las capabilities viven sin archivar en otros changes. Los tres deltas de este change ya cubren los requirements afectados; no hay nada más que editar en specs.

---

## 7. Estrategia de tests (TDD estricto, `vitest`, `npm test`)

Cada test se escribe **en rojo antes** que el código que lo pone en verde.

### 7.1 Unitarios del helper — `comando-empleado.test.ts`, `describe` nuevo

| # | Caso | Cubre |
|---|---|---|
| U1 | `it.each` con los scenarios literales del spec: `/login ana s3cret`, `/login ana s3cr et` (7 `*`), `/crear-empleado bob abc`, `  /login  ana  pw` → `  /login  ana ***` | spec `comando-empleado-tui` |
| U2 | Intactos: `/login`, `/login ana`, `/login ana `, `/crear-empleado bob`, `/estado-bot-prs`, `/soporte ayuda con mi clave`, `hola /login x y`, `""` | idem |
| U3 | **Residual fijado**: `/logni ana secreto`, `/Login ana secreto` y `/login\tana secreto` quedan intactos (R2) | R2 |
| U4 ★ | **Paridad con el parser (oráculo, §3.1 (c))**. Para **cada** descriptor de `COMANDOS.filter(d => d.secreto)` × una tabla de variantes de espaciado (simple, espacios al inicio, dobles, internos, de cola, `\t` después del separador, clave de 1 carácter): si `parsearComando(t)` devuelve `password`, entonces `m = enmascararSecreto(t)` cumple `m.length === t.length`; `m` coincide con `t` hasta el primer `*` y desde ahí es `/^\*+$/`; y el tramo `[t.trimEnd().length - password.length, t.trimEnd().length)` queda dentro de la parte de `*`. Si un descriptor secreto **no** produce un campo `password`, el test **falla** con un mensaje explícito, para que un secreto futuro con otro nombre de campo obligue a revisar el test | R1 |
| U5 | **Tecla a tecla**: para cada prefijo de `/login ana s3cr et` y de `/crear-empleado bob secreto-largo-123`, lo que sigue a `"<cmd> <id> "` es sólo `*` | Borrador |
| U6 | `contieneSecreto`: `true` para U1 y para `/login ana ***`; `false` para U2 y U3 | Historial |
| U7 | Propiedades: idempotencia (`f(f(x)) === f(x)`) y `f(x).length === x.length` sobre U1-U5; un emoji dentro de la clave produce 2 `*` | ADR 300 pto 4 |

`comando-empleado.test.ts:556-558` (el conjunto de secretos es exactamente `/login` y `/crear-empleado`) **no se edita**: fija el mismo `filter` que recorre U4.

### 7.2 UI — `App.test.tsx`, `describe("secret masking (ADR 300)")` nuevo

| # | Caso | Cómo |
|---|---|---|
| T1 | Borrador enmascarado mientras se tipea | `stdin.write` carácter a carácter de `/login ana secreto`. `lastFrame()` contiene `> /login ana *******`, y **ningún** elemento de `frames` (ink-testing-library los acumula) tiene, en la línea del input, algo distinto de `*` después de `/login ana ` |
| T2 | `onSubmit` recibe el texto real | `toHaveBeenCalledWith("/login ana secreto", expect.any(Function))` |
| T3 | Eco del turno pendiente y de `<Static>` | `onSubmit` con `deferred()`: el turno pendiente muestra `Vos: /crear-empleado ana *****************`; se resuelve, se espera la respuesta con `waitFor` y se verifica que `frames.every(f => !f.includes("secreto-largo-123"))` |
| T4 | Backspace | Con `/login ana secreto` + `BACKSPACE`, el frame muestra `> /login ana ******`, y al enviar, `onSubmit` recibe `/login ana secret` |
| T5 | Historial | Se envían `hola` y `/login ana secreto`, y después `ARROW_UP`: se ve `> hola`. Ningún frame posterior al ↑ contiene `/login ana` |
| T6 | Regresión | `hola`, `/estado-bot-prs` y `/login ana` se ven sin cambios en el borrador y el eco, y los tres se recuperan con ↑ |
| T7 | Residual del typo | `/logni ana secreto` se ve tal cual (fija R2) |
| T8 | `PromptInput` directo | `PromptInput({ draft: "/login ana pw" })` → el hijo `<Text>` es `> /login ana **`. Mismo molde que `:1031-1048` |

**Tests existentes: ninguno se edita.** Las ~27 referencias de `App.test.tsx` usan prompts sin secreto (`hola`, `primero`, `linea1 linea2`, etc.) y siguen verdes tal cual.

**Gotchas de ink-testing-library**:

- Su `stdout` no tiene `rows`: el relleno es 0 (`computeFillerLines(undefined)`).
- `lastFrame()` no trae color: sólo se afirma sobre texto.
- El volcado de `<Static>` sí aparece en `lastFrame()`/`frames` (lo usan `:357-365`).
- Conviene reusar `renderApp`, `waitFor`, `deferred`, `ENTER`, `BACKSPACE` y `ARROW_UP` (`:59`, `:172-191`).

### 7.3 No regresión en logs y auditoría

`build-on-comando-empleado.test.ts:568-569` y `:2670-2671`, y `comando-empleado.test.ts:394-396`, **no se editan y deben seguir verdes**. No se agregan tests ahí, porque el dispatcher no cambia. El guardarraíl es el diff: `build-on-comando-empleado.ts` no puede aparecer.

### 7.4 Evidencia manual (`docs/progreso/…`)

En una terminal real (Windows Terminal):

1. Tipear `/login`, borrar con backspace, enviar y apretar ↑.
2. Repetir con `/crear-empleado` como administrador.
3. **Probar H1**: tipear durante *"Pensando..."* y registrar qué eco hace la tty.

Se dejan capturas.

---

## 8. Riesgos y residuales

| # | Riesgo | Prob. | Mitigación / estado |
|---|---|---|---|
| R1 ★ | La máscara diverge del parser y se enmascara de menos | Baja (tras el diseño) | Mismo archivo y mismas primitivas; U4 recorre **todos** los descriptores secretos con el parser como oráculo; U5 cubre el tecleo. El único desvío es sobre-enmascarar espacios de cola (§3.2) |
| R2 | Un typo (`/logni`, `/Login`) o un tab como separador (sólo si se pega texto: la tecla Tab se ignora, `:682`) deja la clave visible | Cierta | **Residual declarado**. Es la misma normalización que el parser, que tampoco lo trata como login. Lo fijan U3 y T7; la ayuda ya no repite la clave (`comando-empleado.test.ts:394-396`) |
| R7 | El CLI `empleados.ts` hace eco de la clave | Cierta | Fuera de alcance (ADR 33). Se documenta |
| R8 | Choque del ADR 300 con el hermano `reembolso-resta-monto-vendido-en-reporte`, que no tiene carpeta. También, por número de hito, con `respaldo-y-durabilidad-sqlite` (`v3.20`) | Media | Este diseño **reserva el ADR 300 y la RD-172**. El hermano debe arrancar en **ADR 301 / RD-173** o reverificar el techo al mergear. Si igual colisiona, prefijar por change (Deuda 11). Respaldo no choca por ADR (usa 232/247/259-262) |
| R9 | El administrador conoce la clave inicial que tipeó | Cierta | Rotación por CLI **recomendada** [CP punto 5] |
| **R10** ★ | Durante un turno pendiente, raw mode está apagado y **la tty hace eco** de lo que se tipea (H1) | Baja (hay que tipear una clave mientras el agente piensa) | **Residual declarado, fuera de alcance.** Cerrarlo exige dejar `isActive` siempre en `true` y descartar la entrada con `pendingRef`, lo que cambia una decisión documentada del módulo (`:31-50`) y el comportamiento del tecleo anticipado. Se verifica a mano (§7.4). Pregunta al checkpoint (§10) |
| R11 | Al archivar, el delta de `autenticacion-empleado-tui` modifica el mismo párrafo del Purpose (*Fuera de alcance*) que `sesiones-web-persistentes` | Media | El delta ya compone ambos estados (su nota de proceso). `sdd-archive` debe fusionar, no pisar |
| R12 | Pegado largo o con saltos de línea | Baja | `\r\n` se colapsa a un espacio (`:705`) **antes** de la máscara, así que un salto dentro de la clave queda como espacio interno enmascarado. La máscara es O(n) por render y no cambia el ancho, así que el wrapping queda igual que hoy |
| R13 | Clave hecha sólo de `*` | Muy baja | La cubre el predicado estructural `contieneSecreto` (no entra al historial). El borrador la muestra igual: es inherente |
| R14 | Surrogate suelto o emoji | Muy baja | Unidades UTF-16 (§3.1): la máscara nunca dibuja un surrogate suelto de la clave |

---

## 9. Despliegue, documentación y rollback

**Sin migración**, sin variables de entorno y sin dependencias npm nuevas.

Documentación a actualizar **en el apply**, no ahora:

- `comando-empleado.ts:113`.
- El módulo doc de `App.tsx` (§4 punto 5).
- ADR 300 y Riesgo 5 (R1) del arc42 (`:792-800`: título, descripción, mitigación *"recomendada"* y condición de disparo *"cumplida por ADR 300"*).
- La nota de reemplazo en `comandos-administracion-empleados/design.md:256`.

**Rollback**:

1. `git revert` de los commits del change.
2. Revertir sólo `App.tsx` ya devuelve la conducta anterior. El helper queda inerte.
3. Si se revierte, el ADR 300 queda marcado *revertido* en el arc42 y el Riesgo 5 vuelve a exigir la rotación obligatoria.

---

## 10. Secuencia sugerida, decisiones asumidas y preguntas abiertas

**Orden lógico** (la división en tareas la hace `sdd-tasks`):

| # | Unidad | Commit | Autónoma |
|---|---|---|---|
| 1 | U1-U7 en rojo → `enmascararSecreto`/`contieneSecreto` → verde; comentario de `:113` | `feat(core)` | Sí: aditiva e inerte |
| 2 | T8 + T1/T4/T7 en rojo → `PromptInput` enmascara | `feat(tui)` | Sí |
| 3 | T2/T3/T5/T6 en rojo → `submitDraft` (eco e historial) + doc-comments de `App.tsx` | `feat(tui)` | Sí |
| 4 | Evidencia manual (incluida H1) | `docs(root)` | — |
| 5 | ADR 300, Riesgo 5 del arc42 y nota de reemplazo en `comandos-administracion-empleados` | `docs(arc42)` | Sí |

`400-line budget risk: Low`. Un PR.

**RD-172**: se asumen los defaults recomendados de la propuesta.

- D2 (a): el helper vive en el núcleo.
- D3: la máscara usa longitud real.
- D4: las líneas con secreto no se guardan en el historial.
- D5: `TurnRecord.prompt` se guarda enmascarado.
- Punto 5: la rotación pasa a **recomendada**.

Si el checkpoint elige **máscara fija** (D3), cambian §3.2 y U1/U5/T1/T4, porque la longitud deja de ser un invariante. Si elige **guardar enmascarado** (D4), `contieneSecreto` pasa a decidir qué versión se guarda y T5 cambia.

**Preguntas abiertas**:

- [ ] **Checkpoint**: ratificar el ADR 300, RD-172 y el número de hito. `v3.21` si `respaldo-y-durabilidad-sqlite` conserva `v3.20`.
- [ ] **Checkpoint**: ¿se acepta **R10** (eco de la tty durante un turno pendiente) como residual, o se abre un change para mantener raw mode activo? Recomendado: aceptarlo y verificarlo a mano.
- [ ] **Checkpoint**: ¿se acepta **R2** (typo visible)?
- [ ] **`sdd-spec` (ajuste menor)**: el requirement de `autenticacion-empleado-tui` dice *"para todo texto que la función de enmascarado transforme"*. Conviene decir *"que tenga tramo secreto (`contieneSecreto`)"*, para que una clave hecha sólo de `*` tampoco entre al historial (R13). Si no se ajusta, el diseño sigue cumpliendo el spec (lo que no se guarda es un superconjunto), pero el scenario *"los demás prompts se comportan como hoy"* queda técnicamente violado en ese caso borde.
