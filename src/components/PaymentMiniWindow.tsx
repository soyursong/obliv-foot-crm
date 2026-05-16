/**
 * PaymentMiniWindow — 풋센터 결제 미니창 (모달)
 *
 * T-20260515-foot-PAYMENT-MINI-WINDOW  기본 구현 (closed ba5c866)
 * T-20260517-foot-PAYMENT-MENU-REVAMP  좌측 메뉴 3탭 재구성 + 풋케어 4×5 그리드
 * T-20260517-foot-PAY-SLOT-MOVE        슬롯 이동 버그 수정 + iframe 인쇄 (중복 창 제거)
 * T-20260517-foot-PAY-CASH-RECEIPT     현금영수증 체크박스 + 일일마감 연동
 * T-20260517-foot-PREPAID-DEDUCT       선수금차감 듀얼 버튼 + 보라색 선택박스 + 2번차트 자동매칭
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import {
  Check,
  ChevronLeft,
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

// ── 탭 + 카테고리 매핑 ──────────────────────────────────────────────────────
// T-20260517-foot-PAYMENT-MENU-REVAMP: 탭 3종 재구성
// 구: [풋케어 / 처방약 / 화장품]  →  신: [상병코드 / 처방약 / 풋케어]

const TAB_LABELS = ['상병코드', '처방약', '풋케어'] as const;
type TabLabel = (typeof TAB_LABELS)[number];

const TAB_CATEGORY_MAP: Record<TabLabel, string[]> = {
  상병코드: ['상병'],
  처방약: ['처방약'],
  풋케어: ['기본', '검사', '풋케어', '수액', '풋화장품'],
};

// 풋케어 4대 서브 카테고리 (AC-4: 4×5 그리드)
const FOOTCARE_CATS = ['기본(진찰료)', '시술내역(풋케어)', '수액', '화장품'] as const;
type FootCatType = (typeof FOOTCARE_CATS)[number];

const FOOTCARE_CAT_LABELS: Record<FootCatType, string[]> = {
  '기본(진찰료)': ['기본', '검사'],
  '시술내역(풋케어)': ['풋케어'],
  '수액': ['수액'],
  '화장품': ['풋화장품'],
};

const GRID_PAGE_SIZE = 20; // 4 cols × 5 rows

// 서비스 항목이 "코드 전용" (상병코드·처방약)인지 여부
function isCodeItem(svc: Service): boolean {
  const label = svc.category_label ?? '';
  return label === '상병' || label === '처방약';
}

// ── 선수금차감 2-tier 자동 매칭 ──────────────────────────────────────────────
// T-20260517-foot-PREPAID-DEDUCT AC-3 확정 기준
const PREPAID_KEYWORDS = ['가열', '비가열', '포돌로게', '수액'] as const;
const PREPAID_CODE_MAP: Record<string, string[]> = {
  가열: ['SZ035-35'],
  비가열: ['SZ035-30'],
  포돌로게: ['BC1300MB08'],
};
// 수액은 코드가 없으므로 category 기반 매칭

// ── 결제수단 ────────────────────────────────────────────────────────────────

type PayMethod = 'card' | 'cash' | 'transfer';

const METHOD_OPTIONS: { value: PayMethod; label: string }[] = [
  { value: 'card', label: '카드' },
  { value: 'cash', label: '현금' },
  { value: 'transfer', label: '이체' },
];

// ── 선택 항목 ───────────────────────────────────────────────────────────────

interface SelectedItem {
  service: Service;
  qty: number;
}

// ── draft persist (localStorage) ─────────────────────────────────────────────
// T-20260515-foot-PAYMENT-CODE-PERSIST

interface DraftItem {
  serviceId: string;
  qty: number;
}

function draftKey(checkInId: string): string {
  return `payment-draft-${checkInId}`;
}

// ── 인쇄 유틸 — iframe 방식 (PAY-SLOT-MOVE AC-4: 중복 창 제거) ───────────────

function buildPrintHtml(pages: string[], title: string): string {
  return `<!DOCTYPE html><html><head>
<meta charset="utf-8"><title>${title}</title>
<style>
  @page { size: A4; margin: 0; }
  body { margin: 0; padding: 0; }
  .page {
    position: relative;
    width: 210mm; height: 297mm;
    overflow: hidden;
    page-break-after: always;
  }
  .page img:first-child { width: 100%; height: 100%; object-fit: contain; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head><body>${pages.join('\n')}</body></html>`;
}

/** iframe 인쇄 — 단 하나의 OS 프린트 다이얼로그만 노출 */
function printViaIframe(html: string): void {
  const iframe = document.createElement('iframe');
  iframe.style.cssText =
    'position:fixed;top:-9999px;left:-9999px;width:210mm;height:297mm;border:0;';
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument!;
  doc.open();
  doc.write(html);
  doc.close();

  const doPrint = () => {
    try {
      iframe.contentWindow?.print();
    } catch {
      /* ignore */
    }
    setTimeout(() => {
      try { document.body.removeChild(iframe); } catch { /* ignore */ }
    }, 3000);
  };

  const imgs = Array.from(doc.querySelectorAll('img'));
  if (imgs.length === 0) {
    setTimeout(doPrint, 300);
    return;
  }
  let loaded = 0;
  const onLoad = () => {
    loaded++;
    if (loaded >= imgs.length) doPrint();
  };
  imgs.forEach((img) => {
    img.onload = onLoad;
    img.onerror = onLoad;
    if (img.complete) onLoad();
  });
  setTimeout(doPrint, 4000); // fallback
}

