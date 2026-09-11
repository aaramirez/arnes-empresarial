> Nota de proceso: sin `Bash`/`graphify` disponible en esta sesión — mismo motivo documentado por `proposal.md` de este change y por las specs de `hito-3.0-a2a-servidor`. Se leyó completo `proposal.md` (ADR 103-107, R1-R9, RD-44 a RD-48) y se verificó contra él, sin releer código fuente adicional (el `.d.ts` del SDK y los archivos reales ya están citados con línea exacta en la propuesta). Molde de formato: `openspec/changes/hito-3.0-a2a-servidor/specs/servidor-a2a-jsonrpc/spec.md` (capability con I/O real, separada de su par sin I/O).
>
> No hay spec previa de esta capability — es un spec completo, no una delta. Fuera de alcance: cómo `toQueryOptions` consume la lista devuelta (capability `habilitacion-skills-turno`), y el contenido concreto de la skill real entregada (RD-47, de `sdd-design`).
>
> **Dependencias abiertas hacia `sdd-design`, señaladas y no resueltas acá**: el criterio exacto de "`SKILL.md` inválido" más allá de "ilegible o sin poder derivar el nombre canónico" es RD-45/RD-46; que la ruta base de este cargador y el `cwd` con que el SDK descubre apunten a la misma carpeta es RD-48. Los requirements de abajo fijan lo que el ADR 105 pto 4 ya decidió (la política degrada/aborta por categoría) sin fijar el detalle fino que esas RD dejan pendiente.

# Registro de Skills Specification

## Purpose

Capability nueva. Cubre el cargador de `src/core/skills/` (Caja Blanca 5 del arc42, Deuda 4): escanea `.claude/skills/` de la raíz del repo buscando paquetes `SKILL.md`, valida cada uno, deriva su nombre canónico y devuelve una lista tipada y estable. Es el primer registro del arnés con I/O real de filesystem (ADR 105 pto 4) — testeable con dobles, sin tocar `process.cwd()` ni disco real por defecto.

## Requirements

### Requirement: La ruta base y el lector de filesystem se reciben inyectados, nunca resueltos internamente

El módulo SHALL recibir la ruta base a escanear y el lector de filesystem como parámetros inyectados, con el mismo patrón de DI por parámetro con default que usan `bootstrapHarness`, `newId`/`now` y `queryFn`. El valor de producción de la ruta base SHALL ser `.claude/skills/` relativo a la raíz del repo. El suite por defecto SHALL NOT leer `process.cwd()` ni el disco real al ejercitar este módulo.

#### Scenario: El descubrimiento se testea con un lector doble, sin disco real
- GIVEN un lector de filesystem doble que simula un directorio con dos paquetes válidos
- WHEN se invoca el descubrimiento con ese lector inyectado
- THEN devuelve la lista de skills correspondiente sin que el test toque ningún path real del sistema de archivos

#### Scenario: El valor de producción es `.claude/skills/` de la raíz del repo
- GIVEN el composition root de arranque, sin overrides de test
- WHEN se invoca el descubrimiento con sus valores por defecto
- THEN la ruta base efectiva es `.claude/skills/` relativa a la raíz del repo

### Requirement: El nombre canónico sale del `name` del frontmatter; el nombre del directorio es su fallback, no un desempate

Para cada paquete válido, el sistema SHALL usar el campo `name` del frontmatter de `SKILL.md` como nombre canónico cuando esté presente. Cuando `name` esté ausente, el sistema SHALL usar el nombre del directorio contenedor como fallback. El sistema SHALL NOT tratar ambas fuentes como candidatos a resolver por prioridad configurable — es `name` primero, directorio después, sin tercera vía.

#### Scenario: `name` presente en el frontmatter gana sobre el nombre del directorio
- GIVEN un paquete en el directorio `mi-carpeta/` cuyo `SKILL.md` declara `name: otra-skill`
- WHEN se deriva su nombre canónico
- THEN el nombre resultante es `otra-skill`, no `mi-carpeta`

#### Scenario: Sin `name` en el frontmatter, el nombre del directorio es el canónico
- GIVEN un paquete en el directorio `mi-skill/` cuyo `SKILL.md` no declara `name`
- WHEN se deriva su nombre canónico
- THEN el nombre resultante es `mi-skill`

### Requirement: Orden estable del listado devuelto

El sistema SHALL devolver la lista de skills descubiertas en un orden estable y determinista entre dos ejecuciones sobre el mismo contenido de disco, independiente del orden en que el lector de filesystem inyectado enumere las entradas.

#### Scenario: Dos corridas sobre el mismo contenido producen el mismo orden
- GIVEN un directorio con tres paquetes válidos, listados por el lector inyectado en un orden arbitrario
- WHEN se invoca el descubrimiento dos veces sobre el mismo contenido
- THEN ambas listas resultantes tienen el mismo orden de elementos

### Requirement: Semántica de arranque — carpeta ausente o vacía degrada; `SKILL.md` inválido aborta

Con la carpeta de skills ausente o presente pero vacía, el sistema SHALL degradar: devolver una lista vacía y loguear el hecho, sin impedir el arranque del arnés. Con al menos un `SKILL.md` presente pero ilegible o sin nombre canónico derivable, el sistema SHALL abortar el arranque con `HarnessBootstrapError` (ADR 105 pto 4). Un paquete inválido SHALL NOT degradar silenciosamente junto a los válidos — el criterio exacto de "inválido" más allá de "ilegible o sin nombre derivable" queda para `sdd-design` (RD-45/RD-46).

#### Scenario: Carpeta ausente — el arnés arranca con lista vacía
- GIVEN `.claude/skills/` no existe en la ruta base
- WHEN corre el descubrimiento durante el arranque
- THEN el arnés arranca, la lista de skills es vacía y se loguea el hecho, sin `HarnessBootstrapError`

#### Scenario: Carpeta vacía — mismo resultado que ausente
- GIVEN `.claude/skills/` existe pero no contiene ningún paquete
- WHEN corre el descubrimiento durante el arranque
- THEN el arnés arranca con lista de skills vacía, sin `HarnessBootstrapError`

#### Scenario: `SKILL.md` ilegible o sin nombre canónico derivable aborta el arranque
- GIVEN un paquete cuyo `SKILL.md` no puede leerse o parsearse lo suficiente para derivar un nombre canónico
- WHEN corre el descubrimiento durante el arranque
- THEN el arranque falla con `HarnessBootstrapError`, y no se completa la secuencia de `bootstrapHarness`

### Requirement: Es el tercer registro en la secuencia de arranque de `bootstrapHarness`

El Registro de Skills SHALL integrarse a `bootstrapHarness` como el tercer registro fijado en la secuencia, después de los dos registros in-memory existentes. El sistema SHALL NOT alterar el orden ni el comportamiento de los otros registros ya fijados.

#### Scenario: `bootstrapHarness` fija el Registro de Skills como tercero
- GIVEN una llamada a `bootstrapHarness` con sus dependencias por defecto
- WHEN se inspecciona el orden de registros fijados
- THEN el Registro de Skills aparece en tercer lugar, y los dos registros previos conservan su comportamiento de `v3.0.0`
