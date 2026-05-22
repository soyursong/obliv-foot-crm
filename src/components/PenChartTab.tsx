// LOGIC-LOCK: L-003 — 차트 수정사항 CRM 전체 고객 동일 적용. 변경 시 현장 승인 필수
/**
 * PenChartTab — PDF 양식 위에 태블릿 직접 필기
 *
 * T-20260513-foot-C21-TAB-RESTRUCTURE-C (AC-4)
 * T-20260517-foot-PENCHART-FORM: PDF 양식 배경 + 상용구
 * T-20260519-foot-HEALTH-Q-PEN: 발건강 질문지 PDF 캔버스 + 태블릿펜 기입
 * T-20260520-foot-PENCHART-MODAL: draw → shadcn Dialog fullscreen (backdrop + ESC close)
 * T-20260520-foot-PENCHART-REFUND-FORM: 환불/비급여 동의서 PDF 원본 + 오버레이 입력
 * T-20260520-foot-PENCHART-CHECKLIST-REMOVE: 개인정보+체크리스트 2종 양식 제거
 *
 * 모드 구조:
 *   list   — 저장된 차트 목록 + 새 차트 버튼
 *   select — 양식 선택 패널 (pen_chart / health_questionnaire_* / refund_consent)
 *   draw   — 캔버스 필기 모드 (pen_chart + health_questionnaire_* + refund_consent 공용)
 *
 * draw 모드 저장:
 *   - photos bucket / customer/{id}/pen-chart/{ts}_{rand}.png
 *   - health_questionnaire는 파일명에 'hq_' prefix 붙여 구분
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { format } from 'date-fns';
import {
  ClipboardList, Download, Eraser, Pencil, Plus, RotateCcw,
  Save, Trash2, Type, X, ChevronLeft, FileText, Undo2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
// T-20260520-foot-PENCHART-REFUND-FORM: 서명 캡처 (pdf_overlay 공용)
import { SignaturePad, type SignaturePadHandle } from '@/components/forms/SignaturePad';

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
  form_key: string;
}

// ─── 내장 폴백 템플릿 ───
// T-20260517-foot-PENCHART-FORM: DB 미적용 시 폴백 (public/forms/ 에셋)
export const BUILTIN_PEN_CHART_TEMPLATE: Template = {
  id: 'builtin-pen-chart',
  name_ko: '펜차트 양식',
  template_path: '/forms/pen_chart_form.png',
  template_format: 'png',
  form_key: 'pen_chart',
};

// T-20260519-foot-HEALTH-Q-PEN: 발건강 질문지 PDF→PNG 폴백 (public/forms/ 에셋)
export const BUILTIN_HEALTH_Q_GENERAL: Template = {
  id: 'builtin-health-q-general',
  name_ko: '발건강 질문지 (일반)',
  template_path: '/forms/health_q_general.png',
  template_format: 'png',
  form_key: 'health_questionnaire_general',
};

export const BUILTIN_HEALTH_Q_SENIOR: Template = {
  id: 'builtin-health-q-senior',
  name_ko: '발건강 질문지 (어르신용)',
  template_path: '/forms/health_q_senior.png',
  template_format: 'png',
  form_key: 'health_questionnaire_senior',
};

// T-20260520-foot-PENCHART-REFUND-FORM: 환불/비급여 동의서 PDF 원본 폴백 (3페이지 세로 연결)
export const BUILTIN_REFUND_CONSENT: Template = {
  id: 'builtin-refund-consent',
  name_ko: '환불/비급여 동의서',
  template_path: '/forms/refund_consent.png',
  template_format: 'pdf_overlay',
  form_key: 'refund_consent',
};

const CANVAS_W = 720;
const CANVAS_H = 1020; // A4 비율 약 1:√2
// T-20260520-foot-PENCHART-REFUND-FORM: 환불/비급여 동의서 3페이지 세로 연결 (1241×5262 → 720×3052)
const CANVAS_H_REFUND_CONSENT = 3052;

// ─── T-20260522-foot-PENCHART-REFUND-AUTOFILL ────────────────────────────
// 환불/비급여 동의서 자동채움 필드 타입 + 위치 상수
interface AutofillFields {
  date:      string; // 작성일
  name:      string; // 고객 성명
  birthDate: string; // 생년월일
  phone:     string; // 연락처
}

// [환자 동의서] 섹션 (page 3, ≈ y 2650–2760) 자동채움 좌표
// 실제 폼 레이아웃에 맞게 조정 가능
const REFUND_AUTOFILL_POS: Array<{ key: keyof AutofillFields; x: number; y: number }> = [
  { key: 'date',      x: 476, y: 2662 }, // 작성 일자 (우측)
  { key: 'name',      x: 110, y: 2706 }, // 환자 성명
  { key: 'birthDate', x: 290, y: 2706 }, // 생년월일 (성명과 같은 행)
  { key: 'phone',     x: 110, y: 2748 }, // 연락처
];

function drawAutofillOnCtx(ctx: CanvasRenderingContext2D, fields: AutofillFields) {
  ctx.save();
  ctx.fillStyle = '#6b7280'; // gray-500 — 수기 입력과 시각적 구분
  ctx.font = 'italic 15px "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
  ctx.textBaseline = 'top';
  for (const { key, x, y } of REFUND_AUTOFILL_POS) {
    const val = fields[key];
    if (val) ctx.fillText(val, x, y);
  }
  ctx.restore();
}

const PEN_COLORS = [
  { label: '검정', value: '#1a1a1a' },
  { label: '파랑', value: '#1d4ed8' },
  { label: '빨강', value: '#dc2626' },
  { label: '초록', value: '#16a34a' },
];

type DrawMode = 'idle' | 'selecting' | 'placing';
type TabMode = 'list' | 'select' | 'draw';

/** draw 모드에서 활성 양식이 발건강 질문지인지 구분 */
const isHealthQFormKey = (k: string) => k.startsWith('health_questionnaire_');

