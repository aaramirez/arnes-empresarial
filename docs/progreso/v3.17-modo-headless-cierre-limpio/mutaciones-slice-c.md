# Evidencia de mutación — Slice C (`modo-headless-cierre-limpio`, tarea 4.7)

> Generado en la corrida de Fase 4 (tareas 4.1-4.6), sobre la rama
> `hito/v3.17-modo-headless-cierre-limpio`. Cada mutación se aplicó, se
> corrió el test afectado (salida ROJA pegada, resumida a las líneas
> `FAIL`/`AssertionError`), y se **revirtió** antes de seguir. La reversión
> se verificó con `sha256sum` de `git diff -- src` (idéntico antes y después
> de cada mutación) y con `cmp` byte a byte de los siete archivos de
> producción tocados por el slice contra una copia tomada antes de mutar.

## Rojo inicial

Salida real de los dos comandos que exige la metodología, corridos con los
tests nuevos ya escritos y ANTES de tocar producción.

### 4.1 — web (`npm run typecheck` + `npm test -- adapters/web`)

```
$ npm run typecheck   (exit 2)
src/adapters/web/config.test.ts(137,19): error TS2339: Property 'host' does not exist on type 'WebConfig'.
src/adapters/web/config.test.ts(143,19): error TS2339: Property 'host' does not exist on type 'WebConfig'.
src/adapters/web/server.test.ts(1367,50): error TS2353: Object literal may only specify known properties, and 'host' does not exist in type 'WebConfig'.

$ npm test -- adapters/web   (exit 1)
 Test Files  2 failed | 14 passed (16)
      Tests  11 failed | 349 passed (360)
 FAIL  config.test.ts > resolveWebConfig — WEB_HOST ... > passes WEB_HOST=127.0.0.1 through as host, exactly as configured
AssertionError: expected undefined to be '127.0.0.1' // Object.is equality
 FAIL  server.test.ts > startServer — WEB_HOST y la aridad de listen ... > con WEB_HOST=127.0.0.1, listen recibe TRES argumentos ...
AssertionError: expected [ 8080, [Function] ] to have a length of 3 but got 2
 FAIL  server.test.ts > startServer — WEB_HOST y la aridad de listen ... > con un host no enlazable (listen emite 'error') ...
AssertionError: expected "vi.fn()" to be called with arguments: [ 8080, '203.0.113.9', Any<Function> ]
 FAIL  server.test.ts > startServer — close() corta las conexiones ociosas ... > close() invoca server.closeIdleConnections() UNA vez, ANTES de server.close()
AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times
```

Los 11 rojos: 4 de `config.test.ts` (tres `WEB_HOST=<valor>` + el recorte), 3 de
aridad con host (`127.0.0.1`, `::1`, `0.0.0.0`), 1 de host no enlazable, 3 de
`closeIdleConnections` (una vez y antes de `server.close`, sin esperar el
callback, sin `closeAllConnections`).

### 4.3 — webhooks (`npm run typecheck` + `npm test -- adapters/webhooks`)

```
$ npm run typecheck   (exit 2)
src/adapters/webhooks/config.test.ts(129,21): error TS2339: Property 'host' does not exist on type 'WebhookConfig'.
src/adapters/webhooks/config.test.ts(136,19): error TS2339: Property 'host' does not exist on type 'WebhookConfig'.
src/adapters/webhooks/server.test.ts(879,50): error TS2353: Object literal may only specify known properties, and 'host' does not exist in type 'WebhookConfig'.

$ npm test -- adapters/webhooks   (exit 1)
 Test Files  2 failed | 3 passed (5)
      Tests  11 failed | 77 passed (88)
 FAIL  config.test.ts > resolveWebhookConfig — WEBHOOK_HOST ... > passes WEBHOOK_HOST=127.0.0.1 through as host, exactly as configured
AssertionError: expected undefined to be '127.0.0.1' // Object.is equality
 FAIL  server.test.ts > startServer — WEBHOOK_HOST y la aridad de listen ... > con WEBHOOK_HOST=127.0.0.1, listen recibe TRES argumentos ...
AssertionError: expected [ 8787, [Function] ] to have a length of 3 but got 2
 FAIL  server.test.ts > startServer — WEBHOOK_HOST y la aridad de listen ... > con un host no enlazable (listen emite 'error') ...
AssertionError: expected "vi.fn()" to be called with arguments: [ 8787, '203.0.113.9', Any<Function> ]
 FAIL  server.test.ts > startServer — close() corta las conexiones ociosas ... > close() invoca server.closeIdleConnections() UNA vez, ANTES de server.close()
AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times
```

Misma distribución que 4.1 (4 + 3 + 1 + 3 = 11).

