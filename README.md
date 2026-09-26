# YNAB to Money Manager

A local-first browser tool that converts YNAB transaction exports into tab-separated files ready to import into [Money Manager](https://www.realbyteapps.com/).

The converter is designed for an initial public beta. It supports account and category mapping, transfers, sub-currencies, browser-local settings, transaction review, and a five-row test export.

> **Fully AI-coded:** This application was designed and implemented with OpenAI Codex, with product direction, testing, and final approval by [@jacopobr](https://github.com/jacopobr).

> This is an independent community project. It is not affiliated with, endorsed by, or maintained by YNAB or Realbyte. Product names and trademarks belong to their respective owners.

## Privacy

- Transaction and reference files are processed locally in the browser and are not uploaded by this project.
- Settings and mappings are stored in the browser's local storage.
- Excel parsing uses a pinned copy of SheetJS stored in this repository, so no third-party script is loaded when the app opens.
- The app contacts the [Frankfurter API](https://frankfurter.dev/) only when you select **Get exchange rates**. Those requests contain dates and currency codes, not transaction details.
- When hosted on GitHub Pages, GitHub processes standard request information such as visitors' IP addresses for security purposes. See the [GitHub Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).

Do not attach real financial exports to public issues. Use anonymized sample data instead.

## What you need

### Required

A transaction-level CSV or TSV exported from YNAB's **Reflect → Spending Breakdown** report. See [YNAB's export guide](https://support.ynab.com/en_us/how-to-export-reflection-data-Bykou09).

### Optional helpers

- A YNAB **Income & Expense** report to identify income that may be absent from the transaction export.
- A Money Manager XLSX, CSV, or TSV export containing the account and category names you want to map. You can also enter these names manually in Settings.

## Use the converter

1. Add the YNAB transaction export and, optionally, the two reference files.
2. Select the date range to convert.
3. Match YNAB accounts and categories to their Money Manager names.
4. Review transactions marked **Needs your input**.
5. Download and import the five-row test file first.
6. If the result is correct, remove the test rows and import the complete TSV file.

Back up Money Manager before importing. See Realbyte's [backup instructions](https://help.realbyteapps.com/hc/en-us/articles/360043020434-How-to-backup-and-restore-data) and [Excel/sub-currency import instructions](https://help.realbyteapps.com/hc/en-us/articles/21691709364761-How-to-import-bulk-data-by-Excel-file-with-sub-currencies).

## Run locally

The project has no runtime build step or package dependencies. It only needs a static web server.

```sh
npm run serve
```

Then open <http://localhost:8000>. You can also serve the `dist` directory with any static file server.

## Development

The public app is in `dist/`:

- `index.html` contains the interface and help text.
- `styles.css` contains the responsive presentation.
- `app.js` contains parsing, mapping, validation, persistence, and export logic.

Run the repository checks before submitting a change:

```sh
npm run check
```

The checks validate the JavaScript syntax, required repository files, HTML IDs, local asset references, and common publication mistakes. See [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution workflow.

Pushes to `main` publish the contents of `dist/` through GitHub Pages after the repository checks pass.

## Releases

Pushing a semantic-version tag such as `v0.1.0` automatically validates the project and creates a GitHub Release with generated release notes and a downloadable ZIP of the complete website. The tag must use the `vMAJOR.MINOR.PATCH` format.

## Known limitations

- YNAB's Spending Breakdown export can omit income and transfer details; the optional Income & Expense report helps flag possible gaps but is not a transaction source.
- Money Manager account, category, and subcategory names must already exist in Money Manager and match the generated file exactly.
- Date and decimal formats are locale-dependent. Confirm them in Settings before importing.
- Automatic historical exchange rates should be reviewed before import.
- Browser storage is local to one browser. Use **Back up configuration** before clearing browser data or moving to another device.

## Contributing and support

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md), the [Code of Conduct](CODE_OF_CONDUCT.md), and [SECURITY.md](SECURITY.md) before opening a pull request. For usage questions, see [SUPPORT.md](SUPPORT.md).

## License

Released under the [MIT License](LICENSE).

SheetJS is distributed under the Apache License 2.0; its license is included at `dist/vendor/SHEETJS-LICENSE.txt`.
