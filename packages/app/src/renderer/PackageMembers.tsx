// The package page (SR-112): the elements that name the package, below its text, as a list of its own with
// a heading that gives their count (SR-114 AK3) and the filter steps on them (AK2). Layout only: `ElementView` keeps the count, which its keys
// need, and gets it from the list's `onData`.
import type { ElementSelection } from "@reqseq/core";
import type { BufferAction, ElementBuffer } from "./buffers.js";
import type { Call } from "./call.js";
import { ListView } from "./ListView.js";
import type { OutsideChanges } from "./outside-marks.js";
import type { MemberCount, PackageModel } from "./package-page.js";
import { memberCount, memberHeading, memberList, memberSummary } from "./package-page.js";

export interface PackageMembersProps {
  readonly model: PackageModel;
  readonly buffer: ElementBuffer;
  readonly selection: ElementSelection;
  readonly call: Call;
  readonly revision: number;
  readonly outside: OutsideChanges;
  readonly dispatch: (action: BufferAction) => void;
  /** The count of the elements, as the list last said it. */
  readonly members: MemberCount | undefined;
  readonly onMembers: (count: MemberCount | undefined) => void;
  /** The elements of the loaded rows, in their order: the selected one is marked (SR-194 AK5). */
  readonly onEntries: (entries: readonly (ElementBuffer | undefined)[] | undefined) => void;
  /** The list of the elements took the focus (true) or lost it (false): only then is its row selected. */
  readonly onListFocus: (focused: boolean) => void;
  readonly onEcho: (message: string) => void;
  /** Up from the first row: the focus goes back to the buffer. */
  readonly onLeave: () => void;
  /** The list takes the focus when it has loaded (the buffer came back to its cursor). */
  readonly focusOnLoad: boolean;
}

export const PackageMembers = ({
  model,
  buffer,
  selection,
  call,
  revision,
  outside,
  dispatch,
  members,
  onMembers,
  onEntries,
  onListFocus,
  onEcho,
  onLeave,
  focusOnLoad,
}: PackageMembersProps): React.JSX.Element => (
  // A page without elements shows nothing of them; a filter that leaves none still names itself (SR-112 AK2).
  <section
    className="members"
    hidden={members?.total === 0 && buffer.memberSteps === undefined}
    onFocus={(event) => {
      onListFocus(event.target.classList.contains("part"));
    }}
    onBlur={() => {
      onListFocus(false);
    }}
  >
    {members !== undefined && (members.total > 0 || buffer.memberSteps !== undefined) ? (
      <h2>
        ← {memberHeading(model.key, buffer.memberSteps)}{" "}
        <span className="count">{memberSummary(members, buffer.memberSort)}</span>
      </h2>
    ) : null}
    <ListView
      part
      call={call}
      buffer={memberList(buffer, selection)}
      revision={revision + outside.seq}
      outside={outside}
      dispatch={dispatch}
      onData={(_key, data) => {
        onMembers(memberCount(data));
        onEntries(data?.kind === "list" ? data.rows : undefined);
      }}
      onEcho={onEcho}
      onLeave={onLeave}
      focusOnLoad={focusOnLoad}
    />
  </section>
);
