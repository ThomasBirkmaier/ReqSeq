// A field of the element buffer with its copy symbol (SR-128). The symbol sits at the right edge and is
// seen only while the pointer is over the field or the focus is in it (styles.css); it takes no focus,
// and a press on it leaves the focus where it is, so the text editor keeps its cursor.
export const CopySymbol = ({
  label,
  onCopy,
}: {
  /** The name of the field, for the accessible name. */
  readonly label: string;
  readonly onCopy: () => void;
}): React.JSX.Element => (
  <button
    type="button"
    className="copy"
    tabIndex={-1}
    aria-label={`Copy ${label}`}
    onMouseDown={(event) => {
      event.preventDefault();
    }}
    onClick={onCopy}
  >
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" />
      <path
        d="M10.5 3.5v-.5a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 3v5A1.5 1.5 0 0 0 4 9.5h.5"
        fill="none"
        stroke="currentColor"
      />
    </svg>
  </button>
);

export const FieldBox = ({
  label,
  focusable = false,
  onCopy,
  children,
}: {
  /** The name of the field: what the status line says and what "Copy field" looks up. */
  readonly label: string;
  /** The field itself takes the focus (it has no control inside), so "the cursor is in the field". */
  readonly focusable?: boolean;
  readonly onCopy: (label: string) => void;
  readonly children: React.ReactNode;
}): React.JSX.Element => (
  <div className="field" data-field={label} {...(focusable ? { tabIndex: 0 } : {})}>
    {children}
    <CopySymbol
      label={label}
      onCopy={() => {
        onCopy(label);
      }}
    />
  </div>
);
