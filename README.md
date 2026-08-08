# Z-Report Dual Dashboard

A production-ready GitHub Pages dashboard built from the supplied Z-Report Excel workbook.

## Two linked dashboards

### Dashboard 1 — All Year

- One global outlet selector
- Search by outlet code or outlet name
- Start / End month range controls
- Quick ranges: 6M / 12M / 24M / All
- Sales / FF / Basket metric switch
- KPI summary
- Grand Total monthly trend
- Category × month table
- Sort every visible month column
- Sticky Category column
- Download visible range to CSV
- New month columns are detected dynamically

### Dashboard 2 — AUTOMATED PROJECTED ZREPORT

- Uses the **same selected outlet**
- Uses the selected **To month** as Last Month
- Automatically derives:
  - Last Year reference month
  - following Projected month
  - network seasonal Sales growth factor
  - network seasonal FF growth factor
- Recreates the workbook's projection logic
- Last Year / Last Month / Projected Sales, FF and Basket
- Growth / De-growth columns
- Contribution %
- Sort every column
- Download to CSV

## Pure dark theme

The dashboard is intentionally solid dark:

- no glass effect
- no transparency
- dark dropdown menus
- white / light text
- blue performance accents
- readable alternating dark table rows

## Excel filename is not hard-coded

The workbook in `/data` can be renamed freely.

The build identifies the source from the required sheets and headers, then discovers month blocks and category mappings dynamically.

## New months

The dashboard does not have a hard-coded end month.

`All Year` month columns are scanned dynamically. When new months are added to the workbook and matching actual data is added to `MAIN`, they become available automatically.

## Projection logic

The dashboard intentionally follows the supplied workbook's existing logic rather than silently changing it.

For selected Last Month `M`:

- Last Year reference = `M - 12 months`
- Previous Last Year month = one month before that reference
- Projected month = `M + 1 month`
- Network seasonal growth = Last Year reference total ÷ Previous Last Year total − 1
- Projected outlet grand total = selected outlet Last Month total × (1 + network seasonal growth)
- Projected category values use the selected outlet's Last Month category mix
- Basket = Sales ÷ FF

## Local build

```bash
python scripts/build.py
python -m http.server 8000 -d site
```

Then open:

`http://localhost:8000`

## GitHub Pages

See `SETUP_GUIDE.md`.
