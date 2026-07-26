/**
 * AssignmentSettingsTab — 상담 자동배정 관리자 설정 (T-20260726-foot-CRM-ASSIGN-V1 실행6)
 *
 *  · 랭킹 가중치(월매출/주매출/객단가)         → assignment_ranking_weights
 *  · Daily Target(1등=꼴등 2배=2:1, 중간 보간)  → assignment_daily_target_config (top=bottom*2 앱+DB 이중)
 *  · 유입경로 전략(TM/INBOUND/WALK_IN)          → assignment_leadsource_policy
 *  · 직원별 자동배정 ON/OFF + Slack 매핑         → staff.auto_assign_enabled / staff.slack_user_id
 *
 *  ★ 매출귀속 RED LINE(조건②): 본 화면은 customers.assigned_consultant_id 를 절대 건드리지 않는다.
 *  ⚠ Slack 알림 발송(실행5)은 별 dependency(장쳰봇 초대 미완) — 여기선 매핑(slack_user_id) 등록만.
 */
import { useCallback, useEffect, useState } from 'react';
import { toast } from '@/lib/toast';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import type { Clinic, AssignLeadSource, AssignStrategy } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const LEAD_SOURCES: { key: AssignLeadSource; label: string }[] = [
  { key: 'TM', label: 'TM (아웃바운드 전화)' },
  { key: 'INBOUND', label: '인바운드 (걸려온 문의)' },
  { key: 'WALK_IN', label: '워크인 (예약없이 방문)' },
];

const STRATEGY_LABEL: Record<AssignStrategy, string> = {
  daily_target: '하루 목표건수 채우기 (미달 실장 우선)',
  ranking_pointer: '매출 순위대로 돌아가며 (순환)',
};

interface ConsultantRow {
  id: string;
  name: string;
  auto_assign_enabled: boolean;
  slack_user_id: string;
}

