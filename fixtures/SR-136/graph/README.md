# SR-136 graph: the verification status and degree in the graph of an element

Built from `fixtures/SR-037/degree` (its README describes the elements, the records and the packages),
with these changes for SR-136:

- the metamodel gives `acceptance-criteria` its meaning, so each requirement counts its criteria;
- R01–R10 `derive-from` N1 `00a001`, so N1 has the ten derived requirements of SR-037 AK1: 6 verified,
  1 failed (R07), 1 outdated (R08), 2 open (R09, R10); degree 60 % (SR-136 AK3);
- N2 `00a002`, a need from which only O1 (obsolete) derives: no valid derived requirement (AK6);
- R11 `00b011`, three criteria, passed records for criteria 1 and 2 of the current version: open,
  2 of 3 (AK2);
- R12 `00b012`, no acceptance criteria, a passed record: verified, no ring (AK5);
- I1 `00b101` stays indirect (AK4).

The record versions are the current versions of the element files; regenerate them when an element
file changes (`node packages/cli/dist/bin.js element list --json --workspace fixtures/SR-136/graph`).
