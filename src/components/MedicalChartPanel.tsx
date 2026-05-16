/**
 * MedicalChartPanel — 풋센터 진료차트 패널
 * T-20260515-foot-CONTEXT-MENU-4ITEM: AC-2 진료차트 메뉴 항목 — cross-CRM 포팅
 * 원본: T-20260515-crm-MEDICAL-CHART-V1 (happy-flow-queue)
 *
 * T-20260516-foot-MEDICAL-CHART-EXPAND: Sheet(사이드 패널) → 전체화면 오버레이 전환
 * - Sheet 제거, fixed inset-0 z-[9999] 풀스크린 오버레이로 전환
 * - 원장님 전체화면 기입 가능 (AC-1)
 * - 3곳 caller(Dashboard/Customers/Reservations) props 변경 없음 (AC-3)
 *
 * AC-1: 환자 기본정보 헤더
 * AC-2: 주호소/증상 기록 (방문별)
 * AC-3: 진단 기록
 * AC-4: 치료/시술 기록
 * AC-5: 진료 메모 (원장 전용 — director/admin 역할만 표시)
 * AC-6: 경과 타임라인 (최신 상단)
 */
import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/supabase';
import { formatPhone } from '@/lib/format';

// ── 타입 ────────────────────────────────────────────────────────────────────

interface MedicalChart {
  id: string;
  customer_id: string;
  clinic_id: string;
  visit_date: string;
  chief_complaint: string | null;
  diagnosis: string | null;
  treatment_record: string | null;
  materials_used: string | null;
  treatment_result: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // 원장 전용 메모 (chart_doctor_memos에서 merge)
  doctor_memo?: string | null;
}

interface CustomerBasic {
  id: string;
  name: string;
  phone: string;
  birth_date: string | null;
  chart_number: string | null;
}

// ── Props ────────────────────────────────────────────────────────────────────

export interface MedicalChartPanelProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  customerId: string | null;
  clinicId: string;
  currentUserRole: string;
  currentUserEmail: string | null;
}

// ── 역할 판별 ────────────────────────────────────────────────────────────────

const DIRECTOR_ROLES = ['director', 'admin'];
function canViewDoctorMemo(role: string): boolean {
  return DIRECTOR_ROLES.includes(role);
}

// ── Component ────────────────────────────────────────────────────────────────