### 4.5 — A2A entrante (`npm run typecheck` + `npm test -- adapters/a2a`)

```
$ npm run typecheck   (exit 2)
src/adapters/a2a/server-config.test.ts(136,21): error TS2339: Property 'host' does not exist on type 'A2AServerConfig'.
src/adapters/a2a/server-config.test.ts(143,19): error TS2339: Property 'host' does not exist on type 'A2AServerConfig'.
src/adapters/a2a/server.test.ts(1466,52): error TS2353: Object literal may only specify known properties, and 'host' does not exist in type 'Partial<A2AServerConfig>'.

$ npm test -- adapters/a2a   (exit 1)
 Test Files  2 failed | 5 passed (7)
      Tests  8 failed | 220 passed (228)
 FAIL  server-config.test.ts > resolveA2AServerConfig — HARNESS_A2A_ENTRANTE_HOST ... > pasa HARNESS_A2A_ENTRANTE_HOST=127.0.0.1 como host, exactamente como se configuro
AssertionError: expected undefined to be '127.0.0.1' // Object.is equality
 FAIL  server.test.ts > ... HARNESS_A2A_ENTRANTE_HOST y la aridad de listen ... > con HARNESS_A2A_ENTRANTE_HOST=127.0.0.1, listen recibe TRES argumentos ...
AssertionError: expected [ 8888, [Function] ] to have a length of 3 but got 2
 FAIL  server.test.ts > ... > con un host no enlazable (listen emite 'error') ...
AssertionError: expected "vi.fn()" to be called with arguments: [ 8888, '203.0.113.9', Any<Function> ]
```

8 rojos = 4 de `server-config.test.ts` + 3 de aridad con host + 1 de host no
enlazable. No hay test nuevo de `closeIdleConnections` en A2A (ya existe).

### Nota honesta sobre los tests que nacen verdes

Los tests de "sin `*_HOST`" (clave `host` ausente para ausente / `""` /
`"   "`, aridad de 2 argumentos, ningún argumento string, blancos equivalentes
a ausente, `*_HOST` que no altera puerto ni interruptor) describen el
comportamiento VIGENTE y por eso nacen verdes: son candados de R21. No
tienen rojo propio; se **validan por mutación** (M-C1, M-C2, M-C3 abajo).
El rojo de tipo (`host` inexistente) y de aserción cubre solo las ramas
nuevas.

## Mutaciones

Cada una: cambio aplicado → test afectado corrido → salida ROJA pegada →
revertido y confirmado.

### M-C1 (R21) — default `"0.0.0.0"` en vez de omitir `host`, en los TRES adaptadores

Cambio (en `web/server.ts`, `webhooks/server.ts` y `a2a/server.ts`): reemplazar el
`if/else` de aridad por
`server.listen(deps.config.port, deps.config.host ?? "0.0.0.0", alListen);`.

```
# adapters/web  (10 rojos; incluye también web/index y webhooks/index, que comparten prefijo)
 FAIL  web/server.test.ts > ... > sin WEB_HOST, listen recibe EXACTAMENTE dos argumentos ...
AssertionError: expected [ Array(3) ] to have a length of 2 but got 3
 FAIL  web/server.test.ts > ... > sin WEB_HOST, ningun argumento de listen es un string ...
AssertionError: expected 'string' not to be 'string' // Object.is equality
 FAIL  web/server.test.ts > ... > con WEB_HOST empty string equivale a ausente: listen recibe DOS argumentos
 FAIL  web/server.test.ts > ... > con WEB_HOST blank (spaces only) equivale a ausente: listen recibe DOS argumentos
AssertionError: expected [ Array(3) ] to have a length of 2 but got 3
 FAIL  web/index.test.ts > startWebServer > returns a WebAdapter with the configured port when WEB_PORT is set and listen succeeds

# adapters/webhooks  (5 rojos)
 FAIL  webhooks/server.test.ts > ... > sin WEBHOOK_HOST, listen recibe EXACTAMENTE dos argumentos ...
AssertionError: expected [ Array(3) ] to have a length of 2 but got 3
 FAIL  webhooks/server.test.ts > ... > sin WEBHOOK_HOST, ningun argumento de listen es un string ...
AssertionError: expected 'string' not to be 'string' // Object.is equality
 FAIL  webhooks/index.test.ts > startWebhookServer > returns a WebhookAdapter with the configured port/path ...
AssertionError: expected "vi.fn()" to be called with arguments: [ 9999, Any<Function> ]

# adapters/a2a  (4 rojos)
 FAIL  a2a/server.test.ts > ... > sin HARNESS_A2A_ENTRANTE_HOST, listen recibe EXACTAMENTE dos argumentos ...
AssertionError: expected [ Array(3) ] to have a length of 2 but got 3
 FAIL  a2a/server.test.ts > ... > sin HARNESS_A2A_ENTRANTE_HOST, ningun argumento de listen es un string ...
AssertionError: expected 'string' not to be 'string' // Object.is equality
```

