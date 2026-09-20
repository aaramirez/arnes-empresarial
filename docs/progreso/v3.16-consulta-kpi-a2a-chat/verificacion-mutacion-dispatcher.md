# Verificación por mutación manual — dispatcher `ejecutarConsultarKpi` (tarea 12.1)

Excepción TDD (design §13.3): con la tarea 9.2 aplicada, el test 12 nació verde. Cada mutación se aplicó
**temporalmente** sobre `src/core/operaciones/ejecutar-operacion.ts` (copia del original aparte, sin `git checkout`),
se corrió `src/core/operaciones/ejecutar-operacion.test.ts`, se restauró la copia y se confirmó `cmp` byte a byte,
y el archivo volvió a verde (150/150). Tras la última reversión: `git diff HEAD -- src` vacío y `npm test` verde.

## M1 — `material` inline: `insumo: { instruccion: INSTRUCCION_CONSULTA_KPI, material: "lo que sea" }` — grupo (b) FALLA

```
FAIL (v) test 12 — el cuerpo de ejecutarConsultarKpi no reimplementa el marco, no escribe el insumo como literal y no crea un caso propio
AssertionError: expected 'unction ejecutarConsultarKpi(\r\n  op…' not to match /material\s*:\s*["'`]/
FAIL (i) test 24 — {kpis_del_mes, incidentes_abiertos, incidentes_criticos, estado_general}: delegar recibe kpi-incidente y la tarea que arma el nucleo con instruccion y material del catalogo
Tests  5 failed | 145 passed (150)
```
Verde tras revertir: `Tests 150 passed (150)`.

## M2 — marco armado a mano (importando `ROTULO_EXTERNO_NO_CONFIABLE`, `MARCA_EXTERNO_INICIO`, `MARCA_EXTERNO_FIN` y concatenándolos) — grupo (a) original NO FALLA (SUPERVIVIENTE) -> ATRAPADA tras el refuerzo de 12(a)

Mutación (exacta a la tarea): `const texto = "resultado de la consulta — " + ROTULO_EXTERNO_NO_CONFIABLE + " " + MARCA_EXTERNO_INICIO + " " + delegacion.resultado + " " + MARCA_EXTERNO_FIN;`

```
FAIL (iv) test 25 — un cierre forjado (y uno en minusculas) ... no abre ni cierra otro bloque   expected 2 to be 1
FAIL (v) test 14 — un resultado de 5000 caracteres queda acotado dentro del marco y la nota ...   expected 5002 to be less than or equal to 1000
Tests  2 failed | 148 passed (150)      <- el test 12 NO está entre los fallos
```
El grupo (a) del test 12 hace `expect(cuerpo).not.toContain(<valor de la constante>)`. Si la mutación importa las
constantes y las usa **por identificador**, el cuerpo contiene el *nombre* y no el *valor*, así que (a) pasa. La
mutación la atrapan sólo tests de **comportamiento** (25 y 14: escape y truncado que `enmarcarTextoExterno` hace y el
marco manual no). Verde tras revertir: 150/150.

### M2b (evidencia complementaria) — mismo marco con los **literales** `"<<<EXTERNO:INICIO>>>"` / `"<<<EXTERNO:FIN>>>"` — grupo (a) FALLA
```
FAIL (v) test 12 ...
AssertionError: expected 'unction ejecutarConsultarKpi(\r\n  op…' not to contain '<<<EXTERNO:INICIO>>>'
```
Conclusión: el grupo (a) tiene dientes contra literales tipeados, no contra el uso de las constantes exportadas.

### M2 tras el refuerzo (opcion A, decision del humano) — ATRAPADA

Que faltaba: 12(a) sólo veía valores literales; una mutacion que usa las constantes por identificador quedaba
fuera. Que se agrego (test 12, `ejecutar-operacion.test.ts`, test nuevo de este change): junto a las tres aserciones
existentes (intactas), `expect(cuerpo).not.toMatch(/MARCA_EXTERNO_|ROTULO_EXTERNO/)` sobre el cuerpo recortado por
NOMBRE con `cuerpoDeFuncion` (mismo criterio que el test 9a de v3.15). `enmarcarTextoExterno(` NO se prohibe (el
cuerpo debe llamarla). El recorte no arrastra el doc-comment de `ejecutarOperacion` (no menciona esos identificadores).

Re-corrida de M2 (import temporal de las tres constantes y marco concatenado en lugar de `enmarcarTextoExterno`):
```
FAIL (v) test 12 — el cuerpo de ejecutarConsultarKpi no reimplementa el marco (ni por literales ni por las constantes importadas), ...
AssertionError: expected 'unction ejecutarConsultarKpi(
  op…' not to match /MARCA_EXTERNO_|ROTULO_EXTERNO/
Tests  1 failed | 149 skipped (150)      <- corrida filtrada por "test 12"
```
Restauracion: `cmp` de `ejecutar-operacion.ts` contra su copia previa = identico; `git diff --stat` de ese archivo vacio.
Con el test reforzado y el codigo original: `npm test` 150 archivos | 2906 tests verdes; `npm run typecheck` verde.

## M3 — `createCaso(...)` en la función (import temporal de `../../adapters/memory/repository.js`; llamada bajo un `if` que no se ejecuta, para aislar el grupo) — grupo (c) FALLA

```
FAIL (v) test 12 ...
AssertionError: expected 'unction ejecutarConsultarKpi(\r\n  op…' not to match /createCaso/
Tests  1 failed | 149 passed (150)
```
Verde tras revertir: 150/150.

## Confirmación

`cmp` de cada archivo contra su copia previa: idéntico tras M1, M2, M2b y M3. `git diff HEAD -- src/core/operaciones/ejecutar-operacion.ts`
vacío. `npm run typecheck` verde. `npm test`: 150 archivos pasan | 1 omitido; 2906 tests pasan | 3 omitidos.
