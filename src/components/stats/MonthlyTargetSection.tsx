import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { formatAmount } from '@/lib/format';
import { toast } from '@/lib/toast';
import { useAuth } from '@/lib/auth';
import {
  achievementRate,
  fetchMonthRevenueNet,
  fetchMonthlyTarget,
  monthScope,
  upsertMonthlyTarget,
} from '@/lib/monthlyTarget';

/**
 * T-20260804-foot-SALESSTAT-MONTHLY-TARGET-ACHIEVEMENT
 * "01 매출통계" 최상단 — 이번 달 목표 매출 등록(월별 저장/수정) + 목표 대비 달성률(%).
 *
 * self-loading: clinicId·refISO(선택기간 시작일)만 받아 자체적으로 목표/실매출을 로드.
 *   → Stats.tsx footprint 최소화(MTM-RESTRUCTURE와 레이아웃 충돌 방지, 맨 상단 additive 카드).
 */
interface Props {
  clinicId: string | null | undefined;
  /** 선택기간 시작일('YYYY-MM-DD'). 이 날짜가 속한 '달'을 목표/달성률 기준월로 삼음. */
  refISO: string;
}

/** 숫자만 남기고 콤마 등 제거 → 정수. 빈값/NaN = null. */
function parseAmount(raw: string): number | null {
  const digits = raw.replace(/[^0-9]/g, '');
  if (!digits) return null;
  const n = Number(digits);
  return Number.isFinite(n) ? n : null;
}

export default function MonthlyTargetSection({ clinicId, refISO }: Props) {
  const { profile } = useAuth();
  const scope = refISO ? monthScope(refISO) : null;
  const yearMonth = scope?.yearMonth ?? '';

  const [target, setTarget] = useState<number | null>(null);
  const [actualNet, setActualNet] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!clinicId || !scope) return;
    setLoading(true);
    try {
      const [t, net] = await Promise.all([
        fetchMonthlyTarget(clinicId, scope.yearMonth),
        fetchMonthRevenueNet(clinicId, scope.from, scope.to),
      ]);
      setTarget(t);
      setActualNet(net);
    } catch (e) {
      console.error('[MonthlyTarget] 목표/실매출 로드 실패', { clinicId, yearMonth, error: e });
      setTarget(null);
      setActualNet(null);
    } finally {
      setLoading(false);
      setEditing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinicId, yearMonth]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSave = async () => {
    if (!clinicId || !scope) return;
    const amount = parseAmount(draft);
    if (amount === null) {
      toast.error('목표 금액을 숫자로 입력해 주세요.');
      return;
    }
    setSaving(true);
    try {
      await upsertMonthlyTarget(clinicId, scope.yearMonth, amount, profile?.id ?? null);
      setTarget(amount);
      setEditing(false);
      toast.success(`${scope.yearMonth} 목표 매출을 저장했습니다.`);
    } catch (e) {
      console.error('[MonthlyTarget] 목표 저장 실패', { clinicId, yearMonth, error: e });
      toast.error('목표 매출 저장 중 오류가 발생했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const startEdit = () => {
    setDraft(target !== null ? String(target) : '');
    setEditing(true);
  };

  const rate = achievementRate(actualNet ?? 0, target);
  const draftPreview = parseAmount(draft);

  return (
    <section className="flex flex-col gap-2">
      <Card className="border-teal-200 bg-teal-50/40">
        <CardContent className="flex flex-col gap-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          {/* 좌: 이번 달 목표 매출 등록/수정 */}
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline gap-2">
              <span className="text-xs font-medium text-muted-foreground">이번 달 목표 매출</span>
              <span className="text-[11px] text-teal-700 tabular-nums">{yearMonth}</span>
            </div>

            {editing ? (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  autoFocus
                  value={draft === '' ? '' : Number(parseAmount(draft) ?? 0).toLocaleString()}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="목표 금액 입력 (원)"
                  data-testid="monthly-target-input"
                  className="w-48 rounded-md border px-3 py-2 text-lg font-semibold tabular-nums text-teal-800 focus:border-teal-500 focus:outline-none"
                />
                <button
                  onClick={handleSave}
                  disabled={saving}
                  data-testid="monthly-target-save"
                  className="rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:opacity-50"
                >
                  {saving ? '저장 중…' : '저장'}
                </button>
                <button
                  onClick={() => setEditing(false)}
                  disabled={saving}
                  className="rounded-md border px-4 py-2 text-sm font-medium text-muted-foreground transition hover:bg-muted disabled:opacity-50"
                >
                  취소
                </button>
                {draftPreview !== null && (
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    = {formatAmount(draftPreview)}
                  </span>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <span
                  className="text-2xl font-bold tabular-nums text-teal-800"
                  data-testid="monthly-target-value"
                >
                  {loading ? '…' : target !== null ? formatAmount(target) : '목표 미설정'}
                </span>
                <button
                  onClick={startEdit}
                  disabled={loading || !clinicId}
                  data-testid="monthly-target-edit"
                  className="rounded-md border border-teal-300 px-3 py-1.5 text-xs font-semibold text-teal-700 transition hover:bg-teal-100 disabled:opacity-50"
                >
                  {target !== null ? '수정' : '목표 등록'}
                </button>
              </div>
            )}
          </div>

          {/* 우: 목표 대비 달성률 */}
          <div className="flex flex-col items-start gap-1 sm:items-end">
            <span className="text-xs font-medium text-muted-foreground">목표 대비 달성률</span>
            <span
              className="text-3xl font-bold tabular-nums text-emerald-700"
              data-testid="monthly-target-achievement"
            >
              {loading ? '…' : rate === null ? '-' : `${rate.toFixed(1)}%`}
            </span>
            <span className="text-[10px] leading-tight text-muted-foreground tabular-nums">
              당월 실매출(누적, 순){' '}
              {loading ? '…' : actualNet !== null ? formatAmount(actualNet) : '-'}
              {rate === null && !loading && ' · 목표 미설정'}
            </span>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
