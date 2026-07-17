/**
 * InsuranceResettlePanel — 건보 등급 확정 재정산 미리보기·처리 패널
 *
 * T-20260714-foot-INSGRADE-VERIFY-RESETTLE (SSOT §2-2-5)
 *
 * grade=null 급여방문에서 general 30% 로 잠정징수된 수납을, 등급 확정 후 확정 본인부담과
 * 대조해 차액(refund/추가징수)을 산출한다. 서버 RPC resettle_insurance_grade 가 authority
 * (calc_copayment 위에서만 산출, 병렬 경로 없음).
 *
 * 표시 정책:
 *   · 마운트/등급확정 시 dry-run 미리보기 → 환불/추가징수 예상액 노출.
 *   · ★실 처리(commit) = Layer2 MONEY = 대표·회계 게이트(money_gate). 게이트 확인 다이얼로그
 *     통과 시에만 commit RPC 호출. 게이트 해제 전에는 "대표·회계 승인 필요" 안내만.
 *   · data_incomplete BLOCK(수가/정액 미접지) 시 BLOCK 배너 — refund 금지.
 *   · 차액 0(시나리오2 general) = 재정산 불필요 안내.
 *
 * 태블릿 UX: 큰 버튼(h-9+), teal 계열, 천단위 콤마.
 */
import { useCallback, useEffect, useState } from 'react';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { resettleInsuranceGrade, type ResettleResult } from '@/hooks/useInsurance';

interface Props {
  checkInId: string;
  /** 현재 확정 등급(unverified/null 이면 재정산 대상 아님 → 렌더 생략). */
  grade: string | null | undefined;
  /** commit(실 refund) 허용 여부 — money_gate 해제 시 true. 기본 false(미리보기만). */
  moneyGateOpen?: boolean;
  /** 처리 완료 후 상위 갱신 콜백. */
  onResettled?: () => void;
}

const fmt = (n: number | undefined | null) => `${(n ?? 0).toLocaleString('ko-KR')}원`;

export function InsuranceResettlePanel({ checkInId, grade, moneyGateOpen = false, onResettled }: Props) {
  const [preview, setPreview] = useState<ResettleResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);

  const eligible = !!grade && grade !== 'unverified' && grade !== 'foreigner';

  const loadPreview = useCallback(async () => {
    if (!checkInId || !eligible) {
      setPreview(null);
      return;
    }
    setLoading(true);
    const res = await resettleInsuranceGrade(checkInId, { dryRun: true });
    setLoading(false);
    setPreview(res);
  }, [checkInId, eligible]);

  useEffect(() => {
    loadPreview();
  }, [loadPreview]);

  if (!eligible) return null;
  if (loading && !preview) {
    return <div className="px-3 py-2 text-xs text-muted-foreground">재정산 확인 중…</div>;
  }
  if (!preview) return null;

  // 산출 불가/대상 아님(급여 없음 등)은 조용히 생략 — 노이즈 방지.
  if (!preview.ok && !preview.blocked) return null;

  // ★ data_incomplete BLOCK 배너 (refund 금지)
  if (preview.blocked) {
    return (
      <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        <p className="font-semibold">재정산 보류 — 수가·정액 데이터 불완전</p>
        <p className="mt-0.5">
          확정 등급 산출에 필요한 수가/정액 정보가 아직 없어 재정산을 진행할 수 없습니다. 데이터 확정 후 다시 시도하세요.
        </p>
      </div>
    );
  }

  const refund = preview.refund ?? 0;
  const additional = preview.additional ?? 0;
  const alreadyDone = preview.already_resettled;

  // 차액 0 = 시나리오2(general 확정): 재정산 불필요.
  if (refund === 0 && additional === 0) {
    return (
      <div className="rounded-md border border-teal-200 bg-teal-50/50 px-3 py-2 text-xs text-teal-800" data-testid="resettle-none">
        확정 등급 기준 차액이 없어 재정산이 필요하지 않습니다{alreadyDone ? ' (처리 완료)' : ''}.
      </div>
    );
  }

  const handleCommit = async () => {
    if (!moneyGateOpen) {
      toast.error('실 환불/추가징수 처리는 대표·회계 승인(money_gate) 후 가능합니다.');
      return;
    }
    const label = refund > 0 ? `환불 ${fmt(refund)}` : `추가징수 ${fmt(additional)}`;
    if (!window.confirm(`재정산을 처리합니다: ${label}\n(대표·회계 승인 확인됨) 계속할까요?`)) return;
    setCommitting(true);
    const res = await resettleInsuranceGrade(checkInId, { dryRun: false });
    setCommitting(false);
    if (!res.ok) {
      toast.error(`재정산 처리 실패: ${res.error ?? res.reason ?? '알 수 없는 오류'}`);
      return;
    }
    toast.success(`재정산 완료 — ${res.refund ? `환불 ${fmt(res.refund)}` : `추가징수 ${fmt(res.additional)}`}`);
    onResettled?.();
    loadPreview();
  };

  return (
    <div className="rounded-md border border-purple-200 bg-purple-50/40 px-3 py-2 space-y-1.5" data-testid="resettle-panel">
      <p className="text-xs font-semibold text-purple-800">등급 확정 재정산</p>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>기징수(잠정 30%)</span>
        <span className="tabular-nums">{fmt(preview.provisional_copay)}</span>
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>확정 본인부담</span>
        <span className="tabular-nums">{fmt(preview.confirmed_copay)}</span>
      </div>
      <div className="flex justify-between text-sm font-bold pt-1 border-t border-purple-200">
        <span>{refund > 0 ? '환불 예상' : '추가징수 예상'}</span>
        <span className="tabular-nums text-purple-700" data-testid="resettle-amount">
          {fmt(refund > 0 ? refund : additional)}
        </span>
      </div>
      {alreadyDone ? (
        <p className="text-[11px] text-teal-700">이미 재정산 처리된 방문입니다.</p>
      ) : (
        <>
          <Button
            type="button"
            size="sm"
            className="w-full h-9"
            variant={moneyGateOpen ? 'default' : 'outline'}
            disabled={committing}
            onClick={handleCommit}
            data-testid="resettle-commit"
          >
            {committing ? '처리 중…' : moneyGateOpen ? '재정산 처리' : '재정산 처리 (대표·회계 승인 필요)'}
          </Button>
          {!moneyGateOpen && (
            <p className="text-[11px] text-muted-foreground">
              실 환불/추가징수는 대표·회계 승인 후 처리됩니다. 위 금액은 예상액입니다.
            </p>
          )}
        </>
      )}
    </div>
  );
}
