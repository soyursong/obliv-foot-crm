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
 * T-20260522-foot-PENCHART-TOOLS-V2:
 *   AC-1: 배경 캔버스를 원본 이미지 natural 해상도로 렌더 → 화질 개선
 *   AC-2: getCoalescedEvents() 활용 → 태블릿 펜 획 누락·지연 개선
 *   AC-3: [T] 텍스트 도구 — 탭 위치 키보드 입력 후 캔버스 삽입
 *   AC-5: 형광펜 도구 — 반투명 두꺼운 선, 지우개 호환
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
  BookOpen, ClipboardList, Download, Eraser, Highlighter, Pencil, Plus, RotateCcw,
  Save, Trash2, Type, X, ChevronLeft, FileText, Undo2, TextCursorInput,
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

// [환자 동의서] 섹션 (page 3, ≈ y 2650–2760) 자동채움 좌표 (기준: CANVAS_W=720)
const REFUND_AUTOFILL_POS: Array<{ key: keyof AutofillFields; x: number; y: number }> = [
  { key: 'date',      x: 476, y: 2662 },
  { key: 'name',      x: 110, y: 2706 },
  { key: 'birthDate', x: 290, y: 2706 },
  { key: 'phone',     x: 110, y: 2748 },
];

/**
 * T-20260522-foot-PENCHART-TOOLS-V2 AC-1:
 * scaleX/scaleY — bg canvas가 naturalWidth×naturalHeight 기준일 때 좌표 보정
 */
function drawAutofillOnCtx(
  ctx: CanvasRenderingContext2D,
  fields: AutofillFields,
  scaleX = 1,
  scaleY = 1,
) {
  ctx.save();
  ctx.fillStyle = '#6b7280'; // gray-500 — 수기 입력과 시각적 구분
  ctx.font = `italic ${Math.round(15 * scaleY)}px "Malgun Gothic", "Apple SD Gothic Neo", sans-serif`;
  ctx.textBaseline = 'top';
  for (const { key, x, y } of REFUND_AUTOFILL_POS) {
    const val = fields[key];
    if (val) ctx.fillText(val, x * scaleX, y * scaleY);
  }
  ctx.restore();
}

const PEN_COLORS = [
  { label: '검정', value: '#1a1a1a' },
  { label: '파랑', value: '#1d4ed8' },
  { label: '빨강', value: '#dc2626' },
  { label: '초록', value: '#16a34a' },
];

// T-20260522-foot-PENCHART-TOOLS-V2 AC-5: 형광펜 색상
const HIGHLIGHT_COLORS = [
  { label: '노랑', value: '#fde047' },
  { label: '분홍', value: '#f9a8d4' },
  { label: '하늘', value: '#67e8f9' },
  { label: '연두', value: '#86efac' },
];

