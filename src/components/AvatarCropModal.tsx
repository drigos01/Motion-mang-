import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Move, RotateCcw, X, ZoomIn, ZoomOut } from 'lucide-react';

interface AvatarCropModalProps {
  file: File;
  onCancel: () => void;
  onConfirm: (croppedFile: File) => void;
  onUnsupportedPreview: (file: File) => void;
}

const VIEWPORT_SIZE = 288;
const CROP_DIAMETER = VIEWPORT_SIZE * 0.94; // Matches SVG circle r="47" (diameter 94%)
const MIN_ZOOM = 1;
const MAX_ZOOM = 3;

export function AvatarCropModal({
  file,
  onCancel,
  onConfirm,
  onUnsupportedPreview,
}: AvatarCropModalProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [exporting, setExporting] = useState(false);

  const imgRef = useRef<HTMLImageElement | null>(null);
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const dragStartRef = useRef<{
    clientX: number;
    clientY: number;
    startX: number;
    startY: number;
  } | null>(null);
  const pinchStartRef = useRef<{
    distance: number;
    startZoom: number;
  } | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setImageUrl(url);
    setNaturalSize(null);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [file]);

  const coverScale = useMemo(() => {
    if (!naturalSize) return 1;
    return Math.max(CROP_DIAMETER / naturalSize.width, CROP_DIAMETER / naturalSize.height);
  }, [naturalSize]);

  const clampOffset = useCallback(
    (x: number, y: number, targetZoom: number) => {
      if (!naturalSize) return { x: 0, y: 0 };
      const totalScale = coverScale * targetZoom;
      const renderedW = naturalSize.width * totalScale;
      const renderedH = naturalSize.height * totalScale;
      const maxX = Math.max(0, (renderedW - CROP_DIAMETER) / 2);
      const maxY = Math.max(0, (renderedH - CROP_DIAMETER) / 2);
      return {
        x: Math.min(maxX, Math.max(-maxX, x)),
        y: Math.min(maxY, Math.max(-maxY, y)),
      };
    },
    [naturalSize, coverScale]
  );

  const handleZoomChange = (nextZoomRaw: number) => {
    const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoomRaw));
    setZoom(nextZoom);
    setOffset((prev) => clampOffset(prev.x, prev.y, nextZoom));
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!naturalSize || exporting) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointersRef.current.size === 1) {
      setDragging(true);
      pinchStartRef.current = null;
      dragStartRef.current = {
        clientX: e.clientX,
        clientY: e.clientY,
        startX: offset.x,
        startY: offset.y,
      };
    } else if (pointersRef.current.size === 2) {
      setDragging(false);
      dragStartRef.current = null;
      const pts = Array.from(pointersRef.current.values()) as Array<{ x: number; y: number }>;
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      pinchStartRef.current = {
        distance: Math.max(1, dist),
        startZoom: zoom,
      };
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(e.pointerId)) return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointersRef.current.size === 2 && pinchStartRef.current) {
      const pts = Array.from(pointersRef.current.values()) as Array<{ x: number; y: number }>;
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      const ratio = dist / pinchStartRef.current.distance;
      handleZoomChange(pinchStartRef.current.startZoom * ratio);
      return;
    }

    if (pointersRef.current.size === 1 && dragStartRef.current) {
      const dx = e.clientX - dragStartRef.current.clientX;
      const dy = e.clientY - dragStartRef.current.clientY;
      setOffset(
        clampOffset(dragStartRef.current.startX + dx, dragStartRef.current.startY + dy, zoom)
      );
    }
  };

  const handlePointerUpOrCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) {
      pinchStartRef.current = null;
    }
    if (pointersRef.current.size === 1) {
      const remaining = Array.from(pointersRef.current.values())[0] as { x: number; y: number };
      dragStartRef.current = {
        clientX: remaining.x,
        clientY: remaining.y,
        startX: offset.x,
        startY: offset.y,
      };
      setDragging(true);
    } else {
      dragStartRef.current = null;
      setDragging(false);
    }
  };

  const handleConfirmCrop = async () => {
    if (!imgRef.current || !naturalSize || exporting) return;
    setExporting(true);
    try {
      const totalScale = coverScale * zoom;
      const sourceSize = CROP_DIAMETER / totalScale;
      const rawSx = naturalSize.width / 2 + (-CROP_DIAMETER / 2 - offset.x) / totalScale;
      const rawSy = naturalSize.height / 2 + (-CROP_DIAMETER / 2 - offset.y) / totalScale;

      const safeSourceSize = Math.min(sourceSize, naturalSize.width, naturalSize.height);
      const sx = Math.min(Math.max(0, rawSx), Math.max(0, naturalSize.width - safeSourceSize));
      const sy = Math.min(Math.max(0, rawSy), Math.max(0, naturalSize.height - safeSourceSize));

      const outSize = Math.min(720, Math.max(512, Math.round(safeSourceSize)));
      const canvas = document.createElement('canvas');
      canvas.width = outSize;
      canvas.height = outSize;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        onConfirm(file);
        return;
      }

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(
        imgRef.current,
        sx,
        sy,
        safeSourceSize,
        safeSourceSize,
        0,
        0,
        outSize,
        outSize
      );

      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(
          (result) => {
            if (result) {
              resolve(result);
              return;
            }
            canvas.toBlob((jpegFallback) => resolve(jpegFallback), 'image/jpeg', 0.92);
          },
          'image/webp',
          0.92
        );
      });

      if (!blob) {
        onConfirm(file);
        return;
      }

      const ext = blob.type === 'image/jpeg' ? 'jpg' : 'webp';
      const baseName = file.name.replace(/\.[^/.]+$/, '') || 'avatar';
      const croppedFile = new File([blob], `${baseName}_avatar.${ext}`, {
        type: blob.type || 'image/webp',
      });
      onConfirm(croppedFile);
    } finally {
      setExporting(false);
    }
  };

  const totalScale = coverScale * zoom;
  const renderedWidth = naturalSize ? naturalSize.width * totalScale : VIEWPORT_SIZE;
  const renderedHeight = naturalSize ? naturalSize.height * totalScale : VIEWPORT_SIZE;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Ajustar foto de perfil"
      className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div className="w-full max-w-md bg-[#111115] border border-white/12 rounded-2xl overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/8">
          <div>
            <h2 className="font-display text-base font-bold text-white">
              Ajustar Foto de Perfil
            </h2>
            <p className="text-[11px] text-zinc-400">
              Arraste e use o zoom para escolher a melhor área da imagem
            </p>
          </div>
          <button
            type="button"
            disabled={exporting}
            onClick={onCancel}
            aria-label="Fechar ajuste de foto"
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Interactive Circular Crop Viewport */}
        <div className="p-5 flex flex-col items-center gap-4 bg-[#08080A]">
          <div
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUpOrCancel}
            onPointerCancel={handlePointerUpOrCancel}
            onWheel={(e) => {
              e.preventDefault();
              const delta = e.deltaY < 0 ? 0.12 : -0.12;
              handleZoomChange(zoom + delta);
            }}
            style={{ width: VIEWPORT_SIZE, height: VIEWPORT_SIZE }}
            className={`relative overflow-hidden rounded-2xl bg-black border border-white/15 touch-none select-none flex items-center justify-center ${
              dragging ? 'cursor-grabbing' : 'cursor-grab'
            }`}
          >
            {imageUrl && (
              <img
                ref={imgRef}
                src={imageUrl}
                alt="Prévia do recorte"
                draggable={false}
                onLoad={(e) => {
                  const img = e.currentTarget;
                  if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                    setNaturalSize({ width: img.naturalWidth, height: img.naturalHeight });
                    setZoom(1);
                    setOffset({ x: 0, y: 0 });
                  }
                }}
                onError={() => {
                  onUnsupportedPreview(file);
                }}
                style={{
                  width: renderedWidth,
                  height: renderedHeight,
                  transform: `translate3d(${offset.x}px, ${offset.y}px, 0)`,
                }}
                className="max-w-none max-h-none pointer-events-none select-none"
              />
            )}

            {/* TikTok / WhatsApp style circular mask overlay */}
            <svg
              viewBox="0 0 100 100"
              className="pointer-events-none absolute inset-0 w-full h-full"
              aria-hidden="true"
            >
              <defs>
                <mask id="avatar-circle-cutout">
                  <rect width="100" height="100" fill="white" />
                  <circle cx="50" cy="50" r="47" fill="black" />
                </mask>
              </defs>
              <rect
                width="100"
                height="100"
                fill="rgba(0,0,0,0.62)"
                mask="url(#avatar-circle-cutout)"
              />
              <circle
                cx="50"
                cy="50"
                r="47"
                fill="none"
                stroke="rgba(255,255,255,0.85)"
                strokeWidth="0.7"
              />
              {dragging && (
                <g stroke="rgba(255,255,255,0.22)" strokeWidth="0.35">
                  <line x1="34" y1="5" x2="34" y2="95" />
                  <line x1="66" y1="5" x2="66" y2="95" />
                  <line x1="5" y1="34" x2="95" y2="34" />
                  <line x1="5" y1="66" x2="95" y2="66" />
                </g>
              )}
            </svg>

            {!naturalSize && (
              <span className="absolute text-xs text-zinc-400">Carregando imagem...</span>
            )}
          </div>

          <div className="flex items-center gap-1.5 text-[11px] text-zinc-400">
            <Move className="w-3.5 h-3.5 text-zinc-500" />
            <span>Arraste para reposicionar</span>
          </div>

          {/* Zoom Controls */}
          <div className="w-full flex items-center gap-3 px-2">
            <button
              type="button"
              disabled={!naturalSize || zoom <= MIN_ZOOM}
              onClick={() => handleZoomChange(zoom - 0.15)}
              aria-label="Diminuir zoom"
              className="p-2 rounded-lg bg-white/8 hover:bg-white/15 text-zinc-200 disabled:opacity-40"
            >
              <ZoomOut className="w-4 h-4" />
            </button>

            <input
              type="range"
              min={MIN_ZOOM}
              max={MAX_ZOOM}
              step={0.01}
              value={zoom}
              disabled={!naturalSize}
              onChange={(e) => handleZoomChange(Number(e.target.value))}
              aria-label="Controle de zoom da foto"
              className="flex-1 accent-[#E11D48] cursor-pointer"
            />

            <button
              type="button"
              disabled={!naturalSize || zoom >= MAX_ZOOM}
              onClick={() => handleZoomChange(zoom + 0.15)}
              aria-label="Aumentar zoom"
              className="p-2 rounded-lg bg-white/8 hover:bg-white/15 text-zinc-200 disabled:opacity-40"
            >
              <ZoomIn className="w-4 h-4" />
            </button>

            <button
              type="button"
              disabled={!naturalSize || (zoom === 1 && offset.x === 0 && offset.y === 0)}
              onClick={() => {
                setZoom(1);
                setOffset({ x: 0, y: 0 });
              }}
              aria-label="Centralizar foto"
              title="Centralizar"
              className="p-2 rounded-lg bg-white/8 hover:bg-white/15 text-zinc-300 disabled:opacity-40"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-2.5 px-5 py-4 border-t border-white/8 bg-[#111115]">
          <button
            type="button"
            disabled={exporting}
            onClick={onCancel}
            className="px-4 py-2 rounded-xl bg-white/8 hover:bg-white/15 text-xs font-medium text-zinc-200 disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={!naturalSize || exporting}
            onClick={() => void handleConfirmCrop()}
            className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl bg-[#E11D48] hover:bg-[#BE123C] text-white text-xs font-semibold disabled:opacity-40"
          >
            <Check className="w-3.5 h-3.5" />
            {exporting ? 'Recortando...' : 'Usar esta Foto'}
          </button>
        </div>
      </div>
    </div>
  );
}
