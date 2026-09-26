# Contributing

Thank you for helping improve YNAB to Money Manager.

## Before you start

- Search existing issues before opening a new one.
- For a large behavior or interface change, open an issue first so the approach can be discussed.
- Never publish real financial exports, account numbers, payees, balances, or other personal data. Create a small anonymized fixture instead.
- Follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Local setup

This is a dependency-free static app. You need a current Node.js release for checks and Python 3 (or another static server) to preview it.

```sh
npm run serve
```

Open <http://localhost:8000>, then use **Load a small example** or anonymized files for testing.

## Make a change

1. Create a focused branch from `main`.
2. Keep parsing and conversion logic in `dist/app.js`, presentation in `dist/styles.css`, and interface copy in `dist/index.html`.
3. Test the required-file flow, mapping flow, review state, test export, and complete export when your change touches them.
4. Check keyboard navigation and both desktop and narrow layouts for interface changes.
5. Run `npm run check`.
6. Open a pull request that explains the problem, the change, and how it was tested.

## Pull requests

Keep pull requests small enough to review. Screenshots are useful for visual changes, but must not contain personal financial information. A maintainer may ask for changes before merging.

By contributing, you agree that your contribution will be licensed under the MIT License.

## Publishing a release

Only the repository owner publishes releases. After confirming that `main` is ready, create and push a semantic-version tag:

```sh
git tag v0.1.0
git push origin v0.1.0
```

The release workflow validates the tagged commit, packages `dist/`, generates release notes, and creates the GitHub Release automatically.