Resultado: ROJO en los **tres** adaptadores. Revertido.

### M-C2 — no recortar blancos (`"   "` pasa como `host`), en los TRES adaptadores

Cambio (en `web/config.ts`, `webhooks/config.ts` y `a2a/server-config.ts`): `env.<X>_HOST?.trim()` pasa a `env.<X>_HOST` (sin recorte).

```
 FAIL  web/config.test.ts > ... > omits the host KEY (never host: undefined) when WEB_HOST is blank (spaces only)
AssertionError: expected true to be false // Object.is equality
 FAIL  web/config.test.ts > ... > trims incidental blanks around a non-blank WEB_HOST
AssertionError: expected '  127.0.0.1  ' to be '127.0.0.1' // Object.is equality
 FAIL  web/server.test.ts > ... > con WEB_HOST blank (spaces only) equivale a ausente: listen recibe DOS argumentos
AssertionError: expected [ 8080, '   ', [Function alListen] ] to have a length of 2 but got 3
# (idem webhooks: 3 rojos; a2a: 3 rojos, con 8787 / 8888 respectivamente)
```

Resultado: ROJO en los tres (web 3, webhooks 3, a2a 3). Revertido.

### M-C3 — asignar `host: undefined` en vez de omitir la clave, en los TRES adaptadores

Cambio: `...(host !== undefined && host !== "" ? { host } : {})` pasa a
`host: host !== undefined && host !== "" ? host : undefined,`.

Los dos candados saltan, cada uno por su lado:

```
$ npm run typecheck   (exit 2)
src/adapters/a2a/server-config.ts(162,3): error TS2375: Type '{ token: string; port: number; host: string | undefined; ... }' is not assignable to type 'A2AServerConfig' with 'exactOptionalPropertyTypes: true'.
src/adapters/web/config.ts(134,3): error TS2375: Type '{ port: number; host: string | undefined; ... }' is not assignable to type 'WebConfig' with 'exactOptionalPropertyTypes: true'.
src/adapters/webhooks/config.ts(83,3): error TS2375: Type '{ secret: string; port: number; host: string | undefined; ... }' is not assignable to type 'WebhookConfig' with 'exactOptionalPropertyTypes: true'.

$ npm test -- adapters/<web|webhooks|a2a>   (exit 1; 3 rojos por adaptador)
 FAIL  ... > omits the host KEY (never host: undefined) when WEB_HOST is missing / is empty string / is blank (spaces only)
AssertionError: expected true to be false // Object.is equality
```

Resultado: `typecheck` ROJO **y** el test `"host" in config === false` ROJO, en los tres. Revertido.

### M-C4 (design §0.2) — quitar `closeIdleConnections()` de web y de webhooks

Cambio: borrar la línea `server.closeIdleConnections?.();` de `close()` en `web/server.ts` y `webhooks/server.ts`.

```
# src/adapters/web/  (3 rojos)
 FAIL  web/server.test.ts > startServer — close() corta las conexiones ociosas ... > close() invoca server.closeIdleConnections() UNA vez, ANTES de server.close()
 FAIL  web/server.test.ts > ... > corta las ociosas SIN esperar el callback de server.close() ...
 FAIL  web/server.test.ts > ... > NO usa closeAllConnections() ...
AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times

# src/adapters/webhooks/  (3 rojos)
 FAIL  webhooks/server.test.ts > ... > close() invoca server.closeIdleConnections() UNA vez, ANTES de server.close()
 FAIL  webhooks/server.test.ts > ... > corta las ociosas SIN esperar el callback de server.close() ...
 FAIL  webhooks/server.test.ts > ... > NO cierra TODAS las conexiones (metodo destructivo) ...
AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times
```

Resultado: ROJO en cada uno. Revertido.

### M-C5 — usar el método que cierra TODAS las conexiones en lugar de `closeIdleConnections()`

Cambio: en `web/server.ts` y `webhooks/server.ts`, la línea pasa a
`(server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();`.

```
# src/adapters/web/  (3 rojos)
 FAIL  web/server.test.ts > ... > close() invoca server.closeIdleConnections() UNA vez, ANTES de server.close()
AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times
 FAIL  web/server.test.ts > ... > NO usa closeAllConnections(): mataria la respuesta de un turno con request en curso
AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1 times

# src/adapters/webhooks/  (3 rojos)
 FAIL  webhooks/server.test.ts > ... > close() invoca server.closeIdleConnections() UNA vez, ANTES de server.close()
AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times
 FAIL  webhooks/server.test.ts > ... > NO cierra TODAS las conexiones (metodo destructivo) ...
AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1 times
```

