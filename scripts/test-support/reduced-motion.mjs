/* global window */
// Test setup for DOM tests (happy-dom): the window starts as a system with "reduce motion" set, so a switch of
// buffers stands at once (SR-212 AK4) and a test that reads the window right after Alt+P finds only the new
// buffer. happy-dom animates (`Element.animate`) and reports no preference by default. A test of the motion
// itself turns it on with `window.happyDOM.settings.device.prefersReducedMotion = "no-preference"`.
if (typeof window !== "undefined" && window.happyDOM !== undefined) {
  window.happyDOM.settings.device.prefersReducedMotion = "reduce";
}
