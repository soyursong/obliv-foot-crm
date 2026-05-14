/**
 * PaymentMiniWindow — 풋센터 결제 미니창 (모달)
 * T-20260515-foot-PAYMENT-MINI-WINDOW
 *
 * 대시보드 수납대기 [결제하기] 클릭 시 오픈.
 * Phase 1 (AC-1~7 + AC-11): 서비스 코드 선택 → 수가 산정 → 세금 분류 → 수납
 * Phase 2 (AC-8~10): 서류발행 섹션 — FORM-TEMPLATE-REFRESH 완료 후 활성화
 */

import { useEffect, useRef, useState } from 'react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import {
  Check,
  ChevronRight,
  CreditCard,
  FileText,
  Printer,
  Square,
  CheckSquare,
  Trash2,
} from 'lucide-react';
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
import {
  FALLBACK_TEMPLATES,
  FORM_META,
  getTemplateImageUrl,
  getStampUrl,
  type FormTemplate,
  type FieldMapEntry,
} from '@/lib/formTemplates';

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

// ── draft persist (localStorage) ─────────────────────────────────────────────
// T-20260515-foot-PAYMENT-CODE-PERSIST: 시술코드 선택 후 모달 닫기→재오픈 시 유지
// Key: `payment-draft-{checkIn.id}` → AC-3 슬롯 간 격리 자동 보장

interface DraftItem {
  serviceId: string;
  qty: number;
}

function draftKey(checkInId: string): string {
  return `payment-draft-${checkInId}`;
}

// ── 서류 출력 유틸 (DocumentPrintPanel 패턴 인라인) ──────────────────────────

/** 자동 바인딩 값 로드 (미니창용 — 기본 필드만) */
async function loadMiniAutoBindValues(checkIn: CheckIn): Promise<Record<string, string>> {
  const today = format(new Date(), 'yyyy-MM-dd');
  const visitDate = checkIn.checked_in_at
    ? format(new Date(checkIn.checked_in_at), 'yyyy-MM-dd')
    : today;

  // 고객 정보
  let patientName = checkIn.customer_name ?? '';
  let patientRrn = '';
  if (checkIn.customer_id) {
    const { data } = await supabase
      .from('customers')
      .select('name, memo')
      .eq('id', checkIn.customer_id)
      .maybeSingle();
    if (data) patientName = data.name ?? patientName;
  }

  // 클리닉 정보
  const { data: clinicData } = await supabase
    .from('clinics')
    .select('name, address')
    .eq('id', checkIn.clinic_id)
    .maybeSingle();

  // 결제 합계 (check_in_services 기반)
  const { data: cisData } = await supabase
    .from('check_in_services')
    .select('price')
    .eq('check_in_id', checkIn.id);
  const totalAmount = (cisData ?? []).reduce((s, r) => s + (r.price ?? 0), 0);

  // 원장님 — duty_roster → staff fallback
  let doctorName = '';
  const { data: rosterData } = await supabase
    .from('duty_roster')
    .select('staff:staff(name)')
    .eq('clinic_id', checkIn.clinic_id)
    .eq('date', visitDate)
    .eq('active', true)
    .limit(1);
  if (rosterData && rosterData.length > 0) {
    const staffEntry = rosterData[0].staff;
    const svc = Array.isArray(staffEntry) ? staffEntry[0] : staffEntry;
    doctorName = (svc as { name?: string } | null)?.name ?? '';
  }
  if (!doctorName) {
    const { data: staffData } = await supabase
      .from('staff')
      .select('name')
      .eq('clinic_id', checkIn.clinic_id)
      .eq('role', 'director')
      .eq('active', true)
      .limit(1)
      .maybeSingle();
    doctorName = staffData?.name ?? '';
  }

  return {
    patient_name: patientName,
    patient_rrn: patientRrn,
    visit_date: visitDate,
    issue_date: today,
    doctor_name: doctorName,
    total_amount: totalAmount > 0 ? formatAmount(totalAmount) : '',
    clinic_name: clinicData?.name ?? '오블리브 풋센터 종로',
    clinic_address: clinicData?.address ?? '',
    diagnosis_ko: '',
  };
}

