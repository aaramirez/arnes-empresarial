# Verificación por mutación manual — invariante del gate en el dispatcher (ADR 238 pto 3, tarea 5.7)

**Fecha**: 2026-09-19
**Rama**: `hito/v3.14-consulta-solicitud-propia`, sobre el árbol con las tareas 5.1-5.6 aplicadas.
**Objetivo**: probar que el test mecánico (viii) de la tarea 5.1 (`ejecutar-operacion.test.ts`, "en la porción de consultar_solicitud, el dispatcher no compara solicitanteId con empleadoId") realmente detecta una regresión del invariante del ADR 238 pto 3 — que nazca verde no significa que sea un test vacío, tiene dientes.

## 1. Mutación aplicada

En `src/core/operaciones/ejecutar-operacion.ts`, dentro de `ejecutarConsultarSolicitud`, en la rama `case "detalle"` del switch sobre `resultado.resultado`, se agregó temporalmente una comparación de alcance que el diseño prohíbe explícitamente (el gate vive en `consultarSolicitudPropia`, núcleo, nunca en el dispatcher):

```diff
     case "detalle":
+      if (resultado.solicitud.solicitanteId === input.sesion.empleadoId) {
+        return formatearDetalleSolicitudPropia(resultado.solicitud);
+      }
       return formatearDetalleSolicitudPropia(resultado.solicitud);
   }
 }
```

## 2. Salida en ROJO (con la mutación)

