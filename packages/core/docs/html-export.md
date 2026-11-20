# HTML export (`src/html-export/`, `src/files/export-folder.ts`)

`html.export` writes the workspace as an HTML export (SR-231, SR-235, D-080) into one folder. The pages are static files; nothing is rendered in the browser from element content except Mermaid diagrams, which one copy of the library in the folder draws (SR-231 AK5).

## Files of the export

| Path | What |
| --- | --- |
| `index.html` | Start page |
| `elements/<uuid>.html` | One page per element without an invalid status (D-044). The UUID never changes (D-017), so a link keeps opening the element when its identifier, title or short ID change (SR-231 AK3). An element with an invalid status whose page the earlier export wrote (`ExportFolder.earlier`) gets the short page of SR-231 AK8 there. |
| `images/<uuid>-<n><ext>` | Copies of the images of the element's texts; `<ext>` from the type the bytes are (`imageExtension`), never from the file name. |
| `assets/docs.css` | The stylesheet of the shipped docs (`docs-theme.generated.ts`, SR-231 AK4) |
| `assets/reqseq.css` | The export's own styles (`OWN_CSS`): the grey of the element facts and of errors, the drawn diagrams, and scrolling of a wide display formula |
| `assets/theme.js`, `assets/reqseq.js` | The page scripts (`page-script.ts`): the theme before the first paint; the theme selects, the menu and the diagrams |
| `assets/copy.js` | The script of the copy buttons of element pages (`copy-script.ts`) |
| `assets/katex.css`, `assets/mermaid.js` | Only when a page needs them: KaTeX's stylesheet with its woff2 fonts as `data:` URLs, and the Mermaid bundle (`vendor.ts`) |
| `licenses/THIRD-PARTY-NOTICES.txt` | The licences of KaTeX, the packages of the Mermaid bundle and Starlight (`notices.ts`) |
| `reqseq-html-export.yaml` | The marker file (`schemas/html-export-marker.schema.json`) |

Data and the search index come as `.js` files loaded with a `script` element, never with `fetch`, which `file://` blocks (ADR-0017). Scripts are classic scripts, since `file://` blocks module scripts and the policy blocks inline ones.

Every link names a file. Every page carries a Content-Security-Policy (`page.ts`, `pagePolicy`): only the export's own styles, scripts, fonts and images, no connections, frames, forms or base change, and `noindex`. A page with a formula adds `font-src 'self' data:` (Firefox treats every `file://` file as an origin of its own and refuses a font from another file); a page with a diagram adds `style-src 'self' 'unsafe-inline'`, because Mermaid measures text in a temporary SVG with a `<style>` element. Content never yields a `<style>`.

## Look of the docs (`page.ts`, `docs-theme.generated.ts`, `page-script.ts`)

`pnpm docs:export-theme` (`packages/docs/src/export-theme.ts`) reads one page of the offline build of the docs and writes `docs-theme.generated.ts`: the stylesheet, the attributes of `<html>` and `<body>`, and Starlight's frame (header, sidebar pane with its menu button, theme selects, content and footer) without scripts, search, social links, table of contents and the links to the next page, with slots for the site title, sidebar, title, content and footer. The CI docs step runs it with `--check`. The pane has no `popover` in the frame: `reqseq.js` sets `popover="auto"` below 50em, the docs' breakpoint, and keeps the page `inert` while it is open, as Starlight's script does. The theme is stored under Starlight's key `starlight-theme`.

## Formulas and diagrams (`formula.ts`, `math-syntax.ts`, `render-options.ts`)

`math-syntax.ts` finds formulas by the rules of the app's editor (`$…$` not before a digit, `$$…$$` inline in display style, `$$` block lines, fenced `math`); the cases of `@reqseq/testkit` (`MATH_SYNTAX_CASES`) run against both. KaTeX sets each at export time with the app's options (`render-options.ts`, which the app imports). Its HTML must match a strict grammar (`isFormulaHtml`), else the formula is text and `html.unsafe-content`. A formula with an error shows its source as code and the error after it, and is the problem `html.formula-error` (SR-096 AK3).

