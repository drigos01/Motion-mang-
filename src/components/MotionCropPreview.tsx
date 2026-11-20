import React, { useEffect, useMemo, useState } from 'react';
import { Crop, Film, X } from 'lucide-react';
import {
  computeProportionalCropRect,
  MotionAlignment,
} from '../../shared/motionMedia';
import { formatMotionSize, MotionInspectionResult } from '../lib/motionValidation';

interface MotionCropPreviewProps {
  inspection: MotionInspectionResult;
  pageWidth: number | null;
  pageHeight: number | null;
  alignment: MotionAlignment;
  onAlignmentChange: (alignment: MotionAlignment) => void;
  onClear?: () => void;
}

const ALIGNMENT_OPTIONS: Array<{ value: MotionAlignment; label: string }> = [
  { value: 'left', label: 'Esquerda' },
  { value: 'center', label: 'Centro' },
  { value: 'right', label: 'Direita' },
];

export function MotionCropPreview({
  inspection,
  pageWidth,
  pageHeight,
  alignment,
  onAlignmentChange,
  onClear,
}: MotionCropPreviewProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(inspection.file);
    setPreviewUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [inspection.file]);

  const crop = useMemo(() => {
    if (!pageWidth || !pageHeight) return null;
    return computeProportionalCropRect({
      mediaWidth: inspection.width,
      mediaHeight: inspection.height,
      targetWidth: pageWidth,
      targetHeight: pageHeight,
      alignment,
      requireEvenDimensions: inspection.isVideo,
    });
  }, [inspection.width, inspection.height, inspection.isVideo, pageWidth, pageHeight, alignment]);

  const objectPosition =
    alignment === 'left'
      ? 'left center'
      : alignment === 'right'
        ? 'right center'
        : 'center center';

  const previewAspectRatio =
    pageWidth && pageHeight && crop?.needsCrop
      ? `${pageWidth} / ${pageHeight}`
      : `${inspection.width} / ${inspection.height}`;

  return (
    <div className="p-3.5 rounded-xl bg-[#111115] border border-white/10 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Film className="w-4 h-4 text-[#E11D48] shrink-0" />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-white truncate">{inspection.file.name}</p>
            <p className="text-[11px] font-mono-tabular text-zinc-400">
              {inspection.format.toUpperCase()} • {inspection.width}×{inspection.height} •{' '}
              {inspection.isVideo || inspection.isAnimated
                ? `${inspection.durationSeconds.toFixed(1).replace('.', ',')}s / 10s`
                : 'Estático'}{' '}
              • {formatMotionSize(inspection.sizeBytes)}
            </p>
          </div>
        </div>
        {onClear && (
          <button
            type="button"
            onClick={onClear}
            aria-label="Remover seleção de Motion"
            className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-4 items-start">
        <div className="shrink-0">
          <div
            className="w-36 max-h-56 rounded-lg overflow-hidden bg-black border border-white/15 flex items-center justify-center"
            style={{ aspectRatio: previewAspectRatio }}
          >
            {previewUrl &&
              (inspection.isVideo ? (
                <video
                  src={previewUrl}
                  autoPlay
                  muted
                  loop
                  playsInline
                  className="w-full h-full object-cover"
                  style={{ objectPosition }}
                />
              ) : (
                <img
                  src={previewUrl}
                  alt="Prévia do recorte Motion"
                  className="w-full h-full object-cover"
                  style={{ objectPosition }}
                />
              ))}
          </div>
        </div>

        <div className="flex-1 space-y-2.5 min-w-0">
          <div className="flex items-start gap-2 text-xs">
            <Crop className="w-4 h-4 text-[#E11D48] shrink-0 mt-0.5" />
            {crop ? (
              crop.needsCrop ? (
                <div className="space-y-0.5">
                  <p className="font-medium text-white">
                    Recorte proporcional automático ativo
                  </p>
                  <p className="text-[11px] text-zinc-400">
                    Página: {pageWidth}×{pageHeight} • Saída final:{' '}
                    <span className="text-zinc-200 font-mono-tabular">
                      {crop.cropWidth}×{crop.cropHeight}
                    </span>{' '}
                    ({inspection.isVideo ? 'MP4 otimizado' : inspection.format.toUpperCase()}, sem esticar ou deformar).
                  </p>
                </div>
              ) : (
                <div className="space-y-0.5">
                  <p className="font-medium text-emerald-400">Proporção compatível com a página</p>
                  <p className="text-[11px] text-zinc-400">
                    Página: {pageWidth}×{pageHeight}. Não será necessário corte horizontal.
                  </p>
                </div>
              )
            ) : (
              <p className="text-[11px] text-amber-300">
                Selecione a Imagem Original para visualizar a proporção exata do recorte.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <div className="text-[11px] font-medium text-zinc-300">
              Alinhamento do recorte horizontal:
            </div>
            <div className="inline-flex rounded-lg bg-[#0B0B0E] p-1 border border-white/10 gap-1">
              {ALIGNMENT_OPTIONS.map((opt) => {
                const active = alignment === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => onAlignmentChange(opt.value)}
                    className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                      active
                        ? 'bg-[#E11D48] text-white'
                        : 'text-zinc-400 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