```
$ npm test -- ejecutar-operacion

 ❯ src/core/operaciones/ejecutar-operacion.test.ts (88 tests | 1 failed) 69ms
     × ★★ test mecánico (nace VERDE, tarea 5.1): en la porción de consultar_solicitud, el dispatcher no compara solicitanteId con empleadoId — el gate de alcance vive en consultarSolicitudPropia, no acá (dientes probados en la tarea 5.7) 6ms

 FAIL  src/core/operaciones/ejecutar-operacion.test.ts > ejecutarOperacion — consultar_solicitud (consulta-solicitud-propia, ADR 238, RD-115, tarea 5.1) > ★★ test mecánico (nace VERDE, tarea 5.1): en la porción de consultar_solicitud, el dispatcher no compara solicitanteId con empleadoId — el gate de alcance vive en consultarSolicitudPropia, no acá (dientes probados en la tarea 5.7)
AssertionError: expected '/**\r\n * Ejecución de las ocho opera…' not to match /solicitanteId\s*===\s*[\w.]*empleadoId/

- Expected:
/solicitanteId\s*===\s*[\w.]*empleadoId/

+ Received:
"/**
 * Ejecución de las ocho operaciones del contrato (`operaciones-contract.ts`,
 ... (fuente completa de ejecutar-operacion.ts, incluida la línea mutada
     `if (resultado.solicitud.solicitanteId === input.sesion.empleadoId) {`)
 */
"

 ❯ src/core/operaciones/ejecutar-operacion.test.ts:2012:24
    2010|     const source = readFileSync(sourcePath, "utf-8");
    2011|
    2012|     expect(source).not.toMatch(/solicitanteId\s*===\s*[\w.]*empleadoId…
       |                        ^
    2013|     expect(source).not.toMatch(/empleadoId\s*===\s*[\w.]*solicitanteId…
    2014|   });

 Test Files  1 failed | 1 passed (2)
      Tests  1 failed | 165 passed (166)
```

**Resultado**: falla exactamente el test mecánico (viii) de la tarea 5.1 — el único diseñado para detectar este invariante — y ningún otro test se ve afectado (165/166 en verde). El regex `\s*===\s*[\w.]*empleadoId` matchea `solicitanteId === input.sesion.empleadoId` porque el `\s*` tras `===` consume el espacio y `[\w.]*` consume `input.sesion.` antes del literal `empleadoId`.

## 3. Reversión

```diff
     case "detalle":
-      if (resultado.solicitud.solicitanteId === input.sesion.empleadoId) {
-        return formatearDetalleSolicitudPropia(resultado.solicitud);
-      }
       return formatearDetalleSolicitudPropia(resultado.solicitud);
   }
 }
```

Se removieron exactamente las tres líneas insertadas (el `if` de comparación, su cuerpo y su llave de cierre), dejando `case "detalle": return formatearDetalleSolicitudPropia(resultado.solicitud);` byte a byte igual al estado posterior a la tarea 5.2 (aplicada en este mismo árbol, sin commitear todavía — el humano commitea las 7 tareas en pasos separados; no hay un commit de 5.2 contra el cual diffear con `git`, pero la reversión fue mecánica: se retiró exactamente lo insertado en el paso 1, sin tocar ninguna otra línea del archivo).

## 4. Salida en VERDE (tras revertir)

```
$ npm test

 Test Files  145 passed | 1 skipped (146)
      Tests  2681 passed | 3 skipped (2684)

$ npm run typecheck
(sin salida — verde)
```

## 5. Segunda mutación (opcional, barata) — `SOLICITUD_PROPIA_SELECT_COLUMNS`

Sobre `src/adapters/memory/repository.ts`, se agregó temporalmente `updated_at` a la lista blanca:

```diff
 export const SOLICITUD_PROPIA_SELECT_COLUMNS =
-  "id, caso_id, solicitante_id, tipo, detalle, estado, dictamen, dictaminada_at, resuelta_por, resuelta_at, created_at";
+  "id, caso_id, solicitante_id, tipo, detalle, estado, dictamen, dictaminada_at, resuelta_por, resuelta_at, created_at, updated_at";
```

### Salida en ROJO

```
$ npm test -- repository

 ❯ src/adapters/memory/repository.test.ts (189 tests | 1 failed) 358ms
           × ★★ no contiene 'updated_at', no contiene '*' y es exactamente el conjunto de las once columnas esperadas 7ms

 FAIL  src/adapters/memory/repository.test.ts > repository > crearSolicitudConCaso / adjuntarDictamenSolicitud / listSolicitudesInternas / aprobarSolicitudInterna / rechazarSolicitudInterna (Hito 5, tarea 19) > SOLICITUD_PROPIA_SELECT_COLUMNS / buscarSolicitudPropiaPorId / listSolicitudesPropiasDeSolicitante (consulta-solicitud-propia, tarea 3.1, ADR 239) > SOLICITUD_PROPIA_SELECT_COLUMNS > ★★ no contiene 'updated_at', no contiene '*' y es exactamente el conjunto de las once columnas esperadas
AssertionError: expected 'id, caso_id, solicitante_id, tipo, de…' not to contain 'updated_at'

Expected: "updated_at"
Received: "id, caso_id, solicitante_id, tipo, detalle, estado, dictamen, dictaminada_at, resuelta_por, resuelta_at, created_at, updated_at"

 Test Files  1 failed | 1 passed (2)
      Tests  1 failed | 366 passed (367)
```

**Resultado**: falla exactamente el test de la tarea 3.1 que fija la lista blanca sin `updated_at` (RD-114 pto 3 / ADR 239).

### Reversión y salida en VERDE

```diff
 export const SOLICITUD_PROPIA_SELECT_COLUMNS =
-  "id, caso_id, solicitante_id, tipo, detalle, estado, dictamen, dictaminada_at, resuelta_por, resuelta_at, created_at, updated_at";
+  "id, caso_id, solicitante_id, tipo, detalle, estado, dictamen, dictaminada_at, resuelta_por, resuelta_at, created_at";
```

```
$ npm test
 Test Files  145 passed | 1 skipped (146)
      Tests  2681 passed | 3 skipped (2684)

$ npm run typecheck
(sin salida — verde)
```

## 6. Resultado

| Criterio de aceptación (tarea 5.7) | Resultado |
|---|---|
| Mutación del gate en `ejecutarConsultarSolicitud` aplicada | ✅ §1 |
| Salida en rojo: falla el test mecánico (viii) de 5.1 | ✅ §2 |
| Reversión limpia (sin residuos de la mutación) | ✅ §3 |
| Salida en verde tras revertir (suite completa + typecheck) | ✅ §4 |
| Verificación opcional y barata sobre `SOLICITUD_PROPIA_SELECT_COLUMNS` | ✅ §5 |

**El criterio de seguridad del change queda demostrado**: el invariante "el dispatcher nunca compara `solicitanteId` con `empleadoId`, el gate vive en el núcleo" (ADR 238 pto 3) no es sólo una afirmación en un test que nace verde por casualidad — una regresión real de tres líneas lo rompe de forma detectable. Lo mismo vale para la lista blanca de columnas de sólo lectura (ADR 239): agregar `updated_at` por error se detecta de inmediato.