/** T-20260520-foot-PENCHART-REFUND-FORM: pdf_overlay 양식 (환불/비급여 동의서) */
const isPdfOverlayFormKey = (k: string) => k === 'refund_consent';

/** T-20260520-foot-PENCHART-REFUND-FORM: 환불/비급여 동의서 여부 (3페이지) */
const isRefundConsentKey = (k: string) => k === 'refund_consent';

/** 양식에 따른 캔버스 높이 반환 */
const getCanvasHeightForForm = (formKey: string | undefined): number => {
  if (!formKey) return CANVAS_H;
  if (isRefundConsentKey(formKey)) return CANVAS_H_REFUND_CONSENT;
  return CANVAS_H;
};



// ─── FullscreenFormWrapper ─────────────────────────────────────────────────
/**
 * FullscreenFormWrapper — 태블릿 최적화 공통 전체화면 래퍼
 * T-20260520-foot-PENCHART-FULLSCREEN AC-5~7:
 *   - 펜차트 탭 내 모든 양식(select/draw/fill + 향후 신규)이 동일 fullscreen UX
 *   - 개별 양식마다 Dialog 분기 없음 — 이 래퍼 하나만 적용
 *   - 향후 양식 추가 시 자동으로 fullscreen 적용됨 (확장성 보장)
 */
function FullscreenFormWrapper({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="fullscreen" hideClose>
        {children}
      </DialogContent>
    </Dialog>
  );
}

