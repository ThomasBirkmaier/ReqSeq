---
title: The app
description: How the desktop app works - the command prompt, the minibuffer and the modeline, buffers and the split window, and context menus.
sidebar:
  order: 1
---

The app works like a text editor: no toolbars, few menus. You run everything from one command prompt, and what you open is a buffer.

## Open a workspace

On Windows and Linux the menu bar is hidden until you press Alt. Ctrl+O (⌘O on macOS), the key of **File > Open Workspace…**, opens the folder dialog. **Open workspace** in the command prompt offers the workspaces you opened last, or takes a folder path.

## The command prompt

Ctrl+Shift+P (⌘⇧P on macOS) opens the command prompt. It lists the actions and commands that apply to the shown buffer. The search is fuzzy (`tr ch` finds **Show trace chain**), and the commands you use most come first. Up and Down move the selection, Enter runs it, Escape closes the prompt. A click on the bottom line opens it too.

Each entry shows its key, so the prompt teaches you the keys. The most frequent commands have one of their own, such as Ctrl+Shift+F for **Search elements**; others follow the prefix key Ctrl+K, such as Ctrl+K E for **Create element**. Press Ctrl+K and wait to see the letters that may follow.

A command that reads or changes the workspace is the one the CLI, the API and MCP run, with the same result: see the [command reference](/reference/commands/).

![The command prompt over an open requirement, filtered by the word "show": a list of commands, some with their keys.](../images/app-command-prompt.png)

## The minibuffer and the modeline

The bottom line is the minibuffer. It shows the last message, and a command that needs input asks there, one argument after another, with the candidates above it. Enter takes an answer, Ctrl+Enter also offers the optional arguments.

Above it, the modeline describes the shown buffer: a list by its filter, sort and count, an element by its ID, type, status and counts of outdated relations and hints, and the workspace on the right.

## Buffers

A list or search result, an element, its neighbourhood or graph, a traceability matrix, the metamodel and the output of a command each open in a buffer, and opening one again shows it. Ctrl+P goes to any buffer or element by name, Alt+P back to the buffer before and Alt+N forward again, as the mouse buttons Back and Forward do. **Close buffer** (Ctrl+K B) saves an element's input first.

A workspace opens on the overview: the number of elements per type and the elements you opened last. Enter or a click opens a line. The buffers you had open come back behind it.

![The overview of a workspace with two needs and three system requirements, and the modeline at the bottom naming the view and the workspace.](../images/app-overview.png)

**Split window** shows two buffers side by side; the other side previews the element you select, until you work in it. Alt+O switches sides, **Unsplit window** ends the split.

## Context menus

A right-click (on macOS also Ctrl+click) on a row, the text, a field, a graph node or a matrix cell opens a menu of the commands for that place, named and keyed as in the command prompt. Its last entry, **All commands…**, opens the prompt.

## Light and dark

The app follows your system. **Toggle dark mode** switches until the app quits; **Follow system light or dark mode** goes back.

## Following an agent

While an agent works through MCP or the API, **Follow agent** (Ctrl+Shift+O) shows the element it read or changed last, in one buffer that its next step replaces. Your unsaved input holds it back until you save or discard it. The modeline says `following agent`, and the same key stops it.

Every key, for each system: [keyboard shortcuts](/reference/keyboard-shortcuts/).