// T-20260522-foot-PENCHART-TOOLS-V2: 도구 모드 통합 타입
// boilerplate-placing: 상용구 삽입 대기 (캔버스 클릭 시 상용구 배치)
type ActiveTool = 'pen' | 'eraser' | 'text' | 'highlight' | 'boilerplate-placing';

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
  // T-20260522-foot-PENCHART-TOOLS-V2: 통합 도구 상태 (pen/eraser/text/highlight/boilerplate-placing)
  const [activeTool, setActiveTool] = useState<ActiveTool>('pen');
  // T-20260522-foot-PENCHART-TOOLS-V2 AC-5: 형광펜 색상
  const [highlightColor, setHighlightColor] = useState('#fde047');
  const [saving, setSaving] = useState(false);
  const [hasDrawing, setHasDrawing] = useState(false);
  const [selectedChart, setSelectedChart] = useState<SavedChart | null>(null);

  // 상용구 상태
  const [pendingBoilerplate, setPendingBoilerplate] = useState<string>('');
  const [showBoilerplatePanel, setShowBoilerplatePanel] = useState(false);

  // T-20260522-foot-PENCHART-PHRASE: phrase_templates DB 연동 상태
  const [phraseTemplates, setPhraseTemplates] = useState<Array<{
    id: number; category: string; name: string; content: string;
  }>>([]);
  const [phraseTemplatesLoaded, setPhraseTemplatesLoaded] = useState(false);
  const [showPhrasePanel, setShowPhrasePanel] = useState(false);
  const [phraseCategory, setPhraseCategory] = useState<string>('charting');

  // T-20260522-foot-PENCHART-TOOLS-V2 AC-3: 텍스트 도구 상태
  const [textInputPos, setTextInputPos] = useState<{
    x: number;     // 캔버스 논리 좌표 (fillText 위치)
    y: number;
    cssX: number;  // CSS 픽셀 좌표 (오버레이 표시 위치)
    cssY: number;
  } | null>(null);
  const [textInputValue, setTextInputValue] = useState('');
  const textAreaRef = useRef<HTMLTextAreaElement>(null);

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
  const loadTemplates = useCallback(async () => {
    const { data } = await supabase
      .from('form_templates')
      .select('id, name_ko, template_path, template_format, form_key')
      .eq('clinic_id', clinicId)
      .in('form_key', [
        'pen_chart',
        'health_questionnaire_general', 'health_questionnaire_senior',
        'refund_consent',
      ])
      .eq('active', true)
      .order('sort_order', { ascending: true });

    if (data) {
      const penChart = (data as Template[]).find((t) => t.form_key === 'pen_chart');
      const healthQs  = (data as Template[]).filter((t) => t.form_key.startsWith('health_questionnaire_'));
      const refundConsent = (data as Template[]).find((t) => t.form_key === 'refund_consent');
      setPenChartTemplate(penChart ?? BUILTIN_PEN_CHART_TEMPLATE);
      setHealthQTemplates(healthQs.length > 0 ? healthQs : [BUILTIN_HEALTH_Q_GENERAL, BUILTIN_HEALTH_Q_SENIOR]);
      setRefundConsentTemplate(refundConsent ?? BUILTIN_REFUND_CONSENT);
    } else {
      setPenChartTemplate(BUILTIN_PEN_CHART_TEMPLATE);
      setHealthQTemplates([BUILTIN_HEALTH_Q_GENERAL, BUILTIN_HEALTH_Q_SENIOR]);
      setRefundConsentTemplate(BUILTIN_REFUND_CONSENT);
    }

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

  // ── 캔버스 초기화 ─────────────────────────────────────────────────────
  // 2-layer canvas 구조:
  //   bgCanvasRef (아래) — 양식 배경 이미지 전용. 지우개 미적용.
  //   canvasRef   (위)   — 드로잉 전용 (투명 배경). clearRect 지우개 → bgCanvas 노출.
  //
  // T-20260522-foot-PENCHART-TOOLS-V2 AC-1:
  //   bgCanvas는 이미지 naturalWidth×naturalHeight 그대로 렌더 (CSS로 CANVAS_W×canvasH에 표시)
  //   → 원본 해상도 보존으로 화질 개선. 저장 시 bg 기준 해상도로 합성.

  /** 배경 레이어 초기화: 양식 이미지 natural 해상도로 렌더 */
  const initBgCanvas = useCallback(() => {
    const canvas = bgCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const canvasH = getCanvasHeightForForm(activeDrawTemplate?.form_key);

    // 초기값: CSS display size 기준 (이미지 로드 전 레이아웃 확정)
    canvas.width = CANVAS_W;
    canvas.height = canvasH;
    canvas.style.width = `${CANVAS_W}px`;
    canvas.style.height = `${canvasH}px`;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, CANVAS_W, canvasH);

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
        // AC-1: 이미지 natural 해상도로 bg 캔버스 설정 (CSS는 CANVAS_W×canvasH 유지)
        const nw = img.naturalWidth || CANVAS_W;
        const nh = img.naturalHeight || canvasH;
        canvas.width = nw;
        canvas.height = nh;
        canvas.style.width = `${CANVAS_W}px`;
        canvas.style.height = `${canvasH}px`;
        // AC-1: 1:1 픽셀 렌더링 — 보간 없이 원본 해상도 그대로
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, 0, 0, nw, nh);
        // 자동채움: 좌표를 naturalWidth/CANVAS_W 비율로 스케일
        if (isRefundConsentKey(activeDrawTemplate?.form_key ?? '') && autofillDataRef.current) {
          const scaleX = nw / CANVAS_W;
          const scaleY = nh / canvasH;
          drawAutofillOnCtx(ctx, autofillDataRef.current, scaleX, scaleY);
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
    ctx.scale(dpr, dpr);
    // 드로잉 레이어는 투명으로 시작 — fillRect 없음
  }, [activeDrawTemplate]);

  const initCanvas = useCallback(() => {
    initBgCanvas();
    initDrawCanvas();
    emptyRef.current = true;
    setHasDrawing(false);
    setActiveTool('pen');
    setPendingBoilerplate('');
    setShowBoilerplatePanel(false);
    setShowPhrasePanel(false);
    setTextInputPos(null);
    setTextInputValue('');
    undoStackRef.current = [];
  }, [initBgCanvas, initDrawCanvas]);

  useEffect(() => {
    if (mode === 'draw') {
      const t = setTimeout(initCanvas, 50);
      return () => clearTimeout(t);
    }
  }, [mode, initCanvas]);

  // T-20260522-foot-PENCHART-PHRASE: phrase_templates 로드 (draw 진입 시 1회)
  useEffect(() => {
    if (mode !== 'draw' || phraseTemplatesLoaded) return;
    supabase
      .from('phrase_templates')
      .select('id, category, name, content')
      .eq('is_active', true)
      .order('sort_order')
      .then(({ data }) => {
        setPhraseTemplates(data ?? []);
        setPhraseTemplatesLoaded(true);
      });
  }, [mode, phraseTemplatesLoaded]);

  // ── Undo 저장/복원 ────────────────────────────────────────────────────
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

  // ── 포인터 좌표 계산 ─────────────────────────────────────────────────
  // getPos: React 합성 이벤트 → 논리 좌표 + CSS 좌표 (text overlay 위치용)
  const getPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0, cssX: 0, cssY: 0 };
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const logicalW = canvas.width / dpr;
    const logicalH = canvas.height / dpr;
    const scaleX = logicalW / rect.width;
    const scaleY = logicalH / rect.height;
    const cssX = e.clientX - rect.left;
    const cssY = e.clientY - rect.top;
    return { x: cssX * scaleX, y: cssY * scaleY, cssX, cssY };
  };

  // ── 상용구 배치 ──────────────────────────────────────────────────────
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
    ctx.globalAlpha = 1;
    const lineHeight = penSize * 4 + 12;
    lines.forEach((line, i) => { ctx.fillText(line, x, y + i * lineHeight); });
    ctx.restore();
    emptyRef.current = false;
    setHasDrawing(true);
    setActiveTool('pen');
    setPendingBoilerplate('');
    toast.success('상용구 삽입 완료');
  };

  // T-20260522-foot-PENCHART-TOOLS-V2 AC-3: 텍스트 도구 — 캔버스에 삽입
  const handleTextConfirm = useCallback(() => {
    if (!textInputValue.trim() || !textInputPos) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    saveUndoState();
    const lines = textInputValue.split('\n');
    ctx.save();
    ctx.font = `${penSize * 4 + 6}px 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif`;
    ctx.fillStyle = penColor;
    ctx.textBaseline = 'top';
    ctx.globalAlpha = 1;
    const lineHeight = penSize * 4 + 12;
    lines.forEach((line, i) => {
      ctx.fillText(line, textInputPos.x, textInputPos.y + i * lineHeight);
    });
    ctx.restore();
    emptyRef.current = false;
    setHasDrawing(true);
    setTextInputPos(null);
    setTextInputValue('');
    toast.success('텍스트 삽입 완료');
  }, [textInputValue, textInputPos, penSize, penColor, saveUndoState]);

  // ── 포인터 이벤트 ────────────────────────────────────────────────────
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // touch → 스크롤 전용 (draw 건너뜀)
    if (e.pointerType === 'touch') return;
    e.preventDefault();
    e.stopPropagation();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const pos = getPos(e);

    // 상용구 배치 모드
    if (activeTool === 'boilerplate-placing' && pendingBoilerplate) {
      saveUndoState();
      placeBoilerplate(pos.x, pos.y);
      return;
    }

    // T-20260522-foot-PENCHART-TOOLS-V2 AC-3: 텍스트 도구
    if (activeTool === 'text') {
      // 기존 입력창이 열려있으면 닫기
      if (textInputPos) { setTextInputPos(null); setTextInputValue(''); return; }
      setTextInputPos({ x: pos.x, y: pos.y, cssX: pos.cssX, cssY: pos.cssY });
      setTextInputValue('');
      // textarea는 textAreaRef로 autoFocus 처리됨
      return;
    }

    saveUndoState();
    canvas.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    lastPosRef.current = { x: pos.x, y: pos.y };
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (activeTool === 'eraser') {
      const sz = penSize * 4;
      ctx.clearRect(pos.x - sz, pos.y - sz, sz * 2, sz * 2);
    } else if (activeTool === 'highlight') {
      // 탭(클릭)에도 점 찍기
      ctx.beginPath();
      const r = Math.max(penSize * 3 + 3, 4);
      ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = highlightColor;
      ctx.fill();
      ctx.globalAlpha = 1;
      emptyRef.current = false;
      setHasDrawing(true);
    } else {
      // pen
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, penSize * 0.5, 0, Math.PI * 2);
      ctx.globalAlpha = 1;
      ctx.fillStyle = penColor;
      ctx.fill();
      emptyRef.current = false;
      setHasDrawing(true);
    }
  };

  // T-20260522-foot-PENCHART-TOOLS-V2 AC-2: getCoalescedEvents() 활용
  // 프레임 사이 중간 포인터 위치를 모두 수집 → 빠른 펜 동작에서 획 누락 방지
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'touch') return;
    if (activeTool === 'text' || activeTool === 'boilerplate-placing') return;
    if (!drawingRef.current) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // rect 1회 계산 후 모든 coalesced events에 재사용
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const scaleX = (canvas.width / dpr) / rect.width;
    const scaleY = (canvas.height / dpr) / rect.height;
    const toLogical = (ev: PointerEvent) => ({
      x: (ev.clientX - rect.left) * scaleX,
      y: (ev.clientY - rect.top)  * scaleY,
    });

    // AC-2: coalesced events — 중간 좌표 모두 처리
    const events: PointerEvent[] = (e.nativeEvent as any).getCoalescedEvents?.() ?? [e.nativeEvent];

    for (const evt of events) {
      const pos = toLogical(evt);
      const last = lastPosRef.current ?? pos;

      if (activeTool === 'eraser') {
        const sz = penSize * 4;
        ctx.clearRect(pos.x - sz, pos.y - sz, sz * 2, sz * 2);
      } else if (activeTool === 'highlight') {
        ctx.beginPath();
        ctx.moveTo(last.x, last.y);
        ctx.lineTo(pos.x, pos.y);
        ctx.globalAlpha = 0.35;
        ctx.strokeStyle = highlightColor;
        ctx.lineWidth = penSize * 6 + 6;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
        ctx.globalAlpha = 1;
        emptyRef.current = false;
        setHasDrawing(true);
      } else {
        // pen
        ctx.beginPath();
        ctx.moveTo(last.x, last.y);
        ctx.lineTo(pos.x, pos.y);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = penColor;
        ctx.lineWidth = penSize;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
        emptyRef.current = false;
        setHasDrawing(true);
      }
      lastPosRef.current = pos;
    }
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
      // T-20260522-foot-PENCHART-TOOLS-V2 AC-1: bg natural 해상도 기준으로 합성
      // bg canvas: naturalWidth × naturalHeight (원본 해상도)
      // draw canvas: CANVAS_W*dpr × canvasH*dpr (DPR 스케일)
      // → temp canvas를 bg 해상도에 맞추고 draw를 스케일해 올림
      const bgCanvas = bgCanvasRef.current;
      const tempCanvas = document.createElement('canvas');

      if (bgCanvas && bgCanvas.width > 0 && bgCanvas.height > 0) {
        // bg 원본 해상도로 저장 (최고 화질)
        tempCanvas.width  = bgCanvas.width;
        tempCanvas.height = bgCanvas.height;
        const tCtx = tempCanvas.getContext('2d')!;
        tCtx.drawImage(bgCanvas, 0, 0);                                        // 배경 (원본 해상도)
        tCtx.drawImage(canvas, 0, 0, bgCanvas.width, bgCanvas.height);         // 드로잉 (bg 크기에 맞게 스케일)
      } else {
        // bg 없을 경우 draw canvas 물리 픽셀 기준
        tempCanvas.width  = canvas.width;
        tempCanvas.height = canvas.height;
        const tCtx = tempCanvas.getContext('2d')!;
        tCtx.drawImage(canvas, 0, 0);
      }

      const dataUrl = tempCanvas.toDataURL('image/png');
      const res = await fetch(dataUrl);
      const blob = await res.blob();

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
      const isPC = activeDrawTemplate && isPdfOverlayFormKey(activeDrawTemplate.form_key);

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
          status:     'signed',
          printed_at: now,
          signed_at:  now,
          ...(staffId ? { issued_by: staffId } : {}),
        };
        if (!activeDrawTemplate.id.startsWith('builtin-')) {
          submissionPayload.template_id = activeDrawTemplate.id;
        }
        if (checkInId) submissionPayload.check_in_id = checkInId;
        const { error: subErr } = await supabase.from('form_submissions').insert(submissionPayload);
        if (subErr) {
          console.error('form_submissions insert 실패:', subErr.message);
          toast.error(`상담내역 연동 실패: ${subErr.message} (이미지는 저장됨)`);
        } else {
          onFormSubmissionSaved?.();
        }
      }

      toast.success(
        isHQ ? '발건강 질문지 저장 완료 — 상담내역에 연동됐습니다' :
        isPC ? '환불/비급여 동의서 저장 완료 — 상담내역에 연동됐습니다' :
               '펜차트 저장 완료',
      );
      await loadSavedCharts();
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
    setActiveTool('boilerplate-placing');
    setShowBoilerplatePanel(false);
    setTextInputPos(null);
    toast('캔버스를 클릭해 상용구를 삽입하세요', { duration: 2000 });
  };

  // ── 양식 선택 ─────────────────────────────────────────────────────────
  const handleSelectTemplate = (tpl: Template) => {
    if (isPdfOverlayFormKey(tpl.form_key)) {
      sigPadRef.current?.clear();
      setSigEmpty(true);
    }
    setActiveDrawTemplate(tpl);
    setMode('draw');
  };

  // ─────────────────────────────────────────────────────────────────────
  // 렌더: select 모드 (양식 선택 패널)
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

            {/* 발건강 질문지 2종 */}
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

            {/* 환불/비급여 동의서 */}
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
        </div>
        </div>
      </FullscreenFormWrapper>
    );
  }

  // ─────────────────────────────────────────────────────────────────────
  // 렌더: draw 모드 (캔버스 필기)
  // ─────────────────────────────────────────────────────────────────────
  if (mode === 'draw') {
    const canvasH = getCanvasHeightForForm(activeDrawTemplate?.form_key);
    const isEraser    = activeTool === 'eraser';
    const isHighlight = activeTool === 'highlight';
    const isTextTool  = activeTool === 'text';
    const isBoilerplatePlacing = activeTool === 'boilerplate-placing';

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
        {/* 툴바 */}
        <div className="flex-none border-b bg-white p-2 flex items-center gap-1.5 flex-wrap shadow-sm">
          {/* ── 기본 도구 ── */}
          {/* 펜 */}
          <button
            onClick={() => { setActiveTool('pen'); setShowBoilerplatePanel(false); setShowPhrasePanel(false); setTextInputPos(null); }}
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded text-xs border transition',
              activeTool === 'pen'
                ? 'bg-purple-100 border-purple-400 text-purple-700'
                : 'bg-white border-gray-200 text-muted-foreground hover:bg-gray-50',
            )}
          >
            <Pencil className="h-3.5 w-3.5" /> 펜
          </button>

          {/* 지우개 */}
          <button
            onClick={() => { setActiveTool('eraser'); setShowBoilerplatePanel(false); setShowPhrasePanel(false); setTextInputPos(null); }}
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded text-xs border transition',
              isEraser ? 'bg-orange-100 border-orange-400 text-orange-700' : 'bg-white border-gray-200 text-muted-foreground hover:bg-gray-50',
            )}
          >
            <Eraser className="h-3.5 w-3.5" /> 지우개
          </button>

          {/* T-20260522-foot-PENCHART-TOOLS-V2 AC-3: 텍스트 도구 */}
          <button
            onClick={() => {
              setActiveTool(isTextTool ? 'pen' : 'text');
              setShowBoilerplatePanel(false);
              setShowPhrasePanel(false);
              setTextInputPos(null);
            }}
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded text-xs border transition',
              isTextTool
                ? 'bg-blue-100 border-blue-400 text-blue-700'
                : 'bg-white border-gray-200 text-muted-foreground hover:bg-gray-50',
            )}
            title="텍스트 도구 — 캔버스를 클릭해 타자 입력"
          >
            <TextCursorInput className="h-3.5 w-3.5" />
            <span>텍스트</span>
            {isTextTool && <span className="ml-0.5 text-blue-600 animate-pulse">●</span>}
          </button>

          {/* T-20260522-foot-PENCHART-TOOLS-V2 AC-5: 형광펜 도구 */}
          <button
            onClick={() => {
              setActiveTool(isHighlight ? 'pen' : 'highlight');
              setShowBoilerplatePanel(false);
              setShowPhrasePanel(false);
              setTextInputPos(null);
            }}
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded text-xs border transition',
              isHighlight
                ? 'bg-yellow-100 border-yellow-400 text-yellow-700'
                : 'bg-white border-gray-200 text-muted-foreground hover:bg-gray-50',
            )}
            title="형광펜 — 반투명 두꺼운 선 (지우개로 지울 수 있음)"
          >
            <Highlighter className="h-3.5 w-3.5" />
            <span>형광펜</span>
          </button>

          {/* 형광펜 색상 선택 (형광펜 모드일 때만 표시) */}
          {isHighlight && (
            <div className="flex items-center gap-1 pl-1 border-l border-gray-200">
              {HIGHLIGHT_COLORS.map((c) => (
                <button
                  key={c.value}
                  onClick={() => setHighlightColor(c.value)}
                  className={cn(
                    'h-5 w-5 rounded border-2 transition',
                    highlightColor === c.value ? 'border-gray-600 scale-125' : 'border-transparent hover:border-gray-400',
                  )}
                  style={{ backgroundColor: c.value }}
                  title={c.label}
                />
              ))}
            </div>
          )}

          {/* 상용구 버튼 */}
          <div className="relative">
            <button
              onClick={() => {
                setShowBoilerplatePanel(!showBoilerplatePanel);
                setShowPhrasePanel(false);
                setTextInputPos(null);
              }}
              className={cn(
                'flex items-center gap-1 px-2 py-1 rounded text-xs border transition',
                isBoilerplatePlacing || showBoilerplatePanel
                  ? 'bg-teal-100 border-teal-400 text-teal-700'
                  : 'bg-white border-gray-200 text-muted-foreground hover:bg-gray-50',
              )}
            >
              <Type className="h-3.5 w-3.5" /> 상용구
              {isBoilerplatePlacing && <span className="ml-0.5 text-teal-600 animate-pulse">●</span>}
            </button>

            {showBoilerplatePanel && (
              <div className="absolute top-8 left-0 z-20 w-52 rounded-lg border bg-white shadow-lg overflow-hidden">
                <div className="flex items-center justify-between px-2 py-1.5 bg-teal-50 border-b">
                  <span className="text-[11px] font-bold text-teal-800">상용구 선택</span>
                  <button
                    onClick={() => { setShowBoilerplatePanel(false); if (activeTool === 'boilerplate-placing') setActiveTool('pen'); }}
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

          {/* T-20260522-foot-PENCHART-PHRASE: 상용구 불러오기 — phrase_templates DB 연동 */}
          <div className="relative">
            <button
              onClick={() => {
                setShowPhrasePanel(!showPhrasePanel);
                setShowBoilerplatePanel(false);
                setTextInputPos(null);
              }}
              className={cn(
                'flex items-center gap-1 px-2 py-1 rounded text-xs border transition',
                showPhrasePanel
                  ? 'bg-emerald-100 border-emerald-400 text-emerald-700'
                  : 'bg-white border-gray-200 text-muted-foreground hover:bg-gray-50',
              )}
              title="어드민 등록 상용구 불러오기 (phrase_templates)"
              data-testid="phrase-library-btn"
            >
              <BookOpen className="h-3.5 w-3.5" />
              <span>불러오기</span>
            </button>

            {showPhrasePanel && (
              <div
                className="absolute top-8 left-0 z-20 w-64 rounded-lg border bg-white shadow-lg overflow-hidden"
                data-testid="phrase-library-panel"
              >
                {/* 헤더 */}
                <div className="flex items-center justify-between px-2 py-1.5 bg-emerald-50 border-b">
                  <span className="text-[11px] font-bold text-emerald-800">상용구 불러오기</span>
                  <button
                    onClick={() => setShowPhrasePanel(false)}
                    className="text-emerald-500 hover:text-emerald-700"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* AC-4: 사이드 메뉴 스타일 카테고리 + 목록 2-컬럼 레이아웃 */}
                {/* AC-3: document '서류' → '원장님' */}
                <div className="flex" data-testid="phrase-category-tabs">
                  {/* 좌: 카테고리 사이드 메뉴 */}
                  <div className="w-[58px] flex-shrink-0 border-r bg-gray-50 flex flex-col">
                    {(
                      [
                        { key: 'charting',     label: '차팅' },
                        { key: 'prescription', label: '처방' },
                        { key: 'document',     label: '원장님' },
                        { key: 'general',      label: '일반' },
                      ] as const
                    ).map(({ key, label }) => {
                      const cnt = phraseTemplates.filter((p) => p.category === key).length;
                      return (
                        <button
                          key={key}
                          onClick={() => setPhraseCategory(key)}
                          className={cn(
                            'flex flex-col items-center gap-0.5 px-1 py-2 text-center border-b border-gray-100 last:border-0 transition',
                            phraseCategory === key
                              ? 'bg-emerald-50 text-emerald-700 font-semibold border-l-2 border-l-emerald-500'
                              : 'text-muted-foreground hover:bg-gray-100',
                          )}
                          data-testid={`phrase-cat-${key}`}
                        >
                          <span className="text-[10px] leading-tight break-keep">{label}</span>
                          <span className="text-[9px] tabular-nums text-muted-foreground/60">{cnt}</span>
                        </button>
                      );
                    })}
                  </div>

                  {/* 우: 상용구 목록 (AC-2: 컴팩트) */}
                  <div className="flex-1 min-w-0 max-h-56 overflow-y-auto" data-testid="phrase-list">
                    {phraseTemplates.filter((p) => p.category === phraseCategory).length === 0 ? (
                      <div
                        className="flex flex-col items-center justify-center py-6 text-[11px] text-muted-foreground"
                        data-testid="phrase-empty-state"
                      >
                        <Type className="h-5 w-5 mb-1.5 opacity-30" />
                        <span>등록된 상용구가 없습니다</span>
                        <span className="text-[10px] mt-0.5 text-gray-400">어드민 &gt; 상용구에서 추가하세요</span>
                      </div>
                    ) : (
                      phraseTemplates
                        .filter((p) => p.category === phraseCategory)
                        .map((phrase) => (
                          <button
                            key={phrase.id}
                            onClick={() => {
                              handleBoilerplateSelect(phrase.content);
                              setShowPhrasePanel(false);
                            }}
                            className="w-full text-left px-2.5 py-1.5 text-[11px] hover:bg-emerald-50 border-b border-gray-100 last:border-0 transition"
                            data-testid={`phrase-item-${phrase.id}`}
                          >
                            <div className="font-medium text-gray-800 truncate">{phrase.name}</div>
                            <div className="text-gray-400 mt-0.5 text-[10px] truncate">
                              {phrase.content.split('\n')[0]}
                            </div>
                          </button>
                        ))
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 상용구 배치 안내 */}
          {isBoilerplatePlacing && (
            <div className="flex items-center gap-1 px-2 py-1 rounded bg-teal-50 border border-teal-300 text-[11px] text-teal-700">
              <span className="animate-pulse">●</span>
              캔버스 클릭해 삽입
              <button
                onClick={() => { setActiveTool('pen'); setPendingBoilerplate(''); }}
                className="ml-1 text-teal-400 hover:text-teal-700"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}

          {/* 텍스트 도구 안내 */}
          {isTextTool && !textInputPos && (
            <div className="flex items-center gap-1 px-2 py-1 rounded bg-blue-50 border border-blue-300 text-[11px] text-blue-700">
              <span className="animate-pulse">●</span>
              캔버스를 클릭해 텍스트 입력
            </div>
          )}

          {/* 자동채움 배지 */}
          {activeDrawTemplate && isRefundConsentKey(activeDrawTemplate.form_key) && customerName && (
            <div className="flex items-center gap-1 px-2 py-1 rounded bg-blue-50 border border-blue-200 text-[11px] text-blue-700" title="성명·생년월일·연락처가 양식에 자동 채워졌습니다">
              ✓ 자동채움: {customerName}
            </div>
          )}

          {/* ── 펜 색상 (펜/상용구/텍스트 모드) ── */}
          {(activeTool === 'pen' || activeTool === 'text' || activeTool === 'boilerplate-placing') && (
            <div className="flex items-center gap-1">
              {PEN_COLORS.map((c) => (
                <button
                  key={c.value}
                  onClick={() => setPenColor(c.value)}
                  className={cn(
                    'h-5 w-5 rounded-full border-2 transition',
                    penColor === c.value ? 'border-gray-600 scale-110' : 'border-transparent hover:border-gray-400',
                  )}
                  style={{ backgroundColor: c.value }}
                  title={c.label}
                />
              ))}
            </div>
          )}

          {/* 굵기 슬라이더 */}
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
            {/* Undo */}
            <button
              onClick={handleUndo}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs border border-gray-200 hover:bg-gray-50"
              title="되돌리기 (Undo)"
            >
              <Undo2 className="h-3.5 w-3.5" /> 되돌리기
            </button>
            {/* 초기화 */}
            <button
              onClick={initCanvas}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs border border-gray-200 hover:bg-gray-50"
              title="전체 초기화"
            >
              <RotateCcw className="h-3.5 w-3.5" /> 초기화
            </button>
            {/* 취소 */}
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
            {/* 저장 */}
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

        {/* 스크롤 콘텐츠 */}
        <div className="flex-1 overflow-auto p-4 space-y-4">

        {/* 캔버스 — 2-layer 스택 */}
        <div className="rounded-lg border bg-white p-2 overflow-x-auto">
          <div className="text-[10px] text-muted-foreground mb-1">
            {activeDrawTemplate
              ? `양식: ${activeDrawTemplate.name_ko}`
              : (penChartTemplate ? `템플릿: ${penChartTemplate.name_ko}` : '빈 캔버스 (A4)')}
            {' — 태블릿/마우스로 직접 필기'}
            {isBoilerplatePlacing && (
              <span className="ml-2 text-teal-600 font-medium">클릭하여 상용구 삽입</span>
            )}
            {isTextTool && (
              <span className="ml-2 text-blue-600 font-medium">클릭하여 텍스트 입력 위치 지정</span>
            )}
          </div>

          {/* canvas container — position:relative 로 text overlay 포함 */}
          <div
            style={{ position: 'relative', display: 'inline-block', maxWidth: '100%', border: '1px solid #e2e8f0' }}
          >
            {/* 배경 레이어: natural 해상도 이미지 — pointer 이벤트 없음 */}
            <canvas
              ref={bgCanvasRef}
              style={{
                display: 'block',
                maxWidth: '100%',
                pointerEvents: 'none',
                // AC-1: CSS downscale → GPU 고품질 보간
                imageRendering: 'auto',
              }}
            />
            {/* 드로잉 레이어: 투명 배경 */}
            <canvas
              ref={canvasRef}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                maxWidth: '100%',
                touchAction: 'pan-y',
                cursor: isBoilerplatePlacing ? 'text' : isTextTool ? 'text' : isEraser ? 'cell' : isHighlight ? 'crosshair' : 'crosshair',
                display: 'block',
              }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={onPointerUp}
              onPointerCancel={onPointerUp}
            />

            {/* T-20260522-foot-PENCHART-TOOLS-V2 AC-3: 텍스트 입력 오버레이 */}
            {textInputPos && (
              <div
                style={{
                  position: 'absolute',
                  left: Math.min(textInputPos.cssX, CANVAS_W - 220),
                  top: Math.min(textInputPos.cssY, canvasH - 140),
                  zIndex: 30,
                  background: 'white',
                  border: '2px solid #7c3aed',
                  borderRadius: 8,
                  padding: 8,
                  boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
                  minWidth: 210,
                  pointerEvents: 'all',
                }}
                onPointerDown={(e) => e.stopPropagation()} // 오버레이 클릭이 캔버스로 전파되지 않도록
              >
                <div className="text-[11px] text-purple-700 font-semibold mb-1.5 flex items-center gap-1">
                  <TextCursorInput className="h-3 w-3" /> 텍스트 입력
                </div>
                <textarea
                  ref={textAreaRef}
                  autoFocus
                  rows={3}
                  value={textInputValue}
                  onChange={(e) => setTextInputValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleTextConfirm(); }
                    if (e.key === 'Escape') { setTextInputPos(null); setTextInputValue(''); }
                  }}
                  placeholder={'텍스트 입력\n(Enter: 삽입 / Shift+Enter: 줄바꿈)'}
                  className="w-full resize-none text-xs border border-gray-200 rounded p-1.5 outline-none focus:border-purple-400"
                  style={{ minHeight: 64 }}
                />
                <div className="flex gap-1.5 mt-1.5">
                  <button
                    onClick={handleTextConfirm}
                    className="flex-1 rounded bg-purple-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-purple-700 transition"
                  >
                    삽입
                  </button>
                  <button
                    onClick={() => { setTextInputPos(null); setTextInputValue(''); }}
                    className="flex-1 rounded bg-gray-100 px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-200 transition"
                  >
                    취소
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* pdf_overlay 전용 서명 캡처 패드 */}
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
