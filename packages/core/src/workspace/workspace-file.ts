// The name of the workspace file, apart from `config.ts`, so that a module that only looks for the file
// (`recent.ts`, which the app's main process loads on its own) loads no schema validator.

/** In the root of the main repository; the folder that holds it is `Workspace.root`. */
export const WORKSPACE_FILE = "logreq-workspace.yaml";