/** 단일 양식 page div 생성 */
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

/** 자동 바인딩 값 로드 (미니창용 — 기본 필드만) */
async function loadMiniAutoBindValues(checkIn: CheckIn): Promise<Record<string, string>> {
  const today = format(new Date(), 'yyyy-MM-dd');
  const visitDate = checkIn.checked_in_at
    ? format(new Date(checkIn.checked_in_at), 'yyyy-MM-dd')
    : today;

  let patientName = checkIn.customer_name ?? '';
  if (checkIn.customer_id) {
    const { data } = await supabase
      .from('customers')
      .select('name')
      .eq('id', checkIn.customer_id)
      .maybeSingle();
    if (data) patientName = data.name ?? patientName;
  }

  const { data: clinicData } = await supabase
    .from('clinics')
    .select('name, address')
    .eq('id', checkIn.clinic_id)
    .maybeSingle();

  const { data: cisData } = await supabase
    .from('check_in_services')
    .select('price')
    .eq('check_in_id', checkIn.id);
  const totalAmount = (cisData ?? []).reduce((s, r) => s + (r.price ?? 0), 0);

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
    patient_rrn: '',
    visit_date: visitDate,
    issue_date: today,
    doctor_name: doctorName,
    total_amount: totalAmount > 0 ? formatAmount(totalAmount) : '',
    clinic_name: clinicData?.name ?? '오블리브 풋센터 종로',
    clinic_address: clinicData?.address ?? '',
    diagnosis_ko: '',
  };
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
  // ── Tab + Grid
  const [activeTab, setActiveTab] = useState<TabLabel>('풋케어');
  const [footcareCat, setFootcareCat] = useState<FootCatType>('기본(진찰료)');
  const [footcarePage, setFootcarePage] = useState(0);

  // ── Services + Selection
  const [services, setServices] = useState<Service[]>([]);
  const [selectedItems, setSelectedItems] = useState<SelectedItem[]>([]);
  const [saved, setSaved] = useState(false);
  const [payMethod, setPayMethod] = useState<PayMethod>('card');
  const [submitting, setSubmitting] = useState(false);

  // ── PAY-CASH-RECEIPT: 현금영수증
  const [cashReceiptIssued, setCashReceiptIssued] = useState(false);
  const [cashReceiptType, setCashReceiptType] = useState<'income_deduction' | 'expense_proof'>(
    'income_deduction',
  );

  // ── PREPAID-DEDUCT: 선수금차감 UI
  const [prepaidIds, setPrepaidIds] = useState<Set<string>>(new Set());
  const [customAmounts, setCustomAmounts] = useState<Map<string, number>>(new Map());
  const [editingPriceId, setEditingPriceId] = useState<string | null>(null);
  const [editingPriceValue, setEditingPriceValue] = useState('');
  const [deductMode, setDeductMode] = useState(false);
  const [deductAmount, setDeductAmount] = useState(0);
  const [hasActivePackage, setHasActivePackage] = useState(false);

  // ── Phase 2: 서류발행 (AC-8~10)
  const [templates, setTemplates] = useState<FormTemplate[]>([]);
  const [selectedDocKeys, setSelectedDocKeys] = useState<Set<string>>(new Set());
  const [docPrinting, setDocPrinting] = useState(false);
  const [docSettlePrinting, setDocSettlePrinting] = useState(false);

  // ── persist ref
  const skipPersistRef = useRef(true);

  // ── 서비스 목록 + 기존 시술 pre-load + 패키지 세션 + 양식 목록 ─────────────
  useEffect(() => {
    if (!checkIn) return;
    skipPersistRef.current = true;

    setSelectedItems([]);
    setSaved(false);
    setPayMethod('card');
    setActiveTab('풋케어');
    setFootcareCat('기본(진찰료)');
    setFootcarePage(0);
    setSelectedDocKeys(new Set());
    setSubmitting(false);
    setDocPrinting(false);
    setDocSettlePrinting(false);
    setCashReceiptIssued(false);
    setCashReceiptType('income_deduction');
    setPrepaidIds(new Set());
    setCustomAmounts(new Map());
    setDeductMode(false);
    setDeductAmount(0);

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

      const existingCis = (cisRes.data ?? []) as { service_id: string; price: number }[];
      if (existingCis.length > 0) {
        const items: SelectedItem[] = [];
        const overrides = new Map<string, number>();
        for (const ci of existingCis) {
          const svc = svcs.find((s) => s.id === ci.service_id);
          if (svc) {
            const existing = items.find((i) => i.service.id === svc.id);
            if (existing) {
              existing.qty += 1;
            } else {
              items.push({ service: svc, qty: 1 });
              // 가격 override 복원 (DB price ≠ service.price인 경우)
              if (ci.price !== svc.price) {
                overrides.set(svc.id, ci.price);
              }
            }
          }
        }
        if (items.length > 0) {
          setSelectedItems(items);
          if (overrides.size > 0) setCustomAmounts(overrides);
          setSaved(true);
        }
        localStorage.removeItem(draftKey(checkIn.id));
      } else {
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
            if (items.length > 0) setSelectedItems(items);
          }
        } catch {
          localStorage.removeItem(draftKey(checkIn.id));
        }
      }

      setTemplates(
        tplRes.data && tplRes.data.length > 0
          ? (tplRes.data as FormTemplate[])
          : FALLBACK_TEMPLATES,
      );

      skipPersistRef.current = false;
    });

    // PREPAID-DEDUCT: 오늘 2번차트 차감 이력 로드 (자동 매칭용)
    if (checkIn.customer_id) {
      loadTodayPackageSessions(checkIn.customer_id);
    }
  }, [checkIn?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 오늘 패키지 세션 로드 → 서비스 목록과 매칭해 자동 prepaid 선택 ──────────
  const loadTodayPackageSessions = useCallback(
    async (customerId: string) => {
      // 1. 활성 패키지 존재 여부 확인
      const { data: pkgData } = await supabase
        .from('packages')
        .select('id')
        .eq('customer_id', customerId)
        .eq('status', 'active');

      const activePkgs = (pkgData ?? []) as { id: string }[];
      setHasActivePackage(activePkgs.length > 0);
      if (activePkgs.length === 0) return;

      // 2. 오늘 차감된 세션 조회
      const today = format(new Date(), 'yyyy-MM-dd');
      const pkgIds = activePkgs.map((p) => p.id);
      const { data: sessData } = await supabase
        .from('package_sessions')
        .select('session_type')
        .in('package_id', pkgIds)
        .eq('session_date', today)
        .eq('status', 'used');

      const sessions = (sessData ?? []) as { session_type: string }[];
      if (sessions.length === 0) return;

      // 3. services가 로드된 이후에 매칭 → services state를 직접 참조하면 stale할 수 있으므로
      //    잠시 후 실행하거나 services 파라미터 받아야 함.
      //    여기서는 closure capture 의도적으로 허용 (services는 이미 setServices 직후)
      //    실제 매칭은 별도 effect에서 (services + sessions 모두 준비된 시점)
      setTodaySessionTypes(sessions.map((s) => s.session_type ?? ''));
    },
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const [todaySessionTypes, setTodaySessionTypes] = useState<string[]>([]);

  // ── 2번차트 자동 매칭: services + todaySessionTypes 모두 준비된 시점 ──────────
  useEffect(() => {
    if (todaySessionTypes.length === 0 || services.length === 0) return;

    const autoIds = new Set<string>();
    for (const svcItem of services) {
      if (isCodeItem(svcItem)) continue; // 상병코드·처방약 제외
      for (const st of todaySessionTypes) {
        // 1차: keyword 포함 확인
        const matchedKw = PREPAID_KEYWORDS.find((kw) => st.includes(kw));
        if (!matchedKw) continue;

        if (matchedKw === '수액') {
          // 수액: category 기반 매칭
          if (
            (svcItem.category_label ?? '').includes('수액') ||
            (svcItem.category ?? '').includes('수액')
          ) {
            autoIds.add(svcItem.id);
          }
        } else {
          // 2차: 정밀 코드 매핑
          const codes = PREPAID_CODE_MAP[matchedKw] ?? [];
          if (codes.length > 0 && svcItem.service_code && codes.includes(svcItem.service_code)) {
            autoIds.add(svcItem.id);
          } else if (svcItem.name.includes(matchedKw)) {
            // fallback: 이름 포함
            autoIds.add(svcItem.id);
          }
        }
      }
    }

    if (autoIds.size > 0) {
      setPrepaidIds((prev) => {
        const merged = new Set(prev);
        autoIds.forEach((id) => merged.add(id));
        return merged;
      });
    }
  }, [todaySessionTypes, services]);

  // ── persist effect ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!checkIn || skipPersistRef.current) return;
    if (saved) {
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

  // ── 현재 탭의 서비스 목록 ────────────────────────────────────────────────

  const tabCategoryLabels = TAB_CATEGORY_MAP[activeTab];

  // 풋케어 탭 내 서브 카테고리 필터링
  const footcareSubLabels = activeTab === '풋케어' ? FOOTCARE_CAT_LABELS[footcareCat] : [];
  const rawTabServices = services.filter((svc) => {
    const label = svc.category_label ?? '';
    const cat = svc.category ?? '';
    return tabCategoryLabels.includes(label) || tabCategoryLabels.includes(cat);
  });
  const tabServices =
    activeTab === '풋케어'
      ? rawTabServices.filter(
          (svc) =>
            footcareSubLabels.includes(svc.category_label ?? '') ||
            footcareSubLabels.includes(svc.category ?? ''),
        )
      : rawTabServices;

  // 4×5 그리드 페이지네이션
  const totalGridPages = Math.max(1, Math.ceil(tabServices.length / GRID_PAGE_SIZE));
  const gridItems = tabServices.slice(
    footcarePage * GRID_PAGE_SIZE,
    (footcarePage + 1) * GRID_PAGE_SIZE,
  );

  // ── 코드 클릭 → 선택 목록에 추가 ─────────────────────────────────────────
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
    setDeductMode(false);
  };

  // ── 항목 제거 ─────────────────────────────────────────────────────────────
  const handleRemoveItem = (serviceId: string) => {
    setSelectedItems((prev) => prev.filter((i) => i.service.id !== serviceId));
    setSaved(false);
    setDeductMode(false);
    setPrepaidIds((prev) => {
      const next = new Set(prev);
      next.delete(serviceId);
      return next;
    });
    setCustomAmounts((prev) => {
      const next = new Map(prev);
      next.delete(serviceId);
      return next;
    });
  };

  // ── 선수금 보라색 토글 ───────────────────────────────────────────────────
  const togglePrepaid = (serviceId: string) => {
    setPrepaidIds((prev) => {
      const next = new Set(prev);
      if (next.has(serviceId)) next.delete(serviceId);
      else next.add(serviceId);
      return next;
    });
    // 토글 시 deductMode 리셋 (재산정 필요)
    setDeductMode(false);
  };

  // ── 인라인 금액 편집 ────────────────────────────────────────────────────
  const startEditPrice = (serviceId: string, currentPrice: number) => {
    setEditingPriceId(serviceId);
    setEditingPriceValue(String(currentPrice));
  };

  const commitEditPrice = (serviceId: string) => {
    const parsed = parseInt(editingPriceValue.replace(/,/g, ''), 10);
    if (!isNaN(parsed) && parsed >= 0) {
      setCustomAmounts((prev) => new Map(prev).set(serviceId, parsed));
      setSaved(false);
      setDeductMode(false);
    }
    setEditingPriceId(null);
  };

  // ── 금액 계산 ──────────────────────────────────────────────────────────
  const getItemAmount = (item: SelectedItem) => {
    const override = customAmounts.get(item.service.id);
    return (override !== undefined ? override : item.service.price) * item.qty;
  };

  const pricingItems = selectedItems.filter((i) => !isCodeItem(i.service));
  const codeItems = selectedItems.filter((i) => isCodeItem(i.service));

  const grandTotal = pricingItems.reduce((s, item) => s + getItemAmount(item), 0);

  // 세금 구분별 합산 (풋케어 항목만)
  const totalByTax: Record<TaxClass, number> = {
    '비급여(과세)': 0,
    '비급여(면세)': 0,
    급여: 0,
  };
  for (const item of pricingItems) {
    const taxClass = getTaxClass(item.service);
    totalByTax[taxClass] += getItemAmount(item);
  }

  // 선수금차감 후 금액 = prepaid 제외 합산
  const calcDeductAmount = () =>
    pricingItems
      .filter((item) => !prepaidIds.has(item.service.id))
      .reduce((s, item) => s + getItemAmount(item), 0);

  // ── 공통 check_in_services 저장 ──────────────────────────────────────────
  const saveCheckInServices = async (): Promise<boolean> => {
    if (pricingItems.length === 0 && codeItems.length === 0) {
      toast.error('시술 코드를 선택해주세요');
      return false;
    }

    const { error: delError } = await supabase
      .from('check_in_services')
      .delete()
      .eq('check_in_id', checkIn.id);
    if (delError) {
      toast.error('저장 실패: ' + delError.message);
      return false;
    }

    const rows = selectedItems.flatMap(({ service, qty }) => {
      const unitPrice =
        customAmounts.get(service.id) !== undefined
          ? customAmounts.get(service.id)!
          : service.price;
      return Array.from({ length: qty }, () => ({
        check_in_id: checkIn.id,
        service_id: service.id,
        service_name: service.name,
        price: unitPrice,
        original_price: service.price,
        is_package_session: false,
      }));
    });

    if (rows.length > 0) {
      const { error } = await supabase.from('check_in_services').insert(rows);
      if (error) {
        toast.error('저장 실패: ' + error.message);
        return false;
      }
    }

    localStorage.removeItem(draftKey(checkIn.id));
    return true;
  };

  // ── [시술 저장 및 포함 금액 산정] (기존 handleSave, 전체 금액) ─────────────
  const handleSaveFull = async () => {
    const ok = await saveCheckInServices();
    if (!ok) return;
    setSaved(true);
    setDeductMode(false);
    toast.success('시술 저장 완료 — 금액 산정됨');
    onSaved?.();
  };

  // ── [선수금 차감 후 금액 산정] (PREPAID-DEDUCT AC-1) ─────────────────────
  const handleSaveDeduct = async () => {
    if (!hasActivePackage) {
      toast.error('활성 패키지가 없습니다');
      return;
    }
    if (pricingItems.length === 0) {
      toast.error('시술 코드를 선택해주세요');
      return;
    }
    const ok = await saveCheckInServices();
    if (!ok) return;

    const deducted = calcDeductAmount();
    setDeductAmount(deducted);
    setDeductMode(true);
    setSaved(true);
    toast.success(`선수금 차감 후 청구 금액: ${formatAmount(deducted)}`);
    onSaved?.();
  };

  // ── executeAutoDone ────────────────────────────────────────────────────────
  const executeAutoDone = async (
    amount: number,
    method: string,
    taxType?: string | null,
  ) => {
    // PAY-CASH-RECEIPT: 결제 삽입 시 cash_receipt_issued 포함
    const isCashLike = method === 'cash' || method === 'transfer';
    const { error: payErr } = await supabase.from('payments').insert({
      check_in_id: checkIn.id,
      clinic_id: checkIn.clinic_id,
      customer_id: checkIn.customer_id,
      amount,
      method,
      installment: null,
      memo: null,
      payment_type: 'payment',
      tax_type: taxType ?? null,
      cash_receipt_issued: isCashLike ? cashReceiptIssued : null,
      cash_receipt_type:
        isCashLike && cashReceiptIssued ? cashReceiptType : null,
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

  // ── [수납] — PAY-SLOT-MOVE: [수납] 클릭 시만 done 이동 ─────────────────────
  const handleSettle = async () => {
    if (!saved) {
      toast.error('[시술 저장 및 금액 산정]을 먼저 완료해주세요');
      return;
    }
    const amount = deductMode ? deductAmount : grandTotal;
    const method = deductMode ? 'membership' : payMethod;
    const taxType = deductMode ? '선수금' : null;

    if (amount < 0) {
      toast.error('결제 금액이 올바르지 않습니다');
      return;
    }
    setSubmitting(true);
    try {
      await executeAutoDone(amount, method, taxType);
      localStorage.removeItem(draftKey(checkIn.id));
      toast.success('수납 완료 — 완료 슬롯으로 이동됩니다');
      setSubmitting(false);
      onComplete(); // ← PAY-SLOT-MOVE: onComplete만 완료 이동. onClose는 이동 없음.
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '수납 처리 실패';
      toast.error(msg);
      setSubmitting(false);
    }
  };

  // ── PAY-SLOT-MOVE AC-3: X 닫기 → 자동 저장 + 수납대기 유지 ─────────────────
  const handleClose = async () => {
    // 미저장 항목이 있으면 DB 자동 저장 (수납대기 유지 — status 변경 없음)
    if (!saved && selectedItems.length > 0) {
      try {
        await supabase
          .from('check_in_services')
          .delete()
          .eq('check_in_id', checkIn.id);
        const rows = selectedItems.flatMap(({ service, qty }) =>
          Array.from({ length: qty }, () => ({
            check_in_id: checkIn.id,
            service_id: service.id,
            service_name: service.name,
            price: customAmounts.get(service.id) ?? service.price,
            original_price: service.price,
            is_package_session: false,
          })),
        );
        if (rows.length > 0) {
          await supabase.from('check_in_services').insert(rows);
        }
        localStorage.removeItem(draftKey(checkIn.id));
      } catch {
        /* 닫기 시 저장 실패는 무시 */
      }
    }
    onClose(); // status 변경 없음 — 수납대기 유지
  };

  // ── 서류 토글 ─────────────────────────────────────────────────────────────
  const toggleDocKey = (formKey: string) => {
    setSelectedDocKeys((prev) => {
      const next = new Set(prev);
      if (next.has(formKey)) next.delete(formKey);
      else next.add(formKey);
      return next;
    });
  };

  // ── [출력] — PAY-SLOT-MOVE: 출력만, 슬롯 이동 없음 ─────────────────────────
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
      // PAY-SLOT-MOVE AC-4: iframe 인쇄 — 중복 창 없음
      printViaIframe(buildPrintHtml(pages, `서류 출력 — ${checkIn.customer_name}`));
      toast.success(`${selected.length}종 출력 요청됨`);
      // 슬롯 이동 없음 (onComplete 호출 X)
    } finally {
      setDocPrinting(false);
    }
  };

  // ── [출력 및 수납] — 출력 + auto-done ───────────────────────────────────────
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
    const amount = deductMode ? deductAmount : grandTotal;
    if (amount < 0) {
      toast.error('결제 금액이 없습니다');
      return;
    }
    setDocSettlePrinting(true);
    try {
      // 1. 서류 출력 (iframe — PAY-SLOT-MOVE AC-4)
      const autoValues = await loadMiniAutoBindValues(checkIn);
      const pages = selected.flatMap((t) => {
        const imgUrl = getTemplateImageUrl(t.form_key);
        if (!imgUrl) return [];
        return [buildPageHtml(t, autoValues, imgUrl)];
      });
      if (pages.length > 0) {
        printViaIframe(buildPrintHtml(pages, `서류 출력 — ${checkIn.customer_name}`));
      }

      // 2. 수납 + auto-done
      const method = deductMode ? 'membership' : payMethod;
      const taxType = deductMode ? '선수금' : null;
      await executeAutoDone(amount, method, taxType);
      localStorage.removeItem(draftKey(checkIn.id));
      toast.success('출력 및 수납 완료 — 완료 슬롯으로 이동됩니다');
      setDocSettlePrinting(false);
      onComplete();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '출력 및 수납 처리 실패';
      toast.error(msg);
      setDocSettlePrinting(false);
    }
  };

  // ── 표시용 수납 금액 ─────────────────────────────────────────────────────
  const displayAmount = deductMode ? deductAmount : grandTotal;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Dialog
      open={!!checkIn}
      onOpenChange={(open) => {
        // PAY-SLOT-MOVE AC-3: X 닫기 시 status 변경 없음 (수납대기 유지)
        if (!open) handleClose();
      }}
    >
      <DialogContent className="max-w-3xl max-h-[92vh] p-0 overflow-hidden flex flex-col">
        {/* 헤더 */}
        <DialogHeader className="px-5 pt-4 pb-3 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2 text-base font-semibold">
            <CreditCard className="h-4 w-4 text-purple-600" />
            결제 미니창 — {checkIn.customer_name}
            {checkIn.queue_number != null && (
              <span className="text-sm text-teal-600 font-normal">
                #{checkIn.queue_number}
              </span>
            )}
            {hasActivePackage && (
              <span className="text-xs text-purple-600 bg-purple-50 border border-purple-200 rounded px-1.5 py-0.5">
                패키지
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        {/* 본문 3열 */}
        <div className="flex min-h-0" style={{ height: '380px' }}>

          {/* ── 좌측: 카테고리 탭 ── */}
          <div className="w-28 shrink-0 border-r bg-muted/30 flex flex-col py-2">
            {TAB_LABELS.map((tab) => (
              <button
                key={tab}
                onClick={() => {
                  setActiveTab(tab);
                  setFootcarePage(0);
                }}
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

          {/* ── 중앙: 코드 목록 / 그리드 ── */}
          <div className="flex-1 flex flex-col min-h-0 min-w-0">
            {/* 풋케어 탭: 서브 카테고리 버튼 */}
            {activeTab === '풋케어' && (
              <div className="flex gap-1 px-2 py-1.5 border-b shrink-0 flex-wrap">
                {FOOTCARE_CATS.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => {
                      setFootcareCat(cat);
                      setFootcarePage(0);
                    }}
                    className={cn(
                      'px-2 py-1 text-xs rounded border transition-colors',
                      footcareCat === cat
                        ? 'bg-teal-600 text-white border-teal-600'
                        : 'border-input hover:bg-muted',
                    )}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            )}

            {/* 풋케어: 4×5 그리드 */}
            {activeTab === '풋케어' && (
              <div className="flex-1 overflow-y-auto p-2 flex flex-col">
                {gridItems.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-8">
                    등록된 코드가 없습니다
                  </p>
                ) : (
                  <div className="grid grid-cols-4 gap-1.5">
                    {gridItems.map((svc) => (
                      <button
                        key={svc.id}
                        onClick={() => handleSelectService(svc)}
                        className="aspect-square flex flex-col items-center justify-center rounded border p-1.5 hover:bg-teal-50 hover:border-teal-300 transition-colors text-center"
                      >
                        <span className="text-[10px] font-medium leading-tight line-clamp-3">
                          {svc.name}
                        </span>
                        <span className="text-[9px] text-muted-foreground mt-0.5 tabular-nums">
                          {formatAmount(svc.price)}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {/* 페이지네이션 */}
                {totalGridPages > 1 && (
                  <div className="flex items-center justify-center gap-2 mt-2 shrink-0">
                    <button
                      onClick={() => setFootcarePage((p) => Math.max(0, p - 1))}
                      disabled={footcarePage === 0}
                      className="p-1 rounded hover:bg-muted disabled:opacity-30"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </button>
                    <span className="text-xs tabular-nums">
                      {footcarePage + 1} / {totalGridPages}
                    </span>
                    <button
                      onClick={() =>
                        setFootcarePage((p) => Math.min(totalGridPages - 1, p + 1))
                      }
                      disabled={footcarePage >= totalGridPages - 1}
                      className="p-1 rounded hover:bg-muted disabled:opacity-30"
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* 상병코드 / 처방약 탭: 리스트 (코드 선택용, 가격 표시 없음) */}
            {(activeTab === '상병코드' || activeTab === '처방약') && (
              <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
                {tabServices.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-8">
                    등록된 코드가 없습니다
                  </p>
                ) : (
                  tabServices.map((svc) => (
                    <button
                      key={svc.id}
                      onClick={() => handleSelectService(svc)}
                      className="w-full text-left rounded-md border px-3 py-2.5 hover:bg-blue-50 hover:border-blue-300 transition-colors"
                    >
                      <p className="text-sm font-medium leading-tight">{svc.name}</p>
                      {svc.service_code && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {svc.service_code}
                        </p>
                      )}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {/* ── 우측: 선택 목록 + 세금 분류 + 버튼 ── */}
          <div className="w-72 shrink-0 border-l flex flex-col min-h-0">
            {/* 선택 항목 목록 */}
            <div className="flex-1 overflow-y-auto p-3 space-y-1.5 min-h-0">
              <p className="text-xs font-semibold text-muted-foreground mb-2">
                선택 항목 ({selectedItems.length}건)
              </p>

              {/* 상병코드 / 처방약 항목 (코드 전용 — 가격 표시 없음) */}
              {codeItems.length > 0 && (
                <div className="mb-2 space-y-1">
                  <p className="text-[10px] text-blue-600 font-semibold uppercase">
                    서류 연동 코드
                  </p>
                  {codeItems.map(({ service, qty }) => (
                    <div
                      key={service.id}
                      className="flex items-center gap-1.5 rounded border px-2 py-1.5 bg-blue-50 border-blue-200"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium leading-tight truncate">
                          {service.name}
                        </p>
                        {service.service_code && (
                          <p className="text-[10px] text-blue-600 mt-0.5">
                            {service.service_code}
                            {qty > 1 && (
                              <span className="text-blue-500"> ×{qty}</span>
                            )}
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => handleRemoveItem(service.id)}
                        className="shrink-0 text-muted-foreground hover:text-destructive transition-colors p-0.5"
                        title="제거"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* 풋케어 / 수가 항목 — 보라색 토글 + 인라인 금액 편집 */}
              {pricingItems.length === 0 && codeItems.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4">
                  좌측에서 코드를 선택하세요
                </p>
              )}
              {pricingItems.map(({ service, qty }) => {
                const isPrepaid = prepaidIds.has(service.id);
                const displayPrice =
                  customAmounts.get(service.id) ?? service.price;
                const isEditing = editingPriceId === service.id;
                const taxClass = getTaxClass(service);
                return (
                  <div
                    key={service.id}
                    className={cn(
                      'flex items-start gap-1.5 rounded border px-2 py-1.5 transition-colors',
                      isPrepaid
                        ? 'bg-purple-50 border-purple-300'
                        : 'bg-white',
                    )}
                  >
                    {/* 보라색 선수금차감 토글 버튼 (PREPAID-DEDUCT AC-2) */}
                    <button
                      onClick={() => togglePrepaid(service.id)}
                      className={cn(
                        'shrink-0 mt-0.5 w-4 h-4 rounded border-2 transition-colors',
                        isPrepaid
                          ? 'bg-purple-600 border-purple-600'
                          : 'border-gray-300 hover:border-purple-400',
                      )}
                      title={isPrepaid ? '선수금차감 해제' : '선수금차감 대상 지정'}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium leading-tight truncate">
                        {service.name}
                      </p>
                      {/* 인라인 금액 편집 (PREPAID-DEDUCT AC-4) */}
                      {isEditing ? (
                        <input
                          className="mt-0.5 w-full text-xs tabular-nums border rounded px-1 py-0.5 bg-white"
                          value={editingPriceValue}
                          onChange={(e) => setEditingPriceValue(e.target.value)}
                          onBlur={() => commitEditPrice(service.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitEditPrice(service.id);
                            if (e.key === 'Escape') setEditingPriceId(null);
                          }}
                          autoFocus
                        />
                      ) : (
                        <button
                          className="mt-0.5 text-xs text-muted-foreground tabular-nums hover:text-purple-700 text-left"
                          onClick={() => startEditPrice(service.id, displayPrice)}
                          title="클릭하여 금액 수정"
                        >
                          {formatAmount(displayPrice)}
                          {qty > 1 && (
                            <>
                              <span className="text-teal-600 font-medium"> ×{qty}</span>
                              <span className="text-muted-foreground">
                                {' '}= {formatAmount(displayPrice * qty)}
                              </span>
                            </>
                          )}
                          {isPrepaid && (
                            <span className="ml-1 text-purple-600 font-medium text-[10px]">
                              [선수금]
                            </span>
                          )}
                        </button>
                      )}
                      <span
                        className={cn(
                          'text-[10px] rounded px-1 py-0.5 inline-block mt-0.5',
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
                    <button
                      onClick={() => handleRemoveItem(service.id)}
                      className="shrink-0 text-muted-foreground hover:text-destructive transition-colors p-0.5 mt-0.5"
                      title="제거"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>

            {/* 세금 구분 + 합산 (수가 항목 있을 때만) */}
            {pricingItems.length > 0 && (
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
                  <span className="tabular-nums text-purple-700">
                    {formatAmount(grandTotal)}
                  </span>
                </div>
                {/* 선수금차감 후 금액 표시 */}
                {prepaidIds.size > 0 && (
                  <div className="flex justify-between text-xs text-purple-600 pt-0.5">
                    <span>차감 후 청구</span>
                    <span className="tabular-nums font-semibold">
                      {formatAmount(calcDeductAmount())}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* 액션 버튼 */}
            <div className="px-3 pt-2 pb-3 space-y-2 shrink-0 border-t">
              {/* PREPAID-DEDUCT AC-1: 듀얼 저장 버튼 */}

              {/* [시술 저장 및 포함 금액 산정] — 기존 동선 */}
              <Button
                variant="outline"
                className="w-full text-xs h-9"
                onClick={handleSaveFull}
                disabled={selectedItems.length === 0}
              >
                {saved && !deductMode ? (
                  <>
                    <Check className="h-3.5 w-3.5 mr-1.5 text-teal-600" />
                    저장됨 (포함)
                  </>
                ) : (
                  <>
                    <ChevronRight className="h-3.5 w-3.5 mr-1.5" />
                    시술 저장 및 포함 금액 산정
                  </>
                )}
              </Button>

              {/* [선수금 차감 후 금액 산정] — PREPAID-DEDUCT */}
              <Button
                variant="outline"
                className={cn(
                  'w-full text-xs h-9',
                  hasActivePackage
                    ? 'border-purple-300 text-purple-700 hover:bg-purple-50'
                    : 'opacity-50',
                )}
                onClick={handleSaveDeduct}
                disabled={pricingItems.length === 0 || !hasActivePackage}
              >
                {saved && deductMode ? (
                  <>
                    <Check className="h-3.5 w-3.5 mr-1.5 text-purple-600" />
                    저장됨 (차감 후 {formatAmount(deductAmount)})
                  </>
                ) : (
                  <>
                    <ChevronRight className="h-3.5 w-3.5 mr-1.5" />
                    선수금 차감 후 금액 산정
                    {!hasActivePackage && (
                      <span className="ml-1 text-[10px] text-muted-foreground">(패키지 없음)</span>
                    )}
                  </>
                )}
              </Button>

              {/* 미저장 힌트 */}
              {!saved && selectedItems.length > 0 && (
                <p className="text-xs text-amber-600 flex items-center gap-1" data-testid="settle-hint">
                  <ChevronRight className="h-3 w-3 shrink-0" />
                  금액 산정 완료 후 수납 버튼이 나타납니다
                </p>
              )}

              {/* 결제 수단 선택 (저장 후 표시, 선수금차감 모드 아닐 때) */}
              {saved && !deductMode && (
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

              {/* PAY-CASH-RECEIPT: 현금영수증 체크박스 — 현금/이체 선택 시 표시 */}
              {saved && !deductMode && (payMethod === 'cash' || payMethod === 'transfer') && (
                <div className="rounded border px-2.5 py-2 bg-muted/20 space-y-1.5">
                  <button
                    onClick={() => {
                      setCashReceiptIssued((v) => !v);
                    }}
                    className="flex items-center gap-1.5 w-full text-xs"
                  >
                    {cashReceiptIssued ? (
                      <CheckSquare className="h-3.5 w-3.5 text-teal-600 shrink-0" />
                    ) : (
                      <Square className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    )}
                    <span className={cashReceiptIssued ? 'text-teal-700 font-medium' : 'text-muted-foreground'}>
                      현금영수증 발급
                    </span>
                  </button>
                  {cashReceiptIssued && (
                    <div className="flex gap-1 ml-5">
                      {(
                        [
                          { value: 'income_deduction', label: '소득공제' },
                          { value: 'expense_proof', label: '지출증빙' },
                        ] as const
                      ).map((t) => (
                        <button
                          key={t.value}
                          onClick={() => setCashReceiptType(t.value)}
                          className={cn(
                            'flex-1 h-6 rounded text-[10px] border transition-colors',
                            cashReceiptType === t.value
                              ? 'bg-teal-600 text-white border-teal-600'
                              : 'border-input hover:bg-muted',
                          )}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* 수납 버튼 (저장 후 표시) */}
              {saved && (
                <Button
                  className={cn(
                    'w-full h-10 text-white text-sm font-semibold',
                    deductMode
                      ? 'bg-purple-600 hover:bg-purple-700'
                      : 'bg-purple-600 hover:bg-purple-700',
                  )}
                  onClick={handleSettle}
                  disabled={submitting}
                  data-testid="btn-settle"
                >
                  {submitting ? '처리 중...' : (
                    deductMode
                      ? `수납 (선수금차감) ${formatAmount(displayAmount)}`
                      : `수납 ${formatAmount(displayAmount)}`
                  )}
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* ── Phase 2: 서류발행 섹션 (AC-8~10) ─────────────────────────────────── */}
        <div className="border-t bg-slate-50 flex flex-col shrink-0">
          <div className="flex items-center gap-2 px-4 pt-3 pb-2">
            <FileText className="h-3.5 w-3.5 text-teal-600" />
            <span className="text-xs font-semibold text-teal-700">서류발행</span>
            {selectedDocKeys.size > 0 && (
              <span className="text-xs text-muted-foreground">
                ({selectedDocKeys.size}종 선택)
              </span>
            )}
          </div>

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
                    <span>
                      {meta?.icon ?? '📄'} {tpl.name_ko}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-2 px-4 pb-3">
            {/* [출력] — 수납 없음, 슬롯 이동 없음 */}
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

            {/* [출력 및 수납] */}
            <Button
              size="sm"
              className="gap-1.5 text-xs bg-purple-600 hover:bg-purple-700 text-white"
              onClick={handleDocAndSettle}
              disabled={docSettlePrinting || selectedDocKeys.size === 0 || !saved}
              data-testid="btn-doc-settle"
            >
              <Printer className="h-3.5 w-3.5" />
              {docSettlePrinting
                ? '처리 중...'
                : `출력 및 수납${saved ? ` ${formatAmount(displayAmount)}` : ''}`}
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
