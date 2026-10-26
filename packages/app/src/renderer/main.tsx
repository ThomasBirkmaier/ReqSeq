// Entry of the renderer: the window's React tree on the bridge of the preload script.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";

const root = document.getElementById("root");
if (root === null) {
  throw new Error("The page has no #root element");
}
createRoot(root).render(
  <StrictMode>
    <App bridge={window.logreq} />
  </StrictMode>,
);
