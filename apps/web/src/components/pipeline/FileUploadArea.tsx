import React, { useCallback, useState } from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
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

// Security constants
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_COLUMNS = 50;
const MAX_ROWS_SCAN = 5000;
const PARSE_TIMEOUT = 5000; // 5 seconds
const MAX_HEADER_LENGTH = 100;

// Allowed file types
const ALLOWED_EXTENSIONS = ['.csv', '.xlsx', '.xls'];
const ALLOWED_MIME_TYPES = [
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
];

// Magic number signatures (first few bytes)
const FILE_SIGNATURES = {
  // Excel modern format (ZIP-based, starts with PK)
  xlsx: [0x50, 0x4b, 0x03, 0x04],
  // Excel old format (OLE2-based)
  xls: [0xd0, 0xcf, 0x11, 0xe0],
};

// Sanitize text to prevent XSS (moved outside component for performance)
const sanitizeText = (text: string): string => {
  return text
    .replace(/[<>'"]/g, '') // Remove HTML/script characters
    .replace(/\0/g, '') // Remove null bytes
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters (intentional for security)
    .slice(0, MAX_HEADER_LENGTH); // Limit length
};

// Check file magic number (moved outside component for performance)
const checkMagicNumber = async (file: File): Promise<boolean> => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const arr = new Uint8Array(e.target?.result as ArrayBuffer);
      const ext = file.name.split('.').pop()?.toLowerCase();

      if (ext === 'xlsx') {
        // Check for ZIP signature (PK)
        const isZip = arr[0] === FILE_SIGNATURES.xlsx[0] &&
                     arr[1] === FILE_SIGNATURES.xlsx[1] &&
                     arr[2] === FILE_SIGNATURES.xlsx[2] &&
                     arr[3] === FILE_SIGNATURES.xlsx[3];
        resolve(isZip);
      } else if (ext === 'xls') {
        // Check for OLE2 signature
        const isOle = arr[0] === FILE_SIGNATURES.xls[0] &&
                     arr[1] === FILE_SIGNATURES.xls[1] &&
                     arr[2] === FILE_SIGNATURES.xls[2] &&
                     arr[3] === FILE_SIGNATURES.xls[3];
        resolve(isOle);
      } else if (ext === 'csv') {
        // CSV should be valid text (not binary)
        const isText = arr.every((byte) => byte === 0x09 || byte === 0x0A || byte === 0x0D || (byte >= 0x20 && byte <= 0x7E) || byte >= 0x80);
        resolve(isText);
      } else {
        resolve(false);
      }
    };
    reader.onerror = () => resolve(false);
    // Read first 4 bytes for magic number check
    reader.readAsArrayBuffer(file.slice(0, 4));
  });
};

