import React, { useCallback, useState } from "react";
import Papa from "papaparse";
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
import { CSVTemplateDownload } from "./CSVTemplateDownload";

interface FileUploadAreaProps {
  onFileSelect: (file: File | null) => void;
  onColumnMapping: (mapping: Record<string, string>) => void;
  selectedFile: File | null;
  columnMapping: Record<string, string>;
}

// Essential field mapping (simplified)
const LEAD_FIELDS = [
  // REQUIRED FIELDS
  { value: "company_name", label: "Company Name", required: true, category: "Required" },
  { value: "domain", label: "Domain (e.g., example.com)", required: true, category: "Required" },

  // OPTIONAL - Contact (providing email saves 1 credit)
  { value: "contact_name", label: "Contact Name", required: false, category: "Contact" },
  { value: "contact_email", label: "Contact Email (saves 1 credit)", required: false, category: "Contact" },
  { value: "email", label: "Email (alt)", required: false, category: "Contact" },
  { value: "phone", label: "Phone", required: false, category: "Contact" },

  // OPTIONAL - Business
  { value: "website", label: "Website URL", required: false, category: "Business" },
  { value: "industry", label: "Industry", required: false, category: "Business" },
  { value: "notes", label: "Notes", required: false, category: "Business" },

  // UTILITY
  { value: "ignore", label: "Ignore Column", required: false, category: "Utility" },
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

        // Parse with papaparse (RFC 4180 compliant)
        Papa.parse<Record<string, string>>(text, {
          header: true,
          skipEmptyLines: true,
          preview: 5, // Only parse first 5 rows for preview
          complete: (results) => {
            if (results.meta.fields && results.meta.fields.length > 0) {
              const headers = results.meta.fields;
              setCsvHeaders(headers);

              // Convert parsed data to preview format
              const preview: string[][] = [
                headers, // Header row
                ...results.data.map((row) =>
                  headers.map((header) => row[header] || ""),
                ),
              ];
              setPreviewData(preview);

              // Auto-map common column names with enhanced detection
              const autoMapping: Record<string, string> = {};
              headers.forEach((header) => {
                const lowerHeader = header.toLowerCase().trim();

                // REQUIRED: Company name
                if (
                  lowerHeader.includes("company") ||
                  lowerHeader.includes("business") ||
                  lowerHeader === "name"
                ) {
                  autoMapping[header] = "company_name";
                }
                // REQUIRED: Domain
                else if (
                  lowerHeader.includes("domain") ||
                  lowerHeader === "site"
                ) {
                  autoMapping[header] = "domain";
                }
                // Contact person name
                else if (
                  lowerHeader.includes("contact") &&
                  (lowerHeader.includes("name") || lowerHeader.includes("person"))
                ) {
                  autoMapping[header] = "contact_name";
                }
                // Email
                else if (
                  lowerHeader.includes("email") ||
                  lowerHeader.includes("e-mail")
                ) {
                  if (lowerHeader.includes("contact")) {
                    autoMapping[header] = "contact_email";
                  } else {
                    autoMapping[header] = "email";
                  }
                }
                // Phone
                else if (
                  lowerHeader.includes("phone") ||
                  lowerHeader.includes("tel") ||
                  lowerHeader.includes("mobile")
                ) {
                  autoMapping[header] = "phone";
                }
                // Website
                else if (
                  lowerHeader.includes("website") ||
                  lowerHeader.includes("url") ||
                  lowerHeader.includes("web")
                ) {
                  autoMapping[header] = "website";
                }
                // Industry
                else if (
                  lowerHeader.includes("industry") ||
                  lowerHeader.includes("sector") ||
                  lowerHeader.includes("category")
                ) {
                  autoMapping[header] = "industry";
                }
                // Notes (also catch description/about/comments)
                else if (
                  lowerHeader.includes("notes") ||
                  lowerHeader.includes("comment") ||
                  lowerHeader.includes("description") ||
                  lowerHeader.includes("about")
                ) {
                  autoMapping[header] = "notes";
                }
                // Default: ignore (includes location, social, job title fields)
                else {
                  autoMapping[header] = "ignore";
                }
              });

              onColumnMapping(autoMapping);
            }
          },
          error: (error) => {
            console.error("CSV parsing error:", error);
          },
        });
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
      {/* CSV Template & Instructions */}
      <CSVTemplateDownload />

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

                <div className="w-64">
                  <Select
                    value={columnMapping[header] || "ignore"}
                    onValueChange={(value) =>
                      updateColumnMapping(header, value)
                    }
                  >
                    <SelectTrigger className="transition-neo">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="max-h-[400px]">
                      {/* Group fields by category */}
                      {Array.from(new Set(LEAD_FIELDS.map((f) => f.category))).map(
                        (category) => (
                          <React.Fragment key={category}>
                            <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground border-b">
                              {category}
                            </div>
                            {LEAD_FIELDS.filter((f) => f.category === category).map(
                              (field) => (
                                <SelectItem key={field.value} value={field.value}>
                                  <div className="flex items-center gap-2">
                                    {field.required && (
                                      <Badge variant="destructive" className="text-xs px-1">
                                        REQ
                                      </Badge>
                                    )}
                                    <span className="text-sm">{field.label}</span>
                                  </div>
                                </SelectItem>
                              ),
                            )}
                          </React.Fragment>
                        ),
                      )}
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
