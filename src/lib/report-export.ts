import ExcelJS from "exceljs";
import { statusLabels } from "./types";

type ExportCategory = { id: string; code: string; name: string; numeric_code?: number | null };
type ExportStop = {
  id: string;
  report_id: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  description: string | null;
  stop_category_id: string;
  stop_category?: ExportCategory | null;
};

interface WorkbookInput {
  reports: any[];
  metrics: any[];
  stops: ExportStop[];
  categories: ExportCategory[];
  filterLabel: string;
  generatedLabel: string;
}

const TITLE_FILL = "FF047857";
const HEADER_FILL = "FFD1FAE5";
const HEADER_TEXT = "FF064E3B";
const BORDER_COLOR = "FFD1D5DB";

function excelDate(value: string | null | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function bogotaDateTime(value: string | null | undefined) {
  if (!value) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((item) => item.type === type)?.value ?? 0);
  return new Date(Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second")));
}

function relationLabel(value: any) {
  if (!value) return null;
  return [value.code, value.name].filter(Boolean).join(" · ") || null;
}

function shiftLabel(report: any) {
  const shift = report.shift_catalog;
  if (!shift) return report.shift || null;
  const range = `${String(shift.start_time).slice(0, 5)} - ${String(shift.end_time).slice(0, 5)}`;
  return shift.name ? `${shift.name} · ${range}` : range;
}

function durationValue(seconds: number | string | null | undefined) {
  return seconds === null || seconds === undefined ? null : Number(seconds) / 86400;
}

function productiveHoursValue(hours: number | string | null | undefined) {
  return hours === null || hours === undefined ? null : Number(hours) / 24;
}

function numericValue(value: number | string | null | undefined) {
  return value === null || value === undefined || value === "" ? null : Number(value);
}

function columnLetter(column: number) {
  let value = column;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function styleSheet(sheet: ExcelJS.Worksheet, columnCount: number, widths: number[]) {
  sheet.mergeCells(1, 1, 1, columnCount);
  sheet.mergeCells(2, 1, 2, columnCount);
  sheet.getRow(1).height = 28;
  sheet.getRow(2).height = 22;
  sheet.getRow(3).height = 46;
  sheet.getRow(1).eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TITLE_FILL } };
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 14 };
    cell.alignment = { horizontal: "center", vertical: "middle" };
  });
  sheet.getRow(2).eachCell((cell) => {
    cell.font = { italic: true, color: { argb: "FF475569" }, size: 10 };
    cell.alignment = { horizontal: "left", vertical: "middle" };
  });
  sheet.getRow(3).eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    cell.font = { bold: true, color: { argb: HEADER_TEXT }, size: 10 };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = {
      top: { style: "thin", color: { argb: BORDER_COLOR } },
      left: { style: "thin", color: { argb: BORDER_COLOR } },
      bottom: { style: "thin", color: { argb: BORDER_COLOR } },
      right: { style: "thin", color: { argb: BORDER_COLOR } },
    };
  });
  widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  sheet.views = [{ state: "frozen", ySplit: 3, topLeftCell: "A4" }];
  sheet.autoFilter = `A3:${columnLetter(columnCount)}3`;
  sheet.properties.defaultRowHeight = 18;
  sheet.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
}

function styleDataRows(sheet: ExcelJS.Worksheet, columnCount: number) {
  for (let rowIndex = 4; rowIndex <= sheet.rowCount; rowIndex += 1) {
    const row = sheet.getRow(rowIndex);
    row.alignment = { vertical: "middle", wrapText: true };
    for (let column = 1; column <= columnCount; column += 1) {
      row.getCell(column).border = { bottom: { style: "hair", color: { argb: BORDER_COLOR } } };
    }
  }
}

