#!/usr/bin/env python3
from __future__ import annotations

import json
import math
import re
import shutil
import sys
import zipfile
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from pathlib import Path
from posixpath import normpath

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
WEB_DIR = ROOT / "web"
SITE_DIR = ROOT / "site"
CONFIG_PATH = ROOT / "config" / "dashboard.config.json"

MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
OFFICE_REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"

MONTH_RX = re.compile(r"^\s*([A-Za-z]{3})[-\s/](\d{2}|\d{4})\s*$")
MONTHS = {m.lower(): i for i, m in enumerate(
    ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"], 1
)}

def norm(value: object) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip()).casefold()

def col_num(ref: str) -> int:
    m = re.match(r"([A-Z]+)", ref or "")
    if not m:
        return 0
    n = 0
    for ch in m.group(1):
        n = n * 26 + ord(ch) - 64
    return n

def col_letter(n: int) -> str:
    s = ""
    while n:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s

def month_key(value: object) -> str | None:
    text = str(value or "").strip()
    if not text:
        return None

    m = MONTH_RX.match(text)
    if m:
        mon = MONTHS.get(m.group(1).lower())
        year_text = m.group(2)
        if mon:
            year = int(year_text)
            if len(year_text) == 2:
                year += 2000 if year < 80 else 1900
            return f"{year:04d}-{mon:02d}"

    for fmt in ("%Y-%m", "%Y/%m", "%b-%Y", "%b %Y", "%Y-%m-%d", "%d-%b-%Y"):
        try:
            return datetime.strptime(text, fmt).strftime("%Y-%m")
        except ValueError:
            pass

    # Excel serial date fallback.
    try:
        serial = float(text)
        if serial > 20000:
            dt = datetime(1899, 12, 30) + timedelta(days=serial)
            return dt.strftime("%Y-%m")
    except Exception:
        pass
    return None

def month_label(key: str) -> str:
    return datetime.strptime(key, "%Y-%m").strftime("%b-%y")

def month_long(key: str) -> str:
    return datetime.strptime(key, "%Y-%m").strftime("%B %Y")

def shift_month(key: str, offset: int) -> str:
    dt = datetime.strptime(key, "%Y-%m")
    total = dt.year * 12 + (dt.month - 1) + offset
    y, m = divmod(total, 12)
    return f"{y:04d}-{m+1:02d}"

def safe_number(value: object) -> float:
    text = str(value or "").strip()
    if not text:
        return 0.0
    try:
        n = float(text)
        if not math.isfinite(n):
            return 0.0
        return n
    except Exception:
        return 0.0

def safe_filename(code: str) -> str:
    base = re.sub(r"[^A-Za-z0-9_-]+", "_", code.strip())
    return base or "OUTLET"


def is_synthetic_main_row(code: object, name: object, month: object) -> bool:
    code_text = str(code or "").strip()
    name_text = str(name or "").strip()
    month_text = str(month or "").strip()

    # Workbook contains synthetic monthly summary rows such as:
    #   Code = "All:Jan-21"
    #   Month = "Jan-21"
    #   Name = "157"
    # Those rows must not appear in the outlet selector and must not be used
    # as actual outlet data or network totals.
    if code_text.lower().startswith("all:"):
        return True

    # Defensive fallback in case future files use the same pattern with different casing/spaces.
    if code_text.lower().startswith("all -") or code_text.lower().startswith("all "):
        if month_key(code_text.split(":", 1)[-1].strip()) or month_key(month_text):
            return True

    return False

