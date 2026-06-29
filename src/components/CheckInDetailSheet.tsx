// LOGIC-LOCK: L-004 — 차트 접근 경로 잠금. useChart() hook 경유만 허용. 변경 시 현장 승인 필수
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useUnsavedGuard } from '@/hooks/useUnsavedGuard';
import { useClinic } from '@/hooks/useClinic';
import { format } from 'date-fns';
import { Calendar, ChevronDown, ChevronRight, Clock, CreditCard, ExternalLink, Phone, FileText, Package, Stethoscope, Trash2, Bell, Upload } from 'lucide-react';
import DoctorTreatmentPanel from '@/components/doctor/DoctorTreatmentPanel';
import { type FootSite, parseFootSite, isCompleteFootSite, parseFootSites } from '@/components/FootSiteSelector';
import FootToeIllustration from '@/components/FootToeIllustration';
import { toast } from '@/lib/toast';
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
import { AmountInput } from '@/components/ui/AmountInput';
import { Separator } from '@/components/ui/separator';
import { Label } from '@/components/ui/label';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { STATUS_KO } from '@/lib/status';
import { formatAmount, formatPhone, todaySeoulStr, todaySeoulISODate, seoulISODate, chartNoBadge } from '@/lib/format';
import { cn } from '@/lib/utils';
// T-20260522-foot-CHECKIN-CONSENT-REMOVE: PreChecklist/ChecklistForm/ConsentForm 제거 (PenChart 이관 완료)
import { InsuranceDocPanel } from '@/components/InsuranceDocPanel';
import { DocumentPrintPanel } from '@/components/DocumentPrintPanel';
// T-20260514-foot-PAYMENT-EDIT-CANCEL-DELETE
// T-20260515-foot-PAYMENT-EDIT-REFLECT: PaymentDonePayload 추가 import
import { PaymentEditDialog, PaymentAuditLogsPanel } from '@/components/PaymentEditDialog';
import type { EditMode, PaymentRowForEdit, PaymentDonePayload } from '@/components/PaymentEditDialog';
import type { CheckIn, Package as PackageType, PackageRemaining, Service, VisitType } from '@/lib/types';
// T-20260516-foot-CHART2-STATE-UNIFY: CustomerChartSheet 렌더 AdminLayout 단일화로 이동
import { useChart } from '@/lib/chartContext';
// T-20260629-foot-CHART1-PAYMENT-INSURANCE-REMOVE: 1번차트 건보공단 실시간 자격조회 row 제거 (NhisLookupPanel import 삭제)
// T-20260515-foot-RESV-MEMO-APPEND: 예약메모 누적 이력
import { ReservationMemoTimeline } from '@/components/ReservationMemoTimeline';
// T-20260629-foot-CHART1-MEMO-INPUT-UNIFY: 고객메모/기타메모 인라인+[추가]+누적 통일
import { CustomerColumnMemo } from '@/components/CustomerColumnMemo';

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

// ─── 금일 동선 슬롯 타입 (T-20260522-foot-SPACE-AUTOROUTE) ──────────────────

// T-20260614-foot-DASH-HEATED-LASER-SLOT-REMOVE: 가열성레이저 슬롯 제거 → 동선 트래커에서 삭제.
// (과거 heated_laser 동선 로그는 매핑 누락으로 표시 생략 — 시술기록은 session_type 기반이라 무영향)
// T-20260623-foot-CHECKIN-LASER-SLOT-LABEL: 레이저 시술도 물리 공간은 '치료실'(별도 레이저실 없음).
//   '레이저실' 슬롯 제거 → laser/treatment 모두 '치료실'로 병합 표시 (DB room_type='laser'는 불변).
type TrackedSlotType = '상담실' | '치료실';
// 슬롯 표시 순서 (상담실 → 치료실)
const TRACKED_SLOT_ORDER: TrackedSlotType[] = ['상담실', '치료실'];

/** room_type → TrackedSlotType 매핑 (check_in_room_logs.room_type 기반) */
const ROOM_TYPE_TO_SLOT: Partial<Record<string, TrackedSlotType>> = {
  consultation: '상담실',
  treatment: '치료실',
  laser: '치료실', // 레이저 시술 물리 공간 = 치료실 (treatment와 병합, last-room-wins)
};
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

