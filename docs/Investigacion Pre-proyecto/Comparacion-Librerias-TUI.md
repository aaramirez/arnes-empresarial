# Comparación de librerías TUI para Node.js/TypeScript

**Objetivo específico 3** de la propuesta de pasantía: identificar las librerías existentes para implementar interfaces de usuario a través del terminal (TUI), y entregar un listado evaluado eligiendo la más óptima para el proyecto.

**Restricción de partida**: el lenguaje ya fue decidido en el objetivo 2 ([Comparacion de lenguajes.pdf](Comparacion%20de%20lenguajes.pdf)) — TypeScript sobre Node.js. Este documento evalúa únicamente librerías TUI del ecosistema Node.js/npm, descartando por alcance las opciones de otros lenguajes (p. ej. Textual/Rich en Python, Bubble Tea en Go), que ya se compararon como parte del ecosistema general en el objetivo 2.

## Candidatas evaluadas

| Librería | Qué es | Estado real (2026) |
|---|---|---|
| **Ink** | Renderer de React para terminal — JSX/componentes, Flexbox vía Yoga | Activa, mantenida por Vadim Demedes, adoptada por herramientas de gran escala |
| **blessed / neo-blessed** | Librería imperativa de widgets ncurses-like (cajas, listas, tablas) | `blessed` original sin releases desde ~2016; `neo-blessed` es un fork comunitario que la mantiene viva parcialmente |
| **blessed-contrib** | Extensión de `blessed` con gráficos/dashboards (sparklines, gauges) | Depende de `blessed`, mismo problema de mantenimiento heredado |
| **terminal-kit** | Librería de bajo nivel para control de terminal (cursor, color, input) sin modelo de componentes | Activa, pero es una capa más primitiva — no resuelve layout complejo por sí sola |
| **Enquirer** | Librería de *prompts* interactivos (preguntas, selección) — no es un framework de TUI completo | Activa, pero fuera de alcance: sirve para wizards puntuales, no para una interfaz persistente tipo chat/dashboard |

## Criterios de evaluación

| Criterio | Por qué importa para este arnés |
|---|---|
| Modelo de componentes declarativo | El arnés renderiza una conversación multi-turno con estado cambiante (spinners, streaming de tokens, listas de mensajes) — un modelo declarativo evita gestión manual de redibujado |
| Reactividad ante streaming | El Claude Agent SDK emite eventos de forma incremental; la UI debe reaccionar a cada evento sin lógica de diffing manual |
| Soporte de testing | El proyecto corre en **modo TDD estricto** (ver `AGENTS.md`) — se necesita una librería de testing de snapshots/interacción para la TUI, no solo para el core |
| TypeScript nativo | Tipado end-to-end sin `@types` de terceros desactualizados |
| Ecosistema de componentes | Spinners, inputs, selects, etc. ya resueltos por el ecosistema en vez de construirlos a mano |
| Adopción en la industria | Señal de mantenimiento a largo plazo y de que el patrón escala a herramientas reales, no solo demos |

## Matriz de evaluación

| Librería | Componentes declarativos | Reactividad a streaming | Testing de primera clase | TypeScript nativo | Ecosistema | Adopción real |
|---|---|---|---|---|---|---|
| **Ink** | ✅ JSX/React | ✅ (reconciliación de React) | ✅ `ink-testing-library` | ✅ | ✅ (`ink-spinner`, `ink-text-input`, `ink-select-input`, `ink-table`...) | Alta — npm CLI, Gatsby CLI, Prisma, Cloudflare Wrangler, GitHub Copilot CLI |
| blessed / neo-blessed | ❌ imperativo (`screen.append(box)`, `screen.render()` manual) | ⚠️ manual (hay que llamar `render()` en cada cambio) | ❌ sin librería de testing dedicada | ⚠️ tipos de terceros, parcialmente desactualizados | ⚠️ amplio pero disperso, mucho código sin mantenimiento | Media — muchas herramientas legacy, pocas nuevas |
| blessed-contrib | ❌ (hereda de blessed) | ⚠️ manual | ❌ | ⚠️ | ✅ para gráficos/dashboards específicamente | Baja-media, nicho de dashboards |
| terminal-kit | ❌ (API de bajo nivel) | ⚠️ manual | ❌ | ✅ | ⚠️ básico (cursor, color, progreso), sin layout complejo | Media, uso en scripts CLI simples |
| Enquirer | N/A (no es TUI persistente) | N/A | ⚠️ testing de prompts puntuales | ✅ | ⚠️ solo prompts | Alta, pero para otro caso de uso |

## Conclusión

**Ink** es la opción más óptima para este proyecto, no por preferencia estética sino por tres razones concretas y verificables en el propio repositorio:

1. **Reutiliza el modelo mental de React** que el proyecto ya usa como dependencia (`react@18.3.1`) — no hay una segunda API de UI que aprender desde cero.
2. **Resuelve el requisito de TDD estricto**: `ink-testing-library@4.0.0` permite testear la TUI con `render()` y aserciones sobre el `lastFrame()`, algo que `blessed` no ofrece de forma nativa.
3. **Reactividad sin gestión manual de redibujado**: al ser un renderer de React, cada evento de streaming del Claude Agent SDK dispara un re-render automático vía `setState`, evitando el patrón imperativo `screen.render()` de `blessed`/`terminal-kit`, propenso a inconsistencias cuando llegan eventos rápidos.

`blessed`/`neo-blessed` quedan descartadas principalmente por abandono de mantenimiento y ausencia de testing de primera clase — dos riesgos directos para un arnés que debe operar en ambiente empresarial. `terminal-kit` y `Enquirer` no se descartan por calidad sino por alcance: resuelven problemas más acotados (control de bajo nivel, prompts puntuales) que no cubren una TUI persistente tipo chat.

## Relevancia para nuestro arnés

Esta elección ya está en producción en el repositorio: `package.json` declara `ink@^5.2.1`, `ink-spinner@^5.0.0` y `ink-testing-library@^4.0.0` como dependencias, y `src/adapters/tui/` implementa la interfaz sobre estos paquetes. Este documento formaliza por escrito la justificación técnica que hasta ahora solo vivía como decisión implícita de código.
