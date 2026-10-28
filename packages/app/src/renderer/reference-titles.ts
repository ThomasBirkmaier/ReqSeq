// The titles of the targets of references to another repository (D-058), kept for the workspace that is
// open: the editor shows the title of such a target in place of its short ID when the target is here. A
// title is asked of core once (`element.get` of the target) and kept, also "not here" (`ref.unknown`), so
// an editor made again, a box and a buffer shown again ask nothing; a pick brings the title of its target
// along, so a reference just written asks nothing either. Any other failure (core stopped or restarting)
// is not kept, so the next editor asks again. The app clears the titles when another workspace opens and
// when core restarts. A target renamed meanwhile keeps the title it had until then (core giving the
// titles with the element is #669).
import type { Call } from "./call.js";
import type { ReferenceRequest } from "./editor/reference-pick.js";
import { titleKey } from "./editor/references.js";

export interface ReferenceTitles {
  /** The title of the target `id` in `repository` (as the reference writes it); undefined when it is not here. */
  readonly title: (id: string, repository: string) => Promise<string | undefined>;
  /** `request` with a pick that keeps the title of its target first. */
  readonly picking: (request: ReferenceRequest) => ReferenceRequest;
  /** Forgets every title: another workspace is open, or core restarted. */
  readonly clear: () => void;
}

/** A title as the editor shows it, the same from core and from a pick; undefined when it is blank. */
const shown = (title: string): string | undefined => (title.trim() === "" ? undefined : title.trim());

/** The titles asked through `call`. */
export const referenceTitles = (call: Call): ReferenceTitles => {
  const titles = new Map<string, Promise<string | undefined>>();
  return {
    title: (id, repository) => {
      const key = titleKey(id, repository);
      const known = titles.get(key);
      if (known !== undefined) {
        return known;
      }
      // Drops this question from the cache, unless a pick or a clear has replaced it meanwhile.
      const forget = (): undefined => {
        if (titles.get(key) === asked) {
          titles.delete(key);
        }
        return undefined;
      };
      const asked: Promise<string | undefined> = call("element.get", { ref: id, repository }).then(
        (answer) => {
          if (answer.ok) {
            return shown(answer.output.element.title);
          }
          // Only "no such element here" is an answer about the target; any other failure is asked again.
          if (answer.code !== "ref.unknown") {
            forget();
          }
          return undefined;
        },
        forget,
      );
      titles.set(key, asked);
      return asked;
    },
    picking: (request) => ({
      ...request,
      insert: (target) => {
        // The reference names the repository percent-encoded (`referenceMarkdown`), and is read as written.
        const title = shown(target.title);
        if (title !== undefined) {
          titles.set(titleKey(target.id, encodeURIComponent(target.repository)), Promise.resolve(title));
        }
        request.insert(target);
      },
    }),
    clear: () => {
      titles.clear();
    },
  };
};
