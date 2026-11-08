---
title: Exchange requirements with ReqIF
description: Analyse a ReqIF file, save its mapping, import it and its next delivery, and export a package, a selection or your statements back to the source.
sidebar:
  order: 12
---

ReqIF 1.2 is the exchange format of requirements tools such as DOORS Next or Polarion. ReqSeq reads a `.reqif` file, not a packed `.reqifz`, in a fixed order:

1. The analysis lists the types and attributes of the file that no mapping covers yet. It writes nothing.
2. The mapping says which type, property or relation kind of your metamodel each of them becomes, or that it is left out. It is a YAML file in the mapping folder (`reqif/` by default), one per source, and serves every later delivery; your metamodel stays as it is.
3. The import creates one element per object, all or nothing, turns XHTML text into Markdown, and lists as losses what it leaves out. Each element keeps its origin: source, source identifier, import date and delivery.
4. The next delivery of the same source updates these elements in place. Its analysis first shows the new, changed and dropped requirements; a dropped one is only listed, never removed. An element changed both locally and in the delivery is a conflict: the import refuses with `reqif.conflict` until you take the delivery or keep your version of each.

The export writes a package or any selection as ReqIF 1.2 and can leave out properties; a relation to an element outside the export keeps only its ID. With the mapping and statements, it writes the statement on each imported requirement back under the identifiers of the source. A file that ReqSeq exported imports without a mapping.

## App

In the command prompt (Ctrl+Shift+P, ⌘⇧P on macOS):

1. Run **Analyse ReqIF file** and choose the file. Its result lists what has no mapping yet.
2. Run **Save ReqIF mapping** and type the mapping as JSON, the `mapping` of the API section below.
3. Run **Import ReqIF file**, choose the file, name the delivery, and answer with Ctrl+Enter (⌘↩) to give the mapping too. For the next delivery, run **Analyse ReqIF file** with the mapping first, the same way; when you import, give each conflict with Ctrl+Enter under `take` or `keep`.
4. To export a package, open the package and run **Export ReqIF** with the name of the new file. On a list, it exports the elements the list shows.
5. For your answer to the source, add the property Statement to each requirement with “Add property”, then run **Export ReqIF** and give the mapping and `statements` yes with Ctrl+Enter.

## CLI

The commands start from a new workspace. The customer's first delivery:

```sh
reqseq workspace init . "Wind sensor"
```

