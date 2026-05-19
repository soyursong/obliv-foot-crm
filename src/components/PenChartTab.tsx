/**
 * PenChartTab — PDF 양식 위에 태블릿 직접 필기 + 개인정보/체크리스트 합본 양식
 *
 * T-20260513-foot-C21-TAB-RESTRUCTURE-C (AC-4)
 * T-20260517-foot-PENCHART-FORM: PDF 양식 배경 + 상용구
 * T-20260519-foot-PENCHART-FORM-ADD: 개인정보+체크리스트 합본 2종 (일반/어르신)
 * T-20260519-foot-HEALTH-Q-PEN: 발건강 질문지 PDF 캔버스 + 태블릿펜 기입
 *
 * 모드 구조:
 *   list   — 저장된 차트 목록 + 새 차트 버튼
 *   select — 양식 선택 패널 (pen_chart / health_questionnaire_* / personal_checklist_*)
 *   draw   — 캔버스 필기 모드 (pen_chart + health_questionnaire_* 공용)
 *   fill   — 텍스트 입력 양식 모드 (personal_checklist_* 레거시 전용)
 *
 * form_submissions 저장 (fill 모드):
 *   - check_in_id: checkInId prop (최근 내원 상담 자동 연동)
 *   - issued_by: staff.id (profile.id → user_id 경유 조회)
 *
 * draw 모드 저장:
 *   - photos bucket / customer/{id}/pen-chart/{ts}_{rand}.png
 *   - health_questionnaire는 파일명에 'hq_' prefix 붙여 구분
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { format } from 'date-fns';
import {
  ClipboardList, Download, Eraser, Pencil, Plus, RotateCcw,
  Save, Trash2, Type, X, ChevronLeft, FileText,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { formatPhoneInput } from '@/lib/format';

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

const CANVAS_W = 720;
const CANVAS_H = 1020; // A4 비율 약 1:√2

const PEN_COLORS = [
  { label: '검정', value: '#1a1a1a' },
  { label: '파랑', value: '#1d4ed8' },
  { label: '빨강', value: '#dc2626' },
  { label: '초록', value: '#16a34a' },
];

type DrawMode = 'idle' | 'selecting' | 'placing';
type TabMode = 'list' | 'select' | 'draw' | 'fill';

/** draw 모드에서 활성 양식이 발건강 질문지인지 구분 */
const isHealthQFormKey = (k: string) => k.startsWith('health_questionnaire_');

// ─── 개인정보/체크리스트 양식 데이터 ───
interface PersonalChecklistData {
  name: string;
  phone: string;
  birth_date: string;
  address: string;
  symptoms: string[];
  symptoms_other: string;
  pain_areas: string[];
  medical_history: string[];
  medical_history_other: string;
  has_allergy: boolean | null; // null = 미선택
  allergy_detail: string;
  agree_privacy: boolean | null; // null = 미선택
  agree_marketing: boolean;
}

const SYMPTOM_OPTIONS = ['굳은살/티눈', '무좀', '내성발톱', '발냄새', '발건조/각질', '당뇨발/혈액순환', '기타'];
const PAIN_AREA_OPTIONS = ['발앞꿈치', '발뒤꿈치', '발바닥', '발등', '발목'];
const MEDICAL_OPTIONS = ['당뇨', '고혈압', '심장질환', '혈액순환장애', '기타'];

const PRIVACY_TEXT = [
  '1. 수집 항목: 성명, 생년월일, 연락처, 발 건강 정보, 시술 사진',
  '2. 수집 목적: 시술·상담 진행, 예약 관리, 사후 관리',
  '3. 보유 기간: 의료법에 따른 진료기록 보존 기간 (최소 5년)',
  '4. 동의를 거부할 권리가 있으나, 거부 시 시술이 제한될 수 있습니다.',
];

const MARKETING_TEXT = [
  '1. 수집 항목: 성명, 연락처',
  '2. 수집 목적: 마케팅 정보 발송 (이벤트·신규 시술 안내)',
  '3. 보유 기간: 동의 철회 시까지',
  '4. 본 동의는 선택이며 거부해도 시술 이용에 제한이 없습니다.',
];

