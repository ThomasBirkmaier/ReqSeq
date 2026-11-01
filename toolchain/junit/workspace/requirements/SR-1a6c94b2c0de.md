---
id: 8e41b6d2-9f3a-4c57-b0e8-1a6c94b2c0de
type: system-requirement
status: draft
requirement-type: functional
acceptance-criteria:
  - Given three wrong passwords in a row, when the third is entered, then the account is locked.
title: Lock the account
derives-from:
  - { id: 2f6d8a41-7c3e-4b95-a0d2-4b7e2c90d1a3, version: n1:9b1de8123cf8435b, title: Keep the station safe }
---

The station locks an account after three wrong passwords in a row.