```xml title="delivery-1.reqif"
<?xml version="1.0" encoding="UTF-8"?>
<REQ-IF xmlns="http://www.omg.org/spec/ReqIF/20110401/reqif.xsd" xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <THE-HEADER>
    <REQ-IF-HEADER IDENTIFIER="header">
      <CREATION-TIME>2026-11-02T09:00:00Z</CREATION-TIME>
      <REQ-IF-TOOL-ID>Customer tool</REQ-IF-TOOL-ID>
      <REQ-IF-VERSION>1.0</REQ-IF-VERSION>
      <SOURCE-TOOL-ID>Customer tool</SOURCE-TOOL-ID>
      <TITLE>Wind sensor, delivery 1</TITLE>
    </REQ-IF-HEADER>
  </THE-HEADER>
  <CORE-CONTENT>
    <REQ-IF-CONTENT>
      <DATATYPES>
        <DATATYPE-DEFINITION-STRING IDENTIFIER="string" MAX-LENGTH="1000"/>
        <DATATYPE-DEFINITION-XHTML IDENTIFIER="xhtml"/>
      </DATATYPES>
      <SPEC-TYPES>
        <SPEC-OBJECT-TYPE IDENTIFIER="req" LONG-NAME="Customer Requirement">
          <SPEC-ATTRIBUTES>
            <ATTRIBUTE-DEFINITION-STRING IDENTIFIER="name" LONG-NAME="ReqIF.Name"><TYPE><DATATYPE-DEFINITION-STRING-REF>string</DATATYPE-DEFINITION-STRING-REF></TYPE></ATTRIBUTE-DEFINITION-STRING>
            <ATTRIBUTE-DEFINITION-XHTML IDENTIFIER="text" LONG-NAME="ReqIF.Text"><TYPE><DATATYPE-DEFINITION-XHTML-REF>xhtml</DATATYPE-DEFINITION-XHTML-REF></TYPE></ATTRIBUTE-DEFINITION-XHTML>
            <ATTRIBUTE-DEFINITION-STRING IDENTIFIER="note" LONG-NAME="Internal Note"><TYPE><DATATYPE-DEFINITION-STRING-REF>string</DATATYPE-DEFINITION-STRING-REF></TYPE></ATTRIBUTE-DEFINITION-STRING>
          </SPEC-ATTRIBUTES>
        </SPEC-OBJECT-TYPE>
      </SPEC-TYPES>
      <SPEC-OBJECTS>
        <SPEC-OBJECT IDENTIFIER="CR-1" LAST-CHANGE="2026-11-02T09:00:00Z">
          <TYPE><SPEC-OBJECT-TYPE-REF>req</SPEC-OBJECT-TYPE-REF></TYPE>
          <VALUES>
            <ATTRIBUTE-VALUE-STRING THE-VALUE="Measure the wind"><DEFINITION><ATTRIBUTE-DEFINITION-STRING-REF>name</ATTRIBUTE-DEFINITION-STRING-REF></DEFINITION></ATTRIBUTE-VALUE-STRING>
            <ATTRIBUTE-VALUE-XHTML><DEFINITION><ATTRIBUTE-DEFINITION-XHTML-REF>text</ATTRIBUTE-DEFINITION-XHTML-REF></DEFINITION><THE-VALUE><xhtml:div>The sensor measures the wind speed.</xhtml:div></THE-VALUE></ATTRIBUTE-VALUE-XHTML>
            <ATTRIBUTE-VALUE-STRING THE-VALUE="Checked"><DEFINITION><ATTRIBUTE-DEFINITION-STRING-REF>note</ATTRIBUTE-DEFINITION-STRING-REF></DEFINITION></ATTRIBUTE-VALUE-STRING>
          </VALUES>
        </SPEC-OBJECT>
        <SPEC-OBJECT IDENTIFIER="CR-2" LAST-CHANGE="2026-11-02T09:00:00Z">
          <TYPE><SPEC-OBJECT-TYPE-REF>req</SPEC-OBJECT-TYPE-REF></TYPE>
          <VALUES>
            <ATTRIBUTE-VALUE-STRING THE-VALUE="Measure the direction"><DEFINITION><ATTRIBUTE-DEFINITION-STRING-REF>name</ATTRIBUTE-DEFINITION-STRING-REF></DEFINITION></ATTRIBUTE-VALUE-STRING>
            <ATTRIBUTE-VALUE-XHTML><DEFINITION><ATTRIBUTE-DEFINITION-XHTML-REF>text</ATTRIBUTE-DEFINITION-XHTML-REF></DEFINITION><THE-VALUE><xhtml:div>The sensor measures the wind direction.</xhtml:div></THE-VALUE></ATTRIBUTE-VALUE-XHTML>
          </VALUES>
        </SPEC-OBJECT>
      </SPEC-OBJECTS>
    </REQ-IF-CONTENT>
  </CORE-CONTENT>
</REQ-IF>
```

```sh
reqseq reqif analyze delivery-1.reqif
```

```text title="Output"
unmapped:
  - kind: type
    source: Customer Requirement
  - kind: attribute
    source: ReqIF.Name
    sourceType: Customer Requirement
  - kind: attribute
    source: ReqIF.Text
    sourceType: Customer Requirement
  - kind: attribute
    source: Internal Note
    sourceType: Customer Requirement
...
```

The mapping makes each customer requirement a system requirement, leaves out the internal note, and names the attribute that takes your statement back:

```json title="mapping.json"
{
  "mapping": {
    "reqseq-reqif-mapping": 1,
    "source": { "name": "Customer" },
    "types": [{ "source": "Customer Requirement", "type": "system-requirement" }],
    "attributes": [
      { "source": "ReqIF.Name", "property": "title" },
      { "source": "ReqIF.Text", "property": "text" },
      { "source": "Internal Note", "omit": true }
    ],
    "statement": { "property": "statement", "attribute": "Supplier Statement" }
  }
}
```

```sh
reqseq reqif save-mapping --input @mapping.json
reqseq reqif import delivery-1.reqif "Delivery 1" --mapping reqif/customer.yaml
```

```text title="Output"
created:
  - identifier: CR-1
...
  - identifier: CR-2
...
losses:
  - identifier: CR-1
...
    code: omitted-attribute
    reason: the mapping omits its attribute Internal Note
files:
  Customer/...
  Customer/...
No problems.
```

The second delivery changes CR-1, drops CR-2 and adds CR-3:

