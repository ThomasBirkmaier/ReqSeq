// The ids of the views in an area of the window (SR-115 AK3): two views side by side, such as two lists,
// must not share a DOM id, or the `aria-activedescendant` of one names a row of the other. The views prefix
// their ids with the scope of their area: none in one area and in the left one, `r-` in the right one.
import { createContext, useContext } from "react";

export const IdScope = createContext("");

/** The prefix of the ids of the view's area. */
export const useIdScope = (): string => useContext(IdScope);
