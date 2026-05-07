import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { format } from 'date-fns';
import { ExternalLink, Pencil, Plus, Printer, Trash2, Upload, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { formatAmount, parseAmount } from '@/lib/format';
import { VISIT_TYPE_KO } from '@/lib/status';
import { cn } from '@/lib/utils';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import type { CheckIn, Customer, Package, PackageRemaining, PackageTemplate, PrescriptionRow, Reservation } from '@/lib/types';
// T-20260506-foot-CHECKLIST-AUTOUPLOAD: 업로드된 양식 조회
import { DocumentViewer } from '@/components/forms/DocumentViewer';
// T-20260507-foot-CHART2-INSURANCE-FIELDS: 건보 자격등급 패널
import { InsuranceGradeSelect } from '@/components/insurance/InsuranceGradeSelect';

type PackageWithRemaining = Package & { remaining: PackageRemaining | null };

interface Payment {
  id: string;
  check_in_id: string | null;
  amount: number;
  method: string;
  installment: number;
  payment_type: 'payment' | 'refund';
  memo: string | null;
  created_at: string;
}

interface PackagePayment {
  id: string;
  package_id: string;
  amount: number;
  method: string;
  installment: number;
  payment_type: 'payment' | 'refund';
  memo: string | null;
  created_at: string;
}

// T-20260506-foot-CHART-MINI-HOMEPAGE: 구매 패키지(티켓) 섹션
interface PackageSession {
  id: string;
  package_id: string;
  session_number: number;
  session_type: string;
  session_date: string;
  performed_by: string | null;
  staff_name: string | null;
  status: string;
  memo: string | null;
}

// T-20260506-foot-CHART-MINI-HOMEPAGE: 이미지 관리 역할별 분리
interface StorageImageItem {
  path: string;
  signedUrl: string;
  name: string;
}

const PKG_STATUS_KO: Record<string, string> = {
  active: '진행중',
  completed: '완료',
  cancelled: '취소',
  refunded: '환불',
  transferred: '양도',
};

const FORM_TITLES: Record<string, string> = {
  treatment: '시술 동의서',
  non_covered: '비급여 동의서',
  privacy: '개인정보 동의서',
  refund: '환불 동의서',
};


// T-20260506-foot-CHART-MINI-HOMEPAGE: 고객 스토리지 이미지 업로드 컴포넌트 (역할별)
// - 상담실장 영역: 동의서(consent), 결제영수증(receipt)
// - 치료사 영역: 비포에프터(before-after)
// Supabase Storage 'photos' 버킷의 customer/{id}/{prefix}/ 경로 사용 — DB 마이그레이션 불필요
function CustomerStorageImageSection({
  customerId,
  prefix,
  label,
  accent,
  accept = 'image/*',
}: {
  customerId: string;
  prefix: string;
  label: string;
  accent: 'blue' | 'green' | 'orange';
  accept?: string;
}) {
  const [images, setImages] = useState<StorageImageItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const storagePath = `customer/${customerId}/${prefix}`;

  const load = useCallback(async () => {
    const { data: files } = await supabase.storage.from('photos').list(storagePath, {
      limit: 50,
      sortBy: { column: 'name', order: 'desc' },
    });
    if (!files || files.length === 0) { setImages([]); return; }
    const withUrls = await Promise.all(
      files
        .filter((f) => f.name && !f.id?.endsWith('/'))
        .map(async (file) => {
          const path = `${storagePath}/${file.name}`;
          const { data } = await supabase.storage.from('photos').createSignedUrl(path, 3600);
          return { path, signedUrl: data?.signedUrl ?? '', name: file.name };
        }),
    );
    setImages(withUrls.filter((i) => i.signedUrl));
  }, [storagePath]);

  useEffect(() => { load(); }, [load]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    for (const file of Array.from(files)) {
      const ext = file.name.split('.').pop() ?? 'jpg';
      const path = `${storagePath}/${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`;
      const { error } = await supabase.storage.from('photos').upload(path, file, { contentType: file.type });
      if (error) toast.error(`업로드 실패: ${error.message}`);
    }
    setUploading(false);
    e.target.value = '';
    await load();
    toast.success('업로드 완료');
  };

  const remove = async (img: StorageImageItem) => {
    if (!window.confirm('이미지를 삭제하시겠습니까?')) return;
    await supabase.storage.from('photos').remove([img.path]);
    await load();
    toast.success('삭제됨');
  };

  const accentMap = {
    blue:   { header: 'bg-blue-50 border-blue-200 text-blue-800', dot: 'bg-blue-500', btn: 'text-blue-700 border-blue-200 hover:bg-blue-50' },
    green:  { header: 'bg-green-50 border-green-200 text-green-800', dot: 'bg-green-500', btn: 'text-green-700 border-green-200 hover:bg-green-50' },
    orange: { header: 'bg-amber-50 border-amber-200 text-amber-800', dot: 'bg-amber-500', btn: 'text-amber-700 border-amber-200 hover:bg-amber-50' },
  };
  const ac = accentMap[accent];

  return (
    <div className="space-y-1.5">
      <div className={`flex items-center justify-between rounded border px-2.5 py-1.5 ${ac.header}`}>
        <span className="text-xs font-semibold flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full shrink-0 ${ac.dot}`} />
          {label}
        </span>
        <label className="cursor-pointer">
          <input
            type="file"
            accept={accept}
            multiple
            className="hidden"
            onChange={handleUpload}
            disabled={uploading}
          />
          <span className={`inline-flex items-center gap-1 text-xs border rounded px-2 py-0.5 bg-white transition cursor-pointer ${ac.btn}`}>
            <Upload className="h-3 w-3" />
            {uploading ? '중…' : '추가'}
          </span>
        </label>
      </div>
      {images.length === 0 ? (
        <div className="rounded border border-dashed py-2.5 text-center text-xs text-muted-foreground">
          이미지 없음
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-1.5">
          {images.map((img) => (
            <div key={img.path} className="relative group aspect-square">
              <img
                src={img.signedUrl}
                alt={img.name}
                className="w-full h-full object-cover rounded border cursor-pointer"
                onClick={() => window.open(img.signedUrl, '_blank')}
              />
              <button
                onClick={() => remove(img)}
                className="absolute top-1 right-1 hidden group-hover:flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-white shadow"
                title="삭제"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function CustomerChartPage() {
  const { customerId } = useParams<{ customerId: string }>();
  const { profile, loading: authLoading } = useAuth();

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [packages, setPackages] = useState<PackageWithRemaining[]>([]);
  const [visits, setVisits] = useState<CheckIn[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [pkgPayments, setPkgPayments] = useState<PackagePayment[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [checkInHistory, setCheckInHistory] = useState<CheckIn[]>([]);
  const [latestCheckIn, setLatestCheckIn] = useState<CheckIn | null>(null);
  const [prescriptions, setPrescriptions] = useState<PrescriptionRow[]>([]);
  const [consentEntries, setConsentEntries] = useState<{ form_type: string; signed_at: string }[]>([]);
  const [submissionEntries, setSubmissionEntries] = useState<{ template_key?: string; printed_at: string }[]>([]);
  // T-20260430-foot-PRESCREEN-CHECKLIST: 사전 체크리스트 응답
  const [checklistEntries, setChecklistEntries] = useState<{
    id: string;
    completed_at: string | null;
    started_at: string;
    checklist_data: Record<string, unknown>;
  }[]>([]);
  const [packageSessions, setPackageSessions] = useState<PackageSession[]>([]);
  const [openPackagePurchase, setOpenPackagePurchase] = useState(false);
  const [loading, setLoading] = useState(true);
  // T-20260507-foot-CHART2-FULL-LAYOUT: 탭 네비게이션
  const [chartTab, setChartTab] = useState<'checklist' | 'reservations' | 'payments' | 'treatments' | 'packages' | 'images'>('checklist');
  // T-20260504-foot-MEMO-RESTRUCTURE: 고객메모 인라인 편집
  const [editingCustomerMemo, setEditingCustomerMemo] = useState(false);
  const [customerMemoText, setCustomerMemoText] = useState('');
  const [savingCustomerMemo, setSavingCustomerMemo] = useState(false);
  const customerMemoRef = useRef<HTMLTextAreaElement>(null);
  // T-20260507-foot-CHART2-INSURANCE-FIELDS: 주소지 인라인 편집
  const [editingAddress, setEditingAddress] = useState(false);
  const [addressText, setAddressText] = useState('');
  const [savingAddress, setSavingAddress] = useState(false);

  useEffect(() => {
    if (!customerId || !profile) return;
    setLoading(true);
    (async () => {
      const { data: custData } = await supabase
        .from('customers')
        .select('*')
        .eq('id', customerId)
        .single();
      if (!custData) { setLoading(false); return; }
      setCustomer(custData as Customer);
      setCustomerMemoText((custData as Customer).customer_memo ?? '');
      setAddressText((custData as Customer).address ?? '');

      const [pkgRes, visitRes, payRes, pkgPayRes, resvRes, ciHistRes] = await Promise.all([
        supabase.from('packages').select('*').eq('customer_id', customerId).order('contract_date', { ascending: false }),
        supabase.from('check_ins').select('*').eq('customer_id', customerId).order('checked_in_at', { ascending: false }).limit(50),
        supabase.from('payments').select('*').eq('customer_id', customerId).order('created_at', { ascending: false }).limit(50),
        supabase.from('package_payments').select('*').eq('customer_id', customerId).order('created_at', { ascending: false }).limit(50),
        supabase.from('reservations').select('*').eq('customer_id', customerId).order('reservation_date', { ascending: false }).limit(30),
        supabase.from('check_ins').select('*').eq('customer_id', customerId).neq('status', 'cancelled').order('checked_in_at', { ascending: false }).limit(100),
      ]);

      const pkgs = (pkgRes.data ?? []) as Package[];
      const remaining = await Promise.all(
        pkgs.map(async (p) => {
          const { data } = await supabase.rpc('get_package_remaining', { p_package_id: p.id });
          return data as PackageRemaining | null;
        }),
      );
      setPackages(pkgs.map((p, i) => ({ ...p, remaining: remaining[i] })));

      // T-20260506-foot-CHART-MINI-HOMEPAGE: 구매 패키지(티켓) — 회차별 치료사명 조회
      if (pkgs.length > 0) {
        const pkgIds = pkgs.map((p) => p.id);
        const { data: sessData } = await supabase
          .from('package_sessions')
          .select('id, package_id, session_number, session_type, session_date, performed_by, status, memo, staff:performed_by(name)')
          .in('package_id', pkgIds)
          .order('session_number', { ascending: true });
        setPackageSessions(
          (sessData ?? []).map((s: Record<string, unknown>) => ({
            id: s.id as string,
            package_id: s.package_id as string,
            session_number: s.session_number as number,
            session_type: s.session_type as string,
            session_date: s.session_date as string,
            performed_by: s.performed_by as string | null,
            staff_name: (s.staff as { name: string } | null)?.name ?? null,
            status: s.status as string,
            memo: s.memo as string | null,
          })),
        );
      }

      setVisits((visitRes.data ?? []) as CheckIn[]);
      setPayments((payRes.data ?? []) as Payment[]);
      setPkgPayments((pkgPayRes.data ?? []) as PackagePayment[]);
      setReservations((resvRes.data ?? []) as Reservation[]);

      const ciHistory = (ciHistRes.data ?? []) as CheckIn[];
      setCheckInHistory(ciHistory);
      setLatestCheckIn(ciHistory[0] ?? null);

      const checkInIds = ciHistory.map((ci: CheckIn) => ci.id);
      if (checkInIds.length > 0) {
        const [rxRes, consentRes, subRes, clRes] = await Promise.all([
          supabase
            .from('prescriptions')
            .select('id, prescribed_by_name, diagnosis, prescribed_at, prescription_items(medication_name, dosage, duration_days)')
            .in('check_in_id', checkInIds)
            .order('prescribed_at', { ascending: false })
            .limit(20),
          supabase
            .from('consent_forms')
            .select('form_type, signed_at')
            .in('check_in_id', checkInIds)
            .order('signed_at', { ascending: false }),
          supabase
            .from('form_submissions')
            .select('template_key, printed_at')
            .in('check_in_id', checkInIds)
            .order('printed_at', { ascending: false })
            .limit(30),
          // T-20260430-foot-PRESCREEN-CHECKLIST: checklists 테이블에서 사전 체크리스트 응답 조회
          supabase
            .from('checklists')
            .select('id, completed_at, started_at, checklist_data')
            .eq('customer_id', customerId)
            .not('completed_at', 'is', null)
            .order('completed_at', { ascending: false })
            .limit(10),
        ]);
        setPrescriptions((rxRes.data ?? []) as PrescriptionRow[]);
        setConsentEntries((consentRes.data ?? []) as { form_type: string; signed_at: string }[]);
        setSubmissionEntries((subRes.data ?? []) as { template_key?: string; printed_at: string }[]);
        setChecklistEntries((clRes.data ?? []) as { id: string; completed_at: string | null; started_at: string; checklist_data: Record<string, unknown> }[]);
      }

      setLoading(false);
    })();
  }, [customerId, profile]);

  // T-20260504-foot-MEMO-RESTRUCTURE: 고객메모 저장
  const saveCustomerMemo = async () => {
    if (!customer) return;
    setSavingCustomerMemo(true);
    const { error } = await supabase
      .from('customers')
      .update({ customer_memo: customerMemoText.trim() || null })
      .eq('id', customer.id);
    setSavingCustomerMemo(false);
    if (error) { toast.error('저장 실패'); return; }
    setCustomer((prev) => prev ? { ...prev, customer_memo: customerMemoText.trim() || null } : prev);
    setEditingCustomerMemo(false);
    toast.success('고객메모 저장됨');
  };

  // T-20260507-foot-CHART2-INSURANCE-FIELDS: 주소지 저장
  const saveAddress = async () => {
    if (!customer) return;
    setSavingAddress(true);
    const { error } = await supabase
      .from('customers')
      .update({ address: addressText.trim() || null })
      .eq('id', customer.id);
    setSavingAddress(false);
    if (error) { toast.error('저장 실패'); return; }
    setCustomer((prev) => prev ? { ...prev, address: addressText.trim() || null } : prev);
    setEditingAddress(false);
    toast.success('주소지 저장됨');
  };

  const totalPaid =
    payments.filter((p) => p.payment_type === 'payment').reduce((x, p) => x + p.amount, 0) +
    pkgPayments.filter((p) => p.payment_type === 'payment').reduce((x, p) => x + p.amount, 0) -
    payments.filter((p) => p.payment_type === 'refund').reduce((x, p) => x + p.amount, 0) -
    pkgPayments.filter((p) => p.payment_type === 'refund').reduce((x, p) => x + p.amount, 0);

  if (authLoading) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">
        인증 확인 중...
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">
        로그인이 필요합니다
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">
        불러오는 중...
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">
        고객 정보를 찾을 수 없습니다
      </div>
    );
  }

  // T-20260507-foot-CHART2-FULL-LAYOUT: 탭 정의
  const TAB_LABELS: { key: typeof chartTab; label: string }[] = [
    { key: 'checklist', label: '문진·동의서' },
    { key: 'reservations', label: '예약내역' },
    { key: 'payments', label: '수납내역' },
    { key: 'treatments', label: '시술내역' },
    { key: 'packages', label: '패키지' },
    { key: 'images', label: '이미지·서류' },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* ── 헤더 (sticky) ─────────────────────────────────────────────── */}
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b bg-white px-4 py-2.5 shadow-sm">
        <div className="flex-1">
          <h1 className="text-base font-bold text-teal-700">{customer.name}</h1>
          <div className="text-xs text-muted-foreground">{customer.chart_number ?? ''} · {customer.phone}</div>
        </div>
        <button
          onClick={() => window.print()}
          className="rounded p-2 hover:bg-muted transition text-xs flex items-center gap-1"
        >
          <Printer className="h-4 w-4" /> 인쇄
        </button>
        <button onClick={() => window.close()} className="rounded p-2 hover:bg-muted transition">
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="p-3 space-y-3 max-w-3xl mx-auto">

        {/* ── 고객정보 패널 (2-column compact form) ───────────────────── */}
        <div className="rounded-lg border bg-white shadow-sm overflow-hidden">
          <div className="grid lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-muted/30">

            {/* 왼쪽 컬럼 */}
            <div className="px-3 py-2.5 space-y-1.5 text-xs">
              {/* 성명 + 차트번호 + 방문유형 */}
              <div className="flex items-center gap-2 pb-1 border-b border-muted/20">
                <span className="text-base font-bold text-teal-800">{customer.name}</span>
                {customer.chart_number && (
                  <span className="rounded bg-teal-50 px-1.5 py-0.5 text-[10px] font-medium text-teal-700">{customer.chart_number}</span>
                )}
                <Badge variant={customer.visit_type === 'new' ? 'teal' : 'secondary'} className="text-[10px]">
                  {VISIT_TYPE_KO[customer.visit_type as keyof typeof VISIT_TYPE_KO] ?? customer.visit_type}
                </Badge>
              </div>

              {/* 주민번호 */}
              <div className="flex gap-2">
                <span className="text-muted-foreground w-20 shrink-0">주민번호</span>
                <span className="font-mono text-muted-foreground/70">
                  {customer.birth_date ? `${customer.birth_date.slice(0, 6)}-*******` : '미등록'}
                </span>
              </div>

              {/* 성별 */}
              <div className="flex gap-2 items-center">
                <span className="text-muted-foreground w-20 shrink-0">성별</span>
                <div className="flex gap-1">
                  {customer.is_foreign ? (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">외국인</span>
                  ) : customer.gender === 'M' ? (
                    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700">남(M)</span>
                  ) : customer.gender === 'F' ? (
                    <span className="rounded-full bg-pink-100 px-2 py-0.5 text-[10px] font-medium text-pink-700">여(F)</span>
                  ) : (
                    <span className="text-muted-foreground">미입력</span>
                  )}
                </div>
              </div>

              {/* 연락처 */}
              <div className="flex gap-2 items-center">
                <span className="text-muted-foreground w-20 shrink-0">연락처</span>
                <a href={`tel:${customer.phone}`} className="font-medium text-teal-700 hover:underline">
                  {customer.phone}
                </a>
              </div>

              {/* 주소지 — 인라인 편집 */}
              <div className="flex items-start gap-2">
                <span className="text-muted-foreground w-20 shrink-0 pt-0.5">주소지</span>
                {editingAddress ? (
                  <div className="flex-1 space-y-1.5">
                    <Input
                      value={addressText}
                      onChange={(e) => setAddressText(e.target.value)}
                      placeholder="예: 서울시 종로구 ..."
                      className="h-7 text-xs"
                      autoFocus
                      onKeyDown={(e) => { if (e.key === 'Enter') saveAddress(); if (e.key === 'Escape') setEditingAddress(false); }}
                    />
                    <div className="flex gap-1.5">
                      <Button size="sm" className="h-6 text-xs flex-1 bg-teal-600 hover:bg-teal-700" onClick={saveAddress} disabled={savingAddress}>
                        {savingAddress ? '저장 중…' : '저장'}
                      </Button>
                      <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => { setEditingAddress(false); setAddressText(customer.address ?? ''); }}>
                        취소
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-1 items-center gap-1.5 min-w-0">
                    <span className={cn('flex-1 truncate font-medium', !customer.address && 'text-muted-foreground/60 font-normal')}>
                      {customer.address ?? '미입력'}
                    </span>
                    <button
                      type="button"
                      onClick={() => { setEditingAddress(true); setAddressText(customer.address ?? ''); }}
                      className="shrink-0 rounded p-1 hover:bg-muted transition text-muted-foreground hover:text-teal-700"
                      title="주소지 편집"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  </div>
                )}
              </div>

              {/* 방문경로 */}
              <div className="flex gap-2 items-center">
                <span className="text-muted-foreground w-20 shrink-0">방문경로</span>
                {customer.lead_source ? (
                  <span className="rounded-full bg-teal-100 px-2 py-0.5 text-[10px] font-medium text-teal-800">{customer.lead_source}</span>
                ) : (
                  <span className="text-muted-foreground/60">미입력</span>
                )}
              </div>

              {/* 담당실장 */}
              <div className="flex gap-2">
                <span className="text-muted-foreground w-20 shrink-0">담당실장</span>
                <span className="font-medium">{latestCheckIn?.consultant_id ?? '미배정'}</span>
              </div>

              {/* 특이사항 (customer_memo 요약) */}
              <div className="flex gap-2">
                <span className="text-muted-foreground w-20 shrink-0">특이사항</span>
                <span className={cn('truncate', !(customer.customer_memo ?? customer.memo) && 'text-muted-foreground/60')}>
                  {(customer.customer_memo ?? customer.memo)
                    ? (customer.customer_memo ?? customer.memo ?? '').slice(0, 30) + ((customer.customer_memo ?? customer.memo ?? '').length > 30 ? '…' : '')
                    : '없음'}
                </span>
              </div>
            </div>

            {/* 오른쪽 컬럼 */}
            <div className="px-3 py-2.5 space-y-2 text-xs">
              {/* 건보 조회 버튼 */}
              <a
                href="https://www.nhis.or.kr/nhis/minwon/wbhame03400m01.do"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-teal-300 bg-teal-50 px-2.5 py-1 text-xs font-medium text-teal-700 hover:bg-teal-100 transition"
              >
                <ExternalLink className="h-3 w-3" />
                건보 조회
              </a>

              {/* 건보 자격등급 */}
              <InsuranceGradeSelect
                customerId={customer.id}
                editable
                onChanged={() => {
                  supabase
                    .from('customers')
                    .select('insurance_grade, insurance_grade_source, insurance_grade_verified_at, insurance_grade_memo')
                    .eq('id', customer.id)
                    .maybeSingle()
                    .then(({ data }) => {
                      if (data) setCustomer((prev) => prev ? { ...prev, ...data } : prev);
                    });
                }}
              />

              {/* 최근 방문 */}
              <div className="flex gap-2 pt-1 border-t border-muted/20">
                <span className="text-muted-foreground w-20 shrink-0">최근 방문</span>
                <span className="font-medium">
                  {latestCheckIn
                    ? format(new Date(latestCheckIn.checked_in_at), 'yyyy-MM-dd HH:mm')
                    : '방문이력없음'}
                </span>
              </div>

              {/* 상담메모 (tm_memo 요약 2줄) */}
              <div className="flex gap-2">
                <span className="text-muted-foreground w-20 shrink-0">상담메모</span>
                <span className={cn('line-clamp-2', !customer.tm_memo && 'text-muted-foreground/60')}>
                  {customer.tm_memo ?? '없음'}
                </span>
              </div>

              {/* 고객메모 인라인 편집 */}
              <div className="pt-1 border-t border-muted/20">
                {editingCustomerMemo ? (
                  <div className="space-y-1.5">
                    <Textarea
                      ref={customerMemoRef}
                      value={customerMemoText}
                      onChange={(e) => setCustomerMemoText(e.target.value)}
                      placeholder="고객 성향, 특이사항, 주차 정보 등"
                      rows={3}
                      className="text-xs"
                      autoFocus
                    />
                    <div className="flex gap-1.5">
                      <Button size="sm" className="h-6 text-xs flex-1 bg-teal-600 hover:bg-teal-700" onClick={saveCustomerMemo} disabled={savingCustomerMemo}>
                        {savingCustomerMemo ? '저장 중…' : '저장'}
                      </Button>
                      <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => { setEditingCustomerMemo(false); setCustomerMemoText(customer.customer_memo ?? ''); }}>
                        취소
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-1.5">
                    <div className="flex-1">
                      <div className="text-muted-foreground mb-0.5">고객메모</div>
                      {(customer.customer_memo ?? customer.memo) ? (
                        <div className="whitespace-pre-wrap text-muted-foreground line-clamp-3">{customer.customer_memo ?? customer.memo}</div>
                      ) : (
                        <span className="text-muted-foreground/60">메모 없음</span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => { setEditingCustomerMemo(true); setCustomerMemoText(customer.customer_memo ?? customer.memo ?? ''); }}
                      className="shrink-0 rounded p-1 hover:bg-muted transition text-muted-foreground hover:text-teal-700"
                      title="고객메모 편집"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── 통계 바 (inline) ─────────────────────────────────────────── */}
        <div className="flex items-center gap-4 rounded-lg bg-muted/30 px-3 py-2 text-xs font-medium">
          <span>총 방문 <strong className="text-teal-700">{visits.length}회</strong></span>
          <span className="text-muted-foreground/40">|</span>
          <span>총 결제 <strong className="text-teal-700">{formatAmount(totalPaid)}</strong></span>
          <span className="text-muted-foreground/40">|</span>
          <span>패키지 <strong className="text-teal-700">{packages.length}건</strong></span>
        </div>

        {/* ── 탭 네비게이션 ────────────────────────────────────────────── */}
        <div className="flex overflow-x-auto gap-0.5 border-b border-muted/40 pb-0 -mb-0.5">
          {TAB_LABELS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setChartTab(key)}
              className={cn(
                'shrink-0 px-3 py-2 text-xs font-medium border-b-2 transition whitespace-nowrap',
                chartTab === key
                  ? 'border-teal-600 text-teal-700 bg-teal-50/60'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/30',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ── 탭 콘텐츠 ───────────────────────────────────────────────── */}
        <div className="space-y-3">

          {/* 탭: 문진·동의서 */}
          {chartTab === 'checklist' && (
            <div className="space-y-3">
              {/* 사전 체크리스트 응답 */}
              {checklistEntries.length > 0 && (
                <div className="rounded-lg border bg-white p-3 space-y-2 text-xs">
                  <div className="font-semibold text-muted-foreground">사전 체크리스트 응답</div>
                  {checklistEntries.map((cl) => {
                    const d = cl.checklist_data as {
                      symptoms?: string[];
                      nail_locations?: string[];
                      pain_duration?: string;
                      pain_severity?: string;
                      medical_history?: string[];
                      medications?: string[];
                      medications_none?: boolean;
                      has_allergy?: boolean;
                      allergy_types?: string[];
                      prior_conditions?: string;
                      family_history?: string;
                      agree_privacy?: boolean;
                      agree_marketing?: boolean;
                      referral_source?: string;
                    };
                    const severityLabel: Record<string, string> = { '1': '경미', '2': '불편', '3': '심함', '4': '매우 심함' };
                    return (
                      <div key={cl.id} className="rounded border border-teal-100 bg-teal-50/30 px-3 py-2 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <Badge variant="teal" className="text-[10px]">✓ 체크리스트 완료</Badge>
                          <span className="text-muted-foreground tabular-nums">
                            {cl.completed_at ? format(new Date(cl.completed_at), 'yyyy-MM-dd HH:mm') : '-'}
                          </span>
                        </div>
                        {(d.symptoms ?? []).length > 0 && <div><span className="text-muted-foreground">증상: </span>{(d.symptoms ?? []).join(', ')}</div>}
                        {(d.nail_locations ?? []).length > 0 && <div><span className="text-muted-foreground">통증부위: </span>{(d.nail_locations ?? []).join(', ')}</div>}
                        {d.pain_duration && <div><span className="text-muted-foreground">유병기간: </span>{d.pain_duration}</div>}
                        {d.pain_severity && <div><span className="text-muted-foreground">통증강도: </span>{severityLabel[d.pain_severity] ?? d.pain_severity}</div>}
                        {(d.medical_history ?? []).length > 0 && <div><span className="text-muted-foreground">병력: </span>{(d.medical_history ?? []).join(', ')}</div>}
                        {d.medications_none && <div><span className="text-muted-foreground">복용약: </span>없음</div>}
                        {!d.medications_none && (d.medications ?? []).length > 0 && <div><span className="text-muted-foreground">복용약: </span>{(d.medications ?? []).join(', ')}</div>}
                        {d.has_allergy && (d.allergy_types ?? []).length > 0 && <div className="text-rose-600"><span className="text-muted-foreground">알레르기: </span>{(d.allergy_types ?? []).join(', ')}</div>}
                        {d.prior_conditions && <div><span className="text-muted-foreground">기왕증: </span>{d.prior_conditions}</div>}
                        {d.family_history && <div><span className="text-muted-foreground">가족력: </span>{d.family_history}</div>}
                        {d.referral_source && <div><span className="text-muted-foreground">방문경로: </span>{d.referral_source}</div>}
                        <div className="flex gap-2 pt-0.5">
                          {d.agree_privacy && <Badge variant="outline" className="text-[9px] text-teal-600 border-teal-300">개인정보동의</Badge>}
                          {d.agree_marketing && <Badge variant="outline" className="text-[9px] text-emerald-600 border-emerald-300">마케팅동의</Badge>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* 전자서명 동의서 */}
              {consentEntries.length > 0 && (
                <div className="rounded-lg border bg-white p-3 text-xs space-y-1.5">
                  <div className="font-semibold text-muted-foreground mb-1">전자서명 동의서</div>
                  {consentEntries.map((c, i) => (
                    <div key={i} className="flex items-center justify-between rounded bg-muted/30 px-2 py-1">
                      <span>{FORM_TITLES[c.form_type] ?? c.form_type}</span>
                      <span className="flex items-center gap-1.5">
                        <Badge variant="teal" className="text-[10px]">서명완료</Badge>
                        <span className="text-muted-foreground">{format(new Date(c.signed_at), 'MM-dd')}</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* 태블릿 작성 양식 (DocumentViewer) */}
              <div className="rounded-lg border bg-white p-3 text-xs">
                <div className="font-semibold text-muted-foreground mb-2">태블릿 작성 양식 (자동 업로드)</div>
                <DocumentViewer customerId={customer.id} />
              </div>

              {/* 처방전 */}
              {prescriptions.length > 0 && (
                <div className="rounded-lg border bg-white p-3 text-xs space-y-2">
                  <div className="font-semibold text-muted-foreground">처방전</div>
                  {prescriptions.map((rx) => (
                    <div key={rx.id} className="rounded bg-muted/30 px-2 py-1.5">
                      <div className="flex items-center justify-between text-muted-foreground mb-0.5">
                        <span>{format(new Date(rx.prescribed_at), 'yyyy-MM-dd')}</span>
                        {rx.prescribed_by_name && <span>{rx.prescribed_by_name}</span>}
                      </div>
                      {rx.diagnosis && <div className="font-medium mb-0.5">진단: {rx.diagnosis}</div>}
                      {rx.prescription_items && rx.prescription_items.length > 0 && (
                        <div className="space-y-0.5 mt-1">
                          {rx.prescription_items.map((item, idx) => (
                            <div key={idx} className="text-muted-foreground">
                              {item.medication_name}
                              {item.dosage && ` · ${item.dosage}`}
                              {item.duration_days && ` · ${item.duration_days}일`}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* 서류발행 */}
              {submissionEntries.length > 0 && (
                <div className="rounded-lg border bg-white p-3 text-xs space-y-1">
                  <div className="font-semibold text-muted-foreground mb-1">서류발행</div>
                  {submissionEntries.map((s, i) => (
                    <div key={i} className="flex items-center justify-between rounded bg-muted/30 px-2 py-1">
                      <span>{s.template_key ?? '-'}</span>
                      <span className="text-muted-foreground flex items-center gap-1">
                        <Printer className="h-3 w-3" />
                        {format(new Date(s.printed_at), 'MM-dd HH:mm')}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {checklistEntries.length === 0 && consentEntries.length === 0 && prescriptions.length === 0 && submissionEntries.length === 0 && (
                <div className="text-xs text-muted-foreground py-4 text-center">기록 없음</div>
              )}
            </div>
          )}

          {/* 탭: 예약내역 */}
          {chartTab === 'reservations' && (
            <div className="space-y-3">
              {/* 예약 목록 */}
              <div className="rounded-lg border bg-white p-3 text-xs space-y-1.5">
                <div className="font-semibold text-muted-foreground mb-1">예약내역</div>
                {reservations.length === 0 ? (
                  <div className="text-muted-foreground py-2">예약 없음</div>
                ) : (
                  reservations.map((r) => (
                    <div key={r.id} className="flex items-center justify-between rounded bg-muted/30 px-2 py-1">
                      <span>{r.reservation_date} {r.reservation_time.slice(0, 5)}</span>
                      <Badge variant="secondary" className="text-[10px]">{r.status}</Badge>
                    </div>
                  ))
                )}
              </div>

              {/* 예약메모 */}
              {reservations.filter((r) => r.booking_memo || r.memo).length > 0 && (
                <div className="rounded-lg border bg-white p-3 text-xs space-y-1.5">
                  <div className="font-semibold text-muted-foreground mb-1">예약메모</div>
                  {reservations.filter((r) => r.booking_memo || r.memo).map((r) => (
                    <div key={r.id} className="rounded bg-amber-50 border border-amber-100 px-2 py-1.5">
                      <div className="text-muted-foreground mb-0.5">{r.reservation_date} {r.reservation_time.slice(0, 5)}</div>
                      <div>{r.booking_memo ?? r.memo}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 탭: 수납내역 */}
          {chartTab === 'payments' && (
            <div className="space-y-3">
              {/* 일반 결제 */}
              <div className="rounded-lg border bg-white p-3 text-xs">
                <div className="font-semibold text-muted-foreground mb-2">수납내역</div>
                {payments.length === 0 ? (
                  <div className="text-muted-foreground py-2">결제 없음</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse">
                      <thead>
                        <tr className="bg-muted/30 text-muted-foreground">
                          <th className="text-left px-2 py-1.5 font-medium border-b">일시</th>
                          <th className="text-right px-2 py-1.5 font-medium border-b">금액</th>
                          <th className="text-left px-2 py-1.5 font-medium border-b">방법</th>
                          <th className="text-left px-2 py-1.5 font-medium border-b">구분</th>
                          <th className="text-left px-2 py-1.5 font-medium border-b">메모</th>
                        </tr>
                      </thead>
                      <tbody>
                        {payments.map((p) => (
                          <tr key={p.id} className="border-b border-muted/20 hover:bg-muted/10">
                            <td className="px-2 py-1.5 tabular-nums text-muted-foreground">{format(new Date(p.created_at), 'MM-dd HH:mm')}</td>
                            <td className={cn('px-2 py-1.5 text-right tabular-nums font-medium', p.payment_type === 'refund' && 'text-red-600')}>
                              {p.payment_type === 'refund' ? '-' : ''}{formatAmount(p.amount)}
                            </td>
                            <td className="px-2 py-1.5">{p.method}{p.installment > 1 ? ` ${p.installment}개월` : ''}</td>
                            <td className="px-2 py-1.5">
                              <Badge variant={p.payment_type === 'refund' ? 'destructive' : 'secondary'} className="text-[10px]">
                                {p.payment_type === 'refund' ? '환불' : '결제'}
                              </Badge>
                            </td>
                            <td className="px-2 py-1.5 text-muted-foreground max-w-[100px] truncate">{p.memo ?? '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* 패키지 결제 */}
              {pkgPayments.length > 0 && (
                <div className="rounded-lg border bg-white p-3 text-xs">
                  <div className="font-semibold text-muted-foreground mb-2">패키지 결제</div>
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse">
                      <thead>
                        <tr className="bg-muted/30 text-muted-foreground">
                          <th className="text-left px-2 py-1.5 font-medium border-b">일시</th>
                          <th className="text-right px-2 py-1.5 font-medium border-b">금액</th>
                          <th className="text-left px-2 py-1.5 font-medium border-b">방법</th>
                          <th className="text-left px-2 py-1.5 font-medium border-b">구분</th>
                          <th className="text-left px-2 py-1.5 font-medium border-b">메모</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pkgPayments.map((p) => (
                          <tr key={p.id} className="border-b border-muted/20 hover:bg-muted/10">
                            <td className="px-2 py-1.5 tabular-nums text-muted-foreground">{format(new Date(p.created_at), 'MM-dd HH:mm')}</td>
                            <td className={cn('px-2 py-1.5 text-right tabular-nums font-medium', p.payment_type === 'refund' && 'text-red-600')}>
                              {p.payment_type === 'refund' ? '-' : ''}{formatAmount(p.amount)}
                            </td>
                            <td className="px-2 py-1.5">{p.method}{p.installment > 1 ? ` ${p.installment}개월` : ''}</td>
                            <td className="px-2 py-1.5">
                              <Badge variant={p.payment_type === 'refund' ? 'destructive' : 'secondary'} className="text-[10px]">
                                {p.payment_type === 'refund' ? '환불' : '결제'}
                              </Badge>
                            </td>
                            <td className="px-2 py-1.5 text-muted-foreground max-w-[100px] truncate">{p.memo ?? '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 탭: 시술내역 */}
          {chartTab === 'treatments' && (
            <div className="space-y-3">
              {/* 원장소견 */}
              {checkInHistory.filter((ci) => ci.doctor_note).length > 0 && (
                <div className="rounded-lg border bg-white p-3 text-xs space-y-2">
                  <div className="font-semibold text-muted-foreground">원장소견</div>
                  {checkInHistory.filter((ci) => ci.doctor_note).map((ci) => (
                    <div key={ci.id} className="rounded bg-muted/30 px-2 py-1.5">
                      <div className="text-muted-foreground mb-0.5">{format(new Date(ci.checked_in_at), 'yyyy-MM-dd HH:mm')}</div>
                      <div className="whitespace-pre-wrap">{ci.doctor_note}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* 진료종류 */}
              {checkInHistory.filter((ci) =>
                ci.consultation_done || ci.treatment_kind || ci.preconditioning_done || ci.pododulle_done || ci.laser_minutes != null
              ).length > 0 && (
                <div className="rounded-lg border bg-white p-3 text-xs space-y-2">
                  <div className="font-semibold text-muted-foreground">진료종류</div>
                  {checkInHistory
                    .filter((ci) =>
                      ci.consultation_done || ci.treatment_kind || ci.preconditioning_done || ci.pododulle_done || ci.laser_minutes != null
                    )
                    .map((ci) => (
                      <div key={ci.id} className="rounded bg-muted/30 px-2 py-1.5">
                        <div className="text-muted-foreground mb-1">{format(new Date(ci.checked_in_at), 'yyyy-MM-dd HH:mm')}</div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                          <div className="flex gap-1.5">
                            <span className="text-muted-foreground w-12 shrink-0">상담유무</span>
                            <span className={ci.consultation_done ? 'text-emerald-600 font-medium' : ''}>{ci.consultation_done ? '○ 상담함' : '—'}</span>
                          </div>
                          {ci.treatment_kind && (
                            <div className="flex gap-1.5">
                              <span className="text-muted-foreground w-12 shrink-0">치료종류</span>
                              <span className="font-medium">{ci.treatment_kind}</span>
                            </div>
                          )}
                          <div className="flex gap-1.5">
                            <span className="text-muted-foreground w-12 shrink-0">프컨</span>
                            <span className={ci.preconditioning_done ? 'text-emerald-600 font-medium' : ''}>{ci.preconditioning_done ? '○' : '—'}</span>
                          </div>
                          <div className="flex gap-1.5">
                            <span className="text-muted-foreground w-12 shrink-0">포돌</span>
                            <span className={ci.pododulle_done ? 'text-emerald-600 font-medium' : ''}>{ci.pododulle_done ? '○' : '—'}</span>
                          </div>
                          {ci.laser_minutes != null && (
                            <div className="flex gap-1.5">
                              <span className="text-muted-foreground w-12 shrink-0">레이저</span>
                              <span>{ci.laser_minutes}분</span>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                </div>
              )}

              {/* 시술메모 */}
              {checkInHistory.filter((ci) => ci.treatment_memo).length > 0 && (
                <div className="rounded-lg border bg-white p-3 text-xs space-y-2">
                  <div className="font-semibold text-muted-foreground">시술메모</div>
                  {checkInHistory.filter((ci) => ci.treatment_memo).map((ci) => (
                    <div key={ci.id} className="rounded bg-muted/30 px-2 py-1.5">
                      <div className="text-muted-foreground mb-0.5">{format(new Date(ci.checked_in_at), 'yyyy-MM-dd HH:mm')}</div>
                      <div className="whitespace-pre-wrap">
                        {ci.treatment_memo?.details ?? JSON.stringify(ci.treatment_memo)}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {checkInHistory.filter((ci) => ci.doctor_note || ci.consultation_done || ci.treatment_kind || ci.preconditioning_done || ci.pododulle_done || ci.laser_minutes != null || ci.treatment_memo).length === 0 && (
                <div className="text-xs text-muted-foreground py-4 text-center">시술 기록 없음</div>
              )}
            </div>
          )}

          {/* 탭: 패키지 */}
          {chartTab === 'packages' && (
            <div className="space-y-3">
              {/* 치료플랜 요약 테이블 */}
              <div className="rounded-lg border bg-white p-3 text-xs">
                <div className="font-semibold text-muted-foreground mb-2">치료플랜 (패키지)</div>
                {packages.length === 0 ? (
                  <div className="text-muted-foreground py-2">패키지 없음</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse">
                      <thead>
                        <tr className="bg-muted/40 text-muted-foreground">
                          <th className="text-left px-2 py-1.5 font-medium border-b">패키지명</th>
                          <th className="text-center px-2 py-1.5 font-medium border-b">총</th>
                          <th className="text-center px-2 py-1.5 font-medium border-b">사용</th>
                          <th className="text-center px-2 py-1.5 font-medium border-b text-teal-700">잔여</th>
                          <th className="text-right px-2 py-1.5 font-medium border-b">금액</th>
                          <th className="text-left px-2 py-1.5 font-medium border-b">시작일</th>
                          <th className="text-center px-2 py-1.5 font-medium border-b">상태</th>
                        </tr>
                      </thead>
                      <tbody>
                        {packages.map((p) => {
                          const used = p.remaining ? p.total_sessions - p.remaining.total_remaining : null;
                          return (
                            <tr key={p.id} className="border-b border-muted/20 hover:bg-muted/10">
                              <td className="px-2 py-1.5 font-medium max-w-[120px] truncate">{p.package_name}</td>
                              <td className="px-2 py-1.5 text-center">{p.total_sessions}</td>
                              <td className="px-2 py-1.5 text-center">{used ?? '-'}</td>
                              <td className="px-2 py-1.5 text-center font-semibold text-teal-700">{p.remaining?.total_remaining ?? '-'}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums">{formatAmount(p.total_amount)}</td>
                              <td className="px-2 py-1.5 text-muted-foreground">{p.contract_date}</td>
                              <td className="px-2 py-1.5 text-center">
                                <Badge variant={p.status === 'active' ? 'teal' : p.status === 'refunded' ? 'destructive' : 'secondary'} className="text-[10px] px-1.5">
                                  {PKG_STATUS_KO[p.status] ?? p.status}
                                </Badge>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* 구매 패키지(티켓) 상세 */}
              <div className="rounded-lg border bg-white p-3 text-xs">
                <div className="flex items-center justify-between mb-2">
                  <div className="font-semibold text-muted-foreground">구매 패키지(티켓)</div>
                  {(profile?.role === 'admin' || profile?.role === 'manager' || profile?.role === 'consultant') && (
                    <button
                      onClick={() => setOpenPackagePurchase(true)}
                      className="inline-flex items-center gap-1 rounded border border-teal-300 bg-teal-50 px-2 py-1 text-[10px] font-medium text-teal-700 hover:bg-teal-100 transition"
                    >
                      <Plus className="h-3 w-3" /> 구입 티켓 추가
                    </button>
                  )}
                </div>
                {packages.length === 0 ? (
                  <div className="text-muted-foreground py-2">패키지 없음</div>
                ) : (
                  <div className="space-y-3">
                    {packages.map((p) => {
                      const usedSessions = packageSessions.filter((s) => s.package_id === p.id && s.status === 'used');
                      const therapistNames = [...new Set(usedSessions.map((s) => s.staff_name).filter(Boolean))];
                      const usedCount = p.remaining ? p.total_sessions - p.remaining.total_remaining : usedSessions.length;
                      return (
                        <div key={p.id} className="rounded-lg border border-muted/40 overflow-hidden">
                          <div className="flex items-center justify-between bg-muted/20 px-3 py-1.5">
                            <span className="text-xs font-semibold text-teal-800">{p.package_name}</span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                              p.status === 'active' ? 'bg-teal-100 text-teal-700' :
                              p.status === 'refunded' ? 'bg-red-100 text-red-700' :
                              'bg-muted text-muted-foreground'
                            }`}>
                              {PKG_STATUS_KO[p.status] ?? p.status}
                            </span>
                          </div>
                          <table className="w-full border-collapse">
                            <thead>
                              <tr className="bg-muted/10 text-muted-foreground border-b border-muted/20">
                                <th className="text-left px-3 py-1.5 font-medium w-1/4">수가</th>
                                <th className="text-center px-2 py-1.5 font-medium w-1/4">구매횟수</th>
                                <th className="text-center px-2 py-1.5 font-medium w-1/4 text-teal-700">사용횟수</th>
                                <th className="text-left px-2 py-1.5 font-medium w-1/4">치료사</th>
                              </tr>
                            </thead>
                            <tbody>
                              <tr>
                                <td className="px-3 py-2 tabular-nums font-medium">{formatAmount(p.total_amount)}</td>
                                <td className="px-2 py-2 text-center">{p.total_sessions}회</td>
                                <td className="px-2 py-2 text-center font-semibold text-teal-700">{usedCount}회</td>
                                <td className="px-2 py-2 text-muted-foreground">
                                  {therapistNames.length > 0 ? therapistNames.join(', ') : usedCount > 0 ? '기록 없음' : '-'}
                                </td>
                              </tr>
                            </tbody>
                          </table>
                          {usedSessions.length > 0 && (
                            <div className="border-t border-muted/20 px-3 pb-2 pt-1.5">
                              <div className="text-[10px] text-muted-foreground mb-1 font-medium">회차 상세</div>
                              <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
                                {usedSessions.map((s) => {
                                  const typeLabel: Record<string, string> = {
                                    heated_laser: '가열', unheated_laser: '비가열', iv: '수액', preconditioning: '프컨',
                                  };
                                  return (
                                    <div key={s.id} className="flex items-center gap-1.5 text-[10px]">
                                      <span className="text-muted-foreground w-5 tabular-nums">{s.session_number}회</span>
                                      <span className="rounded bg-muted/40 px-1">{typeLabel[s.session_type] ?? s.session_type}</span>
                                      <span className="text-muted-foreground">{s.session_date}</span>
                                      {s.staff_name && <span className="text-teal-600 truncate">{s.staff_name}</span>}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 탭: 이미지·서류 */}
          {chartTab === 'images' && (
            <div className="space-y-3">
              {/* 상담실장 영역 */}
              <div className="rounded-lg border bg-white p-3 text-xs">
                <div className="flex items-center gap-1.5 font-bold text-blue-800 mb-2">
                  <span className="h-2 w-2 rounded-full bg-blue-500" />
                  상담실장 영역
                </div>
                <div className="space-y-2">
                  <CustomerStorageImageSection customerId={customer.id} prefix="consent" label="동의서 사진 (환불 + 비급여동의서)" accent="blue" />
                  <CustomerStorageImageSection customerId={customer.id} prefix="receipt" label="결제영수증" accent="green" />
                </div>
              </div>

              {/* 치료사 영역 */}
              <div className="rounded-lg border bg-white p-3 text-xs">
                <div className="flex items-center gap-1.5 font-bold text-amber-800 mb-2">
                  <span className="h-2 w-2 rounded-full bg-amber-500" />
                  치료사 영역 — 일자별 비포/에프터
                </div>
                {checkInHistory.filter((ci) => ci.treatment_photos && ci.treatment_photos.length > 0).length === 0 ? (
                  <div className="rounded border border-dashed py-2.5 text-center text-muted-foreground">사진 없음 (간편차트에서 업로드)</div>
                ) : (
                  <div className="space-y-3">
                    {checkInHistory
                      .filter((ci) => ci.treatment_photos && ci.treatment_photos.length > 0)
                      .map((ci) => (
                        <div key={ci.id}>
                          <div className="text-[10px] text-muted-foreground mb-1 font-medium">{format(new Date(ci.checked_in_at), 'yyyy-MM-dd')}</div>
                          <div className="grid grid-cols-3 gap-1">
                            {(ci.treatment_photos ?? []).map((url, idx) => (
                              <img
                                key={idx}
                                src={url}
                                alt={`사진 ${idx + 1}`}
                                className="rounded w-full object-cover aspect-square bg-muted cursor-pointer"
                                onClick={() => window.open(url, '_blank')}
                              />
                            ))}
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </div>
          )}

        </div>
      </div>

      {/* T-20260507-foot-PKG-TEMPLATE-REDESIGN: 구입 티켓 추가 다이얼로그 */}
      {openPackagePurchase && customer && (
        <PackagePurchaseFromTemplateDialog
          open={openPackagePurchase}
          customerId={customer.id}
          clinicId={customer.clinic_id}
          onOpenChange={setOpenPackagePurchase}
          onCreated={async () => {
            setOpenPackagePurchase(false);
            // 패키지 목록 새로고침
            const pkgRes = await supabase.from('packages').select('*').eq('customer_id', customer.id).order('contract_date', { ascending: false });
            const pkgs = (pkgRes.data ?? []) as Package[];
            const remaining = await Promise.all(
              pkgs.map(async (p) => {
                const { data } = await supabase.rpc('get_package_remaining', { p_package_id: p.id });
                return data as PackageRemaining | null;
              }),
            );
            setPackages(pkgs.map((p, i) => ({ ...p, remaining: remaining[i] })));
            toast.success('구입 티켓 추가됨');
          }}
        />
      )}
    </div>
  );
}

// ============================================================
// T-20260507-foot-PKG-TEMPLATE-REDESIGN: 고객차트에서 구입 티켓 추가
// 항목별 [회수/수가] 자동합산 폼 — 상담 실장 고객차트 연동
// ============================================================
function PackagePurchaseFromTemplateDialog({
  open,
  customerId,
  clinicId,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  customerId: string;
  clinicId: string;
  onOpenChange: (o: boolean) => void;
  onCreated: () => void;
}) {
  const [templates, setTemplates] = useState<PackageTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | 'custom'>('custom');
  const [packageName, setPackageName] = useState('');
  // 가열
  const [heated, setHeated] = useState(0);
  const [heatedUnitPrice, setHeatedUnitPrice] = useState(0);
  const [heatedUpgrade, setHeatedUpgrade] = useState(false);
  // 비가열
  const [unheated, setUnheated] = useState(0);
  const [unheatedUnitPrice, setUnheatedUnitPrice] = useState(0);
  const [unheatedUpgrade, setUnheatedUpgrade] = useState(false);
  // 포돌로게
  const [podologe, setPodologe] = useState(0);
  const [podologeUnitPrice, setPodologeUnitPrice] = useState(0);
  // 수액
  const [iv, setIv] = useState(0);
  const [ivUnitPrice, setIvUnitPrice] = useState(0);
  const [ivCompany, setIvCompany] = useState('');
  // 사전처치
  const [precon, setPrecon] = useState(0);
  // 총금액
  const [priceOverride, setPriceOverride] = useState(false);
  const [manualTotal, setManualTotal] = useState(0);
  const [memo, setMemo] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // 항목별 자동합산
  const computedTotal = useMemo(
    () =>
      heated * heatedUnitPrice +
      unheated * unheatedUnitPrice +
      podologe * podologeUnitPrice +
      iv * ivUnitPrice,
    [heated, heatedUnitPrice, unheated, unheatedUnitPrice, podologe, podologeUnitPrice, iv, ivUnitPrice],
  );
  const upgradeSurcharge = (heatedUpgrade ? 50000 : 0) + (unheatedUpgrade ? 40000 : 0);
  const grandTotal = priceOverride ? manualTotal : computedTotal + upgradeSurcharge;
  const totalSessions = heated + unheated + iv + precon;

  useEffect(() => {
    if (!open || !clinicId) return;
    supabase
      .from('package_templates')
      .select('*')
      .eq('clinic_id', clinicId)
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .then(({ data }) => setTemplates((data ?? []) as PackageTemplate[]));
  }, [open, clinicId]);

  useEffect(() => {
    if (!open) return;
    setSelectedTemplateId('custom');
    setPackageName('');
    setHeated(0); setHeatedUnitPrice(0); setHeatedUpgrade(false);
    setUnheated(0); setUnheatedUnitPrice(0); setUnheatedUpgrade(false);
    setPodologe(0); setPodologeUnitPrice(0);
    setIv(0); setIvUnitPrice(0); setIvCompany('');
    setPrecon(0);
    setPriceOverride(false); setManualTotal(0); setMemo('');
  }, [open]);

  // 자동합산 변경 시 manualTotal 동기화
  useEffect(() => {
    if (!priceOverride) setManualTotal(computedTotal + upgradeSurcharge);
  }, [computedTotal, upgradeSurcharge, priceOverride]);

  // 템플릿 → 구입 티켓 자동 채움
  const applyTemplate = (tmpl: PackageTemplate) => {
    setSelectedTemplateId(tmpl.id);
    setPackageName(tmpl.name);
    setHeated(tmpl.heated_sessions);
    setHeatedUnitPrice(tmpl.heated_unit_price);
    setHeatedUpgrade(false);
    setUnheated(tmpl.unheated_sessions);
    setUnheatedUnitPrice(tmpl.unheated_unit_price);
    setUnheatedUpgrade(false);
    setPodologe(tmpl.podologe_sessions);
    setPodologeUnitPrice(tmpl.podologe_unit_price);
    setIv(tmpl.iv_sessions);
    setIvUnitPrice(tmpl.iv_unit_price);
    setIvCompany(tmpl.iv_company ?? '');
    setPrecon(0);
    setPriceOverride(false);
    setMemo(tmpl.memo ?? '');
  };

  const applyCustom = () => {
    setSelectedTemplateId('custom');
    setPackageName('');
    setHeated(0); setHeatedUnitPrice(0); setHeatedUpgrade(false);
    setUnheated(0); setUnheatedUnitPrice(0); setUnheatedUpgrade(false);
    setPodologe(0); setPodologeUnitPrice(0);
    setIv(0); setIvUnitPrice(0); setIvCompany('');
    setPrecon(0);
    setPriceOverride(false); setManualTotal(0); setMemo('');
  };

  const submit = async () => {
    if (!packageName.trim()) { toast.error('패키지명을 입력하세요'); return; }
    if (totalSessions === 0 && podologe === 0) { toast.error('최소 1회 이상 구성하세요'); return; }
    setSubmitting(true);
    const selectedTemplate = templates.find((t) => t.id === selectedTemplateId);
    const { error } = await supabase.from('packages').insert({
      clinic_id: clinicId,
      customer_id: customerId,
      package_name: packageName.trim(),
      package_type: selectedTemplateId === 'custom' ? 'custom' : (selectedTemplate?.name ?? 'template'),
      template_id: selectedTemplateId !== 'custom' ? selectedTemplateId : null,
      total_sessions: totalSessions,
      heated_sessions: heated,
      heated_unit_price: heatedUnitPrice,
      unheated_sessions: unheated,
      unheated_unit_price: unheatedUnitPrice,
      iv_sessions: iv,
      iv_unit_price: ivUnitPrice,
      preconditioning_sessions: precon,
      podologe_sessions: podologe,
      podologe_unit_price: podologeUnitPrice,
      iv_company: ivCompany.trim() || null,
      shot_upgrade: heatedUpgrade,
      af_upgrade: unheatedUpgrade,
      upgrade_surcharge: upgradeSurcharge,
      total_amount: grandTotal,
      paid_amount: 0,
      status: 'active',
      memo: memo.trim() || null,
    });
    setSubmitting(false);
    if (error) { toast.error(`생성 실패: ${error.message}`); return; }
    onCreated();
  };

  const cn2 = (...classes: string[]) => classes.filter(Boolean).join(' ');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-xl max-h-[90vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold">구입 티켓 추가</h2>
          <button onClick={() => onOpenChange(false)} className="rounded p-1 hover:bg-muted transition">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 text-sm">
          {/* 템플릿 선택 → 자동 채움 */}
          <div className="space-y-1.5">
            <div className="text-xs font-medium text-muted-foreground">패키지 템플릿 선택 → 자동 채움</div>
            <div className="flex flex-wrap gap-2">
              {templates.map((t) => (
                <button
                  key={t.id}
                  onClick={() => applyTemplate(t)}
                  className={cn2(
                    'h-9 rounded-md border px-3 text-sm font-medium transition',
                    selectedTemplateId === t.id
                      ? 'border-teal-600 bg-teal-50 text-teal-700'
                      : 'border-gray-200 hover:bg-gray-50',
                  )}
                >
                  {t.name}
                </button>
              ))}
              <button
                onClick={applyCustom}
                className={cn2(
                  'h-9 rounded-md border px-3 text-sm font-medium transition',
                  selectedTemplateId === 'custom'
                    ? 'border-teal-600 bg-teal-50 text-teal-700'
                    : 'border-gray-200 hover:bg-gray-50',
                )}
              >
                커스텀
              </button>
            </div>
            {templates.length === 0 && (
              <div className="text-xs text-muted-foreground">템플릿 없음 — 커스텀으로 직접 입력하세요</div>
            )}
          </div>

          {/* 패키지명 */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">패키지명 *</label>
            <input
              value={packageName}
              onChange={(e) => setPackageName(e.target.value)}
              placeholder="패키지명"
              className="w-full h-9 rounded-md border border-gray-200 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-teal-500"
            />
          </div>

          {/* 가열 레이저 */}
          <div className="rounded-lg border bg-gray-50 p-3 space-y-2">
            <div className="text-xs font-semibold text-gray-500">가열 레이저</div>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <label className="text-xs text-gray-500">회수</label>
                <input
                  type="number" min={0} value={heated}
                  onChange={(e) => setHeated(Math.max(0, Number(e.target.value) || 0))}
                  className="w-full h-9 rounded-md border border-gray-200 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-teal-500"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-gray-500">수가 (회당)</label>
                <input
                  value={formatAmount(heatedUnitPrice)}
                  onChange={(e) => setHeatedUnitPrice(parseAmount(e.target.value))}
                  inputMode="numeric"
                  className="w-full h-9 rounded-md border border-gray-200 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-teal-500"
                />
              </div>
              <div className="flex items-end">
                <button
                  onClick={() => setHeatedUpgrade(!heatedUpgrade)}
                  className={cn2(
                    'h-9 w-full rounded-md border text-xs font-medium px-1.5 transition',
                    heatedUpgrade ? 'border-teal-600 bg-teal-50 text-teal-700' : 'border-gray-200 hover:bg-gray-50',
                  )}
                >
                  {heatedUpgrade ? '✓ ' : ''}6000샷 +5만
                </button>
              </div>
            </div>
            {heated > 0 && heatedUnitPrice > 0 && (
              <div className="text-xs text-gray-400 text-right">
                소계: {formatAmount(heated * heatedUnitPrice)}
                {heatedUpgrade && <span className="ml-1 text-teal-600">+50,000</span>}
              </div>
            )}
          </div>

          {/* 비가열 레이저 */}
          <div className="rounded-lg border bg-gray-50 p-3 space-y-2">
            <div className="text-xs font-semibold text-gray-500">비가열 레이저</div>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <label className="text-xs text-gray-500">회수</label>
                <input
                  type="number" min={0} value={unheated}
                  onChange={(e) => setUnheated(Math.max(0, Number(e.target.value) || 0))}
                  className="w-full h-9 rounded-md border border-gray-200 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-teal-500"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-gray-500">수가 (회당)</label>
                <input
                  value={formatAmount(unheatedUnitPrice)}
                  onChange={(e) => setUnheatedUnitPrice(parseAmount(e.target.value))}
                  inputMode="numeric"
                  className="w-full h-9 rounded-md border border-gray-200 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-teal-500"
                />
              </div>
              <div className="flex items-end">
                <button
                  onClick={() => setUnheatedUpgrade(!unheatedUpgrade)}
                  className={cn2(
                    'h-9 w-full rounded-md border text-xs font-medium px-1.5 transition',
                    unheatedUpgrade ? 'border-teal-600 bg-teal-50 text-teal-700' : 'border-gray-200 hover:bg-gray-50',
                  )}
                >
                  {unheatedUpgrade ? '✓ ' : ''}AF +4만
                </button>
              </div>
            </div>
            {unheated > 0 && unheatedUnitPrice > 0 && (
              <div className="text-xs text-gray-400 text-right">
                소계: {formatAmount(unheated * unheatedUnitPrice)}
                {unheatedUpgrade && <span className="ml-1 text-teal-600">+40,000</span>}
              </div>
            )}
          </div>

          {/* 포돌로게 */}
          <div className="rounded-lg border bg-gray-50 p-3 space-y-2">
            <div className="text-xs font-semibold text-gray-500">포돌로게</div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-xs text-gray-500">회수</label>
                <input
                  type="number" min={0} value={podologe}
                  onChange={(e) => setPodologe(Math.max(0, Number(e.target.value) || 0))}
                  className="w-full h-9 rounded-md border border-gray-200 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-teal-500"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-gray-500">수가 (회당)</label>
                <input
                  value={formatAmount(podologeUnitPrice)}
                  onChange={(e) => setPodologeUnitPrice(parseAmount(e.target.value))}
                  inputMode="numeric"
                  className="w-full h-9 rounded-md border border-gray-200 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-teal-500"
                />
              </div>
            </div>
            {podologe > 0 && podologeUnitPrice > 0 && (
              <div className="text-xs text-gray-400 text-right">소계: {formatAmount(podologe * podologeUnitPrice)}</div>
            )}
          </div>

          {/* 수액 */}
          <div className="rounded-lg border bg-gray-50 p-3 space-y-2">
            <div className="text-xs font-semibold text-gray-500">수액</div>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <label className="text-xs text-gray-500">회사</label>
                <input
                  value={ivCompany}
                  onChange={(e) => setIvCompany(e.target.value)}
                  placeholder="HK이노엔"
                  className="w-full h-9 rounded-md border border-gray-200 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-teal-500"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-gray-500">회수</label>
                <input
                  type="number" min={0} value={iv}
                  onChange={(e) => setIv(Math.max(0, Number(e.target.value) || 0))}
                  className="w-full h-9 rounded-md border border-gray-200 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-teal-500"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-gray-500">수가 (회당)</label>
                <input
                  value={formatAmount(ivUnitPrice)}
                  onChange={(e) => setIvUnitPrice(parseAmount(e.target.value))}
                  inputMode="numeric"
                  className="w-full h-9 rounded-md border border-gray-200 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-teal-500"
                />
              </div>
            </div>
            {iv > 0 && ivUnitPrice > 0 && (
              <div className="text-xs text-gray-400 text-right">소계: {formatAmount(iv * ivUnitPrice)}</div>
            )}
          </div>

          {/* 사전처치 */}
          <div className="space-y-1">
            <label className="text-xs text-gray-500">사전처치 회수 (프리컨디셔닝 — 수가 미포함)</label>
            <input
              type="number" min={0} value={precon}
              onChange={(e) => setPrecon(Math.max(0, Number(e.target.value) || 0))}
              className="w-28 h-9 rounded-md border border-gray-200 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-teal-500"
            />
          </div>

          {/* 패키지 총 금액 (항목별 자동합산 + 수기수정) */}
          <div className="rounded-lg border border-teal-200 bg-teal-50/40 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-teal-800">패키지 총 금액</span>
              <button
                onClick={() => { setPriceOverride(!priceOverride); if (!priceOverride) setManualTotal(grandTotal); }}
                className={`text-xs rounded border px-2 py-0.5 transition ${
                  priceOverride ? 'border-amber-400 bg-amber-50 text-amber-700' : 'border-gray-200 hover:bg-gray-50'
                }`}
              >
                {priceOverride ? '✓ 수기수정' : '수기수정'}
              </button>
            </div>
            {priceOverride ? (
              <input
                value={formatAmount(manualTotal)}
                onChange={(e) => setManualTotal(parseAmount(e.target.value))}
                inputMode="numeric"
                className="w-full h-10 rounded-md border border-teal-300 px-3 text-lg font-bold text-teal-700 focus:outline-none"
              />
            ) : (
              <div className="text-xl font-bold text-teal-700">
                {formatAmount(grandTotal)}
                <span className="ml-2 text-xs text-gray-400 font-normal">
                  (항목 자동합산{upgradeSurcharge > 0 ? ` + 업그레이드 ${formatAmount(upgradeSurcharge)}` : ''})
                </span>
              </div>
            )}
            <div className="text-xs text-gray-400">
              총 {totalSessions}회{podologe > 0 ? ` + 포돌로게 ${podologe}회` : ''}
            </div>
          </div>

          {/* 메모 */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500">메모 (수액종류, 업그레이드 추가사항 등)</label>
            <textarea
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              rows={2}
              placeholder="예: HK이노엔 글루타치온 + 6000샷 기본 포함"
              className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-teal-500 resize-none"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={() => onOpenChange(false)}
            className="h-9 rounded-md border border-gray-200 px-4 text-sm hover:bg-gray-50 transition"
          >
            취소
          </button>
          <button
            disabled={submitting || !packageName.trim() || (totalSessions === 0 && podologe === 0)}
            onClick={submit}
            className="h-9 rounded-md bg-teal-600 px-4 text-sm font-medium text-white hover:bg-teal-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? '저장 중…' : '구입 티켓 추가'}
          </button>
        </div>
      </div>
    </div>
  );
}
