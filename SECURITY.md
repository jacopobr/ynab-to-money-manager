# Security policy

## Reporting a vulnerability

Please do not open a public issue for a suspected security or privacy vulnerability. Use GitHub's private vulnerability reporting feature for this repository. If that option is unavailable, contact the repository owner privately through their GitHub profile.

Include a concise description, affected files or behavior, reproduction steps, and the impact. Do not include real transaction exports, credentials, account numbers, or other personal financial data.

You can expect an acknowledgement within seven days. Please allow time to investigate and prepare a fix before publicly disclosing the issue.

## Supported version

Security fixes target the latest version on the `main` branch. Older snapshots are not maintained.

## Privacy model

The app processes financial files in the browser. Any change that adds a network request, analytics, tracking, remote storage, or additional third-party code must be clearly documented and reviewed as a privacy-sensitive change.

The SheetJS browser bundle is pinned and stored in the repository. Updates must include the corresponding upstream license and must pass review before they are merged.