class XlsxReader:
    def __init__(self, path: Path):
        self.path = path
        self.zf = zipfile.ZipFile(path)
        self.shared = self._read_shared_strings()
        self.sheets = self._sheet_targets()

    def close(self):
        self.zf.close()

    def _read_shared_strings(self) -> list[str]:
        if "xl/sharedStrings.xml" not in self.zf.namelist():
            return []
        root = ET.fromstring(self.zf.read("xl/sharedStrings.xml"))
        return [
            "".join(t.text or "" for t in si.iter(f"{{{MAIN_NS}}}t"))
            for si in root.findall(f"{{{MAIN_NS}}}si")
        ]

    def _sheet_targets(self) -> dict[str, str]:
        wb = ET.fromstring(self.zf.read("xl/workbook.xml"))
        rels = ET.fromstring(self.zf.read("xl/_rels/workbook.xml.rels"))
        relmap = {
            rel.attrib["Id"]: rel.attrib["Target"]
            for rel in rels.findall(f"{{{PKG_REL_NS}}}Relationship")
        }
        result = {}
        sheets_node = wb.find(f"{{{MAIN_NS}}}sheets")
        if sheets_node is None:
            return result
        for sheet in sheets_node:
            rid = sheet.attrib.get(f"{{{OFFICE_REL_NS}}}id")
            if rid and rid in relmap:
                target = relmap[rid].lstrip("/")
                if not target.startswith("xl/"):
                    target = "xl/" + target
                result[sheet.attrib.get("name", "")] = normpath(target)
        return result

    def has_sheets(self, names: list[str]) -> bool:
        return all(n in self.sheets for n in names)

    def _decode_cell(self, cell: ET.Element) -> tuple[str, str]:
        cell_type = cell.attrib.get("t")
        formula_node = cell.find(f"{{{MAIN_NS}}}f")
        formula = formula_node.text or "" if formula_node is not None else ""

        value = ""
        if cell_type == "inlineStr":
            inline = cell.find(f"{{{MAIN_NS}}}is")
            if inline is not None:
                value = "".join(t.text or "" for t in inline.iter(f"{{{MAIN_NS}}}t"))
        else:
            value_node = cell.find(f"{{{MAIN_NS}}}v")
            if value_node is not None:
                raw = value_node.text or ""
                if cell_type == "s":
                    try:
                        value = self.shared[int(raw)]
                    except Exception:
                        value = raw
                elif cell_type == "b":
                    value = "TRUE" if raw == "1" else "FALSE"
                else:
                    value = raw
        return value, formula

    def iter_rows(self, sheet_name: str):
        target = self.sheets[sheet_name]
        with self.zf.open(target) as fh:
            for event, elem in ET.iterparse(fh, events=("end",)):
                if elem.tag == f"{{{MAIN_NS}}}row":
                    row_num = int(elem.attrib.get("r", "0"))
                    row = {}
                    for cell in elem.findall(f"{{{MAIN_NS}}}c"):
                        idx = col_num(cell.attrib.get("r", ""))
                        if idx:
                            value, formula = self._decode_cell(cell)
                            row[idx] = {"v": value, "f": formula}
                    yield row_num, row
                    elem.clear()

    def rows_subset(self, sheet_name: str, wanted: set[int]) -> dict[int, dict[int, dict]]:
        out = {}
        max_wanted = max(wanted) if wanted else 0
        for rn, row in self.iter_rows(sheet_name):
            if rn in wanted:
                out[rn] = row
            if max_wanted and rn > max_wanted:
                break
        return out

def find_source(required_sheets: list[str]) -> Path:
    candidates = []
    diagnostics = []
    for path in sorted(DATA_DIR.glob("*.xlsx")):
        if path.name.startswith("~$"):
            continue
        try:
            reader = XlsxReader(path)
            try:
                if not reader.has_sheets(required_sheets):
                    diagnostics.append(
                        f"{path.name}: missing sheet(s): "
                        + ", ".join(s for s in required_sheets if s not in reader.sheets)
                    )
                    continue

                main = reader.rows_subset("MAIN", {2}).get(2, {})
                headers = {norm(c["v"]) for c in main.values()}
                if not {"code", "month", "name"}.issubset(headers):
                    diagnostics.append(f"{path.name}: MAIN row 2 does not contain Code, Month and Name.")
                    continue

                ay = reader.rows_subset("All Year", {2, 3})
                metric_vals = {norm(c["v"]) for c in ay.get(3, {}).values()}
                if not {"sales", "ff", "basket"}.issubset(metric_vals):
                    diagnostics.append(f"{path.name}: All Year row 3 is missing SALES / FF / Basket metric blocks.")
                    continue
                candidates.append(path)
            finally:
                reader.close()
        except Exception as exc:
            diagnostics.append(f"{path.name}: could not read workbook ({exc})")

    if not candidates:
        raise RuntimeError(
            "No workbook in /data matches the required Z-Report schema.\n"
            "Required sheets: MAIN, All Year, AUTOMATED PROJECTED ZREPORT.\n\n"
            + "\n".join(diagnostics[:12])
        )
    if len(candidates) > 1:
        raise RuntimeError(
            "More than one matching Z-Report workbook was found in /data. "
            "Keep only the current workbook so the dashboard never guesses:\n"
            + "\n".join(f" - {p.name}" for p in candidates)
        )
    return candidates[0]