export async function buildProductionWorkbook(input: WorkbookInput) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Reporte de producción";
  workbook.created = new Date();
  workbook.modified = new Date();

  const categoryById = new Map(input.categories.map((category) => [category.id, category]));
  for (const stop of input.stops) {
    if (stop.stop_category && !categoryById.has(stop.stop_category.id)) categoryById.set(stop.stop_category.id, stop.stop_category);
  }
  const categories = [...categoryById.values()].sort((left, right) => {
    const leftCode = left.numeric_code ?? Number(left.code);
    const rightCode = right.numeric_code ?? Number(right.code);
    if (Number.isFinite(leftCode) && Number.isFinite(rightCode) && leftCode !== rightCode) return leftCode - rightCode;
    return left.code.localeCompare(right.code, "es", { numeric: true }) || left.name.localeCompare(right.name, "es");
  });
  const metricsById = new Map(input.metrics.map((metric) => [metric.id, metric]));
  const stopsByReport = new Map<string, ExportStop[]>();
  for (const stop of input.stops) {
    const current = stopsByReport.get(stop.report_id) ?? [];
    current.push(stop);
    stopsByReport.set(stop.report_id, current);
  }

  const productionHeaders = [
    "No. Reporte", "Estado", "O.P.", "Línea", "Producto", "Cliente", "Lote", "Fecha", "Operario", "Turno", "Máquina",
    "G/min", "Unidades teóricas por hora", "Horas programadas", "Tiempo total de parada", "Tiempo productivo neto",
    "Objetivo teórico", "Objetivo neto", "Unidades producidas", "Rendimiento teórico", "Rendimiento neto", "Desperdicio",
    "Tipo/Dosificador", "Peso (gr)", "Observaciones",
    ...categories.map((category) => `P-${category.code}`),
  ];
  const production = workbook.addWorksheet("SEGUIMIENTO PRODUCCIÓN");
  production.addRow(["SEGUIMIENTO DIARIO DE PRODUCCIÓN"]);
  production.addRow([`${input.filterLabel} · Generado: ${input.generatedLabel}`]);
  production.addRow(productionHeaders);

  for (const report of input.reports) {
    const metric = metricsById.get(report.id) ?? {};
    const reportStops = stopsByReport.get(report.id) ?? [];
    const categoryDurations = new Map<string, number>();
    for (const stop of reportStops) {
      if (!stop.ended_at || stop.duration_seconds === null) continue;
      categoryDurations.set(stop.stop_category_id, (categoryDurations.get(stop.stop_category_id) ?? 0) + Number(stop.duration_seconds));
    }
    production.addRow([
      report.folio,
      statusLabels[report.status as keyof typeof statusLabels] ?? report.status,
      report.production_order || null,
      report.line?.code || null,
      report.product_name || report.product?.name || null,
      report.client_name || report.client?.name || null,
      report.lot || null,
      excelDate(report.report_date),
      report.creator_full_name,
      shiftLabel(report),
      relationLabel(report.machine),
      numericValue(report.g_min),
      numericValue(metric.theoretical_units_per_hour),
      numericValue(report.programmed_hours),
      durationValue(metric.total_downtime_seconds),
      productiveHoursValue(metric.net_productive_hours),
      numericValue(metric.theoretical_target),
      numericValue(metric.net_target),
      numericValue(report.units_produced),
      numericValue(metric.theoretical_performance),
      numericValue(metric.net_performance),
      numericValue(report.waste),
      report.dosifier_type?.code || null,
      numericValue(report.weight),
      report.observations || null,
      ...categories.map((category) => categoryDurations.has(category.id) ? durationValue(categoryDurations.get(category.id)) : null),
    ]);
  }
  styleSheet(production, productionHeaders.length, [18, 14, 16, 12, 28, 26, 16, 13, 24, 24, 22, 11, 18, 16, 18, 18, 17, 17, 17, 17, 17, 14, 16, 12, 36, ...categories.map(() => 11)]);
  styleDataRows(production, productionHeaders.length);
  production.getColumn(8).numFmt = "dd/mm/yyyy";
  production.getColumn(15).numFmt = "[h]:mm:ss";
  production.getColumn(16).numFmt = "[h]:mm:ss";
  production.getColumn(20).numFmt = "0.0%";
  production.getColumn(21).numFmt = "0.0%";
  for (let column = 26; column <= productionHeaders.length; column += 1) production.getColumn(column).numFmt = "[h]:mm:ss";

  const detailHeaders = ["No. Reporte", "Fecha", "Máquina", "Operario", "O.P.", "Código parada", "Categoría", "Inicio", "Fin", "Duración", "Estado parada", "Observaciones"];
  const detail = workbook.addWorksheet("DETALLE PARADAS");
  detail.addRow(["DETALLE DE PARADAS DE PRODUCCIÓN"]);
  detail.addRow([`${input.filterLabel} · Generado: ${input.generatedLabel}`]);
  detail.addRow(detailHeaders);
  const reportById = new Map(input.reports.map((report) => [report.id, report]));
  const orderedStops = [...input.stops].sort((left, right) => left.started_at.localeCompare(right.started_at) || left.id.localeCompare(right.id));
  for (const stop of orderedStops) {
    const report = reportById.get(stop.report_id);
    if (!report) continue;
    const category = stop.stop_category ?? categoryById.get(stop.stop_category_id);
    detail.addRow([
      report.folio,
      excelDate(report.report_date),
      relationLabel(report.machine),
      report.creator_full_name,
      report.production_order || null,
      category?.code ?? null,
      category?.name ?? null,
      bogotaDateTime(stop.started_at),
      bogotaDateTime(stop.ended_at),
      stop.ended_at ? durationValue(stop.duration_seconds) : null,
      stop.ended_at ? "Cerrada" : "Activa",
      stop.description || null,
    ]);
  }
  styleSheet(detail, detailHeaders.length, [18, 13, 22, 24, 16, 15, 30, 20, 20, 16, 16, 36]);
  styleDataRows(detail, detailHeaders.length);
  detail.getColumn(2).numFmt = "dd/mm/yyyy";
  detail.getColumn(8).numFmt = "dd/mm/yyyy hh:mm";
  detail.getColumn(9).numFmt = "dd/mm/yyyy hh:mm";
  detail.getColumn(10).numFmt = "[h]:mm:ss";

  const catalog = workbook.addWorksheet("CATÁLOGO PARADAS");
  catalog.addRow(["Código", "Categoría"]);
  for (const category of categories) catalog.addRow([`P-${category.code}`, category.name]);
  catalog.getColumn(1).width = 14;
  catalog.getColumn(2).width = 42;
  catalog.getRow(1).height = 24;
  catalog.getRow(1).eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TITLE_FILL } };
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.alignment = { vertical: "middle" };
  });
  for (let rowIndex = 2; rowIndex <= catalog.rowCount; rowIndex += 1) {
    catalog.getRow(rowIndex).eachCell((cell) => {
      cell.alignment = { vertical: "middle", wrapText: true };
      cell.border = { bottom: { style: "hair", color: { argb: BORDER_COLOR } } };
    });
  }
  catalog.views = [{ state: "frozen", ySplit: 1, topLeftCell: "A2" }];
  catalog.autoFilter = "A1:B1";

  return workbook.xlsx.writeBuffer();
}
