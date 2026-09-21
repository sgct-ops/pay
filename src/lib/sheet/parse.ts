import type { RawRow } from "./types";

/**
 * Sheet reading. Everything happens in the browser — the export never touches a
 * server before it has been filtered.
 *
 * CSV / TSV / pasted text are parsed here by hand (RFC 4180 quoting, BOM, CRLF).
 * .xlsx and .xls are handed to SheetJS, loaded from a CDN on first use so it
 * stays out of the bundle.
 */

/** Normalise a header the way Return Prime's own column names read. */
export function normaliseHeader(h: string): string {
  return h
    .replace(/^﻿/, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

/** Guess the delimiter from the header line. */
export function sniff(text: string): string {
  const line = text.slice(0, text.indexOf("\n") === -1 ? text.length : text.indexOf("\n"));
  const counts: Array<[string, number]> = [
    [",", (line.match(/,/g) || []).length],
    ["\t", (line.match(/\t/g) || []).length],
    [";", (line.match(/;/g) || []).length],
    ["|", (line.match(/\|/g) || []).length],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ",";
}

/**
 * Parse delimited text into rows keyed by normalised header.
 * Handles quoted fields containing the delimiter, escaped quotes and newlines.
 */
export function parseDelimited(text: string, delimiter?: string): RawRow[] {
  const src = text.replace(/^﻿/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const d = delimiter || sniff(src);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      quoted = true;
    } else if (c === d) {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }

  const nonEmpty = rows.filter((r) => r.some((v) => v.trim() !== ""));
  if (!nonEmpty.length) return [];

  const headers = nonEmpty[0].map(normaliseHeader);
  return nonEmpty.slice(1).map((r) => {
    const o: RawRow = {};
    headers.forEach((h, i) => {
      if (h) o[h] = (r[i] ?? "").trim();
    });
    return o;
  });
}

/* ---------------------------------------------------------------- xlsx ---- */

const SHEETJS_SRC =
  "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";

type SheetJs = {
  read: (data: ArrayBuffer, opts: Record<string, unknown>) => {
    SheetNames: string[];
    Sheets: Record<string, unknown>;
  };
  utils: {
    sheet_to_json: (
      sheet: unknown,
      opts: Record<string, unknown>,
    ) => Array<Array<string | number | null>>;
  };
};

let sheetJsPromise: Promise<SheetJs> | null = null;

/** Load SheetJS once, on demand. Keeps ~900 kB out of the initial bundle. */
function loadSheetJs(): Promise<SheetJs> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Spreadsheets can only be read in the browser."));
  }
  const w = window as unknown as { XLSX?: SheetJs };
  if (w.XLSX) return Promise.resolve(w.XLSX);
  if (sheetJsPromise) return sheetJsPromise;

  sheetJsPromise = new Promise<SheetJs>((resolve, reject) => {
    const el = document.createElement("script");
    el.src = SHEETJS_SRC;
    el.async = true;
    el.onload = () =>
      w.XLSX
        ? resolve(w.XLSX)
        : reject(new Error("Spreadsheet reader loaded but did not initialise."));
    el.onerror = () =>
      reject(
        new Error(
          "Could not load the spreadsheet reader. Check your connection, or save the export as CSV and try again.",
        ),
      );
    document.head.appendChild(el);
  });
  return sheetJsPromise;
}

async function parseWorkbook(buf: ArrayBuffer): Promise<RawRow[]> {
  const XLSX = await loadSheetJs();
  const wb = XLSX.read(buf, { type: "array", cellDates: false, raw: false });
  const first = wb.SheetNames[0];
  if (!first) return [];
  const grid = XLSX.utils.sheet_to_json(wb.Sheets[first], {
    header: 1,
    blankrows: false,
    defval: "",
    raw: false,
  });
  if (!grid.length) return [];

  const headers = (grid[0] || []).map((h) => normaliseHeader(String(h ?? "")));
  return grid.slice(1).map((r) => {
    const o: RawRow = {};
    headers.forEach((h, i) => {
      if (h) o[h] = String(r[i] ?? "").trim();
    });
    return o;
  });
}

/** Read whatever Return Prime handed the user: .csv, .tsv, .txt, .xlsx or .xls. */
export async function readSheetFile(file: File): Promise<RawRow[]> {
  const name = file.name.toLowerCase();
  if (/\.(xlsx|xlsm|xlsb|xls)$/.test(name)) {
    return parseWorkbook(await file.arrayBuffer());
  }
  return parseDelimited(await file.text());
}
