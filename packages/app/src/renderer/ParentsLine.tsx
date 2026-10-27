// The parents of an element in one line above its title (SR-107 AK1): the titles of the parents from the
// top needs down to the direct parents, each a link to the parent. The line is there only when the
// element has parents. It is a group, not a navigation: the sheet has none (SR-100). It is asked for
// after the element is shown, so opening stays fast (SR-082 AK3).
import { useEffect, useState } from "react";
import type { BufferAction, ElementBuffer } from "./buffers.js";
import type { Call } from "./call.js";
import { parentLevels, parentsInput } from "./neighbourhood.js";
import type { Parent, Parents } from "./neighbourhood.js";

export interface ParentsLineProps {
  readonly call: Call;
  /** The element whose parents are shown. */
  readonly id: string;
  readonly repository: string;
  /** Counts up when the workspace changed: the parents are asked for again. */
  readonly revision: number;
  readonly dispatch: (action: BufferAction) => void;
  readonly onEcho: (message: string) => void;
}

const ParentLink = ({
  parent,
  open,
}: {
  readonly parent: Parent;
  readonly open: (target: ElementBuffer) => void;
}): React.JSX.Element => (
  <span className="parent">
    <span
      role="link"
      tabIndex={0}
      title={parent.label}
      onClick={() => {
        open(parent.open);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          open(parent.open);
        }
      }}
    >
      {parent.name}
    </span>
    {parent.outdated ? <span className="outdated"> outdated</span> : null}
  </span>
);

export const ParentsLine = ({
  call,
  id,
  repository,
  revision,
  dispatch,
  onEcho,
}: ParentsLineProps): React.JSX.Element | null => {
  // The line keeps what it shows while it is asked again, so the title does not jump with every save.
  const [parents, setParents] = useState<Parents | undefined>(undefined);

  useEffect(() => {
    let current = true;
    void call("trace.neighbourhood", parentsInput({ id, repository })).then((answer) => {
      if (!current) {
        return;
      }
      if (answer.ok) {
        setParents(parentLevels(answer.output));
      } else {
        setParents(undefined);
        onEcho(answer.message);
      }
    });
    return () => {
      current = false;
    };
  }, [call, id, repository, revision]);

  if (parents === undefined || parents.levels.length === 0) {
    return null;
  }
  const open = (target: ElementBuffer): void => {
    dispatch({ type: "open", buffer: target });
  };
  return (
    <div className="parents" role="group" aria-label="Parents">
      {parents.levels.map((level, at) => (
        <span className="level" key={at}>
          {at === 0 ? "" : <span className="sep"> › </span>}
          {level.map((parent, index) => (
            <span key={parent.open.key}>
              {index === 0 ? "" : <span className="sep"> · </span>}
              <ParentLink parent={parent} open={open} />
            </span>
          ))}
        </span>
      ))}
      {parents.more ? <span className="sep"> …</span> : null}
    </div>
  );
};
