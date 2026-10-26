// A demo element for the editor tests and screenshots (SR-065): fixture content in German, like the
// specification, with every construct the editor shows set. It is not spec text.
export const DEMO_ID = "69069069-0000-4000-8000-0000000000ed";
export const DEMO_FILE = "needs/N-0000000000ed.md";
export const DEMO_TITLE = "Windmessung im Detail";

export const DEMO_TEXT = `# Übersicht

## Zweck

Das Tool muss **sofort** anzeigen, was *geschrieben* wurde, auch ~~Durchgestrichenes~~ und \`Code\`.

- Erster Punkt
- Zweiter Punkt

1. Eins
2. Zwei

- [ ] offen
- [x] erledigt

| Größe | Wert | Einheit |
| :--- | ---: | :---: |
| Wind | 12 | m/s |
| Böe | **25** | m/s |

\`\`\`ts
const wind = 12;
\`\`\`

> Ein Zitat über den Wind.

Siehe [das Beispiel](https://example.org/wind).
`;

export const DEMO_FRONT_MATTER = `---
id: ${DEMO_ID}
type: need
status: draft
title: ${DEMO_TITLE}
---

`;

/** The `files` option of `launchApp`: the demo element in the fixture workspace. */
export const DEMO_FILES = { [DEMO_FILE]: `${DEMO_FRONT_MATTER}${DEMO_TEXT}` };
