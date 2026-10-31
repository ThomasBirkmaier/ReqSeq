# ReqIF 1.2 XSDs

The XSDs that ReqSeq's tests check every written ReqIF file against (ADR-0013). They are not in this repository, the W3C modules included (product owner decision, 2026-10-31): CI downloads them before the tests, and nothing of them is redistributed.

- `xsd.json` lists the 21 files by base name with their https URL: `reqif.xsd` (OMG, ReqIF 1.2), `driver.xsd` (OMG, its XHTML driver), `xml.xsd` (W3C) and the 18 XHTML Modularization 1.1 modules of the driver's import closure (W3C Software and Document License).
- `xsd.sha256` pins each file's SHA-256 in `sha256sum` format (`#` lines are comments). The hashes were confirmed by the product owner, 2026-10-31, from his own download of each URL. A later change of a hash names such a confirmation in its pull request and is told in the stage epic; without the pins CI fails with "ReqIF XSD not pinned".
- `scripts/reqif-xsd/fetch.mjs <dir> [--fresh]` downloads the files six at a time (https only on every redirect hop, 20 s per request, one retry, 150 s for all, below the step's 3 minutes) and checks every hash, cached files too. A failed download and a hash mismatch are separate `::error` annotations, each printed when it happens, with what to do. Malformed or repeated pin lines and names that are not plain file names are refused.
- CI (`.github/actions/reqif-xsd`, in `checks` on all three systems): cache first, download what is missing, save on a miss on every event, so the entry lies in `main`'s scope, and set `REQSEQ_REQIF_XSD_DIR`. Nightly and manual runs also download every file fresh (`ReqIF XSD upstream`), so an upstream change shows there first. No mirror: on a cache miss with a failed download the job fails.
- Locally the tests that need the XSDs are skipped with that reason. Run `node scripts/reqif-xsd/fetch.mjs <dir>` and set `REQSEQ_REQIF_XSD_DIR=<dir>` where omg.org and w3.org are reachable; agent sessions cannot reach them and rely on CI.

The hand-written samples are in `samples/` (their README).
