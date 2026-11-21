---
title: The neighbourhood in the HTML export
description: What the neighbourhood section of an element's page in an HTML export shows, also when a repository is not on this computer.
sidebar:
  order: 4
---

The page of an element in an [HTML export](/concepts/the-html-export/) has a section Neighbourhood: first the parents up to the topmost, indented per level, then the children as an indented tree, a child with several parents marked as repeated, then the incoming relations and references grouped by kind. Each row names the short ID, identifier, title and status and links the element's page; an outdated relation is marked. Of more than 100 parents or children, only the nearest 100 each stand there, with a line that says so (SR-232 AK5). A parent or child with an invalid status stands without a link, and its parents or children follow (SR-232 AK6, D-044).

On a package page (SR-233 AK4), the section leaves out the incoming group of the property with the meaning `packages` (D-059) as a whole, because the package page lists the elements of the package with a page of their own under Elements already (SR-232 AK9). Its rows of elements without a page of their own (SR-231 AK1) and its outdated marks leave with it; such an element stands in the section only where another group shows it. Without another group of incoming relations and references the section reads as for an element without them. The page of an element that is no package shows the group.

## When a repository is not on this computer

When a repository of the workspace is not on this computer (SR-006 AK2), the section names the missing repositories in the order of the workspace file, in a line after the children and after the note on the nearest 100 (in place of "No children") and in its last line, after the incoming links: children and incoming relations and references from their elements are not accessible and may be missing. A parent in such a repository that the element or a shown parent points at stands once, one level above the nearest shown element that points at it, with `UNKNOWN-<tail>`, the repository's name and `not accessible` (SR-006 AK1), without a link, without an outdated mark and without its own parents. A relation to a parent that is missing, that several files share or whose repository the workspace file does not name stays out of the section; it shows under the outgoing relations. These rows and lines do not count towards the nearest 100 (SR-232 AK8).
