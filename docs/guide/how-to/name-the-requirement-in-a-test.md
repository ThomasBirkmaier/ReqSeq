---
title: Name the requirement in a test
description: Name the requirement a test checks in its name or a property, in Vitest, pytest, Rust, Go, Java or any other tool that writes JUnit XML.
sidebar:
  order: 4.1
---

A test shows a requirement once it names it, in one of two ways that give the same result:

- **In the test name**, in square brackets: `[SR-b2c0de]`, or with an acceptance criterion by its criterion key, [`[SR-b2c0de/AK-k7f3]`](/how-to/give-acceptance-criteria-their-keys/#the-reference-of-a-criterion). Several brackets name several requirements. Without `/AK` the test counts for all criteria.
- **As the property `reqseq:element`** of the test case, with the ID as its value. For one criterion, add the property `reqseq:criterion` with the ID, a colon and the key (`SR-b2c0de:k7f3`).

The key is in the element file. A number in the name, or a key no criterion or several carry, is reported (`evidence.invalid-criterion-name`), the test case unchanged.

The ID is the short ID that `reqseq element list` prints (it gets longer when another UUID ends the same way), the UUID, or an identifier such as `REQ-012`. An unknown short ID or UUID, usually a typo, is reported; an unknown identifier in brackets is passed over, since tools put other text in brackets too, and so is a test that names no requirement.

**Vitest** (the example in the release, `resources/docs/junit/vitest/`):

```js
it("[SR-a1c0de] accepts a valid password", () => { /* ... */ });

it("locks the account after three wrong passwords", async ({ annotate }) => {
  await annotate("SR-b2c0de", "reqseq:element");
});
```

JUnit XML: `vitest run --reporter=junit --outputFile=results.xml`, or the same in `vitest.config.js`.

**pytest** (`resources/docs/junit/pytest/`): a function name cannot hold brackets, so use a property or a parameter ID, and run `pytest --junitxml=results.xml` with `junit_family = xunit1` in `pytest.ini`, without which pytest writes no properties:

```python
def test_accepts_a_valid_password(record_property):
    record_property("reqseq:element", "SR-a1c0de")

@pytest.mark.parametrize("passwords", [["a", "b", "c"]], ids=["SR-b2c0de"])
def test_locks_the_account(passwords):
    ...
```

pytest's own parameter lists such as `test_add[1-2]` are passed over. In a parameter ID right after the test name (`test_x[…]`), an unknown short ID with a type prefix of the workspace is reported as a typo; any other text there is passed over, since pytest also writes data as parameter IDs.

**Any other tool**: its JUnit file must hold the ID in brackets in the `name` of the `<testcase>`, or `<property name="reqseq:element" value="SR-b2c0de"/>` in its `<properties>`. For JUnit output, Jest needs `jest-junit`, CTest `--output-junit`, Go `go-junit-report`; Maven and Gradle write it by default.

## Names without brackets

For Rust, Go or Java, write the short ID into the name in another form and give the form with `--name-pattern`: `{prefix}` stands for a type prefix (`SR`), `{id}` for the hex digits of the short ID, `{ak}` for a criterion key; the rest is literal text, and case does not matter. For Rust, `sr_c67baa_ak_k7f3_shows_the_wind_speed` with `{prefix}_{id}_ak_{ak}`; for Go, `TestSRc67baa_k7f3` with `Test{prefix}{id}_{ak}`.

A match starts and ends at a word boundary (the start or end of the name, a character that is no letter or digit, or a camel case word), so `loaded123456` never gives D-ed123456. Only names are read, outside brackets. Write a separator where the parts could be read two ways: between a prefix and an ID (`de123456` with the prefixes `D` and `DE`), after the ID before hex letters (`sr_c67baaface`), and between an upper-case ID and a camel case word (`SR2F95EAdd`). Too few digits (`sr_029`) count as without reference. Without a separator, `{prefix}{id}` can also read a hash as a short ID (`TestCacheKeyD41d8cd98f00` gives D-41d8cd98f00), and the command exits with 1 unless the workspace has that ID. `workspace check` does not know the pattern, so it cannot warn when such a file was not enriched.

## App

Run **Enrich JUnit file** in the command prompt and answer the item under test with Ctrl+Enter (⌘Enter on macOS): the prompt then offers the optional arguments, among them the name pattern. For brackets, Enter is enough.

## CLI

For a Rust test as `cargo nextest run` writes it to its JUnit file, give the pattern too:

```rust
#[test]
fn sr_c67baa_ak_k7f3_shows_the_wind_speed_in_knots() { /* … */ }
```

`reqseq evidence enrich-junit results.xml build-1 --name-pattern "{prefix}_{id}_ak_{ak}"` then records the test for SR-c67baa and its acceptance criterion with the key `k7f3`, as `[SR-c67baa/AK-k7f3]` would.

## API

```http
POST /v1/commands/evidence.enrichJunit

{ "file": "results.xml", "item": "build-1", "namePattern": "{prefix}_{id}_ak_{ak}" }
```

## MCP

```json
{ "name": "evidence_enrichJunit", "arguments": { "file": "results.xml", "item": "build-1", "namePattern": "{prefix}_{id}_ak_{ak}" } }
```
