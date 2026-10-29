// The standard model that ReqSeq ships (D-012, D-037, D-059, SR-014). `pnpm contracts:generate`
// embeds schemas/examples/metamodel/standard-model.yaml unchanged (contracts:check keeps it equal),
// so the package needs no schemas folder at run time (ADR-0014). `workspace.init` writes it into a
// new workspace as its metamodel file; it is never read from here as the metamodel of a workspace
// (SR-011: a workspace has only the metamodel files of its checked-out state).
import standardModel from "../generated/standard-model.json" with { type: "json" };

/** File name of the standard model in the metamodel folder of a new workspace. */
export const STANDARD_MODEL_FILE: string = standardModel.file;

/** The standard model as a metamodel file (YAML, LF line endings, comments included). */
export const STANDARD_MODEL_TEXT: string = standardModel.text;
