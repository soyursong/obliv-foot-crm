/**
 * PaymentMiniWindow — 풋센터 결제 미니창 (모달)
 * T-20260515-foot-PAYMENT-MINI-WINDOW
 *
 * 대시보드 수납대기 [결제하기] 클릭 시 오픈.
 * Phase 1 (AC-1~7 + AC-11): 서비스 코드 선택 → 수가 산정 → 세금 분류 → 수납
 * Phase 2 (AC-8~10): FORM-TEMPLATE-REFRESH 완료 후 서류발행 연동
 */

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Check, ChevronRight, CreditCard, Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { formatAmount } from '@/lib/format';
import type { CheckIn, Service } from '@/lib/types';

// ── 세금 구분 ────────────────────────────────────────────────────────────────

type TaxClass = '비급여(과세)' | '비급여(면세)' | '급여';

function getTaxClass(svc: Service): TaxClass {
  if (svc.is_insurance_covered) return '급여';
  if (svc.vat_type === 'exclusive' || svc.vat_type === 'inclusive') return '비급여(과세)';
  return '비급여(면세)';
}

// ── 탭 → category_label 매핑 ─────────────────────────────────────────────────

const TAB_LABELS = ['풋케어', '처방약', '화장품'] as const;
type TabLabel = (typeof TAB_LABELS)[number];

/** services.category_label 값 기준 그룹핑 */
const TAB_CATEGORY_MAP: Record<TabLabel, string[]> = {
  풋케어: ['풋케어', '기본', '검사', '수액'],
  처방약: ['상병'],
  화장품: ['풋화장품'],
};

type PayMethod = 'card' | 'cash' | 'transfer';

const METHOD_OPTIONS: { value: PayMethod; label: string }[] = [
  { value: 'card', label: '카드' },
  { value: 'cash', label: '현금' },
  { value: 'transfer', label: '이체' },
];

interface SelectedItem {
  service: Service;
  qty: number;
}

// ── Props ────────────────────────────────────────────────────────────────────

interface Props {
  checkIn: CheckIn | null;
  onClose: () => void;
  /** 수납 완료 후 (auto-done 포함) */
  onComplete: () => void;
  /** 시술 저장 완료 후 (AC-7 수납대기 금액 갱신용) */
  onSaved?: () => void;
}

// ── Component ────────────────────────────────────────────────────────────────

