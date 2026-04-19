import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

interface PaymentModalProps {
  open: boolean;
  customerName: string;
  suggestedAmount?: number;
  services?: { name: string; price: number }[];
  onSkip: () => void;
  onComplete: (data: { amount: number; method: string; installment: number; memo: string }) => void;
}

const INSTALLMENT_OPTIONS = [
  { value: 0, label: '일시불' },
  { value: 2, label: '2개월' },
  { value: 3, label: '3개월' },
  { value: 4, label: '4개월' },
  { value: 5, label: '5개월' },
  { value: 6, label: '6개월' },
  { value: 7, label: '7개월' },
  { value: 8, label: '8개월' },
  { value: 9, label: '9개월' },
  { value: 10, label: '10개월' },
  { value: 11, label: '11개월' },
  { value: 12, label: '12개월' },
];

export default function PaymentModal({ open, customerName, suggestedAmount, services, onSkip, onComplete }: PaymentModalProps) {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'card' | 'cash' | 'transfer' | 'membership'>('card');
  const [installment, setInstallment] = useState(0);
  const [memo, setMemo] = useState('');
  const [splitMode, setSplitMode] = useState(false);
  const [cardAmount, setCardAmount] = useState('');
  const [cashAmount, setCashAmount] = useState('');

  // 김태영 #7: 부가세 자동계산 제거. 상담실에서 입력한 금액 그대로 결제 처리.
  const subtotal = suggestedAmount || 0;

  useEffect(() => {
    if (open && subtotal > 0) setAmount(subtotal.toLocaleString());
    else if (open) setAmount('');
  }, [suggestedAmount, open]);

  const handleComplete = () => {
    if (splitMode) {
      const cardNum = parseInt(cardAmount.replace(/,/g, ''), 10) || 0;
      const cashNum = parseInt(cashAmount.replace(/,/g, ''), 10) || 0;
      if (cardNum + cashNum <= 0) return;
      // Report as card with total amount, memo includes split details
      const splitMemo = `분할: 카드 ${cardNum.toLocaleString()}원 + 현금 ${cashNum.toLocaleString()}원${memo ? ' / ' + memo : ''}`;
      onComplete({
        amount: cardNum + cashNum,
        method: cardNum >= cashNum ? 'card' : 'cash',
        installment: cardNum >= cashNum ? installment : 0,
        memo: splitMemo,
      });
    } else {
      const numAmount = parseInt(amount.replace(/,/g, ''), 10);
      if (isNaN(numAmount) || numAmount <= 0) return;
      onComplete({
        amount: numAmount,
        method,
        installment: method === 'card' ? installment : 0,
        memo,
      });
    }
    // Reset
    setAmount('');
    setMethod('card');
    setInstallment(0);
    setMemo('');
    setSplitMode(false);
    setCardAmount('');
    setCashAmount('');
  };

  const formatAmount = (val: string) => {
    const num = val.replace(/\D/g, '');
    return num ? parseInt(num, 10).toLocaleString() : '';
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onSkip(); }}>
      <DialogContent className="max-w-sm z-[100]">
        <DialogHeader>
          <DialogTitle>결제 정보 입력</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <p className="text-sm text-muted-foreground">고객</p>
            <p className="font-medium">{customerName}</p>
          </div>

          {/* 시술 내역 (김태영 #7: 부가세 자동계산 제거 — 입력 금액 그대로 처리) */}
          {(services && services.length > 0) || subtotal > 0 ? (
            <div className="bg-muted/30 rounded-lg p-2 text-sm space-y-0.5">
              {services && services.map((s, i) => (
                <div key={i} className="flex justify-between">
                  <span className="text-muted-foreground">{s.name}</span>
                  <span>{s.price.toLocaleString()}</span>
                </div>
              ))}
              <div className="border-t border-border pt-1 mt-1 flex justify-between font-bold">
                <span>총 결제금액</span><span>{subtotal.toLocaleString()}원</span>
              </div>
            </div>
          ) : null}
          {(!suggestedAmount || suggestedAmount <= 0) && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2 text-xs text-yellow-700">
              시술 항목이 선택되지 않았습니다. 금액을 직접 입력해주세요.
            </div>
          )}

          {!splitMode ? (
            <>
              <div>
                <label className="block text-sm font-medium mb-1">결제 금액</label>
                <div className="relative">
                  <Input
                    value={amount}
                    onChange={(e) => setAmount(formatAmount(e.target.value))}
                    placeholder="0"
                    className="pr-8"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">원</span>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">결제 수단</label>
                <div className="flex gap-3 items-center flex-wrap">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input type="radio" name="method" checked={method === 'card'} onChange={() => setMethod('card')} className="accent-accent" />
                    <span className="text-sm">💳 카드</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input type="radio" name="method" checked={method === 'cash'} onChange={() => setMethod('cash')} className="accent-accent" />
                    <span className="text-sm">💵 현금</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input type="radio" name="method" checked={method === 'transfer'} onChange={() => setMethod('transfer')} className="accent-accent" />
                    <span className="text-sm">🏦 이체</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input type="radio" name="method" checked={method === 'membership'} onChange={() => setMethod('membership')} className="accent-accent" />
                    <span className="text-sm">🎫 멤버십</span>
                  </label>
                  <button type="button" onClick={() => setSplitMode(true)} className="text-xs text-accent underline ml-auto">분할결제</button>
                </div>
              </div>

              {method === 'card' && (
                <div>
                  <label className="block text-sm font-medium mb-1">할부</label>
                  <select
                    value={installment}
                    onChange={(e) => setInstallment(Number(e.target.value))}
                    className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    {INSTALLMENT_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
              )}
            </>
          ) : (
            <>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-sm font-medium">분할결제</label>
                  <button type="button" onClick={() => setSplitMode(false)} className="text-xs text-muted-foreground underline">단일결제</button>
                </div>
                <div className="space-y-2">
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">카드</span>
                    <Input value={cardAmount} onChange={(e) => setCardAmount(formatAmount(e.target.value))} placeholder="0" className="pl-12 pr-8" />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">원</span>
                  </div>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">현금</span>
                    <Input value={cashAmount} onChange={(e) => setCashAmount(formatAmount(e.target.value))} placeholder="0" className="pl-12 pr-8" />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">원</span>
                  </div>
                  <div className="text-right text-sm font-medium">
                    합계: {((parseInt(cardAmount.replace(/,/g, ''), 10) || 0) + (parseInt(cashAmount.replace(/,/g, ''), 10) || 0)).toLocaleString()}원
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">할부 (카드분)</label>
                <select value={installment} onChange={(e) => setInstallment(Number(e.target.value))} className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm">
                  {INSTALLMENT_OPTIONS.map((opt) => (<option key={opt.value} value={opt.value}>{opt.label}</option>))}
                </select>
              </div>
            </>
          )}

          <div>
            <label className="block text-sm font-medium mb-1">메모</label>
            <Textarea value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="결제 메모 (선택)" rows={2} />
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={onSkip} className="flex-1">건너뛰기</Button>
            <Button
              onClick={handleComplete}
              disabled={splitMode ? ((parseInt(cardAmount.replace(/,/g, ''), 10) || 0) + (parseInt(cashAmount.replace(/,/g, ''), 10) || 0)) <= 0 : (!amount || parseInt(amount.replace(/,/g, ''), 10) <= 0)}
              className="flex-1 bg-accent text-accent-foreground hover:bg-accent/90"
            >
              결제완료
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