```xml title="delivery-2.reqif"
<?xml version="1.0" encoding="UTF-8"?>
<REQ-IF xmlns="http://www.omg.org/spec/ReqIF/20110401/reqif.xsd" xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <THE-HEADER>
    <REQ-IF-HEADER IDENTIFIER="header">
      <CREATION-TIME>2026-11-09T09:00:00Z</CREATION-TIME>
      <REQ-IF-TOOL-ID>Customer tool</REQ-IF-TOOL-ID>
      <REQ-IF-VERSION>1.0</REQ-IF-VERSION>
      <SOURCE-TOOL-ID>Customer tool</SOURCE-TOOL-ID>
      <TITLE>Wind sensor, delivery 2</TITLE>
    </REQ-IF-HEADER>
  </THE-HEADER>
  <CORE-CONTENT>
    <REQ-IF-CONTENT>
      <DATATYPES>
        <DATATYPE-DEFINITION-STRING IDENTIFIER="string" MAX-LENGTH="1000"/>
        <DATATYPE-DEFINITION-XHTML IDENTIFIER="xhtml"/>
      </DATATYPES>
      <SPEC-TYPES>
        <SPEC-OBJECT-TYPE IDENTIFIER="req" LONG-NAME="Customer Requirement">
          <SPEC-ATTRIBUTES>
            <ATTRIBUTE-DEFINITION-STRING IDENTIFIER="name" LONG-NAME="ReqIF.Name"><TYPE><DATATYPE-DEFINITION-STRING-REF>string</DATATYPE-DEFINITION-STRING-REF></TYPE></ATTRIBUTE-DEFINITION-STRING>
            <ATTRIBUTE-DEFINITION-XHTML IDENTIFIER="text" LONG-NAME="ReqIF.Text"><TYPE><DATATYPE-DEFINITION-XHTML-REF>xhtml</DATATYPE-DEFINITION-XHTML-REF></TYPE></ATTRIBUTE-DEFINITION-XHTML>
          </SPEC-ATTRIBUTES>
        </SPEC-OBJECT-TYPE>
      </SPEC-TYPES>
      <SPEC-OBJECTS>
        <SPEC-OBJECT IDENTIFIER="CR-1" LAST-CHANGE="2026-11-09T09:00:00Z">
          <TYPE><SPEC-OBJECT-TYPE-REF>req</SPEC-OBJECT-TYPE-REF></TYPE>
          <VALUES>
            <ATTRIBUTE-VALUE-STRING THE-VALUE="Measure the wind"><DEFINITION><ATTRIBUTE-DEFINITION-STRING-REF>name</ATTRIBUTE-DEFINITION-STRING-REF></DEFINITION></ATTRIBUTE-VALUE-STRING>
            <ATTRIBUTE-VALUE-XHTML><DEFINITION><ATTRIBUTE-DEFINITION-XHTML-REF>text</ATTRIBUTE-DEFINITION-XHTML-REF></DEFINITION><THE-VALUE><xhtml:div>The sensor measures the wind speed every second.</xhtml:div></THE-VALUE></ATTRIBUTE-VALUE-XHTML>
          </VALUES>
        </SPEC-OBJECT>
        <SPEC-OBJECT IDENTIFIER="CR-3" LAST-CHANGE="2026-11-09T09:00:00Z">
          <TYPE><SPEC-OBJECT-TYPE-REF>req</SPEC-OBJECT-TYPE-REF></TYPE>
          <VALUES>
            <ATTRIBUTE-VALUE-STRING THE-VALUE="Measure gusts"><DEFINITION><ATTRIBUTE-DEFINITION-STRING-REF>name</ATTRIBUTE-DEFINITION-STRING-REF></DEFINITION></ATTRIBUTE-VALUE-STRING>
            <ATTRIBUTE-VALUE-XHTML><DEFINITION><ATTRIBUTE-DEFINITION-XHTML-REF>text</ATTRIBUTE-DEFINITION-XHTML-REF></DEFINITION><THE-VALUE><xhtml:div>The sensor measures gusts above 25 knots.</xhtml:div></THE-VALUE></ATTRIBUTE-VALUE-XHTML>
          </VALUES>
        </SPEC-OBJECT>
      </SPEC-OBJECTS>
    </REQ-IF-CONTENT>
  </CORE-CONTENT>
</REQ-IF>
```

```sh
reqseq reqif analyze delivery-2.reqif --mapping reqif/customer.yaml
```