export function PaymentMiniWindow({ checkIn, onClose, onComplete, onSaved }: Props) {
  const [activeTab, setActiveTab] = useState<TabLabel>('풋케어');
  const [services, setServices] = useState<Service[]>([]);
  const [selectedItems, setSelectedItems] = useState<SelectedItem[]>([]);
  const [saved, setSaved] = useState(false);
  const [payMethod, setPayMethod] = useState<PayMethod>('card');
  const [submitting, setSubmitting] = useState(false);

  // ── 서비스 목록 로드 (탭 전환 시 재조회 불필요 — 전체 1회 로드) ──────────────
  useEffect(() => {
    if (!checkIn) return;
    supabase
      .from('services')
      .select('*')
      .eq('clinic_id', checkIn.clinic_id)
      .eq('active', true)
      .order('sort_order')
      .then(({ data }) => setServices((data ?? []) as Service[]));
    // 창 열릴 때마다 리셋
    setSelectedItems([]);
    setSaved(false);
    setPayMethod('card');
    setActiveTab('풋케어');
  }, [checkIn?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!checkIn) return null;

  // ── 현재 탭의 서비스 목록 ──────────────────────────────────────────────────
  const tabCategoryLabels = TAB_CATEGORY_MAP[activeTab];
  const tabServices = services.filter((svc) => {
    const label = svc.category_label ?? '';
    const cat = svc.category ?? '';
    return tabCategoryLabels.includes(label) || tabCategoryLabels.includes(cat);
  });

  // ── 코드 클릭 → 선택 목록에 추가 (같은 코드 클릭 시 수량 +1) ─────────────
  const handleSelectService = (svc: Service) => {
    setSelectedItems((prev) => {
      const idx = prev.findIndex((i) => i.service.id === svc.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: next[idx].qty + 1 };
        return next;
      }
      return [...prev, { service: svc, qty: 1 }];
    });
    setSaved(false);
  };

  // ── 항목 제거 ──────────────────────────────────────────────────────────────
  const handleRemoveItem = (serviceId: string) => {
    setSelectedItems((prev) => prev.filter((i) => i.service.id !== serviceId));
    setSaved(false);
  };

  // ── 세금 구분별 합산 금액 ────────────────────────────────────────────────
  const totalByTax: Record<TaxClass, number> = {
    '비급여(과세)': 0,
    '비급여(면세)': 0,
    급여: 0,
  };
  for (const { service, qty } of selectedItems) {
    const taxClass = getTaxClass(service);
    totalByTax[taxClass] += service.price * qty;
  }
  const grandTotal = Object.values(totalByTax).reduce((a, b) => a + b, 0);

  // ── AC-5: 시술 저장 및 금액 산정 ─────────────────────────────────────────
  const handleSave = async () => {
    if (selectedItems.length === 0) {
      toast.error('시술 코드를 선택해주세요');
      return;
    }

    // 기존 check_in_services 삭제 후 재삽입
    const { error: delError } = await supabase
      .from('check_in_services')
      .delete()
      .eq('check_in_id', checkIn.id);
    if (delError) {
      toast.error('저장 실패: ' + delError.message);
      return;
    }

    const rows = selectedItems.flatMap(({ service, qty }) =>
      Array.from({ length: qty }, () => ({
        check_in_id: checkIn.id,
        service_id: service.id,
        service_name: service.name,
        price: service.price,
        original_price: service.price,
        is_package_session: false,
      })),
    );

    const { error } = await supabase.from('check_in_services').insert(rows);
    if (error) {
      toast.error('저장 실패: ' + error.message);
      return;
    }

    setSaved(true);
    toast.success('시술 저장 완료 — 금액 산정됨');
    onSaved?.();
  };

  // ── AC-11: 수납 (PAYMENT-AUTO-DONE reuse) ─────────────────────────────────
  const handleSettle = async () => {
    if (!saved) {
      toast.error('[시술 저장 및 금액 산정]을 먼저 완료해주세요');
      return;
    }
    if (grandTotal <= 0) {
      toast.error('결제 금액이 없습니다');
      return;
    }
    setSubmitting(true);
    try {
      // 결제 기록 INSERT
      const { error: payErr } = await supabase.from('payments').insert({
        check_in_id: checkIn.id,
        clinic_id: checkIn.clinic_id,
        customer_id: checkIn.customer_id,
        amount: grandTotal,
        method: payMethod,
        installment: null,
        memo: null,
        payment_type: 'payment',
      });
      if (payErr) throw payErr;

      // payment_waiting → done (T-20260514-foot-PAYMENT-AUTO-DONE reuse)
      const { error: ciErr } = await supabase
        .from('check_ins')
        .update({ status: 'done' })
        .eq('id', checkIn.id);
      if (ciErr) throw ciErr;

      const { error: trErr } = await supabase.from('status_transitions').insert({
        check_in_id: checkIn.id,
        clinic_id: checkIn.clinic_id,
        from_status: checkIn.status,
        to_status: 'done',
      });
      if (trErr) {
        // status_transitions 실패는 치명적이지 않으므로 경고만
        console.warn('status_transitions insert failed:', trErr.message);
      }

      toast.success('수납 완료 — 완료 슬롯으로 이동됩니다');
      onComplete();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '수납 처리 실패';
      toast.error(msg);
      setSubmitting(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Dialog open={!!checkIn} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-w-3xl max-h-[85vh] p-0 overflow-hidden flex flex-col"
      >
        {/* 헤더 */}
        <DialogHeader className="px-5 pt-4 pb-3 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2 text-base font-semibold">
            <CreditCard className="h-4 w-4 text-purple-600" />
            결제 미니창 — {checkIn.customer_name}
            {checkIn.queue_number != null && (
              <span className="text-sm text-teal-600 font-normal">#{checkIn.queue_number}</span>
            )}
          </DialogTitle>
        </DialogHeader>

        {/* 본문 3열 */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* ── 좌측: 카테고리 탭 ── */}
          <div className="w-28 shrink-0 border-r bg-muted/30 flex flex-col py-2">
            {TAB_LABELS.map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={cn(
                  'w-full px-3 py-3 text-sm font-medium text-left transition border-l-2',
                  activeTab === tab
                    ? 'bg-teal-50 text-teal-700 border-teal-600'
                    : 'text-muted-foreground border-transparent hover:bg-muted',
                )}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* ── 중앙: 코드 목록 ── */}
          <div className="flex-1 overflow-y-auto p-3 space-y-1.5 min-w-0">
            {tabServices.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-8">
                등록된 코드가 없습니다
              </p>
            ) : (
              tabServices.map((svc) => {
                const taxClass = getTaxClass(svc);
                return (
                  <button
                    key={svc.id}
                    onClick={() => handleSelectService(svc)}
                    className="w-full text-left rounded-md border px-3 py-2.5 hover:bg-teal-50 hover:border-teal-300 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium leading-tight truncate">{svc.name}</p>
                        {svc.service_code && (
                          <p className="text-xs text-muted-foreground mt-0.5">{svc.service_code}</p>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-semibold tabular-nums">
                          {formatAmount(svc.price)}
                        </p>
                        <span
                          className={cn(
                            'text-xs rounded px-1.5 py-0.5 inline-block mt-0.5',
                            taxClass === '급여'
                              ? 'text-blue-700 bg-blue-50'
                              : taxClass === '비급여(과세)'
                                ? 'text-orange-700 bg-orange-50'
                                : 'text-gray-600 bg-gray-100',
                          )}
                        >
                          {taxClass}
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* ── 우측: 선택 목록 + 세금 분류 + 버튼 ── */}
          <div className="w-64 shrink-0 border-l flex flex-col min-h-0">
            {/* 선택 시술 목록 */}
            <div className="flex-1 overflow-y-auto p-3 space-y-1.5 min-h-0">
              <p className="text-xs font-semibold text-muted-foreground mb-2">
                선택 시술 ({selectedItems.length}건)
              </p>
              {selectedItems.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">
                  좌측에서 코드를 선택하세요
                </p>
              ) : (
                selectedItems.map(({ service, qty }) => (
                  <div
                    key={service.id}
                    className="flex items-center gap-1.5 rounded border px-2.5 py-2 bg-white"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium leading-tight truncate">{service.name}</p>
                      <p className="text-xs text-muted-foreground tabular-nums mt-0.5">
                        {formatAmount(service.price)}
                        {qty > 1 && (
                          <span className="text-teal-600 font-medium"> ×{qty}</span>
                        )}
                        {qty > 1 && (
                          <span className="text-muted-foreground">
                            {' '}= {formatAmount(service.price * qty)}
                          </span>
                        )}
                      </p>
                    </div>
                    <button
                      onClick={() => handleRemoveItem(service.id)}
                      className="shrink-0 text-muted-foreground hover:text-destructive transition-colors p-0.5"
                      title="제거"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* 세금 구분 + 합산 */}
            <div className="border-t px-3 py-2.5 bg-muted/20 shrink-0 space-y-1">
              <p className="text-xs font-semibold text-muted-foreground">세금 구분</p>
              {(Object.entries(totalByTax) as [TaxClass, number][]).map(([cls, amt]) => (
                <div key={cls} className="flex justify-between text-xs">
                  <span className="text-muted-foreground">{cls}</span>
                  <span className="tabular-nums font-medium">{formatAmount(amt)}</span>
                </div>
              ))}
              <div className="flex justify-between text-sm font-bold pt-1 border-t">
                <span>합계</span>
                <span className="tabular-nums text-purple-700">{formatAmount(grandTotal)}</span>
              </div>
            </div>

            {/* 액션 버튼 */}
            <div className="px-3 pt-2 pb-3 space-y-2 shrink-0 border-t">
              {/* AC-5: 시술 저장 및 금액 산정 */}
              <Button
                variant="outline"
                className="w-full text-xs h-9"
                onClick={handleSave}
                disabled={selectedItems.length === 0}
              >
                {saved ? (
                  <>
                    <Check className="h-3.5 w-3.5 mr-1.5 text-teal-600" />
                    저장됨
                  </>
                ) : (
                  <>
                    <ChevronRight className="h-3.5 w-3.5 mr-1.5" />
                    시술 저장 및 금액 산정
                  </>
                )}
              </Button>

              {/* 결제 수단 선택 (저장 후 표시) */}
              {saved && (
                <div className="flex gap-1">
                  {METHOD_OPTIONS.map((m) => (
                    <button
                      key={m.value}
                      onClick={() => setPayMethod(m.value)}
                      className={cn(
                        'flex-1 h-8 rounded text-xs font-medium border transition-colors',
                        payMethod === m.value
                          ? 'bg-purple-600 text-white border-purple-600'
                          : 'border-input hover:bg-muted',
                      )}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              )}

              {/* AC-11: 수납 버튼 (저장 후 표시) */}
              {saved && (
                <Button
                  className="w-full h-10 bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold"
                  onClick={handleSettle}
                  disabled={submitting}
                >
                  {submitting ? '처리 중...' : `수납 ${formatAmount(grandTotal)}`}
                </Button>
              )}

              {/* Phase 2 placeholder (AC-8~10 — FORM-TEMPLATE-REFRESH 완료 후) */}
              <div className="rounded border border-dashed border-muted-foreground/30 p-2 text-center">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  서류발행 (출력 / 출력 및 수납)
                  <br />
                  FORM-TEMPLATE-REFRESH 완료 후 활성화
                </p>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
