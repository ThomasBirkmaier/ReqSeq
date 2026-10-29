# SR-062: store the data of a state

One repository `system` (main, this folder): the standard model of `fixtures/SR-061/export`, the evidence location `evidence/`, the `ignore` glob `generated/**`, a saved filter and a baseline. UUIDs `62062062-0000-4000-8000-0000000000xx`, short IDs `SR-0000xx`.

| Element | Content |
|---|---|
| SR-0000a1 | embeds `requirements/SR-a1/layout.png`; a test record in `evidence/` |
| SR-0000a2 | embeds `requirements/SR-a2/plot.dat` (no image extension) |

What makes a stored state `-dirty` (`<commit>-dirty.json`, model/uncommitted.ts), against the commit of the fixture:

- counts: a change to `reqseq-workspace.yaml`, to a `*.yaml` in `metamodel/`, `filters/` or `baselines/`, to an element file or any `*.md` the element walk reads (this README too), to an embedded file; a deleted element or embedded file; a new element file, also in `drafts/`, which `.gitignore` names; an embedded file Git ignores (`*.local.png`);
- does not count: `*.md` and `*.xml` in `evidence/`, `.reqseq/local.yaml`, `src/tool.py`, `generated/notes.md` (ignore glob), a `*.json` anywhere (stored data files), changed stat data alone (a copied work tree).
