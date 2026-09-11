> Nota de proceso: misma corrida sin `Bash`/`graphify` documentada en `registro-skills/spec.md` de este change. Se leyó completo `proposal.md` (ADR 103-105, R1, R8, R9, Success Criteria) y se buscó, con `Grep`/`Glob`, si alguna spec vigente de `delegacion-subagentes` declara un requisito exhaustivo del estilo *"`toQueryOptions` emite exactamente estas claves"* — el candidato que la propuesta nombra explícitamente (`Modified Capabilities`). Se leyeron completos `openspec/changes/hito-2.0-delegacion-subagentes/specs/delegacion-subagentes/spec.md` y su delta `openspec/changes/hito-2.1-escritura-delegada/specs/delegacion-subagentes/spec.md`. **Resultado: no existe ese requisito exhaustivo.** El único requisito de esa capability que toca `toQueryOptions`/`Options` es *"`options.agents` registra el padre y los tres roles"* (`hito-2.0`, líneas 54-58) — una afirmación positiva sobre la clave `agents`, no un cierre sobre el conjunto completo de claves de `Options`. Por lo tanto `Modified Capabilities: Ninguna` queda confirmado tal cual la propuesta lo declara (línea 88), y este change no incluye ningún archivo de delta sobre `delegacion-subagentes` ni sobre ninguna otra capability existente. Molde de formato: `openspec/changes/hito-3.0-a2a-servidor/specs/solicitud-a2a-entrante/spec.md` (capability sin I/O, hermana de una con I/O real).
>
> No hay spec previa de esta capability — es un spec completo, no una delta. Fuera de alcance: cómo se descubren las skills desde disco (capability `registro-skills`, consumida acá solo como la lista ya resuelta que este módulo recibe como parámetro). **Dependencia abierta hacia `sdd-design`**: el invariante negativo de abajo se verifica acá a nivel de objeto puro (con dobles, sin disco); que ese objeto coincida con la realidad de arranque —que el `cwd` con que el SDK descubre sea el mismo `.claude/skills/` que escaneó `registro-skills`— es RD-48, y no es responsabilidad de esta capability cerrarlo.

# Habilitación de Skills en el Turno Specification

## Purpose

Capability nueva. Cubre `toQueryOptions` (`src/core/turn-selector/invoke-model.ts`) ganando dos claves — `skills` y `settingSources` — sin I/O propio: recibe la lista de skills ya descubierta (por `registro-skills`) y arma el `Options` del turno. Es la mitad sin I/O del entregable: se verifica con objetos puros y dobles, con el mismo estilo que `invoke-model.test.ts` ya usa, sin tocar el disco ni el `~/.claude/` de la máquina que corre el test.

## Requirements

### Requirement: `skills` se emite siempre como `string[]` explícito, nunca `'all'`, nunca omitida — ni con cero skills descubiertas

`toQueryOptions` SHALL emitir la clave `skills` del `Options` resultante como un `string[]` explícito, poblado con los nombres canónicos recibidos como entrada. `toQueryOptions` SHALL NOT emitir `'all'` bajo ninguna circunstancia. Con cero skills descubiertas, `toQueryOptions` SHALL emitir `skills: []` — la clave SHALL NOT quedar omitida, porque omitirla hereda el default del SDK, que no es "skills apagadas" (ADR 104 pto 4).

#### Scenario: Con N skills descubiertas, `Options.skills` las lista explícitas
- GIVEN una lista de nombres canónicos `["consultar-precios", "onboarding"]` como entrada
- WHEN se invoca `toQueryOptions`
- THEN `Options.skills` es exactamente `["consultar-precios", "onboarding"]`, no `'all'`

#### Scenario: Con cero skills descubiertas, `Options.skills` es `[]`, no una clave omitida
- GIVEN una lista de entrada vacía
- WHEN se invoca `toQueryOptions`
- THEN `Options.skills` es `[]`, y la clave `skills` está presente en el objeto resultante

### Requirement: `settingSources` se emite siempre como `['project']` explícito

`toQueryOptions` SHALL emitir la clave `settingSources` del `Options` resultante como el valor fijo `['project']`, en toda invocación, sin excepción por caller. `toQueryOptions` SHALL NOT emitir `[]`, SHALL NOT omitir la clave, y SHALL NOT incluir `'user'` en el arreglo (ADR 105 pto 2).

#### Scenario: `Options.settingSources` es siempre `['project']`
- GIVEN cualquier invocación válida de `toQueryOptions`
- WHEN se inspecciona el `Options` resultante
- THEN `settingSources` es exactamente `['project']`

#### Scenario: Ningún caller puede producir `[]`, omitida o con `'user'`
- GIVEN los distintos callers reales de `toQueryOptions` (TUI, webhooks, `/soporte`, A2A entrante, subagentes)
- WHEN se inspecciona el `Options` que cada uno produce
- THEN en ningún caso `settingSources` es `[]`, está ausente, o contiene `'user'`

### Requirement: Invariante negativo — ninguna skill fuera de `.claude/skills/` del repo queda habilitada, verificado sin disco

`toQueryOptions` SHALL NOT realizar descubrimiento propio de skills ni consultar el filesystem: SHALL limitarse a emitir, como `Options.skills`, exactamente los nombres que recibe como parámetro de entrada — sin agregar, completar ni "enriquecer" esa lista desde ninguna otra fuente (variables de entorno, constantes hardcodeadas, o el `~/.claude/` de la máquina). Consecuencia verificable: el `Options` producido SHALL NOT depender de qué skills existan fuera de `.claude/skills/` del repo.

#### Scenario: Una skill plantada fuera de `.claude/skills/` no aparece habilitada
- GIVEN una lista de entrada que NO incluye el nombre de una skill que existiera, hipotéticamente, en `~/.claude/skills/` de la máquina que corre el test
- WHEN se invoca `toQueryOptions` con esa lista
- THEN `Options.skills` no contiene ese nombre — el resultado depende únicamente del parámetro recibido, no del disco de la máquina

#### Scenario: `toQueryOptions` no abre ningún descriptor de archivo
- GIVEN una suite de test que instrumenta el acceso a filesystem durante la invocación
- WHEN se ejercita `toQueryOptions` con cualquier lista de entrada
- THEN no se registra ninguna operación de lectura de disco originada en este módulo

### Requirement: `skills` y `settingSources` se agregan de forma incremental, sin alterar las seis claves existentes

`toQueryOptions` SHALL seguir emitiendo `agent`, `agents`, `resume`, `allowedTools`, `mcpServers` y `cwd` exactamente con el mismo comportamiento que tenían antes de este change. A diferencia de esas seis claves —donde un caller que omite el parámetro correspondiente obtiene esa clave ausente del `Options`—, `skills` y `settingSources` SHALL emitirse siempre, en toda invocación, sin depender de que el caller pase un valor explícito para ellas.

#### Scenario: Un caller que no pasa parámetros de skills sigue viendo `skills` y `settingSources` en su `Options`
- GIVEN un caller que invoca `toQueryOptions` sin ningún parámetro relacionado con skills
- WHEN se inspecciona el `Options` resultante
- THEN `skills` y `settingSources` están presentes con sus valores por defecto, mientras que las seis claves previas conservan exactamente el comportamiento de `v3.0.0`

#### Scenario: Las seis claves previas no cambian de forma por este change
- GIVEN la suite de test existente de `invoke-model.test.ts` previa a este change
- WHEN se re-ejecuta contra la implementación con `skills`/`settingSources` agregadas
- THEN las aserciones sobre `agent`, `agents`, `resume`, `allowedTools`, `mcpServers` y `cwd` siguen pasando sin modificación
