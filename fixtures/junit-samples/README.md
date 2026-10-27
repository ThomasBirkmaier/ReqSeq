# JUnit samples

JUnit XML files written by the real tools (D-054), unchanged, for the tests of the JUnit XML model (`packages/core/src/evidence/junit-model.test.ts`). Not a workspace.

- `pytest.xml`: pytest 9.1.1 (Python 3), `pytest --junitxml=pytest.xml -o junit_family=xunit1 -o junit_logging=all test_sample.py`. `xunit1` because pytest writes `record_property` only there.
- `vitest.xml`: Vitest 5.0.5, `vitest run --reporter=junit --outputFile=vitest.xml`. The property comes from `annotate("SR-46fb54", "logreq:element")`.

`test_sample.py`:

```python
import pytest


def test_login_by_property(record_property):
    record_property("logreq:element", "SR-46fb54")
    assert True


@pytest.mark.parametrize("a,b", [(1, 2), (3, 4)])
def test_add(a, b):
    assert a + b > 0


@pytest.mark.parametrize("ref", ["SR-46fb54", "SR-036"], ids=["SR-46fb54", "SR-036"])
def test_named(ref):
    assert ref


def test_fails():
    print("Prüfling läuft")
    assert 1 == 2


@pytest.mark.skip(reason="not on this platform")
def test_skipped():
    pass


@pytest.fixture
def broken():
    raise RuntimeError("setup <failed> & stopped")


def test_error(broken):
    pass
```

`sample.test.ts`:

```ts
import { describe, expect, it } from "vitest";

describe("login", () => {
  it("[SR-46fb54/AK1] accepts a valid password", async ({ annotate }) => {
    await annotate("SR-46fb54", "logreq:element");
    expect(1 + 1).toBe(2);
  });

  it.each([
    [1, 2],
    [3, 4],
  ])("adds [%i, %i]", (a, b) => {
    expect(a + b).toBeGreaterThan(0);
  });

  it("[SR-036] reports a failure", () => {
    console.log("Prüfling läuft");
    expect(1).toBe(2);
  });

  it.skip("is skipped", () => {
    expect(true).toBe(true);
  });
});
```