// ─── 메인 컴포넌트 ──────────────────────────────────────────────────────────
export function PenChartTab({
  customerId,
  clinicId,
  checkInId,
  // T-20260522-foot-PENCHART-REFUND-AUTOFILL: 환불동의서 자동채움에 사용
  customerName,
  customerPhone,
  customerBirthDate,
  // T-20260520-foot-PENCHART-VIEW-SPLIT HOTFIX2: 상담내역 즉시 갱신
  onFormSubmissionSaved,
}: {
  customerId: string;
  clinicId: string;
  /** 현재 내원 check_in_id — form_submissions.check_in_id 자동 연동 */
  checkInId?: string;
  /** 고객 기본 정보 (양식 자동 채움) */
  customerName?: string;
  customerPhone?: string;
  customerBirthDate?: string;
  /** form_submissions INSERT 성공 시 — 상담내역 탭 [내용보기] 즉시 활성화 트리거 */
  onFormSubmissionSaved?: () => void;
}) {
  const { profile } = useAuth();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // T-20260522-foot-PENCHART-ERASER-CLARITY: 배경 레이어 (양식 이미지 전용 — 지우개 미적용)
  const bgCanvasRef = useRef<HTMLCanvasElement>(null);
  // T-20260522-foot-PENCHART-REFUND-AUTOFILL: 환불동의서 자동채움 데이터 (initCanvas 내 img.onload 에서 읽음)
  const autofillDataRef = useRef<AutofillFields | null>(null);
  const [savedCharts, setSavedCharts] = useState<SavedChart[]>([]);
  const [penChartTemplate, setPenChartTemplate] = useState<Template | null>(null);
  /** 발건강 질문지 템플릿 2종 (일반/어르신) — T-20260519-foot-HEALTH-Q-PEN */
  const [healthQTemplates, setHealthQTemplates] = useState<Template[]>([]);
  /** T-20260520-foot-PENCHART-REFUND-FORM: 환불/비급여 동의서 템플릿 */
  const [refundConsentTemplate, setRefundConsentTemplate] = useState<Template | null>(null);
  const [templateImgUrl, setTemplateImgUrl] = useState<string | null>(null);
  const [mode, setMode] = useState<TabMode>('list');
  /** draw 모드에서 현재 활성 양식 (pen_chart | health_questionnaire_* | refund_consent) */
  const [activeDrawTemplate, setActiveDrawTemplate] = useState<Template | null>(null);
  // staff.id — issued_by FK (profile.id ≠ staff.id, user_id 경유 조회)
  const [staffId, setStaffId] = useState<string | null>(null);

  // Canvas/draw states
  const [penColor, setPenColor] = useState('#1a1a1a');
  const [penSize, setPenSize] = useState(2.5);
  const [isEraser, setIsEraser] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hasDrawing, setHasDrawing] = useState(false);
  const [selectedChart, setSelectedChart] = useState<SavedChart | null>(null);

  // 상용구 상태
  const [boilerplateMode, setBoilerplateMode] = useState<DrawMode>('idle');
  const [pendingBoilerplate, setPendingBoilerplate] = useState<string>('');
  const [showBoilerplatePanel, setShowBoilerplatePanel] = useState(false);

  const drawingRef = useRef(false);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);
  const emptyRef = useRef(true);

  // T-20260519-foot-PENCHART-FORM-ADD (FIX): Undo 10단계
  const undoStackRef = useRef<ImageData[]>([]);
  const UNDO_LIMIT = 10;

  // T-20260519-foot-PENCHART-FORM-ADD (AC-4): pdf_overlay 전용 서명 캡처
  const sigPadRef = useRef<SignaturePadHandle>(null);
  const [sigEmpty, setSigEmpty] = useState(true);

  const storagePath = `customer/${customerId}/pen-chart`;

  // ── staff.id 조회 ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!profile?.id || !clinicId) return;
    supabase
      .from('staff')
      .select('id')
      .eq('user_id', profile.id)
      .eq('clinic_id', clinicId)
      .eq('active', true)
      .maybeSingle()
      .then(({ data }) => setStaffId(data?.id ?? null));
  }, [profile?.id, clinicId]);

  // ── T-20260522-foot-PENCHART-REFUND-AUTOFILL: 환불동의서 자동채움 데이터 준비 ──
  // activeDrawTemplate 변경 시 동기 실행 → initCanvas 내 setTimeout(50ms) 전에 ref 확정
  useEffect(() => {
    if (activeDrawTemplate && isRefundConsentKey(activeDrawTemplate.form_key)) {
      autofillDataRef.current = {
        date:      new Date().toLocaleDateString('ko-KR'),
        name:      customerName      ?? '',
        birthDate: customerBirthDate ?? '',
        phone:     customerPhone     ?? '',
      };
    } else {
      autofillDataRef.current = null;
    }
  }, [activeDrawTemplate, customerName, customerPhone, customerBirthDate]);

  // ── 저장된 차트 목록 로드 ────────────────────────────────────────────
  const loadSavedCharts = useCallback(async () => {
    const { data: files } = await supabase.storage
      .from('photos')
      .list(storagePath, { limit: 100, sortBy: { column: 'name', order: 'desc' } });

    if (!files || files.length === 0) { setSavedCharts([]); return; }

    // T-20260522-foot-PERF-TUNING OPT-7: N × createSignedUrl → createSignedUrls 1회 배치 (N 라운드트립 제거)
    const filtered = files.filter((f) => f.name && !f.id?.endsWith('/'));
    const paths = filtered.map((f) => `${storagePath}/${f.name}`);
    const { data: urlData } = await supabase.storage.from('photos').createSignedUrls(paths, 3600);
    const charts = filtered.map((file, i) => {
      const tsMatch = file.name.match(/^(\d+)/);
      const ts = tsMatch ? parseInt(tsMatch[1], 10) : 0;
      return {
        name: file.name,
        url: urlData?.[i]?.signedUrl ?? '',
        uploadedAt: ts ? new Date(ts).toISOString() : '',
      };
    });
    setSavedCharts(charts.filter((c) => c.url));
  }, [storagePath]);

  // ── 템플릿 로드 ──────────────────────────────────────────────────────
  // T-20260520-foot-PENCHART-CHECKLIST-REMOVE: personal_checklist_* 제거됨
  const loadTemplates = useCallback(async () => {
    const { data } = await supabase
      .from('form_templates')
      .select('id, name_ko, template_path, template_format, form_key')
      .eq('clinic_id', clinicId)
      .in('form_key', [
        'pen_chart',
        'health_questionnaire_general', 'health_questionnaire_senior',
        'refund_consent', // T-20260520-foot-PENCHART-REFUND-FORM
      ])
      .eq('active', true)
      .order('sort_order', { ascending: true });

    if (data) {
      const penChart = (data as Template[]).find((t) => t.form_key === 'pen_chart');
      const healthQs  = (data as Template[]).filter((t) => t.form_key.startsWith('health_questionnaire_'));
      // T-20260520-foot-PENCHART-REFUND-FORM: DB 또는 내장 폴백
      const refundConsent = (data as Template[]).find((t) => t.form_key === 'refund_consent');
      setPenChartTemplate(penChart ?? BUILTIN_PEN_CHART_TEMPLATE);
      // DB에 발건강 질문지 행 없으면 내장 폴백 사용
      setHealthQTemplates(healthQs.length > 0 ? healthQs : [BUILTIN_HEALTH_Q_GENERAL, BUILTIN_HEALTH_Q_SENIOR]);
      // T-20260520-foot-PENCHART-REFUND-FORM: DB 또는 내장 폴백
      setRefundConsentTemplate(refundConsent ?? BUILTIN_REFUND_CONSENT);
    } else {
      setPenChartTemplate(BUILTIN_PEN_CHART_TEMPLATE);
      setHealthQTemplates([BUILTIN_HEALTH_Q_GENERAL, BUILTIN_HEALTH_Q_SENIOR]);
      setRefundConsentTemplate(BUILTIN_REFUND_CONSENT);
    }

    // pen_chart 이미지 URL 로드 (Supabase storage 경로일 경우 signed URL 필요)
    const penTpl = (data as Template[] | null)?.find((t) => t.form_key === 'pen_chart') ?? BUILTIN_PEN_CHART_TEMPLATE;
    const path = penTpl.template_path;
    if (path?.startsWith('/')) {
      setTemplateImgUrl(path);
    } else if (path) {
      const { data: urlData } = await supabase.storage.from('photos').createSignedUrl(path, 3600);
      if (urlData?.signedUrl) setTemplateImgUrl(urlData.signedUrl);
    }
  }, [clinicId]);

  useEffect(() => {
    loadSavedCharts();
    loadTemplates();
  }, [loadSavedCharts, loadTemplates]);

  // ── 캔버스 초기화 (T-20260522-foot-PENCHART-ERASER-CLARITY) ─────────────
  // 2-layer canvas 구조:
  //   bgCanvasRef (아래) — 양식 배경 이미지 전용. 지우개 미적용.
  //   canvasRef   (위)   — 드로잉 전용 (투명 배경). clearRect 지우개 → bgCanvas 노출.
  // 저장 시 tempCanvas에 bg+draw 합성 후 toDataURL.
  // AC-3: bgCanvas에 imageSmoothingQuality='high' → 양식 이미지 선명도 개선.

  /** 배경 레이어 초기화: 양식 이미지 로드 + 고해상도 렌더링 */
  const initBgCanvas = useCallback(() => {
    const canvas = bgCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const canvasH = getCanvasHeightForForm(activeDrawTemplate?.form_key);

    canvas.width = CANVAS_W * dpr;
    canvas.height = canvasH * dpr;
    canvas.style.width = `${CANVAS_W}px`;
    canvas.style.height = `${canvasH}px`;
    canvas.style.display = 'block';
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, CANVAS_W, canvasH);

    // T-20260519-foot-HEALTH-Q-PEN: 활성 draw 템플릿 배경 우선 사용.
    // health_questionnaire_* + pdf_overlay → 공개 에셋 직접 경로
    // pen_chart → templateImgUrl (public path 또는 Supabase signed URL)
    let bgUrl: string | null = null;
    if (activeDrawTemplate && (isHealthQFormKey(activeDrawTemplate.form_key) || isPdfOverlayFormKey(activeDrawTemplate.form_key))) {
      bgUrl = activeDrawTemplate.template_path ?? null;
    } else {
      bgUrl = templateImgUrl;
    }

    if (bgUrl) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        // AC-3: 고해상도 렌더링 (imageSmoothingQuality=high → 양식 선명도 개선)
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, CANVAS_W, canvasH);
        // T-20260522-foot-PENCHART-REFUND-AUTOFILL:
        // 환불/비급여 동의서에서만 고객 정보 자동채움 (배경 레이어에 포함 → 합성 저장에 반영)
        if (isRefundConsentKey(activeDrawTemplate?.form_key ?? '') && autofillDataRef.current) {
          drawAutofillOnCtx(ctx, autofillDataRef.current);
        }
      };
      img.src = bgUrl;
    }
  }, [templateImgUrl, activeDrawTemplate]);

  /** 드로잉 레이어 초기화: 투명 배경 — 지우개 clearRect → bgCanvas 노출 */
  const initDrawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const canvasH = getCanvasHeightForForm(activeDrawTemplate?.form_key);

    canvas.width = CANVAS_W * dpr;
    canvas.height = canvasH * dpr;
    canvas.style.width = `${CANVAS_W}px`;
    canvas.style.height = `${canvasH}px`;
    ctx.scale(dpr, dpr); // T-20260522-foot-PENCHART-ERASER-CLARITY: dpr=2(iPad/Retina) 드로잉 좌표 오프셋 수정
    // 드로잉 레이어는 투명으로 시작 — fillRect 없음 (지우개 → bgCanvas 노출)
    // ctx.clearRect(0, 0, canvas.width, canvas.height); // canvas.width 리셋 시 자동 클리어
  }, [activeDrawTemplate]);

  const initCanvas = useCallback(() => {
    initBgCanvas();
    initDrawCanvas();
    emptyRef.current = true;
    setHasDrawing(false);
    setBoilerplateMode('idle');
    setPendingBoilerplate('');
    setShowBoilerplatePanel(false);
    // T-20260519-foot-PENCHART-FORM-ADD (FIX): Undo 스택 초기화 (draw 레이어만)
    undoStackRef.current = [];
  }, [initBgCanvas, initDrawCanvas]);

  useEffect(() => {
    if (mode === 'draw') {
      const t = setTimeout(initCanvas, 50);
      return () => clearTimeout(t);
    }
  }, [mode, initCanvas]);

  // ── Undo 저장/복원 ────────────────────────────────────────────────────
  // T-20260519-foot-PENCHART-FORM-ADD (FIX): 각 획 시작 전 상태 저장 (최대 10단계)
  const saveUndoState = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const stack = undoStackRef.current;
    stack.push(imageData);
    if (stack.length > UNDO_LIMIT) stack.shift();
  }, []);

  const handleUndo = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (undoStackRef.current.length === 0) {
      toast('되돌릴 내용이 없습니다', { duration: 1500 });
      return;
    }
    const imageData = undoStackRef.current.pop()!;
    ctx.putImageData(imageData, 0, 0);
    if (undoStackRef.current.length === 0) setHasDrawing(false);
  }, []);

  // ── 포인터 이벤트 ────────────────────────────────────────────────────
  // T-20260522-foot-PENCHART-PEN-OFFSET fix:
  // canvas.width/height는 DPR 포함 물리 픽셀 — dpr로 나눠 논리 픽셀 계산.
  // 이전 CANVAS_H(1020) 하드코딩은 refund_consent(3052px) 등 height 가변 양식에서
  // scaleY ≈ 0.33으로 오산해 터치 위치 대비 위쪽에 드로잉되는 버그 유발.
  const getPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const logicalW = canvas.width / dpr;
    const logicalH = canvas.height / dpr;
    const scaleX = logicalW / rect.width;
    const scaleY = logicalH / rect.height;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  };

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
    lines.forEach((line, i) => { ctx.fillText(line, x, y + i * lineHeight); });
    ctx.restore();
    emptyRef.current = false;
    setHasDrawing(true);
    setBoilerplateMode('idle');
    setPendingBoilerplate('');
    toast.success('상용구 삽입 완료');
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // T-20260522-foot-PENCHART-SCROLL-BLOCK fix (방안 A):
    // touch pointerType은 스크롤 전용 — 드로잉 건너뜀.
    // touchAction:'pan-y' CSS와 함께 이중 방어: touch 이벤트가 도달해도 드로잉 불가.
    if (e.pointerType === 'touch') return;
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const pos = getPos(e);
    if (boilerplateMode === 'placing' && pendingBoilerplate) { placeBoilerplate(pos.x, pos.y); return; }
    // T-20260519-foot-PENCHART-FORM-ADD (FIX): 획 시작 전 Undo 상태 저장
    saveUndoState();
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
    // T-20260522-foot-PENCHART-SCROLL-BLOCK fix: touch=스크롤, pen/mouse=드로잉
    if (e.pointerType === 'touch') return;
    if (boilerplateMode === 'placing') return;
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
    if (canvas && canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  };

  // ── 캔버스 저장 ──────────────────────────────────────────────────────
  const handleDrawSave = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setSaving(true);
    try {
      // T-20260522-foot-PENCHART-ERASER-CLARITY: bg+draw 2-layer 합성 후 toDataURL
      // bgCanvas(배경 양식) + drawCanvas(드로잉 스트로크) 를 tempCanvas에 순서대로 합성
      const bgCanvas = bgCanvasRef.current;
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = canvas.width;   // 물리 픽셀 (CANVAS_W * dpr)
      tempCanvas.height = canvas.height; // 물리 픽셀 (canvasH * dpr)
      const tCtx = tempCanvas.getContext('2d')!;
      if (bgCanvas) tCtx.drawImage(bgCanvas, 0, 0); // 1) 배경 양식
      tCtx.drawImage(canvas, 0, 0);                  // 2) 드로잉 스트로크
      const dataUrl = tempCanvas.toDataURL('image/png');
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      // T-20260519-foot-HEALTH-Q-PEN: health_questionnaire 파일에 'hq_' prefix
      // T-20260520-foot-PENCHART-REFUND-FORM: refund_consent 파일에 'rc_' prefix
      let prefix = '';
      if (activeDrawTemplate && isHealthQFormKey(activeDrawTemplate.form_key)) {
        prefix = `hq_${activeDrawTemplate.form_key === 'health_questionnaire_senior' ? 'sr_' : ''}`;
      } else if (activeDrawTemplate && isRefundConsentKey(activeDrawTemplate.form_key)) {
        prefix = 'rc_';
      }
      const fileName = `${prefix}${Date.now()}_${Math.random().toString(36).slice(2, 6)}.png`;
      const path = `${storagePath}/${fileName}`;
      const { error } = await supabase.storage.from('photos').upload(path, blob, { contentType: 'image/png', upsert: false });
      if (error) { toast.error(`저장 실패: ${error.message}`); return; }

      const isHQ = activeDrawTemplate && isHealthQFormKey(activeDrawTemplate.form_key);
      // isPC = 환불/비급여 동의서 (refund_consent) — form_submissions 자동 연동
      const isPC = activeDrawTemplate && isPdfOverlayFormKey(activeDrawTemplate.form_key);

      // T-20260520-foot-PENCHART-VIEW-SPLIT:
      // health_questionnaire_* 도 form_submissions에 저장 → 상담내역 [내용보기] 연동
      // T-20260520-foot-PENCHART-REFUND-FORM:
      // pdf_overlay 양식 (refund_consent) 은 form_submissions에도 저장 (서명 base64 포함)
      // builtin ID면 template_id FK 미적용 — staffId 없어도 issued_by null 허용(nullable)
      // T-20260521-foot-PENCHART-VIEW-SPLIT-REOPEN BUG FIX:
      // status 'completed'는 form_submissions CHECK constraint('draft','printed','signed','voided') 위반
      // → INSERT 무성 실패 → 상담내역 [내용보기] 버튼 비활성. 'signed'로 통일.
      // T-20260522-foot-PENCHART-VIEW-SPLIT-REOPEN3 ROOT CAUSE FIX:
      // staff 테이블의 user_id가 전부 null → staffId 조회 항상 null → INSERT 블록 진입 불가
      // issued_by 컬럼은 nullable(YES) — staffId 조건 제거하여 INSERT 항상 실행
      if ((isPC || isHQ) && activeDrawTemplate) {
        const signatureBase64 = (isPC && !sigEmpty)
          ? (sigPadRef.current?.toDataURL('image/png') ?? null)
          : null;
        const now = new Date().toISOString();
        const submissionPayload: Record<string, unknown> = {
          clinic_id:   clinicId,
          customer_id: customerId,
          field_data: {
            form_key:         activeDrawTemplate.form_key,
            canvas_file:      fileName,
            signature_base64: signatureBase64,
            saved_at:         now,
          },
          status:     'signed',   // 'completed'는 CHECK constraint 위반 — 'signed'로 통일
          printed_at: now,
          signed_at:  now,        // HQ/PC 모두 signed_at 기록 (상담내역 날짜 표시용)
          ...(staffId ? { issued_by: staffId } : {}),  // nullable — null은 생략
        };
        // template_id: builtin ID는 FK 위반 방지를 위해 포함하지 않음
        if (!activeDrawTemplate.id.startsWith('builtin-')) {
          submissionPayload.template_id = activeDrawTemplate.id;
        }
        if (checkInId) submissionPayload.check_in_id = checkInId;
        const { error: subErr } = await supabase.from('form_submissions').insert(submissionPayload);
        if (subErr) {
          // 저장은 됐으나 상담내역 연동 실패 — 사용자에게 경고
          console.error('form_submissions insert 실패:', subErr.message);
          toast.error(`상담내역 연동 실패: ${subErr.message} (이미지는 저장됨)`);
        } else {
          // T-20260520-foot-PENCHART-VIEW-SPLIT HOTFIX2:
          // INSERT 성공 → 부모(CustomerChartPage)에 즉시 갱신 트리거
          // → 상담내역 탭 [내용보기] 버튼 즉시 활성화 (페이지 새로고침 불필요)
          onFormSubmissionSaved?.();
        }
      }

      toast.success(
        isHQ ? '발건강 질문지 저장 완료 — 상담내역에 연동됐습니다' :
        isPC ? '환불/비급여 동의서 저장 완료 — 상담내역에 연동됐습니다' :
               '펜차트 저장 완료',
      );
      await loadSavedCharts();
      // 서명 초기화
      sigPadRef.current?.clear();
      setSigEmpty(true);
      setActiveDrawTemplate(null);
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

  // ── 상용구 선택 ──────────────────────────────────────────────────────
  const handleBoilerplateSelect = (text: string) => {
    setPendingBoilerplate(text);
    setBoilerplateMode('placing');
    setShowBoilerplatePanel(false);
    setIsEraser(false);
    toast('캔버스를 클릭해 상용구를 삽입하세요', { duration: 2000 });
  };

  // ── 양식 선택 ─────────────────────────────────────────────────────────
  // T-20260520-foot-PENCHART-CHECKLIST-REMOVE: 모든 양식은 draw 모드로 진입
  const handleSelectTemplate = (tpl: Template) => {
    // T-20260520-foot-PENCHART-REFUND-FORM: pdf_overlay 진입 시 서명 패드 초기화
    if (isPdfOverlayFormKey(tpl.form_key)) {
      sigPadRef.current?.clear();
      setSigEmpty(true);
    }
    setActiveDrawTemplate(tpl);
    setMode('draw');
  };

  // ─────────────────────────────────────────────────────────────────────
  // 렌더: select 모드 (양식 선택 패널)
  // T-20260520-foot-PENCHART-FULLSCREEN AC-6/7: 양식 선택 패널도 fullscreen
  // 태블릿 최적화 — 차트 배경 완전 차단, 모든 양식 진입점 동일 UX
  // ─────────────────────────────────────────────────────────────────────
  if (mode === 'select') {
    return (
      <FullscreenFormWrapper
        open={true}
        onOpenChange={(open) => { if (!open) setMode('list'); }}
      >
        <div className="h-full overflow-auto p-4 bg-white">
        <div className="max-w-lg mx-auto space-y-3">
        <div className="rounded-lg border bg-white p-3">
          <div className="flex items-center gap-2 mb-3">
            <button
              onClick={() => setMode('list')}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="h-3.5 w-3.5" /> 목록으로
            </button>
            <span className="text-sm font-bold text-purple-800">양식 선택</span>
          </div>
          <div className="grid gap-3">
            {/* 펜차트 (캔버스 필기) */}
            <button
              onClick={() => handleSelectTemplate(penChartTemplate ?? BUILTIN_PEN_CHART_TEMPLATE)}
              className="flex items-center gap-3 rounded-lg border-2 border-purple-200 bg-purple-50 p-4 text-left hover:border-purple-400 hover:bg-purple-100 transition"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-purple-200">
                <FileText className="h-5 w-5 text-purple-700" />
              </div>
              <div>
                <div className="font-semibold text-purple-800 text-sm">펜차트 양식</div>
                <div className="text-xs text-purple-600 mt-0.5">PDF 양식 위에 태블릿/마우스로 직접 필기</div>
              </div>
            </button>

            {/* T-20260519-foot-HEALTH-Q-PEN: 발건강 질문지 2종 (PDF 캔버스 필기) */}
            {healthQTemplates.map((tpl) => {
              const isSenior = tpl.form_key === 'health_questionnaire_senior';
              return (
                <button
                  key={tpl.id}
                  onClick={() => handleSelectTemplate(tpl)}
                  className={cn(
                    'flex items-center gap-3 rounded-lg border-2 p-4 text-left transition',
                    isSenior
                      ? 'border-emerald-200 bg-emerald-50 hover:border-emerald-400 hover:bg-emerald-100'
                      : 'border-teal-200 bg-teal-50 hover:border-teal-400 hover:bg-teal-100',
                  )}
                >
                  <div className={cn(
                    'flex h-10 w-10 items-center justify-center rounded-full',
                    isSenior ? 'bg-emerald-200' : 'bg-teal-200',
                  )}>
                    <ClipboardList className={cn('h-5 w-5', isSenior ? 'text-emerald-700' : 'text-teal-700')} />
                  </div>
                  <div>
                    <div className={cn('font-semibold text-sm', isSenior ? 'text-emerald-800' : 'text-teal-800')}>
                      {tpl.name_ko}
                    </div>
                    <div className={cn('text-xs mt-0.5', isSenior ? 'text-emerald-600' : 'text-teal-600')}>
                      {isSenior
                        ? '발건강 질문지 (어르신용) — 태블릿펜으로 직접 기입'
                        : '발건강 질문지 — 태블릿펜으로 직접 기입 후 저장'}
                    </div>
                  </div>
                  {isSenior && (
                    <span className="ml-auto rounded-full bg-emerald-200 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                      어르신용
                    </span>
                  )}
                  <span className={cn(
                    'rounded-full px-2 py-0.5 text-[10px] font-bold',
                    isSenior ? 'bg-emerald-100 text-emerald-700' : 'bg-teal-100 text-teal-700',
                    isSenior ? '' : 'ml-auto',
                  )}>
                    PDF 양식
                  </span>
                </button>
              );
            })}

            {/* T-20260520-foot-PENCHART-REFUND-FORM: 환불/비급여 동의서 (3페이지) */}
            {refundConsentTemplate && (
              <button
                onClick={() => handleSelectTemplate(refundConsentTemplate)}
                className="flex items-center gap-3 rounded-lg border-2 border-rose-200 bg-rose-50 p-4 text-left hover:border-rose-400 hover:bg-rose-100 transition"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-rose-200">
                  <FileText className="h-5 w-5 text-rose-700" />
                </div>
                <div>
                  <div className="font-semibold text-rose-800 text-sm">환불/비급여 동의서</div>
                  <div className="text-xs text-rose-600 mt-0.5">환불·비급여 동의 PDF 원본 (3p) — 태블릿펜으로 직접 기입 + 서명</div>
                </div>
                <span className="ml-auto rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700">
                  3페이지
                </span>
              </button>
            )}
          </div>
        </div>
        </div>{/* max-w-lg mx-auto */}
        </div>{/* h-full overflow-auto */}
      </FullscreenFormWrapper>
    );
  }

  // ─────────────────────────────────────────────────────────────────────
  // 렌더: draw 모드 (캔버스 필기)
  // ─────────────────────────────────────────────────────────────────────
  if (mode === 'draw') {
    // T-20260520-foot-PENCHART-FULLSCREEN AC-5~7: FullscreenFormWrapper 공통 래퍼 사용
    return (
      <FullscreenFormWrapper
        open={true}
        onOpenChange={(open) => {
          if (!open) {
            if (hasDrawing && !window.confirm('작성 중인 내용이 사라집니다. 취소하시겠습니까?')) return;
            setActiveDrawTemplate(null);
            setMode('list');
          }
        }}
      >
      <div className="flex flex-col h-full bg-white">
        {/* 툴바 — fullscreen 고정 헤더 (AC-2 태블릿 전체화면) */}
        <div className="flex-none border-b bg-white p-2 flex items-center gap-2 flex-wrap shadow-sm">
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
              {boilerplateMode === 'placing' && <span className="ml-0.5 text-teal-600 animate-pulse">●</span>}
            </button>

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

          {/* T-20260522-foot-PENCHART-REFUND-AUTOFILL: 자동채움 적용 배지 (AC-2) */}
          {activeDrawTemplate && isRefundConsentKey(activeDrawTemplate.form_key) && customerName && (
            <div className="flex items-center gap-1 px-2 py-1 rounded bg-blue-50 border border-blue-200 text-[11px] text-blue-700" title="성명·생년월일·연락처가 양식에 자동 채워졌습니다">
              ✓ 자동채움: {customerName}
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
              type="range" min={1} max={8} step={0.5} value={penSize}
              onChange={(e) => setPenSize(parseFloat(e.target.value))}
              className="w-16"
            />
            <span className="tabular-nums w-4">{penSize}</span>
          </div>

          <div className="ml-auto flex gap-1.5">
            {/* T-20260519-foot-PENCHART-FORM-ADD (FIX): Undo 버튼 (최대 10단계) */}
            <button
              onClick={handleUndo}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs border border-gray-200 hover:bg-gray-50"
              title="되돌리기 (Undo)"
            >
              <Undo2 className="h-3.5 w-3.5" /> 되돌리기
            </button>
            <button
              onClick={initCanvas}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs border border-gray-200 hover:bg-gray-50"
              title="전체 초기화"
            >
              <RotateCcw className="h-3.5 w-3.5" /> 초기화
            </button>
            <Button
              size="sm" variant="outline" className="h-7 text-[11px] px-2"
              onClick={() => {
                if (hasDrawing && !window.confirm('작성 중인 내용이 사라집니다. 취소하시겠습니까?')) return;
                setActiveDrawTemplate(null);
                setMode('list');
              }}
            >
              취소
            </Button>
            <Button
              size="sm"
              className="h-7 text-[11px] px-3 bg-purple-600 hover:bg-purple-700"
              onClick={handleDrawSave}
              disabled={saving}
            >
              <Save className="h-3.5 w-3.5 mr-1" />
              {saving ? '저장 중…' : '저장'}
            </Button>
          </div>
        </div>
        {/* 스크롤 콘텐츠 — 태블릿 전체화면 확대 영역 (AC-2) */}
        <div className="flex-1 overflow-auto p-4 space-y-4">

        {/* 캔버스 — T-20260522-foot-PENCHART-ERASER-CLARITY: 2-layer 스택 */}
        <div className="rounded-lg border bg-white p-2 overflow-x-auto">
          <div className="text-[10px] text-muted-foreground mb-1">
            {/* T-20260519-foot-HEALTH-Q-PEN: 활성 템플릿 이름 표시 */}
            {activeDrawTemplate
              ? `양식: ${activeDrawTemplate.name_ko}`
              : (penChartTemplate ? `템플릿: ${penChartTemplate.name_ko}` : '빈 캔버스 (A4)')}
            {' — 태블릿/마우스로 직접 필기'}
            {boilerplateMode === 'placing' && (
              <span className="ml-2 text-teal-600 font-medium">클릭하여 상용구 삽입</span>
            )}
          </div>
          {/* 2-layer canvas 스택
              Layer 1 bgCanvas(아래): 양식 이미지 전용 — 지우개 미적용
              Layer 2 drawCanvas(위): 드로잉 스트로크 — 투명 배경, clearRect 지우개 → bgCanvas 노출 */}
          <div style={{ position: 'relative', display: 'inline-block', maxWidth: '100%', border: '1px solid #e2e8f0' }}>
            {/* 배경 레이어: 양식 이미지 + imageSmoothingQuality=high — pointer 이벤트 없음 */}
            <canvas
              ref={bgCanvasRef}
              style={{
                display: 'block',
                maxWidth: '100%',
                pointerEvents: 'none',
              }}
            />
            {/* 드로잉 레이어: 투명 배경 — 펜/지우개 포인터 이벤트 수신 */}
            <canvas
              ref={canvasRef}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                // T-20260522-foot-PENCHART-SCROLL-BLOCK fix:
                // 'pan-y': touch 수직 스크롤은 브라우저가 처리 (pointer 이벤트 미전달).
                // pen/mouse 입력은 touch-action 영향 없으므로 드로잉 정상 동작.
                touchAction: 'pan-y',
                cursor: boilerplateMode === 'placing' ? 'text' : isEraser ? 'cell' : 'crosshair',
                display: 'block',
              }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={onPointerUp}
              onPointerCancel={onPointerUp}
            />
          </div>
        </div>

        {/* T-20260519-foot-PENCHART-FORM-ADD (AC-4): pdf_overlay 전용 서명 캡처 패드 */}
        {activeDrawTemplate && isPdfOverlayFormKey(activeDrawTemplate.form_key) && (
          <div className="rounded-lg border bg-white p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-teal-800">
                서명란 (개인정보 동의)
              </span>
              <button
                type="button"
                onClick={() => { sigPadRef.current?.clear(); setSigEmpty(true); }}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition"
              >
                <RotateCcw className="h-3 w-3" /> 서명 지우기
              </button>
            </div>
            <div
              className={cn(
                'rounded border overflow-hidden',
                sigEmpty ? 'border-dashed border-gray-300' : 'border-teal-400',
              )}
            >
              <SignaturePad
                ref={sigPadRef}
                width={460}
                height={130}
                penColor="#1a1a1a"
                className="block"
                onChange={(isEmpty) => setSigEmpty(isEmpty)}
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              {sigEmpty
                ? '고객이 태블릿펜 또는 손가락으로 서명해주세요 (선택)'
                : '✓ 서명 완료 — 저장 시 자동 포함됩니다'}
            </p>
          </div>
        )}
        </div>{/* end 스크롤 콘텐츠 */}
      </div>
      </FullscreenFormWrapper>
    );
  }

  // ─────────────────────────────────────────────────────────────────────
  // 렌더: list 모드 (저장된 차트 목록)
  // ─────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-3">
      <div className="rounded-lg border bg-white p-3 text-xs">
        <div className="flex items-center justify-between mb-3">
          <span className="flex items-center gap-1.5 font-bold text-purple-800">
            <span className="h-2 w-2 rounded-full bg-purple-500" />
            펜차트 — 양식 작성
          </span>
          <Button
            size="sm"
            className="h-7 text-[11px] px-3 bg-purple-600 hover:bg-purple-700"
            onClick={() => setMode('select')}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            새 차트 작성
          </Button>
        </div>

        {/* 양식 종류 뱃지 */}
        <div className="mb-2 flex flex-wrap gap-1.5">
          <span className="rounded bg-purple-50 border border-purple-100 px-2 py-0.5 text-[11px] text-purple-700">
            📝 펜차트 (필기)
          </span>
          <span className="rounded bg-teal-50 border border-teal-100 px-2 py-0.5 text-[11px] text-teal-700">
            📋 발건강 질문지 (일반)
          </span>
          <span className="rounded bg-emerald-50 border border-emerald-100 px-2 py-0.5 text-[11px] text-emerald-700">
            📋 발건강 질문지 (어르신용)
          </span>
          {/* T-20260520-foot-PENCHART-REFUND-FORM */}
          <span className="rounded bg-rose-50 border border-rose-100 px-2 py-0.5 text-[11px] text-rose-700">
            📋 환불/비급여 동의서 (3p)
          </span>
        </div>

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
                    {chart.uploadedAt ? format(new Date(chart.uploadedAt), 'MM-dd HH:mm') : chart.name}
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
            <button onClick={() => setSelectedChart(null)} className="text-xs text-muted-foreground hover:text-foreground">
              닫기
            </button>
          </div>
          <img src={selectedChart.url} alt="펜차트" className="w-full rounded border" />
        </div>
      )}
    </div>
  );
}