/** 단일 양식의 인쇄용 HTML page div 생성 */
function buildPageHtml(
  template: FormTemplate,
  fieldValues: Record<string, string>,
  imgUrl: string,
): string {
  const stampUrl = getStampUrl();

  const overlayHtml =
    template.field_map.length > 0
      ? template.field_map
          .map((f: FieldMapEntry) => {
            const val = fieldValues[f.key] ?? '';
            if (!val) return '';
            const style = [
              'position:absolute',
              `left:${f.x}px`,
              `top:${f.y}px`,
              f.w ? `width:${f.w}px` : '',
              f.h ? `height:${f.h}px` : '',
              `font-size:${f.font ?? 14}px`,
              "font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif",
              'color:#000',
              'line-height:1.4',
              'white-space:pre-wrap',
            ]
              .filter(Boolean)
              .join(';');
            return `<div style="${style}">${val}</div>`;
          })
          .join('\n')
      : `<div style="position:absolute;bottom:20px;left:20px;background:rgba(255,245,157,0.9);padding:8px 12px;border-radius:4px;font-size:13px;color:#333;">
           ⚠ 좌표 미설정 — 원본 양식만 표시됩니다.
         </div>`;

  const stampHtml = stampUrl
    ? `<img src="${stampUrl}" alt="원내 도장"
        style="position:absolute;right:52px;bottom:52px;width:88px;height:88px;opacity:0.85;pointer-events:none;"
        onerror="this.style.display='none'" />`
    : '';

  return `<div class="page">
  <img src="${imgUrl}" alt="${template.name_ko}" />
  ${overlayHtml}
  ${stampHtml}
</div>`;
}

