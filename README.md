# ReqSeq

You tell your coding agent what you need, and it writes it down as requirements, acceptance criteria and tests, as Markdown files in your repository, through ReqSeq's CLI or MCP server.
Every element and every link between them carries a version, from the need down to the test run that proves it, so a change shows at once which requirement must be reviewed and which test must run again.
Only people approve; ReqSeq never sets a status, never writes to Git and opens no network connection.

[![CI](https://github.com/ThomasBirkmaier/ReqSeq/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/ThomasBirkmaier/ReqSeq/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/ThomasBirkmaier/ReqSeq)](https://github.com/ThomasBirkmaier/ReqSeq/releases/latest)
[![License: free to try](https://img.shields.io/badge/license-free%20to%20try-lightgrey)](#license)
[![Documentation](https://img.shields.io/badge/docs-thomasbirkmaier.github.io%2FReqSeq-blue)](https://thomasbirkmaier.github.io/ReqSeq/)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/guide/images/chain-dark.svg">
  <img src="docs/guide/images/chain-light.svg" alt="The chain ReqSeq keeps: your need goes to your agent, which writes a need and a system requirement into ReqSeq through the CLI or MCP, and code and tests into your repository. CI hands the test results to ReqSeq as JUnit XML, which records them as evidence against the version of the requirement. Each element and each relation carries a version, so a changed need shows the relation and then the evidence as outdated.">
</picture>

## Get started

1. Download the artifact for your system from the [latest release](https://github.com/ThomasBirkmaier/ReqSeq/releases/latest) and unpack it. [Install ReqSeq](https://thomasbirkmaier.github.io/ReqSeq/how-to/install-reqseq/) says how to check and start it, how to put the `reqseq` launcher on your path, and gives the MCP line for your agent on each system; ReqSeq needs `git` on the PATH.
2. In an empty folder, these are the steps your agent runs, or you by hand. Use the short IDs that ReqSeq prints in place of `N-7fe707` and `SR-c67baa`:

```sh
reqseq --version
reqseq workspace init . "Weather station"
reqseq element create need "See the wind speed" --text "As a sailor, I want to see the wind speed before I leave the harbour."
reqseq element create system-requirement "Show the wind speed" --text "The station must show the wind speed in knots, updated every 10 seconds."
reqseq relation add SR-c67baa derives-from N-7fe707
reqseq trace chain N-7fe707
reqseq workspace check
```

[Get started](https://thomasbirkmaier.github.io/ReqSeq/start/get-started/) explains each step. [Name the requirement in a test](https://thomasbirkmaier.github.io/ReqSeq/how-to/name-the-requirement-in-a-test/), [Check a workspace in CI](https://thomasbirkmaier.github.io/ReqSeq/how-to/check-a-workspace-in-ci/) and [Record test evidence](https://thomasbirkmaier.github.io/ReqSeq/how-to/record-test-evidence/) connect your tests and your pipeline.

## The app

![The app on ReqSeq's own specification: a system requirement opened through the search, the command help of "Filter list", the list of system requirements filtered, sorted and grouped, and the graph of a need with its system requirements.](docs/guide/images/app-tour.gif)

The desktop app works on the same files, with one command prompt for every function, and shows the graph, the traceability matrix and the evidence.

## More

[Documentation](https://thomasbirkmaier.github.io/ReqSeq/) · [Report a bug](https://github.com/ThomasBirkmaier/ReqSeq/issues) · [How ReqSeq is built](CONTRIBUTING.md). ReqSeq keeps its own specification this way in [`spec/`](spec/README.md), and so does the pilot [reqseq-weight-and-balance](https://github.com/ThomasBirkmaier/reqseq-weight-and-balance).

## License

ReqSeq is free to try. We plan to publish it under a source-available license before 1.0. Feedback and [issues](https://github.com/ThomasBirkmaier/ReqSeq/issues) are very welcome.

Copyright (c) 2026 Thomas Birkmaier. The current terms are in [LICENSE](LICENSE).