// T-20260524-foot-PKG-LABEL-AMOUNT AC-3: membership → '패키지' (DB value 유지)
const METHOD_LABEL: Record<string, string> = {
  card: '카드',
  cash: '현금',
  transfer: '이체',
  membership: '패키지',
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

// T-20260522-foot-CHART1-TRIM AC-1: ActivePackageSummary 제거 (패키지 탭 중복)

// T-20260517-foot-C2-TAB-SYNC: 1번차트 진료이미지 일자별 히스토리 (2번차트와 쌍방연동)
// 파일명 규칙: {type}_{timestamp}_{random}.{ext}  (type: before | after | photo)
// 구버전 호환: 타입 없는 파일({timestamp}_{random}.{ext})은 'photo'로 처리

type C1TreatImgType = 'before' | 'after' | 'photo';

interface C1TreatImgItem {
  path: string;
  signedUrl: string;
  name: string;
  imgType: C1TreatImgType;
  dateStr: string;
  timestamp: number;
}

function parseC1TreatMeta(name: string): { imgType: C1TreatImgType; timestamp: number } {
  const parts = name.split('_');
  if (parts[0] === 'before' || parts[0] === 'after') {
    const ts = parseInt(parts[1], 10);
    return { imgType: parts[0] as C1TreatImgType, timestamp: isNaN(ts) ? 0 : ts };
  }
  const ts = parseInt(parts[0], 10);
  return { imgType: 'photo', timestamp: isNaN(ts) ? 0 : ts };
}

function Chart1TreatmentImages({ customerId }: { customerId: string }) {
  const [items, setItems] = useState<C1TreatImgItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadType, setUploadType] = useState<C1TreatImgType>('photo');
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());
  const storagePath = `customer/${customerId}/treatment-images`;

  const load = useCallback(async () => {
    const { data: files } = await supabase.storage.from('photos').list(storagePath, {
      limit: 100,
      sortBy: { column: 'name', order: 'desc' },
    });
    if (!files || files.length === 0) { setItems([]); return; }
    const withMeta = await Promise.all(
      files
        .filter((f) => f.name && !f.id?.endsWith('/'))
        .map(async (file) => {
          const path = `${storagePath}/${file.name}`;
          const { data } = await supabase.storage.from('photos').createSignedUrl(path, 3600);
          const { imgType, timestamp } = parseC1TreatMeta(file.name);
          const dateStr = timestamp > 0
            ? new Date(timestamp).toISOString().slice(0, 10)
            : (file.created_at ? file.created_at.slice(0, 10) : 'unknown');
          return { path, signedUrl: data?.signedUrl ?? '', name: file.name, imgType, dateStr, timestamp } as C1TreatImgItem;
        }),
    );
    const valid = withMeta.filter((i) => i.signedUrl);
    valid.sort((a, b) => b.timestamp - a.timestamp);
    setItems(valid);
    // 최신 날짜 자동 펼치기
    if (valid.length > 0) {
      const newestDate = valid[0].dateStr;
      setExpandedDates((prev) => new Set([...prev, newestDate]));
    }
  }, [storagePath]);

  useEffect(() => { load(); }, [load]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    for (const file of Array.from(files)) {
      const ext = file.name.split('.').pop() ?? 'jpg';
      const path = `${storagePath}/${uploadType}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`;
      const { error } = await supabase.storage.from('photos').upload(path, file, { contentType: file.type });
      if (error) toast.error(`업로드 실패: ${error.message}`);
    }
    setUploading(false);
    e.target.value = '';
    await load();
  };

  const remove = async (item: C1TreatImgItem) => {
    if (!window.confirm('이미지를 삭제하시겠습니까?')) return;
    await supabase.storage.from('photos').remove([item.path]);
    await load();
  };

  const toggleDate = (d: string) =>
    setExpandedDates((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d); else next.add(d);
      return next;
    });

  // 일자별 그룹핑
  const grouped = useMemo(() => {
    const map = new Map<string, C1TreatImgItem[]>();
    for (const item of items) {
      if (!map.has(item.dateStr)) map.set(item.dateStr, []);
      map.get(item.dateStr)!.push(item);
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [items]);

  const TYPE_COLOR: Record<C1TreatImgType, string> = {
    before: 'bg-blue-100 text-blue-700',
    after:  'bg-emerald-100 text-emerald-700',
    photo:  'bg-gray-100 text-gray-500',
  };
  const TYPE_LABEL: Record<C1TreatImgType, string> = { before: '시술 전', after: '시술 후', photo: '기타' };

  return (
    <div className="space-y-2">
      {/* 헤더 + 업로드 */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
          <Upload className="h-3 w-3" /> 진료이미지
          {items.length > 0 && <span className="ml-1 text-teal-600 font-normal">{items.length}장</span>}
        </span>
        <div className="flex items-center gap-1">
          <select
            value={uploadType}
            onChange={(e) => setUploadType(e.target.value as C1TreatImgType)}
            className="text-[10px] border rounded px-1 py-0.5 bg-white text-gray-700"
          >
            <option value="before">시술 전</option>
            <option value="after">시술 후</option>
            <option value="photo">기타</option>
          </select>
          <label className="cursor-pointer">
            <input type="file" accept="image/*" multiple className="hidden" onChange={handleUpload} disabled={uploading} />
            <span className="inline-flex items-center gap-1 text-xs border border-teal-200 rounded px-2 py-0.5 bg-white text-teal-700 hover:bg-teal-50 cursor-pointer transition">
              <Upload className="h-3 w-3" />
              {uploading ? '중…' : '업로드'}
            </span>
          </label>
        </div>
      </div>

      {/* 일자별 그룹 */}
      {grouped.length === 0 ? (
        <div className="rounded-lg border border-dashed py-4 text-center text-xs text-muted-foreground">
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
                <button
                  type="button"
                  onClick={() => toggleDate(dateStr)}
                  className="w-full flex items-center justify-between px-2 py-1.5 bg-gray-50 hover:bg-gray-100 transition text-left"
                >
                  <span className="text-xs font-medium text-gray-700 flex items-center gap-1">
                    {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                    {dateStr}
                    <span className="text-muted-foreground font-normal ml-1">{dateItems.length}장</span>
                  </span>
                  <div className="flex items-center gap-0.5">
                    {beforeItems.length > 0 && (
                      <span className={`text-[9px] rounded px-1 ${TYPE_COLOR.before}`}>전</span>
                    )}
                    {afterItems.length > 0 && (
                      <span className={`text-[9px] rounded px-1 ${TYPE_COLOR.after}`}>후</span>
                    )}
                  </div>
                </button>
                {expanded && (
                  <div className="p-2 space-y-1.5 bg-white">
                    {([['before', beforeItems], ['after', afterItems], ['photo', photoItems]] as Array<[C1TreatImgType, C1TreatImgItem[]]>).map(
                      ([type, typeItems]) =>
                        typeItems.length > 0 && (
                          <div key={type}>
                            <span className={`text-[9px] rounded px-1 ${TYPE_COLOR[type]}`}>{TYPE_LABEL[type]}</span>
                            <div className="grid grid-cols-3 gap-1.5 mt-1">
                              {typeItems.map((img) => (
                                <div key={img.path} className="relative group">
                                  <img
                                    src={img.signedUrl}
                                    alt={img.name}
                                    className="w-full h-20 object-cover rounded border cursor-pointer"
                                    onClick={() => window.open(img.signedUrl, '_blank')}
                                  />
                                  <button
                                    onClick={() => remove(img)}
                                    className="absolute top-0.5 right-0.5 hidden group-hover:flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white"
                                    title="삭제"
                                  >
                                    <Trash2 className="h-2.5 w-2.5" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        ),
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
}

// T-20260522-foot-CHART1-TRIM AC-9/10: Chart1StorageSection 제거 (KOH균검사·경과분석지 하단 비노출)
// DB 기존 데이터 보존, FE 표시만 제거

// ─── 메인 컴포넌트 ────────────────────────────────────────────────────────────

export function CheckInDetailSheet({ checkIn, customerMode, onClose, onUpdated, onPayment, onOpenMedicalChart }: Props) {
  const { profile } = useAuth();
  const clinic = useClinic();
  const isAdmin = profile?.role === 'admin';
  // T-20260516-foot-CHART2-STATE-UNIFY: chartSheetId 제거 → AdminLayout ChartContext 사용
  // LOGIC-LOCK: L-004 [CHART-LOCK-007] — openChart 호출은 useChart() 경유만. 직접 ChartContext 접근 금지.
  const { openChart, closeChart } = useChart();
  const [services, setServices] = useState<Service[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [history, setHistory] = useState<VisitHistory[]>([]);
  const [packages, setPackages] = useState<PackageType[]>([]);
  const [pkgRemaining, setPkgRemaining] = useState<Map<string, PackageRemaining>>(new Map());
  const [notes, setNotes] = useState('');
  const [treatmentMemo, setTreatmentMemo] = useState('');
  // T-20260612-foot-CHART-INTAKE-TOGGLE-INPUT: 좌우+발가락 단일 부위 ({side,toe}) — treatment_memo.foot_site 서브키 저장(신규 컬럼 없음).
  const [footSite, setFootSite] = useState<FootSite | null>(null);
  const [doctorNote, setDoctorNote] = useState('');
  // T-20260504-foot-MEMO-RESTRUCTURE: 고객메모 (예약메모는 2번차트 1구역 전용 — T-20260512)
  const [customerMemo, setCustomerMemo] = useState('');
  const [savingCustomerMemo, setSavingCustomerMemo] = useState(false);
  const [saving, setSaving] = useState(false);
  // T-20260511-foot-C1-SAVE-DIRTY-AUTOSAVE: isDirty 패턴 + 자동저장 인디케이터
  const [isDirty, setIsDirty] = useState(false);
  const [showAutoSaved, setShowAutoSaved] = useState(false);
  // T-20260603-foot-CHART-UNSAVED-GUARD AC-2: 미저장 메모 보호 — 닫기 확인 다이얼로그
  // dirtyRef: 시트 하위 input/textarea(예약·상담·치료·고객·기타메모 등)에 사용자 입력이
  //   한 번이라도 발생했는지 추적하는 proxy(미저장 여부). 상위 저장(메모/고객메모/기타메모/방문경로)
  //   성공 시 false로 리셋. 자식 컴포넌트(예약메모 타임라인·의사 진료 패널)의 자체 저장은
  //   hook할 수 없으므로 안전측으로 동작 — 그쪽만 작성했다면 닫기 시 confirm가 한 번 더 뜬다.
  // 미입력(non-dirty) 상태면 confirm 없이 즉시 닫힘 → 불필요한 마찰 방지.
  const dirtyRef = useRef(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  // T-20260522-foot-CHECKIN-CONSENT-REMOVE: checklistOpen/tabletChecklistOpen/tabletConsentOpen 제거
  /** 고객 차트번호 (T-20260504-foot-CHART-UI-BADGE) */
  const [chartNumber, setChartNumber] = useState<string | null>(null);
  /** T-20260506-foot-CHART-LINK-SYNC: customer_id null 시 phone으로 조회된 고객 ID (2순위 식별) */
  const [resolvedCustomerId, setResolvedCustomerId] = useState<string | null>(null);
  /** T-20260529-foot-CHART-OPEN-SINGLE: 고객 연결 UI — customer_id·phone 모두 null일 때 표시 */
  const [linkQuery, setLinkQuery] = useState('');
  const [linkResults, setLinkResults] = useState<{ id: string; name: string; chart_number: string | null; phone: string | null }[]>([]);
  const [linkSearching, setLinkSearching] = useState(false);
  const [linkSaving, setLinkSaving] = useState(false);
  /** T-20260512-foot-CUSTMGMT-AC6-AC9: customerMode에서 최근 체크인 전체 (서류발행·의사소견·접수상태 표시용) */
  const [latestCheckIn, setLatestCheckIn] = useState<CheckIn | null>(null);

  // ── 진료종류 상태 (T-20260430-foot-TREATMENT-LABEL) — DB 호환성 유지 ──
  const [consultationDone, setConsultationDone] = useState(false);
  const [treatmentKind, setTreatmentKind] = useState<string>('');
  const [preconditioningDone, setPreconditioningDone] = useState(false);
  const [pododulleDone, setPododulleDone] = useState(false);
  const [laserMinutes, setLaserMinutes] = useState<number | null>(null);

  // ── 진료 기록 간소화 상태 (T-20260504-foot-TREATMENT-SIMPLIFY) — UI 제거(AC-7), 저장 호환성 유지 ──
  const [assignedCounselorId, setAssignedCounselorId] = useState<string | null>(null);
  const [treatmentCategory, setTreatmentCategory] = useState<string | null>(null);
  const [treatmentContents, setTreatmentContents] = useState<string[]>([]);
  /** 담당실장 드롭다운용 스태프 목록 (AC-7 UI 제거 — 세터만 유지하여 load 호환성 보존) */
  const [, setStaffList] = useState<Array<{ id: string; name: string; role: string }>>([]);
  /** T-20260510-foot-C1-VISIT-ROUTE-MEMO: 방문경로 */
  const [visitRoute, setVisitRoute] = useState<string>('');
  /** T-20260512-foot-C1-VISIT-ROUTE-MEMO-V3: 기타메모(memo) */
  const [etcMemo, setEtcMemo] = useState('');
  const [savingEtcMemo, setSavingEtcMemo] = useState(false);
  const [latestResvId, setLatestResvId] = useState<string | null>(null);
  // T-20260514-foot-PAYMENT-EDIT-CANCEL-DELETE
  const [payEditTarget, setPayEditTarget] = useState<PaymentRowForEdit | null>(null);
  const [payEditMode, setPayEditMode] = useState<EditMode>('edit');
  // T-20260516-foot-CHART2-STATE-UNIFY: chartSheetId state 제거 (AdminLayout ChartContext로 통합)
  // T-20260513-foot-C1-SPACE-ASSIGN-RESTORE: 공간배정 이동이력
  // T-20260522-foot-SPACE-AUTOROUTE: selectedRoom/assigningRoom/rooms/dailyRoomLog 제거 (수동배정 폐지)
  const [roomLogs, setRoomLogs] = useState<RoomLog[]>([]);
  // T-20260515-foot-KENBO-API-NATIVE: 고객 건보 조회 동의 여부
  // T-20260629-foot-CHART1-PAYMENT-INSURANCE-REMOVE: 건보공단 자격조회 row 제거로 hiraConsent state 삭제
  // T-20260613-foot-CUSTLIST-BIRTHDATE-FROM-RRN: 고객 상세 생년월일(YYYY-MM-DD).
  // PHI: rrn 복호화는 RPC(fn_customer_birthdates) 서버측만, birth_date만 수신.
  const [birthDateDisplay, setBirthDateDisplay] = useState<string | null>(null);

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
    // T-20260603-foot-CHART-UNSAVED-GUARD AC-2: 고객/체크인 전환 시 dirty·확인창 리셋
    dirtyRef.current = false;
    setShowCloseConfirm(false);
    // T-20260529-foot-CHART-OPEN-SINGLE: 고객 연결 UI 초기화
    setLinkQuery('');
    setLinkResults([]);
    setLinkSearching(false);
    // T-20260516-foot-CHART-OPEN-UNIFY AC-5: 칸반 슬롯 간 동일 열림 방식 통일
    // 기존: visit_type === 'new' 조건 → 초진만 2번차트 자동 오픈 (상담대기/치료대기/진료대기 불일치)
    // 변경: customer_id 있으면 visit_type 무관 2번차트 자동 오픈 (김사비 방식 = 전체 통일 기준)
    if (checkIn?.customer_id) {
      openChart(checkIn.customer_id); // 모든 슬롯 2번차트 자동 오픈
    } else {
      closeChart(); // 환자 전환 시 stale 차트 닫기
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

  // T-20260516-foot-CHART-UNIFORM-LOCK AC-1: resolvedCustomerId 확정 후 2번차트 자동 오픈
  // customer_id=null 케이스(초진/워크인)에서 phone 해석 완료 시점에 2번차트 열기
  // → 모든 고객 클릭 시 customer 식별만 되면 2번차트가 동일하게 열림 (김사비 기준 통일)
  // CHART_UNIFORMITY_LOCK: 이 동작을 조건부로 만들면 고객별 불일치 재발. 제거·분기 금지.
  useEffect(() => {
    if (resolvedCustomerId && !checkIn?.customer_id) {
      openChart(resolvedCustomerId);
    }
  }, [resolvedCustomerId]); // eslint-disable-line react-hooks/exhaustive-deps

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
      // T-20260629-foot-CHART1-PAYMENT-INSURANCE-REMOVE: 건보공단 자격조회 제거 — setHiraConsent 삭제
      // T-20260613-foot-CUSTLIST-BIRTHDATE-FROM-RRN: 생년월일 서버 파생 (birth_date 우선, 없으면 rrn 세기코드)
      supabase
        .rpc('fn_customer_birthdates', { p_clinic_id: clinicId, p_ids: [customerId] })
        .then(({ data, error }) => {
          if (error) { setBirthDateDisplay(null); return; }
          const row = (data ?? [])[0] as { birth_date_display: string | null } | undefined;
          setBirthDateDisplay(row?.birth_date_display ?? null);
        });
      const latestResvData = latestResvRes.data as { id: string } | null;
      setLatestResvId(latestResvData?.id ?? null);
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
              .ilike('phone', `%${checkIn.customer_phone.replace(/\D/g, '').slice(-8)}%`)
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
      // T-20260516-foot-RESV-MEMO-REVISIT: 3단계 폴백 — 초진/재진/워크인 무관 동일 경로
      // 수정 이유: ① .single() → 레코드 없을 때 null 반환이나 폴백 없음
      //           ② .or() 내 E.164 '+' 접두사가 PostgREST 필터에서 포맷 불일치 유발
      // 수정: reservation_id 직접 → customer_id → phone digits(ilike) 순 3단계 순차 폴백
      (async (): Promise<{ data: { id: string; booking_memo?: string | null } | null }> => {
        const today = format(new Date(), 'yyyy-MM-dd');
        // 1단계: reservation_id 직접 조회 (예약연결 체크인 — 초진/재진 모두)
        if (checkIn.reservation_id) {
          const { data: byId } = await supabase
            .from('reservations')
            .select('id, booking_memo')
            .eq('id', checkIn.reservation_id)
            .maybeSingle();
          if (byId) return { data: byId };
          // reservation_id 있으나 레코드 없음 → 폴백 진행 (삭제된 예약 등)
        }
        // 2단계: customer_id 기반 (manual check-in 또는 1단계 폴백)
        if (checkIn.customer_id) {
          const { data: todayById } = await supabase
            .from('reservations')
            .select('id, booking_memo')
            .eq('customer_id', checkIn.customer_id)
            .eq('reservation_date', today)
            .order('reservation_time', { ascending: true })
            .limit(1)
            .maybeSingle();
          if (todayById) return { data: todayById };
          const { data: latestById } = await supabase
            .from('reservations')
            .select('id, booking_memo')
            .eq('customer_id', checkIn.customer_id)
            .order('reservation_date', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (latestById) return { data: latestById };
        }
        // 3단계: phone digits ilike (포맷 불일치 방어 — E.164 vs 010-XXXX)
        if (checkIn.customer_phone) {
          const digits = checkIn.customer_phone.replace(/\D/g, '').slice(-8);
          const { data: todayByPhone } = await supabase
            .from('reservations')
            .select('id, booking_memo')
            .eq('reservation_date', today)
            .ilike('customer_phone', `%${digits}%`)
            .order('reservation_time', { ascending: true })
            .limit(1)
            .maybeSingle();
          if (todayByPhone) return { data: todayByPhone };
        }
        return { data: null };
      })(),
    ]);

    setServices((svcRes.data ?? []) as Service[]);
    setPayments((payRes.data ?? []) as PaymentRow[]);
    setHistory((histRes.data ?? []) as VisitHistory[]);
    const custData = custRes.data as { id?: string; chart_number: string | null; customer_memo: string | null; visit_route?: string | null; memo?: string | null; hira_consent?: boolean | null } | null;
    setChartNumber(custData?.chart_number ?? null);
    setCustomerMemo(custData?.customer_memo ?? '');
    setVisitRoute(custData?.visit_route ?? '');
    setEtcMemo(custData?.memo ?? '');
    // T-20260629-foot-CHART1-PAYMENT-INSURANCE-REMOVE: 건보공단 자격조회 제거 — setHiraConsent 삭제
    // T-20260506-foot-CHART-LINK-SYNC: customer_id null 케이스 — phone으로 찾은 고객 ID 2순위 저장
    if (!checkIn.customer_id && custData?.id) {
      setResolvedCustomerId(custData.id);
    }
    // T-20260516-foot-CHART-UNIFORM-LOCK AC-2: 예약메모 표시 균일화 — 4단계 폴백
    // 3단계(reservation_id → customer_id → phone) 실패 시 custData.id로 최신 예약 재탐색
    // CHART_UNIFORMITY_LOCK: 예약메모 UI는 모든 고객에게 동일하게 적용. 분기 금지.
    const resvData = resvRes.data as { id: string } | null;
    if (!resvData && custData?.id) {
      const { data: fallbackResv } = await supabase
        .from('reservations')
        .select('id')
        .eq('customer_id', custData.id)
        .order('reservation_date', { ascending: false })
        .limit(1)
        .maybeSingle();
      setLatestResvId((fallbackResv as { id: string } | null)?.id ?? null);
    } else {
      setLatestResvId(resvData?.id ?? null);
    }
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
    // T-20260612-foot-CHART-INTAKE-TOGGLE-INPUT: 좌우+발가락 부위 로드 (treatment_memo.foot_site)
    setFootSite(parseFootSite(checkIn.treatment_memo?.foot_site));
    setDoctorNote(checkIn.doctor_note ?? '');

    // T-20260522-foot-SPACE-AUTOROUTE: 이동이력 로드 — 테이블 미존재 시 graceful skip
    // REOPEN1 fix: RLS 정책 수정 후 정상 로드. { error } 체크 추가로 디버깅 가시성 확보.
    try {
      const { data: logsData, error: logsErr } = await supabase
        .from('check_in_room_logs')
        .select('id, check_in_id, assigned_room, room_type, logged_at')
        .eq('check_in_id', checkIn.id)
        .order('logged_at', { ascending: true });
      if (logsErr) console.error('[SPACE-AUTOROUTE] check_in_room_logs 로드 실패:', logsErr.message);
      setRoomLogs((logsData ?? []) as RoomLog[]);
    } catch (e) {
      console.error('[SPACE-AUTOROUTE] check_in_room_logs 예외:', e);
      setRoomLogs([]);
    }
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

  // T-20260522-foot-SPACE-AUTOROUTE REOPEN1: check_in_room_logs Realtime 구독
  // 1번차트가 열린 상태에서 환자가 다른 방으로 이동하면 금일 동선이 자동 갱신됨.
  useEffect(() => {
    if (!checkIn?.id || !checkIn?.clinic_id) return;
    const checkInId = checkIn.id;
    const channel = supabase
      .channel(`room-logs-${checkInId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'check_in_room_logs',
          filter: `check_in_id=eq.${checkInId}`,
        },
        (payload) => {
          // Realtime filter가 check_in_id=eq.{id} 보장 — clinic_id 추가 체크 불필요
          const newLog = payload.new as RoomLog;
          setRoomLogs((prev) => {
            // 중복 방지 (동일 id 방어)
            if (prev.some((l) => l.id === newLog.id)) return prev;
            return [...prev, newLog];
          });
        },
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [checkIn?.id]);

  // AC-7 T-20260522-foot-CHART1-TRIM: 타이머 관련 useEffect 제거 (비가열 타이머 UI 제거)

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

  // T-20260613-foot-FIELDBATCH item3: 저장 성공 여부 반환(true=저장됨/저장할 것 없음, false=실패).
  //   "저장 후 닫기"가 성공 시에만 닫도록 사용. 기존 호출부(자동저장·flush 가드)는 반환값 무시 → 무영향.
  const saveNotes = async (): Promise<boolean> => {
    if (!checkIn) return true;
    setSaving(true);
    const notesObj = { ...(checkIn.notes as Record<string, unknown> ?? {}), text: notes };
    // T-20260612-foot-CHART-INTAKE-TOGGLE-INPUT: 좌우+발가락 부위를 treatment_memo.foot_site 서브키로 저장.
    //   값(shape {side,toe})만 저장 — 표시문자열('L1')은 formatFootSite로 파생(저장 금지). null이면 키 제거.
    //   FIX(T-…-TOGGLE-INPUT): 완전한 값(side∈L/R AND toe 1~5)일 때만 기록. 불완전값(toe=0 등)은 키 제거 — DB 불완전 적재 차단.
    const memoObj: Record<string, unknown> = { ...(checkIn.treatment_memo ?? {}), details: treatmentMemo };
    if (isCompleteFootSite(footSite)) memoObj.foot_site = footSite;
    else delete memoObj.foot_site;
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
      return false;
    }
    toast.success('메모 저장됨');
    setIsDirty(false);
    dirtyRef.current = false; // T-20260603-foot-CHART-UNSAVED-GUARD AC-2
    onUpdated();
    return true;
  };

  // T-20260613-foot-FIELDBATCH item3: 1번차트 "저장 후 닫기" — 2번차트(CustomerChartSheet)와 동일 동작.
  //   saveNotes 성공 시에만 닫기 확인 다이얼로그를 닫고 시트 종료(저장 실패 시 그대로 유지).
  const handleSaveAndClose = async () => {
    if (saving) return;
    const ok = await saveNotes();
    if (ok) {
      setShowCloseConfirm(false);
      dirtyRef.current = false;
      onClose();
    }
  };

  // T-20260522-foot-SPACE-AUTOROUTE: assignRoom 제거 (수동 배정 폐지 — 금일동선 자동집계로 전환)
  // AC-6/7 T-20260522-foot-CHART1-TRIM: startTimer/stopTimer/saveCustomerModeDoctorNote 제거

  // T-20260522-foot-CHART1-TRIM AC-3: 금일 이동이력 제거 — dailySlotSummary만 사용

  // T-20260522-foot-SPACE-AUTOROUTE: 금일 동선 — check_in_room_logs 기반 슬롯별 마지막 위치 (last-room-wins)
  // T-20260522-foot-CHART1-TRIM AC-4: 상담실·치료실 항상 표시 (logs 없어도 "—" 표기)
  //   T-20260623-foot-CHECKIN-LASER-SLOT-LABEL: 레이저실 슬롯 제거 — laser room_type은 치료실로 병합.
  const dailySlotSummary = useMemo(() => {
    const today = todaySeoulStr();
    const todayLogs = roomLogs.filter((l) => logDateStr(l.logged_at) === today);
    const slotMap = new Map<TrackedSlotType, string>();
    for (const log of todayLogs) {
      const slotType = ROOM_TYPE_TO_SLOT[log.room_type];
      if (slotType) slotMap.set(slotType, log.assigned_room); // last-room-wins
    }
    // 4개 슬롯 항상 반환 — 미방문 슬롯은 null
    return TRACKED_SLOT_ORDER.map((st) => ({ slotType: st, roomNumber: slotMap.get(st) ?? null }));
  }, [roomLogs]);

  // T-20260511-foot-C1-SAVE-DIRTY-AUTOSAVE: stale closure 방지용 ref (항상 최신 함수 참조)
  const saveNotesRef = useRef(saveNotes);
  saveNotesRef.current = saveNotes;

  // T-20260613-foot-REFRESH-BANNER-AUTOLO (AC-3 dirty-guard, flushable):
  //   자동 새로고침 직전, 미저장 메모가 있으면 명시적 저장 경로(saveNotes)로 자동 flush 후 진행.
  //   체크인 시트는 30초 자동저장과 동일한 saveNotes 경로를 그대로 재사용 → "자동 저장됨" 후 새로고침.
  useUnsavedGuard(
    'checkin-detail-sheet',
    () => isDirty || dirtyRef.current,
    { flush: async () => { await saveNotesRef.current(); }, label: '체크인 메모', enabled: !!checkIn },
  );

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
      .ilike('phone', `%${phoneDigits.slice(-8)}%`)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) {
      toast.error('고객 정보를 찾을 수 없습니다 — 데스크에 문의하세요');
      return;
    }
    // T-20260516-foot-CHART2-STATE-UNIFY: ChartContext openChart 사용
    openChart(data.id);
  };

  // T-20260529-foot-CHART-OPEN-SINGLE: 고객 연결 UI 핸들러 ─────────────────────────
  // customer_id·phone 모두 null인 체크인에서 이름으로 고객 검색 후 연결
  const handleLinkSearch = async (query: string) => {
    setLinkQuery(query);
    if (!checkIn || query.trim().length < 1) { setLinkResults([]); return; }
    setLinkSearching(true);
    const { data } = await supabase
      .from('customers')
      .select('id, name, chart_number, phone')
      .eq('clinic_id', checkIn.clinic_id)
      .ilike('name', `%${query.trim()}%`)
      .order('created_at', { ascending: false })
      .limit(8);
    setLinkResults((data ?? []) as { id: string; name: string; chart_number: string | null; phone: string | null }[]);
    setLinkSearching(false);
  };

  const handleLinkCustomer = async (customerId: string) => {
    if (!checkIn || linkSaving) return;
    setLinkSaving(true);
    const { error } = await supabase
      .from('check_ins')
      .update({ customer_id: customerId })
      .eq('id', checkIn.id);
    if (error) {
      toast.error(`고객 연결 실패: ${error.message}`);
      setLinkSaving(false);
      return;
    }
    toast.success('고객 연결 완료 — 차트를 엽니다');
    setLinkResults([]);
    setLinkQuery('');
    setLinkSaving(false);
    openChart(customerId);
    onUpdated();
  };
  // ──────────────────────────────────────────────────────────────────────────────

  // T-20260510-foot-C1-VISIT-ROUTE-MEMO: 방문경로 저장
  // T-20260511-foot-CUSTMGMT-DETAIL-SHEET: customerMode fallback 추가
  const saveVisitRoute = async (val: string) => {
    const customerId = checkIn?.customer_id ?? resolvedCustomerId ?? customerMode?.customerId;
    if (!customerId) return;
    await supabase.from('customers').update({ visit_route: val || null }).eq('id', customerId);
    dirtyRef.current = false; // T-20260603-foot-CHART-UNSAVED-GUARD AC-2: 자동저장 완료 → dirty 해제
    // AC-8 쌍방연동 — 2번차트에 변경 알림
    localStorage.setItem('foot_crm_customer_refresh', JSON.stringify({ customerId, ts: Date.now() }));
  };

  // T-20260504-foot-MEMO-RESTRUCTURE: 고객메모 (customers.customer_memo)
  // T-20260511-foot-CUSTMGMT-DETAIL-SHEET: customerMode fallback 추가
  // T-20260629-foot-CHART1-MEMO-INPUT-UNIFY: textarea+개별저장 → 인라인+[추가]+누적(append-only).
  //   한 줄을 컬럼에 \n append 후 즉시 persist (예약메모와 동작 일관). DB 스키마 변경 없음.
  const appendCustomerMemo = async (line: string) => {
    const customerId = checkIn?.customer_id ?? customerMode?.customerId;
    if (!customerId) return;
    const base = customerMemo.trim();
    const newValue = base ? `${base}\n${line}` : line;
    setSavingCustomerMemo(true);
    const { error } = await supabase
      .from('customers')
      .update({ customer_memo: newValue })
      .eq('id', customerId);
    setSavingCustomerMemo(false);
    if (error) { toast.error('고객메모 저장 실패'); return; }
    setCustomerMemo(newValue);
    toast.success('고객메모 추가됨');
    dirtyRef.current = false; // T-20260603-foot-CHART-UNSAVED-GUARD AC-2
    // AC-8 쌍방연동 — 2번차트에 변경 알림
    localStorage.setItem('foot_crm_customer_refresh', JSON.stringify({ customerId, ts: Date.now() }));
  };

  // T-20260512-foot-C1-VISIT-ROUTE-MEMO-V3: 기타메모 (customers.memo)
  // T-20260629-foot-CHART1-MEMO-INPUT-UNIFY: 고객메모와 동일 — 인라인+[추가]+누적(append-only).
  const appendEtcMemo = async (line: string) => {
    const customerId = checkIn?.customer_id ?? resolvedCustomerId ?? customerMode?.customerId;
    if (!customerId) return;
    const base = etcMemo.trim();
    const newValue = base ? `${base}\n${line}` : line;
    setSavingEtcMemo(true);
    const { error } = await supabase
      .from('customers')
      .update({ memo: newValue })
      .eq('id', customerId);
    setSavingEtcMemo(false);
    if (error) { toast.error('기타메모 저장 실패'); return; }
    setEtcMemo(newValue);
    toast.success('기타메모 추가됨');
    dirtyRef.current = false; // T-20260603-foot-CHART-UNSAVED-GUARD AC-2
    localStorage.setItem('foot_crm_customer_refresh', JSON.stringify({ customerId, ts: Date.now() }));
  };

  const totalPaid = payments
    .filter((p) => p.payment_type === 'payment')
    .reduce((s, p) => s + p.amount, 0);

  // ── T-20260603-foot-CHART-UNSAVED-GUARD AC-2: 미저장 메모 보호 ──
  // 시트 콘텐츠 하위 input/textarea의 input 이벤트(버블)로 사용자 입력 발생을 감지.
  // (React setState 기반 값 변경은 DOM input 이벤트를 발화하지 않음 — 실제 사용자 타이핑만 dirty 처리)
  const markDirty = () => { dirtyRef.current = true; };
  // 닫기 요청(백드롭/ESC/X/onOpenChange=false) — dirty면 확인, 아니면 즉시 닫기.
  const requestClose = () => {
    if (dirtyRef.current) {
      setShowCloseConfirm(true);
    } else {
      onClose();
    }
  };
  // 닫기 확인 다이얼로그 — 두 렌더 분기(고객관리 모드 / 체크인 모드)에서 공통 사용.
  const closeConfirmDialog = (
    <Dialog open={showCloseConfirm} onOpenChange={(o) => { if (!o) setShowCloseConfirm(false); }}>
      <DialogContent className="max-w-sm" hideClose data-testid="checkin-close-confirm">
        <DialogHeader>
          <DialogTitle>작성 중인 내용이 있습니다</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          저장하지 않은 메모 내용이 사라질 수 있습니다. 닫으시겠습니까?
        </p>
        <DialogFooter>
          <Button
            variant="outline"
            data-testid="checkin-close-cancel"
            onClick={() => setShowCloseConfirm(false)}
          >
            취소(계속 작성)
          </Button>
          <Button
            variant="destructive"
            data-testid="checkin-close-confirm-btn"
            onClick={() => { setShowCloseConfirm(false); dirtyRef.current = false; onClose(); }}
          >
            저장하지 않고 닫기
          </Button>
          {/* T-20260613-foot-FIELDBATCH item3: 2번차트와 동일하게 "저장 후 닫기" 추가 */}
          <Button
            className="bg-teal-600 hover:bg-teal-700"
            data-testid="checkin-close-save-btn"
            disabled={saving}
            onClick={handleSaveAndClose}
          >
            {saving ? '저장 중…' : '저장 후 닫기'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  // ── T-20260511-foot-CUSTMGMT-DETAIL-SHEET: customer_id 기반 뷰 (체크인 없는 고객관리 모드) ──
  if (!checkIn && customerMode) {
    const effectiveChartNumber = chartNumber ?? customerMode.chartNumber;
    return (
      <Sheet open={true} onOpenChange={(o) => { if (!o) requestClose(); }}>
        <SheetContent className="w-[400px] sm:w-[440px] max-h-screen overflow-y-auto">
          <SheetHeader>
            <div className="flex items-center justify-between gap-2">
              <SheetTitle className="flex items-center gap-2 flex-1 flex-wrap">
                {customerMode.customerName}
              </SheetTitle>
              {/* T-20260516-foot-CHART2-STATE-UNIFY: ChartContext openChart 사용 */}
              <Button
                size="sm"
                className="gap-1 h-8 text-xs bg-teal-600 hover:bg-teal-700 shrink-0"
                onClick={() => openChart(customerMode.customerId)}
              >
                <ExternalLink className="h-3.5 w-3.5" />
                고객차트(2번)
              </Button>
            </div>
          </SheetHeader>

          {/* T-20260603-foot-CHART-UNSAVED-GUARD AC-2: 하위 메모 입력 dirty 추적 */}
          <div className="mt-4 space-y-4" onInput={markDirty}>
            {/* 차트번호 */}
            {effectiveChartNumber && (
              <div className="text-sm font-semibold text-teal-700">{effectiveChartNumber}</div>
            )}
            {/* 연락처 */}
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <Phone className="h-3.5 w-3.5" />
              {formatPhone(customerMode.customerPhone)}
            </div>

            {/* T-20260613-foot-CUSTLIST-BIRTHDATE-FROM-RRN: 생년월일(YYYY-MM-DD) 자동 표기.
                PHI: rrn 평문/뒷자리 미노출, 서버 RPC 파생값만 표시 */}
            <div className="flex items-center gap-1 text-sm text-muted-foreground" data-testid="cust-detail-birthdate">
              <Calendar className="h-3.5 w-3.5" />
              <span className="tabular-nums">{birthDateDisplay ?? '생년월일 미등록'}</span>
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
                    /* T-20260625-foot-COLOR-CONVENTION-UNIFY (총괄 A안): 재진=초록(firstvisit). sage→A안 초록 통일 */
                    <span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold bg-firstvisit-100 text-firstvisit-700">재진</span>
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
              {/* T-20260629-foot-CHART1-PAYMENT-INSURANCE-REMOVE AC-2: 건보공단 실시간 자격조회 row 제거 (customerMode) */}
              {/* ② 예약메모 (T-20260515-foot-RESV-MEMO-APPEND: append-only 타임라인) */}
              {/* T-20260520-foot-RESV-MEMO-WALKIN: reservationId 없어도 customerId fallback으로 메모 작성 가능 */}
              {/* T-20260521-foot-WALKIN-MEMO-GAP: customerMode 컨텍스트엔 checkInId 불필요 (customerId 항상 있음) */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-teal-700 flex items-center gap-1">
                  <FileText className="h-3 w-3" /> 예약메모
                </Label>
                <ReservationMemoTimeline
                  reservationId={latestResvId ?? undefined}
                  customerId={customerMode?.customerId}
                  clinicId={clinic?.id ?? ''}
                  authorName={profile?.name ?? ''}
                  compact
                />
              </div>
              {/* ③ 고객메모 (customers.customer_memo) — T-20260629-foot-CHART1-MEMO-INPUT-UNIFY: 인라인+[추가]+누적 통일 */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-teal-700 flex items-center gap-1">
                  <FileText className="h-3 w-3" /> 고객메모
                </Label>
                <CustomerColumnMemo
                  value={customerMemo}
                  onAppend={appendCustomerMemo}
                  saving={savingCustomerMemo}
                  disabled={!customerMode?.customerId}
                  placeholder="고객 성향, 특이사항, 주차 정보 등 (Ctrl+Enter로 추가)"
                  compact
                />
              </div>
              {/* ④ 기타메모 (customers.memo) — T-20260629-foot-CHART1-MEMO-INPUT-UNIFY: 인라인+[추가]+누적 통일 */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-teal-700 flex items-center gap-1">
                  <FileText className="h-3 w-3" /> 기타메모
                </Label>
                <CustomerColumnMemo
                  value={etcMemo}
                  onAppend={appendEtcMemo}
                  saving={savingEtcMemo}
                  disabled={!customerMode?.customerId}
                  placeholder="기타 참고사항 (Ctrl+Enter로 추가)"
                  compact
                />
              </div>
            </div>

            {/* T-20260522-foot-CHART1-TRIM AC-2: 체크리스트/동의서 제거 (펜차트 양식 대체) */}
            {/* T-20260522-foot-CHART1-TRIM AC-1: 패키지 잔여회차 제거 (패키지 탭 중복) */}

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

            {/* AC-6 T-20260522-foot-CHART1-TRIM: 원장 소견 완전 제거 — 진료 중(examination)일 때만 의사 진료 패널 표시 */}
            {latestCheckIn && (latestCheckIn.status === 'examination' || latestCheckIn.status === 'exam_waiting') && (
              <>
                <Separator />
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
              </>
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

          {/* T-20260522-foot-CHECKIN-CONSENT-REMOVE: ChecklistForm/ConsentForm 제거 (PenChart 이관 완료) */}
          {/* AC8: 패키지 회차 사용 다이얼로그 (customerMode) — T-20260512-foot-CUSTMGMT-AC6-AC9 */}
          <SessionUseInSheetDialog
            open={sessionUseOpen}
            pkg={sessionUsePkg}
            remaining={sessionUseRemaining}
            defaultSessionType={sessionUseType}
            /* T-20260609-foot-PKGSESS-CHECKIN-LINK: customerMode 차감은 session_date 기본값=오늘(KST).
               최근 내원이 '오늘'일 때만 귀속(과거 내원 오매칭 방지) — 아니면 NULL 근사 fallback. */
            checkInId={
              latestCheckIn?.checked_in_at &&
              seoulISODate(latestCheckIn.checked_in_at) === todaySeoulISODate()
                ? latestCheckIn.id
                : null
            }
            onOpenChange={setSessionUseOpen}
            onDone={() => {
              setSessionUseOpen(false);
              load();
            }}
          />
          {/* T-20260516-foot-CHART2-STATE-UNIFY: CustomerChartSheet 렌더 AdminLayout으로 이동 */}
          {/* T-20260603-foot-CHART-UNSAVED-GUARD AC-2: 닫기 확인 다이얼로그 */}
          {closeConfirmDialog}
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
  // T-20260629-foot-CHART1-PAYMENT-INSURANCE-REMOVE: '수납 처리' 카드(isDeskStage 게이트) 제거로 isDeskStage 삭제

  // T-20260629-foot-CHART1-PAYMENT-INSURANCE-REMOVE: '수납 처리' 카드 제거에 따라 전용 헬퍼 openBestFitSessionUse 삭제
  //   (패키지 회차 차감은 진료차트(2번차트) C2-PKG-TICKET-TABLE + 고객관리 1번차트 '시술 항목 관리'에서 접근)

  return (
    <Sheet open={!!checkIn} onOpenChange={(o) => { if (!o) requestClose(); }}>
      <SheetContent className="w-[400px] sm:w-[440px] max-h-screen overflow-y-auto">
        <SheetHeader>
          <div className="flex items-center justify-between gap-2">
            <SheetTitle className="flex items-center gap-2 flex-1 flex-wrap">
              {checkIn.queue_number != null && (
                <span className="text-teal-700">#{checkIn.queue_number}</span>
              )}
              {checkIn.customer_name}
              {/* T-20260612-foot-CHARTNO-B2-P2: 환자명 단독 노출 0 — 차트번호 인접(미발번 명시) */}
              {/* T-20260613-foot-CHART1-CHARTNO-DEDUP-REORDER AC-2: 이름 옆 차트번호 = 화면당 유일 노출(이름 하단 단독 div 제거) */}
              <span data-testid="chartno-inline" className="text-xs font-mono font-normal text-teal-600 shrink-0">{chartNoBadge(chartNumber)}</span>
              {/* 초진/재진/체험 배지 — 성함 옆 상단 배치 (T-20260506 항목1) */}
              {checkIn.visit_type === 'new' ? (
                <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold bg-blue-100 text-blue-700 shrink-0">
                  초진
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold bg-firstvisit-100 text-firstvisit-700 shrink-0">{/* T-20260625-foot-COLOR-CONVENTION-UNIFY (총괄 A안): 재진=초록(firstvisit). sage→A안 초록 통일 */}
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

        {/* T-20260603-foot-CHART-UNSAVED-GUARD AC-2: 하위 메모 입력 dirty 추적 */}
        <div className="mt-4 space-y-4" onInput={markDirty}>
          {/* 기본 정보 — 방문유형·상태 배지는 성함 옆으로 이동 (T-20260506 항목1) / 우선순위만 표시.
              T-20260611-foot-CHART2-IDVERIFY-MOVE-AUTOCHECK: 신분증 확인 표시는 2번차트(CustomerChartPage)
              주민번호 입력칸 옆으로 이동 + 주민번호 유효 저장 시 자동 "확인 완료". 1번차트에서는 제거. */}
          {checkIn.priority_flag && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="destructive">{checkIn.priority_flag}</Badge>
            </div>
          )}

          {/* T-20260613-foot-CHART1-CHARTNO-DEDUP-REORDER AC-1/AC-2: 이름 하단 단독 차트번호 제거.
              차트번호는 성함 옆 인접 표시(위 SheetTitle chartNoBadge)로 일원화 — 화면당 1회만 노출. */}
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
                  // T-20260516-foot-CHART2-STATE-UNIFY: ChartContext openChart 사용
                  if (checkIn.customer_id) {
                    // 1순위: customer_id FK 직접 참조 (가장 확실)
                    openChart(checkIn.customer_id);
                  } else if (resolvedCustomerId) {
                    // 2순위: chart_number + phone 일치로 조회된 고객 ID (환자명 불일치 허용)
                    openChart(resolvedCustomerId);
                  } else {
                    // 3순위: phone 기반 실시간 조회 (로드 타임 조회 실패 시 재시도)
                    openChartFallback();
                  }
                }}
              >
                <ExternalLink className="h-4 w-4" />
                고객차트
              </Button>
              {/* T-20260623-PASTEL-RETUNE: 1번차트 잔존 녹색(진료차트 버튼 emerald) → sage 파스텔. 고객차트=teal 유지로 두 버튼 구분 보존 */}
              {onOpenMedicalChart && (checkIn.customer_id || resolvedCustomerId) && (
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 gap-2 border-sage-400 text-sage-700 hover:bg-sage-50 text-sm h-11"
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

          {/* T-20260613-foot-FIELDBATCH item4(스펙 최종확정 pzp9) + CHART1-CHARTNO-DEDUP-REORDER AC-3:
              치료부위 선택은 2번차트 패키지 탭으로 이동. 1번차트는 "2번차트에서 생성된 경우에만" read-only 조건부 표시(위치 유지).
              값 소스: treatment_memo.foot_sites(신규 배열) 우선, 없으면 레거시 단일 foot_site 폴백. 빈 값이면 섹션 미렌더. */}
          {(() => {
            const tm = checkIn.treatment_memo as { foot_sites?: unknown; foot_site?: unknown } | null;
            const toes = parseFootSites(tm?.foot_sites ?? tm?.foot_site);
            if (toes.length === 0) return null;
            return (
              <div className="rounded-md border bg-muted/20 p-3" data-testid="chart1-toe-readonly">
                <FootToeIllustration value={toes} readOnly />
              </div>
            );
          })()}

          {/* T-20260529-foot-CHART-OPEN-SINGLE: 고객 연결 UI — customer_id·phone 모두 null인 경우 */}
          {!checkIn.customer_id && !resolvedCustomerId && !checkIn.customer_phone && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 space-y-2">
              <p className="text-xs font-semibold text-amber-800">
                ⚠ 고객 연결 필요 — 이름으로 검색 후 연결하세요
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="고객 이름 검색"
                  value={linkQuery}
                  onChange={(e) => handleLinkSearch(e.target.value)}
                  className="flex-1 rounded border border-amber-300 px-2 py-1 text-xs focus:outline-none focus:border-teal-500"
                  data-testid="link-customer-search-input"
                />
              </div>
              {linkSearching && (
                <p className="text-xs text-amber-600">검색 중…</p>
              )}
              {linkResults.length > 0 && (
                <ul className="space-y-1">
                  {linkResults.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-2 rounded border border-amber-200 bg-white px-2 py-1">
                      <span className="text-xs truncate">
                        <span className="font-semibold">{c.name}</span>
                        {/* T-20260612-foot-PATIENT-CHARTNO-PAIRING-AUDIT: 차트번호 항상 표시 */}
                        <span className={`ml-1 ${c.chart_number ? 'text-teal-600' : 'text-muted-foreground'}`}>{chartNoBadge(c.chart_number)}</span>
                        {c.phone && <span className="ml-1 text-muted-foreground">{c.phone.slice(-4)}</span>}
                      </span>
                      <button
                        type="button"
                        disabled={linkSaving}
                        onClick={() => handleLinkCustomer(c.id)}
                        className="shrink-0 rounded bg-neutral-800 px-2 py-0.5 text-[10px] font-bold text-white hover:bg-neutral-900 disabled:opacity-50 transition"
                        data-testid="link-customer-btn"
                      >
                        연결
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {!linkSearching && linkQuery.trim().length > 0 && linkResults.length === 0 && (
                <p className="text-xs text-amber-600">검색 결과 없음 — 고객관리에서 신규 등록 후 재시도</p>
              )}
            </div>
          )}

          {/* T-20260613-foot-CHART1-CHARTNO-DEDUP-REORDER AC-3: 방문경로/예약메모/고객메모/기타메모 블록은
              패키지 섹션 아래로 이동됨(섹션 순서 재정렬). 실제 렌더는 패키지 블록 직후 참조. */}

          {/* T-20260629-foot-CHART1-PAYMENT-INSURANCE-REMOVE AC-1: '수납 처리' 카드(패키지 회차 차감/진료비 결제/보험청구 서류) 제거.
              결제는 하단 '결제 등록' 버튼, 회차 차감은 진료차트(2번차트), 보험청구 서류는 하단 '서류 발행' 패널에서 접근. */}

          {/* ── 패키지 생성은 고객차트(미니홈피창)에서 진행 (T-20260506-foot-CHART-SIMPLE-REVAMP) ── */}
          {/* T-20260522-foot-CHART1-TRIM AC-1: 패키지 잔여회차 요약 제거 (패키지 탭 중복) */}
          {/* T-20260522-foot-CHART1-TRIM AC-2: 체크리스트/동의서 제거 (펜차트 양식 대체) */}

          {/* T-20260522-foot-CHART1-TRIM AC-3/AC-4: 금일 동선 — 항상 표시, 4개 슬롯 고정 */}
          <Separator />
          <div className="space-y-1" data-testid="space-assign-section">
            <span className="text-xs text-muted-foreground">금일 동선</span>
            <div className="flex flex-wrap gap-1" data-testid="daily-room-log-section">
              {dailySlotSummary.map(({ slotType, roomNumber }) => (
                <Badge
                  key={slotType}
                  variant={roomNumber ? 'secondary' : 'outline'}
                  className={cn('text-xs font-normal py-0 gap-1', !roomNumber && 'opacity-50')}
                  data-testid={`daily-log-${slotType}`}
                >
                  <span className="text-muted-foreground">{slotType}</span>
                  <span className={cn('font-medium', !roomNumber && 'text-muted-foreground/60')}>
                    {roomNumber ?? '—'}
                  </span>
                </Badge>
              ))}
            </div>
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

          {/* T-20260613-foot-CHART1-CHARTNO-DEDUP-REORDER AC-3: 방문경로/예약메모/고객메모/기타메모 블록 —
              패키지 섹션 아래로 재배치(섹션 순서: 치료부위 → 금일동선 → 패키지 → 예약메모 → 고객메모 → 기타메모 ...).
              섹션 내부 동작·데이터 불변, 렌더 순서만 변경. */}
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
                {/* T-20260629-foot-CHART1-PAYMENT-INSURANCE-REMOVE AC-2: 건보공단 실시간 자격조회 row 제거 (대시보드 1번차트) */}
                {/* ② 예약메모 (T-20260515-foot-RESV-MEMO-APPEND: append-only 타임라인) */}
                {/* T-20260520-foot-RESV-MEMO-WALKIN: reservationId 없어도 customerId fallback으로 메모 작성 가능 */}
                {/* T-20260521-foot-WALKIN-MEMO-GAP: customer_id=null 수기 워크인에 checkInId 3순위 fallback */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-teal-700 flex items-center gap-1">
                    <FileText className="h-3 w-3" /> 예약메모
                  </Label>
                  <ReservationMemoTimeline
                    reservationId={latestResvId ?? undefined}
                    customerId={checkIn?.customer_id ?? resolvedCustomerId ?? undefined}
                    checkInId={checkIn?.id}
                    clinicId={clinic?.id ?? ''}
                    authorName={profile?.name ?? ''}
                    compact
                  />
                </div>
                {/* ③ 고객메모 (customers.customer_memo) — T-20260629-foot-CHART1-MEMO-INPUT-UNIFY: 인라인+[추가]+누적 통일 */}
                {checkIn.customer_id && (
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-teal-700 flex items-center gap-1">
                      <FileText className="h-3 w-3" /> 고객메모
                    </Label>
                    <CustomerColumnMemo
                      value={customerMemo}
                      onAppend={appendCustomerMemo}
                      saving={savingCustomerMemo}
                      disabled={!checkIn.customer_id}
                      placeholder="고객 성향, 특이사항, 주차 정보 등 (Ctrl+Enter로 추가)"
                      compact
                    />
                  </div>
                )}
                {/* ④ 기타메모 (customers.memo) — T-20260629-foot-CHART1-MEMO-INPUT-UNIFY: 인라인+[추가]+누적 통일 */}
                {checkIn.customer_id && (
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-teal-700 flex items-center gap-1">
                      <FileText className="h-3 w-3" /> 기타메모
                    </Label>
                    <CustomerColumnMemo
                      value={etcMemo}
                      onAppend={appendEtcMemo}
                      saving={savingEtcMemo}
                      disabled={!checkIn.customer_id}
                      placeholder="기타 참고사항 (Ctrl+Enter로 추가)"
                      compact
                    />
                  </div>
                )}
              </div>
            </>
          )}

          {/* AC-6 T-20260522-foot-CHART1-TRIM: 원장 소견 완전 제거 — 진료 중(examination)일 때만 의사 진료 패널 표시 */}
          {(checkIn.status === 'examination' || checkIn.status === 'exam_waiting') && (
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
          )}

          {/* AC-7 T-20260522-foot-CHART1-TRIM: 진료 기록 섹션 완전 제거
              (담당실장·치료구분·치료내용·레이저시간·비가열타이머·메모 — DB 기존 데이터 보존, 표시만 제거) */}

          {/* T-20260511-foot-C1-SAVE-DIRTY-AUTOSAVE: isDirty 기반 저장 버튼 + 자동저장 인디케이터 */}
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={saveNotes} disabled={saving || !isDirty} className="flex-1">
              {saving ? '저장 중…' : '메모 저장'}
            </Button>
            {showAutoSaved && (
              <span className="text-[10px] text-teal-600 shrink-0 animate-pulse">자동저장됨 ✓</span>
            )}
          </div>

          {/* AC-9 T-20260522-foot-CHART1-TRIM: KOH균검사 하단구역 제거 (DB 기존 데이터 보존, FE 비노출) */}
          {/* AC-10 T-20260522-foot-CHART1-TRIM: 경과분석지 하단구역 제거 (DB 기존 데이터 보존, FE 비노출) */}

          {/* 진료이미지 — T-20260513-foot-C21-TAB-RESTRUCTURE-B: AC-3b 명칭변경 + AC-8 비포에프터 삭제 */}
          {/* T-20260517-foot-C2-TAB-SYNC: 일자별 히스토리 (before/after 구분) */}
          {checkIn.customer_id && (
            <>
              <Separator />
              <Chart1TreatmentImages customerId={checkIn.customer_id} />
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

        {/* T-20260522-foot-CHECKIN-CONSENT-REMOVE: PreChecklist/ChecklistForm/ConsentForm 제거 (PenChart 이관 완료) */}

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
          /* T-20260609-foot-PKGSESS-CHECKIN-LINK: 활성 내원 슬롯(checkIn) 차감 → 해당 내원 귀속 */
          checkInId={checkIn?.id ?? null}
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
        {/* T-20260516-foot-CHART2-STATE-UNIFY: CustomerChartSheet 렌더 AdminLayout으로 이동 */}
        {/* T-20260603-foot-CHART-UNSAVED-GUARD AC-2: 닫기 확인 다이얼로그 */}
        {closeConfirmDialog}
      </SheetContent>
    </Sheet>
  );
}

// T-20260629-foot-CHART1-PAYMENT-INSURANCE-REMOVE AC-1: DeskPaymentMenu('수납 처리' 카드) 컴포넌트 제거.
//   3개 하위 기능 진입점은 모두 다른 화면에 존재 — 결제(시트 하단 '결제 등록'), 회차 차감(진료차트 C2-PKG-TICKET-TABLE),
//   보험청구 서류(시트 하단 '서류 발행' DocumentPrintPanel). 유일 진입점 아님 확인 후 제거.

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
  checkInId,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  pkg: PackageType | null;
  remaining: PackageRemaining | null;
  defaultSessionType: SessionType;
  // T-20260609-foot-PKGSESS-CHECKIN-LINK: 차감 귀속 내원 식별자(치료사 통계 정밀화). 없으면 NULL(근사 fallback).
  checkInId?: string | null;
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
      // T-20260609-foot-PKGSESS-CHECKIN-LINK (AC2): 현재 내원 귀속 → 통계 정확매칭
      check_in_id: checkInId ?? null,
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
            <AmountInput
              value={surcharge}
              onChange={(raw) => setSurcharge(Number(raw) || 0)}
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
