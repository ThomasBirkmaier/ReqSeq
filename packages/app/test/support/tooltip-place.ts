// Shared by the specs of the slash menu (SR-129) and its calendar (SR-200): a CodeMirror tooltip stands right
// under the line of the caret (above it when the window has no room below), at its start. CodeMirror shows a
// new tooltip at top -10000px until its next measure, one animation frame later, places it (#1126, #1178), so
// the place is polled, not read once. A tooltip that stays off its line still fails when the poll times out.
import { expect } from "@playwright/test";
import type { Locator } from "@playwright/test";

/** Polls until `tooltip` stands right under or above `line`, at its start. */
export const expectNextToLine = async (tooltip: Locator, line: Locator): Promise<void> => {
  // The measured distances while the place is wrong, so a failure shows them; nothing once it is right.
  const wrongPlace = async (): Promise<string | undefined> => {
    // `boundingBox()` waits for the element to be attached, so a missing one is counted first.
    if ((await line.count()) === 0 || (await tooltip.count()) === 0) {
      return "no line or no tooltip on the screen";
    }
    const lineBox = await line.boundingBox();
    const box = await tooltip.boundingBox();
    if (lineBox === null || box === null) {
      return "no line or no tooltip on the screen";
    }
    const below = Math.abs(box.y - (lineBox.y + lineBox.height));
    const above = Math.abs(box.y + box.height - lineBox.y);
    const vertical = Math.min(below, above) <= lineBox.height;
    const horizontal = Math.abs(box.x - lineBox.x) < 40;
    return vertical && horizontal
      ? undefined
      : `below ${below.toFixed(1)}, above ${above.toFixed(1)}, left ${(box.x - lineBox.x).toFixed(1)}, line ${lineBox.height.toFixed(1)}`;
  };
  await expect.poll(wrongPlace).toBeUndefined();
};
