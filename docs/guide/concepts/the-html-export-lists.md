---
title: Lists and start page of the HTML export
description: How readers of an HTML export find elements through the start page, a list per type and the package pages.
sidebar:
  order: 4
---

Readers of an [HTML export](/concepts/the-html-export/) find elements through the start page, a list per type and the package pages; the navigation of every page names the start page, each list and each package (SR-233 AK4).

## Start page

The start page `index.html` carries the name of the workspace. It names the commit, the date of the export and the ReqSeq version, and says that the export is incomplete when a repository of the workspace is not on this computer (SR-006 AK2). Below follow:

- the verification degree in the core, with the number of requirements per verification status;
- the requirements whose verification status in the core is failed, outdated or open;
- the elements with open hints and their number;
- the number of elements changed and added since the newest baseline, counted as `baseline.get` counts them;
- each type with the number of its elements and a link to its list (SR-233 AK3).

## Lists

Each type with an element that has a page gets a list, `lists/<type key>.html`, except the types with the meaning package or variant. A row names the identifier (else the short ID) with a link to the page, the title, the status, the packages, for a requirement the verification status in the core, and the number of open hints. Elements with an invalid status are in no list (SR-233 AK1, SR-231 AK1).

Above the table, a search field keeps the rows whose identifier, short ID or title holds the text, ignoring case. Filters by status, package, verification status and each property with fixed values offer their values with the number of rows each would leave; several values of one filter match any of them, several filters all of them. A click on a column head sorts by it, again for descending, in the order of `element.list` (SR-075 AK1); "Group" groups the rows by one filter, and a row with several packages stands in each of their groups (SR-233 AK1).

Search, filters, sorting and grouping need JavaScript; without it the list stands there whole as a table (SR-233 AK5).

## Package pages

The page of a package is its element page with a section Elements: each element that names the package, with identifier, title, status and verification status in the core. An element in several packages stands on each of their pages (SR-233 AK4).
