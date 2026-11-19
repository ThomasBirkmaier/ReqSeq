# HTML export (`src/html-export/`, `src/files/export-folder.ts`)

`html.export` writes the workspace as an HTML export (SR-231, SR-235, D-080) into one folder. The pages are static files; nothing is rendered in the browser from element content except, from #1963, Mermaid by one bundled copy.

## Files of the export

| Path | What |
| --- | --- |
| `index.html` | Start page |
| `elements/<uuid>.html` | One page per element without an invalid status (D-044). The UUID never changes (D-017), so a link keeps opening the element when its identifier, title or short ID change (SR-231 AK3). |
| `images/<uuid>-<n><ext>` | Copies of the images of the element's texts; `<ext>` from the type the bytes are (`imageExtension`), never from the file name. |
| `assets/` | Stylesheet, later scripts and data. Data and the search index are `.js` files loaded with a `script` element, never with `fetch`, which `file://` blocks (ADR-0017). |
| `reqseq-html-export.yaml` | The marker file (`schemas/html-export-marker.schema.json`) |

Every link names a file. Every page carries a Content-Security-Policy (`page.ts`): only the export's own styles, scripts, fonts and images, no connections, frames, forms or base change, and `noindex`.

## Safe content (`markdown.ts`, `svg.ts`)

Texts and Markdown properties are rendered at export time in core (ADR-0002): `mdast-util-from-markdown` with GFM, a pass over the mdast, `mdast-util-to-hast`, and our own writer. The writer keeps only the elements and attributes of its allowlist, escapes every text and value, keeps `href` only for http, https, mailto and anchors, and `src` only for the image copies it made. The pass shows as the source text, with the problem `html.unsafe-content` (SR-235 AK4):

- raw HTML;
- a link with another scheme than http, https or mailto (a `reqseq:` reference and a link without a scheme keep their link text without a link, SR-235 AK5);
- an image with a scheme (network, `data:`) or a path outside the element's repository (`imageLink`);
- an SVG image that binds a namespace other than SVG and XLink, or whose text holds a script, embedded content or an animation under any prefix, an event attribute, a character reference, a script or data address, an entity or attribute list declaration, or a reference outside the file;
- a Mermaid block with a click action, an HTML label or its own configuration (`mermaidRisk`). Until #1963 every Mermaid block is shown as code.

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
