// Cross-access scenarios of reqif.saveMapping, in addition to the default one (cross-access.test.ts).
import { scenariosOf } from "../../scenario.js";

scenariosOf("reqif.saveMapping", [
  {
    tag: "[SR-054/AK-yc8n]",
    name: "the mapping of a source as a YAML file in the folder reqif of the main repository",
    input: {
      mapping: {
        "reqseq-reqif-mapping": 1,
        source: { name: "Kunde A" },
        types: [{ source: "Customer Requirement", type: "system-requirement" }],
        attributes: [
          { source: "ReqIF.Name", property: "title" },
          { source: "Priority", property: "requirement-type", values: { High: "functional" } },
        ],
        relations: [{ source: "satisfies", kind: "derives-from" }],
      },
    },
    expect: "output",
  },
  {
    tag: "[SR-054/AK-yc8n]",
    name: "a mapping file outside the folder reqif",
    input: {
      file: "requirements/kunde-a.yaml",
      mapping: { "reqseq-reqif-mapping": 1, source: { name: "Kunde A" } },
    },
    expect: "error",
  },
]);