A Mermaid block that passes `mermaidRisk` and the bounds of `diagramOverLimit` is marked `data-rq-diagram`; only those are drawn. A block over the bounds shows its error at export time. `reqseq.js` reads the source with `textContent`, renders it with the app's configuration (`securityLevel: "strict"`, no HTML labels) in the docs' colours, shows the SVG as a `data:` URL in an `<img>`, so the drawing runs nothing, and draws again when the theme changes. A diagram Mermaid cannot parse keeps its source, with the error after it.

The vendor files (`packages/core/vendor/html-export/`, git-ignored, in core's `files`) are written by `scripts/build/html-export-vendor.mjs` in core's build: Mermaid bundled from its ESM against the lockfile into one script (Mermaid's own bundle carries older KaTeX, DOMPurify and marked out of reach of the lockfile), failing on `eval`, `new Function` and a dynamic `import`, and KaTeX's stylesheet with its fonts inlined. No input names the folder; a missing file is `internal` before anything is written. `scripts/licenses/html-export.mjs` attributes every source of the bundle's map and writes `notices.generated.ts`; `licenses:check` runs it with `--check`.

## Element page (`element-page.ts`, `element-data.ts`, `section-*.ts`, `stub-page.ts`)

`element-data.ts` reads what the pages show besides the texts in one batch (N-036): each element as `listElements` gives it (properties as in the file, own and successor relations with the state of the other end), with `withEvidenceStatus`, `criterionReferencesOf` (SR-205 AK1) and `criterionStatusesByView` (the status of each acceptance criterion per view from own records, SR-031; open without one, also when children decide the element's status). `elementPageBody` makes one call per section, each in a module of its own:

- `section-fields.ts` (SR-232 AK1): type, identifier, short ID, status ("–" without one), packages, the repository when there is more than one, the verification status in the core ("not in the core") and in each variant it applies in, the validation status; each row with a copy button.
- the text;
- `section-criteria.ts` (AK2), none without criteria: number, criterion key, text (formatted when the property is Markdown, else as written), the status (alone for the core only, else per view) and a copy button with the reference, none without one;
- `section-properties.ts` (AK1): every other filled property in file order, also unknown ones by key; Markdown formatted, each item of a list too; a relation property as links;
- `section-relations.ts` (AK1): the outgoing relations by relation kind;
- `section-neighbourhood.ts` (AK5, AK6): the neighbourhood as the app's neighbourhood buffer shows it (SR-107), from the walks of `trace.neighbourhood` (`traceNeighbourhood`, with its marks of an edge, `edgeMarks`): up and down over the derivations, and down one step over every other relation key and the inline references. Parents and children: the nearest `NEIGHBOURHOOD_LIMIT` (100) elements each in walk order (each walk stops one element past it, `maxNodes`), with "Only the nearest 100 are shown." only when the walk reached more (spec question #2078); parents topmost first, one indent per level; children as a tree drawn from the shown elements only, a place the walk did not reach first marked repeated and a leaf. Unbounded, every page of the performance suite's workspace (50,000 elements, 200,000 relations) would carry its whole chain, about 29 GB in all. Incoming: one group per key in the order they first appear, named by the kind's `inverse-name`, else its name (as `trace.matrix` names an incoming column), a property by its name, "inline reference" for references; two keys with one name stay two groups. Each row: short ID with identifier, title and status ("–" without one) as a link to the element's page; an element with an invalid status, also one with a short page, and one without a page are rows without a link, and the walks go on through them. The cells are unclassed `span`s styled by place, to keep pages of many rows small. Outdated edges are marked with the note of the edge. `neighbourhoodSource` reads once per export the walks' contexts, the group names, the title key and the current versions of every element (`currentVersions`).

A target is named `identifier`, else short ID, and title (`links.ts`); one in a repository that is not here is `UNKNOWN-<tail>, repository <name>, not accessible` (SR-006 AK1); a missing, ambiguous or unknown-repository one names its UUID and why. The copy buttons are written `hidden`; `assets/copy.js` shows them and writes the value with the Clipboard API, or selects it where that is missing or refused. `stub-page.ts` (SR-231 AK8): identifier, short ID, title, status and a link to each successor (SR-072 AK3); it is not in `exportedElements`, which lists and search come from.

## References and footer (`export.ts`)

A `reqseq:` reference, in the text and in every Markdown property including each acceptance criterion, links `../elements/<uuid>.html` when its target has a page or a short page; a target with an invalid status and no short page, a missing one, one in a repository the workspace file does not name or a UUID of several files gives the link text alone; a target in a repository that is not on this computer gives the link text and `UNKNOWN-<tail>, repository <name>, not accessible` (SR-231 AK6, SR-006 AK1). The footer names the commit of the main repository with `-dirty` by the rules of `data.export` (SR-062 AK1), or "no commit", the date of the export (UTC) and the ReqSeq version (SR-231 AK9).

## Safe content (`markdown.ts`, `svg.ts`)

Texts and Markdown properties are rendered at export time in core (ADR-0002): `mdast-util-from-markdown` with GFM, a pass over the mdast, `mdast-util-to-hast`, and our own writer. The writer keeps only the elements and attributes of its allowlist, escapes every text and value, keeps `href` only for http, https, mailto and anchors, and `src` only for the image copies it made. The pass shows as the source text, with the problem `html.unsafe-content` (SR-235 AK4):

- raw HTML;
- a link with another scheme than http, https or mailto (a `reqseq:` reference and a link without a scheme keep their link text without a link, SR-235 AK5);
- an image with a scheme (network, `data:`) or a path outside the element's repository (`imageLink`);
- an SVG image that binds a namespace other than SVG and XLink, or whose text holds a script, embedded content or an animation under any prefix, an event attribute, a character reference, a script or data address, an entity or attribute list declaration, or a reference outside the file;
- a Mermaid block with a click action, an HTML label or its own configuration (`mermaidRisk`): it stays code without its language, so the page script never draws it.

An image of the repository is read with `readFileSnapshot`, which follows no link. A missing file, a link or bytes that are no image are not copied: the place is text and the problem is `html.image-not-copied`.

## Target folder (`files/export-folder.ts`)

Refused before anything changes: a target in a `.git` folder (also through links, SR-083 AK4), a folder ReqSeq reads YAML files from (metamodel, filters, perspectives, baselines, mappings), a target that is no folder, a missing folder above it, a non-empty folder without a readable marker (SR-235 AK1), another export running into it, and a path the new export writes that a file of another origin holds. Over API and MCP, `invoke` refuses a target outside the repositories (SR-142, SR-235 AK3).

The walk of the target follows no link. A `.git` entry, a folder holding one, a link and anything that is neither file nor folder are opaque. A marker entry counts when it is a relative path in NFC without `.`, `..`, empty names, `\`, `:`, control characters or a name Git takes, unique ignoring case, and the walk found it as a file; others are reported (`html.marker-entry-ignored`) and never touched. Every other file is reported once by its topmost folder of another origin (`html.foreign-file`) and stays as it is (SR-235 AK2).

Writing:

1. `.reqseq-export-staging` is created with an exclusive `mkdir`; it holds `owner.json` with the process ID, start time and run ID and is the lock. A staging folder whose process no longer runs, of this process whose run has ended, or older than a day, is renamed aside, checked once more and removed. A path the new export writes that another spelling of a foreign name holds is refused, since a file system that ignores case takes both as one.
2. The marker names the old files and `pending`, so a crash leaves nothing unmarked.
3. The new files go to `staging/new`. An error here removes the staging folder, restores the marker and removes a target the export created (SR-235 AK6).
4. The marker names old and new files. From the top, a name that is wholly the old export's (or missing) is moved to `staging/old` and replaced by the new one with one rename; a folder that also holds files of another origin is entered. Each folder is checked to be a real folder before a rename in it. An error moves everything back and restores the marker; if moving back fails, the error names `staging/old`.
5. The marker names the new files; then `staging` is removed (a failure is the problem `html.cleanup-failed`).

## Workspace scanner and watcher

An export inside a repository is not read as workspace data: the element walk lists only `*.md` (`model/discover.ts`), the evidence walk `*.md` and `*.xml` (`evidence/folders.ts`), and the export writes neither. The YAML folders are listed without descending, and an export into one is refused. The watcher (`model/watch.ts`) acts only on element, evidence, metamodel and workspace paths.
