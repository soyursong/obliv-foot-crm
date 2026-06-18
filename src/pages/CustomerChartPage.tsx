// LOGIC-LOCK: L-003 — 차트 수정사항 CRM 전체 고객 동일 적용. 변경 시 현장 승인 필수
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { addDays, format, parseISO } from 'date-fns';
import { ko } from 'date-fns/locale';
import { CalendarPlus, Camera, Check, ChevronDown, ChevronLeft, ChevronRight, Columns2, Download, ExternalLink, FileText, Loader2, Lock, MessageSquare, Minus, Package as PackageIcon, Pencil, Plus, Printer, RotateCcw, RotateCw, Send, Stethoscope, Timer, Trash2, Upload, X } from 'lucide-react';
// T-20260513-foot-C21-TAB-RESTRUCTURE-C: 펜차트 탭 컴포넌트
import { PenChartTab } from '@/components/PenChartTab';
// T-20260615-foot-PKGTAB-TOE-RESTORE: 패키지 탭 상단 치료부위(발가락) 일러스트 원상 복원(김주연 총괄). 3b6ab2f 제거분 역복원.
import FootToeIllustration from '@/components/FootToeIllustration';
import { parseFootSites, type FootSite } from '@/components/FootSiteSelector';
// T-20260615-foot-KOHTEST-LIFECYCLE-PUBLISH (AC-1): 패키지 탭 치료부위 우측 상단 KOH ON/OFF 토글
import KohRequestToggle from '@/components/KohRequestToggle';
import BloodTestRequestToggle from '@/components/BloodTestRequestToggle';
// T-20260615-foot-KOHTEST-LIFECYCLE-PUBLISH (AC-4): 검사결과 탭 발행된 균검사 결과지 목록
import KohPublishedResults from '@/components/KohPublishedResults';
// T-20260602-foot-CHART2-HEALTHQ-VIEWER: 자가작성 발건강질문지(health_q_results) 상담내역 [내용보기] 렌더
import { ResultCard, type HQResult } from '@/components/HealthQResultsPanel';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
// T-20260618-foot-STAFF-CHART2-RRN-NOSAVE (Option B): 주민번호 값 조회 권한 게이트(FE 안내문 전용)
import { canViewRrn } from '@/lib/permissions';
import { formatAmount, formatPhone, formatPhoneInput, parseAmount, seoulISODate, todaySeoulISODate, chartNoBadge, chartNoDisplay } from '@/lib/format';
// T-20260524-foot-PKG-LABEL-AMOUNT AC-3: METHOD_KO 추가 import
import { VISIT_TYPE_KO, METHOD_KO, STATUS_KO, staffRoleSortIndex } from '@/lib/status';
import { cn } from '@/lib/utils';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AmountInput } from '@/components/ui/AmountInput';
import { toast } from '@/lib/toast';
import type { CheckIn, Customer, Package, PackageRemaining, PackageTemplate, PrescriptionRow, Reservation, VisitType } from '@/lib/types';
// T-20260506-foot-CHECKLIST-AUTOUPLOAD: 업로드된 양식 조회
import { DocumentViewer } from '@/components/forms/DocumentViewer';
// T-20260510-foot-C2-DOC-ISSUANCE: 서류발행 패널
import { DocumentPrintPanel } from '@/components/DocumentPrintPanel';
// T-20260507-foot-CHART2-INSURANCE-FIELDS: 건보 자격등급 패널
import { InsuranceGradeSelect } from '@/components/insurance/InsuranceGradeSelect';
// T-20260511-foot-C2-INSURANCE-AUTO-CALC: 2번차트 진료비 자동산정 패널
import { Chart2InsuranceCalcPanel } from '@/components/insurance/Chart2InsuranceCalcPanel';
// T-20260520-foot-SET-LOAD-REMOVE: TreatmentSetLoadButton 2구역 상단에서 제거
// T-20260508-foot-C22-RESV-EDIT: CRM 시간대 연동
import { useClinic } from '@/hooks/useClinic';
import { closeTimeFor, generateSlots, openTimeFor } from '@/lib/schedule';
import { isSinglePaymentByCount, netPaidFromPayments, computeOutstanding, balanceStatus, balanceStatusLabel } from '@/lib/footBilling';
// T-20260514-foot-CHART2-OPEN-BUG: Sheet 모드 닫기 (window.close 대체)
import { useChartSheetClose, useRegisterChartSave, useChartSheetMarkClean } from '@/lib/chartSheetContext';
// T-20260514-foot-C2-PAYMENT-SYNC AC-3: 수납 이력 패널
import { PaymentAuditLogsPanel } from '@/components/PaymentEditDialog';
// T-20260515-foot-KENBO-API-NATIVE: 건보공단 수진자 자격조회 Native 패널
import { NhisLookupPanel } from '@/components/insurance/NhisLookupPanel';
// T-20260515-foot-DOC-REISSUE-BTN: 서류 발급 이력 표시용 메타
import { FORM_META } from '@/lib/formTemplates';
// T-20260515-foot-RESV-MEMO-APPEND: 예약메모 누적 삽입 헬퍼
import { ReservationMemoTimeline, insertReservationMemo, insertAltPinnedMemo } from '@/components/ReservationMemoTimeline';
// T-20260522-foot-RESV-HISTORY-SYNC AC-3: 예약 변경 이력 패널
import { ReservationAuditLogPanel } from '@/components/ReservationAuditLogPanel';
// T-20260517-foot-C2-CONSULT-DOCS: 동의서 [작성] 다이얼로그
import { ConsentFormDialog, type FormType } from '@/components/ConsentFormDialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
// T-20260517-foot-C2-CONSULT-DOCS AC-R1: 합본 양식 (개인정보+체크리스트 / 환불+비급여)
import { ChecklistForm } from '@/components/forms/ChecklistForm';
import { ConsentForm } from '@/components/forms/ConsentForm';
// T-20260527-foot-MEDCHART-TAB-REAPPEAR: 고객차트 내 진료차트 탭 버튼 — MedicalChartPanel 직접 열기
import MedicalChartPanel from '@/components/MedicalChartPanel';

type PackageWithRemaining = Package & { remaining: PackageRemaining | null };

// T-20260513-foot-C21-TAB-RESTRUCTURE-C: 문자 이력
interface MessageLog {
  id: string;
  customer_id: string;
  clinic_id: string;
  sent_at: string;
  content: string;
  status: 'sent' | 'failed' | 'pending';
  message_type: 'sms' | 'kakao' | 'manual';
  sent_by_name: string | null;
  memo: string | null;
  created_at: string;
}

// T-20260525-foot-MESSAGING-V1 AC-3: 자동 SMS 발송 이력 (notification_logs)
interface NotificationLog {
  id: string;
  event_type: string;
  channel: string;
  status: 'sent' | 'failed' | 'opt_out' | 'skipped' | 'pending' | 'cancelled';
  body_rendered: string | null;
  sent_at: string | null;
  created_at: string;
  error_message: string | null;
}

interface Payment {
  id: string;
  check_in_id: string | null;
  amount: number;
  method: string;
  installment: number;
  payment_type: 'payment' | 'refund';
  memo: string | null;
  created_at: string;
  // T-20260515-foot-RECEIPT-TAX-SPLIT AC-6: 현금영수증 필드 (DB 마이그레이션 전 null)
  cash_receipt_issued?: boolean | null;
  cash_receipt_type?: 'income_deduction' | 'expense_proof' | null;
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
  // T-20260616-foot-PKG-OUTSTANDING-BALANCE: 결제 귀속(package/consultation). 잔금 산출 시 분리.
  fee_kind?: string | null;
}

// T-20260520-foot-MEMO-HISTORY: 치료메모 히스토리 항목
interface TreatmentMemoEntry {
  id: string;
  content: string;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
}

// T-20260523-foot-LASER-TIMER (위치이동 FIX-20260525): 2번차트 3구역 상세 탭 상단 타이머
interface TimerRecord {
  id: string;
  check_in_id: string;
  duration_minutes: number;
  started_at: string;
  ends_at: string;
  stopped_at: string | null;
}

// T-20260616-foot-LASER-TIMER-SETTING-CONNECT: 비가열 레이저 타이머 시작 버튼 폴백.
// 클리닉 설정(clinics.laser_time_units)이 비었거나 null일 때만 사용 — 버튼이 사라지지 않도록 보장.
const LASER_TIMER_FALLBACK_UNITS = [5, 15, 20];

function formatTimerRemaining(secs: number): string {
  if (secs <= 0) return '00:00';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
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

// T-20260522-foot-PERF-TUNING OPT-4: N × get_package_remaining RPC → package_sessions 1회 조회 + 클라이언트 집계
// session_type 매핑: heated_laser→heated, unheated_laser→unheated, iv→iv, preconditioning→preconditioning,
//                    podologue(DB) → podologe(PackageRemaining 필드, 오타 유지), trial→trial
interface _SessRow { package_id: string; session_type: string; status: string }
function computeRemainingFromSessionRows(
  pkgs: Package[],
  sessions: _SessRow[],
): PackageRemaining[] {
  const usedMap = new Map<string, Record<string, number>>();
  for (const s of sessions) {
    if (s.status !== 'used') continue;
    const byType = usedMap.get(s.package_id) ?? {};
    byType[s.session_type] = (byType[s.session_type] ?? 0) + 1;
    usedMap.set(s.package_id, byType);
  }
  return pkgs.map((p) => {
    const used = usedMap.get(p.id) ?? {};
    const totalUsed = Object.values(used).reduce((a, b) => a + b, 0);
    // T-20260608-foot-ACTIVE-PKG-NOTFOUND-DEDUCT-FAIL: total_remaining을 개별 회차 컬럼 합 기준으로 산출.
    // (이전: stale할 수 있는 저장 컬럼 total_sessions에 의존 → 편집/추가로 reborn 등 신규 항목이 들어와도
    //  total_sessions가 동기화 안 되면 total_remaining=0 → "활성 패키지 없음" 오안내 + 차감 차단 회귀)
    const totalAvailable =
      (p.heated_sessions          ?? 0) +
      (p.unheated_sessions        ?? 0) +
      (p.iv_sessions              ?? 0) +
      (p.preconditioning_sessions ?? 0) +
      (p.podologe_sessions        ?? 0) +
      (p.trial_sessions           ?? 0) +
      (p.reborn_sessions          ?? 0);
    return {
      heated:          (p.heated_sessions          ?? 0) - (used['heated_laser']    ?? 0),
      unheated:        (p.unheated_sessions        ?? 0) - (used['unheated_laser']  ?? 0),
      iv:              (p.iv_sessions              ?? 0) - (used['iv']              ?? 0),
      preconditioning: (p.preconditioning_sessions ?? 0) - (used['preconditioning'] ?? 0),
      podologe:        (p.podologe_sessions        ?? 0) - (used['podologue']       ?? 0),
      trial:           (p.trial_sessions           ?? 0) - (used['trial']           ?? 0),
      reborn:          (p.reborn_sessions          ?? 0) - (used['reborn']          ?? 0),
      total_used:      totalUsed,
      total_remaining: Math.max(0, totalAvailable - totalUsed),
    };
  });
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
  readOnly = false,
}: {
  customerId: string;
  prefix: string;
  label: string;
  accent: 'blue' | 'green' | 'orange';
  accept?: string;
  // T-20260616-foot-CHART2-RECEIPT-RESTRUCTURE: 수납내역에서 영수증을 read-only 뷰어로 표시.
  //   업로드/삭제 버튼 제거 → 보기 전용. (write 경로 없음 — 순수 표시 레이어)
  readOnly?: boolean;
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
    // T-20260522-foot-PERF-TUNING OPT-7: N × createSignedUrl → createSignedUrls 1회 배치 (N 라운드트립 제거)
    const filtered = files.filter((f) => f.name && !f.id?.endsWith('/'));
    const paths = filtered.map((f) => `${storagePath}/${f.name}`);
    const { data: urlData } = await supabase.storage.from('photos').createSignedUrls(paths, 3600);
    const withUrls = filtered.map((file, i) => ({
      path: paths[i],
      signedUrl: urlData?.[i]?.signedUrl ?? '',
      name: file.name,
    }));
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
  };

  const remove = async (img: StorageImageItem) => {
    if (!window.confirm('이미지를 삭제하시겠습니까?')) return;
    await supabase.storage.from('photos').remove([img.path]);
    await load();
  };

  const accentMap = {
    blue:   { header: 'bg-slate-50 border-slate-200 text-slate-800', dot: 'bg-slate-500', btn: 'text-slate-700 border-slate-200 hover:bg-slate-50' },
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
        {/* T-20260616-foot-CHART2-RECEIPT-RESTRUCTURE: readOnly 시 업로드 버튼 미노출 (뷰어 전용) */}
        {!readOnly && (
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
        )}
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
              {/* T-20260616-foot-CHART2-RECEIPT-RESTRUCTURE: readOnly 시 삭제 버튼 미노출 (뷰어 전용) */}
              {!readOnly && (
                <button
                  onClick={() => remove(img)}
                  className="absolute top-1 right-1 hidden group-hover:flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-white shadow"
                  title="삭제"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// T-20260510-foot-C21-IMG-PROGRESS: 영수증 업로드 → 일일 매출 연동 컴포넌트
// CustomerStorageImageSection 패턴 확장: 업로드 후 결제 금액 입력 → payments 테이블 insert
function ReceiptUploadSection({
  customerId,
  clinicId,
  onPaymentCreated,
}: {
  customerId: string;
  clinicId: string;
  onPaymentCreated: () => void;
}) {
  const [images, setImages] = useState<StorageImageItem[]>([]);
  const [uploading, setUploading] = useState(false);
  // T-20260609-foot-RECEIPT-PKG-ALWAYS: 영수증 업로드 = 항상 패키지 결제 (혼합안 supersede)
  //   - 단건/패키지 토글 제거 + 활성 패키지 자동감지 제거 → 항상 package_payments INSERT
  //   - 활성 패키지 없으면 가드 차단(단건 fallback 금지) — "패키지 먼저 생성" 전제
  //   - paymentDate: 결제일 — Closing이 created_at 기준 일자 집계하므로 과거일 선택 시 created_at 세팅
  const [amountDlg, setAmountDlg] = useState<{
    open: boolean; amount: string; method: 'card' | 'cash' | 'transfer';
    packageId: string; paymentDate: string;
  }>({ open: false, amount: '', method: 'cash', packageId: '', paymentDate: todaySeoulISODate() });
  // 활성 패키지 목록 (영수증 결제 라우팅 대상)
  // T-20260610-foot-PKGCLASS-SESSION1-SINGLE: totalSessions 추가 — 회수=1 영수증은 단건(payments)으로 분기.
  const [activePkgs, setActivePkgs] = useState<{ id: string; name: string; totalSessions: number }[]>([]);

  const storagePath = `customer/${customerId}/receipt`;

  // T-20260608-foot-RECEIPT-PKG-PAYCLASS: 고객 활성 패키지 조회 (영수증 결제 라우팅용)
  // T-20260610-foot-PKGCLASS-SESSION1-SINGLE: total_sessions 동반 조회 (회수 기반 단건/패키지 자동 분류).
  const loadActivePkgs = useCallback(async () => {
    const { data } = await supabase
      .from('packages')
      .select('id, package_name, total_sessions')
      .eq('customer_id', customerId)
      .eq('status', 'active')
      .order('created_at', { ascending: false });
    setActivePkgs((data ?? []).map((p: { id: string; package_name: string; total_sessions: number }) =>
      ({ id: p.id, name: p.package_name, totalSessions: p.total_sessions ?? 0 })));
  }, [customerId]);

  const load = useCallback(async () => {
    const { data: files } = await supabase.storage.from('photos').list(storagePath, {
      limit: 50,
      sortBy: { column: 'name', order: 'desc' },
    });
    if (!files || files.length === 0) { setImages([]); return; }
    // T-20260522-foot-PERF-TUNING OPT-7: N × createSignedUrl → createSignedUrls 1회 배치 (N 라운드트립 제거)
    const filtered = files.filter((f) => f.name && !f.id?.endsWith('/'));
    const paths = filtered.map((f) => `${storagePath}/${f.name}`);
    const { data: urlData } = await supabase.storage.from('photos').createSignedUrls(paths, 3600);
    const withUrls = filtered.map((file, i) => ({
      path: paths[i],
      signedUrl: urlData?.[i]?.signedUrl ?? '',
      name: file.name,
    }));
    setImages(withUrls.filter((i) => i.signedUrl));
  }, [storagePath]);

  useEffect(() => { load(); loadActivePkgs(); }, [load, loadActivePkgs]);

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
    // T-20260609-foot-RECEIPT-PKG-ALWAYS: 최신 활성 패키지 재조회 (귀속 대상 프리셀렉트)
    await loadActivePkgs();
    const { data: pkgRows } = await supabase
      .from('packages')
      .select('id, package_name, total_sessions')
      .eq('customer_id', customerId)
      .eq('status', 'active')
      .order('created_at', { ascending: false });
    const pkgs = (pkgRows ?? []).map((p: { id: string; package_name: string; total_sessions: number }) =>
      ({ id: p.id, name: p.package_name, totalSessions: p.total_sessions ?? 0 }));
    setActivePkgs(pkgs);
    // 매출 연동 다이얼로그 열기 — 영수증 업로드 = 항상 패키지 결제. 최신 패키지 1건 프리셀렉트.
    // 활성 패키지 없으면 다이얼로그 내 가드로 차단(등록 비활성), 단건 fallback 안 함.
    setAmountDlg({
      open: true, amount: '', method: 'cash',
      packageId: pkgs.length > 0 ? pkgs[0].id : '',
      paymentDate: todaySeoulISODate(),
    });
  };

  const remove = async (img: StorageImageItem) => {
    if (!window.confirm('이미지를 삭제하시겠습니까?')) return;
    await supabase.storage.from('photos').remove([img.path]);
    await load();
  };

  const handlePaymentConfirm = async () => {
    const amt = parseAmount(amountDlg.amount);
    if (amt <= 0) { toast.error('금액을 입력하세요'); return; }

    // ── T-20260609-foot-RECEIPT-PKG-ALWAYS (AC-1·AC-2) ─────────────────
    // 영수증 업로드 = 항상 package_payments INSERT. 단건 fallback 금지(자동감지·토글 제거).
    // 활성 패키지 없으면 가드 차단 — "패키지 먼저 생성" 전제(reporter 김주연 총괄).
    if (activePkgs.length === 0) {
      toast.error('결제할 패키지가 없습니다. 패키지를 먼저 생성한 뒤 등록하세요.');
      return;
    }
    if (!amountDlg.packageId) { toast.error('결제할 패키지를 선택하세요'); return; }

    // 결제일 귀속(AC-3): Closing은 created_at 기준 일자 집계.
    // 오늘 결제(=업로드일)면 now() 그대로(정확 타임스탬프), 과거 결제일이면 해당일 정오(KST)로 created_at 세팅.
    // → 다중 영수증 날짜별 분리 집계(D1 영수증=D1 일마감, D2 영수증=D2 일마감).
    const createdAtOverride =
      amountDlg.paymentDate && amountDlg.paymentDate !== todaySeoulISODate()
        ? `${amountDlg.paymentDate}T12:00:00+09:00`
        : undefined;

    // ── T-20260610-foot-PKGCLASS-SESSION1-SINGLE (AC-3·회수1 영수증=단건) ───────────
    // 선택 패키지의 총 회수=1 이면 단건(payments)으로 분류한다. RECEIPT-PKG-ALWAYS(305b0ad)를
    // 회수=1 케이스에 한해 supersede. 1차 키=회수(금액 보조). Closing은 payments(단건)·
    // package_payments(패키지) 행을 각각 집계하므로 분기만으로 단건 버킷에 정확히 산입된다.
    const selectedPkg = activePkgs.find((p) => p.id === amountDlg.packageId);
    if (selectedPkg && isSinglePaymentByCount(selectedPkg.totalSessions)) {
      const { error: pErr } = await supabase.from('payments').insert({
        clinic_id: clinicId,
        check_in_id: null, // 영수증 업로드는 내원(check_in) 비종속 — payments.check_in_id NULLABLE
        customer_id: customerId,
        amount: amt,
        method: amountDlg.method,
        installment: 0,
        payment_type: 'payment',
        memo: '영수증 업로드(회수1·단건)',
        ...(createdAtOverride ? { created_at: createdAtOverride } : {}),
      });
      if (pErr) { toast.error(`단건 결제 기록 실패: ${pErr.message}`); return; }
      // 패키지 자체는 존속(1회 세션 소진 추적). paid_amount 에 단건 납부분 직접 반영 —
      // payments 행은 package_payments 합계에 안 잡히므로 "미납" 오표시 방지.
      const { data: pkgRow } = await supabase
        .from('packages')
        .select('paid_amount')
        .eq('id', amountDlg.packageId)
        .maybeSingle();
      await supabase
        .from('packages')
        .update({ paid_amount: (pkgRow?.paid_amount ?? 0) + amt })
        .eq('id', amountDlg.packageId);
      setAmountDlg((d) => ({ ...d, open: false }));
      toast.success('단건 결제로 기록 (회수 1회)');
      onPaymentCreated();
      return;
    }

    // PKG-REVENUE-SPLIT(2026-05-19 확립) 경로 재사용 — 새 경로 신설 금지(AC-5).
    const { error: ppErr } = await supabase.from('package_payments').insert({
      clinic_id: clinicId,
      package_id: amountDlg.packageId,
      customer_id: customerId,
      amount: amt,
      method: amountDlg.method,
      installment: 0,
      payment_type: 'payment',
      memo: '영수증 업로드',
      ...(createdAtOverride ? { created_at: createdAtOverride } : {}),
    });
    if (ppErr) { toast.error(`패키지 결제 기록 실패: ${ppErr.message}`); return; }
    // PackagePaymentAdd 동일 로직: package_payments 합계 → packages.paid_amount 재집계
    const { data: sum } = await supabase
      .from('package_payments')
      .select('amount, payment_type')
      .eq('package_id', amountDlg.packageId);
    const total = (sum ?? []).reduce(
      (s, r) => s + (r.payment_type === 'refund' ? -r.amount : r.amount), 0);
    await supabase.from('packages').update({ paid_amount: total }).eq('id', amountDlg.packageId);
    setAmountDlg((d) => ({ ...d, open: false }));
    toast.success('패키지 결제로 기록');
    onPaymentCreated();
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between rounded border px-2.5 py-1.5 bg-green-50 border-green-200 text-green-800">
        <span className="text-xs font-semibold flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full shrink-0 bg-green-500" />
          결제영수증
        </span>
        <label className="cursor-pointer">
          <input type="file" accept="image/*" multiple className="hidden" onChange={handleUpload} disabled={uploading} />
          <span className="inline-flex items-center gap-1 text-xs border rounded px-2 py-0.5 bg-white transition cursor-pointer text-green-700 border-green-200 hover:bg-green-50">
            <Upload className="h-3 w-3" />
            {uploading ? '중…' : '추가'}
          </span>
        </label>
      </div>
      {images.length === 0 ? (
        <div className="rounded border border-dashed py-2.5 text-center text-xs text-muted-foreground">이미지 없음</div>
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
      {/* 매출 연동 다이얼로그 */}
      {amountDlg.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-lg shadow-xl p-4 w-72 space-y-3">
            <div className="font-semibold text-sm">영수증 매출 연동</div>
            <p className="text-xs text-muted-foreground">결제 금액을 입력하면 일일 매출에 자동 반영됩니다.</p>
            <div className="space-y-2">
              {/* T-20260609-foot-RECEIPT-PKG-ALWAYS: 영수증 업로드 = 항상 패키지 결제 (토글 제거) */}
              {activePkgs.length === 0 ? (
                /* 활성 패키지 없음 — 가드 차단(단건 fallback 금지) */
                <div
                  data-testid="receipt-no-package-guard"
                  className="rounded border border-amber-200 bg-amber-50 px-2 py-2 text-[11px] leading-relaxed text-amber-800"
                >
                  결제할 패키지가 없습니다. <b>패키지를 먼저 생성</b>한 뒤 영수증을 등록하세요.
                </div>
              ) : (
                <div>
                  <label className="text-xs text-muted-foreground block mb-0.5">패키지 결제</label>
                  {/* 패키지 선택: 2개 이상이면 드롭다운(귀속 명시), 1개면 라벨 */}
                  {activePkgs.length > 1 ? (
                    <select
                      data-testid="receipt-package-select"
                      value={amountDlg.packageId}
                      onChange={(e) => setAmountDlg((d) => ({ ...d, packageId: e.target.value }))}
                      className="w-full rounded border border-gray-200 px-2 py-1 text-xs"
                    >
                      {activePkgs.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  ) : (
                    <div
                      data-testid="receipt-package-label"
                      className="rounded bg-teal-50 px-2 py-1 text-[11px] text-teal-800 truncate"
                    >
                      {activePkgs[0].name}
                    </div>
                  )}
                </div>
              )}
              <div>
                <label className="text-xs text-muted-foreground block mb-0.5">금액 (원)</label>
                <AmountInput
                  value={amountDlg.amount}
                  onChange={(raw) => setAmountDlg((d) => ({ ...d, amount: raw }))}
                  placeholder="0"
                  className="text-sm"
                  autoFocus
                />
              </div>
              {/* T-20260609-foot-RECEIPT-PKG-ALWAYS 변경2: 결제일 — 매출은 결제일 기준 일마감에 반영 */}
              <div>
                <label className="text-xs text-muted-foreground block mb-0.5">결제일</label>
                <Input
                  type="date"
                  data-testid="receipt-payment-date"
                  value={amountDlg.paymentDate}
                  max={todaySeoulISODate()}
                  onChange={(e) => setAmountDlg((d) => ({ ...d, paymentDate: e.target.value }))}
                  className="text-sm"
                />
                <p className="text-[10px] text-muted-foreground/70 mt-0.5">매출은 결제일 기준 일마감에 반영됩니다.</p>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-0.5">결제수단</label>
                <div className="flex gap-1">
                  {(['card', 'cash', 'transfer'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setAmountDlg((d) => ({ ...d, method: m }))}
                      className={cn(
                        'flex-1 py-1 text-xs rounded border transition',
                        amountDlg.method === m
                          ? 'bg-teal-600 text-white border-teal-600'
                          : 'bg-white border-gray-200 hover:bg-gray-50',
                      )}
                    >
                      {m === 'card' ? '카드' : m === 'cash' ? '현금' : '이체'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={() => setAmountDlg((d) => ({ ...d, open: false }))}
              >
                건너뛰기
              </Button>
              <Button
                size="sm"
                className="flex-1 bg-teal-600 hover:bg-teal-700"
                onClick={handlePaymentConfirm}
                disabled={activePkgs.length === 0}
                data-testid="receipt-payment-submit"
              >
                등록
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// T-20260517-foot-C2-TAB-SYNC: 진료이미지 일자별 히스토리 (업로드+삭제+출력, 비포/애프터 구분)
// T-20260522-foot-MEDIMG-CAMERA: [사진촬영] 버튼 + 연속촬영 + 자동업로드 + 편집/회전
// 파일명 규칙: {type}_{timestamp}_{random}.{ext}  (type: before | after | photo)
// 구버전 호환: 타입 없는 파일({timestamp}_{random}.{ext})은 'photo'로 처리

type TreatImgType = 'before' | 'after' | 'photo';

interface TreatImgItem extends StorageImageItem {
  imgType: TreatImgType;
  dateStr: string;   // 'yyyy-MM-dd'
  timestamp: number; // 정렬용
}

function parseTreatImgMeta(name: string): { imgType: TreatImgType; timestamp: number } {
  const parts = name.split('_');
  if (parts[0] === 'before' || parts[0] === 'after') {
    const ts = parseInt(parts[1], 10);
    return { imgType: parts[0] as TreatImgType, timestamp: isNaN(ts) ? 0 : ts };
  }
  const ts = parseInt(parts[0], 10);
  return { imgType: 'photo', timestamp: isNaN(ts) ? 0 : ts };
}

// T-20260617-foot-MEDIMG-CAMERA-ZOOM-FOCUS (AC-1): 줌 배율 범위 (사용자 노출 배율)
const MAX_ZOOM = 3;     // 최대 3배
const ZOOM_STEP = 0.5;  // +/− 1회당 0.5배

function TreatmentImagesSection({
  customerId,
  onUrlsLoaded,
}: {
  customerId: string;
  onUrlsLoaded: (urls: string[]) => void;
}) {
  const [items, setItems] = useState<TreatImgItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadType, setUploadType] = useState<TreatImgType>('photo');
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());
  // T-20260601-foot-CHART-IMG-VIEWER-UX 이슈1: 최초 1회만 최신 날짜 자동 펼침 (재렌더 시 재펼침 방지)
  const didAutoExpandRef = useRef(false);

  // T-20260601-foot-CHART-IMG-VIEWER-UX 이슈2: 라이트박스 모달 (좌우 넘김)
  const [lightbox, setLightbox] = useState<{ items: TreatImgItem[]; index: number } | null>(null);
  // T-20260601-foot-CHART-IMG-VIEWER-UX 이슈3: 선택 다운로드 모드
  const [selectMode, setSelectMode] = useState(false);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState(false);
  // T-20260609-foot-MEDIMG-COMPARE-GRID: 멀티셀렉트 → 적응형 비교 그리드 오버레이 (read-only)
  // 선택 인프라(selectMode/selectedPaths) 재사용, 신규 npm 0. null=닫힘.
  const [compareItems, setCompareItems] = useState<TreatImgItem[] | null>(null);

  // T-20260522-foot-IMGDROP-REMOVE: 수동 업로드 분류 다이얼로그 (AC-2)
  const [uploadTypeDialogOpen, setUploadTypeDialogOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // T-20260522-foot-MEDIMG-CAMERA: 카메라 상태 (AC-1 ~ AC-4, AC-6)
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraPhase, setCameraPhase] = useState<'select-type' | 'capture'>('select-type');
  const [cameraType, setCameraType] = useState<TreatImgType>('before');
  const [capturedBlobs, setCapturedBlobs] = useState<{ blob: Blob; previewUrl: string }[]>([]);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  // REOPEN #2 T-20260526-foot-CAMERA-FOCUS-BUG: 탭-투-포커스 상태
  const [isFocusing, setIsFocusing] = useState(false);
  const [focusPoint, setFocusPoint] = useState<{ x: number; y: number } | null>(null);
  // T-20260617-foot-MEDIMG-CAMERA-ZOOM-FOCUS (AC-1): 줌 상태
  // zoom = 사용자 노출 배율(1~MAX_ZOOM). hwZoomActive=true면 MediaStreamTrack zoom(하드웨어),
  // false면 디지털 줌(프리뷰 CSS scale + 캡처 캔버스 crop)로 동작.
  const [zoom, setZoom] = useState(1);
  const [hwZoomActive, setHwZoomActive] = useState(false);
  // 하드웨어 줌 capability (min/max/step). null = 미지원 → 디지털 줌 fallback (Galaxy Tab under-report 대비)
  const zoomCapsRef = useRef<{ min: number; max: number; step: number } | null>(null);
  // ── T-20260618-foot-MEDIMG-PINCH-ZOOM: 핀치투줌(입력경로 2) — 부모 zoom state/applyZoom 공유 ──
  // native Pointer Events 2-pointer 거리 추적만 사용(제스처 라이브러리 의존성 없음).
  // 별도 줌 파이프라인 신설 금지 — 핀치는 applyZoom()을 호출하는 두 번째 입력경로일 뿐.
  const activePointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStartDistRef = useRef<number | null>(null); // 핀치 시작 시 두 손가락 거리(px)
  const pinchStartZoomRef = useRef(1);                    // 핀치 시작 시점 zoom 배율

  // T-20260522-foot-MEDIMG-CAMERA: 이미지 편집/회전 상태 (AC-5)
  const [editingImg, setEditingImg] = useState<TreatImgItem | null>(null);
  const [editRotation, setEditRotation] = useState(0);
  const [savingRotation, setSavingRotation] = useState(false);

  const storagePath = `customer/${customerId}/treatment-images`;

  const load = useCallback(async () => {
    const { data: files } = await supabase.storage.from('photos').list(storagePath, {
      limit: 100,
      sortBy: { column: 'name', order: 'desc' },
    });
    if (!files || files.length === 0) { setItems([]); onUrlsLoaded([]); return; }
    const withMeta = await Promise.all(
      files
        .filter((f) => f.name && !f.id?.endsWith('/'))
        .map(async (file) => {
          const path = `${storagePath}/${file.name}`;
          const { data } = await supabase.storage.from('photos').createSignedUrl(path, 3600);
          const { imgType, timestamp } = parseTreatImgMeta(file.name);
          const dateStr = timestamp > 0
            ? new Date(timestamp).toISOString().slice(0, 10)
            : (file.created_at ? file.created_at.slice(0, 10) : 'unknown');
          return {
            path,
            signedUrl: data?.signedUrl ?? '',
            name: file.name,
            imgType,
            dateStr,
            timestamp,
          } as TreatImgItem;
        }),
    );
    const valid = withMeta.filter((i) => i.signedUrl);
    setItems(valid);
    onUrlsLoaded(valid.map((i) => i.signedUrl));
    // T-20260601-foot-CHART-IMG-VIEWER-UX 이슈1: 자동 펼침 로직을 load()에서 제거.
    // (load는 재렌더/업로드/삭제마다 재실행되어, 여기서 펼치면 접어도 다시 펼쳐지는 버그)
    // → 최초 1회 자동 펼침은 아래 별도 effect(didAutoExpandRef)에서 처리.
  }, [storagePath, onUrlsLoaded]);

  useEffect(() => { load(); }, [load]);

  // T-20260601-foot-CHART-IMG-VIEWER-UX 이슈1 (AC-1):
  // 진입 시 가장 최근 날짜 그룹만 1회 펼침, 나머지 접힘. 이후 토글은 사용자 제어.
  useEffect(() => {
    if (didAutoExpandRef.current) return;
    if (items.length === 0) return;
    const newestDate = items.reduce((a, b) => (a.dateStr > b.dateStr ? a : b)).dateStr;
    setExpandedDates(new Set([newestDate]));
    didAutoExpandRef.current = true;
  }, [items]);

  // 일자별 그룹핑 (최신순)
  const grouped = useMemo(() => {
    const map = new Map<string, TreatImgItem[]>();
    for (const item of items) {
      if (!map.has(item.dateStr)) map.set(item.dateStr, []);
      map.get(item.dateStr)!.push(item);
    }
    // 각 그룹 내 최신순 정렬
    for (const arr of map.values()) {
      arr.sort((a, b) => b.timestamp - a.timestamp);
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [items]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    for (const file of Array.from(files)) {
      const ext = file.name.split('.').pop() ?? 'jpg';
      // T-20260517: 파일명에 type 접두사 포함
      const path = `${storagePath}/${uploadType}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`;
      const { error } = await supabase.storage.from('photos').upload(path, file, { contentType: file.type });
      if (error) toast.error(`업로드 실패: ${error.message}`);
    }
    setUploading(false);
    e.target.value = '';
    await load();
  };

  const remove = async (img: TreatImgItem) => {
    if (!window.confirm('이미지를 삭제하시겠습니까?')) return;
    await supabase.storage.from('photos').remove([img.path]);
    await load();
  };

  const toggleDate = (d: string) =>
    setExpandedDates((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d); else next.add(d);
      return next;
    });

  // ── T-20260601-foot-CHART-IMG-VIEWER-UX 이슈2/3: 라이트박스 + 다운로드 ──

  const openLightbox = (groupItems: TreatImgItem[], img: TreatImgItem) => {
    const idx = groupItems.findIndex((i) => i.path === img.path);
    setLightbox({ items: groupItems, index: idx < 0 ? 0 : idx });
  };

  const lightboxStep = useCallback((delta: number) => {
    setLightbox((lb) => {
      if (!lb) return lb;
      const next = lb.index + delta;
      if (next < 0 || next >= lb.items.length) return lb; // 경계: 멈춤(순환 안 함)
      return { ...lb, index: next };
    });
  }, []);

  // 키보드 ←/→/Esc (AC-2)
  // capture 단계 + stopPropagation: Esc가 라이트박스만 닫고 부모 차트 시트(Radix Dialog)까지
  // 닫는 것을 막는다. (라이트박스는 시트 위에 떠 있는 자식 모달)
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') { e.stopPropagation(); lightboxStep(1); }
      else if (e.key === 'ArrowLeft') { e.stopPropagation(); lightboxStep(-1); }
      else if (e.key === 'Escape') { e.stopPropagation(); setLightbox(null); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [lightbox, lightboxStep]);

  // signedUrl 만료(1h) 대비 재발급 후 blob fetch (AC-5)
  const fetchBlobWithRefresh = async (img: TreatImgItem): Promise<Blob | null> => {
    try {
      let res = await fetch(img.signedUrl);
      if (!res.ok) {
        const { data } = await supabase.storage.from('photos').createSignedUrl(img.path, 3600);
        if (data?.signedUrl) res = await fetch(data.signedUrl);
      }
      if (!res.ok) return null;
      return await res.blob();
    } catch {
      return null;
    }
  };

  const triggerDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // 다건 순차 다운로드. 파일명 = 일자_순번_분류.ext (충돌 회피)
  const downloadImages = async (imgs: TreatImgItem[]) => {
    if (imgs.length === 0 || downloading) return;
    setDownloading(true);
    let ok = 0;
    try {
      for (let i = 0; i < imgs.length; i++) {
        const img = imgs[i];
        const blob = await fetchBlobWithRefresh(img);
        if (!blob) continue;
        const ext = img.name.split('.').pop() ?? 'jpg';
        const fname = `${img.dateStr}_${String(i + 1).padStart(2, '0')}_${img.imgType}.${ext}`;
        triggerDownload(blob, fname);
        ok++;
        if (imgs.length > 1) await new Promise((r) => setTimeout(r, 350)); // 브라우저 연속 다운로드 차단 회피
      }
    } finally {
      setDownloading(false);
    }
    if (ok === 0) toast.error('다운로드 실패 (이미지를 불러오지 못했습니다)');
    else toast.success(`${ok}장 다운로드 완료`);
  };

  const toggleSelect = (path: string) =>
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedPaths(new Set());
  };

  const downloadSelected = async () => {
    const sel = items.filter((i) => selectedPaths.has(i.path));
    await downloadImages(sel);
    exitSelectMode();
  };

  // T-20260609-foot-MEDIMG-COMPARE-GRID (AC-1): 선택 2~4장 → 비교 오버레이.
  // 시간순(asc) 정렬 후 동시각이면 before→after→photo 순. 4장 초과는 버튼 단계에서 차단.
  const openCompare = () => {
    const sel = items
      .filter((i) => selectedPaths.has(i.path))
      .sort((a, b) => {
        if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
        const order: Record<TreatImgType, number> = { before: 0, after: 1, photo: 2 };
        return order[a.imgType] - order[b.imgType];
      })
      .slice(0, 4);
    if (sel.length < 2) return;
    setCompareItems(sel);
  };

  // ── T-20260522-foot-MEDIMG-CAMERA: 카메라 함수 ───────────────────────────

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const openCameraModal = () => {
    setCapturedBlobs([]);
    setCameraPhase('select-type');
    setCameraError(null);
    setCameraOpen(true);
  };

  const selectTypeAndStart = async (type: TreatImgType) => {
    setCameraType(type);
    setCameraError(null);
    // AC-1: 새 스트림마다 줌 초기화
    setZoom(1);
    setHwZoomActive(false);
    zoomCapsRef.current = null;
    try {
      // FIX T-20260522-foot-MEDIMG-CAMERA (flickering):
      // width/height ideal 제거 — Galaxy Tab 카메라 해상도 재협상 방지
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      streamRef.current = stream;

      // FIX T-20260526-foot-CAMERA-FOCUS-BUG REOPEN #1 — Galaxy Tab auto-focus
      //
      // 실패 이력:
      //   ❌ Attempt 1: advanced[{ focusMode:'continuous' }]
      //      → W3C advanced[] "모두 충족 시에만 적용" 원칙 → Galaxy Tab에서 set 전체 skip
      //   ❌ Attempt 2: getCapabilities()-gated top-level focusMode
      //      → Galaxy Tab getCapabilities() returns focusMode:[] → bestMode=null → no-op
      //   ❌ 공통 함정: width:{min:1280} + focusMode 를 동일 applyConstraints()에 혼합
      //      → width OverconstrainedError → focusMode도 같이 실패 (atomic failure)
      //
      // 신규 전략 (AC-5,6):
      //   1. 해상도 / focusMode 분리 — 독립 applyConstraints() 호출
      //   2. blind multi-mode apply — Samsung getCapabilities() under-report 우회
      //      'continuous' → 'auto' → 'single-shot' 순서로 첫 성공까지 시도
      //   3. ImageCapture.takePicture() — 캡처 시 hardware focus cycle 대기 (capturePhoto 참고)
      //   4. console.debug 진단 핑거프린트 — 현장 개발자 도구로 지원 여부 확인 가능
      try {
        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) {
          // ── Layer 1: 해상도 (독립 호출 — focusMode와 완전 분리) ──────────────
          // min 대신 ideal 사용 → OverconstrainedError 최소화 (AC-3 동일 보장)
          try {
            await videoTrack.applyConstraints({ width: { ideal: 1920 } });
          } catch (_resErr) { /* canvas scale-up double-safety가 1280px 보장 */ }

          // ── Layer 2: focusMode 다단계 blind apply (AC-5,6) ──────────────────
          // Samsung Galaxy Tab Chrome은 getCapabilities().focusMode 를 under-report.
          // capabilities 체크 결과와 무관하게 모든 후보를 순서대로 시도.
          type ExtCaps = MediaTrackCapabilities & { focusMode?: string[] };
          const caps: ExtCaps = (videoTrack.getCapabilities?.() ?? {}) as ExtCaps;
          const reportedModes: string[] = caps.focusMode ?? [];
          const supportedConstraints = navigator.mediaDevices.getSupportedConstraints() as Record<string, boolean>;

          // ── AC-1: 줌 capability 감지 (read-only — applyConstraints 미발생, focusMode와 무관) ──
          // 하드웨어 줌 지원 시 zoomCapsRef에 저장 → applyZoom()에서 독립 호출로 적용.
          // Galaxy Tab은 zoom capability를 under-report할 수 있음 → 미보고 시 디지털 줌 fallback.
          const zoomCap = (caps as MediaTrackCapabilities & { zoom?: { min: number; max: number; step?: number } }).zoom;
          if (zoomCap && typeof zoomCap.max === 'number' && typeof zoomCap.min === 'number' && zoomCap.max > zoomCap.min) {
            zoomCapsRef.current = { min: zoomCap.min, max: zoomCap.max, step: zoomCap.step ?? 0.1 };
            console.debug('[CAMERA-ZOOM] hardware zoom supported:', zoomCapsRef.current);
          } else {
            zoomCapsRef.current = null; // 디지털 줌 fallback
            console.debug('[CAMERA-ZOOM] hardware zoom not reported — digital zoom fallback');
          }

          // 진단 로그 (현장 브라우저 콘솔 / 개발자 도구로 확인)
          console.debug('[CAMERA-FOCUS] getSupportedConstraints.focusMode:', supportedConstraints['focusMode']);
          console.debug('[CAMERA-FOCUS] getCapabilities.focusMode:', reportedModes);
          const initSettings = videoTrack.getSettings?.() as (MediaTrackSettings & { focusMode?: string }) | undefined;
          console.debug('[CAMERA-FOCUS] initial focusMode:', initSettings?.focusMode);

          // capabilities 보고 모드 우선 + 보고 없을 시 전체 blind 시도
          const knownModes = ['continuous', 'auto', 'single-shot'];
          const capModes = reportedModes.filter(m => knownModes.includes(m));
          const candidates = capModes.length > 0
            ? [...new Set([...capModes, ...knownModes])] // 보고분 우선, 나머지 blind 추가
            : knownModes; // Galaxy Tab: 보고 없음 → 전부 blind 시도

          for (const mode of candidates) {
            try {
              await videoTrack.applyConstraints({ focusMode: mode } as MediaTrackConstraints);
              console.debug('[CAMERA-FOCUS] applyConstraints ok:', mode);
              break; // 첫 성공에서 중단
            } catch (_modeErr) {
              console.debug('[CAMERA-FOCUS] applyConstraints failed:', mode);
            }
          }

          const finalSettings = videoTrack.getSettings?.() as (MediaTrackSettings & { focusMode?: string }) | undefined;
          console.debug('[CAMERA-FOCUS] final focusMode:', finalSettings?.focusMode);

          // REOPEN #2 AC-9: 프리포커스 킥 (600ms 후) — 카메라 초기화 완료 후 single-shot 1회 트리거
          // 스트림 열림 직후보다 0.6s 지연 후가 카메라 하드웨어 준비 완료 시점에 더 근접.
          // single-shot 성공 → 800ms 뒤 continuous 복원 → 사용자 촬영 전 초점 수렴 완료.
          const trackForPrefocus = videoTrack; // 클로저 캡처 (stopStream 후 stale 방지)
          setTimeout(async () => {
            if (!streamRef.current) return; // 카메라가 이미 닫혔으면 skip
            try {
              await trackForPrefocus.applyConstraints({ focusMode: 'single-shot' } as MediaTrackConstraints);
              console.debug('[CAMERA-FOCUS] prefocus single-shot ok');
              setTimeout(async () => {
                try {
                  await trackForPrefocus.applyConstraints({ focusMode: 'continuous' } as MediaTrackConstraints);
                  console.debug('[CAMERA-FOCUS] prefocus continuous restore ok');
                } catch { /* 미지원 — single-shot 상태 유지 */ }
              }, 800);
            } catch {
              console.debug('[CAMERA-FOCUS] prefocus kick failed — camera in native AF state');
            }
          }, 600);
        }
      } catch (_afErr) {
        // 전체 focus 시도 실패 — 카메라는 정상 작동 (AF 미제어 상태로 fallback)
      }

      setCameraPhase('capture');
    } catch (_err) {
      setCameraError('카메라 접근 권한이 없습니다. 브라우저 설정에서 카메라를 허용해주세요.');
    }
  };

  // FIX T-20260522-foot-MEDIMG-CAMERA (flickering):
  // useCallback([]): 렌더마다 새 함수가 생성되지 않도록 메모이제이션.
  // capturedBlobs 상태변경 시 React가 old→null/new→el을 반복 호출하던 버그 해소.
  // RAF로 play() 지연: Android WebView에서 srcObject 직후 즉시 play() 시 프레임 드롭 방지.
  const videoRefCallback = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
    if (el && streamRef.current) {
      el.srcObject = streamRef.current;
      // Android WebView: RAF 1프레임 대기 후 play — 스트림 바인딩 안정화
      requestAnimationFrame(() => {
        if (el.srcObject) el.play().catch(() => {});
      });
    }
  }, []); // 의존성 없음 — 생명주기 전체에서 동일 함수 참조 유지

  // REOPEN #2 AC-8: 탭-투-포커스 — 화면 탭 시 single-shot AF 발화 + 시각 피드백
  // Samsung Galaxy Tab Chrome은 focusMode API 응답이 불안정 → 사용자가 직접 트리거하는 것이
  // 가장 신뢰도 높은 방법 (native camera app UX 동일 패턴).
  const handleVideoTap = useCallback(async (e: React.PointerEvent<HTMLVideoElement>) => {
    const videoTrack = streamRef.current?.getVideoTracks()[0];
    if (!videoTrack) return;
    // 이미 포커싱 중이면 무시
    if (isFocusing) return;

    // 탭 좌표 → 퍼센트 (포커스 링 위치용)
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100));
    const y = Math.min(100, Math.max(0, ((e.clientY - rect.top) / rect.height) * 100));
    setFocusPoint({ x, y });
    setIsFocusing(true);

    // single-shot → auto → continuous 순으로 시도 (tap 시점에서 즉각 focus 발화)
    for (const mode of ['single-shot', 'auto', 'continuous'] as const) {
      try {
        await videoTrack.applyConstraints({ focusMode: mode } as MediaTrackConstraints);
        console.debug('[CAMERA-FOCUS] tap-to-focus ok:', mode);
        break;
      } catch {
        console.debug('[CAMERA-FOCUS] tap-to-focus failed:', mode);
      }
    }

    // 800ms 후 continuous 복원 시도 + 링 숨김
    setTimeout(async () => {
      try {
        await videoTrack.applyConstraints({ focusMode: 'continuous' } as MediaTrackConstraints);
      } catch { /* 미지원 기기 — 현재 모드 유지 */ }
      setIsFocusing(false);
      setTimeout(() => setFocusPoint(null), 300);
    }, 800);
  }, [isFocusing]);

  // ── T-20260617-foot-MEDIMG-CAMERA-ZOOM-FOCUS (AC-1): 줌 적용 ────────────────
  // 사용자 노출 배율(1~MAX_ZOOM)을 받아서:
  //  - 하드웨어 줌 지원(zoomCapsRef) → applyConstraints({ advanced:[{ zoom }] }) 독립 호출
  //    (★ focusMode와 절대 같은 applyConstraints 호출에 혼합 금지 — atomic OverconstrainedError 함정)
  //  - 미지원 → 디지털 줌(프리뷰 CSS scale + 캡처 시 캔버스 crop)
  const applyZoom = useCallback(async (nextLevel: number) => {
    const clamped = Math.min(MAX_ZOOM, Math.max(1, Math.round(nextLevel * 10) / 10));
    setZoom(clamped);

    const track = streamRef.current?.getVideoTracks()[0];
    const caps = zoomCapsRef.current;
    if (track && caps) {
      // 사용자 배율(1..MAX_ZOOM) → 하드웨어 줌(caps.min..caps.max) 선형 매핑
      const hwZoom = caps.min + ((clamped - 1) / (MAX_ZOOM - 1)) * (caps.max - caps.min);
      try {
        // ★ 줌 전용 독립 applyConstraints — focusMode 시퀀스와 분리 (AC-2 회귀 보호)
        await track.applyConstraints({ advanced: [{ zoom: hwZoom }] } as unknown as MediaTrackConstraints);
        setHwZoomActive(true);
        console.debug('[CAMERA-ZOOM] hardware zoom applied:', hwZoom);
        return;
      } catch {
        // 하드웨어 줌 적용 실패 → 디지털 줌으로 전환 (under-report 기기 대응)
        setHwZoomActive(false);
        console.debug('[CAMERA-ZOOM] hardware zoom apply failed — digital fallback');
        return;
      }
    }
    // 디지털 줌: CSS transform(프리뷰) + 캡처 캔버스 crop으로 배율 반영
    setHwZoomActive(false);
  }, []);

  // ── T-20260618-foot-MEDIMG-PINCH-ZOOM: 핀치 제스처 핸들러 (입력경로 2) ──────────
  // 버튼(입력경로 1)과 동일 applyZoom()/zoom state 공유 → clamp(1..MAX_ZOOM)·0.1 round·
  // 하드웨어/디지털 분기가 한 곳으로 일원화됨. zoom 제약 ↔ focusMode 분리 원칙도 applyZoom 내부에서 보존(무회귀).
  // 2-pointer일 때만 줌; 1-pointer는 기존 탭-투-포커스(handleVideoTap) 그대로.
  // UNIT 매핑 수식: nextZoom = pinchStartZoom × (curDist / startDist). applyZoom이 최종 clamp/round 담당.
  const pointerDist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.hypot(a.x - b.x, a.y - b.y);

  const handleCameraPointerDown = useCallback((e: React.PointerEvent<HTMLVideoElement>) => {
    activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (activePointersRef.current.size >= 2) {
      // 핀치 시작 — 두 손가락 기준 거리/배율 기록. 1-pointer 탭-투-포커스는 발화 금지 + 진행 중 포커스 취소.
      const pts = Array.from(activePointersRef.current.values());
      pinchStartDistRef.current = pointerDist(pts[0], pts[1]);
      pinchStartZoomRef.current = zoom;
      setIsFocusing(false);
      setFocusPoint(null);
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 미지원 — best-effort */ }
      return;
    }
    // 1-pointer: 기존 탭-투-포커스 동작 보존
    handleVideoTap(e);
  }, [zoom, handleVideoTap]);

  const handleCameraPointerMove = useCallback((e: React.PointerEvent<HTMLVideoElement>) => {
    if (!activePointersRef.current.has(e.pointerId)) return;
    activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    // 2-pointer + 핀치 기준 거리 존재할 때만 줌 (1-pointer 이동은 무시 → 탭/스크롤 무회귀)
    if (activePointersRef.current.size < 2 || pinchStartDistRef.current == null) return;
    const pts = Array.from(activePointersRef.current.values());
    const curDist = pointerDist(pts[0], pts[1]);
    if (curDist <= 0) return;
    applyZoom(pinchStartZoomRef.current * (curDist / pinchStartDistRef.current));
  }, [applyZoom]);

  const handleCameraPointerUp = useCallback((e: React.PointerEvent<HTMLVideoElement>) => {
    activePointersRef.current.delete(e.pointerId);
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    // 2-pointer 미만이 되면 핀치 종료 — 다음 핀치 시 zoom 기준 재계산 위해 기준 거리 초기화
    if (activePointersRef.current.size < 2) pinchStartDistRef.current = null;
  }, []);

  // AC-2: 캡처 후 continuous 복원 (non-blocking, best-effort) — 다음 프리뷰 초점 추적 유지
  const restoreContinuousFocus = (track: MediaStreamTrack | undefined) => {
    if (!track) return;
    track.applyConstraints({ focusMode: 'continuous' } as MediaTrackConstraints).catch(() => {
      /* 미지원 기기 — single-shot 상태 유지 (무회귀) */
    });
  };

  const capturePhoto = async () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const videoTrack = streamRef.current?.getVideoTracks()[0];

    // ── AC-2: capture-time 재-프리포커스 게이트 ───────────────────────────────
    // 셔터 시점에 single-shot 1회 발화 후 짧게 수렴 대기 → 캡처. 간헐 초점 나감 완화.
    // ★ focusMode 단독 applyConstraints — zoom 제약과 절대 혼합하지 않음(AC-1/AC-2 분리).
    // ★ 기존 검증된 single-shot 패턴 재사용 — 미지원 기기는 try/catch로 native AF 유지(무회귀).
    if (videoTrack) {
      try {
        await videoTrack.applyConstraints({ focusMode: 'single-shot' } as MediaTrackConstraints);
        await new Promise((r) => setTimeout(r, 450)); // 하드웨어 초점 수렴 대기
        console.debug('[CAMERA-FOCUS] capture-time single-shot refocus ok');
      } catch {
        // 미지원 — 기존 AF 상태 그대로 캡처 (무회귀)
        console.debug('[CAMERA-FOCUS] capture-time refocus unsupported — native AF');
      }
    }

    // AC-1: 디지털 줌 활성(하드웨어 줌 비활성 + 배율>1) 여부 — 캡처본에 배율 반영 경로 결정
    const digitalZoomActive = !hwZoomActive && zoom > 1;

    // ── Strategy 1: ImageCapture.takePicture() ────────────────────────────────
    // REOPEN #1 AC-5: Galaxy Tab에서 hardware focus cycle 완료 후 캡처 트리거.
    // Chrome 59+, Android 7+ 지원. canvas drawImage는 현재 프레임을 즉시 캡처하므로
    // focus 수렴 전 흐린 프레임을 잡을 수 있음 → takePicture()가 근본 해결.
    // 반환 Blob은 JPEG/PNG(기기 네이티브 인코더 사용) — quality 옵션 불필요.
    // ★ AC-1: 디지털 줌일 때는 takePicture()가 풀프레임(미확대)을 반환하므로 skip → 캔버스 crop 경로로.
    //   (하드웨어 줌은 스트림 자체가 확대되므로 takePicture()/canvas 모두 배율 반영됨)
    if (!digitalZoomActive && videoTrack && 'ImageCapture' in window) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ic = new (window as any).ImageCapture(videoTrack);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const blob: Blob = await (ic as any).takePicture();
        if (blob && blob.size > 1000) { // sanity: 유효 이미지 (empty blob 아님)
          const previewUrl = URL.createObjectURL(blob);
          setCapturedBlobs((prev) => [...prev, { blob, previewUrl }]);
          restoreContinuousFocus(videoTrack); // AC-2: 다음 프리뷰 추적용 continuous 복원
          return; // 성공 → canvas fallback 불필요
        }
      } catch (_icErr) {
        // ImageCapture 미지원 또는 실패 → canvas fallback으로 계속
        console.debug('[CAMERA-FOCUS] ImageCapture.takePicture() failed, fallback to canvas');
      }
    }

    // ── Fallback: canvas drawImage ─────────────────────────────────────────────
    // AC-3 T-20260522-foot-CHART2-CAM-FOCUS: 최소 1280px 보장
    // applyConstraints(width:{ideal:1920})로 스트림 레벨 대응
    // + canvas scale-up double-safety
    const naturalW = video.videoWidth || 1280;
    const naturalH = video.videoHeight || 720;
    const minWidth = 1280;

    // AC-1: 디지털 줌 — 중앙 crop으로 배율 반영(프리뷰 CSS scale과 동일한 시야)
    //   crop 영역 = 원본 / zoom (중앙 정렬), 출력은 최소 1280px 보장 위해 scale-up
    const cropW = digitalZoomActive ? naturalW / zoom : naturalW;
    const cropH = digitalZoomActive ? naturalH / zoom : naturalH;
    const cropX = (naturalW - cropW) / 2;
    const cropY = (naturalH - cropH) / 2;
    const scale = cropW < minWidth ? minWidth / cropW : 1;
    canvas.width = Math.round(cropW * scale);
    canvas.height = Math.round(cropH * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const previewUrl = URL.createObjectURL(blob);
      setCapturedBlobs((prev) => [...prev, { blob, previewUrl }]);
    }, 'image/jpeg', 0.9);
    restoreContinuousFocus(videoTrack); // AC-2: continuous 복원
  };

  const removeCaptured = (index: number) => {
    setCapturedBlobs((prev) => {
      URL.revokeObjectURL(prev[index].previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  };

  const uploadCaptured = async () => {
    if (capturedBlobs.length === 0) { closeCamera(); return; }
    const total = capturedBlobs.length;
    setUploadProgress({ done: 0, total });
    let done = 0;
    for (const { blob, previewUrl } of capturedBlobs) {
      const path = `${storagePath}/${cameraType}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.jpg`;
      const { error } = await supabase.storage.from('photos').upload(path, blob, { contentType: 'image/jpeg' });
      if (error) toast.error(`업로드 실패: ${error.message}`);
      URL.revokeObjectURL(previewUrl);
      done++;
      setUploadProgress({ done, total });
    }
    stopStream();
    setCapturedBlobs([]);
    setCameraOpen(false);
    setUploadProgress(null);
    await load();
    toast.success(`${done}장 저장 완료`);
  };

  const closeCamera = () => {
    stopStream();
    capturedBlobs.forEach((b) => URL.revokeObjectURL(b.previewUrl));
    setCapturedBlobs([]);
    setCameraOpen(false);
    setUploadProgress(null);
    setCameraError(null);
    // AC-1: 줌 초기화
    setZoom(1);
    setHwZoomActive(false);
    zoomCapsRef.current = null;
  };

  // ── T-20260522-foot-MEDIMG-CAMERA: 회전 함수 (AC-5) ─────────────────────

  const openEdit = (img: TreatImgItem) => {
    setEditingImg(img);
    setEditRotation(0);
  };

  const saveRotation = async () => {
    if (!editingImg) return;
    if (editRotation === 0) { setEditingImg(null); return; }
    setSavingRotation(true);
    try {
      const loadImg = (): Promise<HTMLImageElement> =>
        new Promise((resolve, reject) => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = editingImg.signedUrl;
        });
      const srcImg = await loadImg();
      const rad = (editRotation * Math.PI) / 180;
      const sin = Math.abs(Math.sin(rad));
      const cos = Math.abs(Math.cos(rad));
      const newW = Math.round(srcImg.width * cos + srcImg.height * sin);
      const newH = Math.round(srcImg.width * sin + srcImg.height * cos);
      const canvas = document.createElement('canvas');
      canvas.width = newW;
      canvas.height = newH;
      const ctx = canvas.getContext('2d')!;
      ctx.translate(newW / 2, newH / 2);
      ctx.rotate(rad);
      ctx.drawImage(srcImg, -srcImg.width / 2, -srcImg.height / 2);
      const rotatedBlob: Blob = await new Promise((resolve, reject) => {
        canvas.toBlob((b) => { if (b) resolve(b); else reject(new Error('toBlob failed')); }, 'image/jpeg', 0.92);
      });
      // 원본 삭제 후 회전본 업로드 (동일 경로 — 파일명 보존)
      await supabase.storage.from('photos').remove([editingImg.path]);
      const { error } = await supabase.storage.from('photos').upload(editingImg.path, rotatedBlob, {
        contentType: 'image/jpeg',
        upsert: true,
      });
      if (error) throw error;
      toast.success('회전 저장 완료');
      setEditingImg(null);
      await load();
    } catch (_err) {
      toast.error('회전 저장 실패');
    } finally {
      setSavingRotation(false);
    }
  };

  const TYPE_LABEL: Record<TreatImgType, string> = { before: '시술 전', after: '시술 후', photo: '기타' };
  const TYPE_COLOR: Record<TreatImgType, string> = {
    before: 'bg-slate-100 text-slate-700',
    after:  'bg-emerald-100 text-emerald-700',
    photo:  'bg-gray-100 text-gray-600',
  };

  return (
    <div className="space-y-1.5">
      {/* 업로드 바 */}
      <div className="flex items-center justify-between rounded border border-teal-200 bg-teal-50 px-2.5 py-1.5">
        <span className="text-xs text-teal-800 font-medium">일자별 이미지 이력</span>
        <div className="flex items-center gap-1.5">
          {/* T-20260601-foot-CHART-IMG-VIEWER-UX 이슈3: 선택 다운로드 모드 (AC-3) */}
          {items.length > 0 && (
            selectMode ? (
              <>
                {/* T-20260609-foot-MEDIMG-COMPARE-GRID (AC-1): 2~4장 선택 시 비교 활성, 4장 초과 차단 */}
                <button
                  type="button"
                  onClick={openCompare}
                  disabled={selectedPaths.size < 2 || selectedPaths.size > 4}
                  data-testid="compare-btn"
                  title={
                    selectedPaths.size < 2 ? '2장 이상 선택하세요'
                    : selectedPaths.size > 4 ? '비교는 최대 4장까지'
                    : '선택 이미지 비교'
                  }
                  className="inline-flex items-center gap-1 text-xs border border-teal-400 rounded px-2 py-0.5 bg-white text-teal-700 hover:bg-teal-100 transition disabled:opacity-50"
                >
                  <Columns2 className="h-3 w-3" />
                  비교 ({selectedPaths.size})
                </button>
                <button
                  type="button"
                  onClick={downloadSelected}
                  disabled={downloading || selectedPaths.size === 0}
                  className="inline-flex items-center gap-1 text-xs border border-neutral-700 rounded px-2 py-0.5 bg-neutral-800 text-white hover:bg-neutral-900 transition disabled:opacity-50"
                >
                  {downloading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                  선택 다운로드 ({selectedPaths.size})
                </button>
                <button
                  type="button"
                  onClick={exitSelectMode}
                  className="inline-flex items-center text-xs border border-gray-300 rounded px-2 py-0.5 bg-white text-gray-600 hover:bg-gray-100 transition"
                >
                  취소
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setSelectMode(true)}
                className="inline-flex items-center gap-1 text-xs border border-teal-200 rounded px-2 py-0.5 bg-white text-teal-700 hover:bg-teal-100 transition"
              >
                <Check className="h-3 w-3" />
                선택
              </button>
            )
          )}
          {/* T-20260522-foot-IMGDROP-REMOVE: 드롭다운 제거 → 업로드 클릭 시 분류 다이얼로그 (AC-1, AC-2) */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleUpload}
            disabled={uploading}
          />
          <button
            type="button"
            onClick={() => setUploadTypeDialogOpen(true)}
            disabled={uploading}
            className="inline-flex items-center gap-1 text-xs border border-teal-200 rounded px-2 py-0.5 bg-white text-teal-700 hover:bg-teal-100 transition cursor-pointer disabled:opacity-50"
          >
            <Upload className="h-3 w-3" />
            {uploading ? '업로드 중…' : '업로드'}
          </button>
          {/* T-20260522-foot-MEDIMG-CAMERA: [사진촬영] 버튼 (AC-1) */}
          <button
            type="button"
            onClick={openCameraModal}
            className="inline-flex items-center gap-1 text-xs border border-neutral-700 rounded px-2 py-0.5 bg-neutral-800 text-white hover:bg-neutral-900 active:bg-neutral-900 transition font-medium"
          >
            <Camera className="h-3 w-3" />
            사진촬영
          </button>
        </div>
      </div>

      {/* 일자별 그룹 */}
      {grouped.length === 0 ? (
        <div className="rounded border border-dashed py-3 text-center text-xs text-muted-foreground">
          진료이미지 없음
        </div>
      ) : (
        <div className="space-y-1">
          {grouped.map(([dateStr, dateItems]) => {
            const expanded = expandedDates.has(dateStr);
            const beforeItems = dateItems.filter((i) => i.imgType === 'before');
            const afterItems  = dateItems.filter((i) => i.imgType === 'after');
            const photoItems  = dateItems.filter((i) => i.imgType === 'photo');
            return (
              <div key={dateStr} className="rounded border border-gray-200 overflow-hidden">
                {/* 날짜 헤더 */}
                <button
                  type="button"
                  onClick={() => toggleDate(dateStr)}
                  className="w-full flex items-center justify-between px-2.5 py-1.5 bg-gray-50 hover:bg-gray-100 transition text-left"
                >
                  <span className="text-xs font-semibold text-gray-700 flex items-center gap-1.5">
                    {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                    {dateStr}
                    <span className="text-muted-foreground font-normal">{dateItems.length}장</span>
                  </span>
                  <div className="flex items-center gap-1">
                    {beforeItems.length > 0 && (
                      <span className={`text-[10px] rounded px-1 ${TYPE_COLOR.before}`}>전 {beforeItems.length}</span>
                    )}
                    {afterItems.length > 0 && (
                      <span className={`text-[10px] rounded px-1 ${TYPE_COLOR.after}`}>후 {afterItems.length}</span>
                    )}
                  </div>
                </button>

                {/* 사진 그리드 */}
                {expanded && (() => {
                  // T-20260601-foot-CHART-IMG-VIEWER-UX 이슈2: 라이트박스 넘김 순서 = 화면 표시 순서(전→후→기타)
                  const orderedItems = [...beforeItems, ...afterItems, ...photoItems];
                  return (
                  <div className="p-2 space-y-2 bg-white">
                    {/* T-20260601-foot-CHART-IMG-VIEWER-UX 이슈3: 그룹 전체 다운로드 (AC-3) */}
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => downloadImages(orderedItems)}
                        disabled={downloading}
                        className="inline-flex items-center gap-1 text-[11px] border border-teal-200 rounded px-2 py-0.5 bg-white text-teal-700 hover:bg-teal-100 transition disabled:opacity-50"
                      >
                        {downloading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                        전체 다운로드 ({orderedItems.length})
                      </button>
                    </div>
                    {([['before', beforeItems], ['after', afterItems], ['photo', photoItems]] as Array<[TreatImgType, TreatImgItem[]]>).map(
                      ([type, typeItems]) =>
                        typeItems.length > 0 && (
                          <div key={type}>
                            <div className={`inline-flex text-[10px] rounded px-1.5 py-0.5 mb-1 ${TYPE_COLOR[type]}`}>
                              {TYPE_LABEL[type]}
                            </div>
                            <div className="grid grid-cols-3 gap-1">
                              {typeItems.map((img) => {
                                const selected = selectedPaths.has(img.path);
                                return (
                                <div key={img.path} className="relative group aspect-square">
                                  <img
                                    src={img.signedUrl}
                                    alt={img.name}
                                    data-testid="treat-img-thumb"
                                    className={cn(
                                      'w-full h-full object-cover rounded border cursor-pointer',
                                      selectMode && selected && 'ring-2 ring-teal-500',
                                    )}
                                    onClick={() => {
                                      // T-20260601-foot-CHART-IMG-VIEWER-UX: 선택 모드면 토글, 아니면 라이트박스 (이슈2/3)
                                      if (selectMode) toggleSelect(img.path);
                                      else openLightbox(orderedItems, img);
                                    }}
                                  />
                                  {/* T-20260601-foot-CHART-IMG-VIEWER-UX 이슈3: 선택 체크박스 */}
                                  {selectMode && (
                                    <div
                                      className={cn(
                                        'absolute top-0.5 left-0.5 h-5 w-5 flex items-center justify-center rounded border shadow pointer-events-none',
                                        selected ? 'bg-teal-600 border-teal-600 text-white' : 'bg-white/80 border-gray-300',
                                      )}
                                    >
                                      {selected && <Check className="h-3 w-3" />}
                                    </div>
                                  )}
                                  {/* 삭제 버튼 */}
                                  {!selectMode && (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); remove(img); }}
                                    className="absolute top-0.5 right-0.5 hidden group-hover:flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white shadow"
                                    title="삭제"
                                  >
                                    <Trash2 className="h-2.5 w-2.5" />
                                  </button>
                                  )}
                                  {/* T-20260522-foot-MEDIMG-CAMERA: 회전 편집 버튼 (AC-5) */}
                                  {!selectMode && (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); openEdit(img); }}
                                    className="absolute bottom-0.5 right-0.5 hidden group-hover:flex h-5 w-5 items-center justify-center rounded-full bg-neutral-800 text-white shadow"
                                    title="편집(회전)"
                                  >
                                    <RotateCw className="h-2.5 w-2.5" />
                                  </button>
                                  )}
                                </div>
                                );
                              })}
                            </div>
                          </div>
                        ),
                    )}
                  </div>
                  );
                })()}
              </div>
            );
          })}
        </div>
      )}

      {/* ── T-20260522-foot-MEDIMG-CAMERA: 카메라 모달 (AC-2 ~ AC-4, AC-6) ── */}
      {/* T-20260522-foot-IMGDROP-REMOVE: 수동 업로드 분류 다이얼로그 (AC-2) */}
      {uploadTypeDialogOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60" role="dialog" aria-modal="true">
          <div className="bg-white rounded-2xl p-6 flex flex-col items-center gap-5 w-[min(90vw,400px)] shadow-2xl">
            <p className="text-sm font-semibold text-gray-800">업로드 분류를 선택하세요</p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setUploadType('before');
                  setUploadTypeDialogOpen(false);
                  fileInputRef.current?.click();
                }}
                className="flex flex-col items-center gap-2 px-7 py-5 rounded-2xl bg-slate-600 hover:bg-slate-700 active:bg-slate-800 text-white text-sm font-bold transition min-w-[100px]"
              >
                <Upload className="h-6 w-6" />
                시술 전
              </button>
              <button
                type="button"
                onClick={() => {
                  setUploadType('after');
                  setUploadTypeDialogOpen(false);
                  fileInputRef.current?.click();
                }}
                className="flex flex-col items-center gap-2 px-7 py-5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-sm font-bold transition min-w-[100px]"
              >
                <Upload className="h-6 w-6" />
                시술 후
              </button>
              <button
                type="button"
                onClick={() => {
                  setUploadType('photo');
                  setUploadTypeDialogOpen(false);
                  fileInputRef.current?.click();
                }}
                className="flex flex-col items-center gap-2 px-7 py-5 rounded-2xl bg-gray-500 hover:bg-gray-600 active:bg-gray-700 text-white text-sm font-bold transition min-w-[100px]"
              >
                <Upload className="h-6 w-6" />
                기타
              </button>
            </div>
            <button
              type="button"
              onClick={() => setUploadTypeDialogOpen(false)}
              className="text-gray-400 hover:text-gray-600 text-sm underline transition"
            >
              취소
            </button>
          </div>
        </div>
      )}

      {cameraOpen && (
        <div className="fixed inset-0 z-[200] flex flex-col bg-black" role="dialog" aria-modal="true">
          {/* 숨김 canvas — 스냅샷 캡처용 */}
          <canvas ref={canvasRef} className="hidden" />

          {cameraPhase === 'select-type' ? (
            /* ── 단계 1: 시술 전/후 선택 (AC-2) ── */
            <div className="flex flex-col items-center justify-center flex-1 gap-6 p-8">
              <p className="text-white text-xl font-semibold">촬영 분류를 선택하세요</p>
              {cameraError && (
                <p className="text-red-400 text-sm text-center max-w-xs">{cameraError}</p>
              )}
              <div className="flex gap-4">
                <button
                  onClick={() => selectTypeAndStart('before')}
                  className="flex flex-col items-center gap-2 px-10 py-6 rounded-2xl bg-slate-600 hover:bg-slate-700 active:bg-slate-800 text-white text-lg font-bold transition min-w-[140px]"
                >
                  <Camera className="h-8 w-8" />
                  시술 전
                </button>
                <button
                  onClick={() => selectTypeAndStart('after')}
                  className="flex flex-col items-center gap-2 px-10 py-6 rounded-2xl bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-lg font-bold transition min-w-[140px]"
                >
                  <Camera className="h-8 w-8" />
                  시술 후
                </button>
              </div>
              <button
                onClick={closeCamera}
                className="mt-4 text-gray-400 hover:text-white text-sm underline transition"
              >
                취소
              </button>
            </div>
          ) : uploadProgress ? (
            /* ── 업로드 진행 중 (AC-4) ── */
            <div className="flex flex-col items-center justify-center flex-1 gap-6 p-8">
              <Loader2 className="h-12 w-12 text-teal-400 animate-spin" />
              <p className="text-white text-lg font-semibold">
                업로드 중… {uploadProgress.done} / {uploadProgress.total}
              </p>
              <div className="w-64 h-2 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-teal-500 rounded-full transition-all duration-300"
                  style={{ width: `${(uploadProgress.done / uploadProgress.total) * 100}%` }}
                />
              </div>
            </div>
          ) : (
            /* ── 단계 2: 연속 촬영 (AC-3, AC-6) ── */
            <>
              {/* 카메라 뷰포트 — 가로 전체화면 */}
              <div className="relative flex-1 bg-black overflow-hidden">
                <video
                  ref={videoRefCallback}
                  autoPlay
                  playsInline
                  muted
                  disablePictureInPicture
                  // T-20260618-foot-MEDIMG-PINCH-ZOOM: 1-pointer=탭포커스 / 2-pointer=핀치줌 (동일 핸들러 그룹)
                  onPointerDown={handleCameraPointerDown}
                  onPointerMove={handleCameraPointerMove}
                  onPointerUp={handleCameraPointerUp}
                  onPointerCancel={handleCameraPointerUp}
                  onPointerLeave={handleCameraPointerUp}
                  className="absolute inset-0 w-full h-full object-cover cursor-pointer"
                  // FIX T-20260522-foot-MEDIMG-CAMERA: GPU 컴포지팅 레이어 고정
                  // translateZ(0) + willChange: transform → Android WebView 비디오 리페인트 분리
                  // AC-1: 디지털 줌 시 CSS scale로 프리뷰 확대 (하드웨어 줌이면 스트림 자체가 확대 → scale 미적용)
                  // PINCH-ZOOM: touchAction none → 브라우저 기본 2-finger 페이지 줌 가로채기 차단(핀치 신뢰성 확보)
                  style={{
                    transform: !hwZoomActive && zoom > 1 ? `translateZ(0) scale(${zoom})` : 'translateZ(0)',
                    transformOrigin: 'center center',
                    willChange: 'transform',
                    touchAction: 'none',
                  }}
                />
                {/* REOPEN #2: 탭-투-포커스 링 (노란 사각형) */}
                {focusPoint && (
                  <div
                    className="absolute pointer-events-none z-20"
                    style={{
                      left: `${focusPoint.x}%`,
                      top: `${focusPoint.y}%`,
                      transform: 'translate(-50%, -50%)',
                      width: 60,
                      height: 60,
                      border: `2px solid ${isFocusing ? '#facc15' : 'rgba(250,204,21,0.3)'}`,
                      borderRadius: 3,
                      transition: 'border-color 0.3s, opacity 0.3s',
                      opacity: isFocusing ? 1 : 0,
                    }}
                  />
                )}
                {/* REOPEN #2: 초점 안내 문구 (하단, 촬영 없을 때만) */}
                {capturedBlobs.length === 0 && (
                  <div className="absolute bottom-3 left-0 right-0 text-center pointer-events-none z-10">
                    <span className="text-white/50 text-xs">
                      {isFocusing ? '초점 맞추는 중…' : '화면을 탭하면 초점이 맞춰집니다'}
                    </span>
                  </div>
                )}
                {/* AC-1: 줌 컨트롤 (우측 세로 — 태블릿 터치 큰 버튼 + 배율 표시) */}
                <div className="absolute right-3 top-1/2 -translate-y-1/2 z-20 flex flex-col items-center gap-2">
                  <button
                    type="button"
                    data-testid="camera-zoom-in"
                    aria-label="확대"
                    onClick={() => applyZoom(zoom + ZOOM_STEP)}
                    disabled={zoom >= MAX_ZOOM}
                    className="h-12 w-12 rounded-full bg-black/55 hover:bg-black/75 active:bg-black/90 text-white flex items-center justify-center shadow-lg transition disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Plus className="h-6 w-6" />
                  </button>
                  <span
                    data-testid="camera-zoom-level"
                    className="text-white text-xs font-bold bg-black/55 rounded-full px-2 py-1 min-w-[44px] text-center tabular-nums"
                  >
                    {zoom.toFixed(1)}×
                  </span>
                  <button
                    type="button"
                    data-testid="camera-zoom-out"
                    aria-label="축소"
                    onClick={() => applyZoom(zoom - ZOOM_STEP)}
                    disabled={zoom <= 1}
                    className="h-12 w-12 rounded-full bg-black/55 hover:bg-black/75 active:bg-black/90 text-white flex items-center justify-center shadow-lg transition disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Minus className="h-6 w-6" />
                  </button>
                </div>
                {/* 분류 배지 */}
                <div className="absolute top-4 left-4 z-10">
                  <span className={`text-sm font-bold rounded-full px-3 py-1 ${cameraType === 'before' ? 'bg-slate-600 text-white' : 'bg-emerald-600 text-white'}`}>
                    {cameraType === 'before' ? '시술 전' : '시술 후'}
                  </span>
                </div>
                {/* 촬영 미리보기 (우상단) */}
                {capturedBlobs.length > 0 && (
                  <div className="absolute top-4 right-4 z-10 flex flex-col items-end gap-1">
                    <span className="text-white text-xs bg-black/60 rounded px-2 py-0.5 mb-1">{capturedBlobs.length}장 촬영됨</span>
                    <div className="flex flex-wrap gap-1 max-w-[180px] justify-end">
                      {capturedBlobs.map((b, i) => (
                        <div key={i} className="relative">
                          <img src={b.previewUrl} alt={`촬영 ${i + 1}`} className="w-14 h-14 object-cover rounded border-2 border-white shadow" />
                          <button
                            onClick={() => removeCaptured(i)}
                            className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-red-500 text-white flex items-center justify-center text-[9px] font-bold"
                            aria-label="촬영 취소"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* 하단 컨트롤 바 */}
              <div className="flex items-center justify-between px-8 py-5 bg-black gap-4">
                {/* 취소 */}
                <button
                  onClick={closeCamera}
                  className="text-gray-400 hover:text-white text-sm transition min-w-[64px]"
                >
                  취소
                </button>
                {/* 셔터 버튼 (S Pen 터치 대응 — 큰 원형) */}
                <button
                  onClick={capturePhoto}
                  className="h-16 w-16 rounded-full border-4 border-white bg-white/10 hover:bg-white/25 active:bg-white/50 transition flex-shrink-0 shadow-lg"
                  aria-label="촬영"
                />
                {/* 완료 버튼 */}
                <button
                  onClick={uploadCaptured}
                  disabled={capturedBlobs.length === 0}
                  className="text-sm font-semibold transition min-w-[64px] text-right disabled:text-gray-600 text-teal-400 hover:text-teal-300 disabled:cursor-not-allowed"
                >
                  완료 ({capturedBlobs.length})
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── T-20260522-foot-MEDIMG-CAMERA: 이미지 편집 모달 (AC-5) ── */}
      {editingImg && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80" role="dialog" aria-modal="true">
          <div className="bg-white rounded-2xl p-4 flex flex-col items-center gap-4 w-[min(90vw,480px)]">
            <p className="text-sm font-semibold text-gray-800">이미지 편집 — 회전</p>
            <div
              className="w-full flex items-center justify-center overflow-hidden bg-gray-100 rounded-lg"
              style={{ minHeight: 200, maxHeight: '50vh' }}
            >
              <img
                src={editingImg.signedUrl}
                alt="편집 중"
                className="max-w-full object-contain transition-transform duration-200"
                style={{ transform: `rotate(${editRotation}deg)`, maxHeight: '50vh' }}
              />
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setEditRotation((r) => (r - 90 + 360) % 360)}
                disabled={savingRotation}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-gray-300 text-sm hover:bg-gray-50 transition disabled:opacity-50"
              >
                <RotateCcw className="h-4 w-4" /> 좌회전
              </button>
              <button
                onClick={() => setEditRotation((r) => (r + 90) % 360)}
                disabled={savingRotation}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-gray-300 text-sm hover:bg-gray-50 transition disabled:opacity-50"
              >
                <RotateCw className="h-4 w-4" /> 우회전
              </button>
            </div>
            <div className="flex gap-2 w-full">
              <button
                onClick={() => setEditingImg(null)}
                disabled={savingRotation}
                className="flex-1 px-4 py-2 rounded-lg border border-gray-300 text-sm hover:bg-gray-50 transition disabled:opacity-50"
              >
                취소
              </button>
              <button
                onClick={saveRotation}
                disabled={savingRotation || editRotation === 0}
                className="flex-1 px-4 py-2 rounded-lg bg-neutral-800 text-white text-sm font-semibold hover:bg-neutral-900 transition disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                {savingRotation && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                저장
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── T-20260601-foot-CHART-IMG-VIEWER-UX 이슈2: 라이트박스 모달 (좌우 넘김, AC-2) ── */}
      {lightbox && lightbox.items[lightbox.index] && (() => {
        const cur = lightbox.items[lightbox.index];
        const atFirst = lightbox.index === 0;
        const atLast = lightbox.index === lightbox.items.length - 1;
        return (
          <div
            className="fixed inset-0 z-[210] flex flex-col bg-black/90"
            role="dialog"
            aria-modal="true"
            data-testid="img-lightbox"
            onClick={() => setLightbox(null)}
          >
            {/* 상단 바: 인덱스 + 닫기 */}
            <div className="flex items-center justify-between px-4 py-3 text-white" onClick={(e) => e.stopPropagation()}>
              <span className="text-sm font-medium" data-testid="lightbox-index">
                {lightbox.index + 1} / {lightbox.items.length}
                <span className="ml-2 text-white/60">{cur.dateStr} · {TYPE_LABEL[cur.imgType]}</span>
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => downloadImages([cur])}
                  disabled={downloading}
                  className="inline-flex items-center gap-1 text-sm rounded px-3 py-1.5 bg-teal-600 hover:bg-teal-700 transition disabled:opacity-50"
                  title="이 이미지 다운로드"
                >
                  {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  다운로드
                </button>
                <button
                  type="button"
                  onClick={() => setLightbox(null)}
                  className="inline-flex items-center justify-center h-9 w-9 rounded-full bg-white/10 hover:bg-white/20 transition"
                  title="닫기"
                  data-testid="lightbox-close"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* 본문: 이미지 + 좌우 화살표 */}
            <div className="relative flex-1 flex items-center justify-center overflow-hidden" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                onClick={() => lightboxStep(-1)}
                disabled={atFirst}
                data-testid="lightbox-prev"
                className="absolute left-3 z-10 flex items-center justify-center h-12 w-12 rounded-full bg-white/10 text-white hover:bg-white/25 transition disabled:opacity-20 disabled:cursor-not-allowed"
                title="이전 (←)"
              >
                <ChevronLeft className="h-7 w-7" />
              </button>
              <img
                src={cur.signedUrl}
                alt={cur.name}
                className="max-h-full max-w-full object-contain select-none"
              />
              <button
                type="button"
                onClick={() => lightboxStep(1)}
                disabled={atLast}
                data-testid="lightbox-next"
                className="absolute right-3 z-10 flex items-center justify-center h-12 w-12 rounded-full bg-white/10 text-white hover:bg-white/25 transition disabled:opacity-20 disabled:cursor-not-allowed"
                title="다음 (→)"
              >
                <ChevronRight className="h-7 w-7" />
              </button>
            </div>
          </div>
        );
      })()}

      {/* ── T-20260609-foot-MEDIMG-COMPARE-GRID (AC-1~AC-4): 적응형 비교 그리드 오버레이 ── */}
      {/* read-only: 편집/삭제/이동 없음. 닫기 시 선택 상태(selectMode/selectedPaths) 보존(AC-3). */}
      {compareItems && compareItems.length >= 2 && (
        <div
          className="fixed inset-0 z-[210] flex flex-col bg-black/90"
          role="dialog"
          aria-modal="true"
          data-testid="img-compare"
          onClick={() => setCompareItems(null)}
        >
          {/* 상단 바: 제목 + 닫기 */}
          <div className="flex items-center justify-between px-4 py-3 text-white" onClick={(e) => e.stopPropagation()}>
            <span className="text-sm font-medium flex items-center gap-1.5">
              <Columns2 className="h-4 w-4" />
              이미지 비교 ({compareItems.length}장)
            </span>
            <button
              type="button"
              onClick={() => setCompareItems(null)}
              className="inline-flex items-center justify-center h-9 w-9 rounded-full bg-white/10 hover:bg-white/20 transition"
              title="닫기"
              data-testid="compare-close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* 본문: 적응형 그리드 (2장=1×2, 3~4장=2×2) */}
          <div
            className="flex-1 grid grid-cols-2 gap-2 p-3 pt-0 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {compareItems.map((img) => (
              <div
                key={img.path}
                data-testid="compare-cell"
                className="relative flex flex-col items-center justify-center min-h-0 rounded-lg border border-white/15 bg-black/40 overflow-hidden"
              >
                <img
                  src={img.signedUrl}
                  alt={img.name}
                  className="flex-1 min-h-0 max-w-full object-contain select-none"
                />
                {/* AC-2: 각 셀 하단 라벨 — 날짜 · 분류(메모 데이터 부재 → 분류로 식별) */}
                <div className="w-full px-2 py-1 text-center text-xs text-white bg-black/60 flex items-center justify-center gap-1.5">
                  <span className="font-medium">{img.dateStr}</span>
                  <span className={cn('rounded px-1.5 py-0.5 text-[10px]', TYPE_COLOR[img.imgType])}>
                    {TYPE_LABEL[img.imgType]}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// T-20260602-foot-SLOT-DWELL-TIME (B안): fn_check_in_slot_dwell RPC 반환 행
interface SlotDwellSeg {
  check_in_id: string;
  seq: number;
  status: string;
  entered_at: string;
  exited_at: string;
  duration_seconds: number;
  is_current: boolean;
}

// 체류시간(초) → "1시간 23분" / "12분 5초" / "45초" 한글 포맷 (천단위·Asia/Seoul UX 일관)
function formatDwell(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}시간 ${m}분`;
  if (m > 0) return `${m}분 ${sec}초`;
  return `${sec}초`;
}

// T-20260516-foot-CHART2-STATE-UNIFY: CustomerChartSheet 내에서 prop으로 주입 가능 (MemoryRouter 불필요)
export default function CustomerChartPage({ customerId: propCustomerId }: { customerId?: string } = {}) {
  const params = useParams<{ customerId: string }>();
  const customerId = propCustomerId ?? params.customerId;
  // T-20260609-foot-VISITLOG-NAMING-CLARIFY: 진료차트 우측 패널 deep-link 진입(?medchart=visit_hist 등).
  //   값이 우측 탭 키면 그 탭으로, 그 외 truthy면 기본 탭으로 패널을 열어 '방문이력' 라벨을 노출 보장.
  const [searchParams] = useSearchParams();
  const medchartParam = searchParams.get('medchart');
  const RIGHT_TAB_KEYS = ['rx', 'phrase', 'super', 'visit_hist', 'images', 'consult'] as const;
  const medchartInitialTab = (RIGHT_TAB_KEYS as readonly string[]).includes(medchartParam ?? '')
    ? (medchartParam as 'rx' | 'phrase' | 'super' | 'visit_hist' | 'images' | 'consult')
    : undefined;
  const { profile, loading: authLoading } = useAuth();
  // T-20260618-foot-STAFF-CHART2-RRN-NOSAVE (Option B): 주민번호 값 조회 권한 = prod rrn_decrypt 게이트(admin/manager/director).
  //   권한 없는 직원은 rrn_decrypt 가 항상 null 을 반환 → 저장 여부를 빈 값으로 구분 불가.
  //   이 플래그로 '미입력'(=저장 안 됨 오해) 대신 '조회 권한 없음' 안내문을 띄운다. DB 권한은 변경 없음.
  const userCanViewRrn = canViewRrn(profile?.role ?? '');
  // T-20260508-foot-C22-RESV-EDIT: CRM 시간대 연동
  const clinic = useClinic();
  // T-20260616-foot-LASER-TIMER-SETTING-CONNECT: 비가열 레이저 타이머 시작 버튼 시간 단위.
  // 클리닉 설정(clinics.laser_time_units, ClinicSettingsTab에서 저장)을 READ. 비었거나 null이면 폴백.
  // T-20260616-foot-LASER-TIMER-SETTING-NOREFLECT: useClinic 이 window focus/visibility 시
  //   force 재조회하므로, 다른 스테이션에서 설정을 바꾼 뒤 이 차트로 전환(refocus)하면
  //   하드리로드 없이도 버튼이 갱신된다(getClinic 싱글톤 영구 staleness 해소).
  const laserTimerUnits = useMemo<number[]>(
    () => (clinic?.laser_time_units?.length ? clinic.laser_time_units : LASER_TIMER_FALLBACK_UNITS),
    [clinic?.laser_time_units],
  );
  // T-20260514-foot-CHART2-OPEN-BUG: Sheet 모드에서 닫기 콜백 (null이면 독립 페이지 모드)
  const chartSheetClose = useChartSheetClose();
  // T-20260611-foot-CHART2-SAVE-DIRTY-RESET: 본문 저장 성공 시 Sheet 미저장 가드 clean 리셋 (독립 페이지 모드 no-op)
  const markChartClean = useChartSheetMarkClean();

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [packages, setPackages] = useState<PackageWithRemaining[]>([]);
  const [visits, setVisits] = useState<CheckIn[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [pkgPayments, setPkgPayments] = useState<PackagePayment[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [checkInHistory, setCheckInHistory] = useState<CheckIn[]>([]);
  const [latestCheckIn, setLatestCheckIn] = useState<CheckIn | null>(null);
  // T-20260602-foot-SLOT-DWELL-TIME (B안): 방문건별 슬롯 체류시간 이력 (fn_check_in_slot_dwell)
  const [slotDwell, setSlotDwell] = useState<SlotDwellSeg[]>([]);
  const [slotDwellLoading, setSlotDwellLoading] = useState(false);
  const [slotDwellLoaded, setSlotDwellLoaded] = useState(false);
  // T-20260603-foot-SLOT-DWELL-LIVE-TICK: 진행중(is_current) 세그먼트 경과시간 실시간 카운트용 now 틱
  const [slotDwellNowMs, setSlotDwellNowMs] = useState(() => Date.now());
  // T-20260515-foot-DOC-REISSUE-BTN: 서류 재발급 모달 대상 체크인
  const [docReissueCheckIn, setDocReissueCheckIn] = useState<CheckIn | null>(null);
  const [prescriptions, setPrescriptions] = useState<PrescriptionRow[]>([]);
  const [consentEntries, setConsentEntries] = useState<{ form_type: string; signed_at: string }[]>([]);
  // T-20260519-foot-PENCHART-FORMS: printed_at nullable 대응 → signed_at 폴백
  // T-20260520-foot-PENCHART-VIEW-SPLIT: field_data 추가 (canvas_file 조회용)
  const [submissionEntries, setSubmissionEntries] = useState<{
    check_in_id: string;
    template_key?: string;
    printed_at: string | null;
    signed_at?: string | null;
    field_data?: Record<string, unknown> | null;
  }[]>([]);
  // T-20260602-foot-CHART2-HEALTHQ-VIEWER: 자가작성 발건강질문지 결과 (health_q_results)
  // 자가작성은 form_submissions가 아닌 health_q_results 에 저장되므로 별도 로드 →
  // 상담내역 그룹3 [내용보기] 활성화 + 다이얼로그 구조화 렌더에 사용
  const [healthQResults, setHealthQResults] = useState<HQResult[]>([]);
  // T-20260520-foot-PENCHART-VIEW-SPLIT: 이미지 뷰어 상태
  const [submissionImages, setSubmissionImages] = useState<{ url: string; date: string; label: string }[]>([]);
  const [submissionImagesLoading, setSubmissionImagesLoading] = useState(false);
  // T-20260430-foot-PRESCREEN-CHECKLIST: 사전 체크리스트 응답
  const [checklistEntries, setChecklistEntries] = useState<{
    id: string;
    completed_at: string | null;
    checklist_data: Record<string, unknown>;
  }[]>([]);
  const [packageSessions, setPackageSessions] = useState<PackageSession[]>([]);
  const [openPackagePurchase, setOpenPackagePurchase] = useState(false);
  // T-20260511-foot-C2-PKG-MERGE-ADDON: 기존 패키지에 항목 추가
  const [openPackageAddon, setOpenPackageAddon] = useState(false);
  const [loading, setLoading] = useState(true);
  // T-20260527-foot-MEDCHART-TAB-REAPPEAR: 진료차트 패널 열림 상태 (데이터 유무 무관 항상 렌더 가능)
  const [medicalChartOpen, setMedicalChartOpen] = useState(false);
  // T-20260609-foot-VISITLOG-NAMING-CLARIFY: ?medchart 진입 시 고객 로드 후 진료차트 패널 1회 자동 오픈.
  //   (패널 안에 '방문이력' 탭/라벨이 있음 — deep-link 노출 경로 보장. 사용자가 닫으면 재오픈 안 함.)
  const medchartAutoOpenedRef = useRef(false);

  // T-20260507-foot-CHART2-FULL-LAYOUT: 탭 네비게이션 (전능CRM 이중 탭)
  // T-20260522-foot-CHART2-TAB-PENCHART: 기본 탭 → 펜차트 (현장 요청)
  const [chartTab, setChartTab] = useState<string>('pen_chart');
  const [chartTabGroup, setChartTabGroup] = useState<'clinical' | 'history'>('clinical');
  // T-20260511-foot-C2-INSURANCE-AUTO-CALC: 건보 자격등급 변경 감지 트리거
  const [insuranceGradeRefreshKey, setInsuranceGradeRefreshKey] = useState(0);
  // T-20260507-foot-CHART2-INSURANCE-FIELDS: 주소지 인라인 편집
  // T-20260513-foot-C21-INPUT-ALWAYS-ACTIVE: editingAddress 제거 — 항상 활성화
  const [addressText, setAddressText] = useState('');
  // T-20260510-foot-ADDRESS-DETAIL-FIX: 상세주소 입력란
  const [addressDetailText, setAddressDetailText] = useState('');
  // T-20260508-foot-CUST-FORM-REVAMP: 신규 폼 필드
  // T-20260513-foot-C21-INPUT-ALWAYS-ACTIVE: editingEmail/editingPassport 제거 — 항상 활성화
  const [emailText, setEmailText] = useState('');
  const [passportText, setPassportText] = useState('');
  // T-20260515-foot-REFERRAL-NAME AC-2: 소개자 성함 로컬 상태 (optimistic update)
  const [referralNameText, setReferralNameText] = useState('');
  // T-20260513-foot-C21-TAB-RESTRUCTURE-B: 진료이미지 출력용 URL 목록
  const [treatmentImageUrls, setTreatmentImageUrls] = useState<string[]>([]);
  // T-20260513-foot-C21-INPUT-ALWAYS-ACTIVE: 예약메모 인라인 편집 상태
  const [resvMemoInputs, setResvMemoInputs] = useState<Record<string, string>>({});
  // T-20260615-foot-RESVTAB-MEMO-ICON-SCROLLFIX AC-1: 예약메모 표시(✏️)↔편집폼 토글 대상 예약 id (null=전부 display-only)
  const [editingResvMemoId, setEditingResvMemoId] = useState<string | null>(null);
  // T-20260513-foot-C21-PHONE-EDIT-BTN: 핸드폰번호 인라인 편집
  const [editingPhone, setEditingPhone] = useState(false);
  const [phoneText, setPhoneText] = useState('');
  const [postalCodeText, setPostalCodeText] = useState(''); // editingPostalCode 제거 — SAVE-UNIFY
  const [savingField, setSavingField] = useState(false);
  // C2-STAFF-DROPDOWN: 실제 직원 목록 (coordinator + consultant + director)
  // T-20260522-foot-STAFF-NAME-UNIFY: display_name(구성명) 추가
  const [staffList, setStaffList] = useState<{id: string; name: string; display_name: string | null; role: string}[]>([]);
  // C2-PKG-TICKET-TABLE: 치료사 목록 (role = 'therapist')
  const [therapistList, setTherapistList] = useState<{id: string; name: string}[]>([]);
  // T-20260523-foot-ACCT-HISTORY-VERIFY: 현재 로그인 직원의 staff.id (performed_by 자동 세팅용)
  // 치료사/기사 계정으로 로그인 시 회차 차감 폼에 본인 자동 세팅 → RLS 준수 + 이력 정확성 보장
  const [currentUserStaffId, setCurrentUserStaffId] = useState<string>('');
  // C2-PKG-TICKET-TABLE: 회차 차감 + 치료사 드롭다운 다이얼로그
  const [useSessionDlg, setUseSessionDlg] = useState<{
    open: boolean;
    packageId: string;
    packageName: string;
    nextSession: number;
  } | null>(null);
  const [sessionDlgForm, setSessionDlgForm] = useState({
    therapistId: '',
    sessionDate: format(new Date(), 'yyyy-MM-dd'),
    sessionType: 'heated_laser',
  });
  const [savingSession, setSavingSession] = useState(false);
  // C2-RESV-MINI-POPUP: 예약하기 미니창
  const [openResvMiniPopup, setOpenResvMiniPopup] = useState(false);
  // T-20260508-foot-C22-RESV-EDIT: endTime 삭제 (불필요)
  // T-20260524-foot-DESIG-BIDIRECT: designatedTherapistId 추가 (AC-2 역동기화용, 빈 상태로 시작 — AC-4)
  const [resvMiniForm, setResvMiniForm] = useState({ date: '', startTime: '', memo: '', designatedTherapistId: '' });
  const [savingResvMini, setSavingResvMini] = useState(false);
  // C2-RESV-DETAIL-PANEL: 예약상세 탭
  const [resvDetailTab, setResvDetailTab] = useState<'예약' | '상담' | '치료메모'>('예약');
  // T-20260523-foot-LASER-TIMER 위치이동 (FIX-20260525): 2번차트 3구역 [상세] 탭 상단 타이머
  const [activeTimer, setActiveTimer] = useState<TimerRecord | null>(null);
  const [timerRemainingSecs, setTimerRemainingSecs] = useState(0);
  const [timerLoading, setTimerLoading] = useState(false);
  const [stopConfirmOpen, setStopConfirmOpen] = useState(false);
  const [resvDetailForm, setResvDetailForm] = useState({
    date: '', startTime: '',
    memo: '', etcMemo: '',
  });
  const [savingResvDetail, setSavingResvDetail] = useState(false);
  // C23-DETAIL-SIMPLIFY: 상담탭 상태
  const [consultationStaffId, setConsultationStaffId] = useState('');
  const [consultationMemo, setConsultationMemo] = useState('');
  const [savingConsultation, setSavingConsultation] = useState(false);
  // C23-PHRASE-LINK: 3구역[상세] 상용구.
  // T-20260618-foot-PHRASE-REORDER-CUSTCHART-MENU CS-AC-3 (cross-party 확정):
  //   2번차트(고객차트) 3구역[상세] 예약·상담·치료메모 입력부는 고객차트 surface(phrase_type='customer_chart') 상용구를 호출.
  //   기존 category='general'(phrase_type 무격리, 펜차트/진료차트 general 혼입)에서 customer_chart 전용으로 전환 → surface 격리.
  //   ※ 기존 general 상용구를 고객차트로 옮기는 backfill은 별건(datafix) — 현장은 [상용구(고객차트)]에서 신규 등록.
  const [customerChartPhrases, setCustomerChartPhrases] = useState<{ id: number; name: string; content: string }[]>([]);
  // T-20260517-foot-C2-CONSULT-DOCS: 필수서류 [작성]/[내용보기] 다이얼로그 상태
  const [consentDialogFormType, setConsentDialogFormType] = useState<FormType | null>(null);
  // T-20260520-foot-PENCHART-VIEW-SPLIT: 그룹3 발건강 질문지 추가
  const [viewDocGroup, setViewDocGroup] = useState<1 | 2 | 3 | null>(null);
  // T-20260517-foot-C2-CONSULT-DOCS AC-R1: 합본 양식 모달
  const [showChecklistForm, setShowChecklistForm] = useState(false);
  const [showConsentFormModal, setShowConsentFormModal] = useState(false);
  // T-20260520-foot-MEMO-HISTORY: 치료메모 히스토리 누적 방식
  const [treatmentMemos, setTreatmentMemos] = useState<TreatmentMemoEntry[]>([]);
  const [treatmentMemosLoaded, setTreatmentMemosLoaded] = useState(false);
  // AC-3 (T-20260520-foot-MEMO-SAVE-ERR): 테이블 미존재 시 graceful fallback 플래그
  const [treatmentMemoUnavailable, setTreatmentMemoUnavailable] = useState(false);
  const [newMemoText, setNewMemoText] = useState('');
  const [savingNewMemo, setSavingNewMemo] = useState(false);
  const [editingMemoId, setEditingMemoId] = useState<string | null>(null);
  const [editingMemoText, setEditingMemoText] = useState('');
  const [savingEditMemo, setSavingEditMemo] = useState(false);
  // T-20260526-foot-VISIT-HIST-FILTER: 방문이력 펼침/접기 + 메모유형 필터
  const [visitHistAllExpanded, setVisitHistAllExpanded] = useState(false);
  const [visitHistExpandedIds, setVisitHistExpandedIds] = useState<Set<string>>(new Set());
  const [visitHistFilters, setVisitHistFilters] = useState<Set<string>>(new Set());
  // C21-RESIDENT-ID: 주민번호 입력/표시
  // T-20260511-foot-SSN-SAVE-BUG: 앞6자리 plain + 뒷7자리 masked (2-split input)
  const [editingRrn, setEditingRrn] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_rrnText, setRrnText] = useState(''); // legacy setter — reset after save
  const [rrnFront, setRrnFront] = useState(''); // 앞 6자리 (생년월일)
  const [rrnBack, setRrnBack] = useState('');  // 뒷 7자리 (비밀번호 마스킹)
  const rrnFrontRef = useRef<HTMLInputElement>(null); // T-20260511-foot-SSN-FRONT-INPUT-BUG: autoFocus 대신 ref 사용
  const rrnBackRef = useRef<HTMLInputElement>(null);
  const [rrnMasked, setRrnMasked] = useState<string | null | undefined>(undefined); // undefined=로드전, null=없음
  // T-20260523-foot-PENCHART-FORM-AUTOFILL AC-8: 전체 표시용 (펜차트 보험차트 자동채움 전용)
  const [rrnFull, setRrnFull] = useState<string | null | undefined>(undefined); // undefined=로드전, null=없음
  // C22-PKG-DEDUCT: 인라인 차감 폼 (복구 — T-20260510-foot-C22-SECTION-MERGE regression fix)
  const [c22DeductForm, setC22DeductForm] = useState({
    sessionDate: format(new Date(), 'yyyy-MM-dd'),
    therapistId: '',
    treatmentType: 'heated_laser' as string,
    packageId: '',  // 복수 활성 패키지 지원
  });
  const [savingC22Deduct, setSavingC22Deduct] = useState(false);
  // T-20260522-foot-DESIGNATED-THERAPIST: 지정 치료사 상태
  const [designatedTherapistId, setDesignatedTherapistId] = useState<string>('');
  const [savingDesignatedTherapist, setSavingDesignatedTherapist] = useState(false);
  // T-20260524-foot-DESIG-SAVE-ERR: 인라인 배지 → toast.success 유지 (배지 렌더링 미사용)
  // T-20260516-foot-HEALER-RESV-BTN → T-20260522-foot-PKG-HEALER-DEDUCT 통합으로 healerFlagLoading 폐기
  // T-20260522-foot-PKG-HEALER-DEDUCT: [힐러예약 후 차감] 복합 동작 로딩
  const [savingHealerDeduct, setSavingHealerDeduct] = useState(false);
  // T-20260611-foot-DEDUCT-DUPKEY-SUBTHERAPIST: 같은 내원(check_in_id)·같은 패키지 재차감 감지 시 이중선택 모달
  // ★ 충돌 판정은 오직 (package_id, check_in_id) 중복 — 지정치료사 유무·값과 무관 (planner INFO 2026-06-11)
  const [dupDeductModal, setDupDeductModal] = useState<{
    targetPkgId: string;
    deductCheckInId: string;
    existingSessionId: string;
    existingSessionNumber: number;
    existingPerformedBy: string | null;
    usedCount: number;
    therapistId: string;
    treatmentType: string;
    sessionDate: string;
    source: 'c22' | 'healer';
  } | null>(null);
  const [dupDeductBusy, setDupDeductBusy] = useState(false);
  // C22-RESV-EDIT: 예약 수정 모달
  const [editResvId, setEditResvId] = useState<string | null>(null);
  // T-20260524-foot-THERAPIST-BISYNC: therapistId + visitType 추가 (AC-2 역동기화용)
  const [editResvForm, setEditResvForm] = useState({ date: '', startTime: '', memo: '', therapistId: '', visitType: '' });
  const [savingEditResv, setSavingEditResv] = useState(false);
  // T-20260515-foot-INLINE-RESV: 강화 인라인 예약 패널 (슬롯 그리드 + 담당의 + 진료종류)
  const [inlineResvOpen, setInlineResvOpen] = useState(false);
  const [inlineResvDate, setInlineResvDate] = useState('');
  const [inlineResvSlotMap, setInlineResvSlotMap] = useState<Record<string, Array<{ name: string; visit_type: VisitType; therapist: string | null }>>>({});
  const [inlineResvLoading, setInlineResvLoading] = useState(false);
  const [savingInlineResv, setSavingInlineResv] = useState(false);
  const [inlineResvMemo, setInlineResvMemo] = useState('');
  // T-20260524-foot-THERAPIST-BISYNC: 인라인 예약 치료사 (AC-1 pre-fill + AC-2 역동기화)
  const [inlineResvTherapistId, setInlineResvTherapistId] = useState('');
  // T-20260511-foot-C21-PKG-USAGE-EDIT: 시술내역 수정/삭제 다이얼로그
  const [editSessionDlg, setEditSessionDlg] = useState<PackageSession | null>(null);
  const [editSessionForm, setEditSessionForm] = useState({
    sessionType: 'heated_laser',
    sessionDate: format(new Date(), 'yyyy-MM-dd'),
    therapistId: '',
  });
  const [savingEditSession, setSavingEditSession] = useState(false);
  // T-20260522-foot-PKG-EDIT-DEL: 구매 패키지 수정 다이얼로그
  const [editPkgDlg, setEditPkgDlg] = useState<PackageWithRemaining | null>(null);
  const [editPkgForm, setEditPkgForm] = useState({
    package_name: '',
    total_amount: '',
    heated_sessions: '', heated_unit_price: '',
    unheated_sessions: '', unheated_unit_price: '',
    podologe_sessions: '', podologe_unit_price: '',
    iv_sessions: '', iv_unit_price: '',
    trial_sessions: '', trial_unit_price: '',
    reborn_sessions: '', reborn_unit_price: '',
  });
  const [savingEditPkg, setSavingEditPkg] = useState(false);
  // T-20260522-foot-PKG-EDIT-DEL: 구매 패키지 삭제 확인 다이얼로그
  const [deletePkgDlg, setDeletePkgDlg] = useState<PackageWithRemaining | null>(null);
  const [deletingPkg, setDeletingPkg] = useState(false);
  // T-20260510-foot-C21-SAVE-UNIFY: 고객정보 패널 통합 저장 로딩 상태
  const [savingInfoPanel, setSavingInfoPanel] = useState(false);
  // T-20260519-foot-PRECHECKIN-CHART AC-3: 내원콜 방문 확인 로딩 상태
  const [confirmingVisit, setConfirmingVisit] = useState(false);
  // T-20260511-foot-C21-SAVE-DIRTY-AUTOSAVE: isDirty 패턴 + 자동저장 인디케이터
  const [isDirty, setIsDirty] = useState(false);
  const [showAutoSaved, setShowAutoSaved] = useState(false);
  // T-20260514-foot-C2-PAYMENT-SYNC AC-3: 수납 이력 확장 행 상태
  const [expandedPaymentId, setExpandedPaymentId] = useState<string | null>(null);
  // T-20260513-foot-C21-TAB-RESTRUCTURE-C: 메시지 이력 + 수동 입력
  const [messageLogs, setMessageLogs] = useState<MessageLog[]>([]);
  const [messageForm, setMessageForm] = useState<{
    content: string;
    message_type: 'sms' | 'kakao' | 'manual';
  }>({ content: '', message_type: 'manual' });
  const [savingMessage, setSavingMessage] = useState(false);
  // T-20260525-foot-MESSAGING-V1 AC-3: 자동 SMS 발송 이력 (notification_logs)
  const [notificationLogs, setNotificationLogs] = useState<NotificationLog[]>([]);

  // T-20260522-foot-ALT-BADGE: ALT 토글 상태 (S2)
  const [altStatus, setAltStatus] = useState(false);
  const [altDetail, setAltDetail] = useState('');
  const [savingAlt, setSavingAlt] = useState(false);

  // C23-PHRASE-LINK / CS-AC-3: 마운트 시 고객차트 surface 상용구(customer_chart, 전체 카테고리) 한 번 조회.
  //   sort_order 오름차순 — 상용구관리>[상용구(고객차트)]의 순서변경(↑↓)이 그대로 반영됨.
  useEffect(() => {
    supabase
      .from('phrase_templates')
      .select('id, name, content')
      .eq('phrase_type', 'customer_chart')
      .eq('is_active', true)
      .order('sort_order')
      .then(({ data }) => { if (data) setCustomerChartPhrases(data); });
  }, []);

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
      // T-20260522-foot-DESIGNATED-THERAPIST: 지정 치료사 초기화
      setDesignatedTherapistId((custData as Customer).designated_therapist_id ?? '');
      setAddressText((custData as Customer).address ?? '');
      setAddressDetailText((custData as Customer).address_detail ?? '');
      setEmailText((custData as Customer).customer_email ?? '');
      setPassportText((custData as Customer).passport_number ?? '');
      setReferralNameText((custData as Customer).referral_name ?? '');
      setPostalCodeText((custData as Customer).postal_code ?? '');
      // C23-DETAIL-SIMPLIFY: 2-3 상세 패널 폼 데이터 초기화
      setResvDetailForm({
        date: '', startTime: '',
        memo: (custData as Customer).customer_memo ?? '',
        etcMemo: (custData as Customer).memo ?? '',
      });
      setConsultationMemo((custData as Customer).tm_memo ?? '');
      // AC-6 쌍방연동: consultationStaffId 초기값을 Zone 1 assigned_staff_id 와 동기화
      setConsultationStaffId((custData as Customer).assigned_staff_id ?? '');
      // T-20260522-foot-ALT-BADGE: ALT 초기값 로드 (S2)
      setAltStatus((custData as Customer).alt_status ?? false);
      setAltDetail((custData as Customer).alt_detail ?? '');
      // T-20260520-foot-MEMO-HISTORY: 메모 히스토리는 lazy load (탭 진입 시 로드)
      setTreatmentMemos([]);
      setTreatmentMemosLoaded(false);

      // T-20260522-foot-PERF-TUNING OPT-5: staff 2쿼리 → 1쿼리 + 클라이언트 분기
      // + staff / 6 main data / 2 checklist 전체 병렬 실행 (이전: staff → 6 main → N RPC → sessions → checklists)
      const clinicId = (custData as Customer).clinic_id;
      const [
        staffAllRes,
        pkgRes, visitRes, payRes, pkgPayRes, resvRes, ciHistRes,
        clRes, subRes, hqRes,
      ] = await Promise.all([
        // C2-STAFF-DROPDOWN: 담당자(consultant/coordinator/director) + 치료사 1쿼리 통합
        // T-20260523-foot-PKG-DEDUCT-THERAPIST bugfix: display_name 컬럼 미존재 → 쿼리 400 에러 → 치료사 드롭다운 비어있음
        // display_name 컬럼은 별도 migration(20260523050000)으로 추가될 예정. UI는 display_name||name fallback 유지.
        supabase.from('staff').select('id, name, role').eq('clinic_id', clinicId).eq('active', true)
          .in('role', ['consultant', 'coordinator', 'director', 'therapist']).order('name', { ascending: true }),
        // 6 main data (기존 병렬 그룹)
        supabase.from('packages').select('*').eq('customer_id', customerId).order('created_at', { ascending: false }),  // T-20260520-foot-PKG-SORT
        supabase.from('check_ins').select('*').eq('customer_id', customerId).order('checked_in_at', { ascending: false }).limit(50),
        supabase.from('payments').select('*').eq('customer_id', customerId).order('created_at', { ascending: false }).limit(50),
        supabase.from('package_payments').select('*').eq('customer_id', customerId).order('created_at', { ascending: false }).limit(50),
        supabase.from('reservations').select('*').eq('customer_id', customerId).order('reservation_date', { ascending: false }).limit(30),
        supabase.from('check_ins').select('*').eq('customer_id', customerId).neq('status', 'cancelled').order('checked_in_at', { ascending: false }).limit(100),
        // T-20260519-foot-CHART-BEFORE-CHECKIN AC-2: checklists + form_submissions 병렬 선행 (customerId만 필요)
        // T-20260613-foot-DUMMY-CHART-FIELD-NOTOPEN: started_at 컬럼은 checklists 테이블에 미존재 →
        //   매 차트 오픈마다 400(42703) 발생 + 체크리스트 로드 실패. select 에서 사용처 없는 started_at 제거.
        supabase.from('checklists').select('id, completed_at, checklist_data').eq('customer_id', customerId)
          .not('completed_at', 'is', null).order('completed_at', { ascending: false }).limit(10),
        supabase.from('form_submissions').select('check_in_id, printed_at, signed_at, field_data, form_templates!template_id(form_key)')
          .eq('customer_id', customerId).order('printed_at', { ascending: false, nullsFirst: false }).limit(30),
        // T-20260602-foot-CHART2-HEALTHQ-VIEWER: 자가작성 발건강질문지 (clinic 스코프 — RLS도 동일 강제)
        supabase.from('health_q_results').select('id, form_type, form_data, submitted_at, created_at')
          .eq('customer_id', customerId).eq('clinic_id', clinicId).order('submitted_at', { ascending: false }).limit(10),
      ]);

      // staff 분기: role별 분류
      // T-20260522-foot-STAFF-NAME-UNIFY: display_name 포함
      const allStaff = (staffAllRes.data ?? []) as {id: string; name: string; display_name: string | null; role: string}[];
      setStaffList(allStaff.filter((s) => ['consultant', 'coordinator', 'director'].includes(s.role)));
      setTherapistList(allStaff.filter((s) => s.role === 'therapist'));

      const pkgs = (pkgRes.data ?? []) as Package[];

      // T-20260522-foot-PERF-TUNING OPT-4: package_sessions 1회 조회 → remaining 클라이언트 집계
      // (이전: N × get_package_remaining RPC 호출)
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
        // sessData를 재사용해 remaining 계산 — N RPC 완전 제거
        const remainingArr = computeRemainingFromSessionRows(
          pkgs,
          (sessData ?? []) as _SessRow[],
        );
        setPackages(pkgs.map((p, i) => ({ ...p, remaining: remainingArr[i] ?? null })));
      } else {
        setPackages([]);
      }

      setVisits((visitRes.data ?? []) as CheckIn[]);
      setPayments((payRes.data ?? []) as Payment[]);
      setPkgPayments((pkgPayRes.data ?? []) as PackagePayment[]);
      setReservations((resvRes.data ?? []) as Reservation[]);

      const ciHistory = (ciHistRes.data ?? []) as CheckIn[];
      setCheckInHistory(ciHistory);
      setLatestCheckIn(ciHistory[0] ?? null);
      // T-20260602-foot-SLOT-DWELL-TIME (B안): 방문이력 갱신 시 체류시간 재로딩 트리거
      setSlotDwellLoaded(false);
      setSlotDwell([]);

      const checkInIds = ciHistory.map((ci: CheckIn) => ci.id);
      setChecklistEntries((clRes.data ?? []) as { id: string; completed_at: string | null; checklist_data: Record<string, unknown> }[]);
      // T-20260520-foot-PENCHART-REFINE AC-1:
      // builtin 템플릿 저장 시 template_id FK 없음 → JOIN 결과 null → template_key null
      // field_data.form_key fallback 으로 [내용보기] 활성화 보장
      setSubmissionEntries(
        (subRes.data ?? []).map((s: Record<string, unknown>) => ({
          check_in_id: s.check_in_id as string,
          template_key: (s.form_templates as { form_key: string } | null)?.form_key
            ?? ((s.field_data as Record<string, unknown> | null)?.form_key as string | undefined),
          printed_at: (s.printed_at as string | null) ?? null,
          signed_at:  (s.signed_at  as string | null) ?? null,
          field_data: (s.field_data as Record<string, unknown> | null) ?? null,
        }))
      );
      // T-20260602-foot-CHART2-HEALTHQ-VIEWER: 자가작성 발건강질문지 결과 적재
      setHealthQResults((hqRes.data ?? []) as HQResult[]);

      if (checkInIds.length > 0) {
        const [rxRes, consentRes] = await Promise.all([
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
        ]);
        setPrescriptions((rxRes.data ?? []) as PrescriptionRow[]);
        setConsentEntries((consentRes.data ?? []) as { form_type: string; signed_at: string }[]);
      }

      // T-20260513-foot-C21-TAB-RESTRUCTURE-C: 메시지 이력 로드
      const { data: msgData } = await supabase
        .from('message_logs')
        .select('*')
        .eq('customer_id', customerId)
        .order('sent_at', { ascending: false })
        .limit(50);
      setMessageLogs((msgData ?? []) as MessageLog[]);

      // T-20260525-foot-MESSAGING-V1 AC-3: 자동 SMS 발송 이력 (notification_logs)
      const { data: nlData } = await (supabase.from('notification_logs') as any)
        .select('id, event_type, channel, status, body_rendered, sent_at, created_at, error_message')
        .eq('customer_id', customerId)
        .order('created_at', { ascending: false })
        .limit(50);
      setNotificationLogs((nlData ?? []) as NotificationLog[]);

      setLoading(false);
    })();
  }, [customerId, profile]);

  // T-20260609-foot-VISITLOG-NAMING-CLARIFY: ?medchart deep-link → 고객 로드 완료 후 진료차트 패널 자동 오픈(1회).
  useEffect(() => {
    if (!medchartParam || medchartAutoOpenedRef.current) return;
    if (!customer) return; // 패널은 customer 가 있어야 렌더됨
    medchartAutoOpenedRef.current = true;
    setMedicalChartOpen(true);
  }, [medchartParam, customer]);

  // T-20260510-foot-C21-IMG-PROGRESS: 영수증 결제 생성 후 결제목록 새로고침
  const refreshPayments = useCallback(async () => {
    if (!customerId) return;
    const { data } = await supabase
      .from('payments')
      .select('*')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(50);
    setPayments((data ?? []) as Payment[]);
  }, [customerId]);

  // T-20260513-foot-C21-TAB-RESTRUCTURE-C: 메시지 이력 새로고침
  const refreshMessageLogs = useCallback(async () => {
    if (!customerId) return;
    const { data } = await supabase
      .from('message_logs')
      .select('*')
      .eq('customer_id', customerId)
      .order('sent_at', { ascending: false })
      .limit(50);
    setMessageLogs((data ?? []) as MessageLog[]);
  }, [customerId]);

  // T-20260525-foot-MESSAGING-V1 AC-3: 자동 SMS 발송 이력 새로고침
  const refreshNotificationLogs = useCallback(async () => {
    if (!customerId) return;
    const { data } = await (supabase.from('notification_logs') as any)
      .select('id, event_type, channel, status, body_rendered, sent_at, created_at, error_message')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(50);
    setNotificationLogs((data ?? []) as NotificationLog[]);
  }, [customerId]);

  // T-20260520-foot-PENCHART-VIEW-SPLIT: form_submissions 이미지 뷰어 핸들러
  // 그룹에 맞는 template_key 필터로 canvas_file → signed URL 생성
  // 그룹3: 발건강 질문지 (health_questionnaire_*) — T-20260520-foot-PENCHART-VIEW-SPLIT 확장
  const openSubmissionViewer = useCallback(async (
    group: 1 | 2 | 3,
    cid: string,
  ) => {
    const filterKey = group === 1
      ? (k: string) => k.startsWith('personal_checklist_')
      : group === 2
      ? (k: string) => k === 'refund_consent'
      : (k: string) => k.startsWith('health_questionnaire_');
    const subs = submissionEntries.filter((s) => s.template_key && filterKey(s.template_key));
    if (subs.length === 0) { setSubmissionImages([]); return; }
    setSubmissionImagesLoading(true);
    try {
      const results = await Promise.all(
        subs.map(async (s) => {
          const canvasFile = (s.field_data as Record<string, unknown> | null)?.canvas_file as string | undefined;
          if (!canvasFile) return null;
          const path = `customer/${cid}/pen-chart/${canvasFile}`;
          const { data } = await supabase.storage.from('photos').createSignedUrl(path, 3600);
          if (!data?.signedUrl) return null;
          const dateStr = s.printed_at ?? s.signed_at ?? '';
          let label = '';
          if (s.template_key === 'personal_checklist_general') label = '개인정보+체크리스트 (일반)';
          else if (s.template_key === 'personal_checklist_senior') label = '개인정보+체크리스트 (어르신용)';
          else if (s.template_key === 'refund_consent') label = '환불/비급여 동의서';
          else if (s.template_key === 'health_questionnaire_general') label = '발건강 질문지 (일반)';
          else if (s.template_key === 'health_questionnaire_senior') label = '발건강 질문지 (어르신용)';
          else label = s.template_key ?? '';
          return { url: data.signedUrl, date: dateStr, label };
        }),
      );
      setSubmissionImages(results.filter(Boolean) as { url: string; date: string; label: string }[]);
    } finally {
      setSubmissionImagesLoading(false);
    }
  }, [submissionEntries]);

  // T-20260520-foot-PENCHART-VIEW-SPLIT HOTFIX2:
  // PenChartTab이 form_submissions INSERT 성공 후 콜백 → submissionEntries 즉시 갱신
  // → 상담내역 탭 [내용보기] 버튼 페이지 새로고침 없이 활성화
  const refreshSubmissionEntries = useCallback(async () => {
    if (!customerId) return;
    const { data } = await supabase
      .from('form_submissions')
      .select('check_in_id, printed_at, signed_at, field_data, form_templates!template_id(form_key)')
      .eq('customer_id', customerId)
      .order('printed_at', { ascending: false, nullsFirst: false })
      .limit(30);
    setSubmissionEntries(
      (data ?? []).map((s: Record<string, unknown>) => ({
        check_in_id: s.check_in_id as string,
        template_key: (s.form_templates as { form_key: string } | null)?.form_key
          ?? ((s.field_data as Record<string, unknown> | null)?.form_key as string | undefined),
        printed_at: (s.printed_at as string | null) ?? null,
        signed_at:  (s.signed_at  as string | null) ?? null,
        field_data: (s.field_data as Record<string, unknown> | null) ?? null,
      }))
    );
  }, [customerId]);

  // T-20260514-foot-C2-PAYMENT-SYNC AC-1: payments realtime → 2번차트 자동 갱신
  useEffect(() => {
    if (!customerId) return;
    const channel = supabase
      .channel(`c2_payments_${customerId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'payments', filter: `customer_id=eq.${customerId}` },
        () => { refreshPayments(); }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [customerId, refreshPayments]);

  // C21-RESIDENT-ID: 고객 로드 시 주민번호 존재 여부 확인
  useEffect(() => {
    if (!customer) return;
    setRrnMasked(undefined);
    setRrnFull(undefined);
    // T-20260618-foot-STAFF-CHART2-RRN-NOSAVE (Option B): 조회 권한 없는 직원은 rrn_decrypt 가
    //   항상 null → 불필요한 RPC 호출 생략. 렌더에서 userCanViewRrn 분기로 안내문 표기.
    if (!userCanViewRrn) {
      setRrnMasked(null);
      setRrnFull(null);
      return;
    }
    (async () => {
      const { data } = await supabase.rpc('rrn_decrypt', { customer_uuid: customer.id });
      if (data) {
        const s = String(data).replace(/\D/g, '');
        setRrnMasked(s.slice(0, 6) + '-*******');
        // AC-8: 펜차트 보험차트 자동채움용 전체 표시 (마스킹 없음)
        setRrnFull(s.slice(0, 6) + '-' + s.slice(6));
      } else {
        setRrnMasked(null);
        setRrnFull(null);
      }
    })();
  }, [customer?.id, userCanViewRrn]); // eslint-disable-line react-hooks/exhaustive-deps

  // T-20260511-foot-SSN-FRONT-INPUT-BUG: autoFocus 대신 programmatic focus
  // 태블릿 가상키보드 완성 후 포커스 — 150ms 딜레이로 키보드 애니메이션 race condition 방지
  useEffect(() => {
    if (!editingRrn) return;
    const t = setTimeout(() => rrnFrontRef.current?.focus(), 150);
    return () => clearTimeout(t);
  }, [editingRrn]);

  // AC-8 쌍방연동 — 1번차트(CheckInDetailSheet)가 저장하면 2번차트도 즉시 반영
  useEffect(() => {
    if (!customer) return;
    const customerId = customer.id;
    const handler = (e: StorageEvent) => {
      if (e.key !== 'foot_crm_customer_refresh' || !e.newValue) return;
      try {
        const { customerId: changedId } = JSON.parse(e.newValue) as { customerId: string };
        if (changedId !== customerId) return;
        // 고객 필드 새로고침
        supabase.from('customers').select('*').eq('id', customerId).single().then(({ data }) => {
          if (!data) return;
          setCustomer(data as Customer);
          setResvDetailForm((f) => ({
            ...f,
            memo: (data as Customer).customer_memo ?? '',
            etcMemo: (data as Customer).memo ?? '',
          }));
        });
        // 예약 새로고침 (booking_memo 반영)
        supabase.from('reservations').select('*').eq('customer_id', customerId).order('reservation_date', { ascending: false }).limit(30).then(({ data }) => {
          if (data) setReservations(data as Reservation[]);
        });
      } catch { /* ignore */ }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, [customer?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // T-20260520-foot-PENCHART-VIEW-SPLIT REOPEN4:
  // 펜차트를 [별도 창](window.open '/penchart-editor')에서 저장하면 PenChartTab(popup)이
  // BroadcastChannel('penchart-update') + localStorage('penchart-update') 신호를 쏘지만,
  // 부모(이 차트 창)는 그 신호를 구독하지 않아 submissionEntries 가 갱신되지 않았음.
  // → 저장(form_submissions INSERT)은 성공했는데 상담내역 탭 [내용보기] 버튼이
  //    페이지 새로고침 전까지 비활성으로 남아 "저장했는데 안 뜬다" 반복 호소의 근인.
  //    팝업 저장 신호를 받아 submissionEntries 를 즉시 재조회한다 (in-tab 저장은
  //    onFormSubmissionSaved=refreshSubmissionEntries 로 이미 처리됨 / HOTFIX2).
  useEffect(() => {
    if (!customer) return;
    const cid = customer.id;
    const onUpdate = (changedId?: string) => {
      if (changedId && changedId !== cid) return;
      void refreshSubmissionEntries();
    };
    // 1) BroadcastChannel (현대 브라우저)
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel('penchart-update');
      bc.onmessage = (ev) => onUpdate((ev.data as { customerId?: string } | null)?.customerId);
    } catch { /* BroadcastChannel 미지원 무시 */ }
    // 2) localStorage storage 이벤트 폴백 (Safari < 15.4 / 구형 iPad)
    const storageHandler = (e: StorageEvent) => {
      if (e.key !== 'penchart-update' || !e.newValue) return;
      try { onUpdate((JSON.parse(e.newValue) as { customerId?: string }).customerId); }
      catch { onUpdate(); }
    };
    window.addEventListener('storage', storageHandler);
    return () => {
      try { bc?.close(); } catch { /* 무시 */ }
      window.removeEventListener('storage', storageHandler);
    };
  }, [customer?.id, refreshSubmissionEntries]); // eslint-disable-line react-hooks/exhaustive-deps

  // T-20260507-foot-CHART2-INSURANCE-FIELDS: 주소지 저장
  // T-20260510-foot-C21-SAVE-UNIFY: 우편번호+주소 동시 저장 (저장버튼 단일화)
  // T-20260510-foot-ADDRESS-DETAIL-FIX: address_detail 동시 저장
  // T-20260516-foot-C21-SAVE-REGRESS AC-3: REST UPDATE → RPC 전환 (PostgREST 스키마 캐시 우회)
  const saveAddress = async () => {
    if (!customer) return;
    const p_address = addressText.trim() || null;
    const p_address_detail = addressDetailText.trim() || null;
    const p_postal_code = postalCodeText.trim() || null;
    const { error } = await supabase.rpc('save_customer_address', {
      p_customer_id: customer.id,
      p_address,
      p_address_detail,
      p_postal_code,
    });
    if (error) {
      console.error('[C21-SAVE-REGRESS] saveAddress 실패:', error.message);
      toast.error(`주소 저장 실패: ${error.message}`);
      return;
    }
    setCustomer((prev) => prev ? {
      ...prev,
      address: p_address,
      address_detail: p_address_detail,
      postal_code: p_postal_code,
    } : prev);
    // T-20260513-foot-C21-INPUT-ALWAYS-ACTIVE: setEditingAddress(false) 제거 — 항상 활성화
  };

  // T-20260508-foot-CUST-FORM-REVAMP: 단일 필드 즉시 저장 헬퍼
  const saveCustomerField = async (patch: Partial<Customer>) => {
    if (!customer) return;
    setSavingField(true);
    const { error } = await supabase.from('customers').update(patch).eq('id', customer.id);
    setSavingField(false);
    if (error) { toast.error(`저장 실패: ${error.message}`); return; }
    setCustomer((prev) => prev ? { ...prev, ...patch } : prev);
    // AC-8 쌍방연동 — 1번차트에 변경 알림 (방문경로·고객메모·기타메모 등)
    localStorage.setItem('foot_crm_customer_refresh', JSON.stringify({ customerId: customer.id, ts: Date.now() }));
  };

  // 이메일 저장 (T-20260513-foot-C21-INPUT-ALWAYS-ACTIVE: setEditingEmail 제거)
  const saveEmail = async () => {
    await saveCustomerField({ customer_email: emailText.trim() || null });
  };

  // 여권번호 저장 (T-20260513-foot-C21-INPUT-ALWAYS-ACTIVE: setEditingPassport 제거)
  const savePassport = async () => {
    await saveCustomerField({ passport_number: passportText.trim() || null });
  };

  // T-20260513-foot-C21-PHONE-EDIT-BTN: 핸드폰번호 저장 (010-XXXX-XXXX 유효성 검증)
  const savePhone = async () => {
    const digits = phoneText.replace(/\D/g, '');
    if (digits.length === 0) { toast.error('번호를 입력해주세요'); return; }
    if (digits.length !== 11 || !digits.startsWith('010')) {
      toast.error('010으로 시작하는 11자리 번호를 입력해주세요 (예: 010-1234-5678)');
      return;
    }
    const normalized = `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
    await saveCustomerField({ phone: normalized });
    setEditingPhone(false);
  };

  // C21-RESIDENT-ID (T-20260511-foot-SSN-SAVE-BUG): 주민번호 2-split 입력
  // 앞 6자리(생년월일) plain text + 뒷 7자리 password 마스킹
  const handleRrnFrontInput = (val: string) => {
    const digits = val.replace(/\D/g, '').slice(0, 6);
    setRrnFront(digits);
    setIsDirty(true);
    // 앞자리 6자리 완성 시 뒷자리 포커스 자동 이동
    if (digits.length === 6) {
      setTimeout(() => rrnBackRef.current?.focus(), 0);
    }
  };

  const handleRrnBackInput = (val: string) => {
    const digits = val.replace(/\D/g, '').slice(0, 7);
    setRrnBack(digits);
    setIsDirty(true);
    // T-20260613-foot-FIELDBATCH item7: 주민번호 뒷자리 첫 숫자로 성별 자동 선택.
    //   feasibility: 복호화 불요 — 입력 시점의 평문 값(digits)을 그대로 파생에 사용(저장은 별도 rrn_encrypt).
    //   1·3·9 → 남 / 2·4·0 → 여, 5·6·7·8 → 외국인(가운데 1900s/2000s 외국인등록번호). 성별 박스(customer.gender/is_foreign)에 즉시 반영.
    const d = digits[0];
    if (d && customer) {
      const isForeign = '5678'.includes(d);
      const gender: 'M' | 'F' = '13579'.includes(d) ? 'M' : 'F';
      // 이미 동일 선택이면 중복 저장 skip (rrn 뒷자리 추가 입력마다 재저장 방지 — d는 첫자리 고정)
      if (customer.gender !== gender || !!customer.is_foreign !== isForeign) {
        void saveCustomerField({ gender, is_foreign: isForeign });
      }
    }
  };

  // T-20260611-foot-CHART2-IDVERIFY-MOVE-AUTOCHECK:
  //   주민번호 유효 저장(13자리 성공) 직후 신분증 확인 플래그 자동 해제(= "확인 완료").
  //   - 기존 check_ins.notes.id_check_required 필드 재사용(신규 컬럼 없음 / db_change:false).
  //   - 빈값/형식미달 저장은 호출부에서 이미 early-return → 여기 도달 X (빈값 가드).
  //   - latestCheckIn(내원 기록) 없으면 no-op. 이미 false면 중복 쓰기 skip.
  //   - 2번차트 배지의 수동 "확인 완료" 클릭에서도 재사용.
  const markIdVerified = useCallback(async () => {
    const ci = latestCheckIn;
    if (!ci) return;
    const notes = (ci.notes ?? {}) as Record<string, unknown>;
    if (notes.id_check_required === false) return; // 이미 확인 완료 — 중복 쓰기 방지
    const newNotes = { ...notes, id_check_required: false };
    const { error } = await supabase
      .from('check_ins')
      .update({ notes: newNotes })
      .eq('id', ci.id);
    if (!error) {
      setLatestCheckIn({ ...ci, notes: newNotes } as CheckIn);
    }
  }, [latestCheckIn]);

  // T-20260615-foot-PKGTAB-TOE-RESTORE: 치료부위(발가락) 멀티선택 — 패키지 탭 상단 일러스트 원상 복원(3b6ab2f 제거분 역복원, 김주연 총괄).
  //   저장: latestCheckIn.treatment_memo.foot_sites jsonb 배열({side,toe}). 기존 treatment_memo 재사용(신규 컬럼 0, db_change:false).
  //   1번차트(CheckInDetailSheet)는 이 값을 읽어 조건부 read-only 표시 — "2번차트 패키지 탭 생성분만 연동".
  const treatmentToes = useMemo<FootSite[]>(
    () => parseFootSites((latestCheckIn?.treatment_memo as { foot_sites?: unknown } | null)?.foot_sites),
    [latestCheckIn],
  );
  const canEditToes = profile?.role === 'admin' || profile?.role === 'manager' || profile?.role === 'consultant';
  const saveTreatmentToes = useCallback(
    async (next: FootSite[]) => {
      const ci = latestCheckIn;
      if (!ci) {
        toast.error('내원(체크인) 기록이 있어야 치료부위를 저장할 수 있습니다');
        return;
      }
      const memo = { ...((ci.treatment_memo as Record<string, unknown> | null) ?? {}) };
      if (next.length > 0) memo.foot_sites = next;
      else delete memo.foot_sites;
      const prev = ci.treatment_memo;
      // optimistic
      setLatestCheckIn({ ...ci, treatment_memo: memo } as CheckIn);
      const { error } = await supabase.from('check_ins').update({ treatment_memo: memo }).eq('id', ci.id);
      if (error) {
        toast.error('치료부위 저장 실패');
        setLatestCheckIn({ ...ci, treatment_memo: prev } as CheckIn); // 롤백
      }
    },
    [latestCheckIn],
  );

  // C21-RESIDENT-ID: 주민번호 암호화 저장
  // T-20260522-foot-SSN-SESSION-KILL: 저장 전 세션 체크 + 에러 코드별 메시지 분기
  // T-20260522-foot-CUST-REG-LOGOUT: 401 수신 시 refreshSession() 후 1회 재시도 추가
  //   root cause: RPC 호출 직전 JWT 만료 → 401 → SDK SIGNED_OUT 발화 → 세션 소실
  //   fix 1(auth.tsx v2): refreshSession() 적극 복구 + 100ms fallback
  //   fix 2(here): 401 에러 시 refresh 후 rrn_encrypt 1회 재시도 — SDK SIGNED_OUT 발화 전에 복구
  const saveRrn = async () => {
    if (!customer) return;
    const digits = (rrnFront + rrnBack).replace(/\D/g, '');
    if (digits.length !== 13) { toast.error('주민번호 13자리를 입력해주세요'); return; }

    // AC-4: 저장 전 세션 유효성 확인 — JWT 만료 선제 처리
    const { data: { session: currentSess } } = await supabase.auth.getSession();
    if (!currentSess) {
      toast.error('세션이 만료되었습니다. 페이지를 새로고침하고 다시 시도해주세요.');
      return;
    }

    const isAuthErr = (err: { code?: string; status?: number; message?: string }) =>
      err.code === 'PGRST301' || err.status === 401 || err.message?.toLowerCase().includes('jwt');

    const { error } = await supabase.rpc('rrn_encrypt', { customer_uuid: customer.id, plain_rrn: digits });
    if (error) {
      // AC-2: 401/JWT 에러 → refreshSession() 후 1회 재시도 (세션 종료 방지)
      if (isAuthErr(error as { code?: string; status?: number; message?: string })) {
        const { data: refreshData } = await supabase.auth.refreshSession();
        if (refreshData.session) {
          // 세션 갱신 성공 → 재시도
          const { error: retryErr } = await supabase.rpc('rrn_encrypt', { customer_uuid: customer.id, plain_rrn: digits });
          if (!retryErr) {
            setRrnMasked(rrnFront + '-' + '*'.repeat(7));
            setRrnFull(rrnFront + '-' + rrnBack); // AC-8: 전체 표시 (펜차트 자동채움용)
            setEditingRrn(false);
            setRrnFront('');
            setRrnBack('');
            setRrnText('');
            await markIdVerified(); // T-20260611-foot-CHART2-IDVERIFY: 유효 저장 → 자동 확인완료
            return;
          }
          toast.error(`주민번호 저장 실패: ${retryErr.message}`);
        } else {
          // 세션 갱신도 실패 → 로그인 재시도 안내 (로그아웃은 auth.tsx가 처리)
          toast.error('세션이 만료되었습니다. 페이지를 새로고침하고 다시 시도해주세요.');
        }
      } else {
        toast.error(`주민번호 저장 실패: ${error.message}`);
      }
      return;
    }
    setRrnMasked(rrnFront + '-' + '*'.repeat(7));
    setRrnFull(rrnFront + '-' + rrnBack); // AC-8: 전체 표시 (펜차트 자동채움용)
    setEditingRrn(false);
    setRrnFront('');
    setRrnBack('');
    setRrnText('');
    await markIdVerified(); // T-20260611-foot-CHART2-IDVERIFY: 유효 저장 → 자동 확인완료
  };

  // T-20260510-foot-C21-SAVE-UNIFY: 고객정보 패널 통합 저장
  // T-20260511-foot-C21-SAVE-DIRTY-AUTOSAVE: isAutoSave=true 시 토스트 생략 (인디케이터만)
  // T-20260609-foot-CHART2-SAVE-CLOSE-BTN: Promise<boolean> 반환 — "저장 후 닫기"가
  //   성공(true)/실패(false)을 판단해 닫을지 결정. 기존 호출부(버튼/자동저장)는 반환값 무시 → 동작 무변경.
  const handleInfoPanelSave = async (): Promise<boolean> => {
    if (!customer) return false;
    setSavingInfoPanel(true);
    let allOk = true; // DB 저장 단계 중 하나라도 실패하면 false → "저장 후 닫기" 미닫힘
    try {
      // 1) 주민번호 — 암호화 RPC 별도 처리 (T-20260511-foot-SSN-SAVE-BUG: split input 사용)
      // T-20260522-foot-SSN-SESSION-KILL: 저장 전 세션 체크 + 에러 코드별 분기
      // T-20260522-foot-CUST-REG-LOGOUT: 401 시 refreshSession() 후 1회 재시도 추가
      if (editingRrn) {
        const digits = (rrnFront + rrnBack).replace(/\D/g, '');
        if (digits.length !== 13) { toast.error('주민번호 13자리를 입력해주세요'); return false; }

        // AC-4: 저장 전 세션 유효성 확인 — JWT 만료 선제 처리
        const { data: { session: rrnSess } } = await supabase.auth.getSession();
        if (!rrnSess) {
          toast.error('세션이 만료되었습니다. 페이지를 새로고침하고 다시 시도해주세요.');
          return false;
        }

        const isAuthErr = (err: { code?: string; status?: number; message?: string }) =>
          err.code === 'PGRST301' || err.status === 401 || err.message?.toLowerCase().includes('jwt');

        const { error } = await supabase.rpc('rrn_encrypt', { customer_uuid: customer.id, plain_rrn: digits });
        if (error) {
          // AC-2: 401/JWT 에러 → refreshSession() 후 1회 재시도
          if (isAuthErr(error as { code?: string; status?: number; message?: string })) {
            const { data: refreshData } = await supabase.auth.refreshSession();
            if (refreshData.session) {
              const { error: retryErr } = await supabase.rpc('rrn_encrypt', { customer_uuid: customer.id, plain_rrn: digits });
              if (retryErr) {
                toast.error(`주민번호 저장 실패: ${retryErr.message}`);
                return false;
              }
              // 재시도 성공 — 아래 setRrnMasked 블록으로 fall-through
            } else {
              toast.error('세션이 만료되었습니다. 페이지를 새로고침하고 다시 시도해주세요.');
              return false;
            }
          } else {
            toast.error(`주민번호 저장 실패: ${error.message}`);
            return false;
          }
        }
        setRrnMasked(rrnFront + '-' + '*'.repeat(7));
        setRrnFull(rrnFront + '-' + rrnBack); // AC-8: 전체 표시 (펜차트 자동채움용)
        setEditingRrn(false);
        setRrnFront('');
        setRrnBack('');
        setRrnText('');
        await markIdVerified(); // T-20260611-foot-CHART2-IDVERIFY: 유효 저장 → 자동 확인완료
      }
      // 2) 나머지 필드 일괄 patch (address 제외 — T-20260516-foot-C21-SAVE-REGRESS)
      const patch: Partial<Customer> = {};
      // T-20260513-foot-C21-INPUT-ALWAYS-ACTIVE: 항상 포함 (editingEmail/editingPassport 가드 제거)
      patch.customer_email = emailText.trim() || null;
      patch.passport_number = passportText.trim() || null;
      // T-20260515-foot-REFERRAL-NAME AC-2: 소개자 성함 통합 저장 (optimistic — saveCustomerField 직접 호출 제거)
      patch.referral_name = referralNameText.trim() || null;
      if (editingPhone) {
        const digits = phoneText.replace(/\D/g, '');
        if (digits.length === 0) { toast.error('번호를 입력해주세요'); return false; }
        if (digits.length !== 11 || !digits.startsWith('010')) {
          toast.error('010으로 시작하는 11자리 번호를 입력해주세요 (예: 010-1234-5678)');
          return false;
        }
        patch.phone = `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
      }
      if (Object.keys(patch).length > 0) {
        const { error } = await supabase.from('customers').update(patch).eq('id', customer.id);
        if (error) {
          console.error('[C21-SAVE-REGRESS] 다른 필드 저장 실패 (address 저장은 계속 진행):', error.message);
          toast.error(`저장 실패: ${error.message}`);
          allOk = false; // T-20260609-CHART2-SAVE-CLOSE-BTN: 실패 시 "저장 후 닫기" 미닫힘
          // return 제거 — address 저장 블록은 다른 필드 저장 결과와 독립 (T-20260516-foot-C21-SAVE-REGRESS AC-3)
        } else {
          setCustomer((prev) => prev ? { ...prev, ...patch } : prev);
        }
      }
      // 3) address 독립 저장 — 실패해도 다른 필드 저장 결과에 영향 없음 (T-20260516-foot-C21-SAVE-REGRESS)
      // T-20260513-foot-C21-INPUT-ALWAYS-ACTIVE: 항상 포함 (editingAddress 가드 제거)
      // T-20260516-foot-C21-SAVE-REGRESS AC-3: REST UPDATE → RPC 전환 (PostgREST 스키마 캐시 우회)
      try {
        const p_address = addressText.trim() || null;
        const p_address_detail = addressDetailText.trim() || null;
        const p_postal_code = postalCodeText.trim() || null;
        const { error: addrErr } = await supabase.rpc('save_customer_address', {
          p_customer_id: customer.id,
          p_address,
          p_address_detail,
          p_postal_code,
        });
        if (addrErr) {
          console.error('[C21-SAVE-REGRESS] address 저장 실패 (다른 필드는 정상 저장됨):', addrErr.message);
          toast.error(`주소 저장 실패: ${addrErr.message}`);
          allOk = false; // T-20260609-CHART2-SAVE-CLOSE-BTN
        } else {
          setCustomer((prev) => prev ? { ...prev, address: p_address, address_detail: p_address_detail, postal_code: p_postal_code } : prev);
        }
      } catch (addrEx) {
        console.error('[C21-SAVE-REGRESS] address 예외 (다른 필드는 정상 저장됨):', addrEx);
        allOk = false; // T-20260609-CHART2-SAVE-CLOSE-BTN
      }
      // 4) 모든 편집 상태 닫기 + isDirty 리셋
      // T-20260513-foot-C21-INPUT-ALWAYS-ACTIVE: setEditingEmail/setEditingPassport/setEditingAddress 제거
      setEditingPhone(false);
      setIsDirty(false);
      // T-20260611-foot-CHART2-SAVE-DIRTY-RESET AC-1: 전체 저장 성공 시 Sheet 미저장 가드(dirtyRef) clean 리셋.
      //   부분 실패(allOk=false)면 미저장 내용 잔존 → 가드 유지(리셋 안 함). Sheet 모드 아니면 no-op.
      if (allOk) markChartClean();
      return allOk; // T-20260609-CHART2-SAVE-CLOSE-BTN: 정상 완료 — 성공 여부 반환
    } finally {
      setSavingInfoPanel(false);
    }
  };

  // T-20260511-foot-C21-SAVE-DIRTY-AUTOSAVE: stale closure 방지용 ref (항상 최신 함수 참조)
  const handleInfoPanelSaveRef = useRef(handleInfoPanelSave);
  handleInfoPanelSaveRef.current = handleInfoPanelSave;

  // T-20260609-foot-CHART2-SAVE-CLOSE-BTN: Sheet "저장 후 닫기" 버튼에 본문 저장 핸들러 등록
  //   (동일 핸들러 재사용 — 신규 저장 경로 없음). Sheet 모드 아니면 no-op.
  useRegisterChartSave(handleInfoPanelSave);

  // T-20260511-foot-C21-SAVE-DIRTY-AUTOSAVE: isDirty=true 시 60초 자동저장 (현장 확정: 30→60초, 김주연 5/11 16:14)
  useEffect(() => {
    if (!isDirty) return;
    const id = setInterval(async () => {
      await handleInfoPanelSaveRef.current();
      setShowAutoSaved(true);
      setTimeout(() => setShowAutoSaved(false), 2500);
    }, 60000);
    return () => clearInterval(id);
  }, [isDirty]); // eslint-disable-line react-hooks/exhaustive-deps

  // C2-PKG-TICKET-TABLE: 회차 차감 저장 (치료사 드롭다운)
  const saveUseSession = async () => {
    if (!useSessionDlg || !sessionDlgForm.therapistId) {
      toast.error('치료사를 선택해주세요.');
      return;
    }
    setSavingSession(true);
    const { error } = await supabase.from('package_sessions').insert({
      package_id: useSessionDlg.packageId,
      // T-20260612-foot-USAGEHIST-DELETE-RESTORE: 삭제 row 점유 대비 전체 최대+1 재계산(stale nextSession 보정)
      session_number: nextSessionNumberFor(useSessionDlg.packageId),
      session_type: sessionDlgForm.sessionType,
      session_date: sessionDlgForm.sessionDate,
      performed_by: sessionDlgForm.therapistId,
      status: 'used',
      // T-20260609-foot-PKGSESS-CHECKIN-LINK (AC2): 차감일 == 최근 내원일(KST)일 때만 귀속(통계 정확매칭), 아니면 NULL 근사
      check_in_id:
        latestCheckIn?.checked_in_at &&
        seoulISODate(latestCheckIn.checked_in_at) === sessionDlgForm.sessionDate
          ? latestCheckIn.id
          : null,
    });
    setSavingSession(false);
    if (error) { toast.error(`저장 실패: ${error.message}`); return; }

    // 패키지 세션 + 잔여횟수 새로고침
    if (packages.length > 0) {
      const pkgIds = packages.map((p) => p.id);
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
      // T-20260522-foot-PERF-TUNING OPT-4: sessData 재사용 → remaining 클라이언트 집계 (N RPC 제거)
      const remainingArr = computeRemainingFromSessionRows(packages, (sessData ?? []) as _SessRow[]);
      setPackages((prev) => prev.map((p, i) => ({ ...p, remaining: remainingArr[i] ?? prev[i]?.remaining ?? null })));
    }

    setUseSessionDlg(null);
  };

  // T-20260511-foot-C21-PKG-USAGE-EDIT: 패키지 세션 + 잔여횟수 공통 새로고침
  const refreshPackageData = async (pkgList: PackageWithRemaining[]) => {
    if (pkgList.length === 0) return;
    const pkgIds = pkgList.map((p) => p.id);
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
    // T-20260522-foot-PERF-TUNING OPT-4: sessData 재사용 → remaining 클라이언트 집계 (N RPC 제거)
    const remainingArr = computeRemainingFromSessionRows(pkgList, (sessData ?? []) as _SessRow[]);
    setPackages((prev) => prev.map((p, i) => ({ ...p, remaining: remainingArr[i] ?? prev[i]?.remaining ?? null })));
  };

  // T-20260511-foot-C21-PKG-USAGE-EDIT: 시술내역 수정 저장
  const saveEditSession = async () => {
    if (!editSessionDlg) return;
    if (!editSessionForm.therapistId) { toast.error('치료사를 선택해주세요.'); return; }
    setSavingEditSession(true);
    const { error } = await supabase
      .from('package_sessions')
      .update({
        session_type: editSessionForm.sessionType,
        session_date: editSessionForm.sessionDate,
        performed_by: editSessionForm.therapistId,
      })
      .eq('id', editSessionDlg.id);
    setSavingEditSession(false);
    if (error) { toast.error(`수정 실패: ${error.message}`); return; }
    toast.success('시술내역이 수정되었습니다.');
    await refreshPackageData(packages);
    setEditSessionDlg(null);
  };

  // T-20260511-foot-C21-PKG-USAGE-EDIT: 시술내역 삭제 (잔여횟수 자동 재계산)
  // T-20260612-foot-USAGEHIST-DELETE-RESTORE: HARD DELETE → SOFT DELETE.
  //   실수 삭제 원복 가능하도록 물리삭제 대신 status='deleted' 표식(soft_delete_package_session RPC).
  //   권한은 RPC 내부 is_admin_or_manager() 게이트 = 기존 DELETE 권한과 동일(확대 없음).
  //   잔여횟수는 status='used'만 집계하므로 자동 +1.
  const deleteSession = async (session: PackageSession) => {
    if (!window.confirm(`${session.session_number}회 시술내역을 삭제하시겠습니까?\n삭제하면 잔여 횟수가 +1 됩니다. (삭제 후 '복원'으로 되돌릴 수 있습니다)`)) return;
    const { error } = await supabase.rpc('soft_delete_package_session', { p_session_id: session.id });
    if (error) { toast.error(`삭제 실패: ${error.message}`); return; }
    toast.success('시술내역이 삭제되었습니다. (잔여횟수 +1 · 복원 가능)');
    await refreshPackageData(packages);
  };

  // T-20260612-foot-USAGEHIST-DELETE-RESTORE: 삭제된 회차 복원(원복).
  //   restore_package_session RPC → status='deleted' → 'used'. 잔여횟수 자동 -1.
  const restoreSession = async (session: PackageSession) => {
    if (!window.confirm(`${session.session_number}회 시술내역을 복원하시겠습니까?\n복원하면 잔여 횟수가 -1 됩니다.`)) return;
    const { error } = await supabase.rpc('restore_package_session', { p_session_id: session.id });
    if (error) { toast.error(`복원 실패: ${error.message}`); return; }
    toast.success('시술내역이 복원되었습니다. (잔여횟수 -1)');
    await refreshPackageData(packages);
  };

  // T-20260612-foot-USAGEHIST-DELETE-RESTORE: soft-delete row가 session_number를 점유한 채 남으므로
  //   신규 회차번호는 'used' 개수가 아니라 해당 패키지 전체 row(삭제 포함) 최대 session_number + 1 로 산출.
  //   UNIQUE(package_id, session_number) 충돌 방지 — 마지막/중간 회차 삭제 후 재차감 시나리오 가드.
  const nextSessionNumberFor = (packageId: string): number => {
    const nums = packageSessions
      .filter((s) => s.package_id === packageId)
      .map((s) => s.session_number);
    return (nums.length ? Math.max(...nums) : 0) + 1;
  };

  // T-20260522-foot-PKG-EDIT-DEL: 구매 패키지 수정 저장
  const saveEditPkg = async () => {
    if (!editPkgDlg || !customer) return;
    setSavingEditPkg(true);
    const editHeated = parseInt(editPkgForm.heated_sessions) || 0;
    const editUnheated = parseInt(editPkgForm.unheated_sessions) || 0;
    const editPodologe = parseInt(editPkgForm.podologe_sessions) || 0;
    const editIv = parseInt(editPkgForm.iv_sessions) || 0;
    const editTrial = parseInt(editPkgForm.trial_sessions) || 0;
    const editReborn = parseInt(editPkgForm.reborn_sessions) || 0;
    const updates = {
      package_name: editPkgForm.package_name.trim() || editPkgDlg.package_name,
      total_amount: parseAmount(editPkgForm.total_amount),
      // T-20260608-foot-ACTIVE-PKG-NOTFOUND-DEDUCT-FAIL: 편집 시 total_sessions를 개별 회차 합으로 재계산.
      // (이전: 개별 컬럼만 갱신하고 total_sessions 미갱신 → 잔여 집계·표시 드리프트 → 활성 패키지 오판정)
      total_sessions: editHeated + editUnheated + editPodologe + editIv + editTrial + editReborn,
      heated_sessions: editHeated,
      heated_unit_price: parseAmount(editPkgForm.heated_unit_price),
      unheated_sessions: editUnheated,
      unheated_unit_price: parseAmount(editPkgForm.unheated_unit_price),
      podologe_sessions: editPodologe,
      podologe_unit_price: parseAmount(editPkgForm.podologe_unit_price),
      iv_sessions: editIv,
      iv_unit_price: parseAmount(editPkgForm.iv_unit_price),
      trial_sessions: editTrial,
      trial_unit_price: parseAmount(editPkgForm.trial_unit_price),
      reborn_sessions: editReborn,
      reborn_unit_price: parseAmount(editPkgForm.reborn_unit_price),
    };
    const { error } = await supabase.from('packages').update(updates).eq('id', editPkgDlg.id);
    setSavingEditPkg(false);
    if (error) { toast.error(`수정 실패: ${error.message}`); return; }
    setEditPkgDlg(null);
    // 목록 갱신 (T-20260522-foot-PERF-TUNING OPT-4 패턴 재사용)
    const pkgRes = await supabase.from('packages').select('*').eq('customer_id', customer.id).order('created_at', { ascending: false });
    const pkgs = (pkgRes.data ?? []) as Package[];
    if (pkgs.length > 0) {
      const pkgIds = pkgs.map((p) => p.id);
      const { data: sessData } = await supabase.from('package_sessions').select('package_id, session_type, status').in('package_id', pkgIds);
      const remainingArr = computeRemainingFromSessionRows(pkgs, (sessData ?? []) as _SessRow[]);
      setPackages(pkgs.map((p, i) => ({ ...p, remaining: remainingArr[i] ?? null })));
    } else {
      setPackages([]);
    }
  };

  // T-20260522-foot-PKG-EDIT-DEL: 구매 패키지 soft delete (status='cancelled', 물리삭제 금지 AC-5)
  const softDeletePkg = async () => {
    if (!deletePkgDlg) return;
    setDeletingPkg(true);
    const { error } = await supabase.from('packages').update({ status: 'cancelled' }).eq('id', deletePkgDlg.id);
    setDeletingPkg(false);
    if (error) { toast.error(`삭제 실패: ${error.message}`); return; }
    // 목록에서 즉시 제거 (AC-2/AC-5: 비노출)
    setPackages((prev) => prev.filter((p) => p.id !== deletePkgDlg.id));
    setDeletePkgDlg(null);
  };

  // 우편번호 카카오 주소검색 팝업 (Kakao Postcode API)
  const openKakaoPostcode = () => {
    const loadAndOpen = () => {
      // @ts-expect-error Kakao Postcode global
      if (!window.daum?.Postcode) {
        const script = document.createElement('script');
        script.src = '//t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';
        script.onload = () => runPostcode();
        document.head.appendChild(script);
      } else {
        runPostcode();
      }
    };
    const runPostcode = () => {
      // @ts-expect-error Kakao Postcode global
      new window.daum.Postcode({
        oncomplete: (data: { zonecode: string; address: string }) => {
          const zoneCode = data.zonecode;
          const fullAddr = data.address;
          setPostalCodeText(zoneCode);
          setAddressText(fullAddr);
          // T-20260513-foot-C21-INPUT-ALWAYS-ACTIVE: 항상 활성화이므로 setEditingAddress 불필요
          // 우편번호 + 주소 즉시 저장 (상세주소는 사용자 입력 후 별도 저장)
          supabase.from('customers').update({
            postal_code: zoneCode || null,
            address: fullAddr || null,
          }).eq('id', customer!.id).then(({ error }) => {
            if (error) {
              console.error('[C21-SAVE-REGRESS] 카카오 주소 즉시 저장 실패:', error.message);
              toast.error(`주소 저장 실패: ${error.message}`);
              return;
            }
            setCustomer((prev) => prev ? { ...prev, postal_code: zoneCode, address: fullAddr } : prev);
          });
        },
      }).open();
    };
    loadAndOpen();
  };

  // T-20260609-foot-CHART-CONSENT-ALIGN-SMS: 셀프접수 정합 — 개인정보수집/건강보험조회/문자수신 독립 토글
  // (구 selectConsentField 단일선택 폐기. sms_reject/marketing_reject 기존 데이터는 보존, 차트에서 더 이상 쓰지 않음.)
  const togglePrivacyConsent = async () => {
    if (!customer) return;
    setIsDirty(true);
    const newVal = !(customer.privacy_consent ?? false);
    await saveCustomerField({
      privacy_consent: newVal,
      privacy_consent_at: newVal ? new Date().toISOString() : null,
    });
  };

  // 문자수신(opt-in, 긍정형). polarity: sms_opt_in=false/null → 자동발송 제외(send-notification Edge Fn 필터).
  const toggleSmsOptIn = async () => {
    if (!customer) return;
    setIsDirty(true);
    const newVal = !(customer.sms_opt_in ?? false);
    await saveCustomerField({
      sms_opt_in: newVal,
      sms_opt_in_at: newVal ? new Date().toISOString() : null,
    });
  };

  // C2-HIRA-CONSENT: 건보 조회 동의 토글
  // T-20260611-foot-WALKIN-CHART-HIRA-CONSENT-NOTSAVED AC-3(단일경로): privacy/sms 토글과 동일하게
  //   공통 핸들러 saveCustomerField 를 경유한다. 기존 인라인 update 분기는 cross-tab 갱신
  //   (localStorage foot_crm_customer_refresh) 누락 + savingHira 별도 state 로 "한쪽만 고쳐지는"
  //   분기 위험이 있었다. 동일 필드는 단일 경로로 저장(현장 요구).
  const toggleHiraConsent = async () => {
    if (!customer) return;
    setIsDirty(true);
    const newVal = !(customer.hira_consent ?? false);
    await saveCustomerField({
      hira_consent: newVal,
      hira_consent_at: newVal ? new Date().toISOString() : null,
    });
  };

  // C2-RESV-MINI-POPUP: 미니 예약 저장
  // T-20260508-foot-C22-RESV-EDIT: end_time 제거 + visit_type: 'returning' 자동 설정
  const saveResvMini = async () => {
    if (!customer || !resvMiniForm.date || !resvMiniForm.startTime) {
      toast.error('예약일자와 시작시간을 입력하세요');
      return;
    }
    setSavingResvMini(true);
    const { data: newResv, error } = await supabase.from('reservations').insert({
      customer_id: customer.id,
      clinic_id: customer.clinic_id,
      customer_name: customer.name,
      customer_phone: customer.phone ?? null,
      reservation_date: resvMiniForm.date,
      reservation_time: resvMiniForm.startTime,
      visit_type: 'returning',  // 재진으로 자동 생성
      booking_memo: resvMiniForm.memo || null,
      status: 'confirmed',
      created_by: profile?.id ?? null,
      // T-20260524-foot-DESIG-BIDIRECT AC-3: preferred_therapist_id = 선택된 지정치료사 또는 기존 지정치료사
      preferred_therapist_id: resvMiniForm.designatedTherapistId || customer.designated_therapist_id || null,
    }).select('id').single();
    setSavingResvMini(false);
    if (error) { toast.error(`예약 저장 실패: ${error.message}`); return; }
    // T-20260524-foot-DESIG-BIDIRECT AC-2: 새 지정 치료사 선택 시 customers.designated_therapist_id 역동기화 (REST UPDATE)
    // T-20260524-foot-DESIG-SAVE-ERR: RPC → REST UPDATE 전환 (RPC 미생성 대응)
    if (resvMiniForm.designatedTherapistId && resvMiniForm.designatedTherapistId !== (customer.designated_therapist_id ?? '')) {
      await supabase
        .from('customers')
        .update({ designated_therapist_id: resvMiniForm.designatedTherapistId })
        .eq('id', customer.id);
      setDesignatedTherapistId(resvMiniForm.designatedTherapistId);
      setCustomer(prev => prev ? { ...prev, designated_therapist_id: resvMiniForm.designatedTherapistId } : prev);
    }
    // AC-8+AC-11: pending_healer_flag → 신규 예약에 healer_flag 자동 적용 후 1회 소모
    // AC-11: 당일(오늘) 예약에는 적용 금지 — 다음날 이후(> today)만 소모. 당일 고객박스 노란색 전환 방지.
    {
      const todayStr = format(new Date(), 'yyyy-MM-dd');
      if (newResv && customer.pending_healer_flag && resvMiniForm.date > todayStr) {
        await supabase.from('reservations').update({ healer_flag: true }).eq('id', newResv.id);
        await supabase.from('customers').update({ pending_healer_flag: false }).eq('id', customer.id);
        setCustomer(prev => prev ? { ...prev, pending_healer_flag: false } : prev);
      }
    }
    // 예약 목록 새로고침
    const { data: resvData } = await supabase
      .from('reservations')
      .select('*')
      .eq('customer_id', customer.id)
      .order('reservation_date', { ascending: false })
      .limit(30);
    setReservations((resvData ?? []) as Reservation[]);
    setOpenResvMiniPopup(false);
    setResvMiniForm({ date: '', startTime: '', memo: '', designatedTherapistId: '' });
  };

  // C23-DETAIL-SIMPLIFY: 예약 탭 저장 (고객메모 + 기타메모)
  const saveResvDetail = async () => {
    if (!customer) return;
    setSavingResvDetail(true);
    const { error } = await supabase.from('customers').update({
      customer_memo: resvDetailForm.memo || null,
      memo: resvDetailForm.etcMemo || null,
    }).eq('id', customer.id);
    setSavingResvDetail(false);
    if (error) { toast.error(`저장 실패: ${error.message}`); return; }
    setCustomer((prev) => prev ? {
      ...prev,
      customer_memo: resvDetailForm.memo || null,
      memo: resvDetailForm.etcMemo || null,
    } : prev);
    // AC-8 쌍방연동 — 1번차트에 변경 알림
    localStorage.setItem('foot_crm_customer_refresh', JSON.stringify({ customerId: customer.id, ts: Date.now() }));
  };

  // T-20260523-foot-LASER-TIMER 위치이동 (FIX-20260525): 2번차트 3구역 [상세] 탭 상단 타이머
  const loadActiveTimer = useCallback(async (checkInId: string) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from('timer_records')
        .select('*')
        .eq('check_in_id', checkInId)
        .is('stopped_at', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      setActiveTimer(data ?? null);
    } catch {
      // 타이머 로드 실패는 무시 (비핵심 기능)
    }
  }, []);

  // latestCheckIn 변경 시 활성 타이머 로드
  useEffect(() => {
    if (latestCheckIn?.id) {
      loadActiveTimer(latestCheckIn.id);
    } else {
      setActiveTimer(null);
    }
  }, [latestCheckIn?.id, loadActiveTimer]);

  // ends_at 기준 카운트다운 — 탭 비활성 대응 (서버시각 앵커)
  useEffect(() => {
    if (!activeTimer) { setTimerRemainingSecs(0); return; }
    const tick = () => {
      const remaining = Math.max(0, new Date(activeTimer.ends_at).getTime() - Date.now()) / 1000;
      setTimerRemainingSecs(Math.ceil(remaining));
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [activeTimer]);

  const handleStartTimer = useCallback(async (minutes: number) => {
    if (!latestCheckIn?.id || !customer) return;
    setTimerLoading(true);
    try {
      const now = new Date();
      const ends = new Date(now.getTime() + minutes * 60 * 1000);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('timer_records')
        .insert({
          check_in_id: latestCheckIn.id,
          clinic_id: customer.clinic_id,
          duration_minutes: minutes,
          started_at: now.toISOString(),
          ends_at: ends.toISOString(),
          created_by: profile?.email ?? null,
        })
        .select('*')
        .maybeSingle();
      if (error) throw error;
      setActiveTimer(data);
      toast.success(`레이저 타이머 ${minutes}분 시작`);
    } catch (err: unknown) {
      toast.error(`타이머 시작 실패: ${err instanceof Error ? err.message : '오류'}`);
    } finally {
      setTimerLoading(false);
    }
  }, [latestCheckIn?.id, customer, profile?.email]);

  const handleStopTimer = useCallback(async () => {
    if (!activeTimer) return;
    setTimerLoading(true);
    setStopConfirmOpen(false);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from('timer_records')
        .update({ stopped_at: new Date().toISOString() })
        .eq('id', activeTimer.id);
      if (error) throw error;
      setActiveTimer(null);
      toast.info('레이저 타이머 종료');
    } catch (err: unknown) {
      toast.error(`타이머 종료 실패: ${err instanceof Error ? err.message : '오류'}`);
    } finally {
      setTimerLoading(false);
    }
  }, [activeTimer]);

  // T-20260519-foot-PRECHECKIN-CHART AC-3: 내원콜 방문 확인 기록 (check_in 없이 reservation_memo_history에 append)
  // BUG FIX: reservations는 DESC로 로드되므로 find()가 가장 먼 미래 예약을 반환.
  // → 날짜+시간 기준 오름차순 정렬 후 첫번째(=가장 가까운) confirmed 예약 선택.
  const handleVisitConfirm = async (willVisit: boolean) => {
    const nextResv = [...reservations]
      .filter((r) => r.status === 'confirmed')
      .sort((a, b) => {
        const da = `${a.reservation_date}T${a.reservation_time}`;
        const db = `${b.reservation_date}T${b.reservation_time}`;
        return da.localeCompare(db);
      })[0];
    if (!nextResv || !customer) return;
    setConfirmingVisit(true);
    const content = willVisit ? '[방문확인] 방문 예정' : '[방문확인] 방문 안함';
    await insertReservationMemo(nextResv.id, customer.clinic_id, content, profile?.name ?? null);
    setConfirmingVisit(false);
    if (willVisit) {
      toast.success('방문 예정으로 기록되었습니다');
    } else {
      toast.info('방문 안함으로 기록되었습니다');
    }
  };

  // C23-DETAIL-SIMPLIFY: 상담 탭 저장
  const saveConsultation = async () => {
    if (!customer) return;
    setSavingConsultation(true);
    const staffName = staffList.find(s => s.id === consultationStaffId)?.name ?? '';
    const newTmMemo = staffName
      ? `[담당: ${staffName}] ${consultationMemo}`.trim()
      : consultationMemo.trim();
    const { error } = await supabase.from('customers').update({
      tm_memo: newTmMemo || null,
    }).eq('id', customer.id);
    setSavingConsultation(false);
    if (error) { toast.error(`저장 실패: ${error.message}`); return; }
    setCustomer((prev) => prev ? { ...prev, tm_memo: newTmMemo || null } : prev);
  };

  // T-20260522-foot-ALT-BADGE: ALT 토글 저장 (S2 AC-5,6,7 + S4 AC-11)
  const saveAlt = async (newStatus: boolean) => {
    if (!customer) return;
    setSavingAlt(true);
    const now = new Date().toISOString();
    const { error } = await supabase.from('customers').update({
      alt_status: newStatus,
      alt_activated_at: newStatus ? now : null,
      alt_detail: altDetail.trim() || null,
    }).eq('id', customer.id);
    setSavingAlt(false);
    if (error) { toast.error(`ALT 저장 실패: ${error.message}`); return; }
    setAltStatus(newStatus);
    setCustomer((prev) => prev ? {
      ...prev,
      alt_status: newStatus,
      alt_activated_at: newStatus ? now : null,
      alt_detail: altDetail.trim() || null,
    } : prev);
    // AC-11: ALT ON 시 고정 메모 자동 삽입
    if (newStatus && customer.id && customer.clinic_id) {
      await insertAltPinnedMemo({
        customerId: customer.id,
        clinicId: customer.clinic_id,
        altDetail: altDetail.trim() || null,
        authorName: profile?.name ?? null,
      });
      toast.success('ALT 활성화 — 고정 메모 추가됨');
    } else if (!newStatus) {
      toast.success('ALT 해제 — 배지 제거 및 레이저코드 차단 해제');
    }
  };

  // T-20260520-foot-MEMO-HISTORY: 치료메모 히스토리 로드 (lazy — 탭 진입 시)
  const loadTreatmentMemos = useCallback(async () => {
    if (!customer) return;
    const { data, error } = await supabase
      .from('customer_treatment_memos')
      .select('id, content, created_by, created_by_name, created_at, updated_at')
      .eq('customer_id', customer.id)
      .order('created_at', { ascending: false });

    if (error) {
      // AC-3 (T-20260520-foot-MEMO-SAVE-ERR): 테이블 미존재 / 스키마 캐시 오류 → graceful fallback
      const isTableMissing =
        error.message?.includes('schema cache') ||
        error.message?.includes('customer_treatment_memos') ||
        (error as { code?: string }).code === 'PGRST205';
      if (isTableMissing) {
        console.warn('[TreatmentMemo] 테이블 미존재 — graceful fallback 적용');
        setTreatmentMemoUnavailable(true);
      } else {
        console.warn('[TreatmentMemo] load error:', error.message);
      }
      setTreatmentMemosLoaded(true);
      return;
    }

    const items = (data ?? []) as TreatmentMemoEntry[];

    // AC-3: lazy migration — 기존 treatment_note 데이터 → 히스토리 첫 항목으로 이관
    if (items.length === 0) {
      const existingNote = customer.treatment_note ?? customer.memo;
      if (existingNote) {
        const { data: inserted } = await supabase
          .from('customer_treatment_memos')
          .insert({
            customer_id: customer.id,
            clinic_id: customer.clinic_id,
            content: existingNote,
            created_by: null,
            created_by_name: '(이전 기록)',
          })
          .select('id, content, created_by, created_by_name, created_at, updated_at')
          .single();
        if (inserted) {
          setTreatmentMemos([inserted as TreatmentMemoEntry]);
          setTreatmentMemosLoaded(true);
          return;
        }
      }
    }

    setTreatmentMemos(items);
    setTreatmentMemosLoaded(true);
  }, [customer]);

  // 치료메모 탭 진입 시 lazy load
  useEffect(() => {
    if (resvDetailTab === '치료메모' && !treatmentMemosLoaded && customer) {
      loadTreatmentMemos();
    }
  }, [resvDetailTab, treatmentMemosLoaded, customer, loadTreatmentMemos]);

  // 새 메모 저장
  const saveNewTreatmentMemo = async () => {
    if (!customer || !newMemoText.trim()) return;
    setSavingNewMemo(true);
    const { data, error } = await supabase
      .from('customer_treatment_memos')
      .insert({
        customer_id: customer.id,
        clinic_id: customer.clinic_id,
        content: newMemoText.trim(),
        created_by: profile?.email ?? null,
        created_by_name: profile?.name ?? null,
      })
      .select('id, content, created_by, created_by_name, created_at, updated_at')
      .single();
    setSavingNewMemo(false);
    if (error) {
      // AC-3: 테이블 미존재 시 친절한 안내 (raw 에러 노출 금지)
      const isTableMissing =
        error.message?.includes('schema cache') ||
        error.message?.includes('customer_treatment_memos') ||
        (error as { code?: string }).code === 'PGRST205';
      if (isTableMissing) {
        toast.error('치료메모 기능 준비 중입니다. 잠시 후 다시 시도해주세요.');
        setTreatmentMemoUnavailable(true);
      } else {
        toast.error(`저장 실패: ${error.message}`);
      }
      return;
    }
    if (data) setTreatmentMemos(prev => [data as TreatmentMemoEntry, ...prev]);
    setNewMemoText('');
  };

  // 메모 수정 저장
  const saveTreatmentMemoEdit = async () => {
    if (!editingMemoId || !editingMemoText.trim()) return;
    setSavingEditMemo(true);
    const now = new Date().toISOString();
    const { error } = await supabase
      .from('customer_treatment_memos')
      .update({ content: editingMemoText.trim(), updated_at: now })
      .eq('id', editingMemoId);
    setSavingEditMemo(false);
    if (error) { toast.error(`수정 실패: ${error.message}`); return; }
    setTreatmentMemos(prev =>
      prev.map(m => m.id === editingMemoId
        ? { ...m, content: editingMemoText.trim(), updated_at: now }
        : m)
    );
    setEditingMemoId(null);
    setEditingMemoText('');
  };

  // 메모 삭제 (본인 작성분)
  const deleteTreatmentMemo = async (id: string) => {
    if (!window.confirm('메모를 삭제하시겠습니까?')) return;
    const { error } = await supabase
      .from('customer_treatment_memos')
      .delete()
      .eq('id', id);
    if (error) { toast.error(`삭제 실패: ${error.message}`); return; }
    setTreatmentMemos(prev => prev.filter(m => m.id !== id));
  };

  // C22-PKG-DEDUCT: 치료사 차감 인라인 폼 저장 (복구 — regression fix)
  // T-20260611-foot-DEDUCT-DUPKEY-SUBTHERAPIST 공통 헬퍼 ───────────────────────
  // 차감일이 최근 내원일(KST)과 같을 때만 check_in_id 귀속 (T-20260609-foot-PKGSESS-CHECKIN-LINK)
  const computeDeductCheckInId = (sessionDate: string): string | null =>
    latestCheckIn?.checked_in_at && seoulISODate(latestCheckIn.checked_in_at) === sessionDate
      ? latestCheckIn.id
      : null;

  // 같은 내원(check_in_id)·같은 패키지에 이미 'used' 차감 이력이 있으면 그 회차를 반환 (없으면 null)
  // ★ 지정치료사와 무관 — 오직 (package_id, check_in_id) 중복(unique_package_checkin)으로 판정
  const findSameCheckinSession = async (packageId: string, checkInId: string) => {
    const { data } = await supabase
      .from('package_sessions')
      .select('id, session_number, performed_by')
      .eq('package_id', packageId)
      .eq('check_in_id', checkInId)
      .eq('status', 'used')
      .order('session_number', { ascending: false })
      .limit(1);
    return data && data.length > 0
      ? (data[0] as { id: string; session_number: number; performed_by: string | null })
      : null;
  };

  // unique_package_checkin 위반(23505) graceful 판정 — AC3: raw error.message 토스트 금지
  const isDupCheckinError = (err: { message?: string; code?: string } | null): boolean =>
    !!err && (err.code === '23505' || /unique_package_checkin/i.test(err.message ?? ''));

  // 세션 새로고침 + remaining 클라이언트 집계 (차감/추가차감/치료사변경 후 공통)
  const refreshPackageSessionsAndRemaining = async () => {
    const pkgIds = packages.map(p => p.id);
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
      }))
    );
    // T-20260522-foot-PERF-TUNING OPT-4: sessData 재사용 → remaining 클라이언트 집계 (N RPC 제거)
    const remainingArr = computeRemainingFromSessionRows(packages, (sessData ?? []) as _SessRow[]);
    setPackages((prev) => prev.map((p, i) => ({ ...p, remaining: remainingArr[i] ?? prev[i]?.remaining ?? null })));
  };

  // 차감 후 폼 리셋 (AC-R1 2026-05-23)
  const resetDeductFormAfterSave = () =>
    setC22DeductForm(f => ({ ...f, therapistId: currentUserStaffId || '', treatmentType: 'heated_laser' }));

  const saveC22Deduct = async () => {
    if (!customer || !c22DeductForm.therapistId) {
      toast.error('치료사를 선택해주세요');
      return;
    }
    const activePackages = packages.filter(p => p.status === 'active');
    // T-20260523-foot-PKG-AUTOSEL-REMOVE AC-2: 활성 패키지 1개 이상 시 미선택 차단
    const activeDisplayPackages = packages.filter(p => p.status === 'active' && (p.remaining === null || p.remaining.total_remaining > 0));
    if (activeDisplayPackages.length >= 1 && !c22DeductForm.packageId) {
      toast.error('차감할 패키지를 선택해주세요');
      return;
    }
    const targetPkg = c22DeductForm.packageId
      ? activePackages.find(p => p.id === c22DeductForm.packageId)
      : activePackages[0];
    if (!targetPkg) {
      toast.error('활성 패키지가 없습니다');
      return;
    }
    const usedCount = packageSessions.filter(s => s.package_id === targetPkg.id && s.status === 'used').length;
    setSavingC22Deduct(true);
    // AC2: 같은 내원·같은 패키지 재차감 감지 → 즉시 INSERT 금지, 이중선택 모달
    const deductCheckInId = computeDeductCheckInId(c22DeductForm.sessionDate);
    if (deductCheckInId) {
      const existing = await findSameCheckinSession(targetPkg.id, deductCheckInId);
      if (existing) {
        setSavingC22Deduct(false);
        setDupDeductModal({
          targetPkgId: targetPkg.id,
          deductCheckInId,
          existingSessionId: existing.id,
          existingSessionNumber: existing.session_number,
          existingPerformedBy: existing.performed_by,
          usedCount,
          therapistId: c22DeductForm.therapistId,
          treatmentType: c22DeductForm.treatmentType,
          sessionDate: c22DeductForm.sessionDate,
          source: 'c22',
        });
        return;
      }
    }
    const { error } = await supabase.from('package_sessions').insert({
      package_id: targetPkg.id,
      // T-20260612-foot-USAGEHIST-DELETE-RESTORE: 삭제 row 점유 대비 전체 최대+1 (UNIQUE 충돌 방지)
      session_number: nextSessionNumberFor(targetPkg.id),
      session_type: c22DeductForm.treatmentType,
      session_date: c22DeductForm.sessionDate,
      performed_by: c22DeductForm.therapistId,
      status: 'used',
      check_in_id: deductCheckInId,
    });
    setSavingC22Deduct(false);
    if (error) {
      // AC3: raw "duplicate key ... unique_package_checkin" 토스트 금지 → graceful 흡수
      if (isDupCheckinError(error)) { toast.error('이미 오늘 내원으로 차감된 회차가 있어요. 잠시 후 다시 시도해 주세요.'); return; }
      toast.error(`차감 실패: ${error.message}`); return;
    }
    await refreshPackageSessionsAndRemaining();
    resetDeductFormAfterSave();
    toast.success('회차 차감 완료');
  };

  // AC2 ①: 당일 대체 치료사 전담 → 기존 회차 performed_by UPDATE (회차 추가 소진 없음)
  const handleDupChangeTherapistOnly = async () => {
    if (!dupDeductModal || dupDeductBusy) return;
    setDupDeductBusy(true);
    const { error } = await supabase
      .from('package_sessions')
      .update({ performed_by: dupDeductModal.therapistId })
      .eq('id', dupDeductModal.existingSessionId);
    if (error) { setDupDeductBusy(false); toast.error(`치료사 변경 실패: ${error.message}`); return; }
    await refreshPackageSessionsAndRemaining();
    if (dupDeductModal.source === 'healer') await applyHealerFlagForCustomer();
    setDupDeductBusy(false);
    resetDeductFormAfterSave();
    setDupDeductModal(null);
    if (dupDeductModal.source !== 'healer') toast.success('당일 담당 치료사 변경 완료 (회차 추가 차감 없음)');
  };

  // AC2 ②: 하루 두 번 시술(ⓠ1=B) → 새 회차 INSERT (session_number+1, 회차 추가 소진)
  const handleDupAddSession = async () => {
    if (!dupDeductModal || dupDeductBusy) return;
    setDupDeductBusy(true);
    const { error } = await supabase.from('package_sessions').insert({
      package_id: dupDeductModal.targetPkgId,
      // T-20260612-foot-USAGEHIST-DELETE-RESTORE: 삭제 row 점유 대비 전체 최대+1 (UNIQUE 충돌 방지)
      session_number: nextSessionNumberFor(dupDeductModal.targetPkgId),
      session_type: dupDeductModal.treatmentType,
      session_date: dupDeductModal.sessionDate,
      performed_by: dupDeductModal.therapistId,
      status: 'used',
      check_in_id: dupDeductModal.deductCheckInId,
    });
    if (error) {
      setDupDeductBusy(false);
      // 제약 마이그(20260611230000)가 prod 미적용이면 23505 잔존 가능 → graceful
      if (isDupCheckinError(error)) { toast.error('같은 날 추가 차감 설정이 아직 반영되지 않았어요. 관리자에게 문의해 주세요.'); return; }
      toast.error(`추가 차감 실패: ${error.message}`); return;
    }
    await refreshPackageSessionsAndRemaining();
    if (dupDeductModal.source === 'healer') await applyHealerFlagForCustomer();
    setDupDeductBusy(false);
    resetDeductFormAfterSave();
    setDupDeductModal(null);
    if (dupDeductModal.source !== 'healer') toast.success('1회차 추가 차감 완료');
  };

  // T-20260522-foot-DESIGNATED-THERAPIST: 지정 치료사 저장
  // T-20260524-foot-DESIG-SAVE-ERR AC-2: REST UPDATE 전환
  //   루트 코즈: save_designated_therapist RPC가 live DB에 미생성
  //     → PGRST202 "Could not find the function" 오류 → 저장 실패 토스트
  //   수정: supabase.rpc() → supabase.from('customers').update() (REST UPDATE)
  //     designated_therapist_id 컬럼 live DB 존재 확인 + 스키마 캐시 갱신 완료
  const saveDesignatedTherapist = async (newTherapistId: string) => {
    if (!customer) return;
    setSavingDesignatedTherapist(true);
    const { data: updatedRows, error } = await supabase
      .from('customers')
      .update({ designated_therapist_id: newTherapistId || null })
      .eq('id', customer.id)
      .select('id');
    setSavingDesignatedTherapist(false);
    if (error) {
      toast.error(`지정 치료사 저장 실패: ${error.message}`);
      return;
    }
    // 0-row: RLS 투명 차단(권한 부족) 또는 고객 ID 불일치
    if (!updatedRows || updatedRows.length === 0) {
      toast.error('지정 치료사 저장 실패: 권한 오류 (관리자에게 문의)');
      return;
    }
    setDesignatedTherapistId(newTherapistId);
    setCustomer(prev => prev ? { ...prev, designated_therapist_id: newTherapistId || null } : prev);
    // AC-R1 (2026-05-23): 지정 치료사 변경 시 차감 폼 자동 동기화 제거 — 수기 선택 방식

    // T-20260524-foot-THERAPIST-BISYNC AC-1: 2번차트 → 미래 재진 예약 순방향 동기화
    // AC-4: newTherapistId 있을 때만 (미지정 해제 시 예약은 유지)
    // preferred_therapist_id IS NULL인 것만 채움 (수기 우선 원칙 — 기존 지정 덮어쓰지 않음)
    if (newTherapistId) {
      const todayStr = format(new Date(), 'yyyy-MM-dd');
      const { error: resvErr } = await supabase
        .from('reservations')
        .update({ preferred_therapist_id: newTherapistId })
        .eq('customer_id', customer.id)
        .eq('visit_type', 'returning')
        .eq('status', 'confirmed')
        .gte('reservation_date', todayStr)
        .is('preferred_therapist_id', null);
      if (resvErr) {
        console.warn('[BISYNC AC-1] 순방향 예약 동기화 부분 실패:', resvErr.message);
      } else {
        // 로컬 state 즉시 반영 (리로드 없이 UI 갱신)
        setReservations(prev => prev.map(r =>
          r.visit_type === 'returning' &&
          r.status === 'confirmed' &&
          r.reservation_date >= todayStr &&
          !r.preferred_therapist_id
            ? { ...r, preferred_therapist_id: newTherapistId }
            : r
        ));
      }
    }

    const therapistName = therapistList.find(t => t.id === newTherapistId)?.name;
    toast.success(therapistName ? `지정 치료사: ${therapistName}` : '지정 치료사 해제');
  };

  // T-20260516-foot-HEALER-RESV-BTN v2: 힐러예약 플래그 토글 → T-20260522-foot-PKG-HEALER-DEDUCT에서 handleHealerDeduct로 통합됨.
  // 기존 handleHealerFlag(토글 OFF 포함)는 git history 참조(commit ebe1dd7 이전). 토글 OFF 동선 필요 시 후속 티켓에서 복원.

  // T-20260522-foot-PKG-HEALER-DEDUCT: [힐러예약 후 차감] 복합 핸들러
  // 패키지 회차 차감(saveC22Deduct 로직) + 힐러 플래그 ON(handleHealerFlag 로직) 순차 실행
  // 버그: 기존 버튼이 handleHealerFlag만 호출 → 패키지 차감 누락. savingHealerDeduct 사용.
  const handleHealerDeduct = async () => {
    if (!customer || savingHealerDeduct) return;

    // 1. 패키지 차감 프리체크
    if (!c22DeductForm.therapistId) {
      toast.error('치료사를 선택해주세요');
      return;
    }
    // T-20260523-foot-PKG-AUTOSEL-REMOVE AC-2/AC-4: 활성 패키지 1개 이상 시 미선택 차단 (handleHealerDeduct 동일 적용)
    const activeDisplayPackages = packages.filter(p => p.status === 'active' && (p.remaining === null || p.remaining.total_remaining > 0));
    if (activeDisplayPackages.length >= 1 && !c22DeductForm.packageId) {
      toast.error('차감할 패키지를 선택해주세요');
      return;
    }
    const activePackages = packages.filter(p => p.status === 'active');
    const targetPkg = c22DeductForm.packageId
      ? activePackages.find(p => p.id === c22DeductForm.packageId)
      : activePackages[0];
    if (!targetPkg) {
      toast.error('활성 패키지가 없습니다');
      return;
    }

    setSavingHealerDeduct(true);

    // 2. 패키지 회차 차감 (saveC22Deduct 동일 로직)
    const usedCount = packageSessions.filter(s => s.package_id === targetPkg.id && s.status === 'used').length;
    // AC2: 같은 내원·같은 패키지 재차감 감지 → 모달로 분기 (source='healer' → 모달 처리 후 힐러 플래그 이어감)
    const deductCheckInId = computeDeductCheckInId(c22DeductForm.sessionDate);
    if (deductCheckInId) {
      const existing = await findSameCheckinSession(targetPkg.id, deductCheckInId);
      if (existing) {
        setSavingHealerDeduct(false);
        setDupDeductModal({
          targetPkgId: targetPkg.id,
          deductCheckInId,
          existingSessionId: existing.id,
          existingSessionNumber: existing.session_number,
          existingPerformedBy: existing.performed_by,
          usedCount,
          therapistId: c22DeductForm.therapistId,
          treatmentType: c22DeductForm.treatmentType,
          sessionDate: c22DeductForm.sessionDate,
          source: 'healer',
        });
        return;
      }
    }
    const { error: deductError } = await supabase.from('package_sessions').insert({
      package_id: targetPkg.id,
      // T-20260612-foot-USAGEHIST-DELETE-RESTORE: 삭제 row 점유 대비 전체 최대+1 (UNIQUE 충돌 방지)
      session_number: nextSessionNumberFor(targetPkg.id),
      session_type: c22DeductForm.treatmentType,
      session_date: c22DeductForm.sessionDate,
      performed_by: c22DeductForm.therapistId,
      status: 'used',
      check_in_id: deductCheckInId,
    });
    if (deductError) {
      setSavingHealerDeduct(false);
      // AC3: raw 23505 토스트 금지
      if (isDupCheckinError(deductError)) { toast.error('이미 오늘 내원으로 차감된 회차가 있어요. 잠시 후 다시 시도해 주세요.'); return; }
      toast.error(`차감 실패: ${deductError.message}`);
      return;
    }

    await refreshPackageSessionsAndRemaining();
    // AC-R1 (2026-05-23): 힐러차감 후 리셋 — 지정 치료사 자동세팅 제거
    resetDeductFormAfterSave();

    // 3. 힐러 플래그 ON
    await applyHealerFlagForCustomer();
    setSavingHealerDeduct(false);
  };

  // T-20260522-foot-PKG-HEALER-DEDUCT: 힐러 플래그 ON (토글 아닌 SET — 차감과 동시이므로 항상 ON)
  // v4: > today (strictly greater) — 오늘 예약 제외. 당일 고객박스가 즉시 노란색으로 변하는 문제 수정.
  const applyHealerFlagForCustomer = async () => {
    if (!customer) return;
    const today = format(new Date(), 'yyyy-MM-dd');
    const nextResv = reservations
      .filter(r => r.reservation_date > today && r.status !== 'cancelled' && r.status !== 'noshow')
      .sort((a, b) => a.reservation_date.localeCompare(b.reservation_date))[0] ?? null;

    if (!nextResv) {
      // 다음 예약 없음 → pending_healer_flag ON
      const { error: flagError } = await supabase
        .from('customers')
        .update({ pending_healer_flag: true })
        .eq('id', customer.id);
      if (flagError) { toast.error(`힐러 플래그 저장 실패: ${flagError.message}`); return; }
      setCustomer(prev => prev ? { ...prev, pending_healer_flag: true } : prev);
      toast.success('회차 차감 + 힐러 예약 대기 설정 완료');
    } else {
      // 다음 예약 있음 → healer_flag ON
      const { error: flagError } = await supabase
        .from('reservations')
        .update({ healer_flag: true })
        .eq('id', nextResv.id);
      if (flagError) { toast.error(`힐러 플래그 저장 실패: ${flagError.message}`); return; }
      setReservations(prev => prev.map(r => r.id === nextResv.id ? { ...r, healer_flag: true } : r));
      toast.success(`회차 차감 + 다음 예약(${nextResv.reservation_date}) 힐러 플래그 설정 완료`);
    }
  };

  // C22-RESV-EDIT: 예약 수정 저장
  // T-20260524-foot-THERAPIST-BISYNC AC-2: 재진 예약 치료사 수기 선택 → customers.designated_therapist_id 역동기화
  const saveEditResv = async () => {
    if (!editResvId || !editResvForm.date || !editResvForm.startTime) {
      toast.error('예약일자와 시간을 입력하세요');
      return;
    }
    setSavingEditResv(true);
    const updatePayload: Record<string, unknown> = {
      reservation_date: editResvForm.date,
      reservation_time: editResvForm.startTime,
      booking_memo: editResvForm.memo || null,
    };
    // T-20260524-foot-THERAPIST-BISYNC: 치료사 필드도 함께 업데이트 (null 허용)
    if (editResvForm.visitType === 'returning') {
      updatePayload.preferred_therapist_id = editResvForm.therapistId || null;
    }
    const { error } = await supabase.from('reservations').update(updatePayload).eq('id', editResvId);
    setSavingEditResv(false);
    if (error) { toast.error(`수정 실패: ${error.message}`); return; }
    // T-20260524-foot-DESIG-BIDIRECT AC-2: 재진 예약 치료사 수기 변경 시 → designated_therapist_id 역동기화 (REST UPDATE)
    // T-20260524-foot-DESIG-SAVE-ERR: RPC → REST UPDATE 전환 (RPC 미생성 대응)
    if (
      customer &&
      editResvForm.visitType === 'returning' &&
      editResvForm.therapistId &&
      editResvForm.therapistId !== (customer.designated_therapist_id ?? '')
    ) {
      await supabase
        .from('customers')
        .update({ designated_therapist_id: editResvForm.therapistId })
        .eq('id', customer.id);
      setDesignatedTherapistId(editResvForm.therapistId);
      setCustomer(prev => prev ? { ...prev, designated_therapist_id: editResvForm.therapistId } : prev);
    }
    const { data: resvData } = await supabase
      .from('reservations')
      .select('*')
      .eq('customer_id', customer!.id)
      .order('reservation_date', { ascending: false })
      .limit(30);
    setReservations((resvData ?? []) as Reservation[]);
    setEditResvId(null);
    // AC-8 쌍방연동 — 예약메모 변경 시 1번차트에 알림
    if (customer) localStorage.setItem('foot_crm_customer_refresh', JSON.stringify({ customerId: customer.id, ts: Date.now() }));
  };

  // T-20260508-foot-C22-RESV-EDIT: CRM 시간대 연동 — 미니예약창/수정모달 슬롯
  const miniPopupSlots = useMemo(() => {
    if (!clinic || !resvMiniForm.date) return [];
    const d = parseISO(resvMiniForm.date);
    return generateSlots(openTimeFor(clinic), closeTimeFor(d, clinic), clinic.slot_interval);
  }, [clinic, resvMiniForm.date]);

  const editResvSlots = useMemo(() => {
    if (!clinic || !editResvForm.date) return [];
    const d = parseISO(editResvForm.date);
    return generateSlots(openTimeFor(clinic), closeTimeFor(d, clinic), clinic.slot_interval);
  }, [clinic, editResvForm.date]);

  // T-20260515-foot-INLINE-RESV: 선택일 슬롯 목록
  const inlineResvSlotList = useMemo(() => {
    if (!clinic || !inlineResvDate) return [];
    const d = parseISO(inlineResvDate);
    return generateSlots(openTimeFor(clinic), closeTimeFor(d, clinic), clinic.slot_interval);
  }, [clinic, inlineResvDate]);

  // T-20260515-foot-INLINE-RESV: 선택일 예약 현황 로드 (담당의=check_ins.therapist_id 조인)
  const loadInlineResvSlots = useCallback(async (dateStr: string) => {
    if (!customer) return;
    setInlineResvLoading(true);
    const { data: resvData } = await supabase
      .from('reservations')
      .select('id, reservation_time, customer_name, visit_type, status')
      .eq('clinic_id', customer.clinic_id)
      .eq('reservation_date', dateStr)
      .neq('status', 'cancelled');
    const resvList = (resvData ?? []) as Array<{
      id: string; reservation_time: string; customer_name: string | null; visit_type: VisitType; status: string;
    }>;
    const resvIds = resvList.map((r) => r.id);
    const ciTherapistMap: Record<string, string | null> = {};
    if (resvIds.length > 0) {
      const { data: ciData } = await supabase
        .from('check_ins')
        .select('reservation_id, therapist_id')
        .in('reservation_id', resvIds);
      for (const ci of (ciData ?? []) as Array<{ reservation_id: string | null; therapist_id: string | null }>) {
        if (!ci.reservation_id) continue;
        ciTherapistMap[ci.reservation_id] = therapistList.find((t) => t.id === ci.therapist_id)?.name ?? null;
      }
    }
    const slotMap: Record<string, Array<{ name: string; visit_type: VisitType; therapist: string | null }>> = {};
    for (const r of resvList) {
      const time = r.reservation_time.slice(0, 5);
      (slotMap[time] ??= []).push({
        name: r.customer_name ?? '?',
        visit_type: r.visit_type,
        therapist: ciTherapistMap[r.id] ?? null,
      });
    }
    setInlineResvSlotMap(slotMap);
    setInlineResvLoading(false);
  }, [customer, therapistList]);

  // T-20260515-foot-INLINE-RESV: 패널이 열리거나 날짜가 바뀔 때 슬롯 데이터 갱신
  useEffect(() => {
    if (!inlineResvOpen || !inlineResvDate) return;
    loadInlineResvSlots(inlineResvDate);
  }, [inlineResvOpen, inlineResvDate, loadInlineResvSlots]);

  // T-20260523-foot-ACCT-HISTORY-VERIFY: profile → staff.id 역방향 조회
  // 치료사 계정 로그인 시 패키지 차감 performed_by 자동 세팅 (AC-1/AC-2/AC-4)
  // staff.user_id = user_profiles.id = auth.uid() 경유 조회
  useEffect(() => {
    if (!profile?.id || !customer?.clinic_id) return;
    supabase
      .from('staff')
      .select('id')
      .eq('user_id', profile.id)
      .eq('clinic_id', customer.clinic_id)
      .eq('active', true)
      .maybeSingle()
      .then(({ data }) => setCurrentUserStaffId((data as { id: string } | null)?.id ?? ''));
  }, [profile?.id, customer?.clinic_id]);

  // T-20260523-foot-ACCT-HISTORY-VERIFY: 치료사 계정 로그인 시 본인 우선 세팅 (RLS 준수)
  // RLS: package_sessions_therap_insert → performed_by IS NULL OR = current_staff_id() 강제
  // AC-R3: RLS 제약이므로 치료사 계정 UI 자동선택 유지
  // AC-R1 (2026-05-23): 지정 치료사 자동선택 제거 — admin/consultant는 매번 수기 선택
  //   현장 원문: "환자가 특정 치료사 지정하면 해당 치료사나 데스크에서 수기로 넣는거야!"
  useEffect(() => {
    if (therapistList.length === 0) return;
    // 치료사 계정 로그인 시 본인 우선 세팅 (RLS 제약 반영)
    if (currentUserStaffId && therapistList.some(t => t.id === currentUserStaffId)) {
      setC22DeductForm(f => ({
        ...f,
        therapistId: f.therapistId || currentUserStaffId,
      }));
    }
    // AC-R1: 지정 치료사 자동선택 제거 — 드롭다운은 빈 상태로 시작, 매번 수기 선택
    // designated_therapist_id 컬럼 및 표시는 유지, UI 자동세팅만 제거
  }, [currentUserStaffId, therapistList]);

  // T-20260602-foot-SLOT-DWELL-TIME (B안): 체류시간 탭 진입 시 lazy 로딩 (방문건별 슬롯 체류 인터벌)
  // T-20260615-foot-CHART2-TABS-RESVTAB-DWELLSWAP:
  //   AC-3: slot_dwell이 CLINICAL 그룹으로 이동 → 그룹 비종속(chartTab 키 단독) 가드로 교체.
  //   AC-5 무한로딩 ROOT CAUSE 제거(코드 근거):
  //     기존 deps에 slotDwellLoading 포함 + 가드에 slotDwellLoading 사용 → setSlotDwellLoading(true)
  //     순간 effect가 즉시 재실행되며 cleanup이 in-flight 요청에 cancelled=true를 세팅.
  //     그 후 RPC가 resolve되면 `if (cancelled) return;`가 setSlotDwellLoading(false) 앞에서
  //     조기 반환 → loading이 true로 영구 고착 → "계속 로딩만 됨"(c9dd3c4 빈ids 가드로 미해소).
  //   해결: slotDwellLoading을 deps·가드에서 제거(자기-취소 트리거 차단). 가드는 slotDwellLoaded만.
  //         setSlotDwellLoading(true)를 async 밖에서 1회 호출 → 상태변화가 effect 재실행을 유발하지 않음.
  //         checkInHistory 변경 등 정상 재실행 시에만 cleanup이 stale 요청을 취소(데이터 적용만 차단).
  useEffect(() => {
    if (chartTab !== 'slot_dwell') return;
    if (slotDwellLoaded) return;
    const ids = checkInHistory.map((ci) => ci.id);
    // T-20260613-foot-FIELDBATCH item8(2): checkInHistory 비동기 로드 race 해소.
    //   빈 ids면 loaded 잠그지 말고 대기 → 방문이 채워지면 effect 재실행되어 fetch.
    //   방문이 진짜 0건이면 아래 렌더가 "기록 없음" 표시(무한 스피너 아님 — slotDwellLoading=false 유지).
    if (ids.length === 0) return;
    let cancelled = false;
    setSlotDwellLoading(true);
    (async () => {
      const { data, error } = await supabase.rpc('fn_check_in_slot_dwell', { p_check_in_ids: ids });
      if (cancelled) return; // 더 새로운 실행이 인계 — 그 실행이 loading 상태를 소유
      if (error) {
        toast.error('체류시간 조회 실패: ' + error.message);
        setSlotDwell([]);
      } else {
        setSlotDwell((data ?? []) as SlotDwellSeg[]);
      }
      setSlotDwellLoaded(true);
      setSlotDwellLoading(false);
    })();
    return () => { cancelled = true; };
  }, [chartTab, slotDwellLoaded, checkInHistory]);

  // T-20260603-foot-SLOT-DWELL-LIVE-TICK: slot_dwell 탭 활성 시 1초마다 now 갱신 → 진행중 세그먼트 라이브 카운트.
  // 탭 이탈/언마운트 시 clearInterval (AC-4: 메모리 누수·백그라운드 타이머 잔존 방지)
  // T-20260615 DWELLSWAP AC-3: slot_dwell이 CLINICAL 그룹으로 이동 → 그룹 비종속(키 단독) 가드.
  useEffect(() => {
    if (chartTab !== 'slot_dwell') return;
    setSlotDwellNowMs(Date.now());
    const id = setInterval(() => setSlotDwellNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [chartTab]);

  // T-20260515-foot-INLINE-RESV: 빈 슬롯 클릭 시 예약 등록
  // T-20260524-foot-THERAPIST-BISYNC AC-2: 치료사 선택 시 preferred_therapist_id 저장 + designated_therapist_id 역동기화
  const saveInlineResv = async (time: string) => {
    if (!customer || !inlineResvDate) return;
    setSavingInlineResv(true);
    const { data: newResv, error } = await supabase.from('reservations').insert({
      customer_id: customer.id,
      clinic_id: customer.clinic_id,
      customer_name: customer.name,
      customer_phone: customer.phone ?? null,
      reservation_date: inlineResvDate,
      reservation_time: time,
      visit_type: 'returning',
      booking_memo: inlineResvMemo.trim() || null,
      status: 'confirmed',
      created_by: profile?.id ?? null,
      // T-20260524-foot-THERAPIST-BISYNC: 선택된 치료사 저장 (AC-2)
      preferred_therapist_id: inlineResvTherapistId || null,
    }).select('id').single();
    setSavingInlineResv(false);
    if (error) { toast.error(`예약 저장 실패: ${error.message}`); return; }
    // T-20260524-foot-DESIG-BIDIRECT AC-2: 치료사 수기 선택 저장 → customers.designated_therapist_id 역동기화 (REST UPDATE)
    // AC-3: visit_type = 'returning'만 (이 함수는 항상 returning이므로 조건 충족)
    // T-20260524-foot-DESIG-SAVE-ERR: RPC → REST UPDATE 전환 (RPC 미생성 대응)
    if (inlineResvTherapistId && inlineResvTherapistId !== (customer.designated_therapist_id ?? '')) {
      await supabase
        .from('customers')
        .update({ designated_therapist_id: inlineResvTherapistId })
        .eq('id', customer.id);
      setDesignatedTherapistId(inlineResvTherapistId);
      setCustomer(prev => prev ? { ...prev, designated_therapist_id: inlineResvTherapistId } : prev);
    }
    // AC-8+AC-11: pending_healer_flag → 신규 예약에 healer_flag 자동 적용 후 1회 소모
    // AC-11: 당일(오늘) 예약에는 적용 금지 — 다음날 이후(> today)만 소모. 당일 고객박스 노란색 전환 방지.
    {
      const todayStr = format(new Date(), 'yyyy-MM-dd');
      if (newResv && customer.pending_healer_flag && inlineResvDate > todayStr) {
        await supabase.from('reservations').update({ healer_flag: true }).eq('id', newResv.id);
        await supabase.from('customers').update({ pending_healer_flag: false }).eq('id', customer.id);
        setCustomer(prev => prev ? { ...prev, pending_healer_flag: false } : prev);
      }
    }
    toast.success(`${inlineResvDate} ${time} 예약 등록 완료`);
    // 예약 이력 즉시 갱신
    const { data: resvData } = await supabase
      .from('reservations')
      .select('*')
      .eq('customer_id', customer.id)
      .order('reservation_date', { ascending: false })
      .limit(30);
    setReservations((resvData ?? []) as Reservation[]);
    // 슬롯 그리드 갱신 (방금 만든 예약 반영)
    await loadInlineResvSlots(inlineResvDate);
    // T-20260524-foot-DESIG-BIDIRECT: 지정 치료사 선택 리셋 (다음 예약 시 빈 상태 — AC-4)
    setInlineResvTherapistId('');
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

  // T-20260507-foot-CHART2-FULL-LAYOUT: 전능CRM SMARTDOCTOR 레이아웃 탭 정의
  // T-20260510-foot-C21-TAB-CLEANUP: 마크류/스마트서베이/면담기록지/예약내역/통화내역/소개자가족 삭제
  // T-20260513-foot-C21-TAB-RESTRUCTURE-A: 상단6+하단5 재배치, 서류발행 상단 이동
  // T-20260522-foot-CHART2-TAB-PENCHART: 펜차트 → 첫 번째 위치 (기본 탭과 일치)
  // T-20260601-foot-CHART-TAB-MUNJIN-DEDUP: [문진] 탭 진입점 제거(데이터/테이블은 보존, 화면 노출만 제거).
  //   진료차트 탭을 펜차트 바로 옆(구 문진 자리)으로 이동 → 결과: [펜차트][진료차트][검사결과]...
  // T-20260615-foot-CHART2-TABS-RESVTAB-DWELLSWAP:
  //   AC-1: '서류발행'(documents) → '예약내역'(reservations) 탭 대체 (서류발행 렌더는 orphan 보존).
  //   AC-3: '수납내역'(payments, CLINICAL) ↔ '체류시간'(slot_dwell, HISTORY) 그룹 위치 스왑.
  //         → payments는 HISTORY로, slot_dwell은 CLINICAL로 이동.
  const CLINICAL_TABS = [
    { key: 'pen_chart',   label: '펜차트' },
    { key: 'test_result', label: '검사결과' },
    { key: 'progress',    label: '경과내역' },
    { key: 'reservations', label: '예약내역' }, // AC-1: documents 대체
    { key: 'slot_dwell',   label: '체류시간' }, // AC-3: payments 자리로 이동
  ];
  const HISTORY_TABS = [
    { key: 'consultations', label: '상담내역' },
    { key: 'packages',      label: '패키지' },
    { key: 'treatments',    label: '진료내역' },
    { key: 'images',        label: '진료이미지' },
    { key: 'messages',      label: '메시지' },
    { key: 'refunds',       label: '환불내역' },
    { key: 'payments',      label: '수납내역' }, // AC-3: slot_dwell 자리로 이동
  ];
  // T-20260513-foot-C21-TAB-RESTRUCTURE-C: pen_chart + messages 구현 완료
  // T-20260522-foot-REFUND-HIST-TAB: 환불내역 탭 추가
  // T-20260601-foot-CHART-TAB-MUNJIN-DEDUP: 'checklist'(문진) 탭 진입점 제거에 맞춰 orphan 항목 정리.
  //   checklist 렌더 로직(L3972~)은 보존(OQ), chartTab은 더 이상 'checklist'에 도달하지 않음.
  // T-20260615 DWELLSWAP: 멤버십 변경 — clinical에 reservations·slot_dwell, history에 payments.
  const IMPLEMENTED_CLINICAL = ['progress', 'reservations', 'slot_dwell', 'test_result', 'pen_chart'];
  const IMPLEMENTED_HISTORY  = ['consultations', 'packages', 'treatments', 'images', 'messages', 'refunds', 'payments'];

  const handleClinicalTab = (key: string) => { setChartTab(key); setChartTabGroup('clinical'); };
  const handleHistoryTab  = (key: string) => { setChartTab(key); setChartTabGroup('history'); };

  // T-20260615-foot-RESVTAB-MEMO-ICON-SCROLLFIX AC-1: 예약메모 저장.
  //   기존 append-only RPC(insertReservationMemo)·상태초기화·1번차트 알림 로직 그대로 — 표시/토글만 추가.
  //   (customer·profile 은 위 early-return 통과 후이므로 non-null. 일반 함수 → hooks 규칙 무관.)
  const saveResvMemo = async (reservationId: string) => {
    const content = (resvMemoInputs[reservationId] ?? '').trim();
    if (!content) { setEditingResvMemoId(null); return; }
    await insertReservationMemo(reservationId, customer.clinic_id ?? '', content, profile.name ?? null);
    setResvMemoInputs(prev => ({ ...prev, [reservationId]: '' }));
    // AC-8 쌍방연동 — 예약메모 추가 시 1번차트에 알림
    localStorage.setItem('foot_crm_customer_refresh', JSON.stringify({ customerId: customer.id, ts: Date.now() }));
    setEditingResvMemoId(null);
  };

  /* ── 공통 셀 스타일 (tailwind concat 대체) ── */
  const LC = 'bg-[#f8fafc] border-r border-b border-gray-200 px-2 py-1.5 font-medium text-[#475569] whitespace-nowrap text-[11px] w-[90px] shrink-0';
  const VC = 'border-b border-gray-200 px-2 py-1.5 text-xs';

  return (
    <div className="min-h-screen bg-[#e8e8e8] flex flex-col">

      {/* ── 헤더 (전능CRM 스타일) ─────────────────────────────────────── */}
      <header className="sticky top-0 z-20 flex items-center gap-2 border-b bg-[#2d2d2d] px-3 py-1.5 text-white shadow shrink-0">
        <span className="text-sm font-bold tracking-tight">SMART DOCTOR — 고객정보</span>
        <div className="flex items-center gap-2 ml-2 text-xs">
          <span className="bg-white/20 rounded px-2 py-0.5 font-semibold">{customer.name}</span>
          {customer.phone && <span className="text-white/70 text-[11px]">{formatPhone(customer.phone)}</span>}
          {/* T-20260612-foot-PATIENT-CHARTNO-PAIRING-AUDIT: 차트번호 항상 표시(미발번도 명시) */}
          <span className="text-white/60">{chartNoBadge(customer.chart_number)}</span>
          <Badge variant={customer.visit_type === 'new' ? 'teal' : 'secondary'} className="text-[10px]">
            {VISIT_TYPE_KO[customer.visit_type as keyof typeof VISIT_TYPE_KO] ?? customer.visit_type}
          </Badge>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          {/* T-20260615-foot-CHART2-RESVBTN-POPUP-NONAV (현장 승인: 김주연 총괄): 2번차트 [예약하기] → navigate 대신 예약 미니팝업 오버레이.
              차트 닫지 않고(navigate X) 현 환자 컨텍스트로 예약. 기존 openResvMiniPopup 자산 재사용. */}
          {/* LOGIC-LOCK: L-002 (부분 supersede) — 2번차트 surface 한정 예외: [예약하기] = 팝업 오버레이(navigate X, 차트 유지).
              사이드바·상단메뉴·고객관리·대시보드·캘린더 등 타 surface [예약하기]는 여전히 /admin/reservations full page 전환 유지. 변경 시 현장 승인 필수 */}
          <button
            onClick={() => {
              // 차트 유지 + 화면 이동 없음 — 현 환자(customer) 컨텍스트로 미니팝업 오버레이 오픈
              setResvMiniForm({ date: '', startTime: '', memo: '', designatedTherapistId: '' });
              setOpenResvMiniPopup(true);
            }}
            className="rounded px-2 py-1 text-xs bg-emerald-500/80 hover:bg-emerald-500 transition flex items-center gap-1"
            data-testid="btn-chart-make-reservation"
          >
            <CalendarPlus className="h-3.5 w-3.5" /> 예약하기
          </button>
          <button onClick={() => window.print()} className="rounded px-2 py-1 text-xs bg-white/10 hover:bg-white/20 transition flex items-center gap-1">
            <Printer className="h-3.5 w-3.5" /> 인쇄
          </button>
          {/* T-20260514-foot-CHART2-OPEN-BUG: Sheet 모드 → Sheet 닫기, 독립 페이지 → window.close */}
          <button
            onClick={() => chartSheetClose ? chartSheetClose() : window.close()}
            className="rounded px-2 py-1 text-xs bg-white/10 hover:bg-white/20 transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* ── 본문 (좌우 분할 패널) ─────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden" style={{ height: 'calc(100vh - 42px)' }}>

        {/* ════════════════════════════════════════════════════════════════ */}
        {/* 좌측 패널 — 고객정보 (60%)                                      */}
        {/* ════════════════════════════════════════════════════════════════ */}
        <div className="flex flex-col overflow-hidden border-r border-gray-400 bg-white" style={{ width: '60%', minWidth: 0 }}>

          {/* 패널 서브헤더 — T-20260510-foot-C21-SAVE-UNIFY: 통합 저장 버튼 */}
          <div className="flex items-center gap-3 bg-[#e2e8f0] border-b border-gray-300 px-3 py-1 shrink-0">
            <span className="text-[11px] font-semibold text-[#2d2d2d]">고객정보</span>
            <span className="text-[11px] text-muted-foreground">
              방문 <strong className="text-teal-700">{visits.length}회</strong>
              {' · '}결제 <strong className="text-teal-700">{formatAmount(totalPaid)}</strong>
              {' · '}패키지 <strong className="text-teal-700">{packages.length}건</strong>
            </span>
            <Button
              size="sm"
              data-testid="chart-info-save-btn"
              className="ml-auto h-6 text-[11px] px-3 bg-teal-600 hover:bg-teal-700"
              onClick={() => handleInfoPanelSave()}
              disabled={savingInfoPanel || !isDirty}
            >
              {savingInfoPanel ? '저장 중…' : '저장'}
            </Button>
            {/* T-20260511-foot-C21-SAVE-DIRTY-AUTOSAVE: 자동저장 인디케이터 */}
            {showAutoSaved && (
              <span className="text-[10px] text-teal-600 ml-1 shrink-0 animate-pulse">자동저장됨 ✓</span>
            )}
          </div>

          {/* 스크롤 영역 — 고객정보 + 탭바 + 탭콘텐츠 */}
          <div data-testid="chart-info-panel" className="flex-1 overflow-y-auto">

            {/* ── 고객정보 폼 테이블 (전능CRM 스타일) ── */}
            <table className="w-full border-collapse text-xs">
              <tbody>

                {/* ① 고객명 + 검증 + 고객번호 */}
                <tr>
                  <td className={LC}>고객명</td>
                  <td className={VC} colSpan={3}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm text-gray-900">{customer.name}</span>
                      <span className="rounded border border-slate-300 bg-slate-50 text-slate-700 px-1.5 py-0.5 text-[10px] cursor-default select-none">검증</span>
                      {/* T-20260612-foot-PATIENT-CHARTNO-PAIRING-AUDIT: 고객번호 항상 표시(미발번도 명시) */}
                      <span className="text-[11px] text-muted-foreground">
                        고객번호: <strong className="text-gray-700">{chartNoDisplay(customer.chart_number)}</strong>
                      </span>
                    </div>
                  </td>
                </tr>

                {/* ② 주민번호 — C21-RESIDENT-ID / T-20260511-foot-SSN-SAVE-BUG: 앞6자리 plain + 뒷7자리 masked */}
                <tr>
                  <td className={LC}>주민번호</td>
                  <td className={VC} colSpan={3}>
                   <div className="flex items-center gap-2 flex-wrap">
                    {editingRrn ? (
                      <div className="flex items-center gap-1">
                        {/* 앞 6자리 — 생년월일 (plain text) */}
                        <input
                          ref={rrnFrontRef}
                          type="text"
                          inputMode="numeric"
                          autoComplete="off"
                          className="font-mono text-sm h-7 w-20 border border-teal-300 rounded px-2 bg-white tracking-widest focus:outline-none focus:ring-1 focus:ring-teal-400"
                          value={rrnFront}
                          onChange={(e) => handleRrnFrontInput(e.target.value)}
                          placeholder="000000"
                          maxLength={6}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); saveRrn(); }
                            if (e.key === 'Escape') { setEditingRrn(false); setRrnFront(''); setRrnBack(''); }
                          }}
                        />
                        <span className="text-gray-400 text-sm font-mono">-</span>
                        {/* 뒷 7자리 — 비밀번호 마스킹 */}
                        <input
                          ref={rrnBackRef}
                          type="password"
                          inputMode="numeric"
                          autoComplete="new-password"
                          className="font-mono text-sm h-7 w-24 border border-teal-300 rounded px-2 bg-white tracking-widest focus:outline-none focus:ring-1 focus:ring-teal-400"
                          value={rrnBack}
                          onChange={(e) => handleRrnBackInput(e.target.value)}
                          placeholder="0000000"
                          maxLength={7}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); saveRrn(); }
                            if (e.key === 'Escape') { setEditingRrn(false); setRrnFront(''); setRrnBack(''); }
                          }}
                        />
                        <button
                          type="button"
                          onClick={saveRrn}
                          disabled={rrnFront.length + rrnBack.length < 13}
                          className="text-[11px] px-2 py-0.5 rounded border border-teal-400 text-teal-600 hover:bg-teal-50 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          저장
                        </button>
                        <button
                          type="button"
                          onClick={() => { setEditingRrn(false); setRrnFront(''); setRrnBack(''); }}
                          className="text-[11px] px-2 py-0.5 rounded border border-gray-300 text-gray-500 hover:bg-gray-50"
                        >
                          취소
                        </button>
                      </div>
                    ) : userCanViewRrn ? (
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-gray-600">
                          {rrnMasked === undefined ? '...' : (rrnMasked ?? '미입력')}
                        </span>
                        <button
                          type="button"
                          onClick={() => { setRrnFront(''); setRrnBack(''); setEditingRrn(true); setIsDirty(true); }}
                          className="text-[10px] px-1.5 py-0.5 rounded border border-gray-300 text-gray-500 hover:bg-gray-50"
                        >
                          {rrnMasked ? '수정' : '입력'}
                        </button>
                      </div>
                    ) : (
                      /* T-20260618-foot-STAFF-CHART2-RRN-NOSAVE (Option B): 조회 권한 없는 직원 안내문.
                         복호화 결과 null 을 '미입력'으로 표기하면 "저장 안 됨"으로 오해 → '조회 권한 없음'으로 명시.
                         저장(입력) 동선은 유지(rrn_encrypt 는 별도 권한). 방금 저장한 값은 세션 내 마스킹 표시. */
                      <div className="flex items-center gap-2">
                        {rrnMasked ? (
                          <span className="font-mono text-gray-600">{rrnMasked}</span>
                        ) : (
                          <span
                            className="inline-flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700"
                            title="주민번호는 관리자·매니저·원장만 조회할 수 있습니다. 저장되어 있어도 이 화면에는 표시되지 않으며, 빈 값이 곧 '미저장'을 뜻하지 않습니다."
                          >
                            <Lock className="h-3 w-3" /> 조회 권한 없음
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => { setRrnFront(''); setRrnBack(''); setEditingRrn(true); setIsDirty(true); }}
                          className="text-[10px] px-1.5 py-0.5 rounded border border-gray-300 text-gray-500 hover:bg-gray-50"
                        >
                          입력
                        </button>
                      </div>
                    )}
                    {/* T-20260611-foot-CHART2-IDVERIFY-MOVE-AUTOCHECK: 신분증 확인 상태 —
                        1번차트(CheckInDetailSheet)에서 이동. 주민번호 유효 저장 시 자동 "확인 완료".
                        verified = 플래그 명시적 false(저장 후 자동 set) OR (rrn 존재 & 미확인필요).
                        미확인 시 클릭으로 수동 확인완료(구 1번차트 동작 보존) — 내원 기록 없으면 비활성. */}
                    {(() => {
                      const flag = latestCheckIn?.notes?.id_check_required;
                      const verified = flag === false || (flag !== true && !!rrnMasked);
                      return verified ? (
                        <span
                          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold"
                          style={{ backgroundColor: '#DCFCE7', color: '#15803D', border: '1.5px solid #BBF7D0' }}
                        >
                          <span className="h-1.5 w-1.5 rounded-full bg-green-500 inline-block" />
                          신분증 확인 완료
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={!latestCheckIn}
                          title={latestCheckIn ? '클릭하면 신분증 확인 완료 처리' : '내원 기록이 없어 수동 처리 불가 (주민번호 저장 시 자동 처리)'}
                          onClick={() => { if (latestCheckIn) markIdVerified(); }}
                          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold transition hover:opacity-80 active:scale-95 disabled:cursor-default disabled:opacity-70 disabled:hover:opacity-70"
                          style={{ backgroundColor: '#FEE2E2', color: '#B91C1C', border: '1.5px solid #FECACA' }}
                        >
                          <span className="h-1.5 w-1.5 rounded-full bg-red-500 inline-block animate-pulse" />
                          신분증 확인 필요
                        </button>
                      );
                    })()}
                   </div>
                  </td>
                </tr>

                {/* ②-b 건강보험 조회 — C2-HIRA-CONSENT.
                    T-20260609-foot-CHART-CONSENT-ALIGN-SMS AC-3: 동의 Y/N 토글은 위 '개인정보 동의' 섹션(건강보험조회)으로 통합(SSOT 단일화).
                    이 행은 NHIS 조회 버튼만 유지(이중 노출 방지). 조회 버튼은 hira_consent=true일 때만 활성. */}
                <tr>
                  <td className={LC}>건보 조회</td>
                  <td className={VC} colSpan={3}>
                    <div className="flex items-center gap-3">
                      {/* 조회 버튼 — 건강보험조회 동의(hira_consent) Y일 때만 활성 */}
                      <button
                        type="button"
                        onClick={() => window.open('https://medicare.nhis.or.kr/portal/refer/selectReferInq.do', '_blank')}
                        disabled={!(customer.hira_consent ?? false)}
                        className={cn(
                          'inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] transition',
                          customer.hira_consent
                            ? 'border-slate-400 bg-slate-50 text-slate-700 hover:bg-slate-100 cursor-pointer'
                            : 'border-gray-200 bg-gray-50 text-gray-300 cursor-not-allowed',
                        )}
                      >
                        조회
                      </button>
                      {customer.hira_consent && customer.hira_consent_at && (
                        <span className="text-[10px] text-teal-600">
                          동의 {format(new Date(customer.hira_consent_at), 'MM-dd HH:mm')}
                        </span>
                      )}
                    </div>
                  </td>
                </tr>

                {/* ③ 성별 (라디오 스타일) — T-20260510-foot-C21-DEPLOYED-VERIFY: 클릭 활성화 */}
                <tr>
                  <td className={LC}>성별</td>
                  <td className={VC} colSpan={3}>
                    <div className="flex items-center gap-4">
                      {[
                        { val: 'M',       label: '남성' },
                        { val: 'F',       label: '여성' },
                        { val: 'foreign', label: '외국인' },
                      ].map(({ val, label }) => {
                        const sel = val === 'foreign'
                          ? customer.is_foreign
                          : (!customer.is_foreign && customer.gender === val);
                        const onClick = () => {
                          if (savingField) return;
                          setIsDirty(true);
                          if (val === 'foreign') {
                            saveCustomerField({ is_foreign: true });
                          } else {
                            saveCustomerField(
                              { gender: val as 'M' | 'F', is_foreign: false },
                            );
                          }
                        };
                        return (
                          <button
                            key={val}
                            type="button"
                            onClick={onClick}
                            disabled={savingField}
                            className="flex items-center gap-1 hover:opacity-80 active:scale-95 transition cursor-pointer"
                            title={`${label} 선택`}
                          >
                            <span className={cn(
                              'h-3.5 w-3.5 rounded-full border-2 flex items-center justify-center',
                              sel ? 'border-slate-600' : 'border-gray-400',
                            )}>
                              {sel && <span className="h-1.5 w-1.5 rounded-full bg-slate-600" />}
                            </span>
                            <span className={sel ? 'font-medium text-slate-700' : 'text-gray-600'}>{label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </td>
                </tr>

                {/* ④ 휴대폰 + 개인정보동의/문자수신거부 — T-20260508-foot-CUST-FORM-REVAMP: 체크박스 활성화 */}
                {/* T-20260513-foot-C21-PHONE-EDIT-BTN: 인라인 편집 */}
                <tr>
                  <td className={LC}>휴대폰</td>
                  <td className={cn(VC, 'border-r border-gray-200 w-[160px]')}>
                    {editingPhone ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="tel"
                          value={phoneText}
                          onChange={(e) => { setPhoneText(formatPhoneInput(e.target.value)); setIsDirty(true); }}
                          autoFocus
                          placeholder="010-1234-5678"
                          className="h-5 w-[110px] text-[11px] rounded border border-teal-400 px-1.5 focus:outline-none focus:border-teal-600"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') savePhone();
                            if (e.key === 'Escape') { setEditingPhone(false); setPhoneText(customer.phone ?? ''); }
                          }}
                        />
                        <button
                          onClick={savePhone}
                          disabled={savingField}
                          className="rounded bg-neutral-800 text-white text-[10px] px-1.5 py-0.5 hover:bg-neutral-900 transition shrink-0"
                        >저장</button>
                        <button
                          onClick={() => { setEditingPhone(false); setPhoneText(customer.phone ?? ''); }}
                          className="rounded border border-gray-300 text-[10px] px-1.5 py-0.5 hover:bg-gray-100 transition shrink-0"
                        >취소</button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <a href={`tel:${customer.phone}`} className="font-medium text-teal-700 hover:underline text-[11px]">{formatPhone(customer.phone) || '미등록'}</a>
                        <button
                          type="button"
                          onClick={() => { setPhoneText(customer.phone ?? ''); setEditingPhone(true); }}
                          className="rounded border border-gray-300 text-[10px] px-1.5 py-0.5 hover:bg-gray-100 transition shrink-0 text-gray-600"
                        >수정</button>
                      </div>
                    )}
                  </td>
                  <td className={cn(LC, 'w-auto')}>개인정보 동의</td>
                  <td className={VC}>
                    {/* T-20260609-foot-CHART-CONSENT-ALIGN-SMS: 셀프접수 동의항목 정합 — 독립 체크박스 3개 */}
                    <div className="flex items-center gap-2 flex-wrap" data-testid="chart-consent-section">
                      {([
                        { label: '개인정보수집', checked: customer.privacy_consent ?? false, onToggle: togglePrivacyConsent, saving: savingField },
                        { label: '건강보험조회', checked: customer.hira_consent ?? false, onToggle: toggleHiraConsent, saving: savingField },
                        { label: '문자수신', checked: customer.sms_opt_in ?? false, onToggle: toggleSmsOptIn, saving: savingField },
                      ]).map(({ label, checked, onToggle, saving }) => (
                        <button
                          key={label}
                          type="button"
                          onClick={onToggle}
                          disabled={saving}
                          className="flex items-center gap-1 hover:opacity-80 active:scale-95 transition disabled:opacity-50"
                          title="클릭하여 동의/미동의 전환 (각 항목 독립 선택 · 셀프접수 결과 반영)"
                        >
                          <span className={cn(
                            'h-3 w-3 border rounded flex items-center justify-center transition-colors',
                            checked ? 'bg-teal-600 border-teal-600' : 'border-gray-400 bg-white',
                          )}>
                            {checked && <Check className="h-2 w-2 text-white" strokeWidth={3.5} />}
                          </span>
                          <span className={cn('text-[11px]', checked ? 'font-medium text-teal-700' : 'text-gray-600')}>{label}</span>
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>

                {/* ⑤ 전화번호 행 삭제 — T-20260508-foot-CUST-FORM-REVAMP */}

                {/* ⑥ 이메일 — T-20260513-foot-C21-INPUT-ALWAYS-ACTIVE: 항상 활성화 */}
                <tr>
                  <td className={LC}>이메일</td>
                  <td className={VC} colSpan={3}>
                    <input
                      type="email"
                      data-testid="chart-email-input"
                      value={emailText}
                      onChange={(e) => { setEmailText(e.target.value); setIsDirty(true); }}
                      placeholder="example@email.com"
                      className="h-5 w-full text-[11px] rounded border border-gray-300 px-1.5 focus:outline-none focus:border-teal-500 bg-white"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveEmail();
                      }}
                    />
                  </td>
                </tr>

                {/* ⑥-b 여권번호 — T-20260513-foot-C21-INPUT-ALWAYS-ACTIVE: 항상 활성화 */}
                <tr>
                  <td className={LC}>여권번호</td>
                  <td className={VC} colSpan={3}>
                    <input
                      type="text"
                      value={passportText}
                      onChange={(e) => { setPassportText(e.target.value.toUpperCase()); setIsDirty(true); }}
                      placeholder="예: M12345678"
                      className="h-5 w-full text-[11px] font-mono rounded border border-gray-300 px-1.5 focus:outline-none focus:border-teal-500 bg-white uppercase"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') savePassport();
                      }}
                    />
                  </td>
                </tr>

                {/* ⑦ 고객등급 드롭다운 — T-20260508-foot-CUST-FORM-REVAMP */}
                <tr>
                  <td className={LC}>고객등급</td>
                  <td className={VC} colSpan={3}>
                    <select
                      value={customer.customer_grade ?? '일반'}
                      onChange={(e) => {
                        const val = e.target.value as Customer['customer_grade'];
                        setIsDirty(true);
                        saveCustomerField({ customer_grade: val });
                      }}
                      disabled={savingField}
                      className={cn(
                        'rounded border px-2 py-0.5 text-[11px] cursor-pointer focus:outline-none focus:border-teal-500 bg-white transition',
                        customer.customer_grade === '일반' || !customer.customer_grade
                          ? 'border-gray-300 text-gray-700'
                          : customer.customer_grade === '1단계'
                          ? 'border-yellow-400 text-yellow-700 bg-yellow-50'
                          : customer.customer_grade === '2단계'
                          ? 'border-orange-400 text-orange-700 bg-orange-50'
                          : 'border-red-400 text-red-700 bg-red-50',
                      )}
                    >
                      <option value="일반">일반</option>
                      <option value="1단계">1단계</option>
                      <option value="2단계">2단계</option>
                      <option value="3단계">3단계 ⚠️</option>
                    </select>
                    {customer.customer_grade && customer.customer_grade !== '일반' && (
                      <span className="ml-2 text-[10px] text-orange-600">주의 등급</span>
                    )}
                  </td>
                </tr>

                {/* ⑧⑨ 우편번호+주소 — T-20260513-foot-C21-INPUT-ALWAYS-ACTIVE: 항상 활성화 */}
                <tr>
                  <td className={LC}>우편번호</td>
                  <td className={VC} colSpan={3}>
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        value={postalCodeText}
                        onChange={(e) => { setPostalCodeText(e.target.value.replace(/\D/g, '').slice(0, 5)); setIsDirty(true); }}
                        placeholder="12345"
                        maxLength={5}
                        inputMode="numeric"
                        className="w-20 h-5 text-[11px] font-mono rounded border border-gray-300 px-1.5 focus:outline-none focus:border-teal-500"
                      />
                      <button
                        onClick={openKakaoPostcode}
                        className="rounded border border-slate-400 bg-slate-50 text-slate-700 text-[10px] px-1.5 py-0.5 hover:bg-slate-100 transition shrink-0"
                      >
                        주소검색
                      </button>
                    </div>
                  </td>
                </tr>

                {/* ⑨ 주소 — T-20260513-foot-C21-INPUT-ALWAYS-ACTIVE: 항상 활성화 */}
                {/* T-20260510-foot-ADDRESS-DETAIL-FIX: 상세주소 입력란 */}
                <tr>
                  <td className={LC}>주소</td>
                  <td className={VC} colSpan={3}>
                    <div className="flex flex-col gap-1">
                      <Input
                        value={addressText}
                        onChange={(e) => { setAddressText(e.target.value); setIsDirty(true); }}
                        placeholder="기본주소 (우편번호 검색 시 자동입력)"
                        className="h-6 text-xs"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveAddress();
                        }}
                      />
                      <div className="flex items-center gap-1">
                        <Input
                          value={addressDetailText}
                          onChange={(e) => { setAddressDetailText(e.target.value); setIsDirty(true); }}
                          placeholder="상세주소 (동·호수·건물명 등)"
                          className="h-6 text-xs flex-1"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveAddress();
                          }}
                        />
                        <Button size="sm" variant="outline" className="h-6 text-[10px] px-2 shrink-0" onClick={() => { setAddressText(customer.address ?? ''); setAddressDetailText(customer.address_detail ?? ''); setPostalCodeText(customer.postal_code ?? ''); }}>초기화</Button>
                      </div>
                    </div>
                  </td>
                </tr>

                {/* ⑨-b 담당자 — 주소 하단, 실제 직원 드롭다운 — C2-STAFF-DROPDOWN */}
                <tr>
                  <td className={LC}>담당자</td>
                  <td className={VC} colSpan={3}>
                    <select
                      value={customer.assigned_staff_id ?? ''}
                      onChange={(e) => {
                        setIsDirty(true);
                        saveCustomerField({ assigned_staff_id: e.target.value || null });
                        setConsultationStaffId(e.target.value); // AC-6 쌍방연동
                      }}
                      disabled={savingField}
                      className="rounded border border-gray-300 px-2 py-0.5 text-[11px] cursor-pointer focus:outline-none focus:border-teal-500 bg-white hover:border-teal-400 transition"
                    >
                      <option value="">— 선택 —</option>
                      {/* C2-MANAGER-PAYMENT-MAP v3: 담당자 드롭다운에서만 role='director'(원장) 제외 — DB 비활성 금지, 코드 레벨 필터 */}
                      {/* T-20260522-foot-STAFF-NAME-UNIFY: display_name(구성명) fallback to name */}
                      {/* T-20260614-foot-STAFF-DROPDOWN-ROLE-SORT: 표시 순서만 role 정렬(상담실장→코디) — 안정정렬로 동일 role 내 기존 순서 유지 */}
                      {staffList.filter(s => s.role !== 'director').sort((a, b) => staffRoleSortIndex(a.role) - staffRoleSortIndex(b.role)).map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.display_name || s.name} ({s.role === 'consultant' ? '상담실장' : s.role === 'coordinator' ? '데스크' : s.role})
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>

                {/* ⑩ 특이 항목 삭제 — C2-REMOVE-EXTRA-FIELDS */}

                {/* ⑪ 방문경로 드롭다운 — C2-VISIT-ROUTE */}
                <tr>
                  <td className={LC}>방문경로</td>
                  <td className={VC} colSpan={3}>
                    <select
                      value={customer.visit_route ?? ''}
                      onChange={(e) => {
                        const val = e.target.value as Customer['visit_route'];
                        // T-20260519-foot-VISIT-ROUTE-DROPDOWN: optimistic update 즉시 반영
                        // → "지인소개" 선택 시 소개자 칸 즉시 표시
                        setCustomer((prev) => prev ? { ...prev, visit_route: val || null } : prev);
                        setIsDirty(true);
                        saveCustomerField({ visit_route: val || null });
                      }}
                      disabled={savingField}
                      className="rounded border border-gray-300 px-2 py-0.5 text-[11px] cursor-pointer focus:outline-none focus:border-teal-500 bg-white hover:border-teal-400 transition"
                    >
                      <option value="">— 선택 —</option>
                      <option value="TM">TM</option>
                      <option value="인바운드">인바운드</option>
                      <option value="워크인">워크인</option>
                      <option value="지인소개">지인소개</option>
                    </select>
                  </td>
                </tr>

                {/* T-20260515-foot-REFERRAL-NAME: 지인소개 시 소개자 성함 */}
                {/* AC-2 fix: referralNameText 로컬 state 바인딩 → optimistic update (saveCustomerField onChange 직접 호출 제거) */}
                {customer.visit_route === '지인소개' && (
                  <tr>
                    <td className={LC}>소개자 성함</td>
                    <td className={VC} colSpan={3}>
                      <input
                        type="text"
                        value={referralNameText}
                        onChange={(e) => {
                          setReferralNameText(e.target.value);
                          setIsDirty(true);
                        }}
                        placeholder="예: 홍길동"
                        className="rounded border border-gray-300 px-2 py-0.5 text-[11px] w-full focus:outline-none focus:border-teal-500 bg-white hover:border-teal-400 transition"
                      />
                    </td>
                  </tr>
                )}

                {/* T-20260609-foot-SELFCHECKIN-LEADSRC-UI-VISITPATH: 방문경로 소분류(유입경로) 표시
                    셀프접수 워크인 동선에서 자동 저장됨. read-only 표시 (값 있을 때만). */}
                {customer.visit_route_detail && (
                  <tr>
                    <td className={LC}>유입경로</td>
                    <td className={VC} colSpan={3} data-testid="chart-visit-route-detail">
                      {customer.visit_route_detail}
                    </td>
                  </tr>
                )}

                {/* ⑫ 예약메모 삭제됨 — AC-6: 예약메모는 2번차트 1구역(예약내역 패널)에서만 표시 (T-20260512-foot-RESV-MGMT-OVERHAUL) */}

                {/* ⑬ 예약메모 — T-20260516-foot-C2Z1-MEMO-SYNC(정본): reservation_memo_history append-only 연동 */}
                <tr>
                  <td className={cn(LC, 'align-top pt-2 border-b-0')}>예약메모</td>
                  <td className={cn(VC, 'border-b-0')} colSpan={3}>
                    {/* T-20260520-foot-RESV-MEMO-WALKIN: reservationId 없어도 customerId fallback으로 메모 작성 가능 */}
                    <ReservationMemoTimeline
                      reservationId={reservations[0]?.id}
                      customerId={customerId}
                      clinicId={customer?.clinic_id ?? ''}
                      authorName={profile?.name ?? ''}
                      compact
                    />
                  </td>
                </tr>

              </tbody>
            </table>

            {/* ─ 패키지 구매항목 요약 — T-20260510-foot-C21-PKG-ITEM-DETAIL ─ */}
            {/* T-20260520-foot-PKG-ZERO-HIDE: remaining_count===0 패키지 비노출 (FE 필터, DB 삭제 아님) */}
            {packages.filter((p) => p.status === 'active' && (p.remaining === null || p.remaining.total_remaining > 0)).length > 0 && (
              <div className="border-t border-gray-200 bg-teal-50/40 px-3 py-2 space-y-1.5 text-[11px]">
                <div className="font-semibold text-teal-800 flex items-center gap-1">
                  <PackageIcon className="h-3.5 w-3.5" /> 활성 패키지
                </div>
                {packages.filter((p) => p.status === 'active' && (p.remaining === null || p.remaining.total_remaining > 0)).map((p) => {
                  const rem = p.remaining;
                  return (
                    <div key={p.id} className="rounded border border-teal-200 bg-white px-2 py-1.5 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-teal-900 truncate">{p.package_name}</span>
                        <span className="text-[10px] text-muted-foreground shrink-0 ml-1">{p.contract_date}</span>
                      </div>
                      {rem && (
                        /* T-20260510-foot-C21-PKG-ITEM-DETAIL: 시술명/총/사용/잔여 테이블 */
                        <table className="w-full border-collapse text-[10px]">
                          <thead>
                            <tr className="text-muted-foreground border-b border-teal-100">
                              <th className="text-left pb-0.5 font-medium">시술</th>
                              <th className="text-center pb-0.5 font-medium">총</th>
                              <th className="text-center pb-0.5 font-medium">사용</th>
                              <th className="text-center pb-0.5 font-medium text-teal-700">잔여</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(p.unheated_sessions ?? 0) > 0 && (
                              <tr>
                                <td className="py-0.5">비가열</td>
                                <td className="text-center py-0.5">{p.unheated_sessions}회</td>
                                <td className="text-center py-0.5">{(p.unheated_sessions ?? 0) - rem.unheated}회</td>
                                <td className="text-center py-0.5 font-semibold text-teal-700">{rem.unheated}회</td>
                              </tr>
                            )}
                            {(p.heated_sessions ?? 0) > 0 && (
                              <tr>
                                <td className="py-0.5">가열</td>
                                <td className="text-center py-0.5">{p.heated_sessions}회</td>
                                <td className="text-center py-0.5">{(p.heated_sessions ?? 0) - rem.heated}회</td>
                                <td className="text-center py-0.5 font-semibold text-teal-700">{rem.heated}회</td>
                              </tr>
                            )}
                            {(p.podologe_sessions ?? 0) > 0 && (
                              <tr>
                                <td className="py-0.5">포돌로게</td>
                                <td className="text-center py-0.5">{p.podologe_sessions}회</td>
                                <td className="text-center py-0.5">{(p.podologe_sessions ?? 0) - (rem.podologe ?? 0)}회</td>
                                <td className="text-center py-0.5 font-semibold text-teal-700">{rem.podologe ?? 0}회</td>
                              </tr>
                            )}
                            {(p.iv_sessions ?? 0) > 0 && (
                              <tr>
                                <td className="py-0.5">수액</td>
                                <td className="text-center py-0.5">{p.iv_sessions}회</td>
                                <td className="text-center py-0.5">{(p.iv_sessions ?? 0) - rem.iv}회</td>
                                <td className="text-center py-0.5 font-semibold text-teal-700">{rem.iv}회</td>
                              </tr>
                            )}
                            {/* T-20260522-foot-PKG-TRIAL: 체험권 잔여 0이면 비노출 */}
                            {(p.trial_sessions ?? 0) > 0 && (rem.trial ?? 0) > 0 && (
                              <tr>
                                <td className="py-0.5">체험권</td>
                                <td className="text-center py-0.5">{p.trial_sessions}회</td>
                                <td className="text-center py-0.5">{(p.trial_sessions ?? 0) - (rem.trial ?? 0)}회</td>
                                <td className="text-center py-0.5 font-semibold text-teal-700">{rem.trial ?? 0}회</td>
                              </tr>
                            )}
                            {/* T-20260608-foot-PKG-REBORN-ITEM: Re:Born 6번째 항목 */}
                            {(p.reborn_sessions ?? 0) > 0 && (
                              <tr>
                                <td className="py-0.5">Re:Born</td>
                                <td className="text-center py-0.5">{p.reborn_sessions}회</td>
                                <td className="text-center py-0.5">{(p.reborn_sessions ?? 0) - (rem.reborn ?? 0)}회</td>
                                <td className="text-center py-0.5 font-semibold text-teal-700">{rem.reborn ?? 0}회</td>
                              </tr>
                            )}
                            <tr className="border-t border-teal-100">
                              <td colSpan={3} className="pt-1 text-muted-foreground">전체 잔여</td>
                              <td className="text-center pt-1 font-bold text-teal-700">{rem.total_remaining}회</td>
                            </tr>
                          </tbody>
                        </table>
                      )}
                    </div>
                  );
                })}
              </div>
            )}


            {/* ─ 탭 열 1 (문진 / 진료 탭) ─────────────────────────────── */}
            {/* T-20260522-foot-REFUND-HIST-TAB AC-3: flex 균등 배치 (좌측 쏠림 해소) */}
            <div data-testid="chart-tab-clinical" className="border-t-2 border-gray-300 shrink-0">
              <div className="flex bg-[#e2e8f0]">
                {CLINICAL_TABS.map(({ key, label }) => (
                  <Fragment key={key}>
                    <button
                      type="button"
                      onClick={() => handleClinicalTab(key)}
                      className={cn(
                        'flex-1 justify-center min-h-[44px] text-[11px] font-medium border-r border-gray-300 whitespace-nowrap transition flex items-center',
                        chartTabGroup === 'clinical' && chartTab === key
                          ? 'bg-white text-teal-700 font-semibold shadow-sm'
                          : 'text-[#475569] hover:bg-white/60',
                      )}
                    >
                      {label}
                    </button>
                    {/* T-20260601-foot-CHART-TAB-MUNJIN-DEDUP: 진료차트 탭을 펜차트 바로 옆(구 문진 자리)으로 이동 */}
                    {/* T-20260527-foot-MEDCHART-TAB-REAPPEAR: 진료차트 탭 버튼 — 항상 표시, 데이터 유무 무관 */}
                    {/* AC-2: 데이터 0건이어도 탭은 항상 visible / 역할 제한 없음(원장·치료사·데스크 공통) */}
                    {key === 'pen_chart' && (
                      <button
                        type="button"
                        data-testid="btn-open-medical-chart"
                        onClick={() => setMedicalChartOpen(true)}
                        className="flex-1 justify-center min-h-[44px] text-[11px] font-medium border-r border-gray-300 whitespace-nowrap transition flex items-center gap-1 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-semibold"
                      >
                        <Stethoscope className="h-3.5 w-3.5" />
                        진료차트
                      </button>
                    )}
                  </Fragment>
                ))}
              </div>
            </div>

            {/* ─ 탭 열 2 (이력 탭) ─────────────────────────────────────── */}
            {/* T-20260522-foot-REFUND-HIST-TAB AC-3: flex 균등 배치 (좌측 쏠림 해소) */}
            <div data-testid="chart-tab-history" className="border-b border-gray-300 shrink-0">
              <div className="flex bg-[#f1f5f9]">
                {HISTORY_TABS.map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => handleHistoryTab(key)}
                    className={cn(
                      'flex-1 justify-center min-h-[44px] text-[11px] font-medium border-r border-gray-300 whitespace-nowrap transition flex items-center',
                      chartTabGroup === 'history' && chartTab === key
                        ? 'bg-white text-teal-700 font-semibold shadow-sm'
                        : 'text-[#475569] hover:bg-white/60',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* ─ 탭 콘텐츠 ─────────────────────────────────────────────── */}
            <div
              data-testid="chart-tab-content"
              className="p-3 space-y-3">

              {/* 준비 중 탭 공통 */}
              {((chartTabGroup === 'clinical' && !IMPLEMENTED_CLINICAL.includes(chartTab)) ||
                (chartTabGroup === 'history'  && !IMPLEMENTED_HISTORY.includes(chartTab))) && (
                <div className="flex items-center justify-center py-10 text-sm text-muted-foreground border border-dashed rounded-lg">
                  준비 중 — 추후 구현 예정
                </div>
              )}

              {/* Clinical: 문진·동의서 */}
              {chartTabGroup === 'clinical' && chartTab === 'checklist' && (
            <div className="space-y-3" data-testid="checklist-tab-content">
              {/* T-20260513-foot-C21-TAB-RESTRUCTURE-C: 원장 메인 요약 뷰 (AC-3) */}
              {/* T-20260519-foot-CHART-BEFORE-CHECKIN: checklistEntries는 check_in 없이도 표시 (customer_id 기반) */}
              {checklistEntries.length > 0 && (() => {
                const latest = checklistEntries[0];
                const d = latest.checklist_data as {
                  has_allergy?: boolean; allergy_types?: string[];
                  medications?: string[]; medications_none?: boolean;
                  pain_severity?: string; medical_history?: string[];
                  prior_conditions?: string; nail_locations?: string[];
                  pain_duration?: string;
                };
                const severityLabel: Record<string, string> = { '1': '경미', '2': '불편', '3': '심함 ⚠️', '4': '매우심함 🚨' };
                const hasAlert = d.has_allergy || (!d.medications_none && (d.medications ?? []).length > 0) || (d.medical_history ?? []).length > 0;
                return (
                  <div data-testid="checklist-summary" className={`rounded-lg border p-3 text-xs ${hasAlert ? 'bg-amber-50 border-amber-200' : 'bg-teal-50 border-teal-200'}`}>
                    <div className="flex items-center gap-1.5 font-bold text-teal-800 mb-2">
                      <span className="h-2 w-2 rounded-full bg-teal-500" />
                      원장 핵심 요약
                      <span className="text-[10px] font-normal text-teal-600 ml-1">최신 체크리스트 기준</span>
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                      {d.has_allergy && (d.allergy_types ?? []).length > 0 && (
                        <div className="col-span-2 flex gap-1.5 text-rose-700 font-semibold">
                          <span className="text-muted-foreground font-normal w-14 shrink-0">🚨 알레르기</span>
                          <span>{(d.allergy_types ?? []).join(', ')}</span>
                        </div>
                      )}
                      {!d.medications_none && (d.medications ?? []).length > 0 && (
                        <div className="col-span-2 flex gap-1.5 text-orange-700">
                          <span className="text-muted-foreground w-14 shrink-0">⚠️ 복용약</span>
                          <span>{(d.medications ?? []).join(', ')}</span>
                        </div>
                      )}
                      {(d.medical_history ?? []).length > 0 && (
                        <div className="flex gap-1.5">
                          <span className="text-muted-foreground w-14 shrink-0">병력</span>
                          <span>{(d.medical_history ?? []).join(', ')}</span>
                        </div>
                      )}
                      {d.prior_conditions && (
                        <div className="flex gap-1.5">
                          <span className="text-muted-foreground w-14 shrink-0">기왕증</span>
                          <span>{d.prior_conditions}</span>
                        </div>
                      )}
                      {d.pain_severity && (
                        <div className="flex gap-1.5">
                          <span className="text-muted-foreground w-14 shrink-0">통증강도</span>
                          <span className={parseInt(d.pain_severity) >= 3 ? 'font-semibold text-orange-700' : ''}>
                            {severityLabel[d.pain_severity] ?? d.pain_severity}
                          </span>
                        </div>
                      )}
                      {(d.nail_locations ?? []).length > 0 && (
                        <div className="flex gap-1.5">
                          <span className="text-muted-foreground w-14 shrink-0">통증부위</span>
                          <span>{(d.nail_locations ?? []).join(', ')}</span>
                        </div>
                      )}
                      {d.pain_duration && (
                        <div className="flex gap-1.5">
                          <span className="text-muted-foreground w-14 shrink-0">유병기간</span>
                          <span>{d.pain_duration}</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

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

              {/* 서류발행 / 기입 완료 양식 (T-20260519-foot-PENCHART-FORMS AC-6) */}
              {submissionEntries.length > 0 && (
                <div className="rounded-lg border bg-white p-3 text-xs space-y-1">
                  <div className="font-semibold text-muted-foreground mb-1">서류발행·기입완료</div>
                  {submissionEntries.map((s, i) => {
                    // form_key → 한국어 레이블 변환
                    const FORM_KEY_LABEL: Record<string, string> = {
                      personal_checklist_general: '개인정보+체크리스트 (일반)',
                      personal_checklist_senior:  '개인정보+체크리스트 (어르신)',
                      pen_chart: '보험차트',
                      consent_form: '동의서',
                      receipt: '영수증',
                    };
                    const label = (s.template_key && FORM_KEY_LABEL[s.template_key]) || s.template_key || '-';
                    // printed_at이 null일 때 signed_at 폴백 (personal_checklist 기입 완료 시각)
                    const tsStr = s.printed_at ?? s.signed_at;
                    return (
                      <div key={i} className="flex items-center justify-between rounded bg-muted/30 px-2 py-1">
                        <span>{label}</span>
                        <span className="text-muted-foreground flex items-center gap-1">
                          <Printer className="h-3 w-3" />
                          {tsStr ? format(new Date(tsStr), 'MM-dd HH:mm') : '-'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              {checklistEntries.length === 0 && consentEntries.length === 0 && prescriptions.length === 0 && submissionEntries.length === 0 && (
                <div className="text-xs text-muted-foreground py-4 text-center">기록 없음</div>
              )}
            </div>
          )}

              {/* Clinical: 수납내역 — T-20260513-foot-C21-TAB-RESTRUCTURE-A: 상단 이동 */}
              {/* T-20260615 DWELLSWAP AC-3: payments는 HISTORY 그룹으로 이동 → 그룹 비종속(키 단독) 가드 */}
              {chartTab === 'payments' && (() => {
            // ── T-20260616-foot-CHART2-RECEIPT-RESTRUCTURE (요청 #2) ─────────────
            // 수납내역 탭은 '진료비 수납내역'만. 영수증 업로드(상담내역>결제영수증 경로)로
            // 생성된 결제 행은 제외 — 상담내역 결제영수증 섹션에서 표기(요청 #1)하므로 중복 방지.
            //   · 일반 결제(payments): memo가 '영수증 업로드…'로 시작하는 행 제외(회수1·단건 영수증 포함).
            //   · 패키지 결제(package_payments): memo==='영수증 업로드'(영수증 연결분) 제외 → 직접 결제분만 잔존.
            // ★DISPLAY-ONLY: 프론트 필터만. write 경로·집계 쿼리·스키마 불변(§3 하드가드 준수).
            const feePayments = payments.filter((p) => !(p.memo ?? '').startsWith('영수증 업로드'));
            const directPkgPayments = pkgPayments.filter((p) => p.memo !== '영수증 업로드');
            return (
            <div className="space-y-3">
              {/* 일반 결제 — 진료비 수납내역만 (영수증 업로드분 제외) */}
              <div className="rounded-lg border bg-white p-3 text-xs">
                <div className="font-semibold text-muted-foreground mb-2">수납내역</div>
                {feePayments.length === 0 ? (
                  <div className="text-muted-foreground py-2">결제 없음</div>
                ) : (
                  <div className="overflow-x-auto">
                    {/* T-20260514-foot-C2-PAYMENT-SYNC AC-3: 수납 이력 — 행 클릭으로 expand */}
                    {/* T-20260515-foot-RECEIPT-TAX-SPLIT AC-6: 현금영수증 컬럼 추가 */}
                    <table className="w-full border-collapse">
                      <thead>
                        <tr className="bg-muted/30 text-muted-foreground">
                          <th className="text-left px-2 py-1.5 font-medium border-b">일시</th>
                          <th className="text-right px-2 py-1.5 font-medium border-b">금액</th>
                          <th className="text-left px-2 py-1.5 font-medium border-b">방법</th>
                          <th className="text-left px-2 py-1.5 font-medium border-b">구분</th>
                          <th className="text-left px-2 py-1.5 font-medium border-b">현금영수증</th>
                          <th className="text-left px-2 py-1.5 font-medium border-b">메모</th>
                        </tr>
                      </thead>
                      <tbody>
                        {feePayments.map((p) => (
                          <Fragment key={p.id}>
                            <tr
                              className="border-b border-muted/20 hover:bg-muted/10 cursor-pointer select-none"
                              onClick={() => setExpandedPaymentId(prev => prev === p.id ? null : p.id)}
                            >
                              <td className="px-2 py-1.5 tabular-nums text-muted-foreground">{format(new Date(p.created_at), 'MM-dd HH:mm')}</td>
                              <td className={cn('px-2 py-1.5 text-right tabular-nums font-medium', p.payment_type === 'refund' && 'text-red-600')}>
                                {p.payment_type === 'refund' ? '-' : ''}{formatAmount(p.amount)}
                              </td>
                              {/* T-20260524-foot-PKG-LABEL-AMOUNT AC-3 */}
                              <td className="px-2 py-1.5">{METHOD_KO[p.method] ?? p.method}{p.installment > 1 ? ` ${p.installment}개월` : ''}</td>
                              <td className="px-2 py-1.5">
                                <Badge variant={p.payment_type === 'refund' ? 'destructive' : 'secondary'} className="text-[10px]">
                                  {p.payment_type === 'refund' ? '환불' : '결제'}
                                </Badge>
                              </td>
                              {/* T-20260515-foot-RECEIPT-TAX-SPLIT AC-6: 현금영수증 발행여부 */}
                              <td className="px-2 py-1.5">
                                {p.cash_receipt_issued === true ? (
                                  <span className="inline-flex items-center gap-0.5 text-emerald-700">
                                    <span>✅</span>
                                    <span className="text-[10px]">
                                      {p.cash_receipt_type === 'income_deduction' ? '소득공제' : p.cash_receipt_type === 'expense_proof' ? '지출증빙' : ''}
                                    </span>
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground/50">—</span>
                                )}
                              </td>
                              <td className="px-2 py-1.5 text-muted-foreground max-w-[100px] truncate">{p.memo ?? '-'}</td>
                            </tr>
                            {expandedPaymentId === p.id && (
                              <tr>
                                <td colSpan={6} className="px-3 pb-2 pt-1 bg-muted/5 border-b border-muted/20">
                                  <div className="text-[11px] font-semibold text-muted-foreground mb-1">수납 이력</div>
                                  <PaymentAuditLogsPanel paymentId={p.id} autoLoad />
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* 패키지 결제 — 영수증 연결분(memo='영수증 업로드')은 상담내역>결제영수증에서 표기(요청 #1) → 직접 결제분만 */}
              {directPkgPayments.length > 0 && (
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
                        {directPkgPayments.map((p) => (
                          <tr key={p.id} className="border-b border-muted/20 hover:bg-muted/10">
                            <td className="px-2 py-1.5 tabular-nums text-muted-foreground">{format(new Date(p.created_at), 'MM-dd HH:mm')}</td>
                            <td className={cn('px-2 py-1.5 text-right tabular-nums font-medium', p.payment_type === 'refund' && 'text-red-600')}>
                              {p.payment_type === 'refund' ? '-' : ''}{formatAmount(p.amount)}
                            </td>
                            {/* T-20260524-foot-PKG-LABEL-AMOUNT AC-3 */}
                            <td className="px-2 py-1.5">{METHOD_KO[p.method] ?? p.method}{p.installment > 1 ? ` ${p.installment}개월` : ''}</td>
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

              {/* T-20260513-foot-C21-TAB-RESTRUCTURE-C: 영수증 자동업로드 — AC-1 */}
              {/* T-20260616-foot-CHART2-RECEIPT-RESTRUCTURE (요청 #2): 업로드 버튼 제거 → read-only 뷰어.
                  업로드는 상담내역>결제영수증(ReceiptUploadSection write 경로)에서만 — §3 하드가드 준수. */}
              <div className="rounded-lg border bg-white p-3 text-xs">
                <div className="flex items-center gap-1.5 font-bold text-green-800 mb-2">
                  <span className="h-2 w-2 rounded-full bg-green-500" />
                  영수증 사진
                </div>
                <CustomerStorageImageSection
                  customerId={customer.id}
                  prefix="receipt"
                  label="영수증 (상담내역에서 업로드)"
                  accent="green"
                  accept="image/*"
                  readOnly
                />
              </div>
            </div>
            );
          })()}

              {/* History: 방문이력 (T-20260526-foot-VISIT-HIST-FILTER: 펼침/접기 + 메모유형 필터) */}
              {chartTabGroup === 'history' && chartTab === 'treatments' && (() => {
                // ── 특이사항 판별 키워드 (임상적으로 중요한 표기)
                const SPECIAL_KW = ['주의', '알레르기', '부작용', '특이', '금기', '과거력', '이상반응'];

                // ── 방문건별 메모 유형 계산
                const visitsWithTypes = checkInHistory.map((ci) => {
                  const treatDetails = (ci.treatment_memo?.details ?? '').trim();
                  const doctorNote = (ci.doctor_note ?? '').trim();
                  const allText = `${treatDetails} ${doctorNote}`.toLowerCase();
                  const memoTypes = new Set<string>();
                  if (treatDetails) memoTypes.add('치료메모');
                  if (doctorNote) memoTypes.add('진료메모');
                  if (SPECIAL_KW.some((kw) => allText.includes(kw))) memoTypes.add('특이사항');
                  return { ci, memoTypes, treatDetails, doctorNote };
                });

                // ── 필터 적용 (AC-3: 복합 선택, AC-4: 전체 해제 시 복원)
                const filtered = visitHistFilters.size === 0
                  ? visitsWithTypes
                  : visitsWithTypes.filter(({ memoTypes }) =>
                      Array.from(visitHistFilters).some((f) => memoTypes.has(f))
                    );

                return (
                  <div className="space-y-2 text-xs" data-testid="visit-history-panel">
                    {/* ── 컨트롤 바: 전체 펼치기/접기 + 필터 칩 (AC-1, AC-2) */}
                    <div className="flex flex-wrap items-center gap-2 pb-1">
                      {/* 전체 펼치기/접기 토글 (AC-1) */}
                      <button
                        type="button"
                        onClick={() => {
                          const next = !visitHistAllExpanded;
                          setVisitHistAllExpanded(next);
                          setVisitHistExpandedIds(
                            next ? new Set(checkInHistory.map((ci) => ci.id)) : new Set(),
                          );
                        }}
                        className="inline-flex items-center gap-1 rounded border border-teal-300 bg-teal-50 px-2 py-1 text-[11px] font-medium text-teal-700 hover:bg-teal-100 transition"
                        data-testid="visit-hist-fold-all-btn"
                      >
                        {visitHistAllExpanded
                          ? <ChevronDown className="h-3 w-3" />
                          : <ChevronRight className="h-3 w-3" />
                        }
                        {visitHistAllExpanded ? '전체 접기' : '전체 펼치기'}
                      </button>

                      {/* 메모 유형 필터 칩 (AC-2, AC-3) */}
                      {(['치료메모', '진료메모', '특이사항'] as const).map((type) => {
                        const active = visitHistFilters.has(type);
                        return (
                          <button
                            key={type}
                            type="button"
                            onClick={() => {
                              setVisitHistFilters((prev) => {
                                const next = new Set(prev);
                                if (next.has(type)) next.delete(type); else next.add(type);
                                return next;
                              });
                            }}
                            className={cn(
                              'inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition',
                              active
                                ? 'border-teal-500 bg-teal-500 text-white'
                                : 'border-gray-300 bg-white text-gray-600 hover:border-teal-400 hover:text-teal-700',
                            )}
                            data-testid={`visit-hist-filter-${type}`}
                          >
                            {type}
                          </button>
                        );
                      })}

                      {/* 필터 전체 해제 (AC-4) */}
                      {visitHistFilters.size > 0 && (
                        <button
                          type="button"
                          onClick={() => setVisitHistFilters(new Set())}
                          className="text-[10px] text-muted-foreground hover:text-destructive transition"
                          data-testid="visit-hist-filter-clear"
                        >
                          전체 해제
                        </button>
                      )}

                      {/* 필터 결과 카운트 */}
                      {visitHistFilters.size > 0 && (
                        <span className="text-[10px] text-muted-foreground">
                          {filtered.length}/{checkInHistory.length}건
                        </span>
                      )}
                    </div>

                    {/* ── 방문이력 카드 목록 */}
                    {filtered.length === 0 ? (
                      <div className="rounded-lg border border-dashed py-8 text-center text-muted-foreground" data-testid="visit-hist-empty">
                        {visitHistFilters.size > 0
                          ? '해당 메모 유형의 방문 기록이 없습니다'
                          : '방문 기록 없음'}
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {filtered.map(({ ci, memoTypes, treatDetails, doctorNote }) => {
                          const isCancelled = ci.status === 'cancelled';
                          const dateStr = format(new Date(ci.checked_in_at), 'yyyy-MM-dd');
                          const timeStr = format(new Date(ci.checked_in_at), 'HH:mm');
                          const treatContent = ci.treatment_kind ?? (ci.consultation_done ? '상담' : '');
                          const ciSubs = submissionEntries.filter((s) => s.check_in_id === ci.id);
                          const isExpanded = visitHistExpandedIds.has(ci.id);
                          const hasTreatMemo = memoTypes.has('치료메모');
                          const hasDoctorNote = memoTypes.has('진료메모');
                          const hasSpecial = memoTypes.has('특이사항');
                          const hasClinicDetail = ci.consultation_done || !!ci.treatment_kind
                            || ci.preconditioning_done || ci.pododulle_done || ci.laser_minutes != null;

                          return (
                            <div
                              key={ci.id}
                              className={cn(
                                'rounded-lg border bg-white transition',
                                isCancelled && 'opacity-60',
                                hasSpecial ? 'border-amber-300' : 'border-gray-200',
                              )}
                              data-testid="visit-hist-card"
                            >
                              {/* 카드 헤더 — 클릭 시 펼침/접기 (AC-1) */}
                              <button
                                type="button"
                                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/30 rounded-lg transition"
                                onClick={() => {
                                  setVisitHistExpandedIds((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(ci.id)) {
                                      next.delete(ci.id);
                                      // 하나라도 접으면 전체펼침 상태 해제
                                      setVisitHistAllExpanded(false);
                                    } else {
                                      next.add(ci.id);
                                    }
                                    return next;
                                  });
                                }}
                                data-testid="visit-hist-card-toggle"
                              >
                                {/* 방향 아이콘 */}
                                <span className="shrink-0 text-muted-foreground">
                                  {isExpanded
                                    ? <ChevronDown className="h-3.5 w-3.5" />
                                    : <ChevronRight className="h-3.5 w-3.5" />
                                  }
                                </span>

                                {/* 날짜·시간 */}
                                <span className={cn('tabular-nums shrink-0 font-medium', isCancelled && 'line-through text-muted-foreground')}>
                                  {dateStr}
                                </span>
                                <span className="tabular-nums shrink-0 text-muted-foreground">{timeStr}</span>

                                {/* 취소 배지 */}
                                {isCancelled && (
                                  <Badge variant="destructive" className="text-[9px] px-1 py-0">취소</Badge>
                                )}

                                {/* 시술명 */}
                                <span className="flex-1 truncate text-gray-700">{treatContent || '—'}</span>

                                {/* 메모 유형 배지 (AC-2) */}
                                <div className="flex items-center gap-1 shrink-0">
                                  {hasTreatMemo && (
                                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] text-slate-700">치료</span>
                                  )}
                                  {hasDoctorNote && (
                                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] text-slate-700">진료</span>
                                  )}
                                  {hasSpecial && (
                                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] text-amber-700 font-semibold">특이</span>
                                  )}
                                </div>

                                {/* 서류 재발급 버튼 (AC-5: 기존 CRUD 무영향) */}
                                <button
                                  type="button"
                                  disabled={isCancelled}
                                  onClick={(e) => { e.stopPropagation(); setDocReissueCheckIn(ci); }}
                                  className={cn(
                                    'flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium transition shrink-0',
                                    isCancelled
                                      ? 'border-muted text-muted-foreground cursor-not-allowed'
                                      : 'border-teal-300 bg-teal-50 text-teal-700 hover:bg-teal-100',
                                  )}
                                >
                                  <FileText className="h-3 w-3" />
                                  서류 재발급
                                </button>
                              </button>

                              {/* 접힌 상태에도 서류 목록 표시 */}
                              {!isExpanded && ciSubs.length > 0 && (
                                <div className="flex flex-wrap gap-1 px-3 pb-2">
                                  {ciSubs.map((s, i) => {
                                    const meta = s.template_key ? FORM_META[s.template_key] : undefined;
                                    const label = meta?.description ?? s.template_key ?? '서류';
                                    return (
                                      <span
                                        key={i}
                                        className="inline-flex items-center gap-0.5 rounded bg-gray-100 px-1.5 py-0.5 text-[9px] text-gray-600"
                                      >
                                        <Printer className="h-2.5 w-2.5 shrink-0" />
                                        {label}
                                      </span>
                                    );
                                  })}
                                </div>
                              )}

                              {/* 확장 영역 (AC-1: 펼침 시 상세 메모 노출) */}
                              {isExpanded && (
                                <div className="border-t border-gray-100 px-4 py-2.5 space-y-2.5" data-testid="visit-hist-card-detail">
                                  {/* 진료종류 */}
                                  {hasClinicDetail && (
                                    <div>
                                      <div className="text-[10px] font-semibold text-muted-foreground mb-1 uppercase tracking-wide">진료종류</div>
                                      <div className="grid grid-cols-2 gap-x-6 gap-y-0.5">
                                        {ci.consultation_done && (
                                          <div className="flex gap-1.5">
                                            <span className="text-muted-foreground w-12 shrink-0">상담유무</span>
                                            <span className="text-emerald-600 font-medium">○ 상담함</span>
                                          </div>
                                        )}
                                        {ci.treatment_kind && (
                                          <div className="flex gap-1.5">
                                            <span className="text-muted-foreground w-12 shrink-0">치료종류</span>
                                            <span className="font-medium">{ci.treatment_kind}</span>
                                          </div>
                                        )}
                                        {ci.preconditioning_done && (
                                          <div className="flex gap-1.5">
                                            <span className="text-muted-foreground w-12 shrink-0">프컨</span>
                                            <span className="text-emerald-600 font-medium">○</span>
                                          </div>
                                        )}
                                        {ci.pododulle_done && (
                                          <div className="flex gap-1.5">
                                            <span className="text-muted-foreground w-12 shrink-0">포돌</span>
                                            <span className="text-emerald-600 font-medium">○</span>
                                          </div>
                                        )}
                                        {ci.laser_minutes != null && (
                                          <div className="flex gap-1.5">
                                            <span className="text-muted-foreground w-12 shrink-0">레이저</span>
                                            <span>{ci.laser_minutes}분</span>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  )}

                                  {/* 치료메모 (AC-2: 치료메모=treatment_memo.details) */}
                                  {hasTreatMemo && (
                                    <div>
                                      <div className="text-[10px] font-semibold text-slate-600 mb-0.5 uppercase tracking-wide">치료메모</div>
                                      <div className="rounded bg-slate-50 border border-slate-100 px-2 py-1.5 text-gray-800 whitespace-pre-wrap">{treatDetails}</div>
                                    </div>
                                  )}

                                  {/* 진료메모 (AC-2: 진료메모=doctor_note) */}
                                  {hasDoctorNote && (
                                    <div>
                                      <div className="text-[10px] font-semibold text-slate-600 mb-0.5 uppercase tracking-wide">진료메모</div>
                                      <div className="rounded bg-slate-50 border border-slate-100 px-2 py-1.5 text-gray-800 whitespace-pre-wrap">{doctorNote}</div>
                                    </div>
                                  )}

                                  {/* 발급 서류 */}
                                  {ciSubs.length > 0 && (
                                    <div>
                                      <div className="text-[10px] font-semibold text-muted-foreground mb-0.5 uppercase tracking-wide">발급 서류</div>
                                      <div className="flex flex-wrap gap-1">
                                        {ciSubs.map((s, i) => {
                                          const meta = s.template_key ? FORM_META[s.template_key] : undefined;
                                          const label = meta?.description ?? s.template_key ?? '서류';
                                          return (
                                            <span
                                              key={i}
                                              className="inline-flex items-center gap-0.5 rounded bg-gray-100 px-1.5 py-0.5 text-[9px] text-gray-600"
                                              title={`발급: ${s.printed_at || s.signed_at ? format(new Date((s.printed_at ?? s.signed_at)!), 'yyyy-MM-dd HH:mm') : '-'}`}
                                            >
                                              <Printer className="h-2.5 w-2.5 shrink-0" />
                                              {label}
                                            </span>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  )}

                                  {/* 내용 없는 방문 */}
                                  {!hasClinicDetail && !hasTreatMemo && !hasDoctorNote && ciSubs.length === 0 && (
                                    <div className="text-muted-foreground text-center py-1">상세 기록 없음</div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* T-20260515-foot-DOC-REISSUE-BTN: 서류 재발급 모달 */}
              {docReissueCheckIn && (
                <div
                  className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
                  onClick={() => setDocReissueCheckIn(null)}
                >
                  <div
                    className="relative w-full max-w-2xl max-h-[90vh] overflow-auto rounded-xl bg-white shadow-2xl"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-center justify-between border-b px-4 py-3">
                      <div className="font-semibold text-sm">
                        서류 재발급 — {format(new Date(docReissueCheckIn.checked_in_at), 'yyyy-MM-dd HH:mm')}
                      </div>
                      <button
                        onClick={() => setDocReissueCheckIn(null)}
                        className="rounded p-1 hover:bg-gray-100"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="p-4">
                      <DocumentPrintPanel
                        checkIn={docReissueCheckIn}
                        onUpdated={() => {}}
                        altStatus={altStatus}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* History: 패키지 — T-20260510-foot-C22-SECTION-MERGE: 치료플랜 요약 제거, 티켓 상세만 표시 */}
              {chartTabGroup === 'history' && chartTab === 'packages' && (
            <div className="space-y-3">
              {/* T-20260615-foot-PKGTAB-TOE-RESTORE: 치료부위 발가락 일러스트 원상 복원(김주연 총괄, 3b6ab2f 제거분 역복원).
                  패키지명 조건 없이 패키지 탭 상단에 항상 고정 노출. 양발 발가락 10개 멀티선택.
                  저장: latestCheckIn.treatment_memo.foot_sites(신규 컬럼 0). 1번차트는 이 값 read-only 연동. */}
              <div className="relative rounded-lg border bg-white p-3" data-testid="pkg-tab-toe-section">
                {/* AC-1: 치료부위 우측 상단 KOH 균검사 ON/OFF 토글 — KOH 검사 이력 있는 환자에게 노출.
                    T-20260616-foot-KOHTOGGLE-NOTRENDER: latestCheckIn(단일 최근 내원) 키잉 시 재방문 환자에게서 토글 소멸.
                    customerId 로 전환 → KOH 보유 가장 최근 내원을 컴포넌트 내부에서 타겟팅(재방문 무관 노출). */}
                {/* AC-1: KOH 토글 + 바로 하단 피검사 토글(T-20260615-foot-BLOODTEST-TOGGLE-ADD). 우측 상단 세로 스택. */}
                <div className="absolute right-3 top-3 z-10 flex flex-col items-end gap-1.5">
                  <KohRequestToggle customerId={customer?.id ?? null} />
                  <BloodTestRequestToggle customerId={customer?.id ?? null} />
                </div>
                <FootToeIllustration
                  value={treatmentToes}
                  onChange={canEditToes ? saveTreatmentToes : undefined}
                  readOnly={!canEditToes}
                />
                {!latestCheckIn && canEditToes && (
                  <p className="mt-1 text-[11px] text-amber-600" data-testid="pkg-tab-toe-nocheckin">
                    ※ 내원(체크인) 기록이 있어야 치료부위를 저장할 수 있습니다.
                  </p>
                )}
              </div>
              {/* 구매 패키지(티켓) 상세 — T-20260510-foot-C21-PKG-ITEM-DETAIL: 시술별 상세표시 */}
              <div className="rounded-lg border bg-white p-3 text-xs">
                <div className="flex items-center justify-between mb-2">
                  <div className="font-semibold text-muted-foreground">구매 패키지(티켓)</div>
                  {(profile?.role === 'admin' || profile?.role === 'manager' || profile?.role === 'consultant') && (
                    <div className="flex items-center gap-1.5">
                      {/* T-20260511-foot-C2-PKG-MERGE-ADDON: 기존 active 패키지에 항목 합산 */}
                      {packages.some((p) => p.status === 'active') && (
                        <button
                          onClick={() => setOpenPackageAddon(true)}
                          className="inline-flex items-center gap-1 rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-[10px] font-medium text-emerald-700 hover:bg-emerald-100 transition"
                        >
                          <Plus className="h-3 w-3" /> 항목 추가
                        </button>
                      )}
                      <button
                        onClick={() => setOpenPackagePurchase(true)}
                        className="inline-flex items-center gap-1 rounded border border-teal-300 bg-teal-50 px-2 py-1 text-[10px] font-medium text-teal-700 hover:bg-teal-100 transition"
                      >
                        <Plus className="h-3 w-3" /> 구입 티켓 추가
                      </button>
                    </div>
                  )}
                </div>
                {packages.filter((p) => p.status !== 'cancelled').length === 0 ? (
                  <div className="text-muted-foreground py-2">패키지 없음</div>
                ) : (
                  <div className="space-y-3">
                    {/* T-20260522-foot-PKG-EDIT-DEL AC-5: cancelled(soft delete) 패키지 비노출 */}
                    {packages.filter((p) => p.status !== 'cancelled').map((p) => {
                      const usedSessions = packageSessions.filter((s) => s.package_id === p.id && s.status === 'used');
                      // T-20260612-foot-USAGEHIST-DELETE-RESTORE: 실수 삭제된 회차(soft-delete) — 복원용 노출
                      const deletedSessions = packageSessions.filter((s) => s.package_id === p.id && s.status === 'deleted');
                      // 시술 타입별 사용횟수 집계
                      const usedByType: Record<string, number> = {};
                      usedSessions.forEach((s) => { usedByType[s.session_type] = (usedByType[s.session_type] || 0) + 1; });
                      // T-20260511-foot-PKG-DYNAMIC-TABLE: 기입된 시술만 행으로 생성 (count > 0 || unit_price > 0)
                      const treatRows = [
                        ((p.unheated_sessions ?? 0) > 0 || (p.unheated_unit_price ?? 0) > 0) && { label: '비가열', qty: p.unheated_sessions ?? 0, unitPrice: p.unheated_unit_price ?? 0, used: usedByType['unheated_laser'] ?? 0 },
                        ((p.heated_sessions ?? 0) > 0 || (p.heated_unit_price ?? 0) > 0) && { label: '가열', qty: p.heated_sessions ?? 0, unitPrice: p.heated_unit_price ?? 0, used: usedByType['heated_laser'] ?? 0 },
                        ((p.podologe_sessions ?? 0) > 0 || (p.podologe_unit_price ?? 0) > 0) && { label: '포돌로게', qty: p.podologe_sessions ?? 0, unitPrice: p.podologe_unit_price ?? 0, used: usedByType['podologue'] ?? 0 },
                        ((p.iv_sessions ?? 0) > 0 || (p.iv_unit_price ?? 0) > 0) && { label: `수액${p.iv_company ? ` (${p.iv_company})` : ''}`, qty: p.iv_sessions ?? 0, unitPrice: p.iv_unit_price ?? 0, used: usedByType['iv'] ?? 0 },
                        // T-20260522-foot-PKG-TRIAL: 체험권 5번째 항목
                        ((p.trial_sessions ?? 0) > 0 || (p.trial_unit_price ?? 0) > 0) && { label: '체험권', qty: p.trial_sessions ?? 0, unitPrice: p.trial_unit_price ?? 0, used: usedByType['trial'] ?? 0 },
                        // T-20260608-foot-PKG-REBORN-ITEM: Re:Born 6번째 항목
                        ((p.reborn_sessions ?? 0) > 0 || (p.reborn_unit_price ?? 0) > 0) && { label: 'Re:Born', qty: p.reborn_sessions ?? 0, unitPrice: p.reborn_unit_price ?? 0, used: usedByType['reborn'] ?? 0 },
                      ].filter(Boolean) as { label: string; qty: number; unitPrice: number; used: number }[];
                      // 시술내역 리스트 (회차 차감 기록)
                      const TREAT_KO: Record<string, string> = { heated_laser: '가열', unheated_laser: '비가열', podologue: '포돌로게', iv: '수액', preconditioning: '프컨', trial: '체험권', reborn: 'Re:Born' };
                      return (
                        <div key={p.id} className="rounded-lg border border-muted/40 overflow-hidden">
                          {/* 패키지 헤더 — T-20260511-foot-C21-PKG-TICKET-DATE: 발행일자 추가 */}
                          {/* T-20260522-foot-PKG-EDIT-DEL: 수정/삭제 버튼 추가 */}
                          <div className="flex items-center justify-between bg-muted/20 px-3 py-1.5">
                            <span className="text-xs font-semibold text-teal-800">{p.package_name}</span>
                            <div className="flex items-center gap-1.5 shrink-0 ml-1">
                              {(p.contract_date || p.created_at) && (
                                <span className="text-[10px] text-muted-foreground tabular-nums">
                                  {p.contract_date
                                    ? p.contract_date.slice(0, 10)
                                    : format(new Date(p.created_at), 'yyyy-MM-dd')}
                                </span>
                              )}
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                                p.status === 'active' ? 'bg-teal-100 text-teal-700' :
                                p.status === 'refunded' ? 'bg-red-100 text-red-700' :
                                'bg-muted text-muted-foreground'
                              }`}>
                                {PKG_STATUS_KO[p.status] ?? p.status}
                              </span>
                              {/* AC-1/AC-3: 수정·삭제 버튼 — admin/manager/consultant만 */}
                              {(profile?.role === 'admin' || profile?.role === 'manager' || profile?.role === 'consultant') && (
                                <span className="flex items-center gap-0.5">
                                  <button
                                    type="button"
                                    title="패키지 수정"
                                    onClick={() => {
                                      setEditPkgDlg(p);
                                      setEditPkgForm({
                                        package_name: p.package_name,
                                        total_amount: String(p.total_amount),
                                        heated_sessions: String(p.heated_sessions ?? 0),
                                        heated_unit_price: String(p.heated_unit_price ?? 0),
                                        unheated_sessions: String(p.unheated_sessions ?? 0),
                                        unheated_unit_price: String(p.unheated_unit_price ?? 0),
                                        podologe_sessions: String(p.podologe_sessions ?? 0),
                                        podologe_unit_price: String(p.podologe_unit_price ?? 0),
                                        iv_sessions: String(p.iv_sessions ?? 0),
                                        iv_unit_price: String(p.iv_unit_price ?? 0),
                                        trial_sessions: String(p.trial_sessions ?? 0),
                                        trial_unit_price: String(p.trial_unit_price ?? 0),
                                        reborn_sessions: String(p.reborn_sessions ?? 0),
                                        reborn_unit_price: String(p.reborn_unit_price ?? 0),
                                      });
                                    }}
                                    className="h-5 w-5 flex items-center justify-center rounded hover:bg-teal-100 text-teal-600 transition"
                                  >
                                    <Pencil className="h-3 w-3" />
                                  </button>
                                  <button
                                    type="button"
                                    title="패키지 삭제"
                                    onClick={() => {
                                      // AC-3: 사용 이력(sessions) 있으면 차단
                                      const usedCount = packageSessions.filter((s) => s.package_id === p.id && s.status === 'used').length;
                                      if (usedCount > 0) {
                                        toast.error('시술 사용 이력이 있어 삭제할 수 없습니다.');
                                        return;
                                      }
                                      // AC-3: 결제 이력(pkgPayments) 있으면 차단
                                      const paidCount = pkgPayments.filter((pay) => pay.package_id === p.id && pay.payment_type === 'payment').length;
                                      if (paidCount > 0) {
                                        toast.error('결제 이력이 있어 삭제할 수 없습니다.');
                                        return;
                                      }
                                      setDeletePkgDlg(p);
                                    }}
                                    className="h-5 w-5 flex items-center justify-center rounded hover:bg-red-100 text-red-500 transition"
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </button>
                                </span>
                              )}
                            </div>
                          </div>
                          {/* T-20260616-foot-PKG-OUTSTANDING-BALANCE ③: 패키지 금액/진료비 금액 별도 표기 + 항목별 잔금(§4-A: 합산 단일표기 금지). */}
                          {(() => {
                            const rows = pkgPayments.filter((pay) => pay.package_id === p.id);
                            const pkgDue = computeOutstanding(p.total_amount, netPaidFromPayments(rows, 'package'));
                            const pkgSt = balanceStatus(pkgDue);
                            const fee = p.consultation_fee ?? 0;
                            const consultDue = computeOutstanding(fee, netPaidFromPayments(rows, 'consultation'));
                            const consultSt = balanceStatus(consultDue);
                            const showConsult = fee > 0 || netPaidFromPayments(rows, 'consultation') !== 0;
                            const balanceChip = (st: ReturnType<typeof balanceStatus>, due: number) =>
                              st === 'paid' ? (
                                <span className="text-emerald-600">완납</span>
                              ) : (
                                <span className={st === 'due' ? 'text-red-600 font-semibold' : 'text-amber-600 font-semibold'}>
                                  {balanceStatusLabel(st)} {formatAmount(Math.abs(due))}
                                </span>
                              );
                            return (
                              <div className="px-3 py-1 text-[10px] text-muted-foreground border-b border-muted/10 space-y-0.5">
                                <div className="flex items-center justify-between gap-2">
                                  <span>패키지 금액: <span className="font-semibold text-teal-700 tabular-nums">{formatAmount(p.total_amount)}</span></span>
                                  <span className="tabular-nums">잔금 {balanceChip(pkgSt, pkgDue)}</span>
                                </div>
                                {showConsult && (
                                  <div className="flex items-center justify-between gap-2">
                                    <span>진료비 <span className="opacity-70">(별도)</span>: <span className="font-semibold text-slate-700 tabular-nums">{formatAmount(fee)}</span></span>
                                    <span className="tabular-nums">잔금 {balanceChip(consultSt, consultDue)}</span>
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                          {/* 시술별 상세표 */}
                          {treatRows.length > 0 && (
                            /* T-20260510-foot-C21-PKG-ITEM-DETAIL: 잔여횟수 컬럼 추가 */
                            <table className="w-full border-collapse">
                              <thead>
                                <tr className="bg-muted/10 text-muted-foreground border-b border-muted/20">
                                  <th className="text-left px-3 py-1 font-medium text-[10px]">시술명</th>
                                  <th className="text-right px-2 py-1 font-medium text-[10px]">수가(회당)</th>
                                  <th className="text-center px-2 py-1 font-medium text-[10px]">총 횟수</th>
                                  <th className="text-center px-2 py-1 font-medium text-[10px] text-teal-700">사용</th>
                                  <th className="text-center px-2 py-1 font-medium text-[10px] text-orange-600">잔여</th>
                                </tr>
                              </thead>
                              <tbody>
                                {treatRows.map((row) => (
                                  <tr key={row.label} className="border-b border-muted/10 last:border-b-0">
                                    <td className="px-3 py-1.5 font-medium text-[11px]">{row.label}</td>
                                    <td className="px-2 py-1.5 text-right tabular-nums text-[11px]">{row.unitPrice > 0 ? formatAmount(row.unitPrice) : '-'}</td>
                                    <td className="px-2 py-1.5 text-center text-[11px]">{row.qty}회</td>
                                    <td className="px-2 py-1.5 text-center font-semibold text-teal-700 text-[11px]">{row.used}회</td>
                                    <td className="px-2 py-1.5 text-center font-semibold text-orange-600 text-[11px]">{row.qty - row.used}회</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                          {/* 시술내역 (회차 차감 기록) */}
                          {usedSessions.length > 0 && (
                            <div className="border-t border-muted/20 px-3 pb-2 pt-1.5">
                              <div className="text-[10px] text-muted-foreground mb-1 font-medium">시술내역</div>
                              <div className="space-y-0.5">
                                {usedSessions.map((s) => (
                                  <div key={s.id} className="group flex items-center gap-1.5 text-[10px] rounded px-0.5 hover:bg-muted/30 transition">
                                    <span className="text-muted-foreground w-5 tabular-nums shrink-0">{s.session_number}회</span>
                                    <span className="rounded bg-muted/40 px-1 shrink-0">{TREAT_KO[s.session_type] ?? s.session_type}</span>
                                    <span className="text-muted-foreground shrink-0">{s.session_date}</span>
                                    {s.staff_name && <span className="text-teal-600 truncate">{s.staff_name}</span>}
                                    {(profile?.role === 'admin' || profile?.role === 'manager' || profile?.role === 'director' || profile?.role === 'consultant') && (
                                      <span className="ml-auto hidden group-hover:flex items-center gap-0.5 shrink-0">
                                        {/* 수정 버튼 — consultant 포함 (package_sessions_consult_update RLS 허용) */}
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setEditSessionDlg(s);
                                            setEditSessionForm({
                                              sessionType: s.session_type,
                                              sessionDate: s.session_date,
                                              therapistId: s.performed_by ?? '',
                                            });
                                          }}
                                          className="h-5 w-5 flex items-center justify-center rounded hover:bg-teal-100 text-teal-600"
                                          title="수정"
                                        >
                                          <Pencil className="h-3 w-3" />
                                        </button>
                                        {/* 삭제 버튼 — admin/manager/director만 (is_admin_or_manager() DELETE 정책, consultant 불허) */}
                                        {(profile?.role === 'admin' || profile?.role === 'manager' || profile?.role === 'director') && (
                                          <button
                                            type="button"
                                            onClick={() => deleteSession(s)}
                                            className="h-5 w-5 flex items-center justify-center rounded hover:bg-red-100 text-red-500"
                                            title="삭제"
                                          >
                                            <Trash2 className="h-3 w-3" />
                                          </button>
                                        )}
                                      </span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {/* T-20260612-foot-USAGEHIST-DELETE-RESTORE: 삭제된 시술내역 — 복원(원복) */}
                          {deletedSessions.length > 0 && (profile?.role === 'admin' || profile?.role === 'manager' || profile?.role === 'director') && (
                            <div className="border-t border-dashed border-red-200 bg-red-50/40 px-3 pb-2 pt-1.5">
                              <div className="text-[10px] text-red-400 mb-1 font-medium">삭제된 시술내역 ({deletedSessions.length}건) — 복원 가능</div>
                              <div className="space-y-0.5">
                                {deletedSessions.map((s) => (
                                  <div key={s.id} className="group flex items-center gap-1.5 text-[10px] rounded px-0.5 hover:bg-red-100/50 transition">
                                    <span className="text-red-300 w-5 tabular-nums shrink-0 line-through">{s.session_number}회</span>
                                    <span className="rounded bg-red-100/60 text-red-500 px-1 shrink-0 line-through">{TREAT_KO[s.session_type] ?? s.session_type}</span>
                                    <span className="text-red-300 shrink-0 line-through">{s.session_date}</span>
                                    {s.staff_name && <span className="text-red-400 truncate line-through">{s.staff_name}</span>}
                                    <button
                                      type="button"
                                      onClick={() => restoreSession(s)}
                                      className="ml-auto flex items-center gap-0.5 shrink-0 h-5 px-1.5 rounded bg-white border border-teal-200 hover:bg-teal-50 text-teal-600 font-medium transition"
                                      title="복원"
                                    >
                                      <RotateCcw className="h-3 w-3" /> 복원
                                    </button>
                                  </div>
                                ))}
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

              {/* History: 진료이미지 — T-20260513-foot-C21-TAB-RESTRUCTURE-B: 업로드/삭제/출력 + 발톱이력 */}
              {chartTabGroup === 'history' && chartTab === 'images' && (
            <div className="space-y-3">
              {/* 진료이미지 — Storage 기반 업로드/삭제/출력 (쌍방연동) */}
              <div className="rounded-lg border bg-white p-3 text-xs">
                <div className="flex items-center justify-between mb-2">
                  <span className="flex items-center gap-1.5 font-bold text-teal-800">
                    <span className="h-2 w-2 rounded-full bg-teal-500" />
                    진료이미지
                  </span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-teal-600">1번↔2번차트 쌍방연동</span>
                    <button
                      type="button"
                      onClick={() => {
                        const imgs = treatmentImageUrls.filter(Boolean);
                        if (imgs.length === 0) { toast.error('출력할 이미지가 없습니다'); return; }
                        const today = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
                        const imgTags = imgs.map((url, i) => `<div class="photo-item"><img src="${url}" alt="진료이미지 ${i+1}" /><p class="photo-label">사진 ${i+1}</p></div>`).join('');
                        const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>진료이미지 — ${customer.name}</title><style>@page{size:A4 landscape;margin:12mm}body{font-family:'Malgun Gothic',sans-serif;margin:0;padding:0;background:#fff}.header{text-align:center;margin-bottom:8px;border-bottom:1.5px solid #333;padding-bottom:6px}.header h2{font-size:16px;margin:0 0 2px}.header p{font-size:11px;color:#666;margin:0}.photo-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;padding:8px 0}.photo-item{text-align:center}.photo-item img{width:100%;height:160px;object-fit:cover;border:1px solid #ccc;border-radius:4px}.photo-label{font-size:10px;color:#555;margin-top:3px}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head><body><div class="header"><h2>진료이미지 — ${customer.name}</h2><p>출력일: ${today} · 총 ${imgs.length}장</p></div><div class="photo-grid">${imgTags}</div></body></html>`;
                        const w = window.open('', '_blank');
                        if (!w) { toast.error('팝업이 차단되었습니다'); return; }
                        w.document.write(html); w.document.close(); w.focus();
                        const firstImg = w.document.querySelector('img');
                        if (firstImg) { firstImg.onload = () => w.print(); } else { setTimeout(() => w.print(), 600); }
                      }}
                      className="inline-flex items-center gap-1 rounded border border-teal-200 bg-white px-2 py-0.5 text-[10px] text-teal-700 hover:bg-teal-50 transition"
                    >
                      <Printer className="h-3 w-3" /> 출력
                    </button>
                  </div>
                </div>
                <TreatmentImagesSection
                  customerId={customer.id}
                  onUrlsLoaded={(urls) => setTreatmentImageUrls(urls)}
                />
              </div>
              {/* 발톱 치료 before·after 일자별 이력 (AC-6) */}
              {checkInHistory.filter((ci) => ci.treatment_photos && ci.treatment_photos.length > 0).length > 0 && (
                <div className="rounded-lg border bg-white p-3 text-xs">
                  <div className="flex items-center gap-1.5 font-bold text-amber-800 mb-2">
                    <span className="h-2 w-2 rounded-full bg-amber-500" />
                    발톱 치료 이력 (Before/After)
                  </div>
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
                </div>
              )}
            </div>
          )}

              {/* History: 상담내역 — T-20260517-foot-C2-CONSULT-DOCS: 필수서류 2그룹 분리 */}
              {chartTabGroup === 'history' && chartTab === 'consultations' && (
            <div className="space-y-3">

              {/* ── 그룹1 (개인정보/체크리스트) 제거됨 — T-20260521-foot-PENCHART-VIEW-SPLIT-REOPEN AC-7
                  CHECKLIST-REMOVE로 personal_checklist form_templates soft-delete 완료.
                  발건강 질문지(그룹3)가 동일 내용을 대체하므로 중복 표시 제거. ── */}

              {/* ── 그룹2: 환불 / 비급여 동의서 — AC-R1/R2: 합본 기준 단일 상태 ── */}
              <div className="rounded-lg border bg-white p-3 text-xs">
                <div className="flex items-center gap-1.5 font-bold text-slate-800 mb-2">
                  <span className="h-2 w-2 rounded-full bg-slate-500" />
                  환불 / 비급여 동의서
                </div>
                {/* AC-R2: 개별 서브항목 제거 → 합본 단일 상태 */}
                {/* T-20260520-foot-PENCHART-VIEW-SPLIT: form_submissions refund_consent 포함 */}
                {(() => {
                  const hasOld = consentEntries.some((c) => c.form_type === 'non_covered') || consentEntries.some((c) => c.form_type === 'refund');
                  const hasNew = submissionEntries.some((s) => s.template_key === 'refund_consent');
                  const done = hasOld || hasNew;
                  const dateStr = (() => {
                    if (hasNew) {
                      const newest = submissionEntries.filter((s) => s.template_key === 'refund_consent')[0];
                      const d = newest?.printed_at ?? newest?.signed_at;
                      return d ? format(new Date(d), 'MM-dd') : null;
                    }
                    const dateEntry = consentEntries.find((c) => c.form_type === 'non_covered') ?? consentEntries.find((c) => c.form_type === 'refund');
                    return dateEntry ? format(new Date(dateEntry.signed_at), 'MM-dd') : null;
                  })();
                  return (
                    <div className={`flex items-center gap-2 rounded px-2 py-1 mb-2 ${done ? 'bg-slate-50' : 'bg-gray-50'}`}>
                      <span className={done ? 'text-slate-600' : 'text-gray-300'}>{done ? '✓' : '○'}</span>
                      <span className={done ? 'text-slate-700 font-medium' : 'text-muted-foreground'}>합본 양식 (환불 + 비급여)</span>
                      {done && dateStr && <span className="ml-auto text-muted-foreground text-[10px]">{dateStr}</span>}
                    </div>
                  );
                })()}
                {/* T-20260520-foot-PENCHART-VIEW-SPLIT AC-5: [작성] → 펜차트 탭 이동 (B안 브릿지) */}
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => { handleClinicalTab('pen_chart'); }}
                    className="flex-1 rounded border border-slate-200 bg-slate-50 py-1 text-[10px] font-medium text-slate-600 hover:bg-slate-100 transition"
                    title="펜차트 탭에서 작성"
                  >펜차트에서 작성</button>
                  <button
                    type="button"
                    onClick={() => {
                      const hasNew = submissionEntries.some((s) => s.template_key === 'refund_consent');
                      const hasOld = consentEntries.some((c) => c.form_type === 'refund') || consentEntries.some((c) => c.form_type === 'non_covered');
                      if (!hasNew && !hasOld) return;
                      void openSubmissionViewer(2, customer.id);
                      setViewDocGroup(2);
                    }}
                    disabled={
                      !submissionEntries.some((s) => s.template_key === 'refund_consent') &&
                      !consentEntries.some((c) => c.form_type === 'refund') &&
                      !consentEntries.some((c) => c.form_type === 'non_covered')
                    }
                    className="flex-1 rounded border border-gray-200 bg-white py-1 text-[10px] font-medium text-gray-600 hover:bg-gray-50 transition disabled:opacity-40 disabled:cursor-not-allowed"
                  >내용보기</button>
                </div>
              </div>

              {/* ── 그룹3: 발건강 질문지 — T-20260520-foot-PENCHART-VIEW-SPLIT ── */}
              <div className="rounded-lg border bg-white p-3 text-xs">
                <div className="flex items-center gap-1.5 font-bold text-teal-800 mb-2">
                  <span className="h-2 w-2 rounded-full bg-teal-500" />
                  발건강 질문지
                </div>
                {/* T-20260602-foot-CHART2-HEALTHQ-VIEWER: 자가작성(health_q_results)도
                    [내용보기] 활성화 대상에 포함. 기존엔 펜차트(form_submissions)만 인식해
                    자가작성 제출 고객은 버튼이 영구 비활성이었음(근본원인). */}
                {(() => {
                  const hasPenHQ = submissionEntries.some((s) => s.template_key?.startsWith('health_questionnaire_'));
                  const hasSelfHQ = healthQResults.length > 0;
                  const hasHQ = hasPenHQ || hasSelfHQ;
                  const dateStr = (() => {
                    if (!hasHQ) return null;
                    const penNewest = submissionEntries.filter((s) => s.template_key?.startsWith('health_questionnaire_'))[0];
                    const penDate = penNewest?.printed_at ?? penNewest?.signed_at ?? null;
                    const selfDate = healthQResults[0]?.submitted_at ?? null;
                    // 둘 중 최신
                    const d = [penDate, selfDate].filter(Boolean).sort().reverse()[0];
                    return d ? format(new Date(d), 'MM-dd') : null;
                  })();
                  return (
                    <div className={`flex items-center gap-2 rounded px-2 py-1 mb-2 ${hasHQ ? 'bg-teal-50' : 'bg-gray-50'}`}>
                      <span className={hasHQ ? 'text-teal-600' : 'text-gray-300'}>{hasHQ ? '✓' : '○'}</span>
                      <span className={hasHQ ? 'text-teal-700 font-medium' : 'text-muted-foreground'}>
                        발건강 질문지 (일반 / 어르신용){hasSelfHQ && !hasPenHQ ? ' · 자가작성' : ''}
                      </span>
                      {hasHQ && dateStr && <span className="ml-auto text-muted-foreground text-[10px]">{dateStr}</span>}
                    </div>
                  );
                })()}
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => { handleClinicalTab('pen_chart'); }}
                    className="flex-1 rounded border border-teal-200 bg-teal-50 py-1 text-[10px] font-medium text-teal-600 hover:bg-teal-100 transition"
                    title="펜차트 탭에서 작성"
                  >펜차트에서 작성</button>
                  <button
                    type="button"
                    onClick={() => {
                      const hasHQ = submissionEntries.some((s) => s.template_key?.startsWith('health_questionnaire_')) || healthQResults.length > 0;
                      if (!hasHQ) return;
                      // 펜차트 PNG(form_submissions)가 있으면 함께 로드, 없으면 빈 배열 → 자가작성만 표시
                      void openSubmissionViewer(3, customer.id);
                      setViewDocGroup(3);
                    }}
                    disabled={!submissionEntries.some((s) => s.template_key?.startsWith('health_questionnaire_')) && healthQResults.length === 0}
                    className="flex-1 rounded border border-gray-200 bg-white py-1 text-[10px] font-medium text-gray-600 hover:bg-gray-50 transition disabled:opacity-40 disabled:cursor-not-allowed"
                  >내용보기</button>
                </div>
              </div>

              {/* ── 결제영수증 (AC-4: 기존 기능 유지 + 자동 매출 산정 이미 도입됨) ── */}
              <div className="rounded-lg border bg-white p-3 text-xs">
                <ReceiptUploadSection
                  customerId={customer.id}
                  clinicId={customer.clinic_id}
                  onPaymentCreated={refreshPayments}
                />
              </div>

              {/* 영수증 연결 수납내역 — T-20260616-foot-CHART2-RECEIPT-RESTRUCTURE (요청 #1) */}
              {/* 영수증과 연결된 수납내역을 결제영수증 영역에 함께 표기. **패키지 결제 건만**.
                  영수증 업로드 write 경로(ReceiptUploadSection)는 회수>1 영수증을 package_payments(memo='영수증 업로드')로
                  적재 → 원천을 pkgPayments로 전환(기존 payments 단일테이블 필터는 회수1·단건만 잡혀 패키지 영수증 누락).
                  단일회차/진료비 건은 제외(스펙 §4-1). ★DISPLAY-ONLY: 표시 필터만, write·집계 불변. */}
              {pkgPayments.filter((p) => p.memo === '영수증 업로드').length > 0 && (
                <div className="rounded-lg border bg-white p-3 text-xs">
                  <div className="flex items-center gap-1.5 font-semibold text-green-800 mb-2">
                    <span className="h-2 w-2 rounded-full bg-green-500" />
                    영수증 연결 수납내역
                  </div>
                  <div className="space-y-1">
                    {pkgPayments
                      .filter((p) => p.memo === '영수증 업로드')
                      .map((p) => (
                        <div key={p.id} className="flex items-center gap-2 rounded bg-green-50 px-2 py-1">
                          <span className="text-muted-foreground tabular-nums">{format(new Date(p.created_at), 'MM-dd HH:mm')}</span>
                          <span className="font-semibold text-green-700">{formatAmount(p.amount)}</span>
                          {/* T-20260524-foot-PKG-LABEL-AMOUNT AC-3 */}
                          <span className="text-muted-foreground">{METHOD_KO[p.method] ?? p.method}</span>
                          <Badge variant="secondary" className="text-[10px] ml-auto">패키지 결제 연결</Badge>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
          )}

              {/* Clinical: 경과내역 — T-20260513-foot-C21-TAB-RESTRUCTURE-B: 경과분석지 + 간편차트 연동 제거 */}
              {chartTabGroup === 'clinical' && chartTab === 'progress' && (
            <div className="space-y-3">
              {/* 경과분석지 업로드 */}
              <div className="rounded-lg border bg-white p-3 text-xs">
                <div className="flex items-center gap-1.5 font-bold text-orange-800 mb-2">
                  <span className="h-2 w-2 rounded-full bg-orange-500" />
                  경과분석지
                </div>
                <CustomerStorageImageSection customerId={customer.id} prefix="progress" label="경과분석지 업로드" accent="orange" />
              </div>
            </div>
          )}

              {/* Clinical: 서류발행 — orphan 보존(T-20260615 DWELLSWAP AC-1: 탭 진입점은 예약내역으로 대체, 렌더는 유지) */}
              {chartTabGroup === 'clinical' && chartTab === 'documents' && (
            <div className="space-y-3">
              {latestCheckIn ? (
                <DocumentPrintPanel
                  checkIn={latestCheckIn}
                  onUpdated={refreshPayments}
                  altStatus={altStatus}
                />
              ) : (
                <div className="flex items-center justify-center py-10 text-sm text-muted-foreground border border-dashed rounded-lg">
                  접수 기록이 없어 서류 발행을 사용할 수 없습니다
                </div>
              )}
            </div>
          )}

              {/* Clinical: 예약내역 — T-20260615-foot-CHART2-TABS-RESVTAB-DWELLSWAP AC-1 */}
              {/*   기존 2구역(우측 사이드) 예약내역 패널을 이 탭으로 이동. 핸들러·testid 동일 보존. */}
              {chartTab === 'reservations' && (
            <div className="space-y-3" data-testid="reservations-tab-content">
              {/* AC-2: 2구역에 있던 '최근 방문'을 예약내역 탭으로 이동(중복 제거). 콘텐츠 동등. */}
              <div className="rounded-lg border bg-white p-3 text-xs" data-testid="resv-tab-last-visit">
                <div className="text-[11px] font-semibold text-[#2d2d2d] mb-1">최근 방문</div>
                <div className="text-xs text-gray-700">
                  {latestCheckIn
                    ? format(new Date(latestCheckIn.checked_in_at), 'yyyy-MM-dd HH:mm')
                    : '방문 이력 없음'}
                </div>
              </div>
              <div className="rounded-lg border bg-white p-3 text-xs">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[11px] font-semibold text-[#2d2d2d]">예약내역</div>
                  {/* T-20260515-foot-INLINE-RESV: 다음 예약 → 인라인 예약 패널 (페이지 이동 없음) */}
                  <button
                    type="button"
                    onClick={() => {
                      setInlineResvMemo('');
                      setInlineResvDate(format(addDays(new Date(), 1), 'yyyy-MM-dd'));
                      setInlineResvSlotMap({});
                      setInlineResvOpen(true);
                    }}
                    className="inline-flex items-center gap-1 rounded border border-teal-300 bg-teal-50 px-1.5 py-0.5 text-[10px] font-medium text-teal-700 hover:bg-teal-100 transition"
                    data-testid="btn-next-reservation"
                  >
                    <Plus className="h-3 w-3" /> 다음 예약
                  </button>
                </div>
                {reservations.length === 0 ? (
                  <div className="text-[11px] text-muted-foreground py-2">예약 없음</div>
                ) : (
                  <div className="space-y-1.5">
                    {reservations.slice(0, 5).map((r) => (
                      <div key={r.id} className="space-y-0.5">
                        {/* T-20260525-foot-RESV-REDCHECK-REMOVE: 빨간 체크(status badge) 제거 — 변경 사유 직접 표시로 대체 */}
                        <button
                          type="button"
                          onClick={() => {
                            setEditResvId(r.id);
                            setEditResvForm({
                              date: r.reservation_date,
                              startTime: r.reservation_time.slice(0, 5),
                              memo: resvMemoInputs[r.id] ?? r.booking_memo ?? '',
                              // T-20260524-foot-DESIG-BIDIRECT: 예약의 preferred_therapist_id 로드 (수정 모달은 기존 값 복원)
                              therapistId: r.preferred_therapist_id ?? '',
                              visitType: r.visit_type,
                            });
                          }}
                          className="w-full flex items-center text-[11px] rounded hover:bg-muted/50 px-1 py-0.5 transition text-left"
                        >
                          <span className="text-gray-700">{r.reservation_date} {r.reservation_time.slice(0, 5)}</span>
                        </button>
                        {/* T-20260615-foot-RESVTAB-MEMO-ICON-SCROLLFIX AC-1: 항상 열린 입력창 → 표시(텍스트+✏️)↔편집폼 토글.
                            저장 로직·데이터모델 불변 — saveResvMemo 가 기존 append-only RPC 그대로 호출(표시·토글만). */}
                        {editingResvMemoId === r.id ? (
                          <div className="flex items-center gap-1" data-testid="resv-memo-edit-form">
                            <input
                              type="text"
                              autoFocus
                              value={resvMemoInputs[r.id] ?? ''}
                              onChange={(e) => setResvMemoInputs(prev => ({ ...prev, [r.id]: e.target.value }))}
                              onKeyDown={async (e) => {
                                if (e.key === 'Escape') { setEditingResvMemoId(null); return; }
                                if (e.key !== 'Enter') return;
                                await saveResvMemo(r.id);
                              }}
                              placeholder="예약메모 추가"
                              className="flex-1 h-5 text-[10px] rounded border border-gray-200 px-1.5 focus:outline-none focus:border-teal-400 bg-white text-gray-600 placeholder:text-gray-300"
                            />
                            <button
                              type="button"
                              data-testid="resv-memo-save"
                              onClick={() => saveResvMemo(r.id)}
                              className="shrink-0 h-5 px-1.5 rounded bg-neutral-800 text-white text-[10px] font-medium hover:bg-neutral-900 transition"
                            >
                              저장
                            </button>
                            <button
                              type="button"
                              data-testid="resv-memo-cancel"
                              onClick={() => { setResvMemoInputs(prev => ({ ...prev, [r.id]: '' })); setEditingResvMemoId(null); }}
                              className="shrink-0 h-5 px-1.5 rounded border border-gray-200 text-gray-500 text-[10px] hover:bg-gray-50 transition"
                            >
                              취소
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            data-testid="resv-memo-display"
                            onClick={() => setEditingResvMemoId(r.id)}
                            className="group w-full flex items-center gap-1 h-5 rounded px-1.5 text-left hover:bg-muted/40 transition"
                          >
                            <span className={cn('flex-1 truncate text-[10px]', r.booking_memo ? 'text-gray-600' : 'text-gray-300')}>
                              {r.booking_memo || '예약메모 추가'}
                            </span>
                            <Pencil className="h-3 w-3 shrink-0 text-gray-400 group-hover:text-teal-600" />
                          </button>
                        )}
                        {/* T-20260522-foot-RESV-HISTORY-SYNC AC-2/3: 예약 변경 이력 (공유 컴포넌트) */}
                        <ReservationAuditLogPanel
                          reservationId={r.id}
                          compact
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

              {/* Clinical: 검사결과 — T-20260513-foot-C21-TAB-RESTRUCTURE-B: KOH균검사 쌍방연동 */}
              {chartTabGroup === 'clinical' && chartTab === 'test_result' && (
            <div className="space-y-3">
              <div className="rounded-lg border bg-white p-3 text-xs">
                <div className="flex items-center justify-between mb-2">
                  <span className="flex items-center gap-1.5 font-bold text-teal-800">
                    <span className="h-2 w-2 rounded-full bg-teal-500" />
                    KOH균검사
                  </span>
                  <span className="text-[10px] text-teal-600">1번↔2번차트 쌍방연동</span>
                </div>
                <CustomerStorageImageSection
                  customerId={customer.id}
                  prefix="koh-results"
                  label="KOH균검사 결과 업로드"
                  accent="green"
                  accept="image/*"
                />
              </div>
              {/* AC-4: 진료대시보드 균검사지에서 발행된 검사결과 보고서 자동 표시(읽기전용·비가역) */}
              <KohPublishedResults clinicId={customer.clinic_id} customerId={customer.id} />
            </div>
          )}

              {/* Clinical: 펜차트 — T-20260513-foot-C21-TAB-RESTRUCTURE-C (AC-4)
                  T-20260519-foot-PENCHART-FORM-ADD: checkInId + 고객 기본정보 전달
                    → form_submissions.check_in_id 자동 연동 (AC-4)
                  T-20260520-foot-PENCHART-VIEW-SPLIT HOTFIX2: onFormSubmissionSaved
                    → 저장 후 상담내역 탭 [내용보기] 즉시 활성화 */}
              {chartTabGroup === 'clinical' && chartTab === 'pen_chart' && (
                // T-20260523-foot-PENCHART-FORM-AUTOFILL AC-8: customerRrn = rrnFull (전체 표시, 마스킹 제거)
                <PenChartTab
                  customerId={customer.id}
                  clinicId={customer.clinic_id}
                  checkInId={latestCheckIn?.id}
                  customerName={customer.name}
                  customerPhone={customer.phone ?? undefined}
                  customerBirthDate={customer.birth_date ?? undefined}
                  customerChartNumber={customer.chart_number?.toString() ?? undefined}
                  customerRrn={rrnFull ?? undefined}
                  onFormSubmissionSaved={refreshSubmissionEntries}
                />
              )}

              {/* History: 환불내역 — T-20260522-foot-REFUND-HIST-TAB */}
              {chartTabGroup === 'history' && chartTab === 'refunds' && (() => {
                // payments + package_payments 중 payment_type='refund' 필터링, 최신순 정렬
                type RefundRow = { id: string; amount: number; method: string; created_at: string; memo: string | null; source: 'payment' | 'package' };
                const allRefunds: RefundRow[] = [
                  ...payments.filter((p) => p.payment_type === 'refund').map((p) => ({
                    id: p.id, amount: p.amount, method: p.method, created_at: p.created_at, memo: p.memo, source: 'payment' as const,
                  })),
                  ...pkgPayments.filter((p) => p.payment_type === 'refund').map((p) => ({
                    id: p.id, amount: p.amount, method: p.method, created_at: p.created_at, memo: p.memo, source: 'package' as const,
                  })),
                ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
                const totalRefund = allRefunds.reduce((s, r) => s + r.amount, 0);
                return (
                  <div className="space-y-3">
                    <div className="rounded-lg border bg-white p-3 text-xs">
                      <div className="flex items-center gap-1.5 font-bold text-red-700 mb-2">
                        <span className="h-2 w-2 rounded-full bg-red-500" />
                        환불내역
                        {allRefunds.length > 0 && (
                          <span className="ml-auto text-red-600 tabular-nums font-semibold">
                            합계 -{formatAmount(totalRefund)}
                          </span>
                        )}
                      </div>
                      {allRefunds.length === 0 ? (
                        <div className="py-6 text-center text-muted-foreground border border-dashed rounded">
                          환불 내역 없음
                        </div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full border-collapse">
                            <thead>
                              <tr className="bg-muted/30 text-muted-foreground">
                                <th className="text-left px-2 py-1.5 font-medium border-b">일시</th>
                                <th className="text-right px-2 py-1.5 font-medium border-b">환불금액</th>
                                <th className="text-left px-2 py-1.5 font-medium border-b">수단</th>
                                <th className="text-left px-2 py-1.5 font-medium border-b">구분</th>
                                <th className="text-left px-2 py-1.5 font-medium border-b">메모</th>
                              </tr>
                            </thead>
                            <tbody>
                              {allRefunds.map((r) => (
                                <tr key={r.id} className="border-b border-muted/20 hover:bg-red-50/40 bg-red-50/20">
                                  <td className="px-2 py-1.5 tabular-nums text-muted-foreground">{format(new Date(r.created_at), 'MM-dd HH:mm')}</td>
                                  <td className="px-2 py-1.5 text-right tabular-nums font-semibold text-red-600">-{formatAmount(r.amount)}</td>
                                  {/* T-20260524-foot-PKG-LABEL-AMOUNT AC-3 */}
                                  <td className="px-2 py-1.5">{METHOD_KO[r.method] ?? r.method}</td>
                                  <td className="px-2 py-1.5">
                                    <Badge variant="destructive" className="text-[10px]">
                                      {r.source === 'package' ? '패키지 환불' : '단건 환불'}
                                    </Badge>
                                  </td>
                                  <td className="px-2 py-1.5 text-muted-foreground max-w-[120px] truncate">{r.memo ?? '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* Clinical: 체류시간 — T-20260602-foot-SLOT-DWELL-TIME (B안) */}
              {/* T-20260615 DWELLSWAP AC-3: slot_dwell은 CLINICAL 그룹으로 이동 → 그룹 비종속(키 단독) 가드 */}
              {chartTab === 'slot_dwell' && (() => {
                if (slotDwellLoading) {
                  return (
                    <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin mr-2" /> 체류시간 불러오는 중…
                    </div>
                  );
                }
                // 방문건별로 세그먼트 그룹화 (checkInHistory 순서 = 최신순)
                const byCheckIn = new Map<string, SlotDwellSeg[]>();
                for (const seg of slotDwell) {
                  const arr = byCheckIn.get(seg.check_in_id) ?? [];
                  arr.push(seg);
                  byCheckIn.set(seg.check_in_id, arr);
                }
                const visits = checkInHistory.filter((ci) => byCheckIn.has(ci.id));
                if (visits.length === 0) {
                  return (
                    <div className="py-8 text-center text-sm text-muted-foreground border border-dashed rounded-lg">
                      슬롯 체류시간 기록 없음
                    </div>
                  );
                }
                return (
                  // T-20260615-foot-RESVTAB-MEMO-ICON-SCROLLFIX AC-2: 체류시간 콘텐츠 스크롤을 이 탭 영역으로 재한정.
                  //   max-h + overflow-y-auto → 좌측 패널 전체(고객정보)·우측 2구역으로 스크롤이 번지지 않고 박스 내부에서만 스크롤.
                  //   overscroll-contain → 끝점 도달 시 스크롤 체이닝(전이) 차단. 이 분기 한정 → 수납내역 등 타 탭 부수효과 0.
                  <div
                    className="space-y-3 max-h-[70vh] overflow-y-auto overscroll-contain"
                    data-testid="slot-dwell-panel"
                  >
                    <div className="text-[11px] text-muted-foreground">
                      방문건별 각 슬롯(상담실·치료실 등)에 머문 시간입니다. 슬롯 이동 시각(전이 로그) 기준 산출.
                    </div>
                    {visits.map((ci) => {
                      const segs = (byCheckIn.get(ci.id) ?? []).slice().sort((a, b) => a.seq - b.seq);
                      // T-20260603-foot-SLOT-DWELL-LIVE-TICK: 진행중(is_current) 세그먼트는 now 기준 라이브 경과,
                      // 완료(is_current=false)는 RPC 스냅샷 duration_seconds 그대로 (AC-3 불변)
                      const effSec = (s: SlotDwellSeg) =>
                        s.is_current
                          ? Math.max(0, (slotDwellNowMs - new Date(s.entered_at).getTime()) / 1000)
                          : s.duration_seconds;
                      // 슬롯(상태)별 누적 집계 (AC-1: 진행중 포함 시 라이브)
                      const agg = new Map<string, number>();
                      for (const s of segs) agg.set(s.status, (agg.get(s.status) ?? 0) + effSec(s));
                      const totalSec = segs.reduce((sum, s) => sum + effSec(s), 0);
                      return (
                        <div key={ci.id} className="rounded-lg border bg-white p-3 text-xs" data-testid="slot-dwell-visit">
                          <div className="flex items-center gap-1.5 font-bold text-teal-700 mb-2">
                            <Timer className="h-3.5 w-3.5" />
                            {format(new Date(ci.checked_in_at), 'yyyy-MM-dd HH:mm')}
                            <span className="ml-auto text-[10px] font-medium text-muted-foreground">
                              총 원내 체류 {formatDwell(totalSec)}
                            </span>
                          </div>
                          {/* 슬롯별 누적 체류시간 */}
                          <table className="w-full border-collapse">
                            <thead>
                              <tr className="bg-muted/30 text-muted-foreground">
                                <th className="text-left px-2 py-1.5 font-medium border-b">슬롯</th>
                                <th className="text-right px-2 py-1.5 font-medium border-b">체류시간</th>
                              </tr>
                            </thead>
                            <tbody>
                              {Array.from(agg.entries()).map(([status, sec]) => (
                                <tr key={status} className="border-b border-muted/20">
                                  <td className="px-2 py-1.5">{STATUS_KO[status as keyof typeof STATUS_KO] ?? status}</td>
                                  <td className="px-2 py-1.5 text-right tabular-nums font-semibold text-teal-700">{formatDwell(sec)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {/* 시간순 동선 (현재 슬롯은 진행중 표시) */}
                          {segs.length > 1 && (
                            <div className="mt-2 pt-2 border-t border-muted/30">
                              <div className="text-[10px] text-muted-foreground mb-1">시간순 동선</div>
                              <div className="flex flex-wrap gap-1">
                                {segs.map((s) => (
                                  <span
                                    key={s.seq}
                                    className={cn(
                                      'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] border',
                                      s.is_current
                                        ? 'border-emerald-400 bg-emerald-50 text-emerald-700 font-semibold'
                                        : 'border-gray-200 bg-gray-50 text-gray-600',
                                    )}
                                  >
                                    {STATUS_KO[s.status as keyof typeof STATUS_KO] ?? s.status}
                                    <span className="tabular-nums">{formatDwell(effSec(s))}</span>
                                    {s.is_current && <span className="text-emerald-600">(진행중)</span>}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

              {/* History: 메시지 — T-20260513-foot-C21-TAB-RESTRUCTURE-C (AC-5) */}
              {chartTabGroup === 'history' && chartTab === 'messages' && (
            <div className="space-y-3">
              {/* 메시지 수동 입력 */}
              <div className="rounded-lg border bg-white p-3 text-xs">
                <div className="flex items-center gap-1.5 font-bold text-slate-800 mb-2">
                  <span className="h-2 w-2 rounded-full bg-slate-500" />
                  문자 이력 등록
                </div>
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <select
                      value={messageForm.message_type}
                      onChange={(e) => setMessageForm((f) => ({ ...f, message_type: e.target.value as 'sms' | 'kakao' | 'manual' }))}
                      className="border rounded px-2 py-1 text-xs bg-white shrink-0"
                    >
                      <option value="manual">수동기록</option>
                      <option value="sms">SMS</option>
                      <option value="kakao">카카오</option>
                    </select>
                    <input
                      className="border rounded px-2 py-1 text-xs flex-1 min-w-0"
                      placeholder="발송 내용 입력…"
                      value={messageForm.content}
                      onChange={(e) => setMessageForm((f) => ({ ...f, content: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); }
                      }}
                    />
                    <Button
                      size="sm"
                      className="h-7 text-[11px] px-3 bg-slate-600 hover:bg-slate-700 shrink-0"
                      disabled={savingMessage || !messageForm.content.trim()}
                      onClick={async () => {
                        if (!messageForm.content.trim() || !customer) return;
                        setSavingMessage(true);
                        const { error } = await supabase.from('message_logs').insert({
                          customer_id: customer.id,
                          clinic_id: customer.clinic_id,
                          content: messageForm.content.trim(),
                          message_type: messageForm.message_type,
                          status: 'sent',
                          sent_at: new Date().toISOString(),
                        });
                        setSavingMessage(false);
                        if (error) { toast.error(`저장 실패: ${error.message}`); return; }
                        toast.success('문자 이력 등록 완료');
                        setMessageForm((f) => ({ ...f, content: '' }));
                        refreshMessageLogs();
                      }}
                    >
                      <Send className="h-3.5 w-3.5 mr-1" />
                      {savingMessage ? '저장 중…' : '등록'}
                    </Button>
                  </div>
                </div>
              </div>

              {/* T-20260525-foot-MESSAGING-V1 AC-3: 자동 SMS 발송 이력 (notification_logs) */}
              <div className="rounded-lg border bg-white p-3 text-xs">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5 font-semibold text-teal-700">
                    <MessageSquare className="h-3.5 w-3.5" />
                    자동 SMS 발송 이력
                    {notificationLogs.length > 0 && (
                      <span className="ml-1 text-[10px] bg-teal-100 text-teal-700 rounded-full px-1.5 py-0.5">
                        {notificationLogs.length}
                      </span>
                    )}
                  </div>
                  <button
                    className="text-[10px] text-muted-foreground hover:text-foreground"
                    onClick={refreshNotificationLogs}
                  >
                    새로고침
                  </button>
                </div>
                {notificationLogs.length === 0 ? (
                  <div className="py-3 text-center text-muted-foreground border border-dashed rounded text-[11px]">
                    자동 SMS 발송 이력 없음
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {notificationLogs.map((log) => {
                      const statusColor =
                        log.status === 'sent' ? 'text-teal-700 bg-teal-50 border-teal-200' :
                        log.status === 'failed' ? 'text-red-600 bg-red-50 border-red-200' :
                        log.status === 'opt_out' ? 'text-orange-600 bg-orange-50 border-orange-200' :
                        log.status === 'skipped' ? 'text-gray-500 bg-gray-50 border-gray-200' :
                        'text-muted-foreground bg-muted border-border';
                      const eventLabel: Record<string, string> = {
                        resv_confirm:          '예약확정',
                        resv_reminder_d1:      'D-1 리마인드',
                        resv_reminder_morning: '당일 아침',
                        noshow:                '노쇼 후속',
                        test_send:             '테스트 발송',
                      };
                      const statusLabel: Record<string, string> = {
                        sent:     '발송완료',
                        failed:   '실패',
                        opt_out:  '수신거부',
                        skipped:  '미발송',
                        pending:  '대기',
                        cancelled:'취소',
                      };
                      return (
                        <div key={log.id} className="rounded border border-gray-100 bg-gray-50 px-2.5 py-2 space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-foreground">
                              {eventLabel[log.event_type] || log.event_type}
                            </span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                              {log.channel.toUpperCase()}
                            </span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${statusColor}`}>
                              {statusLabel[log.status] || log.status}
                            </span>
                            <span className="ml-auto tabular-nums text-[10px] text-muted-foreground/70">
                              {format(new Date(log.sent_at || log.created_at), 'MM-dd HH:mm')}
                            </span>
                          </div>
                          {log.body_rendered && (
                            <p className="text-[11px] text-gray-700 bg-white/70 rounded p-1.5 whitespace-pre-wrap leading-snug border border-gray-100">
                              {log.body_rendered}
                            </p>
                          )}
                          {log.error_message && (
                            <p className="text-[10px] text-red-500">{log.error_message}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* 메시지 이력 목록 (수동 기록) */}
              <div className="rounded-lg border bg-white p-3 text-xs">
                <div className="flex items-center gap-1.5 font-semibold text-muted-foreground mb-2">
                  <MessageSquare className="h-3.5 w-3.5" />
                  수동 문자 기록
                </div>
                {messageLogs.length === 0 ? (
                  <div className="py-4 text-center text-muted-foreground border border-dashed rounded">
                    문자 발송 이력 없음
                  </div>
                ) : (
                  <div className="space-y-1">
                    {messageLogs.map((msg) => (
                      <div key={msg.id} className="rounded border border-gray-100 bg-gray-50 px-2.5 py-2 space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="tabular-nums text-muted-foreground">
                            {format(new Date(msg.sent_at), 'MM-dd HH:mm')}
                          </span>
                          <Badge
                            variant={msg.message_type === 'kakao' ? 'teal' : msg.message_type === 'sms' ? 'secondary' : 'outline'}
                            className="text-[10px]"
                          >
                            {msg.message_type === 'kakao' ? '카카오' : msg.message_type === 'sms' ? 'SMS' : '수동'}
                          </Badge>
                          <Badge
                            variant={msg.status === 'failed' ? 'destructive' : msg.status === 'pending' ? 'secondary' : 'outline'}
                            className={cn('text-[10px]', msg.status === 'sent' && 'text-teal-700 border-teal-300')}
                          >
                            {msg.status === 'sent' ? '발송완료' : msg.status === 'failed' ? '실패' : '대기'}
                          </Badge>
                          {msg.sent_by_name && (
                            <span className="ml-auto text-muted-foreground text-[10px]">{msg.sent_by_name}</span>
                          )}
                        </div>
                        <div className="text-gray-700 leading-snug whitespace-pre-wrap">{msg.content}</div>
                        {msg.memo && (
                          <div className="text-muted-foreground text-[10px]">메모: {msg.memo}</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

            </div>{/* /tab-content */}
          </div>{/* /scrollable area */}
        </div>{/* /left-panel */}

        {/* ════════════════════════════════════════════════════════════════ */}
        {/* 우측 패널 — 건보 + 예약 + 통계 (40%)                            */}
        {/* ════════════════════════════════════════════════════════════════ */}
        <div className="flex flex-col overflow-y-auto bg-white" style={{ width: '40%' }}>

          {/* 패널 서브헤더 */}
          <div className="bg-[#e2e8f0] border-b border-gray-300 px-3 py-1 shrink-0">
            <span className="text-[11px] font-semibold text-[#2d2d2d]">건강보험 · 예약 정보</span>
          </div>

          {/* 건보 조회 + 자격등급 */}
          <div className="border-b border-gray-200 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#2d2d2d]">건강보험 자격등급</span>
              <div className="flex items-center gap-1.5">
                <a
                  href="https://medicare.nhis.or.kr/portal/refer/selectReferInq.do"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded border border-teal-300 bg-teal-50 px-2 py-1 text-[11px] font-medium text-teal-700 hover:bg-teal-100 transition"
                >
                  <ExternalLink className="h-3 w-3" /> 외부조회
                </a>
              </div>
            </div>
            {/* T-20260515-foot-KENBO-API-NATIVE: 건보공단 Native API 자격조회 */}
            <NhisLookupPanel
              customerId={customer.id}
              clinicId={customer.clinic_id}
              hiraConsent={customer.hira_consent ?? false}
              onGradeUpdated={() => {
                supabase
                  .from('customers')
                  .select('insurance_grade, insurance_grade_source, insurance_grade_verified_at, insurance_grade_memo')
                  .eq('id', customer.id)
                  .maybeSingle()
                  .then(({ data }) => {
                    if (data) setCustomer((prev) => prev ? { ...prev, ...data } : prev);
                  });
                setInsuranceGradeRefreshKey((k) => k + 1);
              }}
            />
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
                // T-20260511-foot-C2-INSURANCE-AUTO-CALC: 자동산정 패널 재트리거
                setInsuranceGradeRefreshKey((k) => k + 1);
              }}
            />
            {/* T-20260511-foot-C2-INSURANCE-AUTO-CALC: 등급 변경 시 진료비 실시간 자동산정 */}
            {/* T-20260520-foot-SET-LOAD-REMOVE: 세트 필터 props 제거 */}
            <Chart2InsuranceCalcPanel
              customerId={customer.id}
              clinicId={customer.clinic_id}
              refreshTrigger={insuranceGradeRefreshKey}
            />
          </div>

          {/* T-20260615-foot-CHART2-TABS-RESVTAB-DWELLSWAP AC-2: 2구역 '최근 방문'을 [예약내역] 탭(clinical)으로 이동. 여기서 제거(중복 삭제). */}

          {/* T-20260519-foot-PRECHECKIN-CHART AC-3: 접수 전 내원콜 방문 확인 */}
          {/* check_in 없음 + confirmed 예약 존재 시에만 표시 */}
          {latestCheckIn === null && reservations.some((r) => r.status === 'confirmed') && (() => {
            // BUG FIX: DESC 정렬된 reservations에서 가장 가까운 confirmed 예약 선택
            const nextResv = [...reservations]
              .filter((r) => r.status === 'confirmed')
              .sort((a, b) => {
                const da = `${a.reservation_date}T${a.reservation_time}`;
                const db = `${b.reservation_date}T${b.reservation_time}`;
                return da.localeCompare(db);
              })[0];
            return (
              <div className="border-b border-amber-200 bg-amber-50 px-3 py-2">
                <div className="text-[11px] font-semibold text-amber-800 mb-1.5 flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-amber-400 inline-block shrink-0" />
                  내원콜 방문 확인 (접수 전)
                </div>
                <div className="text-[11px] text-amber-700 mb-2">
                  예약: {nextResv.reservation_date} {nextResv.reservation_time.slice(0, 5)}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={confirmingVisit}
                    onClick={() => handleVisitConfirm(true)}
                    data-testid="btn-visit-confirm-yes"
                    className="flex-1 rounded bg-neutral-800 text-white py-1.5 text-[11px] font-semibold hover:bg-neutral-900 transition disabled:opacity-50"
                  >
                    방문 예정 ✓
                  </button>
                  <button
                    type="button"
                    disabled={confirmingVisit}
                    onClick={() => handleVisitConfirm(false)}
                    data-testid="btn-visit-confirm-no"
                    className="flex-1 rounded border border-gray-300 bg-white text-gray-700 py-1.5 text-[11px] font-semibold hover:bg-gray-100 transition disabled:opacity-50"
                  >
                    방문 안함 ✗
                  </button>
                </div>
              </div>
            );
          })()}

          {/* 상담메모 */}
          {customer.tm_memo && (
            <div className="border-b border-gray-200 px-3 py-2">
              <div className="text-[11px] font-semibold text-[#2d2d2d] mb-1">상담메모</div>
              <div className="text-xs text-gray-700 whitespace-pre-wrap line-clamp-6">{customer.tm_memo}</div>
            </div>
          )}

          {/* T-20260615-foot-CHART2-TABS-RESVTAB-DWELLSWAP AC-1: 2구역 예약내역 패널은 [예약내역] 탭(clinical)으로 이동. 여기서 제거. */}

          {/* T-20260522-foot-DESIGNATED-THERAPIST: 지정 치료사 드롭다운 (최근방문↔회차차감 사이) */}
          <div className="border-b border-gray-200 px-3 py-2">
            <div className="flex items-center justify-between mb-1">
              <div className="text-[11px] font-semibold text-[#2d2d2d] flex items-center gap-1">
                지정 치료사
                {/* AC-R1 (2026-05-23): 자동 선택 배지 제거 — 수기 선택 방식 */}
              </div>
              {savingDesignatedTherapist && (
                <span className="text-[9px] text-muted-foreground">저장 중…</span>
              )}
            </div>
            <select
              data-testid="designated-therapist-select"
              value={designatedTherapistId}
              onChange={(e) => saveDesignatedTherapist(e.target.value)}
              disabled={savingDesignatedTherapist}
              className="w-full h-7 rounded border border-gray-300 px-1.5 text-[11px] focus:outline-none focus:border-emerald-500 bg-white disabled:opacity-60"
            >
              <option value="">— 지정 치료사 없음</option>
              {therapistList.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            {/* AC-R1 (2026-05-23): "회차 차감 시 자동 선택됩니다" 텍스트 제거 — 수기 선택 방식 */}
          </div>

          {/* C22-PKG-DEDUCT: 회차 차감 인라인 폼 — 복구 T-20260510-foot-C22-SECTION-MERGE regression fix */}
          {/* T-20260521-foot-PKG-ZONE2-HIDE: remaining_count===0 패키지 비노출 (FE 필터, DB 삭제 아님) */}
          <div className="border-b border-gray-200 px-3 py-2">
            <div className="text-[11px] font-semibold text-[#2d2d2d] mb-1.5 flex items-center gap-1">
              회차 차감
              <span className="text-[9px] font-normal bg-teal-100 text-teal-700 rounded px-1 py-0.5">치료사 기입</span>
              {packages.filter(p => p.status === 'active' && (p.remaining === null || p.remaining.total_remaining > 0)).length === 0 && (
                <span className="ml-1 text-[10px] font-normal text-amber-500">— 활성 패키지 없음</span>
              )}
            </div>
            <div className="space-y-1.5">
              {/* 활성 패키지 1개 이상 시 선택 드롭다운 — T-20260523-foot-PKG-AUTOSEL-REMOVE: 단일 패키지도 자동선택 제거, 수동선택 강제 */}
              {packages.filter(p => p.status === 'active' && (p.remaining === null || p.remaining.total_remaining > 0)).length >= 1 && (
                <div>
                  <label className="block text-[10px] text-muted-foreground mb-0.5">패키지 선택 <span className="text-red-500">*</span></label>
                  <select
                    value={c22DeductForm.packageId}
                    onChange={(e) => setC22DeductForm(f => ({ ...f, packageId: e.target.value }))}
                    className={`w-full h-6 rounded border px-1 text-[10px] focus:outline-none focus:border-teal-500 bg-white ${
                      c22DeductForm.packageId === '' ? 'border-red-400 text-gray-400' : 'border-gray-300 text-gray-900'
                    }`}
                  >
                    <option value="" disabled>패키지를 선택하세요</option>
                    {packages.filter(p => p.status === 'active' && (p.remaining === null || p.remaining.total_remaining > 0)).map(p => (
                      <option key={p.id} value={p.id}>{p.package_name}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="grid grid-cols-3 gap-1.5">
                <div>
                  <label className="block text-[10px] text-muted-foreground mb-0.5">일자</label>
                  <input
                    type="date"
                    value={c22DeductForm.sessionDate}
                    onChange={(e) => setC22DeductForm(f => ({ ...f, sessionDate: e.target.value }))}
                    className="w-full h-6 rounded border border-gray-300 px-1 text-[10px] focus:outline-none focus:border-teal-500"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-muted-foreground mb-0.5">치료사</label>
                  <select
                    data-testid="deduct-therapist-select"
                    value={c22DeductForm.therapistId}
                    onChange={(e) => setC22DeductForm(f => ({ ...f, therapistId: e.target.value }))}
                    className="w-full h-6 rounded border border-gray-300 px-1 text-[10px] focus:outline-none focus:border-teal-500 bg-white"
                  >
                    <option value="">선택</option>
                    {therapistList.map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-muted-foreground mb-0.5">금일치료</label>
                  <select
                    value={c22DeductForm.treatmentType}
                    onChange={(e) => setC22DeductForm(f => ({ ...f, treatmentType: e.target.value }))}
                    className="w-full h-6 rounded border border-gray-300 px-1 text-[10px] focus:outline-none focus:border-teal-500 bg-white"
                  >
                    <option value="heated_laser">가열</option>
                    <option value="unheated_laser">비가열</option>
                    <option value="podologue">포돌로게</option>
                    <option value="iv">수액</option>
                    {/* T-20260521-foot-TRIAL-DROP-ADD: 체험권 회차 차감 */}
                    <option value="trial">체험권</option>
                    {/* T-20260608-foot-PKG-REBORN-ITEM: Re:Born 회차 차감 */}
                    <option value="reborn">Re:Born</option>
                  </select>
                </div>
              </div>
              {/* T-20260516-foot-HEALER-RESV-BTN v2: [차감] + [힐러예약 후 차감] 한 줄 배치 */}
              {/* FIX(v4): >= today → > today — 오늘 예약 제외. 당일 고객박스 즉시 노란색 전환 방지. */}
              {(() => {
                const today = format(new Date(), 'yyyy-MM-dd');
                const nextResv = reservations
                  .filter(r => r.reservation_date > today && r.status !== 'cancelled' && r.status !== 'noshow')
                  .sort((a, b) => a.reservation_date.localeCompare(b.reservation_date))[0] ?? null;
                // isActive: 다음 예약(오늘 제외) healer_flag OR pending_healer_flag 중 하나라도 켜진 상태
                const isActive = !!nextResv?.healer_flag || !!customer.pending_healer_flag;
                const isPending = !nextResv && !!customer.pending_healer_flag;
                const healerTitle = nextResv
                  ? `다음 예약: ${nextResv.reservation_date}${nextResv.healer_flag ? ' (힐러 플래그 ON)' : ''}`
                  : isPending
                    ? '힐러 대기 설정됨 — 다음 예약 시 자동 적용'
                    : '다음 예약 없음 — 클릭 시 대기 플래그 설정';
                return (
                  <div className="flex gap-1 mt-1">
                    <button
                      type="button"
                      onClick={saveC22Deduct}
                      disabled={savingC22Deduct || !c22DeductForm.therapistId || packages.filter(p => p.status === 'active' && (p.remaining === null || p.remaining.total_remaining > 0)).length === 0 || (packages.filter(p => p.status === 'active' && (p.remaining === null || p.remaining.total_remaining > 0)).length >= 1 && !c22DeductForm.packageId)}
                      className="flex-1 rounded bg-neutral-800 text-white py-1.5 text-[10px] font-medium hover:bg-neutral-900 transition disabled:opacity-50"
                    >
                      {savingC22Deduct ? '저장 중…' : '차감'}
                    </button>
                    <button
                      type="button"
                      onClick={handleHealerDeduct}
                      disabled={savingHealerDeduct || !c22DeductForm.therapistId || packages.filter(p => p.status === 'active' && (p.remaining === null || p.remaining.total_remaining > 0)).length === 0 || (packages.filter(p => p.status === 'active' && (p.remaining === null || p.remaining.total_remaining > 0)).length >= 1 && !c22DeductForm.packageId)}
                      title={healerTitle}
                      className={cn(
                        'flex-1 rounded py-1.5 text-[10px] font-medium transition disabled:opacity-50',
                        isActive
                          ? 'bg-neutral-800 text-white hover:bg-neutral-900'
                          : 'bg-background text-foreground border border-neutral-300 hover:bg-neutral-100',
                      )}
                    >
                      {savingHealerDeduct
                        ? '저장 중…'
                        : isActive
                          ? '힐러예약 후 차감 ✓'
                          : '힐러예약 후 차감'}
                    </button>
                  </div>
                );
              })()}
            </div>
          </div>

          {/* C23-DETAIL-SIMPLIFY: 상세 패널 (2-3) */}
          <div className="border-b border-gray-200">
            <div className="bg-[#e2e8f0] border-b border-gray-300 px-3 py-1 shrink-0">
              <span className="text-[11px] font-semibold text-[#2d2d2d]">상세</span>
            </div>

            {/* T-20260523-foot-LASER-TIMER 위치이동 (FIX-20260525): [상세] 탭 상단 — 탭 선택 무관하게 항상 표시 */}
            {latestCheckIn && (
              <div
                className={`mx-2 mt-2 mb-1 rounded-xl border p-2.5 flex flex-col gap-2 ${
                  activeTimer
                    ? timerRemainingSecs <= 60
                      ? 'border-red-400 bg-red-50'
                      : 'border-slate-300 bg-slate-50'
                    : 'border-muted bg-muted/20'
                }`}
                data-testid="laser-timer-panel"
              >
                <div className="flex items-center gap-1.5">
                  <Timer className="h-3.5 w-3.5 text-slate-600 shrink-0" />
                  <span className="text-[11px] font-semibold text-slate-700">비가열 레이저 타이머</span>
                  {activeTimer && (
                    <span
                      className={`ml-auto tabular-nums font-mono text-base font-bold ${
                        timerRemainingSecs <= 60 ? 'text-red-600' : 'text-slate-700'
                      }`}
                      data-testid="laser-timer-countdown"
                    >
                      {formatTimerRemaining(timerRemainingSecs)}
                    </span>
                  )}
                </div>

                {!activeTimer ? (
                  /* 타이머 미실행 — 시작 버튼 3종 */
                  <div className="flex gap-1.5" data-testid="laser-timer-start-buttons">
                    {laserTimerUnits.map((min) => (
                      <button
                        key={min}
                        type="button"
                        disabled={timerLoading}
                        onClick={() => handleStartTimer(min)}
                        className="flex-1 rounded-lg border-2 border-slate-400 bg-white text-slate-700 font-bold text-sm py-2 hover:bg-slate-50 active:bg-slate-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        data-testid={`laser-timer-btn-${min}`}
                      >
                        {timerLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin mx-auto" /> : `${min}분`}
                      </button>
                    ))}
                  </div>
                ) : (
                  /* 타이머 실행 중 — 진행 바 + 중지 버튼 */
                  <div className="space-y-1.5">
                    <div className="w-full h-1.5 rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          timerRemainingSecs <= 60 ? 'bg-red-500' : 'bg-slate-500'
                        }`}
                        style={{
                          width: `${Math.min(100, (timerRemainingSecs / (activeTimer.duration_minutes * 60)) * 100)}%`,
                        }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                      <span>{activeTimer.duration_minutes}분 타이머</span>
                      <button
                        type="button"
                        disabled={timerLoading}
                        onClick={() => setStopConfirmOpen(true)}
                        className="flex items-center gap-1 rounded border border-red-300 bg-white text-red-600 text-[10px] font-medium px-2 py-0.5 hover:bg-red-50 transition-colors disabled:opacity-50"
                        data-testid="laser-timer-stop-btn"
                      >
                        {timerLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : '■ 종료'}
                      </button>
                    </div>

                    {/* 종료 확인 인라인 박스 */}
                    {stopConfirmOpen && (
                      <div
                        className="mt-1 rounded-lg border border-red-300 bg-red-50 p-2 flex flex-col gap-1.5"
                        data-testid="laser-timer-stop-confirm"
                      >
                        <p className="text-[11px] text-red-700 font-medium">타이머를 종료하시겠습니까?</p>
                        <div className="flex gap-1.5 justify-end">
                          <button
                            type="button"
                            onClick={() => setStopConfirmOpen(false)}
                            className="rounded border border-gray-300 bg-white text-gray-600 text-[10px] font-medium px-2.5 py-1 hover:bg-gray-50 transition-colors"
                            data-testid="laser-timer-stop-cancel"
                          >
                            취소
                          </button>
                          <button
                            type="button"
                            disabled={timerLoading}
                            onClick={() => { setStopConfirmOpen(false); handleStopTimer(); }}
                            className="rounded bg-red-500 text-white text-[10px] font-semibold px-2.5 py-1 hover:bg-red-600 transition-colors disabled:opacity-50"
                            data-testid="laser-timer-stop-confirm-btn"
                          >
                            {timerLoading ? <Loader2 className="h-3 w-3 animate-spin inline" /> : '종료'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* 탭 */}
            <div className="flex border-b border-gray-200">
              {(['예약', '상담', '치료메모'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setResvDetailTab(tab)}
                  className={cn(
                    'flex-1 px-2 min-h-[44px] text-[11px] font-medium border-r border-gray-200 last:border-r-0 transition flex items-center justify-center',
                    resvDetailTab === tab
                      ? 'bg-white text-teal-700 font-semibold'
                      : 'bg-[#f8fafc] text-[#475569] hover:bg-white/70',
                  )}
                >
                  {tab}
                </button>
              ))}
            </div>

            {/* 예약 탭 — 고객메모 + 기타메모 + 저장 */}
            {resvDetailTab === '예약' && (
              <div className="p-2 space-y-2">
                {/* CS-AC-3: 고객차트 상용구 — 고객메모에 삽입 */}
                {customerChartPhrases.length > 0 && (
                  <div>
                    <label className="block text-[11px] text-muted-foreground mb-0.5">상용구</label>
                    <div className="flex flex-wrap gap-1" data-testid="custchart-phrases-예약">
                      {customerChartPhrases.map(phrase => (
                        <button
                          key={phrase.id}
                          type="button"
                          onClick={() => setResvDetailForm((f) => ({ ...f, memo: f.memo ? `${f.memo} ${phrase.content}` : phrase.content }))}
                          className="rounded border border-teal-200 bg-teal-50 px-1.5 py-0.5 text-[10px] text-teal-700 hover:bg-teal-100 transition"
                        >
                          {phrase.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div>
                  <label className="block text-[11px] text-muted-foreground mb-0.5">고객메모</label>
                  <Textarea
                    value={resvDetailForm.memo}
                    onChange={(e) => setResvDetailForm((f) => ({ ...f, memo: e.target.value }))}
                    placeholder="고객 관련 메모"
                    rows={3}
                    className="text-[11px] resize-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-muted-foreground mb-0.5">기타메모</label>
                  <Textarea
                    value={resvDetailForm.etcMemo}
                    onChange={(e) => setResvDetailForm((f) => ({ ...f, etcMemo: e.target.value }))}
                    placeholder="기타 참고사항"
                    rows={2}
                    className="text-[11px] resize-none"
                  />
                </div>
                <button
                  type="button"
                  onClick={saveResvDetail}
                  disabled={savingResvDetail}
                  className="w-full rounded bg-neutral-800 text-white py-1.5 text-[11px] font-medium hover:bg-neutral-900 transition disabled:opacity-50"
                >
                  {savingResvDetail ? '저장 중…' : '저장'}
                </button>
              </div>
            )}

            {/* 상담 탭 — 담당자 + 메모 + 상용구 + 저장 */}
            {resvDetailTab === '상담' && (
              <div className="p-2 space-y-2">
                <div>
                  <label className="block text-[11px] text-muted-foreground mb-0.5">담당자</label>
                  <select
                    value={consultationStaffId}
                    onChange={(e) => {
                      setConsultationStaffId(e.target.value);
                      saveCustomerField({ assigned_staff_id: e.target.value || null }); // AC-6 쌍방연동
                    }}
                    className="w-full h-7 rounded border border-gray-300 px-1.5 text-[11px] focus:outline-none focus:border-teal-500 bg-white"
                  >
                    <option value="">— 실장 선택 —</option>
                    {/* T-20260522-foot-STAFF-NAME-UNIFY: display_name(구성명) fallback to name */}
                    {/* T-20260614-foot-STAFF-DROPDOWN-ROLE-SORT: 표시 순서만 role 정렬(상담실장→코디) */}
                    {staffList.filter(s => s.role === 'consultant' || s.role === 'coordinator' || s.role === 'director').sort((a, b) => staffRoleSortIndex(a.role) - staffRoleSortIndex(b.role)).map(s => (
                      <option key={s.id} value={s.id}>{s.display_name || s.name}</option>
                    ))}
                  </select>
                </div>
                {/* T-20260522-foot-ALT-BADGE: ALT 토글 (AC-4,5,6,7) — 담당자 드롭다운 하단 */}
                <div className="rounded-lg border border-dashed border-gray-300 p-2 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span
                        className="text-[11px] font-bold tracking-wide px-1.5 py-0.5 rounded"
                        style={{
                          background: 'linear-gradient(135deg, #c8c8c8 0%, #e8e8e8 40%, #b0b0b0 60%, #d4d4d4 100%)',
                          color: '#2a2a2a',
                          border: '1px solid #a0a0a0',
                          boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.6)',
                        }}
                      >
                        ALT
                      </span>
                      <span className="text-[11px] text-muted-foreground">올트 — 보험 반려 레이저 병행</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => saveAlt(true)}
                        disabled={savingAlt || altStatus}
                        className="h-6 px-2 rounded text-[10px] font-medium bg-gray-800 text-white hover:bg-gray-900 transition disabled:opacity-40"
                        data-testid="alt-on-btn"
                      >
                        ON
                      </button>
                      <button
                        type="button"
                        onClick={() => saveAlt(false)}
                        disabled={savingAlt || !altStatus}
                        className="h-6 px-2 rounded text-[10px] font-medium border border-gray-400 text-gray-600 hover:bg-gray-100 transition disabled:opacity-40"
                        data-testid="alt-off-btn"
                      >
                        OFF
                      </button>
                    </div>
                  </div>
                  {altStatus && (
                    <div className="flex items-center gap-1 text-[10px] text-gray-500">
                      <span className="w-1.5 h-1.5 rounded-full bg-gray-600 inline-block shrink-0" />
                      ALT 활성 중 — 서류출력 레이저코드 차단
                    </div>
                  )}
                  <div>
                    <label className="block text-[10px] text-muted-foreground mb-0.5">상세내용</label>
                    <textarea
                      value={altDetail}
                      onChange={(e) => setAltDetail(e.target.value)}
                      rows={2}
                      placeholder="예: 5회차까지 진행, 보험 반려됨"
                      className="w-full rounded border border-gray-300 px-1.5 py-1 text-[11px] resize-none focus:outline-none focus:border-teal-500"
                      data-testid="alt-detail-input"
                    />
                  </div>
                </div>

                {/* 상용구 — C23-PHRASE-LINK / CS-AC-3: 고객차트 surface(customer_chart) 상용구 → 상담메모 삽입 */}
                {customerChartPhrases.length > 0 && (
                  <div>
                    <label className="block text-[11px] text-muted-foreground mb-0.5">상용구</label>
                    <div className="flex flex-wrap gap-1" data-testid="custchart-phrases-상담">
                      {customerChartPhrases.map(phrase => (
                        <button
                          key={phrase.id}
                          type="button"
                          onClick={() => setConsultationMemo(prev => prev ? `${prev} ${phrase.content}` : phrase.content)}
                          className="rounded border border-teal-200 bg-teal-50 px-1.5 py-0.5 text-[10px] text-teal-700 hover:bg-teal-100 transition"
                        >
                          {phrase.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div>
                  <label className="block text-[11px] text-muted-foreground mb-0.5">상담메모</label>
                  <Textarea
                    value={consultationMemo}
                    onChange={(e) => setConsultationMemo(e.target.value)}
                    rows={8}
                    className="text-[11px] resize-none"
                  />
                </div>
                <button
                  type="button"
                  onClick={saveConsultation}
                  disabled={savingConsultation}
                  className="w-full rounded bg-neutral-800 text-white py-1.5 text-[11px] font-medium hover:bg-neutral-900 transition disabled:opacity-50"
                >
                  {savingConsultation ? '저장 중…' : '저장'}
                </button>
              </div>
            )}

            {/* 치료메모 탭 — T-20260520-foot-MEMO-HISTORY: 히스토리 누적 방식 */}
            {resvDetailTab === '치료메모' && (
              <div className="p-2 space-y-2">
                {/* AC-3: 테이블 미존재 graceful fallback 배너 */}
                {treatmentMemoUnavailable && (
                  <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700 text-center">
                    치료메모 기능 준비 중입니다. 잠시 후 다시 이용해주세요.
                  </div>
                )}
                {/* 새 메모 입력 — AC-3: 테이블 unavailable 시 숨김 */}
                {!treatmentMemoUnavailable && (
                  <>
                    {/* CS-AC-3: 고객차트 상용구 — 새 치료메모에 삽입 */}
                    {customerChartPhrases.length > 0 && (
                      <div>
                        <label className="block text-[11px] text-muted-foreground mb-0.5">상용구</label>
                        <div className="flex flex-wrap gap-1" data-testid="custchart-phrases-치료메모">
                          {customerChartPhrases.map(phrase => (
                            <button
                              key={phrase.id}
                              type="button"
                              onClick={() => setNewMemoText(prev => prev ? `${prev} ${phrase.content}` : phrase.content)}
                              className="rounded border border-teal-200 bg-teal-50 px-1.5 py-0.5 text-[10px] text-teal-700 hover:bg-teal-100 transition"
                            >
                              {phrase.name}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    <div>
                      <label className="block text-[11px] text-muted-foreground mb-0.5">새 메모 추가</label>
                      <Textarea
                        value={newMemoText}
                        onChange={(e) => setNewMemoText(e.target.value)}
                        rows={3}
                        placeholder="치료 메모를 입력하세요…"
                        className="text-[11px] resize-none"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={saveNewTreatmentMemo}
                      disabled={savingNewMemo || !newMemoText.trim()}
                      className="w-full rounded bg-neutral-800 text-white py-1.5 text-[11px] font-medium hover:bg-neutral-900 transition disabled:opacity-50"
                    >
                      {savingNewMemo ? '저장 중…' : '메모 추가'}
                    </button>
                  </>
                )}

                {/* 이력 목록 (최신순 DESC) */}
                {!treatmentMemosLoaded ? (
                  <div className="text-[11px] text-muted-foreground text-center py-2">불러오는 중…</div>
                ) : treatmentMemos.length === 0 ? (
                  <div className="text-[11px] text-muted-foreground text-center py-3">아직 치료메모가 없습니다</div>
                ) : (
                  <div className="space-y-1.5 mt-1">
                    <label className="block text-[11px] font-semibold text-[#2d2d2d]">메모 이력</label>
                    {treatmentMemos.map((memo) => (
                      <div key={memo.id} className="rounded border border-gray-200 bg-gray-50/50 p-2 space-y-1">
                        {editingMemoId === memo.id ? (
                          <>
                            <Textarea
                              value={editingMemoText}
                              onChange={(e) => setEditingMemoText(e.target.value)}
                              rows={3}
                              className="text-[11px] resize-none"
                              autoFocus
                            />
                            <div className="flex gap-1">
                              <button
                                type="button"
                                onClick={saveTreatmentMemoEdit}
                                disabled={savingEditMemo || !editingMemoText.trim()}
                                className="flex-1 rounded bg-neutral-800 text-white py-1 text-[11px] font-medium hover:bg-neutral-900 transition disabled:opacity-50"
                              >
                                {savingEditMemo ? '저장 중…' : '수정 저장'}
                              </button>
                              <button
                                type="button"
                                onClick={() => { setEditingMemoId(null); setEditingMemoText(''); }}
                                className="px-2 rounded border border-gray-300 text-[11px] hover:bg-gray-100 transition"
                              >
                                취소
                              </button>
                            </div>
                          </>
                        ) : (
                          <>
                            <p className="text-[11px] text-gray-800 whitespace-pre-wrap">{memo.content}</p>
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] text-muted-foreground">
                                {memo.created_by_name ?? '알 수 없음'} · {format(new Date(memo.created_at), 'yyyy-MM-dd HH:mm', { locale: ko })}
                              </span>
                              {memo.created_by && memo.created_by === profile?.email && (
                                <div className="flex gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => { setEditingMemoId(memo.id); setEditingMemoText(memo.content); }}
                                    className="text-[10px] text-teal-600 hover:underline"
                                  >
                                    수정
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => deleteTreatmentMemo(memo.id)}
                                    className="text-[10px] text-red-500 hover:underline"
                                  >
                                    삭제
                                  </button>
                                </div>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 수납 통계 — C2-REMOVE-PKG-STATS: 패키지 항목 삭제 */}
          <div className="px-3 py-2">
            <div className="text-[11px] font-semibold text-[#2d2d2d] mb-1.5">수납 통계</div>
            <div className="space-y-1 text-[11px]">
              <div className="flex justify-between">
                <span className="text-muted-foreground">총 방문</span>
                <strong className="text-teal-700">{visits.length}회</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">총 결제</span>
                <strong className="text-teal-700">{formatAmount(totalPaid)}</strong>
              </div>
              {/* 패키지 항목 삭제 — C2-REMOVE-PKG-STATS */}
            </div>
          </div>

        </div>{/* /right-panel */}

      </div>{/* /main-flex */}

      {/* C2-RESV-MINI-POPUP: 예약하기 미니창 (T-20260615-foot-CHART2-RESVBTN-POPUP-NONAV: 2번차트 [예약하기]가 navigate 대신 이 팝업을 오버레이로 오픈) */}
      {openResvMiniPopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" data-testid="resv-mini-popup">
          <div className="bg-white rounded-lg shadow-xl border border-gray-200 w-[360px] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#2d2d2d]">예약 등록 — {customer.name}</h3>
              <button onClick={() => setOpenResvMiniPopup(false)} className="p-1 rounded hover:bg-muted text-muted-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-2 text-xs">
              <div>
                <label className="block text-muted-foreground mb-0.5">예약일자 <span className="text-red-500">*</span></label>
                <input type="date" value={resvMiniForm.date}
                  onChange={(e) => setResvMiniForm((f) => ({ ...f, date: e.target.value }))}
                  className="w-full h-8 rounded border border-gray-300 px-2 text-xs focus:outline-none focus:border-teal-500" />
              </div>
              {/* T-20260508-foot-C22-RESV-EDIT: CRM 시간대 연동 (30분 단위, 평일 20시/토 18시까지) */}
              <div>
                <label className="block text-muted-foreground mb-0.5">시작시간 <span className="text-red-500">*</span></label>
                <select
                  value={resvMiniForm.startTime}
                  onChange={(e) => setResvMiniForm((f) => ({ ...f, startTime: e.target.value }))}
                  className="w-full h-8 rounded border border-gray-300 px-2 text-xs focus:outline-none focus:border-teal-500 bg-white"
                >
                  <option value="">시간 선택</option>
                  {miniPopupSlots.length > 0
                    ? miniPopupSlots.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))
                    : Array.from({ length: 23 }, (_, i) => {
                        const h = Math.floor(i / 2) + 9;
                        const m = i % 2 === 0 ? '00' : '30';
                        const timeStr = `${String(h).padStart(2, '0')}:${m}`;
                        return <option key={timeStr} value={timeStr}>{timeStr}</option>;
                      })
                  }
                </select>
              </div>
              <div>
                <label className="block text-muted-foreground mb-0.5">예약메모</label>
                <Textarea
                  value={resvMiniForm.memo}
                  onChange={(e) => setResvMiniForm((f) => ({ ...f, memo: e.target.value }))}
                  placeholder="예약 관련 메모"
                  rows={2}
                  className="text-xs resize-none"
                />
              </div>
              {/* T-20260524-foot-DESIG-BIDIRECT AC-1: 지정 치료사 참고 표시 + AC-2: 변경 선택 */}
              <div>
                {customer.designated_therapist_id && (
                  <div className="text-[10px] text-teal-600 mb-0.5">
                    현재 지정 치료사: {therapistList.find(t => t.id === customer.designated_therapist_id)?.name ?? '-'}
                  </div>
                )}
                <label className="block text-muted-foreground mb-0.5">지정 치료사 변경</label>
                <select
                  value={resvMiniForm.designatedTherapistId}
                  onChange={(e) => setResvMiniForm(f => ({ ...f, designatedTherapistId: e.target.value }))}
                  className="w-full h-8 rounded border border-gray-300 px-2 text-xs focus:outline-none focus:border-teal-500 bg-white"
                  data-testid="resv-mini-designated-therapist"
                >
                  <option value="">— 변경 없음</option>
                  {therapistList.map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <Button
                className="flex-1 bg-teal-600 hover:bg-teal-700 h-8 text-xs"
                onClick={saveResvMini}
                disabled={savingResvMini}
              >
                {savingResvMini ? '저장 중…' : '예약 등록'}
              </Button>
              <Button variant="outline" className="h-8 text-xs px-3" data-testid="resv-mini-cancel" onClick={() => setOpenResvMiniPopup(false)}>
                취소
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* C22-RESV-EDIT: 예약 수정 모달 */}
      {editResvId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-white rounded-lg shadow-xl border border-gray-200 w-[340px] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#2d2d2d]">예약 수정</h3>
              <button onClick={() => setEditResvId(null)} className="p-1 rounded hover:bg-muted text-muted-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-2 text-xs">
              <div>
                <label className="block text-muted-foreground mb-0.5">예약일자 *</label>
                <input type="date" value={editResvForm.date}
                  onChange={(e) => setEditResvForm(f => ({ ...f, date: e.target.value }))}
                  className="w-full h-8 rounded border border-gray-300 px-2 text-xs focus:outline-none focus:border-teal-500" />
              </div>
              {/* T-20260508-foot-C22-RESV-EDIT: CRM 시간대 연동 (30분 단위, 평일 20시/토 18시까지) */}
              <div>
                <label className="block text-muted-foreground mb-0.5">시작시간 *</label>
                <select
                  value={editResvForm.startTime}
                  onChange={(e) => setEditResvForm(f => ({ ...f, startTime: e.target.value }))}
                  className="w-full h-8 rounded border border-gray-300 px-2 text-xs focus:outline-none focus:border-teal-500 bg-white"
                >
                  <option value="">시간 선택</option>
                  {editResvSlots.length > 0
                    ? editResvSlots.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))
                    : Array.from({ length: 23 }, (_, i) => {
                        const h = Math.floor(i / 2) + 9;
                        const m = i % 2 === 0 ? '00' : '30';
                        const timeStr = `${String(h).padStart(2, '0')}:${m}`;
                        return <option key={timeStr} value={timeStr}>{timeStr}</option>;
                      })
                  }
                </select>
              </div>
              <div>
                <label className="block text-muted-foreground mb-0.5">메모</label>
                <Textarea value={editResvForm.memo}
                  onChange={(e) => setEditResvForm(f => ({ ...f, memo: e.target.value }))}
                  rows={2} className="text-xs resize-none" />
              </div>
              {/* T-20260524-foot-DESIG-BIDIRECT AC-1: 지정 치료사 참고 + AC-2: 수기 변경 */}
              {editResvForm.visitType === 'returning' && (
                <div>
                  {customer?.designated_therapist_id && (
                    <div className="text-[10px] text-teal-600 mb-0.5">
                      현재 지정 치료사: {therapistList.find(t => t.id === customer?.designated_therapist_id)?.name ?? '-'}
                    </div>
                  )}
                  <label className="block text-muted-foreground mb-0.5">지정 치료사 변경</label>
                  <select
                    value={editResvForm.therapistId}
                    onChange={(e) => setEditResvForm(f => ({ ...f, therapistId: e.target.value }))}
                    className="w-full h-8 rounded border border-gray-300 px-2 text-xs focus:outline-none focus:border-teal-500 bg-white"
                    data-testid="edit-resv-designated-therapist"
                  >
                    <option value="">— 변경 없음</option>
                    {therapistList.map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            <div className="flex gap-2 pt-1">
              <Button className="flex-1 bg-teal-600 hover:bg-teal-700 h-8 text-xs"
                onClick={saveEditResv} disabled={savingEditResv}>
                {savingEditResv ? '저장 중…' : '수정 저장'}
              </Button>
              <Button variant="outline" className="h-8 text-xs px-3" onClick={() => setEditResvId(null)}>취소</Button>
            </div>
          </div>
        </div>
      )}

      {/* T-20260515-foot-INLINE-RESV: 강화 인라인 예약 패널 — 슬롯 그리드 + 담당의 + 진료종류 */}
      {inlineResvOpen && customer && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center pt-12 bg-black/30"
          onClick={() => setInlineResvOpen(false)}
        >
          <div
            className="bg-white rounded-lg shadow-xl border border-gray-200 w-[480px] max-h-[85vh] overflow-y-auto p-4 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#2d2d2d]">다음 예약 — {customer.name}</h3>
              <button
                type="button"
                onClick={() => setInlineResvOpen(false)}
                className="p-1 rounded hover:bg-muted text-muted-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-muted-foreground mb-0.5">
                  예약일자 <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  value={inlineResvDate}
                  min={format(new Date(), 'yyyy-MM-dd')}
                  onChange={(e) => setInlineResvDate(e.target.value)}
                  className="w-full h-8 rounded border border-gray-300 px-2 text-xs focus:outline-none focus:border-teal-500"
                  data-testid="inline-resv-date"
                />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-0.5">예약메모</label>
                <input
                  type="text"
                  value={inlineResvMemo}
                  onChange={(e) => setInlineResvMemo(e.target.value)}
                  placeholder="예약 관련 메모"
                  className="w-full h-8 rounded border border-gray-300 px-2 text-xs focus:outline-none focus:border-teal-500"
                />
              </div>
            </div>
            {/* T-20260524-foot-DESIG-BIDIRECT AC-1: 지정 치료사 참고 + AC-2: 수기 변경 */}
            <div>
              {customer.designated_therapist_id && (
                <div className="text-[10px] text-teal-600 mb-0.5">
                  현재 지정 치료사: {therapistList.find(t => t.id === customer.designated_therapist_id)?.name ?? '-'}
                </div>
              )}
              <label className="block text-xs text-muted-foreground mb-0.5">지정 치료사 변경</label>
              <select
                value={inlineResvTherapistId}
                onChange={(e) => setInlineResvTherapistId(e.target.value)}
                className="w-full h-8 rounded border border-gray-300 px-2 text-xs focus:outline-none focus:border-teal-500 bg-white"
                data-testid="inline-resv-designated-therapist"
              >
                <option value="">— 변경 없음</option>
                {therapistList.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            <div>
              <div className="text-[11px] font-semibold text-[#2d2d2d] mb-1.5 flex items-center gap-2">
                시간대별 예약 현황
                <span className="text-[10px] font-normal text-muted-foreground">
                  ○ 빈 슬롯 클릭 시 예약 등록 · ● 예약됨
                </span>
                {inlineResvLoading && (
                  <span className="text-[10px] font-normal text-muted-foreground ml-auto">불러오는 중…</span>
                )}
              </div>
              {!inlineResvDate ? (
                <div className="py-3 text-center text-xs text-muted-foreground">날짜를 선택하세요</div>
              ) : (
                <div className="space-y-0.5 max-h-[400px] overflow-y-auto" data-testid="inline-resv-slot-grid">
                  {inlineResvSlotList.map((time) => {
                    const booked = inlineResvSlotMap[time] ?? [];
                    const count = booked.length;
                    const isFull = count >= 12;
                    return (
                      <div
                        key={time}
                        className={cn(
                          'rounded border px-2 py-1 text-xs',
                          count === 0
                            ? 'border-dashed border-teal-200 bg-teal-50/30 hover:bg-teal-50 hover:border-teal-400 transition'
                            : isFull
                              ? 'border-red-200 bg-red-50/40'
                              : 'border-slate-100 bg-slate-50/20',
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <span className="w-12 shrink-0 font-mono font-medium text-gray-700">{time}</span>
                          {count > 0 && (
                            <span className={cn('text-[10px]', isFull ? 'text-red-600 font-semibold' : 'text-slate-600')}>
                              {count}/12
                            </span>
                          )}
                          {isFull ? (
                            <span className="ml-auto text-[10px] font-medium text-red-500">● 마감</span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => saveInlineResv(time)}
                              disabled={savingInlineResv}
                              className="ml-auto text-[10px] font-medium text-teal-700 hover:underline disabled:opacity-50"
                              data-testid={`slot-${time}`}
                            >
                              ○ {count === 0 ? '빈 슬롯 · 예약' : '추가 예약'}
                            </button>
                          )}
                        </div>
                        {booked.map((b, i) => (
                          <div
                            key={i}
                            className="ml-14 mt-0.5 flex items-center gap-1.5 text-[10px] text-gray-600"
                          >
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
                            <span className="font-medium">{b.name}</span>
                            <span className="text-muted-foreground">
                              {VISIT_TYPE_KO[b.visit_type]}
                              {b.therapist ? ` · 담당: ${b.therapist}` : ''}
                            </span>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-full text-xs"
              onClick={() => setInlineResvOpen(false)}
            >
              닫기
            </Button>
          </div>
        </div>
      )}

      {/* C2-PKG-TICKET-TABLE: 회차 차감 + 치료사 드롭다운 다이얼로그 (UseSessionDialog) */}
      {useSessionDlg?.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-80 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="font-semibold text-teal-800 text-sm">회차 차감</div>
              <button type="button" onClick={() => setUseSessionDlg(null)} className="text-gray-400 hover:text-gray-600">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="text-xs text-muted-foreground">
              패키지: <span className="font-medium text-gray-800">{useSessionDlg.packageName}</span>
              &nbsp;· <span className="text-teal-700 font-semibold">{useSessionDlg.nextSession}회차</span>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-700 mb-1 block">
                  치료사 <span className="text-red-500">*</span>
                </label>
                <select
                  value={sessionDlgForm.therapistId}
                  onChange={(e) => setSessionDlgForm((f) => ({ ...f, therapistId: e.target.value }))}
                  className="w-full h-9 rounded border border-gray-300 px-2 text-xs focus:outline-none focus:border-teal-500"
                >
                  <option value="">— 치료사 선택 —</option>
                  {therapistList.length > 0 ? therapistList.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  )) : (
                    <option disabled>등록된 치료사 없음</option>
                  )}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-700 mb-1 block">시술 날짜</label>
                <input
                  type="date"
                  value={sessionDlgForm.sessionDate}
                  onChange={(e) => setSessionDlgForm((f) => ({ ...f, sessionDate: e.target.value }))}
                  className="w-full h-9 rounded border border-gray-300 px-2 text-xs focus:outline-none focus:border-teal-500"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-700 mb-1 block">시술 유형</label>
                <select
                  value={sessionDlgForm.sessionType}
                  onChange={(e) => setSessionDlgForm((f) => ({ ...f, sessionType: e.target.value }))}
                  className="w-full h-9 rounded border border-gray-300 px-2 text-xs focus:outline-none focus:border-teal-500"
                >
                  <option value="heated_laser">가열 레이저</option>
                  <option value="unheated_laser">비가열 레이저</option>
                  <option value="preconditioning">사전처치(프컨)</option>
                  <option value="iv">수액</option>
                  {/* T-20260521-foot-TRIAL-DROP-ADD: 체험권 회차 차감 */}
                  <option value="trial">체험권</option>
                  {/* T-20260608-foot-PKG-REBORN-ITEM: Re:Born 회차 차감 */}
                  <option value="reborn">Re:Born</option>
                </select>
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <Button
                className="flex-1 bg-teal-600 hover:bg-teal-700 h-9 text-xs"
                onClick={saveUseSession}
                disabled={savingSession || !sessionDlgForm.therapistId}
              >
                {savingSession ? '저장 중…' : '차감 확정'}
              </Button>
              <Button variant="outline" className="h-9 text-xs px-3" onClick={() => setUseSessionDlg(null)}>
                취소
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* T-20260511-foot-C21-PKG-USAGE-EDIT: 시술내역 수정 다이얼로그 */}
      {editSessionDlg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-80 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="font-semibold text-teal-800 text-sm">시술내역 수정</div>
              <button type="button" onClick={() => setEditSessionDlg(null)} className="text-gray-400 hover:text-gray-600">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="text-xs text-muted-foreground">
              <span className="font-medium text-gray-800">{editSessionDlg.session_number}회차</span> 내역을 수정합니다.
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-700 mb-1 block">시술 유형</label>
                <select
                  value={editSessionForm.sessionType}
                  onChange={(e) => setEditSessionForm((f) => ({ ...f, sessionType: e.target.value }))}
                  className="w-full h-9 rounded border border-gray-300 px-2 text-xs focus:outline-none focus:border-teal-500"
                >
                  <option value="heated_laser">가열 레이저</option>
                  <option value="unheated_laser">비가열 레이저</option>
                  <option value="preconditioning">사전처치(프컨)</option>
                  <option value="podologue">포돌로게</option>
                  <option value="iv">수액</option>
                  {/* T-20260521-foot-TRIAL-DROP-ADD: 체험권 회차 차감 */}
                  <option value="trial">체험권</option>
                  {/* T-20260608-foot-PKG-REBORN-ITEM: Re:Born 회차 차감 */}
                  <option value="reborn">Re:Born</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-700 mb-1 block">시술 날짜</label>
                <input
                  type="date"
                  value={editSessionForm.sessionDate}
                  onChange={(e) => setEditSessionForm((f) => ({ ...f, sessionDate: e.target.value }))}
                  className="w-full h-9 rounded border border-gray-300 px-2 text-xs focus:outline-none focus:border-teal-500"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-700 mb-1 block">
                  치료사 <span className="text-red-500">*</span>
                </label>
                <select
                  value={editSessionForm.therapistId}
                  onChange={(e) => setEditSessionForm((f) => ({ ...f, therapistId: e.target.value }))}
                  className="w-full h-9 rounded border border-gray-300 px-2 text-xs focus:outline-none focus:border-teal-500"
                >
                  <option value="">— 치료사 선택 —</option>
                  {therapistList.length > 0 ? therapistList.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  )) : (
                    <option disabled>등록된 치료사 없음</option>
                  )}
                </select>
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <Button
                className="flex-1 bg-teal-600 hover:bg-teal-700 h-9 text-xs"
                onClick={saveEditSession}
                disabled={savingEditSession || !editSessionForm.therapistId}
              >
                {savingEditSession ? '저장 중…' : '수정 저장'}
              </Button>
              <Button variant="outline" className="h-9 text-xs px-3" onClick={() => setEditSessionDlg(null)}>
                취소
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* T-20260522-foot-PKG-EDIT-DEL: 구매 패키지 수정 다이얼로그 (AC-1/AC-2) */}
      {editPkgDlg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-96 p-5 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div className="font-semibold text-teal-800 text-sm">패키지 수정</div>
              <button type="button" onClick={() => setEditPkgDlg(null)} className="text-gray-400 hover:text-gray-600">
                <X className="h-4 w-4" />
              </button>
            </div>
            {/* AC-3: 사용/결제 이력 경고 배너 */}
            {editPkgDlg && (
              packageSessions.filter((s) => s.package_id === editPkgDlg.id && s.status === 'used').length > 0 ||
              pkgPayments.filter((pay) => pay.package_id === editPkgDlg.id && pay.payment_type === 'payment').length > 0
            ) && (
              <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700 flex items-start gap-1.5">
                <span className="mt-0.5 shrink-0">⚠️</span>
                <span>시술 또는 결제 이력이 있는 패키지입니다. 수정 시 내용을 신중히 확인하세요.</span>
              </div>
            )}
            <div className="space-y-3">
              {/* 상품명 */}
              <div>
                <label className="text-xs font-medium text-gray-700 mb-1 block">상품명</label>
                <input
                  type="text"
                  value={editPkgForm.package_name}
                  onChange={(e) => setEditPkgForm((f) => ({ ...f, package_name: e.target.value }))}
                  className="w-full h-9 rounded border border-gray-300 px-2 text-xs focus:outline-none focus:border-teal-500"
                />
              </div>
              {/* 총금액 */}
              <div>
                <label className="text-xs font-medium text-gray-700 mb-1 block">총 금액</label>
                <AmountInput
                  value={editPkgForm.total_amount}
                  onChange={(raw) => setEditPkgForm((f) => ({ ...f, total_amount: raw }))}
                  className="w-full h-9 rounded border border-gray-300 px-2 text-xs focus:outline-none focus:border-teal-500"
                />
              </div>
              {/* 시술별 횟수·수가 */}
              {[
                { label: '가열', sessKey: 'heated_sessions' as const, priceKey: 'heated_unit_price' as const },
                { label: '비가열', sessKey: 'unheated_sessions' as const, priceKey: 'unheated_unit_price' as const },
                { label: '포돌로게', sessKey: 'podologe_sessions' as const, priceKey: 'podologe_unit_price' as const },
                { label: '수액', sessKey: 'iv_sessions' as const, priceKey: 'iv_unit_price' as const },
                { label: '체험권', sessKey: 'trial_sessions' as const, priceKey: 'trial_unit_price' as const },
                { label: 'Re:Born', sessKey: 'reborn_sessions' as const, priceKey: 'reborn_unit_price' as const },
              ].map(({ label, sessKey, priceKey }) => (
                <div key={label} className="grid grid-cols-2 gap-2 items-end">
                  <div>
                    <label className="text-xs font-medium text-gray-700 mb-1 block">{label} 횟수</label>
                    <input
                      type="number"
                      min={0}
                      value={editPkgForm[sessKey]}
                      onChange={(e) => setEditPkgForm((f) => ({ ...f, [sessKey]: e.target.value }))}
                      className="w-full h-9 rounded border border-gray-300 px-2 text-xs focus:outline-none focus:border-teal-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-700 mb-1 block">{label} 수가(회당)</label>
                    <AmountInput
                      value={editPkgForm[priceKey]}
                      onChange={(raw) => setEditPkgForm((f) => ({ ...f, [priceKey]: raw }))}
                      className="w-full h-9 rounded border border-gray-300 px-2 text-xs focus:outline-none focus:border-teal-500"
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-2 pt-1">
              <Button
                className="flex-1 bg-teal-600 hover:bg-teal-700 h-9 text-xs"
                onClick={saveEditPkg}
                disabled={savingEditPkg}
              >
                {savingEditPkg ? '저장 중…' : '수정 저장'}
              </Button>
              <Button variant="outline" className="h-9 text-xs px-3" onClick={() => setEditPkgDlg(null)}>
                취소
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* T-20260522-foot-PKG-EDIT-DEL: 구매 패키지 삭제 확인 다이얼로그 (AC-3/AC-5) */}
      {deletePkgDlg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-80 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="font-semibold text-red-700 text-sm">패키지 삭제</div>
              <button type="button" onClick={() => setDeletePkgDlg(null)} className="text-gray-400 hover:text-gray-600">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="text-xs text-gray-700">
              <span className="font-semibold text-gray-900">"{deletePkgDlg.package_name}"</span> 패키지를 삭제하시겠습니까?<br />
              <span className="text-muted-foreground">삭제된 패키지는 목록에서 숨겨집니다.</span>
            </div>
            <div className="flex gap-2 pt-1">
              <Button
                className="flex-1 bg-red-600 hover:bg-red-700 h-9 text-xs"
                onClick={softDeletePkg}
                disabled={deletingPkg}
              >
                {deletingPkg ? '삭제 중…' : '삭제'}
              </Button>
              <Button variant="outline" className="h-9 text-xs px-3" onClick={() => setDeletePkgDlg(null)}>
                취소
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* T-20260507-foot-PKG-TEMPLATE-REDESIGN: 구입 티켓 추가 다이얼로그 */}
      {openPackagePurchase && customer && (
        <PackagePurchaseFromTemplateDialog
          open={openPackagePurchase}
          customerId={customer.id}
          clinicId={customer.clinic_id}
          onOpenChange={setOpenPackagePurchase}
          onCreated={async () => {
            setOpenPackagePurchase(false);
            // T-20260522-foot-PERF-TUNING OPT-4: packages + package_sessions 병렬 조회 → remaining 클라이언트 집계 (N RPC 제거)
            const pkgRes = await supabase.from('packages').select('*').eq('customer_id', customer.id).order('created_at', { ascending: false });  // T-20260520-foot-PKG-SORT
            const pkgs = (pkgRes.data ?? []) as Package[];
            if (pkgs.length > 0) {
              const pkgIds = pkgs.map((p) => p.id);
              const { data: sessData } = await supabase.from('package_sessions').select('package_id, session_type, status').in('package_id', pkgIds);
              const remainingArr = computeRemainingFromSessionRows(pkgs, (sessData ?? []) as _SessRow[]);
              setPackages(pkgs.map((p, i) => ({ ...p, remaining: remainingArr[i] ?? null })));
            } else {
              setPackages([]);
            }
          }}
        />
      )}

      {/* T-20260511-foot-C2-PKG-MERGE-ADDON: 기존 패키지에 항목 합산 다이얼로그 */}
      {openPackageAddon && customer && (
        <PackageAddonDialog
          open={openPackageAddon}
          activePackages={packages.filter((p) => p.status === 'active')}
          onOpenChange={setOpenPackageAddon}
          onDone={async () => {
            setOpenPackageAddon(false);
            // T-20260522-foot-PERF-TUNING OPT-4: packages + package_sessions 병렬 조회 → remaining 클라이언트 집계 (N RPC 제거)
            const pkgRes = await supabase.from('packages').select('*').eq('customer_id', customer.id).order('created_at', { ascending: false });  // T-20260520-foot-PKG-SORT
            const pkgs = (pkgRes.data ?? []) as Package[];
            if (pkgs.length > 0) {
              const pkgIds = pkgs.map((p) => p.id);
              const { data: sessData } = await supabase.from('package_sessions').select('package_id, session_type, status').in('package_id', pkgIds);
              const remainingArr = computeRemainingFromSessionRows(pkgs, (sessData ?? []) as _SessRow[]);
              setPackages(pkgs.map((p, i) => ({ ...p, remaining: remainingArr[i] ?? null })));
            } else {
              setPackages([]);
            }
          }}
        />
      )}

      {/* T-20260517-foot-C2-CONSULT-DOCS: 동의서 [작성] 다이얼로그 (Option A — CRM 직접 오픈) */}
      {consentDialogFormType && (
        <ConsentFormDialog
          checkIn={latestCheckIn}
          formType={consentDialogFormType}
          open={!!consentDialogFormType}
          onOpenChange={(o) => { if (!o) setConsentDialogFormType(null); }}
          onSigned={() => {
            setConsentDialogFormType(null);
            // consent_forms 새로고침
            const ids = checkInHistory.map((ci) => ci.id);
            if (ids.length > 0) {
              supabase.from('consent_forms').select('form_type, signed_at').in('check_in_id', ids).order('signed_at', { ascending: false }).then(({ data }) => {
                setConsentEntries((data ?? []) as { form_type: string; signed_at: string }[]);
              });
            }
          }}
        />
      )}

      {/* T-20260517-foot-C2-CONSULT-DOCS: 필수서류 [내용보기] 다이얼로그 */}
      {/* T-20260520-foot-PENCHART-VIEW-SPLIT: form_submissions PNG 이미지 뷰어 통합 (그룹3 발건강 질문지 포함) */}
      {viewDocGroup !== null && (
        <Dialog open={viewDocGroup !== null} onOpenChange={(o) => { if (!o) { setViewDocGroup(null); setSubmissionImages([]); } }}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="text-sm">
                {viewDocGroup === 1 ? '개인정보 / 체크리스트' : viewDocGroup === 2 ? '환불 / 비급여 동의서' : '발건강 질문지'}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3 text-xs max-h-[70vh] overflow-y-auto">

              {/* ── 펜차트 저장 이미지 (form_submissions) ── */}
              {submissionImagesLoading && (
                <div className="py-4 text-center text-muted-foreground text-[11px]">이미지 로딩 중…</div>
              )}
              {!submissionImagesLoading && submissionImages.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
                    <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                    보험차트 저장 양식
                  </div>
                  {submissionImages.map((img, i) => (
                    <div key={i} className="rounded-lg border bg-gray-50 overflow-hidden">
                      <div className="flex items-center justify-between px-2 py-1 bg-white border-b">
                        <span className="font-medium text-[11px] text-gray-700">{img.label}</span>
                        {img.date && (
                          <span className="text-[10px] text-muted-foreground">
                            {format(new Date(img.date), 'yyyy-MM-dd HH:mm')}
                          </span>
                        )}
                        <a
                          href={img.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[10px] text-teal-600 hover:underline ml-2"
                        >
                          원본 보기
                        </a>
                      </div>
                      <img
                        src={img.url}
                        alt={img.label}
                        className="w-full object-contain max-h-[400px]"
                      />
                    </div>
                  ))}
                </div>
              )}

              {/* ── 구형 레거시 데이터 (consent_forms / checklists) ── */}
              {viewDocGroup === 1 && (
                <>
                  {consentEntries.filter((c) => c.form_type === 'privacy').map((c, i) => (
                    <div key={i} className="rounded-lg border bg-teal-50 p-3">
                      <div className="font-semibold text-teal-800 mb-1">개인정보 동의서 (이전 방식)</div>
                      <div className="text-muted-foreground">{format(new Date(c.signed_at), 'yyyy-MM-dd HH:mm')} 서명 완료</div>
                    </div>
                  ))}
                  {checklistEntries.length > 0 && (
                    <div className="rounded-lg border bg-teal-50 p-3">
                      <div className="font-semibold text-teal-800 mb-1">사전 체크리스트 (이전 방식)</div>
                      <div className="text-muted-foreground">
                        {checklistEntries[0].completed_at
                          ? format(new Date(checklistEntries[0].completed_at), 'yyyy-MM-dd HH:mm')
                          : '날짜 미기록'}{' '}작성 완료
                      </div>
                    </div>
                  )}
                  {/* 전체 없음 */}
                  {!submissionImagesLoading &&
                    submissionImages.length === 0 &&
                    consentEntries.filter((c) => c.form_type === 'privacy').length === 0 &&
                    checklistEntries.length === 0 && (
                      <p className="text-muted-foreground text-center py-4">서명된 서류가 없습니다</p>
                    )}
                </>
              )}
              {viewDocGroup === 2 && (
                <>
                  {(['non_covered', 'refund'] as const).map((fType) =>
                    consentEntries.filter((c) => c.form_type === fType).map((c, i) => (
                      <div key={`${fType}-${i}`} className="rounded-lg border bg-slate-50 p-3">
                        <div className="font-semibold text-slate-800 mb-1">{FORM_TITLES[fType]} (이전 방식)</div>
                        <div className="text-muted-foreground">{format(new Date(c.signed_at), 'yyyy-MM-dd HH:mm')} 서명 완료</div>
                      </div>
                    ))
                  )}
                  {/* 전체 없음 */}
                  {!submissionImagesLoading &&
                    submissionImages.length === 0 &&
                    consentEntries.filter((c) => c.form_type === 'refund' || c.form_type === 'non_covered').length === 0 && (
                      <p className="text-muted-foreground text-center py-4">서명된 서류가 없습니다</p>
                    )}
                </>
              )}
              {/* T-20260520-foot-PENCHART-VIEW-SPLIT: 그룹3 — 발건강 질문지 (health_questionnaire_*) */}
              {/* T-20260602-foot-CHART2-HEALTHQ-VIEWER: 자가작성(health_q_results) 구조화 결과 렌더 추가.
                  근본원인 — 자가작성은 PNG(form_submissions)가 아니라 health_q_results 에 저장되므로
                  기존 PNG 전용 뷰어에서는 항상 '없음'으로 떴음. 펜차트 PNG와 자가작성을 함께 표시. */}
              {viewDocGroup === 3 && (
                <>
                  {healthQResults.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
                        <span className="h-1.5 w-1.5 rounded-full bg-teal-400" />
                        자가작성 제출 ({healthQResults.length}건)
                      </div>
                      {healthQResults.map((r) => (
                        <ResultCard key={r.id} result={r} defaultExpanded={healthQResults.length === 1} />
                      ))}
                    </div>
                  )}
                  {!submissionImagesLoading && submissionImages.length === 0 && healthQResults.length === 0 && (
                    <p className="text-muted-foreground text-center py-4">저장된 발건강 질문지가 없습니다</p>
                  )}
                </>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* T-20260611-foot-DEDUCT-DUPKEY-SUBTHERAPIST: 같은 내원 재차감 이중선택 모달 */}
      <Dialog open={dupDeductModal !== null} onOpenChange={(o) => { if (!o && !dupDeductBusy) setDupDeductModal(null); }}>
        <DialogContent className="max-w-sm" data-testid="dup-deduct-modal">
          <DialogHeader>
            <DialogTitle>오늘 이미 차감된 회차가 있어요</DialogTitle>
          </DialogHeader>
          {dupDeductModal && (
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground leading-relaxed">
                같은 내원 건에 이 패키지로 <b>{dupDeductModal.existingSessionNumber}회차</b>가 이미 차감되어 있어요
                {dupDeductModal.existingPerformedBy && (
                  <> (담당: {therapistList.find(t => t.id === dupDeductModal.existingPerformedBy)?.name ?? '-'})</>
                )}.
                <br />어떻게 처리할까요?
              </p>
              <button
                type="button"
                disabled={dupDeductBusy}
                onClick={handleDupChangeTherapistOnly}
                data-testid="dup-deduct-change-therapist"
                className="w-full text-left rounded-lg border border-teal-300 bg-teal-50 hover:bg-teal-100 px-3 py-2.5 transition disabled:opacity-50"
              >
                <div className="font-semibold text-teal-800">① 담당 치료사만 변경</div>
                <div className="text-[11px] text-teal-700 mt-0.5">
                  당일 다른 치료사가 전담 — 회차 추가 차감 없이 담당만
                  <b> {therapistList.find(t => t.id === dupDeductModal.therapistId)?.name ?? '선택 치료사'}</b>(으)로 변경
                </div>
              </button>
              <button
                type="button"
                disabled={dupDeductBusy}
                onClick={handleDupAddSession}
                data-testid="dup-deduct-add-session"
                className="w-full text-left rounded-lg border border-amber-300 bg-amber-50 hover:bg-amber-100 px-3 py-2.5 transition disabled:opacity-50"
              >
                <div className="font-semibold text-amber-800">② 1회차 추가 차감</div>
                <div className="text-[11px] text-amber-700 mt-0.5">
                  하루 두 번 시술 — 새 회차(<b>{dupDeductModal.usedCount + 1}회차</b>)로 추가 차감, 잔여 1회 감소
                </div>
              </button>
              <button
                type="button"
                disabled={dupDeductBusy}
                onClick={() => setDupDeductModal(null)}
                className="w-full rounded-lg border border-gray-300 bg-white hover:bg-gray-50 px-3 py-2 text-gray-600 transition disabled:opacity-50"
              >
                ③ 취소
              </button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* T-20260517-foot-C2-CONSULT-DOCS AC-R1: 합본1 — 개인정보 + 체크리스트 */}
      {showChecklistForm && (
        <ChecklistForm
          open={showChecklistForm}
          onOpenChange={setShowChecklistForm}
          customerId={customer.id}
          defaultName={customer.name}
          defaultPhone={customer.phone ?? undefined}
          defaultBirthDate={customer.birth_date ?? undefined}
          onSaved={() => {
            setShowChecklistForm(false);
            // Storage 저장 후 DB checklist 재조회 시도 (태블릿 경로 체크리스트가 있을 경우 반영)
            void supabase
              .from('checklists')
              .select('id, completed_at, checklist_data')
              .eq('customer_id', customer.id)
              .not('completed_at', 'is', null)
              .order('completed_at', { ascending: false })
              .limit(10)
              .then(({ data }) => {
                if (data) setChecklistEntries(data as { id: string; completed_at: string | null; checklist_data: Record<string, unknown> }[]);
              });
          }}
        />
      )}

      {/* T-20260517-foot-C2-CONSULT-DOCS AC-R1: 합본2 — 환불 + 비급여 동의서 */}
      {/* T-20260522-foot-PENCHART-REFUND-AUTOFILL: 차트번호·이름 자동 불러오기 */}
      {showConsentFormModal && (
        <ConsentForm
          open={showConsentFormModal}
          onOpenChange={setShowConsentFormModal}
          customerId={customer.id}
          defaultChartNumber={customer.chart_number}
          defaultName={customer.name}
          onSaved={() => {
            setShowConsentFormModal(false);
          }}
        />
      )}

      {/* T-20260527-foot-MEDCHART-TAB-REAPPEAR: 진료차트 패널 (고객차트 내 버튼 → Drawer 열기) */}
      {medicalChartOpen && customer && (
        <MedicalChartPanel
          open={medicalChartOpen}
          onOpenChange={setMedicalChartOpen}
          customerId={customer.id}
          clinicId={customer.clinic_id}
          currentUserRole={profile?.role ?? ''}
          currentUserEmail={profile?.email ?? null}
          initialRightTab={medchartInitialTab}
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
  // T-20260522-foot-PKG-TRIAL: 체험권 5번째 항목
  const [trial, setTrial] = useState(0);
  const [trialUnitPrice, setTrialUnitPrice] = useState(0);
  // T-20260608-foot-PKG-REBORN-ITEM: Re:Born 6번째 항목
  const [reborn, setReborn] = useState(0);
  const [rebornUnitPrice, setRebornUnitPrice] = useState(0);
  // 사전처치
  const [precon, setPrecon] = useState(0);
  // 총금액
  const [priceOverride, setPriceOverride] = useState(false);
  const [manualTotal, setManualTotal] = useState(0);
  // T-20260616-foot-PKG-OUTSTANDING-BALANCE ①: 진료비(consultation_fee) — 패키지 금액과 별도(§4-A: 합산 단일표기 금지).
  const [consultationFee, setConsultationFee] = useState(0);
  const [memo, setMemo] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // 항목별 자동합산
  const computedTotal = useMemo(
    () =>
      heated * heatedUnitPrice +
      unheated * unheatedUnitPrice +
      podologe * podologeUnitPrice +
      iv * ivUnitPrice +
      trial * trialUnitPrice +
      reborn * rebornUnitPrice,
    [heated, heatedUnitPrice, unheated, unheatedUnitPrice, podologe, podologeUnitPrice, iv, ivUnitPrice, trial, trialUnitPrice, reborn, rebornUnitPrice],
  );
  const upgradeSurcharge = (heatedUpgrade ? 50000 : 0) + (unheatedUpgrade ? 40000 : 0);
  const grandTotal = priceOverride ? manualTotal : computedTotal + upgradeSurcharge;
  // T-20260510-foot-PKG-CREATE-FIX3: 포돌로게 포함 (total_sessions에 반영)
  // T-20260522-foot-PKG-TRIAL: 체험권 포함
  // T-20260608-foot-PKG-REBORN-ITEM: Re:Born 포함
  const totalSessions = heated + unheated + iv + precon + podologe + trial + reborn;

  // T-20260510-foot-PKG-CREATE-FIX3: 템플릿 로드 후 첫 번째 자동 선택 (button 활성화 보장)
  useEffect(() => {
    if (!open || !clinicId) return;
    supabase
      .from('package_templates')
      .select('*')
      .eq('clinic_id', clinicId)
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        const tmplList = (data ?? []) as PackageTemplate[];
        setTemplates(tmplList);
        if (tmplList.length > 0) {
          const first = tmplList[0];
          setSelectedTemplateId(first.id);
          setPackageName(first.name);
          setHeated(first.heated_sessions); setHeatedUnitPrice(first.heated_unit_price); setHeatedUpgrade(false);
          setUnheated(first.unheated_sessions); setUnheatedUnitPrice(first.unheated_unit_price); setUnheatedUpgrade(false);
          setPodologe(first.podologe_sessions); setPodologeUnitPrice(first.podologe_unit_price);
          setIv(first.iv_sessions); setIvUnitPrice(first.iv_unit_price); setIvCompany(first.iv_company ?? '');
          setTrial(first.trial_sessions ?? 0); setTrialUnitPrice(first.trial_unit_price ?? 0);
          setReborn(0); setRebornUnitPrice(0); // 템플릿은 Re:Born 미보유
          setPrecon(0); setPriceOverride(false); setMemo(first.memo ?? '');
        }
      });
  }, [open, clinicId]);

  useEffect(() => {
    if (!open) return;
    setSelectedTemplateId('custom');
    setPackageName('');
    setHeated(0); setHeatedUnitPrice(0); setHeatedUpgrade(false);
    setUnheated(0); setUnheatedUnitPrice(0); setUnheatedUpgrade(false);
    setPodologe(0); setPodologeUnitPrice(0);
    setIv(0); setIvUnitPrice(0); setIvCompany('');
    setTrial(0); setTrialUnitPrice(0);
    setReborn(0); setRebornUnitPrice(0);
    setPrecon(0);
    setPriceOverride(false); setManualTotal(0); setConsultationFee(0); setMemo('');
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
    setTrial(tmpl.trial_sessions ?? 0);
    setTrialUnitPrice(tmpl.trial_unit_price ?? 0);
    setReborn(0); setRebornUnitPrice(0); // 템플릿은 Re:Born 미보유
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
    setTrial(0); setTrialUnitPrice(0);
    setReborn(0); setRebornUnitPrice(0);
    setPrecon(0);
    setPriceOverride(false); setManualTotal(0); setConsultationFee(0); setMemo('');
  };

  const submit = async () => {
    if (!packageName.trim()) { toast.error('패키지명을 입력하세요'); return; }
    if (totalSessions === 0) { toast.error('최소 1회 이상 구성하세요'); return; }
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
      // T-20260522-foot-PKG-TRIAL: 체험권 5번째 항목
      trial_sessions: trial,
      trial_unit_price: trialUnitPrice,
      // T-20260608-foot-PKG-REBORN-ITEM: Re:Born 6번째 항목
      reborn_sessions: reborn,
      reborn_unit_price: rebornUnitPrice,
      shot_upgrade: heatedUpgrade,
      af_upgrade: unheatedUpgrade,
      upgrade_surcharge: upgradeSurcharge,
      total_amount: grandTotal,
      // T-20260616-foot-PKG-OUTSTANDING-BALANCE ①: 진료비 별도 컬럼(§4-A: total_amount와 합산 단일표기 금지).
      consultation_fee: consultationFee,
      paid_amount: 0,
      status: 'active',
      memo: memo.trim() || null,
    });
    setSubmitting(false);
    if (error) { toast.error(`생성 실패: ${error.message}`); return; }
    onCreated();
  };

  // T-20260510-foot-PKG-ROUTE-UNIFY: 템플릿 추가 후 생성 (템플릿 저장 + 패키지 생성)
  const submitWithTemplate = async () => {
    if (!packageName.trim()) { toast.error('패키지명을 입력하세요'); return; }
    if (totalSessions === 0) { toast.error('최소 1회 이상 구성하세요'); return; }
    setSubmitting(true);
    // 1) 템플릿 저장
    const { error: tmplErr } = await supabase.from('package_templates').insert({
      clinic_id: clinicId,
      name: packageName.trim(),
      heated_sessions: heated, heated_unit_price: heatedUnitPrice, heated_upgrade_available: heatedUpgrade,
      unheated_sessions: unheated, unheated_unit_price: unheatedUnitPrice, unheated_upgrade_available: unheatedUpgrade,
      podologe_sessions: podologe, podologe_unit_price: podologeUnitPrice,
      iv_company: ivCompany.trim() || null, iv_sessions: iv, iv_unit_price: ivUnitPrice,
      // T-20260522-foot-PKG-TRIAL: 체험권 5번째 항목
      trial_sessions: trial, trial_unit_price: trialUnitPrice,
      total_price: grandTotal, price_override: priceOverride,
      memo: memo.trim() || null, sort_order: 0, is_active: true,
      updated_at: new Date().toISOString(),
    });
    if (tmplErr) { toast.error(`템플릿 저장 실패: ${tmplErr.message}`); setSubmitting(false); return; }
    // 2) 패키지 생성
    const { error: pkgErr } = await supabase.from('packages').insert({
      clinic_id: clinicId, customer_id: customerId,
      package_name: packageName.trim(), package_type: 'template', template_id: null,
      total_sessions: totalSessions, heated_sessions: heated, heated_unit_price: heatedUnitPrice,
      unheated_sessions: unheated, unheated_unit_price: unheatedUnitPrice,
      iv_sessions: iv, iv_unit_price: ivUnitPrice, preconditioning_sessions: precon,
      podologe_sessions: podologe, podologe_unit_price: podologeUnitPrice,
      iv_company: ivCompany.trim() || null, shot_upgrade: heatedUpgrade, af_upgrade: unheatedUpgrade,
      // T-20260522-foot-PKG-TRIAL: 체험권 5번째 항목
      trial_sessions: trial, trial_unit_price: trialUnitPrice,
      // T-20260608-foot-PKG-REBORN-ITEM: Re:Born 6번째 항목 (packages 전용 — package_templates에는 미반영)
      reborn_sessions: reborn, reborn_unit_price: rebornUnitPrice,
      upgrade_surcharge: upgradeSurcharge, total_amount: grandTotal,
      // T-20260616-foot-PKG-OUTSTANDING-BALANCE ①: 진료비 별도(§4-A).
      consultation_fee: consultationFee, paid_amount: 0,
      status: 'active', memo: memo.trim() || null,
    });
    setSubmitting(false);
    if (pkgErr) { toast.error(`패키지 생성 실패: ${pkgErr.message}`); return; }
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
                <AmountInput
                  value={heatedUnitPrice}
                  onChange={(raw) => setHeatedUnitPrice(Number(raw) || 0)}
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
                <AmountInput
                  value={unheatedUnitPrice}
                  onChange={(raw) => setUnheatedUnitPrice(Number(raw) || 0)}
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
                <AmountInput
                  value={podologeUnitPrice}
                  onChange={(raw) => setPodologeUnitPrice(Number(raw) || 0)}
                  className="w-full h-9 rounded-md border border-gray-200 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-teal-500"
                />
              </div>
            </div>
            {podologe > 0 && podologeUnitPrice > 0 && (
              <div className="text-xs text-gray-400 text-right">소계: {formatAmount(podologe * podologeUnitPrice)}</div>
            )}
          </div>

          {/* 수액 — T-20260510-foot-PKG-CREATE-FIX3: 수액명 드롭다운 8종 */}
          <div className="rounded-lg border bg-gray-50 p-3 space-y-2">
            <div className="text-xs font-semibold text-gray-500">수액</div>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <label className="text-xs text-gray-500">수액명</label>
                <select
                  value={ivCompany}
                  onChange={(e) => setIvCompany(e.target.value)}
                  className="w-full h-9 rounded-md border border-gray-200 px-2 text-sm focus:outline-none focus:ring-1 focus:ring-teal-500 bg-white"
                >
                  <option value="">— 선택 —</option>
                  <option value="재생">재생</option>
                  <option value="항염">항염</option>
                  <option value="글로우">글로우</option>
                  <option value="성장">성장</option>
                  <option value="태반">태반</option>
                  <option value="알파">알파</option>
                  <option value="비타민D">비타민D</option>
                  <option value="비타민C">비타민C</option>
                </select>
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
                <AmountInput
                  value={ivUnitPrice}
                  onChange={(raw) => setIvUnitPrice(Number(raw) || 0)}
                  className="w-full h-9 rounded-md border border-gray-200 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-teal-500"
                />
              </div>
            </div>
            {iv > 0 && ivUnitPrice > 0 && (
              <div className="text-xs text-gray-400 text-right">소계: {formatAmount(iv * ivUnitPrice)}</div>
            )}
          </div>

          {/* T-20260522-foot-PKG-TRIAL: 체험권 5번째 항목 */}
          <div className="rounded-lg border bg-gray-50 p-3 space-y-2">
            <div className="text-xs font-semibold text-gray-500">체험권</div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-xs text-gray-500">회수</label>
                <input
                  type="number" min={0} value={trial}
                  onChange={(e) => setTrial(Math.max(0, Number(e.target.value) || 0))}
                  className="w-full h-9 rounded-md border border-gray-200 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-teal-500"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-gray-500">수가 (회당)</label>
                <AmountInput
                  value={trialUnitPrice}
                  onChange={(raw) => setTrialUnitPrice(Number(raw) || 0)}
                  className="w-full h-9 rounded-md border border-gray-200 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-teal-500"
                />
              </div>
            </div>
            {trial > 0 && trialUnitPrice > 0 && (
              <div className="text-xs text-gray-400 text-right">소계: {formatAmount(trial * trialUnitPrice)}</div>
            )}
          </div>

          {/* T-20260608-foot-PKG-REBORN-ITEM: Re:Born 6번째 항목 */}
          <div className="rounded-lg border bg-gray-50 p-3 space-y-2">
            <div className="text-xs font-semibold text-gray-500">Re:Born</div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-xs text-gray-500">회수</label>
                <input
                  type="number" min={0} value={reborn}
                  onChange={(e) => setReborn(Math.max(0, Number(e.target.value) || 0))}
                  className="w-full h-9 rounded-md border border-gray-200 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-teal-500"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-gray-500">수가 (회당)</label>
                <AmountInput
                  value={rebornUnitPrice}
                  onChange={(raw) => setRebornUnitPrice(Number(raw) || 0)}
                  className="w-full h-9 rounded-md border border-gray-200 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-teal-500"
                />
              </div>
            </div>
            {reborn > 0 && rebornUnitPrice > 0 && (
              <div className="text-xs text-gray-400 text-right">소계: {formatAmount(reborn * rebornUnitPrice)}</div>
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

          {/* T-20260511-foot-PKG-DYNAMIC-TABLE: 기입된 항목만 표시하는 동적 요약 표 */}
          {(() => {
            const previewRows = [
              heated > 0 || heatedUnitPrice > 0
                ? { label: `가열 레이저${heatedUpgrade ? ' (+6000샷)' : ''}`, count: heated, unitPrice: heatedUnitPrice, subtotal: heated * heatedUnitPrice + (heatedUpgrade ? 50000 : 0) }
                : null,
              unheated > 0 || unheatedUnitPrice > 0
                ? { label: `비가열 레이저${unheatedUpgrade ? ' (+AF)' : ''}`, count: unheated, unitPrice: unheatedUnitPrice, subtotal: unheated * unheatedUnitPrice + (unheatedUpgrade ? 40000 : 0) }
                : null,
              podologe > 0 || podologeUnitPrice > 0
                ? { label: '포돌로게', count: podologe, unitPrice: podologeUnitPrice, subtotal: podologe * podologeUnitPrice }
                : null,
              iv > 0 || ivUnitPrice > 0
                ? { label: `수액${ivCompany ? ` (${ivCompany})` : ''}`, count: iv, unitPrice: ivUnitPrice, subtotal: iv * ivUnitPrice }
                : null,
              trial > 0 || trialUnitPrice > 0
                ? { label: '체험권', count: trial, unitPrice: trialUnitPrice, subtotal: trial * trialUnitPrice }
                : null,
              reborn > 0 || rebornUnitPrice > 0
                ? { label: 'Re:Born', count: reborn, unitPrice: rebornUnitPrice, subtotal: reborn * rebornUnitPrice }
                : null,
              precon > 0
                ? { label: '사전처치 (프리컨)', count: precon, unitPrice: 0, subtotal: 0 }
                : null,
            ].filter(Boolean) as { label: string; count: number; unitPrice: number; subtotal: number }[];
            if (previewRows.length === 0) return null;
            return (
              <div className="rounded-lg border border-teal-100 bg-teal-50/30 overflow-hidden">
                <div className="px-3 py-1.5 bg-teal-50 border-b border-teal-100 text-xs font-semibold text-teal-800">구성 항목 요약</div>
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="text-gray-500 border-b border-teal-100 bg-white/60">
                      <th className="text-left px-3 py-1 font-medium">시술명</th>
                      <th className="text-center px-2 py-1 font-medium">회수</th>
                      <th className="text-right px-2 py-1 font-medium">수가(회당)</th>
                      <th className="text-right px-3 py-1 font-medium">소계</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row) => (
                      <tr key={row.label} className="border-b border-teal-50 last:border-b-0">
                        <td className="px-3 py-1 font-medium text-teal-900">{row.label}</td>
                        <td className="px-2 py-1 text-center">{row.count}회</td>
                        <td className="px-2 py-1 text-right tabular-nums">{row.unitPrice > 0 ? formatAmount(row.unitPrice) : '-'}</td>
                        <td className="px-3 py-1 text-right tabular-nums font-semibold text-teal-700">{row.subtotal > 0 ? formatAmount(row.subtotal) : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })()}

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
              <AmountInput
                value={manualTotal}
                onChange={(raw) => setManualTotal(Number(raw) || 0)}
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

          {/* T-20260616-foot-PKG-OUTSTANDING-BALANCE ①: 진료비 — 패키지 금액과 별도 입력/표시(§4-A). 합산 단일표기 금지. */}
          <div className="rounded-lg border border-gray-200 bg-gray-50/60 p-3 space-y-1.5">
            <label className="text-xs font-semibold text-gray-600">진료비 <span className="font-normal text-gray-400">(패키지 금액과 별도 — 합산하지 않음)</span></label>
            <AmountInput
              value={consultationFee}
              onChange={(raw) => setConsultationFee(Number(raw) || 0)}
              className="w-full h-9 rounded-md border border-gray-200 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-teal-500"
            />
            <div className="text-xs text-gray-400">진료비는 패키지 금액에 합산되지 않고, 결제·잔금이 따로 관리됩니다.</div>
          </div>

          {/* 메모 */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500">메모</label>
            <textarea
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              rows={2}
              placeholder="메모"
              className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-teal-500 resize-none"
            />
          </div>
        </div>

        {/* T-20260510-foot-PKG-ROUTE-UNIFY: 통일 버튼 [취소 / 템플릿추가후생성 / 구입티켓생성] */}
        {/* T-20260511-foot-C2-PKG-BTN-DISABLED: packageName disabled 조건 제거 → submit() 토스트 검증으로 이동 */}
        <div className="flex justify-end gap-1.5 mt-4">
          <button
            onClick={() => onOpenChange(false)}
            className="h-8 rounded border border-gray-200 px-3 text-xs hover:bg-gray-50 transition"
          >
            취소
          </button>
          <button
            disabled={submitting || totalSessions === 0}
            onClick={submitWithTemplate}
            className="h-8 rounded border border-teal-300 bg-teal-50 px-3 text-xs font-medium text-teal-700 hover:bg-teal-100 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? '저장 중…' : '템플릿 추가 후 생성'}
          </button>
          <button
            disabled={submitting || totalSessions === 0}
            onClick={submit}
            className="h-8 rounded bg-neutral-800 px-3 text-xs font-medium text-white hover:bg-neutral-900 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? '저장 중…' : '구입 티켓 생성'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// T-20260511-foot-C2-PKG-MERGE-ADDON: 기존 진행중 패키지에 항목 합산 추가
// packages row UPDATE (INSERT 아님) + total_sessions/total_amount 합산
// ============================================================
function PackageAddonDialog({
  open,
  activePackages,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  activePackages: PackageWithRemaining[];
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}) {
  const [selectedPkgId, setSelectedPkgId] = useState<string | null>(null);
  // 추가 항목
  const [heated, setHeated] = useState(0);
  const [heatedUnitPrice, setHeatedUnitPrice] = useState(0);
  const [unheated, setUnheated] = useState(0);
  const [unheatedUnitPrice, setUnheatedUnitPrice] = useState(0);
  const [podologe, setPodologe] = useState(0);
  const [podologeUnitPrice, setPodologeUnitPrice] = useState(0);
  const [iv, setIv] = useState(0);
  const [ivUnitPrice, setIvUnitPrice] = useState(0);
  const [ivCompany, setIvCompany] = useState('');
  // T-20260608-foot-PKG-REBORN-ITEM: Re:Born 6번째 항목
  const [reborn, setReborn] = useState(0);
  const [rebornUnitPrice, setRebornUnitPrice] = useState(0);
  const [priceOverride, setPriceOverride] = useState(false);
  const [manualAddAmount, setManualAddAmount] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  const selectedPkg = activePackages.find((p) => p.id === selectedPkgId) ?? null;

  // 패키지 선택 시 기존 수가 pre-fill
  const selectPackage = (pkg: PackageWithRemaining) => {
    setSelectedPkgId(pkg.id);
    setHeated(0);
    setHeatedUnitPrice(pkg.heated_unit_price ?? 0);
    setUnheated(0);
    setUnheatedUnitPrice(pkg.unheated_unit_price ?? 0);
    setPodologe(0);
    setPodologeUnitPrice(pkg.podologe_unit_price ?? 0);
    setIv(0);
    setIvUnitPrice(pkg.iv_unit_price ?? 0);
    setIvCompany(pkg.iv_company ?? '');
    setReborn(0);
    setRebornUnitPrice(pkg.reborn_unit_price ?? 0);
    setPriceOverride(false);
    setManualAddAmount(0);
  };

  // 열릴 때 패키지 1개면 자동 선택
  useEffect(() => {
    if (open && activePackages.length === 1) {
      selectPackage(activePackages[0]);
    }
    if (!open) {
      setSelectedPkgId(null);
      setHeated(0); setHeatedUnitPrice(0);
      setUnheated(0); setUnheatedUnitPrice(0);
      setPodologe(0); setPodologeUnitPrice(0);
      setIv(0); setIvUnitPrice(0); setIvCompany('');
      setReborn(0); setRebornUnitPrice(0);
      setPriceOverride(false); setManualAddAmount(0);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const computedAddAmount =
    heated * heatedUnitPrice +
    unheated * unheatedUnitPrice +
    podologe * podologeUnitPrice +
    iv * ivUnitPrice +
    reborn * rebornUnitPrice;
  const finalAddAmount = priceOverride ? manualAddAmount : computedAddAmount;
  const totalAdded = heated + unheated + podologe + iv + reborn;

  // 자동합산 변경 시 동기화
  useEffect(() => {
    if (!priceOverride) setManualAddAmount(computedAddAmount);
  }, [computedAddAmount, priceOverride]);

  const submit = async () => {
    if (!selectedPkg) { toast.error('패키지를 선택하세요'); return; }
    if (totalAdded === 0) { toast.error('추가할 항목을 1회 이상 입력하세요'); return; }
    setSubmitting(true);

    // packages row UPDATE: 기존 값에 합산
    const updates: Record<string, number | string | null> = {
      total_sessions: selectedPkg.total_sessions + totalAdded,
      total_amount: selectedPkg.total_amount + finalAddAmount,
    };
    if (heated > 0) {
      updates.heated_sessions = (selectedPkg.heated_sessions ?? 0) + heated;
      if (heatedUnitPrice > 0) updates.heated_unit_price = heatedUnitPrice;
    }
    if (unheated > 0) {
      updates.unheated_sessions = (selectedPkg.unheated_sessions ?? 0) + unheated;
      if (unheatedUnitPrice > 0) updates.unheated_unit_price = unheatedUnitPrice;
    }
    if (podologe > 0) {
      updates.podologe_sessions = (selectedPkg.podologe_sessions ?? 0) + podologe;
      if (podologeUnitPrice > 0) updates.podologe_unit_price = podologeUnitPrice;
    }
    if (iv > 0) {
      updates.iv_sessions = (selectedPkg.iv_sessions ?? 0) + iv;
      if (ivUnitPrice > 0) updates.iv_unit_price = ivUnitPrice;
      if (ivCompany.trim()) updates.iv_company = ivCompany.trim();
    }
    // T-20260608-foot-PKG-REBORN-ITEM: Re:Born 합산
    if (reborn > 0) {
      updates.reborn_sessions = (selectedPkg.reborn_sessions ?? 0) + reborn;
      if (rebornUnitPrice > 0) updates.reborn_unit_price = rebornUnitPrice;
    }

    const { error } = await supabase.from('packages').update(updates).eq('id', selectedPkg.id);
    setSubmitting(false);
    if (error) { toast.error(`합산 실패: ${error.message}`); return; }
    toast.success(`「${selectedPkg.package_name}」에 항목 추가 완료 (+${totalAdded}회 / +${formatAmount(finalAddAmount)})`);
    onDone();
  };

  const cn2 = (...classes: string[]) => classes.filter(Boolean).join(' ');

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-xl max-h-[90vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-base font-bold">기존 패키지에 항목 추가</h2>
          <button onClick={() => onOpenChange(false)} className="rounded p-1 hover:bg-muted transition">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          신규 패키지 생성이 아닌, 기존 진행중 패키지에 회차를 합산합니다.
        </p>

        <div className="space-y-4 text-sm">
          {/* 패키지 선택 */}
          <div className="space-y-1.5">
            <div className="text-xs font-medium text-muted-foreground">합산할 패키지 선택 *</div>
            <div className="space-y-1.5">
              {activePackages.map((p) => (
                <button
                  key={p.id}
                  onClick={() => selectPackage(p)}
                  className={cn2(
                    'w-full text-left rounded-lg border px-3 py-2 text-xs transition',
                    selectedPkgId === p.id
                      ? 'border-emerald-500 bg-emerald-50'
                      : 'border-gray-200 hover:bg-gray-50',
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-teal-800">{p.package_name}</span>
                    <span className="text-muted-foreground">{formatAmount(p.total_amount)}</span>
                  </div>
                  <div className="text-muted-foreground mt-0.5">
                    총 {p.total_sessions}회
                    {(p.heated_sessions ?? 0) > 0 && ` · 가열 ${p.heated_sessions}회`}
                    {(p.unheated_sessions ?? 0) > 0 && ` · 비가열 ${p.unheated_sessions}회`}
                    {(p.iv_sessions ?? 0) > 0 && ` · 수액${p.iv_company ? `(${p.iv_company})` : ''} ${p.iv_sessions}회`}
                    {(p.podologe_sessions ?? 0) > 0 && ` · 포돌로게 ${p.podologe_sessions}회`}
                    {(p.reborn_sessions ?? 0) > 0 && ` · Re:Born ${p.reborn_sessions}회`}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* 추가 항목 입력 (패키지 선택 후 표시) */}
          {selectedPkg && (
            <>
              <div className="border-t pt-4">
                <div className="text-xs font-semibold text-muted-foreground mb-3">
                  추가할 항목 입력 (0이면 생략)
                </div>

                {/* 가열 레이저 */}
                <div className="rounded-lg border bg-muted/20 p-3 space-y-2 mb-2">
                  <div className="text-xs font-semibold text-muted-foreground">가열 레이저</div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <div className="text-[10px] text-muted-foreground">추가 회수</div>
                      <Input type="number" min={0} value={heated}
                        onChange={(e) => setHeated(Math.max(0, Number(e.target.value) || 0))} />
                    </div>
                    <div className="space-y-1">
                      <div className="text-[10px] text-muted-foreground">
                        수가 (회당)
                        {(selectedPkg.heated_sessions ?? 0) > 0 && <span className="ml-1 text-teal-600">기존: {formatAmount(selectedPkg.heated_unit_price ?? 0)}</span>}
                      </div>
                      <AmountInput value={heatedUnitPrice}
                        onChange={(raw) => setHeatedUnitPrice(Number(raw) || 0)} />
                    </div>
                  </div>
                  {heated > 0 && (
                    <div className="text-xs text-muted-foreground text-right">
                      소계: {formatAmount(heated * heatedUnitPrice)}
                      <span className="ml-2 text-teal-600">
                        기존 {selectedPkg.heated_sessions ?? 0}회 → {(selectedPkg.heated_sessions ?? 0) + heated}회
                      </span>
                    </div>
                  )}
                </div>

                {/* 비가열 레이저 */}
                <div className="rounded-lg border bg-muted/20 p-3 space-y-2 mb-2">
                  <div className="text-xs font-semibold text-muted-foreground">비가열 레이저</div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <div className="text-[10px] text-muted-foreground">추가 회수</div>
                      <Input type="number" min={0} value={unheated}
                        onChange={(e) => setUnheated(Math.max(0, Number(e.target.value) || 0))} />
                    </div>
                    <div className="space-y-1">
                      <div className="text-[10px] text-muted-foreground">
                        수가 (회당)
                        {(selectedPkg.unheated_sessions ?? 0) > 0 && <span className="ml-1 text-teal-600">기존: {formatAmount(selectedPkg.unheated_unit_price ?? 0)}</span>}
                      </div>
                      <AmountInput value={unheatedUnitPrice}
                        onChange={(raw) => setUnheatedUnitPrice(Number(raw) || 0)} />
                    </div>
                  </div>
                  {unheated > 0 && (
                    <div className="text-xs text-muted-foreground text-right">
                      소계: {formatAmount(unheated * unheatedUnitPrice)}
                      <span className="ml-2 text-teal-600">
                        기존 {selectedPkg.unheated_sessions ?? 0}회 → {(selectedPkg.unheated_sessions ?? 0) + unheated}회
                      </span>
                    </div>
                  )}
                </div>

                {/* 수액 */}
                <div className="rounded-lg border bg-muted/20 p-3 space-y-2 mb-2">
                  <div className="text-xs font-semibold text-muted-foreground">수액</div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="space-y-1">
                      <div className="text-[10px] text-muted-foreground">수액명</div>
                      <select value={ivCompany} onChange={(e) => setIvCompany(e.target.value)}
                        className="w-full h-9 rounded-md border border-input px-2 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-teal-500">
                        <option value="">— 선택 —</option>
                        <option value="재생">재생</option>
                        <option value="항염">항염</option>
                        <option value="글로우">글로우</option>
                        <option value="성장">성장</option>
                        <option value="태반">태반</option>
                        <option value="알파">알파</option>
                        <option value="비타민D">비타민D</option>
                        <option value="비타민C">비타민C</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <div className="text-[10px] text-muted-foreground">추가 회수</div>
                      <Input type="number" min={0} value={iv}
                        onChange={(e) => setIv(Math.max(0, Number(e.target.value) || 0))} />
                    </div>
                    <div className="space-y-1">
                      <div className="text-[10px] text-muted-foreground">
                        수가 (회당)
                        {(selectedPkg.iv_sessions ?? 0) > 0 && <span className="ml-1 text-teal-600">기존: {formatAmount(selectedPkg.iv_unit_price ?? 0)}</span>}
                      </div>
                      <AmountInput value={ivUnitPrice}
                        onChange={(raw) => setIvUnitPrice(Number(raw) || 0)} />
                    </div>
                  </div>
                  {iv > 0 && (
                    <div className="text-xs text-muted-foreground text-right">
                      소계: {formatAmount(iv * ivUnitPrice)}
                      <span className="ml-2 text-teal-600">
                        기존 {selectedPkg.iv_sessions ?? 0}회 → {(selectedPkg.iv_sessions ?? 0) + iv}회
                      </span>
                    </div>
                  )}
                </div>

                {/* 포돌로게 */}
                <div className="rounded-lg border bg-muted/20 p-3 space-y-2 mb-4">
                  <div className="text-xs font-semibold text-muted-foreground">포돌로게</div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <div className="text-[10px] text-muted-foreground">추가 회수</div>
                      <Input type="number" min={0} value={podologe}
                        onChange={(e) => setPodologe(Math.max(0, Number(e.target.value) || 0))} />
                    </div>
                    <div className="space-y-1">
                      <div className="text-[10px] text-muted-foreground">
                        수가 (회당)
                        {(selectedPkg.podologe_sessions ?? 0) > 0 && <span className="ml-1 text-teal-600">기존: {formatAmount(selectedPkg.podologe_unit_price ?? 0)}</span>}
                      </div>
                      <AmountInput value={podologeUnitPrice}
                        onChange={(raw) => setPodologeUnitPrice(Number(raw) || 0)} />
                    </div>
                  </div>
                  {podologe > 0 && (
                    <div className="text-xs text-muted-foreground text-right">
                      소계: {formatAmount(podologe * podologeUnitPrice)}
                      <span className="ml-2 text-teal-600">
                        기존 {selectedPkg.podologe_sessions ?? 0}회 → {(selectedPkg.podologe_sessions ?? 0) + podologe}회
                      </span>
                    </div>
                  )}
                </div>

                {/* T-20260608-foot-PKG-REBORN-ITEM: Re:Born */}
                <div className="rounded-lg border bg-muted/20 p-3 space-y-2 mb-4">
                  <div className="text-xs font-semibold text-muted-foreground">Re:Born</div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <div className="text-[10px] text-muted-foreground">추가 회수</div>
                      <Input type="number" min={0} value={reborn}
                        onChange={(e) => setReborn(Math.max(0, Number(e.target.value) || 0))} />
                    </div>
                    <div className="space-y-1">
                      <div className="text-[10px] text-muted-foreground">
                        수가 (회당)
                        {(selectedPkg.reborn_sessions ?? 0) > 0 && <span className="ml-1 text-teal-600">기존: {formatAmount(selectedPkg.reborn_unit_price ?? 0)}</span>}
                      </div>
                      <AmountInput value={rebornUnitPrice}
                        onChange={(raw) => setRebornUnitPrice(Number(raw) || 0)} />
                    </div>
                  </div>
                  {reborn > 0 && (
                    <div className="text-xs text-muted-foreground text-right">
                      소계: {formatAmount(reborn * rebornUnitPrice)}
                      <span className="ml-2 text-teal-600">
                        기존 {selectedPkg.reborn_sessions ?? 0}회 → {(selectedPkg.reborn_sessions ?? 0) + reborn}회
                      </span>
                    </div>
                  )}
                </div>

                {/* 합산 금액 요약 */}
                {totalAdded > 0 && (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-semibold text-emerald-800">추가 금액</div>
                      <button
                        onClick={() => { setPriceOverride(!priceOverride); if (!priceOverride) setManualAddAmount(computedAddAmount); }}
                        className={cn2('text-xs rounded border px-2 py-0.5',
                          priceOverride ? 'border-amber-400 bg-amber-50 text-amber-700' : 'border-input hover:bg-muted')}
                      >
                        {priceOverride ? '✓ 수기수정' : '수기수정'}
                      </button>
                    </div>
                    {priceOverride ? (
                      <AmountInput
                        value={manualAddAmount}
                        onChange={(raw) => setManualAddAmount(Number(raw) || 0)}
                        className="text-lg font-bold"
                      />
                    ) : (
                      <div className="text-xl font-bold text-emerald-700">
                        +{formatAmount(computedAddAmount)}
                      </div>
                    )}
                    <div className="text-xs text-muted-foreground border-t border-emerald-100 pt-2">
                      <span>기존 총금액: {formatAmount(selectedPkg.total_amount)}</span>
                      <span className="mx-2">→</span>
                      <span className="font-semibold text-emerald-700">
                        합산 후: {formatAmount(selectedPkg.total_amount + finalAddAmount)}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      <span>기존 총회차: {selectedPkg.total_sessions}회</span>
                      <span className="mx-2">→</span>
                      <span className="font-semibold text-emerald-700">
                        합산 후: {selectedPkg.total_sessions + totalAdded}회
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button
            onClick={() => onOpenChange(false)}
            className="h-8 rounded border border-gray-200 px-3 text-xs font-medium text-gray-600 hover:bg-gray-50 transition"
          >
            취소
          </button>
          <button
            disabled={submitting || !selectedPkg || totalAdded === 0}
            onClick={submit}
            className="h-8 rounded bg-emerald-600 px-4 text-xs font-medium text-white hover:bg-emerald-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? '저장 중…' : `항목 합산 (+${totalAdded}회)`}
          </button>
        </div>
      </div>
    </div>
  );
}

