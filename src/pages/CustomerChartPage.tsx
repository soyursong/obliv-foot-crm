import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { format } from 'date-fns';
import { ChevronDown, Printer, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { formatAmount } from '@/lib/format';
import { VISIT_TYPE_KO } from '@/lib/status';
import { cn } from '@/lib/utils';
import type { CheckIn, Customer, Package, PackageRemaining, PrescriptionRow, Reservation } from '@/lib/types';

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
  const [loading, setLoading] = useState(true);

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
      setVisits((visitRes.data ?? []) as CheckIn[]);
      setPayments((payRes.data ?? []) as Payment[]);
      setPkgPayments((pkgPayRes.data ?? []) as PackagePayment[]);
      setReservations((resvRes.data ?? []) as Reservation[]);

      const ciHistory = (ciHistRes.data ?? []) as CheckIn[];
      setCheckInHistory(ciHistory);
      setLatestCheckIn(ciHistory[0] ?? null);

      const checkInIds = ciHistory.map((ci: CheckIn) => ci.id);
      if (checkInIds.length > 0) {
        const [rxRes, consentRes, subRes] = await Promise.all([
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
        ]);
        setPrescriptions((rxRes.data ?? []) as PrescriptionRow[]);
        setConsentEntries((consentRes.data ?? []) as { form_type: string; signed_at: string }[]);
        setSubmissionEntries((subRes.data ?? []) as { template_key?: string; printed_at: string }[]);
      }

      setLoading(false);
    })();
  }, [customerId, profile]);

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

        {/* 섹션 7 — 예약메모 */}
        <ChartSection title="예약메모">
          {reservations.filter((r) => r.memo).length === 0 ? (
            <div className="text-xs text-muted-foreground py-1">메모 없음</div>
          ) : (
            <div className="space-y-1.5">
              {reservations.filter((r) => r.memo).map((r) => (
                <div key={r.id} className="rounded bg-muted/30 px-2 py-1.5 text-xs">
                  <div className="text-muted-foreground mb-0.5">{r.reservation_date} {r.reservation_time.slice(0, 5)}</div>
                  <div>{r.memo}</div>
                </div>
              ))}
            </div>
          )}
        </ChartSection>

        {/* 섹션 8 — 고객메모 */}
        <ChartSection title="고객메모" defaultOpen>
          <div className="text-xs">
            {customer.memo ? (
              <div className="whitespace-pre-wrap text-muted-foreground">{customer.memo}</div>
            ) : (
              <span className="text-muted-foreground">메모 없음</span>
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

        {/* 섹션 12 — 비포/에프터 */}
        <ChartSection title="비포/에프터">
          {checkInHistory.filter((ci) => ci.treatment_photos && ci.treatment_photos.length > 0).length === 0 ? (
            <div className="text-xs text-muted-foreground py-1">사진 없음</div>
          ) : (
            <div className="space-y-3">
              {checkInHistory
                .filter((ci) => ci.treatment_photos && ci.treatment_photos.length > 0)
                .map((ci) => (
                  <div key={ci.id}>
                    <div className="text-xs text-muted-foreground mb-1">{format(new Date(ci.checked_in_at), 'yyyy-MM-dd HH:mm')}</div>
                    <div className="grid grid-cols-2 gap-1">
                      {(ci.treatment_photos ?? []).map((url, idx) => (
                        <img
                          key={idx}
                          src={url}
                          alt={`사진 ${idx + 1}`}
                          className="rounded w-full object-cover aspect-square bg-muted"
                        />
                      ))}
                    </div>
                  </div>
                ))}
            </div>
          )}
        </ChartSection>

        {/* 섹션 13 — 체크리스트 / 동의서 */}
        <ChartSection title="체크리스트 / 동의서">
          <div className="space-y-2 text-xs">
            {latestCheckIn?.notes?.checklist && Object.keys(latestCheckIn.notes.checklist).length > 0 && (
              <div>
                <div className="font-medium text-muted-foreground mb-1">체크리스트</div>
                <Badge variant="secondary" className="text-[10px]">작성완료</Badge>
              </div>
            )}
            {consentEntries.length === 0 ? (
              <div className="text-muted-foreground">동의서 없음</div>
            ) : (
              <div>
                <div className="font-medium text-muted-foreground mb-1">동의서</div>
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
