import { useState, useRef } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function RateconUploadPage() {
  const [, setLocation] = useLocation();
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<string>("");
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setStatus("Uploading...");
    try {
      const fd = new FormData();
      fd.append("pdf", file);
      const res = await fetch("/api/ratecon-intake/upload", { method: "POST", body: fd });
      if (!res.ok) throw new Error(await res.text());
      const { intakeId } = await res.json();
      setStatus("Parsing with AI...");
      // Poll for status
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        const r = await fetch(`/api/ratecon-intake/${intakeId}`);
        const row = await r.json();
        if (row.status === "parsed" || row.status === "in_review" || row.status === "auto_dispatched") {
          setLocation(`/review-queue?highlight=${intakeId}`);
          return;
        }
      }
      setStatus("Parsing took longer than expected — check the review queue.");
    } catch (err: any) {
      setStatus(`Error: ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-6">
      <Card>
        <CardHeader>
          <CardTitle>Upload Rate Confirmation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            className="border-2 border-dashed rounded-lg p-10 text-center cursor-pointer hover:bg-muted"
            onClick={() => inputRef.current?.click()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files[0];
              if (f) setFile(f);
            }}
            onDragOver={(e) => e.preventDefault()}
            data-testid="upload-dropzone"
          >
            {file ? (
              <div>
                <p className="font-medium">{file.name}</p>
                <p className="text-sm text-muted-foreground">{(file.size / 1024).toFixed(0)} KB</p>
              </div>
            ) : (
              <p className="text-muted-foreground">Drag PDF here or click to select</p>
            )}
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <Button
            onClick={handleUpload}
            disabled={!file || uploading}
            className="w-full"
            data-testid="btn-upload-ratecon"
          >
            {uploading ? "Processing..." : "Upload & Parse"}
          </Button>
          {status && <p className="text-sm">{status}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
