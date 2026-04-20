import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { CreditCard } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/lib/supabase';
import { formatAmount, parseAmount } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { CheckIn } from '@/lib/types';

type PayMethod = 'card' | 'cash' | 'transfer';

interface Props {
  checkIn: CheckIn | null;
  onClose: () => void;
  onPaid: () => void;
}

const METHOD_OPTIONS: { value: PayMethod; label: string; icon: string }[] = [
  { value: 'card', label: '카드', icon: '💳' },
  { value: 'cash', label: '현금', icon: '💵' },
  { value: 'transfer', label: '이체', icon: '🏦' },
];

const INSTALLMENT_OPTIONS = [
  { value: 0, label: '일시불' },
  { value: 2, label: '2개월' },
  { value: 3, label: '3개월' },
  { value: 6, label: '6개월' },
  { value: 10, label: '10개월' },
  { value: 12, label: '12개월' },
];

export function PaymentDialog({ checkIn, onClose, onPaid }: Props) {
  const [method, setMethod] = useState<PayMethod>('card');
  const [amountStr, setAmountStr] = useState('');
  const [installment, setInstallment] = useState(0);
  const [isSplit, setIsSplit] = useState(false);
  const [splitCardStr, setSplitCardStr] = useState('');
  const [splitCashStr, setSplitCashStr] = useState('');
  const [memo, setMemo] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (checkIn) {
      setMethod('card');
      setAmountStr('');
      setInstallment(0);
      setIsSplit(false);
      setSplitCardStr('');
      setSplitCashStr('');
      setMemo('');
    }
  }, [checkIn?.id]);

  if (!checkIn) return null;

  const amount = parseAmount(amountStr);
  const splitCard = parseAmount(splitCardStr);
  const splitCash = parseAmount(splitCashStr);

  const handleSubmit = async () => {
    setSubmitting(true);

    if (isSplit) {
      if (splitCard <= 0 && splitCash <= 0) {
        toast.error('금액을 입력하세요');
        setSubmitting(false);
        return;
      }
      const payments: { clinic_id: string; check_in_id: string; customer_id: string | null; amount: number; method: PayMethod; installment: number | null; memo: string | null; payment_type: string }[] = [];
      if (splitCard > 0) {
        payments.push({
          clinic_id: checkIn.clinic_id,
          check_in_id: checkIn.id,
          customer_id: checkIn.customer_id,
          amount: splitCard,
          method: 'card',
          installment: installment || null,
          memo: `분할: 카드 ${formatAmount(splitCard)} + 현금 ${formatAmount(splitCash)}`,
          payment_type: 'payment',
        });
      }
      if (splitCash > 0) {
        payments.push({
          clinic_id: checkIn.clinic_id,
          check_in_id: checkIn.id,
          customer_id: checkIn.customer_id,
          amount: splitCash,
          method: 'cash',
          installment: null,
          memo: `분할: 카드 ${formatAmount(splitCard)} + 현금 ${formatAmount(splitCash)}`,
          payment_type: 'payment',
        });
      }
      const { error } = await supabase.from('payments').insert(payments);
      if (error) {
        toast.error(`결제 실패: ${error.message}`);
        setSubmitting(false);
        return;
      }
    } else {
      if (amount <= 0) {
        toast.error('금액을 입력하세요');
        setSubmitting(false);
        return;
      }
      const { error } = await supabase.from('payments').insert({
        clinic_id: checkIn.clinic_id,
        check_in_id: checkIn.id,
        customer_id: checkIn.customer_id,
        amount,
        method,
        installment: method === 'card' && installment > 0 ? installment : null,
        memo: memo || null,
        payment_type: 'payment',
      });
      if (error) {
        toast.error(`결제 실패: ${error.message}`);
        setSubmitting(false);
        return;
      }
    }

    if (checkIn.status === 'payment_waiting') {
      await supabase
        .from('check_ins')
        .update({ status: 'treatment_waiting' })
        .eq('id', checkIn.id);
      await supabase.from('status_transitions').insert({
        check_in_id: checkIn.id,
        clinic_id: checkIn.clinic_id,
        from_status: 'payment_waiting',
        to_status: 'treatment_waiting',
      });
    }

    toast.success('결제 완료');
    setSubmitting(false);
    onPaid();
  };

  return (
    <Dialog open={!!checkIn} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            결제 — {checkIn.customer_name}
            {checkIn.queue_number != null && (
              <span className="text-sm text-teal-700">#{checkIn.queue_number}</span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* 단일 / 분할 토글 */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setIsSplit(false)}
              className={cn(
                'flex-1 rounded-md border py-2 text-sm font-medium transition',
                !isSplit ? 'border-teal-600 bg-teal-50 text-teal-700' : 'border-input hover:bg-muted',
              )}
            >
              단일 결제
            </button>
            <button
              type="button"
              onClick={() => setIsSplit(true)}
              className={cn(
                'flex-1 rounded-md border py-2 text-sm font-medium transition',
                isSplit ? 'border-teal-600 bg-teal-50 text-teal-700' : 'border-input hover:bg-muted',
              )}
            >
              분할 결제
            </button>
          </div>

          {isSplit ? (
            <>
              <div className="space-y-2">
                <Label>카드 금액</Label>
                <Input
                  value={splitCardStr}
                  onChange={(e) => setSplitCardStr(e.target.value)}
                  placeholder="0"
                  inputMode="numeric"
                  className="text-right tabular-nums"
                />
              </div>
              <div className="space-y-2">
                <Label>현금 금액</Label>
                <Input
                  value={splitCashStr}
                  onChange={(e) => setSplitCashStr(e.target.value)}
                  placeholder="0"
                  inputMode="numeric"
                  className="text-right tabular-nums"
                />
              </div>
              {splitCard + splitCash > 0 && (
                <div className="flex justify-between text-sm font-medium rounded bg-muted px-3 py-2">
                  <span>합계</span>
                  <span className="tabular-nums">{formatAmount(splitCard + splitCash)}</span>
                </div>
              )}
            </>
          ) : (
            <>
              {/* 결제 수단 */}
              <div className="space-y-2">
                <Label>결제 수단</Label>
                <div className="grid grid-cols-3 gap-2">
                  {METHOD_OPTIONS.map((m) => (
                    <button
                      key={m.value}
                      type="button"
                      onClick={() => setMethod(m.value)}
                      className={cn(
                        'flex items-center justify-center gap-1 rounded-md border py-2 text-sm font-medium transition',
                        method === m.value
                          ? 'border-teal-600 bg-teal-50 text-teal-700'
                          : 'border-input hover:bg-muted',
                      )}
                    >
                      {m.icon} {m.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 금액 */}
              <div className="space-y-2">
                <Label>금액</Label>
                <Input
                  value={amountStr}
                  onChange={(e) => setAmountStr(e.target.value)}
                  placeholder="0"
                  inputMode="numeric"
                  className="text-right text-lg tabular-nums"
                  autoFocus
                />
              </div>

              {/* 할부 (카드만) */}
              {method === 'card' && (
                <div className="space-y-2">
                  <Label>할부</Label>
                  <div className="grid grid-cols-3 gap-2">
                    {INSTALLMENT_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setInstallment(opt.value)}
                        className={cn(
                          'rounded border px-2 h-9 text-xs font-medium transition',
                          installment === opt.value
                            ? 'border-teal-600 bg-teal-50 text-teal-700'
                            : 'border-input hover:bg-muted',
                        )}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          <div className="space-y-2">
            <Label>메모</Label>
            <Textarea
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="결제 메모"
              rows={2}
              className="text-sm"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            취소
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? '처리 중…' : '결제 완료'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
