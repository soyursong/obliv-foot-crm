// LOGIC-LOCK: L-003 — 차트 수정사항 CRM 전체 고객 동일 적용. 변경 시 현장 승인 필수
/**
 * MedicalChartPanel — 풋센터 진료차트 Drawer (전면 보강)
 *
 * T-20260519-foot-MEDCHART-REVAMP:
 *   AC-2: 진료차트 Drawer UI 전환 (전체화면 → 우측 슬라이드 Drawer)
 *   AC-3: 컴팩트 레이아웃
 *         - 진료일 / 진단명 / 치료(결제내역 연동) / 치료사차트 / 임상경과(상용구) / 진료메모(원장전용) / 처방내역(세트)
 *   AC-4: 경과 타임라인 좌측 배치 (최신 상단, 날짜 클릭 → 우측 폼 전환)
 *
 * T-20260526-foot-PHRASE-SLASH:
 *   AC-2/3: 임상경과 단축어 트리거 # → // 전환
 *           (예: //족통감소 입력 시 팝오버, 선택 시 문구 대체)
 *
 * T-20260522-foot-LASER-TIMER:
 *   AC-1: 치료메모 상단 타이머 버튼 [5분] [15분] [20분] + 카운트다운
 *   AC-2: ends_at 기준 카운트다운 (탭 비활성 대응 — 서버시각 앵커)
 *   AC-4: timer_records 신규 테이블 사용
 *   checkInId prop 추가 (optional — 없으면 타이머 미표시)
 *
 * T-20260526-foot-CHART-DRAWER-LAYOUT:
 *   AC-1: 처방내역·상용구 팝업/드롭다운 → Drawer 오른쪽 패널(2-column) 전환
 *         좌측=진료기록 폼, 우측=처방내역·상용구 콘텐츠 패널(탭 전환)
 *   AC-2: 우측 패널 처방세트·상용구 선택 → 좌측 폼 삽입 + "편집" 버튼 → 관리 화면 이동
 *   AC-3: 치료사차트 읽기전용 스타일 (회색 배경 + disabled + cursor-not-allowed)
 *   AC-4: 진료차트 모든 placeholder/예시 멘트 연한 회색 처리
 *   AC-5: 기존 기능 무영향 (MEDCHART-REVAMP 타임라인·저장·Drawer 동작 유지)
 *
 * T-20260526-foot-MEDCHART-SYNC:
 *   AC-1: 진료차트 상용구(phrase_type='medical_chart')만 연동 — 펜차트 상용구 분리
 *   AC-2: 치료메모 탭 — customer_treatment_memos 읽기전용 뷰어 (우측 패널)
 *   AC-3: 진료내역 탭 — check_ins 방문 이력 읽기전용 뷰어 (우측 패널)
 *   AC-4: 진료이미지 탭 — photos Storage 썸네일 뷰어 (우측 패널)
 *
 * 이전 버전:
 *   T-20260515-foot-MEDICAL-CHART-V1 — 최초 구현 (6항목)
 *   T-20260516-foot-MEDICAL-CHART-EXPAND — 전체화면 전환 (이 버전으로 대체)
 *
 * Props: open / onOpenChange / customerId / clinicId / currentUserRole / currentUserEmail
 *   — 기존 caller 변경 없음. checkInId 신규 (optional)
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { toast } from '@/lib/toast';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import { BookOpen, Camera, ChevronDown, ChevronLeft, ChevronRight, ClipboardList, Edit2, FlaskConical, History, Loader2, Plus, Stethoscope, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/supabase';
import { formatAmount, formatPhone } from '@/lib/format';
import type { PrescriptionItem } from '@/components/admin/PrescriptionSetsTab';

// ── 타입 ─────────────────────────────────────────────────────────────────────

interface MedicalChart {
  id: string;
  customer_id: string;
  clinic_id: string;
  visit_date: string;
  chief_complaint: string | null;   // legacy — display only in timeline summary
  diagnosis: string | null;
  treatment_record: string | null;  // 치료사차트
  materials_used: string | null;    // legacy
  treatment_result: string | null;  // legacy
  clinical_progress: string | null; // NEW: 임상경과
  prescription_items: PrescriptionItem[] | null; // NEW: 처방내역
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // doctor_memo: chart_doctor_memos에서 merge (director/admin 전용)
  doctor_memo?: string | null;
}

interface CustomerBasic {
  id: string;
  name: string;
  phone: string;
  birth_date: string | null;
  chart_number: string | null;
}

interface PhraseTemplate {
  id: number;
  category: string;
  name: string;
  content: string;
  shortcut_key: string | null;
  is_active: boolean;
}

interface PrescriptionSet {
  id: number;
  name: string;
  items: PrescriptionItem[];
  is_active: boolean;
}

interface VisitPayment {
  id: string;
  amount: number;
  memo: string | null;
  method: string;
}

// T-20260526-foot-MEDCHART-SYNC: 치료메모 항목
interface TreatmentMemoEntry {
  id: string;
  content: string;
  created_by_name: string | null;
  created_at: string;
  memo_type?: string | null;
}

// T-20260526-foot-MEDCHART-SYNC: 방문 이력 항목 (진료내역)
interface VisitHistoryEntry {
  id: string;
  checked_in_at: string;
  treatment_kind: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  treatment_memo: any | null;  // JSONB { details: string }
  doctor_note: string | null;
  status: string;
}

// T-20260526-foot-MEDCHART-SYNC: 진료이미지 항목
interface TreatmentImage {
  path: string;
  signedUrl: string;
  name: string;
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface MedicalChartPanelProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  customerId: string | null;
  clinicId: string;
  currentUserRole: string;
  currentUserEmail: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const DIRECTOR_ROLES = ['director', 'admin'];
function canViewDoctorMemo(role: string): boolean {
  return DIRECTOR_ROLES.includes(role);
}

function fmtDateShort(dateStr: string): string {
  try {
    return format(new Date(dateStr), 'yy.MM.dd (EEE)', { locale: ko });
  } catch {
    return dateStr;
  }
}

function fmtDateFull(dateStr: string): string {
  try {
    return format(new Date(dateStr), 'yyyy년 M월 d일 (EEE)', { locale: ko });
  } catch {
    return dateStr;
  }
}

function chartSummary(chart: MedicalChart): string {
  return chart.diagnosis || chart.chief_complaint || chart.clinical_progress || chart.treatment_record || '기록';
}

// T-20260526-foot-VISIT-FOLD-FILTER: 특이사항 판별 기준 (dev 제안: 키워드 매칭 — 현장 확인 필요)
// 제안 기준 ① notes 내 키워드 포함 ② 금기/과민 반응 언급 ③ 부작용 기록
const NOTABLE_KEYWORDS = ['알러지', '주의', '특이', '금기', '과민', '부작용', '금지'];

function hasTreatMemo(c: MedicalChart): boolean {
  return !!c.treatment_record?.trim();
}
function hasDocMemo(c: MedicalChart): boolean {
  return !!c.clinical_progress?.trim() || !!c.doctor_memo?.trim();
}
function isNotable(c: MedicalChart): boolean {
  const text = [c.clinical_progress, c.doctor_memo, c.diagnosis, c.treatment_record]
    .filter(Boolean).join(' ');
  return NOTABLE_KEYWORDS.some(kw => text.includes(kw));
}

type MemoFilter = 'treat' | 'doc' | 'notable';

const FILTER_OPTIONS: { key: MemoFilter; label: string; chipClass: string }[] = [
  { key: 'treat', label: '치료메모', chipClass: 'bg-blue-600 text-white border-blue-600' },
  { key: 'doc', label: '진료메모', chipClass: 'bg-teal-600 text-white border-teal-600' },
  { key: 'notable', label: '⚠특이', chipClass: 'bg-amber-500 text-white border-amber-500' },
];

// ── Component ─────────────────────────────────────────────────────────────────

export default function MedicalChartPanel({
  open,
  onOpenChange,
  customerId,
  clinicId,
  currentUserRole,
  currentUserEmail,
}: MedicalChartPanelProps) {
  const isDirector = canViewDoctorMemo(currentUserRole);
  const navigate = useNavigate();

  // ── 데이터 ──────────────────────────────────────────────────────────────────
  const [customer, setCustomer] = useState<CustomerBasic | null>(null);
  const [charts, setCharts] = useState<MedicalChart[]>([]);
  const [loading, setLoading] = useState(false);
  const [phraseTemplates, setPhraseTemplates] = useState<PhraseTemplate[]>([]);
  const [prescriptionSets, setPrescriptionSets] = useState<PrescriptionSet[]>([]);
  const [visitPayments, setVisitPayments] = useState<VisitPayment[]>([]);

  // ── 선택 차트 (null = 새 기록 모드) ──────────────────────────────────────────
  const [selectedChartId, setSelectedChartId] = useState<string | null>(null);

  // ── 폼 상태 ─────────────────────────────────────────────────────────────────
  const [formDate, setFormDate] = useState('');
  const [formDx, setFormDx] = useState('');
  const [formTx, setFormTx] = useState('');          // 치료사차트 = treatment_record (읽기전용)
  const [formClinical, setFormClinical] = useState(''); // 임상경과
  const [formMemo, setFormMemo] = useState('');       // 원장 전용 메모
  const [formRx, setFormRx] = useState<PrescriptionItem[]>([]); // 처방내역
  const [saving, setSaving] = useState(false);

  // ── 임상경과 상용구 autocomplete ───────────────────────────────────────────
  const clinicalRef = useRef<HTMLTextAreaElement>(null);
  const [phrasePopoverVisible, setPhrasePopoverVisible] = useState(false);
  const [phraseQuery, setPhraseQuery] = useState('');

  // ── 우측 패널 탭 (AC-1 + MEDCHART-SYNC: 처방세트 / 상용구 / 치료메모 / 진료내역 / 진료이미지)
  const [rightTab, setRightTab] = useState<'rx' | 'phrase' | 'treat_memo' | 'visit_hist' | 'images'>('rx');
  const [selectedPhraseIds, setSelectedPhraseIds] = useState<Set<number>>(new Set());

  // T-20260526-foot-MEDCHART-SYNC: 참고 데이터 상태
  const [treatMemos, setTreatMemos] = useState<TreatmentMemoEntry[]>([]);
  const [treatMemosLoaded, setTreatMemosLoaded] = useState(false);
  const [treatMemosLoading, setTreatMemosLoading] = useState(false);
  const [visitHistory, setVisitHistory] = useState<VisitHistoryEntry[]>([]);
  const [visitHistLoaded, setVisitHistLoaded] = useState(false);
  const [visitHistLoading, setVisitHistLoading] = useState(false);
  const [treatImages, setTreatImages] = useState<TreatmentImage[]>([]);
  const [treatImagesLoaded, setTreatImagesLoaded] = useState(false);
  const [treatImagesLoading, setTreatImagesLoading] = useState(false);

  // T-20260526-foot-VISIT-FOLD-FILTER: 아코디언 + 필터 상태
  const [expandedChartIds, setExpandedChartIds] = useState<Set<string>>(new Set<string>());
  const [memoFilters, setMemoFilters] = useState<Set<MemoFilter>>(new Set<MemoFilter>());

  // ── 데이터 로드 ──────────────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    if (!customerId || !clinicId) return;
    setLoading(true);
    try {
      const [custRes, chartsRes, phrasesRes, rxSetsRes] = await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any)
          .from('customers')
          .select('id,name,phone,birth_date,chart_number')
          .eq('id', customerId)
          .maybeSingle(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any)
          .from('medical_charts')
          .select('*')
          .eq('customer_id', customerId)
          .eq('clinic_id', clinicId)
          .order('visit_date', { ascending: false }),
        // T-20260526-foot-MEDCHART-SYNC: 진료차트 상용구(medical_chart)만 조회
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any)
          .from('phrase_templates')
          .select('id,category,name,content,shortcut_key,is_active')
          .eq('is_active', true)
          .eq('phrase_type', 'medical_chart')
          .order('sort_order', { ascending: true }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any)
          .from('prescription_sets')
          .select('id,name,items,is_active')
          .eq('is_active', true)
          .order('sort_order', { ascending: true }),
      ]);

      if (custRes.data) setCustomer(custRes.data as CustomerBasic);
      const rawCharts: MedicalChart[] = chartsRes.data || [];
      setPhraseTemplates(phrasesRes.data || []);
      setPrescriptionSets(rxSetsRes.data || []);

      // director면 chart_doctor_memos merge
      if (isDirector && rawCharts.length > 0) {
        const chartIds = rawCharts.map((c: MedicalChart) => c.id);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: memos } = await (supabase as any)
          .from('chart_doctor_memos')
          .select('medical_chart_id,memo')
          .in('medical_chart_id', chartIds);
        const memoMap: Record<string, string> = {};
        (memos || []).forEach((m: { medical_chart_id: string; memo: string }) => {
          memoMap[m.medical_chart_id] = m.memo;
        });
        setCharts(rawCharts.map((c: MedicalChart) => ({ ...c, doctor_memo: memoMap[c.id] ?? null })));
      } else {
        setCharts(rawCharts);
      }
    } catch {
      toast.error('진료차트 로드 실패 — 잠시 후 다시 시도해주세요');
    } finally {
      setLoading(false);
    }
  }, [customerId, clinicId, isDirector]);

  const loadVisitPayments = useCallback(async (date: string) => {
    if (!customerId || !date) { setVisitPayments([]); return; }
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: checkIns } = await (supabase as any)
        .from('check_ins')
        .select('id')
        .eq('customer_id', customerId)
        .gte('created_at', `${date}T00:00:00+09:00`)
        .lte('created_at', `${date}T23:59:59+09:00`);
      if (!checkIns?.length) { setVisitPayments([]); return; }
      const ids = (checkIns as { id: string }[]).map(c => c.id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: pmts } = await (supabase as any)
        .from('payments')
        .select('id,amount,memo,method')
        .in('check_in_id', ids)
        .eq('payment_type', 'payment');
      setVisitPayments(pmts || []);
    } catch {
      setVisitPayments([]);
    }
  }, [customerId]);

  // ── 폼 채우기 ────────────────────────────────────────────────────────────────

  const resetForm = useCallback((chart?: MedicalChart | null) => {
    const today = format(new Date(), 'yyyy-MM-dd');
    if (chart) {
      setFormDate(chart.visit_date);
      setFormDx(chart.diagnosis || '');
      setFormTx(chart.treatment_record || '');
      setFormClinical(chart.clinical_progress || '');
      setFormMemo(chart.doctor_memo || '');
      setFormRx(chart.prescription_items || []);
      loadVisitPayments(chart.visit_date);
    } else {
      setFormDate(today);
      setFormDx('');
      setFormTx('');
      setFormClinical('');
      setFormMemo('');
      setFormRx([]);
      loadVisitPayments(today);
    }
  }, [loadVisitPayments]);

  // ── 열림/닫힘 lifecycle ───────────────────────────────────────────────────────

  useEffect(() => {
    if (open && customerId) {
      loadData();
      setSelectedChartId(null);
      resetForm(null);
      setPhrasePopoverVisible(false);
      setSelectedPhraseIds(new Set());
      setRightTab('rx');
      // T-20260526-foot-MEDCHART-SYNC: 참고 데이터 리셋 (새 고객 열릴 때마다)
      setTreatMemos([]);
      setTreatMemosLoaded(false);
      setVisitHistory([]);
      setVisitHistLoaded(false);
      setTreatImages([]);
      setTreatImagesLoaded(false);
      // T-20260526-foot-VISIT-FOLD-FILTER: 리셋
      setExpandedChartIds(new Set<string>());
      setMemoFilters(new Set<MemoFilter>());
    } else {
      setCustomer(null);
      setCharts([]);
      setSelectedChartId(null);
    }
  }, [open, customerId, loadData, resetForm]);

  // ESC 키 닫기
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onOpenChange(false); }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [open, onOpenChange]);

  // ── 타임라인 선택 ────────────────────────────────────────────────────────────

  function selectChart(chart: MedicalChart) {
    setSelectedChartId(chart.id);
    resetForm(chart);
    setPhrasePopoverVisible(false);
  }

  function selectNew() {
    setSelectedChartId(null);
    resetForm(null);
    setPhrasePopoverVisible(false);
  }

  // ── 저장 ─────────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!customerId || !clinicId || !formDate) return;
    // T-20260526-foot-NAV-ARROW-DUMMY: 더미 차트는 저장 불가
    if (selectedChartId?.startsWith('__dummy__')) {
      toast.error('더미 데이터는 저장할 수 없습니다 (실제 고객 데이터 없음)');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        customer_id: customerId,
        clinic_id: clinicId,
        visit_date: formDate,
        chief_complaint: null,    // legacy field — no longer written
        diagnosis: formDx.trim() || null,
        treatment_record: formTx.trim() || null,
        materials_used: null,     // legacy field
        treatment_result: null,   // legacy field
        clinical_progress: formClinical.trim() || null,
        prescription_items: formRx.length > 0 ? (formRx as unknown as Record<string, unknown>[]) : null,
        created_by: currentUserEmail,
        updated_at: new Date().toISOString(),
      };

      let chartId = selectedChartId;
      if (selectedChartId) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (supabase as any)
          .from('medical_charts')
          .update(payload)
          .eq('id', selectedChartId);
        if (error) throw error;
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any)
          .from('medical_charts')
          .insert(payload)
          .select('id')
          .maybeSingle();
        if (error) throw error;
        chartId = data?.id ?? null;
        if (chartId) setSelectedChartId(chartId);
      }

      // director면 doctor_memo upsert (chart_doctor_memos)
      if (isDirector && chartId) {
        const memoTrimmed = formMemo.trim();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: existing } = await (supabase as any)
          .from('chart_doctor_memos')
          .select('id')
          .eq('medical_chart_id', chartId)
          .maybeSingle();
        if (memoTrimmed) {
          if (existing?.id) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (supabase as any)
              .from('chart_doctor_memos')
              .update({ memo: memoTrimmed, updated_at: new Date().toISOString() })
              .eq('id', existing.id);
          } else {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (supabase as any).from('chart_doctor_memos').insert({
              medical_chart_id: chartId,
              customer_id: customerId,
              clinic_id: clinicId,
              memo: memoTrimmed,
              created_by: currentUserEmail,
            });
          }
        }
      }

      toast.success(selectedChartId ? '진료 기록 수정 완료' : '진료 기록 저장 완료');
      loadData();
    } catch (err: unknown) {
      toast.error(`저장 실패: ${err instanceof Error ? err.message : '알 수 없는 오류'}`);
    } finally {
      setSaving(false);
    }
  };

  // ── 임상경과 상용구 ────────────────────────────────────────────────────────────

  // T-20260526-foot-PHRASE-SLASH AC-2/3: `//` 트리거 (기존 `#` 대체)
  function handleClinicalChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value;
    setFormClinical(value);
    const cursor = e.target.selectionStart ?? value.length;
    const textBefore = value.substring(0, cursor);
    // `//` 입력 후 이어지는 문자를 단축어 query로 캡처
    const match = textBefore.match(/\/\/([^\s/]*)$/);
    if (match) {
      setPhraseQuery(match[1]);
      setPhrasePopoverVisible(true);
    } else {
      setPhrasePopoverVisible(false);
    }
  }

  const filteredPhrases = phraseTemplates.filter(p => {
    if (!phraseQuery) return p.shortcut_key != null;
    return (
      (p.shortcut_key?.startsWith(phraseQuery)) ||
      p.name.includes(phraseQuery)
    );
  }).slice(0, 8);

  function insertPhrase(phrase: PhraseTemplate) {
    const textarea = clinicalRef.current;
    const cursor = textarea?.selectionStart ?? formClinical.length;
    const textBefore = formClinical.substring(0, cursor);
    const textAfter = formClinical.substring(cursor);
    // `//query` 패턴을 상용구 문구로 대체 (AC-3)
    const match = textBefore.match(/\/\/([^\s/]*)$/);
    if (match) {
      const newText = textBefore.substring(0, textBefore.length - match[0].length) + phrase.content + textAfter;
      setFormClinical(newText);
    } else {
      setFormClinical(prev => prev ? prev + '\n' + phrase.content : phrase.content);
    }
    setPhrasePopoverVisible(false);
    setPhraseQuery('');
    setTimeout(() => textarea?.focus(), 50);
  }

  // ── 우측 패널 — 상용구 다중 선택 삽입 ─────────────────────────────────────

  function togglePhraseId(id: number) {
    setSelectedPhraseIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function insertSelectedPhrases() {
    const contents = phraseTemplates
      .filter(p => selectedPhraseIds.has(p.id))
      .map(p => p.content)
      .join('\n');
    if (contents) {
      setFormClinical(prev => prev ? prev + '\n' + contents : contents);
      toast.success(`${selectedPhraseIds.size}개 상용구 삽입됨`);
    }
    setSelectedPhraseIds(new Set());
  }

  // ── 처방세트 적용 ─────────────────────────────────────────────────────────────

  function loadPrescriptionSet(set: PrescriptionSet) {
    setFormRx(set.items);
    toast.success(`"${set.name}" 처방세트 불러왔습니다`);
  }

  // ── 관리 화면 이동 (AC-2: 편집 버튼) ─────────────────────────────────────────

  function handleNavigateToAdmin() {
    onOpenChange(false);
    navigate('/admin/doctor-tools');
  }

  // ── T-20260526-foot-MEDCHART-SYNC: 치료메모 lazy load ─────────────────────────
  const loadTreatMemos = useCallback(async () => {
    if (!customerId || treatMemosLoaded || treatMemosLoading) return;
    setTreatMemosLoading(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from('customer_treatment_memos')
        .select('id, content, created_by_name, created_at, memo_type')
        .eq('customer_id', customerId)
        .order('created_at', { ascending: false })
        .limit(20);
      setTreatMemos((data as TreatmentMemoEntry[]) ?? []);
    } catch {
      // graceful — 테이블 없거나 오류 시 빈 배열 유지
    } finally {
      setTreatMemosLoaded(true);
      setTreatMemosLoading(false);
    }
  }, [customerId, treatMemosLoaded, treatMemosLoading]);

  // ── T-20260526-foot-MEDCHART-SYNC: 방문 이력 lazy load ────────────────────────
  const loadVisitHistory = useCallback(async () => {
    if (!customerId || visitHistLoaded || visitHistLoading) return;
    setVisitHistLoading(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from('check_ins')
        .select('id, checked_in_at, treatment_kind, treatment_memo, doctor_note, status')
        .eq('customer_id', customerId)
        .order('checked_in_at', { ascending: false })
        .limit(30);
      setVisitHistory((data as VisitHistoryEntry[]) ?? []);
    } catch {
      // graceful
    } finally {
      setVisitHistLoaded(true);
      setVisitHistLoading(false);
    }
  }, [customerId, visitHistLoaded, visitHistLoading]);

  // ── T-20260526-foot-MEDCHART-SYNC: 진료이미지 lazy load ───────────────────────
  const loadTreatImages = useCallback(async () => {
    if (!customerId || treatImagesLoaded || treatImagesLoading) return;
    setTreatImagesLoading(true);
    try {
      const storagePath = `customer/${customerId}/treatment-images`;
      const { data: files } = await supabase.storage
        .from('photos')
        .list(storagePath, { limit: 50, sortBy: { column: 'created_at', order: 'desc' } });
      if (files && files.length > 0) {
        const paths = files
          .filter((f) => f.name && !f.name.startsWith('.'))
          .map((f) => `${storagePath}/${f.name}`);
        const { data: urls } = await supabase.storage.from('photos').createSignedUrls(paths, 3600);
        setTreatImages(
          (urls ?? [])
            .filter((u) => u.signedUrl)
            .map((u, i) => ({ path: paths[i], signedUrl: u.signedUrl as string, name: files[i]?.name ?? '' }))
        );
      }
    } catch {
      // graceful
    } finally {
      setTreatImagesLoaded(true);
      setTreatImagesLoading(false);
    }
  }, [customerId, treatImagesLoaded, treatImagesLoading]);

  // ── 탭 전환 시 lazy load 트리거 ────────────────────────────────────────────────
  useEffect(() => {
    if (rightTab === 'treat_memo') loadTreatMemos();
    else if (rightTab === 'visit_hist') loadVisitHistory();
    else if (rightTab === 'images') loadTreatImages();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rightTab]);

  // ── Render ────────────────────────────────────────────────────────────────────

  if (!open) return null;

  // T-20260526-foot-NAV-ARROW-DUMMY (AC-4): 실데이터 없을 때 노란테두리 더미 5건 표시
  const DUMMY_CHARTS: MedicalChart[] = [
    {
      id: '__dummy__1', customer_id: customerId || '', clinic_id: clinicId || '',
      visit_date: '2026-05-20', chief_complaint: null,
      diagnosis: '내성발톱 — 더미 샘플 ①',
      treatment_record: '레이저 시술 15분 (테스트용 데이터)',
      materials_used: null, treatment_result: null,
      clinical_progress: '1회차 시술 후 경과 양호 — 더미 샘플',
      prescription_items: null, created_by: null,
      created_at: '2026-05-20T10:00:00+09:00', updated_at: '2026-05-20T10:00:00+09:00',
    },
    {
      id: '__dummy__2', customer_id: customerId || '', clinic_id: clinicId || '',
      visit_date: '2026-05-13', chief_complaint: null,
      diagnosis: '족저근막염 — 더미 샘플 ②',
      treatment_record: '물리치료 20분 (테스트용 데이터)',
      materials_used: null, treatment_result: null,
      clinical_progress: '2회차 통증 30% 감소 — 더미 샘플',
      prescription_items: null, created_by: null,
      created_at: '2026-05-13T14:00:00+09:00', updated_at: '2026-05-13T14:00:00+09:00',
    },
    {
      id: '__dummy__3', customer_id: customerId || '', clinic_id: clinicId || '',
      visit_date: '2026-05-06', chief_complaint: null,
      diagnosis: '무좀 (백선) — 더미 샘플 ③',
      treatment_record: '레이저 + 연고 처방 (테스트용 데이터)',
      materials_used: null, treatment_result: null,
      clinical_progress: '진균 감소 확인 — 더미 샘플',
      prescription_items: null, created_by: null,
      created_at: '2026-05-06T11:00:00+09:00', updated_at: '2026-05-06T11:00:00+09:00',
    },
    {
      id: '__dummy__4', customer_id: customerId || '', clinic_id: clinicId || '',
      visit_date: '2026-04-29', chief_complaint: null,
      diagnosis: '굳은살 제거 — 더미 샘플 ④',
      treatment_record: '기계적 제거 10분 (테스트용 데이터)',
      materials_used: null, treatment_result: null,
      clinical_progress: '굳은살 80% 제거 완료 — 더미 샘플',
      prescription_items: null, created_by: null,
      created_at: '2026-04-29T15:00:00+09:00', updated_at: '2026-04-29T15:00:00+09:00',
    },
    {
      id: '__dummy__5', customer_id: customerId || '', clinic_id: clinicId || '',
      visit_date: '2026-04-22', chief_complaint: null,
      diagnosis: '티눈 — 더미 샘플 ⑤',
      treatment_record: '티눈 제거술 (테스트용 데이터)',
      materials_used: null, treatment_result: null,
      clinical_progress: '초진 — 티눈 확인 및 계획 수립 — 더미 샘플',
      prescription_items: null, created_by: null,
      created_at: '2026-04-22T09:00:00+09:00', updated_at: '2026-04-22T09:00:00+09:00',
    },
  ];
  // 실데이터 없을 때만 더미 표시
  const displayCharts = charts.length > 0 ? charts : DUMMY_CHARTS;
  const isDummyMode = charts.length === 0;

  // T-20260526-foot-VISIT-FOLD-FILTER: 필터 적용 (OR 로직)
  const filteredDisplayCharts = memoFilters.size === 0
    ? displayCharts
    : displayCharts.filter(c => {
        if (memoFilters.has('treat') && hasTreatMemo(c)) return true;
        if (memoFilters.has('doc') && hasDocMemo(c)) return true;
        if (memoFilters.has('notable') && isNotable(c)) return true;
        return false;
      });

  const expandedCount = filteredDisplayCharts.filter(c => expandedChartIds.has(c.id)).length;
  const allExpanded = filteredDisplayCharts.length > 0 && expandedCount === filteredDisplayCharts.length;

  function expandAll() {
    setExpandedChartIds(prev => {
      const next = new Set(prev);
      filteredDisplayCharts.forEach(c => next.add(c.id));
      return next;
    });
  }
  function collapseAll() {
    setExpandedChartIds(prev => {
      const next = new Set(prev);
      filteredDisplayCharts.forEach(c => next.delete(c.id));
      return next;
    });
  }
  function toggleExpandChart(id: string) {
    setExpandedChartIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleFilter(f: MemoFilter) {
    setMemoFilters(prev => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f); else next.add(f);
      return next;
    });
  }

  const selectedChart = displayCharts.find(c => c.id === selectedChartId) ?? null;
  const chartsIdx = selectedChart ? displayCharts.indexOf(selectedChart) : -1;

  return createPortal(
    <>
      {/* 백드롭 — 클릭 시 닫힘 (AC-2 Drawer 외부 클릭 닫힘) */}
      <div
        className="fixed inset-0 z-[80] bg-black/40"
        onClick={() => onOpenChange(false)}
        aria-hidden="true"
        data-testid="medical-chart-backdrop"
      />

      {/* Drawer 패널 — 우측 슬라이드 인 (AC-2) */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="진료차트"
        className="fixed right-0 top-0 z-[90] h-full bg-background shadow-2xl flex flex-col outline-none animate-in slide-in-from-right duration-300"
        style={{ width: 'min(97vw, 1440px)' }}
        data-testid="medical-chart-drawer"
      >
        {/* ── 헤더 ─────────────────────────────────────────────────────────────── */}
        <div className="flex-none flex items-center justify-between px-5 py-3 border-b bg-background shadow-sm">
          <div className="flex items-center gap-3">
            <Stethoscope className="h-4 w-4 text-teal-600 shrink-0" />
            <span className="text-base font-bold text-teal-700">진료차트</span>
            {customer && (
              <div className="flex items-center gap-2 ml-1">
                <span className="font-semibold">{customer.name}</span>
                {customer.chart_number && (
                  <span className="text-xs text-muted-foreground font-mono">#{customer.chart_number}</span>
                )}
                <span className="text-xs text-muted-foreground">{formatPhone(customer.phone)}</span>
                {customer.birth_date && (
                  <span className="text-xs text-muted-foreground">
                    {/^\d{6}$/.test(customer.birth_date)
                      ? `${customer.birth_date.slice(0, 2)}/${customer.birth_date.slice(2, 4)}/${customer.birth_date.slice(4, 6)}`
                      : customer.birth_date}
                  </span>
                )}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            aria-label="닫기"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* ── 본문: 타임라인 | 진료폼 | 우측 콘텐츠 패널 ─────────────────────── */}
        <div className="flex-1 flex overflow-hidden">
          {loading ? (
            <div className="flex-1 flex items-center justify-center">
              <Loader2 className="h-10 w-10 animate-spin text-teal-400" />
            </div>
          ) : (
            <>
              {/* ── 좌측: 경과 타임라인 (AC-4 + T-20260526-foot-VISIT-FOLD-FILTER) ── */}
              <div
                className="w-56 flex-shrink-0 border-r bg-muted/10 flex flex-col overflow-hidden"
                data-testid="medical-chart-timeline"
              >
                {/* 새 기록 버튼 */}
                <div className="flex-none p-2 border-b">
                  <button
                    type="button"
                    onClick={selectNew}
                    className={`w-full flex items-center justify-center gap-1 rounded-md py-2 text-sm font-medium transition-colors ${
                      selectedChartId === null
                        ? 'bg-teal-600 text-white'
                        : 'border border-teal-300 text-teal-700 hover:bg-teal-50'
                    }`}
                    data-testid="medical-chart-new-btn"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    새 기록
                  </button>
                </div>

                {/* T-20260526-foot-VISIT-FOLD-FILTER: 메모 필터 + 전체 열기/접기 */}
                <div className="flex-none px-2 pt-2 pb-2 border-b space-y-1.5">
                  {/* 메모 종류 필터 chips */}
                  <div className="flex items-center gap-1 flex-wrap">
                    <span className="text-[9px] font-semibold text-muted-foreground shrink-0">필터</span>
                    {FILTER_OPTIONS.map(({ key, label, chipClass }) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => toggleFilter(key)}
                        className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold transition-colors border ${
                          memoFilters.has(key)
                            ? chipClass
                            : 'border-gray-300 text-muted-foreground hover:border-teal-400 hover:text-teal-700'
                        }`}
                        data-testid={`memo-filter-${key}`}
                      >
                        {label}
                      </button>
                    ))}
                    {memoFilters.size > 0 && (
                      <button
                        type="button"
                        onClick={() => setMemoFilters(new Set<MemoFilter>())}
                        className="text-[9px] text-red-500 hover:text-red-700 underline ml-0.5"
                        data-testid="memo-filter-clear"
                      >
                        전체
                      </button>
                    )}
                  </div>

                  {/* 전체 열기/접기 + 카운트 */}
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[9px] text-muted-foreground tabular-nums shrink-0">
                      {expandedCount}/{filteredDisplayCharts.length}건 펼침
                      {memoFilters.size > 0 && (
                        <span className="ml-0.5 text-amber-600">(전체 {displayCharts.length})</span>
                      )}
                    </span>
                    <div className="flex gap-0.5 shrink-0">
                      <button
                        type="button"
                        onClick={expandAll}
                        disabled={filteredDisplayCharts.length === 0 || allExpanded}
                        className="text-[9px] text-teal-600 hover:text-teal-800 disabled:opacity-30 border border-teal-200 rounded px-1 py-0.5 hover:bg-teal-50 transition-colors"
                        data-testid="expand-all-btn"
                        title="모두 펼치기"
                      >
                        모두펼침
                      </button>
                      <button
                        type="button"
                        onClick={collapseAll}
                        disabled={expandedCount === 0}
                        className="text-[9px] text-gray-600 hover:text-gray-800 disabled:opacity-30 border border-gray-200 rounded px-1 py-0.5 hover:bg-gray-50 transition-colors"
                        data-testid="collapse-all-btn"
                        title="모두 접기"
                      >
                        모두접기
                      </button>
                    </div>
                  </div>
                </div>

                {/* 경과 타임라인 레이블 */}
                <div className="flex-none px-2 pt-2 pb-1">
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                    경과 타임라인
                    {isDummyMode && (
                      <span className="ml-1 text-yellow-600 font-bold">[더미]</span>
                    )}
                  </span>
                </div>

                <div className="flex-1 overflow-y-auto">
                  {/* 더미 모드 배너 */}
                  {isDummyMode && (
                    <div className="mx-2 mb-1 rounded border-2 border-yellow-400 bg-yellow-50 px-2 py-1 text-[10px] text-yellow-800 font-semibold">
                      실데이터 없음 — 더미 샘플 표시 중
                    </div>
                  )}

                  {/* 필터 결과 없음 */}
                  {memoFilters.size > 0 && filteredDisplayCharts.length === 0 && (
                    <div className="mx-2 mt-2 rounded border border-dashed p-3 text-[10px] text-muted-foreground text-center">
                      해당 메모가 있는<br />방문 기록 없음
                    </div>
                  )}

                  {/* 아코디언 엔트리 목록 */}
                  {filteredDisplayCharts.map(chart => {
                    const isDummyEntry = chart.id.startsWith('__dummy__');
                    const isExpanded = expandedChartIds.has(chart.id);
                    const hasTreat = hasTreatMemo(chart);
                    const hasDoc = hasDocMemo(chart);
                    const notable = isNotable(chart);
                    return (
                      <div
                        key={chart.id}
                        className="border-b border-border/40"
                        style={isDummyEntry ? { outline: '2px solid #facc15', outlineOffset: '-2px' } : undefined}
                        data-testid="medical-chart-timeline-entry"
                      >
                        {/* 엔트리 헤더 */}
                        <div className="flex items-stretch">
                          {/* 클릭 → 센터 폼 선택 */}
                          <button
                            type="button"
                            onClick={() => selectChart(chart)}
                            className={`flex-1 text-left px-3 py-2.5 hover:bg-muted transition-colors min-w-0 ${
                              selectedChartId === chart.id
                                ? 'bg-teal-50 border-l-2 border-l-teal-500'
                                : ''
                            }`}
                          >
                            <div className="text-[11px] font-semibold text-teal-700 leading-tight">
                              {fmtDateShort(chart.visit_date)}
                              {isDummyEntry && (
                                <span className="ml-1 text-[9px] text-yellow-600 font-bold">더미</span>
                              )}
                            </div>
                            <div className="text-[10px] text-muted-foreground truncate mt-0.5">
                              {chartSummary(chart)}
                            </div>
                            {/* 메모 종류 배지 */}
                            <div className="flex gap-0.5 mt-0.5 flex-wrap">
                              {hasTreat && (
                                <span className="text-[8px] bg-blue-50 text-blue-600 border border-blue-200 rounded-full px-1 leading-4">치료</span>
                              )}
                              {hasDoc && (
                                <span className="text-[8px] bg-teal-50 text-teal-600 border border-teal-200 rounded-full px-1 leading-4">진료</span>
                              )}
                              {notable && (
                                <span className="text-[8px] bg-amber-50 text-amber-600 border border-amber-200 rounded-full px-1 leading-4">⚠특이</span>
                              )}
                            </div>
                          </button>
                          {/* 아코디언 토글 버튼 */}
                          <button
                            type="button"
                            onClick={() => toggleExpandChart(chart.id)}
                            className="px-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex items-center shrink-0"
                            aria-label={isExpanded ? '접기' : '펼치기'}
                            data-testid={`chart-accordion-toggle-${chart.id}`}
                          >
                            <ChevronDown
                              className={`h-3 w-3 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                            />
                          </button>
                        </div>

                        {/* 아코디언 확장 콘텐츠 */}
                        {isExpanded && (
                          <div
                            className="px-3 pb-2.5 pt-1.5 space-y-1.5 border-t border-border/20 bg-muted/5"
                            data-testid={`chart-accordion-content-${chart.id}`}
                          >
                            {hasTreat && (
                              <div>
                                <span className="text-[8px] font-bold text-blue-600 uppercase tracking-wide">치료메모</span>
                                <p className="text-[10px] text-gray-700 line-clamp-4 whitespace-pre-wrap leading-relaxed mt-0.5">
                                  {chart.treatment_record}
                                </p>
                              </div>
                            )}
                            {chart.clinical_progress && (
                              <div>
                                <span className="text-[8px] font-bold text-teal-600 uppercase tracking-wide">임상경과</span>
                                <p className="text-[10px] text-gray-700 line-clamp-4 whitespace-pre-wrap leading-relaxed mt-0.5">
                                  {chart.clinical_progress}
                                </p>
                              </div>
                            )}
                            {isDirector && chart.doctor_memo && (
                              <div>
                                <span className="text-[8px] font-bold text-red-600 uppercase tracking-wide">진료메모</span>
                                <p className="text-[10px] text-gray-700 line-clamp-4 whitespace-pre-wrap leading-relaxed mt-0.5">
                                  {chart.doctor_memo}
                                </p>
                              </div>
                            )}
                            {notable && (
                              <div className="mt-0.5">
                                <span className="text-[9px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 font-semibold">
                                  ⚠ 특이사항 감지
                                </span>
                              </div>
                            )}
                            {!hasTreat && !chart.clinical_progress && !(isDirector && chart.doctor_memo) && (
                              <p className="text-[10px] text-muted-foreground italic">저장된 메모 없음</p>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* ── 중앙: 진료기록 폼 (AC-1 좌측 컬럼) ─────────────────────────── */}
              <div className="flex-1 overflow-y-auto p-5 border-r" data-testid="medical-chart-form">
                <div className="max-w-2xl space-y-4">

                  {/* 타이틀 */}
                  <div className="flex items-center gap-2 pb-1.5 border-b flex-wrap">
                    <span className="text-sm font-semibold text-teal-700">
                      {selectedChartId
                        ? `진료 기록 ${selectedChartId.startsWith('__dummy__') ? '[더미]' : '수정'} — ${fmtDateFull(formDate)}`
                        : '새 진료 기록'}
                    </span>
                    {/* T-20260526-foot-NAV-ARROW-DUMMY: 방문 레코드 간 좌/우 화살표 네비게이션 (AC-2/3) */}
                    {selectedChartId && chartsIdx >= 0 && (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            const prev = displayCharts[chartsIdx - 1];
                            if (prev) selectChart(prev);
                          }}
                          disabled={chartsIdx <= 0}
                          className="rounded p-0.5 hover:bg-muted disabled:opacity-30 transition-colors"
                          aria-label="이전 기록"
                          title="이전 방문 기록"
                          data-testid="chart-nav-prev"
                        >
                          <ChevronLeft className="h-3.5 w-3.5 text-teal-600" />
                        </button>
                        <Badge variant="outline" className="text-[10px] px-1.5">
                          {chartsIdx + 1}/{displayCharts.length}회차
                        </Badge>
                        <button
                          type="button"
                          onClick={() => {
                            const next = displayCharts[chartsIdx + 1];
                            if (next) selectChart(next);
                          }}
                          disabled={chartsIdx >= displayCharts.length - 1}
                          className="rounded p-0.5 hover:bg-muted disabled:opacity-30 transition-colors"
                          aria-label="다음 기록"
                          title="다음 방문 기록"
                          data-testid="chart-nav-next"
                        >
                          <ChevronRight className="h-3.5 w-3.5 text-teal-600" />
                        </button>
                      </div>
                    )}
                    {isDummyMode && selectedChartId?.startsWith('__dummy__') && (
                      <span
                        className="text-[10px] text-yellow-700 font-semibold px-1.5 rounded"
                        style={{ border: '2px solid yellow' }}
                      >
                        더미 — 저장 불가
                      </span>
                    )}
                  </div>

                  {/* 진료일 */}
                  <div>
                    <label className="block text-xs font-semibold text-muted-foreground mb-1">진료일</label>
                    <Input
                      type="date"
                      value={formDate}
                      onChange={(e) => { setFormDate(e.target.value); loadVisitPayments(e.target.value); }}
                      className="h-9 text-sm max-w-[180px]"
                      data-testid="medical-chart-date"
                    />
                  </div>

                  {/* 진단명 */}
                  <div>
                    <label className="block text-xs font-semibold text-muted-foreground mb-1">진단명</label>
                    <Input
                      value={formDx}
                      onChange={(e) => setFormDx(e.target.value)}
                      placeholder="진단명을 입력하세요"
                      className="h-9 text-sm placeholder:text-gray-300"
                      data-testid="medical-chart-diagnosis"
                    />
                  </div>

                  {/* 치료·시술 — 결제내역 자동 연동 (readonly) */}
                  {visitPayments.length > 0 && (
                    <div>
                      <label className="block text-xs font-semibold text-muted-foreground mb-1">
                        치료·시술{' '}
                        <span className="font-normal text-teal-600">(결제내역 자동 연동)</span>
                      </label>
                      <div className="rounded-lg border bg-muted/20 px-3 py-2 space-y-1">
                        {visitPayments.map(pmt => (
                          <div key={pmt.id} className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">{pmt.memo || '결제 항목'}</span>
                            <span className="font-medium">{formatAmount(pmt.amount)}원</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 치료사차트 — 읽기전용 (AC-3) */}
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <label className="text-xs font-semibold text-muted-foreground">치료사차트</label>
                      <span className="text-[10px] text-muted-foreground bg-gray-100 rounded px-1.5 py-0.5">읽기전용</span>
                    </div>
                    <Textarea
                      value={formTx}
                      readOnly
                      disabled
                      placeholder="치료사가 기록한 내용이 여기 표시됩니다"
                      rows={3}
                      className="text-sm resize-none bg-gray-50 text-gray-500 cursor-not-allowed placeholder:text-gray-300 disabled:opacity-100"
                      data-testid="medical-chart-treatment"
                    />
                  </div>

                  {/* 임상경과 — 상용구 단축어 (우측 패널로 이동, // autocomplete 유지) */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-semibold text-muted-foreground">임상경과</label>
                      <span className="text-[10px] text-muted-foreground">//단축어 입력 시 자동완성</span>
                    </div>

                    <div className="relative">
                      <Textarea
                        ref={clinicalRef}
                        value={formClinical}
                        onChange={handleClinicalChange}
                        onBlur={() => { setTimeout(() => setPhrasePopoverVisible(false), 200); }}
                        placeholder="임상경과를 입력하세요  예: //통증감소"
                        rows={5}
                        className="text-sm resize-none placeholder:text-gray-300"
                        data-testid="medical-chart-clinical"
                      />

                      {/* 단축어 팝오버 — // 트리거 autocomplete */}
                      {phrasePopoverVisible && filteredPhrases.length > 0 && (
                        <div
                          className="absolute left-0 top-full z-[110] mt-1 w-72 rounded-lg border bg-popover shadow-lg overflow-hidden"
                          onMouseDown={(e) => e.preventDefault()}
                          data-testid="phrase-autocomplete-popover"
                        >
                          {filteredPhrases.map(p => (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => insertPhrase(p)}
                              className="w-full text-left px-3 py-2 hover:bg-muted flex items-start gap-2 border-b border-border/50 last:border-0"
                            >
                              {p.shortcut_key && (
                                <Badge
                                  variant="secondary"
                                  className="text-[9px] shrink-0 mt-0.5 h-4 px-1 font-mono"
                                >
                                  //{p.shortcut_key}
                                </Badge>
                              )}
                              <div className="min-w-0">
                                <div className="text-xs font-medium truncate">{p.name}</div>
                                <div className="text-[10px] text-muted-foreground line-clamp-1">{p.content}</div>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 처방내역 — 우측 패널에서 선택 후 이 테이블에 반영 */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-semibold text-muted-foreground">처방내역</label>
                      <span className="text-[10px] text-muted-foreground">우측 패널에서 처방세트 선택</span>
                    </div>
                    {formRx.length > 0 ? (
                      <div
                        className="rounded-lg border bg-card overflow-hidden"
                        data-testid="prescription-items-table"
                      >
                        <table className="w-full text-xs">
                          <thead className="bg-muted/40">
                            <tr>
                              <th className="text-left px-3 py-1.5 font-medium">약품·시술</th>
                              <th className="text-left px-2 py-1.5 font-medium hidden sm:table-cell">용량</th>
                              <th className="text-left px-2 py-1.5 font-medium hidden sm:table-cell">경로</th>
                              <th className="text-left px-2 py-1.5 font-medium">횟수/일수</th>
                              <th className="py-1.5 w-6" />
                            </tr>
                          </thead>
                          <tbody>
                            {formRx.map((item, idx) => (
                              <tr key={idx} className="border-t border-border/50">
                                <td className="px-3 py-1.5 font-medium">{item.name}</td>
                                <td className="px-2 py-1.5 text-muted-foreground hidden sm:table-cell">{item.dosage}</td>
                                <td className="px-2 py-1.5 text-muted-foreground hidden sm:table-cell">{item.route}</td>
                                <td className="px-2 py-1.5 text-muted-foreground">
                                  {item.frequency} / {item.days}일
                                </td>
                                <td className="py-1.5 pr-1">
                                  <button
                                    type="button"
                                    onClick={() => setFormRx(prev => prev.filter((_, i) => i !== idx))}
                                    className="h-5 w-5 rounded text-destructive hover:bg-destructive/10 flex items-center justify-center"
                                    aria-label="처방 항목 삭제"
                                  >
                                    <X className="h-3 w-3" />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground text-center">
                        처방내역 없음 — 우측 패널에서 처방세트를 선택하세요
                      </div>
                    )}
                  </div>

                  {/* 진료메모 — 원장 전용 미노출 (AC-3) */}
                  {isDirector ? (
                    <div
                      className="rounded-xl border border-red-100 bg-red-50/30 p-3 space-y-1.5"
                      data-testid="doctor-memo-section"
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <label className="text-xs font-semibold text-red-700">진료메모 (원장 전용)</label>
                        <span className="text-[10px] text-muted-foreground">
                          이 내용은 타 스태프에게 노출되지 않습니다
                        </span>
                      </div>
                      <Textarea
                        value={formMemo}
                        onChange={(e) => setFormMemo(e.target.value)}
                        placeholder="원장 전용 메모를 입력하세요"
                        rows={3}
                        className="text-sm resize-none border-red-200 focus:border-red-400 placeholder:text-gray-300"
                        data-testid="doctor-memo-input"
                      />
                    </div>
                  ) : (
                    /* 비원장: 필드 자체 미표시 (AC-4 시나리오 4) */
                    null
                  )}

                  {/* 저장 버튼 */}
                  <div className="flex gap-3 pt-2 pb-4 border-t">
                    <Button
                      size="lg"
                      className={`flex-1 h-12 text-base ${
                        selectedChartId?.startsWith('__dummy__')
                          ? 'bg-gray-300 hover:bg-gray-300 text-gray-500 cursor-not-allowed'
                          : 'bg-teal-600 hover:bg-teal-700 text-white'
                      }`}
                      onClick={handleSave}
                      disabled={saving || !formDate}
                      data-testid="medical-chart-save-btn"
                    >
                      {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                      {saving
                        ? '저장 중...'
                        : selectedChartId?.startsWith('__dummy__')
                          ? '더미 데이터 — 저장 불가'
                          : selectedChartId
                            ? '수정 저장'
                            : '기록 저장'}
                    </Button>
                  </div>
                </div>
              </div>

              {/* ── 우측 콘텐츠 패널 — 처방세트 / 상용구 / 치료메모 / 진료내역 / 진료이미지 탭 ─ */}
              <div
                className="w-72 flex-shrink-0 flex flex-col bg-muted/5"
                data-testid="medical-chart-right-panel"
              >
                {/* 탭 헤더 — 5개 아이콘+라벨 컴팩트 */}
                <div className="flex-none border-b">
                  {/* 상단 행: 처방세트 / 상용구 (기존) */}
                  <div className="flex border-b border-border/30">
                    {([
                      { key: 'rx', icon: <FlaskConical className="h-3 w-3" />, label: '처방세트' },
                      { key: 'phrase', icon: <BookOpen className="h-3 w-3" />, label: '상용구' },
                    ] as const).map(({ key, icon, label }) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setRightTab(key)}
                        className={`flex-1 flex items-center justify-center gap-1 py-2 text-[11px] font-semibold transition-colors border-b-2 ${
                          rightTab === key
                            ? 'border-teal-500 text-teal-700 bg-background'
                            : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/30'
                        }`}
                        data-testid={`right-panel-tab-${key}`}
                      >
                        {icon}{label}
                      </button>
                    ))}
                  </div>
                  {/* 하단 행: 치료메모 / 진료내역 / 진료이미지 (T-20260526-foot-MEDCHART-SYNC) */}
                  <div className="flex">
                    {([
                      { key: 'treat_memo', icon: <ClipboardList className="h-3 w-3" />, label: '치료메모' },
                      { key: 'visit_hist', icon: <History className="h-3 w-3" />, label: '진료내역' },
                      { key: 'images', icon: <Camera className="h-3 w-3" />, label: '진료이미지' },
                    ] as const).map(({ key, icon, label }) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setRightTab(key)}
                        className={`flex-1 flex items-center justify-center gap-1 py-2 text-[11px] font-semibold transition-colors border-b-2 ${
                          rightTab === key
                            ? 'border-teal-500 text-teal-700 bg-background'
                            : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/30'
                        }`}
                        data-testid={`right-panel-tab-${key}`}
                      >
                        {icon}{label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 탭 콘텐츠 */}
                <div className="flex-1 overflow-y-auto">

                  {/* 처방세트 탭 */}
                  {rightTab === 'rx' && (
                    <div className="p-3 space-y-2" data-testid="right-panel-rx-content">
                      {/* 편집 바로가기 (AC-2) */}
                      <button
                        type="button"
                        onClick={handleNavigateToAdmin}
                        className="w-full flex items-center justify-center gap-1.5 text-[11px] text-teal-600 hover:text-teal-800 border border-teal-200 rounded-md py-1.5 hover:bg-teal-50 transition-colors"
                        data-testid="rx-set-edit-btn"
                      >
                        <Edit2 className="h-3 w-3" />
                        처방세트 관리 화면으로
                      </button>

                      <div className="text-[10px] font-semibold text-muted-foreground px-1 pt-1">
                        클릭하면 처방내역에 적용됩니다
                      </div>

                      {prescriptionSets.length === 0 ? (
                        <div className="rounded-lg border border-dashed p-4 text-xs text-muted-foreground text-center mt-2">
                          등록된 처방세트 없음<br />
                          <span className="text-[10px]">위 버튼으로 추가하세요</span>
                        </div>
                      ) : (
                        prescriptionSets.map(set => (
                          <button
                            key={set.id}
                            type="button"
                            onClick={() => loadPrescriptionSet(set)}
                            className="w-full text-left rounded-lg border bg-card px-3 py-2.5 hover:border-teal-400 hover:bg-teal-50/30 transition-colors"
                            data-testid="rx-set-option"
                          >
                            <div className="font-medium text-xs">{set.name}</div>
                            <div className="text-[10px] text-muted-foreground mt-0.5">
                              {set.items.slice(0, 3).map(i => i.name).join(', ')}
                              {set.items.length > 3 ? ` 외 ${set.items.length - 3}개` : ''}
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  )}

                  {/* 상용구 탭 */}
                  {rightTab === 'phrase' && (
                    <div className="p-3 space-y-2" data-testid="right-panel-phrase-content">
                      {/* 편집 바로가기 (AC-2) */}
                      <button
                        type="button"
                        onClick={handleNavigateToAdmin}
                        className="w-full flex items-center justify-center gap-1.5 text-[11px] text-teal-600 hover:text-teal-800 border border-teal-200 rounded-md py-1.5 hover:bg-teal-50 transition-colors"
                        data-testid="phrase-edit-btn"
                      >
                        <Edit2 className="h-3 w-3" />
                        상용구 관리 화면으로
                      </button>

                      <div className="text-[10px] font-semibold text-muted-foreground px-1 pt-1">
                        선택 후 "삽입" — 임상경과 필드에 추가됩니다
                        {selectedPhraseIds.size > 0 && (
                          <span className="text-teal-600 ml-1">({selectedPhraseIds.size}개 선택됨)</span>
                        )}
                      </div>

                      {phraseTemplates.length === 0 ? (
                        <div className="rounded-lg border border-dashed p-4 text-xs text-muted-foreground text-center mt-2">
                          등록된 상용구 없음<br />
                          <span className="text-[10px]">위 버튼으로 추가하세요</span>
                        </div>
                      ) : (
                        <div className="space-y-0.5">
                          {phraseTemplates.map(p => (
                            <label
                              key={p.id}
                              className="flex items-start gap-2 cursor-pointer hover:bg-muted rounded px-2 py-1.5"
                            >
                              <input
                                type="checkbox"
                                checked={selectedPhraseIds.has(p.id)}
                                onChange={() => togglePhraseId(p.id)}
                                className="mt-0.5 h-3.5 w-3.5 accent-teal-600 shrink-0"
                              />
                              <div className="min-w-0">
                                <div className="flex items-center gap-1">
                                  <span className="text-xs font-medium">{p.name}</span>
                                  {p.shortcut_key && (
                                    <span className="text-[10px] text-muted-foreground font-mono">//{p.shortcut_key}</span>
                                  )}
                                </div>
                                <p className="text-[10px] text-muted-foreground line-clamp-1 mt-0.5">
                                  {p.content}
                                </p>
                              </div>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {/* ── T-20260526-foot-MEDCHART-SYNC: 치료메모 탭 ─────────────── */}
                  {rightTab === 'treat_memo' && (
                    <div className="p-3 space-y-2" data-testid="right-panel-treat-memo-content">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-semibold text-muted-foreground">
                          치료메모 이력 (읽기전용)
                        </span>
                        <span className="text-[9px] text-muted-foreground bg-muted rounded px-1.5 py-0.5">
                          2번차트 3구역
                        </span>
                      </div>
                      {treatMemosLoading ? (
                        <div className="flex justify-center py-6">
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        </div>
                      ) : treatMemos.length === 0 ? (
                        <div className="rounded-lg border border-dashed p-4 text-[11px] text-muted-foreground text-center">
                          등록된 치료메모 없음
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          {treatMemos.map((memo) => (
                            <div
                              key={memo.id}
                              className="rounded border bg-blue-50/40 border-blue-100 px-2.5 py-2 space-y-1"
                              data-testid="treat-memo-item"
                            >
                              <p className="text-[11px] text-gray-800 whitespace-pre-wrap leading-relaxed">{memo.content}</p>
                              <div className="flex items-center justify-between gap-1">
                                <span className="text-[9px] text-muted-foreground">
                                  {memo.created_by_name ?? '알 수 없음'}
                                </span>
                                <span className="text-[9px] text-muted-foreground tabular-nums">
                                  {fmtDateShort(memo.created_at)}
                                </span>
                              </div>
                              {memo.memo_type && (
                                <span className="text-[9px] text-blue-600 bg-blue-100 rounded px-1 py-0.5">
                                  {memo.memo_type}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── T-20260526-foot-MEDCHART-SYNC: 진료내역 탭 ──────────────── */}
                  {rightTab === 'visit_hist' && (
                    <div className="p-3 space-y-2" data-testid="right-panel-visit-hist-content">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-semibold text-muted-foreground">
                          방문 진료내역 (읽기전용)
                        </span>
                        <span className="text-[9px] text-muted-foreground bg-muted rounded px-1.5 py-0.5">
                          2번차트 1구역
                        </span>
                      </div>
                      {visitHistLoading ? (
                        <div className="flex justify-center py-6">
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        </div>
                      ) : visitHistory.length === 0 ? (
                        <div className="rounded-lg border border-dashed p-4 text-[11px] text-muted-foreground text-center">
                          방문 기록 없음
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          {visitHistory.map((ci) => {
                            const treatDetails = (ci.treatment_memo?.details ?? '').trim();
                            const hasTreat = !!treatDetails;
                            const hasDoc = !!ci.doctor_note?.trim();
                            const isCancelled = ci.status === 'cancelled';
                            return (
                              <div
                                key={ci.id}
                                className={`rounded border ${isCancelled ? 'opacity-50 border-gray-200' : 'border-gray-200 bg-white'}`}
                                data-testid="visit-hist-item"
                              >
                                <div className="px-2.5 py-1.5">
                                  <div className="flex items-center justify-between gap-1 mb-0.5">
                                    <span className="text-[11px] font-semibold text-teal-700 tabular-nums">
                                      {fmtDateShort(ci.checked_in_at)}
                                    </span>
                                    {isCancelled && (
                                      <span className="text-[9px] text-red-500 bg-red-50 rounded px-1">취소</span>
                                    )}
                                  </div>
                                  {ci.treatment_kind && (
                                    <p className="text-[11px] text-gray-700 truncate">{ci.treatment_kind}</p>
                                  )}
                                  {hasTreat && (
                                    <div className="mt-1">
                                      <span className="text-[9px] font-semibold text-blue-600 uppercase tracking-wide">치료메모</span>
                                      <p className="text-[10px] text-gray-700 line-clamp-2 whitespace-pre-wrap mt-0.5">{treatDetails}</p>
                                    </div>
                                  )}
                                  {hasDoc && (
                                    <div className="mt-1">
                                      <span className="text-[9px] font-semibold text-violet-600 uppercase tracking-wide">진료메모</span>
                                      <p className="text-[10px] text-gray-700 line-clamp-2 whitespace-pre-wrap mt-0.5">{ci.doctor_note}</p>
                                    </div>
                                  )}
                                  {!ci.treatment_kind && !hasTreat && !hasDoc && (
                                    <p className="text-[10px] text-muted-foreground">기록 없음</p>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── T-20260526-foot-MEDCHART-SYNC: 진료이미지 탭 ─────────────── */}
                  {rightTab === 'images' && (
                    <div className="p-3 space-y-2" data-testid="right-panel-images-content">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-semibold text-muted-foreground">
                          진료이미지 (읽기전용)
                        </span>
                        <span className="text-[9px] text-muted-foreground bg-muted rounded px-1.5 py-0.5">
                          2번차트 1구역
                        </span>
                      </div>
                      {treatImagesLoading ? (
                        <div className="flex justify-center py-6">
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        </div>
                      ) : treatImages.length === 0 ? (
                        <div className="rounded-lg border border-dashed p-4 text-[11px] text-muted-foreground text-center">
                          등록된 진료이미지 없음
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 gap-1.5">
                          {treatImages.map((img) => (
                            <button
                              key={img.path}
                              type="button"
                              onClick={() => window.open(img.signedUrl, '_blank')}
                              className="relative rounded overflow-hidden border border-gray-200 hover:border-teal-400 transition-colors aspect-square bg-muted"
                              title={img.name}
                              data-testid="treat-image-thumb"
                            >
                              <img
                                src={img.signedUrl}
                                alt={img.name}
                                className="w-full h-full object-cover"
                              />
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* 상용구 탭 — 삽입 버튼 (선택 시만 표시) */}
                {rightTab === 'phrase' && selectedPhraseIds.size > 0 && (
                  <div className="flex-none p-3 border-t bg-background">
                    <Button
                      size="sm"
                      className="w-full bg-teal-600 hover:bg-teal-700 text-white h-9 text-xs"
                      onClick={insertSelectedPhrases}
                      data-testid="phrase-insert-btn"
                    >
                      선택한 {selectedPhraseIds.size}개 임상경과에 삽입
                    </Button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}
