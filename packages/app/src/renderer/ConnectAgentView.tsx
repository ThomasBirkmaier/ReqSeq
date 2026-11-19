// The buffer of "Connect AI agent" for a chosen client (SR-227 AK7, D-078): the answer sentence, under it the
// command or JSON block as a field with the copy symbol (SR-128), which "Copy field" copies too, the sentence on
// how to go on, and, quiet, the place the setup holds for (AK3). Code in a sentence (`/mcp`) is set as code.
import type { bufferMark } from "./area-slot.js";
import { CopySymbol } from "./FieldBox.js";
import type { AgentSetup } from "./connect-agent.js";
import { SETUP_FIELD, codeParts } from "./connect-agent.js";

const Sentence = ({
  text,
  className,
}: {
  readonly text: string;
  readonly className: string;
}): React.JSX.Element => (
  <p className={className}>
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
  readonly onCopy: (label: string, text: string) => void;
}): React.JSX.Element => {
  const copy = (): void => {
    onCopy(SETUP_FIELD, setup.text);
  };
  return (
    <div className="buffer result agent-setup" aria-label={name} {...attributes} tabIndex={0}>
      <div className="column">
        <Sentence className="answer" text={setup.answer} />
        <div className="field setup" data-field={SETUP_FIELD} data-form={setup.form} tabIndex={0}>
          <pre>
            <code>{setup.text}</code>
          </pre>
          <CopySymbol label={SETUP_FIELD} onCopy={copy} />
        </div>
        {setup.next === undefined ? null : <Sentence className="next" text={setup.next} />}
        {setup.valid === undefined ? null : <Sentence className="valid" text={setup.valid} />}
      </div>
    </div>
  );
};
