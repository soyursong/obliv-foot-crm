// T-20260707-foot-PAYMENT-ITEMIZED-CHARGE-ENTRY
// 결제 항목별 명세(payment_items) 입력 에디터. 스코프 (C) 풀명세:
//   항목명 + 수가코드 + 급여/비급여 + 단가 + 횟수 각 행 분리.
// charge_class·service_code 는 표시 스냅샷일 뿐 급여 split/수가 authority 아님(service_charges 유지).
// 태블릿 UX: 큰 버튼 / 천단위 콤마 / 한국어.
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AmountInput } from '@/components/ui/AmountInput';
import { formatAmount } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Service, ChargeClass } from '@/lib/types';

export interface PaymentItemDraft {
  key: string;
  service_id: string | null;
  service_name: string;
  service_code: string | null;
  quantity: number;
  unit_price: number | null;
  line_amount: number;
  charge_class: ChargeClass | null;
}

let __rowSeq = 0;
export function newItemKey(): string {
  __rowSeq += 1;
  return `pi-${__rowSeq}`;
}

/** service 마스터 → 라인 초안 스냅샷 (charge_class·service_code 파생) */
export function draftFromService(svc: Service, quantity = 1): PaymentItemDraft {
  const unit = svc.price ?? 0;
  return {
    key: newItemKey(),
    service_id: svc.id,
    service_name: svc.name,
    // 정련①: service_code 우선, 없으면 hira_code 스냅샷 (표시 전용, 권위 아님)
    service_code: svc.service_code ?? svc.hira_code ?? null,
    quantity,
    unit_price: unit,
    line_amount: unit * quantity,
    // 판정2: 보험축 2값 라벨. service.is_insurance_covered 파생, 없으면 미지정
    charge_class: svc.is_insurance_covered == null ? null : svc.is_insurance_covered ? '급여' : '비급여',
  };
}

export function emptyItemDraft(): PaymentItemDraft {
  return {
    key: newItemKey(),
    service_id: null,
    service_name: '',
    service_code: null,
    quantity: 1,
    unit_price: null,
    line_amount: 0,
    charge_class: null,
  };
}

export function lineItemsTotal(items: PaymentItemDraft[]): number {
  return items.reduce((s, it) => s + (it.line_amount || 0), 0);
}

interface Props {
  items: PaymentItemDraft[];
  onChange: (items: PaymentItemDraft[]) => void;
  services: Service[];
  /** 수납 총액 (합계 불일치 경고 대조) */
  settlementTotal: number;
}

const CHARGE_CLASSES: ChargeClass[] = ['급여', '비급여'];

