(() => {
  "use strict";

  const Drive = window.ShwapnoDrive;
  const $ = id => document.getElementById(id);
  const DB_NAME = "zreport-google-drive-cache";
  const DB_VERSION = 1;
  const STORE = "snapshots";
  const CACHE_KEY = "latest-v1";
  const REQUIRED_SHEETS = ["MAIN", "All Year", "AUTOMATED PROJECTED ZREPORT"];
  const DEFAULT_RANGE_MONTHS = 12;
  let snapshot = null;
  let onData = null;
  let onStatus = null;
  let refreshPromise = null;
  let watchTimer = null;

  function openDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function dbGet(key) {
    try {
      const db = await openDb();
      return await new Promise(resolve => {
        const request = db.transaction(STORE).objectStore(STORE).get(key);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => resolve(null);
      });
    } catch { return null; }
  }

  async function dbPut(key, value) {
    try {
      const db = await openDb();
      await new Promise(resolve => {
        const request = db.transaction(STORE, "readwrite").objectStore(STORE).put(value, key);
        request.onsuccess = request.onerror = () => resolve();
      });
    } catch { /* Retention failure must not block the live dashboard. */ }
  }

  const norm = value => String(value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
  const cell = (sheet, row, col) => sheet[window.XLSX.utils.encode_cell({ r: row - 1, c: col - 1 })] || null;
  const cellValue = (sheet, row, col) => cell(sheet, row, col)?.v ?? "";
  const cellFormula = (sheet, row, col) => cell(sheet, row, col)?.f || "";
  const colNumber = letters => String(letters || "").toUpperCase().split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);

  function monthKey(value, display = "") {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`;
    }
    for (const raw of [display, value]) {
      const text = String(raw ?? "").trim();
      if (!text) continue;
      let match = text.match(/^([A-Za-z]{3})[-\s/](\d{2}|\d{4})$/);
      if (match) {
        const months = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
        const month = months[match[1].toLowerCase()];
        let year = Number(match[2]);
        if (match[2].length === 2) year += year < 80 ? 2000 : 1900;
        if (month) return `${year}-${String(month).padStart(2, "0")}`;
      }
      match = text.match(/^(\d{4})[-/](\d{1,2})(?:[-/]\d{1,2})?$/);
      if (match) return `${match[1]}-${String(Number(match[2])).padStart(2, "0")}`;
    }
    if (Number.isFinite(Number(value)) && Number(value) > 20000) {
      const parsed = window.XLSX.SSF.parse_date_code(Number(value));
      if (parsed?.y && parsed?.m) return `${parsed.y}-${String(parsed.m).padStart(2, "0")}`;
    }
    return null;
  }

  function monthFromCell(c) { return monthKey(c?.v, c?.w); }
  function safeNumber(value) { const n = Number(value); return Number.isFinite(n) ? n : 0; }
  function shiftMonth(key, offset) {
    const [year, month] = key.split("-").map(Number);
    const date = new Date(year, month - 1 + offset, 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  }

  function mainColFromFormula(formula) {
    const match = String(formula || "").match(/MAIN!\$([A-Z]+):\$([A-Z]+)/i);
    return match && match[1].toUpperCase() === match[2].toUpperCase() ? colNumber(match[1]) : null;
  }

  function dependencyRows(formula) {
    const text = String(formula || "");
    const deps = [];
    for (const match of text.matchAll(/\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)/gi)) {
      if (match[1].toUpperCase() !== match[3].toUpperCase()) continue;
      const start = Number(match[2]), end = Number(match[4]), step = start <= end ? 1 : -1;
      for (let row = start; row !== end + step; row += step) deps.push(row);
    }
    const stripped = text.replace(/\$?[A-Z]+\$?\d+:\$?[A-Z]+\$?\d+/gi, "");
    for (const match of stripped.matchAll(/\$?[A-Z]+\$?(\d+)/gi)) deps.push(Number(match[1]));
    return [...new Set(deps)];
  }

  function sheetByName(workbook, wanted) {
    const name = workbook.SheetNames.find(item => norm(item) === norm(wanted));
    return name ? workbook.Sheets[name] : null;
  }

  function extractAllYear(sheet) {
    const range = window.XLSX.utils.decode_range(sheet["!ref"] || "A1:A1");
    const maxCol = range.e.c + 1;
    const salesCols = [], ffCols = [], basketCols = [];
    for (let col = 1; col <= maxCol; col += 1) {
      const metric = norm(cellValue(sheet, 3, col));
      if (metric === "sales") salesCols.push(col);
      else if (metric === "ff") ffCols.push(col);
      else if (metric === "basket") basketCols.push(col);
    }
    if (!salesCols.length || !ffCols.length || !basketCols.length) throw new Error("All Year is missing the SALES, FF or Basket column group.");

    const horizonMonths = [...new Set(salesCols.map(col => monthFromCell(cell(sheet, 2, col))).filter(Boolean))].sort();
    const rows = [];
    const rowToIndex = new Map();
    const lastRow = Math.min(120, range.e.r + 1);
    for (let row = 5; row <= lastRow; row += 1) {
      const label = String(cellValue(sheet, row, 2) || "").trim();
      if (!label) continue;
      const salesFormula = salesCols.map(col => cellFormula(sheet, row, col)).find(Boolean) || "";
      const ffFormula = ffCols.map(col => cellFormula(sheet, row, col)).find(Boolean) || "";
      const salesMainCol = mainColFromFormula(salesFormula);
      const ffMainCol = mainColFromFormula(ffFormula);
      const detail = Boolean(salesMainCol && ffMainCol);
      rowToIndex.set(row, rows.length);
      rows.push({ excelRow: row, label, kind: detail ? "detail" : "total", salesMainCol, ffMainCol, depsRows: detail ? [] : dependencyRows(salesFormula), detailIndex: null });
    }
    let detailCount = 0;
    rows.forEach(item => { if (item.kind === "detail") item.detailIndex = detailCount++; });
    rows.forEach(item => {
      item.deps = item.depsRows.map(row => rowToIndex.get(row)).filter(index => index !== undefined);
      delete item.depsRows;
    });
    const grandMatch = rows.findIndex(item => norm(item.label) === "grand total");
    return { horizonMonths, rows, detailCount, grandIndex: grandMatch >= 0 ? grandMatch : rows.length - 1 };
  }

  function extractProjected(sheet, allYear) {
    const range = window.XLSX.utils.decode_range(sheet["!ref"] || "A1:A1");
    const detailByLabel = new Map(allYear.rows.filter(item => item.kind === "detail").map(item => [norm(item.label), item.detailIndex]));
    const rows = [];
    const rowToIndex = new Map();
    for (let row = 5; row <= Math.min(100, range.e.r + 1); row += 1) {
      const label = String(cellValue(sheet, row, 1) || "").trim();
      if (!label) continue;
      const detailIndex = detailByLabel.get(norm(label));
      const detail = detailIndex !== undefined;
      rowToIndex.set(row, rows.length);
      rows.push({ excelRow: row, label, kind: detail ? "detail" : "total", detailIndex: detail ? detailIndex : null, depsRows: detail ? [] : dependencyRows(cellFormula(sheet, row, 2)) });
    }
    rows.forEach(item => {
      item.deps = item.depsRows.map(row => rowToIndex.get(row)).filter(index => index !== undefined);
      delete item.depsRows;
    });
    return rows;
  }

  function syntheticMainRow(code, name, rawMonth) {
    const value = String(code || "").trim().toLowerCase();
    if (value.startsWith("all:")) return true;
    return (value.startsWith("all ") || value.startsWith("all -")) && Boolean(monthKey(rawMonth) || monthKey(value.split(":").at(-1)));
  }

  async function parseWorkbook(file, progress = () => {}) {
    if (!window.XLSX) throw new Error("The Excel reader did not load. Refresh the page and try again.");
    progress(`Opening ${file.name}…`);
    await new Promise(resolve => setTimeout(resolve, 20));
    const workbook = window.XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false, cellStyles: false, cellFormula: true });
    const missing = REQUIRED_SHEETS.filter(name => !sheetByName(workbook, name));
    if (missing.length) throw new Error(`The selected Z-Report workbook is missing: ${missing.join(", ")}.`);
    const main = sheetByName(workbook, "MAIN");
    const allYear = extractAllYear(sheetByName(workbook, "All Year"));
    const projectedRows = extractProjected(sheetByName(workbook, "AUTOMATED PROJECTED ZREPORT"), allYear);
    const range = window.XLSX.utils.decode_range(main["!ref"] || "A1:A1");
    const mainCols = {};
    for (let col = 1; col <= range.e.c + 1; col += 1) {
      const header = norm(cellValue(main, 2, col));
      if (["code", "month", "name"].includes(header) && !mainCols[header]) mainCols[header] = col;
    }
    if (!mainCols.code || !mainCols.month || !mainCols.name) throw new Error("MAIN row 2 must contain Code, Month and Name.");
    const details = allYear.rows.filter(item => item.kind === "detail");
    if (details.some(item => !item.salesMainCol || !item.ffMainCol)) throw new Error("One or more All Year categories could not be mapped to MAIN.");

    const outletNames = new Map();
    const outletMonths = new Map();
    const actualMonths = new Set();
    const networkTotals = {};
    const monthSummaries = new Map();
    const lastRow = range.e.r + 1;
    for (let row = 3; row <= lastRow; row += 1) {
      const code = String(cellValue(main, row, mainCols.code) || "").trim();
      const monthCell = cell(main, row, mainCols.month);
      const month = monthFromCell(monthCell);
      if (!code || !month) continue;
      const name = String(cellValue(main, row, mainCols.name) || "").trim();
      const sales = details.map(item => safeNumber(cellValue(main, row, item.salesMainCol)));
      const ff = details.map(item => safeNumber(cellValue(main, row, item.ffMainCol)));
      if (syntheticMainRow(code, name, monthCell?.v)) {
        monthSummaries.set(month, { month, sourceCode: code, outletCount: Math.round(safeNumber(name)), sales, ff });
        continue;
      }
      outletNames.set(code, name || outletNames.get(code) || code);
      actualMonths.add(month);
      if (!outletMonths.has(code)) outletMonths.set(code, {});
      const months = outletMonths.get(code);
      if (!months[month]) months[month] = [sales, ff];
      else {
        for (let index = 0; index < sales.length; index += 1) {
          months[month][0][index] += sales[index];
          months[month][1][index] += ff[index];
        }
      }
      const totalSales = sales.reduce((sum, value) => sum + value, 0);
      const totalFf = ff.reduce((sum, value) => sum + value, 0);
      if (!networkTotals[month]) networkTotals[month] = [0, 0];
      networkTotals[month][0] += totalSales;
      networkTotals[month][1] += totalFf;
      if (row % 2500 === 0) {
        progress(`Reading MAIN: ${Math.min(row, lastRow).toLocaleString()} of ${lastRow.toLocaleString()} rows…`);
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    if (!outletNames.size) throw new Error("No outlet rows were found in MAIN.");

    const actual = [...actualMonths].sort();
    const horizon = [...new Set([...allYear.horizonMonths, ...actual])].sort();
    const earliest = actual[0], latest = actual.at(-1);
    const defaultStart = actual.length > DEFAULT_RANGE_MONTHS ? actual.at(-DEFAULT_RANGE_MONTHS) : earliest;
    const outlets = {};
    const outletIndex = [...outletNames.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })).map(code => {
      outlets[code] = { code, name: outletNames.get(code), months: outletMonths.get(code) || {} };
      return { code, name: outletNames.get(code), file: "" };
    });
    const publicRows = allYear.rows.map(item => ({ excelRow: item.excelRow, label: item.label, kind: item.kind, detailIndex: item.detailIndex, deps: item.deps }));
    const index = {
      meta: {
        sourceWorkbook: file.name,
        generatedAt: new Date().toISOString(),
        sourceKind: "google-drive",
        outletCount: outletNames.size,
        detailCategoryCount: allYear.detailCount,
        allYearRowCount: allYear.rows.length,
        projectedRowCount: projectedRows.length,
        earliestActualMonth: earliest,
        latestActualMonth: latest,
        futureHeaderMonthCount: horizon.filter(month => month > latest).length,
        networkMonthSummaryCount: monthSummaries.size,
      },
      config: { title: "Z-Report Category-Wise Sales & Footfall Dashboard", defaultRangeMonths: DEFAULT_RANGE_MONTHS, requiredSheets: REQUIRED_SHEETS },
      months: horizon.map(key => ({ key, label: key, longLabel: key, actual: actualMonths.has(key) })),
      actualMonths: actual,
      defaultRange: { start: defaultStart, end: latest },
      allYearRows: publicRows,
      allYearGrandIndex: allYear.grandIndex,
      projectedRows,
      networkTotals,
      networkMonthSummaries: [...monthSummaries.keys()].sort().map(key => monthSummaries.get(key)),
      outlets: outletIndex,
    };
    progress(`Calculated ${outletNames.size.toLocaleString()} outlets through ${latest}.`);
    return { index, outlets };
  }

  function workbookScore(meta) {
    const name = String(meta?.name || "").toLowerCase();
    if (!/\.(xlsx|xlsm|xls)$/i.test(name) || name.startsWith("~$")) return 99;
    if (/z[\s_-]*report.*category.*sales|category.*wise.*sales.*(?:ff|foot)|sales.*ff.*outlet/.test(name)) return 0;
    if (/z[\s_-]*report|category.*wise.*sales|footfall.*outlet/.test(name)) return 1;
    return 99;
  }

  function setStatus(kind, label, message) {
    const status = { kind, label, message };
    const badge = $("drive-source-status");
    if (badge) { badge.dataset.kind = kind; badge.textContent = label; }
    if ($("drive-source-note")) $("drive-source-note").textContent = message;
    if (onStatus) onStatus(status);
  }

  async function restore() {
    const saved = await dbGet(CACHE_KEY);
    if (saved?.index?.outlets?.length && saved?.outlets && saved?.savedAt) {
      snapshot = saved;
      return saved;
    }
    return null;
  }

  async function refresh({ interactive = false, pickFolder = false } = {}) {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      try {
        if (interactive) {
          setStatus("reading", "CONNECTING", "Connecting to the shared Google Drive folder…");
          const connection = await Drive.connect({ pickFolder: pickFolder || !Drive.getFolder(), title: "Select shared Shwapno dashboard data folder" });
          if (!connection) return;
        }
        const folder = Drive.getFolder();
        if (!folder) {
          setStatus(snapshot ? "retained" : "idle", snapshot ? "RETAINED SNAPSHOT" : "DRIVE SETUP REQUIRED", snapshot ? "Showing the retained Z-Report snapshot. Use Drive setup to select the shared folder." : "Use Drive setup to select the shared Google Drive folder.");
          return;
        }
        if (!Drive.cachedToken()) {
          setStatus(snapshot ? "retained" : "idle", snapshot ? "RETAINED SNAPSHOT" : "RECONNECT DRIVE", snapshot ? `Showing the retained Z-Report snapshot. Folder “${folder.name}” is remembered; click Reconnect Google Drive to check for updates.` : `Folder “${folder.name}” is remembered. Click Reconnect Google Drive to authorize read-only access.`);
          return;
        }
        setStatus("reading", "CHECKING DRIVE", `Checking “${folder.name}” for the Z-Report workbook…`);
        const files = (await Drive.listFolderFiles(folder.id)).filter(meta => workbookScore(meta) < 99 && meta.capabilities?.canDownload !== false).sort((a, b) => workbookScore(a) - workbookScore(b) || Date.parse(b.modifiedTime || "") - Date.parse(a.modifiedTime || "") || String(a.name).localeCompare(String(b.name)));
        if (!files.length) throw new Error("No workbook named like “Z-REPORT CATEGORY WISE SALES …” was found in the shared Drive folder.");
        const meta = files[0];
        const remoteSignature = Drive.remoteSignature(meta);
        if (snapshot?.remoteSignature === remoteSignature) {
          setStatus("live", "GOOGLE DRIVE — LIVE", `Live from “${folder.name}”. ${snapshot.index.meta.outletCount.toLocaleString()} outlets · ${meta.name}.`);
          startWatch();
          return snapshot;
        }
        setStatus("reading", "DOWNLOADING", `Downloading ${meta.name} from Google Drive…`);
        const file = await Drive.downloadFile(meta);
        const parsed = await parseWorkbook(file, message => setStatus("reading", "READING WORKBOOK", message));
        snapshot = { ...parsed, remoteSignature, savedAt: new Date().toISOString(), folderId: folder.id, folderName: folder.name, fileId: meta.id };
        setStatus("reading", "SAVING SNAPSHOT", "Saving the calculated Z-Report snapshot for fast reopening…");
        await dbPut(CACHE_KEY, snapshot);
        setStatus("live", "GOOGLE DRIVE — LIVE", `Live from “${folder.name}”. ${parsed.index.meta.outletCount.toLocaleString()} outlets · ${meta.name}.`);
        if (onData) onData(snapshot);
        startWatch();
        return snapshot;
      } catch (error) {
        if (error?.name === "AbortError") {
          setStatus(snapshot ? "retained" : "idle", snapshot ? "RETAINED SNAPSHOT" : "DRIVE NOT CONNECTED", snapshot ? "Google Drive sign-in was cancelled. Showing the retained Z-Report snapshot." : "Google Drive sign-in was cancelled.");
          return null;
        }
        setStatus(snapshot ? "retained" : "error", snapshot ? "RETAINED SNAPSHOT" : "DRIVE ERROR", snapshot ? `Showing the retained Z-Report snapshot. ${error?.message || "Google Drive could not be read."}` : (error?.message || "Google Drive could not be read."));
        return null;
      } finally { refreshPromise = null; }
    })();
    return refreshPromise;
  }

  function openSetup() {
    const config = Drive.getConfig();
    $("google-client-id").value = config.clientId;
    $("google-api-key").value = config.apiKey;
    $("google-app-id").value = config.appId;
    $("drive-modal").hidden = false;
  }
  function closeSetup() { $("drive-modal").hidden = true; }

  function startWatch() {
    if (watchTimer) return;
    watchTimer = setInterval(() => { if (!document.hidden && Drive.cachedToken()) refresh(); }, 30000);
  }

  function bind(callbacks = {}) {
    onData = callbacks.onData || null;
    onStatus = callbacks.onStatus || null;
    $("drive-reconnect")?.addEventListener("click", () => Drive.configReady() ? refresh({ interactive: true, pickFolder: false }) : openSetup());
    $("drive-setup")?.addEventListener("click", openSetup);
    $("drive-modal-close")?.addEventListener("click", closeSetup);
    $("drive-modal")?.addEventListener("click", event => { if (event.target === $("drive-modal")) closeSetup(); });
    $("drive-save")?.addEventListener("click", () => {
      try {
        Drive.saveConfig({ clientId: $("google-client-id").value, apiKey: $("google-api-key").value, appId: $("google-app-id").value });
        closeSetup();
        setTimeout(() => refresh({ interactive: true, pickFolder: true }), 0);
      } catch (error) { alert(error.message); }
    });
    $("drive-clear")?.addEventListener("click", () => {
      if (!confirm("Clear the shared Google Drive setup for all supported dashboards on this browser?")) return;
      Drive.clearSetup();
      closeSetup();
      setStatus(snapshot ? "retained" : "idle", snapshot ? "RETAINED SNAPSHOT" : "DRIVE SETUP REQUIRED", snapshot ? "Shared Drive setup was cleared. Showing the retained Z-Report snapshot." : "Shared Drive setup was cleared.");
    });
    document.addEventListener("visibilitychange", () => { if (!document.hidden && Drive.cachedToken()) refresh(); });
  }

  window.ZReportDrive = Object.freeze({ restore, bind, refresh, parseWorkbook });
})();
