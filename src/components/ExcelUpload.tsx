import { useRef, useState } from "react";
import { parseWorkbook } from "../lib/parser";
import type { ParsedTripRow } from "../types";

interface Props {
  onParsed: (rows: ParsedTripRow[], warnings: string[]) => void;
}

export default function ExcelUpload({ onParsed }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string>("");
  const [error, setError] = useState<string>("");

  async function handleFile(file: File) {
    setError("");
    try {
      const buffer = await file.arrayBuffer();
      const { rows, warnings } = parseWorkbook(buffer);
      if (rows.length === 0) {
        setError("No trip rows were found in that file.");
        return;
      }
      setFileName(file.name);
      onParsed(rows, warnings);
    } catch {
      setError("Couldn't read that file. Make sure it's a valid .xlsx or .xls export.");
    }
  }

  return (
    <div className="upload-dropzone">
      <p>Upload today's trip sheet (.xlsx or .xls)</p>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />
      {fileName && <p className="lane-meta">Loaded: {fileName}</p>}
      {error && <p className="warning-box">{error}</p>}
    </div>
  );
}
