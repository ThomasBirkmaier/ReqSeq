---
title: Publish the workspace as HTML
description: Write the workspace as an HTML export, a folder of pages that people read in a browser without ReqSeq, Git or network.
---

The HTML export writes the workspace into a folder of pages for readers without ReqSeq (D-080). It holds:

- `index.html`, the start page, and one page per element without an invalid status in `elements/`, named by the UUID of its element, so a link to it keeps opening that element after the next export, also when its short ID or title changed (SR-231 AK1, AK3);
- `lists/` with a list per type, `lists/<type key>.html` (SR-233 AK1);
- `assets/` with the stylesheet of this documentation, the scripts of the pages, the search index and, when a page needs them, KaTeX's stylesheet and the Mermaid library (SR-231 AK4, AK5, AK7);
- `images/` with a copy of each image the texts show from the repository of their element (SR-231 AK5);
- `licenses/THIRD-PARTY-NOTICES.txt` with the licences of what the folder copies;
- the marker file `reqseq-html-export.yaml`, which names the files of the export (SR-235 AK2).

Open `index.html` from the folder (`file://`), or put the folder under any path of a web server: every link between the pages leads to a file of the folder, and no page asks for an address outside it (SR-231 AK2). ReqSeq publishes nothing: where you put the pages decides who reads them (D-080). What the pages show: [The HTML export](/concepts/the-html-export/).

What would run, load or link outside the folder is text and a problem: raw HTML, links with another scheme than http, https or mailto, images from the network, from a `data:` address or from outside the element's repository, and Mermaid diagrams with click actions or HTML labels (SR-235 AK4). An image that is missing or not readable stays as text, and a link to another file of the repository is text without a link (SR-235 AK5).

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
