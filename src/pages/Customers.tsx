// LOGIC-LOCK: L-004 — 차트 접근 경로 잠금. useChart() hook 경유만 허용. 변경 시 현장 승인 필수
/**
 * 고객관리 페이지
 *
 * T-20260506-foot-CHART-CONSOLIDATE:
 *   고객관리 메뉴의 차트(CustomerDetailSheet)를 폐지하고
 *   행 클릭 → 2번차트(미니홈피, /chart/:id) 새 창으로 통합.
 *   CRM 차트는 1번(간편차트=대시보드 우측 패널) / 2번(미니홈피) 두 가지만 존재.
 *   수정 기능은 EditCustomerDialog(수정 전용 다이얼로그)로 분리.
 *
 * T-20260510-foot-CUSTMGMT-CHART-PATTERN:
 *   대시보드와 접근 패턴 통일.
 *   클릭 → 1번차트(간편요약, 우측 패널), 우클릭 → 2번차트(미니홈피) 새 창
 *
 * T-20260514-foot-CHART2-OPEN-BUG (3차 재오픈):
 *   openChart() window.open() → CustomerChartSheet DrawerSheet로 전환.
 *   window.open() 팝업 차단 시 2번차트 안열리는 버그 해소.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { BookOpen, CalendarPlus, CreditCard, Download, ExternalLink, MessageSquare, Pencil, Plus, Search, Stethoscope, Trash2 } from 'lucide-react';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { InlinePatientSearch, type PatientMatch } from '@/components/InlinePatientSearch';
import { CheckInDetailSheet } from '@/components/CheckInDetailSheet';
// T-20260516-foot-CHART2-STATE-UNIFY: CustomerChartSheet 렌더 AdminLayout 단일화로 이동
import { useChart } from '@/lib/chartContext';
// T-20260515-foot-CONTEXT-MENU-4ITEM AC-4: 진료차트 패널
import MedicalChartPanel from '@/components/MedicalChartPanel';
// T-20260614-foot-CUSTLIST-CTXMENU-PARITY: 우클릭 [문자] parity — 기존 SMS 발송 경로(SendSmsDialog) 재사용
import SendSmsDialog from '@/components/SendSmsDialog';
import { canAccess, isStaffUnlockRole } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useClinic } from '@/hooks/useClinic';
import { formatAmount, formatPhone, birthDateYMD } from '@/lib/format';
import { normalizeToE164 } from '@/lib/phone';
// T-20260613-foot-CUSTLIST-MULTISELECT-EXPORT: 리스트 내보내기 CSV(무의존). PHI(rrn) 영구 제외, admin/manager 게이팅.
//   (엑셀 .xlsx 내보내기는 후속 — customerExport.ts 유지)
import { downloadCustomerCsv, customerCsvFilename, type CustomerCsvRow } from '@/lib/customerCsv';
import type { CheckIn, Customer, LeadSource } from '@/lib/types';
// T-20260625-foot-PASSPORT-PORT: 외국인 정보(국적/여권 영문명/여권번호/외국인등록번호/만료일) — derm 이식
import ForeignInfoSection, { type ForeignInfoValue } from '@/components/ForeignInfoSection';

interface CustomerStats {
  visit_count: number;
  last_visit: string | null;
  total_revenue: number;
  has_package: boolean;
}

const LEAD_SOURCE_OPTIONS: LeadSource[] = ['TM', '인바운드', '워크인', '지인소개', '온라인', '기타'];

const PAGE_SIZE = 30;

/** 페이지네이션 버튼 번호 목록 생성 (숫자 | '…') */
function getPageNumbers(current: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  if (current <= 4) return [1, 2, 3, 4, 5, '…', total];
  if (current >= total - 3) return [1, '…', total - 4, total - 3, total - 2, total - 1, total];
  return [1, '…', current - 1, current, current + 1, '…', total];
}

// T-20260613-foot-CUSTLIST-MULTISELECT-EXPORT: 내보내기(필터 전체) 안전 상한.
// 선택 0건 → 현재 필터에 매칭되는 전체 고객 export. 폭주 방지 상한(단일 지점 현실 규모 충분).
const EXPORT_MAX = 5000;
// 통계 집계용 IN 쿼리 청크 크기 (URL 길이 한계 회피).
const STATS_CHUNK = 150;

/**
 * 고객관리 검색/내보내기 공통 필터 적용 (검색어 + 담당자).
 * runSearch(목록)와 export(전체)에서 동일 필터를 보장하기 위해 추출 — drift 차단.
 * 구조적 제네릭: PostgREST 빌더(.is/.eq/.or 동일 반환)를 내부 타입 import 없이 수용.
 */
function applyCustomerSearchFilters<
  Q extends {
    is: (col: string, val: null) => Q;
    eq: (col: string, val: string) => Q;
    or: (filters: string) => Q;
  },
>(req: Q, staffFilter: string, rawQuery: string): Q {
  // 담당자 필터 ('미지정' → IS NULL, 특정 직원 → assigned_staff_id 일치, '전체' → 미적용)
  if (staffFilter === '__unassigned__') {
    req = req.is('assigned_staff_id', null);
  } else if (staffFilter) {
    req = req.eq('assigned_staff_id', staffFilter);
  }
  const trimmed = rawQuery.trim();
  if (trimmed) {
    const safe = trimmed.replace(/[%_(),.]/g, '');
    if (safe) {
      const digits = safe.replace(/\D/g, '');
      const digitsNoLeadingZero = digits.startsWith('0') && digits.length >= 5 ? digits.slice(1) : null;
      const dobYYMMDD = digits.length === 8 ? digits.slice(2) : null;
      const orParts = [
        `name.ilike.%${safe}%`,
        `phone.ilike.%${safe}%`,
        `birth_date.ilike.%${safe}%`,
        `chart_number.ilike.%${safe}%`,
      ];
      if (digitsNoLeadingZero) orParts.push(`phone.ilike.%${digitsNoLeadingZero}%`);
      if (dobYYMMDD) orParts.push(`birth_date.ilike.%${dobYYMMDD}%`);
      req = req.or(orParts.join(','));
    }
  }
  return req;
}

/**
 * 고객 id 집합에 대한 통계(방문·결제·패키지) + 서버 파생 생년월일 로드.
 * runSearch(현재 페이지)와 export(필터 전체)에서 공유. 많은 id는 청크로 나눠 IN 쿼리.
 * PHI: 생년월일은 RPC(fn_customer_birthdates) 서버 파생값만 수신 — rrn 복호화 결과는 클라에 미노출.
 */
async function loadCustomerStats(
  clinicId: string,
  ids: string[],
): Promise<{ statsMap: Map<string, CustomerStats>; birthMap: Map<string, string> }> {
  const statsMap = new Map<string, CustomerStats>();
  const birthMap = new Map<string, string>();
  if (ids.length === 0) return { statsMap, birthMap };
  for (const id of ids) statsMap.set(id, { visit_count: 0, last_visit: null, total_revenue: 0, has_package: false });

  // id 청크 단위로 집계 (URL 길이 한계 회피)
  for (let i = 0; i < ids.length; i += STATS_CHUNK) {
    const chunk = ids.slice(i, i + STATS_CHUNK);
    const [checkInsRes, paymentsRes, pkgPaymentsRes, pkgsRes, birthRes] = await Promise.all([
      supabase.from('check_ins').select('customer_id, checked_in_at').in('customer_id', chunk).neq('status', 'cancelled'),
      supabase.from('payments').select('customer_id, amount, payment_type').in('customer_id', chunk),
      supabase.from('package_payments').select('customer_id, amount, payment_type').in('customer_id', chunk),
      supabase.from('packages').select('customer_id').in('customer_id', chunk).eq('status', 'active'),
      supabase.rpc('fn_customer_birthdates', { p_clinic_id: clinicId, p_ids: chunk }),
    ]);
    for (const row of (checkInsRes.data ?? []) as { customer_id: string; checked_in_at: string }[]) {
      const s = statsMap.get(row.customer_id);
      if (!s) continue;
      s.visit_count++;
      if (!s.last_visit || row.checked_in_at > s.last_visit) s.last_visit = row.checked_in_at;
    }
    for (const row of (paymentsRes.data ?? []) as { customer_id: string | null; amount: number; payment_type: string }[]) {
      if (!row.customer_id) continue;
      const s = statsMap.get(row.customer_id);
      if (s) s.total_revenue += row.payment_type === 'refund' ? -row.amount : row.amount;
    }
    for (const row of (pkgPaymentsRes.data ?? []) as { customer_id: string; amount: number; payment_type: string }[]) {
      const s = statsMap.get(row.customer_id);
      if (s) s.total_revenue += row.payment_type === 'refund' ? -row.amount : row.amount;
    }
    for (const row of (pkgsRes.data ?? []) as { customer_id: string }[]) {
      const s = statsMap.get(row.customer_id);
      if (s) s.has_package = true;
    }
    if (!birthRes.error) {
      for (const row of (birthRes.data ?? []) as { customer_id: string; birth_date_display: string | null }[]) {
        if (row.birth_date_display) birthMap.set(row.customer_id, row.birth_date_display);
      }
    }
  }
  return { statsMap, birthMap };
}