export function AssignmentSettingsTab({ clinic }: { clinic: Clinic }) {
  const { profile } = useAuth();
  const uid = profile?.id ?? null;

  // 가중치
  const [wMonth, setWMonth] = useState('1');
  const [wWeek, setWWeek] = useState('1');
  const [wAvg, setWAvg] = useState('1');
  // Daily Target — top 입력, bottom = top/2 (2:1)
  const [topTarget, setTopTarget] = useState('8');
  // 유입경로 전략 (미설정='none')
  const [policy, setPolicy] = useState<Record<AssignLeadSource, AssignStrategy | 'none'>>({
    TM: 'none',
    INBOUND: 'none',
    WALK_IN: 'none',
  });
  // 상담사 목록
  const [consultants, setConsultants] = useState<ConsultantRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingW, setSavingW] = useState(false);
  const [savingT, setSavingT] = useState(false);
  const [savingP, setSavingP] = useState(false);

  const bottomTarget = Math.max(1, Math.floor((parseInt(topTarget, 10) || 0) / 2));
  const topIsEven = (parseInt(topTarget, 10) || 0) % 2 === 0 && (parseInt(topTarget, 10) || 0) > 0;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [w, t, p, s] = await Promise.all([
        supabase
          .from('assignment_ranking_weights')
          .select('weight_revenue_month, weight_revenue_week, weight_avg_ticket')
          .eq('clinic_id', clinic.id)
          .maybeSingle(),
        supabase
          .from('assignment_daily_target_config')
          .select('top_rank_target, bottom_rank_target')
          .eq('clinic_id', clinic.id)
          .maybeSingle(),
        supabase
          .from('assignment_leadsource_policy')
          .select('lead_source, strategy')
          .eq('clinic_id', clinic.id),
        supabase
          .from('staff')
          .select('id, name, auto_assign_enabled, slack_user_id')
          .eq('clinic_id', clinic.id)
          .eq('active', true)
          .eq('role', 'consultant')
          .order('name'),
      ]);
      if (w.data) {
        setWMonth(String(w.data.weight_revenue_month ?? 1));
        setWWeek(String(w.data.weight_revenue_week ?? 1));
        setWAvg(String(w.data.weight_avg_ticket ?? 1));
      }
      if (t.data?.top_rank_target) setTopTarget(String(t.data.top_rank_target));
      const nextPolicy: Record<AssignLeadSource, AssignStrategy | 'none'> = {
        TM: 'none',
        INBOUND: 'none',
        WALK_IN: 'none',
      };
      for (const r of (p.data ?? []) as { lead_source: AssignLeadSource; strategy: AssignStrategy }[]) {
        nextPolicy[r.lead_source] = r.strategy;
      }
      setPolicy(nextPolicy);
      setConsultants(
        ((s.data ?? []) as { id: string; name: string; auto_assign_enabled: boolean | null; slack_user_id: string | null }[]).map(
          (r) => ({
            id: r.id,
            name: r.name,
            auto_assign_enabled: r.auto_assign_enabled !== false,
            slack_user_id: r.slack_user_id ?? '',
          }),
        ),
      );
    } catch (e) {
      toast.error('배정 설정을 불러오지 못했습니다.');
      console.warn('[AssignmentSettingsTab] load failed', e);
    } finally {
      setLoading(false);
    }
  }, [clinic.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveWeights = async () => {
    setSavingW(true);
    try {
      const payload = {
        clinic_id: clinic.id,
        weight_revenue_month: Number(wMonth) || 0,
        weight_revenue_week: Number(wWeek) || 0,
        weight_avg_ticket: Number(wAvg) || 0,
        updated_at: new Date().toISOString(),
        updated_by: uid,
      };
      const { data, error } = await supabase
        .from('assignment_ranking_weights')
        .upsert(payload, { onConflict: 'clinic_id' })
        .select('clinic_id');
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('저장 권한이 없습니다.');
      toast.success('랭킹 가중치를 저장했어요.');
    } catch (e) {
      toast.error(`가중치 저장 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSavingW(false);
    }
  };

  const saveTarget = async () => {
    if (!topIsEven) {
      toast.error('1등 목표건수는 2 이상의 짝수여야 합니다 (꼴등 = 1등의 절반, 2:1).');
      return;
    }
    setSavingT(true);
    try {
      const payload = {
        clinic_id: clinic.id,
        top_rank_target: parseInt(topTarget, 10),
        bottom_rank_target: bottomTarget, // = top/2 (2:1 앱 검증 + DB CHECK 이중)
        updated_at: new Date().toISOString(),
        updated_by: uid,
      };
      const { data, error } = await supabase
        .from('assignment_daily_target_config')
        .upsert(payload, { onConflict: 'clinic_id' })
        .select('clinic_id');
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('저장 권한이 없습니다.');
      toast.success(`하루 목표건수를 저장했어요. (1등 ${payload.top_rank_target}건 / 꼴등 ${bottomTarget}건)`);
    } catch (e) {
      toast.error(`목표건수 저장 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSavingT(false);
    }
  };

  const savePolicy = async () => {
    setSavingP(true);
    try {
      const upserts = LEAD_SOURCES.filter((ls) => policy[ls.key] !== 'none').map((ls) => ({
        clinic_id: clinic.id,
        lead_source: ls.key,
        strategy: policy[ls.key] as AssignStrategy,
        updated_at: new Date().toISOString(),
        updated_by: uid,
      }));
      const deletes = LEAD_SOURCES.filter((ls) => policy[ls.key] === 'none').map((ls) => ls.key);
      if (upserts.length > 0) {
        const { error } = await supabase
          .from('assignment_leadsource_policy')
          .upsert(upserts, { onConflict: 'clinic_id,lead_source' });
        if (error) throw error;
      }
      if (deletes.length > 0) {
        const { error } = await supabase
          .from('assignment_leadsource_policy')
          .delete()
          .eq('clinic_id', clinic.id)
          .in('lead_source', deletes);
        if (error) throw error;
      }
      toast.success('유입경로 배정전략을 저장했어요.');
    } catch (e) {
      toast.error(`전략 저장 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSavingP(false);
    }
  };

  const toggleAuto = async (id: string, on: boolean) => {
    setConsultants((prev) => prev.map((c) => (c.id === id ? { ...c, auto_assign_enabled: on } : c)));
    const { data, error } = await supabase
      .from('staff')
      .update({ auto_assign_enabled: on })
      .eq('id', id)
      .select('id');
    if (error || !data || data.length === 0) {
      toast.error('자동배정 설정 변경에 실패했어요.');
      setConsultants((prev) => prev.map((c) => (c.id === id ? { ...c, auto_assign_enabled: !on } : c)));
    }
  };

  const saveSlack = async (id: string, value: string) => {
    const v = value.trim() || null;
    const { data, error } = await supabase
      .from('staff')
      .update({ slack_user_id: v })
      .eq('id', id)
      .select('id');
    if (error || !data || data.length === 0) {
      toast.error('Slack 매핑 저장에 실패했어요.');
    } else {
      toast.success('Slack 매핑을 저장했어요.');
    }
  };

  if (loading) return <div className="p-6 text-muted-foreground">배정 설정 불러오는 중…</div>;

  return (
    <div className="space-y-6 pb-10" data-testid="assignment-settings-tab">
      {/* 실행1 — 랭킹 가중치 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">상담사 매출 순위 가중치</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            매출 순위를 매길 때 세 항목의 비중입니다. 기본값 1 : 1 : 1. 클수록 그 항목을 더 많이 반영합니다.
          </p>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1">
              <Label htmlFor="w-month">이번 달 매출</Label>
              <Input id="w-month" type="number" min="0" step="0.5" value={wMonth} onChange={(e) => setWMonth(e.target.value)} className="h-12 text-lg" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="w-week">이번 주 매출</Label>
              <Input id="w-week" type="number" min="0" step="0.5" value={wWeek} onChange={(e) => setWWeek(e.target.value)} className="h-12 text-lg" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="w-avg">객단가(1인당)</Label>
              <Input id="w-avg" type="number" min="0" step="0.5" value={wAvg} onChange={(e) => setWAvg(e.target.value)} className="h-12 text-lg" />
            </div>
          </div>
          <Button onClick={saveWeights} disabled={savingW} className="h-12 px-8 text-base" data-testid="save-weights">
            {savingW ? '저장 중…' : '가중치 저장'}
          </Button>
        </CardContent>
      </Card>

      {/* 실행2 — Daily Target */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">하루 목표 배정건수</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            매출 1등 실장의 하루 목표입니다. 꼴등 실장은 그 절반(2:1)이 되고, 중간 등수는 자동으로 나눠집니다.
          </p>
          <div className="flex items-end gap-6">
            <div className="space-y-1">
              <Label htmlFor="top-target">1등 목표(하루)</Label>
              <Input id="top-target" type="number" min="2" step="2" value={topTarget} onChange={(e) => setTopTarget(e.target.value)} className="h-12 w-32 text-lg" data-testid="top-target" />
            </div>
            <div className="pb-3 text-base text-muted-foreground">
              → 꼴등 목표 = <span className="font-semibold text-foreground" data-testid="bottom-target-derived">{bottomTarget}</span>건 (자동)
            </div>
          </div>
          {!topIsEven && (
            <p className="text-sm text-red-500">1등 목표는 2 이상의 짝수여야 합니다 (꼴등이 정확히 절반이 되도록).</p>
          )}
          <Button onClick={saveTarget} disabled={savingT} className="h-12 px-8 text-base" data-testid="save-target">
            {savingT ? '저장 중…' : '목표건수 저장'}
          </Button>
        </CardContent>
      </Card>

      {/* 실행2 — 유입경로 전략 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">유입경로별 배정 방식</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            어떻게 들어온 손님인지에 따라 상담 실장을 정하는 방식입니다. "설정 안함"이면 기존 균등배정 방식으로 동작합니다.
          </p>
          <div className="space-y-3">
            {LEAD_SOURCES.map((ls) => (
              <div key={ls.key} className="flex items-center justify-between gap-4">
                <div className="text-base font-medium">{ls.label}</div>
                <Select
                  value={policy[ls.key]}
                  onValueChange={(v) => setPolicy((p) => ({ ...p, [ls.key]: v as AssignStrategy | 'none' }))}
                >
                  <SelectTrigger className="h-12 w-80 text-base" data-testid={`policy-${ls.key}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">설정 안함 (기존 균등배정)</SelectItem>
                    <SelectItem value="daily_target">{STRATEGY_LABEL.daily_target}</SelectItem>
                    <SelectItem value="ranking_pointer">{STRATEGY_LABEL.ranking_pointer}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
          <Button onClick={savePolicy} disabled={savingP} className="h-12 px-8 text-base" data-testid="save-policy">
            {savingP ? '저장 중…' : '배정 방식 저장'}
          </Button>
        </CardContent>
      </Card>

      {/* 실행3/6 — 직원별 자동배정 ON/OFF + Slack 매핑 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">상담 실장별 자동배정 · 알림</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-muted-foreground">
            자동배정을 끄면 그 실장은 자동으로 배정되지 않습니다(수동 배정은 계속 가능). Slack 알림은 준비 중입니다.
          </p>
          <Separator />
          {consultants.length === 0 && <p className="py-4 text-muted-foreground">등록된 상담 실장이 없습니다.</p>}
          {consultants.map((c) => (
            <div key={c.id} className="flex items-center gap-4 py-2" data-testid={`consultant-row-${c.id}`}>
              <div className="w-28 text-base font-medium">{c.name}</div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={c.auto_assign_enabled}
                  onCheckedChange={(v) => toggleAuto(c.id, v)}
                  data-testid={`auto-toggle-${c.id}`}
                />
                <span className="text-sm text-muted-foreground">{c.auto_assign_enabled ? '자동배정 켜짐' : '꺼짐'}</span>
              </div>
              <div className="flex flex-1 items-center gap-2">
                <Label className="whitespace-nowrap text-sm text-muted-foreground">Slack ID</Label>
                <Input
                  defaultValue={c.slack_user_id}
                  placeholder="예: U01AB2CD (선택)"
                  className="h-10 max-w-xs"
                  onBlur={(e) => saveSlack(c.id, e.target.value)}
                  data-testid={`slack-input-${c.id}`}
                />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

export default AssignmentSettingsTab;
