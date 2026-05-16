import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useClinic } from '@/hooks/useClinic';
import { format } from 'date-fns';
import { ChevronDown, Clock, CreditCard, ExternalLink, Phone, FileText, Camera, Package, Stethoscope, Trash2, Bell, Upload, MapPin } from 'lucide-react';
import DoctorTreatmentPanel from '@/components/doctor/DoctorTreatmentPanel';
import { toast } from 'sonner';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { STATUS_KO } from '@/lib/status';
import { formatAmount, formatPhone, parseAmount } from '@/lib/format';
import { cn } from '@/lib/utils';
import { PreChecklist } from '@/components/PreChecklist';
// T-20260506-foot-CHECKLIST-AUTOUPLOAD: 태블릿 작성 양식 + 자동 업로드
import { ChecklistForm } from '@/components/forms/ChecklistForm';
import { ConsentForm } from '@/components/forms/ConsentForm';
import { DocumentViewer } from '@/components/forms/DocumentViewer';
import { InsuranceDocPanel } from '@/components/InsuranceDocPanel';
import { DocumentPrintPanel } from '@/components/DocumentPrintPanel';
// T-20260514-foot-PAYMENT-EDIT-CANCEL-DELETE
// T-20260515-foot-PAYMENT-EDIT-REFLECT: PaymentDonePayload 추가 import
import { PaymentEditDialog, PaymentAuditLogsPanel } from '@/components/PaymentEditDialog';
import type { EditMode, PaymentRowForEdit, PaymentDonePayload } from '@/components/PaymentEditDialog';
import type { CheckIn, Package as PackageType, PackageRemaining, Room, Service, VisitType } from '@/lib/types';
// T-20260514-foot-CHART-EXPAND-UX: 고객차트 슬라이드 패널
import { CustomerChartSheet } from '@/components/CustomerChartSheet';
// T-20260515-foot-KENBO-API-NATIVE: 건보공단 수진자 자격조회 Native 패널
import { NhisLookupPanel } from '@/components/insurance/NhisLookupPanel';

// ─── 시술 항목 / 회차 차감 타입 ──────────────────────────────────────────────

type SessionType = 'heated_laser' | 'unheated_laser' | 'iv' | 'preconditioning';

// ─── 공간배정 이동이력 타입 (T-20260513-foot-C1-SPACE-ASSIGN-RESTORE) ─────────

interface RoomLog {
  id: string;
  check_in_id: string;
  assigned_room: string;
  room_type: string;
  logged_at: string;
}