export default function MedicalChartPanel({
  open,
  onOpenChange,
  customerId,
  clinicId,
  currentUserRole,
  currentUserEmail,
}: MedicalChartPanelProps) {
  const isDirector = canViewDoctorMemo(currentUserRole);

  const [customer, setCustomer] = useState<CustomerBasic | null>(null);
  const [charts, setCharts] = useState<MedicalChart[]>([]);
  const [loading, setLoading] = useState(false);

  // 입력 폼 상태
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formDate, setFormDate] = useState('');
  const [formCC, setFormCC] = useState('');
  const [formDx, setFormDx] = useState('');
  const [formTx, setFormTx] = useState('');
  const [formMaterials, setFormMaterials] = useState('');
  const [formResult, setFormResult] = useState('');
  const [formMemo, setFormMemo] = useState('');
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    if (!customerId || !clinicId) return;
    setLoading(true);
    try {
      const [custRes, chartsRes] = await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any)
          .from('customers')
          .select('id, name, phone, birth_date, chart_number')
          .eq('id', customerId)
          .maybeSingle(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any)
          .from('medical_charts')
          .select('*')
          .eq('customer_id', customerId)
          .eq('clinic_id', clinicId)
          .order('visit_date', { ascending: false }),
      ]);

      if (custRes.data) setCustomer(custRes.data as CustomerBasic);
      const rawCharts: MedicalChart[] = chartsRes.data || [];

      // director면 doctor_memos를 별도 로드 후 merge
      if (isDirector && rawCharts.length > 0) {
        const chartIds = rawCharts.map((c: MedicalChart) => c.id);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: memos } = await (supabase as any)
          .from('chart_doctor_memos')
          .select('medical_chart_id, memo')
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

  useEffect(() => {
    if (open && customerId) {
      loadData();
    } else {
      setCustomer(null);
      setCharts([]);
      setFormOpen(false);
    }
  }, [open, customerId, loadData]);

  const openNewForm = () => {
    setEditingId(null);
    setFormDate(format(new Date(), 'yyyy-MM-dd'));
    setFormCC('');
    setFormDx('');
    setFormTx('');
    setFormMaterials('');
    setFormResult('');
    setFormMemo('');
    setFormOpen(true);
  };

  const openEditForm = (chart: MedicalChart) => {
    setEditingId(chart.id);
    setFormDate(chart.visit_date);
    setFormCC(chart.chief_complaint || '');
    setFormDx(chart.diagnosis || '');
    setFormTx(chart.treatment_record || '');
    setFormMaterials(chart.materials_used || '');
    setFormResult(chart.treatment_result || '');
    setFormMemo(chart.doctor_memo || '');
    setFormOpen(true);
  };

  const handleSave = async () => {
    if (!customerId || !clinicId || !formDate) return;
    setSaving(true);
    try {
      const payload = {
        customer_id: customerId,
        clinic_id: clinicId,
        visit_date: formDate,
        chief_complaint: formCC.trim() || null,
        diagnosis: formDx.trim() || null,
        treatment_record: formTx.trim() || null,
        materials_used: formMaterials.trim() || null,
        treatment_result: formResult.trim() || null,
        created_by: currentUserEmail,
        updated_at: new Date().toISOString(),
      };

      let chartId = editingId;
      if (editingId) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (supabase as any)
          .from('medical_charts')
          .update(payload)
          .eq('id', editingId);
        if (error) throw error;
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any)
          .from('medical_charts')
          .insert(payload)
          .select('id')
          .maybeSingle();
        if (error) throw error;
        chartId = data?.id;
      }

      // director면 doctor_memo 저장 (chart_doctor_memos)
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

      toast.success(editingId ? '진료 기록 수정 완료' : '진료 기록 저장 완료');
      setFormOpen(false);
      loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '저장 실패';
      toast.error(`저장 실패: ${msg}`);
    } finally {
      setSaving(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  if (!open) return null;

  return (
    // T-20260516-foot-MEDICAL-CHART-EXPAND: 전체화면 오버레이 (Sheet → fixed inset-0 z-[9999])
    <div className="fixed inset-0 z-[9999] bg-background flex flex-col">
      {/* 헤더 바 */}
      <div className="flex-none flex items-center justify-between px-6 py-4 border-b bg-background shadow-sm">
        <div className="flex items-center gap-3">
          <span className="text-xl font-bold text-teal-700">진료차트</span>
          {/* AC-1: 환자 기본정보 인라인 */}
          {customer && (
            <div className="flex items-center gap-2 ml-2">
              <span className="text-lg font-semibold">{customer.name}</span>
              {customer.chart_number && (
                <span className="text-sm text-muted-foreground font-mono">#{customer.chart_number}</span>
              )}
              <span className="text-sm text-muted-foreground">{formatPhone(customer.phone)}</span>
              {customer.birth_date && (
                <span className="text-sm text-muted-foreground">
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
          className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          aria-label="닫기"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* 본문 — 스크롤 가능 */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-teal-400 border-t-transparent" />
          </div>
        ) : (
          <div className="max-w-4xl mx-auto px-6 py-6 space-y-6">
            {/* 새 기록 버튼 */}
            {!formOpen && (
              <Button
                size="lg"
                variant="outline"
                onClick={openNewForm}
                className="w-full text-base h-12 border-teal-300 text-teal-700 hover:bg-teal-50"
              >
                + 새 진료 기록 작성
              </Button>
            )}

            {/* 입력 폼 */}
            {formOpen && (
              <div className="rounded-xl border border-teal-200 p-5 space-y-4 bg-teal-50/30">
                <p className="text-base font-semibold text-teal-700">
                  {editingId ? '진료 기록 수정' : '새 진료 기록'}
                </p>

                {/* 방문일 */}
                <div>
                  <label className="block text-sm font-medium mb-1.5">방문일</label>
                  <Input
                    type="date"
                    value={formDate}
                    onChange={(e) => setFormDate(e.target.value)}
                    className="h-10 text-sm max-w-xs"
                  />
                </div>

                {/* AC-2: 주호소/증상 */}
                <div>
                  <label className="block text-sm font-medium mb-1.5">주호소/증상</label>
                  <Textarea
                    value={formCC}
                    onChange={(e) => setFormCC(e.target.value)}
                    placeholder="주호소 및 증상을 기록하세요"
                    rows={3}
                    className="text-sm"
                  />
                </div>

                {/* AC-3: 진단 */}
                <div>
                  <label className="block text-sm font-medium mb-1.5">진단</label>
                  <Input
                    value={formDx}
                    onChange={(e) => setFormDx(e.target.value)}
                    placeholder="진단명 (예: 내성발톱, 무좀)"
                    className="h-10 text-sm"
                  />
                </div>

                {/* AC-4: 치료/시술 */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-sm font-medium mb-1.5">치료/시술</label>
                    <Input
                      value={formTx}
                      onChange={(e) => setFormTx(e.target.value)}
                      placeholder="시술명"
                      className="h-10 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1.5">사용 재료</label>
                    <Input
                      value={formMaterials}
                      onChange={(e) => setFormMaterials(e.target.value)}
                      placeholder="사용 재료"
                      className="h-10 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1.5">결과</label>
                    <Input
                      value={formResult}
                      onChange={(e) => setFormResult(e.target.value)}
                      placeholder="치료 결과"
                      className="h-10 text-sm"
                    />
                  </div>
                </div>

                {/* AC-5: 원장 전용 메모 */}
                {isDirector && (
                  <div className="rounded-lg bg-red-50 border border-red-100 p-3 space-y-1.5">
                    <label className="block text-sm font-semibold text-red-700">
                      진료 메모 (원장 전용)
                    </label>
                    <Textarea
                      value={formMemo}
                      onChange={(e) => setFormMemo(e.target.value)}
                      placeholder="원장 전용 메모 — 타 스태프 미노출"
                      rows={3}
                      className="text-sm border-red-200 focus:border-red-400"
                    />
                  </div>
                )}

                <div className="flex gap-3 pt-1">
                  <Button
                    variant="outline"
                    size="lg"
                    className="flex-1"
                    onClick={() => setFormOpen(false)}
                    disabled={saving}
                  >
                    취소
                  </Button>
                  <Button
                    size="lg"
                    className="flex-1 bg-teal-600 hover:bg-teal-700 text-white"
                    onClick={handleSave}
                    disabled={saving}
                  >
                    {saving ? '저장 중...' : '저장'}
                  </Button>
                </div>
              </div>
            )}

            {/* AC-6: 경과 타임라인 */}
            <div>
              <h4 className="text-base font-semibold mb-4">경과 타임라인</h4>
              {charts.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-10">진료 기록이 없습니다</p>
              ) : (
                <div className="relative space-y-4">
                  {/* 세로 타임라인 선 */}
                  <div className="absolute left-1.5 top-2 bottom-2 w-px bg-border" />
                  {charts.map((chart) => (
                    <div key={chart.id} className="relative pl-7">
                      {/* 타임라인 노드 */}
                      <div className="absolute left-0 top-3 h-3.5 w-3.5 rounded-full bg-teal-500 border-2 border-background shadow-sm" />
                      <div className="rounded-xl border border-border bg-white p-4 space-y-2 shadow-sm">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold text-teal-700">
                            {(() => {
                              try {
                                return format(new Date(chart.visit_date), 'yyyy년 M월 d일 (EEE)', { locale: ko });
                              } catch {
                                return chart.visit_date;
                              }
                            })()}
                          </span>
                          <button
                            type="button"
                            onClick={() => openEditForm(chart)}
                            className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded border border-border hover:bg-muted transition-colors"
                          >
                            수정
                          </button>
                        </div>

                        {/* AC-2: 주호소 */}
                        {chart.chief_complaint && (
                          <div className="text-sm">
                            <span className="font-semibold text-muted-foreground">주호소 </span>
                            {chart.chief_complaint}
                          </div>
                        )}

                        {/* AC-3: 진단 */}
                        {chart.diagnosis && (
                          <div className="text-sm">
                            <span className="font-semibold text-muted-foreground">진단 </span>
                            {chart.diagnosis}
                          </div>
                        )}

                        {/* AC-4: 치료/시술 */}
                        {(chart.treatment_record || chart.materials_used || chart.treatment_result) && (
                          <div className="text-sm text-muted-foreground space-y-0.5">
                            {chart.treatment_record && <p>시술: {chart.treatment_record}</p>}
                            {chart.materials_used && <p>재료: {chart.materials_used}</p>}
                            {chart.treatment_result && <p>결과: {chart.treatment_result}</p>}
                          </div>
                        )}

                        {/* AC-5: 원장 전용 메모 — director에게만 표시 */}
                        {isDirector && chart.doctor_memo && (
                          <div className="rounded-lg px-3 py-2 bg-red-50 border border-red-100">
                            <p className="text-xs font-semibold text-red-700 mb-0.5">원장 메모</p>
                            <p className="text-sm whitespace-pre-wrap">{chart.doctor_memo}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