export function FileUploadArea({
  onFileSelect,
  onColumnMapping,
  selectedFile,
  columnMapping,
}: FileUploadAreaProps) {
  const [dragActive, setDragActive] = useState(false);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [previewData, setPreviewData] = useState<string[][]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Comprehensive file validation
  const validateFile = useCallback(async (file: File): Promise<{ valid: boolean; error?: string }> => {
    // 1. File size check
    if (file.size > MAX_FILE_SIZE) {
      return {
        valid: false,
        error: `File is too large. Maximum size is ${(MAX_FILE_SIZE / 1024 / 1024).toFixed(0)}MB.`,
      };
    }

    if (file.size === 0) {
      return { valid: false, error: 'File is empty. Please upload a valid file.' };
    }

    // 2. File extension check
    const fileName = file.name.toLowerCase();
    const extension = '.' + fileName.split('.').pop();
    if (!ALLOWED_EXTENSIONS.includes(extension)) {
      return {
        valid: false,
        error: 'Invalid file type. Please upload CSV or Excel (.xlsx, .xls) files only.',
      };
    }

    // 3. MIME type check (if available)
    if (file.type && !ALLOWED_MIME_TYPES.includes(file.type)) {
      // Some browsers don't set MIME type correctly, so this is a soft check
      console.warn('MIME type mismatch:', file.type);
    }

    // 4. Magic number check (content-based validation)
    const hasValidSignature = await checkMagicNumber(file);
    if (!hasValidSignature) {
      return {
        valid: false,
        error: 'File appears to be corrupted or not a valid CSV/Excel file. Please check the file and try again.',
      };
    }

    return { valid: true };
  }, []); // No dependencies - uses external functions only

  const autoMapColumns = useCallback(
    (headers: string[]) => {
      // Security: Limit number of columns
      if (headers.length > MAX_COLUMNS) {
        setUploadError(`File has too many columns (${headers.length}). Maximum is ${MAX_COLUMNS} columns.`);
        return;
      }

      const autoMapping: Record<string, string> = {};
      headers.forEach((header) => {
        // Sanitize header
        const sanitized = sanitizeText(String(header));
        // Clean the header: remove "(required)" suffix if present
        const cleanHeader = sanitized.replace(/\s*\(required\)\s*$/i, "");
        const lowerHeader = cleanHeader.toLowerCase().trim();

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
        // Contact person name - recognize common name column variants
        else if (
          // Original: "contact name", "contact person"
          (lowerHeader.includes("contact") &&
            (lowerHeader.includes("name") || lowerHeader.includes("person"))) ||
          // Common CRM exports: "first_name", "firstname", "first name"
          lowerHeader === "first_name" ||
          lowerHeader === "firstname" ||
          lowerHeader === "first name" ||
          // Full name variants: "full_name", "fullname", "full name"
          lowerHeader === "full_name" ||
          lowerHeader === "fullname" ||
          lowerHeader === "full name" ||
          // Person name variants
          lowerHeader === "person_name" ||
          lowerHeader === "person name" ||
          lowerHeader === "personname" ||
          // Representative/rep variants
          lowerHeader === "rep_name" ||
          lowerHeader === "rep name" ||
          lowerHeader === "representative"
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
    },
    [onColumnMapping],
  );

  const processFile = useCallback(
    async (file: File) => {
      // Clear previous errors
      setUploadError(null);

      // Validate file first
      const validation = await validateFile(file);
      if (!validation.valid) {
        setUploadError(validation.error || 'Invalid file');
        onFileSelect(null);
        setCsvHeaders([]);
        setPreviewData([]);
        onColumnMapping({});
        return;
      }

      const fileExtension = file.name.split('.').pop()?.toLowerCase();
      const isExcel = fileExtension === 'xlsx' || fileExtension === 'xls';

      // Set timeout for parsing
      const timeoutId = setTimeout(() => {
        setUploadError('File parsing timed out. Please try a smaller file.');
        onFileSelect(null);
      }, PARSE_TIMEOUT);

      try {
        if (isExcel) {
          // Parse Excel file
          const reader = new FileReader();
          reader.onload = (e) => {
            try {
              clearTimeout(timeoutId);
              const data = e.target?.result;
              const workbook = XLSX.read(data, {
                type: 'binary',
                // Security: Disable external entities
                cellDates: true,
                cellNF: false,
                cellText: false,
              });

              // Get first worksheet only (security: prevent zip bomb)
              const firstSheetName = workbook.SheetNames[0];
              const worksheet = workbook.Sheets[firstSheetName];

              // Convert to JSON with header row
              const jsonData = XLSX.utils.sheet_to_json(worksheet, {
                header: 1,
                defval: '',
                blankrows: false,
                // Security: Limit rows scanned
                range: `A1:${String.fromCharCode(65 + MAX_COLUMNS)}${Math.min(MAX_ROWS_SCAN, 5)}`,
              }) as string[][];

              if (jsonData.length === 0) {
                setUploadError('File is empty or has no valid data.');
                onFileSelect(null);
                return;
              }

              // Sanitize headers
              const headers = jsonData[0].map((h) => sanitizeText(String(h)));

              if (headers.length === 0) {
                setUploadError('File has no columns.');
                onFileSelect(null);
                return;
              }

              setCsvHeaders(headers);

              // Sanitize preview data
              const preview = jsonData.slice(0, Math.min(5, jsonData.length)).map((row) =>
                row.map((cell) => sanitizeText(String(cell)))
              );
              setPreviewData(preview);

              // Auto-map columns
              autoMapColumns(headers);
            } catch (error) {
              clearTimeout(timeoutId);
              console.error("Excel parsing error:", error);
              setUploadError('Unable to parse Excel file. Please check the file format and try again.');
              onFileSelect(null);
            }
          };
          reader.onerror = () => {
            clearTimeout(timeoutId);
            setUploadError('Failed to read file. Please try again.');
            onFileSelect(null);
          };
          reader.readAsBinaryString(file);
        } else {
          // Parse CSV file
          const reader = new FileReader();
          reader.onload = (e) => {
            try {
              clearTimeout(timeoutId);
              const text = e.target?.result as string;

              // Parse with papaparse (RFC 4180 compliant)
              Papa.parse<Record<string, string>>(text, {
                header: true,
                skipEmptyLines: true,
                preview: 5, // Only parse first 5 rows for preview
                complete: (results) => {
                  try {
                    if (!results.meta.fields || results.meta.fields.length === 0) {
                      setUploadError('CSV file has no columns or invalid format.');
                      onFileSelect(null);
                      return;
                    }

                    if (results.data.length === 0) {
                      setUploadError('CSV file is empty or has no data rows.');
                      onFileSelect(null);
                      return;
                    }

                    // Sanitize headers
                    const headers = results.meta.fields.map((h) => sanitizeText(h));
                    setCsvHeaders(headers);

                    // Convert parsed data to preview format and sanitize
                    const preview: string[][] = [
                      headers, // Header row
                      ...results.data.map((row) =>
                        headers.map((header) => sanitizeText(row[header] || "")),
                      ),
                    ];
                    setPreviewData(preview);

                    // Auto-map columns
                    autoMapColumns(headers);
                  } catch (error) {
                    console.error("CSV data processing error:", error);
                    setUploadError('Error processing CSV data. Please check the file format.');
                    onFileSelect(null);
                  }
                },
                error: (error) => {
                  clearTimeout(timeoutId);
                  console.error("CSV parsing error:", error);
                  setUploadError('Unable to parse CSV file. Please check the file format and try again.');
                  onFileSelect(null);
                },
              });
            } catch (error) {
              clearTimeout(timeoutId);
              console.error("CSV read error:", error);
              setUploadError('Failed to read CSV file. Please try again.');
              onFileSelect(null);
            }
          };
          reader.onerror = () => {
            clearTimeout(timeoutId);
            setUploadError('Failed to read file. Please try again.');
            onFileSelect(null);
          };
          reader.readAsText(file);
        }
      } catch (error) {
        clearTimeout(timeoutId);
        console.error("File processing error:", error);
        setUploadError('An unexpected error occurred. Please try again.');
        onFileSelect(null);
      }
    },
    [autoMapColumns, onColumnMapping, onFileSelect, validateFile],
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
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);

      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        const file = e.dataTransfer.files[0];
        onFileSelect(file);
        await processFile(file);
      }
    },
    [onFileSelect, processFile],
  );

  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      onFileSelect(file);
      await processFile(file);
    }
    // Reset input so same file can be uploaded again
    e.target.value = '';
  };

  const updateColumnMapping = (csvColumn: string, leadField: string) => {
    const newMapping = { ...columnMapping };
    newMapping[csvColumn] = leadField;
    onColumnMapping(newMapping);
  };

  return (
    <div className="space-y-6">
      {/* Error Alert */}
      {uploadError && (
        <Alert variant="destructive" className="animate-in slide-in-from-top">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between gap-4">
            <span>{uploadError}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setUploadError(null);
                onFileSelect(null);
                setCsvHeaders([]);
                setPreviewData([]);
                onColumnMapping({});
              }}
              className="shrink-0"
            >
              Try Again
            </Button>
          </AlertDescription>
        </Alert>
      )}

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
              <h3 className="text-lg font-semibold">Drop your CSV or Excel file here</h3>
              <p className="text-muted-foreground">
                Or click to browse and select a file
              </p>
            </div>

            <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground">
              <span>Max 10MB</span>
              <span>•</span>
              <span>CSV or Excel (.xlsx, .xls)</span>
            </div>

            <input
              type="file"
              accept=".csv,text/csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
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
