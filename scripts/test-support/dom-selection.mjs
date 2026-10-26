/* global document, setTimeout */
// Test setup for DOM tests (happy-dom): `selectionchange` behaves as in a browser. It arrives as a task
// after the call that changed the selection, and only when the selection is another one. happy-dom fires
// it inside the call and for every call, and CodeMirror (the Markdown editor of the app, SR-065) then
// updates its view while it is still updating, which it refuses; once deferred, its own reaction to the
// event would set the selection again and fire the event again without end.
if (typeof document !== "undefined") {
  const dispatch = document.dispatchEvent.bind(document);
  const snapshot = () => {
    const selection = document.getSelection();
    return selection === null
      ? []
      : [selection.anchorNode, selection.anchorOffset, selection.focusNode, selection.focusOffset];
  };
  let last = snapshot();
  document.dispatchEvent = (event) => {
    if (event.type !== "selectionchange") {
      return dispatch(event);
    }
    setTimeout(() => {
      const current = snapshot();
      if (current.some((part, at) => part !== last[at])) {
        last = current;
        dispatch(event);
      }
    }, 0);
    return true;
  };
}
