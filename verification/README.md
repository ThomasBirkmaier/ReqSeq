# verification/

One record per system requirement whose verification method is Analyse, Inspektion or Demonstration: `SR-xxx.md` with what was checked, how, by whom (agent or human), result and date. A human confirms these records at stage acceptance (D-050). Agents never mark a record as confirmed.

## Where ReqSeq shows the status

The tests are the evidence of the other SRs. `.github/workflows/evidence.yml` takes the JUnit files of each nightly or manual run on `main` of CI, of the performance suite (`perf.yml`) and of the delivery tests (`release.yml`, also on a release tag), enriches them with `reqseq evidence enrich-junit` against the spec of the tested commit, and brings them into `spec/evidence/ci/` through a pull request that merges itself (#946). One file per suite and system, replaced by the next run of its workflow; older runs stay in the Git history. ReqSeq then shows the verification status of `spec/` in the app and through `reqseq evidence status|degree --workspace spec`. Once a human has confirmed a record here, a verification record for it (`reqseq evidence record`, with this file as the evidence location) goes into `spec/evidence/manual/`. `pnpm trace-check` stays the gate for each acceptance criterion.
