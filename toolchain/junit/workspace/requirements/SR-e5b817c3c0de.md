---
id: 2a7f0c95-6d1e-4b38-9c4a-e5b817c3c0de
type: system-requirement
status: draft
requirement-type: functional
acceptance-criteria:
  - Given a logged-in user, when 15 minutes pass without input, then the station logs the user out.
title: Log out when idle
spec-id: REQ-012
derives-from:
  - { id: 2f6d8a41-7c3e-4b95-a0d2-4b7e2c90d1a3, version: n1:9b1de8123cf8435b, title: Keep the station safe }
---

The station logs a user out after 15 idle minutes.