function getRoomField(roomName: string): 'examination_room' | 'consultation_room' | 'treatment_room' | 'laser_room' | null {
  if (roomName.startsWith('원장실')) return 'examination_room';
  if (roomName.startsWith('상담실')) return 'consultation_room';
  if (roomName.startsWith('치료실')) return 'treatment_room';
  if (roomName.startsWith('레이저실')) return 'laser_room';
  return null;
}
function getRoomType(roomName: string): 'examination' | 'consultation' | 'treatment' | 'laser' | null {
  if (roomName.startsWith('원장실')) return 'examination';
  if (roomName.startsWith('상담실')) return 'consultation';
  if (roomName.startsWith('치료실')) return 'treatment';
  if (roomName.startsWith('레이저실')) return 'laser';
  return null;
}
/** 오늘(서울 기준) 날짜 문자열 반환 */
function todaySeoulStr(): string {
  return new Date().toLocaleDateString('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  });
}
function logDateStr(isoStr: string): string {
  return new Date(isoStr).toLocaleDateString('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  });
}

interface TreatmentItem {
  /** 로컬 식별자 */
  _id: string;
  service: Service;
  /** 서비스→패키지 세션 타입 추론 결과 (null이면 단건 결제만 가능) */
  sessionType: SessionType | null;
  /** 패키지 회차 사용 완료 여부 */
  settled: boolean;
}

const SESSION_TYPE_FULL: Record<SessionType, string> = {
  heated_laser: '가열레이저',
  unheated_laser: '비가열레이저',
  iv: '수액',
  preconditioning: '사전처치',
};

/** SessionType → PackageRemaining 키 매핑
 *  heated_laser → heated, unheated_laser → unheated (나머지는 동일)
 */
const SESSION_TYPE_TO_REM_KEY: Record<SessionType, keyof PackageRemaining> = {
  heated_laser: 'heated',
  unheated_laser: 'unheated',
  iv: 'iv',
  preconditioning: 'preconditioning',
};

/** 서비스 category·name 텍스트에서 패키지 세션 타입 추론 */
function sessionTypeFromService(svc: Service): SessionType | null {
  const hay = ((svc.category ?? '') + ' ' + (svc.name ?? '')).toLowerCase();
  if (hay.includes('비가열')) return 'unheated_laser';
  if (hay.includes('가열')) return 'heated_laser';
  if (hay.includes('수액') || hay.includes(' iv')) return 'iv';
  if (hay.includes('사전처치') || hay.includes('preconditioning')) return 'preconditioning';
  return null;
}

// ─── 기존 인터페이스 ──────────────────────────────────────────────────────────

interface PaymentRow {
  id: string;
  amount: number;
  method: string;
  installment: number | null;
  payment_type: string;
  created_at: string;
  // T-20260514-foot-PAYMENT-EDIT-CANCEL-DELETE
  status?: string | null;
  check_in_id?: string | null;
  clinic_id?: string | null;
}

interface VisitHistory {
  id: string;
  checked_in_at: string;
  status: string;
  visit_type: string;
  doctor_note: string | null;
  treatment_memo: { details?: string; [key: string]: unknown } | null;
  notes: { text?: string; [key: string]: unknown } | null;
}

interface Props {
  checkIn: CheckIn | null;
  /**
   * customer_id 기반 뷰 모드 (고객관리 1번차트)
   * T-20260511-foot-CUSTMGMT-DETAIL-SHEET
   * check_in 없이 고객 정보를 바로 조회할 때 사용.
   */
  customerMode?: {
    customerId: string;
    customerName: string;
    customerPhone: string;
    clinicId: string;
    chartNumber?: string | null;
  };
  onClose: () => void;
  onUpdated: () => void;
  /** initialMode: 상담 단계 진입 시 'package' 전달 → PaymentDialog 패키지 모드 default */
  onPayment: (ci: CheckIn, initialMode?: 'package') => void;
  /** T-20260515-foot-MEDICAL-CHART-V1 AC-7: 진료차트 패널 열기 */
  onOpenMedicalChart?: (customerId: string) => void;
}

const METHOD_LABEL: Record<string, string> = {
  card: '카드',
  cash: '현금',
  transfer: '이체',
  membership: '멤버십',
};

// ─── 서브 컴포넌트: 방문 이력 아코디언 ──────────────────────────────────────

function VisitHistoryAccordion({ history }: { history: VisitHistory[] }) {
  const grouped = history.reduce<Record<string, VisitHistory[]>>((acc, h) => {
    const date = format(new Date(h.checked_in_at), 'yyyy-MM-dd');
    (acc[date] ??= []).push(h);
    return acc;
  }, {});
  const dates = Object.keys(grouped).sort().reverse();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(dates.slice(0, 1)));

  const toggle = (d: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });

  return (
    <div className="space-y-1">
      <span className="text-sm font-semibold text-muted-foreground">방문 이력 ({history.length})</span>
      {dates.map((date) => {
        const items = grouped[date];
        const isOpen = expanded.has(date);
        return (
          <div key={date} className="rounded-lg border overflow-hidden">
            <button
              onClick={() => toggle(date)}
              className="w-full flex items-center justify-between px-2.5 py-1.5 text-xs hover:bg-muted/50 transition"
            >
              <span className="font-semibold">{date}</span>
              <div className="flex items-center gap-1 text-muted-foreground">
                <span className="text-xs">{items.length}건</span>
                <ChevronDown className={cn('h-3 w-3 transition-transform', !isOpen && '-rotate-90')} />
              </div>
            </button>
            {isOpen && (
              <div className="px-2.5 pb-2 space-y-1.5">
                {items.map((h) => (
                  <div key={h.id} className="rounded border px-2 py-1.5 text-xs space-y-1 bg-muted/20">
                    <div className="flex justify-between text-muted-foreground">
                      <span>{format(new Date(h.checked_in_at), 'HH:mm')}</span>
                      <span>{STATUS_KO[h.status as keyof typeof STATUS_KO] ?? h.status}</span>
                    </div>
                    {h.doctor_note && (
                      <div className="text-violet-700">
                        <span className="font-semibold">소견:</span> {h.doctor_note}
                      </div>
                    )}
                    {h.treatment_memo?.details && (
                      <div className="text-muted-foreground">
                        <span className="font-semibold">시술:</span> {h.treatment_memo.details}
                      </div>
                    )}
                    {h.notes?.text && (
                      <div className="text-muted-foreground">
                        <span className="font-semibold">메모:</span> {h.notes.text}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── 서브 컴포넌트: 활성 패키지 잔여회차 요약 카드 ──────────────────────────

function ActivePackageSummary({
  packages,
  pkgRemaining,
  emphasize,
}: {
  packages: PackageType[];
  pkgRemaining: Map<string, PackageRemaining>;
  /** payment_waiting 단계: 카드 강조 스타일 */
  emphasize?: boolean;
}) {
  if (packages.length === 0) return null;

  return (
    <div className={cn('space-y-1.5', emphasize && 'rounded-xl bg-teal-50 border-2 border-teal-400 p-3')}>
      <span className={cn(
        'text-sm font-semibold flex items-center gap-1',
        emphasize ? 'text-teal-800' : 'text-teal-700',
      )}>
        <Package className={cn('h-3.5 w-3.5', emphasize && 'h-4 w-4')} />
        패키지 잔여회차
        {emphasize && (
          <span className="ml-1 text-xs font-normal text-teal-600 bg-teal-100 rounded px-1.5 py-0.5">
            회차 차감 단계
          </span>
        )}
      </span>
      {packages.map((pkg) => {
        const rem = pkgRemaining.get(pkg.id);
        const hasAny = rem && rem.total_remaining > 0;
        return (
          <div
            key={pkg.id}
            className={cn(
              'rounded-lg border px-2.5 py-2 space-y-1.5',
              emphasize
                ? hasAny
                  ? 'border-teal-400 bg-white shadow-sm'
                  : 'border-gray-300 bg-gray-50'
                : hasAny
                  ? 'border-teal-300 bg-teal-50/60'
                  : 'border-gray-200 bg-gray-50/60',
            )}
          >
            <div className="flex items-center justify-between">
              <span className={cn(
                'font-semibold',
                emphasize ? 'text-sm text-teal-900' : 'text-xs text-teal-900',
              )}>{pkg.package_name}</span>
              {rem && (
                <span className={cn(
                  'text-muted-foreground',
                  emphasize
                    ? hasAny
                      ? 'text-sm font-bold text-teal-700'
                      : 'text-xs'
                    : 'text-xs',
                )}>
                  잔여 {rem.total_remaining}/{pkg.total_sessions}회
                </span>
              )}
            </div>
            {rem ? (
              <div className="flex gap-1.5 flex-wrap">
                {rem.heated > 0 && (
                  <span className={cn(
                    'inline-flex items-center bg-orange-100 text-orange-700 rounded-full font-medium',
                    emphasize ? 'text-sm px-2.5 py-1' : 'text-xs px-2 py-0.5',
                  )}>
                    가열 {rem.heated}
                  </span>
                )}
                {rem.unheated > 0 && (
                  <span className={cn(
                    'inline-flex items-center bg-blue-100 text-blue-700 rounded-full font-medium',
                    emphasize ? 'text-sm px-2.5 py-1' : 'text-xs px-2 py-0.5',
                  )}>
                    비가열 {rem.unheated}
                  </span>
                )}
                {rem.iv > 0 && (
                  <span className={cn(
                    'inline-flex items-center bg-purple-100 text-purple-700 rounded-full font-medium',
                    emphasize ? 'text-sm px-2.5 py-1' : 'text-xs px-2 py-0.5',
                  )}>
                    수액 {rem.iv}
                  </span>
                )}
                {rem.preconditioning > 0 && (
                  <span className={cn(
                    'inline-flex items-center bg-emerald-100 text-emerald-700 rounded-full font-medium',
                    emphasize ? 'text-sm px-2.5 py-1' : 'text-xs px-2 py-0.5',
                  )}>
                    사전처치 {rem.preconditioning}
                  </span>
                )}
                {rem.total_remaining === 0 && (
                  <span className="text-xs text-muted-foreground">잔여 없음</span>
                )}
              </div>
            ) : (
              <span className="text-xs text-muted-foreground">로딩 중…</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// T-20260513-foot-C21-TAB-RESTRUCTURE-B: 1번차트 진료이미지 섹션 (Storage 기반, 2번차트와 쌍방연동)
function Chart1TreatmentImages({ customerId }: { customerId: string }) {
  const [images, setImages] = useState<Array<{ path: string; signedUrl: string; name: string }>>([]);
  const [uploading, setUploading] = useState(false);
  const storagePath = `customer/${customerId}/treatment-images`;

  const load = useCallback(async () => {
    const { data: files } = await supabase.storage.from('photos').list(storagePath, {
      limit: 100,
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
  };

  const remove = async (path: string) => {
    if (!window.confirm('이미지를 삭제하시겠습니까?')) return;
    await supabase.storage.from('photos').remove([path]);
    await load();
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
          <Upload className="h-3 w-3" /> 진료이미지
          {images.length > 0 && <span className="ml-1 text-teal-600 font-normal">{images.length}장</span>}
        </span>
        <label className="cursor-pointer">
          <input type="file" accept="image/*" multiple className="hidden" onChange={handleUpload} disabled={uploading} />
          <span className="inline-flex items-center gap-1 text-xs border border-teal-200 rounded px-2 py-0.5 bg-white text-teal-700 hover:bg-teal-50 cursor-pointer transition">
            <Upload className="h-3 w-3" />
            {uploading ? '중…' : '업로드'}
          </span>
        </label>
      </div>
      {images.length === 0 ? (
        <div className="rounded-lg border border-dashed py-4 text-center text-xs text-muted-foreground">
          진료이미지 없음
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {images.map((img) => (
            <div key={img.path} className="relative group">
              <img
                src={img.signedUrl}
                alt={img.name}
                className="w-full h-24 object-cover rounded-lg border cursor-pointer"
                onClick={() => window.open(img.signedUrl, '_blank')}
              />
              <button
                onClick={() => remove(img.path)}
                className="absolute top-1 right-1 hidden group-hover:flex h-7 w-7 items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600"
                title="삭제"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── 메인 컴포넌트 ────────────────────────────────────────────────────────────

// 기본 레이저 시간 단위 (어드민 설정 미존재 시 fallback) — 10분 추가 (T-20260504-foot-TREATMENT-SIMPLIFY)
const DEFAULT_LASER_TIME_UNITS = [10, 15, 20, 30];

export function CheckInDetailSheet({ checkIn, customerMode, onClose, onUpdated, onPayment, onOpenMedicalChart }: Props) {
  const { profile } = useAuth();
  const clinic = useClinic();
  const isAdmin = profile?.role === 'admin';
  /** 클리닉 설정 기반 레이저 시간 단위 목록 */
  const laserTimeUnits: number[] = clinic?.laser_time_units?.length
    ? clinic.laser_time_units
    : DEFAULT_LASER_TIME_UNITS;
  const [services, setServices] = useState<Service[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [history, setHistory] = useState<VisitHistory[]>([]);
  const [packages, setPackages] = useState<PackageType[]>([]);
  const [pkgRemaining, setPkgRemaining] = useState<Map<string, PackageRemaining>>(new Map());
  const [notes, setNotes] = useState('');
  const [treatmentMemo, setTreatmentMemo] = useState('');
  const [doctorNote, setDoctorNote] = useState('');
  // T-20260504-foot-MEMO-RESTRUCTURE: 고객메모 (예약메모는 2번차트 1구역 전용 — T-20260512)
  const [customerMemo, setCustomerMemo] = useState('');
  const [savingCustomerMemo, setSavingCustomerMemo] = useState(false);
  const [saving, setSaving] = useState(false);
  // T-20260511-foot-C1-SAVE-DIRTY-AUTOSAVE: isDirty 패턴 + 자동저장 인디케이터
  const [isDirty, setIsDirty] = useState(false);
  const [showAutoSaved, setShowAutoSaved] = useState(false);
  const [checklistOpen, setChecklistOpen] = useState(false);
  // T-20260506-foot-CHECKLIST-AUTOUPLOAD: 태블릿 양식 다이얼로그
  const [tabletChecklistOpen, setTabletChecklistOpen] = useState(false);
  const [tabletConsentOpen, setTabletConsentOpen] = useState(false);
  const [docRefreshKey, setDocRefreshKey] = useState(0);
  /** 고객 차트번호 (T-20260504-foot-CHART-UI-BADGE) */
  const [chartNumber, setChartNumber] = useState<string | null>(null);
  /** T-20260506-foot-CHART-LINK-SYNC: customer_id null 시 phone으로 조회된 고객 ID (2순위 식별) */
  const [resolvedCustomerId, setResolvedCustomerId] = useState<string | null>(null);
  /** T-20260512-foot-CUSTMGMT-AC6-AC9: customerMode에서 최근 체크인 전체 (서류발행·의사소견·접수상태 표시용) */
  const [latestCheckIn, setLatestCheckIn] = useState<CheckIn | null>(null);

  // ── 진료종류 상태 (T-20260430-foot-TREATMENT-LABEL) — DB 호환성 유지 ──
  const [consultationDone, setConsultationDone] = useState(false);
  const [treatmentKind, setTreatmentKind] = useState<string>('');
  const [preconditioningDone, setPreconditioningDone] = useState(false);
  const [pododulleDone, setPododulleDone] = useState(false);
  const [laserMinutes, setLaserMinutes] = useState<number | null>(null);

  // ── 진료 기록 간소화 상태 (T-20260504-foot-TREATMENT-SIMPLIFY) ──
  const [assignedCounselorId, setAssignedCounselorId] = useState<string | null>(null);
  const [treatmentCategory, setTreatmentCategory] = useState<string | null>(null);
  const [treatmentContents, setTreatmentContents] = useState<string[]>([]);
  /** 담당실장 드롭다운용 스태프 목록 */
  const [staffList, setStaffList] = useState<Array<{ id: string; name: string; role: string }>>([]);
  /** T-20260510-foot-C1-VISIT-ROUTE-MEMO: 방문경로 */
  const [visitRoute, setVisitRoute] = useState<string>('');
  /** T-20260512-foot-C1-VISIT-ROUTE-MEMO-V3: 예약메모(booking_memo) / 기타메모(memo) */
  const [bookingMemo, setBookingMemo] = useState('');
  const [savingBookingMemo, setSavingBookingMemo] = useState(false);
  const [etcMemo, setEtcMemo] = useState('');
  const [savingEtcMemo, setSavingEtcMemo] = useState(false);
  const [latestResvId, setLatestResvId] = useState<string | null>(null);
  // T-20260514-foot-PAYMENT-EDIT-CANCEL-DELETE
  const [payEditTarget, setPayEditTarget] = useState<PaymentRowForEdit | null>(null);
  const [payEditMode, setPayEditMode] = useState<EditMode>('edit');
  // T-20260514-foot-CHART-EXPAND-UX: 고객차트 슬라이드 패널 (window.open 대체)
  const [chartSheetId, setChartSheetId] = useState<string | null>(null);
  // T-20260513-foot-C1-SPACE-ASSIGN-RESTORE: 공간배정 이동이력
  const [roomLogs, setRoomLogs] = useState<RoomLog[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [selectedRoom, setSelectedRoom] = useState('');
  const [assigningRoom, setAssigningRoom] = useState(false);
  // T-20260515-foot-KENBO-API-NATIVE: 고객 건보 조회 동의 여부
  const [hiraConsent, setHiraConsent] = useState(false);

  // ── 시술 항목 상태 (ServiceSelectModal/SessionUseInSheetDialog 유지용) ──
  const [, setTreatmentItems] = useState<TreatmentItem[]>([]);
  const [svcModalOpen, setSvcModalOpen] = useState(false);
  const [sessionUseOpen, setSessionUseOpen] = useState(false);
  const [sessionUsePkg, setSessionUsePkg] = useState<PackageType | null>(null);
  const [sessionUseRemaining, setSessionUseRemaining] = useState<PackageRemaining | null>(null);
  const [sessionUseType, setSessionUseType] = useState<SessionType>('unheated_laser');
  const [sessionUseTreatmentIdx, setSessionUseTreatmentIdx] = useState<number>(-1);

  /** 서류 발행 섹션 스크롤 타깃 (데스크 메뉴 → 보험청구 서류 발급 버튼) */
  const docPrintRef = useRef<HTMLDivElement>(null);

  // 체크인 변경 시 시술 항목 + 진료종류 초기화
  // T-20260515-foot-CHART2-REOPEN 5차 fix (atomic): data-reset + auto-open 단일 effect로 병합.
  // 이전 4차 fix(068239c): 두 개의 별도 effect로 분리 → React 18에서 effect 간 배칭 순서가
  // 비결정적일 수 있어 setChartSheetId(null) 이후 auto-open이 누락되는 경우 발생.
  // 해결: 단일 effect 내에서 reset → 조건부 auto-open을 원자적으로 처리.
  // 결과: data-reset과 auto-open이 항상 동일 effect flush에서 실행 → 순서 보장.
  useEffect(() => {
    setTreatmentItems([]);
    setChartNumber(null);
    setResolvedCustomerId(null);
    setLatestCheckIn(null);
    // 초진(new) + customer_id 있으면 자동 오픈, 그 외 모두 reset
    if (checkIn?.visit_type === 'new' && checkIn.customer_id) {
      setChartSheetId(checkIn.customer_id); // 초진 자동 오픈
    } else {
      setChartSheetId(null); // 환자 전환 시 stale 차트 닫기
    }
    if (checkIn) {
      setConsultationDone(checkIn.consultation_done ?? false);
      setTreatmentKind(checkIn.treatment_kind ?? '');
      setPreconditioningDone(checkIn.preconditioning_done ?? false);
      setPododulleDone(checkIn.pododulle_done ?? false);
      setLaserMinutes(checkIn.laser_minutes ?? null);
      // T-20260504-foot-TREATMENT-SIMPLIFY
      setAssignedCounselorId(checkIn.assigned_counselor_id ?? null);
      setTreatmentCategory(checkIn.treatment_category ?? null);
      setTreatmentContents(checkIn.treatment_contents ?? []);
    }
  }, [checkIn?.id, customerMode?.customerId]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    if (!checkIn && !customerMode) return;

    // ── customer_id 기반 조회 모드 (고객관리 1번차트 T-20260511-foot-CUSTMGMT-DETAIL-SHEET) ──
    if (!checkIn && customerMode) {
      const { customerId, clinicId } = customerMode;
      const [pkgRes, histRes, custRes, staffRes, latestCiRes, latestResvRes] = await Promise.all([
        supabase
          .from('packages')
          .select('*')
          .eq('customer_id', customerId)
          .eq('status', 'active')
          .order('contract_date', { ascending: false }),
        supabase
          .from('check_ins')
          .select('id, checked_in_at, status, visit_type, doctor_note, treatment_memo, notes')
          .eq('customer_id', customerId)
          .order('checked_in_at', { ascending: false })
          .limit(10),
        supabase
          .from('customers')
          .select('id, chart_number, customer_memo, visit_route, memo, hira_consent')
          .eq('id', customerId)
          .single(),
        supabase
          .from('staff')
          .select('id, name, role')
          .eq('clinic_id', clinicId)
          .eq('active', true)
          .in('role', ['consultant'])
          .order('name'),
        // T-20260512-foot-CUSTMGMT-AC6-AC9: 서류발행·의사소견·접수상태 표시용 최근 체크인 전체 조회
        supabase
          .from('check_ins')
          .select('*')
          .eq('customer_id', customerId)
          .neq('status', 'cancelled')
          .order('checked_in_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        // T-20260512-foot-C1-VISIT-ROUTE-MEMO-V3: 예약메모 — 최근 예약 booking_memo
        supabase
          .from('reservations')
          .select('id, booking_memo')
          .eq('customer_id', customerId)
          .order('reservation_date', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      const pkgs = (pkgRes.data ?? []) as PackageType[];
      setPackages(pkgs);
      setHistory((histRes.data ?? []) as VisitHistory[]);
      const custData = custRes.data as { chart_number: string | null; customer_memo: string | null; visit_route?: string | null; memo?: string | null; hira_consent?: boolean | null } | null;
      setChartNumber(custData?.chart_number ?? customerMode.chartNumber ?? null);
      setCustomerMemo(custData?.customer_memo ?? '');
      setVisitRoute(custData?.visit_route ?? '');
      setEtcMemo(custData?.memo ?? '');
      setHiraConsent(custData?.hira_consent ?? false);
      const latestResvData = latestResvRes.data as { id: string; booking_memo: string | null } | null;
      setLatestResvId(latestResvData?.id ?? null);
      setBookingMemo(latestResvData?.booking_memo ?? '');
      setStaffList((staffRes.data ?? []) as Array<{ id: string; name: string; role: string }>);
      const latestCi = (latestCiRes.data as CheckIn | null) ?? null;
      setLatestCheckIn(latestCi);
      // T-20260511-foot-CUSTMGMT-DETAIL-SHEET 3차: doctorNote 초기화 (편집 가능)
      setDoctorNote(latestCi?.doctor_note ?? '');
      const remMap = new Map<string, PackageRemaining>();
      await Promise.all(
        pkgs.map(async (p) => {
          const { data } = await supabase.rpc('get_package_remaining', { p_package_id: p.id });
          if (data) remMap.set(p.id, data as PackageRemaining);
        }),
      );
      setPkgRemaining(remMap);
      return;
    }

    // TypeScript narrowing: 이 아래부터 checkIn은 반드시 non-null
    if (!checkIn) return;

    const [svcRes, payRes, histRes, pkgRes, custRes, staffRes, resvRes] = await Promise.all([
      supabase
        .from('services')
        .select('*')
        .eq('clinic_id', checkIn.clinic_id)
        .eq('active', true)
        .order('sort_order'),
      supabase
        .from('payments')
        .select('id, amount, method, installment, payment_type, created_at, status, check_in_id, clinic_id')
        .eq('check_in_id', checkIn.id)
        .neq('status', 'deleted'),
      checkIn.customer_id
        ? supabase
            .from('check_ins')
            .select('id, checked_in_at, status, visit_type, doctor_note, treatment_memo, notes')
            .eq('customer_id', checkIn.customer_id)
            .neq('id', checkIn.id)
            .order('checked_in_at', { ascending: false })
            .limit(10)
        : Promise.resolve({ data: [] }),
      checkIn.customer_id
        ? supabase
            .from('packages')
            .select('*')
            .eq('customer_id', checkIn.customer_id)
            .eq('status', 'active')
            .order('contract_date', { ascending: false })
        : Promise.resolve({ data: [] }),
      // T-20260504-foot-CHART-UI-BADGE, T-20260504-foot-MEMO-RESTRUCTURE, T-20260506-foot-CHART-LINK-SYNC
      // 고객 차트번호·메모 조회: 1순위 customer_id, 2순위 phone 기반 (환자명 불일치 허용)
      checkIn.customer_id
        ? supabase
            .from('customers')
            .select('id, chart_number, customer_memo, visit_route, memo, hira_consent')
            .eq('id', checkIn.customer_id)
            .single()
        : checkIn.customer_phone
          ? supabase
              .from('customers')
              .select('id, chart_number, customer_memo, visit_route, memo, hira_consent')
              .eq('clinic_id', checkIn.clinic_id)
              .ilike('phone', `%${checkIn.customer_phone.replace(/\D/g, '')}%`)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle()
          : Promise.resolve({ data: null }),
      // 담당실장 드롭다운용 스태프 목록 — 실장(상담실장) 역할만 (T-20260506 항목8)
      supabase
        .from('staff')
        .select('id, name, role')
        .eq('clinic_id', checkIn.clinic_id)
        .eq('active', true)
        .in('role', ['consultant'])
        .order('name'),
      // T-20260512-foot-C1-VISIT-ROUTE-MEMO-V3: 예약메모 — reservation_id 우선, 없으면 최근 예약
      checkIn.reservation_id
        ? supabase
            .from('reservations')
            .select('id, booking_memo')
            .eq('id', checkIn.reservation_id)
            .single()
        : checkIn.customer_id
          ? supabase
              .from('reservations')
              .select('id, booking_memo')
              .eq('customer_id', checkIn.customer_id)
              .order('reservation_date', { ascending: false })
              .limit(1)
              .maybeSingle()
          : Promise.resolve({ data: null }),
    ]);

    setServices((svcRes.data ?? []) as Service[]);
    setPayments((payRes.data ?? []) as PaymentRow[]);
    setHistory((histRes.data ?? []) as VisitHistory[]);
    const custData = custRes.data as { id?: string; chart_number: string | null; customer_memo: string | null; visit_route?: string | null; memo?: string | null; hira_consent?: boolean | null } | null;
    setChartNumber(custData?.chart_number ?? null);
    setCustomerMemo(custData?.customer_memo ?? '');
    setVisitRoute(custData?.visit_route ?? '');
    setEtcMemo(custData?.memo ?? '');
    setHiraConsent(custData?.hira_consent ?? false);
    // T-20260506-foot-CHART-LINK-SYNC: customer_id null 케이스 — phone으로 찾은 고객 ID 2순위 저장
    if (!checkIn.customer_id && custData?.id) {
      setResolvedCustomerId(custData.id);
    }
    // T-20260512-foot-C1-VISIT-ROUTE-MEMO-V3: 예약메모 — reservation 로드
    const resvData = resvRes.data as { id: string; booking_memo: string | null } | null;
    setLatestResvId(resvData?.id ?? null);
    setBookingMemo(resvData?.booking_memo ?? '');
    setStaffList((staffRes.data ?? []) as Array<{ id: string; name: string; role: string }>);
    const pkgs = (pkgRes.data ?? []) as PackageType[];
    setPackages(pkgs);

    const remMap = new Map<string, PackageRemaining>();
    await Promise.all(
      pkgs.map(async (p) => {
        const { data } = await supabase.rpc('get_package_remaining', { p_package_id: p.id });
        if (data) remMap.set(p.id, data as PackageRemaining);
      }),
    );
    setPkgRemaining(remMap);

    const noteObj = checkIn.notes as Record<string, string> | null;
    setNotes(noteObj?.text ?? '');
    setTreatmentMemo(checkIn.treatment_memo?.details ?? '');
    setDoctorNote(checkIn.doctor_note ?? '');

    // T-20260513-foot-C1-SPACE-ASSIGN-RESTORE: 공간배정 이동이력 + rooms 목록 로드
    const [roomsRes] = await Promise.all([
      supabase
        .from('rooms')
        .select('*')
        .eq('clinic_id', checkIn.clinic_id)
        .eq('active', true)
        .order('sort_order', { ascending: true }),
    ]);
    setRooms((roomsRes.data ?? []) as Room[]);

    // 이동이력 로드 — 테이블 미존재 시 graceful skip
    try {
      const { data: logsData } = await supabase
        .from('check_in_room_logs')
        .select('id, check_in_id, assigned_room, room_type, logged_at')
        .eq('check_in_id', checkIn.id)
        .order('logged_at', { ascending: true });
      setRoomLogs((logsData ?? []) as RoomLog[]);
    } catch {
      setRoomLogs([]);
    }

    // 현재 배정된 공간을 드롭다운 초기값으로 설정
    const cur =
      checkIn.examination_room ??
      checkIn.consultation_room ??
      checkIn.treatment_room ??
      checkIn.laser_room ??
      '';
    setSelectedRoom(cur);
  }, [checkIn, customerMode]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load();
  }, [load]);

  // AC-8 쌍방연동 — 2번차트(CustomerChartPage)가 저장하면 이쪽도 즉시 반영
  useEffect(() => {
    const myCustomerId = () => checkIn?.customer_id ?? resolvedCustomerId ?? customerMode?.customerId;
    const handler = (e: StorageEvent) => {
      if (e.key !== 'foot_crm_customer_refresh' || !e.newValue) return;
      try {
        const { customerId: changedId } = JSON.parse(e.newValue) as { customerId: string };
        if (myCustomerId() && changedId === myCustomerId()) load();
      } catch { /* ignore */ }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, [checkIn?.customer_id, resolvedCustomerId, customerMode?.customerId, load]);

  const deleteCheckIn = async () => {
    if (!checkIn) return;
    if (!window.confirm('체크인을 삭제하시겠습니까?\n결제 데이터가 없을 때만 삭제됩니다.')) return;
    const { count } = await supabase
      .from('payments')
      .select('id', { count: 'exact', head: true })
      .eq('check_in_id', checkIn.id);
    if ((count ?? 0) > 0) {
      toast.error(`결제 데이터가 있어 삭제할 수 없습니다 (${count}건). 결제를 먼저 취소하세요.`);
      return;
    }
    const { error } = await supabase.from('check_ins').delete().eq('id', checkIn.id);
    if (error) { toast.error(`삭제 실패: ${error.message}`); return; }
    toast.success('체크인 삭제됨');
    onClose();
    onUpdated();
  };

  const saveNotes = async () => {
    if (!checkIn) return;
    setSaving(true);
    const notesObj = { ...(checkIn.notes as Record<string, unknown> ?? {}), text: notes };
    const memoObj = { ...(checkIn.treatment_memo ?? {}), details: treatmentMemo };
    const { error } = await supabase
      .from('check_ins')
      .update({
        notes: notesObj,
        treatment_memo: memoObj,
        doctor_note: doctorNote || null,
        // 진료종류 필드 저장 (T-20260430-foot-TREATMENT-LABEL) — DB 호환성 유지
        consultation_done: consultationDone,
        treatment_kind: treatmentKind || null,
        preconditioning_done: preconditioningDone,
        pododulle_done: pododulleDone,
        laser_minutes: laserMinutes,
        // 진료 기록 간소화 필드 (T-20260504-foot-TREATMENT-SIMPLIFY)
        assigned_counselor_id: assignedCounselorId || null,
        treatment_category: treatmentCategory || null,
        treatment_contents: treatmentContents.length > 0 ? treatmentContents : null,
      })
      .eq('id', checkIn.id);
    setSaving(false);
    if (error) {
      toast.error('저장 실패');
      return;
    }
    toast.success('메모 저장됨');
    setIsDirty(false);
    onUpdated();
  };

  // T-20260513-foot-C1-SPACE-ASSIGN-RESTORE: 공간 배정 함수
  const assignRoom = async (roomName: string) => {
    if (!checkIn || !roomName) return;
    const field = getRoomField(roomName);
    const roomType = getRoomType(roomName);
    if (!field || !roomType) return;

    // 중복 방지: 오늘 이동이력 중 마지막과 동일 공간이면 무시
    const todayLogs = roomLogs.filter((l) => logDateStr(l.logged_at) === todaySeoulStr());
    const lastLog = todayLogs[todayLogs.length - 1];
    if (lastLog?.assigned_room === roomName) {
      toast('이미 해당 공간에 배정되어 있어요');
      return;
    }

    setAssigningRoom(true);
    try {
      // check_ins 업데이트 — 다른 방 필드 초기화 (현재 방만 유지)
      const patch: Record<string, string | null> = {
        examination_room: null,
        consultation_room: null,
        treatment_room: null,
        laser_room: null,
        [field]: roomName,
      };
      const { error: ciErr } = await supabase
        .from('check_ins')
        .update(patch)
        .eq('id', checkIn.id);
      if (ciErr) { toast.error('배정 실패: ' + ciErr.message); return; }

      // 이동이력 기록 (table이 없으면 graceful skip)
      const logEntry: RoomLog = {
        id: crypto.randomUUID(),
        check_in_id: checkIn.id,
        assigned_room: roomName,
        room_type: roomType,
        logged_at: new Date().toISOString(),
      };
      // 이동이력 기록 — 테이블 미존재 시 로컬 상태로 폴백 (graceful)
      let inserted: RoomLog | null = null;
      try {
        const { data } = await supabase
          .from('check_in_room_logs')
          .insert({
            check_in_id: checkIn.id,
            clinic_id: checkIn.clinic_id,
            assigned_room: roomName,
            room_type: roomType,
          })
          .select('id, check_in_id, assigned_room, room_type, logged_at')
          .single();
        inserted = data as RoomLog | null;
      } catch {
        // table not yet created — use local fallback
      }
      setRoomLogs((prev) => [...prev, inserted ?? logEntry]);
      setSelectedRoom(roomName);
      toast.success(`${roomName} 배정됨`);
      onUpdated();
    } finally {
      setAssigningRoom(false);
    }
  };

  // T-20260511-foot-CUSTMGMT-DETAIL-SHEET 3차: customerMode 원장 소견 저장 (latestCheckIn 대상)
  const saveCustomerModeDoctorNote = async () => {
    if (!latestCheckIn) return;
    setSaving(true);
    const { error } = await supabase
      .from('check_ins')
      .update({ doctor_note: doctorNote || null })
      .eq('id', latestCheckIn.id);
    setSaving(false);
    if (error) { toast.error('소견 저장 실패: ' + error.message); return; }
    toast.success('소견이 저장되었습니다');
    setLatestCheckIn((prev) => prev ? { ...prev, doctor_note: doctorNote || null } : prev);
  };

  // T-20260513-foot-C1-SPACE-ASSIGN-RESTORE: 오늘 이동이력 (연속 중복 제거 + 날짜 필터)
  const todayRoomLogs = useMemo(() => {
    const today = todaySeoulStr();
    const todayFiltered = roomLogs.filter((l) => logDateStr(l.logged_at) === today);
    // 연속 중복만 제거: 치료실→상담실→치료실→상담실 순서도 전부 표시
    return todayFiltered.filter((l, idx, arr) => {
      if (idx === 0) return true;
      return arr[idx - 1].assigned_room !== l.assigned_room;
    });
  }, [roomLogs]);

  // 공간 드롭다운 옵션 (rooms 테이블 기반)
  const roomOptions = useMemo<string[]>(() => rooms.map((r) => r.name), [rooms]);

  // T-20260511-foot-C1-SAVE-DIRTY-AUTOSAVE: stale closure 방지용 ref (항상 최신 함수 참조)
  const saveNotesRef = useRef(saveNotes);
  saveNotesRef.current = saveNotes;

  // T-20260511-foot-C1-SAVE-DIRTY-AUTOSAVE: isDirty=true 시 30초 자동저장 (현장 확정: 1번차트 30초)
  useEffect(() => {
    if (!isDirty) return;
    const id = setInterval(async () => {
      await saveNotesRef.current();
      setShowAutoSaved(true);
      setTimeout(() => setShowAutoSaved(false), 2500);
    }, 30000);
    return () => clearInterval(id);
  }, [isDirty]); // eslint-disable-line react-hooks/exhaustive-deps

  // T-20260506-foot-CHART-LINK-SYNC: 3순위 fallback — 실시간 phone 조회 (로드 타임 조회 실패 재시도)
  // phone 정규화(digits-only) + ilike 매칭으로 포맷 차이(010-XXXX vs +8210XXXX) 허용
  const openChartFallback = async () => {
    if (!checkIn?.customer_phone) {
      toast.error('고객 연락처 정보가 없습니다');
      return;
    }
    const phoneDigits = checkIn.customer_phone.replace(/\D/g, '');
    if (phoneDigits.length < 4) {
      toast.error('연락처가 너무 짧습니다');
      return;
    }
    const { data } = await supabase
      .from('customers')
      .select('id, name, chart_number')
      .eq('clinic_id', checkIn.clinic_id)
      .ilike('phone', `%${phoneDigits}%`)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) {
      toast.error('고객 정보를 찾을 수 없습니다 — 데스크에 문의하세요');
      return;
    }
    // T-20260514-foot-CHART-EXPAND-UX: window.open → 슬라이드 패널
    setChartSheetId(data.id);
  };

  // T-20260510-foot-C1-VISIT-ROUTE-MEMO: 방문경로 저장
  // T-20260511-foot-CUSTMGMT-DETAIL-SHEET: customerMode fallback 추가
  const saveVisitRoute = async (val: string) => {
    const customerId = checkIn?.customer_id ?? resolvedCustomerId ?? customerMode?.customerId;
    if (!customerId) return;
    await supabase.from('customers').update({ visit_route: val || null }).eq('id', customerId);
    // AC-8 쌍방연동 — 2번차트에 변경 알림
    localStorage.setItem('foot_crm_customer_refresh', JSON.stringify({ customerId, ts: Date.now() }));
  };

  // T-20260504-foot-MEMO-RESTRUCTURE: 고객메모 저장
  // T-20260511-foot-CUSTMGMT-DETAIL-SHEET: customerMode fallback 추가
  const saveCustomerMemo = async () => {
    const customerId = checkIn?.customer_id ?? customerMode?.customerId;
    if (!customerId) return;
    setSavingCustomerMemo(true);
    const { error } = await supabase
      .from('customers')
      .update({ customer_memo: customerMemo.trim() || null })
      .eq('id', customerId);
    setSavingCustomerMemo(false);
    if (error) { toast.error('고객메모 저장 실패'); return; }
    toast.success('고객메모 저장됨');
    // AC-8 쌍방연동 — 2번차트에 변경 알림
    const customerId2 = checkIn?.customer_id ?? customerMode?.customerId;
    if (customerId2) localStorage.setItem('foot_crm_customer_refresh', JSON.stringify({ customerId: customerId2, ts: Date.now() }));
  };

  // T-20260512-foot-C1-VISIT-ROUTE-MEMO-V3: 예약메모 저장 (reservations.booking_memo)
  const saveBookingMemo = async () => {
    if (!latestResvId) { toast.error('연결된 예약이 없습니다'); return; }
    setSavingBookingMemo(true);
    const { error } = await supabase
      .from('reservations')
      .update({ booking_memo: bookingMemo.trim() || null })
      .eq('id', latestResvId);
    setSavingBookingMemo(false);
    if (error) { toast.error('예약메모 저장 실패'); return; }
    toast.success('예약메모 저장됨');
    const customerId3 = checkIn?.customer_id ?? resolvedCustomerId ?? customerMode?.customerId;
    if (customerId3) localStorage.setItem('foot_crm_customer_refresh', JSON.stringify({ customerId: customerId3, ts: Date.now() }));
  };

  // T-20260512-foot-C1-VISIT-ROUTE-MEMO-V3: 기타메모 저장 (customers.memo)
  const saveEtcMemo = async () => {
    const customerId = checkIn?.customer_id ?? resolvedCustomerId ?? customerMode?.customerId;
    if (!customerId) return;
    setSavingEtcMemo(true);
    const { error } = await supabase
      .from('customers')
      .update({ memo: etcMemo.trim() || null })
      .eq('id', customerId);
    setSavingEtcMemo(false);
    if (error) { toast.error('기타메모 저장 실패'); return; }
    toast.success('기타메모 저장됨');
    localStorage.setItem('foot_crm_customer_refresh', JSON.stringify({ customerId, ts: Date.now() }));
  };

  const totalPaid = payments
    .filter((p) => p.payment_type === 'payment')
    .reduce((s, p) => s + p.amount, 0);

  // ── T-20260511-foot-CUSTMGMT-DETAIL-SHEET: customer_id 기반 뷰 (체크인 없는 고객관리 모드) ──
  if (!checkIn && customerMode) {
    const effectiveChartNumber = chartNumber ?? customerMode.chartNumber;
    return (
      <Sheet open={true} onOpenChange={(o) => !o && onClose()}>
        <SheetContent className="w-[400px] sm:w-[440px] max-h-screen overflow-y-auto">
          <SheetHeader>
            <div className="flex items-center justify-between gap-2">
              <SheetTitle className="flex items-center gap-2 flex-1 flex-wrap">
                {customerMode.customerName}
              </SheetTitle>
              {/* T-20260514-foot-CHART-EXPAND-UX: window.open → 슬라이드 패널 */}
              <Button
                size="sm"
                className="gap-1 h-8 text-xs bg-teal-600 hover:bg-teal-700 shrink-0"
                onClick={() => setChartSheetId(customerMode.customerId)}
              >
                <ExternalLink className="h-3.5 w-3.5" />
                고객차트(2번)
              </Button>
            </div>
          </SheetHeader>

          <div className="mt-4 space-y-4">
            {/* 차트번호 */}
            {effectiveChartNumber && (
              <div className="text-sm font-semibold text-teal-700">{effectiveChartNumber}</div>
            )}
            {/* 연락처 */}
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <Phone className="h-3.5 w-3.5" />
              {formatPhone(customerMode.customerPhone)}
            </div>

            {/* AC9: 접수 상태 표시 — 항상 표시 (T-20260511-CUSTMGMT 3차) */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-muted-foreground">최근 접수</span>
              {latestCheckIn ? (
                <>
                  <Badge variant="outline" className="text-xs">
                    {STATUS_KO[latestCheckIn.status as keyof typeof STATUS_KO] ?? latestCheckIn.status}
                  </Badge>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {format(new Date(latestCheckIn.checked_in_at), 'MM/dd HH:mm')}
                  </span>
                  {latestCheckIn.visit_type === 'new' ? (
                    <span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold bg-blue-100 text-blue-700">초진</span>
                  ) : (
                    <span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold bg-emerald-100 text-emerald-700">재진</span>
                  )}
                </>
              ) : (
                <span className="text-xs text-muted-foreground italic">방문 이력 없음</span>
              )}
            </div>

            {/* T-20260512-foot-C1-VISIT-ROUTE-MEMO-V3: 방문경로/예약메모/고객메모/기타메모 4항목 */}
            <Separator />
            <div className="space-y-3">
              {/* ① 방문경로 */}
              <div className="flex items-center gap-2">
                <Label className="text-xs font-semibold text-teal-700 shrink-0">방문경로</Label>
                <select
                  value={visitRoute}
                  onChange={(e) => {
                    setVisitRoute(e.target.value);
                    saveVisitRoute(e.target.value);
                  }}
                  className="rounded border border-gray-300 px-2 py-0.5 text-xs cursor-pointer focus:outline-none focus:border-teal-500 bg-white hover:border-teal-400 transition"
                >
                  <option value="">— 선택 —</option>
                  <option value="TM">TM</option>
                  <option value="인바운드">인바운드</option>
                  <option value="워크인">워크인</option>
                  <option value="지인소개">지인소개</option>
                </select>
              </div>
              {/* ② 예약메모 (reservations.booking_memo) — AC-5 복구 */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-teal-700 flex items-center gap-1">
                  <FileText className="h-3 w-3" /> 예약메모
                </Label>
                <Textarea
                  value={bookingMemo}
                  onChange={(e) => setBookingMemo(e.target.value)}
                  placeholder="예약 관련 메모"
                  rows={2}
                  className="text-xs"
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs w-full border-teal-300 text-teal-700 hover:bg-teal-50"
                  onClick={saveBookingMemo}
                  disabled={savingBookingMemo}
                >
                  {savingBookingMemo ? '저장 중…' : '예약메모 저장'}
                </Button>
              </div>
              {/* ③ 고객메모 (customers.customer_memo) — AC-6 추가 */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-teal-700 flex items-center gap-1">
                  <FileText className="h-3 w-3" /> 고객메모
                </Label>
                <Textarea
                  value={customerMemo}
                  onChange={(e) => setCustomerMemo(e.target.value)}
                  placeholder="고객 성향, 특이사항, 주차 정보 등"
                  rows={2}
                  className="text-xs"
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs w-full border-teal-300 text-teal-700 hover:bg-teal-50"
                  onClick={saveCustomerMemo}
                  disabled={savingCustomerMemo}
                >
                  {savingCustomerMemo ? '저장 중…' : '고객메모 저장'}
                </Button>
              </div>
              {/* ④ 기타메모 (customers.memo) — AC-6 추가 */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-teal-700 flex items-center gap-1">
                  <FileText className="h-3 w-3" /> 기타메모
                </Label>
                <Textarea
                  value={etcMemo}
                  onChange={(e) => setEtcMemo(e.target.value)}
                  placeholder="기타 참고사항"
                  rows={2}
                  className="text-xs"
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs w-full border-teal-300 text-teal-700 hover:bg-teal-50"
                  onClick={saveEtcMemo}
                  disabled={savingEtcMemo}
                >
                  {savingEtcMemo ? '저장 중…' : '기타메모 저장'}
                </Button>
              </div>
            </div>

            {/* 체크리스트 / 동의서 */}
            <Separator />
            <div className="space-y-2">
              <span className="text-sm font-semibold text-muted-foreground">체크리스트 / 동의서</span>
              <div className="space-y-1.5 pt-1">
                <div className="flex flex-wrap gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 text-xs gap-1 border-teal-300 text-teal-700 hover:bg-teal-50"
                    onClick={() => setTabletChecklistOpen(true)}
                  >
                    📝 사전 체크리스트 & 개인정보
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 text-xs gap-1 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                    onClick={() => setTabletConsentOpen(true)}
                  >
                    📝 환불 & 비급여 동의서
                  </Button>
                </div>
                <DocumentViewer
                  key={docRefreshKey}
                  customerId={customerMode.customerId}
                  compact
                />
              </div>
            </div>

            {/* 패키지 잔여회차 요약 */}
            {packages.length > 0 && (
              <>
                <Separator />
                <ActivePackageSummary packages={packages} pkgRemaining={pkgRemaining} />
              </>
            )}

            {/* 패키지 상세 목록 */}
            <Separator />
            <div className="space-y-2">
              <span className="text-sm font-semibold text-muted-foreground flex items-center gap-1">
                <Package className="h-3 w-3" /> 패키지
              </span>
              {packages.length > 0 ? (
                <div className="space-y-1.5">
                  {packages.map((pkg) => {
                    const rem = pkgRemaining.get(pkg.id);
                    const usedPct =
                      rem && pkg.total_sessions > 0
                        ? Math.round((rem.total_used / pkg.total_sessions) * 100)
                        : 0;
                    return (
                      <div
                        key={pkg.id}
                        className="rounded-lg border p-2 text-xs space-y-1 border-input"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold">{pkg.package_name}</span>
                          <Badge variant="outline" className="text-xs">
                            {formatAmount(pkg.total_amount)}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>가열 {rem?.heated ?? pkg.heated_sessions}</span>
                          <span>비가열 {rem?.unheated ?? pkg.unheated_sessions}</span>
                          <span>수액 {rem?.iv ?? pkg.iv_sessions}</span>
                          <span>사전처치 {rem?.preconditioning ?? pkg.preconditioning_sessions}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 rounded-full bg-gray-200 overflow-hidden">
                            <div
                              className="h-full bg-teal-500 rounded-full"
                              style={{ width: `${Math.min(usedPct, 100)}%` }}
                            />
                          </div>
                          <span className="text-xs text-muted-foreground">{usedPct}%</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">활성 패키지 없음</p>
              )}
            </div>

            {/* AC6: 원장 소견 / 의사 진료 패널 — T-20260511-CUSTMGMT 3차 (편집 가능 + DoctorTreatmentPanel) */}
            <Separator />
            {latestCheckIn && (latestCheckIn.status === 'examination' || latestCheckIn.status === 'exam_waiting') ? (
              <div className="space-y-3 rounded-md p-3 bg-violet-50 ring-2 ring-violet-300">
                <Label className="text-sm font-semibold text-violet-900 flex items-center gap-1">
                  <Stethoscope className="h-3 w-3" /> 의사 진료 패널
                  <span className="ml-auto text-xs font-normal text-violet-700/80">진료 중</span>
                </Label>
                <DoctorTreatmentPanel
                  checkInId={latestCheckIn.id}
                  visitType={latestCheckIn.visit_type as VisitType}
                  hasHealerLaser={false}
                  onUpdated={onUpdated}
                />
              </div>
            ) : (
              <div className="space-y-2 rounded-md p-3 bg-violet-50/40 ring-1 ring-violet-100">
                <Label className="text-sm font-semibold text-violet-900 flex items-center gap-1">
                  <Stethoscope className="h-3 w-3" /> 원장 소견
                  <span className="ml-auto text-xs font-normal text-violet-700/80">
                    {latestCheckIn ? format(new Date(latestCheckIn.checked_in_at), 'MM/dd') + ' 방문 기준' : '최근 방문 없음'}
                  </span>
                </Label>
                <Textarea
                  value={doctorNote}
                  onChange={(e) => setDoctorNote(e.target.value)}
                  placeholder={latestCheckIn ? '원장 소견을 입력하세요' : '방문 이력이 없어 소견 입력 불가'}
                  rows={3}
                  disabled={!latestCheckIn}
                  className="text-sm bg-white border-violet-200 focus-visible:ring-violet-400"
                />
                {latestCheckIn && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs w-full border-violet-300 text-violet-700 hover:bg-violet-50"
                    onClick={saveCustomerModeDoctorNote}
                    disabled={saving}
                  >
                    {saving ? '저장 중…' : '소견 저장'}
                  </Button>
                )}
              </div>
            )}

            {/* AC8: 시술 항목 관리 / 패키지 회차 차감 — 항상 표시 (T-20260511-CUSTMGMT 3차) */}
            <Separator />
            <div className="space-y-2">
              <span className="text-sm font-semibold text-muted-foreground flex items-center gap-1">
                <Package className="h-3 w-3" /> 시술 항목 관리
              </span>
              {packages.some((p) => (pkgRemaining.get(p.id)?.total_remaining ?? 0) > 0) ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full gap-2 border-teal-400 text-teal-700 hover:bg-teal-50 h-10"
                  onClick={() => {
                    const pkg = packages.find((p) => {
                      const rem = pkgRemaining.get(p.id);
                      return rem && rem.total_remaining > 0;
                    });
                    if (!pkg) { toast.error('잔여 회차가 없습니다'); return; }
                    const rem = pkgRemaining.get(pkg.id)!;
                    const firstType = (
                      ['unheated_laser', 'heated_laser', 'iv', 'preconditioning'] as const
                    ).find((t) => (rem[SESSION_TYPE_TO_REM_KEY[t]] as number) > 0) ?? ('unheated_laser' as SessionType);
                    setSessionUsePkg(pkg);
                    setSessionUseRemaining(rem);
                    setSessionUseType(firstType);
                    setSessionUseTreatmentIdx(-1);
                    setSessionUseOpen(true);
                  }}
                >
                  <Package className="h-3.5 w-3.5" /> 패키지 회차 차감
                </Button>
              ) : (
                <p className="text-xs text-muted-foreground">잔여 회차 없음 (패키지 등록 후 이용 가능)</p>
              )}
            </div>

            {/* T-20260515-foot-KENBO-API-NATIVE: 건보공단 수진자 자격조회 (customerMode) */}
            <Separator />
            <NhisLookupPanel
              customerId={customerMode.customerId}
              clinicId={customerMode.clinicId}
              hiraConsent={hiraConsent}
              onGradeUpdated={load}
            />

            {/* AC7: 보험 영수증 / 처방전 — 항상 표시 (T-20260511-CUSTMGMT 3차) */}
            <Separator />
            {latestCheckIn ? (
              <InsuranceDocPanel checkIn={latestCheckIn} onUpdated={onUpdated} />
            ) : (
              <div className="text-xs text-muted-foreground py-1 flex items-center gap-1">
                <FileText className="h-3 w-3" /> 방문 이력이 없어 서류 업로드 불가
              </div>
            )}

            {/* AC7: 서류 발행 (실손 보험 서류 + 인쇄) — 항상 표시 (T-20260511-CUSTMGMT 3차) */}
            <Separator />
            {latestCheckIn ? (
              <DocumentPrintPanel checkIn={latestCheckIn} onUpdated={onUpdated} />
            ) : (
              <div className="text-xs text-muted-foreground py-1 flex items-center gap-1">
                <FileText className="h-3 w-3" /> 방문 이력이 없어 서류 발행 불가
              </div>
            )}

            {/* 방문 이력 */}
            {history.length > 0 && (
              <>
                <Separator />
                <VisitHistoryAccordion history={history} />
              </>
            )}
          </div>

          {/* 태블릿 양식 모달 */}
          <ChecklistForm
            open={tabletChecklistOpen}
            onOpenChange={setTabletChecklistOpen}
            customerId={customerMode.customerId}
            defaultName={customerMode.customerName}
            defaultPhone={customerMode.customerPhone}
            onSaved={() => {
              setDocRefreshKey((k) => k + 1);
              onUpdated();
            }}
          />
          <ConsentForm
            open={tabletConsentOpen}
            onOpenChange={setTabletConsentOpen}
            customerId={customerMode.customerId}
            defaultName={customerMode.customerName}
            onSaved={() => {
              setDocRefreshKey((k) => k + 1);
              onUpdated();
            }}
          />
          {/* AC8: 패키지 회차 사용 다이얼로그 (customerMode) — T-20260512-foot-CUSTMGMT-AC6-AC9 */}
          <SessionUseInSheetDialog
            open={sessionUseOpen}
            pkg={sessionUsePkg}
            remaining={sessionUseRemaining}
            defaultSessionType={sessionUseType}
            onOpenChange={setSessionUseOpen}
            onDone={() => {
              setSessionUseOpen(false);
              load();
            }}
          />
          {/* T-20260514-foot-CHART2-OPEN-BUG v2 fix: createPortal 방식 — nested dialog 독립 */}
          <CustomerChartSheet
            customerId={chartSheetId}
            onClose={() => setChartSheetId(null)}
          />
        </SheetContent>
      </Sheet>
    );
  }

  if (!checkIn) return null;

  const mins = Math.floor((Date.now() - new Date(checkIn.checked_in_at).getTime()) / 60000);

  // ── 시술 항목 헬퍼 ──
  const addTreatmentItem = (svc: Service) => {
    const item: TreatmentItem = {
      _id: `${svc.id}-${Date.now()}`,
      service: svc,
      sessionType: sessionTypeFromService(svc),
      settled: false,
    };
    setTreatmentItems((prev) => [...prev, item]);
  };

  const markSettled = (idx: number) => {
    setTreatmentItems((prev) =>
      prev.map((item, i) => (i === idx ? { ...item, settled: true } : item)),
    );
  };

  // ── Stage 감지 (4/30 표준 v2 기준) ──
  const isConsultStage =
    checkIn.status === 'consultation' || checkIn.status === 'consult_waiting';
  const isDeskStage = checkIn.status === 'payment_waiting';

  /**
   * 데스크 통합 메뉴에서 "패키지 회차 차감" 클릭 시:
   * 잔여 회차가 있는 첫 번째 패키지를 자동 선택해 SessionUseInSheetDialog 오픈.
   */
  const openBestFitSessionUse = () => {
    const pkg = packages.find((p) => {
      const rem = pkgRemaining.get(p.id);
      return rem && rem.total_remaining > 0;
    });
    if (!pkg) {
      toast.error('잔여 회차가 없습니다');
      return;
    }
    const rem = pkgRemaining.get(pkg.id)!;
    const firstType = (
      ['unheated_laser', 'heated_laser', 'iv', 'preconditioning'] as const
    ).find((t) => (rem[SESSION_TYPE_TO_REM_KEY[t]] as number) > 0) ?? ('unheated_laser' as SessionType);
    setSessionUsePkg(pkg);
    setSessionUseRemaining(rem);
    setSessionUseType(firstType);
    setSessionUseTreatmentIdx(-1); // 데스크 메뉴 진입: 특정 시술 항목과 연결하지 않음
    setSessionUseOpen(true);
  };

  return (
    <Sheet open={!!checkIn} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-[400px] sm:w-[440px] max-h-screen overflow-y-auto">
        <SheetHeader>
          <div className="flex items-center justify-between gap-2">
            <SheetTitle className="flex items-center gap-2 flex-1 flex-wrap">
              {checkIn.queue_number != null && (
                <span className="text-teal-700">#{checkIn.queue_number}</span>
              )}
              {checkIn.customer_name}
              {/* 초진/재진/체험 배지 — 성함 옆 상단 배치 (T-20260506 항목1) */}
              {checkIn.visit_type === 'new' ? (
                <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold bg-blue-100 text-blue-700 shrink-0">
                  초진
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold bg-emerald-100 text-emerald-700 shrink-0">
                  재진
                </span>
              )}
            </SheetTitle>
            {isAdmin && (
              <button
                onClick={deleteCheckIn}
                className="rounded p-1.5 hover:bg-red-50 transition shrink-0"
                title="체크인 삭제 (관리자)"
              >
                <Trash2 className="h-4 w-4 text-red-400" />
              </button>
            )}
          </div>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          {/* 기본 정보 — 방문유형·상태 배지는 성함 옆으로 이동 (T-20260506 항목1) / 우선순위·신분증만 표시 */}
          {(checkIn.priority_flag || checkIn.notes?.id_check_required) && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {checkIn.priority_flag && (
                <Badge variant="destructive">{checkIn.priority_flag}</Badge>
              )}
              {checkIn.notes?.id_check_required && (
                <button
                  title="클릭하면 신분증 확인 완료 처리"
                  onClick={async () => {
                    const newNotes = {
                      ...(checkIn.notes as Record<string, unknown> ?? {}),
                      id_check_required: false,
                    };
                    const { error } = await supabase
                      .from('check_ins')
                      .update({ notes: newNotes })
                      .eq('id', checkIn.id);
                    if (!error) {
                      toast.success('신분증 확인 완료');
                      onUpdated();
                    } else {
                      toast.error('업데이트 실패');
                    }
                  }}
                  className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold transition hover:opacity-80 active:scale-95 cursor-pointer"
                  style={{
                    backgroundColor: '#FEE2E2',
                    color: '#B91C1C',
                    border: '1.5px solid #FECACA',
                  }}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-red-500 inline-block animate-pulse" />
                  신분증 확인 필요 · 탭하여 해제
                </button>
              )}
            </div>
          )}

          {/* 차트번호 — 단독 배치, 괄호 없음 (T-20260506 항목2) */}
          {chartNumber && (
            <div className="text-sm font-semibold text-teal-700">{chartNumber}</div>
          )}
          {/* 연락처 / 접수시간 — 한 줄 배치 (T-20260506 항목3) */}
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted-foreground">
            {checkIn.customer_phone && (
              <>
                <span className="flex items-center gap-1">
                  <Phone className="h-3.5 w-3.5" />
                  {formatPhone(checkIn.customer_phone)}
                </span>
                <span className="text-muted-foreground/60">/</span>
              </>
            )}
            <span className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              {format(new Date(checkIn.checked_in_at), 'HH:mm')} 접수
              <span className={cn(mins >= 30 && 'text-red-600 font-semibold')}>
                ({mins}분)
              </span>
            </span>
          </div>

          {/* T-20260515-foot-MEDICAL-CHART-V1 AC-7: [고객차트] [진료차트] 버튼 나란히 */}
          {/* 식별 우선순위: 1순위 customer_id → 2순위 resolvedCustomerId(phone 기반) → 3순위 실시간 조회 */}
          {(checkIn.customer_id || resolvedCustomerId || checkIn.customer_phone) && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1 gap-2 border-teal-400 text-teal-700 hover:bg-teal-50 text-sm h-11"
                onClick={() => {
                  // T-20260514-foot-CHART-EXPAND-UX: window.open → 슬라이드 패널
                  if (checkIn.customer_id) {
                    // 1순위: customer_id FK 직접 참조 (가장 확실)
                    setChartSheetId(checkIn.customer_id);
                  } else if (resolvedCustomerId) {
                    // 2순위: chart_number + phone 일치로 조회된 고객 ID (환자명 불일치 허용)
                    setChartSheetId(resolvedCustomerId);
                  } else {
                    // 3순위: phone 기반 실시간 조회 (로드 타임 조회 실패 시 재시도)
                    openChartFallback();
                  }
                }}
              >
                <ExternalLink className="h-4 w-4" />
                고객차트
              </Button>
              {onOpenMedicalChart && (checkIn.customer_id || resolvedCustomerId) && (
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 gap-2 border-emerald-400 text-emerald-700 hover:bg-emerald-50 text-sm h-11"
                  onClick={() => {
                    const cid = checkIn.customer_id || resolvedCustomerId;
                    if (cid) onOpenMedicalChart(cid);
                  }}
                >
                  <Stethoscope className="h-4 w-4" />
                  진료차트
                </Button>
              )}
            </div>
          )}

          {/* T-20260512-foot-C1-VISIT-ROUTE-MEMO-V3: 방문경로/예약메모/고객메모/기타메모 4항목 쌍방연동 */}
          {(checkIn.customer_id || resolvedCustomerId) && (
            <>
              <Separator />
              <div className="space-y-3">
                {/* ① 방문경로 — 초진/체험(예약없이방문)만 노출. 재진 미노출. */}
                {checkIn.visit_type !== 'returning' && (
                  <div className="flex items-center gap-2">
                    <Label className="text-xs font-semibold text-teal-700 shrink-0">방문경로</Label>
                    <select
                      value={visitRoute}
                      onChange={(e) => {
                        setVisitRoute(e.target.value);
                        saveVisitRoute(e.target.value);
                      }}
                      className="rounded border border-gray-300 px-2 py-0.5 text-xs cursor-pointer focus:outline-none focus:border-teal-500 bg-white hover:border-teal-400 transition"
                    >
                      <option value="">— 선택 —</option>
                      <option value="TM">TM</option>
                      <option value="인바운드">인바운드</option>
                      <option value="워크인">워크인</option>
                      <option value="지인소개">지인소개</option>
                    </select>
                  </div>
                )}
                {/* ② 예약메모 (reservations.booking_memo) — AC-5 복구 */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-teal-700 flex items-center gap-1">
                    <FileText className="h-3 w-3" /> 예약메모
                  </Label>
                  <Textarea
                    value={bookingMemo}
                    onChange={(e) => setBookingMemo(e.target.value)}
                    placeholder="예약 관련 메모"
                    rows={2}
                    className="text-xs"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs w-full border-teal-300 text-teal-700 hover:bg-teal-50"
                    onClick={saveBookingMemo}
                    disabled={savingBookingMemo}
                  >
                    {savingBookingMemo ? '저장 중…' : '예약메모 저장'}
                  </Button>
                </div>
                {/* ③ 고객메모 (customers.customer_memo) — AC-6 추가 */}
                {checkIn.customer_id && (
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-teal-700 flex items-center gap-1">
                      <FileText className="h-3 w-3" /> 고객메모
                    </Label>
                    <Textarea
                      value={customerMemo}
                      onChange={(e) => setCustomerMemo(e.target.value)}
                      placeholder="고객 성향, 특이사항, 주차 정보 등"
                      rows={2}
                      className="text-xs"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs w-full border-teal-300 text-teal-700 hover:bg-teal-50"
                      onClick={saveCustomerMemo}
                      disabled={savingCustomerMemo}
                    >
                      {savingCustomerMemo ? '저장 중…' : '고객메모 저장'}
                    </Button>
                  </div>
                )}
                {/* ④ 기타메모 (customers.memo) — AC-6 추가 */}
                {checkIn.customer_id && (
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-teal-700 flex items-center gap-1">
                      <FileText className="h-3 w-3" /> 기타메모
                    </Label>
                    <Textarea
                      value={etcMemo}
                      onChange={(e) => setEtcMemo(e.target.value)}
                      placeholder="기타 참고사항"
                      rows={2}
                      className="text-xs"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs w-full border-teal-300 text-teal-700 hover:bg-teal-50"
                      onClick={saveEtcMemo}
                      disabled={savingEtcMemo}
                    >
                      {savingEtcMemo ? '저장 중…' : '기타메모 저장'}
                    </Button>
                  </div>
                )}
              </div>
            </>
          )}

          {/* ── [NEW] 데스크 통합 수납 메뉴 (payment_waiting 전용) ─ T-20260430-foot-DESK-PAYMENT-MENU ── */}
          {isDeskStage && (
            <>
              <Separator />
              <DeskPaymentMenu
                packages={packages}
                pkgRemaining={pkgRemaining}
                onSinglePayment={() => onPayment(checkIn)}
                onSessionUse={openBestFitSessionUse}
                onScrollToDoc={() =>
                  docPrintRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }
              />
            </>
          )}

          {/* ── 패키지 생성은 고객차트(미니홈피창)에서 진행 (T-20260506-foot-CHART-SIMPLE-REVAMP) ── */}

          {/* ── 활성 패키지 잔여회차 요약 (패키지 있을 때만) ── */}
          {packages.length > 0 && (
            <>
              <Separator />
              <ActivePackageSummary
                packages={packages}
                pkgRemaining={pkgRemaining}
                emphasize={isDeskStage}
              />
            </>
          )}

          {/* 체크리스트 + 동의서 */}
          <Separator />
          <div className="space-y-2">
            <span className="text-sm font-semibold text-muted-foreground">체크리스트 / 동의서</span>

            {/* T-20260506-foot-CHECKLIST-AUTOUPLOAD: 태블릿 양식 → Storage 자동 업로드 */}
            {/* T-20260510-foot-CHECKLIST-ALWAYS-VISIBLE: customer_id 없어도 버튼 항상 표시 */}
            <div className="space-y-1.5 pt-1">
              <div className="flex flex-wrap gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 text-xs gap-1 border-teal-300 text-teal-700 hover:bg-teal-50"
                  onClick={() => setTabletChecklistOpen(true)}
                  data-testid="tablet-checklist-btn"
                >
                  📝 사전 체크리스트 & 개인정보
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 text-xs gap-1 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                  onClick={() => setTabletConsentOpen(true)}
                  data-testid="tablet-consent-btn"
                >
                  📝 환불 & 비급여 동의서
                </Button>
              </div>
              {checkIn.customer_id && (
                <DocumentViewer
                  key={docRefreshKey}
                  customerId={checkIn.customer_id}
                  compact
                />
              )}
            </div>
          </div>

          {/* T-20260513-foot-C1-SPACE-ASSIGN-RESTORE: 공간배정 (체크리스트/동의서 하단) */}
          <Separator />
          <div className="space-y-2" data-testid="space-assign-section">
            <span className="text-sm font-semibold text-muted-foreground flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" /> 공간배정
            </span>
            <div className="flex gap-2">
              <select
                value={selectedRoom}
                onChange={(e) => setSelectedRoom(e.target.value)}
                className="flex-1 h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
                data-testid="space-assign-select"
              >
                <option value="">— 공간 선택 —</option>
                {roomOptions.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
              <Button
                size="sm"
                className="h-9 min-w-[52px] bg-teal-600 hover:bg-teal-700 text-white"
                onClick={() => assignRoom(selectedRoom)}
                disabled={!selectedRoom || assigningRoom}
                data-testid="space-assign-btn"
              >
                {assigningRoom ? '…' : '배정'}
              </Button>
            </div>
            {/* 당일 이동이력 */}
            {todayRoomLogs.length > 0 && (
              <div className="space-y-1 pt-0.5">
                <span className="text-xs text-muted-foreground">금일 이동이력</span>
                <div className="flex flex-wrap items-center gap-1 text-xs">
                  {todayRoomLogs.map((log, idx) => (
                    <span key={log.id} className="flex items-center gap-1">
                      {idx > 0 && <span className="text-muted-foreground/60">→</span>}
                      <Badge variant="outline" className="text-xs font-normal py-0">
                        <span className="text-muted-foreground mr-1">
                          {format(new Date(log.logged_at), 'HH:mm')}
                        </span>
                        {log.assigned_room}
                      </Badge>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* T-20260510-foot-CHART1-PAYMENT-ORDER: 결제 섹션은 서류발행 위로 이동됨 */}

          {/* 패키지 상세 목록 (연결 + 잔여 세부 표시) */}
          {checkIn.customer_id && (
            <>
              <Separator />
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-muted-foreground flex items-center gap-1">
                    <Package className="h-3 w-3" /> 패키지
                  </span>
                  {checkIn.package_id && (
                    <Badge variant="teal" className="text-xs">연결됨</Badge>
                  )}
                </div>
                {packages.length > 0 ? (
                  <div className="space-y-1.5">
                    {packages.map((pkg) => {
                      const isLinked = checkIn.package_id === pkg.id;
                      const rem = pkgRemaining.get(pkg.id);
                      const usedPct = rem && pkg.total_sessions > 0
                        ? Math.round((rem.total_used / pkg.total_sessions) * 100)
                        : 0;
                      return (
                        <div
                          key={pkg.id}
                          className={cn(
                            'rounded-lg border p-2 text-xs space-y-1',
                            isLinked ? 'border-teal-300 bg-teal-50/50' : 'border-input',
                          )}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-semibold">{pkg.package_name}</span>
                            <Badge variant={isLinked ? 'teal' : 'outline'} className="text-xs">
                              {formatAmount(pkg.total_amount)}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span>가열 {rem?.heated ?? pkg.heated_sessions}</span>
                            <span>비가열 {rem?.unheated ?? pkg.unheated_sessions}</span>
                            <span>수액 {rem?.iv ?? pkg.iv_sessions}</span>
                            <span>사전처치 {rem?.preconditioning ?? pkg.preconditioning_sessions}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 rounded-full bg-gray-200 overflow-hidden">
                              <div
                                className="h-full bg-teal-500 rounded-full"
                                style={{ width: `${Math.min(usedPct, 100)}%` }}
                              />
                            </div>
                            <span className="text-xs text-muted-foreground">{usedPct}%</span>
                          </div>
                          {!isLinked && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="w-full text-xs h-9 mt-1"
                              onClick={async () => {
                                if (!window.confirm('이 패키지를 시술에 연결하시겠습니까?')) return;
                                const { error } = await supabase
                                  .from('check_ins')
                                  .update({ package_id: pkg.id })
                                  .eq('id', checkIn.id);
                                if (error) {
                                  toast.error('패키지 연결 실패');
                                  return;
                                }
                                toast.success('패키지 연결 완료');
                                onUpdated();
                              }}
                            >
                              이 시술에 연결
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">활성 패키지 없음</p>
                )}
              </div>
            </>
          )}

          {/* 원장 소견 / 진료 패널 */}
          {(() => {
            const isExaminationStage = checkIn.status === 'examination' || checkIn.status === 'exam_waiting';
            if (isExaminationStage) {
              return (
                <div className="space-y-3 rounded-md p-3 bg-violet-50 ring-2 ring-violet-300 transition">
                  {/* 진료콜 알람 배너 (exam_waiting 단계) */}
                  {checkIn.status === 'exam_waiting' && (
                    <div className="flex items-center gap-2 rounded-lg border border-violet-300 bg-violet-100 px-3 py-2">
                      <Bell className="h-4 w-4 text-violet-600 animate-pulse shrink-0" />
                      <span className="text-xs font-semibold text-violet-800">진료 대기 중 — 원장님을 호출하세요</span>
                    </div>
                  )}
                  <Label className="text-sm font-semibold text-violet-900 flex items-center gap-1">
                    <Stethoscope className="h-3 w-3" /> 의사 진료 패널
                    <span className="ml-auto text-xs font-normal text-violet-700/80">진료 중</span>
                  </Label>
                  {/* T-20260502-foot-DOCTOR-TREATMENT-FLOW: DoctorTreatmentPanel */}
                  <DoctorTreatmentPanel
                    checkInId={checkIn.id}
                    visitType={checkIn.visit_type}
                    hasHealerLaser={
                      // 힐러레이저 포함 여부: 시술 항목명에 '힐러레이저' 포함 시 true
                      !!(checkIn.treatment_memo as { details?: string } | null)?.details?.includes('힐러레이저')
                    }
                    onUpdated={onUpdated}
                  />
                </div>
              );
            }
            // 비진료 단계: 간단한 원장 소견 텍스트
            return (
              <div className="space-y-2 rounded-md p-3 bg-violet-50/40 ring-1 ring-violet-100 transition">
                <Label className="text-sm font-semibold text-violet-900 flex items-center gap-1">
                  <Stethoscope className="h-3 w-3" /> 원장 소견
                  <span className="ml-auto text-xs font-normal text-violet-700/80">
                    선택 입력 (원장 미진료 시 대리 메모 가능)
                  </span>
                </Label>
                <Textarea
                  value={doctorNote}
                  onChange={(e) => { setDoctorNote(e.target.value); setIsDirty(true); }}
                  placeholder="원장 소견을 자유롭게 입력하세요"
                  rows={3}
                  className="text-sm bg-white border-violet-200 focus-visible:ring-violet-400"
                />
              </div>
            );
          })()}

          {/* 진료 기록 — T-20260504-foot-TREATMENT-SIMPLIFY (간소화) */}
          <div className="space-y-3 rounded-md p-3 bg-emerald-50/40 ring-1 ring-emerald-100">
            <span className="text-sm font-semibold text-emerald-900 flex items-center gap-1">
              <Stethoscope className="h-3.5 w-3.5" /> 진료 기록
            </span>

            {/* 담당실장 */}
            <div className="space-y-1.5">
              <Label className="text-sm text-emerald-900">담당실장</Label>
              <select
                value={assignedCounselorId ?? ''}
                onChange={(e) => { setAssignedCounselorId(e.target.value || null); setIsDirty(true); }}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 text-foreground"
              >
                <option value="">선택하세요</option>
                {staffList.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>

            {/* 치료구분 (단일선택) */}
            <div className="space-y-1.5">
              <Label className="text-sm text-emerald-900">치료구분</Label>
              <div className="flex gap-1.5">
                {['발톱무좀', '내성발톱'].map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => { setTreatmentCategory((v) => (v === cat ? null : cat)); setIsDirty(true); }}
                    className={cn(
                      'flex-1 h-9 rounded-md border text-sm font-medium transition',
                      treatmentCategory === cat
                        ? 'border-emerald-600 bg-emerald-50 text-emerald-700'
                        : 'border-input hover:bg-muted text-muted-foreground',
                    )}
                  >
                    {treatmentCategory === cat ? '✓ ' : ''}{cat}
                  </button>
                ))}
              </div>
            </div>

            {/* 치료내용 (중복선택) */}
            <div className="space-y-1.5">
              <Label className="text-sm text-emerald-900">
                치료내용
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">중복선택</span>
              </Label>
              <div className="grid grid-cols-2 gap-1.5">
                {['가열', '비가열', '포돌로게', '수액'].map((content) => {
                  const isChecked = treatmentContents.includes(content);
                  return (
                    <button
                      key={content}
                      type="button"
                      onClick={() => {
                        setTreatmentContents((prev) =>
                          isChecked ? prev.filter((c) => c !== content) : [...prev, content],
                        );
                        setIsDirty(true);
                      }}
                      className={cn(
                        'h-9 rounded-md border text-sm font-medium transition',
                        isChecked
                          ? 'border-emerald-600 bg-emerald-50 text-emerald-700'
                          : 'border-input hover:bg-muted text-muted-foreground',
                      )}
                    >
                      {isChecked ? '✓ ' : ''}{content}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 레이저 시간 — T-20260502-foot-LASER-TIME-UNIT + 10분 추가 */}
            <div className="space-y-1.5">
              <Label className="text-sm text-emerald-900">레이저 시간</Label>
              <div className="flex flex-wrap gap-1.5">
                {laserTimeUnits.map((min) => (
                  <button
                    key={min}
                    type="button"
                    onClick={() => { setLaserMinutes(laserMinutes === min ? null : min); setIsDirty(true); }}
                    className={cn(
                      'min-w-[52px] h-9 rounded-md border text-sm font-medium transition px-2',
                      laserMinutes === min
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'border-input hover:bg-muted text-muted-foreground',
                    )}
                  >
                    {min}분
                  </button>
                ))}
                {/* 직접 입력 — 목록에 없는 값 처리 */}
                {laserMinutes != null && !laserTimeUnits.includes(laserMinutes) && (
                  <span className="inline-flex items-center h-9 rounded-md border border-blue-400 bg-blue-50 px-2.5 text-sm font-medium text-blue-700">
                    {laserMinutes}분 (직접)
                    <button
                      type="button"
                      onClick={() => { setLaserMinutes(null); setIsDirty(true); }}
                      className="ml-1.5 text-blue-400 hover:text-blue-700"
                      title="취소"
                    >✕</button>
                  </span>
                )}
                {laserMinutes != null && (
                  <button
                    type="button"
                    onClick={() => { setLaserMinutes(null); setIsDirty(true); }}
                    className="h-9 px-2 rounded-md border border-dashed border-gray-300 text-xs text-muted-foreground hover:bg-muted transition"
                    title="레이저 시간 초기화"
                  >
                    초기화
                  </button>
                )}
              </div>
            </div>

            {/* 메모 */}
            <div className="space-y-1.5">
              <Label className="text-sm text-emerald-900 flex items-center gap-1">
                <Camera className="h-3 w-3" /> 메모
                {checkIn.treatment_memo?.details && (
                  <span className="ml-1 text-xs font-normal text-teal-600 bg-teal-50 rounded px-1.5 py-0.5">저장됨</span>
                )}
              </Label>
              <Textarea
                value={treatmentMemo}
                onChange={(e) => { setTreatmentMemo(e.target.value); setIsDirty(true); }}
                placeholder="시술 기록, 사용 장비, 특이사항"
                rows={3}
                className="text-sm"
              />
            </div>
          </div>

          {/* T-20260511-foot-C1-SAVE-DIRTY-AUTOSAVE: isDirty 기반 저장 버튼 + 자동저장 인디케이터 */}
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={saveNotes} disabled={saving || !isDirty} className="flex-1">
              {saving ? '저장 중…' : '메모 저장'}
            </Button>
            {showAutoSaved && (
              <span className="text-[10px] text-teal-600 shrink-0 animate-pulse">자동저장됨 ✓</span>
            )}
          </div>

          {/* 진료이미지 — T-20260513-foot-C21-TAB-RESTRUCTURE-B: AC-3b 명칭변경 + AC-8 비포에프터 삭제 */}
          {checkIn.customer_id && (
            <>
              <Separator />
              <Chart1TreatmentImages customerId={checkIn.customer_id} />
            </>
          )}

          {/* T-20260515-foot-KENBO-API-NATIVE: 건보공단 수진자 자격조회 */}
          {checkIn.customer_id && (
            <>
              <Separator />
              <NhisLookupPanel
                customerId={checkIn.customer_id}
                clinicId={checkIn.clinic_id}
                hiraConsent={hiraConsent}
                onGradeUpdated={load}
              />
            </>
          )}

          {/* 보험 영수증 / 처방전 */}
          <Separator />
          <InsuranceDocPanel checkIn={checkIn} onUpdated={onUpdated} />

          {/* 결제 — T-20260510-foot-CHART1-PAYMENT-ORDER: 서류발행 바로 위로 이동 */}
          <Separator />
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-muted-foreground">결제</span>
              {totalPaid > 0 ? (
                <Badge variant="success" className="text-xs">
                  결제완료 {formatAmount(totalPaid)}
                </Badge>
              ) : (
                <Badge variant="outline" className="text-xs text-orange-600">미결제</Badge>
              )}
            </div>
            {payments.length > 0 ? (
              <div className="space-y-1.5">
                {payments.map((p) => (
                  <div key={p.id} className="space-y-0.5">
                    <div className="flex items-center gap-1 text-xs">
                      <span className="flex-1">
                        {METHOD_LABEL[p.method] ?? p.method}
                        {p.installment && p.installment > 0 ? ` ${p.installment}개월` : ''}
                        {p.status === 'cancelled' && (
                          <span className="ml-1 text-[10px] text-amber-600 font-medium">[취소]</span>
                        )}
                      </span>
                      <span className={cn('tabular-nums mr-1', p.payment_type === 'refund' && 'text-red-600', p.status === 'cancelled' && 'line-through text-muted-foreground')}>
                        {p.payment_type === 'refund' ? '-' : ''}
                        {formatAmount(p.amount)}
                      </span>
                      {/* 수정/취소/삭제 버튼 (T-20260514-foot-PAYMENT-EDIT-CANCEL-DELETE) */}
                      {p.status !== 'cancelled' && (
                        <button
                          type="button"
                          data-testid={`btn-edit-payment-${p.id}`}
                          title="수납 수정"
                          onClick={() => { setPayEditTarget(p as PaymentRowForEdit); setPayEditMode('edit'); }}
                          className="rounded px-1 py-0.5 text-[10px] text-blue-600 hover:bg-blue-50 transition"
                        >수정</button>
                      )}
                      {p.status !== 'cancelled' && (
                        <button
                          type="button"
                          data-testid={`btn-cancel-payment-${p.id}`}
                          title="수납 취소"
                          onClick={() => { setPayEditTarget(p as PaymentRowForEdit); setPayEditMode('cancel'); }}
                          className="rounded px-1 py-0.5 text-[10px] text-amber-600 hover:bg-amber-50 transition"
                        >취소</button>
                      )}
                      <button
                        type="button"
                        data-testid={`btn-delete-payment-${p.id}`}
                        title="수납 삭제"
                        onClick={() => { setPayEditTarget(p as PaymentRowForEdit); setPayEditMode('delete'); }}
                        className="rounded px-1 py-0.5 text-[10px] text-red-500 hover:bg-red-50 transition"
                      >삭제</button>
                    </div>
                    {/* 수납 이력 보기 (AC-7) */}
                    <PaymentAuditLogsPanel paymentId={p.id} />
                  </div>
                ))}
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-1"
                onClick={() => onPayment(checkIn)}
              >
                <CreditCard className="h-3.5 w-3.5" /> 결제 등록
              </Button>
            )}
          </div>

          {/* 서류 발행 */}
          <Separator />
          <div ref={docPrintRef}>
            <DocumentPrintPanel checkIn={checkIn} onUpdated={onUpdated} />
          </div>

          {/* 방문 이력 */}
          {history.length > 0 && (
            <>
              <Separator />
              <VisitHistoryAccordion history={history} />
            </>
          )}
        </div>

        <PreChecklist
          checkIn={checkIn}
          open={checklistOpen}
          onOpenChange={setChecklistOpen}
          onCompleted={() => {
            setChecklistOpen(false);
            onUpdated();
          }}
        />

        {/* T-20260506-foot-CHECKLIST-AUTOUPLOAD: 태블릿 작성 양식 모달 */}
        {checkIn.customer_id && (
          <>
            <ChecklistForm
              open={tabletChecklistOpen}
              onOpenChange={setTabletChecklistOpen}
              customerId={checkIn.customer_id}
              defaultName={checkIn.customer_name ?? undefined}
              defaultPhone={checkIn.customer_phone ?? undefined}
              onSaved={() => {
                setDocRefreshKey((k) => k + 1);
                onUpdated();
              }}
            />
            <ConsentForm
              open={tabletConsentOpen}
              onOpenChange={setTabletConsentOpen}
              customerId={checkIn.customer_id}
              defaultName={checkIn.customer_name ?? undefined}
              onSaved={() => {
                setDocRefreshKey((k) => k + 1);
                onUpdated();
              }}
            />
          </>
        )}

        {/* 시술 선택 모달 */}
        <ServiceSelectModal
          open={svcModalOpen}
          services={services}
          onClose={() => setSvcModalOpen(false)}
          onSelect={addTreatmentItem}
          isConsultStage={isConsultStage}
          onPackageCTA={() => {
            setSvcModalOpen(false);
            onPayment(checkIn, 'package');
          }}
        />

        {/* 패키지 회차 사용 다이얼로그 */}
        <SessionUseInSheetDialog
          open={sessionUseOpen}
          pkg={sessionUsePkg}
          remaining={sessionUseRemaining}
          defaultSessionType={sessionUseType}
          onOpenChange={setSessionUseOpen}
          onDone={() => {
            setSessionUseOpen(false);
            if (sessionUseTreatmentIdx >= 0) {
              markSettled(sessionUseTreatmentIdx);
            }
            load(); // 잔여회차 갱신
          }}
        />

        {/* T-20260514-foot-PAYMENT-EDIT-CANCEL-DELETE */}
        {/* T-20260515-foot-PAYMENT-EDIT-REFLECT: onDone에 낙관적 업데이트 추가 */}
        <PaymentEditDialog
          payment={payEditTarget}
          mode={payEditMode}
          onClose={() => setPayEditTarget(null)}
          onDone={(updated?: PaymentDonePayload) => {
            setPayEditTarget(null);
            // 낙관적 업데이트: DB 재조회 대기 없이 즉시 UI 반영
            if (updated) {
              setPayments((prev) => {
                const mapped = prev.map((p) =>
                  p.id === updated.id ? ({ ...p, ...updated } as typeof p) : p
                );
                // soft-delete된 수납은 목록에서 즉시 제거
                return mapped.filter((p) => p.status !== 'deleted');
              });
            }
            load(); // DB 재조회로 최종 확인
          }}
        />
        {/* T-20260514-foot-CHART2-OPEN-BUG v2 fix: createPortal 방식 — nested dialog 독립 */}
        <CustomerChartSheet
          customerId={chartSheetId}
          onClose={() => setChartSheetId(null)}
        />
      </SheetContent>
    </Sheet>
  );
}

// ─── 서브 컴포넌트: 데스크 통합 수납 메뉴 (payment_waiting 전용) ─────────────
//   3가지 수납 작업을 한 화면에 통합
//   1) 패키지 회차 차감  2) 진료비 결제  3) 보험청구 서류 발급

interface DeskPaymentMenuProps {
  packages: PackageType[];
  pkgRemaining: Map<string, PackageRemaining>;
  onSinglePayment: () => void;
  onSessionUse: () => void;
  onScrollToDoc: () => void;
}

function DeskPaymentMenu({
  packages,
  pkgRemaining,
  onSinglePayment,
  onSessionUse,
  onScrollToDoc,
}: DeskPaymentMenuProps) {
  const hasActiveSessions = packages.some((pkg) => {
    const rem = pkgRemaining.get(pkg.id);
    return rem && rem.total_remaining > 0;
  });

  const menuItems = [
    {
      testid: 'desk-menu-session-deduct',
      icon: <Package className="h-4 w-4 text-teal-600 shrink-0" />,
      label: '패키지 회차 차감',
      sub: hasActiveSessions ? '잔여 회차 소진 처리' : '잔여 없음',
      borderColor: 'border-teal-300',
      hoverBg: 'hover:bg-teal-50/80',
      labelColor: 'text-teal-900',
      subColor: 'text-teal-600',
      disabled: !hasActiveSessions,
      onClick: hasActiveSessions ? onSessionUse : undefined,
    },
    {
      testid: 'desk-menu-single-payment',
      icon: <CreditCard className="h-4 w-4 text-blue-600 shrink-0" />,
      label: '진료비 결제',
      sub: '현장 진료비 결제',
      borderColor: 'border-blue-300',
      hoverBg: 'hover:bg-blue-50/80',
      labelColor: 'text-blue-900',
      subColor: 'text-blue-600',
      disabled: false,
      onClick: onSinglePayment,
    },
    {
      testid: 'desk-menu-insurance-doc',
      icon: <FileText className="h-4 w-4 text-amber-600 shrink-0" />,
      label: '보험청구 서류',
      sub: '소견서·진단서 발급',
      borderColor: 'border-amber-300',
      hoverBg: 'hover:bg-amber-50/80',
      labelColor: 'text-amber-900',
      subColor: 'text-amber-600',
      disabled: false,
      onClick: onScrollToDoc,
    },
  ] as const;

  return (
    <div
      data-testid="desk-payment-menu"
      className="rounded-xl border-2 border-teal-500 bg-gradient-to-br from-teal-50 to-emerald-50 p-3 space-y-2.5 shadow-sm"
    >
      {/* 헤더 */}
      <div className="flex items-center gap-2">
        <CreditCard className="h-4 w-4 text-teal-700" />
        <span className="text-sm font-bold text-teal-800">수납 처리</span>
        <span className="ml-auto text-[11px] bg-teal-600 text-white rounded-full px-2 py-0.5 font-medium">
          수납대기
        </span>
      </div>

      {/* 3버튼 세로 목록 */}
      <div className="grid grid-cols-1 gap-2">
        {menuItems.map((item) => (
          <button
            key={item.testid}
            data-testid={item.testid}
            disabled={item.disabled}
            onClick={item.onClick}
            className={cn(
              'rounded-xl border-2 bg-white p-3 text-left flex flex-col gap-1 transition min-h-[72px] shadow-sm',
              item.disabled
                ? 'border-gray-200 bg-gray-50/80 opacity-50 cursor-not-allowed'
                : cn(item.borderColor, item.hoverBg, 'active:scale-[0.98] cursor-pointer'),
            )}
          >
            <div className="flex items-center gap-1.5">
              {item.icon}
              <span className={cn('text-[11px] font-bold leading-tight', item.labelColor)}>
                {item.label}
              </span>
            </div>
            <span className={cn('text-[10px] leading-tight', item.subColor)}>
              {item.sub}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── 서브 컴포넌트: 시술 선택 모달 ──────────────────────────────────────────

function ServiceSelectModal({
  open,
  services,
  onClose,
  onSelect,
  isConsultStage,
  onPackageCTA,
}: {
  open: boolean;
  services: Service[];
  onClose: () => void;
  onSelect: (svc: Service) => void;
  /** 상담 단계: true이면 "패키지 신규 구매" CTA 상단 표시 */
  isConsultStage?: boolean;
  /** 상담 단계 CTA 클릭 → PaymentDialog 패키지 모드로 진입 */
  onPackageCTA?: () => void;
}) {
  // 카테고리별 그루핑
  const grouped = services.reduce<Record<string, Service[]>>((acc, s) => {
    const cat = s.category || '기타';
    (acc[cat] ??= []).push(s);
    return acc;
  }, {});

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Stethoscope className="h-4 w-4" /> 시술 선택
          </DialogTitle>
        </DialogHeader>

        {/* 상담 단계: 패키지 신규 구매 강조 CTA */}
        {isConsultStage && onPackageCTA && (
          <button
            onClick={onPackageCTA}
            className="w-full flex items-center justify-between rounded-xl border-2 border-teal-400 bg-teal-50 px-4 py-3 hover:bg-teal-100 transition"
          >
            <div className="flex items-center gap-2">
              <Package className="h-5 w-5 text-teal-600" />
              <div className="text-left">
                <div className="text-sm font-semibold text-teal-800">패키지 신규 구매</div>
                <div className="text-xs text-teal-600">상담 완료 후 패키지 결제 등록</div>
              </div>
            </div>
            <span className="text-teal-500 text-xs font-medium">→</span>
          </button>
        )}

        <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
          {Object.keys(grouped).length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              등록된 시술 없음 — 관리자에게 문의
            </p>
          ) : (
            Object.entries(grouped).map(([cat, svcs]) => (
              <div key={cat}>
                <div className="text-xs font-semibold text-muted-foreground mb-1.5 sticky top-0 bg-background py-0.5">
                  {cat}
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {svcs.map((s) => {
                    const sType = sessionTypeFromService(s);
                    return (
                      <button
                        key={s.id}
                        data-testid={`svc-option-${s.id}`}
                        onClick={() => {
                          onSelect(s);
                          onClose();
                        }}
                        className="rounded-lg border border-input px-2.5 py-2.5 text-left text-xs hover:border-teal-400 hover:bg-teal-50/50 active:scale-[0.98] transition space-y-0.5"
                      >
                        <div className="font-medium">{s.name}</div>
                        <div className="text-muted-foreground">{formatAmount(s.price)}</div>
                        {sType && (
                          <div className="text-teal-600 font-medium">
                            {SESSION_TYPE_FULL[sType]}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── 서브 컴포넌트: 시트 내 패키지 회차 사용 다이얼로그 ──────────────────────

function SessionUseInSheetDialog({
  open,
  pkg,
  remaining,
  defaultSessionType,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  pkg: PackageType | null;
  remaining: PackageRemaining | null;
  defaultSessionType: SessionType;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}) {
  const [sessionType, setSessionType] = useState<SessionType>(defaultSessionType);
  const [surcharge, setSurcharge] = useState(0);
  const [surchargeMemo, setSurchargeMemo] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // defaultSessionType 변경 시 반영
  useEffect(() => {
    setSessionType(defaultSessionType);
    setSurcharge(0);
    setSurchargeMemo('');
  }, [defaultSessionType, open]);

  const available: Record<SessionType, number> = {
    heated_laser: remaining?.heated ?? 0,
    unheated_laser: remaining?.unheated ?? 0,
    iv: remaining?.iv ?? 0,
    preconditioning: remaining?.preconditioning ?? 0,
  };

  const save = async () => {
    if (!pkg) return;
    if ((available[sessionType] ?? 0) <= 0) {
      toast.error('남은 회차가 없습니다');
      return;
    }
    setSubmitting(true);

    const { count } = await supabase
      .from('package_sessions')
      .select('*', { count: 'exact', head: true })
      .eq('package_id', pkg.id);
    const nextNumber = (count ?? 0) + 1;

    const { error } = await supabase.from('package_sessions').insert({
      package_id: pkg.id,
      session_number: nextNumber,
      session_type: sessionType,
      surcharge: surcharge || 0,
      surcharge_memo: surchargeMemo.trim() || null,
      status: 'used',
    });

    setSubmitting(false);
    if (error) {
      toast.error(`저장 실패: ${error.message}`);
      return;
    }
    toast.success('패키지 회차 소진 완료');
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-4 w-4 text-teal-600" />
            패키지 회차 사용
          </DialogTitle>
        </DialogHeader>

        {pkg && (
          <div className="rounded-lg bg-teal-50 border border-teal-200 px-3 py-2 text-xs space-y-0.5">
            <div className="font-semibold text-teal-900">{pkg.package_name}</div>
            <div className="flex gap-2 text-teal-700">
              <span>가열 {remaining?.heated ?? 0}</span>
              <span>비가열 {remaining?.unheated ?? 0}</span>
              <span>수액 {remaining?.iv ?? 0}</span>
              <span>사전처치 {remaining?.preconditioning ?? 0}</span>
            </div>
          </div>
        )}

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>진료 종류</Label>
            <div className="grid grid-cols-2 gap-2">
              {(['unheated_laser', 'heated_laser', 'iv', 'preconditioning'] as const).map((t) => (
                <button
                  key={t}
                  data-testid={`session-type-btn-${t}`}
                  onClick={() => setSessionType(t)}
                  disabled={available[t] <= 0}
                  className={cn(
                    'h-11 rounded-md border text-sm font-medium transition',
                    available[t] <= 0 && 'opacity-40 cursor-not-allowed',
                    sessionType === t
                      ? 'border-teal-600 bg-teal-50 text-teal-700'
                      : 'border-input hover:bg-muted',
                  )}
                >
                  {SESSION_TYPE_FULL[t]}
                  <span className="ml-1 text-xs text-muted-foreground">({available[t]})</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>당일 추가금 (옵션)</Label>
            <Input
              value={formatAmount(surcharge)}
              onChange={(e) => setSurcharge(parseAmount(e.target.value))}
              inputMode="numeric"
              placeholder="0"
            />
          </div>

          {surcharge > 0 && (
            <div className="space-y-1.5">
              <Label>추가금 메모</Label>
              <Input
                value={surchargeMemo}
                onChange={(e) => setSurchargeMemo(e.target.value)}
                placeholder="추가금 사유"
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button
            data-testid="btn-confirm-session-use"
            disabled={submitting || !pkg || available[sessionType] <= 0}
            onClick={save}
            className="bg-teal-600 hover:bg-teal-700"
          >
            {submitting ? '처리 중…' : '회차 소진 기록'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
