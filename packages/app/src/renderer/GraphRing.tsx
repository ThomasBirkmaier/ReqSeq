// What a node of the graph shows of its verification (SR-136): the status word of a requirement, in the
// accent colour when failed or outdated, as the matrix shows it, and a small progress ring with its text,
// "2 of 3" for a requirement's verified acceptance criteria, "60 %" for a need's degree, inside the box on
// its marks line, both together at the line's right end, apart from the marks on its left (an outdated
// relation and an outdated verification are two things). Greys only (D-062): the ring's track in the edge grey, its full part in the text
// colour. The node's accessible name says both (`nodeLabel`), so the ring itself is hidden. A row of a list
// shows the same right of the element's status (SR-137 AK3); it has no label of its own, so there only the
// drawing is hidden and the ring's text names it (`named`).
import type { Verifiable } from "./graph.js";
import { accentStatus, ringOf, statusOf } from "./graph.js";

/** The circumference of the ring as its path length: the full part is `part` of it. */
const LENGTH = 100;

export const NodeVerification = ({
  node,
  named = false,
}: {
  readonly node: Verifiable;
  readonly named?: boolean;
}): React.JSX.Element | null => {
  const status = statusOf(node);
  const ring = ringOf(node);
  if (status === undefined && ring === undefined) {
    return null;
  }
  return (
    <span className="graph-verification">
      {status === undefined ? null : (
        <span className={["status", ...(accentStatus(status) ? ["accent"] : [])].join(" ")}>{status}</span>
      )}
      {ring === undefined ? null : (
        <span
          className="graph-ring"
          {...(named ? {} : { "aria-hidden": true })}
          data-part={String(ring.part)}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <circle className="track" cx="6" cy="6" r="5" pathLength={LENGTH} />
            <circle
              className="full"
              cx="6"
              cy="6"
              r="5"
              pathLength={LENGTH}
              strokeDasharray={`${String(ring.part * LENGTH)} ${String(LENGTH)}`}
              transform="rotate(-90 6 6)"
            />
          </svg>
          {ring.text}
        </span>
      )}
    </span>
  );
};
