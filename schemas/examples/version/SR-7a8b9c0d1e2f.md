---
id: 3c4d5e6f-7a8b-4c9d-8e0f-7a8b9c0d1e2f
type: system-requirement
status: draft
title: Pin the Markdown subset of embedded images
requirement-type: functional
---

The images of this text pin the Markdown subset of normal form n1 (ADR-0005 "Files").

<!-- HTML is not recognised, so this image counts: ![Hidden](SR-7a8b9c0d1e2f/comment.png) -->

A paragraph line, so the next line is paragraph text and no definition:
[para]: SR-7a8b9c0d1e2f/para.png

![Para][para] ![Listed][list]

- [list]: SR-7a8b9c0d1e2f/list(1).png

- An item, so the next list item marker starts a new block:
- [item]: SR-7a8b9c0d1e2f/item.png

![Item][item]

	![Tab-indented code](SR-7a8b9c0d1e2f/tab.png)

![Query and fragment](SR-7a8b9c0d1e2f/photo.png?size=2#top)
![Escape](SR-7a8b9c0d1e2f/under\_score.png)
![Invalid percent-encoding](SR-7a8b9c0d1e2f/bad%zz.png)
![Backslash](SR-7a8b9c0d1e2f\none.png)
![Trailing dot](SR-7a8b9c0d1e2f/dot.)
![Trailing slash](SR-7a8b9c0d1e2f/photo.png/)
![Control character](SR-7a8b9c0d1e2f/%01.png)
![Own file](SR-7a8b9c0d1e2f.md)
![Git](.git/config)
