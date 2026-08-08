# Excel input

Keep **one current matching `.xlsx` workbook** in this folder.

## Filename replacement

The workbook filename can be changed to anything. The build does **not** depend on the filename.

Examples:

- `Z Report July 2026.xlsx`
- `Latest ZREPORT.xlsx`
- `Z Report Aug 2026 Final.xlsx`

The build identifies the correct workbook from its internal schema.

## Required sheets

The replacement workbook must continue to contain:

- `MAIN`
- `All Year`
- `AUTOMATED PROJECTED ZREPORT`

## Required MAIN headers

`MAIN` row 2 must continue to include:

- `Code`
- `Month`
- `Name`

The category Sales / FootFall columns are mapped automatically from the formulas already used in the `All Year` sheet. Therefore the Excel filename can change without code changes.

## New month columns in All Year

Supported automatically.

The build scans **all** columns in `All Year` row 3 and dynamically detects the `SALES`, `FF`, and `Basket` month blocks. If new month columns are added later, the dashboard does not have a hard-coded month limit.

For actual outlet data, make sure the corresponding new month is also present in the `MAIN` sheet.

## Refresh

1. Delete the old `.xlsx` from `/data`.
2. Upload the new workbook with any filename.
3. Commit to `main`.
4. GitHub Actions rebuilds both dashboards automatically.