/** 여러 page div를 하나의 인쇄 창으로 출력 */
function openBatchPrintWindow(pages: string[], title: string): Window | null {
  const html = `<!DOCTYPE html><html><head>
<meta charset="utf-8">
<title>${title}</title>
<style>
  @page { size: A4; margin: 0; }
  body { margin: 0; padding: 0; }
  .page {
    position: relative;
    width: 210mm;
    height: 297mm;
    overflow: hidden;
    page-break-after: always;
  }
  .page img:first-child {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head><body>
${pages.join('\n')}
</body></html>`;

  const w = window.open('', '_blank');
  if (!w) return null;
  w.document.write(html);
  w.document.close();
  w.focus();

  const firstImg = w.document.querySelector('img');
  if (firstImg) {
    firstImg.onload = () => w.print();
  } else {
    setTimeout(() => w.print(), 600);
  }
  return w;
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

  // ── Phase 2 — 서류발행 (AC-8~10) ──────────────────────────────────────────
  const [templates, setTemplates] = useState<FormTemplate[]>([]);
  const [selectedDocKeys, setSelectedDocKeys] = useState<Set<string>>(new Set());
  const [docPrinting, setDocPrinting] = useState(false);
  const [docSettlePrinting, setDocSettlePrinting] = useState(false);

  // T-20260515-foot-PAYMENT-CODE-PERSIST: 비동기 초기 로드 중 persist effect 차단용 ref
  // (로드 완료 전 selectedItems=[] 상태를 draft로 덮어쓰는 것 방지)
  const skipPersistRef = useRef(true);

  // ── 서비스 목록 + 기존 시술 pre-load + 양식 목록 로드 ────────────────────────
  useEffect(() => {
    if (!checkIn) return;

    // 비동기 로드 시작 전 persist effect 차단 (빈 상태를 draft로 저장하는 것 방지)
    skipPersistRef.current = true;

    // 창 열릴 때마다 즉시 리셋 (비동기 로드 전에 빈 상태로 시작)
    setSelectedItems([]);
    setSaved(false);
    setPayMethod('card');
    setActiveTab('풋케어');
    setSelectedDocKeys(new Set());
    // T-20260514-foot-PAYMENT-CONSECUTIVE-STUCK BUG2 fix:
    // checkIn 변경 시 submitting 계열 state 리셋 — 연속 수납 시 이전 환자의 submitting=true 잔류 방지
    setSubmitting(false);
    setDocPrinting(false);
    setDocSettlePrinting(false);

    // T-20260514-foot-DASH-REALTIME-FAIL AC-1 fix:
    // services + 기존 check_in_services 동시 로드 → pre-populate selectedItems
    // 수납대기 카드에 이미 시술이 저장되어 있을 경우, 재선택 없이 바로 수납 가능
    Promise.all([
      supabase
        .from('services')
        .select('*')
        .eq('clinic_id', checkIn.clinic_id)
        .eq('active', true)
        .order('sort_order'),
      supabase
        .from('check_in_services')
        .select('service_id, price')
        .eq('check_in_id', checkIn.id),
      supabase
        .from('form_templates')
        .select('*')
        .eq('clinic_id', checkIn.clinic_id)
        .eq('category', 'foot-service')
        .eq('active', true)
        .order('sort_order'),
    ]).then(([svcsRes, cisRes, tplRes]) => {
      const svcs = (svcsRes.data ?? []) as Service[];
      setServices(svcs);

      // 기존 check_in_services가 있으면 selectedItems pre-populate + saved=true
      const existingCis = (cisRes.data ?? []) as { service_id: string; price: number }[];
      if (existingCis.length > 0) {
        const items: SelectedItem[] = [];
        for (const ci of existingCis) {
          const svc = svcs.find((s) => s.id === ci.service_id);
          if (svc) {
            const existing = items.find((i) => i.service.id === svc.id);
            if (existing) {
              existing.qty += 1;
            } else {
              items.push({ service: svc, qty: 1 });
            }
          }
        }
        if (items.length > 0) {
          setSelectedItems(items);
          setSaved(true); // DB에 이미 저장된 데이터 → saved=true로 즉시 수납 가능
        }
        // DB가 정본 → 잔류 draft 제거
        localStorage.removeItem(draftKey(checkIn.id));
      } else {
        // T-20260515-foot-PAYMENT-CODE-PERSIST AC-1:
        // DB에 check_in_services 없으면 localStorage draft 복원 (모달 닫기→재열기 시 코드 유지)
        try {
          const raw = localStorage.getItem(draftKey(checkIn.id));
          if (raw) {
            const draft: DraftItem[] = JSON.parse(raw);
            const items: SelectedItem[] = draft
              .map((d) => {
                const svc = svcs.find((s) => s.id === d.serviceId);
                return svc ? { service: svc, qty: d.qty } : null;
              })
              .filter((x): x is SelectedItem => x !== null);
            if (items.length > 0) {
              setSelectedItems(items);
              // saved=false 유지 — DB에 없으므로 저장 버튼 필요
            }
          }
        } catch {
          // 파싱 실패 시 draft 폐기 (corrupt data)
          localStorage.removeItem(draftKey(checkIn.id));
        }
      }

      setTemplates(
        tplRes.data && tplRes.data.length > 0
          ? (tplRes.data as FormTemplate[])
          : FALLBACK_TEMPLATES,
      );

      // 비동기 로드 완료 — 이후 selectedItems 변경은 persist effect가 처리
      skipPersistRef.current = false;
    });
  }, [checkIn?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // T-20260515-foot-PAYMENT-CODE-PERSIST AC-1/AC-3: 미저장 draft → localStorage 동기화
  // saved=false 상태에서 selectedItems 변경 시마다 슬롯별 키로 저장
  useEffect(() => {
    if (!checkIn || skipPersistRef.current) return;
    if (saved) {
      // DB가 정본 — 잔류 draft 제거
      localStorage.removeItem(draftKey(checkIn.id));
      return;
    }
    if (selectedItems.length === 0) {
      localStorage.removeItem(draftKey(checkIn.id));
      return;
    }
    const draft: DraftItem[] = selectedItems.map((i) => ({ serviceId: i.service.id, qty: i.qty }));
    localStorage.setItem(draftKey(checkIn.id), JSON.stringify(draft));
  }, [selectedItems, saved, checkIn?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
    // T-20260515-foot-PAYMENT-CODE-PERSIST: draft → DB로 승격, localStorage 클리어
    localStorage.removeItem(draftKey(checkIn.id));
    toast.success('시술 저장 완료 — 금액 산정됨');
    onSaved?.();
  };

  // ── auto-done 공통 핸들러 (PAYMENT-AUTO-DONE reuse) ──────────────────────
  const executeAutoDone = async (amount: number, method: PayMethod) => {
    const { error: payErr } = await supabase.from('payments').insert({
      check_in_id: checkIn.id,
      clinic_id: checkIn.clinic_id,
      customer_id: checkIn.customer_id,
      amount,
      method,
      installment: null,
      memo: null,
      payment_type: 'payment',
    });
    if (payErr) throw payErr;

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
      console.warn('status_transitions insert failed:', trErr.message);
    }
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
      await executeAutoDone(grandTotal, payMethod);
      // T-20260515-foot-PAYMENT-CODE-PERSIST AC-2: 결제 완료 시 draft 클리어
      localStorage.removeItem(draftKey(checkIn.id));
      toast.success('수납 완료 — 완료 슬롯으로 이동됩니다');
      setSubmitting(false); // PAYMENT-SUBMIT-STUCK: success path에서도 명시 해제
      onComplete();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '수납 처리 실패';
      toast.error(msg);
      setSubmitting(false);
    }
  };

  // ── AC-8: 서류 체크박스 토글 ──────────────────────────────────────────────
  const toggleDocKey = (formKey: string) => {
    setSelectedDocKeys((prev) => {
      const next = new Set(prev);
      if (next.has(formKey)) next.delete(formKey);
      else next.add(formKey);
      return next;
    });
  };

  // ── AC-9: [출력] — 서류 인쇄 (수납 없음) ─────────────────────────────────
  const handleDocPrint = async () => {
    const selected = templates.filter((t) => selectedDocKeys.has(t.form_key));
    if (selected.length === 0) {
      toast.error('서류를 선택해주세요');
      return;
    }
    setDocPrinting(true);
    try {
      const autoValues = await loadMiniAutoBindValues(checkIn);
      const pages = selected.flatMap((t) => {
        const imgUrl = getTemplateImageUrl(t.form_key);
        if (!imgUrl) return [];
        return [buildPageHtml(t, autoValues, imgUrl)];
      });
      if (pages.length === 0) {
        toast.warning('출력 가능한 이미지 양식이 없습니다');
        return;
      }
      const w = openBatchPrintWindow(pages, `서류 출력 — ${checkIn.customer_name}`);
      if (!w) {
        toast.error('팝업이 차단되었습니다. 팝업을 허용해주세요.');
        return;
      }
      toast.success(`${selected.length}종 출력 요청됨`);
    } finally {
      setDocPrinting(false);
    }
  };

  // ── AC-10: [출력 및 수납] — 서류 인쇄 + auto-done ─────────────────────────
  const handleDocAndSettle = async () => {
    const selected = templates.filter((t) => selectedDocKeys.has(t.form_key));
    if (selected.length === 0) {
      toast.error('서류를 선택해주세요');
      return;
    }
    if (!saved) {
      toast.error('[시술 저장 및 금액 산정]을 먼저 완료해주세요');
      return;
    }
    if (grandTotal <= 0) {
      toast.error('결제 금액이 없습니다');
      return;
    }
    setDocSettlePrinting(true);
    try {
      // 1. 서류 출력
      const autoValues = await loadMiniAutoBindValues(checkIn);
      const pages = selected.flatMap((t) => {
        const imgUrl = getTemplateImageUrl(t.form_key);
        if (!imgUrl) return [];
        return [buildPageHtml(t, autoValues, imgUrl)];
      });
      if (pages.length > 0) {
        const w = openBatchPrintWindow(pages, `서류 출력 — ${checkIn.customer_name}`);
        if (!w) {
          toast.error('팝업이 차단되었습니다. 팝업을 허용해주세요.');
          setDocSettlePrinting(false);
          return;
        }
      }

      // 2. 수납 + auto-done (PAYMENT-AUTO-DONE reuse)
      await executeAutoDone(grandTotal, payMethod);
      // T-20260515-foot-PAYMENT-CODE-PERSIST AC-2: 결제 완료 시 draft 클리어
      localStorage.removeItem(draftKey(checkIn.id));
      toast.success('출력 및 수납 완료 — 완료 슬롯으로 이동됩니다');
      setDocSettlePrinting(false); // PAYMENT-SUBMIT-STUCK AC-2: success path에서도 명시 해제
      onComplete();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '출력 및 수납 처리 실패';
      toast.error(msg);
      setDocSettlePrinting(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Dialog open={!!checkIn} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-w-3xl max-h-[90vh] p-0 overflow-hidden flex flex-col"
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
        <div className="flex min-h-0" style={{ height: '340px' }}>
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

              {/* PAYMENT-BLOCKED AC-2: 산정 미완료 안내 — 항목 선택 후 저장 전 */}
              {!saved && selectedItems.length > 0 && (
                <p
                  className="text-xs text-amber-600 flex items-center gap-1"
                  data-testid="settle-hint"
                >
                  <ChevronRight className="h-3 w-3 shrink-0" />
                  금액 산정 완료 후 수납 버튼이 나타납니다
                </p>
              )}

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
                  data-testid="btn-settle"
                >
                  {submitting ? '처리 중...' : `수납 ${formatAmount(grandTotal)}`}
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* ── Phase 2: 서류발행 섹션 (AC-8~10) ────────────────────────────────── */}
        <div className="border-t bg-slate-50 flex flex-col shrink-0">
          {/* 섹션 헤더 */}
          <div className="flex items-center gap-2 px-4 pt-3 pb-2">
            <FileText className="h-3.5 w-3.5 text-teal-600" />
            <span className="text-xs font-semibold text-teal-700">서류발행</span>
            {selectedDocKeys.size > 0 && (
              <span className="text-xs text-muted-foreground">({selectedDocKeys.size}종 선택)</span>
            )}
          </div>

          {/* 서류 체크박스 목록 */}
          <div className="px-4 pb-2">
            <div className="flex flex-wrap gap-1.5" data-testid="doc-template-list">
              {templates.map((tpl) => {
                const meta = FORM_META[tpl.form_key];
                const isSelected = selectedDocKeys.has(tpl.form_key);
                return (
                  <button
                    key={tpl.form_key}
                    onClick={() => toggleDocKey(tpl.form_key)}
                    className={cn(
                      'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all',
                      isSelected
                        ? 'bg-teal-600 text-white border-teal-600'
                        : 'bg-white text-muted-foreground border-gray-200 hover:border-teal-300 hover:text-teal-700',
                    )}
                    data-testid={`doc-checkbox-${tpl.form_key}`}
                  >
                    {isSelected ? (
                      <CheckSquare className="h-3 w-3 shrink-0" />
                    ) : (
                      <Square className="h-3 w-3 shrink-0" />
                    )}
                    <span>{meta?.icon ?? '📄'} {tpl.name_ko}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* AC-9/10 버튼 */}
          <div className="flex items-center gap-2 px-4 pb-3">
            {/* AC-9: 출력 */}
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs border-teal-300 text-teal-700 hover:bg-teal-50"
              onClick={handleDocPrint}
              disabled={docPrinting || selectedDocKeys.size === 0}
              data-testid="btn-doc-print"
            >
              <Printer className="h-3.5 w-3.5" />
              {docPrinting ? '출력 중...' : '출력'}
            </Button>

            {/* AC-10: 출력 및 수납 */}
            <Button
              size="sm"
              className="gap-1.5 text-xs bg-purple-600 hover:bg-purple-700 text-white"
              onClick={handleDocAndSettle}
              disabled={docSettlePrinting || selectedDocKeys.size === 0 || !saved}
              data-testid="btn-doc-settle"
            >
              <Printer className="h-3.5 w-3.5" />
              {docSettlePrinting ? '처리 중...' : `출력 및 수납${saved ? ` ${formatAmount(grandTotal)}` : ''}`}
            </Button>

            {!saved && selectedDocKeys.size > 0 && (
              <span className="text-xs text-amber-600">시술 저장 후 활성화</span>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