Resultado: ROJO en ambos, por DOS vías: no se invocó `closeIdleConnections` y sí se
invocó el destructivo. Revertido.

### M-C6 (candado relajado de la 4.2a, design §11.5.1) — tocar `board/` o `env.ts` deja el `it` en ROJO

La 4.2a saca **solo** `src/adapters/webhooks/` de `diffStat([...])` en
`comandos-administracion-empleados-invariantes.integration.test.ts` (`it` de
`:49-53`) y reescribe su título. **Nace verde** (excepción "infraestructura de
suite" de `AGENTS.md`: en el punto donde se aplica, `webhooks/` todavía no
cambió, así que el `diffStat` es vacío con y sin la enmienda). Su valor se
demuestra aquí, por mutación: la enmienda **acotó** el candado, no lo apagó.
Requiere la rama local `main` (existe: `git rev-parse --verify main` OK; el
`describe.skipIf` NO saltó y las 10 aserciones del archivo corrieron).

Cada variante se aplicó por separado y se revirtió antes de la siguiente.

**Variante A — `src/adapters/board/`**: agregar una línea de comentario al final de
`src/adapters/board/labels.ts`.

```
$ git diff --stat main -- src/adapters/board/ src/core/config/env.ts
 src/adapters/board/labels.ts | 2 ++
$ npm test -- comandos-administracion-empleados-invariantes   (exit 1)
 FAIL  ...invariantes.integration.test.ts > ... git diff contra main (tarea 10) > src/adapters/board/ y src/core/config/env.ts NO fueron tocados (ADR 178: ...)
AssertionError: expected 'src/adapters/board/labels.ts | 2 ++\n…' to be '' // Object.is equality
- Expected
+ Received
+ src/adapters/board/labels.ts | 2 ++
+  1 file changed, 2 insertions(+)
 Test Files  1 failed (1)
      Tests  1 failed | 9 passed (10)
```

**Variante B — `src/core/config/env.ts`**: agregar una línea de comentario al final del archivo.

```
$ git diff --stat main -- src/adapters/board/ src/core/config/env.ts
 src/core/config/env.ts | 2 ++
$ npm test -- comandos-administracion-empleados-invariantes   (exit 1)
 FAIL  ...invariantes.integration.test.ts > ... git diff contra main (tarea 10) > src/adapters/board/ y src/core/config/env.ts NO fueron tocados (ADR 178: ...)
AssertionError: expected 'src/core/config/env.ts | 2 ++\n…' to be '' // Object.is equality
- Expected
+ Received
+ src/core/config/env.ts | 2 ++
+  1 file changed, 2 insertions(+)
 Test Files  1 failed (1)
      Tests  1 failed | 9 passed (10)
```

Resultado: ROJO en cada caso, y solo ese `it` (9 de 10 siguen verdes). Ambas
mutaciones revertidas: `cmp` de `labels.ts` y de `env.ts` contra la copia previa
idéntico, y `sha256sum` de `git diff -- src` igual antes y después.

**Control verde** (el par rojo/verde es la evidencia completa): con
`src/adapters/webhooks/` YA tocado por 4.3/4.4 (`git diff --stat main --
src/adapters/webhooks/` → 5 archivos, 296 inserciones, 11 borrados) y
`board/` y `env.ts` intactos (`git diff --stat main -- src/adapters/board/
src/core/config/env.ts` → vacío):

```
$ npm test -- comandos-administracion-empleados-invariantes   (exit 0)
 Test Files  1 passed (1)
      Tests  10 passed (10)
```

Sin la enmienda ese mismo `it` fallaba exactamente por `webhooks/` (visto en la
corrida previa de esta fase: 2 fallos en `npm test`, uno de ellos este).

## Cierre

- Los siete archivos de producción del slice (`web/{config,http,server}.ts`,
  `webhooks/{config,server}.ts`, `a2a/{server-config,server}.ts`) quedaron
  **byte a byte iguales** a la copia previa a las mutaciones (`cmp`), y
  `sha256sum` de `git diff -- src` coincide antes y después de cada una de
  las cinco mutaciones (M-C1..M-C5). Para M-C6 se repitió la verificación
  con un hash nuevo (el árbol ya incluía la edición de la 4.2a) y `cmp` de
  `board/labels.ts` y `core/config/env.ts`.
- Ninguna mutación quedó en `src/`.
