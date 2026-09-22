---
tags: [arnes, investigacion, arquitectura-arneses, matriz]
fuente: "docs/Investigacion Pre-proyecto/cuadro-comparativo-harness-empresarial.html"
---

# Matriz comparativa — Harnesses de agentes vs. criterios empresariales

Ocho proyectos confrontados contra catorce criterios de diseño empresarial. La pregunta del documento fuente no es "cuál tiene mejor demo", sino cuál fue diseñado para vivir detrás de un webhook, con multi-tenencia, identidad delegada y auditoría regulatoria.

Dos de los ocho documentos analizados **no son harnesses**: [[MEMU]] es un subsistema de memoria (sidecar sin LLM propio) y [[OpenHands]] es explícitamente solo el frontend — el harness real (el Agent Server) no está documentado. Se analizan aparte, fuera de la matriz de puntaje.

## Los 14 criterios

| Código | Criterio | Pregunta |
|---|---|---|
| C1 | Modelo de activación | ¿El ciclo del agente está desacoplado del canal de entrada (webhook, cola, REST/gRPC, cron)? |
| C2 | Persistencia de sesión | ¿Sesiones de larga duración con checkpoint, hibernación y reanudación tras caída? |
| C3 | Concurrencia y multi-tenencia | ¿Aislamiento estricto entre tenants, con cuotas y sandboxing por-tenant? |
| C4 | Identidad y delegación | ¿Cuenta de servicio o delegación on-behalf-of del usuario final autenticado? |
| C5 | Auditoría y trazabilidad | ¿Registro inmutable (append-only), con replay forense de prompt/tool/respuesta? |
| C6 | Gobernanza y guardrails | ¿Aprobación humana, políticas por rol y límites de gasto como primitivas del runtime? |
| C7 | Semántica de fallo | ¿Idempotencia, reintentos con backoff, dead-letter queue y escalamiento sin humano observando? |
| C8 | Integración saliente | ¿Puntos de extensión limpios (MCP) para hablar con sistemas reales, incluido legacy? |
| C9 | Memoria a largo plazo | ¿Memoria por cliente/caso, con residencia de datos y cifrado bien separados del runtime? |
| C10 | Topología de despliegue | ¿Servicio distribuido con escala horizontal (K8s), o proceso único de escritorio? |
| C11 | Contrato y versionado de tools | ¿El catálogo de herramientas evoluciona con versionado y compatibilidad hacia atrás? |
| C12 | Evaluación y regresión | ¿Harness de evaluación separado, con datasets de negocio corriendo en CI? |
| C13 | Observabilidad de negocio | ¿Costo por tenant/caso, tasa de resolución, retorno — no solo latencia y tokens? |
| C14 | Patrones humano-agente | ¿Tablero asíncrono, interrupción por umbral, HITL, handoff limpio — no solo chat síncrono? |

Escala por celda: ● cumple = 1, ◐ parcial = 0,5, ○ ausente = 0.

## El cuadro (seis harnesses reales × 14 criterios)

| Harness | C1 | C2 | C3 | C4 | C5 | C6 | C7 | C8 | C9 | C10 | C11 | C12 | C13 | C14 | Puntaje | Categoría |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| [[DeerFlow]] | ● | ● | ● | ◐ | ◐ | ◐ | ◐ | ● | ● | ● | ◐ | ○ | ◐ | ◐ | **9,5/14** | Empresarial |
| [[Opencode]] | ● | ● | ◐ | ◐ | ◐ | ◐ | ◐ | ● | ◐ | ● | ◐ | ◐ | ◐ | ◐ | **9,0/14** | Empresarial |
| [[Hive]] | ● | ◐ | ◐ | ◐ | ◐ | ● | ◐ | ● | ◐ | ◐ | ○ | ◐ | ● | ● | **9,0/14** | Empresarial |
| Pi Agent Harness *(no tiene nota propia en este vault)* | ◐ | ● | ◐ | ◐ | ○ | ○ | ○ | ◐ | ◐ | ◐ | ◐ | ● | ○ | ◐ | **6,0/14** | Asist. dev |
| [[Codex]] | ◐ | ◐ | ○ | ◐ | ○ | ● | ○ | ● | ◐ | ◐ | ◐ | ○ | ○ | ◐ | **5,5/14** | Asist. dev |
| [[Claude-Code]] | ◐ | ◐ | ○ | ○ | ○ | ◐ | ○ | ● | ◐ | ○ | ○ | ○ | ○ | ◐ | **4,0/14** | Asist. dev |

> **Nota de alcance de este vault**: el documento fuente evalúa ocho proyectos, entre ellos *Pi Agent Harness* (Earendil, arquitectura hexagonal). La estructura de esta bóveda no incluye una nota individual para Pi Agent Harness — se deja el puntaje acá por completitud del cuadro, pero su detalle vive únicamente en el documento fuente HTML.

## Las tres categorías

- **Categoría A — Harness de entorno empresarial** ([[DeerFlow]] 9,5 · [[Opencode]] 9,0 · [[Hive]] 9,0): nacieron con cliente/servidor, sesión durable, activación múltiple o gobernanza. Ya traen resueltas varias capas empresariales.
- **Categoría B — Harness de asistencia al desarrollador** (Pi Agent Harness 6,0 · [[Codex]] 5,5 · [[Claude-Code]] 4,0): sesgo "un humano, un terminal, un ciclo". Excelentes como herramienta local; sin multi-tenencia, identidad delegada ni auditoría.
- **Fuera de categoría — no son harness** ([[MEMU]] · [[OpenHands]]): no son la capa de runtime que el marco evalúa. memU resuelve C9 mejor que cualquier harness (multi-host, postgres/pgvector, scope de usuario); OpenHands Agent Canvas es solo el frontend.

## Veredicto del documento fuente

Ningún harness cumple los catorce criterios — y eso es exactamente lo que predice el documento maestro de la investigación ("ningún harness público cubre todos los criterios"). La decisión no es "¿cuál cumple?" sino **"¿cuál me deja menos por construir?"**:

- **[[DeerFlow]] (9,5/14)** — elección por defecto: el más "empresarial de fábrica", frontera Harness/App verificada en CI, per-thread isolation, sandbox con provisioner K8s y multi-canal. Le falta evaluación de regresión (C12) y auditoría forense (C5).
- **[[Opencode]] (9,0/14)** — si se prioriza el núcleo: sesión durable V2, admisión separada de la ejecución (sobrevive a caídas), HttpApi contract-first.
- **[[Hive]] (9,0/14)** — si se prioriza gobernanza: único con HITL, constraints duros, billing y observabilidad de negocio como ciudadanos de primera clase. Punto débil: versionado de tools (C11).
- **[[MEMU]]** no compite en el cuadro, pero ningún núcleo resuelve bien C9: la arquitectura envolvente recomendada por el documento es *núcleo (DeerFlow u OpenCode) + memU para memoria + capa propia de auditoría, versionado y evaluación*.

## Relevancia para nuestro arnés

Nuestro arnés no busca "ganar" esta matriz — el ARC42 del proyecto descarta explícitamente la gobernanza/multi-tenencia por tratarse de un MVP de pasantía corta (ver [[Vision-General]]). Pero el eje de decisión del documento ("cuánto viene resuelto de fábrica vs. cuánto hay que construir") es exactamente el mismo razonamiento aplicado, a otra escala, a la arquitectura hexagonal de nuestro propio núcleo.
