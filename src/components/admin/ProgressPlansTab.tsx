/**
 * ProgressPlansTab — 경과분석 플랜 관리 탭
 * T-20260526-foot-PROGRESS-CHECKPOINT Phase 1 (AC-2)
 * T-20260611-foot-PROGRESSPLAN-PKGTYPE-DB-BIND (AC-1): 패키지타입(string) → 회차 tier(total_sessions) 기준 UI.
 *
 * 역할: 회차수(tier)별 경과분석 회차(체크포인트) CRUD
 * 접근: admin / manager / director 전용
 * 탑재: DoctorTools.tsx "경과분석 플랜" 탭
 *
 * package_progress_plans 테이블:
 *   id, clinic_id, session_count_tier(매칭키), package_type(=tier_N 호환표기),
 *   session_milestone, label, notify_staff, notify_patient, is_active
 *
 * 매칭: packages.total_sessions == session_count_tier && milestone == 예상회차.
 *   이름·FK 무관 전수 커버(Option C). tier = 6의 배수: 6/12/18/24/30/36/42/48.
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useClinic } from '@/hooks/useClinic';
import { useAuth } from '@/lib/auth';
import { canEditClinicMgmt } from '@/lib/permissions';
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
  session_count_tier: number;   // 매칭키 = packages.total_sessions
  package_type: string;         // 'tier_N' 호환 표기 (단계 폐기 예정)
  session_milestone: number;
  label: string;
  notify_staff: boolean;
  notify_patient: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface PlanForm {
  session_count_tier: string;  // string for input
  session_milestone: string;   // string for input
  label: string;
  notify_staff: boolean;
  notify_patient: boolean;
  is_active: boolean;
}

// ── 회차 tier 메타데이터 (6의 배수: 6/12/18/24/30/36/42/48) ───────────────────
// 패키지명·FK 무관, 회차수(total_sessions)로 경과분석 tier 판정 (Option C).

const TIER_OPTIONS = [6, 12, 18, 24, 30, 36, 42, 48] as const;

function getTierLabel(tier: number): string {
  return `${tier}회 패키지`;
}

function getTierBadgeColor(tier: number): string {
  // 회차수가 클수록 진한 teal — 시각적 위계
  if (tier <= 6) return 'bg-teal-50 text-teal-700 border-teal-200';
  if (tier <= 12) return 'bg-teal-100 text-teal-800 border-teal-300';
  if (tier <= 24) return 'bg-emerald-100 text-emerald-800 border-emerald-300';
  if (tier <= 36) return 'bg-blue-100 text-blue-800 border-blue-300';
  return 'bg-indigo-100 text-indigo-800 border-indigo-300';
}

// ── 기본 폼 상태 ──────────────────────────────────────────────────────────────

const EMPTY_FORM: PlanForm = {
  session_count_tier: '12',
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
  // T-20260619-foot-CLINICMGMT-WRITE-RESTRICT-MEDVIEW Phase A(AC-2): 진료관리 write = director+admin(manager 제거·축소).
  //   progress_plans RLS write 旣존 {admin,manager,director} → director 무회귀. canEditClinicMgmt 재사용.
  const canWrite = canEditClinicMgmt(profile?.role);

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
      .order('session_count_tier', { ascending: true })
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

  // ── 회차 tier별 그룹핑 ────────────────────────────────────────────────────

  const grouped = plans.reduce<Record<number, ProgressPlan[]>>((acc, p) => {
    (acc[p.session_count_tier] ??= []).push(p);
    return acc;
  }, {});

  const tiers = Object.keys(grouped)
    .map(Number)
    .sort((a, b) => a - b);

  // ── 다이얼로그 열기 ────────────────────────────────────────────────────────

  function openCreate(defaultTier?: number) {
    setEditingId(null);
    setForm({ ...EMPTY_FORM, session_count_tier: String(defaultTier ?? 12) });
    setDialogOpen(true);
  }

  function openEdit(plan: ProgressPlan) {
    setEditingId(plan.id);
    setForm({
      session_count_tier: String(plan.session_count_tier),
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
    const tier = parseInt(form.session_count_tier, 10);
    const milestone = parseInt(form.session_milestone, 10);
    if (!tier || tier <= 0) {
      toast.error('회차 tier를 선택해주세요 (예: 12회 패키지)');
      return;
    }
    if (!milestone || milestone <= 0) {
      toast.error('유효한 회차 번호를 입력해주세요 (1 이상)');
      return;
    }
    if (milestone > tier) {
      toast.error(`경과분석 회차(${milestone})는 패키지 회차수(${tier})를 넘을 수 없습니다`);
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
        session_count_tier: tier,
        package_type: `tier_${tier}`,  // 호환 표기 (매칭은 session_count_tier 기준)
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
            toast.error(`이미 존재하는 체크포인트입니다 — ${getTierLabel(tier)} ${milestone}회차`);
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
    if (!window.confirm(`"${getTierLabel(plan.session_count_tier)} ${plan.session_milestone}회차 — ${plan.label}" 를 삭제하시겠습니까?`)) return;
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
  // tier(총회차)와 같으면 "최종", 6의 배수면 "중간", 그 외 "N회차".

  const autoLabel = (tier: number, milestone: number): string => {
    if (tier > 0 && milestone === tier) return `${milestone}회 최종 경과분석`;
    if (milestone % 6 === 0) return `${milestone}회 중간 경과분석`;
    return `${milestone}회차 경과분석`;
  };

  const handleMilestoneChange = (value: string) => {
    const n = parseInt(value, 10);
    const tier = parseInt(form.session_count_tier, 10);
    setForm(prev => ({
      ...prev,
      session_milestone: value,
      // 레이블이 비어있거나 자동생성 패턴인 경우에만 자동 업데이트
      label: (!prev.label || prev.label.match(/^\d+회/))
        ? (isNaN(n) || n <= 0 ? '' : autoLabel(tier, n))
        : prev.label,
    }));
  };

  const handleTierChange = (value: string) => {
    const n = parseInt(form.session_milestone, 10);
    const tier = parseInt(value, 10);
    setForm(prev => ({
      ...prev,
      session_count_tier: value,
      label: (!prev.label || prev.label.match(/^\d+회/))
        ? (isNaN(n) || n <= 0 ? '' : autoLabel(tier, n))
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
            패키지 회차수(예: 12회·24회·36회)별로 경과분석이 필요한 회차를 정의합니다.
            <br />
            패키지 이름과 무관하게 <span className="text-teal-600">회차수가 같은 모든 패키지</span>에 자동 적용됩니다.
          </p>
        </div>
        <Button
          size="sm"
          className="bg-neutral-800 hover:bg-neutral-900 text-white gap-1.5 h-9"
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
            "체크포인트 추가" 버튼으로 회차수(tier)별 경과분석 회차를 설정하세요.
          </p>
          <Button
            size="sm"
            className="mt-4 bg-neutral-800 hover:bg-neutral-900 text-white gap-1.5"
            onClick={() => openCreate()}
          >
            <Plus className="h-3.5 w-3.5" />
            첫 번째 체크포인트 추가
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {tiers.map(tier => {
            const group = grouped[tier] ?? [];
            const isCollapsed = collapsed[tier] ?? false;
            const activeCount = group.filter(p => p.is_active).length;

            return (
              <div
                key={tier}
                className="rounded-xl border bg-card shadow-sm overflow-hidden"
                data-testid={`progress-plan-group-${tier}`}
              >
                {/* 그룹 헤더 */}
                <button
                  type="button"
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/40 transition-colors"
                  onClick={() => setCollapsed(prev => ({ ...prev, [tier]: !isCollapsed }))}
                >
                  <div className="flex items-center gap-2.5">
                    {isCollapsed
                      ? <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      : <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    }
                    <span
                      className={`inline-flex items-center rounded border px-2.5 py-0.5 text-xs font-semibold ${getTierBadgeColor(tier)}`}
                    >
                      {getTierLabel(tier)}
                    </span>
                    <span className="text-xs text-muted-foreground">회차수 {tier}회 기준</span>
                    <Badge variant="outline" className="text-[10px] h-4 px-1.5">
                      {activeCount}/{group.length}건 활성
                    </Badge>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1 text-xs text-teal-600 hover:bg-teal-50"
                    onClick={(e) => { e.stopPropagation(); openCreate(tier); }}
                    data-testid={`progress-plan-add-${tier}`}
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

      {/* 동작 안내 */}
      <div className="rounded-lg border border-teal-200 bg-teal-50/40 px-4 py-3 text-xs text-teal-700">
        <p className="font-semibold mb-0.5">회차수 기준 자동 적용</p>
        <p className="text-teal-600">
          예약에 패키지를 연결하면 그 패키지의 회차수(예: 12회)에 맞는 플랜이 자동 매칭됩니다.
          진행 회차가 설정된 경과분석 회차에 도달하면 예약현황 카드에 배지가 표시됩니다.
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
            {/* 회차수 tier */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">패키지 회차수 (tier)</label>
              <div className="flex flex-wrap gap-1.5">
                {TIER_OPTIONS.map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => handleTierChange(String(t))}
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                      form.session_count_tier === String(t)
                        ? 'border-teal-500 bg-teal-600 text-white'
                        : 'border-border hover:border-teal-300 hover:bg-teal-50'
                    }`}
                    data-testid={`tier-btn-${t}`}
                  >
                    {t}회
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground">
                회차수가 같은 모든 패키지(이름 무관)에 적용됩니다. 6의 배수.
              </p>
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
              className="bg-neutral-800 hover:bg-neutral-900 text-white min-w-[80px]"
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
