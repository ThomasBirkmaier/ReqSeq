# Release summaries

One file per version, `<version>.md` (`0.8.5.md`, also for the tag `v0.6`: `0.6.0.md`), written in the version PR of a release. It stands at the top of the GitHub release and on the page "What's new" of the documentation site, above the folded list of commits (`scripts/package/stage.mjs --release-body`, `--whats-new`).

The agent that prepares the release writes it from the commits since the previous release tag (the folded list under it, `git log --first-parent --format=%s <previous tag>..main`): it picks what a user notices, groups related changes into one point, and leaves out small fixes and changes of tests, build, documentation workflow and spec process. The product owner reads it in the version PR before setting the tag.

It tells a user what changed for them:

- One bold line that names the theme of the release.
- Three to five points, each a bold keyword and one or two sentences on what the user can do now.
- Words of the app (element, workspace, command line, buffer), no SR or issue numbers, no commit language, no small fixes. A change that needs the user to act, such as updating together, is always a point.

The release workflow fails without the file of its version, so the trial run on `main` before the tag shows it missing. After a summary of a published release changed, the workflow `Release texts` (by hand on `main`) writes the text of the release again.
