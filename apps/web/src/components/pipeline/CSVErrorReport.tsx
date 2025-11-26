import React, { useMemo } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileWarning,
  Info,
  XCircle,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { RowValidationResult } from "@/pipeline/sources/UploadSource";

interface CSVErrorReportProps {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  errors: RowValidationResult[];
  onClose?: () => void;
}

/**
 * CSV Error Report Component
 *
 * Displays import results with detailed error reporting:
 * - Import summary statistics
 * - Error table with row details
 * - Downloadable error report (CSV format)
 * - Suggested fixes for common errors
 */
export function CSVErrorReport({
  totalRows,
  validRows,
  invalidRows,
  errors,
  onClose,
}: CSVErrorReportProps) {
  // Calculate statistics
  const stats = useMemo(() => {
    const successRate = totalRows > 0 ? (validRows / totalRows) * 100 : 0;
    const errorRate = totalRows > 0 ? (invalidRows / totalRows) * 100 : 0;

    // Count error types
    const errorTypes: Record<string, number> = {};
    errors.forEach((error) => {
      error.errors.forEach((errMsg) => {
        errorTypes[errMsg] = (errorTypes[errMsg] || 0) + 1;
      });
    });

    return {
      successRate,
      errorRate,
      errorTypes,
    };
  }, [totalRows, validRows, invalidRows, errors]);

  // Generate CSV error report for download
  const downloadErrorReport = () => {
    const headers = [
      "Row Number",
      "Company Name",
      "Errors",
      "Warnings",
      "Suggested Fix",
    ];

    const rows = errors.map((error, index) => {
      const companyName =
        error.rowData.company_name || error.rowData.businessName || "N/A";
      const errorMessages = error.errors.join("; ");
      const warningMessages = error.warnings?.join("; ") || "";
      const suggestedFix = getSuggestedFix(error.errors);

      return [
        String(index + 2), // +2 because row 1 is headers
        companyName,
        errorMessages,
        warningMessages,
        suggestedFix,
      ];
    });

    // Convert to CSV
    const csvContent =
      headers.join(",") +
      "\n" +
      rows
        .map((row) =>
          row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(","),
        )
        .join("\n");

    // Download
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `csv_import_errors_${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Get suggested fix for common errors
  const getSuggestedFix = (errors: string[]): string => {
    if (errors.some((e) => e.includes("Company name is required"))) {
      return "Add a value to the company_name column";
    }
    if (
      errors.some((e) => e.includes("Must provide either domain OR email"))
    ) {
      return "Add either a domain (e.g., example.com) or email address";
    }
    if (errors.some((e) => e.includes("Invalid email format"))) {
      return "Check email format (should be user@domain.com)";
    }
    if (errors.some((e) => e.includes("Invalid domain format"))) {
      return "Use domain without protocol (e.g., example.com not https://example.com)";
    }
    if (
      errors.some((e) => e.includes("Cannot process: missing required data"))
    ) {
      return "Provide both company_name and (domain OR email)";
    }
    return "Review row data and correct missing/invalid fields";
  };

  return (
    <Card className="glass-card border-orange-500/30">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <FileWarning className="h-5 w-5 text-orange-500" />
              Import Results
            </CardTitle>
            <CardDescription>
              {validRows > 0
                ? `Successfully imported ${validRows} of ${totalRows} leads`
                : `Import failed - ${invalidRows} invalid rows detected`}
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={downloadErrorReport}
              size="sm"
              variant="outline"
              className="gap-2"
            >
              <Download className="h-4 w-4" />
              Export Errors
            </Button>
            {onClose && (
              <Button onClick={onClose} size="sm" variant="ghost">
                Close
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Statistics Summary */}
        <div className="grid grid-cols-3 gap-4">
          <Alert className="border-green-500/50 bg-green-500/10">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            <AlertDescription>
              <div className="text-lg font-bold text-green-500">
                {validRows}
              </div>
              <div className="text-xs text-muted-foreground">
                Valid Rows ({stats.successRate.toFixed(1)}%)
              </div>
            </AlertDescription>
          </Alert>

          <Alert className="border-red-500/50 bg-red-500/10">
            <XCircle className="h-4 w-4 text-red-500" />
            <AlertDescription>
              <div className="text-lg font-bold text-red-500">
                {invalidRows}
              </div>
              <div className="text-xs text-muted-foreground">
                Invalid Rows ({stats.errorRate.toFixed(1)}%)
              </div>
            </AlertDescription>
          </Alert>

          <Alert className="border-blue-500/50 bg-blue-500/10">
            <Info className="h-4 w-4 text-blue-500" />
            <AlertDescription>
              <div className="text-lg font-bold text-blue-500">{totalRows}</div>
              <div className="text-xs text-muted-foreground">Total Rows</div>
            </AlertDescription>
          </Alert>
        </div>

        {/* Common Error Types */}
        {Object.keys(stats.errorTypes).length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-semibold flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-orange-500" />
              Common Errors
            </h4>
            <div className="flex flex-wrap gap-2">
              {Object.entries(stats.errorTypes).map(([error, count]) => (
                <Badge
                  key={error}
                  variant="outline"
                  className="text-xs border-orange-500/50"
                >
                  {error}: {count}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Error Details Table */}
        {errors.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-semibold">Error Details</h4>
            <ScrollArea className="h-[400px] rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[80px]">Row #</TableHead>
                    <TableHead className="w-[200px]">Company Name</TableHead>
                    <TableHead>Errors</TableHead>
                    <TableHead className="w-[200px]">Suggested Fix</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {errors.map((error, index) => {
                    const companyName =
                      error.rowData.company_name ||
                      error.rowData.businessName ||
                      "—";
                    const suggestedFix = getSuggestedFix(error.errors);

                    return (
                      <TableRow key={index}>
                        <TableCell className="font-mono text-sm">
                          {index + 2}
                        </TableCell>
                        <TableCell className="font-medium">
                          {companyName}
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            {error.errors.map((err, errIndex) => (
                              <div
                                key={errIndex}
                                className="flex items-start gap-2 text-sm"
                              >
                                <XCircle className="h-3 w-3 text-red-500 mt-0.5 flex-shrink-0" />
                                <span className="text-red-600">{err}</span>
                              </div>
                            ))}
                            {error.warnings && error.warnings.length > 0 && (
                              <>
                                {error.warnings.map((warn, warnIndex) => (
                                  <div
                                    key={warnIndex}
                                    className="flex items-start gap-2 text-sm"
                                  >
                                    <AlertTriangle className="h-3 w-3 text-orange-500 mt-0.5 flex-shrink-0" />
                                    <span className="text-orange-600">
                                      {warn}
                                    </span>
                                  </div>
                                ))}
                              </>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {suggestedFix}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </ScrollArea>
          </div>
        )}

        {/* Help Text */}
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription className="text-sm space-y-2">
            <strong className="block">How to fix these errors:</strong>
            <ol className="list-decimal list-inside space-y-1 ml-2 text-muted-foreground">
              <li>Download the error report using the "Export Errors" button</li>
              <li>Open your original CSV file and correct the invalid rows</li>
              <li>
                Ensure all rows have <strong>company_name</strong> and either{" "}
                <strong>domain</strong> OR <strong>email</strong>
              </li>
              <li>Re-upload the corrected CSV file</li>
            </ol>
          </AlertDescription>
        </Alert>

        {/* Quick Tips */}
        <div className="text-xs text-muted-foreground space-y-1 pt-2 border-t">
          <p>
            <strong>💡 Common Fixes:</strong>
          </p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>
              Missing company name → Check for empty cells in company_name column
            </li>
            <li>
              Missing domain/email → Add at least one (domain saves 1 credit if you
              have email!)
            </li>
            <li>
              Invalid email → Check format is user@domain.com (no spaces or typos)
            </li>
            <li>
              Invalid domain → Use domain only (example.com not www.example.com or
              https://example.com)
            </li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
