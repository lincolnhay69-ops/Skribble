# Code Signing Policy

This document describes the code signing process for Scribble.

## Signed Artifacts

The following release artifacts are signed:

- **Windows installer** (`.exe`) — NSIS package
- **Windows installer** (`.msi`) — MSI package

## Signing Service

Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by [SignPath Foundation](https://signpath.org).

## Build and Signing Process

1. All artifacts are built from the [Scribble repository](https://github.com/lincolnhay69-ops/Skribble) using automated CI.
2. Only artifacts produced by the official build pipeline are submitted for signing.
3. The private key is held by SignPath on HSM-backed infrastructure — the development team never has access to it.
4. Each signing request requires approval by a designated team member before processing.

## Team Roles

| Role | Responsibility |
|---|---|
| **Authors** | Team members trusted to modify source code without additional review |
| **Reviewers** | Responsible for reviewing pull requests and changes |
| **Approvers** | Authorize each signing request before submission |

## Verification

Users can verify the signature of any Scribble release:

1. Right-click the installer → **Properties** → **Digital Signatures** tab
2. Select the signature and click **Details**
3. Confirm the certificate is issued to **SignPath Foundation** and signed by a trusted certificate authority

## Privacy

Scribble does not collect or transmit personal data during installation. See the [README](README.md) for full privacy details.