export function PaymentItemsEditor({ items, onChange, services, settlementTotal }: Props) {
  const total = lineItemsTotal(items);
  const mismatch = items.length > 0 && settlementTotal > 0 && total !== settlementTotal;

  const patch = (key: string, next: Partial<PaymentItemDraft>) => {
    onChange(
      items.map((it) => {
        if (it.key !== key) return it;
        const merged = { ...it, ...next };
        // 수량/단가 변경 시 라인금액 자동 재계산 (line_amount 직접수정이 아니면)
        if (('quantity' in next || 'unit_price' in next) && !('line_amount' in next)) {
          merged.line_amount = (merged.unit_price ?? 0) * (merged.quantity || 0);
        }
        return merged;
      }),
    );
  };

  const onSelectService = (key: string, serviceId: string) => {
    if (!serviceId) {
      patch(key, { service_id: null });
      return;
    }
    const svc = services.find((s) => s.id === serviceId);
    if (!svc) return;
    const d = draftFromService(svc, items.find((i) => i.key === key)?.quantity ?? 1);
    patch(key, {
      service_id: d.service_id,
      service_name: d.service_name,
      service_code: d.service_code,
      unit_price: d.unit_price,
      line_amount: d.line_amount,
      charge_class: d.charge_class,
    });
  };

  return (
    <div className="space-y-2 rounded-md border border-teal-100 bg-teal-50/40 p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-teal-800">항목별 명세</span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 gap-1 text-teal-700"
          data-testid="btn-add-payment-item"
          onClick={() => onChange([...items, emptyItemDraft()])}
        >
          <Plus className="h-3.5 w-3.5" /> 항목 추가
        </Button>
      </div>

      {items.length === 0 ? (
        <p className="py-1 text-xs text-muted-foreground">
          항목을 추가하면 결제 내역이 항목별(항목명·수가코드·급여/비급여·단가·횟수)로 저장됩니다. 미입력 시 총액만 저장(기존 방식).
        </p>
      ) : (
        <div className="space-y-2">
          {items.map((it) => (
            <div
              key={it.key}
              data-testid="payment-item-row"
              className="space-y-1.5 rounded-md border border-input bg-white p-2"
            >
              {/* 1행: 항목명(서비스 선택 or 직접입력) + 삭제 */}
              <div className="flex items-center gap-1.5">
                {services.length > 0 && (
                  <select
                    className="h-9 shrink-0 rounded-md border border-input bg-background px-2 text-xs"
                    data-testid="select-payment-item-service"
                    value={it.service_id ?? ''}
                    onChange={(e) => onSelectService(it.key, e.target.value)}
                  >
                    <option value="">직접입력</option>
                    {services.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                )}
                <Input
                  className="h-9 flex-1 text-sm"
                  placeholder="항목명"
                  data-testid="input-payment-item-name"
                  value={it.service_name}
                  onChange={(e) => patch(it.key, { service_name: e.target.value })}
                />
                <button
                  type="button"
                  title="항목 삭제"
                  data-testid="btn-remove-payment-item"
                  onClick={() => onChange(items.filter((x) => x.key !== it.key))}
                  className="shrink-0 rounded p-1.5 text-red-500 hover:bg-red-50"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              {/* 2행: 수가코드 + 급여/비급여 */}
              <div className="flex items-center gap-1.5">
                <Input
                  className="h-9 w-28 text-xs"
                  placeholder="수가코드"
                  data-testid="input-payment-item-code"
                  value={it.service_code ?? ''}
                  onChange={(e) => patch(it.key, { service_code: e.target.value || null })}
                />
                <div className="flex gap-1">
                  {CHARGE_CLASSES.map((cc) => (
                    <button
                      key={cc}
                      type="button"
                      data-testid={`btn-charge-class-${cc}`}
                      onClick={() => patch(it.key, { charge_class: it.charge_class === cc ? null : cc })}
                      className={cn(
                        'h-9 rounded-md border px-3 text-xs font-medium transition',
                        it.charge_class === cc
                          ? 'border-teal-600 bg-teal-100 text-teal-800'
                          : 'border-input hover:bg-muted',
                      )}
                    >
                      {cc}
                    </button>
                  ))}
                </div>
              </div>

              {/* 3행: 횟수 × 단가 = 라인금액 */}
              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-muted-foreground">횟수</span>
                <Input
                  type="number"
                  min={1}
                  className="h-9 w-16 text-sm"
                  data-testid="input-payment-item-qty"
                  value={it.quantity}
                  onChange={(e) => patch(it.key, { quantity: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                />
                <span className="text-muted-foreground">×</span>
                <AmountInput
                  className="h-9 w-28"
                  placeholder="단가"
                  data-testid="input-payment-item-unit"
                  value={it.unit_price == null ? '' : String(it.unit_price)}
                  onChange={(v) => patch(it.key, { unit_price: v ? parseInt(v.replace(/[^0-9]/g, ''), 10) || 0 : null })}
                />
                <span className="ml-auto font-medium tabular-nums text-teal-800" data-testid="payment-item-line-amount">
                  {formatAmount(it.line_amount)}
                </span>
              </div>
            </div>
          ))}

          {/* 합계 + 불일치 경고 */}
          <div className="flex items-center justify-between border-t border-teal-200 pt-2 text-sm">
            <span className="font-medium text-teal-800">항목 합계</span>
            <span className="font-semibold tabular-nums text-teal-800" data-testid="payment-items-total">
              {formatAmount(total)}
            </span>
          </div>
          {mismatch && (
            <p
              className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-700"
              data-testid="payment-items-mismatch-warning"
            >
              ⚠ 항목 합계({formatAmount(total)})가 수납 총액({formatAmount(settlementTotal)})과 다릅니다. 확인해 주세요.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
