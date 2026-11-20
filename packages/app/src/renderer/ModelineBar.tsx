// The modeline: a display, not a control. Left the parts of the shown buffer, right the workspace, each
// part a segment of one rounded bar (ThomasBirkmaier/ReqSeq-archive#490). Two
// things are not just display (SR-128): the ID of an element carries the copy symbol of a field, and the
// confirmation of a copy shows briefly after the parts. At the right end the connected agent (SR-228): a green
// dot and "Agent connected", a grey dot and "No agent connected", or a quiet "Connect AI agent"; a click on
// either of the last two starts "Connect AI agent" (AK3).
import type { AgentStatus } from "./agent-status.js";
import { AGENT_CONNECTED, CONNECT_AI_AGENT, NO_AGENT } from "./agent-status.js";
import { STATUS_FIELD } from "./copy.js";
import { CopySymbol } from "./FieldBox.js";
import { NO_WORKSPACE_OPEN } from "../shared/open-hint.js";
import type { ElementHead, WorkspaceView } from "./modeline.js";

export const ModelineBar = ({
  parts,
  view,
  stopped,
  follow,
  shown,
  head,
  onCopy,
  notice,
  agent,
  onConnectAgent,
}: {
  /** What the shown buffer is and has (`bufferView`). */
  readonly parts: readonly string[];
  /** The workspace; undefined until its status is known. */
  readonly view: WorkspaceView | undefined;
  /** The core process stopped for good. */
  readonly stopped: boolean;
  /** The mark of the mode „Agent folgen“ (SR-117 AK3); undefined while it is off. */
  readonly follow?: string | undefined;
  /** The view shown (SR-043 AK1, „view: A“); undefined while all elements are shown. */
  readonly shown?: string | undefined;
  /**
   * The ID, type and status of the element the shown buffer is (`elementHead`), drawn as its first part: the
   * ID is a field to copy (SR-128), the ID and the status are fields with a context menu (SR-196).
   */
  readonly head: ElementHead | undefined;
  /** Copies a field (its name and its value). */
  readonly onCopy: (label: string, text: string) => void;
  /** The confirmation of a copy; empty when there is none. */
  readonly notice: string;
  /** The connected agent (SR-228); undefined while it is not known or the cache folder records none (AK4). */
  readonly agent?: AgentStatus | undefined;
  /** Starts "Connect AI agent" (SR-227), as the command prompt does (SR-228 AK3). */
  readonly onConnectAgent?: () => void;
}): React.JSX.Element => {
  return (
    <footer className="modeline" aria-label="Modeline">
      {view === undefined ? null : (
        <>
          <span className="parts">
            {parts.map((part, at) =>
              at === 0 && head !== undefined ? (
                <span key={part} className="segment">
                  {/* The ID and the status are fields with a context menu (SR-196 AK3, AK4): a right press
                      gives them the focus, so "Copy field" copies them. */}
                  <span className="field" data-field="ID" data-menu="field-short-id" tabIndex={-1}>
                    <span>{head.id}</span>
                    <CopySymbol
                      label="ID"
                      onCopy={() => {
                        onCopy("ID", head.shortId);
                      }}
                    />
                  </span>
                  {` · ${head.type}`}
                  {head.status === undefined ? null : (
                    <>
                      {" · "}
                      <span
                        className="field"
                        data-field={STATUS_FIELD}
                        data-menu="field-status"
                        tabIndex={-1}
                      >
                        {head.status}
                      </span>
                    </>
                  )}
                </span>
              ) : (
                <span key={part} className="segment">
                  {part}
                </span>
              ),
            )}
            {notice === "" ? null : (
              <span className="segment notice" role="status">
                {notice}
              </span>
            )}
          </span>
          <span className="workspace">
            <span className="segment name">{view.name ?? NO_WORKSPACE_OPEN}</span>
            {[
              ...view.marks,
              ...(shown === undefined ? [] : [shown]),
              ...(follow === undefined ? [] : [follow]),
              ...(stopped ? ["stopped"] : []),
            ].map((mark) => (
              <span key={mark} className="segment">
                {mark}
              </span>
            ))}
            <AgentPart agent={agent} onConnect={onConnectAgent} />
          </span>
        </>
      )}
    </footer>
  );
};

/** The agent's part of the modeline (SR-228): a display while connected, else a quiet button. */
const AgentPart = ({
  agent,
  onConnect,
}: {
  readonly agent: AgentStatus | undefined;
  readonly onConnect: (() => void) | undefined;
}): React.JSX.Element | null => {
  if (agent === undefined) {
    return null;
  }
  if (agent.kind === "connected") {
    return (
      <span className="segment agent" data-agent="connected" title={agent.hover}>
        <span className="agent-dot" aria-hidden="true" />
        {AGENT_CONNECTED}
      </span>
    );
  }
  // Out of the tab order, as the rest of the modeline; the click starts the action, which opens its prompt.
  return (
    <button
      type="button"
      className="segment agent"
      data-agent={agent.kind}
      tabIndex={-1}
      {...(agent.kind === "ended" ? { title: agent.hover } : {})}
      onClick={() => onConnect?.()}
    >
      {agent.kind === "ended" ? (
        <>
          <span className="agent-dot" aria-hidden="true" />
          {NO_AGENT}
        </>
      ) : (
        CONNECT_AI_AGENT
      )}
    </button>
  );
};
