// T-20260707-foot-PAYMENT-ITEMIZED-CHARGE-ENTRY
// 결제 상세 — 항목별 명세(payment_items) 읽기 전용 표시. AC-2: 결제 상세에서 항목별 내역 조회.
// 0행이면 아무것도 렌더 안 함 = 레거시 lump-sum 결제 그대로(하위호환).
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { formatAmount } from '@/lib/format';
import type { PaymentItem } from '@/lib/types';

export function PaymentItemsView({ paymentId }: { paymentId: string }) {
  const [items, setItems] = useState<PaymentItem[]>([]);

  useEffect(() => {
    let alive = true;
    supabase
      .from('payment_items')
      .select('id, payment_id, service_name, service_code, quantity, unit_price, line_amount, charge_class, created_at, check_in_id, service_id')
      .eq('payment_id', paymentId)
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        if (alive) setItems((data ?? []) as PaymentItem[]);
      });
    return () => {
      alive = false;
    };
  }, [paymentId]);

  if (items.length === 0) return null;

  return (
    <div className="ml-2 mt-0.5 space-y-0.5 border-l-2 border-teal-100 pl-2" data-testid="payment-items-view">
      {items.map((it) => (
        <div key={it.id} className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <span className="flex-1 truncate">
            {it.service_name}
            {it.service_code ? <span className="ml-1 font-mono text-[10px] text-teal-600">{it.service_code}</span> : null}
            {it.charge_class ? (
              <span className="ml-1 rounded bg-teal-50 px-1 text-[10px] text-teal-700">{it.charge_class}</span>
            ) : null}
            {it.quantity > 1 ? <span className="ml-1">×{it.quantity}</span> : null}
          </span>
          <span className="tabular-nums">{formatAmount(it.line_amount)}</span>
        </div>
      ))}
    </div>
  );
}
