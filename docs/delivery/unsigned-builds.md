# Opening unsigned builds

The ReqSeq builds are not signed with a developer certificate yet (ADR-0014); signing comes later. macOS and Windows therefore warn the first time they open a downloaded build. The steps below open it anyway. Check the download against `SHA256SUMS.txt` of the release first ([Getting ReqSeq](README.md)).

## macOS

A zip downloaded with a browser is marked as coming from the internet, and macOS refuses to open the unpacked `ReqSeq.app` the first time (macOS 14: "cannot be opened because Apple cannot check it for malicious software"; macOS 15 and later: "“ReqSeq” Not Opened … Apple could not verify …"). Either:

- try to open the app once, then open System Settings → Privacy & Security, scroll to the message about ReqSeq and click "Open Anyway" (it asks for an administrator password on macOS 15 and later; on macOS 14 also: Control-click `ReqSeq.app` → Open → Open), or
- remove the mark once in Terminal: `xattr -dr com.apple.quarantine /Applications/ReqSeq.app`.

The second way also lets the command line `bin/reqseq` inside the app run; with the first, start the app once before using the command line.

The app carries an ad-hoc signature only, which Apple silicon needs to run it at all. If macOS says the app "is damaged and can't be opened" (this dialog has no "Open Anyway"), check the download against `SHA256SUMS.txt`. If the checksum does not match, download it again. If it matches, the download is intact and macOS objects only to the missing developer signature: remove the mark with the `xattr` line above.

## Windows

Windows SmartScreen shows "Windows protected your PC" when `ReqSeq.exe` starts for the first time: click "More info", then "Run anyway". To avoid the warning for every file, unblock the zip before unpacking it (Windows copies the mark of the web to every unpacked file): right-click the zip → Properties → "Unblock", or in PowerShell `Unblock-File .\ReqSeq-<version>-win-x64.zip`.

## Linux

Linux has no such check. Verify the download with `shasum -a 256 -c SHA256SUMS.txt --ignore-missing`. Ubuntu 24.04 needs one admin step for the app's sandbox ([Getting ReqSeq](README.md#ubuntu-2404-one-admin-step-for-the-apps-sandbox)).

## Without network

A check that macOS or Windows make online when a program is opened for the first time is the operating system's, not ReqSeq's (SR-078 concerns the tool). Without network they show the same dialog, and the steps above work the same way.
