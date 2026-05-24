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
 * T-20260522-foot-LASER-TIMER:
 *   AC-1: 치료메모 상단 타이머 버튼 [5분] [15분] [20분] + 카운트다운
 *   AC-2: ends_at 기준 카운트다운 (탭 비활성 대응 — 서버시각 앵커)
 *   AC-4: timer_records 신규 테이블 사용
 *   checkInId prop 추가 (optional — 없으면 타이머 미표시)
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
import { toast } from '@/lib/toast';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import { BookOpen, ChevronRight, Loader2, Plus, Stethoscope, Timer, X } from 'lucide-react';
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

// ── Timer ─────────────────────────────────────────────────────────────────────

interface TimerRecord {
  id: string;
  check_in_id: string;
  duration_minutes: number;
  started_at: string;
  ends_at: string;
  stopped_at: string | null;
}

function formatRemaining(secs: number): string {
  if (secs <= 0) return '00:00';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface MedicalChartPanelProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  customerId: string | null;
  clinicId: string;
  currentUserRole: string;
  currentUserEmail: string | null;
  /** T-20260522-foot-LASER-TIMER: 타이머 기능 활성화. 없으면 타이머 미표시. */
  checkInId?: string | null;
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

// ── Component ─────────────────────────────────────────────────────────────────

export default function MedicalChartPanel({
  open,
  onOpenChange,
  customerId,
  clinicId,
  currentUserRole,
  currentUserEmail,
  checkInId,
}: MedicalChartPanelProps) {
  const isDirector = canViewDoctorMemo(currentUserRole);

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
  const [formTx, setFormTx] = useState('');          // 치료사차트 = treatment_record
  const [formClinical, setFormClinical] = useState(''); // 임상경과
  const [formMemo, setFormMemo] = useState('');       // 원장 전용 메모
  const [formRx, setFormRx] = useState<PrescriptionItem[]>([]); // 처방내역
  const [saving, setSaving] = useState(false);

  // ── 상용구 (임상경과 autocomplete + toggle panel) ─────────────────────────────
  const clinicalRef = useRef<HTMLTextAreaElement>(null);
  const [phrasePopoverVisible, setPhrasePopoverVisible] = useState(false);
  const [phraseQuery, setPhraseQuery] = useState('');
  const [phrasePanelOpen, setPhrasePanelOpen] = useState(false);
  const [selectedPhraseIds, setSelectedPhraseIds] = useState<Set<number>>(new Set());

  // ── 처방세트 다이얼로그 ────────────────────────────────────────────────────────
  const [rxDialogOpen, setRxDialogOpen] = useState(false);

  // ── T-20260522-foot-LASER-TIMER: 타이머 상태 ──────────────────────────────────
  const [activeTimer, setActiveTimer] = useState<TimerRecord | null>(null);
  const [timerRemainingSecs, setTimerRemainingSecs] = useState(0);
  const [timerLoading, setTimerLoading] = useState(false);
  // T-20260523-foot-LASER-TIMER AC-4: 종료 확인 다이얼로그 상태
  const [stopConfirmOpen, setStopConfirmOpen] = useState(false);

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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any)
          .from('phrase_templates')
          .select('id,category,name,content,shortcut_key,is_active')
          .eq('is_active', true)
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

  // ── T-20260522-foot-LASER-TIMER: 활성 타이머 로드 ────────────────────────────

  const loadActiveTimer = useCallback(async () => {
    if (!checkInId) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from('timer_records')
        .select('*')
        .eq('check_in_id', checkInId)
        .is('stopped_at', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      setActiveTimer(data ?? null);
    } catch {
      // 타이머 로드 실패는 무시 (비핵심 기능)
    }
  }, [checkInId]);

  // AC-2: ends_at 기준 카운트다운 — 탭 비활성 대응
  // Date.now() vs ends_at(서버시각 앵커) → 탭 복귀 시 자동 보정
  useEffect(() => {
    if (!activeTimer) { setTimerRemainingSecs(0); return; }
    const tick = () => {
      const remaining = Math.max(0, new Date(activeTimer.ends_at).getTime() - Date.now()) / 1000;
      setTimerRemainingSecs(Math.ceil(remaining));
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [activeTimer]);

  // 타이머 시작
  const handleStartTimer = useCallback(async (minutes: 5 | 15 | 20) => {
    if (!checkInId) return;
    setTimerLoading(true);
    try {
      const now = new Date();
      const ends = new Date(now.getTime() + minutes * 60 * 1000);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('timer_records')
        .insert({
          check_in_id: checkInId,
          clinic_id: clinicId,
          duration_minutes: minutes,
          started_at: now.toISOString(),
          ends_at: ends.toISOString(),
          created_by: currentUserEmail,
        })
        .select('*')
        .maybeSingle();
      if (error) throw error;
      setActiveTimer(data);
      toast.success(`레이저 타이머 ${minutes}분 시작`);
    } catch (err: unknown) {
      toast.error(`타이머 시작 실패: ${err instanceof Error ? err.message : '오류'}`);
    } finally {
      setTimerLoading(false);
    }
  }, [checkInId, clinicId, currentUserEmail]);

  // 타이머 중지 (T-20260523 AC-4: confirm 후 호출)
  const handleStopTimer = useCallback(async () => {
    if (!activeTimer) return;
    setTimerLoading(true);
    setStopConfirmOpen(false);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from('timer_records')
        .update({ stopped_at: new Date().toISOString() })
        .eq('id', activeTimer.id);
      if (error) throw error;
      setActiveTimer(null);
      toast.info('레이저 타이머 종료');
    } catch (err: unknown) {
      toast.error(`타이머 종료 실패: ${err instanceof Error ? err.message : '오류'}`);
    } finally {
      setTimerLoading(false);
    }
  }, [activeTimer]);

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
      setPhrasePanelOpen(false);
      setPhrasePopoverVisible(false);
      // T-20260522-foot-LASER-TIMER: 패널 열릴 때 활성 타이머 로드
      if (checkInId) loadActiveTimer();
    } else {
      setCustomer(null);
      setCharts([]);
      setSelectedChartId(null);
      setActiveTimer(null);
      setStopConfirmOpen(false); // T-20260523 AC-4: 패널 닫힐 때 confirm 리셋
    }
  }, [open, customerId, checkInId, loadData, resetForm, loadActiveTimer]);

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
    setPhrasePanelOpen(false);
  }

  function selectNew() {
    setSelectedChartId(null);
    resetForm(null);
    setPhrasePopoverVisible(false);
    setPhrasePanelOpen(false);
  }

  // ── 저장 ─────────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!customerId || !clinicId || !formDate) return;
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

  function handleClinicalChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value;
    setFormClinical(value);
    const cursor = e.target.selectionStart ?? value.length;
    const textBefore = value.substring(0, cursor);
    const match = textBefore.match(/#(\w*)$/);
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
    const match = textBefore.match(/#(\w*)$/);
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
    }
    setSelectedPhraseIds(new Set());
    setPhrasePanelOpen(false);
  }

  // ── 처방세트 로드 ─────────────────────────────────────────────────────────────

  function loadPrescriptionSet(set: PrescriptionSet) {
    setFormRx(set.items);
    setRxDialogOpen(false);
    toast.success(`"${set.name}" 처방세트 불러왔습니다`);
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  if (!open) return null;

  const selectedChart = charts.find(c => c.id === selectedChartId) ?? null;
  const chartsIdx = selectedChart ? charts.indexOf(selectedChart) : -1;

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
        style={{ width: 'min(95vw, 1280px)' }}
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

        {/* ── 본문: 좌측 타임라인 + 우측 컴팩트 폼 ────────────────────────────── */}
        <div className="flex-1 flex overflow-hidden">
          {loading ? (
            <div className="flex-1 flex items-center justify-center">
              <Loader2 className="h-10 w-10 animate-spin text-teal-400" />
            </div>
          ) : (
            <>
              {/* ── 좌측: 경과 타임라인 (AC-4) ──────────────────────────────────── */}
              <div
                className="w-44 flex-shrink-0 border-r bg-muted/10 flex flex-col overflow-hidden"
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

                {/* 경과 타임라인 목록 — 최신 상단 (최신순 정렬 유지) */}
                <div className="flex-none px-2 pt-2 pb-1">
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">경과 타임라인</span>
                </div>
                <div className="flex-1 overflow-y-auto">
                  {charts.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-8 px-3">기록 없음</p>
                  ) : (
                    charts.map(chart => (
                      <button
                        key={chart.id}
                        type="button"
                        onClick={() => selectChart(chart)}
                        className={`w-full text-left px-3 py-2.5 hover:bg-muted transition-colors border-b border-border/40 relative ${
                          selectedChartId === chart.id
                            ? 'bg-teal-50 border-l-2 border-l-teal-500'
                            : ''
                        }`}
                        data-testid="medical-chart-timeline-entry"
                      >
                        <div className="text-[11px] font-semibold text-teal-700 leading-tight">
                          {fmtDateShort(chart.visit_date)}
                        </div>
                        <div className="text-[10px] text-muted-foreground truncate mt-0.5">
                          {chartSummary(chart)}
                        </div>
                        {selectedChartId === chart.id && (
                          <ChevronRight className="h-3 w-3 absolute right-1 top-1/2 -translate-y-1/2 text-teal-500" />
                        )}
                      </button>
                    ))
                  )}
                </div>
              </div>

              {/* ── 우측: 컴팩트 폼 (AC-3) ────────────────────────────────────── */}
              <div className="flex-1 overflow-y-auto p-5" data-testid="medical-chart-form">
                <div className="max-w-3xl space-y-4">

                  {/* T-20260522-foot-LASER-TIMER AC-1: 타이머 버튼 + 카운트다운 */}
                  {checkInId && (
                    <div
                      className={`rounded-xl border p-3 flex flex-col gap-2 ${
                        activeTimer
                          ? timerRemainingSecs <= 60
                            ? 'border-red-400 bg-red-50'
                            : 'border-blue-300 bg-blue-50'
                          : 'border-muted bg-muted/20'
                      }`}
                      data-testid="laser-timer-panel"
                    >
                      <div className="flex items-center gap-2">
                        <Timer className="h-4 w-4 text-blue-600 shrink-0" />
                        <span className="text-sm font-semibold text-blue-700">비가열 레이저 타이머</span>
                        {activeTimer && (
                          <span
                            className={`ml-auto tabular-nums font-mono text-xl font-bold ${
                              timerRemainingSecs <= 60 ? 'text-red-600' : 'text-blue-700'
                            }`}
                            data-testid="laser-timer-countdown"
                          >
                            {formatRemaining(timerRemainingSecs)}
                          </span>
                        )}
                      </div>

                      {!activeTimer ? (
                        /* 타이머 미실행 — 시작 버튼 3종 */
                        <div className="flex gap-2" data-testid="laser-timer-start-buttons">
                          {([5, 15, 20] as const).map((min) => (
                            <button
                              key={min}
                              type="button"
                              disabled={timerLoading}
                              onClick={() => handleStartTimer(min)}
                              className="flex-1 rounded-lg border-2 border-blue-400 bg-white text-blue-700 font-bold text-lg py-2.5 hover:bg-blue-50 active:bg-blue-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                              data-testid={`laser-timer-btn-${min}`}
                            >
                              {timerLoading ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : `${min}분`}
                            </button>
                          ))}
                        </div>
                      ) : (
                        /* 타이머 실행 중 — 진행 바 + 중지 버튼 */
                        <div className="space-y-2">
                          <div className="w-full h-2 rounded-full bg-blue-100 overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${
                                timerRemainingSecs <= 60 ? 'bg-red-500' : 'bg-blue-500'
                              }`}
                              style={{
                                width: `${Math.min(100, (timerRemainingSecs / (activeTimer.duration_minutes * 60)) * 100)}%`,
                              }}
                            />
                          </div>
                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>{activeTimer.duration_minutes}분 타이머</span>
                            {/* T-20260523-foot-LASER-TIMER AC-4: 종료 전 확인 다이얼로그 */}
                            <button
                              type="button"
                              disabled={timerLoading}
                              onClick={() => setStopConfirmOpen(true)}
                              className="flex items-center gap-1 rounded border border-red-300 bg-white text-red-600 text-xs font-medium px-2 py-1 hover:bg-red-50 transition-colors disabled:opacity-50"
                              data-testid="laser-timer-stop-btn"
                            >
                              {timerLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : '■ 종료'}
                            </button>
                          </div>

                          {/* 종료 확인 인라인 박스 */}
                          {stopConfirmOpen && (
                            <div
                              className="mt-1 rounded-lg border border-red-300 bg-red-50 p-2.5 flex flex-col gap-2"
                              data-testid="laser-timer-stop-confirm"
                            >
                              <p className="text-xs text-red-700 font-medium">타이머를 종료하시겠습니까?</p>
                              <div className="flex gap-2 justify-end">
                                <button
                                  type="button"
                                  onClick={() => setStopConfirmOpen(false)}
                                  className="rounded border border-gray-300 bg-white text-gray-600 text-xs font-medium px-3 py-1 hover:bg-gray-50 transition-colors"
                                  data-testid="laser-timer-stop-cancel"
                                >
                                  취소
                                </button>
                                <button
                                  type="button"
                                  disabled={timerLoading}
                                  onClick={() => { setStopConfirmOpen(false); handleStopTimer(); }}
                                  className="rounded bg-red-500 text-white text-xs font-semibold px-3 py-1 hover:bg-red-600 transition-colors disabled:opacity-50"
                                  data-testid="laser-timer-stop-confirm-btn"
                                >
                                  {timerLoading ? <Loader2 className="h-3 w-3 animate-spin inline" /> : '종료'}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* 타이틀 */}
                  <div className="flex items-center gap-2 pb-1.5 border-b">
                    <span className="text-sm font-semibold text-teal-700">
                      {selectedChartId
                        ? `진료 기록 수정 — ${fmtDateFull(formDate)}`
                        : '새 진료 기록'}
                    </span>
                    {selectedChartId && chartsIdx >= 0 && (
                      <Badge variant="outline" className="text-[10px] px-1.5">
                        {chartsIdx + 1}/{charts.length}회차
                      </Badge>
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
                      placeholder="진단명 (예: 내성발톱, 무좀)"
                      className="h-9 text-sm"
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

                  {/* 치료사차트 — treatment_record */}
                  <div>
                    <label className="block text-xs font-semibold text-muted-foreground mb-1">치료사차트</label>
                    <Textarea
                      value={formTx}
                      onChange={(e) => setFormTx(e.target.value)}
                      placeholder="치료사 기록"
                      rows={3}
                      className="text-sm resize-none"
                      data-testid="medical-chart-treatment"
                    />
                  </div>

                  {/* 임상경과 — 상용구 단축어 + 토글 패널 (AC-3) */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-semibold text-muted-foreground">임상경과</label>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-muted-foreground">#단축어 또는</span>
                        <button
                          type="button"
                          onClick={() => { setPhrasePanelOpen(v => !v); setPhrasePopoverVisible(false); }}
                          className="flex items-center gap-1 text-[11px] text-teal-600 hover:text-teal-800 border border-teal-200 rounded px-1.5 py-0.5 hover:bg-teal-50 transition-colors"
                          data-testid="phrase-panel-toggle"
                        >
                          <BookOpen className="h-3 w-3" />
                          상용구
                        </button>
                      </div>
                    </div>

                    <div className="relative">
                      <Textarea
                        ref={clinicalRef}
                        value={formClinical}
                        onChange={handleClinicalChange}
                        onBlur={() => { setTimeout(() => setPhrasePopoverVisible(false), 200); }}
                        placeholder="임상경과 기록 — #단축어 입력 시 자동완성 (예: #통증감소)"
                        rows={4}
                        className="text-sm resize-none"
                        data-testid="medical-chart-clinical"
                      />

                      {/* 단축어 팝오버 */}
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
                                  #{p.shortcut_key}
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

                    {/* 토글 상용구 패널 (체크박스 다중 선택) */}
                    {phrasePanelOpen && (
                      <div
                        className="mt-2 rounded-lg border bg-card p-3"
                        data-testid="phrase-toggle-panel"
                      >
                        <div className="text-xs font-semibold mb-2 text-muted-foreground">
                          상용구 선택
                          {selectedPhraseIds.size > 0 && (
                            <span className="text-teal-600 ml-1">({selectedPhraseIds.size}개 선택됨)</span>
                          )}
                        </div>
                        <div className="space-y-0.5 max-h-52 overflow-y-auto">
                          {phraseTemplates.length === 0 ? (
                            <p className="text-xs text-muted-foreground text-center py-4">
                              등록된 상용구 없음 — 어드민 설정에서 추가하세요
                            </p>
                          ) : (
                            phraseTemplates.map(p => (
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
                                      <span className="text-[10px] text-muted-foreground font-mono">#{p.shortcut_key}</span>
                                    )}
                                  </div>
                                  <p className="text-[10px] text-muted-foreground line-clamp-1 mt-0.5">
                                    {p.content}
                                  </p>
                                </div>
                              </label>
                            ))
                          )}
                        </div>
                        {selectedPhraseIds.size > 0 && (
                          <Button
                            size="sm"
                            className="mt-2 w-full bg-teal-600 hover:bg-teal-700 text-white h-8 text-xs"
                            onClick={insertSelectedPhrases}
                          >
                            선택한 {selectedPhraseIds.size}개 삽입
                          </Button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* 처방내역 — 처방세트 불러오기 (AC-3) */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-semibold text-muted-foreground">처방내역</label>
                      <button
                        type="button"
                        onClick={() => setRxDialogOpen(true)}
                        className="text-[11px] text-teal-600 hover:text-teal-800 border border-teal-200 rounded px-1.5 py-0.5 hover:bg-teal-50 transition-colors"
                        data-testid="rx-set-load-btn"
                      >
                        처방세트 불러오기
                      </button>
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
                        처방내역 없음 — "처방세트 불러오기"로 추가
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
                        placeholder="원장 전용 메모"
                        rows={3}
                        className="text-sm resize-none border-red-200 focus:border-red-400"
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
                      className="flex-1 bg-teal-600 hover:bg-teal-700 text-white h-12 text-base"
                      onClick={handleSave}
                      disabled={saving || !formDate}
                      data-testid="medical-chart-save-btn"
                    >
                      {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                      {saving ? '저장 중...' : selectedChartId ? '수정 저장' : '기록 저장'}
                    </Button>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* 처방세트 다이얼로그 */}
      {rxDialogOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setRxDialogOpen(false)}
            aria-hidden="true"
          />
          <div className="relative bg-background rounded-xl shadow-2xl w-[480px] max-w-[92vw] max-h-[72vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <span className="font-semibold text-sm">처방세트 불러오기</span>
              <button
                type="button"
                onClick={() => setRxDialogOpen(false)}
                className="rounded p-1 hover:bg-muted text-muted-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="overflow-y-auto flex-1 p-4 space-y-2">
              {prescriptionSets.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  등록된 처방세트 없음 — 어드민 설정에서 추가하세요
                </p>
              ) : (
                prescriptionSets.map(set => (
                  <button
                    key={set.id}
                    type="button"
                    onClick={() => loadPrescriptionSet(set)}
                    className="w-full text-left rounded-lg border bg-card px-4 py-3 hover:border-teal-400 hover:bg-teal-50/30 transition-colors"
                    data-testid="rx-set-option"
                  >
                    <div className="font-medium text-sm">{set.name}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {set.items.slice(0, 3).map(i => i.name).join(', ')}
                      {set.items.length > 3 ? ` 외 ${set.items.length - 3}개` : ''}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>,
    document.body,
  );
}
