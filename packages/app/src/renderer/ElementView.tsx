// The element buffer: one element, read-only, as `element.get` gives it. The text is shown as plain text
// (React text nodes only: nothing from a file is ever interpreted as HTML); Markdown rendering comes
// with the editor. Empty properties are left out; the UUID and the version are shown on request only.
import { useEffect, useState } from "react";
import type { DataExportElement, DataExportRelation } from "@logreq/core";
import type { ElementBuffer } from "./buffers.js";
import type { Call } from "./call.js";
import { propertyBoxes, relationGroups } from "./element-view.js";
import type { BufferData } from "./modeline.js";

export interface ElementViewProps {
  readonly call: Call;
  readonly buffer: ElementBuffer;
  /** Counts up when the workspace changed: the element is asked for again. */
  readonly revision: number;
  /** What the buffer has loaded, for the modeline. */
  readonly onData: (key: string, data: BufferData | undefined) => void;
  readonly onEcho: (message: string) => void;
  /** A relation target is opened: by its UUID, as the relation output has no repository. */
  readonly onOpenTarget: (id: string) => void;
}

type View =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ok"; readonly element: DataExportElement };

const Relation = ({
  relation,
  onOpenTarget,
}: {
  readonly relation: DataExportRelation;
  readonly onOpenTarget: (id: string) => void;
}): React.JSX.Element => {
  const available = relation.targetState === "available";
  const label = `${relation.identifier ?? relation.shortId ?? relation.id} ${relation.title ?? ""}`.trim();
  return (
    <li className={available ? "relation" : "relation unavailable"}>
      {available ? (
        <span
          role="link"
          tabIndex={0}
          onClick={() => {
            onOpenTarget(relation.id);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onOpenTarget(relation.id);
            }
          }}
        >
          {label}
        </span>
      ) : (
        <>
          <span>{label}</span> <span className="state">{relation.targetState}</span>
        </>
      )}
      {relation.outdated === true ? <span className="outdated"> outdated</span> : null}
    </li>
  );
};

export const ElementView = ({
  call,
  buffer,
  revision,
  onData,
  onEcho,
  onOpenTarget,
}: ElementViewProps): React.JSX.Element => {
  const [view, setView] = useState<View>({ status: "loading" });

  useEffect(() => {
    let current = true;
    setView({ status: "loading" });
    onData(buffer.key, undefined);
    void call("element.get", { ref: buffer.id, repository: buffer.repository }).then((answer) => {
      if (!current) {
        return;
      }
      if (answer.ok) {
        setView({ status: "ok", element: answer.output.element });
        onData(buffer.key, { kind: "element", element: answer.output.element });
      } else {
        setView({ status: "error", message: answer.message });
        onEcho(answer.message);
      }
    });
    return () => {
      current = false;
    };
  }, [call, buffer.key, buffer.id, buffer.repository, revision]);

  return (
    <article className="buffer element" aria-label={buffer.name} data-buffer="" tabIndex={0}>
      <div className="column">
        {view.status === "error" ? <p className="quiet">{view.message}</p> : null}
        {view.status === "ok" ? (
          <>
            <h1>
              {view.element.title === ""
                ? (view.element.identifier ?? view.element.shortId)
                : view.element.title}
            </h1>
            {view.element.text === undefined || view.element.text === "" ? null : (
              <p className="text">{view.element.text}</p>
            )}
            {propertyBoxes(view.element).map((box) => (
              <div className="box" key={box.key}>
                <span className="key">{box.key}</span>
                <span className="value">
                  {box.lines.map((line, at) => (
                    <span className="line" key={at}>
                      {line}
                    </span>
                  ))}
                </span>
              </div>
            ))}
            {relationGroups(view.element.relations).map((group) => (
              <section key={group.heading}>
                <h2>{group.heading}</h2>
                <ul>
                  {group.relations.map((relation, at) => (
                    <Relation key={at} relation={relation} onOpenTarget={onOpenTarget} />
                  ))}
                </ul>
              </section>
            ))}
          </>
        ) : null}
      </div>
    </article>
  );
};
