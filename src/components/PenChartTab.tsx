/**
 * PenChartTab — PDF 양식 위에 태블릿 직접 필기
 *
 * T-20260513-foot-C21-TAB-RESTRUCTURE-C (AC-4)
 * T-20260517-foot-PENCHART-FORM: PDF 양식 배경 + 상용구
 *
 * - form_templates WHERE form_key='pen_chart' 템플릿 이미지 배경 렌더링
 * - Canvas API + PointerEvent 로 직접 필기 (SignaturePad 패턴 재사용)
 * - 완성본 Supabase Storage photos 버킷 `customer/{id}/pen-chart/` 저장
 * - 저장된 차트 목록 조회 + 이미지 뷰어
 * - 상용구 (boilerplate) 기능: 미리 등록된 텍스트 → 원하는 위치에 삽입
 * - 새 npm 패키지 불필요
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { format } from 'date-fns';
import { Download, Eraser, Pencil, Plus, RotateCcw, Save, Trash2, Type, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

// ─── 상용구 데이터 ───
// T-20260517-foot-PENCHART-FORM: 자주 사용하는 텍스트 템플릿
export const BOILERPLATE_ITEMS = [
  { id: 'b1', label: '발목 족저근막염', text: '족저근막염\n좌 / 우  초음파 확인' },
  { id: 'b2', label: '무지외반증', text: '무지외반증\n좌 / 우  Grade:' },
  { id: 'b3', label: '굳은살·티눈', text: '굳은살 / 티눈\n부위:' },
  { id: 'b4', label: '발톱 내성발톱', text: '내성발톱\n좌 / 우  단계:' },
  { id: 'b5', label: '평발(편평족)', text: '편평족\n좌 / 우  Arch Index:' },
  { id: 'b6', label: '당뇨발 주의', text: '당뇨발 주의사항\n혈당조절 중요. 상처 즉시 내원.' },
  { id: 'b7', label: '시술 후 주의', text: '시술 후 주의사항:\n・ 당일 세발 금지\n・ 48시간 습윤 유지\n・ 출혈·발열 시 즉시 내원' },
  { id: 'b8', label: '다음 예약', text: '다음 예약: ___ 월 ___ 일 ___ 시\n담당:' },
];

interface SavedChart {
  name: string;
  url: string;
  uploadedAt: string; // ISO string parsed from filename
}

interface Template {
  id: string;
  name_ko: string;
  template_path: string;
  template_format: string;
}

// ─── 내장 폴백 템플릿 ───
// T-20260517-foot-PENCHART-FORM: DB 미적용 시 폴백 (public/forms/ 에셋)
export const BUILTIN_PEN_CHART_TEMPLATE: Template = {
  id: 'builtin-pen-chart',
  name_ko: '펜차트 양식',
  template_path: '/forms/pen_chart_form.png',
  template_format: 'png',
};

const CANVAS_W = 720;
const CANVAS_H = 1020; // A4 비율 약 1:√2

const PEN_COLORS = [
  { label: '검정', value: '#1a1a1a' },
  { label: '파랑', value: '#1d4ed8' },
  { label: '빨강', value: '#dc2626' },
  { label: '초록', value: '#16a34a' },
];

type BoilerplateMode = 'idle' | 'selecting' | 'placing';

export function PenChartTab({
  customerId,
  clinicId,
}: {
  customerId: string;
  clinicId: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [savedCharts, setSavedCharts] = useState<SavedChart[]>([]);
  const [template, setTemplate] = useState<Template | null>(null);
  const [templateImgUrl, setTemplateImgUrl] = useState<string | null>(null);
  const [mode, setMode] = useState<'list' | 'draw'>('list');
  const [penColor, setPenColor] = useState('#1a1a1a');
  const [penSize, setPenSize] = useState(2.5);
  const [isEraser, setIsEraser] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hasDrawing, setHasDrawing] = useState(false);
  const [selectedChart, setSelectedChart] = useState<SavedChart | null>(null);

  // ─── 상용구 상태 ───
  const [boilerplateMode, setBoilerplateMode] = useState<BoilerplateMode>('idle');
  const [pendingBoilerplate, setPendingBoilerplate] = useState<string>('');
  const [showBoilerplatePanel, setShowBoilerplatePanel] = useState(false);

  const drawingRef = useRef(false);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);
  const emptyRef = useRef(true);

  const storagePath = `customer/${customerId}/pen-chart`;

  // ── 저장된 차트 목록 로드 ────────────────────────────────────────────
  const loadSavedCharts = useCallback(async () => {
    const { data: files } = await supabase.storage
      .from('photos')
      .list(storagePath, { limit: 100, sortBy: { column: 'name', order: 'desc' } });

    if (!files || files.length === 0) { setSavedCharts([]); return; }

    const charts = await Promise.all(
      files
        .filter((f) => f.name && !f.id?.endsWith('/'))
        .map(async (file) => {
          const path = `${storagePath}/${file.name}`;
          const { data } = await supabase.storage.from('photos').createSignedUrl(path, 3600);
          const tsMatch = file.name.match(/^(\d+)/);
          const ts = tsMatch ? parseInt(tsMatch[1], 10) : 0;
          return {
            name: file.name,
            url: data?.signedUrl ?? '',
            uploadedAt: ts ? new Date(ts).toISOString() : '',
          };
        }),
    );
    setSavedCharts(charts.filter((c) => c.url));
  }, [storagePath]);

  // ── 템플릿 로드 ──────────────────────────────────────────────────────
  const loadTemplate = useCallback(async () => {
    const { data } = await supabase
      .from('form_templates')
      .select('id, name_ko, template_path, template_format')
      .eq('clinic_id', clinicId)
      .eq('form_key', 'pen_chart')
      .eq('active', true)
      .maybeSingle();

    // DB에 pen_chart 템플릿 없으면 내장 폴백 사용
    const tpl = (data as Template | null) ?? BUILTIN_PEN_CHART_TEMPLATE;
    setTemplate(tpl);

    const path = tpl.template_path;
    if (!path) return;

    // '/'로 시작하면 public/ 정적 파일 (Vercel/개발서버 직접 서빙)
    if (path.startsWith('/')) {
      setTemplateImgUrl(path);
    } else {
      // Supabase Storage 경로 → signed URL
      const { data: urlData } = await supabase.storage
        .from('photos')
        .createSignedUrl(path, 3600);
      if (urlData?.signedUrl) setTemplateImgUrl(urlData.signedUrl);
    }
  }, [clinicId]);

  useEffect(() => {
    loadSavedCharts();
    loadTemplate();
  }, [loadSavedCharts, loadTemplate]);

  // ── 캔버스 초기화 ─────────────────────────────────────────────────────
  const initCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = CANVAS_W * dpr;
    canvas.height = CANVAS_H * dpr;
    canvas.style.width = `${CANVAS_W}px`;
    canvas.style.height = `${CANVAS_H}px`;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // 템플릿 이미지 그리기 (PDF 양식 배경)
    if (templateImgUrl) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        ctx.drawImage(img, 0, 0, CANVAS_W, CANVAS_H);
      };
      img.src = templateImgUrl;
    }
    emptyRef.current = true;
    setHasDrawing(false);
    setBoilerplateMode('idle');
    setPendingBoilerplate('');
    setShowBoilerplatePanel(false);
  }, [templateImgUrl]);

  useEffect(() => {
    if (mode === 'draw') {
      // 약간의 딜레이 후 캔버스 초기화 (DOM mount 대기)
      const t = setTimeout(initCanvas, 50);
      return () => clearTimeout(t);
    }
  }, [mode, initCanvas]);

  // ── 포인터 이벤트 ────────────────────────────────────────────────────
  const getPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = CANVAS_W / rect.width;
    const scaleY = CANVAS_H / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  // 상용구 배치: 캔버스 클릭 시 해당 위치에 텍스트 삽입
  const placeBoilerplate = (x: number, y: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const lines = pendingBoilerplate.split('\n');
    ctx.save();
    ctx.font = `${penSize * 4 + 6}px 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif`;
    ctx.fillStyle = penColor;
    ctx.textBaseline = 'top';
    const lineHeight = penSize * 4 + 12;
    lines.forEach((line, i) => {
      ctx.fillText(line, x, y + i * lineHeight);
    });
    ctx.restore();

    emptyRef.current = false;
    setHasDrawing(true);
    setBoilerplateMode('idle');
    setPendingBoilerplate('');
    toast.success('상용구 삽입 완료');
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;

    const pos = getPos(e);

    // 상용구 배치 모드: 클릭 위치에 텍스트 삽입
    if (boilerplateMode === 'placing' && pendingBoilerplate) {
      placeBoilerplate(pos.x, pos.y);
      return;
    }

    canvas.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    lastPosRef.current = pos;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.beginPath();
    if (isEraser) {
      ctx.clearRect(pos.x - penSize * 4, pos.y - penSize * 4, penSize * 8, penSize * 8);
    } else {
      ctx.arc(pos.x, pos.y, penSize * 0.5, 0, Math.PI * 2);
      ctx.fillStyle = penColor;
      ctx.fill();
      emptyRef.current = false;
      setHasDrawing(true);
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (boilerplateMode === 'placing') return; // 배치 모드에서는 그리기 무시
    if (!drawingRef.current) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const pos = getPos(e);
    const last = lastPosRef.current ?? pos;

    if (isEraser) {
      ctx.clearRect(pos.x - penSize * 4, pos.y - penSize * 4, penSize * 8, penSize * 8);
    } else {
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(pos.x, pos.y);
      ctx.strokeStyle = penColor;
      ctx.lineWidth = penSize;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
      emptyRef.current = false;
      setHasDrawing(true);
    }
    lastPosRef.current = pos;
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    lastPosRef.current = null;
    const canvas = canvasRef.current;
    if (canvas && canvas.hasPointerCapture(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId);
    }
  };

  // ── 저장 ─────────────────────────────────────────────────────────────
  const handleSave = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setSaving(true);
    try {
      const dataUrl = canvas.toDataURL('image/png');
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const fileName = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}.png`;
      const path = `${storagePath}/${fileName}`;
      const { error } = await supabase.storage.from('photos').upload(path, blob, {
        contentType: 'image/png',
        upsert: false,
      });
      if (error) { toast.error(`저장 실패: ${error.message}`); return; }
      toast.success('펜차트 저장 완료');
      await loadSavedCharts();
      setMode('list');
    } finally {
      setSaving(false);
    }
  };

  // ── 삭제 ─────────────────────────────────────────────────────────────
  const handleDelete = async (chart: SavedChart) => {
    if (!window.confirm(`"${chart.name}" 을 삭제하시겠습니까?`)) return;
    const path = `${storagePath}/${chart.name}`;
    await supabase.storage.from('photos').remove([path]);
    toast.success('삭제 완료');
    if (selectedChart?.name === chart.name) setSelectedChart(null);
    await loadSavedCharts();
  };

  // ── 상용구 선택 처리 ─────────────────────────────────────────────────
  const handleBoilerplateSelect = (text: string) => {
    setPendingBoilerplate(text);
    setBoilerplateMode('placing');
    setShowBoilerplatePanel(false);
    setIsEraser(false);
    toast('캔버스를 클릭해 상용구를 삽입하세요', { duration: 2000 });
  };

  // ── 렌더: 목록 뷰 ────────────────────────────────────────────────────
  if (mode === 'list') {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border bg-white p-3 text-xs">
          <div className="flex items-center justify-between mb-3">
            <span className="flex items-center gap-1.5 font-bold text-purple-800">
              <span className="h-2 w-2 rounded-full bg-purple-500" />
              펜차트 — PDF 양식 위 직접 필기
            </span>
            <Button
              size="sm"
              className="h-7 text-[11px] px-3 bg-purple-600 hover:bg-purple-700"
              onClick={() => setMode('draw')}
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              새 차트 작성
            </Button>
          </div>

          {template && (
            <div className="mb-2 rounded bg-purple-50 border border-purple-100 px-2 py-1 text-[11px] text-purple-700">
              템플릿: {template.name_ko}
            </div>
          )}
          {!template && (
            <div className="mb-2 rounded bg-gray-50 border border-dashed px-2 py-1 text-[11px] text-muted-foreground">
              템플릿 없음 — 빈 캔버스(A4)로 작성합니다
            </div>
          )}

          {savedCharts.length === 0 ? (
            <div className="py-6 text-center text-muted-foreground border border-dashed rounded">
              저장된 펜차트 없음
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {savedCharts.map((chart) => (
                <div
                  key={chart.name}
                  className={cn(
                    'relative rounded border cursor-pointer overflow-hidden',
                    selectedChart?.name === chart.name
                      ? 'border-purple-400 ring-1 ring-purple-300'
                      : 'border-gray-200 hover:border-purple-300',
                  )}
                  onClick={() => setSelectedChart(chart.name === selectedChart?.name ? null : chart)}
                >
                  <img
                    src={chart.url}
                    alt={chart.name}
                    className="w-full object-cover"
                    style={{ maxHeight: 200 }}
                  />
                  <div className="absolute bottom-0 left-0 right-0 bg-black/40 text-white text-[10px] px-1.5 py-1 flex items-center justify-between">
                    <span>
                      {chart.uploadedAt
                        ? format(new Date(chart.uploadedAt), 'MM-dd HH:mm')
                        : chart.name}
                    </span>
                    <div className="flex gap-1">
                      <a
                        href={chart.url}
                        download={chart.name}
                        onClick={(e) => e.stopPropagation()}
                        className="text-white/80 hover:text-white"
                      >
                        <Download className="h-3 w-3" />
                      </a>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(chart); }}
                        className="text-red-300 hover:text-red-100"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 선택된 차트 확대 뷰 */}
        {selectedChart && (
          <div className="rounded-lg border bg-white p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-muted-foreground">
                {selectedChart.uploadedAt
                  ? format(new Date(selectedChart.uploadedAt), 'yyyy-MM-dd HH:mm')
                  : selectedChart.name}
              </span>
              <button
                onClick={() => setSelectedChart(null)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                닫기
              </button>
            </div>
            <img src={selectedChart.url} alt="펜차트" className="w-full rounded border" />
          </div>
        )}
      </div>
    );
  }

  // ── 렌더: 그리기 모드 ────────────────────────────────────────────────
  return (
    <div className="space-y-2">
      {/* 툴바 */}
      <div className="rounded-lg border bg-white p-2 flex items-center gap-2 flex-wrap sticky top-0 z-10 shadow-sm">
        {/* 펜/지우개 */}
        <button
          onClick={() => { setIsEraser(false); setBoilerplateMode('idle'); }}
          className={cn(
            'flex items-center gap-1 px-2 py-1 rounded text-xs border transition',
            !isEraser && boilerplateMode === 'idle'
              ? 'bg-purple-100 border-purple-400 text-purple-700'
              : 'bg-white border-gray-200 text-muted-foreground hover:bg-gray-50',
          )}
        >
          <Pencil className="h-3.5 w-3.5" /> 펜
        </button>
        <button
          onClick={() => { setIsEraser(true); setBoilerplateMode('idle'); }}
          className={cn(
            'flex items-center gap-1 px-2 py-1 rounded text-xs border transition',
            isEraser ? 'bg-orange-100 border-orange-400 text-orange-700' : 'bg-white border-gray-200 text-muted-foreground hover:bg-gray-50',
          )}
        >
          <Eraser className="h-3.5 w-3.5" /> 지우개
        </button>

        {/* 상용구 버튼 */}
        <div className="relative">
          <button
            onClick={() => {
              setShowBoilerplatePanel(!showBoilerplatePanel);
              setBoilerplateMode('selecting');
              setIsEraser(false);
            }}
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded text-xs border transition',
              boilerplateMode !== 'idle'
                ? 'bg-teal-100 border-teal-400 text-teal-700'
                : 'bg-white border-gray-200 text-muted-foreground hover:bg-gray-50',
            )}
          >
            <Type className="h-3.5 w-3.5" /> 상용구
            {boilerplateMode === 'placing' && (
              <span className="ml-0.5 text-teal-600 animate-pulse">●</span>
            )}
          </button>

          {/* 상용구 패널 */}
          {showBoilerplatePanel && (
            <div className="absolute top-8 left-0 z-20 w-52 rounded-lg border bg-white shadow-lg overflow-hidden">
              <div className="flex items-center justify-between px-2 py-1.5 bg-teal-50 border-b">
                <span className="text-[11px] font-bold text-teal-800">상용구 선택</span>
                <button
                  onClick={() => { setShowBoilerplatePanel(false); setBoilerplateMode('idle'); }}
                  className="text-teal-500 hover:text-teal-700"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="max-h-56 overflow-y-auto">
                {BOILERPLATE_ITEMS.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => handleBoilerplateSelect(item.text)}
                    className="w-full text-left px-3 py-2 text-[11px] hover:bg-teal-50 border-b border-gray-100 last:border-0 transition"
                  >
                    <div className="font-medium text-gray-800">{item.label}</div>
                    <div className="text-gray-400 mt-0.5 text-[10px] truncate">{item.text.split('\n')[0]}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 상용구 배치 모드 안내 */}
        {boilerplateMode === 'placing' && (
          <div className="flex items-center gap-1 px-2 py-1 rounded bg-teal-50 border border-teal-300 text-[11px] text-teal-700">
            <span className="animate-pulse">●</span>
            캔버스 클릭해 삽입
            <button
              onClick={() => { setBoilerplateMode('idle'); setPendingBoilerplate(''); }}
              className="ml-1 text-teal-400 hover:text-teal-700"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}

        {/* 색상 */}
        <div className="flex items-center gap-1">
          {PEN_COLORS.map((c) => (
            <button
              key={c.value}
              onClick={() => { setPenColor(c.value); setIsEraser(false); setBoilerplateMode('idle'); }}
              className={cn(
                'h-5 w-5 rounded-full border-2 transition',
                penColor === c.value && !isEraser ? 'border-gray-600 scale-110' : 'border-transparent',
              )}
              style={{ backgroundColor: c.value }}
              title={c.label}
            />
          ))}
        </div>

        {/* 굵기 */}
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <span>굵기</span>
          <input
            type="range"
            min={1}
            max={8}
            step={0.5}
            value={penSize}
            onChange={(e) => setPenSize(parseFloat(e.target.value))}
            className="w-16"
          />
          <span className="tabular-nums w-4">{penSize}</span>
        </div>

        <div className="ml-auto flex gap-1.5">
          <button
            onClick={initCanvas}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs border border-gray-200 hover:bg-gray-50"
            title="전체 초기화"
          >
            <RotateCcw className="h-3.5 w-3.5" /> 초기화
          </button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[11px] px-2"
            onClick={() => {
              if (hasDrawing && !window.confirm('작성 중인 내용이 사라집니다. 취소하시겠습니까?')) return;
              setMode('list');
            }}
          >
            취소
          </Button>
          <Button
            size="sm"
            className="h-7 text-[11px] px-3 bg-purple-600 hover:bg-purple-700"
            onClick={handleSave}
            disabled={saving}
          >
            <Save className="h-3.5 w-3.5 mr-1" />
            {saving ? '저장 중…' : '저장'}
          </Button>
        </div>
      </div>

      {/* 캔버스 */}
      <div className="rounded-lg border bg-white p-2 overflow-x-auto">
        <div className="text-[10px] text-muted-foreground mb-1">
          {template ? `템플릿: ${template.name_ko}` : '빈 캔버스 (A4)'}
          {' — 태블릿/마우스로 직접 필기'}
          {boilerplateMode === 'placing' && (
            <span className="ml-2 text-teal-600 font-medium">클릭하여 상용구 삽입</span>
          )}
        </div>
        <canvas
          ref={canvasRef}
          style={{
            touchAction: 'none',
            cursor: boilerplateMode === 'placing'
              ? 'text'
              : isEraser
              ? 'cell'
              : 'crosshair',
            border: '1px solid #e2e8f0',
            display: 'block',
            maxWidth: '100%',
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          onPointerCancel={onPointerUp}
        />
      </div>
    </div>
  );
}
