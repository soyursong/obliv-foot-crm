/**
 * ProgressPlansTab — 경과분석 플랜 관리 탭
 * T-20260526-foot-PROGRESS-CHECKPOINT Phase 1 (AC-2)
 *
 * 역할: 패키지 타입별 경과분석 회차(체크포인트) CRUD
 * 접근: admin / manager / director 전용
 * 탑재: DoctorTools.tsx "경과분석 플랜" 탭
 *
 * package_progress_plans 테이블:
 *   id, clinic_id, package_type, session_milestone, label,
 *   notify_staff, notify_patient, is_active
 *
 * Phase 2에서 reservations.anticipated_session_number와 연동됨
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useClinic } from '@/hooks/useClinic';
import { useAuth } from '@/lib/auth';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Loader2, Plus, Pencil, Trash2, Bell, BellOff, ChevronDown, ChevronRight } from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ProgressPlan {
  id: string;
  clinic_id: string;
  package_type: string;
  session_milestone: number;
  label: string;
  notify_staff: boolean;
  notify_patient: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface PlanForm {
  package_type: string;
  session_milestone: string;  // string for input
  label: string;
  notify_staff: boolean;
  notify_patient: boolean;
  is_active: boolean;
}

// ── 패키지 타입 메타데이터 ────────────────────────────────────────────────────

const PACKAGE_TYPE_OPTIONS = [
  { value: 'package1', label: '패키지1', total: 12 },
  { value: 'blelabel', label: '블레라벨', total: 36 },
  { value: 'special', label: '스페셜', total: 12 },
  { value: 'other', label: '기타', total: null },
] as const;

function getPackageTypeLabel(packageType: string): string {
  const found = PACKAGE_TYPE_OPTIONS.find(o => o.value === packageType);
  return found ? found.label : packageType;
}

function getPackageTypeBadgeColor(packageType: string): string {
  switch (packageType) {
    case 'package1': return 'bg-teal-100 text-teal-800 border-teal-300';
    case 'blelabel': return 'bg-blue-100 text-blue-800 border-blue-300';
    case 'special': return 'bg-purple-100 text-purple-800 border-purple-300';
    default: return 'bg-gray-100 text-gray-700 border-gray-300';
  }
}

// ── 기본 폼 상태 ──────────────────────────────────────────────────────────────

const EMPTY_FORM: PlanForm = {
  package_type: 'package1',
  session_milestone: '',
  label: '',
  notify_staff: true,
  notify_patient: false,
  is_active: true,
};

// ── 컴포넌트 ──────────────────────────────────────────────────────────────────

export default function ProgressPlansTab() {
  const clinic = useClinic();
  const { profile } = useAuth();
  const canWrite = ['admin', 'manager', 'director'].includes(profile?.role ?? '');

  const [plans, setPlans] = useState<ProgressPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // 다이얼로그
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<PlanForm>(EMPTY_FORM);

  // 패키지타입별 접기/펼치기
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // ── 데이터 로드 ────────────────────────────────────────────────────────────

  const fetchPlans = useCallback(async () => {
    if (!clinic) return;
    setLoading(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from('package_progress_plans')
      .select('*')
      .eq('clinic_id', clinic.id)
      .order('package_type', { ascending: true })
      .order('session_milestone', { ascending: true });
    setLoading(false);
    if (error) {
      toast.error(`경과분석 플랜 로딩 실패: ${error.message}`);
      return;
    }
    setPlans((data ?? []) as ProgressPlan[]);
  }, [clinic]);

  useEffect(() => {
    fetchPlans();
  }, [fetchPlans]);

  // ── 패키지 타입별 그룹핑 ──────────────────────────────────────────────────

  const grouped = plans.reduce<Record<string, ProgressPlan[]>>((acc, p) => {
    (acc[p.package_type] ??= []).push(p);
    return acc;
  }, {});

  const packageTypes = Object.keys(grouped).sort((a, b) => {
    const ORDER: Record<string, number> = { package1: 0, blelabel: 1, special: 2 };
    return (ORDER[a] ?? 99) - (ORDER[b] ?? 99);
  });

  // ── 다이얼로그 열기 ────────────────────────────────────────────────────────

  function openCreate(defaultType?: string) {
    setEditingId(null);
    setForm({ ...EMPTY_FORM, package_type: defaultType ?? 'package1' });
    setDialogOpen(true);
  }

  function openEdit(plan: ProgressPlan) {
    setEditingId(plan.id);
    setForm({
      package_type: plan.package_type,
      session_milestone: String(plan.session_milestone),
      label: plan.label,
      notify_staff: plan.notify_staff,
      notify_patient: plan.notify_patient,
      is_active: plan.is_active,
    });
    setDialogOpen(true);
  }

  // ── 저장 ──────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!clinic) return;
    const milestone = parseInt(form.session_milestone, 10);
    if (!form.package_type.trim()) {
      toast.error('패키지 타입을 선택해주세요');
      return;
    }
    if (!milestone || milestone <= 0) {
      toast.error('유효한 회차 번호를 입력해주세요 (1 이상)');
      return;
    }
    if (!form.label.trim()) {
      toast.error('레이블을 입력해주세요');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        clinic_id: clinic.id,
        package_type: form.package_type.trim(),
        session_milestone: milestone,
        label: form.label.trim(),
        notify_staff: form.notify_staff,
        notify_patient: form.notify_patient,
        is_active: form.is_active,
        updated_at: new Date().toISOString(),
      };

      if (editingId) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (supabase as any)
          .from('package_progress_plans')
          .update(payload)
          .eq('id', editingId);
        if (error) throw error;
        toast.success('체크포인트 수정 완료');
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (supabase as any)
          .from('package_progress_plans')
          .insert({ ...payload, created_by: profile?.email });
        if (error) {
          if (error.code === '23505') {
            toast.error(`이미 존재하는 체크포인트입니다 — ${getPackageTypeLabel(form.package_type)} ${milestone}회차`);
            return;
          }
          throw error;
        }
        toast.success('체크포인트 추가 완료');
      }

      setDialogOpen(false);
      fetchPlans();
    } catch (err: unknown) {
      toast.error(`저장 실패: ${err instanceof Error ? err.message : '알 수 없는 오류'}`);
    } finally {
      setSaving(false);
    }
  };

  // ── 활성/비활성 토글 ──────────────────────────────────────────────────────

  const toggleActive = async (plan: ProgressPlan) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from('package_progress_plans')
      .update({ is_active: !plan.is_active, updated_at: new Date().toISOString() })
      .eq('id', plan.id);
    if (error) {
      toast.error(`변경 실패: ${error.message}`);
      return;
    }
    setPlans(prev => prev.map(p => p.id === plan.id ? { ...p, is_active: !p.is_active } : p));
  };

  // ── 삭제 ──────────────────────────────────────────────────────────────────

  const handleDelete = async (plan: ProgressPlan) => {
    if (!window.confirm(`"${getPackageTypeLabel(plan.package_type)} ${plan.session_milestone}회차 — ${plan.label}" 를 삭제하시겠습니까?`)) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from('package_progress_plans')
      .delete()
      .eq('id', plan.id);
    if (error) {
      toast.error(`삭제 실패: ${error.message}`);
      return;
    }
    toast.success('체크포인트 삭제 완료');
    setPlans(prev => prev.filter(p => p.id !== plan.id));
  };

  // ── 레이블 자동완성 (회차 입력 시) ───────────────────────────────────────

  const autoLabel = (packageType: string, milestone: number): string => {
    const meta = PACKAGE_TYPE_OPTIONS.find(o => o.value === packageType);
    if (!meta) return `${milestone}회차 경과분석`;
    const isLast = meta.total !== null && milestone === meta.total;
    if (isLast) return `${milestone}회 최종 경과분석`;
    if (milestone % 6 === 0) return `${milestone}회 중간 경과분석`;
    return `${milestone}회차 경과분석`;
  };

  const handleMilestoneChange = (value: string) => {
    const n = parseInt(value, 10);
    setForm(prev => ({
      ...prev,
      session_milestone: value,
      // 레이블이 비어있거나 자동생성 패턴인 경우에만 자동 업데이트
      label: (!prev.label || prev.label.match(/^\d+회/))
        ? (isNaN(n) || n <= 0 ? '' : autoLabel(prev.package_type, n))
        : prev.label,
    }));
  };

  const handlePackageTypeChange = (value: string) => {
    const n = parseInt(form.session_milestone, 10);
    setForm(prev => ({
      ...prev,
      package_type: value,
      label: (!prev.label || prev.label.match(/^\d+회/))
        ? (isNaN(n) || n <= 0 ? '' : autoLabel(value, n))
        : prev.label,
    }));
  };

  // ── Render ────────────────────────────────────────────────────────────────

  if (!canWrite) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
        admin / manager / director 권한이 필요합니다.
      </div>
    );
  }

  return (
    <div className="space-y-5" data-testid="progress-plans-tab">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">경과분석 플랜 설정</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            패키지 타입별로 경과분석이 필요한 회차를 정의합니다.
            <br />
            <span className="text-teal-600">Phase 2</span>에서 해당 회차 예약 시 스태프 알림 + 예약현황 배지로 연동됩니다.
          </p>
        </div>
        <Button
          size="sm"
          className="bg-teal-600 hover:bg-teal-700 text-white gap-1.5 h-9"
          onClick={() => openCreate()}
          data-testid="progress-plan-add-btn"
        >
          <Plus className="h-3.5 w-3.5" />
          체크포인트 추가
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-teal-500" />
        </div>
      ) : plans.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-teal-200 bg-teal-50/30 p-10 text-center">
          <p className="text-sm font-medium text-teal-700">등록된 체크포인트가 없습니다</p>
          <p className="text-xs text-muted-foreground mt-1">
            "체크포인트 추가" 버튼으로 패키지 타입별 경과분석 회차를 설정하세요.
          </p>
          <Button
            size="sm"
            className="mt-4 bg-teal-600 hover:bg-teal-700 text-white gap-1.5"
            onClick={() => openCreate()}
          >
            <Plus className="h-3.5 w-3.5" />
            첫 번째 체크포인트 추가
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {packageTypes.map(ptype => {
            const group = grouped[ptype] ?? [];
            const isCollapsed = collapsed[ptype] ?? false;
            const activeCount = group.filter(p => p.is_active).length;

            return (
              <div
                key={ptype}
                className="rounded-xl border bg-card shadow-sm overflow-hidden"
                data-testid={`progress-plan-group-${ptype}`}
              >
                {/* 그룹 헤더 */}
                <button
                  type="button"
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/40 transition-colors"
                  onClick={() => setCollapsed(prev => ({ ...prev, [ptype]: !isCollapsed }))}
                >
                  <div className="flex items-center gap-2.5">
                    {isCollapsed
                      ? <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      : <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    }
                    <span
                      className={`inline-flex items-center rounded border px-2.5 py-0.5 text-xs font-semibold ${getPackageTypeBadgeColor(ptype)}`}
                    >
                      {getPackageTypeLabel(ptype)}
                    </span>
                    <span className="text-sm font-medium">{ptype}</span>
                    <Badge variant="outline" className="text-[10px] h-4 px-1.5">
                      {activeCount}/{group.length}건 활성
                    </Badge>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1 text-xs text-teal-600 hover:bg-teal-50"
                    onClick={(e) => { e.stopPropagation(); openCreate(ptype); }}
                    data-testid={`progress-plan-add-${ptype}`}
                  >
                    <Plus className="h-3 w-3" />
                    추가
                  </Button>
                </button>

                {/* 체크포인트 목록 */}
                {!isCollapsed && (
                  <div className="border-t">
                    {group.length === 0 ? (
                      <p className="px-4 py-3 text-xs text-muted-foreground">
                        체크포인트 없음
                      </p>
                    ) : (
                      <table className="w-full text-xs">
                        <thead className="bg-muted/30">
                          <tr>
                            <th className="text-left px-4 py-2 font-medium text-muted-foreground w-16">회차</th>
                            <th className="text-left px-3 py-2 font-medium text-muted-foreground">레이블</th>
                            <th className="text-left px-3 py-2 font-medium text-muted-foreground w-24">스태프 알림</th>
                            <th className="text-left px-3 py-2 font-medium text-muted-foreground w-24">환자 SMS</th>
                            <th className="text-left px-3 py-2 font-medium text-muted-foreground w-16">활성</th>
                            <th className="py-2 w-20 text-right pr-3 font-medium text-muted-foreground">작업</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.map((plan, idx) => (
                            <tr
                              key={plan.id}
                              className={`border-t border-border/40 ${!plan.is_active ? 'opacity-50' : ''}`}
                              data-testid="progress-plan-row"
                            >
                              <td className="px-4 py-2.5">
                                <span className="font-mono font-semibold text-teal-700">
                                  {plan.session_milestone}회
                                </span>
                              </td>
                              <td className="px-3 py-2.5">
                                <span className="font-medium">{plan.label}</span>
                              </td>
                              <td className="px-3 py-2.5">
                                {plan.notify_staff
                                  ? <span className="flex items-center gap-1 text-teal-600"><Bell className="h-3 w-3" />알림</span>
                                  : <span className="text-muted-foreground flex items-center gap-1"><BellOff className="h-3 w-3" />없음</span>
                                }
                              </td>
                              <td className="px-3 py-2.5">
                                {plan.notify_patient
                                  ? <span className="flex items-center gap-1 text-blue-600"><Bell className="h-3 w-3" />SMS</span>
                                  : <span className="text-muted-foreground text-[10px]">비활성</span>
                                }
                              </td>
                              <td className="px-3 py-2.5">
                                <Switch
                                  checked={plan.is_active}
                                  onCheckedChange={() => toggleActive(plan)}
                                  className="scale-75 data-[state=checked]:bg-teal-600"
                                  aria-label={`${plan.label} 활성 토글`}
                                  data-testid={`progress-plan-toggle-${idx}`}
                                />
                              </td>
                              <td className="py-2.5 pr-3 text-right">
                                <div className="flex items-center justify-end gap-1">
                                  <button
                                    type="button"
                                    onClick={() => openEdit(plan)}
                                    className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                                    aria-label="수정"
                                    data-testid={`progress-plan-edit-${idx}`}
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDelete(plan)}
                                    className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                                    aria-label="삭제"
                                    data-testid={`progress-plan-delete-${idx}`}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Phase 2 예고 안내 */}
      <div className="rounded-lg border border-teal-200 bg-teal-50/40 px-4 py-3 text-xs text-teal-700">
        <p className="font-semibold mb-0.5">Phase 2 예정</p>
        <p className="text-teal-600">
          예약 생성 시 패키지 연결 + 경과분석 회차 자동 계산 → 스태프 알림 배너 + 예약현황 카드 배지
        </p>
      </div>

      {/* 추가/수정 다이얼로그 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md" data-testid="progress-plan-dialog">
          <DialogHeader>
            <DialogTitle className="text-base">
              {editingId ? '체크포인트 수정' : '체크포인트 추가'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* 패키지 타입 */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">패키지 타입</label>
              <div className="flex flex-wrap gap-1.5">
                {PACKAGE_TYPE_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => handlePackageTypeChange(opt.value)}
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                      form.package_type === opt.value
                        ? 'border-teal-500 bg-teal-600 text-white'
                        : 'border-border hover:border-teal-300 hover:bg-teal-50'
                    }`}
                    data-testid={`pkg-type-btn-${opt.value}`}
                  >
                    {opt.label}
                    {opt.total && (
                      <span className="ml-1 opacity-70">({opt.total}회)</span>
                    )}
                  </button>
                ))}
                {/* 직접 입력 */}
                {!PACKAGE_TYPE_OPTIONS.find(o => o.value === form.package_type) && (
                  <span className="rounded-full border border-teal-500 bg-teal-600 text-white px-3 py-1 text-xs font-medium">
                    {form.package_type}
                  </span>
                )}
              </div>
              {/* 커스텀 타입 입력 */}
              <div className="mt-1">
                <Input
                  value={form.package_type}
                  onChange={e => handlePackageTypeChange(e.target.value)}
                  placeholder="커스텀 패키지 타입 (예: bleremedies)"
                  className="h-8 text-xs"
                  data-testid="pkg-type-input"
                />
              </div>
            </div>

            {/* 회차 */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">
                  경과분석 회차 <span className="text-destructive">*</span>
                </label>
                <Input
                  type="number"
                  min={1}
                  max={999}
                  value={form.session_milestone}
                  onChange={e => handleMilestoneChange(e.target.value)}
                  placeholder="예: 6"
                  className="h-9 text-sm font-mono"
                  data-testid="milestone-input"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">레이블 미리보기</label>
                <div className="h-9 flex items-center px-2 rounded-md border bg-muted/20 text-xs text-teal-700 font-medium">
                  {form.session_milestone
                    ? (parseInt(form.session_milestone) > 0 ? `${form.session_milestone}회차` : '—')
                    : '—'}
                </div>
              </div>
            </div>

            {/* 레이블 */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">
                레이블 <span className="text-destructive">*</span>
              </label>
              <Input
                value={form.label}
                onChange={e => setForm(prev => ({ ...prev, label: e.target.value }))}
                placeholder="예: 6회 중간 경과분석"
                className="h-9 text-sm"
                data-testid="label-input"
              />
              <p className="text-[10px] text-muted-foreground">예약 카드·알림에 표시되는 이름</p>
            </div>

            {/* 알림 설정 */}
            <div className="rounded-lg border bg-muted/20 p-3 space-y-3">
              <p className="text-xs font-semibold text-muted-foreground">알림 설정 (Phase 2 연동)</p>

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium">스태프 인앱 알림</p>
                  <p className="text-[10px] text-muted-foreground">예약 카드에 배지 표시</p>
                </div>
                <Switch
                  checked={form.notify_staff}
                  onCheckedChange={v => setForm(prev => ({ ...prev, notify_staff: v }))}
                  className="data-[state=checked]:bg-teal-600"
                  data-testid="notify-staff-switch"
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium">환자 SMS 발송</p>
                  <p className="text-[10px] text-muted-foreground">Phase 2에서 활성화 예정</p>
                </div>
                <Switch
                  checked={form.notify_patient}
                  onCheckedChange={v => setForm(prev => ({ ...prev, notify_patient: v }))}
                  className="data-[state=checked]:bg-blue-600"
                  data-testid="notify-patient-switch"
                />
              </div>
            </div>

            {/* 활성 여부 */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium">활성화</p>
                <p className="text-[10px] text-muted-foreground">비활성 시 해당 회차 알림 비작동</p>
              </div>
              <Switch
                checked={form.is_active}
                onCheckedChange={v => setForm(prev => ({ ...prev, is_active: v }))}
                className="data-[state=checked]:bg-teal-600"
                data-testid="is-active-switch"
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDialogOpen(false)}
              disabled={saving}
            >
              취소
            </Button>
            <Button
              size="sm"
              className="bg-teal-600 hover:bg-teal-700 text-white min-w-[80px]"
              onClick={handleSave}
              disabled={saving}
              data-testid="progress-plan-save-btn"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
              {saving ? '저장 중...' : editingId ? '수정 저장' : '추가'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
