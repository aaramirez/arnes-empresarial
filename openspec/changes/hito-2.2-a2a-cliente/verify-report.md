# Verification Report — Hito 6 (v2.2.0) — Comunicacion A2A saliente

**Fecha**: 2026-09-09. **Rama**: hito/v2.2-a2a-cliente (contra main). **Verificador**: sdd-verify, evidencia de codigo real + ejecucion real (no de memoria, no de tasks.md solo).

## Comandos ejecutados

```
npm run typecheck   -> PASS, sin salida (tsc --noEmit sin errores)
npm test             -> PASS
  Test Files  103 passed | 1 skipped (104)
  Tests       1667 passed | 3 skipped (1670)
```

El unico archivo skipped es src/test/integration/a2a-client.integration.test.ts (gateado por sondeo real del Agent Card via top-level await sondearAgentCard(...) - sin sample A2A arriba en este entorno, degrada a skip, no a falla; confirmado leyendo el archivo, linea 110/157). Coincide exactamente con la evidencia citada por docs/progreso/v2.2-a2a-cliente/verificacion-manual-tarea-23.md seccion 7.2 (1667 passed / 3 skipped tras el fix de esta misma sesion).

## Completeness - 23 tareas de tasks.md contra git log real

tasks.md (checkboxes) esta DESACTUALIZADO: solo las tareas 14 y 23 aparecen marcadas [x]; las 1-13 y 15-22 siguen [ ] pese a estar commiteadas. Fuente de verdad real usada: git log --oneline main..HEAD.

```
35 commits Hito 6 en main..HEAD, incluidas las 23 tareas + fixes de code-review + 2 bugs post-review:
18ace4b..48d3348 - tareas 1 a 23, una por commit, en el orden del documento
d5b79c7, 68c42f6, 737ecd8, a235bd7, bad8ffe - 5 commits de code-review post-PR2/PR3
4f2f600 - fix(adapters/a2a): header A2A-Version + desempaquetado SendMessage (verificacion tarea 23)
```

