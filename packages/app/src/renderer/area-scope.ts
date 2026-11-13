// The ids of the views in an area of the window (SR-115 AK3): two views, such as two lists side by side, or a
// shown one and one drawn in advance beside it (SR-212 AK5), must not share a DOM id, or the
// `aria-activedescendant` of one names a row of the other. Each layer of an area that holds a view gives it its
// own scope (`BufferArea.tsx`), and the view prefixes its ids with it.
import { createContext, useContext } from "react";

export const IdScope = createContext("");

/** The prefix of the ids of the view's layer. */
export const useIdScope = (): string => useContext(IdScope);
