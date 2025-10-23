import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Square,
  ArrowRight,
  Pencil,
  Type,
  Trash2,
  Save,
} from "lucide-react";

interface Annotation {
  id?: string;
  type: "rectangle" | "arrow" | "freehand" | "text";
  color: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  endX?: number;
  endY?: number;
  pathData?: { x: number; y: number }[];
  text?: string;
  fontSize?: number;
  note?: string;
}

interface DocumentAnnotationsProps {
  documentId: string;
  documentUrl: string;
}

export function DocumentAnnotations({
  documentId,
  documentUrl,
}: DocumentAnnotationsProps) {
  const { toast } = useToast();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [selectedTool, setSelectedTool] = useState<"rectangle" | "arrow" | "freehand" | "text" | null>(null);
  const [selectedColor, setSelectedColor] = useState("#ff0000");
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentAnnotation, setCurrentAnnotation] = useState<Annotation | null>(null);
  const [textInput, setTextInput] = useState("");
  const [noteInput, setNoteInput] = useState("");
  const [imageLoaded, setImageLoaded] = useState(false);

  const colors = [
    { name: "Red (Issues)", value: "#ff0000" },
    { name: "Yellow (Warnings)", value: "#ffff00" },
    { name: "Green (Approved)", value: "#00ff00" },
    { name: "Blue (Notes)", value: "#0000ff" },
  ];

  // Load existing annotations
  const { data: savedAnnotations } = useQuery({
    queryKey: ["/api/documents", documentId, "annotations"],
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (savedAnnotations && Array.isArray(savedAnnotations)) {
      setAnnotations(savedAnnotations);
    }
  }, [savedAnnotations]);

  // Save annotations mutation
  const saveAnnotationsMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest(`/api/documents/${documentId}/annotations`, {
        method: "POST",
        body: JSON.stringify({ annotations }),
      });
    },
    onSuccess: () => {
      toast({
        title: "Annotations Saved",
        description: "Your annotations have been saved successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/documents", documentId, "annotations"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Save Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    if (imageLoaded && canvasRef.current && imageRef.current) {
      const canvas = canvasRef.current;
      const image = imageRef.current;
      canvas.width = image.width;
      canvas.height = image.height;
      redrawCanvas();
    }
  }, [imageLoaded, annotations]);

  const redrawCanvas = () => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    annotations.forEach((annotation) => {
      ctx.strokeStyle = annotation.color;
      ctx.fillStyle = annotation.color;
      ctx.lineWidth = 2;

      const x = annotation.x * canvas.width;
      const y = annotation.y * canvas.height;

      switch (annotation.type) {
        case "rectangle":
          if (annotation.width && annotation.height) {
            const width = annotation.width * canvas.width;
            const height = annotation.height * canvas.height;
            ctx.strokeRect(x, y, width, height);
          }
          break;
        case "arrow":
          if (annotation.endX !== undefined && annotation.endY !== undefined) {
            const endX = annotation.endX * canvas.width;
            const endY = annotation.endY * canvas.height;
            drawArrow(ctx, x, y, endX, endY);
          }
          break;
        case "freehand":
          if (annotation.pathData && annotation.pathData.length > 0) {
            ctx.beginPath();
            const firstPoint = annotation.pathData[0];
            ctx.moveTo(firstPoint.x * canvas.width, firstPoint.y * canvas.height);
            annotation.pathData.forEach((point) => {
              ctx.lineTo(point.x * canvas.width, point.y * canvas.height);
            });
            ctx.stroke();
          }
          break;
        case "text":
          if (annotation.text) {
            ctx.font = `${annotation.fontSize || 14}px Arial`;
            ctx.fillText(annotation.text, x, y);
          }
          break;
      }
    });
  };

  const drawArrow = (
    ctx: CanvasRenderingContext2D,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number
  ) => {
    const headLength = 15;
    const angle = Math.atan2(toY - fromY, toX - fromX);

    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.lineTo(
      toX - headLength * Math.cos(angle - Math.PI / 6),
      toY - headLength * Math.sin(angle - Math.PI / 6)
    );
    ctx.moveTo(toX, toY);
    ctx.lineTo(
      toX - headLength * Math.cos(angle + Math.PI / 6),
      toY - headLength * Math.sin(angle + Math.PI / 6)
    );
    ctx.stroke();
  };

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!selectedTool || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / canvas.width;
    const y = (e.clientY - rect.top) / canvas.height;

    setIsDrawing(true);
    setCurrentAnnotation({
      type: selectedTool,
      color: selectedColor,
      x,
      y,
      pathData: selectedTool === "freehand" ? [{ x, y }] : undefined,
    });
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !currentAnnotation || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / canvas.width;
    const y = (e.clientY - rect.top) / canvas.height;

    if (currentAnnotation.type === "freehand") {
      setCurrentAnnotation({
        ...currentAnnotation,
        pathData: [...(currentAnnotation.pathData || []), { x, y }],
      });
    } else if (currentAnnotation.type === "rectangle") {
      setCurrentAnnotation({
        ...currentAnnotation,
        width: x - currentAnnotation.x,
        height: y - currentAnnotation.y,
      });
    } else if (currentAnnotation.type === "arrow") {
      setCurrentAnnotation({
        ...currentAnnotation,
        endX: x,
        endY: y,
      });
    }

    redrawCanvas();

    const ctx = canvas.getContext("2d");
    if (ctx && currentAnnotation) {
      ctx.strokeStyle = currentAnnotation.color;
      ctx.fillStyle = currentAnnotation.color;
      ctx.lineWidth = 2;

      const startX = currentAnnotation.x * canvas.width;
      const startY = currentAnnotation.y * canvas.height;

      if (currentAnnotation.type === "rectangle" && currentAnnotation.width && currentAnnotation.height) {
        ctx.strokeRect(
          startX,
          startY,
          currentAnnotation.width * canvas.width,
          currentAnnotation.height * canvas.height
        );
      } else if (currentAnnotation.type === "arrow" && currentAnnotation.endX !== undefined && currentAnnotation.endY !== undefined) {
        drawArrow(
          ctx,
          startX,
          startY,
          currentAnnotation.endX * canvas.width,
          currentAnnotation.endY * canvas.height
        );
      } else if (currentAnnotation.type === "freehand" && currentAnnotation.pathData) {
        ctx.beginPath();
        const firstPoint = currentAnnotation.pathData[0];
        ctx.moveTo(firstPoint.x * canvas.width, firstPoint.y * canvas.height);
        currentAnnotation.pathData.forEach((point) => {
          ctx.lineTo(point.x * canvas.width, point.y * canvas.height);
        });
        ctx.stroke();
      }
    }
  };

  const handleCanvasMouseUp = () => {
    if (!currentAnnotation) return;

    if (currentAnnotation.type === "text") {
      const text = prompt("Enter text:");
      if (text) {
        setAnnotations([...annotations, { ...currentAnnotation, text, fontSize: 14 }]);
      }
    } else {
      setAnnotations([...annotations, currentAnnotation]);
    }

    setIsDrawing(false);
    setCurrentAnnotation(null);
  };

  const handleImageLoad = () => {
    setImageLoaded(true);
  };

  const handleDeleteAnnotation = (index: number) => {
    setAnnotations(annotations.filter((_, i) => i !== index));
  };

  const handleSaveAnnotations = () => {
    saveAnnotationsMutation.mutate();
  };

  return (
    <div className="flex h-full">
      {/* Canvas Area */}
      <div className="flex-1 flex flex-col bg-gray-100">
        <div className="flex-1 overflow-auto p-6 flex items-center justify-center">
          <div className="relative" data-testid="annotation-canvas-container">
            <img
              ref={imageRef}
              src={documentUrl}
              alt="Document"
              className="max-w-full max-h-full"
              onLoad={handleImageLoad}
              style={{ visibility: imageLoaded ? "visible" : "hidden" }}
            />
            {imageLoaded && (
              <canvas
                ref={canvasRef}
                onMouseDown={handleCanvasMouseDown}
                onMouseMove={handleCanvasMouseMove}
                onMouseUp={handleCanvasMouseUp}
                onMouseLeave={handleCanvasMouseUp}
                className="absolute top-0 left-0 cursor-crosshair"
                style={{ width: imageRef.current?.width, height: imageRef.current?.height }}
                data-testid="annotation-canvas"
              />
            )}
          </div>
        </div>

        {/* Toolbar */}
        <div className="border-t bg-white p-4">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <Label>Tools:</Label>
              <Button
                onClick={() => setSelectedTool("rectangle")}
                variant={selectedTool === "rectangle" ? "default" : "outline"}
                size="sm"
                data-testid="button-tool-rectangle"
              >
                <Square className="h-4 w-4 mr-1" />
                Rectangle
              </Button>
              <Button
                onClick={() => setSelectedTool("arrow")}
                variant={selectedTool === "arrow" ? "default" : "outline"}
                size="sm"
                data-testid="button-tool-arrow"
              >
                <ArrowRight className="h-4 w-4 mr-1" />
                Arrow
              </Button>
              <Button
                onClick={() => setSelectedTool("freehand")}
                variant={selectedTool === "freehand" ? "default" : "outline"}
                size="sm"
                data-testid="button-tool-freehand"
              >
                <Pencil className="h-4 w-4 mr-1" />
                Freehand
              </Button>
              <Button
                onClick={() => setSelectedTool("text")}
                variant={selectedTool === "text" ? "default" : "outline"}
                size="sm"
                data-testid="button-tool-text"
              >
                <Type className="h-4 w-4 mr-1" />
                Text
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <Label>Color:</Label>
              {colors.map((color) => (
                <button
                  key={color.value}
                  onClick={() => setSelectedColor(color.value)}
                  className={`w-8 h-8 rounded border-2 ${
                    selectedColor === color.value ? "border-black scale-110" : "border-gray-300"
                  }`}
                  style={{ backgroundColor: color.value }}
                  title={color.name}
                  data-testid={`button-color-${color.value}`}
                />
              ))}
            </div>

            <Button
              onClick={handleSaveAnnotations}
              disabled={saveAnnotationsMutation.isPending || annotations.length === 0}
              variant="default"
              className="ml-auto"
              data-testid="button-save-annotations"
            >
              <Save className="h-4 w-4 mr-1" />
              {saveAnnotationsMutation.isPending ? "Saving..." : "Save Annotations"}
            </Button>
          </div>
        </div>
      </div>

      {/* Annotations List Panel */}
      <div className="w-80 border-l bg-white flex flex-col">
        <div className="p-4 border-b">
          <h3 className="font-semibold" data-testid="text-annotations-title">
            Annotations ({annotations.length})
          </h3>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-4 space-y-2">
            {annotations.length === 0 ? (
              <div className="text-center text-gray-500 text-sm py-8" data-testid="text-no-annotations">
                No annotations yet. Select a tool and draw on the document.
              </div>
            ) : (
              annotations.map((annotation, index) => (
                <div
                  key={index}
                  className="p-3 border rounded-lg flex items-start gap-2"
                  data-testid={`annotation-item-${index}`}
                >
                  <div
                    className="w-4 h-4 rounded flex-shrink-0 mt-1"
                    style={{ backgroundColor: annotation.color }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm capitalize">{annotation.type}</div>
                    {annotation.text && (
                      <div className="text-sm text-gray-600 truncate">{annotation.text}</div>
                    )}
                    {annotation.note && (
                      <div className="text-xs text-gray-500 mt-1">{annotation.note}</div>
                    )}
                  </div>
                  <Button
                    onClick={() => handleDeleteAnnotation(index)}
                    variant="ghost"
                    size="sm"
                    className="flex-shrink-0"
                    data-testid={`button-delete-annotation-${index}`}
                  >
                    <Trash2 className="h-4 w-4 text-red-600" />
                  </Button>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
