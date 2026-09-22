---
tags: [arnes, investigacion, seleccion-tui]
fuente: "docs/Investigacion Pre-proyecto/Comparacion-Librerias-TUI.md"
---

# Librerías TUI: por qué Ink

Evaluación de librerías TUI del ecosistema Node.js/TypeScript — restringida a ese ecosistema porque el lenguaje ya se decidió en [[Node-vs-Go]].

## Candidatas comparadas

- **Ink** — renderer de React para terminal (JSX, Flexbox vía Yoga). Activa y ampliamente adoptada.
- **blessed / neo-blessed** — widgets imperativos estilo ncurses. Original sin releases desde ~2016; el fork `neo-blessed` la mantiene parcialmente viva.
- **blessed-contrib** — dashboards sobre `blessed`, hereda su problema de mantenimiento.
- **terminal-kit** — control de bajo nivel (cursor, color), sin modelo de componentes.
- **Enquirer** — solo *prompts* puntuales, no una TUI persistente.

## Criterios que decidieron

- **Reactividad ante streaming**: el Claude Agent SDK emite eventos incrementales; Ink reacciona vía `setState` de React sin redibujado manual, a diferencia de `blessed`/`terminal-kit` (`screen.render()` manual).
- **Testing de primera clase**: el proyecto corre en modo TDD estricto — `ink-testing-library` permite testear la TUI con `render()` + `lastFrame()`. `blessed` no tiene equivalente.
- **Reutilización de conocimiento**: el proyecto ya depende de `react@18.3.1` — Ink no agrega una segunda API de UI que aprender.

## Conclusión

Ink gana no por preferencia estética sino porque resuelve directamente dos riesgos concretos del proyecto: mantenimiento (blessed abandonado) y testabilidad (requisito de TDD estricto). Ya está en producción: `package.json` declara `ink@^5.2.1`, `ink-spinner@^5.0.0`, `ink-testing-library@^4.0.0`, e implementada en `src/adapters/tui/`.

## Relevancia para nuestro arnés

Esta decisión es la base técnica de todo `src/adapters/tui/` — ver [[Vision-General]] para cómo se integra con el resto del arnés.
