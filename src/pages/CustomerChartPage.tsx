import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { format } from 'date-fns';
import { ChevronDown, Pencil, Printer, Trash2, Upload, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { formatAmount } from '@/lib/format';
import { VISIT_TYPE_KO } from '@/lib/status';
import { cn } from '@/lib/utils';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import type { CheckIn, Customer, Package, PackageRemaining, PrescriptionRow, Reservation } from '@/lib/types';
// T-20260506-foot-CHECKLIST-AUTOUPLOAD: 업로드된 양식 조회
import { DocumentViewer } from '@/components/forms/DocumentViewer';

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

function ChartSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border bg-white overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-sm font-medium hover:bg-muted/30 transition"
      >
        <span className="flex-1 text-left">{title}</span>
        <ChevronDown className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>
      {open && <div className="border-t px-3 py-2 text-sm">{children}</div>}
    </div>
  );
}

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
  const [loading, setLoading] = useState(true);
  // T-20260504-foot-MEMO-RESTRUCTURE: 고객메모 인라인 편집
  const [editingCustomerMemo, setEditingCustomerMemo] = useState(false);
  const [customerMemoText, setCustomerMemoText] = useState('');
  const [savingCustomerMemo, setSavingCustomerMemo] = useState(false);
  const customerMemoRef = useRef<HTMLTextAreaElement>(null);

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

  return (
    <div className="min-h-screen bg-background">
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

      <div className="p-4 space-y-2 max-w-3xl mx-auto">
        {/* 통계 */}
        <div className="grid grid-cols-2 gap-2 mb-2">
          <div className="rounded-lg bg-muted/40 px-3 py-2">
            <div className="text-xs text-muted-foreground">총 방문</div>
            <div className="text-base font-bold">{visits.length}회</div>
          </div>
          <div className="rounded-lg bg-muted/40 px-3 py-2">
            <div className="text-xs text-muted-foreground">총 결제</div>
            <div className="text-base font-bold">{formatAmount(totalPaid)}</div>
          </div>
        </div>

        {/* 섹션 1 — 성함/접수시간 */}
        <ChartSection title="성함 / 접수시간" defaultOpen>
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-xl font-bold">{customer.name}</span>
                {customer.chart_number && (
                  <span className="rounded bg-teal-50 px-1.5 py-0.5 text-xs font-medium text-teal-700">{customer.chart_number}</span>
                )}
                <Badge variant={customer.visit_type === 'new' ? 'teal' : 'secondary'} className="text-[10px]">
                  {VISIT_TYPE_KO[customer.visit_type as keyof typeof VISIT_TYPE_KO] ?? customer.visit_type}
                </Badge>
              </div>
              {customer.birth_date && (
                <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">{customer.birth_date}</div>
              )}
              {latestCheckIn && (
                <div className="mt-1 text-xs text-muted-foreground">
                  최근 방문: {format(new Date(latestCheckIn.checked_in_at), 'MM-dd HH:mm')}
                </div>
              )}
            </div>
          </div>
        </ChartSection>

        {/* 섹션 2 — 내원경로 */}
        <ChartSection title="내원경로" defaultOpen>
          <div className="space-y-1">
            {customer.lead_source ? (
              <span className="inline-block rounded-full bg-teal-100 px-2.5 py-0.5 text-xs font-medium text-teal-800">
                {customer.lead_source}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">경로 미입력</span>
            )}
            {(customer.referrer_name || customer.referrer_id) && (
              <div className="text-xs text-muted-foreground">
                추천인: {customer.referrer_name ?? '(고객 연결됨)'}
              </div>
            )}
          </div>
        </ChartSection>

        {/* 섹션 3 — 연락처 */}
        <ChartSection title="연락처" defaultOpen>
          <div className="space-y-0.5 text-xs">
            <div className="flex gap-2">
              <span className="text-muted-foreground w-16">전화번호</span>
              <span className="font-medium">{customer.phone}</span>
            </div>
            {customer.birth_date && (
              <div className="flex gap-2">
                <span className="text-muted-foreground w-16">생년월일</span>
                <span className="tabular-nums">{customer.birth_date}</span>
              </div>
            )}
            <div className="flex gap-2">
              <span className="text-muted-foreground w-16">외국인</span>
              <span>{customer.is_foreign ? '예' : '아니오'}</span>
            </div>
          </div>
        </ChartSection>

        {/* 섹션 4 — 치료플랜 (패키지) */}
        <ChartSection title="치료플랜 (패키지)" defaultOpen>
          {packages.length === 0 ? (
            <div className="py-2 text-xs text-muted-foreground">패키지 없음</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
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
                        <td className="px-2 py-1.5 text-center font-semibold text-teal-700">
                          {p.remaining?.total_remaining ?? '-'}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{formatAmount(p.total_amount)}</td>
                        <td className="px-2 py-1.5 text-muted-foreground">{p.contract_date}</td>
                        <td className="px-2 py-1.5 text-center">
                          <Badge
                            variant={p.status === 'active' ? 'teal' : p.status === 'refunded' ? 'destructive' : 'secondary'}
                            className="text-[10px] px-1.5"
                          >
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
        </ChartSection>

        {/* 섹션 4.5 — 구매 패키지(티켓) — T-20260506-foot-CHART-MINI-HOMEPAGE */}
        <ChartSection title="구매 패키지(티켓)" defaultOpen>
          {packages.length === 0 ? (
            <div className="py-2 text-xs text-muted-foreground">패키지 없음</div>
          ) : (
            <div className="space-y-3">
              {packages.map((p) => {
                const usedSessions = packageSessions.filter(
                  (s) => s.package_id === p.id && s.status === 'used',
                );
                // 치료사명 목록 (중복 제거)
                const therapistNames = [...new Set(
                  usedSessions.map((s) => s.staff_name).filter(Boolean),
                )];
                const usedCount = p.remaining
                  ? p.total_sessions - p.remaining.total_remaining
                  : usedSessions.length;

                return (
                  <div key={p.id} className="rounded-lg border border-muted/40 overflow-hidden">
                    {/* 패키지 헤더 */}
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
                    {/* 3×4 표: 상품명 | 수가 | 구매횟수 | 사용횟수(치료사명) */}
                    <table className="w-full text-xs border-collapse">
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
                            {therapistNames.length > 0
                              ? therapistNames.join(', ')
                              : usedCount > 0 ? '기록 없음' : '-'}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                    {/* 회차별 상세 (세션 있을 때만) */}
                    {usedSessions.length > 0 && (
                      <div className="border-t border-muted/20 px-3 pb-2 pt-1.5">
                        <div className="text-[10px] text-muted-foreground mb-1 font-medium">회차 상세</div>
                        <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
                          {usedSessions.map((s) => {
                            const typeLabel: Record<string, string> = {
                              heated_laser: '가열',
                              unheated_laser: '비가열',
                              iv: '수액',
                              preconditioning: '프컨',
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
        </ChartSection>

        {/* 섹션 5 — 공간배정 */}
        <ChartSection title="공간배정">
          {latestCheckIn ? (
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <div className="flex gap-2">
                <span className="text-muted-foreground w-14">진료실</span>
                <span>{latestCheckIn.examination_room ?? '-'}</span>
              </div>
              <div className="flex gap-2">
                <span className="text-muted-foreground w-14">상담실</span>
                <span>{latestCheckIn.consultation_room ?? '-'}</span>
              </div>
              <div className="flex gap-2">
                <span className="text-muted-foreground w-14">치료실</span>
                <span>{latestCheckIn.treatment_room ?? '-'}</span>
              </div>
              <div className="flex gap-2">
                <span className="text-muted-foreground w-14">레이저</span>
                <span>{latestCheckIn.laser_room ?? '-'}</span>
              </div>
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">방문 이력 없음</div>
          )}
        </ChartSection>

        {/* 섹션 6 — 예약내역 */}
        <ChartSection title="예약내역">
          {reservations.length === 0 ? (
            <div className="text-xs text-muted-foreground py-1">예약 없음</div>
          ) : (
            <div className="space-y-1">
              {reservations.map((r) => (
                <div key={r.id} className="flex items-center justify-between rounded bg-muted/30 px-2 py-1 text-xs">
                  <span>{r.reservation_date} {r.reservation_time.slice(0, 5)}</span>
                  <Badge variant="secondary" className="text-[10px]">{r.status}</Badge>
                </div>
              ))}
            </div>
          )}
        </ChartSection>

        {/* 섹션 7 — 예약메모 (T-20260504-foot-MEMO-RESTRUCTURE) */}
        <ChartSection title="예약메모 (예약 경로 확인)">
          {reservations.filter((r) => r.booking_memo || r.memo).length === 0 ? (
            <div className="text-xs text-muted-foreground py-1">메모 없음</div>
          ) : (
            <div className="space-y-1.5">
              {reservations.filter((r) => r.booking_memo || r.memo).map((r) => (
                <div key={r.id} className="rounded bg-amber-50 border border-amber-100 px-2 py-1.5 text-xs">
                  <div className="text-muted-foreground mb-0.5">{r.reservation_date} {r.reservation_time.slice(0, 5)}</div>
                  <div>{r.booking_memo ?? r.memo}</div>
                </div>
              ))}
            </div>
          )}
        </ChartSection>

        {/* 섹션 8 — 고객메모 (T-20260504-foot-MEMO-RESTRUCTURE) */}
        <ChartSection title="고객메모 (성향·주차)" defaultOpen>
          <div className="text-xs space-y-2">
            {editingCustomerMemo ? (
              <div className="space-y-2">
                <Textarea
                  ref={customerMemoRef}
                  value={customerMemoText}
                  onChange={(e) => setCustomerMemoText(e.target.value)}
                  placeholder="고객 성향, 특이사항, 주차 정보 등"
                  rows={3}
                  className="text-xs"
                  autoFocus
                />
                <div className="flex gap-2">
                  <Button size="sm" className="h-7 text-xs flex-1" onClick={saveCustomerMemo} disabled={savingCustomerMemo}>
                    {savingCustomerMemo ? '저장 중…' : '저장'}
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setEditingCustomerMemo(false); setCustomerMemoText(customer.customer_memo ?? ''); }}>
                    취소
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2">
                <div className="flex-1">
                  {(customer.customer_memo ?? customer.memo) ? (
                    <div className="whitespace-pre-wrap text-muted-foreground">{customer.customer_memo ?? customer.memo}</div>
                  ) : (
                    <span className="text-muted-foreground">메모 없음</span>
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
        </ChartSection>

        {/* 섹션 9 — 상담메모 / 담당실장 */}
        <ChartSection title="상담메모 / 담당실장" defaultOpen>
          <div className="space-y-1.5 text-xs">
            {customer.tm_memo ? (
              <div className="whitespace-pre-wrap text-muted-foreground">{customer.tm_memo}</div>
            ) : (
              <span className="text-muted-foreground">상담메모 없음</span>
            )}
            <div className="flex gap-2 text-muted-foreground">
              <span className="w-16">담당실장</span>
              <span>{latestCheckIn?.consultant_id ?? '-'}</span>
            </div>
          </div>
        </ChartSection>

        {/* 섹션 10 — 원장소견 */}
        <ChartSection title="원장소견">
          {checkInHistory.filter((ci) => ci.doctor_note).length === 0 ? (
            <div className="text-xs text-muted-foreground py-1">소견 없음</div>
          ) : (
            <div className="space-y-2">
              {checkInHistory.filter((ci) => ci.doctor_note).map((ci) => (
                <div key={ci.id} className="rounded bg-muted/30 px-2 py-1.5 text-xs">
                  <div className="text-muted-foreground mb-0.5">{format(new Date(ci.checked_in_at), 'yyyy-MM-dd HH:mm')}</div>
                  <div className="whitespace-pre-wrap">{ci.doctor_note}</div>
                </div>
              ))}
            </div>
          )}
        </ChartSection>

        {/* 섹션 10.5 — 진료종류 (간단차트) */}
        <ChartSection title="진료종류">
          {checkInHistory.filter((ci) =>
            ci.consultation_done || ci.treatment_kind || ci.preconditioning_done || ci.pododulle_done || ci.laser_minutes != null
          ).length === 0 ? (
            <div className="text-xs text-muted-foreground py-1">기록 없음</div>
          ) : (
            <div className="space-y-2">
              {checkInHistory
                .filter((ci) =>
                  ci.consultation_done || ci.treatment_kind || ci.preconditioning_done || ci.pododulle_done || ci.laser_minutes != null
                )
                .map((ci) => (
                  <div key={ci.id} className="rounded bg-muted/30 px-2 py-1.5 text-xs">
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
        </ChartSection>

        {/* 섹션 11 — 시술메모 */}
        <ChartSection title="시술메모">
          {checkInHistory.filter((ci) => ci.treatment_memo).length === 0 ? (
            <div className="text-xs text-muted-foreground py-1">시술메모 없음</div>
          ) : (
            <div className="space-y-2">
              {checkInHistory.filter((ci) => ci.treatment_memo).map((ci) => (
                <div key={ci.id} className="rounded bg-muted/30 px-2 py-1.5 text-xs">
                  <div className="text-muted-foreground mb-0.5">{format(new Date(ci.checked_in_at), 'yyyy-MM-dd HH:mm')}</div>
                  <div className="whitespace-pre-wrap">
                    {ci.treatment_memo?.details ?? JSON.stringify(ci.treatment_memo)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </ChartSection>

        {/* 섹션 12 — 이미지 관리 (역할별) — T-20260506-foot-CHART-MINI-HOMEPAGE
            5/4 14:49 요청: 상담실장 영역(동의서+결제영수증) / 치료사 영역(비포에프터) 구분 */}
        <ChartSection title="이미지 관리" defaultOpen>
          <div className="space-y-4">

            {/* ── 상담실장 영역 ───────────────────────────────────────────────── */}
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-bold text-blue-800">
                <span className="h-2 w-2 rounded-full bg-blue-500" />
                상담실장 영역
              </div>
              <div className="space-y-2 pl-1">
                <CustomerStorageImageSection
                  customerId={customer.id}
                  prefix="consent"
                  label="동의서 사진 (환불 + 비급여동의서)"
                  accent="blue"
                />
                <CustomerStorageImageSection
                  customerId={customer.id}
                  prefix="receipt"
                  label="결제영수증"
                  accent="green"
                />
              </div>
            </div>

            {/* ── 치료사 영역 ─────────────────────────────────────────────────── */}
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-bold text-amber-800">
                <span className="h-2 w-2 rounded-full bg-amber-500" />
                치료사 영역 — 일자별 비포/에프터
              </div>
              <div className="pl-1">
                {checkInHistory.filter((ci) => ci.treatment_photos && ci.treatment_photos.length > 0).length === 0 ? (
                  <div className="rounded border border-dashed py-2.5 text-center text-xs text-muted-foreground">
                    사진 없음 (간편차트에서 업로드)
                  </div>
                ) : (
                  <div className="space-y-3">
                    {checkInHistory
                      .filter((ci) => ci.treatment_photos && ci.treatment_photos.length > 0)
                      .map((ci) => (
                        <div key={ci.id}>
                          <div className="text-[10px] text-muted-foreground mb-1 font-medium">
                            {format(new Date(ci.checked_in_at), 'yyyy-MM-dd')}
                          </div>
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

          </div>
        </ChartSection>

        {/* 섹션 13 — 체크리스트 / 동의서 */}
        <ChartSection title={`체크리스트 / 동의서${checklistEntries.length > 0 ? ` (사전체크 ${checklistEntries.length}건)` : ''}`} defaultOpen>
          <div className="space-y-3 text-xs">
            {/* T-20260430-foot-PRESCREEN-CHECKLIST: 사전 체크리스트 응답 (checklists 테이블) */}
            {checklistEntries.length > 0 && (
              <div className="space-y-2">
                <div className="font-medium text-muted-foreground">사전 체크리스트 응답</div>
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
                      {(d.symptoms ?? []).length > 0 && (
                        <div><span className="text-muted-foreground">증상: </span>{(d.symptoms ?? []).join(', ')}</div>
                      )}
                      {(d.nail_locations ?? []).length > 0 && (
                        <div><span className="text-muted-foreground">통증부위: </span>{(d.nail_locations ?? []).join(', ')}</div>
                      )}
                      {d.pain_duration && (
                        <div><span className="text-muted-foreground">유병기간: </span>{d.pain_duration}</div>
                      )}
                      {d.pain_severity && (
                        <div><span className="text-muted-foreground">통증강도: </span>{severityLabel[d.pain_severity] ?? d.pain_severity}</div>
                      )}
                      {(d.medical_history ?? []).length > 0 && (
                        <div><span className="text-muted-foreground">병력: </span>{(d.medical_history ?? []).join(', ')}</div>
                      )}
                      {d.medications_none && (
                        <div><span className="text-muted-foreground">복용약: </span>없음</div>
                      )}
                      {!d.medications_none && (d.medications ?? []).length > 0 && (
                        <div><span className="text-muted-foreground">복용약: </span>{(d.medications ?? []).join(', ')}</div>
                      )}
                      {d.has_allergy && (d.allergy_types ?? []).length > 0 && (
                        <div className="text-rose-600"><span className="text-muted-foreground">알레르기: </span>{(d.allergy_types ?? []).join(', ')}</div>
                      )}
                      {d.prior_conditions && (
                        <div><span className="text-muted-foreground">기왕증: </span>{d.prior_conditions}</div>
                      )}
                      {d.family_history && (
                        <div><span className="text-muted-foreground">가족력: </span>{d.family_history}</div>
                      )}
                      {d.referral_source && (
                        <div><span className="text-muted-foreground">방문경로: </span>{d.referral_source}</div>
                      )}
                      <div className="flex gap-2 pt-0.5">
                        {d.agree_privacy && <Badge variant="outline" className="text-[9px] text-teal-600 border-teal-300">개인정보동의</Badge>}
                        {d.agree_marketing && <Badge variant="outline" className="text-[9px] text-emerald-600 border-emerald-300">마케팅동의</Badge>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {latestCheckIn?.notes?.checklist && Object.keys(latestCheckIn.notes.checklist).length > 0 && (
              <div>
                <div className="font-medium text-muted-foreground mb-1">체크리스트 (구버전)</div>
                <Badge variant="secondary" className="text-[10px]">작성완료</Badge>
              </div>
            )}
            {consentEntries.length > 0 && (
              <div>
                <div className="font-medium text-muted-foreground mb-1">전자서명 동의서</div>
                <div className="space-y-1">
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
              </div>
            )}
            {/* T-20260506-foot-CHECKLIST-AUTOUPLOAD: 태블릿 작성 양식 + 자동 업로드 */}
            <div className="pt-1 border-t">
              <div className="font-medium text-muted-foreground mb-1.5">태블릿 작성 양식 (자동 업로드)</div>
              <DocumentViewer customerId={customer.id} />
            </div>
          </div>
        </ChartSection>

        {/* 섹션 14 — 처방전 */}
        <ChartSection title="처방전">
          {prescriptions.length === 0 ? (
            <div className="text-xs text-muted-foreground py-1">처방전 없음</div>
          ) : (
            <div className="space-y-2 text-xs">
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
        </ChartSection>

        {/* 섹션 15 — 서류발행 */}
        <ChartSection title="서류발행">
          {submissionEntries.length === 0 ? (
            <div className="text-xs text-muted-foreground py-1">발행 이력 없음</div>
          ) : (
            <div className="space-y-1 text-xs">
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
        </ChartSection>
      </div>
    </div>
  );
}
