---
title: The HTML export
description: What the pages of an HTML export show, how they look, and how they link elements.
sidebar:
  order: 3
---

The HTML export is a folder of pages for readers without ReqSeq ([Publish the workspace as HTML](/how-to/publish-the-workspace-as-html/)).

## The page of an element

The page of an element starts with a list of its type, identifier, short ID, status (without one "–") and packages, the repository when the workspace has more than one, and for a requirement its verification status in the core and in each variant it applies in ("not in the core" when the core does not hold it), for a need its validation status; each row has a button that copies its value. Then come its text, its acceptance criteria, each with its number, criterion key, text (formatted when the metamodel marks the property as Markdown) and verification status and a button that copies its reference for test names such as `[SR-036/AK-k7f3]` (none for a criterion without one, SR-205 AK1), every other filled property as in the element file, and its outgoing relations by relation kind (SR-232 AK1, AK2). A target is a link where it has a page or a short page, and its name without link where it has neither; a target in a repository that is not on this computer shows `UNKNOWN-<tail>, repository <name>, not accessible` (SR-006 AK1); a target that is missing, that several files share or whose repository the workspace file does not name shows its UUID and the reason.

The neighbourhood follows: first the parents up to the topmost, each level further indented, then the children as an indented tree, where a child of several parents stands under each and is marked repeated everywhere but at the place nearest the element (SR-107 AK3), then the incoming relations and references grouped by kind (SR-232 AK5), each group named by the relation kind's inverse name, else its name (the metamodel's inverse name is the name shown at the target). Each row names the short ID with the identifier, the title and the status, and links the element's page; an outdated relation is marked "link outdated". An element with an invalid status stands there with its identifier, title and status without a link, and its parents or children follow it (SR-232 AK6, D-044).

An element that had a page in an earlier export and now has an invalid status keeps a short page at the same address, with its identifier, short ID, title and status and a link to each successor; it is in no list and not in the search (SR-231 AK8, SR-072 AK3).

## Look, references and footer

The pages look like this documentation: a switch for dark and light, and below the width where this documentation changes its layout, the navigation as a menu (SR-231 AK4). Formulas are set when you export, Mermaid diagrams are drawn by the library in the folder, and tables, task lists, callouts and images are formatted. A formula or diagram with an error shows its source, then the error (SR-231 AK5); a formula with an error is also named as the problem `html.formula-error`. A reference in the text or in a Markdown property, also in an acceptance criterion, links the page of its target, or its short page; to a target with an invalid status and no short page, one that is missing, or one in a repository the workspace file does not name, only its link text is left, and a reference to a target in a repository that is not on this computer shows its link text followed by `(UNKNOWN-<tail>, repository <name>, not accessible)`, with the last six digits of the UUID as `<tail>` (SR-231 AK6, SR-006 AK1). The footer of every page names the commit of the main repository, with `-dirty` unless every repository on this computer has a known commit and no uncommitted change to the files the pages come from (SR-062 AK1), or "no commit" without Git, and the date of the export; each page asks search engines with `noindex` not to list it (SR-231 AK9).
