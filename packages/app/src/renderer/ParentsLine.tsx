// The parents of an element in one line above its title (SR-107 AK1): the titles of the parents from the
// top needs down to the direct parents, each a link to the parent. The line is there only when the
// element has parents. It is a group, not a navigation: the sheet has none (SR-100). The element buffer asks
// for it together with the element and shows both at once (`useParents`), so the title never moves down
// under the pointer after the element is shown (#542); the two calls run side by side.
import { useEffect, useState } from "react";
import type { BufferAction, ElementBuffer } from "./buffers.js";
import type { Call } from "./call.js";
import type { OutdatedMark } from "./editor/references.js";
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
  mark,
}: {
  readonly parent: Parent;
  readonly open: (target: ElementBuffer) => void;
  readonly mark: OutdatedMark | undefined;
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
    {parent.outdated ? (
      <span className="outdated" {...(mark === undefined ? {} : { title: mark.message })}>
        {" "}
        {mark?.word ?? "outdated"}
      </span>
    ) : null}
  </span>
);

/** The parents of an element: `answered` once the first answer is there (`parents` is undefined when it failed). */
export interface AskedParents {
  readonly answered: boolean;
  readonly parents: Parents | undefined;
}

/** Asks for the parents of the element, and again when the workspace changed. */
export const useParents = ({
  call,
  id,
  repository,
  revision,
  onEcho,
}: Omit<ParentsLineProps, "dispatch">): AskedParents => {
  // The line keeps what it shows while it is asked again, so the title does not jump with every save.
  const [asked, setAsked] = useState<AskedParents>({ answered: false, parents: undefined });

  useEffect(() => {
    let current = true;
    void call("trace.neighbourhood", parentsInput({ id, repository })).then((answer) => {
      if (!current) {
        return;
      }
      if (answer.ok) {
        setAsked({ answered: true, parents: parentLevels(answer.output) });
      } else {
        setAsked({ answered: true, parents: undefined });
        onEcho(answer.message);
      }
    });
    return () => {
      current = false;
    };
  }, [call, id, repository, revision]);
  return asked;
};

/** The line of parents that are there: nothing without parents. */
export const ParentsRow = ({
  parents,
  dispatch,
  mark = () => undefined,
}: {
  readonly parents: Parents | undefined;
  readonly dispatch: (action: BufferAction) => void;
  /**
   * The mark of the element's own outdated derivation to a direct parent: the hint's message and the word
   * with the date of the version it stores (SR-110 AK2); undefined while the buffer has none for it. The
   * neighbourhood buffer has no hints of the element and shows the word alone.
   */
  readonly mark?: (parent: Parent) => OutdatedMark | undefined;
}): React.JSX.Element | null => {
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
              <ParentLink parent={parent} open={open} mark={parent.outdated ? mark(parent) : undefined} />
            </span>
          ))}
        </span>
      ))}
      {parents.more ? <span className="sep"> …</span> : null}
    </div>
  );
};

/** The parents line that asks for its parents itself (the neighbourhood buffer). */
export const ParentsLine = (props: ParentsLineProps): React.JSX.Element => {
  const { parents } = useParents(props);
  return <ParentsRow parents={parents} dispatch={props.dispatch} />;
};
