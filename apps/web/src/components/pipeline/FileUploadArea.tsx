import React, { useCallback, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Upload,
  FileText,
  X,
  CheckCircle,
  AlertTriangle,
  Download,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface FileUploadAreaProps {
  onFileSelect: (file: File | null) => void;
  onColumnMapping: (mapping: Record<string, string>) => void;
  selectedFile: File | null;
  columnMapping: Record<string, string>;
}

const LEAD_FIELDS = [
  { value: "company_name", label: "Company Name", required: true },
  { value: "email", label: "Email Address", required: false },
  { value: "phone", label: "Phone Number", required: false },
  { value: "website", label: "Website URL", required: false },
  { value: "address", label: "Address", required: false },
  { value: "description", label: "Description", required: false },
  { value: "industry", label: "Industry", required: false },
  { value: "ignore", label: "Ignore Column", required: false },
];

export function FileUploadArea({
  onFileSelect,
  onColumnMapping,
  selectedFile,
  columnMapping,
}: FileUploadAreaProps) {
  const [dragActive, setDragActive] = useState(false);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [previewData, setPreviewData] = useState<string[][]>([]);

  const processFile = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        const lines = text.split("\n").filter((line) => line.trim());

        if (lines.length > 0) {
          const headers = lines[0]
            .split(",")
            .map((h) => h.trim().replace(/"/g, ""));
          setCsvHeaders(headers);

          // Show preview of first few rows
          const preview = lines
            .slice(0, 4)
            .map((line) =>
              line.split(",").map((cell) => cell.trim().replace(/"/g, "")),
            );
          setPreviewData(preview);

          // Auto-map common column names
          const autoMapping: Record<string, string> = {};
          headers.forEach((header) => {
            const lowerHeader = header.toLowerCase();
            if (
              lowerHeader.includes("company") ||
              lowerHeader.includes("business")
            ) {
              autoMapping[header] = "company_name";
            } else if (lowerHeader.includes("email")) {
              autoMapping[header] = "email";
            } else if (lowerHeader.includes("phone")) {
              autoMapping[header] = "phone";
            } else if (
              lowerHeader.includes("website") ||
              lowerHeader.includes("url")
            ) {
              autoMapping[header] = "website";
            } else if (lowerHeader.includes("address")) {
              autoMapping[header] = "address";
            } else if (
              lowerHeader.includes("industry") ||
              lowerHeader.includes("sector")
            ) {
              autoMapping[header] = "industry";
            } else {
              autoMapping[header] = "ignore";
            }
          });

          onColumnMapping(autoMapping);
        }
      };
      reader.readAsText(file);
    },
    [onColumnMapping],
  );

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);

      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        const file = e.dataTransfer.files[0];
        onFileSelect(file);
        processFile(file);
      }
    },
    [onFileSelect, processFile],
  );

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      onFileSelect(file);
      processFile(file);
    }
  };

  const updateColumnMapping = (csvColumn: string, leadField: string) => {
    const newMapping = { ...columnMapping };
    newMapping[csvColumn] = leadField;
    onColumnMapping(newMapping);
  };

  return (
    <div className="space-y-6">
      {/* File Upload Area */}
      {!selectedFile ? (
        <Card
          className={cn(
            "glass-card border-2 border-dashed transition-all duration-300 hover-lift cursor-pointer",
            dragActive && "border-primary bg-primary/5 glow-soft",
          )}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
        >
          <CardContent className="p-12 text-center space-y-4">
            <div
              className={cn(
                "mx-auto w-16 h-16 rounded-full flex items-center justify-center transition-all duration-300",
                dragActive
                  ? "bg-primary/20 glow-neon-lime upload-bounce"
                  : "bg-muted/20",
              )}
            >
              <Upload
                className={cn(
                  "h-8 w-8 transition-colors",
                  dragActive ? "text-primary" : "text-muted-foreground",
                )}
              />
            </div>

            <div className="space-y-2">
              <h3 className="text-lg font-semibold">Drop your CSV file here</h3>
              <p className="text-muted-foreground">
                Or click to browse and select a file
              </p>
            </div>

            <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground">
              <span>Max 10MB</span>
              <span>•</span>
              <span>CSV format only</span>
            </div>

            <input
              type="file"
              accept=".csv,text/csv"
              onChange={handleFileInput}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
          </CardContent>
        </Card>
      ) : (
        /* File Selected */
        <Card className="glass-card">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-green-500/20">
                  <FileText className="h-5 w-5 text-green-500" />
                </div>
                <div>
                  <CardTitle className="text-lg">{selectedFile.name}</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    {(selectedFile.size / 1024).toFixed(1)}KB •{" "}
                    {csvHeaders.length} columns
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  onFileSelect(null);
                  setCsvHeaders([]);
                  setPreviewData([]);
                  onColumnMapping({});
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
        </Card>
      )}

      {/* Column Mapping */}
      {csvHeaders.length > 0 && (
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-lg">Map Your Columns</CardTitle>
            <p className="text-sm text-muted-foreground">
              Tell us which columns contain which type of information
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {csvHeaders.map((header, index) => (
              <div
                key={header}
                className="flex items-center gap-4 p-3 rounded-lg bg-muted/10"
              >
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">{header}</div>
                  {previewData[1] && previewData[1][index] && (
                    <div className="text-xs text-muted-foreground truncate">
                      Example: {previewData[1][index]}
                    </div>
                  )}
                </div>

                <div className="w-48">
                  <Select
                    value={columnMapping[header] || "ignore"}
                    onValueChange={(value) =>
                      updateColumnMapping(header, value)
                    }
                  >
                    <SelectTrigger className="transition-neo">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LEAD_FIELDS.map((field) => (
                        <SelectItem key={field.value} value={field.value}>
                          <div className="flex items-center gap-2">
                            {field.required && (
                              <Badge variant="destructive" className="text-xs">
                                Required
                              </Badge>
                            )}
                            {field.label}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Preview */}
      {previewData.length > 0 && (
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-lg">Data Preview</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    {csvHeaders.map((header) => (
                      <th key={header} className="text-left p-2 font-medium">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewData.slice(1, 4).map((row, rowIndex) => (
                    <tr key={rowIndex} className="border-b border-border/50">
                      {row.map((cell, cellIndex) => (
                        <td
                          key={cellIndex}
                          className="p-2 text-muted-foreground"
                        >
                          {cell || "-"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
