/** `text` without the internal references that stand alone in parentheses or as its lead (#642). */
export declare const userText: (text: string) => string;
/** The internal references still in `text`. */
export declare const internalReferences: (text: string) => string[];
/** `node` with `userText` applied to every string under `description`, `summary` or `title`. */
export declare const userTexts: <T>(node: T) => T;