Las 23 tareas estan realmente implementadas y commiteadas. tasks.md sin actualizar es un hallazgo de proceso (WARNING #1 abajo), no de codigo.

## Regla no negociable de arquitectura hexagonal (AGENTS.md)

- grep de imports adapters/a2a dentro de src/core/** (fuera de comentarios) -> 0 resultados. dispatch-delegation.ts, dispatch-delegation-a2a.ts y a2a-contract.ts no importan src/adapters/a2a/ - confirmado leyendo los tres archivos completos, no solo el doc-comment que lo promete.
- src/adapters/a2a/*.ts no importa de ningun otro adaptador (grep de imports relativos fuera de ../../core -> 0 resultados).
- Test explicito que asegura esto en runtime: dispatch-delegation.test.ts (simbolos exportados) y el requirement equivalente de delegacion-a2a-saliente spec ("El caso de uso no importa el adaptador").

Veredicto: CUMPLE.

## Spec compliance - los 4 specs contra el codigo real

### cliente-a2a-jsonrpc (adaptador, src/adapters/a2a/client.ts, config.ts, index.ts)

| Requirement | Evidencia real |
|---|---|
| Agent Card en /.well-known/agent-card.json, primera entrada JSONRPC de supportedInterfaces | extraerEndpointJsonRpc (client.ts:189-207), sin cache (resolverEndpointJsonRpc se llama en cada delegarTarea) |
| Metodos SendMessage/GetTask/CancelTask, PascalCase sin prefijo | Literal en enviarSendMessage/consultarOControlarTarea (client.ts:466, 626, 758) |
| Loop GetTask a pollIntervalMs, timeout total taskTimeoutMs, request timeout independiente | delegarTarea (client.ts:651-784), AbortSignal.timeout(deps.config.requestTimeoutMs) por request individual |
| CancelTask best-effort, nunca cambia reason=timeout | client.ts:723-749, disparado sin await con catch, resultado solo logueado |
| Clasificacion transporte/protocolo, TaskState desconocido -> protocolo sin crash | estadoDeTarea usa esTaskStateConocido del nucleo (ADR 84) |
| Truncado de error a 500 chars, sin credenciales en el mensaje | ERROR_BODY_MAX_CHARS=500/truncate() (client.ts:66-70); Authorization solo se arma en construirHeaders, nunca se pasa a logEvent/mensaje - confirmado por 6+ tests dedicados en client.test.ts (lineas 133, 314, 822, 912+) |
| Ninguna firma publica acepta una URL arbitraria | ClienteA2APort.baseUrlDe(clave)/delegar({clave,...}) - solo DestinoA2AClave (a2a-contract.ts:169-176) |
| Unico test con red real, gateado por sondeo | a2a-client.integration.test.ts, top-level await sondearAgentCard(...), describe.skipIf |

Estado: CUMPLE, con evidencia de ejecucion real (npm test en verde, integracion skipped limpio) y evidencia de campo (ver seccion "Verificacion manual" abajo).

### delegacion-a2a-saliente (nucleo)

| Requirement | Evidencia real |
|---|---|
| Registro estatico de 2 claves, resueltas por env, el llamador elige | DESTINOS_A2A = exactamente ["riesgo-credito","kpi-incidente"] (a2a-contract.ts:112-117); resolverDestinoA2A valida contra el registro cerrado |
| ClienteA2APort inyectable, sin red en tests de nucleo | dispatch-delegation-a2a.test.ts usa dobles puros; ClienteA2APort declarado sin imports en a2a-contract.ts |
| Registrar antes de invocar, completar despues | despacharDelegacionA2A (dispatch-delegation-a2a.ts:210-261): crearDelegacionA2A con TASK_STATE_SUBMITTED ANTES de cliente.delegar(), actualizarDelegacionA2A SIEMPRE despues |
| TASK_STATE_* persistido crudo, terminalidad exhaustiva sobre 8 valores | esEstadoTerminal/motivoDeEstadoTerminal (a2a-contract.ts:72-108), test exhaustivo en a2a-contract.test.ts |
| Despachador bloquea, nunca deja esperando A2A | await cliente.delegar(...) dentro del mismo await que invoca despacharDelegacionA2A - sin cola, sin scheduler, verificado leyendo el archivo completo |
| Desenlaces exhaustivos, ninguno enmascara el error real | patch de despacharDelegacionA2A (lineas 242-259): COALESCE-friendly (siDefinido), NUNCA fabrica TASK_STATE_FAILED (fix de code-review confirmado en repository.ts:1801-1808, actualizarDelegacionA2A con COALESCE) |
| Tarea delegada reusa TAREA_DELEGADA_MAX_CHARS=8000, sin AgentDefinition | construirTareaDelegadaA2A -> ensamblarTareaDelegada (helper compartido con subagents.ts, tarea 11) |
| Interruptor HARNESS_A2A_SALIENTE, off reproduce v2.1.0 exacto | main.ts:354-421: clienteA2A/riesgoCredito quedan undefined, spread condicional (exactOptionalPropertyTypes) |
| /consultar-kpi, comando privilegiado, un solo paso, consulta obligatoria | Descriptor en comando-empleado.ts:224-235, privilegiado:true, forma:id_mas_resto |
| /consultar-kpi productor real, espera el desenlace | manejarConsultarKpi (build-on-comando-empleado.ts:1160-1197) awaitea despacharDelegacionA2A completo antes de responder |
| Cada motivo de fracaso -> mensaje distinto | mensajeDeMotivoA2A (build-on-comando-empleado.ts:620-639), switch exhaustivo sobre los 8 MotivoDelegacionA2ANoCompletada, SIN default: un noveno motivo seria error de compilacion |

Estado: CUMPLE, con la salvedad documentada de RD-21 (ver "Atencion especial" abajo - no es una desviacion del codigo respecto del spec, es la lectura debil ya decidida por ADR 76).

### despacho-delegacion (delta MODIFIED)

- DelegacionA2ANoImplementadaError NO EXISTE en dispatch-delegation.ts (confirmado leyendo el archivo completo: la clase fue borrada, solo queda su mencion en comentarios explicando la historia).
- El test heredado de hito-2.0 que la asserteaba esta borrado (dispatch-delegation.test.ts no lo contiene - confirmado por npm test en verde sin ese caso).
- despacharDelegacion/despacharCadena no cambiaron de forma para el camino in-process (mismo cuerpo, mismo comportamiento).
- ADR 78 VERIFICADO COMO GARANTIA DE COMPILACION REAL, no documental: se armo un archivo TypeScript de prueba (descartado tras la verificacion) que intenta pasar destino con kind "a2a" a despacharDelegacion sin cast - tsc --strict lo rechaza con error TS2322 (el tipo literal "a2a" no es asignable al tipo literal "in-process"). El propio dispatch-delegation.test.ts (linea 69-82) documenta la misma verificacion con un cast explicito para poder ejercitar el runtime, dejando constancia de que sin ese cast el codigo no compila.

Estado: CUMPLE.

### venta-confirmacion (delta ADDED)

- VentasConfig.ventaGrandeUmbral con default 5000, mismo criterio de validacion que reembolsoUmbral (ventas-config.ts, confirmado por npm test en verde de ventas-config.test.ts).
- registrarVenta dispara la consulta SIN AWAIT (registrar-venta.ts:143-161), fire-and-forget con catch, solo cuando input.monto >= config.ventaGrandeUmbral, ANTES de notifier.notificarLinkConfirmacion - orden verificado leyendo el archivo completo.
- clienteEmail no viaja en el insumo de la consulta de riesgo (confirmado: el objeto pasado a consultar() solo tiene casoId/ventaId/clienteId/planAnterior/planNuevo/monto).

Estado: CUMPLE.

## Atencion especial pedida por tasks.md ("Despues de la tarea 23")

- ADR 76/RD-21 (consulta "iniciada" vs "resuelta"): verificado en codigo, no solo en prosa - registrar-venta.ts dispara la consulta sin esperar el resultado; el link de confirmacion se arma y se notifica inmediatamente despues, sin gatear nada sobre el desenlace de la consulta. La lectura debil del spec venta-confirmacion se sostiene exactamente como esta escrita - el propio requirement documenta esto como decision ya cerrada (alternativa b del ADR 76), y el codigo no promete nada mas fuerte. No es una desviacion; es la implementacion literal de una decision de diseno ya tomada por el checkpoint. Ver tambien evidencia de campo: docs/progreso/.../verificacion-manual-tarea-23.md seccion 7.3 confirma con HTTP/DB/log reales que el 201 de /ventas vuelve en menos de 0.4s y la fila de delegaciones_a2a completa segundos despues, de forma asincrona respecto del POST.
- ADR 78 (angostamiento de tipo): confirmado como garantia de compilacion real (ver seccion despacho-delegacion arriba) - no documental.
- ADR 84/RD-27 (noveno TaskState): a2a-contract.test.ts linea 83-89 testea explicitamente que esTaskStateConocido de TASK_STATE_UNSPECIFIED es false (rechazado, cae a protocolo) y que un string inventado tambien lo es - exhaustivo, no parcial.
- ADR 85/RD-30 (espera de hasta 2 min sin barra de progreso): confirmado como decision ya aceptada, no reabierta - no se reporta como hallazgo.
- Las 8 preguntas abiertas de design.md seccion 15 (RD-26 ya resuelta): ninguna bloquea el codigo tal cual quedo escrito. RD-19 (gate de secuencia contra main) esta satisfecho - el arbol de hito-2.1 ya esta en main (confirmado por el propio encabezado de tasks.md, "GATE CUMPLIDO"). Las demas (RD-21, numero de VENTA_GRANDE_UMBRAL, ADR 78/79/84, RD-24 ya resuelta, el corte de 5 PRs) son confirmaciones de diseno ya tomadas por el checkpoint, no defectos de implementacion.

## Bugs post-review encontrados y corregidos (esta misma rama, confirmados en el codigo actual)

Dos bugs reales, documentados en docs/progreso/v2.2-a2a-cliente/verificacion-manual-tarea-23.md secciones 2 y 7, encontrados corriendo el entregable contra samples A2A reales (a2a-samples/helloworld, no simulados):

1. Header A2A-Version faltante - el servidor de referencia (a2a-sdk 1.1.0, el mismo que documenta el propio README del proyecto para correr la integracion) rechazaba toda llamada con VERSION_NOT_SUPPORTED al asumir protocolo legacy 0.3 sin ese header. CORREGIDO: construirHeaders() en client.ts:437-443 agrega el header A2A-Version 1.0 a las 4 llamadas (GET card + 3 POST). Verificado en el codigo actual - no repite el bug original.
2. Desempaquetado incorrecto de SendMessage - SendMessageResponse.result es un oneof con task o message, no un Task plano; el cliente leia result.id directo y siempre fallaba con reason=protocolo antes de llegar al loop de polling. CORREGIDO: parsearSobreDeSendMessage() (client.ts:300-322) dedicada, distinta de parsearSobreDeTarea() (que sigue sirviendo correctamente a GetTask/CancelTask, sin tocar). El caso result.message (agente sin ciclo de vida de Task) se trata explicitamente como protocolo, no como exito fabricado ni como transporte - decision documentada en el propio codigo (client.ts:518-531).

Ambos fueron corregidos con TDD real (rojo a verde, confirmado en el propio reporte de verificacion manual seccion 7.2: 22 tests fallando antes del fix, 44/44 pasando despues) y re-verificados contra los 3 agentes reales (seccion 7.3): POST /ventas sobre el umbral llega a TASK_STATE_COMPLETED real con resultado poblado, y el mismo test de integracion pasa contra kpi-incidente sin una linea de codigo distinta.

No repiten el bug original - confirmado leyendo el codigo de client.ts tal como esta ahora, no de memoria del reporte.

## CRITICAL

Ninguno.

## WARNING

1. tasks.md con checkboxes desactualizados frente a git log real. Solo las tareas 14 y 23 aparecen [x]; las 23 tareas y los 5 commits de code-review estan realmente commiteados y verificados (ver "Completeness" arriba), pero el documento no lo refleja. Antes de archivar el hito, actualizar las 23 casillas a [x] para que el artefacto en openspec/ sea una fuente de verdad honesta del estado real - es exactamente lo que AGENTS.md exige del "repositorio mostrando el proceso de construccion paso a paso".
2. Pasos 7b-7d de design.md seccion 11 (el comando /consultar-kpi en la TUI real) siguen sin demostrarse de punta a punta. docs/progreso/.../verificacion-manual-tarea-23.md secciones 4 y 8 documentan que Ink exige raw mode de terminal, no ejecutable en el entorno headless donde se corrio la verificacion - confirmado con la traza real del error de Ink sobre raw mode no soportado. El mecanismo subyacente SI esta probado (11+ tests unitarios de build-on-comando-empleado.test.ts con dobles, mas el POST /ventas real que ejercita el mismo despacharDelegacionA2A), pero el flujo humano interactivo, que es literalmente la razon de ser del ADR 85 (primer llamador real del camino sincrono), no tiene una demostracion real registrada todavia. El checkpoint humano ya acepto esto explicitamente como pendiente (seccion 8, con los comandos exactos para correrlo en unos 2 minutos documentados en la seccion 4) y no bloqueo el cierre de la tarea 23 por esto. Se reporta aca como WARNING para que quien apruebe el checklist de cierre de hito (AGENTS.md: el entregable funcional se puede demostrar de punta a punta) sepa que ese paso especifico de demostracion humana sigue pendiente al momento de este verify.
3. Paso 9 de design.md seccion 11 (timeout total + CancelTask contra un agente real) solo esta probado a nivel de test unitario (reloj/sueno fake), no de punta a punta contra un agente real. Causa raiz identificada y documentada (seccion 7.4): el SDK de referencia bloquea la respuesta HTTP de SendMessage hasta estado terminal salvo que se pida explicitamente el modo no bloqueante, campo que este cliente no envia (decision consciente, fuera del alcance de este hito). Deuda YA ACEPTADA por el checkpoint humano (seccion 8) - no es un hallazgo nuevo de esta verificacion, se re-confirma que sigue asi en el codigo actual (client.ts no arma ese campo en SendMessageParams, confirmado leyendo la interfaz SendMessageParams lineas 105-112).

## SUGGESTION

1. La linea de dependencias planificadas de openspec/config.yaml (linea 7-8) sigue listando el SDK del agente, better-sqlite3 e Ink como "planned not yet installed" pese a estar instalados y en uso desde Hito 1 - quedo fuera del alcance textual de la tarea 18 (que solo pedia sacar la mencion de A2A, y la saco correctamente), pero es una oportunidad de limpieza menor para un change futuro, no de este hito.
2. RD-21 (ADR 76, lectura debil "iniciada" vs "resuelta") queda abierta por diseno - si el negocio necesita alguna vez la lectura fuerte (bloquear la venta hasta que la verificacion de riesgo resuelva), la propia design.md seccion 15 punto 1 ya deja anotado el mecanismo (una variable de timeout dedicada, hoy deliberadamente inexistente). No es una accion para este verify, solo una constancia de que la perilla no existe todavia si se la llegara a necesitar.

## Veredicto

PASS WITH WARNINGS - aprobado con salvedades. Cero hallazgos CRITICAL: npm test y npm run typecheck en verde (1667 passed, 3 skipped, 0 fallos), las 23 tareas realmente implementadas y commiteadas, los 4 specs cumplidos contra el codigo real (no contra su prosa), la frontera hexagonal intacta, el angostamiento de tipo del ADR 78 confirmado como error de compilacion real, el noveno TaskState del ADR 84 exhaustivamente testeado, y los dos bugs reales encontrados en la verificacion de campo (header A2A-Version, desempaquetado de SendMessage) corregidos con TDD y re-verificados contra 3 agentes A2A reales. Las 3 salvedades (WARNING 1-3) son de PROCESO y de EVIDENCIA DE DEMOSTRACION HUMANA, no de codigo: tasks.md desactualizado, y dos pasos de la verificacion manual (TUI interactiva de /consultar-kpi, y timeout end-to-end contra un agente real) aceptados como deuda documentada por el checkpoint humano, no como codigo roto.