const initialFillData = (defaults?: { name?: string; phone?: string; birth_date?: string }): PersonalChecklistData => ({
  name: defaults?.name ?? '',
  phone: defaults?.phone ?? '',
  birth_date: defaults?.birth_date ?? '',
  address: '',
  symptoms: [],
  symptoms_other: '',
  pain_areas: [],
  medical_history: [],
  medical_history_other: '',
  has_allergy: null,
  allergy_detail: '',
  agree_privacy: null,
  agree_marketing: false,
});

// ─── 개인정보/체크리스트 양식 렌더러 ────────────────────────────────────────
function PersonalChecklistFillView({
  isSenior,
  data,
  onChange,
  onSave,
  onCancel,
  saving,
}: {
  isSenior: boolean;
  data: PersonalChecklistData;
  onChange: (d: PersonalChecklistData) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const fs = isSenior ? 'text-xl' : 'text-sm';
  const fsLabel = isSenior ? 'text-base' : 'text-xs';
  const inputH = isSenior ? 'h-16 text-xl' : 'h-11 text-sm';
  const btnH = isSenior ? 'min-h-16 text-xl px-6 py-3' : 'min-h-12 px-4 py-2 text-sm';

  const toggle = (key: 'symptoms' | 'pain_areas' | 'medical_history', val: string) => {
    const arr = data[key] as string[];
    onChange({ ...data, [key]: arr.includes(val) ? arr.filter((v) => v !== val) : [...arr, val] });
  };

  const canSave = data.name.trim() && data.agree_privacy === true;

  return (
    <div className="space-y-4">
      {/* 상단 툴바 */}
      <div className="rounded-lg border bg-white p-2 flex items-center gap-2 sticky top-0 z-10 shadow-sm">
        <button
          onClick={onCancel}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs border border-gray-200 hover:bg-gray-50"
        >
          <ChevronLeft className="h-3.5 w-3.5" /> 취소
        </button>
        <span className={cn('flex-1 font-semibold text-teal-800', isSenior ? 'text-lg' : 'text-sm')}>
          {isSenior ? '개인정보+체크리스트 (어르신용)' : '개인정보+체크리스트 (일반)'}
        </span>
        <Button
          size={isSenior ? 'default' : 'sm'}
          className={cn(
            isSenior ? 'h-12 text-base px-6' : 'h-7 text-[11px] px-3',
            'bg-teal-600 hover:bg-teal-700',
          )}
          onClick={onSave}
          disabled={!canSave || saving}
        >
          <Save className={cn('mr-1', isSenior ? 'h-5 w-5' : 'h-3.5 w-3.5')} />
          {saving ? '저장 중…' : '저장'}
        </Button>
      </div>

      {/* 기본 정보 */}
      <section className="rounded-lg border bg-white p-4 space-y-3">
        <h3 className={cn('font-semibold text-teal-800', isSenior ? 'text-xl' : 'text-sm')}>기본 정보</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className={fsLabel}>성명 *</Label>
            <Input
              value={data.name}
              onChange={(e) => onChange({ ...data, name: e.target.value })}
              className={inputH}
              placeholder="홍길동"
            />
          </div>
          <div>
            <Label className={fsLabel}>연락처</Label>
            <Input
              value={data.phone}
              onChange={(e) => onChange({ ...data, phone: formatPhoneInput(e.target.value) })}
              className={inputH}
              placeholder="010-0000-0000"
            />
          </div>
          <div>
            <Label className={fsLabel}>생년월일</Label>
            <Input
              type="date"
              value={data.birth_date}
              onChange={(e) => onChange({ ...data, birth_date: e.target.value })}
              className={inputH}
            />
          </div>
          <div>
            <Label className={fsLabel}>주소</Label>
            <Input
              value={data.address}
              onChange={(e) => onChange({ ...data, address: e.target.value })}
              className={inputH}
              placeholder="서울시 종로구…"
            />
          </div>
        </div>
      </section>

      {/* 발 관련 증상 */}
      <section className="rounded-lg border bg-white p-4 space-y-3">
        <h3 className={cn('font-semibold text-teal-800', isSenior ? 'text-xl' : 'text-sm')}>
          발 관련 증상 (해당 항목 모두 선택)
        </h3>
        <div className="flex flex-wrap gap-2">
          {SYMPTOM_OPTIONS.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => toggle('symptoms', opt)}
              className={cn(
                'rounded-md border font-medium transition',
                btnH,
                data.symptoms.includes(opt)
                  ? 'border-teal-600 bg-teal-50 text-teal-700'
                  : 'border-input hover:bg-muted',
              )}
            >
              {opt}
            </button>
          ))}
        </div>
        {data.symptoms.includes('기타') && (
          <Input
            value={data.symptoms_other}
            onChange={(e) => onChange({ ...data, symptoms_other: e.target.value })}
            placeholder="기타 증상 직접 입력"
            className={inputH}
          />
        )}
      </section>

      {/* 통증 부위 */}
      <section className="rounded-lg border bg-white p-4 space-y-3">
        <h3 className={cn('font-semibold text-teal-800', isSenior ? 'text-xl' : 'text-sm')}>통증 부위</h3>
        <div className="flex flex-wrap gap-2">
          {PAIN_AREA_OPTIONS.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => toggle('pain_areas', opt)}
              className={cn(
                'rounded-md border font-medium transition',
                btnH,
                data.pain_areas.includes(opt)
                  ? 'border-emerald-600 bg-emerald-50 text-emerald-700'
                  : 'border-input hover:bg-muted',
              )}
            >
              {opt}
            </button>
          ))}
        </div>
      </section>

      {/* 과거병력 */}
      <section className="rounded-lg border bg-white p-4 space-y-3">
        <h3 className={cn('font-semibold text-teal-800', isSenior ? 'text-xl' : 'text-sm')}>과거병력</h3>
        <div className="flex flex-wrap gap-2">
          {MEDICAL_OPTIONS.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => toggle('medical_history', opt)}
              className={cn(
                'rounded-md border font-medium transition',
                btnH,
                data.medical_history.includes(opt)
                  ? 'border-amber-600 bg-amber-50 text-amber-700'
                  : 'border-input hover:bg-muted',
              )}
            >
              {opt}
            </button>
          ))}
        </div>
        {data.medical_history.includes('기타') && (
          <Input
            value={data.medical_history_other}
            onChange={(e) => onChange({ ...data, medical_history_other: e.target.value })}
            placeholder="기타 과거병력 직접 입력"
            className={inputH}
          />
        )}
      </section>

      {/* 알레르기 */}
      <section className="rounded-lg border bg-white p-4 space-y-3">
        <h3 className={cn('font-semibold text-teal-800', isSenior ? 'text-xl' : 'text-sm')}>알레르기 여부</h3>
        <div className="flex gap-3">
          {[
            { value: false as const, label: '없음', color: 'teal' as const },
            { value: true as const,  label: '있음', color: 'rose' as const },
          ].map(({ value, label, color }) => (
            <button
              key={String(value)}
              type="button"
              onClick={() => onChange({ ...data, has_allergy: value, allergy_detail: value ? data.allergy_detail : '' })}
              className={cn(
                'flex-1 rounded-md border-2 font-semibold transition',
                btnH,
                data.has_allergy === value
                  ? color === 'teal'
                    ? 'border-teal-600 bg-teal-600 text-white'
                    : 'border-rose-500 bg-rose-500 text-white'
                  : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {data.has_allergy && (
          <Textarea
            value={data.allergy_detail}
            onChange={(e) => onChange({ ...data, allergy_detail: e.target.value })}
            placeholder="알레르기 내역을 입력해주세요"
            rows={isSenior ? 3 : 2}
            className={cn(fs)}
          />
        )}
      </section>

      {/* 개인정보 동의 (필수) */}
      <section className="rounded-lg border bg-muted/20 p-4 space-y-3">
        <h3 className={cn('font-semibold text-teal-800', isSenior ? 'text-xl' : 'text-sm')}>
          개인정보 수집·이용 동의 (필수)
        </h3>
        <div className="space-y-1 text-muted-foreground leading-relaxed" style={{ fontSize: isSenior ? '1rem' : '0.75rem' }}>
          {PRIVACY_TEXT.map((line, i) => <p key={i}>{line}</p>)}
        </div>
        <div className="flex gap-3 pt-1">
          {[
            { value: true  as const, label: '동의합니다',       color: 'teal' as const },
            { value: false as const, label: '동의하지 않습니다', color: 'rose' as const },
          ].map(({ value, label, color }) => (
            <button
              key={String(value)}
              type="button"
              onClick={() => onChange({ ...data, agree_privacy: value })}
              className={cn(
                'flex-1 rounded-md border-2 font-semibold transition',
                btnH,
                data.agree_privacy === value
                  ? color === 'teal'
                    ? 'border-teal-600 bg-teal-600 text-white'
                    : 'border-rose-500 bg-rose-500 text-white'
                  : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {data.agree_privacy === false && (
          <p className="text-rose-600 font-medium" style={{ fontSize: isSenior ? '1rem' : '0.7rem' }}>
            ※ 개인정보 수집·이용에 동의하지 않으면 시술이 제한될 수 있습니다.
          </p>
        )}
      </section>

      {/* 마케팅 동의 (선택) */}
      <section className="rounded-lg border bg-muted/10 p-4 space-y-3">
        <h3 className={cn('font-semibold text-muted-foreground', isSenior ? 'text-xl' : 'text-sm')}>
          마케팅 정보 수신 동의 (선택)
        </h3>
        <div className="space-y-1 text-muted-foreground leading-relaxed" style={{ fontSize: isSenior ? '1rem' : '0.75rem' }}>
          {MARKETING_TEXT.map((line, i) => <p key={i}>{line}</p>)}
        </div>
        <label className="flex items-center gap-3 cursor-pointer pt-1">
          <input
            type="checkbox"
            checked={data.agree_marketing}
            onChange={(e) => onChange({ ...data, agree_marketing: e.target.checked })}
            className={isSenior ? 'h-7 w-7 rounded border-gray-300' : 'h-5 w-5 rounded border-gray-300'}
          />
          <span className={cn(isSenior ? 'text-lg' : 'text-sm')}>마케팅 정보 수신에 동의합니다.</span>
        </label>
      </section>

      {/* 저장 불가 안내 */}
      {!canSave && (
        <p className="text-center text-rose-600" style={{ fontSize: isSenior ? '1rem' : '0.75rem' }}>
          {!data.name.trim() ? '성명을 입력해주세요.' : '개인정보 동의 여부를 선택해주세요 (필수).'}
        </p>
      )}
    </div>
  );
}

// ─── 메인 컴포넌트 ──────────────────────────────────────────────────────────
export function PenChartTab({
  customerId,
  clinicId,
  checkInId,
  customerName,
  customerPhone,
  customerBirthDate,
}: {
  customerId: string;
  clinicId: string;
  /** 현재 내원 check_in_id — form_submissions.check_in_id 자동 연동 */
  checkInId?: string;
  /** 고객 기본 정보 (양식 자동 채움) */
  customerName?: string;
  customerPhone?: string;
  customerBirthDate?: string;
}) {
  const { profile } = useAuth();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [savedCharts, setSavedCharts] = useState<SavedChart[]>([]);
  const [penChartTemplate, setPenChartTemplate] = useState<Template | null>(null);
  const [checklistTemplates, setChecklistTemplates] = useState<Template[]>([]);
  /** 발건강 질문지 템플릿 2종 (일반/어르신) — T-20260519-foot-HEALTH-Q-PEN */
  const [healthQTemplates, setHealthQTemplates] = useState<Template[]>([]);
  const [templateImgUrl, setTemplateImgUrl] = useState<string | null>(null);
  const [mode, setMode] = useState<TabMode>('list');
  /** draw 모드에서 현재 활성 양식 (pen_chart | health_questionnaire_*) */
  const [activeDrawTemplate, setActiveDrawTemplate] = useState<Template | null>(null);
  const [selectedFillTemplate, setSelectedFillTemplate] = useState<Template | null>(null);
  const [fillData, setFillData] = useState<PersonalChecklistData>(() => initialFillData());
  const [fillSaving, setFillSaving] = useState(false);
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
  const loadTemplates = useCallback(async () => {
    const { data } = await supabase
      .from('form_templates')
      .select('id, name_ko, template_path, template_format, form_key')
      .eq('clinic_id', clinicId)
      .in('form_key', [
        'pen_chart',
        'personal_checklist_general', 'personal_checklist_senior',
        'health_questionnaire_general', 'health_questionnaire_senior',
      ])
      .eq('active', true)
      .order('sort_order', { ascending: true });

    if (data) {
      const penChart = (data as Template[]).find((t) => t.form_key === 'pen_chart');
      const checklists = (data as Template[]).filter((t) => t.form_key.startsWith('personal_checklist_'));
      const healthQs  = (data as Template[]).filter((t) => t.form_key.startsWith('health_questionnaire_'));
      setPenChartTemplate(penChart ?? BUILTIN_PEN_CHART_TEMPLATE);
      setChecklistTemplates(checklists);
      // DB에 발건강 질문지 행 없으면 내장 폴백 사용
      setHealthQTemplates(healthQs.length > 0 ? healthQs : [BUILTIN_HEALTH_Q_GENERAL, BUILTIN_HEALTH_Q_SENIOR]);
    } else {
      setPenChartTemplate(BUILTIN_PEN_CHART_TEMPLATE);
      setHealthQTemplates([BUILTIN_HEALTH_Q_GENERAL, BUILTIN_HEALTH_Q_SENIOR]);
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

    // T-20260519-foot-HEALTH-Q-PEN: 활성 draw 템플릿 배경 우선 사용.
    // health_questionnaire_* → 공개 에셋 직접 경로
    // pen_chart → templateImgUrl (public path 또는 Supabase signed URL)
    let bgUrl: string | null = null;
    if (activeDrawTemplate && isHealthQFormKey(activeDrawTemplate.form_key)) {
      bgUrl = activeDrawTemplate.template_path ?? null;
    } else {
      bgUrl = templateImgUrl;
    }

    if (bgUrl) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => { ctx.drawImage(img, 0, 0, CANVAS_W, CANVAS_H); };
      img.src = bgUrl;
    }
    emptyRef.current = true;
    setHasDrawing(false);
    setBoilerplateMode('idle');
    setPendingBoilerplate('');
    setShowBoilerplatePanel(false);
  }, [templateImgUrl, activeDrawTemplate]);

  useEffect(() => {
    if (mode === 'draw') {
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
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const pos = getPos(e);
    if (boilerplateMode === 'placing' && pendingBoilerplate) { placeBoilerplate(pos.x, pos.y); return; }
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
      const dataUrl = canvas.toDataURL('image/png');
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      // T-20260519-foot-HEALTH-Q-PEN: health_questionnaire 파일에 'hq_' prefix
      const prefix = activeDrawTemplate && isHealthQFormKey(activeDrawTemplate.form_key)
        ? `hq_${activeDrawTemplate.form_key === 'health_questionnaire_senior' ? 'sr_' : ''}`
        : '';
      const fileName = `${prefix}${Date.now()}_${Math.random().toString(36).slice(2, 6)}.png`;
      const path = `${storagePath}/${fileName}`;
      const { error } = await supabase.storage.from('photos').upload(path, blob, { contentType: 'image/png', upsert: false });
      if (error) { toast.error(`저장 실패: ${error.message}`); return; }
      const isHQ = activeDrawTemplate && isHealthQFormKey(activeDrawTemplate.form_key);
      toast.success(isHQ ? '발건강 질문지 저장 완료' : '펜차트 저장 완료');
      await loadSavedCharts();
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

  // ── fill 모드 저장 ────────────────────────────────────────────────────
  const handleFillSave = async () => {
    if (!fillData.name.trim()) { toast.error('성명을 입력해주세요'); return; }
    if (fillData.agree_privacy !== true) { toast.error('개인정보 수집·이용에 동의해주세요 (필수)'); return; }
    if (!selectedFillTemplate) return;

    // T-20260519-foot-PENCHART-FORMS: 폴백 템플릿 ID는 real UUID가 아님 → FK 위반 방지
    if (selectedFillTemplate.id.startsWith('fallback-')) {
      toast.error('양식 템플릿을 불러오는 중입니다. 잠시 후 다시 시도해주세요.');
      return;
    }
    // issued_by NOT NULL — staffId 미확보 시 저장 불가
    if (!staffId) {
      toast.error('직원 정보를 불러오는 중입니다. 잠시 후 다시 시도해주세요.');
      return;
    }

    setFillSaving(true);
    try {
      const now = new Date().toISOString();
      const payload: Record<string, unknown> = {
        clinic_id: clinicId,
        template_id: selectedFillTemplate.id,
        customer_id: customerId,
        field_data: fillData,
        status: 'signed',
        signed_at: now,
        // printed_at: 상담내역 submissionEntries 쿼리가 printed_at 기준으로 정렬·표시함
        // 기입 완료 = 서류 발행 시점과 동일하게 처리 (T-20260519-foot-PENCHART-FORMS AC-6)
        printed_at: now,
        issued_by: staffId,
      };
      // check_in_id: 내원 상담 자동 연동 (AC-5)
      if (checkInId) payload.check_in_id = checkInId;

      const { error } = await supabase.from('form_submissions').insert(payload);
      if (error) {
        toast.error(`저장 실패: ${error.message}`);
        return;
      }
      toast.success('양식 저장 완료 — 상담내역에 연동됐습니다');
      setMode('list');
      setSelectedFillTemplate(null);
      setFillData(initialFillData({ name: customerName, phone: customerPhone, birth_date: customerBirthDate }));
    } finally {
      setFillSaving(false);
    }
  };

  // ── 양식 선택 ─────────────────────────────────────────────────────────
  const handleSelectTemplate = (tpl: Template) => {
    if (tpl.form_key === 'pen_chart' || isHealthQFormKey(tpl.form_key)) {
      // T-20260519-foot-HEALTH-Q-PEN: 발건강 질문지도 draw 모드 (PDF 캔버스)
      setActiveDrawTemplate(tpl);
      setMode('draw');
    } else {
      // personal_checklist_* 레거시 fill 모드
      setSelectedFillTemplate(tpl);
      setFillData(initialFillData({ name: customerName, phone: customerPhone, birth_date: customerBirthDate }));
      setMode('fill');
    }
  };

  // ─────────────────────────────────────────────────────────────────────
  // 렌더: fill 모드 (개인정보/체크리스트 텍스트 입력)
  // ─────────────────────────────────────────────────────────────────────
  if (mode === 'fill' && selectedFillTemplate) {
    const isSenior = selectedFillTemplate.form_key === 'personal_checklist_senior';
    return (
      <PersonalChecklistFillView
        isSenior={isSenior}
        data={fillData}
        onChange={setFillData}
        onSave={handleFillSave}
        onCancel={() => { setMode('list'); setSelectedFillTemplate(null); }}
        saving={fillSaving}
      />
    );
  }

  // ─────────────────────────────────────────────────────────────────────
  // 렌더: select 모드 (양식 선택 패널)
  // ─────────────────────────────────────────────────────────────────────
  if (mode === 'select') {
    return (
      <div className="space-y-3">
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

            {/* 개인정보+체크리스트 레거시 (텍스트 입력 — 이전 방식) */}
            {checklistTemplates.length > 0 && checklistTemplates.map((tpl) => {
              const isSenior = tpl.form_key === 'personal_checklist_senior';
              return (
                <button
                  key={tpl.id}
                  onClick={() => handleSelectTemplate(tpl)}
                  className="flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3 text-left hover:border-gray-300 hover:bg-gray-100 transition"
                >
                  <ClipboardList className="h-4 w-4 text-gray-400 shrink-0" />
                  <div>
                    <div className="font-medium text-xs text-gray-600">{tpl.name_ko}</div>
                    <div className="text-[10px] text-gray-400 mt-0.5">텍스트 입력 방식 (레거시)</div>
                  </div>
                  {isSenior && (
                    <span className="ml-auto rounded bg-gray-200 px-1.5 py-0.5 text-[9px] text-gray-500">어르신</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────
  // 렌더: draw 모드 (캔버스 필기)
  // ─────────────────────────────────────────────────────────────────────
  if (mode === 'draw') {
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

        {/* 캔버스 */}
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
          <canvas
            ref={canvasRef}
            style={{
              touchAction: 'none',
              cursor: boilerplateMode === 'placing' ? 'text' : isEraser ? 'cell' : 'crosshair',
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
