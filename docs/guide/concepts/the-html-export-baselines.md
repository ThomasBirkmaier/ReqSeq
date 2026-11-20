---
title: Baselines and variants in the HTML export
description: How an HTML export shows each baseline, what changed since it, each variant against the core, and the variant comparison.
sidebar:
  order: 5
---

An [HTML export](/concepts/the-html-export/) shows each baseline and each variant, and compares the variants with the core (SR-234). The navigation of every page names the page of all baselines, each baseline and the variant comparison, where there are any.

## Baselines

The page of all baselines, `baselines/index.html`, lists each baseline with its name, date, the number of its elements and the number of changed elements, newest first (SR-234 AK2).

The page of a baseline names its name, date and the commit per repository, and lists its elements in the groups changed, added, removed and unchanged, as `baseline.get` marks them, each with the version in the baseline and its date. Superseded elements stand in a group of their own with identifier, title and status, without a link. A baseline without a stored selection has no added and no removed elements, and its page says so (SR-234 AK1, SR-051 AK2, AK3).

## Change since a baseline

The page of an element names, for each baseline that lists it or to which it is added, the change since that baseline and the version in the baseline with its date (SR-232 AK7). Where its version differs from the one in the baseline and the baseline's commit is in the local Git history, the page shows the old and the new wording of each changed text, acceptance criterion (matched by its criterion key) and property that counts to the version, and the relations added and removed; a newer stored version of a target is no difference. Without that commit, for example in a shallow clone, the page says that the difference is not available. ReqSeq only reads Git (D-036).

A list compares with a baseline you choose above it: a column and a filter then show the change of each row since that baseline, with the same values and "not in the baseline". No baseline is chosen at first, and comparing needs JavaScript (SR-233 AK2, AK5).

## Variants

The page of a variant shows its verification degree and what it adds, replaces and excludes compared with the core, as `variant.diff` gives it; it is not compared with other variants, since a variant builds on the core only (SR-234 AK4, D-020).

The variant comparison, `variants/index.html`, shows the verification degree in the core and in each variant, and below it the requirements whose verification status differs between the views, with the status in each view (SR-234 AK3).
