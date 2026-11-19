// The buffer of "Connect AI agent" for a chosen client (SR-227 AK7, D-078): the answer sentence, under it the
// command or JSON block as a field with the copy symbol (SR-128), which "Copy field" copies too, the sentence on
// how to go on, and, quiet, the place the setup holds for (AK3). The answer and the place stand as core gives
// them; code in the sentence on how to go on (`/mcp`) is set as code. Without a copy the block has no symbol.
import type { bufferMark } from "./area-slot.js";
import { CopySymbol } from "./FieldBox.js";
import type { AgentSetup } from "./connect-agent.js";
import { SETUP_FIELD, codeParts } from "./connect-agent.js";

const Next = ({ text }: { readonly text: string }): React.JSX.Element => (
  <p className="next">
    {codeParts(text).map((part, at) => (part.code ? <code key={at}>{part.text}</code> : part.text))}
  </p>
);

export const ConnectAgentView = ({
  name,
  setup,
  attributes,
  onCopy,
}: {
  /** The name of the buffer, for the accessible name. */
  readonly name: string;
  readonly setup: AgentSetup;
  /** What marks the shown buffer (`bufferMark`). */
  readonly attributes: ReturnType<typeof bufferMark>;
  readonly onCopy: ((label: string, text: string) => void) | undefined;
}): React.JSX.Element => {
  return (
    <div className="buffer result agent-setup" aria-label={name} {...attributes} tabIndex={0}>
      <div className="column">
        <p className="answer">{setup.answer}</p>
        <div className="field setup" data-field={SETUP_FIELD} data-form={setup.form} tabIndex={0}>
          <pre>
            <code>{setup.text}</code>
          </pre>
          {onCopy === undefined ? null : (
            <CopySymbol
              label={SETUP_FIELD}
              onCopy={() => {
                onCopy(SETUP_FIELD, setup.text);
              }}
            />
          )}
        </div>
        {setup.next === undefined ? null : <Next text={setup.next} />}
        {setup.valid === undefined ? null : <p className="valid">{setup.valid}</p>}
      </div>
    </div>
  );
};
