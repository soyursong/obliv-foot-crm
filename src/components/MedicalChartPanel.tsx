// LOGIC-LOCK: L-003 — 차트 수정사항 CRM 전체 고객 동일 적용. 변경 시 현장 승인 필수
/**
 * MedicalChartPanel — 풋센터 진료차트 Drawer (전면 보강)
 *
 * T-20260519-foot-MEDCHART-REVAMP:
 *   AC-2: 진료차트 Drawer UI 전환 (전체화면 → 우측 슬라이드 Drawer)
 *   AC-3: 컴팩트 레이아웃
 *         - 진료일 / 진단명 / 치료(결제내역 연동) / 치료사차트 / 임상경과(상용구) / 진료메모(원장전용) / 처방내역(세트)
 *   AC-4: 경과 타임라인 좌측 배치 (최신 상단, 날짜 클릭 → 우측 폼 전환)
 *
 * T-20260526-foot-PHRASE-SLASH:
 *   AC-2/3: 임상경과 단축어 트리거 # → // 전환
 *           (예: //족통감소 입력 시 팝오버, 선택 시 문구 대체)
 *
 * T-20260522-foot-LASER-TIMER:
 *   AC-1: 치료메모 상단 타이머 버튼 [5분] [15분] [20분] + 카운트다운
 *   AC-2: ends_at 기준 카운트다운 (탭 비활성 대응 — 서버시각 앵커)
 *   AC-4: timer_records 신규 테이블 사용
 *   checkInId prop 추가 (optional — 없으면 타이머 미표시)
 *
 * T-20260526-foot-CHART-DRAWER-LAYOUT:
 *   AC-1: 처방내역·상용구 팝업/드롭다운 → Drawer 오른쪽 패널(2-column) 전환
 *         좌측=진료기록 폼, 우측=처방내역·상용구 콘텐츠 패널(탭 전환)
 *   AC-2: 우측 패널 처방세트·상용구 선택 → 좌측 폼 삽입 + "편집" 버튼 → 관리 화면 이동
 *   AC-3: 치료사차트 읽기전용 스타일 (회색 배경 + disabled + cursor-not-allowed)
 *   AC-4: 진료차트 모든 placeholder/예시 멘트 연한 회색 처리
 *   AC-5: 기존 기능 무영향 (MEDCHART-REVAMP 타임라인·저장·Drawer 동작 유지)
 *
 * T-20260526-foot-MEDCHART-SYNC:
 *   AC-1: 진료차트 상용구(phrase_type='medical_chart')만 연동 — 펜차트 상용구 분리
 *   AC-2: 치료메모 탭 — customer_treatment_memos 읽기전용 뷰어 (우측 패널)
 *   AC-3: 진료내역 탭 — check_ins 방문 이력 읽기전용 뷰어 (우측 패널)
 *   AC-4: 진료이미지 탭 — photos Storage 썸네일 뷰어 (우측 패널)
 *
 * T-20260527-foot-TREATMEMO-CHART-MERGE:
 *   AC-1: 치료메모 뷰어(우측 패널 별도 탭) → [치료사차트] 섹션 하단에 통합
 *   AC-2: 읽기 전용 유지
 *   AC-3: 기존 치료사차트(treatment_record) 콘텐츠 보존
 *   AC-4: 치료메모 없는 방문 → 서브섹션 미표시 (에러 없음)
 *
 * 이전 버전:
 *   T-20260515-foot-MEDICAL-CHART-V1 — 최초 구현 (6항목)
 *   T-20260516-foot-MEDICAL-CHART-EXPAND — 전체화면 전환 (이 버전으로 대체)
 *
 * Props: open / onOpenChange / customerId / clinicId / currentUserRole / currentUserEmail
 *   — 기존 caller 변경 없음. checkInId 신규 (optional)
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { toast } from '@/lib/toast';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import { AlertTriangle, BookOpen, Camera, Check, ChevronDown, ChevronLeft, ChevronRight, Edit2, FlaskConical, Folder, FolderOpen, FolderTree, History, Loader2, Pill, Pin, PinOff, Plus, Search, Sparkles, Stethoscope, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { checkRxRoleGate, rxRoleGateMessage } from '@/lib/prescriptionGate';
import { formatAmount, formatPhone } from '@/lib/format';
import type { PrescriptionItem } from '@/components/admin/PrescriptionSetsTab';
import { classificationToRoute } from '@/components/admin/PrescriptionSetsTab';
// T-20260606-foot-RX-SET-REDESIGN AC-R3/R5: 약품 폴더 탐색기(개별 약품 트리). 묶음처방(set)과 별개 축.
import DrugFolderTree, { type DrugPick } from '@/components/doctor/DrugFolderTree';
import RxCountInput from '@/components/admin/RxCountInput';
// T-20260606-foot-DIAGNOSIS-MASTER-MGMT (AC-2/AC-3): 상병명 폴더 탐색 선택기(자동완성 폐지)
import DiagnosisFolderPicker from '@/components/medical/DiagnosisFolderPicker';
// T-20260603-foot-RX-SUPER-PHRASE: 슈퍼상용구 적용(진단명+임상경과+처방 일괄 라우팅)
import type { SuperPhrase } from '@/components/admin/SuperPhrasesTab';

// ── 타입 ─────────────────────────────────────────────────────────────────────

interface MedicalChart {
  id: string;
  customer_id: string;
  clinic_id: string;
  visit_date: string;
  chief_complaint: string | null;   // legacy — display only in timeline summary
  diagnosis: string | null;
  treatment_record: string | null;  // 치료사차트
  materials_used: string | null;    // legacy
  treatment_result: string | null;  // legacy
  clinical_progress: string | null; // NEW: 임상경과
  prescription_items: PrescriptionItem[] | null; // NEW: 처방내역
  created_by: string | null;
  // T-20260606-foot-MEDCHART-RECORDER-NAME AC-4: 기록 시점 의사 표시명 스냅샷(DB 영구). NULL=레거시/미매칭→폴백.
  created_by_name?: string | null;
  created_at: string;
  updated_at: string;
  // doctor_memo: chart_doctor_memos에서 merge (director/admin 전용)
  doctor_memo?: string | null;
}

interface CustomerBasic {
  id: string;
  name: string;
  phone: string;
  birth_date: string | null;
  chart_number: string | null;
}

interface PhraseTemplate {
  id: number;
  category: string;
  name: string;
  content: string;
  shortcut_key: string | null;
  is_active: boolean;
  // T-20260605-foot-RX-SUPER-PHRASE-LOAD-BUG: 유형 배지·정렬용. 레거시 행은 pen_chart 로 간주.
  phrase_type?: 'pen_chart' | 'medical_chart';
}

interface PrescriptionSet {
  id: number;
  name: string;
  items: PrescriptionItem[];
  is_active: boolean;
  folder?: string | null; // AC-1 폴더명 (nullable)
}

// T-20260603-foot-RX-CHART-ENHANCE AC-5: 약품 마스터(prescription_codes) 검색 결과
interface RxCodeResult {
  id: string;
  name_ko: string;
  claim_code: string;
  classification: string | null;
  code_source: string; // 'official' | 'custom'
  price_krw: number | null;
}

// T-20260603-foot-RX-CHART-ENHANCE AC-2: 금기증
interface Contraindication {
  id: string;
  prescription_code_id: string;
  contraindication_text: string;
  severity: string | null;
}

interface VisitPayment {
  id: string;
  amount: number;
  memo: string | null;
  method: string;
}

// T-20260603-foot-RX-CHART-ENHANCE AC-3: 약 종류(투여경로) 색상 구분.
// PrescriptionItem.route(경구/외용/주사 등) → 색상 도트 매핑. 미매칭은 회색.
// (약품 마스터 classification 연동 전까지 route를 종류 프록시로 사용)
const RX_ROUTE_STYLE: Record<string, { dot: string; label: string }> = {
  경구: { dot: 'bg-teal-500', label: '경구' },
  내복: { dot: 'bg-teal-500', label: '내복' },
  외용: { dot: 'bg-amber-500', label: '외용' },
  도포: { dot: 'bg-amber-500', label: '도포' },
  주사: { dot: 'bg-rose-500', label: '주사' },
  주사제: { dot: 'bg-rose-500', label: '주사' },
  점안: { dot: 'bg-sky-500', label: '점안' },
  흡입: { dot: 'bg-violet-500', label: '흡입' },
};
function rxRouteStyle(route: string | undefined | null): { dot: string; label: string } {
  const key = (route ?? '').trim();
  return RX_ROUTE_STYLE[key] ?? { dot: 'bg-gray-400', label: key || '기타' };
}
// AC-5/AC-3: classification 확보 시 그것을 우선 색상 프록시로 사용(점진 전환). 미보유 시 기존 route 도트 유지.
function rxItemStyle(item: PrescriptionItem): { dot: string; label: string } {
  if (item.classification) {
    const mapped = classificationToRoute(item.classification);
    if (mapped) return rxRouteStyle(mapped);
  }
  return rxRouteStyle(item.route);
}

// T-20260526-foot-MEDCHART-SYNC: 치료메모 항목
interface TreatmentMemoEntry {
  id: string;
  content: string;
  created_by_name: string | null;
  created_at: string;
  memo_type?: string | null;
}

// T-20260603-foot-CHART-SPECIAL-NOTE: 특이사항 공용 누적칸 항목 (환자 단위, 날짜 분기 없음)
interface SpecialNoteEntry {
  id: string;
  content: string;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  // T-20260603-foot-RX-CHART-FOLLOWUP2 #10: 핀 고정(맨위로). 클리닉 공용 표식.
  is_pinned?: boolean | null;
  pinned_at?: string | null;
}

// T-20260603-foot-RX-CHART-FOLLOWUP2 #10: 핀 우선 정렬 (고정 먼저, 그룹 내 최신순).
//   서버 정렬과 동일 규칙을 클라이언트에서도 보장 (낙관적 업데이트 후 재정렬).
function sortSpecialNotes(notes: SpecialNoteEntry[]): SpecialNoteEntry[] {
  return [...notes].sort((a, b) => {
    const ap = a.is_pinned ? 1 : 0;
    const bp = b.is_pinned ? 1 : 0;
    if (ap !== bp) return bp - ap; // 고정 우선
    return (b.created_at || '').localeCompare(a.created_at || ''); // 최신순
  });
}

// T-20260526-foot-MEDCHART-SYNC: 방문 이력 항목 (진료내역)
interface VisitHistoryEntry {
  id: string;
  checked_in_at: string;
  treatment_kind: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  treatment_memo: any | null;  // JSONB { details: string }
  doctor_note: string | null;
  status: string;
}

// T-20260526-foot-MEDCHART-SYNC: 진료이미지 항목
interface TreatmentImage {
  path: string;
  signedUrl: string;
  name: string;
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface MedicalChartPanelProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  customerId: string | null;
  clinicId: string;
  currentUserRole: string;
  currentUserEmail: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const DIRECTOR_ROLES = ['director', 'admin'];
function canViewDoctorMemo(role: string): boolean {
  return DIRECTOR_ROLES.includes(role);
}

function fmtDateShort(dateStr: string): string {
  try {
    return format(new Date(dateStr), 'yy.MM.dd (EEE)', { locale: ko });
  } catch {
    return dateStr;
  }
}

function fmtDateFull(dateStr: string): string {
  try {
    return format(new Date(dateStr), 'yyyy년 M월 d일 (EEE)', { locale: ko });
  } catch {
    return dateStr;
  }
}

function chartSummary(chart: MedicalChart): string {
  return chart.diagnosis || chart.chief_complaint || chart.clinical_progress || chart.treatment_record || '기록';
}

// T-20260526-foot-VISIT-FOLD-FILTER: 특이사항 판별 기준 (dev 제안: 키워드 매칭 — 현장 확인 필요)
// 제안 기준 ① notes 내 키워드 포함 ② 금기/과민 반응 언급 ③ 부작용 기록
const NOTABLE_KEYWORDS = ['알러지', '주의', '특이', '금기', '과민', '부작용', '금지'];

function hasTreatMemo(c: MedicalChart): boolean {
  return !!c.treatment_record?.trim();
}
function hasDocMemo(c: MedicalChart): boolean {
  return !!c.clinical_progress?.trim() || !!c.doctor_memo?.trim();
}
// T-20260603-foot-CHART-UIUX-ENHANCE AC-12④: 처방 타임라인 필터
function hasRx(c: MedicalChart): boolean {
  return Array.isArray(c.prescription_items) && c.prescription_items.length > 0;
}
function isNotable(c: MedicalChart): boolean {
  const text = [c.clinical_progress, c.doctor_memo, c.diagnosis, c.treatment_record]
    .filter(Boolean).join(' ');
  return NOTABLE_KEYWORDS.some(kw => text.includes(kw));
}

// T-20260603-foot-CHART-UIUX-ENHANCE AC-12: 처방(rx) 필터 추가 (②치료메모 ③진료메모 ④처방 ⑤특이 독립 on/off)
type MemoFilter = 'treat' | 'doc' | 'rx' | 'notable';

const FILTER_OPTIONS: { key: MemoFilter; label: string; chipClass: string }[] = [
  { key: 'treat', label: '치료메모', chipClass: 'bg-blue-600 text-white border-blue-600' },
  { key: 'doc', label: '진료메모', chipClass: 'bg-teal-600 text-white border-teal-600' },
  { key: 'rx', label: '처방', chipClass: 'bg-violet-600 text-white border-violet-600' },
  { key: 'notable', label: '⚠특이', chipClass: 'bg-amber-500 text-white border-amber-500' },
];

// T-20260606-foot-MEDCHART-NIGHT-REFEEDBACK AC-3 (문지은 대표원장):
//   임상경과 `//` 트리거 드롭다운을 textarea 전체 하단이 아닌 '커서(caret) 바로 아래'에 렌더.
//   mirror-div 기법: textarea 박스를 동일 스타일로 복제하고 caret 직전까지의 텍스트 폭/높이로 caret 픽셀 좌표 산출.
//   반환 top 은 caret 라인 '아래'(viewport 기준), left 는 caret 가로 위치. 실패 시 호출측 폴백.
function getTextareaCaretRect(
  ta: HTMLTextAreaElement,
  caretIndex: number,
): { top: number; left: number; lineHeight: number } {
  const style = window.getComputedStyle(ta);
  const div = document.createElement('div');
  const copyProps = [
    'boxSizing', 'overflowX', 'overflowY',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch', 'fontSize', 'fontSizeAdjust',
    'lineHeight', 'fontFamily', 'textAlign', 'textTransform', 'textIndent',
    'letterSpacing', 'wordSpacing', 'tabSize',
  ] as const;
  div.style.position = 'absolute';
  div.style.visibility = 'hidden';
  div.style.whiteSpace = 'pre-wrap';
  div.style.wordWrap = 'break-word';
  div.style.top = '0';
  div.style.left = '0';
  div.style.width = `${ta.offsetWidth}px`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  copyProps.forEach((p) => { (div.style as any)[p] = (style as any)[p]; });
  div.textContent = ta.value.substring(0, caretIndex);
  const span = document.createElement('span');
  span.textContent = ta.value.substring(caretIndex) || '.';
  div.appendChild(span);
  document.body.appendChild(div);
  const taRect = ta.getBoundingClientRect();
  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2 || 18;
  const top = taRect.top + span.offsetTop - ta.scrollTop + lineHeight;
  const left = taRect.left + span.offsetLeft - ta.scrollLeft;
  document.body.removeChild(div);
  return { top, left, lineHeight };
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function MedicalChartPanel({
  open,
  onOpenChange,
  customerId,
  clinicId,
  currentUserRole,
  currentUserEmail,
}: MedicalChartPanelProps) {
  const isDirector = canViewDoctorMemo(currentUserRole);
  const navigate = useNavigate();
  const { profile } = useAuth();
  // AC-9: 현재 로그인 의사 표시명 (이름 > 이메일 > 폴백)
  const currentUserName = profile?.name ?? currentUserEmail ?? '알 수 없음';

  // ── 데이터 ──────────────────────────────────────────────────────────────────
  const [customer, setCustomer] = useState<CustomerBasic | null>(null);
  const [charts, setCharts] = useState<MedicalChart[]>([]);
  const [loading, setLoading] = useState(false);
  // AC-13: 기록자(의사) 이메일 → 표시명 매핑 (user_profiles)
  const [staffNameMap, setStaffNameMap] = useState<Record<string, string>>({});
  const [phraseTemplates, setPhraseTemplates] = useState<PhraseTemplate[]>([]);
  const [prescriptionSets, setPrescriptionSets] = useState<PrescriptionSet[]>([]);
  // T-20260605-foot-RX-SET-EXPLORER-TREE: 처방세트 탭 폴더 트리 — 접힌 폴더 추적.
  // T-20260606-foot-RX-PANEL-UX-5FIX AC-2: 기본 전체 접힘으로 변경(문지은 원장 요청).
  //   데이터 로드 후 1회만 전체 폴더명을 collapsed 집합에 적재(rxFoldersInitRef 가드) — 이후 사용자 토글 보존.
  const [collapsedRxFolders, setCollapsedRxFolders] = useState<Set<string>>(new Set<string>());
  const rxFoldersInitRef = useRef(false);
  // T-20260603-foot-RX-SUPER-PHRASE: 슈퍼상용구 목록
  const [superPhrases, setSuperPhrases] = useState<SuperPhrase[]>([]);
  // T-20260605-foot-RX-SUPER-PHRASE-LOAD-BUG (AC-2 빈 vs 에러 구분): 조회 자체가 실패(RLS/스키마)했는지 추적.
  //   Promise.all 은 supabase 응답을 reject 하지 않고 {data:null,error} 로 resolve → 에러가 빈 목록으로 swallow 되던 문제.
  const [phraseLoadError, setPhraseLoadError] = useState(false);
  const [superLoadError, setSuperLoadError] = useState(false);
  const [visitPayments, setVisitPayments] = useState<VisitPayment[]>([]);
  // T-20260606-foot-DIAGNOSIS-MASTER-MGMT (AC-2 [B]): 진단명 입력은 자동완성/이력 datalist 폐지 →
  //   DiagnosisFolderPicker(폴더 탐색 + 원장별 즐겨찾기) 선택전용으로 전환. 별도 상태 불요(picker 자체조회).
  //   저장값은 순수 상병명(formDx) — medical_charts.diagnosis 저장경로 무변경.

  // ── 선택 차트 (null = 새 기록 모드) ──────────────────────────────────────────
  const [selectedChartId, setSelectedChartId] = useState<string | null>(null);

  // ── 폼 상태 ─────────────────────────────────────────────────────────────────
  const [formDate, setFormDate] = useState('');
  const [formDx, setFormDx] = useState('');
  const [formTx, setFormTx] = useState('');          // 치료사차트 = treatment_record (읽기전용)
  const [formClinical, setFormClinical] = useState(''); // 임상경과
  const [formMemo, setFormMemo] = useState('');       // 원장 전용 메모
  const [formRx, setFormRx] = useState<PrescriptionItem[]>([]); // 처방내역
  // T-20260606-foot-MEDCHART-NIGHT-REFEEDBACK AC-4 (문지은 대표원장): 저장/수정 모드 토글(실수 방지).
  //   신규 작성 = 항상 편집 가능. 저장된 차트 = 진입 시 읽기전용 → [수정] 클릭해야 편집모드 진입.
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);

  // T-20260603-foot-RX-CHART-ENHANCE AC-5: 약품 마스터 검색
  const [rxSearchQuery, setRxSearchQuery] = useState('');
  const [rxSearchResults, setRxSearchResults] = useState<RxCodeResult[]>([]);
  const [rxSearching, setRxSearching] = useState(false);

  // T-20260603-foot-RX-CHART-ENHANCE AC-2: 금기증 확인 게이트
  //   처방 추가 시 prescription_code_id 매칭 금기증이 있으면 모달로 확인 강제.
  //   pendingRxItems = 확인 통과 시 적재할 항목들. gateContras = 표시할 금기 목록.
  //   ackedContraIds = 사용자가 체크한 금기 id 집합(전부 체크해야 진행 가능 — 우회불가).
  const [gateContras, setGateContras] = useState<Contraindication[]>([]);
  const [pendingRxItems, setPendingRxItems] = useState<PrescriptionItem[]>([]);
  const [ackedContraIds, setAckedContraIds] = useState<Set<string>>(new Set());
  const [gateChecking, setGateChecking] = useState(false);
  // T-20260603-foot-RX-CHART-ENHANCE FIX(MSG-20260603-190947): 금기증 조회 실패 시
  //   "우회불가" 보장을 위해 처방 적재를 차단하고 별도 오류 게이트를 띄운다.
  //   사용자가 재시도하거나 명시적 override(관리자 확인 + 감사 로그)를 누르기 전에는 commitRxItems 호출 금지.
  const [gateError, setGateError] = useState<{ items: PrescriptionItem[]; successMsg?: string; codeIds: string[] } | null>(null);

  // ── 임상경과 상용구 autocomplete ───────────────────────────────────────────
  const clinicalRef = useRef<HTMLTextAreaElement>(null);
  const [phrasePopoverVisible, setPhrasePopoverVisible] = useState(false);
  const [phraseQuery, setPhraseQuery] = useState('');

  // ── 우측 패널 탭 (AC-1 + MEDCHART-SYNC → TREATMEMO-CHART-MERGE: 처방세트 / 상용구 / 진료내역 / 진료이미지)
  // T-20260527-foot-TREATMEMO-CHART-MERGE: treat_memo 탭 제거 — [치료사차트] 섹션에 통합
  const [rightTab, setRightTab] = useState<'rx' | 'phrase' | 'super' | 'visit_hist' | 'images'>('rx');
  // T-20260605-foot-RX-PHRASE-CLICK-INSERT: 체크박스 다중선택 → 클릭 시 ✓ 즉시삽입 단일화.
  //   행 클릭 → 그 행만 ✓ 버튼 노출(단일 활성), ✓ 클릭 → 즉시 삽입. (펜차트 PHRASE-MULTISELECT 와 별개 패널)
  const [clickedPhraseId, setClickedPhraseId] = useState<number | null>(null);
  // T-20260606-foot-RX-PANEL-UX-5FIX AC-3: 상용구 탭을 진료차트/펜차트 그룹으로 분리.
  //   펜차트 상용구는 항상 기본 접힘(원장 동선은 진료차트 위주, 펜차트는 보조).
  const [penPhraseCollapsed, setPenPhraseCollapsed] = useState(true);

  // T-20260526-foot-MEDCHART-SYNC: 참고 데이터 상태
  // T-20260527-foot-TREATMEMO-CHART-MERGE: treatMemosLoaded/Loading 제거 (loadData 통합으로 불필요)
  const [treatMemos, setTreatMemos] = useState<TreatmentMemoEntry[]>([]);
  const [visitHistory, setVisitHistory] = useState<VisitHistoryEntry[]>([]);
  const [visitHistLoaded, setVisitHistLoaded] = useState(false);
  const [visitHistLoading, setVisitHistLoading] = useState(false);
  const [treatImages, setTreatImages] = useState<TreatmentImage[]>([]);
  const [treatImagesLoaded, setTreatImagesLoaded] = useState(false);
  const [treatImagesLoading, setTreatImagesLoading] = useState(false);

  // T-20260603-foot-CHART-SPECIAL-NOTE: 특이사항 공용 누적칸 (좌측 타임라인 ⑤)
  const [specialNotes, setSpecialNotes] = useState<SpecialNoteEntry[]>([]);
  const [specialNoteInput, setSpecialNoteInput] = useState('');
  const [specialNoteSaving, setSpecialNoteSaving] = useState(false);
  const [specialNoteOpen, setSpecialNoteOpen] = useState(true);
  // T-20260603-foot-RX-CHART-FOLLOWUP2 #10: 특이사항 핀 토글 진행상태.
  //   ⚠ Rules of Hooks: 반드시 `if (!open) return null` 조기반환(아래) 이전에 선언해야 함.
  //   (T-20260604-foot-RX-CHART-PERSIST-BUG: 조기반환 이후 useState가 있어 open 토글 시
  //    "Rendered more hooks" 크래시로 진료차트 진입 불가 → 본 위치로 상향 이동.)
  const [pinningId, setPinningId] = useState<string | null>(null);

  // T-20260526-foot-VISIT-FOLD-FILTER: 아코디언 + 필터 상태
  const [expandedChartIds, setExpandedChartIds] = useState<Set<string>>(new Set<string>());
  const [memoFilters, setMemoFilters] = useState<Set<MemoFilter>>(new Set<MemoFilter>());

  // ── 데이터 로드 ──────────────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    if (!customerId || !clinicId) return;
    setLoading(true);
    try {
      const [custRes, chartsRes, phrasesRes, rxSetsRes, treatMemosRes, staffRes, superRes, specialNotesRes] = await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any)
          .from('customers')
          .select('id,name,phone,birth_date,chart_number')
          .eq('id', customerId)
          .maybeSingle(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any)
          .from('medical_charts')
          .select('*')
          .eq('customer_id', customerId)
          .eq('clinic_id', clinicId)
          .order('visit_date', { ascending: false }),
        // T-20260605-foot-RX-SUPER-PHRASE-LOAD-BUG (회귀수정): 진료차트 우측 '상용구' 탭 로딩 갭.
        //   기존 T-20260526-foot-MEDCHART-SYNC 가 .eq(phrase_type,'medical_chart') 단일 필터라
        //   현장 상용구 대부분(prod: pen_chart 33 / medical_chart 1)이 0건 노출 → 의사 입장 "불러오기 안됨/미표시".
        //   6/5 SUPER-PHRASE-LOAD-FIX(SuperPhrasesTab)와 동일 루트코즈이나 본 진료차트 패널엔 미전파였음.
        //   필터 완화: 활성 상용구 전체 노출(유형 무관) + phrase_type 보존(배지/정렬용).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any)
          .from('phrase_templates')
          .select('id,category,name,content,shortcut_key,is_active,phrase_type,sort_order')
          .eq('is_active', true)
          .order('sort_order', { ascending: true }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any)
          .from('prescription_sets')
          .select('id,name,items,is_active,folder')
          .eq('is_active', true)
          .order('sort_order', { ascending: true }),
        // T-20260527-foot-TREATMEMO-CHART-MERGE: 치료메모를 loadData에 통합 (드로어 오픈 시 자동 로드)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any)
          .from('customer_treatment_memos')
          .select('id, content, created_by_name, created_at, memo_type')
          .eq('customer_id', customerId)
          .order('created_at', { ascending: false })
          .limit(20),
        // T-20260603-foot-CHART-UIUX-ENHANCE AC-13: 기록자 이메일→표시명 매핑용 스태프 조회
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any)
          .from('user_profiles')
          .select('email,name')
          .eq('clinic_id', clinicId),
        // T-20260603-foot-RX-SUPER-PHRASE: 활성 슈퍼상용구 조회 (진단명+임상경과+처방 묶음)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any)
          .from('super_phrases')
          .select('id,name,diagnosis,clinical_progress,rx_items,is_active,sort_order')
          .eq('is_active', true)
          .order('sort_order', { ascending: true }),
        // T-20260603-foot-CHART-SPECIAL-NOTE: 특이사항 공용 누적칸 (환자 단위, 최신순)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any)
          .from('customer_special_notes')
          .select('id,content,created_by,created_by_name,created_at,is_pinned,pinned_at')
          .eq('customer_id', customerId)
          .eq('clinic_id', clinicId)
          .order('is_pinned', { ascending: false }) // #10 고정 우선
          .order('created_at', { ascending: false }),
      ]);

      if (custRes.data) setCustomer(custRes.data as CustomerBasic);
      const rawCharts: MedicalChart[] = chartsRes.data || [];
      // T-20260605-foot-RX-SUPER-PHRASE-LOAD-BUG: 상용구 — 유형 무관 전체 노출 + 진료차트 우선 안정정렬.
      //   레거시 행(phrase_type null)은 pen_chart 로 간주. AC-2: 조회 실패(error)와 빈 목록을 구분.
      setPhraseLoadError(!!phrasesRes?.error);
      {
        const rows = ((phrasesRes?.data as PhraseTemplate[] | null) ?? []).map((p) => ({
          ...p,
          phrase_type: (p.phrase_type ?? 'pen_chart') as 'pen_chart' | 'medical_chart',
        }));
        // 안정 정렬: 진료차트 유형 우선, 동일 유형 내 기존 sort_order 순서 유지
        rows.sort((a, b) =>
          a.phrase_type === b.phrase_type ? 0 : a.phrase_type === 'medical_chart' ? -1 : 1,
        );
        setPhraseTemplates(rows);
      }
      setPrescriptionSets(rxSetsRes.data || []);
      // T-20260603-foot-RX-SUPER-PHRASE: 슈퍼상용구 — rx_items null 방어. 조회 실패 시 빈 목록(레거시 무영향).
      // T-20260605-foot-RX-SUPER-PHRASE-LOAD-BUG (AC-2): 조회 실패(error)와 0건(빈)을 구분해 패널에서 다른 안내.
      setSuperLoadError(!!superRes?.error);
      setSuperPhrases(
        ((superRes?.data as SuperPhrase[] | null) ?? []).map((s) => ({
          ...s,
          rx_items: (s.rx_items ?? []) as PrescriptionItem[],
        })),
      );
      // T-20260527-foot-TREATMEMO-CHART-MERGE: 치료메모 상태 설정
      setTreatMemos((treatMemosRes.data as TreatmentMemoEntry[]) ?? []);
      // T-20260603-foot-CHART-SPECIAL-NOTE: 특이사항 공용 누적칸 (조회 실패 시 빈 목록 — 레거시 무영향)
      // #10: 핀 우선 재정렬 보장 (is_pinned 컬럼 미적용 환경에서도 안전 — undefined→0)
      setSpecialNotes(sortSpecialNotes((specialNotesRes?.data as SpecialNoteEntry[]) ?? []));
      // T-20260603-foot-CHART-UIUX-ENHANCE AC-13: 기록자 이메일→이름 매핑 구성
      {
        const nameMap: Record<string, string> = {};
        ((staffRes?.data as { email: string | null; name: string | null }[]) ?? []).forEach(s => {
          if (s.email && s.name) nameMap[s.email] = s.name;
        });
        setStaffNameMap(nameMap);
      }

      // director면 chart_doctor_memos merge
      if (isDirector && rawCharts.length > 0) {
        const chartIds = rawCharts.map((c: MedicalChart) => c.id);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: memos } = await (supabase as any)
          .from('chart_doctor_memos')
          .select('medical_chart_id,memo')
          .in('medical_chart_id', chartIds);
        const memoMap: Record<string, string> = {};
        (memos || []).forEach((m: { medical_chart_id: string; memo: string }) => {
          memoMap[m.medical_chart_id] = m.memo;
        });
        setCharts(rawCharts.map((c: MedicalChart) => ({ ...c, doctor_memo: memoMap[c.id] ?? null })));
      } else {
        setCharts(rawCharts);
      }
    } catch {
      toast.error('진료차트 로드 실패 — 잠시 후 다시 시도해주세요');
    } finally {
      setLoading(false);
    }
  }, [customerId, clinicId, isDirector]);

  const loadVisitPayments = useCallback(async (date: string) => {
    if (!customerId || !date) { setVisitPayments([]); return; }
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: checkIns } = await (supabase as any)
        .from('check_ins')
        .select('id')
        .eq('customer_id', customerId)
        .gte('created_at', `${date}T00:00:00+09:00`)
        .lte('created_at', `${date}T23:59:59+09:00`);
      if (!checkIns?.length) { setVisitPayments([]); return; }
      const ids = (checkIns as { id: string }[]).map(c => c.id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: pmts } = await (supabase as any)
        .from('payments')
        .select('id,amount,memo,method')
        .in('check_in_id', ids)
        .eq('payment_type', 'payment');
      setVisitPayments(pmts || []);
    } catch {
      setVisitPayments([]);
    }
  }, [customerId]);

  // ── 폼 채우기 ────────────────────────────────────────────────────────────────

  const resetForm = useCallback((chart?: MedicalChart | null) => {
    const today = format(new Date(), 'yyyy-MM-dd');
    if (chart) {
      setFormDate(chart.visit_date);
      setFormDx(chart.diagnosis || '');
      setFormTx(chart.treatment_record || '');
      setFormClinical(chart.clinical_progress || '');
      setFormMemo(chart.doctor_memo || '');
      setFormRx(chart.prescription_items || []);
      loadVisitPayments(chart.visit_date);
    } else {
      setFormDate(today);
      setFormDx('');
      setFormTx('');
      setFormClinical('');
      setFormMemo('');
      setFormRx([]);
      loadVisitPayments(today);
    }
  }, [loadVisitPayments]);

  // ── 열림/닫힘 lifecycle ───────────────────────────────────────────────────────

  useEffect(() => {
    if (open && customerId) {
      loadData();
      setSelectedChartId(null);
      resetForm(null);
      setEditMode(true); // AC-4: 새 고객 열림 = 신규 작성 모드(편집 가능)
      setPhrasePopoverVisible(false);
      setClickedPhraseId(null);
      setRightTab('rx');
      // T-20260526-foot-MEDCHART-SYNC: 참고 데이터 리셋 (새 고객 열릴 때마다)
      // T-20260527-foot-TREATMEMO-CHART-MERGE: treatMemos는 loadData에서 자동 재로드됨
      setTreatMemos([]);
      setVisitHistory([]);
      setVisitHistLoaded(false);
      setTreatImages([]);
      setTreatImagesLoaded(false);
      // T-20260526-foot-VISIT-FOLD-FILTER: 리셋
      setExpandedChartIds(new Set<string>());
      setMemoFilters(new Set<MemoFilter>());
    } else {
      setCustomer(null);
      setCharts([]);
      setSelectedChartId(null);
    }
  }, [open, customerId, loadData, resetForm]);

  // T-20260606-foot-DIAGNOSIS-MASTER-MGMT (AC-2 [B]): 진단명 자동완성/이력 datalist 로더 제거.
  //   상병 후보는 DiagnosisFolderPicker 가 자체적으로 services(category_label='상병') 단일정본만
  //   조회·폴더탐색·즐겨찾기. super_phrases.diagnosis 보조소스 폐지(자유이력 노출경로 구조적 종결).

  // ESC 키 닫기
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onOpenChange(false); }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [open, onOpenChange]);

  // T-20260606-foot-RX-PANEL-UX-5FIX AC-2: 처방세트 폴더 기본 전체 접힘.
  //   처방세트 로드 후 1회만 전체 폴더명을 collapsed 집합으로 초기화(rxFoldersInitRef 가드).
  //   이후 사용자가 펼친 폴더는 보존(재초기화 안 함). Drawer 재오픈 시 ref 리셋(아래 open=false 처리).
  useEffect(() => {
    if (rxFoldersInitRef.current) return;
    if (prescriptionSets.length === 0) return;
    const NO_FOLDER = '미분류';
    const names = new Set<string>();
    for (const s of prescriptionSets) {
      names.add(s.folder?.trim() ? s.folder.trim() : NO_FOLDER);
    }
    setCollapsedRxFolders(names);
    rxFoldersInitRef.current = true;
  }, [prescriptionSets]);

  // Drawer 닫힐 때 폴더 접힘 초기화 플래그 리셋 → 다음 오픈 시 다시 전체 접힘으로 시작.
  useEffect(() => {
    if (!open) {
      rxFoldersInitRef.current = false;
      setPenPhraseCollapsed(true);
    }
  }, [open]);

  // ── 타임라인 선택 ────────────────────────────────────────────────────────────

  function selectChart(chart: MedicalChart) {
    setSelectedChartId(chart.id);
    resetForm(chart);
    setPhrasePopoverVisible(false);
    setEditMode(false); // AC-4: 저장된 차트 진입 시 읽기전용
  }

  function selectNew() {
    setSelectedChartId(null);
    resetForm(null);
    setPhrasePopoverVisible(false);
    setEditMode(true); // AC-4: 신규 작성은 즉시 편집 가능
  }

  // ── 저장 ─────────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!customerId || !clinicId || !formDate) return;
    // T-20260526-foot-NAV-ARROW-DUMMY: 더미 차트는 저장 불가
    if (selectedChartId?.startsWith('__dummy__')) {
      toast.error('더미 데이터는 저장할 수 없습니다 (실제 고객 데이터 없음)');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        customer_id: customerId,
        clinic_id: clinicId,
        visit_date: formDate,
        chief_complaint: null,    // legacy field — no longer written
        diagnosis: formDx.trim() || null,
        treatment_record: formTx.trim() || null,
        materials_used: null,     // legacy field
        treatment_result: null,   // legacy field
        clinical_progress: formClinical.trim() || null,
        prescription_items: formRx.length > 0 ? (formRx as unknown as Record<string, unknown>[]) : null,
        created_by: currentUserEmail,
        // T-20260606-foot-MEDCHART-RECORDER-NAME AC-3: 기록자 표시명 영구 저장(currentUserName=L302 재사용).
        created_by_name: currentUserName,
        updated_at: new Date().toISOString(),
      };

      let chartId = selectedChartId;
      if (selectedChartId) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (supabase as any)
          .from('medical_charts')
          .update(payload)
          .eq('id', selectedChartId);
        if (error) throw error;
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any)
          .from('medical_charts')
          .insert(payload)
          .select('id')
          .maybeSingle();
        if (error) throw error;
        chartId = data?.id ?? null;
        if (chartId) setSelectedChartId(chartId);
      }

      // director면 doctor_memo upsert (chart_doctor_memos)
      if (isDirector && chartId) {
        const memoTrimmed = formMemo.trim();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: existing } = await (supabase as any)
          .from('chart_doctor_memos')
          .select('id')
          .eq('medical_chart_id', chartId)
          .maybeSingle();
        if (memoTrimmed) {
          if (existing?.id) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (supabase as any)
              .from('chart_doctor_memos')
              .update({ memo: memoTrimmed, updated_at: new Date().toISOString() })
              .eq('id', existing.id);
          } else {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (supabase as any).from('chart_doctor_memos').insert({
              medical_chart_id: chartId,
              customer_id: customerId,
              clinic_id: clinicId,
              memo: memoTrimmed,
              created_by: currentUserEmail,
            });
          }
        }
      }

      toast.success(selectedChartId ? '진료 기록 수정 완료' : '진료 기록 저장 완료');
      // T-20260527-foot-MEDCHART-DATA-LOSS AC-FE: 저장 후 필터 리셋
      // 필터 활성 상태에서 저장 시 새 차트가 필터에 미일치 → 타임라인에서 사라져 보이는 UX 버그 방지
      setMemoFilters(new Set<MemoFilter>());
      setEditMode(false); // AC-4: 저장 완료 → 읽기전용 전환(연속 실수 차단)
      loadData();
    } catch (err: unknown) {
      toast.error(`저장 실패: ${err instanceof Error ? err.message : '알 수 없는 오류'}`);
    } finally {
      setSaving(false);
    }
  };

  // ── 임상경과 상용구 ────────────────────────────────────────────────────────────

  // T-20260526-foot-PHRASE-SLASH AC-2/3: `//` 트리거 (기존 `#` 대체)
  function handleClinicalChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value;
    setFormClinical(value);
    const cursor = e.target.selectionStart ?? value.length;
    const textBefore = value.substring(0, cursor);
    // `//` 입력 후 이어지는 문자를 단축어 query로 캡처
    const match = textBefore.match(/\/\/([^\s/]*)$/);
    if (match) {
      setPhraseQuery(match[1]);
      setPhrasePopoverVisible(true);
    } else {
      setPhrasePopoverVisible(false);
    }
  }

  const filteredPhrases = phraseTemplates.filter(p => {
    if (!phraseQuery) return p.shortcut_key != null;
    return (
      (p.shortcut_key?.startsWith(phraseQuery)) ||
      p.name.includes(phraseQuery)
    );
  }).slice(0, 8);

  // T-20260606-foot-SUPER-PHRASE-CHART-LINK-FIX (AC-2): `//` 트리거에 슈퍼상용구 연결.
  //   기존 `//` 팝오버는 phraseTemplates(일반 상용구)에만 바인딩 → 슈퍼상용구 "연결 안 됨" 재신고.
  //   루트코즈: 핸들러 미연결(데이터 무관). super_phrases 소스를 동일 팝오버에 합류시킨다.
  //   빈 query 면 전체(상위 6) 노출, query 있으면 이름/진단/경과 부분일치.
  const filteredSuperPhrases = superPhrases.filter(sp => {
    if (!phraseQuery) return true;
    return (
      sp.name.includes(phraseQuery) ||
      (sp.diagnosis ?? '').includes(phraseQuery) ||
      (sp.clinical_progress ?? '').includes(phraseQuery)
    );
  }).slice(0, 6);

  function insertPhrase(phrase: PhraseTemplate) {
    // T-20260605-foot-RX-SUPER-PHRASE-LOAD-BUG (AC-4 GUARD): null/빈 상용구 방어 — 빈 내용은 무시.
    if (!phrase || !(phrase.content ?? '').trim()) return;
    const textarea = clinicalRef.current;
    const cursor = textarea?.selectionStart ?? formClinical.length;
    const textBefore = formClinical.substring(0, cursor);
    const textAfter = formClinical.substring(cursor);
    // `//query` 패턴을 상용구 문구로 대체 (AC-3)
    const match = textBefore.match(/\/\/([^\s/]*)$/);
    if (match) {
      const newText = textBefore.substring(0, textBefore.length - match[0].length) + phrase.content + textAfter;
      setFormClinical(newText);
    } else {
      setFormClinical(prev => prev ? prev + '\n' + phrase.content : phrase.content);
    }
    setPhrasePopoverVisible(false);
    setPhraseQuery('');
    setTimeout(() => textarea?.focus(), 50);
  }

  // T-20260606-foot-SUPER-PHRASE-CHART-LINK-FIX (AC-2): `//` 팝오버에서 슈퍼상용구 선택 시.
  //   1) 커서 앞 `//query` 토큰 제거(트리거 텍스트 정리) → 2) applySuperPhrase 로 일괄 적용.
  //   setFormClinical 은 둘 다 함수형 업데이트라 (토큰제거 → 경과 append) 순서가 안전하게 합성됨.
  function applySuperPhraseFromSlash(sp: SuperPhrase) {
    const textarea = clinicalRef.current;
    const cursor = textarea?.selectionStart ?? formClinical.length;
    setFormClinical(prev => {
      const before = prev.substring(0, cursor);
      const after = prev.substring(cursor);
      const m = before.match(/\/\/([^\s/]*)$/);
      return m ? before.substring(0, before.length - m[0].length) + after : prev;
    });
    setPhrasePopoverVisible(false);
    setPhraseQuery('');
    applySuperPhrase(sp); // 진단명·임상경과(누적)·처방(게이트) 일괄 라우팅
    setTimeout(() => textarea?.focus(), 50);
  }

  // ── 우측 패널 — 상용구 클릭 → ✓ 즉시삽입 (T-20260605-foot-RX-PHRASE-CLICK-INSERT) ──
  //   행 클릭 시 단일 활성(같은 행 재클릭=닫기). ✓ 클릭 → insertPhrase(p) 재활용(누적/대체 시맨틱 동일).

  function togglePhraseRow(id: number) {
    setClickedPhraseId(prev => (prev === id ? null : id));
  }

  function confirmInsertPhrase(p: PhraseTemplate) {
    // ✓ 버튼 — 단일 행 즉시 삽입. 기존 insertPhrase 핸들러 재활용(빈/대체 GUARD 포함).
    insertPhrase(p);
    setClickedPhraseId(null);
  }

  // T-20260606-foot-RX-PANEL-UX-5FIX AC-4: 상용구 행 — 왼쪽 체크박스 제거 + 우측 끝 ✓ 비방해 토글.
  //   행 클릭 → 단일 활성(togglePhraseRow). 활성 행만 우측 끝에 ✓ 노출 → 눌러 임상경과에 삽입.
  //   placeholder span(좌측 고정폭) 제거로 텍스트가 왼쪽 정렬되며, ✓ 는 우측 끝에서만 등장(레이아웃 비방해).
  function renderPhraseRow(p: PhraseTemplate) {
    const active = clickedPhraseId === p.id;
    return (
      <div
        key={p.id}
        role="button"
        tabIndex={0}
        onClick={() => togglePhraseRow(p.id)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); togglePhraseRow(p.id); } }}
        className={`flex items-start gap-2 cursor-pointer rounded px-2 py-1.5 transition-colors ${active ? 'bg-teal-50' : 'hover:bg-muted'}`}
        data-testid="phrase-option"
        data-active={active ? 'true' : 'false'}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <span className="text-xs font-medium">{p.name}</span>
            {p.shortcut_key && (
              <span className="text-[10px] text-muted-foreground font-mono">//{p.shortcut_key}</span>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground line-clamp-1 mt-0.5">
            {p.content}
          </p>
        </div>
        {/* AC-4: ✓ 즉시삽입 버튼 — 우측 끝, 활성 행만 노출(비방해) */}
        {active && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); confirmInsertPhrase(p); }}
            className="mt-0.5 flex h-5 w-5 items-center justify-center rounded bg-teal-600 text-white shrink-0 hover:bg-teal-700"
            data-testid="phrase-insert-check"
            aria-label={`${p.name} 삽입`}
          >
            <Check className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    );
  }

  // ── 슈퍼상용구 적용 (T-20260603-foot-RX-SUPER-PHRASE) ────────────────────────
  //   진단명·임상경과·처방내역 3슬롯을 각 영역에 일괄 라우팅. 빈 슬롯은 스킵(Q2).
  //   적용 시맨틱(Q1 dev 기본안):
  //     - 진단명   = 비었으면 채우고, 값 있으면 줄바꿈 누적
  //     - 임상경과 = 누적(append, 기존 상용구 삽입과 동일 패턴)
  //     - 처방내역 = addRxItems() 동일 진입점 재사용 → 누적 + 금기증 게이트 자동 상속
  function applySuperPhrase(sp: SuperPhrase) {
    // T-20260605-foot-RX-SUPER-PHRASE-LOAD-BUG (AC-4 GUARD): null/손상 슈퍼상용구 방어 — 무반응 대신 안전 종료.
    if (!sp) return;
    const applied: string[] = [];

    const dx = (sp.diagnosis ?? '').trim();
    if (dx) {
      setFormDx(prev => (prev.trim() ? `${prev}\n${dx}` : dx));
      applied.push('진단명');
    }

    const clinical = (sp.clinical_progress ?? '').trim();
    if (clinical) {
      setFormClinical(prev => (prev ? `${prev}\n${clinical}` : clinical));
      applied.push('임상경과');
    }

    const items = (sp.rx_items ?? []).filter(it => (it.name ?? '').trim() !== '');
    if (items.length > 0) {
      // 처방은 addRxItems 경유 — 금기증 게이트 상속. 게이트가 뜨면 처방 적재는 그쪽에서 토스트.
      addRxItems(items.map(it => ({ ...it })), `"${sp.name}" 처방 ${items.length}개 항목 추가됨`);
      applied.push(`처방 ${items.length}개`);
    }

    if (applied.length === 0) {
      toast.warning(`"${sp.name}" 슈퍼상용구에 적용할 내용이 없어요`);
      return;
    }
    // 진단명·임상경과 적용 알림(처방은 addRxItems 가 별도 토스트). 처방만 있는 경우 중복 토스트 방지.
    if (applied.some(a => a === '진단명' || a === '임상경과')) {
      toast.success(`"${sp.name}" 적용됨 — ${applied.join(' · ')}`);
    }
  }

  // ── 처방세트 적용 ─────────────────────────────────────────────────────────────

  // T-20260601-foot-RX-SET-ACCUMULATE:
  //   (1) 누적(append) — 기존 처방 목록을 유지한 채 세트 약을 추가 (replace 금지)
  //   (2) 세트=폴더 — set.items(다중 약 묶음) 전체를 일괄 추가 (첫 항목만 X)
  //   (3) 중복 정책 — 기본값: 중복 행 그대로 누적 추가(현장이 직접 삭제)
  //   각 항목은 얕은 복제하여 세트 원본 객체와 참조 공유 방지(JSONB 저장 안전성)
  function loadPrescriptionSet(set: PrescriptionSet) {
    const items = set.items ?? [];
    if (items.length === 0) {
      toast.warning(`"${set.name}" 처방세트에 항목이 없어요`);
      return;
    }
    // AC-2 게이트 경유 — 세트 내 prescription_code_id 보유 약 중 금기증 등록분이 있으면 확인 강제.
    addRxItems(items.map(it => ({ ...it })), `"${set.name}" 처방세트 ${items.length}개 항목 추가됨`);
  }

  // T-20260603-foot-RX-CHART-ENHANCE AC-2: 처방 추가 단일 진입점 — 금기증 게이트.
  //   추가 대상 중 prescription_code_id 가 있는 약에 대해 금기증을 조회.
  //   - 금기 없음 → 즉시 적재
  //   - 금기 있음 → 확인 모달 오픈(pendingRxItems 보관). 사용자가 전체 체크 후 확인해야 적재.
  //   ※ 텍스트 약명매칭 금지 — prescription_code_id 기준만. (오탐 차단 / 의료안전)
  async function addRxItems(items: PrescriptionItem[], successMsg?: string) {
    // T-20260606-foot-MEDCHART-NIGHT-REFEEDBACK AC-4: 읽기전용(저장된 차트·미편집) 상태에선 처방 적재 차단.
    if (isReadOnly) {
      toast.error('[수정] 버튼을 눌러 편집 모드로 전환한 뒤 처방을 추가하세요');
      return;
    }
    // #8-1b(role 게이트): 부원장(vice_director)은 prescription_code_id 없는 자유텍스트 처방 추가 금지.
    //   official 499 코드(addRxFromCode)는 항상 code_id 보유 → 통과. fail-closed: code_id 없으면 차단.
    const roleGate = checkRxRoleGate(currentUserRole, items);
    if (!roleGate.allowed) {
      toast.error(rxRoleGateMessage(roleGate.blockedNames));
      return;
    }
    const codeIds = Array.from(
      new Set(items.map(i => i.prescription_code_id).filter((x): x is string => !!x)),
    );
    if (codeIds.length === 0) {
      // FK 미보유(자유텍스트) → 게이트 제외(허용)
      commitRxItems(items, successMsg);
      return;
    }
    setGateChecking(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('prescription_contraindications')
        .select('id,prescription_code_id,contraindication_text,severity')
        .in('prescription_code_id', codeIds);
      // FIX(MSG-20260603-190947): Supabase 는 HTTP 오류(예: 500)에 throw 하지 않고 error 를 반환.
      //   error 를 명시 검사하지 않으면 data=null → contras=[] → "금기 없음" 오인 적재(우회로).
      //   → error 존재 시 catch 와 동일하게 차단 게이트로 전환.
      if (error) {
        setGateError({ items, successMsg, codeIds });
        toast.error('금기증 조회 실패 — 처방 추가가 차단되었습니다. 재시도하거나 관리자 확인 후 진행하세요.');
        return;
      }
      const contras = (data as Contraindication[]) ?? [];
      if (contras.length === 0) {
        commitRxItems(items, successMsg);
        return;
      }
      // 금기증 존재 → 확인 모달 게이트
      setGateContras(contras);
      setPendingRxItems(items);
      setAckedContraIds(new Set());
    } catch {
      // FIX(MSG-20260603-190947): 금기증 조회 실패 = 안전을 보장할 수 없는 상태.
      //   AC-2 "우회불가" 원칙상 자동 적재 금지. 처방 추가를 차단하고 오류 게이트를 띄운다.
      //   사용자가 재시도 또는 명시적 override(관리자 확인 + 감사 로그)를 선택해야만 진행 가능.
      setGateError({ items, successMsg, codeIds });
      toast.error('금기증 조회 실패 — 처방 추가가 차단되었습니다. 재시도하거나 관리자 확인 후 진행하세요.');
    } finally {
      setGateChecking(false);
    }
  }

  // FIX(MSG-20260603-190947): 조회 실패 게이트 — 재시도(조회 재실행).
  function retryGateError() {
    const e = gateError;
    if (!e) return;
    setGateError(null);
    void addRxItems(e.items, e.successMsg);
  }

  // FIX(MSG-20260603-190947): 조회 실패 게이트 — 명시적 override(관리자 확인).
  //   금기증을 확인하지 못한 채 강제 적재하므로 감사 로그를 남기고 사용자의 명시 클릭이 있을 때만 실행.
  function overrideGateError() {
    const e = gateError;
    if (!e) return;
    // 감사 로그 — 조회 장애 상황에서의 강제 처방 추가 추적용
    console.warn('[RX-CONTRA-GATE][OVERRIDE] 금기증 조회 실패 상태에서 관리자 강제 처방 추가', {
      ticket: 'T-20260603-foot-RX-CHART-ENHANCE',
      codeIds: e.codeIds,
      itemCount: e.items.length,
      at: new Date().toISOString(),
    });
    const { items, successMsg } = e;
    setGateError(null);
    commitRxItems(items, successMsg);
  }

  // FIX(MSG-20260603-190947): 조회 실패 게이트 — 취소(적재 안 함).
  function cancelGateError() {
    setGateError(null);
    toast.info('처방 추가를 취소했습니다');
  }

  // 실제 처방 적재 (게이트 통과 후). 누적(append) 정책 유지.
  function commitRxItems(items: PrescriptionItem[], successMsg?: string) {
    setFormRx(prev => [...prev, ...items.map(it => ({ ...it }))]);
    if (successMsg) toast.success(successMsg);
  }

  // AC-2 게이트 확인 — 전체 금기 항목 체크 시에만 적재 (우회불가).
  function confirmGate() {
    if (gateContras.some(c => !ackedContraIds.has(c.id))) return; // 방어 (버튼 disabled 이중화)
    const items = pendingRxItems;
    setGateContras([]);
    setPendingRxItems([]);
    setAckedContraIds(new Set());
    commitRxItems(items, `처방 ${items.length}개 항목 추가됨 (금기 확인 완료)`);
  }
  function cancelGate() {
    setGateContras([]);
    setPendingRxItems([]);
    setAckedContraIds(new Set());
    toast.info('처방 추가를 취소했습니다');
  }

  // T-20260603-foot-RX-CHART-ENHANCE AC-5: 약품 마스터(prescription_codes) 검색.
  const searchRxCodes = useCallback(async (q: string) => {
    const query = q.trim();
    if (query.length < 1) {
      setRxSearchResults([]);
      return;
    }
    setRxSearching(true);
    try {
      const esc = query.replace(/[%,]/g, ' ');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from('prescription_codes')
        .select('id,name_ko,claim_code,classification,code_source,price_krw')
        .or(`name_ko.ilike.%${esc}%,claim_code.ilike.%${esc}%`)
        .order('code_source', { ascending: false }) // custom(카피약) 우선 노출
        .limit(20);
      setRxSearchResults((data as RxCodeResult[]) ?? []);
    } catch {
      setRxSearchResults([]);
    } finally {
      setRxSearching(false);
    }
  }, []);

  // AC-5: 검색결과 약 1건을 처방내역에 추가 (name·route·classification·code_id 자동채움 → 게이트 경유)
  function addRxFromCode(code: RxCodeResult) {
    const item: PrescriptionItem = {
      name: code.name_ko,
      dosage: '',
      route: classificationToRoute(code.classification),
      classification: code.classification ?? null,
      prescription_code_id: code.id,
      frequency: '1일 3회',
      days: 3,
      notes: '',
    };
    addRxItems([item], `"${code.name_ko}" 추가됨`);
  }

  // T-20260606-foot-RX-SET-REDESIGN AC-R3/R5: 약품 폴더 탐색기에서 약 1건 이상을 처방내역에 추가.
  //   addRxFromCode 와 동일 변환(classification→route, code_id 보존) → addRxItems 단일 진입점(금기 게이트 상속).
  function addRxFromCodes(codes: DrugPick[]) {
    if (codes.length === 0) return;
    const items: PrescriptionItem[] = codes.map((c) => ({
      name: c.name_ko,
      dosage: '',
      route: classificationToRoute(c.classification),
      classification: c.classification ?? null,
      prescription_code_id: c.id,
      frequency: '1일 3회',
      days: 3,
      notes: '',
    }));
    const msg = items.length === 1 ? `"${items[0].name}" 추가됨` : `약품 ${items.length}개 추가됨`;
    void addRxItems(items, msg);
  }

  // T-20260603-foot-RX-CHART-ENHANCE AC-4: 처방내역 행별 횟수·일수 직접 조정.
  //   frequency/days 는 PrescriptionItem 에 이미 분리 필드로 존재 → 순수 FE 인라인 편집
  //   (DB 모델/데이터 이관 불요). 다른 항목은 불변 유지.
  // T-20260604-foot-RX-DRUGINFO-DOSAGE AC-3: dosage(용량) 인라인 편집 추가.
  //   외부 약정보 자동조회(AC-2)는 신뢰 가능한 무료 공개 API 부재(AC-1 조사 결론)로 보류 →
  //   "등록할 때 넣든지"(현장 요청) 수동입력 fallback. dosage 는 PrescriptionItem 기존 필드 +
  //   prescription_items JSONB 영속이라 마이그 불요. 단건 약 검색 추가 시 dosage='' 갭을 점입력으로 메움.
  //   처방세트 등록 dosage 는 종전대로 로드 시 자동 노출(PrescriptionSetsTab ItemRow).
  function updateRxItem(idx: number, field: 'frequency' | 'days' | 'dosage', value: string) {
    setFormRx(prev =>
      prev.map((it, i) => {
        if (i !== idx) return it;
        if (field === 'days') {
          const n = value === '' ? 0 : Math.max(0, Number(value) || 0);
          return { ...it, days: n };
        }
        if (field === 'dosage') {
          return { ...it, dosage: value };
        }
        return { ...it, frequency: value };
      }),
    );
  }

  // T-20260603-foot-MEDCHART-SUPERPHRASE-EXT 2-5: 횟수 = 숫자만 저장(예: 3), "회"는 RxCountInput 배경 suffix.
  //   빈칸=null(미입력). 용법(frequency='1일 3회' 자유텍스트)과 별개 필드(분해 아님).
  function updateRxCount(idx: number, v: number | null) {
    setFormRx(prev => prev.map((it, i) => (i === idx ? { ...it, count: v } : it)));
  }

  // ── 관리 화면 이동 (AC-2: 편집 버튼) ─────────────────────────────────────────

  // T-20260606-foot-RX-PANEL-UX-5FIX AC-5: 관리화면 진입 시 해당 탭 pre-select.
  //   각 우측 패널 버튼이 대응 탭(?tab=)을 넘겨 진료관리(ClinicManagement)가 그 탭으로 바로 열림.
  // T-20260606-foot-RXTOOL-INJURY-MENU-SPLIT: 어드민성 관리 도구가 진료 도구 → '진료관리'로 분리됨에 따라
  //   진입 경로를 /admin/doctor-tools → /admin/clinic-management 로 이전(관리 도구 위치 단일화).
  function handleNavigateToAdmin(tab?: 'super_phrases' | 'phrases' | 'prescriptions') {
    onOpenChange(false);
    navigate(tab ? `/admin/clinic-management?tab=${tab}` : '/admin/clinic-management');
  }

  // T-20260527-foot-TREATMEMO-CHART-MERGE: loadTreatMemos 제거 — loadData()에 통합됨
  // (customer_treatment_memos 쿼리가 loadData Promise.all에 포함)

  // ── T-20260526-foot-MEDCHART-SYNC: 방문 이력 lazy load ────────────────────────
  const loadVisitHistory = useCallback(async () => {
    if (!customerId || visitHistLoaded || visitHistLoading) return;
    setVisitHistLoading(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from('check_ins')
        .select('id, checked_in_at, treatment_kind, treatment_memo, doctor_note, status')
        .eq('customer_id', customerId)
        .order('checked_in_at', { ascending: false })
        .limit(30);
      setVisitHistory((data as VisitHistoryEntry[]) ?? []);
    } catch {
      // graceful
    } finally {
      setVisitHistLoaded(true);
      setVisitHistLoading(false);
    }
  }, [customerId, visitHistLoaded, visitHistLoading]);

  // ── T-20260526-foot-MEDCHART-SYNC: 진료이미지 lazy load ───────────────────────
  const loadTreatImages = useCallback(async () => {
    if (!customerId || treatImagesLoaded || treatImagesLoading) return;
    setTreatImagesLoading(true);
    try {
      const storagePath = `customer/${customerId}/treatment-images`;
      const { data: files } = await supabase.storage
        .from('photos')
        .list(storagePath, { limit: 50, sortBy: { column: 'created_at', order: 'desc' } });
      if (files && files.length > 0) {
        const paths = files
          .filter((f) => f.name && !f.name.startsWith('.'))
          .map((f) => `${storagePath}/${f.name}`);
        const { data: urls } = await supabase.storage.from('photos').createSignedUrls(paths, 3600);
        setTreatImages(
          (urls ?? [])
            .filter((u) => u.signedUrl)
            .map((u, i) => ({ path: paths[i], signedUrl: u.signedUrl as string, name: files[i]?.name ?? '' }))
        );
      }
    } catch {
      // graceful
    } finally {
      setTreatImagesLoaded(true);
      setTreatImagesLoading(false);
    }
  }, [customerId, treatImagesLoaded, treatImagesLoading]);

  // ── 탭 전환 시 lazy load 트리거 ────────────────────────────────────────────────
  // T-20260527-foot-TREATMEMO-CHART-MERGE: treat_memo는 loadData에서 로드 → 탭 트리거 제거
  useEffect(() => {
    if (rightTab === 'visit_hist') loadVisitHistory();
    else if (rightTab === 'images') loadTreatImages();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rightTab]);

  // ── Render ────────────────────────────────────────────────────────────────────

  if (!open) return null;

  // T-20260526-foot-NAV-ARROW-DUMMY (AC-4): 실데이터 없을 때 노란테두리 더미 5건 표시
  const DUMMY_CHARTS: MedicalChart[] = [
    {
      id: '__dummy__1', customer_id: customerId || '', clinic_id: clinicId || '',
      visit_date: '2026-05-20', chief_complaint: null,
      diagnosis: '내성발톱 — 더미 샘플 ①',
      treatment_record: '레이저 시술 15분 (테스트용 데이터)',
      materials_used: null, treatment_result: null,
      clinical_progress: '1회차 시술 후 경과 양호 — 더미 샘플',
      prescription_items: null, created_by: null,
      created_at: '2026-05-20T10:00:00+09:00', updated_at: '2026-05-20T10:00:00+09:00',
    },
    {
      id: '__dummy__2', customer_id: customerId || '', clinic_id: clinicId || '',
      visit_date: '2026-05-13', chief_complaint: null,
      diagnosis: '족저근막염 — 더미 샘플 ②',
      treatment_record: '물리치료 20분 (테스트용 데이터)',
      materials_used: null, treatment_result: null,
      clinical_progress: '2회차 통증 30% 감소 — 더미 샘플',
      prescription_items: null, created_by: null,
      created_at: '2026-05-13T14:00:00+09:00', updated_at: '2026-05-13T14:00:00+09:00',
    },
    {
      id: '__dummy__3', customer_id: customerId || '', clinic_id: clinicId || '',
      visit_date: '2026-05-06', chief_complaint: null,
      diagnosis: '무좀 (백선) — 더미 샘플 ③',
      treatment_record: '레이저 + 연고 처방 (테스트용 데이터)',
      materials_used: null, treatment_result: null,
      clinical_progress: '진균 감소 확인 — 더미 샘플',
      prescription_items: null, created_by: null,
      created_at: '2026-05-06T11:00:00+09:00', updated_at: '2026-05-06T11:00:00+09:00',
    },
    {
      id: '__dummy__4', customer_id: customerId || '', clinic_id: clinicId || '',
      visit_date: '2026-04-29', chief_complaint: null,
      diagnosis: '굳은살 제거 — 더미 샘플 ④',
      treatment_record: '기계적 제거 10분 (테스트용 데이터)',
      materials_used: null, treatment_result: null,
      clinical_progress: '굳은살 80% 제거 완료 — 더미 샘플',
      prescription_items: null, created_by: null,
      created_at: '2026-04-29T15:00:00+09:00', updated_at: '2026-04-29T15:00:00+09:00',
    },
    {
      id: '__dummy__5', customer_id: customerId || '', clinic_id: clinicId || '',
      visit_date: '2026-04-22', chief_complaint: null,
      diagnosis: '티눈 — 더미 샘플 ⑤',
      treatment_record: '티눈 제거술 (테스트용 데이터)',
      materials_used: null, treatment_result: null,
      clinical_progress: '초진 — 티눈 확인 및 계획 수립 — 더미 샘플',
      prescription_items: null, created_by: null,
      created_at: '2026-04-22T09:00:00+09:00', updated_at: '2026-04-22T09:00:00+09:00',
    },
  ];
  // 실데이터 없을 때만 더미 표시
  const displayCharts = charts.length > 0 ? charts : DUMMY_CHARTS;
  const isDummyMode = charts.length === 0;

  // T-20260526-foot-VISIT-FOLD-FILTER: 필터 적용 (OR 로직)
  const filteredDisplayCharts = memoFilters.size === 0
    ? displayCharts
    : displayCharts.filter(c => {
        if (memoFilters.has('treat') && hasTreatMemo(c)) return true;
        if (memoFilters.has('doc') && hasDocMemo(c)) return true;
        if (memoFilters.has('rx') && hasRx(c)) return true;
        if (memoFilters.has('notable') && isNotable(c)) return true;
        return false;
      });

  const expandedCount = filteredDisplayCharts.filter(c => expandedChartIds.has(c.id)).length;
  const allExpanded = filteredDisplayCharts.length > 0 && expandedCount === filteredDisplayCharts.length;

  function expandAll() {
    setExpandedChartIds(prev => {
      const next = new Set(prev);
      filteredDisplayCharts.forEach(c => next.add(c.id));
      return next;
    });
  }
  function collapseAll() {
    setExpandedChartIds(prev => {
      const next = new Set(prev);
      filteredDisplayCharts.forEach(c => next.delete(c.id));
      return next;
    });
  }
  function toggleExpandChart(id: string) {
    setExpandedChartIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleFilter(f: MemoFilter) {
    setMemoFilters(prev => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f); else next.add(f);
      return next;
    });
  }

  const selectedChart = displayCharts.find(c => c.id === selectedChartId) ?? null;
  // T-20260606-foot-MEDCHART-NIGHT-REFEEDBACK AC-4: 저장된 차트(선택됨)는 편집모드 진입 전까지 읽기전용.
  //   신규 작성(selectedChartId=null)은 항상 편집 가능. 더미도 selectedChartId 보유 → 읽기전용(저장 자체 불가).
  const isReadOnly = !!selectedChartId && !editMode;
  const chartsIdx = selectedChart ? displayCharts.indexOf(selectedChart) : -1;

  // AC-13: created_by(이메일) → 표시명 변환. 매핑 없으면 이메일 로컬파트 폴백.
  function recorderName(createdBy: string | null | undefined): string | null {
    if (!createdBy) return null;
    return staffNameMap[createdBy] ?? createdBy.split('@')[0] ?? createdBy;
  }

  // T-20260603-foot-CHART-SPECIAL-NOTE AC-2: 특이사항 1줄 누적 추가 (기존 항목 변경 X)
  async function addSpecialNote() {
    const content = specialNoteInput.trim();
    if (!content) return;
    if (!customerId || !clinicId) { toast.error('고객 정보가 없습니다'); return; }
    setSpecialNoteSaving(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('customer_special_notes')
        .insert({
          customer_id: customerId,
          clinic_id: clinicId,
          content,
          created_by: currentUserEmail,
          created_by_name: currentUserName,
        })
        .select('id,content,created_by,created_by_name,created_at')
        .single();
      if (error) throw error;
      // 누적 보존: 기존 목록 위에 신규 항목 추가 후 핀 우선 재정렬
      setSpecialNotes(prev => sortSpecialNotes([data as SpecialNoteEntry, ...prev]));
      setSpecialNoteInput('');
      toast.success('특이사항이 추가되었습니다');
    } catch {
      toast.error('특이사항 추가 실패 — 잠시 후 다시 시도해주세요');
    } finally {
      setSpecialNoteSaving(false);
    }
  }

  // T-20260603-foot-RX-CHART-FOLLOWUP2 #10: 특이사항 핀 토글(맨위로 고정).
  //   클리닉 공용 표식 — 타인 작성 항목도 고정 가능. set_special_note_pin RPC 로 컬럼 단위 변경.
  //   (pinningId useState 는 Rules of Hooks 준수 위해 조기반환 이전 상단으로 이동 — PERSIST-BUG.)
  async function toggleSpecialNotePin(note: SpecialNoteEntry) {
    const next = !note.is_pinned;
    setPinningId(note.id);
    // 낙관적 업데이트 (즉시 재정렬)
    setSpecialNotes(prev =>
      sortSpecialNotes(prev.map(n => (n.id === note.id ? { ...n, is_pinned: next } : n))),
    );
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).rpc('set_special_note_pin', {
        p_note_id: note.id,
        p_pinned: next,
      });
      if (error) throw error;
    } catch {
      // 실패 시 롤백
      setSpecialNotes(prev =>
        sortSpecialNotes(prev.map(n => (n.id === note.id ? { ...n, is_pinned: note.is_pinned } : n))),
      );
      toast.error('고정 상태 변경 실패 — 잠시 후 다시 시도해주세요');
    } finally {
      setPinningId(null);
    }
  }

  return createPortal(
    <>
      {/* 백드롭 — 클릭 시 닫힘 (AC-2 Drawer 외부 클릭 닫힘) */}
      <div
        className="fixed inset-0 z-[80] bg-black/40"
        onClick={() => onOpenChange(false)}
        aria-hidden="true"
        data-testid="medical-chart-backdrop"
      />

      {/* Drawer 패널 — 우측 슬라이드 인 (AC-2) */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="진료차트"
        className="fixed right-0 top-0 z-[90] h-full bg-background shadow-2xl flex flex-col outline-none animate-in slide-in-from-right duration-300"
        style={{ width: 'min(97vw, 1440px)' }}
        data-testid="medical-chart-drawer"
      >
        {/* ── 헤더 ─────────────────────────────────────────────────────────────── */}
        <div className="flex-none flex items-center justify-between px-5 py-3 border-b bg-background shadow-sm">
          <div className="flex items-center gap-3">
            <Stethoscope className="h-4 w-4 text-teal-600 shrink-0" />
            <span className="text-base font-bold text-teal-700">진료차트</span>
            {customer && (
              <div className="flex items-center gap-2 ml-1">
                <span className="font-semibold">{customer.name}</span>
                {customer.chart_number && (
                  <span className="text-xs text-muted-foreground font-mono">#{customer.chart_number}</span>
                )}
                <span className="text-xs text-muted-foreground">{formatPhone(customer.phone)}</span>
                {customer.birth_date && (
                  <span className="text-xs text-muted-foreground">
                    {/^\d{6}$/.test(customer.birth_date)
                      ? `${customer.birth_date.slice(0, 2)}/${customer.birth_date.slice(2, 4)}/${customer.birth_date.slice(4, 6)}`
                      : customer.birth_date}
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* AC-9: 현재 로그인 의사 상시 표시 */}
            <span
              className="flex items-center gap-1 rounded-full bg-teal-50 border border-teal-200 px-2.5 py-1 text-xs font-semibold text-teal-700"
              data-testid="current-doctor-name"
              title="현재 로그인 의사"
            >
              <Stethoscope className="h-3.5 w-3.5" />
              {currentUserName}
            </span>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              aria-label="닫기"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* ── 본문: 타임라인 | 진료폼 | 우측 콘텐츠 패널 ─────────────────────── */}
        <div className="flex-1 flex overflow-hidden">
          {loading ? (
            <div className="flex-1 flex items-center justify-center">
              <Loader2 className="h-10 w-10 animate-spin text-teal-400" />
            </div>
          ) : (
            <>
              {/* ── 좌측: 경과 타임라인 (AC-4 + T-20260526-foot-VISIT-FOLD-FILTER) ── */}
              <div
                className="w-56 flex-shrink-0 border-r bg-muted/10 flex flex-col overflow-hidden"
                data-testid="medical-chart-timeline"
              >
                {/* 새 기록 버튼 */}
                <div className="flex-none p-2 border-b">
                  <button
                    type="button"
                    onClick={selectNew}
                    className={`w-full flex items-center justify-center gap-1 rounded-md py-2 text-sm font-medium transition-colors ${
                      selectedChartId === null
                        ? 'bg-teal-600 text-white'
                        : 'border border-teal-300 text-teal-700 hover:bg-teal-50'
                    }`}
                    data-testid="medical-chart-new-btn"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    새 기록
                  </button>
                </div>

                {/* T-20260603-foot-CHART-SPECIAL-NOTE: ⑤ 특이사항 공용 누적칸 (환자 단위, 날짜 분기 없음) */}
                <div className="flex-none border-b bg-amber-50/40" data-testid="special-note-section">
                  <button
                    type="button"
                    onClick={() => setSpecialNoteOpen(o => !o)}
                    className="w-full flex items-center justify-between gap-1 px-2 py-1.5 hover:bg-amber-50 transition-colors"
                    data-testid="special-note-toggle"
                    aria-expanded={specialNoteOpen}
                  >
                    <span className="flex items-center gap-1 text-[10px] font-semibold text-amber-700 uppercase tracking-wide">
                      <AlertTriangle className="h-3 w-3" />
                      특이사항
                      {specialNotes.length > 0 && (
                        <span className="text-[9px] text-amber-600 tabular-nums">({specialNotes.length})</span>
                      )}
                    </span>
                    <ChevronDown
                      className={`h-3 w-3 text-amber-600 transition-transform duration-200 ${specialNoteOpen ? 'rotate-180' : ''}`}
                    />
                  </button>

                  {specialNoteOpen && (
                    <div className="px-2 pb-2 space-y-1.5">
                      {/* 누적 항목 목록 (최신순, 기존 항목 불변 — read-only 표시) */}
                      <div className="max-h-40 overflow-y-auto space-y-1" data-testid="special-note-list">
                        {specialNotes.length === 0 ? (
                          <p className="text-[10px] text-muted-foreground italic py-1">등록된 특이사항 없음</p>
                        ) : (
                          specialNotes.map(note => (
                            <div
                              key={note.id}
                              className={`rounded border px-1.5 py-1 ${note.is_pinned ? 'border-amber-400 bg-amber-100/70 ring-1 ring-amber-300' : 'border-amber-200 bg-white'}`}
                              data-testid="special-note-item"
                              data-pinned={note.is_pinned ? 'true' : 'false'}
                            >
                              <div className="flex items-start justify-between gap-1">
                                <p className="text-[10px] text-gray-800 whitespace-pre-wrap leading-snug break-words flex-1">
                                  {note.content}
                                </p>
                                {/* #10: 핀 고정 토글 (맨위로) */}
                                <button
                                  type="button"
                                  onClick={() => toggleSpecialNotePin(note)}
                                  disabled={pinningId === note.id}
                                  className={`shrink-0 -mr-0.5 -mt-0.5 rounded p-0.5 transition-colors disabled:opacity-40 ${note.is_pinned ? 'text-amber-700 hover:text-amber-900' : 'text-gray-300 hover:text-amber-600'}`}
                                  title={note.is_pinned ? '고정 해제' : '맨위로 고정'}
                                  aria-label={note.is_pinned ? '고정 해제' : '맨위로 고정'}
                                  aria-pressed={!!note.is_pinned}
                                  data-testid="special-note-pin-btn"
                                >
                                  {pinningId === note.id
                                    ? <Loader2 className="h-3 w-3 animate-spin" />
                                    : note.is_pinned
                                      ? <Pin className="h-3 w-3 fill-current" />
                                      : <PinOff className="h-3 w-3" />}
                                </button>
                              </div>
                              <div className="flex items-center justify-between gap-1 mt-0.5 text-[8px] text-muted-foreground">
                                <span className="truncate" data-testid="special-note-recorder">
                                  {note.created_by_name || recorderName(note.created_by) || '기록자 미상'}
                                </span>
                                <span className="shrink-0 tabular-nums">
                                  {(() => {
                                    try { return format(new Date(note.created_at), 'yy.MM.dd HH:mm'); }
                                    catch { return ''; }
                                  })()}
                                </span>
                              </div>
                            </div>
                          ))
                        )}
                      </div>

                      {/* 1줄 추가 입력 (누적 append — 기존 항목 변경 안 됨) */}
                      <div className="flex items-end gap-1">
                        <Textarea
                          value={specialNoteInput}
                          onChange={e => setSpecialNoteInput(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              if (!specialNoteSaving) addSpecialNote();
                            }
                          }}
                          placeholder="특이사항 입력 후 추가"
                          rows={1}
                          className="min-h-[32px] text-[10px] resize-none bg-white placeholder:text-gray-400"
                          data-testid="special-note-input"
                        />
                        <button
                          type="button"
                          onClick={addSpecialNote}
                          disabled={specialNoteSaving || !specialNoteInput.trim()}
                          className="shrink-0 rounded-md bg-amber-600 px-2 py-1.5 text-[10px] font-semibold text-white hover:bg-amber-700 disabled:opacity-40 transition-colors"
                          data-testid="special-note-add-btn"
                        >
                          {specialNoteSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : '추가'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* T-20260526-foot-VISIT-FOLD-FILTER: 메모 필터 + 전체 열기/접기 */}
                <div className="flex-none px-2 pt-2 pb-2 border-b space-y-1.5">
                  {/* 메모 종류 필터 chips */}
                  <div className="flex items-center gap-1 flex-wrap">
                    <span className="text-[9px] font-semibold text-muted-foreground shrink-0">필터</span>
                    {FILTER_OPTIONS.map(({ key, label, chipClass }) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => toggleFilter(key)}
                        className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold transition-colors border ${
                          memoFilters.has(key)
                            ? chipClass
                            : 'border-gray-300 text-muted-foreground hover:border-teal-400 hover:text-teal-700'
                        }`}
                        data-testid={`memo-filter-${key}`}
                      >
                        {label}
                      </button>
                    ))}
                    {memoFilters.size > 0 && (
                      <button
                        type="button"
                        onClick={() => setMemoFilters(new Set<MemoFilter>())}
                        className="text-[9px] text-red-500 hover:text-red-700 underline ml-0.5"
                        data-testid="memo-filter-clear"
                      >
                        전체
                      </button>
                    )}
                  </div>

                  {/* 전체 열기/접기 + 카운트 */}
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[9px] text-muted-foreground tabular-nums shrink-0">
                      {expandedCount}/{filteredDisplayCharts.length}건 펼침
                      {memoFilters.size > 0 && (
                        <span className="ml-0.5 text-amber-600">(전체 {displayCharts.length})</span>
                      )}
                    </span>
                    <div className="flex gap-0.5 shrink-0">
                      <button
                        type="button"
                        onClick={expandAll}
                        disabled={filteredDisplayCharts.length === 0 || allExpanded}
                        className="text-[9px] text-teal-600 hover:text-teal-800 disabled:opacity-30 border border-teal-200 rounded px-1 py-0.5 hover:bg-teal-50 transition-colors"
                        data-testid="expand-all-btn"
                        title="모두 펼치기"
                      >
                        모두펼침
                      </button>
                      <button
                        type="button"
                        onClick={collapseAll}
                        disabled={expandedCount === 0}
                        className="text-[9px] text-gray-600 hover:text-gray-800 disabled:opacity-30 border border-gray-200 rounded px-1 py-0.5 hover:bg-gray-50 transition-colors"
                        data-testid="collapse-all-btn"
                        title="모두 접기"
                      >
                        모두접기
                      </button>
                    </div>
                  </div>
                </div>

                {/* 경과 타임라인 레이블 */}
                <div className="flex-none px-2 pt-2 pb-1">
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                    경과 타임라인
                    {isDummyMode && (
                      <span className="ml-1 text-yellow-600 font-bold">[더미]</span>
                    )}
                  </span>
                </div>

                <div className="flex-1 overflow-y-auto">
                  {/* 더미 모드 배너 */}
                  {isDummyMode && (
                    <div className="mx-2 mb-1 rounded border-2 border-yellow-400 bg-yellow-50 px-2 py-1 text-[10px] text-yellow-800 font-semibold">
                      실데이터 없음 — 더미 샘플 표시 중
                    </div>
                  )}

                  {/* 필터 결과 없음 */}
                  {memoFilters.size > 0 && filteredDisplayCharts.length === 0 && (
                    <div className="mx-2 mt-2 rounded border border-dashed p-3 text-[10px] text-muted-foreground text-center">
                      해당 메모가 있는<br />방문 기록 없음
                    </div>
                  )}

                  {/* 아코디언 엔트리 목록 */}
                  {filteredDisplayCharts.map(chart => {
                    const isDummyEntry = chart.id.startsWith('__dummy__');
                    const isExpanded = expandedChartIds.has(chart.id);
                    const hasTreat = hasTreatMemo(chart);
                    const hasDoc = hasDocMemo(chart);
                    const hasRxItems = hasRx(chart);
                    const notable = isNotable(chart);
                    // T-20260606-foot-MEDCHART-RECORDER-NAME AC-5: DB 영구 스냅샷 우선, 없으면 동적 폴백.
                    const recorder = chart.created_by_name || recorderName(chart.created_by);
                    return (
                      <div
                        key={chart.id}
                        className="border-b border-border/40"
                        style={isDummyEntry ? { outline: '2px solid #facc15', outlineOffset: '-2px' } : undefined}
                        data-testid="medical-chart-timeline-entry"
                      >
                        {/* 엔트리 헤더 */}
                        <div className="flex items-stretch">
                          {/* 클릭 → 센터 폼 선택 */}
                          <button
                            type="button"
                            onClick={() => selectChart(chart)}
                            className={`flex-1 text-left px-3 py-2.5 hover:bg-muted transition-colors min-w-0 ${
                              selectedChartId === chart.id
                                ? 'bg-teal-50 border-l-2 border-l-teal-500'
                                : ''
                            }`}
                          >
                            <div className="text-[11px] font-semibold text-teal-700 leading-tight">
                              {fmtDateShort(chart.visit_date)}
                              {isDummyEntry && (
                                <span className="ml-1 text-[9px] text-yellow-600 font-bold">더미</span>
                              )}
                            </div>
                            <div className="text-[10px] text-muted-foreground truncate mt-0.5">
                              {chartSummary(chart)}
                            </div>
                            {/* 메모 종류 배지 */}
                            <div className="flex gap-0.5 mt-0.5 flex-wrap">
                              {hasTreat && (
                                <span className="text-[8px] bg-blue-50 text-blue-600 border border-blue-200 rounded-full px-1 leading-4">치료</span>
                              )}
                              {hasDoc && (
                                <span className="text-[8px] bg-teal-50 text-teal-600 border border-teal-200 rounded-full px-1 leading-4">진료</span>
                              )}
                              {hasRxItems && (
                                <span className="text-[8px] bg-violet-50 text-violet-600 border border-violet-200 rounded-full px-1 leading-4">처방</span>
                              )}
                              {notable && (
                                <span className="text-[8px] bg-amber-50 text-amber-600 border border-amber-200 rounded-full px-1 leading-4">⚠특이</span>
                              )}
                            </div>
                            {/* AC-13: 기록자(의사) 표시 */}
                            {recorder && (
                              <div className="text-[9px] text-muted-foreground mt-0.5 truncate" data-testid="timeline-recorder">
                                기록자 {recorder}
                              </div>
                            )}
                          </button>
                          {/* 아코디언 토글 버튼 */}
                          <button
                            type="button"
                            onClick={() => toggleExpandChart(chart.id)}
                            className="px-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex items-center shrink-0"
                            aria-label={isExpanded ? '접기' : '펼치기'}
                            data-testid={`chart-accordion-toggle-${chart.id}`}
                          >
                            <ChevronDown
                              className={`h-3 w-3 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                            />
                          </button>
                        </div>

                        {/* 아코디언 확장 콘텐츠 */}
                        {isExpanded && (
                          <div
                            className="px-3 pb-2.5 pt-1.5 space-y-1.5 border-t border-border/20 bg-muted/5"
                            data-testid={`chart-accordion-content-${chart.id}`}
                          >
                            {hasTreat && (
                              <div>
                                <span className="text-[8px] font-bold text-blue-600 uppercase tracking-wide">치료메모</span>
                                <p className="text-[10px] text-gray-700 line-clamp-4 whitespace-pre-wrap leading-relaxed mt-0.5">
                                  {chart.treatment_record}
                                </p>
                              </div>
                            )}
                            {chart.clinical_progress && (
                              <div>
                                <span className="text-[8px] font-bold text-teal-600 uppercase tracking-wide">임상경과</span>
                                <p className="text-[10px] text-gray-700 line-clamp-4 whitespace-pre-wrap leading-relaxed mt-0.5">
                                  {chart.clinical_progress}
                                </p>
                              </div>
                            )}
                            {isDirector && chart.doctor_memo && (
                              <div>
                                <span className="text-[8px] font-bold text-red-600 uppercase tracking-wide">진료메모</span>
                                <p className="text-[10px] text-gray-700 line-clamp-4 whitespace-pre-wrap leading-relaxed mt-0.5">
                                  {chart.doctor_memo}
                                </p>
                              </div>
                            )}
                            {/* AC-12④: 처방 타임라인 — 처방 항목 요약 */}
                            {hasRxItems && (
                              <div>
                                <span className="text-[8px] font-bold text-violet-600 uppercase tracking-wide">처방</span>
                                <p className="text-[10px] text-gray-700 line-clamp-3 leading-relaxed mt-0.5">
                                  {(chart.prescription_items ?? []).map(rx => rx.name).filter(Boolean).join(', ')}
                                </p>
                              </div>
                            )}
                            {notable && (
                              <div className="mt-0.5">
                                <span className="text-[9px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 font-semibold">
                                  ⚠ 특이사항 감지
                                </span>
                              </div>
                            )}
                            {!hasTreat && !chart.clinical_progress && !(isDirector && chart.doctor_memo) && (
                              <p className="text-[10px] text-muted-foreground italic">저장된 메모 없음</p>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* ── 중앙: 진료기록 폼 (AC-1 좌측 컬럼) ─────────────────────────── */}
              <div className="flex-1 overflow-y-auto p-5 border-r" data-testid="medical-chart-form">
                {/* AC-6: 불필요 여백 제거 — 폼 가로 폭 확대(max-w-2xl→max-w-5xl) */}
                <div className="max-w-5xl space-y-4">

                  {/* 타이틀 */}
                  <div className="flex items-center gap-2 pb-1.5 border-b flex-wrap">
                    <span className="text-sm font-semibold text-teal-700">
                      {selectedChartId
                        ? `진료 기록 ${selectedChartId.startsWith('__dummy__') ? '[더미]' : '수정'} — ${fmtDateFull(formDate)}`
                        : '새 진료 기록'}
                    </span>
                    {/* T-20260526-foot-NAV-ARROW-DUMMY: 방문 레코드 간 좌/우 화살표 네비게이션 (AC-2/3) */}
                    {selectedChartId && chartsIdx >= 0 && (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            const prev = displayCharts[chartsIdx - 1];
                            if (prev) selectChart(prev);
                          }}
                          disabled={chartsIdx <= 0}
                          className="rounded p-0.5 hover:bg-muted disabled:opacity-30 transition-colors"
                          aria-label="이전 기록"
                          title="이전 방문 기록"
                          data-testid="chart-nav-prev"
                        >
                          <ChevronLeft className="h-3.5 w-3.5 text-teal-600" />
                        </button>
                        <Badge variant="outline" className="text-[10px] px-1.5">
                          {chartsIdx + 1}/{displayCharts.length}회차
                        </Badge>
                        <button
                          type="button"
                          onClick={() => {
                            const next = displayCharts[chartsIdx + 1];
                            if (next) selectChart(next);
                          }}
                          disabled={chartsIdx >= displayCharts.length - 1}
                          className="rounded p-0.5 hover:bg-muted disabled:opacity-30 transition-colors"
                          aria-label="다음 기록"
                          title="다음 방문 기록"
                          data-testid="chart-nav-next"
                        >
                          <ChevronRight className="h-3.5 w-3.5 text-teal-600" />
                        </button>
                      </div>
                    )}
                    {isDummyMode && selectedChartId?.startsWith('__dummy__') && (
                      <span
                        className="text-[10px] text-yellow-700 font-semibold px-1.5 rounded"
                        style={{ border: '2px solid yellow' }}
                      >
                        더미 — 저장 불가
                      </span>
                    )}
                    {/* T-20260606-foot-MEDCHART-NIGHT-REFEEDBACK AC-2: 기록자(작성자) 표시는 상단 '로그인 계정 인디케이터'
                        오인을 피해 본문 하단 서명 위치로 이동(아래 진료메모 다음 서명 블록 참조). 상단 미표시. */}
                  </div>

                  {/* 진료일 */}
                  <div>
                    <label className="block text-xs font-semibold text-muted-foreground mb-1">진료일</label>
                    <Input
                      type="date"
                      value={formDate}
                      onChange={(e) => { setFormDate(e.target.value); loadVisitPayments(e.target.value); }}
                      disabled={isReadOnly}
                      className="h-9 text-sm max-w-[180px] disabled:opacity-100 disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed"
                      data-testid="medical-chart-date"
                    />
                  </div>

                  {/* 진단명 — T-20260606-foot-DIAGNOSIS-MASTER-MGMT (AC-2 [B] + AC-3 [C]):
                      자동완성/이력 datalist 폐지 → 폴더 탐색 드롭다운(등록 상병만 선택) + 원장별 즐겨찾기.
                      넓게/오른쪽 아래로 확장. 저장값=순수 상병명(formDx), medical_charts.diagnosis 저장경로 무변경. */}
                  <div>
                    <label className="block text-xs font-semibold text-muted-foreground mb-1">
                      진단명
                      <span className="ml-1 text-[10px] text-teal-600 font-normal">· 등록 상병명 폴더 선택</span>
                    </label>
                    <DiagnosisFolderPicker
                      value={formDx}
                      onChange={setFormDx}
                      clinicId={clinicId}
                      disabled={isReadOnly}
                      data-testid="medical-chart-diagnosis"
                    />
                  </div>

                  {/* 치료·시술 — 결제내역 자동 연동 (readonly) */}
                  {visitPayments.length > 0 && (
                    <div>
                      <label className="block text-xs font-semibold text-muted-foreground mb-1">
                        치료·시술{' '}
                        <span className="font-normal text-teal-600">(결제내역 자동 연동)</span>
                      </label>
                      <div className="rounded-lg border bg-muted/20 px-3 py-2 space-y-1">
                        {visitPayments.map(pmt => (
                          <div key={pmt.id} className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">{pmt.memo || '결제 항목'}</span>
                            <span className="font-medium">{formatAmount(pmt.amount)}원</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 치료사차트 — 읽기전용 (AC-3) + T-20260527-foot-TREATMEMO-CHART-MERGE: 치료메모 통합 */}
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <label className="text-xs font-semibold text-muted-foreground">치료사차트</label>
                      <span className="text-[10px] text-muted-foreground bg-gray-100 rounded px-1.5 py-0.5">읽기전용</span>
                    </div>
                    <Textarea
                      value={formTx}
                      readOnly
                      disabled
                      placeholder="치료사가 기록한 내용이 여기 표시됩니다"
                      rows={7}
                      className="text-sm resize-none bg-gray-50 text-gray-500 cursor-not-allowed placeholder:text-gray-300 disabled:opacity-100 min-h-[8rem]"
                      data-testid="medical-chart-treatment"
                    />
                    {/* T-20260527-foot-TREATMEMO-CHART-MERGE AC-1/3/4: 치료메모 이력 통합 표시 */}
                    {treatMemos.length > 0 && (
                      <div className="mt-2 space-y-1.5" data-testid="treat-memo-in-chart-section">
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className="text-[10px] font-semibold text-blue-600 uppercase tracking-wide">치료메모 이력</span>
                          <span className="text-[9px] text-muted-foreground bg-muted rounded px-1.5 py-0.5">읽기전용</span>
                        </div>
                        {treatMemos.map((memo) => (
                          <div
                            key={memo.id}
                            className="rounded border bg-blue-50/40 border-blue-100 px-2.5 py-2 space-y-1"
                            data-testid="treat-memo-item"
                          >
                            <p className="text-[11px] text-gray-800 whitespace-pre-wrap leading-relaxed">{memo.content}</p>
                            <div className="flex items-center justify-between gap-1">
                              <span className="text-[9px] text-muted-foreground">{memo.created_by_name ?? '알 수 없음'}</span>
                              <span className="text-[9px] text-muted-foreground tabular-nums">{fmtDateShort(memo.created_at)}</span>
                            </div>
                            {memo.memo_type && (
                              <span className="text-[9px] text-blue-600 bg-blue-100 rounded px-1 py-0.5">{memo.memo_type}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* 임상경과 — 상용구 단축어 (우측 패널로 이동, // autocomplete 유지) */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-semibold text-muted-foreground">임상경과</label>
                      <span className="text-[10px] text-muted-foreground">//단축어 입력 시 자동완성</span>
                    </div>

                    <div className="relative">
                      <Textarea
                        ref={clinicalRef}
                        value={formClinical}
                        onChange={handleClinicalChange}
                        onBlur={() => { setTimeout(() => setPhrasePopoverVisible(false), 200); }}
                        readOnly={isReadOnly}
                        placeholder="임상경과를 입력하세요  예: //통증감소"
                        rows={13}
                        className={`text-sm resize-y placeholder:text-gray-300 min-h-[16rem] ${isReadOnly ? 'bg-gray-50 text-gray-500 cursor-not-allowed' : ''}`}
                        data-testid="medical-chart-clinical"
                      />

                      {/* 단축어 팝오버 — // 트리거 autocomplete
                          T-20260606-foot-SUPER-PHRASE-CHART-LINK-FIX:
                          AC-1: drawer(z-90) 내부 absolute 라 상위 stacking 에 갇혀 "뒤로 열림" → document.body 로 portal +
                                position:fixed + z-[200] 으로 항상 최상위 렌더(클리핑/뒤로깔림 제거).
                          AC-2: 슈퍼상용구 + 일반 상용구 합류 노출. 후보 0건이어도 팝오버는 열되 빈 상태 안내(하드 게이팅 금지). */}
                      {phrasePopoverVisible && (() => {
                        const ta = clinicalRef.current;
                        if (!ta) return null;
                        const POPOVER_MAX = 300;
                        const POPOVER_W = 288;
                        // AC-3: 커서(caret) 좌표 기준 렌더 (textarea 전체 하단 X). 계산 실패 시 textarea rect 폴백.
                        let anchorTop: number;
                        let anchorLeft: number;
                        let lineH = 18;
                        try {
                          const caret = getTextareaCaretRect(ta, ta.selectionStart ?? ta.value.length);
                          anchorTop = caret.top;
                          anchorLeft = caret.left;
                          lineH = caret.lineHeight;
                        } catch {
                          const rect = ta.getBoundingClientRect();
                          anchorTop = rect.bottom;
                          anchorLeft = rect.left;
                        }
                        const spaceBelow = window.innerHeight - anchorTop;
                        const top = spaceBelow > POPOVER_MAX
                          ? anchorTop + 4
                          : Math.max(8, anchorTop - lineH - POPOVER_MAX - 4);
                        const left = Math.min(Math.max(8, anchorLeft), window.innerWidth - POPOVER_W - 8);
                        const hasAny = filteredSuperPhrases.length > 0 || filteredPhrases.length > 0;
                        return createPortal(
                          <div
                            style={{ position: 'fixed', top, left, width: 288, maxHeight: POPOVER_MAX }}
                            className="z-[200] overflow-y-auto rounded-lg border bg-popover shadow-xl"
                            onMouseDown={(e) => e.preventDefault()}
                            data-testid="phrase-autocomplete-popover"
                          >
                            {!hasAny ? (
                              <div className="px-3 py-3 text-[11px] text-muted-foreground text-center" data-testid="phrase-autocomplete-empty">
                                일치하는 상용구·슈퍼상용구 없음
                              </div>
                            ) : (
                              <>
                                {/* 슈퍼상용구 (진단·경과·처방 일괄 적용) */}
                                {filteredSuperPhrases.map(sp => (
                                  <button
                                    key={`sp-${sp.id}`}
                                    type="button"
                                    onClick={() => applySuperPhraseFromSlash(sp)}
                                    disabled={gateChecking}
                                    className="w-full text-left px-3 py-2 hover:bg-teal-50 flex items-start gap-2 border-b border-border/50 disabled:opacity-50"
                                    data-testid="phrase-autocomplete-super-option"
                                  >
                                    <Sparkles className="h-3 w-3 text-teal-600 shrink-0 mt-0.5" />
                                    <div className="min-w-0">
                                      <div className="text-xs font-medium truncate">{sp.name}</div>
                                      <div className="text-[10px] text-muted-foreground line-clamp-1">
                                        {[sp.diagnosis, sp.clinical_progress].filter(Boolean).join(' · ') || `처방 ${sp.rx_items.length}개`}
                                      </div>
                                    </div>
                                  </button>
                                ))}
                                {/* 일반 상용구 (임상경과 텍스트 삽입) */}
                                {filteredPhrases.map(p => (
                                  <button
                                    key={`p-${p.id}`}
                                    type="button"
                                    onClick={() => insertPhrase(p)}
                                    className="w-full text-left px-3 py-2 hover:bg-muted flex items-start gap-2 border-b border-border/50 last:border-0"
                                    data-testid="phrase-autocomplete-option"
                                  >
                                    {p.shortcut_key && (
                                      <Badge
                                        variant="secondary"
                                        className="text-[9px] shrink-0 mt-0.5 h-4 px-1 font-mono"
                                      >
                                        //{p.shortcut_key}
                                      </Badge>
                                    )}
                                    <div className="min-w-0">
                                      <div className="text-xs font-medium truncate">{p.name}</div>
                                      <div className="text-[10px] text-muted-foreground line-clamp-1">{p.content}</div>
                                    </div>
                                  </button>
                                ))}
                              </>
                            )}
                          </div>,
                          document.body
                        );
                      })()}
                    </div>
                  </div>

                  {/* 처방내역 — 우측 패널에서 선택 후 이 테이블에 반영 */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-semibold text-muted-foreground">처방내역</label>
                      <span className="text-[10px] text-muted-foreground">우측 패널에서 처방세트 선택</span>
                    </div>
                    {formRx.length > 0 ? (
                      <div
                        className="rounded-lg border bg-card overflow-hidden"
                        data-testid="prescription-items-table"
                      >
                        {/* AC-4: 약이름(용량 포함) | 용법 | 횟수 | 일수 컬럼 분리 + 행별 직접 조정.
                            AC-3: 약 종류(투여경로) 색상 도트.
                            MEDCHART-SUPERPHRASE-EXT 2-5: 횟수 = 숫자만 입력 + 배경 '회'(RxCountInput), 용법과 별도 칸. */}
                        <table className="w-full text-xs">
                          <thead className="bg-muted/40">
                            <tr>
                              <th className="text-left px-3 py-1.5 font-medium">약이름 (용량)</th>
                              <th className="text-left px-2 py-1.5 font-medium w-24">용법</th>
                              <th className="text-left px-2 py-1.5 font-medium w-20">횟수</th>
                              <th className="text-left px-2 py-1.5 font-medium w-16">일수</th>
                              <th className="py-1.5 w-6" />
                            </tr>
                          </thead>
                          <tbody>
                            {formRx.map((item, idx) => {
                              const rs = rxItemStyle(item);
                              return (
                                <tr
                                  key={idx}
                                  className="border-t border-border/50"
                                  data-testid={`prescription-row-${idx}`}
                                >
                                  <td className="px-3 py-1.5">
                                    <div className="flex items-center gap-1.5">
                                      <span
                                        className={`inline-block h-2 w-2 rounded-full flex-shrink-0 ${rs.dot}`}
                                        title={rs.label}
                                        aria-label={`투여경로 ${rs.label}`}
                                        data-testid={`rx-route-dot-${idx}`}
                                      />
                                      <span className="font-medium">{item.name}</span>
                                      {/* T-20260604-foot-RX-DRUGINFO-DOSAGE AC-3: 용량 인라인 수동입력
                                          (외부 자동조회 불가 → 등록/처방 시 직접 입력 fallback). */}
                                      <Input
                                        value={item.dosage}
                                        onChange={(e) => updateRxItem(idx, 'dosage', e.target.value)}
                                        disabled={isReadOnly}
                                        className="h-6 text-xs px-1.5 w-24 text-muted-foreground disabled:opacity-100 disabled:bg-gray-50 disabled:cursor-not-allowed"
                                        placeholder="용량"
                                        aria-label="용량"
                                        data-testid={`rx-dosage-${idx}`}
                                      />
                                    </div>
                                  </td>
                                  <td className="px-2 py-1 align-middle">
                                    <Input
                                      value={item.frequency}
                                      onChange={(e) => updateRxItem(idx, 'frequency', e.target.value)}
                                      disabled={isReadOnly}
                                      className="h-7 text-xs px-2 disabled:opacity-100 disabled:bg-gray-50 disabled:cursor-not-allowed"
                                      placeholder="1일 3회"
                                      data-testid={`rx-frequency-${idx}`}
                                    />
                                  </td>
                                  {/* MEDCHART-SUPERPHRASE-EXT 2-5: 횟수 = 숫자만 + 배경 '회' */}
                                  <td className="px-2 py-1 align-middle">
                                    <RxCountInput
                                      value={item.count ?? null}
                                      onChange={(v) => updateRxCount(idx, v)}
                                      disabled={isReadOnly}
                                      className="w-16"
                                    />
                                  </td>
                                  <td className="px-2 py-1 align-middle">
                                    <Input
                                      type="number"
                                      min={0}
                                      value={item.days}
                                      onChange={(e) => updateRxItem(idx, 'days', e.target.value)}
                                      disabled={isReadOnly}
                                      className="h-7 text-xs px-2 w-14 disabled:opacity-100 disabled:bg-gray-50 disabled:cursor-not-allowed"
                                      placeholder="일수"
                                      data-testid={`rx-days-${idx}`}
                                    />
                                  </td>
                                  <td className="py-1.5 pr-1">
                                    {!isReadOnly && (
                                      <button
                                        type="button"
                                        onClick={() => setFormRx(prev => prev.filter((_, i) => i !== idx))}
                                        className="h-5 w-5 rounded text-destructive hover:bg-destructive/10 flex items-center justify-center"
                                        aria-label="처방 항목 삭제"
                                      >
                                        <X className="h-3 w-3" />
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground text-center">
                        처방내역 없음 — 우측 패널에서 처방세트를 선택하세요
                      </div>
                    )}
                  </div>

                  {/* 진료메모 — 원장 전용 미노출 (AC-3)
                      T-20260603-foot-CHART-UIUX-ENHANCE AC-10: 빨간 박스 제거 → 타 카테고리와 동일 스타일 통일.
                      원장 전용 구분은 회색 배지로만 유지 (이질적 색상 제거). */}
                  {isDirector ? (
                    <div data-testid="doctor-memo-section">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <label className="text-xs font-semibold text-muted-foreground">진료메모</label>
                        <span className="text-[10px] text-muted-foreground bg-gray-100 rounded px-1.5 py-0.5">원장 전용</span>
                        <span className="text-[10px] text-muted-foreground">
                          타 스태프에게 노출되지 않습니다
                        </span>
                      </div>
                      <Textarea
                        value={formMemo}
                        onChange={(e) => setFormMemo(e.target.value)}
                        readOnly={isReadOnly}
                        placeholder="원장 전용 메모를 입력하세요"
                        rows={3}
                        className={`text-sm resize-none placeholder:text-gray-300 ${isReadOnly ? 'bg-gray-50 text-gray-500 cursor-not-allowed' : ''}`}
                        data-testid="doctor-memo-input"
                      />
                    </div>
                  ) : (
                    /* 비원장: 필드 자체 미표시 (AC-4 시나리오 4) */
                    null
                  )}

                  {/* T-20260606-foot-MEDCHART-NIGHT-REFEEDBACK AC-2: 작성자 서명 — 기록 본문 말미.
                      상단 로그인 계정 인디케이터와 구분되는 '서명' 스타일(우측 정렬, 점선 구분, 작성: {이름}). */}
                  {selectedChart && !selectedChartId?.startsWith('__dummy__') && (selectedChart.created_by_name || recorderName(selectedChart.created_by)) && (
                    <div className="flex justify-end" data-testid="chart-recorder">
                      <span className="inline-flex items-center gap-1.5 border-t border-dashed border-gray-300 pt-1.5 text-xs text-muted-foreground italic">
                        <Stethoscope className="h-3 w-3 text-teal-600" />
                        작성{' '}
                        <span className="font-semibold not-italic text-teal-700">
                          {selectedChart.created_by_name || recorderName(selectedChart.created_by)}
                        </span>
                      </span>
                    </div>
                  )}

                  {/* 저장/수정 버튼 — AC-4: 저장된 차트는 [수정]으로 편집모드 진입 후에만 저장 가능(실수 방지) */}
                  <div className="flex gap-3 pt-2 pb-4 border-t">
                    {isReadOnly && !selectedChartId?.startsWith('__dummy__') ? (
                      <Button
                        size="lg"
                        className="flex-1 h-12 text-base bg-amber-500 hover:bg-amber-600 text-white"
                        onClick={() => setEditMode(true)}
                        data-testid="medical-chart-edit-btn"
                      >
                        <Edit2 className="h-4 w-4 mr-2" />
                        수정
                      </Button>
                    ) : (
                      <Button
                        size="lg"
                        className={`flex-1 h-12 text-base ${
                          selectedChartId?.startsWith('__dummy__')
                            ? 'bg-gray-300 hover:bg-gray-300 text-gray-500 cursor-not-allowed'
                            : 'bg-teal-600 hover:bg-teal-700 text-white'
                        }`}
                        onClick={handleSave}
                        disabled={saving || !formDate}
                        data-testid="medical-chart-save-btn"
                      >
                        {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                        {saving
                          ? '저장 중...'
                          : selectedChartId?.startsWith('__dummy__')
                            ? '더미 데이터 — 저장 불가'
                            : selectedChartId
                              ? '수정 저장'
                              : '기록 저장'}
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              {/* ── 우측 콘텐츠 패널 — 처방세트 / 상용구 / 치료메모 / 진료내역 / 진료이미지 탭 ─ */}
              <div
                className="w-72 flex-shrink-0 flex flex-col bg-muted/5"
                data-testid="medical-chart-right-panel"
              >
                {/* 탭 헤더 — 5개 아이콘+라벨 컴팩트 */}
                <div className="flex-none border-b">
                  {/* 상단 행: 처방세트 / 상용구 / 슈퍼상용구 (T-20260603-foot-RX-SUPER-PHRASE) */}
                  <div className="flex border-b border-border/30">
                    {([
                      { key: 'rx', icon: <FlaskConical className="h-3 w-3" />, label: '처방세트' },
                      { key: 'phrase', icon: <BookOpen className="h-3 w-3" />, label: '상용구' },
                      { key: 'super', icon: <Sparkles className="h-3 w-3" />, label: '슈퍼상용구' },
                    ] as const).map(({ key, icon, label }) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setRightTab(key)}
                        className={`flex-1 flex items-center justify-center gap-1 py-2 text-[11px] font-semibold transition-colors border-b-2 ${
                          rightTab === key
                            ? 'border-teal-500 text-teal-700 bg-background'
                            : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/30'
                        }`}
                        data-testid={`right-panel-tab-${key}`}
                      >
                        {icon}{label}
                      </button>
                    ))}
                  </div>
                  {/* 하단 행: 진료내역 / 진료이미지 (T-20260527-foot-TREATMEMO-CHART-MERGE: 치료메모 탭 제거) */}
                  <div className="flex">
                    {([
                      { key: 'visit_hist', icon: <History className="h-3 w-3" />, label: '진료내역' },
                      { key: 'images', icon: <Camera className="h-3 w-3" />, label: '진료이미지' },
                    ] as const).map(({ key, icon, label }) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setRightTab(key)}
                        className={`flex-1 flex items-center justify-center gap-1 py-2 text-[11px] font-semibold transition-colors border-b-2 ${
                          rightTab === key
                            ? 'border-teal-500 text-teal-700 bg-background'
                            : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/30'
                        }`}
                        data-testid={`right-panel-tab-${key}`}
                      >
                        {icon}{label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 탭 콘텐츠 */}
                <div className="flex-1 overflow-y-auto">

                  {/* 처방세트 탭 */}
                  {rightTab === 'rx' && (
                    <div className="p-3 space-y-2" data-testid="right-panel-rx-content">
                      {/* 편집 바로가기 (AC-2) — RX-PANEL-UX-5FIX AC-5: 처방세트 탭 pre-select */}
                      <button
                        type="button"
                        onClick={() => handleNavigateToAdmin('prescriptions')}
                        className="w-full flex items-center justify-center gap-1.5 text-[11px] text-teal-600 hover:text-teal-800 border border-teal-200 rounded-md py-1.5 hover:bg-teal-50 transition-colors"
                        data-testid="rx-set-edit-btn"
                      >
                        <Edit2 className="h-3 w-3" />
                        처방세트 관리 화면으로
                      </button>

                      {/* T-20260603-foot-RX-CHART-ENHANCE AC-5 (구 RX-MODULE-8REQ #5/AC-5-1): 약품 마스터(prescription_codes) 검색 →
                          단건 처방내역 추가. 내부 마스터 대상(외부연동 없음). code_source='custom'(자체·카피약) 우선 노출. */}
                      <div className="rounded-lg border bg-card p-2 space-y-1.5" data-testid="rx-search-box">
                        <div className="relative">
                          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                          <Input
                            value={rxSearchQuery}
                            onChange={(e) => {
                              const v = e.target.value;
                              setRxSearchQuery(v);
                              searchRxCodes(v);
                            }}
                            placeholder="약품명·보험코드 검색"
                            className="h-8 text-xs pl-7"
                            data-testid="rx-search-input"
                          />
                          {rxSearching && (
                            <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground" />
                          )}
                        </div>
                        {rxSearchQuery.trim() !== '' && (
                          <div className="max-h-48 overflow-y-auto space-y-0.5" data-testid="rx-search-results">
                            {rxSearchResults.length === 0 && !rxSearching ? (
                              <div className="text-[10px] text-muted-foreground text-center py-2">검색 결과 없음</div>
                            ) : (
                              rxSearchResults.map((code) => (
                                <button
                                  key={code.id}
                                  type="button"
                                  onClick={() => addRxFromCode(code)}
                                  disabled={gateChecking}
                                  className="w-full text-left rounded-md px-2 py-1.5 hover:bg-teal-50/60 border border-transparent hover:border-teal-200 transition-colors disabled:opacity-50"
                                  data-testid="rx-search-result-item"
                                >
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-xs font-medium truncate flex-1">{code.name_ko}</span>
                                    {code.code_source === 'custom' && (
                                      <Badge variant="secondary" className="text-[9px] h-4 px-1 shrink-0">자체</Badge>
                                    )}
                                  </div>
                                  <div className="text-[10px] text-muted-foreground flex items-center gap-1.5">
                                    <span className="font-mono">{code.claim_code}</span>
                                    {code.classification && <span>· {code.classification}</span>}
                                  </div>
                                </button>
                              ))
                            )}
                          </div>
                        )}
                      </div>

                      <div className="text-[10px] font-semibold text-muted-foreground px-1 pt-1">
                        클릭하면 처방내역에 적용됩니다
                      </div>

                      {/* T-20260606-foot-RX-SET-REDESIGN AC-R3/R5/R6 — 현장용어 3분할(코드 식별자 매핑):
                            · (위) 약품 검색 = 현장 "처방세트" = 전체 약 카탈로그 ............ prescription_codes
                            · 약품 폴더      = 약 분류/탐색 트리(개별 약품 단위) ............ prescription_folders
                            · 묶음처방       = 이름+약 묶음 프리셋(폴더와 별개 직교 축) ..... prescription_sets */}

                      {/* 약품 폴더 (AC-R3: 개별 약품 분류 탐색기 / AC-R5: 단일·다중 추가) */}
                      <div className="flex items-center gap-1.5 px-1 pt-2" data-testid="drug-folder-section-header">
                        <FolderTree className="h-3.5 w-3.5 text-teal-600" />
                        <span className="text-[11px] font-semibold text-foreground">약품 폴더</span>
                      </div>
                      <DrugFolderTree onAdd={addRxFromCodes} disabled={gateChecking} />

                      {/* 묶음처방 (AC-R4: 이름+약 묶음 프리셋 = 코드 prescription_sets) */}
                      <div className="flex items-center gap-1.5 px-1 pt-2" data-testid="rx-set-section-header">
                        <Pill className="h-3.5 w-3.5 text-teal-600" />
                        <span className="text-[11px] font-semibold text-foreground">묶음처방</span>
                      </div>

                      {prescriptionSets.length === 0 ? (
                        <div className="rounded-lg border border-dashed p-4 text-xs text-muted-foreground text-center mt-2" data-testid="rx-set-empty">
                          등록된 처방세트 없음<br />
                          <span className="text-[10px]">위 버튼으로 추가하세요</span>
                        </div>
                      ) : (
                        // T-20260605-foot-RX-SET-EXPLORER-TREE: folder→set 2단 탐색기 트리.
                        //   PrescriptionSetsTab(관리화면) 그룹핑과 동일 규칙: 폴더 가나다순, '미분류' 맨 끝, 폴더 내부는 로드 순서(sort_order) 유지.
                        //   leaf 클릭 = loadPrescriptionSet(set) 그대로 보존(적용 로직 변경 없음).
                        (() => {
                          const NO_FOLDER = '미분류';
                          const map = new Map<string, PrescriptionSet[]>();
                          for (const s of prescriptionSets) {
                            const key = s.folder?.trim() ? s.folder.trim() : NO_FOLDER;
                            if (!map.has(key)) map.set(key, []);
                            map.get(key)!.push(s);
                          }
                          const keys = Array.from(map.keys()).sort((a, b) => {
                            if (a === NO_FOLDER) return 1;
                            if (b === NO_FOLDER) return -1;
                            return a.localeCompare(b, 'ko');
                          });
                          return keys.map((folderName) => {
                            const items = map.get(folderName)!;
                            const collapsed = collapsedRxFolders.has(folderName);
                            return (
                              <div key={folderName} data-testid="rx-set-folder-node" className="space-y-1">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setCollapsedRxFolders((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(folderName)) next.delete(folderName);
                                      else next.add(folderName);
                                      return next;
                                    })
                                  }
                                  className="w-full flex items-center gap-1.5 px-1 py-1.5 rounded-md hover:bg-teal-50/60 transition-colors"
                                  data-testid="rx-set-folder-toggle"
                                  aria-expanded={!collapsed}
                                >
                                  {collapsed ? (
                                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                  ) : (
                                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                  )}
                                  {collapsed ? (
                                    <Folder className="h-3.5 w-3.5 text-teal-600 shrink-0" />
                                  ) : (
                                    <FolderOpen className="h-3.5 w-3.5 text-teal-600 shrink-0" />
                                  )}
                                  <span className="text-xs font-semibold text-foreground truncate flex-1 text-left" data-testid="rx-set-folder-name">
                                    {folderName}
                                  </span>
                                  <Badge variant="secondary" className="text-[10px] h-4 px-1.5 shrink-0">{items.length}</Badge>
                                </button>
                                {!collapsed && (
                                  <div className="space-y-1 pl-3 border-l border-teal-100 ml-2">
                                    {items.map((set) => (
                                      <button
                                        key={set.id}
                                        type="button"
                                        onClick={() => loadPrescriptionSet(set)}
                                        disabled={gateChecking}
                                        className="w-full text-left rounded-lg border bg-card px-3 py-2.5 hover:border-teal-400 hover:bg-teal-50/30 transition-colors disabled:opacity-50"
                                        data-testid="rx-set-option"
                                      >
                                        <div className="font-medium text-xs">{set.name}</div>
                                        <div className="text-[10px] text-muted-foreground mt-0.5">
                                          {set.items.slice(0, 3).map(i => i.name).join(', ')}
                                          {set.items.length > 3 ? ` 외 ${set.items.length - 3}개` : ''}
                                        </div>
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          });
                        })()
                      )}
                    </div>
                  )}

                  {/* 상용구 탭 */}
                  {rightTab === 'phrase' && (
                    <div className="p-3 space-y-2" data-testid="right-panel-phrase-content">
                      {/* 편집 바로가기 (AC-2) */}
                      <button
                        type="button"
                        onClick={() => handleNavigateToAdmin('phrases')}
                        className="w-full flex items-center justify-center gap-1.5 text-[11px] text-teal-600 hover:text-teal-800 border border-teal-200 rounded-md py-1.5 hover:bg-teal-50 transition-colors"
                        data-testid="phrase-edit-btn"
                      >
                        <Edit2 className="h-3 w-3" />
                        상용구 관리 화면으로
                      </button>

                      <div className="text-[10px] font-semibold text-muted-foreground px-1 pt-1">
                        항목을 누르면 우측에 ✓ 버튼이 나타납니다 — 눌러서 임상경과에 삽입
                      </div>

                      {/* T-20260605-foot-RX-SUPER-PHRASE-LOAD-BUG (AC-2): 조회 실패(에러) ≠ 0건(빈) 구분 안내 */}
                      {phraseLoadError ? (
                        <div className="rounded-lg border border-dashed border-red-200 bg-red-50/40 p-4 text-xs text-red-600 text-center mt-2" data-testid="phrase-load-error">
                          상용구를 불러오지 못했습니다<br />
                          <span className="text-[10px]">잠시 후 다시 시도하거나 관리자에게 문의하세요</span>
                        </div>
                      ) : phraseTemplates.length === 0 ? (
                        <div className="rounded-lg border border-dashed p-4 text-xs text-muted-foreground text-center mt-2" data-testid="phrase-empty">
                          등록된 상용구 없음<br />
                          <span className="text-[10px]">위 버튼으로 추가하세요</span>
                        </div>
                      ) : (
                        // T-20260606-foot-RX-PANEL-UX-5FIX AC-3: 진료차트/펜차트 그룹 분리.
                        //   진료차트 상용구는 항상 펼침(원장 기본 동선), 펜차트는 접이식 헤더(기본 접힘).
                        (() => {
                          const medicalPhrases = phraseTemplates.filter(p => p.phrase_type === 'medical_chart');
                          const penPhrases = phraseTemplates.filter(p => p.phrase_type !== 'medical_chart');
                          return (
                            <div className="space-y-2">
                              {/* 진료차트 상용구 (항상 펼침) */}
                              <div data-testid="phrase-group-medical">
                                <div className="flex items-center gap-1 px-1 pb-1">
                                  <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 rounded px-1.5 py-0.5">진료차트</span>
                                  <span className="text-[10px] text-muted-foreground">{medicalPhrases.length}</span>
                                </div>
                                {medicalPhrases.length === 0 ? (
                                  <p className="text-[10px] text-muted-foreground px-2 py-1.5">진료차트 상용구 없음</p>
                                ) : (
                                  <div className="space-y-0.5">
                                    {medicalPhrases.map(renderPhraseRow)}
                                  </div>
                                )}
                              </div>

                              {/* 펜차트 상용구 (AC-3: 항상 기본 접힘) */}
                              <div data-testid="phrase-group-pen" className="border-t pt-2">
                                <button
                                  type="button"
                                  onClick={() => setPenPhraseCollapsed(c => !c)}
                                  className="w-full flex items-center gap-1.5 px-1 py-1 rounded-md hover:bg-muted/50 transition-colors"
                                  data-testid="phrase-group-pen-toggle"
                                  aria-expanded={!penPhraseCollapsed}
                                >
                                  {penPhraseCollapsed
                                    ? <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                    : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                                  <span className="text-[10px] font-semibold text-blue-600 bg-blue-50 rounded px-1.5 py-0.5">펜차트</span>
                                  <span className="text-[10px] text-muted-foreground">{penPhrases.length}</span>
                                </button>
                                {!penPhraseCollapsed && (
                                  penPhrases.length === 0 ? (
                                    <p className="text-[10px] text-muted-foreground px-2 py-1.5">펜차트 상용구 없음</p>
                                  ) : (
                                    <div className="space-y-0.5 mt-1">
                                      {penPhrases.map(renderPhraseRow)}
                                    </div>
                                  )
                                )}
                              </div>
                            </div>
                          );
                        })()
                      )}
                    </div>
                  )}
                  {/* 슈퍼상용구 탭 (T-20260603-foot-RX-SUPER-PHRASE) — 클릭 시 진단명/임상경과/처방 일괄 적용 */}
                  {rightTab === 'super' && (
                    <div className="p-3 space-y-2" data-testid="right-panel-super-content">
                      {/* 편집 바로가기 */}
                      <button
                        type="button"
                        onClick={() => handleNavigateToAdmin('super_phrases')}
                        className="w-full flex items-center justify-center gap-1.5 text-[11px] text-teal-600 hover:text-teal-800 border border-teal-200 rounded-md py-1.5 hover:bg-teal-50 transition-colors"
                        data-testid="super-phrase-edit-btn"
                      >
                        <Edit2 className="h-3 w-3" />
                        슈퍼상용구 관리 화면으로
                      </button>

                      <div className="text-[10px] font-semibold text-muted-foreground px-1 pt-1">
                        클릭하면 진단명·임상경과·처방내역에 일괄 적용됩니다
                      </div>

                      {/* T-20260605-foot-RX-SUPER-PHRASE-LOAD-BUG (AC-2): 조회 실패(에러) ≠ 0건(빈) 구분 안내 */}
                      {superLoadError ? (
                        <div className="rounded-lg border border-dashed border-red-200 bg-red-50/40 p-4 text-xs text-red-600 text-center mt-2" data-testid="super-phrase-load-error">
                          슈퍼상용구를 불러오지 못했습니다<br />
                          <span className="text-[10px]">잠시 후 다시 시도하거나 관리자에게 문의하세요</span>
                        </div>
                      ) : superPhrases.length === 0 ? (
                        <div className="rounded-lg border border-dashed p-4 text-xs text-muted-foreground text-center mt-2" data-testid="super-phrase-empty">
                          등록된 슈퍼상용구 없음<br />
                          <span className="text-[10px]">위 버튼으로 추가하세요</span>
                        </div>
                      ) : (
                        superPhrases.map(sp => (
                          <button
                            key={sp.id}
                            type="button"
                            onClick={() => applySuperPhrase(sp)}
                            disabled={gateChecking}
                            className="w-full text-left rounded-lg border bg-card px-3 py-2.5 hover:border-teal-400 hover:bg-teal-50/30 transition-colors disabled:opacity-50"
                            data-testid="super-phrase-option"
                          >
                            <div className="flex items-center gap-1.5 font-medium text-xs">
                              <Sparkles className="h-3 w-3 text-teal-600 shrink-0" />
                              {sp.name}
                            </div>
                            <div className="text-[10px] text-muted-foreground mt-1 space-y-0.5">
                              {sp.diagnosis && <div className="truncate"><span className="text-foreground">진단</span> {sp.diagnosis}</div>}
                              {sp.clinical_progress && <div className="truncate"><span className="text-foreground">경과</span> {sp.clinical_progress}</div>}
                              {sp.rx_items.length > 0 && (
                                <div className="truncate">
                                  <span className="text-foreground">처방 {sp.rx_items.length}개</span>{' '}
                                  {sp.rx_items.slice(0, 2).map(i => i.name).join(', ')}
                                  {sp.rx_items.length > 2 ? ' 외' : ''}
                                </div>
                              )}
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  )}

                  {/* ── T-20260527-foot-TREATMEMO-CHART-MERGE: 치료메모 탭 제거 — [치료사차트] 섹션에 통합 ── */}

                  {/* ── T-20260526-foot-MEDCHART-SYNC: 진료내역 탭 ──────────────── */}
                  {rightTab === 'visit_hist' && (
                    <div className="p-3 space-y-2" data-testid="right-panel-visit-hist-content">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-semibold text-muted-foreground">
                          방문 진료내역 (읽기전용)
                        </span>
                        <span className="text-[9px] text-muted-foreground bg-muted rounded px-1.5 py-0.5">
                          2번차트 1구역
                        </span>
                      </div>
                      {visitHistLoading ? (
                        <div className="flex justify-center py-6">
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        </div>
                      ) : visitHistory.length === 0 ? (
                        <div className="rounded-lg border border-dashed p-4 text-[11px] text-muted-foreground text-center">
                          방문 기록 없음
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          {visitHistory.map((ci) => {
                            const treatDetails = (ci.treatment_memo?.details ?? '').trim();
                            const hasTreat = !!treatDetails;
                            const hasDoc = !!ci.doctor_note?.trim();
                            const isCancelled = ci.status === 'cancelled';
                            return (
                              <div
                                key={ci.id}
                                className={`rounded border ${isCancelled ? 'opacity-50 border-gray-200' : 'border-gray-200 bg-white'}`}
                                data-testid="visit-hist-item"
                              >
                                <div className="px-2.5 py-1.5">
                                  <div className="flex items-center justify-between gap-1 mb-0.5">
                                    <span className="text-[11px] font-semibold text-teal-700 tabular-nums">
                                      {fmtDateShort(ci.checked_in_at)}
                                    </span>
                                    {isCancelled && (
                                      <span className="text-[9px] text-red-500 bg-red-50 rounded px-1">취소</span>
                                    )}
                                  </div>
                                  {ci.treatment_kind && (
                                    <p className="text-[11px] text-gray-700 truncate">{ci.treatment_kind}</p>
                                  )}
                                  {hasTreat && (
                                    <div className="mt-1">
                                      <span className="text-[9px] font-semibold text-blue-600 uppercase tracking-wide">치료메모</span>
                                      <p className="text-[10px] text-gray-700 line-clamp-2 whitespace-pre-wrap mt-0.5">{treatDetails}</p>
                                    </div>
                                  )}
                                  {hasDoc && (
                                    <div className="mt-1">
                                      <span className="text-[9px] font-semibold text-violet-600 uppercase tracking-wide">진료메모</span>
                                      <p className="text-[10px] text-gray-700 line-clamp-2 whitespace-pre-wrap mt-0.5">{ci.doctor_note}</p>
                                    </div>
                                  )}
                                  {!ci.treatment_kind && !hasTreat && !hasDoc && (
                                    <p className="text-[10px] text-muted-foreground">기록 없음</p>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── T-20260526-foot-MEDCHART-SYNC: 진료이미지 탭 ─────────────── */}
                  {rightTab === 'images' && (
                    <div className="p-3 space-y-2" data-testid="right-panel-images-content">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-semibold text-muted-foreground">
                          진료이미지 (읽기전용)
                        </span>
                        <span className="text-[9px] text-muted-foreground bg-muted rounded px-1.5 py-0.5">
                          2번차트 1구역
                        </span>
                      </div>
                      {treatImagesLoading ? (
                        <div className="flex justify-center py-6">
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        </div>
                      ) : treatImages.length === 0 ? (
                        <div className="rounded-lg border border-dashed p-4 text-[11px] text-muted-foreground text-center">
                          등록된 진료이미지 없음
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 gap-1.5">
                          {treatImages.map((img) => (
                            <button
                              key={img.path}
                              type="button"
                              onClick={() => window.open(img.signedUrl, '_blank')}
                              className="relative rounded overflow-hidden border border-gray-200 hover:border-teal-400 transition-colors aspect-square bg-muted"
                              title={img.name}
                              data-testid="treat-image-thumb"
                            >
                              <img
                                src={img.signedUrl}
                                alt={img.name}
                                className="w-full h-full object-cover"
                              />
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                {/* T-20260605-foot-RX-PHRASE-CLICK-INSERT: 하단 일괄 '삽입' 버튼 제거 — 행 내 ✓ 즉시삽입으로 단일화 */}
              </div>
            </>
          )}
        </div>
      </div>

      {/* T-20260603-foot-RX-CHART-ENHANCE AC-2 (구 RX-MODULE-8REQ #2/AC-2): 약품 금기증 확인 게이트.
          prescription_code_id 매칭 금기증 보유 약 추가 시 전체 항목 체크 후에만 진행(우회불가). 의료안전 직결. */}
      {gateContras.length > 0 && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4"
          data-testid="rx-contra-gate"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-xl bg-white shadow-2xl overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 bg-red-50 border-b border-red-100">
              <AlertTriangle className="h-5 w-5 text-red-600 shrink-0" />
              <div className="font-semibold text-sm text-red-700">금기증 확인이 필요합니다</div>
            </div>
            <div className="px-4 py-3 space-y-2 max-h-[50vh] overflow-y-auto">
              <p className="text-xs text-muted-foreground">
                추가하려는 처방 약품에 등록된 금기증이 있습니다. 각 항목을 확인하고 체크해야 처방을 추가할 수 있습니다.
              </p>
              {gateContras.map((c) => (
                <label
                  key={c.id}
                  className="flex items-start gap-2 cursor-pointer rounded-lg border p-2 hover:bg-muted/40"
                  data-testid="rx-contra-item"
                >
                  <input
                    type="checkbox"
                    checked={ackedContraIds.has(c.id)}
                    onChange={() =>
                      setAckedContraIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(c.id)) next.delete(c.id);
                        else next.add(c.id);
                        return next;
                      })
                    }
                    className="mt-0.5 h-4 w-4 accent-red-600 shrink-0"
                    data-testid="rx-contra-ack"
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      {c.severity && (
                        <Badge variant="destructive" className="text-[9px] h-4 px-1 shrink-0">{c.severity}</Badge>
                      )}
                    </div>
                    <p className="text-xs text-foreground">{c.contraindication_text}</p>
                  </div>
                </label>
              ))}
            </div>
            <div className="flex gap-2 px-4 py-3 border-t bg-muted/20">
              <Button
                size="sm"
                variant="outline"
                className="flex-1 h-9 text-xs"
                onClick={cancelGate}
                data-testid="rx-contra-cancel"
              >
                처방 취소
              </Button>
              <Button
                size="sm"
                className="flex-1 h-9 text-xs bg-red-600 hover:bg-red-700 text-white disabled:opacity-50"
                disabled={gateContras.some((c) => !ackedContraIds.has(c.id))}
                onClick={confirmGate}
                data-testid="rx-contra-confirm"
              >
                확인하고 처방 추가
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* T-20260603-foot-RX-CHART-ENHANCE FIX(MSG-20260603-190947): 금기증 조회 실패 게이트.
          조회 장애 시 자동 적재 금지(우회불가). 재시도 / 관리자 확인 후 강제 추가(override+로그) / 취소만 허용. */}
      {gateError && (
        <div
          className="fixed inset-0 z-[121] flex items-center justify-center bg-black/50 p-4"
          data-testid="rx-contra-gate-error"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-xl bg-white shadow-2xl overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 bg-amber-50 border-b border-amber-100">
              <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />
              <div className="font-semibold text-sm text-amber-700">금기증 조회 실패</div>
            </div>
            <div className="px-4 py-3 space-y-2">
              <p className="text-xs text-muted-foreground">
                금기증 정보를 불러오지 못해 안전 확인을 완료할 수 없습니다. 처방 추가가 차단되었습니다.
                네트워크 상태를 확인 후 <strong>재시도</strong>하거나, 책임자 확인 하에 강제로 추가할 수 있습니다.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 px-4 py-3 border-t bg-muted/20">
              <Button
                size="sm"
                variant="outline"
                className="flex-1 h-9 text-xs"
                onClick={cancelGateError}
                data-testid="rx-contra-error-cancel"
              >
                처방 취소
              </Button>
              <Button
                size="sm"
                className="flex-1 h-9 text-xs bg-teal-600 hover:bg-teal-700 text-white"
                onClick={retryGateError}
                data-testid="rx-contra-error-retry"
              >
                재시도
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="w-full h-9 text-xs border-amber-300 text-amber-700 hover:bg-amber-50"
                onClick={overrideGateError}
                data-testid="rx-contra-error-override"
              >
                관리자 확인 후 강제 추가
              </Button>
            </div>
          </div>
        </div>
      )}
    </>,
    document.body,
  );
}