def cell_value(row: dict[int, dict], col: int) -> str:
    return row.get(col, {}).get("v", "")

def cell_formula(row: dict[int, dict], col: int) -> str:
    return row.get(col, {}).get("f", "")

def main_col_from_formula(formula: str) -> int | None:
    # Examples: SUMIFS(MAIN!$H:$H, ...)
    m = re.search(r"MAIN!\$([A-Z]+):\$([A-Z]+)", formula or "", re.I)
    if not m:
        return None
    if m.group(1).upper() != m.group(2).upper():
        return None
    return col_num(m.group(1).upper())

def dependency_rows(formula: str) -> list[int]:
    formula = formula or ""
    deps: list[int] = []

    # Expand same-column row ranges first.
    for m in re.finditer(r"\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)", formula, re.I):
        if m.group(1).upper() == m.group(3).upper():
            a, b = int(m.group(2)), int(m.group(4))
            step = 1 if a <= b else -1
            deps.extend(range(a, b + step, step))

    # Remove ranges before collecting standalone cells to avoid duplicate endpoints.
    stripped = re.sub(r"\$?[A-Z]+\$?\d+:\$?[A-Z]+\$?\d+", "", formula, flags=re.I)
    for m in re.finditer(r"\$?[A-Z]+\$?(\d+)", stripped, re.I):
        deps.append(int(m.group(1)))

    seen = set()
    ordered = []
    for r in deps:
        if r not in seen:
            seen.add(r)
            ordered.append(r)
    return ordered

def extract_all_year(reader: XlsxReader) -> dict:
    rows = {}
    for rn, row in reader.iter_rows("All Year"):
        if rn <= 120:
            rows[rn] = row
        else:
            break

    row2 = rows.get(2, {})
    row3 = rows.get(3, {})

    sales_cols = sorted(c for c, x in row3.items() if norm(x["v"]) == "sales")
    ff_cols = sorted(c for c, x in row3.items() if norm(x["v"]) == "ff")
    basket_cols = sorted(c for c, x in row3.items() if norm(x["v"]) == "basket")

    if not sales_cols or not ff_cols or not basket_cols:
        raise RuntimeError("All Year does not contain SALES, FF and Basket column groups in row 3.")

    horizon = []
    for c in sales_cols:
        mk = month_key(cell_value(row2, c))
        if mk:
            horizon.append(mk)
    horizon = sorted(dict.fromkeys(horizon))

    row_defs = []
    row_to_idx = {}

    # B column contains the displayed row labels in All Year.
    for rn in sorted(rows):
        if rn < 5:
            continue
        label = str(cell_value(rows[rn], 2) or "").strip()
        if not label:
            continue

        sales_formula = ""
        ff_formula = ""
        for c in sales_cols:
            sales_formula = cell_formula(rows[rn], c)
            if sales_formula:
                break
        for c in ff_cols:
            ff_formula = cell_formula(rows[rn], c)
            if ff_formula:
                break

        sales_main_col = main_col_from_formula(sales_formula)
        ff_main_col = main_col_from_formula(ff_formula)
        is_detail = sales_main_col is not None and ff_main_col is not None

        item = {
            "excelRow": rn,
            "label": label,
            "kind": "detail" if is_detail else "total",
            "salesMainCol": sales_main_col,
            "ffMainCol": ff_main_col,
            "formula": sales_formula,
            "depsRows": [] if is_detail else dependency_rows(sales_formula),
        }
        row_to_idx[rn] = len(row_defs)
        row_defs.append(item)

    # Detail index is the compact index stored in outlet JSON.
    detail_count = 0
    for item in row_defs:
        if item["kind"] == "detail":
            item["detailIndex"] = detail_count
            detail_count += 1
        else:
            item["detailIndex"] = None

    for item in row_defs:
        item["deps"] = [
            row_to_idx[r] for r in item["depsRows"] if r in row_to_idx
        ]
        item.pop("depsRows", None)
        item.pop("formula", None)

    grand_idx = next(
        (i for i, r in enumerate(row_defs) if norm(r["label"]) == "grand total"),
        len(row_defs) - 1
    )

    return {
        "horizonMonths": horizon,
        "rows": row_defs,
        "detailCount": detail_count,
        "grandIndex": grand_idx,
    }

