// An element named by its shown ID and title (#1758): the ID muted and small (`.id`), the title in the text's
// own colour, the same wherever the app shows a short ID next to a title (#1482).
import type { IdParts } from "./id-title.js";

export const IdTitle = ({ parts }: { readonly parts: IdParts }): React.JSX.Element => (
  <>
    <span className="id">{parts.id}</span>
    {parts.title === "" ? null : <> {parts.title}</>}
  </>
);
