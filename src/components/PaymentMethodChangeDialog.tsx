/**
 * PaymentMethodChangeDialog — 수납 완료 건의 '결제수단만' 변경(수정) 전용 다이얼로그
 * T-20260730-foot-SUSU-PAYMETHOD-CHANGE-SPLITPAY-UNIFIED (요구 A)
 *
 * 현장 요청(김다인, 풋센터): 과거/현재 수납 내역에서 결제수단을 변경하는 버튼.
 *   편집 방식(zgf0 A안) = 취소·재등록 없이 payments.method 만 직접 UPDATE.
 *
 * DA 게이트(§33/euaq, DA-20260730-FOOT-PAYMETHOD-CHANGE-SPLIT) 결속 AC:
 *   1. payments.method UPDATE → rows-affected=1 불변식 assert (silent write-failure guard).
 *      · supabase .update().select() 반환행 == 1 아니면 저장 실패로 처리(감사 미기록·낙관갱신 안 함).
 *   2. RedPay-앵커 행(external_trxid IS NOT NULL ∧ reconciled_at IS NOT NULL) = 카드 물리승인 앵커 →
 *      method 사후변경 불가. 버튼 disable(호출측) + 본 다이얼로그 제출 시 2차 백스톱 차단.
 *      환불 후 재결제 경로는 F4717 소유(본 버튼 소관 아님).
 *   3. audit ADDITIVE — payment_audit_logs 에 action='method_change' 로 누가·언제·이전값→새값 기록.
 *      (신규 테이블/컬럼 없음 — 기존 감사 인프라 재사용. db_change=false.)
 *   4. 현금영수증 coherence — cash_receipt_* 필드는 손대지 않음(물리 발행 사실 보존). 발행건이면 안내만 표기.
 *   5. 일마감 결제수단별 집계는 payments.method 파생 → in-place UPDATE 로 자동 재반영(별도 write 0).
 *
 * 분할(요구 B)은 배포된 write-path(RECEIPT-MANUAL-PAY-SPLIT-METHOD 등)로 커버 = 본 다이얼로그 소관 아님.
 */

import { useState } from 'react';
import { toast } from '@/lib/toast';
import { ArrowLeftRight } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';

// 결제수단 변경 대상은 수기 3종만(카드/현금/이체) — 현장 요청 범위(DA A안).
type PayMethod = 'card' | 'cash' | 'transfer';

export interface PaymentRowForMethodChange {
  id: string;
  method: string;
  installment?: number | null;
  clinic_id?: string | null;
  check_in_id?: string | null;
  status?: string | null;
  external_trxid?: string | null;
  reconciled_at?: string | null;
  cash_receipt_issued?: boolean | null;
}

export interface PaymentMethodChangeDonePayload {
  id: string;
  method: string;
  installment?: number | null;
}

interface Props {
  payment: PaymentRowForMethodChange | null;
  onClose: () => void;
  onDone: (updated: PaymentMethodChangeDonePayload) => void;
}

const METHOD_OPTIONS: { value: PayMethod; label: string }[] = [
  { value: 'card', label: '카드' },
  { value: 'cash', label: '현금' },
  { value: 'transfer', label: '이체' },
];

const METHOD_LABEL: Record<string, string> = {
  card: '카드', cash: '현금', transfer: '이체',
  membership: '패키지', insurance: '보험', mixed: '복합',
};

/** RedPay-앵커 판정(DA Q1a LOCK canonical): 카드 물리승인 + 대사확정 완료 = 사후 method 변경 불가. */
export function isRedpayAnchor(p: { external_trxid?: string | null; reconciled_at?: string | null }): boolean {
  return !!p.external_trxid && !!p.reconciled_at;
}

