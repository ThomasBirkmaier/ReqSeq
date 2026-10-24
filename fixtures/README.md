# fixtures/

Small test data per system requirement (D-055), used by unit and CLI end-to-end tests.

- One folder per SR: `fixtures/SR-xxx/<case>/` with the files of a tiny workspace (`logreq-workspace.yaml`, metamodel, elements).
- Tests copy a case into a temporary folder and, when Git is needed, turn it into a repository with a helper from `packages/testkit` (stage 1). Fixtures are never used in place, so tests can write.
- Keep cases minimal: only the files the acceptance criterion needs.
- Large workspaces (50,000 elements) are generated, never committed: `packages/testkit` generator with a fixed seed (N-036).
- Realistic multi-repository scenarios live in `ThomasBirkmaier/logreq-testdata`.
