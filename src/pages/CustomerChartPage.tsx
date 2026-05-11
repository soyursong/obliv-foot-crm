import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { ExternalLink, Package as PackageIcon, Pencil, Plus, Printer, Trash2, Upload, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { formatAmount, formatPhone, parseAmount } from '@/lib/format';
import { VISIT_TYPE_KO } from '@/lib/status';
import { cn } from '@/lib/utils';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import type { CheckIn, Customer, Package, PackageRemaining, PackageTemplate, PrescriptionRow, Reservation } from '@/lib/types';
// T-20260506-foot-CHECKLIST-AUTOUPLOAD: 업로드된 양식 조회
import { DocumentViewer } from '@/components/forms/DocumentViewer';
// T-20260510-foot-C2-DOC-ISSUANCE: 서류발행 패널
import { DocumentPrintPanel } from '@/components/DocumentPrintPanel';
// T-20260507-foot-CHART2-INSURANCE-FIELDS: 건보 자격등급 패널
import { InsuranceGradeSelect } from '@/components/insurance/InsuranceGradeSelect';
// T-20260511-foot-C2-INSURANCE-AUTO-CALC: 2번차트 진료비 자동산정 패널
import { Chart2InsuranceCalcPanel } from '@/components/insurance/Chart2InsuranceCalcPanel';
// T-20260508-foot-C22-RESV-EDIT: CRM 시간대 연동
import { useClinic } from '@/hooks/useClinic';
import { closeTimeFor, generateSlots, openTimeFor } from '@/lib/schedule';

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
  const [amountDlg, setAmountDlg] = useState<{
    open: boolean; amount: string; method: 'card' | 'cash' | 'transfer';
  }>({ open: false, amount: '', method: 'cash' });

  const storagePath = `customer/${customerId}/receipt`;

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
    toast.success('영수증 업로드 완료');
    // 매출 연동 다이얼로그 열기
    setAmountDlg({ open: true, amount: '', method: 'cash' });
  };

  const remove = async (img: StorageImageItem) => {
    if (!window.confirm('이미지를 삭제하시겠습니까?')) return;
    await supabase.storage.from('photos').remove([img.path]);
    await load();
    toast.success('삭제됨');
  };

  const handlePaymentConfirm = async () => {
    const amt = parseAmount(amountDlg.amount);
    if (amt <= 0) { toast.error('금액을 입력하세요'); return; }
    const { error } = await supabase.from('payments').insert({
      customer_id: customerId,
      clinic_id: clinicId,
      check_in_id: null,
      amount: amt,
      method: amountDlg.method,
      installment: 0,
      payment_type: 'payment',
      memo: '영수증 업로드',
    });
    if (error) { toast.error(`결제 기록 실패: ${error.message}`); return; }
    toast.success('매출 연동 완료');
    setAmountDlg((d) => ({ ...d, open: false }));
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
              <div>
                <label className="text-xs text-muted-foreground block mb-0.5">금액 (원)</label>
                <Input
                  value={amountDlg.amount}
                  onChange={(e) => setAmountDlg((d) => ({ ...d, amount: e.target.value }))}
                  placeholder="0"
                  className="text-sm"
                  autoFocus
                />
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

export default function CustomerChartPage() {
  const { customerId } = useParams<{ customerId: string }>();
  const { profile, loading: authLoading } = useAuth();
  // T-20260508-foot-C22-RESV-EDIT: CRM 시간대 연동
  const clinic = useClinic();

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
  // T-20260507-foot-CHART2-FULL-LAYOUT: 탭 네비게이션 (전능CRM 이중 탭)
  const [chartTab, setChartTab] = useState<string>('checklist');
  const [chartTabGroup, setChartTabGroup] = useState<'clinical' | 'history'>('clinical');
  // T-20260504-foot-MEMO-RESTRUCTURE: 고객메모 인라인 편집
  const [editingCustomerMemo, setEditingCustomerMemo] = useState(false);
  const [customerMemoText, setCustomerMemoText] = useState('');
  const customerMemoRef = useRef<HTMLTextAreaElement>(null);
  // T-20260511-foot-C2-INSURANCE-AUTO-CALC: 건보 자격등급 변경 감지 트리거
  const [insuranceGradeRefreshKey, setInsuranceGradeRefreshKey] = useState(0);
  // T-20260507-foot-CHART2-INSURANCE-FIELDS: 주소지 인라인 편집
  const [editingAddress, setEditingAddress] = useState(false);
  const [addressText, setAddressText] = useState('');
  // T-20260510-foot-ADDRESS-DETAIL-FIX: 상세주소 입력란
  const [addressDetailText, setAddressDetailText] = useState('');
  // T-20260508-foot-CUST-FORM-REVAMP: 신규 폼 필드
  const [editingEmail, setEditingEmail] = useState(false);
  const [emailText, setEmailText] = useState('');
  const [editingPassport, setEditingPassport] = useState(false);
  const [passportText, setPassportText] = useState('');
  const [postalCodeText, setPostalCodeText] = useState(''); // editingPostalCode 제거 — SAVE-UNIFY
  const [savingField, setSavingField] = useState(false);
  // C2-STAFF-DROPDOWN: 실제 직원 목록 (coordinator + consultant + director)
  const [staffList, setStaffList] = useState<{id: string; name: string; role: string}[]>([]);
  // C2-PKG-TICKET-TABLE: 치료사 목록 (role = 'therapist')
  const [therapistList, setTherapistList] = useState<{id: string; name: string}[]>([]);
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
  // C2-HIRA-CONSENT: 건보 조회 동의 상태
  const [savingHira, setSavingHira] = useState(false);
  // C2-RESV-MINI-POPUP: 예약하기 미니창
  const [openResvMiniPopup, setOpenResvMiniPopup] = useState(false);
  // T-20260508-foot-C22-RESV-EDIT: endTime 삭제 (불필요)
  const [resvMiniForm, setResvMiniForm] = useState({ date: '', startTime: '', memo: '' });
  const [savingResvMini, setSavingResvMini] = useState(false);
  // C2-RESV-DETAIL-PANEL: 예약상세 탭
  const [resvDetailTab, setResvDetailTab] = useState<'예약' | '상담' | '치료메모'>('예약');
  const [resvDetailForm, setResvDetailForm] = useState({
    date: '', startTime: '',
    memo: '', etcMemo: '',
  });
  const [savingResvDetail, setSavingResvDetail] = useState(false);
  // C23-DETAIL-SIMPLIFY: 상담탭 상태
  const [consultationStaffId, setConsultationStaffId] = useState('');
  const [consultationMemo, setConsultationMemo] = useState('');
  const [savingConsultation, setSavingConsultation] = useState(false);
  // C23-PHRASE-LINK: 상담 탭 상용구 — phrase_templates WHERE category='general' DB 연동
  const [generalPhrases, setGeneralPhrases] = useState<{ id: number; name: string; content: string }[]>([]);
  // C23-DETAIL-SIMPLIFY: 치료메모 탭 상태
  const [treatmentMemoText, setTreatmentMemoText] = useState('');
  const [savingTreatmentMemo, setSavingTreatmentMemo] = useState(false);
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
  // C22-RESV-EDIT: 예약 수정 모달
  const [editResvId, setEditResvId] = useState<string | null>(null);
  const [editResvForm, setEditResvForm] = useState({ date: '', startTime: '', memo: '' });
  const [savingEditResv, setSavingEditResv] = useState(false);
  // T-20260510-foot-C21-SAVE-UNIFY: 고객정보 패널 통합 저장 로딩 상태
  const [savingInfoPanel, setSavingInfoPanel] = useState(false);
  // T-20260511-foot-C21-SAVE-DIRTY-AUTOSAVE: isDirty 패턴 + 자동저장 인디케이터
  const [isDirty, setIsDirty] = useState(false);
  const [showAutoSaved, setShowAutoSaved] = useState(false);

  // C23-PHRASE-LINK: 마운트 시 [일반] 카테고리 상용구 한 번 조회
  useEffect(() => {
    supabase
      .from('phrase_templates')
      .select('id, name, content')
      .eq('category', 'general')
      .eq('is_active', true)
      .order('sort_order')
      .then(({ data }) => { if (data) setGeneralPhrases(data); });
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
      setCustomerMemoText((custData as Customer).customer_memo ?? '');
      setAddressText((custData as Customer).address ?? '');
      setAddressDetailText((custData as Customer).address_detail ?? '');
      setEmailText((custData as Customer).customer_email ?? '');
      setPassportText((custData as Customer).passport_number ?? '');
      setPostalCodeText((custData as Customer).postal_code ?? '');
      // C23-DETAIL-SIMPLIFY: 2-3 상세 패널 폼 데이터 초기화
      setResvDetailForm({
        date: '', startTime: '',
        memo: (custData as Customer).customer_memo ?? '',
        etcMemo: (custData as Customer).memo ?? '',
      });
      setConsultationMemo((custData as Customer).tm_memo ?? '');
      // treatment_note 컬럼 적용 전 memo 폴백 (migration 20260508000090)
      setTreatmentMemoText((custData as Customer).treatment_note ?? (custData as Customer).memo ?? '');

      // C2-STAFF-DROPDOWN: 담당자 직원 목록 로드 (coordinator + consultant + director)
      // C2-MANAGER-PAYMENT-MAP: active=true DB 필터만으로 비활성 직원 제외 (하드코드 제거)
      const { data: staffData } = await supabase
        .from('staff')
        .select('id, name, role')
        .eq('clinic_id', (custData as Customer).clinic_id)
        .eq('active', true)
        .in('role', ['consultant', 'coordinator', 'director'])
        .order('name', { ascending: true });
      setStaffList((staffData ?? []) as {id: string; name: string; role: string}[]);

      // C2-PKG-TICKET-TABLE: 치료사 목록 로드 (role = 'therapist')
      const { data: therapistData } = await supabase
        .from('staff')
        .select('id, name')
        .eq('clinic_id', (custData as Customer).clinic_id)
        .eq('active', true)
        .eq('role', 'therapist')
        .order('name', { ascending: true });
      setTherapistList((therapistData ?? []) as {id: string; name: string}[]);

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

  // C21-RESIDENT-ID: 고객 로드 시 주민번호 존재 여부 확인
  useEffect(() => {
    if (!customer) return;
    setRrnMasked(undefined);
    (async () => {
      const { data } = await supabase.rpc('rrn_decrypt', { customer_uuid: customer.id });
      if (data) {
        const s = String(data).replace(/\D/g, '');
        setRrnMasked(s.slice(0, 6) + '-*******');
      } else {
        setRrnMasked(null);
      }
    })();
  }, [customer?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // T-20260511-foot-SSN-FRONT-INPUT-BUG: autoFocus 대신 programmatic focus
  // 태블릿 가상키보드 완성 후 포커스 — 150ms 딜레이로 키보드 애니메이션 race condition 방지
  useEffect(() => {
    if (!editingRrn) return;
    const t = setTimeout(() => rrnFrontRef.current?.focus(), 150);
    return () => clearTimeout(t);
  }, [editingRrn]);

  // T-20260507-foot-CHART2-INSURANCE-FIELDS: 주소지 저장
  // T-20260510-foot-C21-SAVE-UNIFY: 우편번호+주소 동시 저장 (저장버튼 단일화)
  // T-20260510-foot-ADDRESS-DETAIL-FIX: address_detail 동시 저장
  const saveAddress = async () => {
    if (!customer) return;
    const { error } = await supabase
      .from('customers')
      .update({
        address: addressText.trim() || null,
        address_detail: addressDetailText.trim() || null,
        postal_code: postalCodeText.trim() || null,
      })
      .eq('id', customer.id);
    if (error) { toast.error('저장 실패'); return; }
    setCustomer((prev) => prev ? {
      ...prev,
      address: addressText.trim() || null,
      address_detail: addressDetailText.trim() || null,
      postal_code: postalCodeText.trim() || null,
    } : prev);
    setEditingAddress(false);
    toast.success('주소 저장됨');
  };

  // T-20260508-foot-CUST-FORM-REVAMP: 단일 필드 즉시 저장 헬퍼
  const saveCustomerField = async (patch: Partial<Customer>, successMsg?: string) => {
    if (!customer) return;
    setSavingField(true);
    const { error } = await supabase.from('customers').update(patch).eq('id', customer.id);
    setSavingField(false);
    if (error) { toast.error(`저장 실패: ${error.message}`); return; }
    setCustomer((prev) => prev ? { ...prev, ...patch } : prev);
    if (successMsg) toast.success(successMsg);
  };

  // 이메일 저장
  const saveEmail = async () => {
    await saveCustomerField({ customer_email: emailText.trim() || null });
    setEditingEmail(false);
    toast.success('이메일 저장됨');
  };

  // 여권번호 저장
  const savePassport = async () => {
    await saveCustomerField({ passport_number: passportText.trim() || null });
    setEditingPassport(false);
    toast.success('여권번호 저장됨');
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
  };

  // C21-RESIDENT-ID: 주민번호 암호화 저장
  const saveRrn = async () => {
    if (!customer) return;
    const digits = (rrnFront + rrnBack).replace(/\D/g, '');
    if (digits.length !== 13) { toast.error('주민번호 13자리를 입력해주세요'); return; }
    const { error } = await supabase.rpc('rrn_encrypt', { customer_uuid: customer.id, plain_rrn: digits });
    if (error) { toast.error(`저장 실패: ${error.message}`); return; }
    setRrnMasked(rrnFront + '-' + '*'.repeat(7));
    setEditingRrn(false);
    setRrnFront('');
    setRrnBack('');
    setRrnText('');
    toast.success('주민번호 저장됨');
  };

  // T-20260510-foot-C21-SAVE-UNIFY: 고객정보 패널 통합 저장
  // T-20260511-foot-C21-SAVE-DIRTY-AUTOSAVE: isAutoSave=true 시 토스트 생략 (인디케이터만)
  const handleInfoPanelSave = async (isAutoSave = false) => {
    if (!customer) return;
    setSavingInfoPanel(true);
    try {
      // 1) 주민번호 — 암호화 RPC 별도 처리 (T-20260511-foot-SSN-SAVE-BUG: split input 사용)
      if (editingRrn) {
        const digits = (rrnFront + rrnBack).replace(/\D/g, '');
        if (digits.length !== 13) { toast.error('주민번호 13자리를 입력해주세요'); return; }
        const { error } = await supabase.rpc('rrn_encrypt', { customer_uuid: customer.id, plain_rrn: digits });
        if (error) { toast.error(`주민번호 저장 실패: ${error.message}`); return; }
        setRrnMasked(rrnFront + '-' + '*'.repeat(7));
        setEditingRrn(false);
        setRrnFront('');
        setRrnBack('');
        setRrnText('');
      }
      // 2) 나머지 필드 일괄 patch
      const patch: Partial<Customer> = {};
      if (editingEmail) patch.customer_email = emailText.trim() || null;
      if (editingPassport) patch.passport_number = passportText.trim() || null;
      if (editingAddress) {
        patch.address = addressText.trim() || null;
        patch.address_detail = addressDetailText.trim() || null;
        patch.postal_code = postalCodeText.trim() || null;
      }
      if (editingCustomerMemo) patch.customer_memo = customerMemoText.trim() || null;
      if (Object.keys(patch).length > 0) {
        const { error } = await supabase.from('customers').update(patch).eq('id', customer.id);
        if (error) { toast.error(`저장 실패: ${error.message}`); return; }
        setCustomer((prev) => prev ? { ...prev, ...patch } : prev);
      }
      // 3) 모든 편집 상태 닫기 + isDirty 리셋
      setEditingEmail(false);
      setEditingPassport(false);
      setEditingAddress(false);
      setEditingCustomerMemo(false);
      setIsDirty(false);
      if (!isAutoSave) toast.success('고객정보 저장 완료');
    } finally {
      setSavingInfoPanel(false);
    }
  };

  // T-20260511-foot-C21-SAVE-DIRTY-AUTOSAVE: stale closure 방지용 ref (항상 최신 함수 참조)
  const handleInfoPanelSaveRef = useRef(handleInfoPanelSave);
  handleInfoPanelSaveRef.current = handleInfoPanelSave;

  // T-20260511-foot-C21-SAVE-DIRTY-AUTOSAVE: isDirty=true 시 60초 자동저장 (현장 확정: 30→60초, 김주연 5/11 16:14)
  useEffect(() => {
    if (!isDirty) return;
    const id = setInterval(async () => {
      await handleInfoPanelSaveRef.current(true);
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
      session_number: useSessionDlg.nextSession,
      session_type: sessionDlgForm.sessionType,
      session_date: sessionDlgForm.sessionDate,
      performed_by: sessionDlgForm.therapistId,
      status: 'used',
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
      const remaining = await Promise.all(
        packages.map(async (p) => {
          const { data } = await supabase.rpc('get_package_remaining', { p_package_id: p.id });
          return data as PackageRemaining | null;
        }),
      );
      setPackages((prev) => prev.map((p, i) => ({ ...p, remaining: remaining[i] })));
    }

    setUseSessionDlg(null);
    toast.success('회차 차감 완료');
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
          // T-20260510-foot-ADDRESS-DETAIL-FIX: 우편번호 검색 직후 상세주소 입력 가능하도록 편집 모드 유지
          setEditingAddress(true);
          // 우편번호 + 주소 즉시 저장 (상세주소는 사용자 입력 후 별도 저장)
          supabase.from('customers').update({
            postal_code: zoneCode || null,
            address: fullAddr || null,
          }).eq('id', customer!.id).then(({ error }) => {
            if (error) { toast.error('주소 저장 실패'); return; }
            setCustomer((prev) => prev ? { ...prev, postal_code: zoneCode, address: fullAddr } : prev);
            toast.success('우편번호·기본주소 저장됨. 상세주소 입력 후 [저장] 클릭.');
          });
        },
      }).open();
    };
    loadAndOpen();
  };

  // T-20260510-foot-CONSENT-SINGLE-SELECT: 개인정보동의 단일선택 — 선택 시 나머지 두 개 false
  const selectConsentField = async (selected: 'privacy_consent' | 'sms_reject' | 'marketing_reject') => {
    if (!customer) return;
    setIsDirty(true);
    const patch = {
      privacy_consent: selected === 'privacy_consent',
      sms_reject: selected === 'sms_reject',
      marketing_reject: selected === 'marketing_reject',
    };
    await saveCustomerField(patch);
  };

  // C2-HIRA-CONSENT: 건보 조회 동의 토글
  const toggleHiraConsent = async () => {
    if (!customer) return;
    setSavingHira(true);
    const newVal = !(customer.hira_consent ?? false);
    const patch: Partial<Customer> = {
      hira_consent: newVal,
      hira_consent_at: newVal ? new Date().toISOString() : null,
    };
    const { error } = await supabase.from('customers').update(patch).eq('id', customer.id);
    setSavingHira(false);
    if (error) { toast.error(`저장 실패: ${error.message}`); return; }
    setCustomer((prev) => prev ? { ...prev, ...patch } : prev);
    toast.success(newVal ? '건보 조회 동의 완료' : '건보 조회 동의 해제');
  };

  // C2-RESV-MINI-POPUP: 미니 예약 저장
  // T-20260508-foot-C22-RESV-EDIT: end_time 제거 + visit_type: 'returning' 자동 설정
  const saveResvMini = async () => {
    if (!customer || !resvMiniForm.date || !resvMiniForm.startTime) {
      toast.error('예약일자와 시작시간을 입력하세요');
      return;
    }
    setSavingResvMini(true);
    const { error } = await supabase.from('reservations').insert({
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
    });
    setSavingResvMini(false);
    if (error) { toast.error(`예약 저장 실패: ${error.message}`); return; }
    // 예약 목록 새로고침
    const { data: resvData } = await supabase
      .from('reservations')
      .select('*')
      .eq('customer_id', customer.id)
      .order('reservation_date', { ascending: false })
      .limit(30);
    setReservations((resvData ?? []) as Reservation[]);
    setOpenResvMiniPopup(false);
    setResvMiniForm({ date: '', startTime: '', memo: '' });
    toast.success('예약 등록 완료 (재진)');
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
    toast.success('메모 저장 완료');
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
    toast.success('상담메모 저장 완료');
  };

  // C23-DETAIL-SIMPLIFY: 치료메모 탭 저장
  // 우선 treatment_note 컬럼 시도, 미존재(42703) 시 기존 memo 컬럼 폴백
  const saveTreatmentMemo = async () => {
    if (!customer) return;
    setSavingTreatmentMemo(true);
    const { error } = await supabase.from('customers').update({
      treatment_note: treatmentMemoText || null,
    }).eq('id', customer.id);
    if (error?.code === '42703') {
      // treatment_note 컬럼 미생성 — memo 폴백 (migration 20260508000090 대기 중)
      const { error: e2 } = await supabase.from('customers').update({
        memo: treatmentMemoText || null,
      }).eq('id', customer.id);
      setSavingTreatmentMemo(false);
      if (e2) { toast.error(`저장 실패: ${e2.message}`); return; }
      setCustomer((prev) => prev ? { ...prev, memo: treatmentMemoText || null } : prev);
      toast.success('치료메모 저장 완료');
      return;
    }
    setSavingTreatmentMemo(false);
    if (error) { toast.error(`저장 실패: ${error.message}`); return; }
    setCustomer((prev) => prev ? { ...prev, treatment_note: treatmentMemoText || null } : prev);
    toast.success('치료메모 저장 완료');
  };

  // C22-RESV-EDIT: 예약 수정 저장
  const saveEditResv = async () => {
    if (!editResvId || !editResvForm.date || !editResvForm.startTime) {
      toast.error('예약일자와 시간을 입력하세요');
      return;
    }
    setSavingEditResv(true);
    const { error } = await supabase.from('reservations').update({
      reservation_date: editResvForm.date,
      reservation_time: editResvForm.startTime,
      booking_memo: editResvForm.memo || null,
    }).eq('id', editResvId);
    setSavingEditResv(false);
    if (error) { toast.error(`수정 실패: ${error.message}`); return; }
    const { data: resvData } = await supabase
      .from('reservations')
      .select('*')
      .eq('customer_id', customer!.id)
      .order('reservation_date', { ascending: false })
      .limit(30);
    setReservations((resvData ?? []) as Reservation[]);
    setEditResvId(null);
    toast.success('예약 수정 완료');
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
  const CLINICAL_TABS = [
    { key: 'checklist',   label: '문진' },
    { key: 'pen_chart',   label: '펜차트' },
    { key: 'images',      label: '진료이미지' },
    { key: 'test_result', label: '검사결과' },
  ];
  const HISTORY_TABS = [
    { key: 'consultations', label: '상담내역' },
    { key: 'payments',      label: '수납내역' },
    { key: 'treatments',    label: '시술내역' },
    { key: 'packages',      label: '패키지' },
    { key: 'messages',      label: '메시지' },
    { key: 'progress',      label: '경과내역' },
    { key: 'documents',     label: '서류발행' },
  ];
  const IMPLEMENTED_CLINICAL = ['checklist', 'images'];
  const IMPLEMENTED_HISTORY  = ['consultations', 'payments', 'treatments', 'packages', 'progress', 'documents'];

  const handleClinicalTab = (key: string) => { setChartTab(key); setChartTabGroup('clinical'); };
  const handleHistoryTab  = (key: string) => { setChartTab(key); setChartTabGroup('history'); };

  /* ── 공통 셀 스타일 (tailwind concat 대체) ── */
  const LC = 'bg-[#eef3f7] border-r border-b border-gray-200 px-2 py-1.5 font-medium text-[#334e65] whitespace-nowrap text-[11px] w-[90px] shrink-0';
  const VC = 'border-b border-gray-200 px-2 py-1.5 text-xs';

  return (
    <div className="min-h-screen bg-[#c8d5de] flex flex-col">

      {/* ── 헤더 (전능CRM 스타일) ─────────────────────────────────────── */}
      <header className="sticky top-0 z-20 flex items-center gap-2 border-b bg-[#1e4e6e] px-3 py-1.5 text-white shadow shrink-0">
        <span className="text-sm font-bold tracking-tight">SMART DOCTOR — 고객정보</span>
        <div className="flex items-center gap-2 ml-2 text-xs">
          <span className="bg-white/20 rounded px-2 py-0.5 font-semibold">{customer.name}</span>
          {customer.chart_number && <span className="text-white/60"># {customer.chart_number}</span>}
          <Badge variant={customer.visit_type === 'new' ? 'teal' : 'secondary'} className="text-[10px]">
            {VISIT_TYPE_KO[customer.visit_type as keyof typeof VISIT_TYPE_KO] ?? customer.visit_type}
          </Badge>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <button onClick={() => window.print()} className="rounded px-2 py-1 text-xs bg-white/10 hover:bg-white/20 transition flex items-center gap-1">
            <Printer className="h-3.5 w-3.5" /> 인쇄
          </button>
          <button onClick={() => window.close()} className="rounded px-2 py-1 text-xs bg-white/10 hover:bg-white/20 transition">
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
          <div className="flex items-center gap-3 bg-[#d8e8f0] border-b border-gray-300 px-3 py-1 shrink-0">
            <span className="text-[11px] font-semibold text-[#1e4e6e]">고객정보</span>
            <span className="text-[11px] text-muted-foreground">
              방문 <strong className="text-teal-700">{visits.length}회</strong>
              {' · '}결제 <strong className="text-teal-700">{formatAmount(totalPaid)}</strong>
              {' · '}패키지 <strong className="text-teal-700">{packages.length}건</strong>
            </span>
            <Button
              size="sm"
              className="ml-auto h-6 text-[11px] px-3 bg-teal-600 hover:bg-teal-700"
              onClick={() => handleInfoPanelSave(false)}
              disabled={savingInfoPanel || !isDirty}
            >
              {savingInfoPanel ? '저장 중…' : '저장'}
            </Button>
            {/* T-20260511-foot-C21-SAVE-DIRTY-AUTOSAVE: 자동저장 인디케이터 */}
            {showAutoSaved && (
              <span className="text-[10px] text-teal-600 ml-1 shrink-0 animate-pulse">자동저장됨 ✓</span>
            )}
          </div>

          {/* 스크롤 영역 */}
          <div className="flex-1 overflow-y-auto">

            {/* ── 고객정보 폼 테이블 (전능CRM 스타일) ── */}
            <table className="w-full border-collapse text-xs">
              <tbody>

                {/* ① 고객명 + 검증 + 고객번호 */}
                <tr>
                  <td className={LC}>고객명</td>
                  <td className={VC} colSpan={3}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm text-gray-900">{customer.name}</span>
                      <span className="rounded border border-blue-300 bg-blue-50 text-blue-700 px-1.5 py-0.5 text-[10px] cursor-default select-none">검증</span>
                      {customer.chart_number && (
                        <span className="text-[11px] text-muted-foreground">
                          고객번호: <strong className="text-gray-700">{customer.chart_number}</strong>
                        </span>
                      )}
                    </div>
                  </td>
                </tr>

                {/* ② 주민번호 — C21-RESIDENT-ID / T-20260511-foot-SSN-SAVE-BUG: 앞6자리 plain + 뒷7자리 masked */}
                <tr>
                  <td className={LC}>주민번호</td>
                  <td className={VC} colSpan={3}>
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
                    ) : (
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
                    )}
                  </td>
                </tr>

                {/* ②-b 건강보험 조회 동의 — C2-HIRA-CONSENT */}
                <tr>
                  <td className={LC}>건보 조회동의</td>
                  <td className={VC} colSpan={3}>
                    <div className="flex items-center gap-3">
                      {/* Y/N 선택 버튼 */}
                      {(['Y', 'N'] as const).map((opt) => {
                        const isY = opt === 'Y';
                        const selected = isY ? (customer.hira_consent ?? false) : !(customer.hira_consent ?? false);
                        return (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => { if (isY !== (customer.hira_consent ?? false)) toggleHiraConsent(); }}
                            disabled={savingHira}
                            className={cn(
                              'inline-flex items-center gap-1 rounded border px-3 py-0.5 text-[11px] font-semibold transition',
                              selected
                                ? isY ? 'border-teal-500 bg-teal-100 text-teal-800' : 'border-gray-400 bg-gray-100 text-gray-600'
                                : 'border-gray-300 bg-white text-gray-400 hover:border-gray-400',
                            )}
                          >
                            <span className={cn(
                              'h-2.5 w-2.5 rounded-full border-2 flex items-center justify-center',
                              selected ? (isY ? 'border-teal-600' : 'border-gray-500') : 'border-gray-300',
                            )}>
                              {selected && <span className={cn('h-1.5 w-1.5 rounded-full', isY ? 'bg-teal-600' : 'bg-gray-500')} />}
                            </span>
                            {opt}
                          </button>
                        );
                      })}
                      {/* 조회 버튼 — Y일 때만 활성 */}
                      <button
                        type="button"
                        onClick={() => window.open('https://www.nhis.or.kr/nhis/minwon/wbhame03400m01.do', '_blank')}
                        disabled={!(customer.hira_consent ?? false)}
                        className={cn(
                          'inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] transition',
                          customer.hira_consent
                            ? 'border-blue-400 bg-blue-50 text-blue-700 hover:bg-blue-100 cursor-pointer'
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
                            saveCustomerField({ is_foreign: true }, '성별: 외국인');
                          } else {
                            saveCustomerField(
                              { gender: val as 'M' | 'F', is_foreign: false },
                              `성별: ${label}`,
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
                              sel ? 'border-blue-600' : 'border-gray-400',
                            )}>
                              {sel && <span className="h-1.5 w-1.5 rounded-full bg-blue-600" />}
                            </span>
                            <span className={sel ? 'font-medium text-blue-700' : 'text-gray-600'}>{label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </td>
                </tr>

                {/* ④ 휴대폰 + 개인정보동의/문자수신거부 — T-20260508-foot-CUST-FORM-REVAMP: 체크박스 활성화 */}
                <tr>
                  <td className={LC}>휴대폰</td>
                  <td className={cn(VC, 'border-r border-gray-200 w-[130px]')}>
                    <a href={`tel:${customer.phone}`} className="font-medium text-teal-700 hover:underline">{formatPhone(customer.phone)}</a>
                  </td>
                  <td className={cn(LC, 'w-auto')}>개인정보동의</td>
                  <td className={VC}>
                    <div className="flex items-center gap-2 flex-wrap">
                      {([
                        { label: '동의', field: 'privacy_consent' as const, checked: customer.privacy_consent ?? false },
                        { label: '문자수신거부', field: 'sms_reject' as const, checked: customer.sms_reject ?? false },
                        { label: '광고미동의', field: 'marketing_reject' as const, checked: customer.marketing_reject ?? false },
                      ]).map(({ label, field, checked }) => (
                        <button
                          key={field}
                          type="button"
                          onClick={() => selectConsentField(field)}
                          disabled={savingField}
                          className="flex items-center gap-1 hover:opacity-80 active:scale-95 transition"
                          title="선택 (셋 중 하나만 선택됩니다)"
                        >
                          <span className={cn(
                            'h-3 w-3 border rounded-full flex items-center justify-center transition-colors',
                            checked ? 'bg-blue-600 border-blue-600' : 'border-gray-400 bg-white',
                          )}>
                            {checked && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                          </span>
                          <span className={cn('text-[11px]', checked ? 'font-medium text-blue-700' : 'text-gray-600')}>{label}</span>
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>

                {/* ⑤ 전화번호 행 삭제 — T-20260508-foot-CUST-FORM-REVAMP */}

                {/* ⑥ 이메일 — 분리·활성화 */}
                <tr>
                  <td className={LC}>이메일</td>
                  <td className={VC} colSpan={3}>
                    {editingEmail ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="email"
                          value={emailText}
                          onChange={(e) => { setEmailText(e.target.value); setIsDirty(true); }}
                          autoFocus
                          placeholder="example@email.com"
                          className="h-5 flex-1 text-[11px] rounded border border-teal-400 px-1.5 focus:outline-none focus:border-teal-600"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveEmail();
                            if (e.key === 'Escape') { setEditingEmail(false); setEmailText(customer.customer_email ?? ''); }
                          }}
                        />
                        <button onClick={() => { setEditingEmail(false); setEmailText(customer.customer_email ?? ''); }} className="rounded border border-gray-300 text-[10px] px-1.5 py-0.5 hover:bg-gray-100 transition shrink-0">취소</button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => { setEditingEmail(true); setIsDirty(true); }}
                        className="text-left w-full hover:bg-blue-50/50 rounded px-0.5 transition"
                        title="클릭하여 편집"
                      >
                        <span className={cn('text-[11px]', customer.customer_email ? 'text-gray-800' : 'text-muted-foreground/50')}>
                          {customer.customer_email ?? '클릭하여 입력'}
                        </span>
                      </button>
                    )}
                  </td>
                </tr>

                {/* ⑥-b 여권번호 — 분리·활성화 */}
                <tr>
                  <td className={LC}>여권번호</td>
                  <td className={VC} colSpan={3}>
                    {editingPassport ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          value={passportText}
                          onChange={(e) => { setPassportText(e.target.value.toUpperCase()); setIsDirty(true); }}
                          autoFocus
                          placeholder="예: M12345678"
                          className="h-5 flex-1 text-[11px] font-mono rounded border border-teal-400 px-1.5 focus:outline-none focus:border-teal-600 uppercase"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') savePassport();
                            if (e.key === 'Escape') { setEditingPassport(false); setPassportText(customer.passport_number ?? ''); }
                          }}
                        />
                        <button onClick={() => { setEditingPassport(false); setPassportText(customer.passport_number ?? ''); }} className="rounded border border-gray-300 text-[10px] px-1.5 py-0.5 hover:bg-gray-100 transition shrink-0">취소</button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => { setEditingPassport(true); setIsDirty(true); }}
                        className="text-left w-full hover:bg-blue-50/50 rounded px-0.5 transition"
                        title="클릭하여 편집"
                      >
                        <span className={cn('text-[11px] font-mono', customer.passport_number ? 'text-gray-800' : 'text-muted-foreground/50')}>
                          {customer.passport_number ?? (customer.is_foreign ? '클릭하여 입력' : '해당없음')}
                        </span>
                      </button>
                    )}
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
                        saveCustomerField({ customer_grade: val }, '고객등급 저장됨');
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

                {/* ⑧⑨ 우편번호+주소 — T-20260510-foot-C21-SAVE-UNIFY: 통합 편집, 저장버튼 하나 */}
                <tr>
                  <td className={LC}>우편번호</td>
                  <td className={VC} colSpan={3}>
                    {editingAddress ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          value={postalCodeText}
                          onChange={(e) => { setPostalCodeText(e.target.value.replace(/\D/g, '').slice(0, 5)); setIsDirty(true); }}
                          placeholder="12345"
                          maxLength={5}
                          inputMode="numeric"
                          className="w-20 h-5 text-[11px] font-mono rounded border border-teal-400 px-1.5 focus:outline-none focus:border-teal-600"
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') { setEditingAddress(false); setPostalCodeText(customer.postal_code ?? ''); setAddressText(customer.address ?? ''); }
                          }}
                        />
                        <button
                          onClick={openKakaoPostcode}
                          className="rounded border border-blue-400 bg-blue-50 text-blue-700 text-[10px] px-1.5 py-0.5 hover:bg-blue-100 transition shrink-0"
                        >
                          주소검색
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => { setEditingAddress(true); setPostalCodeText(customer.postal_code ?? ''); setAddressText(customer.address ?? ''); setIsDirty(true); }}
                        className="flex items-center gap-1.5 hover:bg-blue-50/50 rounded px-0.5 transition"
                        title="클릭하여 우편번호·주소 편집"
                      >
                        <span className={cn('text-[11px] font-mono', customer.postal_code ? 'text-gray-800' : 'text-muted-foreground/50')}>
                          {customer.postal_code ?? '클릭하여 입력'}
                        </span>
                        {!customer.postal_code && (
                          <span className="rounded border border-blue-300 bg-blue-50 text-blue-600 text-[9px] px-1 py-0.5">주소검색</span>
                        )}
                      </button>
                    )}
                  </td>
                </tr>

                {/* ⑨ 주소 — 우편번호와 동일 편집 모드, 저장버튼 1개 */}
                {/* T-20260510-foot-ADDRESS-DETAIL-FIX: 상세주소 입력란 추가 */}
                <tr>
                  <td className={LC}>주소</td>
                  <td className={VC} colSpan={3}>
                    {editingAddress ? (
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-1">
                          <Input
                            value={addressText}
                            onChange={(e) => { setAddressText(e.target.value); setIsDirty(true); }}
                            placeholder="기본주소 (우편번호 검색 시 자동입력)"
                            className="h-6 text-xs flex-1"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveAddress();
                              if (e.key === 'Escape') { setEditingAddress(false); setAddressText(customer.address ?? ''); setAddressDetailText(customer.address_detail ?? ''); setPostalCodeText(customer.postal_code ?? ''); }
                            }}
                          />
                        </div>
                        <div className="flex items-center gap-1">
                          <Input
                            value={addressDetailText}
                            onChange={(e) => { setAddressDetailText(e.target.value); setIsDirty(true); }}
                            placeholder="상세주소 (동·호수·건물명 등)"
                            className="h-6 text-xs flex-1"
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveAddress();
                              if (e.key === 'Escape') { setEditingAddress(false); setAddressText(customer.address ?? ''); setAddressDetailText(customer.address_detail ?? ''); setPostalCodeText(customer.postal_code ?? ''); }
                            }}
                          />
                          <Button size="sm" variant="outline" className="h-6 text-[10px] px-2 shrink-0" onClick={() => { setEditingAddress(false); setAddressText(customer.address ?? ''); setAddressDetailText(customer.address_detail ?? ''); setPostalCodeText(customer.postal_code ?? ''); }}>취소</Button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => { setEditingAddress(true); setAddressText(customer.address ?? ''); setAddressDetailText(customer.address_detail ?? ''); setPostalCodeText(customer.postal_code ?? ''); setIsDirty(true); }}
                        className="text-left w-full hover:bg-blue-50/50 rounded px-0.5 transition"
                        title="클릭하여 주소 편집"
                      >
                        <span className={cn('text-[11px]', customer.address ? 'text-gray-800' : 'text-muted-foreground/50')}>
                          {customer.address ? (
                            <>
                              {customer.address}
                              {customer.address_detail && <span className="text-gray-600"> {customer.address_detail}</span>}
                            </>
                          ) : '미입력 (우편번호 검색 시 자동입력)'}
                        </span>
                      </button>
                    )}
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
                        saveCustomerField({ assigned_staff_id: e.target.value || null }, '담당자 저장됨');
                      }}
                      disabled={savingField}
                      className="rounded border border-gray-300 px-2 py-0.5 text-[11px] cursor-pointer focus:outline-none focus:border-teal-500 bg-white hover:border-teal-400 transition"
                    >
                      <option value="">— 선택 —</option>
                      {staffList.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} ({s.role === 'consultant' ? '상담실장' : s.role === 'coordinator' ? '데스크' : '원장'})
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
                        setIsDirty(true);
                        saveCustomerField({ visit_route: val || null }, '방문경로 저장됨');
                      }}
                      disabled={savingField}
                      className="rounded border border-gray-300 px-2 py-0.5 text-[11px] cursor-pointer focus:outline-none focus:border-teal-500 bg-white hover:border-teal-400 transition"
                    >
                      <option value="">— 선택 —</option>
                      <option value="TM">TM</option>
                      <option value="워크인">워크인</option>
                      <option value="인바운드">인바운드</option>
                      <option value="지인소개">지인소개</option>
                    </select>
                  </td>
                </tr>

                {/* ⑫ 예약메모 (인라인 편집) — C2-MEMO-RENAME: 고객메모→예약메모 */}
                <tr>
                  <td className={cn(LC, 'align-top pt-2 border-b-0')}>예약메모</td>
                  <td className={cn(VC, 'border-b-0')} colSpan={3}>
                    {editingCustomerMemo ? (
                      <div className="space-y-1">
                        <Textarea
                          ref={customerMemoRef}
                          value={customerMemoText}
                          onChange={(e) => { setCustomerMemoText(e.target.value); setIsDirty(true); }}
                          rows={3}
                          className="text-xs"
                          autoFocus
                        />
                        <div className="flex gap-1">
                          <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => { setEditingCustomerMemo(false); setCustomerMemoText(customer.customer_memo ?? ''); }}>
                            취소
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start gap-1 min-h-[40px]">
                        <div className="flex-1">
                          {(customer.customer_memo ?? customer.memo) ? (
                            <div className="text-xs whitespace-pre-wrap text-gray-700 line-clamp-4">{customer.customer_memo ?? customer.memo}</div>
                          ) : (
                            <span className="text-muted-foreground/50 text-[11px]">메모 없음</span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => { setEditingCustomerMemo(true); setCustomerMemoText(customer.customer_memo ?? customer.memo ?? ''); setIsDirty(true); }}
                          className="shrink-0 p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-teal-700"
                          title="고객메모 편집"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>

              </tbody>
            </table>

            {/* ─ 패키지 구매항목 요약 — T-20260510-foot-C21-PKG-ITEM-DETAIL ─ */}
            {packages.filter((p) => p.status === 'active').length > 0 && (
              <div className="border-t border-gray-200 bg-teal-50/40 px-3 py-2 space-y-1.5 text-[11px]">
                <div className="font-semibold text-teal-800 flex items-center gap-1">
                  <PackageIcon className="h-3.5 w-3.5" /> 활성 패키지
                </div>
                {packages.filter((p) => p.status === 'active').map((p) => {
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
            <div className="border-t-2 border-gray-300 shrink-0">
              <div className="flex overflow-x-auto bg-[#d8e8f0]">
                {CLINICAL_TABS.map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => handleClinicalTab(key)}
                    className={cn(
                      'shrink-0 px-3 py-1.5 text-[11px] font-medium border-r border-gray-300 whitespace-nowrap transition',
                      chartTabGroup === 'clinical' && chartTab === key
                        ? 'bg-white text-teal-700 font-semibold shadow-sm'
                        : 'text-[#334e65] hover:bg-white/60',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* ─ 탭 열 2 (이력 탭) ─────────────────────────────────────── */}
            <div className="border-b border-gray-300 shrink-0">
              <div className="flex overflow-x-auto bg-[#e4eef4]">
                {HISTORY_TABS.map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => handleHistoryTab(key)}
                    className={cn(
                      'shrink-0 px-3 py-1.5 text-[11px] font-medium border-r border-gray-300 whitespace-nowrap transition',
                      chartTabGroup === 'history' && chartTab === key
                        ? 'bg-white text-teal-700 font-semibold shadow-sm'
                        : 'text-[#334e65] hover:bg-white/60',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* ─ 탭 콘텐츠 ─────────────────────────────────────────────── */}
            <div className="p-3 space-y-3">

              {/* 준비 중 탭 공통 */}
              {((chartTabGroup === 'clinical' && !IMPLEMENTED_CLINICAL.includes(chartTab)) ||
                (chartTabGroup === 'history'  && !IMPLEMENTED_HISTORY.includes(chartTab))) && (
                <div className="flex items-center justify-center py-10 text-sm text-muted-foreground border border-dashed rounded-lg">
                  준비 중 — 추후 구현 예정
                </div>
              )}

              {/* Clinical: 문진·동의서 */}
              {chartTabGroup === 'clinical' && chartTab === 'checklist' && (
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

              {/* History: 수납내역 */}
              {chartTabGroup === 'history' && chartTab === 'payments' && (
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

              {/* History: 시술내역 */}
              {chartTabGroup === 'history' && chartTab === 'treatments' && (
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

              {/* History: 패키지 — T-20260510-foot-C22-SECTION-MERGE: 치료플랜 요약 제거, 티켓 상세만 표시 */}
              {chartTabGroup === 'history' && chartTab === 'packages' && (
            <div className="space-y-3">
              {/* 구매 패키지(티켓) 상세 — T-20260510-foot-C21-PKG-ITEM-DETAIL: 시술별 상세표시 */}
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
                      // 시술 타입별 사용횟수 집계
                      const usedByType: Record<string, number> = {};
                      usedSessions.forEach((s) => { usedByType[s.session_type] = (usedByType[s.session_type] || 0) + 1; });
                      // T-20260511-foot-PKG-DYNAMIC-TABLE: 기입된 시술만 행으로 생성 (count > 0 || unit_price > 0)
                      const treatRows = [
                        ((p.unheated_sessions ?? 0) > 0 || (p.unheated_unit_price ?? 0) > 0) && { label: '비가열', qty: p.unheated_sessions ?? 0, unitPrice: p.unheated_unit_price ?? 0, used: usedByType['unheated_laser'] ?? 0 },
                        ((p.heated_sessions ?? 0) > 0 || (p.heated_unit_price ?? 0) > 0) && { label: '가열', qty: p.heated_sessions ?? 0, unitPrice: p.heated_unit_price ?? 0, used: usedByType['heated_laser'] ?? 0 },
                        ((p.podologe_sessions ?? 0) > 0 || (p.podologe_unit_price ?? 0) > 0) && { label: '포돌로게', qty: p.podologe_sessions ?? 0, unitPrice: p.podologe_unit_price ?? 0, used: usedByType['podologue'] ?? 0 },
                        ((p.iv_sessions ?? 0) > 0 || (p.iv_unit_price ?? 0) > 0) && { label: `수액${p.iv_company ? ` (${p.iv_company})` : ''}`, qty: p.iv_sessions ?? 0, unitPrice: p.iv_unit_price ?? 0, used: usedByType['iv'] ?? 0 },
                      ].filter(Boolean) as { label: string; qty: number; unitPrice: number; used: number }[];
                      // 시술내역 리스트 (회차 차감 기록)
                      const TREAT_KO: Record<string, string> = { heated_laser: '가열', unheated_laser: '비가열', podologue: '포돌로게', iv: '수액', preconditioning: '프컨' };
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
                          {/* 총금액 */}
                          <div className="px-3 py-1 text-[10px] text-muted-foreground border-b border-muted/10">
                            총 금액: <span className="font-semibold text-teal-700 tabular-nums">{formatAmount(p.total_amount)}</span>
                          </div>
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
                              <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
                                {usedSessions.map((s) => (
                                  <div key={s.id} className="flex items-center gap-1.5 text-[10px]">
                                    <span className="text-muted-foreground w-5 tabular-nums">{s.session_number}회</span>
                                    <span className="rounded bg-muted/40 px-1">{TREAT_KO[s.session_type] ?? s.session_type}</span>
                                    <span className="text-muted-foreground">{s.session_date}</span>
                                    {s.staff_name && <span className="text-teal-600 truncate">{s.staff_name}</span>}
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

              {/* Clinical: 진료이미지 — T-20260510-foot-C21-IMG-PROGRESS: 동의서/영수증→상담내역 이동, 비포에프터만 표시 */}
              {chartTabGroup === 'clinical' && chartTab === 'images' && (
            <div className="space-y-3">
              {/* 치료사 영역 — 비포/에프터 (1번차트 체크인 연동) */}
              <div className="rounded-lg border bg-white p-3 text-xs">
                <div className="flex items-center gap-1.5 font-bold text-amber-800 mb-2">
                  <span className="h-2 w-2 rounded-full bg-amber-500" />
                  일자별 비포/에프터
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

              {/* History: 상담내역 — T-20260510-foot-C21-IMG-PROGRESS: 동의서+영수증 통합 */}
              {chartTabGroup === 'history' && chartTab === 'consultations' && (
            <div className="space-y-3">
              {/* 동의서 사진 + 결제영수증 */}
              <div className="rounded-lg border bg-white p-3 text-xs">
                <div className="flex items-center gap-1.5 font-bold text-blue-800 mb-2">
                  <span className="h-2 w-2 rounded-full bg-blue-500" />
                  상담실장 서류
                </div>
                <div className="space-y-2">
                  <CustomerStorageImageSection customerId={customer.id} prefix="consent" label="동의서 사진 (환불 + 비급여동의서)" accent="blue" />
                  <ReceiptUploadSection
                    customerId={customer.id}
                    clinicId={customer.clinic_id}
                    onPaymentCreated={refreshPayments}
                  />
                </div>
              </div>
              {/* 전자서명 동의서 목록 */}
              {consentEntries.length > 0 && (
                <div className="rounded-lg border bg-white p-3 text-xs">
                  <div className="font-semibold text-muted-foreground mb-2">전자서명 동의서</div>
                  <div className="space-y-1">
                    {consentEntries.map((c, i) => (
                      <div key={i} className="flex items-center gap-2 rounded bg-blue-50 px-2 py-1">
                        <span className="text-muted-foreground">{format(new Date(c.signed_at), 'MM-dd HH:mm')}</span>
                        <span>{FORM_TITLES[c.form_type] ?? c.form_type}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

              {/* History: 경과내역 — T-20260510-foot-C21-IMG-PROGRESS: 경과 사진 업로드 */}
              {chartTabGroup === 'history' && chartTab === 'progress' && (
            <div className="space-y-3">
              {/* 경과내역 사진 업로드 */}
              <div className="rounded-lg border bg-white p-3 text-xs">
                <div className="flex items-center gap-1.5 font-bold text-teal-800 mb-2">
                  <span className="h-2 w-2 rounded-full bg-teal-500" />
                  경과내역 사진
                </div>
                <CustomerStorageImageSection customerId={customer.id} prefix="progress" label="경과 사진 업로드" accent="orange" />
              </div>
              {/* 1번차트 연동 — 체크인별 시술 사진 */}
              {checkInHistory.filter((ci) => ci.treatment_photos && ci.treatment_photos.length > 0).length > 0 && (
                <div className="rounded-lg border bg-white p-3 text-xs">
                  <div className="flex items-center gap-1.5 font-bold text-amber-800 mb-2">
                    <span className="h-2 w-2 rounded-full bg-amber-500" />
                    간편차트 시술사진 (1번차트 연동)
                  </div>
                  <div className="space-y-3">
                    {checkInHistory
                      .filter((ci) => ci.treatment_photos && ci.treatment_photos.length > 0)
                      .map((ci) => (
                        <div key={ci.id}>
                          <div className="text-[10px] text-muted-foreground mb-1 font-medium">{format(new Date(ci.checked_in_at), 'yyyy-MM-dd')}</div>
                          <div className="grid grid-cols-3 gap-1">
                            {(ci.treatment_photos ?? []).map((url, idx) => (
                              <img key={idx} src={url} alt={`사진 ${idx + 1}`}
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

              {/* History: 서류발행 — T-20260510-foot-C2-DOC-ISSUANCE */}
              {chartTabGroup === 'history' && chartTab === 'documents' && (
            <div className="space-y-3">
              {latestCheckIn ? (
                <DocumentPrintPanel
                  checkIn={latestCheckIn}
                  onUpdated={refreshPayments}
                />
              ) : (
                <div className="flex items-center justify-center py-10 text-sm text-muted-foreground border border-dashed rounded-lg">
                  접수 기록이 없어 서류 발행을 사용할 수 없습니다
                </div>
              )}
            </div>
          )}

            </div>{/* /tab-content */}
          </div>{/* /scrollable-area */}
        </div>{/* /left-panel */}

        {/* ════════════════════════════════════════════════════════════════ */}
        {/* 우측 패널 — 건보 + 예약 + 통계 (40%)                            */}
        {/* ════════════════════════════════════════════════════════════════ */}
        <div className="flex flex-col overflow-y-auto bg-white" style={{ width: '40%' }}>

          {/* 패널 서브헤더 */}
          <div className="bg-[#d8e8f0] border-b border-gray-300 px-3 py-1 shrink-0">
            <span className="text-[11px] font-semibold text-[#1e4e6e]">건강보험 · 예약 정보</span>
          </div>

          {/* 건보 조회 + 자격등급 */}
          <div className="border-b border-gray-200 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#1e4e6e]">건강보험 자격등급</span>
              <a
                href="https://www.nhis.or.kr/nhis/minwon/wbhame03400m01.do"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded border border-teal-300 bg-teal-50 px-2 py-1 text-[11px] font-medium text-teal-700 hover:bg-teal-100 transition"
              >
                <ExternalLink className="h-3 w-3" /> 건보 조회
              </a>
            </div>
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
            <Chart2InsuranceCalcPanel
              customerId={customer.id}
              clinicId={customer.clinic_id}
              refreshTrigger={insuranceGradeRefreshKey}
            />
          </div>

          {/* 최근 방문 */}
          <div className="border-b border-gray-200 px-3 py-2">
            <div className="text-[11px] font-semibold text-[#1e4e6e] mb-1">최근 방문</div>
            <div className="text-xs text-gray-700">
              {latestCheckIn
                ? format(new Date(latestCheckIn.checked_in_at), 'yyyy-MM-dd HH:mm')
                : '방문 이력 없음'}
            </div>
          </div>

          {/* 상담메모 */}
          {customer.tm_memo && (
            <div className="border-b border-gray-200 px-3 py-2">
              <div className="text-[11px] font-semibold text-[#1e4e6e] mb-1">상담메모</div>
              <div className="text-xs text-gray-700 whitespace-pre-wrap line-clamp-6">{customer.tm_memo}</div>
            </div>
          )}

          {/* 예약내역 (우측 패널 간략) */}
          <div className="border-b border-gray-200 px-3 py-2">
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-[11px] font-semibold text-[#1e4e6e]">예약내역</div>
              <button
                type="button"
                onClick={() => {
                  setResvMiniForm({ date: format(new Date(), 'yyyy-MM-dd'), startTime: '', memo: '' });
                  setOpenResvMiniPopup(true);
                }}
                className="inline-flex items-center gap-1 rounded border border-teal-300 bg-teal-50 px-1.5 py-0.5 text-[10px] font-medium text-teal-700 hover:bg-teal-100 transition"
              >
                <Plus className="h-3 w-3" /> 예약하기
              </button>
            </div>
            {reservations.length === 0 ? (
              <div className="text-[11px] text-muted-foreground">예약 없음</div>
            ) : (
              <div className="space-y-1">
                {reservations.slice(0, 5).map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => {
                      setEditResvId(r.id);
                      setEditResvForm({
                        date: r.reservation_date,
                        startTime: r.reservation_time.slice(0, 5),
                        memo: r.booking_memo ?? '',
                      });
                    }}
                    className="w-full flex items-center justify-between text-[11px] rounded hover:bg-muted/50 px-1 py-0.5 transition text-left"
                  >
                    <span className="text-gray-700">{r.reservation_date} {r.reservation_time.slice(0, 5)}</span>
                    <Badge variant="secondary" className="text-[10px] px-1.5">{r.status}</Badge>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* C23-DETAIL-SIMPLIFY: 상세 패널 (2-3) */}
          <div className="border-b border-gray-200">
            <div className="bg-[#d8e8f0] border-b border-gray-300 px-3 py-1 shrink-0">
              <span className="text-[11px] font-semibold text-[#1e4e6e]">상세</span>
            </div>
            {/* 탭 */}
            <div className="flex border-b border-gray-200">
              {(['예약', '상담', '치료메모'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setResvDetailTab(tab)}
                  className={cn(
                    'flex-1 px-2 py-1.5 text-[11px] font-medium border-r border-gray-200 last:border-r-0 transition',
                    resvDetailTab === tab
                      ? 'bg-white text-teal-700 font-semibold'
                      : 'bg-[#eef3f7] text-[#334e65] hover:bg-white/70',
                  )}
                >
                  {tab}
                </button>
              ))}
            </div>

            {/* 예약 탭 — 고객메모 + 기타메모 + 저장 */}
            {resvDetailTab === '예약' && (
              <div className="p-2 space-y-2">
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
                  className="w-full rounded bg-teal-600 text-white py-1.5 text-[11px] font-medium hover:bg-teal-700 transition disabled:opacity-50"
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
                    onChange={(e) => setConsultationStaffId(e.target.value)}
                    className="w-full h-7 rounded border border-gray-300 px-1.5 text-[11px] focus:outline-none focus:border-teal-500 bg-white"
                  >
                    <option value="">— 실장 선택 —</option>
                    {staffList.filter(s => s.role === 'consultant' || s.role === 'coordinator' || s.role === 'director').map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
                {/* 상용구 — C23-PHRASE-LINK: phrase_templates WHERE category='general' DB 연동 */}
                {generalPhrases.length > 0 && (
                  <div>
                    <label className="block text-[11px] text-muted-foreground mb-0.5">상용구</label>
                    <div className="flex flex-wrap gap-1">
                      {generalPhrases.map(phrase => (
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
                    rows={4}
                    className="text-[11px] resize-none"
                  />
                </div>
                <button
                  type="button"
                  onClick={saveConsultation}
                  disabled={savingConsultation}
                  className="w-full rounded bg-teal-600 text-white py-1.5 text-[11px] font-medium hover:bg-teal-700 transition disabled:opacity-50"
                >
                  {savingConsultation ? '저장 중…' : '저장'}
                </button>
              </div>
            )}

            {/* 치료메모 탭 */}
            {resvDetailTab === '치료메모' && (
              <div className="p-2 space-y-2">
                <div>
                  <label className="block text-[11px] text-muted-foreground mb-0.5">치료메모</label>
                  <Textarea
                    value={treatmentMemoText}
                    onChange={(e) => setTreatmentMemoText(e.target.value)}
                    rows={5}
                    className="text-[11px] resize-none"
                  />
                </div>
                <button
                  type="button"
                  onClick={saveTreatmentMemo}
                  disabled={savingTreatmentMemo}
                  className="w-full rounded bg-teal-600 text-white py-1.5 text-[11px] font-medium hover:bg-teal-700 transition disabled:opacity-50"
                >
                  {savingTreatmentMemo ? '저장 중…' : '저장'}
                </button>
              </div>
            )}
          </div>

          {/* 수납 통계 — C2-REMOVE-PKG-STATS: 패키지 항목 삭제 */}
          <div className="px-3 py-2">
            <div className="text-[11px] font-semibold text-[#1e4e6e] mb-1.5">수납 통계</div>
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

      {/* C2-RESV-MINI-POPUP: 예약하기 미니창 */}
      {openResvMiniPopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-white rounded-lg shadow-xl border border-gray-200 w-[360px] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#1e4e6e]">예약 등록 — {customer.name}</h3>
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
            </div>
            <div className="flex gap-2 pt-1">
              <Button
                className="flex-1 bg-teal-600 hover:bg-teal-700 h-8 text-xs"
                onClick={saveResvMini}
                disabled={savingResvMini}
              >
                {savingResvMini ? '저장 중…' : '예약 등록'}
              </Button>
              <Button variant="outline" className="h-8 text-xs px-3" onClick={() => setOpenResvMiniPopup(false)}>
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
              <h3 className="text-sm font-semibold text-[#1e4e6e]">예약 수정</h3>
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
  // T-20260510-foot-PKG-CREATE-FIX3: 포돌로게 포함 (total_sessions에 반영)
  const totalSessions = heated + unheated + iv + precon + podologe;

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
      upgrade_surcharge: upgradeSurcharge, total_amount: grandTotal, paid_amount: 0,
      status: 'active', memo: memo.trim() || null,
    });
    setSubmitting(false);
    if (pkgErr) { toast.error(`패키지 생성 실패: ${pkgErr.message}`); return; }
    toast.success('템플릿 저장 + 구입 티켓 생성 완료');
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
        <div className="flex justify-end gap-1.5 mt-4">
          <button
            onClick={() => onOpenChange(false)}
            className="h-8 rounded border border-gray-200 px-3 text-xs hover:bg-gray-50 transition"
          >
            취소
          </button>
          <button
            disabled={submitting || !packageName.trim() || totalSessions === 0}
            onClick={submitWithTemplate}
            className="h-8 rounded border border-teal-300 bg-teal-50 px-3 text-xs font-medium text-teal-700 hover:bg-teal-100 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? '저장 중…' : '템플릿 추가 후 생성'}
          </button>
          <button
            disabled={submitting || !packageName.trim() || totalSessions === 0}
            onClick={submit}
            className="h-8 rounded bg-teal-600 px-3 text-xs font-medium text-white hover:bg-teal-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? '저장 중…' : '구입 티켓 생성'}
          </button>
        </div>
      </div>
    </div>
  );
}
