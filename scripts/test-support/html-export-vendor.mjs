// Vitest global setup: the vendor files of the HTML export (scripts/build/html-export-vendor.mjs), which core's
// `build` writes, are built once before the tests when one is missing, so that a test run needs no build first.
import { vendorComplete, writeVendor } from "../build/html-export-vendor.mjs";

export default async function setup() {
  if (!(await vendorComplete())) {
    await writeVendor();
  }
}
