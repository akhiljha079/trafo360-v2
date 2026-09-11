import { BadRequestException, Controller, Get, Param, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { Auth } from "../common/auth.decorator";
import { CurrentUserId } from "../common/current-user.decorator";
import { toCsv, toExcelBuffer, toPdfBuffer } from "./report-export";
import { REPORT_TYPES, ReportsService, ReportType } from "./reports.service";

const FORMATS = ["json", "csv", "xlsx", "pdf"] as const;
type Format = (typeof FORMATS)[number];

@Controller("reports")
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get(":type")
  @Auth("report.view")
  async get(
    @Param("type") type: string,
    @Query("format") format: string | undefined,
    @CurrentUserId() userId: string,
    @Res() res: Response,
  ) {
    if (!REPORT_TYPES.includes(type as ReportType)) {
      throw new BadRequestException(`Unknown report type "${type}". Valid types: ${REPORT_TYPES.join(", ")}`);
    }
    const fmt = (format ?? "json") as Format;
    if (!FORMATS.includes(fmt)) {
      throw new BadRequestException(`Unknown format "${format}". Valid formats: ${FORMATS.join(", ")}`);
    }

    const report = await this.reports.getReport(type as ReportType, userId);

    if (fmt === "json") {
      res.json(report);
      return;
    }
    if (fmt === "csv") {
      res.set({
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${type}.csv"`,
      });
      res.send(toCsv(report));
      return;
    }
    if (fmt === "xlsx") {
      const buffer = await toExcelBuffer(report);
      res.set({
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${type}.xlsx"`,
        "Content-Length": buffer.length,
      });
      res.send(buffer);
      return;
    }
    const buffer = await toPdfBuffer(report);
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${type}.pdf"`,
      "Content-Length": buffer.length,
    });
    res.send(buffer);
  }
}