```text title="Output"
unmapped: none
new:
  - identifier: CR-3
changed:
  - identifier: CR-1
...
dropped:
  - identifier: CR-2
...
conflicts: none
losses: none
```

```sh
reqseq reqif import delivery-2.reqif "Delivery 2" --mapping reqif/customer.yaml
reqseq element list --sort title
```

```text title="Output"
elements:
  SR-5e1d0a  draft  Measure gusts
  SR-41c165  draft  Measure the direction
  SR-c67baa  draft  Measure the wind
total: 3
```

With a conflict, add `--take CR-1` or `--keep CR-1`. Write your statement into the requirement, and export the statements of the source:

```sh
reqseq element update SR-c67baa --set "statement=Agreed, one value per second."
reqseq reqif export statements.reqif --mapping reqif/customer.yaml --statements
```

```text title="Output"
file: statements.reqif
elements: 3
relations: 0
withoutStatement: 2
files: none
No problems.
```

A package, or any selection with `--ids`, `--filter` or `--where-type`, exports the same way; `--omit-properties` leaves properties out:

```sh
reqseq element create package "Sensor"
```

```text title="Output"
PKG-65ba20  draft  Sensor
...
```

```sh
reqseq element update SR-c67baa --set 'packages=["PKG-65ba20"]'
reqseq reqif export sensor.reqif --package PKG-65ba20
reqseq reqif export all.reqif --where-type system-requirement --omit-properties statement
```

```text title="Output"
file: all.reqif
elements: 3
relations: 1
files: none
No problems.
```

The one relation is the package of SR-c67baa, which is not exported and so goes out with its ID only.

## API

Start the API in the workspace with `reqseq serve api`, and send each command with the token of `api.json` as `Authorization: Bearer <token>`. Paths are relative to the workspace and must lie inside its repositories:

```http
POST /v1/commands/reqif.analyze

{ "file": "delivery-2.reqif", "mapping": "reqif/customer.yaml" }
```

```http
POST /v1/commands/reqif.saveMapping

{ "mapping": { "reqseq-reqif-mapping": 1, "source": { "name": "Customer" }, "types": [{ "source": "Customer Requirement", "type": "system-requirement" }], "attributes": [{ "source": "ReqIF.Name", "property": "title" }, { "source": "ReqIF.Text", "property": "text" }, { "source": "Internal Note", "omit": true }], "statement": { "property": "statement", "attribute": "Supplier Statement" } } }
```

```http
POST /v1/commands/reqif.import

{ "file": "delivery-2.reqif", "delivery": "Delivery 2", "mapping": "reqif/customer.yaml", "take": ["CR-1"] }
```

```http
POST /v1/commands/reqif.export

{ "output": "sensor.reqif", "selection": { "package": "PKG-65ba20" }, "omitProperties": ["statement"] }
```

```http
POST /v1/commands/reqif.export

{ "output": "statements.reqif", "mapping": "reqif/customer.yaml", "statements": true }
```

## MCP

An agent connected to `reqseq mcp` calls the same commands as tools, with the same input:

```json
{ "name": "reqif_analyze", "arguments": { "file": "delivery-2.reqif", "mapping": "reqif/customer.yaml" } }
```

```json
{
  "name": "reqif_saveMapping",
  "arguments": {
    "mapping": {
      "reqseq-reqif-mapping": 1,
      "source": { "name": "Customer" },
      "types": [{ "source": "Customer Requirement", "type": "system-requirement" }],
      "attributes": [
        { "source": "ReqIF.Name", "property": "title" },
        { "source": "ReqIF.Text", "property": "text" },
        { "source": "Internal Note", "omit": true }
      ],
      "statement": { "property": "statement", "attribute": "Supplier Statement" }
    }
  }
}
```

```json
{ "name": "reqif_import", "arguments": { "file": "delivery-2.reqif", "delivery": "Delivery 2", "mapping": "reqif/customer.yaml" } }
```

```json
{ "name": "reqif_export", "arguments": { "output": "statements.reqif", "mapping": "reqif/customer.yaml", "statements": true } }
```

The reference has every option of [reqif.analyze](/reference/commands/reqif-analyze/), [reqif.saveMapping](/reference/commands/reqif-save-mapping/), [reqif.import](/reference/commands/reqif-import/) and [reqif.export](/reference/commands/reqif-export/), and the [mapping file](/reference/formats/reqif-mapping/) has every entry.
