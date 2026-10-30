import { describe, expect, it } from "vitest";
import { inline } from "./markdown.js";
import { modelAnchor, STANDARD_MODEL_IMAGE_ALT, standardModelPage } from "./standard-model.js";

describe("standardModelPage", () => {
  it("renders every part with its anchor, description and the facts it has", () => {
    const page = standardModelPage({
      types: [
        {
          key: "need",
          name: "Need",
          prefix: "N",
          description: "A need of <users>.",
          meaning: "Stakeholder need.",
          properties: ["title"],
          required: ["title"],
        },
        { key: "bare", name: "Bare", prefix: "B" },
      ],
      properties: [
        {
          key: "tags",
          name: "Tags",
          kind: "choice",
          many: true,
          content: true,
          markdown: true,
          description: "Tags.",
          choices: [{ key: "a", name: "A" }],
          "target-types": ["need"],
          meaning: "Keywords.",
        },
        { key: "plain", name: "Plain", kind: "text" },
      ],
      relations: [
        {
          key: "refines",
          name: "Refines",
          description: "Refines.",
          "inverse-name": "Refined by",
          "source-types": ["need"],
          "target-types": ["need"],
          meaning: "Refinement.",
        },
        { key: "loose", name: "Loose" },
      ],
      statuses: [
        { key: "draft", name: "Draft", initial: true, description: "Draft." },
        { key: "rejected", name: "Rejected", invalid: true },
      ],
    });
    expect(page).toContain(`![${STANDARD_MODEL_IMAGE_ALT}](../images/app-standard-model.png)\n\n## Types`);
    expect(page).toContain(
      `<a id="type-need"></a>\n\n### Need (\`need\`)\n\n${inline("A need of <users>.")}\n\n- Short ID prefix: \`N\`\n- Meaning: Stakeholder need.\n- Properties: \`title\`\n- Required: \`title\`\n`,
    );
    expect(page).toContain(
      '<a id="type-bare"></a>\n\n### Bare (`bare`)\n\n- Short ID prefix: `B`\n\n## Properties',
    );
    expect(page).toContain(
      "- Kind: choice, several values\n- Choices: A (`a`)\n- Target types: `need`\n- Meaning: Keywords.\n- Counts to the version of the element.\n- Markdown text.\n",
    );
    expect(page).toContain("### Plain (`plain`)\n\n- Kind: text\n\n");
    expect(page).toContain(
      "- Inverse name: Refined by\n- From types: `need`\n- To types: `need`\n- Meaning: Refinement.\n",
    );
    expect(page).toContain("### Loose (`loose`)\n\n\n## Statuses");
    expect(page).toContain("Draft.\n\n- The status of a new element.\n");
    expect(page).toContain(
      "- Invalid: the element counts neither for coverage nor for indirect verification.\n",
    );
    expect(modelAnchor("status", "draft")).toBe("status-draft");
  });
});
