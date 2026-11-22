// The marks every page shows the same way: the verification status and the status pill.
import { h } from "./dom.js";
import { statusName, statusRole } from "./meaning.js";
import { store } from "./store.js";

/** The verification statuses of ReqSeq in words for people. */
export const VERIFICATION: Readonly<Record<string, string>> = {
  verified: "Verified",
  indirect: "Verified through children",
  open: "No evidence yet",
  outdated: "Evidence outdated",
  failed: "Test failed",
};

export const verificationWord = (status: string): string => VERIFICATION[status] ?? status;

/** A verification mark: a dot in the colour of the status and its words. */
export const verificationMark = (status: string | undefined, text?: string): HTMLElement | null =>
  status === undefined ? null : h("span", { class: `st ${status}` }, text ?? verificationWord(status));

/** The status pill, coloured by the role of the status in the metamodel. */
export const statusPill = (status: string | undefined): HTMLElement | null =>
  status === undefined
    ? null
    : h("span", { class: `pill st-${statusRole(store.mm, status) || "none"}` }, statusName(store.mm, status));
