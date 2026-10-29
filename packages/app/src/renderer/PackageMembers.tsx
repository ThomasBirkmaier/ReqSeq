// The package page (SR-112): the elements that name the package, below its text, as a list of its own with
// a heading that gives their count (SR-114 AK3). Layout only: `ElementView` keeps the count, which its keys
// need, and gets it from the list's `onData`.
import type { ElementSelection } from "@reqseq/core";
import type { BufferAction, ElementBuffer } from "./buffers.js";
import type { Call } from "./call.js";
import { ListView } from "./ListView.js";
import type { OutsideChanges } from "./outside-marks.js";
import type { MemberCount, PackageModel } from "./package-page.js";
import { memberCount, memberList, memberSummary } from "./package-page.js";

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
  onEcho,
  onLeave,
  focusOnLoad,
}: PackageMembersProps): React.JSX.Element => (
  <section className="members" hidden={members?.total === 0}>
    {members !== undefined && members.total > 0 ? (
      <h2>
        ← {model.key} <span className="count">{memberSummary(members, buffer.memberSort)}</span>
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
      }}
      onEcho={onEcho}
      onLeave={onLeave}
      focusOnLoad={focusOnLoad}
    />
  </section>
);
