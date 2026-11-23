---
title: The desktop shell
description: How the desktop shell of the release shows the web UI in a window of its own, starts its server and ends it.
sidebar:
  order: 7
---

The desktop shell is a program of the release that shows the web UI in a window of the operating system instead of the browser. It uses the system's web engine: WebView2 on Windows, WKWebView on macOS, WebKitGTK on Linux (ADR-0021). It has no logic of its own: what you do in its window, the web UI and its server do.

## Start it

Start `ReqSeq.app` on macOS, `ReqSeq.exe` on Windows or `ReqSeq` on Linux, from the place [Install ReqSeq](/how-to/install-reqseq/) moved it to. The shell starts `reqseq ui --no-open` of its own release, without a workspace and whatever folder or arguments it was started with (SR-252 AK1), and shows its pages once the server prints its address. Open a workspace in the window, as in the browser. The folder and file dialogs are those of your system (SR-253 AK1).

The shell does not start when the root of the file system, on Windows the root of the system drive, holds a workspace file, because the server would find it there; it names that file (SR-252 AK10). On Linux it needs the package `libwebkit2gtk-4.1-0`; without it, `ReqSeq` ends with a message that names the package, and starts no server (SR-252 AK8).

## In the window

The window loads pages of its own server only. A link in an element's text to a full `http`, `https` or `mailto` address opens in the program your system names for it, such as your browser; any other address opens nothing (SR-252 AK3). If the server cannot start, prints no address within 30 seconds or ends, the shell loads nothing more from it and names the reason in English: the last part of the server's error output, or that it did not start or gave no address (SR-252 AK5).

Each start gets a new address, so the preferences of the pages take their defaults again (ADR-0021).

## End it

Closing the window ends the shell on every system, and with it its server: within 5 seconds the address no longer answers, also when the shell is ended in another way (SR-252 AK4).

## On macOS

The command line of the shell's release lies inside the bundle, at `ReqSeq.app/Contents/Resources/bin/reqseq` (SR-249 AK3), so the terminal and the agent setups reach the same release. Move `ReqSeq.app` to `/Applications` before you start it: macOS starts an app that was not moved from a place it gives only for that start, and [Connect an AI agent](/how-to/connect-an-ai-agent/) then gives no setup and asks you to move it to `/Applications` first (SR-227 AK4).