export default function Customers() {
  const location = useLocation();
  const clinic = useClinic();
  const { profile } = useAuth();
  // T-20260520-foot-STAFF-CUSTOMER-UPDATE: isAdmin → 역할별 권한 분리 (isAdmin 제거됨)
  // staff/part_lead도 customers UPDATE 가능 (RLS: customers_staff_update)
  // T-20260620-foot-STAFF-PERM-UNLOCK-6MENU ⑥: 고객정보 수정 — therapist 누락분 해제(3역할 전체 보장).
  //   ★ADDITIVE only: 기존 staff/part_lead 절대 회수 금지(lock-out 0). isStaffUnlockRole(6역할: +director/therapist) ∪ {staff,part_lead}.
  //   동반 RLS 마이그(customers_therap_update_6menu = therapist UPDATE). consult/coord 는 customers_*_update 旣허용.
  const canEditCustomer = isStaffUnlockRole(profile?.role) || ['staff', 'part_lead'].includes(profile?.role ?? '');
  // 삭제는 admin / T-20260619-foot-MUNJIEUN-ROLE-DIRECTOR B2①(DA PII 민감도): +director(대표원장). customers RLS=is_admin_or_manager(director 포함)이라 FOR ALL(DELETE) 이미 director 허용 → RLS/감사로그 영향 0. admin 비제거.
  const canDeleteCustomer = profile?.role === 'admin' || profile?.role === 'director';
  // T-20260613-foot-CUSTLIST-MULTISELECT-EXPORT: 내보내기는 PII(전화·생년월일) 포함 → admin/manager 한정(노출+실행 동시 게이팅).
  // T-20260620-foot-SUPERADMIN-EXEMPT: profile(subject) 전달 → exempt_from_restrictions honor(상시예외 시 customer_export 보존). role 문자열 대신 subject.
  const canExportCustomers = canAccess(profile, 'customer_export');
  const [query, setQuery] = useState('');
  // T-20260613-foot-CUSTLIST-STAFF-FILTER: 담당자 드롭다운 필터.
  // '' = 전체(필터해제), '__unassigned__' = 미지정(assigned_staff_id IS NULL), 그 외 = staff.id 일치.
  // 검색어와 AND 조합. 옵션소스 = staff role consultant/coordinator/director (assigned_staff_id 旣구현 자산 재사용).
  const [staffFilter, setStaffFilter] = useState('');
  const [staffOptions, setStaffOptions] = useState<{ id: string; name: string }[]>([]);
  // T-20260614-foot-CUSTOMER-STAFF-AUTOLINK (기능1): 고객 목록 '담당자' 컬럼 표시용 staff_id → 이름 맵.
  //   재진=차트(차트2)에 지정된 assigned_staff_id 이름 자동연동 / 첫방문(NULL)=공란(AC2) / 결손=빈값 안전표시(AC4).
  //   드롭다운 옵션소스(consultant/coordinator/director, active)와 달리 비활성·director 담당자도 이름 resolve해야 하므로
  //   active/role 필터 없이 clinic 전체 staff 이름 맵을 로드(raw UUID/공백 노출 방지).
  const [staffNameMap, setStaffNameMap] = useState<Map<string, string>>(new Map());
  const [results, setResults] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(false);
  // T-20260506-foot-CHART-CONSOLIDATE: selected → editingCustomer (수정 전용)
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [openCreate, setOpenCreate] = useState(false);
  // T-20260510-foot-CUSTMGMT-CHART-PATTERN: 1번차트 우측 패널
  // T-20260511-foot-CUSTMGMT-DETAIL-SHEET: CheckInDetailSheet customerMode로 교체
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  // T-20260516-foot-CHART2-STATE-UNIFY: chart2Id state 제거 → AdminLayout ChartContext 사용
  // LOGIC-LOCK: L-004 [CHART-LOCK-008] — openChart 호출은 useChart() 경유만. 직접 접근 금지.
  const { openChart } = useChart();
  // T-20260515-foot-CONTEXT-MENU-4ITEM AC-4: 진료차트 패널
  const [medicalChartOpen, setMedicalChartOpen] = useState(false);
  const [medicalChartCustomerId, setMedicalChartCustomerId] = useState<string | null>(null);
  // T-20260614-foot-CUSTLIST-CTXMENU-PARITY: 우클릭 [문자] → 기존 SendSmsDialog 경로 재사용(신규 발송 로직 없음).
  // 게이트는 canon SSOT인 manual_sms_send 권한(CustomerQuickMenu/Dashboard/Reservations 동일) — 미충족 시 onSendSms 미전달로 항목 미노출.
  const [smsTarget, setSmsTarget] = useState<CheckIn | null>(null);
  const canSendSms = canAccess(profile, 'manual_sms_send');
  // Customer → CheckIn 어댑터: SendSmsDialog는 customer_id로 phone을 SSOT refetch하므로 식별 필드만 채우면 충분
  // (resvAsCheckIn(Reservations.tsx) 패턴 미러). 가짜 체크인 행이므로 id에 cust- 접두.
  const customerAsCheckIn = useCallback((c: Customer): CheckIn => ({
    id: `cust-${c.id}`,
    clinic_id: c.clinic_id,
    customer_id: c.id,
    reservation_id: null,
    queue_number: null,
    customer_name: c.name,
    customer_phone: c.phone,
    visit_type: c.visit_type,
    status: 'waiting' as CheckIn['status'],
    consultant_id: null,
    therapist_id: null,
    technician_id: null,
    consultation_room: null,
    treatment_room: null,
    laser_room: null,
    package_id: null,
    notes: null,
    treatment_memo: null,
    treatment_photos: null,
    doctor_note: null,
    examination_room: null,
    checked_in_at: c.created_at,
    called_at: null,
    completed_at: null,
    priority_flag: null,
    sort_order: 0,
    skip_reason: null,
    created_at: c.created_at,
    consultation_done: false,
    treatment_kind: null,
    preconditioning_done: false,
    pododulle_done: false,
    laser_minutes: null,
    prescription_items: null,
    document_content: null,
    doctor_confirm_charting: false,
    doctor_confirm_prescription: false,
    doctor_confirm_document: false,
    doctor_confirmed_at: null,
    healer_laser_confirm: false,
    prescription_status: 'none',
    status_flag: null,
    status_flag_history: null,
    assigned_counselor_id: null,
    treatment_category: null,
    treatment_contents: null,
    doctor_call_memo: null,
    doctor_ack_at: null,
    doctor_status: null,
    doctor_started_at: null,
    doctor_ended_at: null,
    call_list_manual_order: null,
  }), []);
  // 우클릭 컨텍스트 메뉴
  // T-20260613-foot-CUST-CONTEXTMENU-STALE: customer 스냅샷 대신 customerId만 보관.
  // 메뉴 표시 데이터는 render 시점에 results에서 라이브 조회 → 수정·저장 후 stale 방지.
  const [ctxMenu, setCtxMenu] = useState<{ customerId: string; x: number; y: number } | null>(null);
  const [statsMap, setStatsMap] = useState<Map<string, CustomerStats>>(new Map());
  // T-20260613-foot-CUSTLIST-BIRTHDATE-FROM-RRN: 생년월일(YYYY-MM-DD) 서버 파생값.
  // PHI: rrn 복호화는 RPC(fn_customer_birthdates) 서버측에서만, birth_date만 수신.
  const [birthMap, setBirthMap] = useState<Map<string, string>>(new Map());
  // T-20260613-foot-CUSTMGMT-LIST-5FIX AC4: 행 선택(체크박스) + 리스트 다운로드.
  // 선택은 customer id Set. 검색/페이지 전환 시 초기화(혼선 방지).
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // T-20260613-foot-CUSTLIST-MULTISELECT-EXPORT: 내보내기 진행 중(중복 클릭·전체 fetch 대기) 표시.
  const [exporting, setExporting] = useState(false);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navStateConsumed = useRef(false);

  const runSearch = useCallback(
    async (q: string, pageNum = 1) => {
      if (!clinic) return;
      const trimmed = q.trim();
      setLoading(true);
      const from = (pageNum - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      let req = supabase
        .from('customers')
        .select('*', { count: 'exact' })
        .eq('clinic_id', clinic.id)
        // T-20260610-foot-ADMIN-SIM-FILTER: 시뮬레이션(테스트 더미) 기본 숨김.
        // IS NOT TRUE → false/NULL(실고객) 보존, true만 제외 (AC-3 null-safe).
        .not('is_simulation', 'is', true)
        .order('updated_at', { ascending: false })
        .range(from, to);
      // T-20260613-foot-CUSTLIST-STAFF-FILTER + SEARCH-PHONE-DOB: 담당자·검색어 필터 (export와 공유 헬퍼).
      req = applyCustomerSearchFilters(req, staffFilter, trimmed);
      const { data, error, count } = await req;
      setLoading(false);
      if (error) {
        toast.error('검색 실패');
        return;
      }
      setTotalCount(count ?? 0);
      const customers = (data ?? []) as Customer[];
      setResults(customers);
      // T-20260613-foot-CUSTMGMT-LIST-5FIX AC4: 검색/페이지 전환 시 선택 초기화(다른 리스트와 혼선 방지)
      setSelectedIds(new Set());

      if (customers.length > 0) {
        // T-20260613-foot-CUSTLIST-MULTISELECT-EXPORT: 통계·생년월일 로드 공유 헬퍼로 추출(export와 동일 산식).
        const { statsMap: map, birthMap: bMap } = await loadCustomerStats(clinic.id, customers.map((c) => c.id));
        setStatsMap(map);
        setBirthMap(bMap);
      } else {
        setStatsMap(new Map());
        setBirthMap(new Map());
      }
    },
    [clinic, staffFilter],
  );

  useEffect(() => {
    if (!clinic) return;
    setPage(1);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(query, 1), 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, clinic, runSearch]);

  // T-20260613-foot-CUSTLIST-STAFF-FILTER: 담당자 옵션 로드.
  // 옵션소스 = staff role consultant/coordinator/director, active, 이름순 (assigned_staff_id 옵션소스와 동일 규약).
  useEffect(() => {
    if (!clinic) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('staff')
        .select('id, name')
        .eq('clinic_id', clinic.id)
        .eq('active', true)
        .in('role', ['consultant', 'coordinator', 'director'])
        .order('name', { ascending: true });
      if (cancelled || error) return;
      setStaffOptions((data ?? []) as { id: string; name: string }[]);
    })();
    return () => { cancelled = true; };
  }, [clinic]);

  // T-20260614-foot-CUSTOMER-STAFF-AUTOLINK (기능1): 담당자 컬럼용 전체 staff 이름 맵 로드.
  //   role/active 무관 전체 — 비활성·director 담당자도 이름 표시(raw UUID 노출 방지). display_name fallback name.
  useEffect(() => {
    if (!clinic) return;
    let cancelled = false;
    (async () => {
      // T-20260618-foot-STAFF-DISPLAYNAME-SELECT-400: staff.display_name 컬럼 DB 미존재(STAFF-NAME-UNIFY 타입만, 미마이그) →
      //   select 포함 시 PostgREST 400(42703) → data=null → 담당자명 무음 미표시. select는 name만, UI는 ||name fallback 유지.
      const { data, error } = await supabase
        .from('staff')
        .select('id, name')
        .eq('clinic_id', clinic.id);
      if (cancelled || error) return;
      const m = new Map<string, string>();
      for (const s of (data ?? []) as { id: string; name: string | null; display_name: string | null }[]) {
        m.set(s.id, (s.display_name || s.name || '').trim());
      }
      setStaffNameMap(m);
    })();
    return () => { cancelled = true; };
  }, [clinic]);

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    runSearch(query, newPage);
  };

  // 대시보드 고객차트 바로가기 → location.state.openCustomerId → 2번차트(미니홈피) 새 창
  // T-20260506-foot-CHART-CONSOLIDATE: CustomerDetailSheet 열기 → openChart로 교체
  useEffect(() => {
    if (navStateConsumed.current) return;
    if (!clinic) return;
    const state = location.state as { openCustomerId?: string } | null;
    if (!state?.openCustomerId) return;
    navStateConsumed.current = true;
    window.history.replaceState({}, '');
    openChart(state.openCustomerId);
  }, [clinic, location.state]);

  // T-20260510-foot-CUSTMGMT-CHART-PATTERN: 1번차트 패널 열기
  // T-20260511-foot-CUSTMGMT-DETAIL-SHEET: CheckInDetailSheet customerMode 사용 (stats 불필요)
  const handleRowClick = useCallback((c: Customer) => {
    setSelectedCustomer(c);
  }, []);

  // 우클릭 → 컨텍스트 메뉴
  const handleRowContextMenu = useCallback((e: React.MouseEvent, c: Customer) => {
    e.preventDefault();
    // T-20260613-foot-CUST-CONTEXTMENU-STALE: id만 보관 (스냅샷 캡처 X)
    setCtxMenu({ customerId: c.id, x: e.clientX, y: e.clientY });
  }, []);

  const deleteCustomer = async (c: Customer) => {
    if (!window.confirm(`${c.name}님을 삭제하시겠습니까?\n체크인·패키지 이력이 없을 때만 삭제됩니다.`)) return;
    const [{ count: ciCount }, { count: pkgCount }] = await Promise.all([
      supabase.from('check_ins').select('id', { count: 'exact', head: true }).eq('customer_id', c.id),
      supabase.from('packages').select('id', { count: 'exact', head: true }).eq('customer_id', c.id),
    ]);
    if ((ciCount ?? 0) > 0 || (pkgCount ?? 0) > 0) {
      toast.error(`삭제 불가: 체크인 ${ciCount ?? 0}건·패키지 ${pkgCount ?? 0}건이 연결되어 있습니다`);
      return;
    }
    const { error } = await supabase.from('customers').delete().eq('id', c.id);
    if (error) { toast.error(`삭제 실패: ${error.message}`); return; }
    toast.success(`${c.name}님 삭제됨`);
    runSearch(query, page);
  };

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const rangeFrom = totalCount === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeTo = Math.min(page * PAGE_SIZE, totalCount);

  // T-20260613-foot-CUST-CONTEXTMENU-STALE: 컨텍스트 메뉴 데이터는 항상 최신 results에서 라이브 조회.
  // 수정·저장 → runSearch 리페치 → 같은 행 우클릭 시 최신값 표시 (옛 스냅샷 캡처 제거).
  const ctxCustomer = ctxMenu ? results.find((c) => c.id === ctxMenu.customerId) ?? null : null;

  // ── T-20260613-foot-CUSTMGMT-LIST-5FIX AC4: 행 선택 + 리스트 다운로드 ──────────
  const allOnPageSelected = results.length > 0 && results.every((c) => selectedIds.has(c.id));
  const someOnPageSelected = results.some((c) => selectedIds.has(c.id));

  const toggleRow = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      const allSelected = results.length > 0 && results.every((c) => prev.has(c.id));
      if (allSelected) return new Set();
      return new Set(results.map((c) => c.id));
    });
  }, [results]);

  // T-20260613-foot-CUSTLIST-MULTISELECT-EXPORT: 한 고객 → CSV 1행 매핑.
  // PHI 가드: rrn(주민번호) 평문·뒷자리 절대 미포함(CSV 헤더에 부재). 생년월일은 서버 파생값(birthMap) 우선.
  const toCsvRow = useCallback(
    (c: Customer, stats: CustomerStats | undefined, bMap: Map<string, string>): CustomerCsvRow => ({
      이름: c.name ?? '',
      전화번호: formatPhone(c.phone) || (c.phone ?? ''),
      생년월일: bMap.get(c.id) ?? (birthDateYMD(c.birth_date) || ''),
      차트번호: c.chart_number ?? '',
      방문횟수: stats?.visit_count ?? 0,
      최종방문: stats?.last_visit ? format(new Date(stats.last_visit), 'yyyy-MM-dd') : '',
      결제액: stats?.total_revenue ?? 0,
      고객메모: c.customer_memo ?? '',
    }),
    [],
  );

  const handleExport = useCallback(async () => {
    // 권한 게이트(실행): admin/manager만. 버튼은 미노출이지만 호출 경로 이중 방어.
    if (!canExportCustomers) {
      toast.error('내보내기 권한이 없습니다 (관리자·매니저 전용)');
      return;
    }
    if (exporting || !clinic) return;

    // 선택 있음 → 선택된 행(현재 페이지)만. 선택 0건 → 현재 필터에 매칭되는 전체 고객.
    if (selectedIds.size > 0) {
      const targets = results.filter((c) => selectedIds.has(c.id));
      if (targets.length === 0) {
        toast.error('내보낼 고객이 없습니다');
        return;
      }
      const rows = targets.map((c) => toCsvRow(c, statsMap.get(c.id), birthMap));
      downloadCustomerCsv(rows, customerCsvFilename());
      toast.success(`${rows.length}명 내보내기 완료`);
      return;
    }

    // 선택 0건 → 필터된 전체 (페이지네이션 없이 재조회, 안전 상한 EXPORT_MAX).
    setExporting(true);
    try {
      let req = supabase
        .from('customers')
        .select('*')
        .eq('clinic_id', clinic.id)
        .not('is_simulation', 'is', true)
        .order('updated_at', { ascending: false })
        .range(0, EXPORT_MAX - 1);
      req = applyCustomerSearchFilters(req, staffFilter, query);
      const { data, error } = await req;
      if (error) {
        toast.error('내보내기 조회 실패');
        return;
      }
      const all = (data ?? []) as Customer[];
      if (all.length === 0) {
        toast.error('내보낼 고객이 없습니다');
        return;
      }
      const { statsMap: exStats, birthMap: exBirth } = await loadCustomerStats(
        clinic.id,
        all.map((c) => c.id),
      );
      const rows = all.map((c) => toCsvRow(c, exStats.get(c.id), exBirth));
      downloadCustomerCsv(rows, customerCsvFilename());
      const capped = all.length >= EXPORT_MAX;
      toast.success(`${rows.length}명 내보내기 완료${capped ? ` (상한 ${EXPORT_MAX}명)` : ''}`);
    } finally {
      setExporting(false);
    }
  }, [canExportCustomers, exporting, clinic, selectedIds, results, statsMap, birthMap, staffFilter, query, toCsvRow]);

  return (
    <div className="flex h-full flex-col p-6">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <div className="relative w-96">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="이름 · 전화번호(010…) · 생년월일(YYMMDD/YYYYMMDD) · 차트번호"
              className="pl-9"
            />
          </div>
          {/* T-20260613-foot-CUSTLIST-STAFF-FILTER: 담당자 드롭다운 (전체/미지정/직원). 검색어와 AND. */}
          <select
            data-testid="cust-staff-filter"
            aria-label="담당자 필터"
            value={staffFilter}
            onChange={(e) => setStaffFilter(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-teal-500"
          >
            <option value="">담당자 전체</option>
            <option value="__unassigned__">미지정</option>
            {staffOptions.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-3">
          {totalCount > 0 && (
            <span className="text-xs text-muted-foreground tabular-nums">
              전체 <span className="font-medium text-foreground">{totalCount}</span>명 중{' '}
              {rangeFrom}–{rangeTo}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* T-20260613-foot-CUSTLIST-MULTISELECT-EXPORT: 내보내기(CSV). admin/manager만 노출(PII 게이팅).
              선택 있으면 선택분, 0건이면 필터된 전체 export. */}
          {canExportCustomers && (
            <Button
              variant="outline"
              onClick={handleExport}
              disabled={results.length === 0 || exporting}
              className="gap-1"
              data-testid="cust-export-btn"
              title="선택 고객(미선택 시 현재 필터 전체)을 CSV로 내보내기"
            >
              <Download className="h-4 w-4" />
              {exporting ? '내보내는 중…' : `내보내기${selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}`}
            </Button>
          )}
          <Button onClick={() => setOpenCreate(true)} className="gap-1">
            <Plus className="h-4 w-4" /> 신규 고객
          </Button>
        </div>
      </div>

      {/* T-20260629-foot-CUSTLIST-MEMO-REMOVE-COMPACT:
          ① 고객메모 컬럼 제거(11열→10열). customer_memo 데이터·고객상세(EditCustomerDialog)·CSV는 존속 — 목록 표시만 숨김.
          ② 남은 10열 너비 컴팩트화 — 실제 글자수 기준 w-* 고정 + 패딩 축소(px-4→px-2),
             whitespace-nowrap/truncate로 넘침 방지(잔여 컬럼 강제 확장 차단). w-full 제거로 표 가로폭 축소. */}
      <div className="flex-1 overflow-auto rounded-lg border bg-background">
        <table className="text-sm">
          <thead className="bg-muted/60 text-xs text-muted-foreground">
            <tr>
              {/* T-20260613-foot-CUSTMGMT-LIST-5FIX AC4: 전체선택 체크박스 */}
              <th className="w-9 px-2 py-1.5 text-center font-medium">
                <input
                  type="checkbox"
                  data-testid="cust-select-all"
                  aria-label="전체 선택"
                  className="h-4 w-4 cursor-pointer accent-teal-600 align-middle"
                  checked={allOnPageSelected}
                  ref={(el) => { if (el) el.indeterminate = !allOnPageSelected && someOnPageSelected; }}
                  onChange={toggleSelectAll}
                />
              </th>
              <th className="w-[116px] px-2 py-1.5 text-left font-medium">이름</th>
              <th className="w-[116px] px-2 py-1.5 text-left font-medium">전화번호</th>
              <th className="w-[100px] px-2 py-1.5 text-left font-medium">생년월일</th>
              <th className="w-[96px] px-2 py-1.5 text-left font-medium">차트번호</th>
              {/* T-20260614-foot-CUSTOMER-STAFF-AUTOLINK (기능1): 담당자 컬럼 — 차트(차트2) assigned_staff 자동연동 표시 */}
              <th className="w-[80px] px-2 py-1.5 text-left font-medium">담당자</th>
              <th className="w-[52px] px-2 py-1.5 text-right font-medium">방문</th>
              <th className="w-[104px] px-2 py-1.5 text-left font-medium">최종 방문</th>
              <th className="w-[92px] px-2 py-1.5 text-right font-medium">결제액</th>
              <th className="w-[84px] px-2 py-1.5 text-center font-medium">관리</th>
            </tr>
          </thead>
          <tbody>
            {results.map((c) => {
              const stats = statsMap.get(c.id);
              return (
                <tr
                  key={c.id}
                  onClick={() => handleRowClick(c)}
                  onContextMenu={(e) => handleRowContextMenu(e, c)}
                  className="cursor-pointer border-t hover:bg-teal-50/40 h-11"
                >
                  {/* T-20260613-foot-CUSTMGMT-LIST-5FIX AC4: 행 선택 체크박스 (행 클릭/차트열기 동선과 분리) */}
                  {/* T-20260629-foot-CUSTLIST-MEMO-REMOVE-COMPACT: 패딩 축소(px-4→px-2) + 텍스트 nowrap·truncate(넘침 방지). */}
                  <td className="w-9 px-2 py-1.5 text-center" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      data-testid="cust-row-check"
                      aria-label={`${c.name} 선택`}
                      className="h-4 w-4 cursor-pointer accent-teal-600 align-middle"
                      checked={selectedIds.has(c.id)}
                      onChange={() => toggleRow(c.id)}
                    />
                  </td>
                  <td className="px-2 py-1.5 font-medium">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate">{c.name}</span>
                      {stats?.has_package && <Badge variant="teal" className="shrink-0 text-[10px] px-1 py-0">PKG</Badge>}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-muted-foreground whitespace-nowrap">{formatPhone(c.phone)}</td>
                  {/* T-20260613-foot-CUSTLIST-BIRTHDATE-FROM-RRN: 서버 파생 YYYY-MM-DD 우선,
                      없으면 birth_date 컬럼 휴리스틱 fallback, 그래도 없으면 '-' */}
                  <td className="px-2 py-1.5 text-muted-foreground tabular-nums whitespace-nowrap" data-testid="cust-birthdate">
                    {birthMap.get(c.id) ?? (birthDateYMD(c.birth_date) || '-')}
                  </td>
                  <td className="px-2 py-1.5 text-muted-foreground truncate" data-testid="cust-chart-number">{c.chart_number ?? '-'}</td>
                  {/* T-20260614-foot-CUSTOMER-STAFF-AUTOLINK (기능1): 담당자 — 차트2 assigned_staff_id → 이름.
                      재진=자동연동 표시 / 첫방문(NULL)·결손=공란('-') 안전표시(AC2/AC4). */}
                  <td className="px-2 py-1.5 text-muted-foreground truncate" data-testid="cust-assigned-staff">
                    {(c.assigned_staff_id && staffNameMap.get(c.assigned_staff_id)) || '-'}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{stats?.visit_count ?? 0}</td>
                  <td className="px-2 py-1.5 text-muted-foreground whitespace-nowrap tabular-nums">
                    {stats?.last_visit ? format(new Date(stats.last_visit), 'yyyy-MM-dd') : '-'}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground whitespace-nowrap">
                    {stats?.total_revenue ? formatAmount(stats.total_revenue) : '-'}
                  </td>
                  {/* T-20260629-foot-CUSTLIST-MEMO-REMOVE-COMPACT: 고객메모 셀 제거(목록 표시만). 데이터·상세화면 존속. */}
                  {/* 관리 열: 차트보기(모든 역할) + 수정(staff 이상) + 삭제(admin만) */}
                  <td className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-center gap-1">
                      <button
                        data-testid="open-chart-btn"
                        onClick={(e) => { e.stopPropagation(); openChart(c.id); }}
                        className="rounded p-1.5 hover:bg-teal-50 transition"
                      >
                        <ExternalLink className="h-3.5 w-3.5 text-teal-600" />
                      </button>
                      {/* T-20260520-foot-STAFF-CUSTOMER-UPDATE: 수정 버튼 staff/part_lead까지 노출 */}
                      {canEditCustomer && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setEditingCustomer(c); }}
                          className="rounded p-1.5 hover:bg-muted transition"
                          title="고객 정보 수정"
                        >
                          <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                        </button>
                      )}
                      {/* 삭제 버튼은 admin만 (canDeleteCustomer) */}
                      {canDeleteCustomer && (
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteCustomer(c); }}
                          className="rounded p-1.5 hover:bg-red-50 transition"
                          title="삭제"
                        >
                          <Trash2 className="h-3.5 w-3.5 text-red-400" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {!loading && results.length === 0 && (
              <tr>
                <td colSpan={10} className="px-2 py-10 text-center text-sm text-muted-foreground">
                  {query ? '검색 결과 없음' : '고객이 없습니다'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 페이지네이션 */}
      {totalPages > 1 && (
        <div className="mt-3 flex items-center justify-center gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handlePageChange(page - 1)}
            disabled={page === 1 || loading}
            className="h-8 px-3 text-xs"
          >
            이전
          </Button>
          {getPageNumbers(page, totalPages).map((p, idx) =>
            p === '…' ? (
              <span key={`ellipsis-${idx}`} className="px-1 text-xs text-muted-foreground select-none">
                …
              </span>
            ) : (
              <Button
                key={p}
                variant={p === page ? 'default' : 'outline'}
                size="sm"
                onClick={() => handlePageChange(p as number)}
                disabled={loading}
                className={`h-8 min-w-[32px] px-2 text-xs ${
                  p === page ? 'bg-teal-600 hover:bg-teal-700 border-teal-600' : ''
                }`}
              >
                {p}
              </Button>
            ),
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => handlePageChange(page + 1)}
            disabled={page === totalPages || loading}
            className="h-8 px-3 text-xs"
          >
            다음
          </Button>
        </div>
      )}

      {/* T-20260506-foot-CHART-CONSOLIDATE: CustomerDetailSheet 폐지 → 수정 전용 다이얼로그 */}
      {/* T-20260520-foot-STAFF-CUSTOMER-UPDATE: canEditSensitive — staff/part_lead는 민감 컬럼 readonly */}
      {/* T-20260620-foot-STAFF-PERM-UNLOCK-6MENU ⑥: 민감정보(여권번호 등) 수정 — therapist 포함 3역할 해제.
          기존(admin/manager/consultant/coordinator) → STAFF_UNLOCK_ROLES(+director/therapist). 회수 0(staff/part_lead는 본래 readonly 유지). */}
      <EditCustomerDialog
        customer={editingCustomer}
        onOpenChange={(o) => { if (!o) setEditingCustomer(null); }}
        onUpdated={() => {
          setEditingCustomer(null);
          runSearch(query, page);
        }}
        canEditSensitive={isStaffUnlockRole(profile?.role)}
      />

      <CreateCustomerDialog
        open={openCreate}
        clinicId={clinic?.id}
        onOpenChange={setOpenCreate}
        onCreated={() => {
          setOpenCreate(false);
          setPage(1);
          runSearch(query, 1);
        }}
      />

      {/* T-20260511-foot-CUSTMGMT-DETAIL-SHEET: 간편요약 → CheckInDetailSheet 전체 양식 교체 */}
      <CheckInDetailSheet
        checkIn={null}
        customerMode={
          selectedCustomer && clinic
            ? {
                customerId: selectedCustomer.id,
                customerName: selectedCustomer.name,
                customerPhone: selectedCustomer.phone,
                clinicId: clinic.id,
                chartNumber: selectedCustomer.chart_number,
              }
            : undefined
        }
        onClose={() => setSelectedCustomer(null)}
        onUpdated={() => runSearch(query, page)}
        onPayment={() => {}} // 고객관리에서는 결제 진입 불필요
      />

      {/* T-20260510-foot-CUSTMGMT-CHART-PATTERN: 우클릭 컨텍스트 메뉴 */}
      {/* T-20260515-foot-CONTEXT-MENU-4ITEM AC-4: 4항목으로 확장 */}
      {/* T-20260613-foot-CUST-CONTEXTMENU-STALE: ctxMenu.customer 스냅샷 → results 라이브 조회(ctxCustomer)로 교체.
          수정 후 행이 results에서 사라지면(재정렬·페이지 이탈) 메뉴 미표시(stale ghost 차단). */}
      {ctxMenu && ctxCustomer && (
        <CustomerContextMenu
          customer={ctxCustomer}
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          onOpenChart={(c) => { openChart(c.id); setCtxMenu(null); }}
          onOpenMedicalChart={(c) => {
            setMedicalChartCustomerId(c.id);
            setMedicalChartOpen(true);
            setCtxMenu(null);
          }}
          onEdit={(c) => { setEditingCustomer(c); setCtxMenu(null); }}
          canEditCustomer={canEditCustomer}
          /* T-20260614-foot-CUSTLIST-CTXMENU-PARITY: [문자] — manual_sms_send 권한 시만 전달(미충족 → 항목 미노출).
             발송은 SendSmsDialog 기존 경로(optout·발신번호 화이트리스트 차단 포함) 그대로 재사용. */
          onSendSms={canSendSms ? (c) => { setSmsTarget(customerAsCheckIn(c)); setCtxMenu(null); } : undefined}
        />
      )}

      {/* T-20260614-foot-CUSTLIST-CTXMENU-PARITY: 수동 1:1 문자 발송 모달 — 대시보드/예약관리와 동일 컴포넌트·경로 */}
      <SendSmsDialog
        open={smsTarget !== null}
        onOpenChange={(v) => { if (!v) setSmsTarget(null); }}
        checkIn={smsTarget}
        clinicId={clinic?.id ?? ''}
      />

      {/* T-20260516-foot-CHART2-STATE-UNIFY: CustomerChartSheet 렌더 AdminLayout 단일화로 이동 */}

      {/* T-20260515-foot-CONTEXT-MENU-4ITEM AC-4: 진료차트 패널 (고객관리 진입) */}
      <MedicalChartPanel
        open={medicalChartOpen}
        onOpenChange={(v) => { if (!v) { setMedicalChartOpen(false); setMedicalChartCustomerId(null); } }}
        customerId={medicalChartCustomerId}
        clinicId={clinic?.id ?? ''}
        currentUserRole={profile?.role ?? ''}
        currentUserEmail={profile?.email ?? null}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EditCustomerDialog — 고객 정보 수정 전용 다이얼로그 (차트 섹션 없음)
// T-20260506-foot-CHART-CONSOLIDATE: CustomerDetailSheet 차트 UI 완전 폐지
// ─────────────────────────────────────────────────────────────────────────────
// T-20260508-foot-CUST-FORM-REVAMP: 고객등급 옵션
const CUSTOMER_GRADE_OPTIONS = ['일반', '1단계', '2단계', '3단계'] as const;

function EditCustomerDialog({
  customer,
  onOpenChange,
  onUpdated,
  canEditSensitive = true,
}: {
  customer: Customer | null;
  onOpenChange: (o: boolean) => void;
  onUpdated: () => void;
  /** admin/manager/consultant/coordinator만 true. staff/part_lead는 false → 민감 컬럼 readonly */
  canEditSensitive?: boolean;
}) {
  const [name, setName] = useState('');
  // phone: 읽기전용 표시 (T-20260508-foot-CUST-FORM-REVAMP: 전화번호 기입칸 삭제)
  const [phone, setPhone] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [chartNumber, setChartNumber] = useState('');
  const [memo, setMemo] = useState('');
  const [customerMemo, setCustomerMemo] = useState('');
  const [leadSource, setLeadSource] = useState('');
  const [tmMemo, setTmMemo] = useState('');
  const [referrerName, setReferrerName] = useState('');
  // T-20260508-foot-CUST-FORM-REVAMP: 신규 필드
  const [customerGrade, setCustomerGrade] = useState<string>('일반');
  const [customerEmail, setCustomerEmail] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // T-20260625-foot-PASSPORT-PORT: 외국인 정보 (여권번호 포함 — passportNumber는 foreignInfo로 통합)
  const [foreignInfo, setForeignInfo] = useState<ForeignInfoValue>({
    nationalityId: '', language: '', passportLastName: '', passportFirstName: '',
    passportNumber: '', foreignerRegNumber: '', docExpiry: '',
  });

  useEffect(() => {
    if (customer) {
      setName(customer.name);
      setPhone(customer.phone);
      setBirthDate(customer.birth_date ?? '');
      setChartNumber(customer.chart_number ?? '');
      setMemo(customer.memo ?? '');
      setCustomerMemo(customer.customer_memo ?? '');
      setLeadSource(customer.lead_source ?? '');
      setTmMemo(customer.tm_memo ?? '');
      setReferrerName(customer.referrer_name ?? '');
      setCustomerGrade(customer.customer_grade ?? '일반');
      setCustomerEmail(customer.customer_email ?? '');
      setPostalCode(customer.postal_code ?? '');
      setForeignInfo({
        nationalityId: customer.nationality_id != null ? String(customer.nationality_id) : '',
        language: customer.language ?? '',
        passportLastName: customer.passport_last_name ?? '',
        passportFirstName: customer.passport_first_name ?? '',
        passportNumber: customer.passport_number ?? '',
        foreignerRegNumber: customer.foreigner_registration_number ?? '',
        docExpiry: customer.foreign_doc_expiry ?? '',
      });
    }
  }, [customer]);

  const save = async () => {
    if (!customer) return;
    setSubmitting(true);
    const newName = name.trim();
    // 고객명 변경 시 reservations/check_ins.customer_name 스냅샷 카스케이드는
    // DB 트리거(T-20260603-foot-DASH-NAME-STALE-SYNC, 옵션A, AFTER UPDATE OF name
    // ON customers)가 SSOT로 담당. 앱레벨 중복 카스케이드는 이중 쓰기·false-error
    // 토스트 유발로 제거됨(T-20260603-foot-CUSTNAME-CASCADE-DASH CANCELLATION).
    const { error } = await supabase
      .from('customers')
      .update({
        name: newName,
        // phone 유지 (읽기전용 표시이지만 기존값 보존)
        birth_date: birthDate.trim() || null,
        // chart_number: 자동 부여 후 변경 불가 (T-20260505-foot-CHART-NUMBER-AUTO)
        memo: memo.trim() || null,
        customer_memo: customerMemo.trim() || null, // T-20260504-foot-MEMO-RESTRUCTURE
        lead_source: leadSource.trim() || null,
        tm_memo: tmMemo.trim() || null,
        referrer_name: referrerName.trim() || null,
        // T-20260508-foot-CUST-FORM-REVAMP
        customer_grade: customerGrade || '일반',
        customer_email: customerEmail.trim() || null,
        postal_code: postalCode.trim() || null,
        // T-20260625-foot-PASSPORT-PORT: 외국인 정보. is_foreign는 다운그레이드 금지(기존값 OR 신규 입력).
        passport_number: foreignInfo.passportNumber.trim() || null,
        passport_last_name: foreignInfo.passportLastName.trim() || null,
        passport_first_name: foreignInfo.passportFirstName.trim() || null,
        nationality_id: foreignInfo.nationalityId ? Number(foreignInfo.nationalityId) : null,
        // T-20260625-foot-FOREIGN-LANG-SAVE: 환자 선호 언어(BCP-47 코드) 저장
        language: foreignInfo.language.trim() || null,
        foreigner_registration_number: foreignInfo.foreignerRegNumber.trim() || null,
        foreign_doc_expiry: foreignInfo.docExpiry.trim() || null,
        is_foreign: customer.is_foreign || !!(
          foreignInfo.nationalityId || foreignInfo.passportNumber.trim() ||
          foreignInfo.passportLastName.trim() || foreignInfo.passportFirstName.trim() ||
          foreignInfo.foreignerRegNumber.trim() || foreignInfo.docExpiry.trim()
        ),
      })
      .eq('id', customer.id);
    if (error) {
      setSubmitting(false);
      toast.error(`수정 실패: ${error.message}`);
      return;
    }
    setSubmitting(false);
    toast.success('수정 완료');
    onUpdated();
  };

  return (
    <Dialog open={!!customer} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>고객 정보 수정 — {customer?.name}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[65vh] overflow-y-auto space-y-3 pr-1">
          {/* 이름 */}
          <div className="space-y-1.5">
            <Label>이름</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          {/* 전화번호 — 읽기전용 표시 (T-20260508-foot-CUST-FORM-REVAMP: 기입칸 삭제) */}
          <div className="space-y-1.5">
            <Label>전화번호 <span className="text-xs text-muted-foreground font-normal">(변경 불가)</span></Label>
            <div className="flex h-9 items-center rounded-md border border-input bg-muted px-3 text-sm text-muted-foreground select-all">
              {formatPhone(phone) || '—'}
            </div>
          </div>
          {/* 생년월일 / 차트번호 */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label>생년월일 <span className="text-xs text-muted-foreground font-normal">(YYMMDD)</span></Label>
              <Input
                value={birthDate}
                onChange={(e) => setBirthDate(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                placeholder="예: 900515"
                maxLength={6}
              />
              {/* T-20260630-foot-CRM-BIRTHDATE-RRN-GLOBAL [C2]: YYMMDD 입력 시 세기판별 YYYY-MM-DD 미리보기(표기 전용).
                  ⚠ DA canon §2: 저장값은 YYMMDD 유지 — 표시포맷 역기록 금지(selfcheckin 병합키 보호). */}
              {birthDateYMD(birthDate) && (
                <p className="text-xs text-teal-600 tabular-nums" data-testid="custform-birth-preview">{birthDateYMD(birthDate)}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>차트번호</Label>
              <div className="flex h-9 items-center rounded-md border border-input bg-muted px-3 text-sm text-muted-foreground select-all">
                {chartNumber || '—'}
              </div>
              <p className="text-[10px] text-muted-foreground">자동 부여됨 (변경 불가)</p>
            </div>
          </div>
          {/* 고객등급 — T-20260508-foot-CUST-FORM-REVAMP */}
          <div className="space-y-1.5">
            <Label>고객등급</Label>
            <div className="flex gap-1.5 flex-wrap">
              {CUSTOMER_GRADE_OPTIONS.map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setCustomerGrade(g)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition border ${
                    customerGrade === g
                      ? g === '일반'
                        ? 'bg-teal-600 text-white border-teal-600'
                        : g === '1단계'
                        ? 'bg-yellow-500 text-white border-yellow-500'
                        : g === '2단계'
                        ? 'bg-orange-500 text-white border-orange-500'
                        : 'bg-red-600 text-white border-red-600'
                      : 'bg-muted text-muted-foreground border-transparent hover:bg-muted/80'
                  }`}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>
          {/* 이메일 — T-20260508-foot-CUST-FORM-REVAMP */}
          <div className="space-y-1.5">
            <Label>이메일</Label>
            <Input
              type="email"
              value={customerEmail}
              onChange={(e) => setCustomerEmail(e.target.value)}
              placeholder="example@email.com"
            />
          </div>
          {/* 외국인 정보(국적/여권 영문명/여권번호/외국인등록번호/만료일) — T-20260625-foot-PASSPORT-PORT */}
          {/* T-20260520-foot-STAFF-CUSTOMER-UPDATE: staff/part_lead는 민감정보(여권번호·외국인등록번호) 열람 전용 */}
          <ForeignInfoSection
            value={foreignInfo}
            onChange={(next) => setForeignInfo((prev) => ({ ...prev, ...next }))}
            canEdit={canEditSensitive}
          />
          {/* 우편번호 — T-20260508-foot-CUST-FORM-REVAMP */}
          <div className="space-y-1.5">
            <Label>우편번호</Label>
            <Input
              value={postalCode}
              onChange={(e) => setPostalCode(e.target.value.replace(/\D/g, '').slice(0, 5))}
              inputMode="numeric"
              placeholder="12345"
              maxLength={5}
              className="font-mono"
            />
          </div>
          {/* 내원경로 */}
          <div className="space-y-1.5">
            <Label>내원경로</Label>
            <div className="flex flex-wrap gap-1.5">
              {LEAD_SOURCE_OPTIONS.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setLeadSource(leadSource === opt ? '' : opt)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                    leadSource === opt
                      ? 'bg-teal-600 text-white'
                      : 'bg-muted text-muted-foreground hover:bg-muted/80'
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>
          {/* 추천인 */}
          <div className="space-y-1.5">
            <Label>추천인</Label>
            <Input value={referrerName} onChange={(e) => setReferrerName(e.target.value)} placeholder="추천인 이름" />
          </div>
          {/* 고객메모 */}
          <div className="space-y-1.5">
            <Label>고객메모 <span className="text-xs text-muted-foreground font-normal">(성향·주차)</span></Label>
            <Textarea
              value={customerMemo}
              onChange={(e) => setCustomerMemo(e.target.value)}
              rows={2}
              placeholder="고객 성향, 특이사항, 주차 정보 등"
            />
          </div>
          {/* 상담메모 */}
          <div className="space-y-1.5">
            <Label>상담메모</Label>
            <Textarea
              value={tmMemo}
              onChange={(e) => setTmMemo(e.target.value)}
              rows={2}
              placeholder="실비 보험사, 상한액, 고객 성향 등..."
            />
          </div>
          {/* 내부메모 */}
          <div className="space-y-1.5">
            <Label>내부메모</Label>
            <Textarea value={memo} onChange={(e) => setMemo(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button disabled={submitting || !name.trim()} onClick={save}>
            {submitting ? '저장 중…' : '저장'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CreateCustomerDialog — 신규 고객 등록
// ─────────────────────────────────────────────────────────────────────────────
function CreateCustomerDialog({
  open,
  clinicId,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  clinicId: string | undefined;
  onOpenChange: (o: boolean) => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [birthDate, setBirthDate] = useState('');
  // chart_number: DB 트리거 자동생성 (T-20260505-foot-CHART-NUMBER-AUTO)
  const [memo, setMemo] = useState('');
  const [referrerName, setReferrerName] = useState('');
  // 추천인 자동완성 — 기존 고객 검색
  const [referrerQuery, setReferrerQuery] = useState('');
  const [referrerSuggestions, setReferrerSuggestions] = useState<{ id: string; name: string; phone: string }[]>([]);
  const [referrerId, setReferrerId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // 인라인 자동검색으로 선택된 기존 고객 (중복 등록 방지)
  const [selectedExistingId, setSelectedExistingId] = useState<string | null>(null);
  // T-20260625-foot-PASSPORT-PORT: 외국인 정보(국적/여권 영문명/여권번호/외국인등록번호/만료일)
  const [foreignInfo, setForeignInfo] = useState<ForeignInfoValue>({
    nationalityId: '', language: '', passportLastName: '', passportFirstName: '',
    passportNumber: '', foreignerRegNumber: '', docExpiry: '',
  });

  useEffect(() => {
    if (open) {
      setName('');
      setPhone('');
      setBirthDate('');
      setMemo('');
      setReferrerName('');
      setReferrerQuery('');
      setReferrerSuggestions([]);
      setReferrerId(null);
      setSelectedExistingId(null);
      setForeignInfo({
        nationalityId: '', language: '', passportLastName: '', passportFirstName: '',
        passportNumber: '', foreignerRegNumber: '', docExpiry: '',
      });
    }
  }, [open]);

  // 기존 고객 선택 시 폼 자동 채움
  const handleExistingSelect = useCallback((p: PatientMatch) => {
    setName(p.name);
    setPhone(p.phone);
    if (p.birth_date) setBirthDate(p.birth_date);
    setSelectedExistingId(p.id);
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedExistingId(null);
  }, []);

  // 추천인 검색 — 300ms 디바운스
  useEffect(() => {
    if (!clinicId || referrerQuery.trim().length < 1) {
      setReferrerSuggestions([]);
      return;
    }
    const timer = setTimeout(async () => {
      const { data } = await supabase
        .from('customers')
        .select('id, name, phone')
        .eq('clinic_id', clinicId)
        .ilike('name', `%${referrerQuery.trim()}%`)
        .limit(5);
      setReferrerSuggestions((data ?? []) as { id: string; name: string; phone: string }[]);
    }, 300);
    return () => clearTimeout(timer);
  }, [referrerQuery, clinicId]);

  const save = async () => {
    if (!clinicId) return;
    // 기존 고객 선택 상태에서는 신규 등록 차단 (중복 등록 방지)
    if (selectedExistingId) {
      toast.info('이미 등록된 고객입니다. 목록에서 해당 고객을 선택해 주세요.');
      onCreated();
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.from('customers').insert({
      clinic_id: clinicId,
      name: name.trim(),
      phone: normalizeToE164(phone) ?? phone.trim(),
      birth_date: birthDate.trim() || null,
      // chart_number: DB BEFORE INSERT 트리거가 자동 채번 (F-XXXX 형식)
      memo: memo.trim() || null,
      referrer_id: referrerId || null,
      referrer_name: !referrerId && referrerName.trim() ? referrerName.trim() : null,
      // T-20260625-foot-PASSPORT-PORT: 외국인 정보. 하나라도 입력 시 is_foreign 자동 true.
      passport_number: foreignInfo.passportNumber.trim() || null,
      passport_last_name: foreignInfo.passportLastName.trim() || null,
      passport_first_name: foreignInfo.passportFirstName.trim() || null,
      nationality_id: foreignInfo.nationalityId ? Number(foreignInfo.nationalityId) : null,
      // T-20260625-foot-FOREIGN-LANG-SAVE: 환자 선호 언어(BCP-47 코드) 저장
      language: foreignInfo.language.trim() || null,
      foreigner_registration_number: foreignInfo.foreignerRegNumber.trim() || null,
      foreign_doc_expiry: foreignInfo.docExpiry.trim() || null,
      is_foreign: !!(
        foreignInfo.nationalityId || foreignInfo.passportNumber.trim() ||
        foreignInfo.passportLastName.trim() || foreignInfo.passportFirstName.trim() ||
        foreignInfo.foreignerRegNumber.trim() || foreignInfo.docExpiry.trim()
      ),
    });
    setSubmitting(false);
    if (error) {
      toast.error(error.code === '23505' ? '이미 등록된 전화번호입니다' : `등록 실패: ${error.message}`);
      return;
    }
    toast.success('고객 등록 완료');
    onCreated();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>신규 고객 등록</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>이름</Label>
            <InlinePatientSearch
              value={name}
              onChange={(v) => {
                setName(v);
                if (selectedExistingId) setSelectedExistingId(null);
              }}
              onSelect={handleExistingSelect}
              onClearSelection={clearSelection}
              searchField="name"
              clinicId={clinicId}
              selectedCustomerId={selectedExistingId}
              autoFocus
              placeholder="이름 (2글자 이상 입력 시 기존 고객 자동 검색)"
            />
          </div>
          <div className="space-y-1.5">
            <Label>전화번호</Label>
            <InlinePatientSearch
              value={phone}
              onChange={(v) => {
                setPhone(v);
                if (selectedExistingId) setSelectedExistingId(null);
              }}
              onSelect={handleExistingSelect}
              onClearSelection={clearSelection}
              searchField="phone"
              clinicId={clinicId}
              selectedCustomerId={selectedExistingId}
              inputMode="tel"
              placeholder="전화번호 (4자리 이상 입력 시 자동 검색)"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label>생년월일 <span className="text-xs text-muted-foreground font-normal">(YYMMDD)</span></Label>
              <Input
                value={birthDate}
                onChange={(e) => setBirthDate(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                placeholder="예: 900515"
                maxLength={6}
              />
              {/* T-20260630-foot-CRM-BIRTHDATE-RRN-GLOBAL [C2]: YYMMDD 입력 시 세기판별 YYYY-MM-DD 미리보기(표기 전용).
                  ⚠ DA canon §2: 저장값은 YYMMDD 유지 — 표시포맷 역기록 금지(selfcheckin 병합키 보호). */}
              {birthDateYMD(birthDate) && (
                <p className="text-xs text-teal-600 tabular-nums" data-testid="custform-birth-preview">{birthDateYMD(birthDate)}</p>
              )}
            </div>
            {/* 차트번호: DB 트리거 자동생성 — 등록 후 F-XXXX 자동 부여 */}
          </div>
          {/* 외국인 정보 — T-20260625-foot-PASSPORT-PORT */}
          <ForeignInfoSection
            value={foreignInfo}
            onChange={(next) => setForeignInfo((prev) => ({ ...prev, ...next }))}
          />
          <div className="space-y-1.5">
            <Label>메모</Label>
            <Textarea value={memo} onChange={(e) => setMemo(e.target.value)} rows={3} />
          </div>
          {/* 추천인 */}
          <div className="space-y-1.5">
            <Label>추천인 <span className="text-xs text-muted-foreground font-normal">(선택)</span></Label>
            {referrerId ? (
              <div className="flex items-center gap-2 rounded-md border bg-teal-50 px-3 py-2 text-sm">
                <span className="flex-1 font-medium text-teal-800">
                  {referrerSuggestions.find((s) => s.id === referrerId)?.name ?? referrerName}
                </span>
                <button
                  type="button"
                  onClick={() => { setReferrerId(null); setReferrerName(''); setReferrerQuery(''); }}
                  className="text-xs text-muted-foreground hover:text-destructive"
                >
                  ✕
                </button>
              </div>
            ) : (
              <div className="relative">
                <Input
                  placeholder="추천인 이름 검색 또는 직접 입력"
                  value={referrerQuery || referrerName}
                  onChange={(e) => {
                    setReferrerQuery(e.target.value);
                    setReferrerName(e.target.value);
                    setReferrerId(null);
                  }}
                />
                {referrerSuggestions.length > 0 && (
                  <ul className="absolute z-50 mt-1 w-full rounded-md border bg-white shadow-md text-sm">
                    {referrerSuggestions.map((s) => (
                      <li
                        key={s.id}
                        className="cursor-pointer px-3 py-2 hover:bg-teal-50"
                        onMouseDown={() => {
                          setReferrerId(s.id);
                          setReferrerName(s.name);
                          setReferrerQuery('');
                          setReferrerSuggestions([]);
                        }}
                      >
                        <span className="font-medium">{s.name}</span>
                        <span className="ml-2 text-muted-foreground">{formatPhone(s.phone)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button disabled={submitting || !name.trim() || !phone.trim()} onClick={save}>
            등록
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── T-20260510-foot-CUSTMGMT-CHART-PATTERN: 우클릭 컨텍스트 메뉴 ─────────────
// T-20260515-foot-CONTEXT-MENU-4ITEM AC-4: 4항목으로 확장
// 순서: 고객차트 → 진료차트 → 예약하기(예약관리 전환+자동채움) → 수납(안내 토스트) → 정보수정

interface CustomerContextMenuProps {
  customer: Customer;
  x: number;
  y: number;
  onClose: () => void;
  onOpenChart: (c: Customer) => void;
  onOpenMedicalChart: (c: Customer) => void;
  onEdit: (c: Customer) => void;
  canEditCustomer: boolean;
  /** T-20260614-foot-CUSTLIST-CTXMENU-PARITY: 문자 발송 콜백 — 제공 시(manual_sms_send 권한)만 메뉴 항목 표시 */
  onSendSms?: (c: Customer) => void;
}

function CustomerContextMenu({ customer, x, y, onClose, onOpenChart, onOpenMedicalChart, onEdit, canEditCustomer, onSendSms }: CustomerContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  const safeX = Math.min(x, window.innerWidth - 190);
  // T-20260614-foot-CUSTLIST-CTXMENU-PARITY: [문자] 항목(+44px) 노출 시 하단 경계 여유 확보
  const safeY = Math.min(y, window.innerHeight - (200 + (onSendSms ? 44 : 0)));

  return (
    <div
      ref={ref}
      className="fixed z-[60] min-w-[170px] rounded-lg border bg-white shadow-xl py-1 select-none"
      style={{ top: safeY, left: safeX }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="px-3 py-1.5 text-xs font-semibold text-teal-700 border-b truncate">
        {customer.name}
      </div>

      {/* 1. 고객차트 */}
      <button
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-sm hover:bg-teal-50 transition text-left"
        onClick={() => onOpenChart(customer)}
      >
        <BookOpen className="h-4 w-4 text-teal-600 shrink-0" />
        고객차트
      </button>

      {/* 2. 진료차트 — T-20260515-foot-CONTEXT-MENU-4ITEM AC-2 */}
      <button
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-sm hover:bg-teal-50 transition text-left"
        onClick={() => { onOpenMedicalChart(customer); onClose(); }}
      >
        <Stethoscope className="h-4 w-4 text-teal-600 shrink-0" />
        진료차트
      </button>

      {/* 3. 예약하기 — T-20260516-foot-RESV-ROUTE-FIX: navigate + 고객 자동채움 */}
      <button
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-sm hover:bg-teal-50 transition text-left"
        onClick={() => {
          onClose();
          // LOGIC-LOCK: L-002 — 변경 시 현장 승인 필수
          navigate('/admin/reservations', {
            state: {
              openReservationFor: {
                customer_id: customer.id,
                name: customer.name,
                phone: customer.phone ?? '',
                visit_type: customer.visit_type,
              },
            },
          });
        }}
      >
        <CalendarPlus className="h-4 w-4 text-teal-600 shrink-0" />
        예약하기
      </button>

      {/* 4. 수납 — T-20260515-foot-CONTEXT-MENU-4ITEM AC-3 (고객관리: 대시보드 안내) */}
      <button
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-sm hover:bg-teal-50 transition text-left"
        onClick={() => {
          toast('대시보드에서 해당 환자 체크인 후 수납해주세요');
          onClose();
        }}
      >
        <CreditCard className="h-4 w-4 text-teal-600 shrink-0" />
        수납
      </button>

      {/* 5. 문자 — T-20260614-foot-CUSTLIST-CTXMENU-PARITY: CustomerQuickMenu와 동일 항목 미러링.
          manual_sms_send 권한(onSendSms 제공) 시만 노출. 발송 로직은 SendSmsDialog 기존 경로 재사용. */}
      {onSendSms && (
        <button
          data-testid="cust-ctxmenu-sms-btn"
          className="flex w-full items-center gap-2.5 px-3 py-2.5 text-sm hover:bg-teal-50 transition text-left"
          onClick={() => onSendSms(customer)}
        >
          <MessageSquare className="h-4 w-4 text-teal-600 shrink-0" />
          문자
        </button>
      )}

      {/* 정보 수정 (T-20260520-foot-STAFF-CUSTOMER-UPDATE: staff/part_lead까지 허용) */}
      {canEditCustomer && (
        <>
          <div className="border-t my-1" />
          <button
            className="flex w-full items-center gap-2.5 px-3 py-2.5 text-sm hover:bg-muted/50 transition text-left"
            onClick={() => onEdit(customer)}
          >
            <Pencil className="h-4 w-4 text-muted-foreground shrink-0" />
            정보 수정
          </button>
        </>
      )}
    </div>
  );
}