def extract_projected_schema(reader: XlsxReader, all_year: dict) -> list[dict]:
    rows = {}
    for rn, row in reader.iter_rows("AUTOMATED PROJECTED ZREPORT"):
        if rn <= 100:
            rows[rn] = row
        else:
            break

    # Map All Year detail labels to compact detail indexes.
    detail_by_label = {
        norm(r["label"]): r["detailIndex"]
        for r in all_year["rows"] if r["kind"] == "detail"
    }

    defs = []
    row_to_idx = {}
    for rn in sorted(rows):
        if rn < 5:
            continue
        label = str(cell_value(rows[rn], 1) or "").strip()
        if not label:
            continue

        detail_idx = detail_by_label.get(norm(label))
        formula = cell_formula(rows[rn], 2)  # B column = Sales in the "Last Year" block
        kind = "detail" if detail_idx is not None else "total"

        item = {
            "excelRow": rn,
            "label": label,
            "kind": kind,
            "detailIndex": detail_idx,
            "depsRows": [] if kind == "detail" else dependency_rows(formula),
        }
        row_to_idx[rn] = len(defs)
        defs.append(item)

    for item in defs:
        item["deps"] = [
            row_to_idx[r] for r in item["depsRows"] if r in row_to_idx
        ]
        item.pop("depsRows", None)

    return defs

