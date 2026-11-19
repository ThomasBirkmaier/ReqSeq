---
title: Publish the workspace as HTML
description: Write the workspace as an HTML export, a folder of pages that people read in a browser without ReqSeq, Git or network.
sidebar:
  order: 14
---

The HTML export writes the workspace into a folder of pages for readers without ReqSeq (D-080). It holds:

- `index.html`, the start page, and one page per element without an invalid status in `elements/`, named by the UUID of its element, so a link to it keeps opening that element after the next export, also when its short ID or title changed (SR-231 AK1, AK3). An element that had a page in an earlier export and now has an invalid status keeps a short page there with its identifier, short ID, title and status and a link to each successor; it is in no list and not in the search (SR-231 AK8, SR-072 AK3);
- `assets/` with the stylesheet of this documentation, the scripts of the pages and, when a page needs them, KaTeX's stylesheet and the Mermaid library (SR-231 AK4, AK5);
- `images/` with a copy of each image the texts show from the repository of their element (SR-231 AK5);
- `licenses/THIRD-PARTY-NOTICES.txt` with the licences of what the folder copies;
- the marker file `reqseq-html-export.yaml`, which names the files of the export (SR-235 AK2).

The page of an element starts with a list of its type, identifier, short ID, status (without one "–") and packages, and for a requirement its verification status in the core and in each variant it applies in ("not in the core" when the core does not hold it), for a need its validation status; each row has a button that copies its value. Then come its text, its acceptance criteria, each with its number, criterion key, text and verification status and a button that copies its reference for test names such as `[SR-036/AK-k7f3]` (none for a criterion without one, SR-205 AK1), every other filled property as in the element file, and its outgoing relations by relation kind, each target a link to its page (SR-232 AK1, AK2).

Open `index.html` from the folder (`file://`), or put the folder under any path of a web server: every link between the pages leads to a file of the folder, and no page asks for an address outside it (SR-231 AK2). ReqSeq publishes nothing: where you put the pages decides who reads them (D-080).

The pages look like this documentation: a switch for dark and light, and below the width where this documentation changes its layout, the navigation as a menu (SR-231 AK4). Formulas are set when you export, Mermaid diagrams are drawn by the library in the folder, and tables, task lists, callouts and images are formatted. A formula or diagram with an error shows its source, then the error (SR-231 AK5); a formula with an error is also named as the problem `html.formula-error`. A reference in the text or in a Markdown property, also in an acceptance criterion, links the page of its target, or its short page; to a target with an invalid status and no short page, one that is missing, or one in a repository the workspace file does not name, only its link text is left, and a reference to a target in a repository that is not on this computer shows its link text followed by `(UNKNOWN-<tail>, repository <name>, not accessible)`, with the last six digits of the UUID as `<tail>` (SR-231 AK6, SR-006 AK1). The footer of every page names the commit of the main repository, with `-dirty` unless every repository on this computer has a known commit and no uncommitted change to the files the pages come from (SR-062 AK1), or "no commit" without Git, and the date of the export; each page asks search engines with `noindex` not to list it (SR-231 AK9).

Whatever would run, load or link something outside the folder is shown as text and named as a problem: raw HTML, links with another scheme than http, https or mailto, images from the network, from a `data:` address or from outside the element's repository, and Mermaid diagrams with click actions or HTML labels (SR-235 AK4). An image that is missing or not readable stays as text, and a link to another file of the repository is text without a link (SR-235 AK5).

ReqSeq writes into a new folder, an empty one, or the folder of an earlier export. There it replaces and removes only the files the marker file names, and names every other file as a problem. A folder that is not empty and has no marker file is refused, as is a folder inside `.git`, and nothing is changed (SR-235 AK1 to AK3). When an export fails, an earlier one stays as it was (SR-235 AK6).

## App

In the command prompt (Ctrl+Shift+P, ⌘⇧P on macOS), run **Export HTML** and choose the folder.

## CLI

```sh
reqseq workspace init . "Wind sensor"
reqseq element create system-requirement "Show the wind speed"
reqseq html export site
```

```text title="Output"
Exported 1 element page to site.
folder: site
pages: 1
exportedElements: SR-9d35ce
removed: 0
No problems.
```

Export again into the folder to update it.

## API

```http
POST /v1/commands/html.export

{ "output": "site" }
```

## MCP

An agent connected to `reqseq mcp` calls the same command as a tool:

```json
{ "name": "html_export", "arguments": { "output": "site" } }
```

The reference has every option of [html.export](/reference/commands/html-export/).
