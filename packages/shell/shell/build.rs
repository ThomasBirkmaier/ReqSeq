//! Tauri's build step without the Tauri CLI (ADR-0021, Package): the app manifest gives each command of the pages
//! a permission, which the run-time capability grants.
fn main() {
    let manifest = tauri_build::AppManifest::new().commands(&[
        "pick_folder",
        "pick_file",
        "pick_save_target",
        "open_address",
    ]);
    if let Err(error) = tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest)) {
        panic!("tauri-build failed: {error:#}");
    }
}