def build() -> dict:
    cfg = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    source = find_source(cfg["requiredSheets"])
    reader = XlsxReader(source)

    try:
        all_year = extract_all_year(reader)
        projected_rows = extract_projected_schema(reader, all_year)

        main_header = reader.rows_subset("MAIN", {1, 2})
        row1 = main_header.get(1, {})
        row2 = main_header.get(2, {})

        main_cols = {}
        for col, cell in row2.items():
            h = norm(cell["v"])
            if h in {"code", "month", "name"} and h not in main_cols:
                main_cols[h] = col
        if set(main_cols) != {"code", "month", "name"}:
            raise RuntimeError("MAIN row 2 must contain Code, Month and Name.")

        detail_defs = [r for r in all_year["rows"] if r["kind"] == "detail"]
        for d in detail_defs:
            if not d["salesMainCol"] or not d["ffMainCol"]:
                raise RuntimeError(f"Could not map MAIN Sales/FootFall columns for category '{d['label']}'.")

        outlets: dict[str, str] = {}
        outlet_months: dict[str, dict[str, list[list[float]]]] = {}
        actual_months = set()
        network: dict[str, list[float]] = {}
        monthly_summary_rows: dict[str, dict] = {}

        for rn, row in reader.iter_rows("MAIN"):
            if rn <= 2:
                continue

            code = str(cell_value(row, main_cols["code"]) or "").strip()
            raw_month = cell_value(row, main_cols["month"])
            mk = month_key(raw_month)
            if not code or not mk:
                continue

            name = str(cell_value(row, main_cols["name"]) or "").strip()

            sales = [safe_number(cell_value(row, d["salesMainCol"])) for d in detail_defs]
            ff = [safe_number(cell_value(row, d["ffMainCol"])) for d in detail_defs]

            # Keep workbook-generated monthly "All:" summary rows in a separate,
            # chronological dashboard selector instead of treating them as outlets.
            if is_synthetic_main_row(code, name, raw_month):
                outlet_count = int(round(safe_number(name))) if safe_number(name) else 0
                monthly_summary_rows[mk] = {
                    "month": mk,
                    "sourceCode": code,
                    "outletCount": outlet_count,
                    "sales": sales,
                    "ff": ff,
                }
                continue

            if name:
                outlets[code] = name
            else:
                outlets.setdefault(code, code)

            actual_months.add(mk)

            om = outlet_months.setdefault(code, {})
            if mk not in om:
                om[mk] = [sales, ff]
            else:
                # Sum duplicate outlet-month rows defensively.
                existing = om[mk]
                for i in range(len(sales)):
                    existing[0][i] += sales[i]
                    existing[1][i] += ff[i]

            grand_sales = sum(sales)
            grand_ff = sum(ff)
            nt = network.setdefault(mk, [0.0, 0.0])
            nt[0] += grand_sales
            nt[1] += grand_ff

        if not outlets:
            raise RuntimeError("No outlet rows were found in MAIN.")

        actual_months_sorted = sorted(actual_months)
        horizon = sorted(set(all_year["horizonMonths"]) | set(actual_months_sorted))

        # The workbook currently contains future All Year month headers; default end is latest actual MAIN month.
        latest_actual = actual_months_sorted[-1]
        earliest_actual = actual_months_sorted[0]
        default_n = int(cfg.get("defaultRangeMonths", 12))
        default_start = earliest_actual
        if default_n > 0 and len(actual_months_sorted) > default_n:
            default_start = actual_months_sorted[-default_n]

        outlet_index = []
        used_files = set()
        data_dir = SITE_DIR / "data" / "outlets"
        data_dir.mkdir(parents=True, exist_ok=True)

        for code in sorted(outlets, key=lambda x: (x[0:1], x)):
            base_name = safe_filename(code)
            file_name = base_name + ".json"
            suffix = 2
            while file_name in used_files:
                file_name = f"{base_name}_{suffix}.json"
                suffix += 1
            used_files.add(file_name)

            payload = {
                "code": code,
                "name": outlets[code],
                "months": outlet_months.get(code, {}),
            }
            (data_dir / file_name).write_text(
                json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
                encoding="utf-8"
            )
            outlet_index.append({
                "code": code,
                "name": outlets[code],
                "file": f"data/outlets/{file_name}",
            })

        # Do not expose MAIN column positions in the browser metadata.
        public_rows = []
        for r in all_year["rows"]:
            public_rows.append({
                "excelRow": r["excelRow"],
                "label": r["label"],
                "kind": r["kind"],
                "detailIndex": r["detailIndex"],
                "deps": r["deps"],
            })

        index_payload = {
            "meta": {
                "sourceWorkbook": source.name,
                "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "outletCount": len(outlets),
                "detailCategoryCount": all_year["detailCount"],
                "allYearRowCount": len(all_year["rows"]),
                "projectedRowCount": len(projected_rows),
                "earliestActualMonth": earliest_actual,
                "latestActualMonth": latest_actual,
                "futureHeaderMonthCount": len([m for m in horizon if m > latest_actual]),
                "networkMonthSummaryCount": len(monthly_summary_rows),
            },
            "config": cfg,
            "months": [
                {"key": m, "label": month_label(m), "longLabel": month_long(m), "actual": m in actual_months}
                for m in horizon
            ],
            "actualMonths": actual_months_sorted,
            "defaultRange": {"start": default_start, "end": latest_actual},
            "allYearRows": public_rows,
            "allYearGrandIndex": all_year["grandIndex"],
            "projectedRows": projected_rows,
            "networkTotals": network,
            "networkMonthSummaries": [
                monthly_summary_rows[m] for m in sorted(monthly_summary_rows)
            ],
            "outlets": outlet_index,
        }
        (SITE_DIR / "data" / "index.json").write_text(
            json.dumps(index_payload, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8"
        )

        summary = {
            "sourceWorkbook": source.name,
            "outlets": len(outlets),
            "actualMonths": len(actual_months_sorted),
            "monthHorizon": len(horizon),
            "earliestActual": earliest_actual,
            "latestActual": latest_actual,
            "allYearRows": len(all_year["rows"]),
            "detailCategories": all_year["detailCount"],
            "projectedRows": len(projected_rows),
            "networkMonthSummaries": len(monthly_summary_rows),
            "projectedTargetFromLatestActual": shift_month(latest_actual, 1),
        }
        return summary
    finally:
        reader.close()

def main() -> int:
    try:
        if SITE_DIR.exists():
            shutil.rmtree(SITE_DIR)
        SITE_DIR.mkdir(parents=True, exist_ok=True)

        # Copy app shell before building the generated data files.
        for filename in ("index.html", "styles.css", "app.js", "google-drive-source.js", "drive-zreport.js", "drive-owner-mode.js", "cloud-snapshot.js", "supabase-sync.js"):
            shutil.copy2(WEB_DIR / filename, SITE_DIR / filename)
        (SITE_DIR / ".nojekyll").write_text("", encoding="utf-8")

        summary = build()
        print(json.dumps(summary, indent=2))
        return 0
    except Exception as exc:
        print("\nBUILD FAILED\n============", file=sys.stderr)
        print(str(exc), file=sys.stderr)
        return 1

if __name__ == "__main__":
    raise SystemExit(main())