export function PaymentMethodChangeDialog({ payment, onClose, onDone }: Props) {
  const initial = (payment?.method as PayMethod) ?? 'card';
  const [method, setMethod] = useState<PayMethod>(
    METHOD_OPTIONS.some((m) => m.value === initial) ? initial : 'card',
  );
  const [submitting, setSubmitting] = useState(false);

  if (!payment) return null;

  const anchored = isRedpayAnchor(payment);
  const unchanged = method === payment.method;

  const handleSubmit = async () => {
    // ── AC-2 백스톱: RedPay-앵커 행은 method 변경 불가(버튼 disable 우회·렌더 갭 방어). ──
    if (anchored) {
      toast.error('카드 자동승인 건은 결제수단을 변경할 수 없습니다. 환불 후 재결제로 처리하세요.');
      return;
    }
    if (unchanged) {
      toast.error('현재와 동일한 결제수단입니다.');
      return;
    }
    setSubmitting(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const actor = userData?.user?.email ?? userData?.user?.id ?? 'unknown';

      const before = { method: payment.method, installment: payment.installment ?? null };
      // 카드가 아닌 수단으로 바꾸면 할부는 의미 없음 → null 정리(카드↔카드 아님 일관).
      const nextInstallment = method === 'card' ? (payment.installment ?? null) : null;
      const after = { method, installment: nextInstallment };

      // ── AC-1: rows-affected=1 불변식. .select() 반환행으로 실제 반영 검증(silent write-failure guard). ──
      //   status='active' 재조건 = 동시 취소/삭제된 행에 대한 오변경 방어(0행 → 불변식 실패로 감지).
      const { data: updated, error } = await supabase
        .from('payments')
        .update({ method, installment: nextInstallment })
        .eq('id', payment.id)
        .eq('status', 'active')
        .select('id');
      if (error) throw error;
      if (!updated || updated.length !== 1) {
        throw new Error(
          `저장이 반영되지 않았습니다(영향 행 ${updated?.length ?? 0}건). 화면을 새로고침 후 다시 시도하세요.`,
        );
      }

      // ── AC-3: 감사 ADDITIVE — 누가·언제·이전값→새값. 감사 실패는 결제 UPDATE 를 롤백하지 않음(best-effort). ──
      //   action='edit' 재사용(payment_audit_logs.action CHECK 는 create/edit/cancel/delete 만 허용, db_change=false).
      //   before/after 에 method 를 실어 이력 패널이 '결제수단: 현금→이체' 델타로 렌더한다.
      const { error: auditErr } = await supabase.from('payment_audit_logs').insert({
        payment_id: payment.id,
        clinic_id: payment.clinic_id ?? null,
        check_in_id: payment.check_in_id ?? null,
        action: 'edit',
        before_data: before,
        after_data: after,
        actor,
        reason: '결제수단 변경',
      });
      if (auditErr) console.error('결제수단 변경 감사 기록 실패(변경은 반영됨):', auditErr.message);

      toast.success('결제수단이 변경되었습니다');
      onDone({ id: payment.id, method, installment: nextInstallment });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`변경 실패: ${msg}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={!!payment} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm" data-testid="payment-method-change-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowLeftRight className="h-4 w-4" />
            결제수단 변경
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* 현재 결제수단 */}
          <div className="rounded-md bg-muted px-3 py-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">현재 결제수단</span>
              <span className="font-medium" data-testid="method-change-current">
                {METHOD_LABEL[payment.method] ?? payment.method}
              </span>
            </div>
          </div>

          {anchored ? (
            /* ── AC-2: RedPay-앵커 행 안내(버튼 disable 로 여기까지 오지 않는 게 정상, 방어적 안내) ── */
            <div
              className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
              data-testid="method-change-redpay-locked"
            >
              카드 자동승인(RedPay 대사 완료) 건은 결제수단을 변경할 수 없습니다.
              환불 후 재결제로 처리하세요.
            </div>
          ) : (
            <div className="space-y-2">
              <Label>새 결제수단</Label>
              <div className="grid grid-cols-3 gap-2">
                {METHOD_OPTIONS.map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    data-testid={`method-change-${m.value}`}
                    onClick={() => setMethod(m.value)}
                    className={cn(
                      'rounded-md border py-2 text-sm font-medium transition',
                      method === m.value
                        ? 'border-teal-600 bg-teal-50 text-teal-700'
                        : 'border-input hover:bg-muted',
                    )}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* AC-4: 현금영수증 발행건 안내(coherence — 영수증 기록은 보존됨) */}
          {!anchored && payment.cash_receipt_issued === true && (
            <p className="text-xs text-muted-foreground" data-testid="method-change-cashreceipt-note">
              이 수납은 현금영수증이 발행되어 있습니다. 결제수단을 변경해도 발행 기록은 그대로 유지됩니다.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            닫기
          </Button>
          <Button
            data-testid="btn-method-change-submit"
            onClick={handleSubmit}
            disabled={submitting || anchored || unchanged}
          >
            {submitting ? '처리 중…' : '변경 저장'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
