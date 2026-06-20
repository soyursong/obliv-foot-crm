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
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useUnsavedGuard } from '@/hooks/useUnsavedGuard';
import { toast } from '@/lib/toast';
import { rxFreqCore } from '@/lib/rxFormat';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import { Check, ChevronDown, ChevronLeft, ChevronRight, Edit2, Loader2, Pill, Search, Trash2, X } from 'lucide-react';
// T-20260607-foot-MEDCHART-CONSULT-DRAWER: 진료차트 우측 "📋 상담" 탭 (A안 — 서랍에서 탭으로 이식)
import ConsultRecordTab from '@/components/ConsultRecordTab';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { checkRxRoleGate, rxRoleGateMessage, rxInsuranceGateMessage, rxInsuranceOverrideConfirm } from '@/lib/prescriptionGate';
import { evaluateRxInsuranceGate, searchServiceRxDrugs } from '@/lib/prescribableDrugs';
import { formatAmount, formatPhone, todaySeoulISODate, chartNoBadge } from '@/lib/format';
import { cn } from '@/lib/utils';
// T-20260609-foot-DOCCALL-DOCTOR-ACK AC8: 환자차트에도 ✋ 표시(대기 pulse / 확인 후 파란 고정).
import { DoctorAckBadge } from '@/components/doctor/DoctorAck';
import type { PrescriptionItem } from '@/components/admin/PrescriptionSetsTab';
import { classificationToRoute } from '@/components/admin/PrescriptionSetsTab';
// T-20260606-foot-RX-SET-REDESIGN AC-R3/R5: 약품 폴더 탐색기(개별 약품 트리). 묶음처방(set)과 별개 축.
import DrugFolderTree, { type DrugPick } from '@/components/doctor/DrugFolderTree';
// T-20260618-foot-RXSET-VIEWALL-DESC-HOVER-WIDEN (Part E): 처방내역 약 hover → 설명 툴팁.
import DrugInfoTooltip from '@/components/doctor/DrugInfoTooltip';
import { useDrugDescriptions } from '@/lib/drugFolders';
// T-20260607-foot-RXQUICK-SET-FOLDER-NAV: 묶음처방 folder→set 2단 트리(공용 추출).
import PrescriptionSetTreePicker from '@/components/prescription/PrescriptionSetTreePicker';
import RxCountInput from '@/components/admin/RxCountInput';
// T-20260614-foot-RX-DISPLAY-BUNDLE-TOKEN-FIX: 묶음처방 흡수분 포함 처방 표기를 '약물명 1/3/2'
//   단일 토큰 경로(SSOT)로 수렴 — 진료차트 처방내역/미리보기 raw text 제거.
import { formatRxItemToken } from '@/lib/rxTooltip';
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
  // T-20260608-foot-MEDCHART-SIGN-AUDIT (Phase 2): 진료의 귀속(의료법). 레거시 행은 전부 NULL.
  //   signing_doctor_id = clinic_doctors.id. name/seal_url = 저장시점 스냅샷(출력 표기·의사 레코드 변경 무관 보존).
  signing_doctor_id?: string | null;
  signing_doctor_name?: string | null;
  signing_doctor_seal_url?: string | null;
  created_at: string;
  updated_at: string;
  // doctor_memo: chart_doctor_memos에서 merge (director/admin 전용)
  doctor_memo?: string | null;
  // T-20260620-foot-MEDCHART-DELETE-SAMEDAY-POLICY (Phase B): soft-delete(무효화) — 의료법 §22-3.
  //   컬럼 부재(마이그 미적용) 환경에선 undefined → 기능 자동 비활성(runtime 스키마 게이트).
  is_deleted?: boolean | null;
  deleted_at?: string | null;
  deleted_by?: string | null;
  delete_reason?: string | null;
}

// T-20260608-foot-MEDCHART-SIGN-AUDIT (Phase 2): 진료의 선택지(활성 clinic_doctors)
interface ClinicDoctorOption {
  id: string;
  name: string;
  seal_image_url: string | null;
  is_default: boolean;
}

// T-20260608-foot-MEDCHART-SIGN-AUDIT (Phase 2): 진료의 변경이력 1행(AC-P2-3 차트 단위 조회)
interface SignerAuditEntry {
  id: string;
  old_doctor_name: string | null;
  new_doctor_name: string | null;
  changed_by_name: string | null;
  changed_by: string | null;
  changed_at: string;
}

interface CustomerBasic {
  id: string;
  name: string;
  phone: string;
  birth_date: string | null;
  chart_number: string | null;
  // T-20260607-foot-MEDCHART-CONSULT-DRAWER: 초진(new) 강조 배지용
  visit_type: 'new' | 'returning' | null;
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
  manufacturer: string | null; // DRUGINFO-MANUFACTURER: 제약사(제조사). custom 코드는 NULL 가능 → 표기 생략.
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

// T-20260615-foot-RXTABLE-PRESCRIPTION-ALIGN AC2/AC6 (문지은 대표원장):
//   처방내역 테이블에서 좌측 투여경로 색상 도트(rxItemStyle/rxRouteStyle/RX_ROUTE_STYLE)를 제거.
//   기존 RX-CHART-ENHANCE AC-3 색상 도트는 본 티켓이 supersede(reporter-explicit) — 함께 정리.
//   용법 셀 "숫자/범위 코어만 표시"(AC6)는 순수 헬퍼 rxFreqCore(@/lib/rxFormat)로 분리(표시 전용).

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
  // T-20260609-foot-CHARTBTN-MINIMAL-COURSE-DRAWER:
  //   'full'(기본) = 기존 전체 진료차트 Drawer(타임라인·2COL·처방·우측패널) — 모든 기존 호출자 무변경.
  //   'clinical'   = 차팅 버튼용 미니멀 뷰. 임상경과 입력 + 담당의사 + 저장만 노출(타임라인/처방/진료메모 제외).
  //                  저장은 동일 handleSave 재사용(신규 저장경로 없음·AC-1), 같은 medical_charts 소스(AC-3).
  variant?: 'full' | 'clinical';
  // T-20260609-foot-MEDDASH-MINIMAL-TABLE AC-5: clinical 미니멀 drawer 안에서 전체 진료차트로 승격하는 진입점.
  //   제공 시 clinical 헤더에 '본 차트 열기' 버튼 노출. 호출부가 variant를 'full'로 전환(같은 패널 인스턴스·
  //   같은 customerId 유지 → 폼 상태·작성 중 임상경과 보존, AC-6 2단 레이아웃 그대로 재진입).
  onOpenFull?: () => void;
  // T-20260609-foot-DOCDASH-CHART-UX item1: clinical 미니멀 뷰를 Drawer(portal) 대신 호출부에 인라인 임베드.
  //   embed=true + variant='clinical' → 백드롭/슬라이드아웃 없이 호출부 DOM 흐름에 인라인(아코디언) 렌더.
  //   진료대시보드 행 바로 아래 펼침용. 저장 로직/NOT NULL 강제/같은날 append 전부 기존 그대로 재사용.
  embed?: boolean;
  // T-20260609-foot-DOCDASH-CHART-UX item1 (AC1-1): 저장 성공 직후 호출(인라인 아코디언 접기용).
  //   저장 로직 자체는 무변경 — 성공 후 presentation 콜백만 추가.
  // T-20260616-foot-DOCDASH-ELAPSED-CLINICAL-POLISH AC-3: 방금 저장한 임상경과 본문을 인자로 전달
  //   → caller(진료대시보드)가 미리보기 맵을 즉시 optimistic 갱신(refetch 왕복 대기 없는 체감 0지연).
  //   인자 옵셔널 — 기존 `() =>` caller 는 인자 무시(하위호환).
  onSaved?: (savedClinical?: string) => void;
  // T-20260610-foot-DOCPATIENTLIST-EXPAND-CLINICAL (AC-3, 문지은 대표원장):
  //   caller-forced 읽기전용 게이트. 진료환자목록 펼침 패널에서 '당일 외(과거/미래) 접수' 환자의
  //   임상경과 오기입 차단용 — readOnly=true 면 textarea readOnly + 저장 버튼(embed footer) 미노출.
  // T-20260609-foot-VISITLOG-NAMING-CLARIFY: 패널 열림 시 우측 기본 탭 지정(deep-link/QA 진입용).
  //   미지정 시 기존과 동일하게 'rx'. ?medchart=visit_hist 진입 시 '방문이력' 콘텐츠를 바로 노출하기 위함.
  initialRightTab?: 'rx' | 'phrase' | 'super' | 'visit_hist' | 'images' | 'consult';
  //   default false → 기존 모든 호출자(DoctorCallDashboard 등) 동작 무변경(AC-4 회귀가드).
  readOnly?: boolean;
  // T-20260611-foot-DOCDASH-TABLEVIEW-CONVERGE B안 (문지은 대표원장, '둘다해줘'):
  //   진료부 대시보드 테이블뷰에서 임상경과 입력을 '한 줄 텍스트 인풋'으로 축소.
  //   embed && variant='clinical' && singleLine → 기존 tall 아코디언(textarea rows 9, 담당의+임상경과+저장 3섹션)
  //   대신 [담당의 select | 한 줄 input | 저장] 1줄 컴팩트 폼으로 렌더.
  //   ⚠ 저장 로직(handleSave) · 진료의 NOT NULL 강제(AC-P2-6, 의료법) · clinical_progress 같은날 append
  //     전부 무변경(비간섭) — input UI 폼만 1줄로 축소. // 자동완성도 동일 clinicalRef(Textarea rows=1)로 유지.
  //   default false → 기존 embed clinical 호출자(DoctorPatientList 펼침 등) 무회귀.
  singleLine?: boolean;
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

// ── T-20260609-foot-TIMELINE-FILTER-PREVIEW-FIX (문지은 대표원장 field-soak) ──────────────
//   접힌 카드 미리보기를 '선택 필터 유형' 기준으로 구성한다. 이전엔 chartSummary(주증상/상병명 우선)
//   + chartTreatmentGist(치료 위주)가 필터와 무관하게 항상 같은 텍스트를 그려, 칩을 눌러도 미리보기가
//   안 바뀌니 "필터가 동작 안 한다(AC-3)"로 체감되고, 무필터에서도 치료메모 위주로만 보였다(AC-4).
//   - AC-2 상병명(diagnosis)·주증상(chief_complaint)은 4개 필터 유형(치료/진료/처방/특이) 어디에도
//          매핑되지 않으므로 미리보기 소스에서 제외 → 상병명 라벨 카드 비노출.
//   - AC-3 미리보기가 필터 토글에 즉시 반응 → '필터 동작' 체감 복구(칩 핸들러 toggleFilter 자체는 무회귀).
//   - AC-4 무필터=전체 유형 활성 → 치료메모만 고정 해소.
//   - AC-5 필터선택=선택 유형만, 다중선택은 누적(중복적용).
function firstLine(s: string | null | undefined): string {
  return (s ?? '').split('\n')[0].trim();
}
function clipText(s: string, n = 44): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
// 유형 활성 판정: 무필터=전체 활성 / 필터선택=선택 유형만 활성
function isTypeActive(filters: Set<MemoFilter>, f: MemoFilter): boolean {
  return filters.size === 0 || filters.has(f);
}
// 접힌 카드 미리보기 세그먼트 (유형 순서: 치료 → 진료(임상경과) → 처방 → 특이).
//   진료메모(doc) 미리보기는 임상경과(clinical_progress)만 노출 — doctor_memo 는 권한 게이트라 미리보기 비노출 유지.
function chartPreviewSegments(chart: MedicalChart, filters: Set<MemoFilter>): string[] {
  const segs: string[] = [];
  if (isTypeActive(filters, 'treat') && hasTreatMemo(chart)) {
    const t = clipText(firstLine(chart.treatment_record));
    if (t) segs.push(t);
  }
  if (isTypeActive(filters, 'doc')) {
    const d = clipText(firstLine(chart.clinical_progress));
    if (d) segs.push(d);
  }
  if (isTypeActive(filters, 'rx') && hasRx(chart)) {
    // T-20260614-foot-RX-DISPLAY-BUNDLE-TOKEN-FIX (AC-2): 미리보기 teaser 도 '약물명 1/3/2' 토큰으로
    //   통일(구 약명-only). name 결측 항목은 제외 후 토큰화 — 단일 경로(formatRxItemToken) 수렴.
    const rxTokens = (Array.isArray(chart.prescription_items) ? chart.prescription_items : [])
      .filter(rx => !!rx?.name?.trim())
      .map(rx => formatRxItemToken(rx));
    if (rxTokens.length > 0) {
      segs.push(`💊 ${rxTokens.slice(0, 2).join(', ')}${rxTokens.length > 2 ? ` 외 ${rxTokens.length - 2}` : ''}`);
    }
  }
  // AC-10: 특이(notable)는 미리보기 세그먼트에서 제외 — 특이사항은 좌측 상단 고정 카드로 일원화.
  return segs;
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
//   'notable'(특이)은 MemoFilter 유형 유지(이력 필터 로직 호환)하되, AC-10 이후 칩에서는 비노출(특이사항은 상단 고정 카드로 일원화).
type MemoFilter = 'treat' | 'doc' | 'rx' | 'notable';

// T-20260609-foot-TIMELINE-FILTER-PREVIEW-FIX AC-8/AC-9/AC-10 (문지은 대표원장):
//   AC-8 칩 레이블 단축('치료메모'→'치료','진료메모'→'진료','처방' 유지) + 유형별 색상.
//   AC-9 닷 색상과 통일하는 단일 팔레트(TYPE_DOT_CLASS) — 치료=blue / 진료=emerald(green) / 처방=amber.
//   AC-10 '특이' 칩 제거 — FILTER_OPTIONS 에서 notable 항목 삭제(특이사항은 좌측 상단 고정 카드로 일원화).
const FILTER_OPTIONS: { key: MemoFilter; label: string; chipClass: string }[] = [
  { key: 'treat', label: '치료', chipClass: 'bg-blue-600 text-white border-blue-600' },
  { key: 'doc', label: '진료', chipClass: 'bg-emerald-600 text-white border-emerald-600' },
  { key: 'rx', label: '처방', chipClass: 'bg-amber-600 text-white border-amber-600' },
];
// AC-9 유형 닷 색상(칩 색과 통일된 동일 hue) — 부재 유형은 transparent 로 컬럼 폭만 유지.
const TYPE_DOT_CLASS: Record<'treat' | 'doc' | 'rx', string> = {
  treat: 'bg-blue-500',
  doc: 'bg-emerald-500',
  rx: 'bg-amber-500',
};

// T-20260606-foot-MEDCHART-NIGHT-REFEEDBACK AC-3 (문지은 대표원장):
//   임상경과 `//` 트리거 드롭다운을 textarea 전체 하단이 아닌 '커서(caret) 바로 아래'에 렌더.
//   mirror-div 기법: textarea 박스를 동일 스타일로 복제하고 caret 직전까지의 텍스트 폭/높이로 caret 픽셀 좌표 산출.
//
// T-20260609-foot-PHRASE-SLASH-DROPDOWN-POS (3차 재발 — 문지은 원장 "아직도 이상한 데서 열림"):
//   기존 mirror 의 좌표 어긋남 근본원인 3개를 모두 교정한다.
//   (1) wrap 폭 불일치(가장 큰 주범): div width=offsetWidth(border-box)는 세로 스크롤바 폭을 반영 못해
//       textarea 실제 텍스트 폭(clientWidth - paddingL - paddingR)보다 넓다 → 줄바꿈 위치가 어긋나
//       여러 줄/긴 경과에서 caret 라인(top)이 통째로 빗나갔다.
//       → 미러를 content-box + '내부 콘텐츠 폭(clientWidth-padding)'으로 구성해 wrap 을 정확히 일치시킴.
//   (2) border 오프셋 누락: span.offsetTop/Left 는 div padding-edge 기준이라 textarea border 두께만큼 어긋남.
//       → taRect(border-box) + borderTop/Left 를 더해 viewport 좌표로 정합.
//   (3) +lineHeight 중복: 라인 '윗변'을 반환하고 '아래로 띄우기'는 호출측이 lineHeight 를 더해 처리(중복 제거).
//   반환 top = caret 라인의 '윗변'(viewport 기준), left = caret 가로 위치. 실패 시 호출측 폴백.
function getTextareaCaretRect(
  ta: HTMLTextAreaElement,
  caretIndex: number,
): { top: number; left: number; lineHeight: number } {
  const style = window.getComputedStyle(ta);
  const div = document.createElement('div');
  // boxSizing/border 는 직접 지정(아래) — 폭은 콘텐츠 폭으로 강제하므로 복제 대상에서 제외.
  const copyProps = [
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch', 'fontSize', 'fontSizeAdjust',
    'lineHeight', 'fontFamily', 'textAlign', 'textTransform', 'textIndent',
    'letterSpacing', 'wordSpacing', 'tabSize', 'direction',
  ] as const;
  div.style.position = 'absolute';
  div.style.visibility = 'hidden';
  div.style.whiteSpace = 'pre-wrap';
  div.style.wordWrap = 'break-word';
  div.style.overflowWrap = 'break-word';
  div.style.top = '0';
  div.style.left = '-9999px';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  copyProps.forEach((p) => { (div.style as any)[p] = (style as any)[p]; });
  // 핵심 (1): wrap 폭 = textarea 내부 콘텐츠 폭 = clientWidth - paddingL - paddingR.
  //   clientWidth 는 border 와 세로 스크롤바를 제외하므로 스크롤바가 떠도 정확히 일치한다.
  const padLeft = parseFloat(style.paddingLeft) || 0;
  const padRight = parseFloat(style.paddingRight) || 0;
  const contentWidth = Math.max(0, ta.clientWidth - padLeft - padRight);
  div.style.boxSizing = 'content-box';
  div.style.width = `${contentWidth}px`;
  div.textContent = ta.value.substring(0, caretIndex);
  const span = document.createElement('span');
  span.textContent = ta.value.substring(caretIndex) || '.';
  div.appendChild(span);
  document.body.appendChild(div);
  const taRect = ta.getBoundingClientRect();
  const borderTop = parseFloat(style.borderTopWidth) || 0;
  const borderLeft = parseFloat(style.borderLeftWidth) || 0;
  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2 || 18;
  // span.offsetTop/Left 는 div padding-edge 기준(=paddingTop/Left 포함). textarea 화면좌표 =
  //   border-box top + borderTop + offsetTop - scrollTop (라인 윗변).
  const top = taRect.top + borderTop + span.offsetTop - ta.scrollTop;
  const left = taRect.left + borderLeft + span.offsetLeft - ta.scrollLeft;
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
  variant = 'full',
  onOpenFull,
  embed = false,
  onSaved,
  readOnly = false,
  initialRightTab,
  singleLine = false,
}: MedicalChartPanelProps) {
  const isDirector = canViewDoctorMemo(currentUserRole);
  // T-20260621-foot-MEDCHART-ADMIN-NAV-REMOVE: navigate/useNavigate 제거 — 관리화면 지름길 버튼 삭제로 미사용.
  const { profile } = useAuth();
  // AC-9: 현재 로그인 의사 표시명 (이름 > 이메일 > 폴백)
  const currentUserName = profile?.name ?? currentUserEmail ?? '알 수 없음';

  // T-20260609-foot-DOCCALL-DOCTOR-ACK AC8: 당일 진료호출(status_flag purple/pink)의 의사 ✋확인 상태.
  //   환자차트는 customerId 기준이라 check_in 컨텍스트가 없으므로, 당일 KST 진료호출 1건을 자체 조회.
  //   ack 됨 → 파란 "의사 확인됨" 고정, 활성 호출(purple) 미확인 → pulse "확인 대기". 표시 전용(write 없음).
  //   Realtime: 해당 고객 check_ins 변경 즉시 재조회(새로고침 없이 반영).
  const [docAck, setDocAck] = useState<{ ackAt: string | null; hasActiveCall: boolean }>({
    ackAt: null,
    hasActiveCall: false,
  });
  useEffect(() => {
    if (!open || !customerId || !clinicId) {
      setDocAck({ ackAt: null, hasActiveCall: false });
      return;
    }
    let cancelled = false;
    const today = todaySeoulISODate();
    const fetchAck = async () => {
      const { data, error } = await supabase
        .from('check_ins')
        .select('doctor_ack_at, status_flag, checked_in_at')
        .eq('customer_id', customerId)
        .eq('clinic_id', clinicId)
        .gte('checked_in_at', `${today}T00:00:00+09:00`)
        .lte('checked_in_at', `${today}T23:59:59+09:00`)
        .in('status_flag', ['purple', 'pink'])
        .order('checked_in_at', { ascending: false })
        .limit(1);
      if (cancelled || error) return;
      const row = (data ?? [])[0] as { doctor_ack_at: string | null; status_flag: string | null } | undefined;
      setDocAck({
        ackAt: row?.doctor_ack_at ?? null,
        hasActiveCall: row?.status_flag === 'purple',
      });
    };
    void fetchAck();
    const channel = supabase
      .channel(`medchart_doc_ack_${customerId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'check_ins', filter: `customer_id=eq.${customerId}` },
        () => {
          void fetchAck();
        },
      )
      .subscribe();
    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [open, customerId, clinicId]);

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
  // T-20260608-foot-CHART-LAYOUT-SHIFT AC-0/AC-1: '치료·시술(결제 자동연동)' 섹션은 loadVisitPayments()가
  //   메인 loading 게이트 밖에서(=resetForm에서 await 없이) 별도 로드된다. 스피너가 사라진 뒤 늦게 resolve되며
  //   섹션이 진단명↔치료사차트 사이에 뒤늦게 삽입 → 임상경과/치료사차트를 아래로 밀어내는 CLS 주범.
  //   in-flight 동안 동일 높이 skeleton으로 자리를 미리 점유해 pop-in 점프 제거.
  const [visitPaymentsLoading, setVisitPaymentsLoading] = useState(false);
  // T-20260606-foot-DIAGNOSIS-MASTER-MGMT (AC-2 [B]): 진단명 입력은 자동완성/이력 datalist 폐지 →
  //   DiagnosisFolderPicker(폴더 탐색 + 원장별 즐겨찾기) 선택전용으로 전환. 별도 상태 불요(picker 자체조회).
  //   저장값은 순수 상병명(formDx) — medical_charts.diagnosis 저장경로 무변경.

  // ── 선택 차트 (null = 새 기록 모드) ──────────────────────────────────────────
  const [selectedChartId, setSelectedChartId] = useState<string | null>(null);
  // T-20260611-foot-DOCDASH-CLINICAL-SAVE-FAIL: loadData(차트 서버조회)가 최초 1회 완료됐는지 신호.
  //   clinical variant 의 today-차트 자동선택(clinicalInit)이 "아직 charts 미로드(초기 빈 배열)" 상태에서
  //   먼저 돌아 ref 가 굳는 레이스를 차단하기 위함. loadData finally 직전 true, 매 로드 시작 시 false 로 재게이트.
  const chartsLoadedRef = useRef(false);

  // ── 폼 상태 ─────────────────────────────────────────────────────────────────
  const [formDate, setFormDate] = useState('');
  const [formDx, setFormDx] = useState('');
  const [formTx, setFormTx] = useState('');          // 치료사차트 = treatment_record (읽기전용)
  const [formClinical, setFormClinical] = useState(''); // 임상경과
  const [formMemo, setFormMemo] = useState('');       // 원장 전용 메모
  const [formRx, setFormRx] = useState<PrescriptionItem[]>([]); // 처방내역
  // T-20260618-foot-RXSET-VIEWALL-DESC-HOVER-WIDEN (Part E): 처방내역 약 설명 lookup(code_id→description).
  //   처방된 약은 PrescriptionItem.prescription_code_id 만 보유 → hover 툴팁용 설명을 prescription_codes 에서 조회.
  const { data: rxDescMap } = useDrugDescriptions(formRx.map((it) => it.prescription_code_id));
  // T-20260608-foot-MEDCHART-SIGN-AUDIT (Phase 2): 진료의 귀속(의료법). 선택지=활성 clinic_doctors.
  //   formSigningDoctorId = 현재 폼에서 선택된 진료의(저장 시 NOT NULL 강제 — 신규/수정행).
  const [clinicDoctors, setClinicDoctors] = useState<ClinicDoctorOption[]>([]);
  const [formSigningDoctorId, setFormSigningDoctorId] = useState<string>('');
  // AC-P2-3: 선택된(저장된) 차트의 진료의 변경이력
  const [signerAudit, setSignerAudit] = useState<SignerAuditEntry[]>([]);
  const [signerAuditOpen, setSignerAuditOpen] = useState(false);
  // 저장 후 동일 차트의 변경이력을 재조회하기 위한 refresh 토큰.
  const [signerAuditRefresh, setSignerAuditRefresh] = useState(0);
  // T-20260606-foot-MEDCHART-NIGHT-REFEEDBACK AC-4 (문지은 대표원장): 저장/수정 모드 토글(실수 방지).
  //   신규 작성 = 항상 편집 가능. 저장된 차트 = 진입 시 읽기전용 → [수정] 클릭해야 편집모드 진입.
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);

  // T-20260620-foot-MEDCHART-DELETE-SAMEDAY-POLICY (Phase B): 진료차트 soft-delete(무효화) 상태.
  //   softDeleteEnabled = 런타임 스키마 게이트. medical_charts 에 is_deleted 컬럼이 실제로 존재할 때만 true.
  //   (마이그 단계1·2 미적용 환경에서 .select('*') 가 is_deleted 키를 반환하지 않으면 false → 삭제 UI 전면 비노출.
  //    FE 가 DB보다 먼저 배포돼도 깨지지 않게 하는 방어막.)
  const [softDeleteEnabled, setSoftDeleteEnabled] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);                  // 삭제된 차트 보기 토글(director/admin)
  const [deletedCharts, setDeletedCharts] = useState<MedicalChart[]>([]); // soft-delete 된 차트(목록 기본 숨김)
  const [deleteTarget, setDeleteTarget] = useState<MedicalChart | null>(null); // 삭제 확인 다이얼로그 대상
  const [deleteReason, setDeleteReason] = useState('');
  const [deleting, setDeleting] = useState(false);

  // T-20260613-foot-REFRESH-BANNER-AUTOLO (AC-3 dirty-guard, blocking):
  //   자동 새로고침 배너(UpdateBanner)가 진료차트 작성 중에 무방비로 발화하면 데이터 유실.
  //   진료차트는 의료법상 진료의 NOT NULL 강제(handleSave 가드)로 미완 차트를 임의 저장(flush)
  //   할 수 없다 → flush 미전달(blocking). 편집모드(읽기전용 아님)에서 입력 내용이 있으면 dirty로
  //   보고, UpdateBanner는 새로고침을 보류하고 "저장 후 새로고침" 안내만 띄운다(유실 0).
  //   over-block은 안전(사용자가 저장 후 진행), under-block은 데이터 유실이므로 보수적으로 판정.
  useUnsavedGuard(
    'medical-chart-panel',
    () => {
      if (!open) return false;
      const isReadOnly = readOnly || (!!selectedChartId && !editMode);
      if (isReadOnly) return false;
      return (
        formClinical.trim().length > 0 ||
        formMemo.trim().length > 0 ||
        formDx.trim().length > 0 ||
        formRx.length > 0
      );
    },
    { label: '진료차트' },
  );

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
  // T-20260614-foot-DOCDASH-POSTDEPLOY-REFINE-5 item②: singleLine "진료의 ○○○" 셀(레이블↔드롭다운)의
  //   외부클릭(blur) 원복 감지용 컨테이너 ref. editingSingleDoctor=true(드롭다운 펼침) 상태에서
  //   이 영역 바깥 mousedown 시 → setEditingSingleDoctor(false)로 레이블(접힘) 원복(저장 안 함).
  const singleDoctorCellRef = useRef<HTMLSpanElement>(null);
  const [phrasePopoverVisible, setPhrasePopoverVisible] = useState(false);
  const [phraseQuery, setPhraseQuery] = useState('');
  // T-20260609-foot-PHRASE-SLASH-DROPDOWN-POS (3): caret 좌표는 1회 계산이라 textarea/drawer 스크롤·리사이즈 시 stale.
  //   팝오버가 열린 동안 scroll(capture=textarea 내부 스크롤 포함)·resize 를 구독해 강제 재렌더 → caret 추종.
  const [, bumpPhraseReposition] = useState(0);
  useEffect(() => {
    if (!phrasePopoverVisible) return;
    const onReposition = () => bumpPhraseReposition((n) => n + 1);
    window.addEventListener('scroll', onReposition, true);
    window.addEventListener('resize', onReposition);
    return () => {
      window.removeEventListener('scroll', onReposition, true);
      window.removeEventListener('resize', onReposition);
    };
  }, [phrasePopoverVisible]);

  // ── 우측 패널 탭 (AC-1 + MEDCHART-SYNC → TREATMEMO-CHART-MERGE: 처방세트 / 상용구 / 진료내역 / 진료이미지)
  // T-20260527-foot-TREATMEMO-CHART-MERGE: treat_memo 탭 제거 — [치료사차트] 섹션에 통합
  // T-20260607-foot-MEDCHART-CONSULT-DRAWER: 'consult' 탭(📋 상담) 추가
  const [rightTab, setRightTab] = useState<'rx' | 'phrase' | 'super' | 'visit_hist' | 'images' | 'consult'>('rx');
  // T-20260605-foot-RX-PHRASE-CLICK-INSERT: 체크박스 다중선택 → 클릭 시 ✓ 즉시삽입 단일화.
  //   행 클릭 → 그 행만 ✓ 버튼 노출(단일 활성), ✓ 클릭 → 즉시 삽입. (펜차트 PHRASE-MULTISELECT 와 별개 패널)
  const [clickedPhraseId, setClickedPhraseId] = useState<number | null>(null);
  // T-20260606-foot-RX-PANEL-UX-5FIX AC-3: 상용구 탭을 진료차트/펜차트 그룹으로 분리.
  //   펜차트 상용구는 항상 기본 접힘(원장 동선은 진료차트 위주, 펜차트는 보조).
  const [penPhraseCollapsed, setPenPhraseCollapsed] = useState(true);
  // T-20260609-foot-PHRASE-CHECKBOX-ARROW AC6-2/6-3: 우측 콘텐츠 패널(상용구·처방세트 등)을
  //   왼쪽 여백의 `<` 화살표로 접어 좌측으로 슬라이드(공간 절약). 다시 누르면 펼침.
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false);

  // T-20260526-foot-MEDCHART-SYNC: 참고 데이터 상태
  // T-20260527-foot-TREATMEMO-CHART-MERGE: treatMemosLoaded/Loading 제거 (loadData 통합으로 불필요)
  const [treatMemos, setTreatMemos] = useState<TreatmentMemoEntry[]>([]);
  // T-20260620-foot-MEDCHART-MEMO-HISTORY-SPLIT-PRINTOMIT (문지은 대표원장): 치료메모 이전 이력 분리(기본 접힘).
  //   AC-1 기본=현재(최신) 메모만 / AC-2 '이전 이력 보기' 토글 / AC-4 GUARD: MEMO-HISTORY(5/20) 데이터·열람 보존(표시 기본값만 변경).
  const [treatMemoHistoryOpen, setTreatMemoHistoryOpen] = useState(false);
  const [visitHistory, setVisitHistory] = useState<VisitHistoryEntry[]>([]);
  // T-20260609-foot-VISITLOG-EMPTYROW-HIDE: 렌더 전용 필터 — 진료종류·치료메모·진료메모가 모두 빈
  // 방문(체크인) 행은 표시하지 않는다. 원본 visitHistory(쿼리/정렬/그룹핑)는 무변경.
  const visibleVisitHistory = useMemo(
    () =>
      visitHistory.filter((ci) => {
        const treatDetails = (ci.treatment_memo?.details ?? '').trim();
        return !!ci.treatment_kind || !!treatDetails || !!ci.doctor_note?.trim();
      }),
    [visitHistory],
  );
  // T-20260614-foot-MEDCHART-AUDIT-NOISE-VISIBILITY: 진료의 "최초 지정(생성)" 이벤트는 변경이 아님 → 표시에서 제외.
  // 적재(medical_chart_signer_audit append-only, L1209)는 무변경 — 화면 필터만.
  // 실제 변경(old·new 둘 다 non-null & old≠new)만 노출. old가 null/빈값/'(없음)'이면 생성행으로 보고 숨김.
  const visibleSignerAudit = useMemo(
    () =>
      signerAudit.filter((a) => {
        const oldName = (a.old_doctor_name ?? '').trim();
        const newName = (a.new_doctor_name ?? '').trim();
        if (!oldName || oldName === '(없음)') return false; // 최초 지정(생성) 이벤트 제외
        if (!newName) return false;
        return oldName !== newName; // 실제 변경만
      }),
    [signerAudit],
  );
  const [visitHistLoaded, setVisitHistLoaded] = useState(false);
  const [visitHistLoading, setVisitHistLoading] = useState(false);
  const [treatImages, setTreatImages] = useState<TreatmentImage[]>([]);
  const [treatImagesLoaded, setTreatImagesLoaded] = useState(false);
  const [treatImagesLoading, setTreatImagesLoading] = useState(false);

  // T-20260603-foot-CHART-SPECIAL-NOTE: 특이사항 공용 누적칸 (좌측 타임라인 ⑤)
  const [specialNotes, setSpecialNotes] = useState<SpecialNoteEntry[]>([]);
  const [specialNoteInput, setSpecialNoteInput] = useState('');
  const [specialNoteSaving, setSpecialNoteSaving] = useState(false);
  // T-20260609-foot-SPECIALNOTE-MEMO-UX AC-2: 접힘/펼침 디폴트 — 내용 없으면 접힘, 있으면 펼침.
  //   초기값 false(접힘). 데이터 로드 후 콘텐츠 유무로 자동 결정(아래 loadData).
  //   사용자가 직접 토글하면 specialNoteManualRef 로 자동결정 무력화(의도 존중).
  const [specialNoteOpen, setSpecialNoteOpen] = useState(false);
  const specialNoteManualRef = useRef(false);
  // T-20260613-foot-MEDCHART-MEMO-TIMELINE-REFINE AC-6: 핀 토글(pinningId/toggleSpecialNotePin) 제거 —
  //   특이사항 핀 버튼을 빨강/파랑 닷(글씨색 토글)으로 대체. is_pinned 기반 정렬(sortSpecialNotes)은 유지
  //   (레거시 고정 항목 상단 보존), UI 토글만 제거.
  // T-20260613-foot-MEDCHART-MEMO-TIMELINE-REFINE AC-5: 특이사항 편집 게이트 — 펼침(specialNoteOpen)은
  //   읽기전용, 연필 토글을 눌러야 입력창 노출(오기입 방지). 펼침/편집을 분리한 별도 플래그.
  const [specialNoteEditing, setSpecialNoteEditing] = useState(false);
  // AC-6: 핀 버튼 제거 → 빨강/파랑 닷으로 특이사항 '글씨색' 토글(presentation-only · 비영속 · db_change 無).
  //   note.id → 'red'|'blue'. 같은 색 재클릭 = 해제(기본 검정). 새로고침 시 초기화(영속 컬럼 없음, UI 강조용).
  const [noteColorOverrides, setNoteColorOverrides] = useState<Record<string, 'red' | 'blue'>>({});

  // T-20260526-foot-VISIT-FOLD-FILTER: 아코디언 + 필터 상태
  const [expandedChartIds, setExpandedChartIds] = useState<Set<string>>(new Set<string>());
  const [memoFilters, setMemoFilters] = useState<Set<MemoFilter>>(new Set<MemoFilter>());
  // T-20260609-foot-MEDCHART-SOAK-REFINE AC3-4: 타임라인 묶음처방(다항목) 펼침 토글 상태(차트별).
  //   기본 접힘 — 묶음처방은 버튼 토글로 펼쳐 각 항목 줄바꿈 표시(공간 효율).
  const [expandedRxCharts, setExpandedRxCharts] = useState<Set<string>>(new Set<string>());

  // ── 데이터 로드 ──────────────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    if (!customerId || !clinicId) return;
    // T-20260611-foot-DOCDASH-CLINICAL-SAVE-FAIL: 새 로드 시작 → today-차트 자동선택 게이트 재무장.
    chartsLoadedRef.current = false;
    setLoading(true);
    try {
      const [custRes, chartsRes, phrasesRes, rxSetsRes, treatMemosRes, staffRes, superRes, specialNotesRes, clinicDoctorsRes] = await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any)
          .from('customers')
          .select('id,name,phone,birth_date,chart_number,visit_type')
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
        // T-20260618-foot-PHRASE-REORDER-CUSTCHART-MENU CS-AC-3: 고객차트 surface(customer_chart)는
        //   의사 진료차트와 별개 → 진료차트 패널에서 배제(.neq). pen_chart/medical_chart 노출은 그대로 보존
        //   (phrase_type NOT NULL DEFAULT pen_chart 이므로 .neq 가 기존 행 누락 없음 — 빈목록 버그 무재발).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any)
          .from('phrase_templates')
          .select('id,category,name,content,shortcut_key,is_active,phrase_type,sort_order')
          .eq('is_active', true)
          .neq('phrase_type', 'customer_chart')
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
        // T-20260608-foot-MEDCHART-SIGN-AUDIT (Phase 2): 진료의 선택지 = 활성 clinic_doctors (AC-P2-2).
        //   clinicId(=clinic UUID 문자열)로 필터. autoBindContext/ClinicSettings와 동일 패턴.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any)
          .from('clinic_doctors')
          .select('id,name,seal_image_url,is_default')
          .eq('clinic_id', clinicId)
          .eq('active', true)
          .order('sort_order', { ascending: true })
          .order('created_at', { ascending: true }),
      ]);

      if (custRes.data) setCustomer(custRes.data as CustomerBasic);
      const rawCharts: MedicalChart[] = chartsRes.data || [];
      // T-20260620-foot-MEDCHART-DELETE-SAMEDAY-POLICY (Phase B): 런타임 스키마 게이트.
      //   .select('*') 결과행에 is_deleted 키가 있으면(=마이그 적용됨) soft-delete 기능 활성화.
      //   컬럼 부재 시 키가 없어 false → 삭제 UI 전면 비노출(FE 선배포 안전).
      setSoftDeleteEnabled(rawCharts.length > 0 && Object.prototype.hasOwnProperty.call(rawCharts[0], 'is_deleted'));
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
      {
        const sortedNotes = sortSpecialNotes((specialNotesRes?.data as SpecialNoteEntry[]) ?? []);
        setSpecialNotes(sortedNotes);
        // T-20260609-foot-SPECIALNOTE-MEMO-UX AC-2: 사용자가 토글 안 했으면 콘텐츠 유무로 자동 펼침/접힘
        if (!specialNoteManualRef.current) setSpecialNoteOpen(sortedNotes.length > 0);
      }
      // T-20260603-foot-CHART-UIUX-ENHANCE AC-13: 기록자 이메일→이름 매핑 구성
      {
        const nameMap: Record<string, string> = {};
        ((staffRes?.data as { email: string | null; name: string | null }[]) ?? []).forEach(s => {
          if (s.email && s.name) nameMap[s.email] = s.name;
        });
        setStaffNameMap(nameMap);
      }
      // T-20260608-foot-MEDCHART-SIGN-AUDIT (Phase 2): 진료의 선택지 적재(조회 실패 시 빈 목록 — 레거시 무영향).
      setClinicDoctors((clinicDoctorsRes?.data as ClinicDoctorOption[]) ?? []);

      // director면 chart_doctor_memos merge
      let merged: MedicalChart[] = rawCharts;
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
        merged = rawCharts.map((c: MedicalChart) => ({ ...c, doctor_memo: memoMap[c.id] ?? null }));
      }
      // T-20260620-foot-MEDCHART-DELETE-SAMEDAY-POLICY (Phase B): soft-delete 분리.
      //   활성 차트만 charts(기존 모든 로직=타임라인/저장/today-latch/네비 대상)에 유지 → 무회귀.
      //   삭제된 차트는 deletedCharts 로 분리(목록 기본 숨김, 관리자 "삭제된 차트 보기" 토글로만 조회).
      setCharts(merged.filter((c) => !c.is_deleted));
      setDeletedCharts(merged.filter((c) => !!c.is_deleted));
      // T-20260611-foot-DOCDASH-CLINICAL-SAVE-FAIL: charts 서버조회 성공 반영 완료 → today-차트 자동선택 허용.
      //   (성공 경로에서만 true. 실패 시 false 유지 → 빈 charts 로 today-차트 자동선택이 굳지 않음)
      chartsLoadedRef.current = true;
    } catch {
      toast.error('진료차트 로드 실패 — 잠시 후 다시 시도해주세요');
    } finally {
      setLoading(false);
    }
  }, [customerId, clinicId, isDirector]);

  const loadVisitPayments = useCallback(async (date: string) => {
    if (!customerId || !date) { setVisitPayments([]); setVisitPaymentsLoading(false); return; }
    // T-20260608-foot-CHART-LAYOUT-SHIFT AC-1: in-flight 표시 → 섹션 자리 미리 점유(skeleton).
    setVisitPaymentsLoading(true);
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
    } finally {
      // early-return(if !checkIns) 포함 모든 경로에서 로딩 해제 (finally 보장)
      setVisitPaymentsLoading(false);
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
      // T-20260608-foot-MEDCHART-SIGN-AUDIT (Phase 2): 저장된 차트의 진료의 복원(레거시는 ''→재선택 필요).
      setFormSigningDoctorId(chart.signing_doctor_id ?? '');
      loadVisitPayments(chart.visit_date);
    } else {
      setFormDate(today);
      setFormDx('');
      setFormTx('');
      setFormClinical('');
      setFormMemo('');
      setFormRx([]);
      // 신규 작성: 진료의 미선택 — 아래 자동기본값 effect가 의사 계정이면 본인으로 채움(AC-P2-1).
      setFormSigningDoctorId('');
      loadVisitPayments(today);
    }
  }, [loadVisitPayments]);

  // T-20260608-foot-MEDCHART-SIGN-AUDIT AC-P2-1 (자동 기본값): 신규 작성 + 진료의 미선택일 때,
  //   로그인 계정이 의사이고 이름이 일치하는 활성 의사가 있으면 본인 자동 선택.
  //   매칭 없으면 미선택 유지 → 드롭다운에서 수동 선택(AC-P2-2).
  // T-20260610-foot-DOCDASH-CLINICAL-UX-REFINE AC-2 B안(reporter 문지은 confirm 1781074543.411799):
  //   embed clinical(진료대시보드 인라인) 에도 동일 auto-fill 이식. 기존 isDirector(director/admin) 역할 게이트는
  //   의사호출 대시보드가 의사로 취급하는 manager/doctor 를 누락시켰음 → "내 이름 == 활성 clinic_doctor" 매칭
  //   자체를 의사 판정 기준으로 사용(role 프록시 제거). 매칭=의사이므로 AC-P2-1 의 strict superset → 풀차트 회귀 없음.
  //   드롭다운 수동 변경 가능(formSigningDoctorId 빈 값일 때만 채움) + 비우면 NOT NULL guard 로 저장 차단 유지(AC-P2-6).
  useEffect(() => {
    if (selectedChartId) return;          // 저장된 차트는 복원값 유지
    if (formSigningDoctorId) return;      // 이미 선택됨(수동 선택 보존)
    if (clinicDoctors.length === 0) return;
    const mine = clinicDoctors.find((d) => d.name === currentUserName);
    if (mine) setFormSigningDoctorId(mine.id);   // 이름 매칭 = 로그인 계정이 의사 → 본인 자동
  }, [selectedChartId, formSigningDoctorId, clinicDoctors, currentUserName]);

  // T-20260612-foot-DOCDASH-11FIX AC-6: singleLine 진료의 = 평소엔 "진료의 ○○○" 레이블, 클릭 시에만
  //   드롭다운 노출. 미선택(빈값)이면 드롭다운 강제 노출 → NOT NULL 강제(AC-P2-6) 무회귀.
  // T-20260613-foot-DOCDASH-CALLUX-3FIX AC-2: '변경' 버튼 기본 비노출 → 레이블 자체 클릭으로 드롭다운 확장.
  const [editingSingleDoctor, setEditingSingleDoctor] = useState(false);
  // T-20260613-foot-DOCDASH-CALLUX-3FIX AC-2(c): 다른 의사 선택 시 재확인 모달 — 확정 전 pending 보관.
  const [pendingDoctorChange, setPendingDoctorChange] = useState<{ id: string; name: string } | null>(null);

  // T-20260614-foot-DOCDASH-POSTDEPLOY-REFINE-5 item②: 진료의 드롭다운 외부클릭(blur) → 접힘 원복.
  //   현행 버그: "진료의 ○○○" 레이블 클릭 → 드롭다운(수정상태) 펼침 → 외부클릭/커서이동 해도 펼침 유지.
  //   기대: 외부 mousedown(blur) 시 드롭다운 닫고 레이블 상태로 원복(저장 안 함).
  //   가드 — (1) 펼침(editingSingleDoctor)일 때만, (2) 재확인 모달(pendingDoctorChange) 떠있으면 비개입(모달이 소유),
  //     (3) 원복할 진료의가 있을 때만(formSigningDoctorId 비면 NOT NULL 강제로 드롭다운 유지 — 무회귀),
  //     (4) 셀 컨테이너(레이블·select 모두 포함) 내부 클릭은 제외(정상 '선택' 동작 보존),
  //     (5) 재확인 모달 portal 내부 클릭도 제외(모달은 별도 흐름).
  //   기존 RxPopover/InlinePatientSearch clickOutside(mousedown) 패턴 재사용 — 신규 라이브러리 0.
  useEffect(() => {
    if (!editingSingleDoctor || pendingDoctorChange || !formSigningDoctorId) return;
    function onDoc(e: MouseEvent) {
      const node = e.target as Node;
      const el = e.target as Element | null;
      if (singleDoctorCellRef.current?.contains(node)) return; // (4) 진료의 셀(레이블/select) 내부 — 선택 보존
      if (el?.closest?.('[data-testid="clinical-singleline-doctor-confirm"]')) return; // (5) 재확인 모달
      setEditingSingleDoctor(false); // blur → 접힘(레이블) 원복, 저장 안 함
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [editingSingleDoctor, pendingDoctorChange, formSigningDoctorId]);

  // T-20260612-foot-DOCDASH-11FIX AC-5: singleLine 임상경과 textarea auto-resize.
  //   상용구(//) 삽입 등 긴 내용도 스크롤 없이 전체가 보이도록 내용 높이만큼 확장.
  //   singleLine 분기에 한정 — 다른 variant(rows 고정 9/13/14)는 비간섭(무회귀).
  useEffect(() => {
    if (!(embed && variant === 'clinical' && singleLine)) return;
    const ta = clinicalRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
  }, [formClinical, embed, variant, singleLine]);

  // T-20260608-foot-MEDCHART-SIGN-AUDIT AC-P2-3: 선택된(저장된) 차트의 진료의 변경이력 로드(차트 단위 조회).
  useEffect(() => {
    if (!selectedChartId || selectedChartId.startsWith('__dummy__')) {
      setSignerAudit([]);
      setSignerAuditOpen(false);
      return;
    }
    let alive = true;
    (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from('medical_chart_signer_audit')
        .select('id,old_doctor_name,new_doctor_name,changed_by,changed_by_name,changed_at')
        .eq('medical_chart_id', selectedChartId)
        .order('changed_at', { ascending: false });
      if (alive) setSignerAudit((data as SignerAuditEntry[]) ?? []);
    })();
    return () => { alive = false; };
  }, [selectedChartId, signerAuditRefresh]);

  // T-20260608-foot-MEDCHART-SIGN-AUDIT AC-P2-5: 선택 차트의 진료의 직인 storage path → signed URL(출력 표기용).
  //   직인 없으면 빈값 → 이름 텍스트로 표기(현장 "이름 정도면 충분"). 'documents' 버킷(autoBindContext와 동일).
  const [sealSignedUrl, setSealSignedUrl] = useState<string>('');
  const selectedSealPath = charts.find((c) => c.id === selectedChartId)?.signing_doctor_seal_url ?? null;
  useEffect(() => {
    if (!selectedSealPath) { setSealSignedUrl(''); return; }
    let alive = true;
    (async () => {
      const { data } = await supabase.storage.from('documents').createSignedUrl(selectedSealPath, 3600);
      if (alive) setSealSignedUrl(data?.signedUrl ?? '');
    })();
    return () => { alive = false; };
  }, [selectedSealPath]);

  // ── 열림/닫힘 lifecycle ───────────────────────────────────────────────────────

  useEffect(() => {
    if (open && customerId) {
      loadData();
      setSelectedChartId(null);
      resetForm(null);
      setEditMode(true); // AC-4: 새 고객 열림 = 신규 작성 모드(편집 가능)
      setPhrasePopoverVisible(false);
      setClickedPhraseId(null);
      // T-20260609-foot-VISITLOG-NAMING-CLARIFY: deep-link 진입(?medchart=visit_hist)이면 해당 탭으로 열기. 기본은 'rx'(불변).
      setRightTab(initialRightTab ?? 'rx');
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
      // T-20260609-foot-SPECIALNOTE-MEMO-UX AC-2: 새 고객 열림마다 자동 펼침/접힘 재적용(수동 토글 플래그 리셋)
      specialNoteManualRef.current = false;
    } else {
      setCustomer(null);
      setCharts([]);
      setSelectedChartId(null);
    }
  }, [open, customerId, loadData, resetForm, initialRightTab]);

  // T-20260609-foot-CHARTBTN-MINIMAL-COURSE-DRAWER (clinical variant):
  //   미니멀 임상경과 뷰는 '빠른 경과 입력'이므로, 오늘 날짜의 기존 차트가 있으면 그 차트를 골라
  //   임상경과를 이어서(append) 편집·저장하게 한다(같은 날 중복 차트 방지). 없으면 신규(open effect가
  //   이미 resetForm(null)+editMode 처리). 오픈당 1회만 적용(clinicalInitRef 가드) — 사용자 후속 입력 비방해.
  const clinicalInitRef = useRef(false);
  useEffect(() => {
    if (variant !== 'clinical') return;
    if (!open) { clinicalInitRef.current = false; return; }
    if (loading || clinicalInitRef.current) return;
    // T-20260611-foot-DOCDASH-CLINICAL-SAVE-FAIL (회귀/데이터무결): charts 가 서버에서 최초 로드되기 전
    //   (초기 빈 배열) 에 이 effect 가 돌면 today-차트를 못 찾고 clinicalInitRef 만 true 로 굳어 →
    //   재펼침 시 기존 today-차트 미선택(빈 textarea) → 다음 저장이 UPDATE 가 아닌 신규 INSERT(같은날 중복차트).
    //   현장(문지은 6/11): 같은 환자 today-차트 2건 중복 INSERT 확인. loadData 완료 전엔 latch 금지.
    if (!chartsLoadedRef.current) return;
    const today = format(new Date(), 'yyyy-MM-dd');
    const todays = charts.find(
      (c) => c.visit_date === today && !c.id.startsWith('__dummy__'),
    );
    if (todays) {
      setSelectedChartId(todays.id);
      resetForm(todays);
      // T-20260610-foot-DOCPATIENTLIST-EXPAND-CLINICAL (AC-3): readOnly(당일 외)면 편집모드 진입 금지 —
      //   기존 차트를 읽기전용으로만 표시. readOnly=false(당일/기존 호출자)는 즉시 편집 가능(불변).
      if (!readOnly) setEditMode(true); // 미니멀 뷰는 즉시 편집 가능(읽기전용 진입 아님)
    }
    clinicalInitRef.current = true;
  }, [variant, open, loading, charts, resetForm, readOnly]);

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
    // T-20260611-foot-DOCDASH-CLINICAL-SAVE-FAIL (planner 가드): 저장 차단을 silent return 하지 말고 표면화.
    //   formDate 미설정(로드 미완 등) 시 사용자가 "저장했는데 안 됨"으로 오인하지 않도록 안내.
    if (!customerId || !clinicId || !formDate) {
      toast.error('아직 차트 정보를 불러오는 중입니다 — 잠시 후 다시 저장해주세요');
      return;
    }
    // T-20260526-foot-NAV-ARROW-DUMMY: 더미 차트는 저장 불가
    if (selectedChartId?.startsWith('__dummy__')) {
      toast.error('더미 데이터는 저장할 수 없습니다 (실제 고객 데이터 없음)');
      return;
    }
    // T-20260608-foot-MEDCHART-SIGN-AUDIT AC-P2-6 (FE 강제, 의료법): 진료의 없이 저장 차단.
    //   DB 트리거가 최종 방어선이나, 사용자 안내를 위해 FE에서 먼저 막는다(시나리오 2).
    if (!formSigningDoctorId) {
      toast.error('진료의가 필요합니다 — 담당 의사를 선택해주세요');
      return;
    }
    const selectedDoctor = clinicDoctors.find((d) => d.id === formSigningDoctorId) ?? null;
    if (!selectedDoctor) {
      toast.error('선택한 진료의 정보를 찾을 수 없습니다 — 다시 선택해주세요');
      return;
    }
    // 변경이력(AC-P2-3)용 — 수정 전 진료의 스냅샷.
    const prevChart = charts.find((c) => c.id === selectedChartId) ?? null;
    const prevDoctorId = prevChart?.signing_doctor_id ?? null;
    const prevDoctorName = prevChart?.signing_doctor_name ?? null;
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
        // T-20260608-foot-MEDCHART-SIGN-AUDIT AC-P2-4/5: 진료의 귀속 + 저장시점 스냅샷(이름·직인 path).
        //   스냅샷은 의사 레코드 변경/삭제와 무관하게 출력 표기를 보존하기 위함.
        signing_doctor_id: formSigningDoctorId,
        signing_doctor_name: selectedDoctor.name,
        signing_doctor_seal_url: selectedDoctor.seal_image_url ?? null,
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
        if (error) {
          // T-20260620-foot-MEDCHART-DELETE-SAMEDAY-POLICY AC-2 §B-2 (a)안 (DB 강제 동일일 1차트):
          //   partial UNIQUE index(uix_mc_customer_clinic_date) 충돌(23505) = 같은날 같은 환자 차트가 이미 존재.
          //   현행 today-latch(append) 가 정상 동작하면 INSERT 경로 자체가 안 타지만, 경합/우회로 INSERT 가 발생해도
          //   DB가 우발 중복(T-20260611 재발)을 최종 차단한다. 사용자에겐 "기존 차트 이어쓰기"로 자연 유도하고 재조회한다.
          //   (마이그 미적용 환경엔 index 자체가 없어 23505 미발생 → 본 분기는 무해한 no-op)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if ((error as any)?.code === '23505') {
            toast.error('이미 오늘 차트가 있습니다 — 기존 차트에서 이어서 편집해 주세요');
            loadData(); // 활성 today-차트 재로드 → today-latch 가 기존 차트를 자동 선택(append 동선 복귀)
            setSaving(false);
            return;
          }
          throw error;
        }
        chartId = data?.id ?? null;
        if (chartId) setSelectedChartId(chartId);
      }

      // T-20260608-foot-MEDCHART-SIGN-AUDIT AC-P2-3: 진료의 귀속이 신규 지정/변경된 경우에만 변경이력 append.
      //   (신규 차트 최초 지정 = old NULL → new, 수정 시 의사 변경 = old → new). append-only(덮어쓰기 금지).
      if (chartId && prevDoctorId !== formSigningDoctorId) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase as any).from('medical_chart_signer_audit').insert({
          medical_chart_id: chartId,
          clinic_id: clinicId,
          old_doctor_id: prevDoctorId,
          old_doctor_name: prevDoctorName,
          new_doctor_id: formSigningDoctorId,
          new_doctor_name: selectedDoctor.name,
          changed_by: currentUserEmail,
          changed_by_name: currentUserName,
        });
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
      setSignerAuditRefresh((n) => n + 1); // AC-P2-3: 변경이력 패널 재조회
      loadData();
      // T-20260609-foot-DOCDASH-CHART-UX item1 (AC1-1): 저장 성공 → 인라인 아코디언 접기(presentation only).
      // T-20260616-foot-DOCDASH-ELAPSED-CLINICAL-POLISH AC-3: 방금 저장한 임상경과 본문 전달(optimistic 미리보기용).
      onSaved?.(formClinical.trim() || undefined);
    } catch (err: unknown) {
      toast.error(`저장 실패: ${err instanceof Error ? err.message : '알 수 없는 오류'}`);
    } finally {
      setSaving(false);
    }
  };

  // ── 진료차트 soft-delete (무효화) ────────────────────────────────────────────────
  // T-20260620-foot-MEDCHART-DELETE-SAMEDAY-POLICY AC-1 (의료법 §22-3): hard-delete 금지.
  //   UPDATE is_deleted=true → 목록 숨김(데이터·결제/처방 연동 보존). director/admin 한정(isDirector 게이트).
  //   DB BEFORE UPDATE 트리거가 operation='DELETE' 로 자동 감사(수행자·일시·원본 보존).
  const handleConfirmDelete = async () => {
    const target = deleteTarget;
    if (!target) return;
    if (!softDeleteEnabled) {
      toast.error('삭제 기능이 아직 활성화되지 않았습니다 (DB 반영 대기) — 관리자에게 문의하세요');
      return;
    }
    if (!isDirector) { toast.error('삭제 권한이 없습니다 (원장/관리자 전용)'); return; }
    if (target.id.startsWith('__dummy__')) { toast.error('더미 데이터는 삭제할 수 없습니다'); return; }
    setDeleting(true);
    try {
      // 삭제 수행자 auth.uid()(법적 진실원천은 audit_log.changed_by, deleted_by 는 보조 기록).
      let uid: string | null = null;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: u } = await (supabase as any).auth.getUser();
        uid = u?.user?.id ?? null;
      } catch { /* best-effort */ }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from('medical_charts')
        .update({
          is_deleted: true,
          deleted_at: new Date().toISOString(),
          deleted_by: uid,
          delete_reason: deleteReason.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', target.id);
      if (error) throw error;
      toast.success('진료 기록을 삭제했습니다 (법적 보존을 위해 기록은 유지됩니다)');
      // 삭제한 차트가 현재 선택돼 있으면 선택 해제(새 기록 폼으로)
      if (selectedChartId === target.id) { setSelectedChartId(null); setEditMode(false); }
      setDeleteTarget(null);
      setDeleteReason('');
      loadData();
    } catch (err: unknown) {
      toast.error(`삭제 실패: ${err instanceof Error ? err.message : '알 수 없는 오류'}`);
    } finally {
      setDeleting(false);
    }
  };

  // ── 임상경과 상용구 ────────────────────────────────────────────────────────────

  // T-20260616-foot-CLINPROG-SLASH-DISABLE: 임상경과 필드에 한해 `//` 슈퍼상용구 트리거 비활성화.
  //   ⚠ REDEFINITION — T-20260526-foot-PHRASE-SLASH / T-20260607-foot-CLINCOURSE-SLASH-PHRASE-FIX
  //   (둘 다 '임상경과 // 동작' 방향)의 정반대 지시. 같은 reporter(문지은 대표원장)가 방향 반전 →
  //   임상경과는 `//` 슈퍼상용구를 쓰지 않는 게 확정 스펙. 선행 티켓은 superseded.
  //   AC-1: `//` 검출 → 팝오버 발동 조건 skip. `//`는 평문 그대로 입력·저장.
  //   슈퍼상용구 기능 자체는 유지 — 슈퍼상용구 패널(applySuperPhrase) 클릭 경로로 계속 사용 가능.
  //   처방/펜차트/의료진전용메모 등 타 필드는 handleClinicalChange 미사용 → 영향 0.
  function handleClinicalChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setFormClinical(e.target.value);
    // `//` 트리거 팝오버는 임상경과에서 더 이상 발동하지 않음. 잔존 표시 상태가 있으면 닫음.
    if (phrasePopoverVisible) setPhrasePopoverVisible(false);
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
            className="mt-0.5 flex h-5 w-5 items-center justify-center rounded bg-neutral-800 text-white shrink-0 hover:bg-neutral-900"
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
    // 급여여부 게이트(DECISION 2-B): 급여중지/삭제/기준변경 약은 경고+차단(관리자 해제 가능).
    //   Phase1 = FE 게이트(fail-open). TODO(Phase1.5): 서버측 강제(medical_charts UPDATE trigger/RPC) 하드닝 후보.
    const insGate = await evaluateRxInsuranceGate(currentUserRole, items);
    if (!insGate.allowed) {
      if (!insGate.overridable) {
        toast.error(rxInsuranceGateMessage(insGate.blocked));
        return;
      }
      if (!window.confirm(rxInsuranceOverrideConfirm(insGate.blocked))) {
        toast.info('처방 추가를 취소했어요.');
        return;
      }
      console.warn('[RX-INSURANCE-GATE][OVERRIDE] 관리자 급여상태 해제 처방 추가', {
        ticket: 'T-20260609-foot-DRUG-INSURANCE-GATE',
        blocked: insGate.blocked,
        at: new Date().toISOString(),
      });
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

  // T-20260606-foot-RX-DRUG-WHITELIST AC-1: 진료차트 처방 약 검색 출처를
  //   전체 EDI(prescription_codes) → 처방세트 등록약(services category_label='처방약', active)으로 제한.
  //   대표원장 문지은 확정(전직원 동일·별도 화이트리스트 불요·처방세트=services 처방약 소스 공유).
  //   단일 재바인딩 지점 = prescribableDrugs.searchServiceRxDrugs(자매 RXSET-DRUGSOURCE-SVCRX와 동일 소스).
  //
  //   ⚠️ services 처방약은 prescription_codes FK 미보유(service_code=EDI 청구코드만 보유, AC-0 실측 0% 매핑).
  //      → 검색 결과 약은 prescription_code_id=null(addRxFromCode에서 services.id를 코드로 저장하지 않음).
  //      금기/급여 게이트는 코드 보유 약만 대상이라 자유텍스트와 동일하게 skip되며,
  //      실제 처방전/청구(rx_standard)는 PaymentMiniWindow가 services.service_code를 별도 사용 → 청구 무손실.
  const searchRxCodes = useCallback(async (q: string) => {
    const query = q.trim();
    if (query.length < 1) {
      setRxSearchResults([]);
      return;
    }
    setRxSearching(true);
    try {
      const rows = await searchServiceRxDrugs(query);
      // services 처방약 → 기존 검색 결과 렌더 shape(RxCodeResult)로 어댑트.
      //   id=services.id(React key·표시 전용, prescription_code_id 아님), claim_code=service_code(EDI 청구코드 표시),
      //   code_source='service'(자체 배지 미노출), classification/manufacturer=없음.
      const mapped: RxCodeResult[] = rows.map((r) => ({
        id: r.id,
        name_ko: r.name,
        claim_code: r.service_code ?? '',
        classification: null,
        code_source: 'service',
        price_krw: null,
        manufacturer: null,
      }));
      setRxSearchResults(mapped);
    } catch {
      setRxSearchResults([]);
    } finally {
      setRxSearching(false);
    }
  }, []);

  // AC-5: 검색결과 약 1건을 처방내역에 추가 (name·route·classification·code_id 자동채움 → 게이트 경유)
  //   T-20260606-foot-RX-DRUG-WHITELIST: services 처방약 소스('service')는 prescription_codes FK가 아니므로
  //   prescription_code_id에 services.id를 저장하지 않는다(null) — 게이트 오염 방지(금기/급여는 코드 보유 약만 대상).
  function addRxFromCode(code: RxCodeResult) {
    const isServiceRx = code.code_source === 'service';
    const item: PrescriptionItem = {
      name: code.name_ko,
      dosage: '',
      route: classificationToRoute(code.classification),
      classification: code.classification ?? null,
      prescription_code_id: isServiceRx ? null : code.id,
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

  // T-20260621-foot-MEDCHART-ADMIN-NAV-REMOVE: handleNavigateToAdmin 제거 — 진료차트 우측 패널의
  //   관리화면 지름길 버튼 3종(처방세트/상용구/슈퍼상용구) 전원 삭제에 따라 미사용. 관리화면 진입은
  //   사이드바(서비스관리 → 진료관리 서브탭) 단일 경로로 일원화(문원장 요청: 차트는 원장 전용 공간).

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
  // T-20260620-foot-MEDCHART-DELETE-SAMEDAY-POLICY AC-1: "삭제된 차트 보기"(director/admin) ON 이면
  //   활성 차트 + 삭제 차트를 visit_date 최신순으로 병합 표기(삭제분은 엔트리에서 시각 구분 + 읽기전용).
  const activeCharts = charts;
  const displayCharts = activeCharts.length > 0 || (showDeleted && deletedCharts.length > 0)
    ? (showDeleted
        ? [...activeCharts, ...deletedCharts].sort((a, b) =>
            (b.visit_date || '').localeCompare(a.visit_date || '') ||
            (b.created_at || '').localeCompare(a.created_at || ''))
        : activeCharts)
    : DUMMY_CHARTS;
  const isDummyMode = activeCharts.length === 0 && !(showDeleted && deletedCharts.length > 0);

  // T-20260526-foot-VISIT-FOLD-FILTER: 필터 적용 (OR 로직)
  // T-20260609-foot-MEDCHART-SOAK-REFINE item2 (문지은 대표원장 field-soak 버그):
  //   필터(처방/치료/진료)는 방문 '날짜행'을 절대 지우지 않는다 — 날짜는 항상 표기 유지하고
  //   내용(미리보기 segment·펼침 상세)만 활성 유형에 맞춰 미표기한다.
  //   (preview는 chartPreviewSegments, 펼침 상세는 isTypeActive 가 이미 유형별로 표시/미표시 처리)
  //   이전 동작: 필터 시 매칭 없는 방문행 전체가 사라짐 = 버그. 이제 행은 보존, 내용만 가린다.
  const filteredDisplayCharts = displayCharts;

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
  // T-20260609-foot-MEDCHART-SOAK-REFINE AC3-4: 묶음처방 펼침 토글(차트별).
  function toggleRxBundle(id: string) {
    setExpandedRxCharts(prev => {
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
  // T-20260610-foot-DOCPATIENTLIST-EXPAND-CLINICAL (AC-3): caller가 readOnly=true 강제 시 항상 읽기전용
  //   (당일 외 환자 임상경과 편집 차단). default readOnly=false → 기존 동작 그대로.
  const isReadOnly = readOnly || (!!selectedChartId && !editMode);
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

  // T-20260613-foot-MEDCHART-MEMO-TIMELINE-REFINE AC-6: 특이사항 핀 토글(toggleSpecialNotePin) 제거됨 —
  //   핀 버튼을 빨강/파랑 닷(글씨색 강조 토글)으로 대체. is_pinned 정렬(sortSpecialNotes)은 보존(레거시 고정 상단 유지).

  // T-20260609-foot-DOCDASH-CHART-UX item1: clinical 미니멀 본문 — Drawer/인라인(embed) 양쪽에서 재사용.
  //   embed=true(진료대시보드 행 아래 인라인): textarea rows 9·min-h 14rem(full-width)·컴팩트 버튼, 풀높이 flex 미사용.
  //   embed=false(기존 Drawer): rows 14·min-h 18rem 등 기존 레이아웃 그대로(불변).
  //   T-20260610-foot-DOCDASH-CLINICAL-INLINE-REFINE(문지은 6/10, prior DOCDASH-CLINICAL-UX-REFINE 위 2차 정제):
  //     AC-3 임상경과 textarea embed 추가 확대(5→9 rows / 8rem→14rem, w-full). AC-4 담당의 행 flex-wrap(좁은폭 wrap 허용).
  //     AC-1(상단 컨텍스트 안내문구) · AC-2(임상경과 텍스트 필수 라벨)는 prior REFINE 에서 이미 제거 완료 — 잔존 0 회귀가드만.
  //     ⚠ 진료의 NOT NULL 강제(AC-P2-6, 의료법, handleSave `if (!formSigningDoctorId)`)는 절대 무변경.
  //   상태/핸들러(formClinical·handleClinicalChange·handleSave·formSigningDoctorId·clinicDoctors)는 전부 기존 재사용.
  //   저장 로직(같은날 append·진료의 NOT NULL 강제 AC-P2-6)은 무변경.
  const clinicalMiniBody = loading ? (
    <div className={cn('flex items-center justify-center', embed ? 'py-12' : 'flex-1')}>
      <Loader2 className="h-8 w-8 animate-spin text-teal-400" />
    </div>
  ) : (
    <div
      className={cn('flex flex-col', embed ? '' : 'flex-1 overflow-y-auto')}
      data-testid="medical-chart-clinical-mini"
    >
      <div className={cn('space-y-4', embed ? 'p-4' : 'flex-1 p-5')}>
        {/* T-20260615-foot-DOCPATIENTLIST-DONE-CLINICAL-READONLY (문지은 대표원장, item3 '내용 없으면 빈 편집폼 금지'):
            읽기전용(진료완료/당일 외)인데 임상경과 내용이 비어있으면 — 담당의 select·textarea(빈 편집폼)를 렌더하지 않고
            '기록 없음' 안내만 노출(내용 있을 때만 표시). 편집 호출자(readOnly=false)는 항상 폼 노출 → 무회귀. */}
        {isReadOnly && !formClinical.trim() ? (
          <p
            className="py-2 text-[13px] text-muted-foreground/60"
            data-testid="clinical-mini-empty-readonly"
          >
            작성된 임상경과가 없습니다.
          </p>
        ) : (
        <>
        {/* 담당 의사 (저장 필수 — 의료법, 기존 검증 동일 재사용)
            T-20260610-foot-DOCDASH-CLINICAL-UX-REFINE AC-4: label+select 1줄 인라인.
            T-20260610-foot-DOCDASH-CLINICAL-INLINE-REFINE AC-4: 담당의 선택칸+인접(label) 동일 행 컴팩트 유지 + flex-wrap(좁은폭 wrap 허용).
            ⚠️ 진료의 NOT NULL 강제(MEDCHART-SIGN-AUDIT AC-P2-6, 의료법) 검증 유지 — 라벨 텍스트만 정리. */}
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="w-16 shrink-0 text-xs font-semibold text-muted-foreground">
              담당 의사
            </label>
            <select
              value={formSigningDoctorId}
              onChange={(e) => setFormSigningDoctorId(e.target.value)}
              disabled={isReadOnly}
              className={`h-10 text-sm flex-1 max-w-[280px] rounded-md border px-3 bg-background ${
                !formSigningDoctorId ? 'border-rose-300 focus:border-rose-400' : 'border-input'
              }`}
              data-testid="clinical-mini-signing-doctor"
              aria-label="담당 의사(진료의)"
            >
              <option value="">의사를 선택하세요</option>
              {clinicDoctors.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
          {!formSigningDoctorId && !isReadOnly && (
            <p className="mt-1 text-[11px] text-rose-500" data-testid="clinical-mini-doctor-warning">
              진료의를 선택해야 저장할 수 있습니다.
            </p>
          )}
        </div>

        {/* 임상경과 — 기존 textarea 핸들러/// 자동완성 재사용. embed는 2~3줄로 컴팩트. */}
        <div>
          {/* T-20260612-foot-MEDREC-DATE-DIAG-UI-REFINE 6번: 슬래시 단축어 안내 설명 텍스트 제거
              (기능 무변경 — 슬래시 트리거 핸들러·팝오버 유지). 임상경과 라벨만 유지. */}
          <div className="flex items-center mb-1">
            <label className="text-xs font-semibold text-muted-foreground">임상경과</label>
          </div>
          <div className="relative">
            <Textarea
              ref={clinicalRef}
              value={formClinical}
              onChange={handleClinicalChange}
              onBlur={() => { setTimeout(() => setPhrasePopoverVisible(false), 200); }}
              readOnly={isReadOnly}
              placeholder="임상경과를 입력하세요"
              rows={embed ? 9 : 14}
              className={cn(
                'text-sm resize-y placeholder:text-gray-300',
                // T-20260610-foot-DOCDASH-CLINICAL-INLINE-REFINE AC-3: embed textarea 추가 확대 + full-width.
                //   (Textarea 기본 w-full 이나 AC-3 'full-width' 명시 의도로 유지) 풀차트(embed=false)는 14/18rem 불변.
                embed ? 'w-full min-h-[14rem]' : 'min-h-[18rem]',
                // T-20260610-foot-DOCPATIENTLIST-EXPAND-CLINICAL (AC-3): 읽기전용(당일 외) 시각 힌트 — 회색 처리.
                isReadOnly && 'bg-gray-50 text-gray-500 cursor-not-allowed',
              )}
              data-testid="clinical-mini-textarea"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-1p-ignore
              data-lpignore="true"
            />
            {/* 미니멀 // 자동완성 — 기존 데이터·핸들러 재사용, 위치는 textarea 하단 고정(간소) */}
            {phrasePopoverVisible && (filteredSuperPhrases.length > 0 || filteredPhrases.length > 0) && (
              <div
                className="absolute left-0 right-0 top-full mt-1 z-[200] max-h-72 overflow-y-auto rounded-lg border bg-popover shadow-xl"
                onMouseDown={(e) => e.preventDefault()}
                data-testid="clinical-mini-phrase-popover"
              >
                {filteredSuperPhrases.map((sp) => (
                  <button
                    key={`sp-${sp.id}`}
                    type="button"
                    onClick={() => applySuperPhraseFromSlash(sp)}
                    disabled={gateChecking}
                    className="w-full text-left px-3 py-2 hover:bg-teal-50 flex items-start gap-2 border-b border-border/50 disabled:opacity-50"
                    data-testid="clinical-mini-super-option"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-medium truncate">{sp.name}</div>
                      <div className="text-[10px] text-muted-foreground line-clamp-1">
                        {[sp.diagnosis, sp.clinical_progress].filter(Boolean).join(' · ') || `처방 ${sp.rx_items.length}개`}
                      </div>
                    </div>
                  </button>
                ))}
                {filteredPhrases.map((p) => (
                  <button
                    key={`p-${p.id}`}
                    type="button"
                    onClick={() => insertPhrase(p)}
                    className="w-full text-left px-3 py-2 hover:bg-muted flex items-start gap-2 border-b border-border/50 last:border-0"
                    data-testid="clinical-mini-phrase-option"
                  >
                    {p.shortcut_key && (
                      <Badge variant="secondary" className="text-[9px] shrink-0 mt-0.5 h-4 px-1 font-mono">
                        //{p.shortcut_key}
                      </Badge>
                    )}
                    <div className="min-w-0">
                      <div className="text-xs font-medium truncate">{p.name}</div>
                      <div className="text-[10px] text-muted-foreground line-clamp-1">{p.content}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        </>
        )}
      </div>

      {/* 저장 / 닫기 — handleSave 그대로 재사용(AC1-3).
          T-20260610-foot-DOCPATIENTLIST-EXPAND-CLINICAL (AC-3): embed 읽기전용(당일 외)일 때는
          footer(닫기+저장) 전체 미노출 → 오기입 방지. 비-embed(Drawer)는 닫기 버튼 필요로 항상 유지(회귀 0). */}
      {!(embed && isReadOnly) && (
        <div className={cn('flex gap-3', embed ? 'px-4 pb-4' : 'flex-none px-5 py-4 border-t bg-background')}>
          <Button
            size={embed ? 'default' : 'lg'}
            variant="outline"
            className={embed ? 'h-10' : 'h-12 text-base'}
            onClick={() => onOpenChange(false)}
            data-testid="clinical-mini-close-btn"
          >
            닫기
          </Button>
          <Button
            size={embed ? 'default' : 'lg'}
            className={cn('flex-1 bg-neutral-800 hover:bg-neutral-900 text-white', embed ? 'h-10' : 'h-12 text-base')}
            onClick={handleSave}
            disabled={saving || !formDate}
            data-testid="clinical-mini-save-btn"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {saving ? '저장 중...' : '임상경과 저장'}
          </Button>
        </div>
      )}
    </div>
  );

  // T-20260611-foot-DOCDASH-TABLEVIEW-CONVERGE B안: 임상경과 '한 줄 텍스트 인풋' 컴팩트 폼.
  //   tall 아코디언(담당의 섹션 + textarea rows 9 + 저장 섹션) 대신 1줄: [담당의 select | 한 줄 input | 저장].
  //   상태/핸들러(formClinical·handleClinicalChange·handleSave·formSigningDoctorId·clinicDoctors)·// 자동완성 전부 재사용.
  //   ⚠ 진료의 NOT NULL 강제(handleSave `if (!formSigningDoctorId)`, 의료법)·clinical_progress 저장 로직 무변경.
  const clinicalSingleLineBody = loading ? (
    <div className="flex items-center justify-center py-4" data-testid="clinical-singleline-loading">
      <Loader2 className="h-5 w-5 animate-spin text-teal-400" />
    </div>
  ) : (
    <div className="p-2.5" data-testid="clinical-singleline">
      <div className="flex flex-wrap items-center gap-2">
        {/* 담당 의사 (저장 필수 — 의료법, 기존 검증 동일 재사용).
            T-20260613-foot-DOCDASH-CALLUX-3FIX AC-2 (문지은 대표원장, 11FIX AC-6 supersede):
              (a) '변경' 버튼 기본 비노출 → "진료의 ○○○" 레이블 자체를 클릭하면 드롭다운 확장.
              (b) 드롭다운(select)에서 의사 변경 진입.
              (c) 현재와 '다른' 의사 선택 → 재확인 모달(pendingDoctorChange) → '확인' 시에만 반영.
                  동일 의사 재선택/모달 취소 → 무변경. 최초 지정(기존 진료의 없음)은 모달 없이 바로 반영(NOT NULL 강제 보존). */}
        {/* T-20260614-foot-DOCDASH-POSTDEPLOY-REFINE-5 item②: 외부클릭 원복 감지 컨테이너.
            display:contents(=className="contents")로 flex 레이아웃 무영향, DOM 포함관계만 제공(ref.contains). */}
        <span ref={singleDoctorCellRef} className="contents">
        {(() => {
          const selectedSingleDoctor = clinicDoctors.find((d) => d.id === formSigningDoctorId) ?? null;
          const showLabel = !!formSigningDoctorId && !!selectedSingleDoctor && !editingSingleDoctor;
          if (showLabel) {
            // AC-2(a/b): 레이블 자체가 드롭다운 진입 트리거(별도 '변경' 버튼 제거).
            return isReadOnly ? (
              <span
                className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1.5 text-xs"
                data-testid="clinical-singleline-doctor-label"
              >
                <span className="font-medium text-gray-700">진료의 {selectedSingleDoctor.name}</span>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setEditingSingleDoctor(true)}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1.5 text-xs transition-colors hover:border-teal-300 hover:bg-teal-50"
                data-testid="clinical-singleline-doctor-label"
                title="진료의 변경 — 클릭하여 의사 선택"
                aria-label="진료의 변경"
              >
                <span className="font-medium text-gray-700">진료의 {selectedSingleDoctor.name}</span>
              </button>
            );
          }
          return (
            <select
              value={formSigningDoctorId}
              onChange={(e) => {
                const next = e.target.value;
                // 비우기(빈값) → NOT NULL 강제 게이트가 저장 차단(무회귀). 즉시 반영.
                if (!next) {
                  setFormSigningDoctorId('');
                  return;
                }
                // 동일 의사 재선택 → 무변경, 편집 종료.
                if (next === formSigningDoctorId) {
                  setEditingSingleDoctor(false);
                  return;
                }
                // 기존 진료의가 있는데 '다른' 의사 선택 → AC-2(c) 재확인 모달(확정 전 보류).
                if (formSigningDoctorId) {
                  const nd = clinicDoctors.find((d) => d.id === next);
                  setPendingDoctorChange({ id: next, name: nd?.name ?? '' });
                  return;
                }
                // 최초 지정(기존 진료의 없음) → 모달 없이 바로 반영.
                setFormSigningDoctorId(next);
                setEditingSingleDoctor(false);
              }}
              disabled={isReadOnly}
              className={cn(
                'h-9 w-28 shrink-0 rounded-md border px-2 text-xs bg-background',
                !formSigningDoctorId ? 'border-rose-300 focus:border-rose-400' : 'border-input',
              )}
              data-testid="clinical-singleline-doctor"
              aria-label="담당 의사(진료의)"
            >
              <option value="">의사 선택</option>
              {clinicDoctors.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          );
        })()}
        </span>
        {/* 임상경과 — 한 줄 입력. // 자동완성 유지 위해 Textarea(rows=1)로 단일행 렌더. */}
        <div className="relative min-w-[160px] flex-1">
          <Textarea
            ref={clinicalRef}
            value={formClinical}
            onChange={handleClinicalChange}
            onBlur={() => { setTimeout(() => setPhrasePopoverVisible(false), 200); }}
            readOnly={isReadOnly}
            placeholder="임상경과 입력"
            rows={1}
            /* T-20260612-foot-DOCDASH-11FIX AC-5: 고정 h-9 → 내용 높이만큼 auto-resize(useEffect가 scrollHeight로 확장).
               min-h 로 한 줄 기준 높이 보장, overflow-hidden 으로 스크롤 없이 전체 표시. */
            className={cn(
              'min-h-[2.25rem] resize-none overflow-hidden py-2 text-sm placeholder:text-gray-300',
              isReadOnly && 'bg-gray-50 text-gray-500 cursor-not-allowed',
            )}
            data-testid="clinical-singleline-input"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            data-1p-ignore
            data-lpignore="true"
          />
          {/* T-20260612-foot-CLINICAL-SINGLELINE-DROPDOWN-POS:
              단축어 드롭다운이 absolute(top-full)라 진료대시보드 '테이블 행' stacking/overflow 에 갇혀
              텍스트칸/다음 행 뒤로 가려짐(문지은 재신고). → 선례 PHRASE-SLASH-DROPDOWN-POS(4e8df2b) 패턴
              (document.body portal + position:fixed + getTextareaCaretRect + z-[200]) 을 single-line 분기에 한정 적용.
              AC-1 최상위 렌더(클리핑/뒤로깔림 제거) · AC-2 하단 행에선 위로 열기(flip)+viewport clamp · AC-3 자동완성 무회귀.
              ⚠ 공유 유틸 getTextareaCaretRect 는 호출만(무변경) — PHRASE-BROKEN-REGRESS·PINGPONG5 회귀 가드. */}
          {phrasePopoverVisible && (filteredSuperPhrases.length > 0 || filteredPhrases.length > 0) && (() => {
            const ta = clinicalRef.current;
            if (!ta) return null;
            const POPOVER_MAX = 300;
            const taRect = ta.getBoundingClientRect();
            // single-line 폭에 맞춰 드롭다운 폭 정렬(최소 240, viewport 안전 clamp).
            const POPOVER_W = Math.min(Math.max(240, taRect.width), window.innerWidth - 16);
            // single-line 은 caret 좌표보다 input 자체 하단/상단 기준이 자연스러움 → input 경계로 앵커.
            // (getTextareaCaretRect 는 줄바꿈 없는 한 줄이라 lineHeight 만 안전 참조 — 호출 무변경/회귀가드.)
            const lineBottom = taRect.bottom;
            const spaceBelow = window.innerHeight - lineBottom;
            // AC-2: 아래 공간 부족(테이블 하단 행)이면 위로 열기(flip) + 상단 8px clamp.
            const top = spaceBelow > POPOVER_MAX
              ? lineBottom + 4
              : Math.max(8, taRect.top - POPOVER_MAX - 4);
            const left = Math.min(Math.max(8, taRect.left), window.innerWidth - POPOVER_W - 8);
            return createPortal(
              <div
                style={{ position: 'fixed', top, left, width: POPOVER_W, maxHeight: POPOVER_MAX }}
                className="z-[200] overflow-y-auto rounded-lg border bg-popover shadow-xl"
                onMouseDown={(e) => e.preventDefault()}
                data-testid="clinical-singleline-phrase-popover"
              >
                {filteredSuperPhrases.map((sp) => (
                  <button
                    key={`sp-${sp.id}`}
                    type="button"
                    onClick={() => applySuperPhraseFromSlash(sp)}
                    disabled={gateChecking}
                    className="w-full text-left px-3 py-2 hover:bg-teal-50 flex items-start gap-2 border-b border-border/50 disabled:opacity-50"
                    data-testid="clinical-singleline-super-option"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-medium truncate">{sp.name}</div>
                      <div className="text-[10px] text-muted-foreground line-clamp-1">
                        {[sp.diagnosis, sp.clinical_progress].filter(Boolean).join(' · ') || `처방 ${sp.rx_items.length}개`}
                      </div>
                    </div>
                  </button>
                ))}
                {filteredPhrases.map((p) => (
                  <button
                    key={`p-${p.id}`}
                    type="button"
                    onClick={() => insertPhrase(p)}
                    className="w-full text-left px-3 py-2 hover:bg-muted flex items-start gap-2 border-b border-border/50 last:border-0"
                    data-testid="clinical-singleline-phrase-option"
                  >
                    {p.shortcut_key && (
                      <Badge variant="secondary" className="text-[9px] shrink-0 mt-0.5 h-4 px-1 font-mono">
                        //{p.shortcut_key}
                      </Badge>
                    )}
                    <div className="min-w-0">
                      <div className="text-xs font-medium truncate">{p.name}</div>
                      <div className="text-[10px] text-muted-foreground line-clamp-1">{p.content}</div>
                    </div>
                  </button>
                ))}
              </div>,
              document.body
            );
          })()}
        </div>
        {/* 저장 — handleSave 그대로 재사용. 읽기전용(당일 외)일 땐 미노출(오기입 방지, 기존 정책 동일).
            ⚠ 한 줄(singleLine) 유지를 위해 별도 경고 <p> 미추가 — 미선택 시 select rose 보더 + handleSave toast 로 안내
              (CLINICAL-UX-REFINE '경고 p 2건' 카운트 무회귀). 진료의 NOT NULL 강제(handleSave)는 동일. */}
        {!isReadOnly && (
          <Button
            size="sm"
            className="h-9 shrink-0 bg-neutral-800 hover:bg-neutral-900 text-white"
            onClick={handleSave}
            disabled={saving || !formDate}
            data-testid="clinical-singleline-save"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : '저장'}
          </Button>
        )}
      </div>
      {/* T-20260613-foot-DOCDASH-CALLUX-3FIX AC-2(c): 다른 의사 선택 시 재확인 모달.
          '확인' 시에만 진료의 변경 반영(setFormSigningDoctorId). '취소'/배경 클릭 → 무변경, 원래 진료의 레이블 복귀. */}
      {pendingDoctorChange && createPortal(
        <div
          className="fixed inset-0 z-[300] flex items-center justify-center bg-black/40 p-4"
          data-testid="clinical-singleline-doctor-confirm"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              setPendingDoctorChange(null);
              setEditingSingleDoctor(false);
            }
          }}
        >
          <div
            className="w-full max-w-xs rounded-lg bg-white p-4 shadow-xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <p className="text-sm font-semibold text-gray-800">진료의 변경</p>
            <p className="mt-1.5 text-[13px] text-gray-600">
              진료의를{' '}
              <span className="font-medium text-gray-900">{pendingDoctorChange.name}</span>{' '}
              (으)로 변경할까요?
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setPendingDoctorChange(null);
                  setEditingSingleDoctor(false);
                }}
                className="rounded-md border border-input bg-background px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
                data-testid="clinical-singleline-doctor-confirm-cancel"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => {
                  setFormSigningDoctorId(pendingDoctorChange.id);
                  setPendingDoctorChange(null);
                  setEditingSingleDoctor(false);
                }}
                className="rounded-md bg-neutral-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-900"
                data-testid="clinical-singleline-doctor-confirm-ok"
              >
                확인
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );

  // T-20260609-foot-DOCDASH-CHART-UX item1 (AC1-1): embed clinical → 인라인(아코디언) 렌더.
  //   portal/백드롭/슬라이드아웃 Drawer 미사용 — 호출부(진료대시보드 행) DOM 흐름에 그대로 펼침.
  // T-20260611-foot-DOCDASH-TABLEVIEW-CONVERGE B안: singleLine=true 면 tall 아코디언 대신 한 줄 폼.
  if (embed && variant === 'clinical') {
    if (singleLine) {
      return (
        <div
          className="rounded-lg border border-teal-200 bg-teal-50/20"
          data-testid="medical-chart-clinical-singleline"
        >
          {clinicalSingleLineBody}
        </div>
      );
    }
    return (
      <div
        className="rounded-lg border border-teal-200 bg-teal-50/20"
        data-testid="medical-chart-clinical-inline"
      >
        {clinicalMiniBody}
      </div>
    );
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
        // T-20260609-foot-CHARTBTN-MINIMAL-COURSE-DRAWER: clinical 미니멀 뷰는 좁은 폭(임상경과만).
        // T-20260613-foot-MEDCHART-DIAG-RX-TABLEVIEW-REFINE AC-1: 진료차트 Drawer 폭 1440→1520px 소폭 확대.
        //   좌측 타임라인(w-56)·우측 패널(w-72)은 고정폭 → 추가 80px는 전부 중앙 본문(flex-1)으로 흘러
        //   '중앙 차트만 넓게'(좌우 칼럼 폭 불변) 요청 충족. 1520-(224+288)=1008px < max-w-5xl(1024) → 클리핑 無.
        style={{ width: variant === 'clinical' ? 'min(94vw, 560px)' : 'min(97vw, 1520px)' }}
        data-testid="medical-chart-drawer"
        data-variant={variant}
      >
        {/* ── 헤더 ─────────────────────────────────────────────────────────────── */}
        <div className="flex-none flex items-center justify-between px-5 py-3 border-b bg-background shadow-sm">
          <div className="flex items-center gap-3">
            <span className="text-base font-bold text-teal-700">
              {variant === 'clinical' ? '빠른 임상경과' : '진료차트'}
            </span>
            {customer && (
              <div className="flex items-center gap-2 ml-1">
                <span className="font-semibold">{customer.name}</span>
                {/* T-20260612-foot-PATIENT-CHARTNO-PAIRING-AUDIT: 차트번호 항상 표시(미발번도 명시) */}
                <span className="text-xs text-muted-foreground font-mono">{chartNoBadge(customer.chart_number)}</span>
                <span className="text-xs text-muted-foreground">{formatPhone(customer.phone)}</span>
                {customer.birth_date && (
                  <span className="text-xs text-muted-foreground">
                    {/^\d{6}$/.test(customer.birth_date)
                      ? `${customer.birth_date.slice(0, 2)}/${customer.birth_date.slice(2, 4)}/${customer.birth_date.slice(4, 6)}`
                      : customer.birth_date}
                  </span>
                )}
                {/* T-20260609-foot-DOCCALL-DOCTOR-ACK AC8: 환자차트 ✋ 표시 — 확인됨 파란 고정 / 활성호출 미확인 pulse 대기. */}
                <DoctorAckBadge ackAt={docAck.ackAt} showPending={docAck.hasActiveCall} />
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* T-20260607-foot-MEDCHART-CONSULT-DRAWER (A안): 상담기록 진입은 우측 "📋 상담" 탭으로 이식.
                기존 헤더 빠른조회 버튼/서랍 제거 — 진료폼 입력 유지하며 탭으로 전환 조회. */}
            {/* AC-9: 현재 로그인 의사 상시 표시 */}
            <span
              className="flex items-center gap-1 rounded-full bg-teal-50 border border-teal-200 px-2.5 py-1 text-xs font-semibold text-teal-700"
              data-testid="current-doctor-name"
              title="현재 로그인 의사"
            >
              {currentUserName}
            </span>
            {/* T-20260609-foot-MEDDASH-MINIMAL-TABLE AC-5: clinical 미니멀 drawer → 전체 진료차트 승격.
                같은 customerId·같은 패널 인스턴스 유지(variant만 전환) → 작성 중 임상경과 보존,
                AC-6 2단 레이아웃 그대로 재진입(full 경로 무변경). */}
            {variant === 'clinical' && onOpenFull && (
              <button
                type="button"
                onClick={onOpenFull}
                data-testid="clinical-open-full-btn"
                className="inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100 transition-colors"
                title="전체 진료차트(타임라인·진단·치료·처방·진료메모) 열기"
              >
                본 차트 열기
              </button>
            )}
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
          {/* T-20260609-foot-CHARTBTN-MINIMAL-COURSE-DRAWER (AC-1): clinical 미니멀 본문.
              임상경과 + 담당의사 + 저장만. 타임라인·진단·치료·처방·진료메모·우측패널 전부 제외.
              상태/핸들러(formClinical·handleClinicalChange·handleSave·formSigningDoctorId·clinicDoctors)는
              전부 기존 것 재사용 — 신규 저장경로 없음. */}
          {variant === 'clinical' ? (
            clinicalMiniBody
          ) : loading ? (
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
                    새 기록
                  </button>
                </div>

                {/* T-20260603-foot-CHART-SPECIAL-NOTE: ⑤ 특이사항 공용 누적칸 (환자 단위, 날짜 분기 없음)
                    T-20260609-foot-SPECIALNOTE-MEMO-UX: 메모판 UX (저장 로직·스키마 무변경, FE presentation only)
                    T-20260609-foot-MEDCHART-SOAK-REFINE item1 (문지은 대표원장 field-soak — 부분 revert/policy_superseded):
                      AC1-1 이모지 제거 · AC1-2 "특이사항" 단일화+다른 섹션과 헤더 스타일 통일
                      · AC1-3 포스트잇/박스 강조 제거→배경에 녹임(내용 有일 때만 검은 볼드 강조)
                      · AC1-4 미리보기 글씨 제거 · AC1-5 빈상태 텍스트 제거(비면 아무것도 안 보임)
                      · AC1-6 버튼형 입력→줄(inline) 입력 (밑줄, Enter 저장) */}
                <div className="flex-none mx-2 mt-2" data-testid="special-note-section">
                  {/* T-20260613-foot-MEDCHART-MEMO-TIMELINE-REFINE AC-5: 헤더 = [연필(편집 진입)] + [특이사항 펼침 토글].
                      펼침은 읽기 전용(입력창 자동 노출 X). 토글 왼쪽 연필(흑백 아이콘)을 눌러야 편집 모드 진입(입력창 노출). */}
                  <div className="w-full flex items-center gap-1 py-1">
                    {/* AC-5: 연필 토글(흑백) — 펼친 상태에서만 노출. 클릭 시 편집 모드 on/off. */}
                    {specialNoteOpen && (
                      <button
                        type="button"
                        onClick={() => setSpecialNoteEditing(e => !e)}
                        className={`shrink-0 rounded p-0.5 transition-colors ${specialNoteEditing ? 'text-gray-900' : 'text-gray-400 hover:text-gray-700'}`}
                        title={specialNoteEditing ? '편집 종료' : '특이사항 편집'}
                        aria-label={specialNoteEditing ? '편집 종료' : '특이사항 편집'}
                        aria-pressed={specialNoteEditing}
                        data-testid="special-note-edit-toggle"
                      >
                        <Edit2 className="h-3 w-3" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => { specialNoteManualRef.current = true; setSpecialNoteOpen(o => { const next = !o; if (!next) setSpecialNoteEditing(false); return next; }); }}
                      className="flex-1 flex items-center justify-between gap-1 hover:opacity-80 transition-opacity"
                      data-testid="special-note-toggle"
                      aria-expanded={specialNoteOpen}
                    >
                      <span className={`flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide ${specialNotes.length > 0 ? 'text-gray-900' : 'text-muted-foreground'}`}>
                        특이사항
                        {specialNotes.length > 0 && (
                          <span className="text-[9px] tabular-nums font-bold">({specialNotes.length})</span>
                        )}
                        {/* T-20260613-foot-MEDCHART-EDITSTATE-RX-POLISH AC-2 (supersede EDITMODE AC-3):
                            편집 vs 읽기 시각 구분을 '과한 색' teal 배지 → 미니멀 흑백 톤으로 전환.
                            편집(연필 ON) 상태일 때만 중립 회색 '편집 중' 배지 노출(흑백 톤, 색상 강조 없음). */}
                        {specialNoteEditing && (
                          <span
                            className="rounded-sm border border-gray-300 bg-gray-100 px-1 py-px text-[8px] font-bold normal-case tracking-normal text-gray-600"
                            data-testid="special-note-editing-badge"
                          >
                            편집 중
                          </span>
                        )}
                      </span>
                      <ChevronDown
                        className={`h-3 w-3 text-muted-foreground transition-transform duration-200 ${specialNoteOpen ? 'rotate-180' : ''}`}
                      />
                    </button>
                  </div>

                  {specialNoteOpen && (
                    <div
                      className={`pb-1 space-y-1 transition-colors ${specialNoteEditing ? 'rounded-md bg-gray-50 ring-1 ring-gray-200 px-1.5 py-1' : ''}`}
                      data-testid="special-note-panel"
                    >
                      {/* T-20260613-foot-MEDCHART-EDITSTATE-RX-POLISH AC-2: 편집(연필 ON) 모드일 때만 패널에
                          옅은 회색 배경+테두리(흑백 톤)를 입혀 읽기 모드와 '글씨 느낌'이 달라 보이게 — 과한 색 없이
                          미니멀 그레이스케일로 '지금 편집 중' 인지. 읽기 모드는 기존처럼 배경 강조 없음. */}
                      {/* 내용 있을 때만 목록 렌더(빈상태 텍스트 없음). 박스/배경 강조 없이 왼쪽 컬러바 + 본문. */}
                      {specialNotes.length > 0 && (
                        <div className="max-h-44 overflow-y-auto space-y-1" data-testid="special-note-list">
                          {specialNotes.map(note => {
                            const recorder = note.created_by_name || recorderName(note.created_by) || '미상';
                            let metaDate = '';
                            try { metaDate = format(new Date(note.created_at), 'yy.MM.dd'); } catch { metaDate = ''; }
                            // AC-6: 빨강/파랑 닷으로 글씨색 토글(presentation-only). 미지정 = 기본 gray-900.
                            const colorOv = noteColorOverrides[note.id];
                            const bodyColorClass = colorOv === 'red' ? 'text-red-600' : colorOv === 'blue' ? 'text-blue-600' : 'text-gray-900';
                            return (
                            <div
                              key={note.id}
                              className="border-l-2 border-gray-200 pl-2 py-0.5"
                              data-testid="special-note-item"
                            >
                              {/* 우상단 메타 1줄 + (좌) 컬러 닷 토글 */}
                              <div className="flex items-center justify-between gap-1">
                                {/* T-20260613-foot-MEDCHART-EDITMODE-RXTABLE-LAYOUT-POLISH AC-2: 빨강/파랑 상태닷은
                                    편집(연필 ON) 상태일 때만 노출 — 기본(읽기) 상태에선 숨김. 적용된 글씨색(red/blue)은
                                    닷과 무관하게 본문에 상시 유지(bodyColorClass). */}
                                {specialNoteEditing && (
                                <span className="flex items-center gap-1 shrink-0" data-testid="special-note-color-dots">
                                  <button
                                    type="button"
                                    onClick={() => setNoteColorOverrides(prev => { const n = { ...prev }; if (n[note.id] === 'red') delete n[note.id]; else n[note.id] = 'red'; return n; })}
                                    className={`h-2.5 w-2.5 rounded-full bg-red-500 transition-all ${colorOv === 'red' ? 'ring-1 ring-offset-1 ring-red-600' : 'opacity-50 hover:opacity-100'}`}
                                    title="글씨 빨강"
                                    aria-label="글씨 빨강으로 표시"
                                    aria-pressed={colorOv === 'red'}
                                    data-testid="special-note-dot-red"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => setNoteColorOverrides(prev => { const n = { ...prev }; if (n[note.id] === 'blue') delete n[note.id]; else n[note.id] = 'blue'; return n; })}
                                    className={`h-2.5 w-2.5 rounded-full bg-blue-500 transition-all ${colorOv === 'blue' ? 'ring-1 ring-offset-1 ring-blue-600' : 'opacity-50 hover:opacity-100'}`}
                                    title="글씨 파랑"
                                    aria-label="글씨 파랑으로 표시"
                                    aria-pressed={colorOv === 'blue'}
                                    data-testid="special-note-dot-blue"
                                  />
                                </span>
                                )}
                                <span
                                  className="ml-auto shrink-0 text-[8px] leading-tight text-muted-foreground/60 tabular-nums text-right"
                                  data-testid="special-note-meta"
                                  title={(() => { try { return format(new Date(note.created_at), 'yyyy.MM.dd HH:mm'); } catch { return ''; } })()}
                                >
                                  {metaDate} <span data-testid="special-note-recorder">{recorder}</span>
                                </span>
                              </div>
                              {/* 본문 — AC-6 글씨색(빨강/파랑/기본) 적용 */}
                              <p className={`text-left text-[11px] font-semibold whitespace-pre-wrap leading-snug break-words mt-0.5 ${bodyColorClass}`}>
                                {note.content}
                              </p>
                            </div>
                            );
                          })}
                        </div>
                      )}

                      {/* AC-5: 입력창은 편집 모드(연필 클릭)일 때만 노출 — 펼침만으로는 안 보임(읽기 전용 기본). */}
                      {specialNoteEditing && (
                        <Input
                          value={specialNoteInput}
                          onChange={e => setSpecialNoteInput(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter' && !(e.nativeEvent as { isComposing?: boolean }).isComposing) {
                              e.preventDefault();
                              if (!specialNoteSaving && specialNoteInput.trim()) addSpecialNote();
                            }
                          }}
                          placeholder="특이사항 입력 후 Enter"
                          disabled={specialNoteSaving}
                          autoFocus
                          className="h-7 text-[11px] border-0 border-b border-gray-200 rounded-none bg-transparent px-1 shadow-none focus-visible:ring-0 focus-visible:border-gray-900 placeholder:text-muted-foreground/40"
                          data-testid="special-note-input"
                        />
                      )}
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
                    </span>
                    {/* T-20260613-foot-CHARTFILTER-EMPTYTEXT-TOGGLE AC-2: 모두펼침/모두접기 = 현재 상태 토글.
                        현장 혼란("내가 누른 게 켜진 건지 헷갈림") 해소 → 현재 상태인 쪽 버튼을 solid 강조(스위치 ON 느낌:
                        진한 배경+흰 글씨), 중립/비현재 쪽은 약한 outline. 데이터 없음(0건)만 진짜 dim(opacity).
                        allExpanded=전부펼침=펼침 ON / expandedCount===0=전부접힘=접기 ON / 부분=둘 다 중립.
                        동작(expandAll/collapseAll·disabled 조건) 무변경 — 스타일만. */}
                    <div className="flex gap-0.5 shrink-0">
                      <button
                        type="button"
                        onClick={expandAll}
                        disabled={filteredDisplayCharts.length === 0 || allExpanded}
                        aria-pressed={allExpanded}
                        className={`text-[9px] font-semibold rounded px-1.5 py-0.5 border transition-colors ${
                          allExpanded
                            ? 'bg-teal-600 text-white border-teal-600 shadow-sm'
                            : filteredDisplayCharts.length === 0
                              ? 'text-teal-600 border-teal-200 opacity-30'
                              : 'text-teal-700 border-teal-200 hover:bg-teal-50 hover:text-teal-800'
                        }`}
                        data-testid="expand-all-btn"
                        title="모두 펼치기"
                      >
                        모두펼침
                      </button>
                      <button
                        type="button"
                        onClick={collapseAll}
                        disabled={expandedCount === 0}
                        aria-pressed={expandedCount === 0}
                        className={`text-[9px] font-semibold rounded px-1.5 py-0.5 border transition-colors ${
                          expandedCount === 0
                            ? 'bg-gray-700 text-white border-gray-700 shadow-sm'
                            : 'text-gray-700 border-gray-200 hover:bg-gray-50 hover:text-gray-800'
                        }`}
                        data-testid="collapse-all-btn"
                        title="모두 접기"
                      >
                        모두접기
                      </button>
                    </div>
                  </div>
                </div>

                {/* 경과 타임라인 레이블 (T-20260608-foot-MEDCHART-PANEL-CLARITY AC-1 + TIMELINE-FILTER AC-5:
                    좌=진료 전용 / 상담=우측 역할을 헤더로 한눈에 구분. "좌·우가 뭐가 다른지 모르겠다" 해소) */}
                <div className="flex-none px-2 pt-2 pb-1">
                  <span
                    className="inline-flex items-center gap-1 text-[10px] font-semibold text-teal-700 uppercase tracking-wide"
                    title="이 패널은 '진료 경과'만 시간순으로 모읍니다 — 진료메모·치료메모·처방. 항목을 클릭하면 우측 폼에서 편집합니다. ▸ 상담기록은 우측 '📋 상담' 탭에 있습니다. ▸ 우측 '방문이력'은 방문(체크인) 단위 읽기전용 뷰입니다."
                  >
                    {/* T-20260613-foot-MEDCHART-MEMO-TIMELINE-REFINE AC-7: 라벨에서 '타임라인' 단어 제거 → '진료경과'. */}
                    진료경과
                    {isDummyMode && (
                      <span className="ml-1 text-yellow-600 font-bold">[더미]</span>
                    )}
                  </span>
                  {/* T-20260620-foot-MEDCHART-DELETE-SAMEDAY-POLICY AC-1: "삭제된 차트 보기" 토글(director/admin 한정).
                      softDeleteEnabled(런타임 스키마 게이트) + 삭제된 차트가 있을 때만 노출. */}
                  {isDirector && softDeleteEnabled && deletedCharts.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowDeleted((v) => !v)}
                      className={`mt-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-medium border transition-colors ${
                        showDeleted
                          ? 'bg-red-50 border-red-300 text-red-700'
                          : 'bg-muted/40 border-border text-muted-foreground hover:bg-muted'
                      }`}
                      data-testid="toggle-show-deleted-charts"
                      aria-pressed={showDeleted}
                    >
                      {showDeleted ? `삭제된 차트 숨기기 (${deletedCharts.length})` : `삭제된 차트 보기 (${deletedCharts.length})`}
                    </button>
                  )}
                </div>

                <div className="flex-1 overflow-y-auto">
                  {/* 더미 모드 배너 */}
                  {isDummyMode && (
                    <div className="mx-2 mb-1 rounded border-2 border-yellow-400 bg-yellow-50 px-2 py-1 text-[10px] text-yellow-800 font-semibold">
                      실데이터 없음 — 더미 샘플 표시 중
                    </div>
                  )}

                  {/* T-20260609-foot-MEDCHART-SOAK-REFINE item2: 필터로 행을 지우지 않으므로
                      '필터 결과 없음' 빈 상태(날짜행 소거) 제거 — 방문 날짜행은 항상 보존, 내용만 가린다. */}

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
                        {/* 엔트리 헤더 — T-20260613-foot-MEDCHART-MEMO-TIMELINE-REFINE AC-8/AC-9 재구성.
                            상단 헤더 행(닷·날짜·진료의) 클릭 = 센터 폼 선택(기존 동선 유지).
                            하단 미리보기 텍스트 클릭 = 펼침/접기 토글(AC-8). 우측 ▾ 셰브론도 동일 토글. */}
                        <div className={`flex items-stretch ${selectedChartId === chart.id ? 'bg-teal-50 border-l-2 border-l-teal-500' : ''}`}>
                          <div className="flex-1 min-w-0">
                            {/* 헤더 행: 클릭 → 센터 폼 선택. AC-9: 닷 토글 왼쪽 여백 최소(pl-1.5),
                                날짜(좌측정렬) … 진료의(우측정렬) 한 줄. */}
                            <button
                              type="button"
                              onClick={() => selectChart(chart)}
                              className="w-full text-left pl-1.5 pr-2 pt-2 pb-0.5 hover:bg-muted transition-colors min-w-0"
                              data-testid={`chart-select-${chart.id}`}
                            >
                              <div className="flex items-center gap-1.5 leading-tight">
                                {/* T-20260609-foot-TIMELINE-FILTER-PREVIEW-FIX AC-9: 유형 컬러 닷 — 좌측 고정 컬럼.
                                    치료=파랑 / 진료=초록(emerald) / 처방=amber. 부재 유형은 transparent 닷으로 컬럼 폭만 유지. */}
                                <span className="flex items-center gap-1 shrink-0" data-testid="timeline-type-dots">
                                  <span
                                    className={`h-1.5 w-1.5 rounded-full ${hasTreat ? TYPE_DOT_CLASS.treat : 'bg-transparent'}`}
                                    data-type="treat"
                                    title={hasTreat ? '치료메모' : undefined}
                                  />
                                  <span
                                    className={`h-1.5 w-1.5 rounded-full ${hasDoc ? TYPE_DOT_CLASS.doc : 'bg-transparent'}`}
                                    data-type="doc"
                                    title={hasDoc ? '진료메모' : undefined}
                                  />
                                  <span
                                    className={`h-1.5 w-1.5 rounded-full ${hasRxItems ? TYPE_DOT_CLASS.rx : 'bg-transparent'}`}
                                    data-type="rx"
                                    title={hasRxItems ? '처방' : undefined}
                                  />
                                </span>
                                {/* AC-9: 날짜 좌측정렬(+더미) */}
                                <span className="text-[11px] font-semibold text-teal-700 shrink-0">
                                  {fmtDateShort(chart.visit_date)}
                                </span>
                                {isDummyEntry && (
                                  <span className="text-[9px] text-yellow-600 font-bold shrink-0">더미</span>
                                )}
                                {/* T-20260620-foot-MEDCHART-DELETE-SAMEDAY AC-1: soft-delete 행 배지(원장/관리자 '삭제된 차트 보기' 시에만 노출) */}
                                {chart.is_deleted && (
                                  <span className="text-[9px] text-red-600 font-bold shrink-0 bg-red-50 border border-red-200 rounded px-1" data-testid="timeline-deleted-badge">삭제됨</span>
                                )}
                                {/* AC-9: 진료의(작성자) 우측정렬 — 한 줄. 펼침 상세의 중복 표기(구 timeline-expanded-recorder)는 제거. */}
                                {recorder && (
                                  <span className="ml-auto text-[9px] text-muted-foreground truncate min-w-0 text-right pl-1" data-testid="timeline-recorder">
                                    {recorder}
                                  </span>
                                )}
                              </div>
                            </button>
                            {/* AC-8: 하단 미리보기 텍스트 — 클릭 시 펼침/접기 토글(별도 버튼: selectChart와 분리, 중첩 button 회피).
                                T-20260609-foot-TIMELINE-FILTER-PREVIEW-FIX: 미리보기는 선택 필터 유형 기준 구성. */}
                            <button
                              type="button"
                              onClick={() => toggleExpandChart(chart.id)}
                              className="w-full text-left pl-1.5 pr-2 pb-2 hover:bg-muted/60 transition-colors"
                              aria-expanded={isExpanded}
                              data-testid={`timeline-preview-toggle-${chart.id}`}
                            >
                              {(() => {
                                const segs = chartPreviewSegments(chart, memoFilters);
                                return (
                                  <div
                                    className={`text-[10px] font-medium text-foreground/80 mt-0.5 ${isExpanded ? 'whitespace-pre-wrap break-words' : 'truncate'}`}
                                    data-testid="timeline-preview"
                                  >
                                    {segs.length > 0
                                      ? segs.join('  ·  ')
                                      /* T-20260613-foot-CHARTFILTER-EMPTYTEXT-TOGGLE AC-1: 필터 빈상태 → "-"(대시). */
                                      : <span className="text-muted-foreground/60 font-normal">-</span>}
                                  </div>
                                );
                              })()}
                            </button>
                          </div>
                          {/* T-20260620-foot-MEDCHART-DELETE-SAMEDAY-POLICY AC-1: 진료차트 삭제(무효화) 버튼.
                              director/admin 한정(isDirector) + 더미·이미삭제행 제외 + softDeleteEnabled(런타임 스키마 게이트).
                              soft-delete만(의료법 §22-3 hard-delete 금지) — 확인 다이얼로그를 거쳐 handleConfirmDelete 실행. */}
                          {isDirector && softDeleteEnabled && !isDummyEntry && !chart.is_deleted && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setDeleteTarget(chart); setDeleteReason(''); }}
                              className="px-1.5 text-muted-foreground hover:text-red-600 hover:bg-red-50 transition-colors flex items-center shrink-0"
                              aria-label="진료 기록 삭제"
                              title="진료 기록 삭제(무효화) — 법적 보존을 위해 기록은 유지됩니다"
                              data-testid={`chart-delete-${chart.id}`}
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          )}
                          {/* 아코디언 토글 ▾ 버튼 (AC-8: 미리보기 클릭과 동일 동작) */}
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
                            {/* T-20260609-foot-TIMELINE-FILTER-PREVIEW-FIX AC-6 (AC-5와 일관):
                                펼친 상세 섹션도 활성 필터 유형만 노출 — 무필터=전체, 필터선택=선택 유형만(다중=누적).
                                작성자(recorder) 메타는 PROGRESS-TIMELINE-AUTHOR 보존 위해 필터와 무관하게 항상 표시. */}
                            {/* T-20260609-foot-CHART-LEFTCOL-MINIMAL AC-1/AC-2 (문지은 대표원장 후속, policy_superseded):
                                좌측 단 잔존 섹션 텍스트 라벨('치료메모'·'임상경과'·'진료메모') 제거 → 유형색
                                border-left 세로줄(2px)로만 구분(텍스트 없이 식별). 메모 본문 내용은 보존(AC-5).
                                색 매핑은 상단 유형 닷(TYPE_DOT_CLASS)과 동일 계열: 치료=blue·임상경과=teal·진료메모=red. */}
                            {hasTreat && isTypeActive(memoFilters, 'treat') && (
                              <div className="border-l-2 border-blue-400 pl-2">
                                <p className="text-[10px] text-gray-700 line-clamp-4 whitespace-pre-wrap leading-relaxed">
                                  {chart.treatment_record}
                                </p>
                              </div>
                            )}
                            {chart.clinical_progress && isTypeActive(memoFilters, 'doc') && (
                              <div className="border-l-2 border-teal-400 pl-2">
                                <p className="text-[10px] text-gray-700 line-clamp-4 whitespace-pre-wrap leading-relaxed">
                                  {chart.clinical_progress}
                                </p>
                              </div>
                            )}
                            {isDirector && chart.doctor_memo && isTypeActive(memoFilters, 'doc') && (
                              <div className="border-l-2 border-red-400 pl-2">
                                <p className="text-[10px] text-gray-700 line-clamp-4 whitespace-pre-wrap leading-relaxed">
                                  {chart.doctor_memo}
                                </p>
                              </div>
                            )}
                            {/* T-20260609-foot-MEDCHART-TIMELINE-COMPACT AC-3 (문지은 대표원장):
                                처방 = 약명 + 용량만 주르륵. 처방일시·코드·route·frequency·days 등 메타 숨김.
                                T-20260609-foot-MEDCHART-SOAK-REFINE AC3-3: "처방" 텍스트 헤더 → 검은색 미니멀 알약 아이콘.
                                AC3-4: 항목마다 줄바꿈(말줄임 제거). 묶음처방(4건+)은 버튼 토글로 펼침/접기(공간 효율). */}
                            {hasRxItems && isTypeActive(memoFilters, 'rx') && (() => {
                              const rxList = (chart.prescription_items ?? []).filter(rx => rx?.name?.trim());
                              const isBundle = rxList.length > 3;
                              const rxOpen = expandedRxCharts.has(chart.id);
                              const shown = isBundle && !rxOpen ? rxList.slice(0, 2) : rxList;
                              return (
                                <div data-testid="timeline-rx-section">
                                  {/* AC3-3: 검은색 미니멀 알약 아이콘 (텍스트 라벨 대체) */}
                                  <div className="flex items-center gap-1">
                                    <Pill className="h-3 w-3 text-gray-900 shrink-0" aria-label="처방" data-testid="timeline-rx-pill-icon" />
                                    {isBundle && (
                                      <span className="text-[9px] text-gray-500">묶음처방 {rxList.length}건</span>
                                    )}
                                  </div>
                                  {/* AC3-4: 항목마다 줄바꿈 (truncate 제거 → break-words) */}
                                  <ul className="text-[10px] text-gray-700 leading-relaxed mt-0.5 space-y-0.5">
                                    {/* T-20260614-foot-RX-DISPLAY-BUNDLE-TOKEN-FIX (AC-1/AC-2):
                                        reporter(문지은) — 약물명 1/3/2(1회량/1일횟수/총일수) 토큰 표기.
                                        구 '{name} {dosage}' raw text(반쪽) → SSOT formatRxItemToken 단일 경로.
                                        묶음처방(prescription_sets) 흡수분도 동일 항목 shape라 동일 토큰으로 렌더. */}
                                    {shown.map((rx, i) => (
                                      <li key={i} className="break-words" data-testid="timeline-rx-item">
                                        {formatRxItemToken(rx)}
                                      </li>
                                    ))}
                                  </ul>
                                  {/* AC3-4: 묶음처방 펼침/접기 토글 버튼 */}
                                  {isBundle && (
                                    <button
                                      type="button"
                                      onClick={(e) => { e.stopPropagation(); toggleRxBundle(chart.id); }}
                                      className="mt-0.5 inline-flex items-center gap-0.5 text-[9px] text-violet-600 hover:text-violet-800 transition-colors"
                                      data-testid="timeline-rx-bundle-toggle"
                                      aria-expanded={rxOpen}
                                    >
                                      {rxOpen ? '접기' : `+${rxList.length - 2}건 더보기`}
                                      <ChevronDown className={`h-2.5 w-2.5 transition-transform ${rxOpen ? 'rotate-180' : ''}`} />
                                    </button>
                                  )}
                                </div>
                              );
                            })()}
                            {/* AC-10: 키워드 감지 안전 신호는 펼침 상세에서 필터와 무관하게 항상 노출(detail-on-demand). */}
                            {notable && (
                              <div className="mt-0.5">
                                <span className="text-[9px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 font-semibold">
                                  특이사항 감지
                                </span>
                              </div>
                            )}
                            {!(hasTreat && isTypeActive(memoFilters, 'treat'))
                              && !(chart.clinical_progress && isTypeActive(memoFilters, 'doc'))
                              && !(isDirector && chart.doctor_memo && isTypeActive(memoFilters, 'doc'))
                              && !(hasRxItems && isTypeActive(memoFilters, 'rx'))
                              && !notable && (
                              <p className="text-[10px] text-muted-foreground italic">
                                {/* T-20260613-foot-CHARTFILTER-EMPTYTEXT-TOGGLE AC-1: 필터 적용 후 매칭 0건 빈상태
                                    안내문(구 '선택 유형 ...없음')을 "-"로 축약. 필터 무적용·데이터 자체 없음('저장된
                                    메모 없음')은 필터 빈상태가 아니므로 보존(현장 요청 맥락 = '필터를 눌렀을 때'). */}
                                {memoFilters.size > 0 ? '-' : '저장된 메모 없음'}
                              </p>
                            )}
                            {/* T-20260613-foot-MEDCHART-MEMO-TIMELINE-REFINE AC-9 (중복 제거): 진료의(작성자)가
                                펼침 상세에서 또 표시되어 헤더 행과 합쳐 '2회 표시'되던 문제 — 펼침 상세의 작성자 블록
                                (구 timeline-expanded-recorder, T-20260607-foot-PROGRESS-TIMELINE-AUTHOR)을 제거.
                                진료의는 헤더 행 우측(timeline-recorder)에 1회만 표시(접힘/펼침 무관 상시 노출). */}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* ── 중앙: 진료기록 폼 (AC-1 좌측 컬럼) ─────────────────────────── */}
              {/* T-20260608-foot-CHART-LAYOUT-SHIFT AC-3: overflow-anchor:auto 명시 — 처방내역 입력 행
                  추가/삭제 시 브라우저가 보이는 콘텐츠 기준으로 스크롤 위치를 앵커링해 급점프 최소화. */}
              <div className="flex-1 overflow-y-auto p-5 border-r [overflow-anchor:auto]" data-testid="medical-chart-form">
                {/* AC-6: 불필요 여백 제거 — 폼 가로 폭 확대(max-w-2xl→max-w-5xl) */}
                <div className="max-w-5xl space-y-4">

                  {/* 타이틀 */}
                  <div className="flex items-center gap-2 pb-1.5 border-b flex-wrap">
                    <span className="text-sm font-semibold text-teal-700" data-testid="medical-chart-form-title">
                      {/* T-20260613-foot-MEDCHART-MEMO-TIMELINE-REFINE AC-10 (버그): 뷰 모드(읽기전용)에서도
                          "수정" 라벨이 상시 표시되던 상태관리 버그 수정. 저장된 차트는 진입 시 editMode=false(읽기전용) →
                          이때는 "수정" 미표시. [수정] 버튼으로 editMode 진입(=!isReadOnly)했을 때만 "수정" 노출.
                          더미는 기존대로 [더미]. 저장/취소(selectChart)로 editMode=false 복귀 시 자동으로 라벨 사라짐. */}
                      {selectedChartId
                        ? `진료 기록 ${selectedChartId.startsWith('__dummy__') ? '[더미] ' : (!isReadOnly ? '수정 ' : '')}— ${fmtDateFull(formDate)}`
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

                  {/* T-20260611-foot-MEDREC-CLINICAL-SAVE-UICLEANUP AC-1: 진료일 | 담당의사 두 단 배치.
                      (임상경과/진료메모 2단 + 처방내역 진단명아래 누적은 NOTES-2COL 850ceed 기구현 — 회귀 금지) */}
                  {/* T-20260614-foot-MEDREC-LAYOUT-4REFINE AC-4 (문지은 대표원장, 3차+ 재요청):
                      진료일+진료의를 '딱 한 줄(single row)'에. 헤더+내용 2단 구조 금지.
                      ⚠ 근본원인: 직전 수정들은 두 필드를 좌우로 배치만 했지, 각 필드 내부 라벨이
                        block(label 위) + 입력칸(아래) = 필드마다 '헤더+내용 2단'으로 렌더된 게 원인.
                        (reporter "왜자꾸 헤더랑 아래내용구조로 가는거지?")
                      → 라벨을 block→inline(라벨·값 같은 줄)으로 전환. flex items-center 한 행에
                        '진료일 [날짜]  담당 의사 [의사]'를 모두 인라인 배치(라벨 위 stacking 제거).
                      T-20260613-foot-MEDCHART-DIAG-RX-TABLEVIEW-REFINE AC-5(한 줄 배치)·MEDREC-DATE-DIAG-UI-REFINE
                      (정렬)을 supersede — 라벨 stacking 제거가 핵심. */}
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-1" data-testid="chart-date-doctor-row">
                  {/* 진료일 — 라벨·값 한 줄 인라인. (type=date = 네이티브 달력 아이콘/피커, 비읽기전용일 때 수정 가능 — 동작 무변경) */}
                  <div className="flex items-center gap-2 min-w-0">
                    <label className="text-xs font-semibold text-muted-foreground whitespace-nowrap">진료일</label>
                    <Input
                      type="date"
                      value={formDate}
                      onChange={(e) => { setFormDate(e.target.value); loadVisitPayments(e.target.value); }}
                      disabled={isReadOnly}
                      className="h-9 text-sm text-left border-0 max-w-[150px] disabled:opacity-100 disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed"
                      data-testid="medical-chart-date"
                    />
                  </div>

                  {/* 담당 의사 (진료의) — T-20260608-foot-MEDCHART-SIGN-AUDIT (Phase 2, 의료법) AC-P2-1/2:
                      로그인 계정이 의사면 자동 본인 + 드롭다운 수동 변경(스탭 포함) 가능. 신규/수정행 필수.
                      ⚠️ T-20260609-foot-DOCDASH-CHART-UX item5 (AC5-2): 저장된 차트 읽기전용 보기에선 하단
                      서명블록(chart-signing-doctor)이 canonical → 상단 선택 입력 숨김. 신규/수정/더미만 노출.
                      AC-4: 라벨·select 한 줄 인라인. 경고문(미선택/의사없음)은 select 바로 아래 컬럼으로만
                      흘려 단일 행 외형 유지(formSigningDoctorId NOT NULL 강제·변경이력 로직 무변경). */}
                  {!(isReadOnly && selectedChart && !selectedChartId?.startsWith('__dummy__')) && (
                  <div className="flex items-center gap-2 min-w-0 sm:ml-auto" data-testid="signing-doctor-select-block">
                    <label className="text-xs font-semibold text-muted-foreground whitespace-nowrap">담당 의사</label>
                    <div className="flex flex-col min-w-0">
                      <select
                        value={formSigningDoctorId}
                        onChange={(e) => setFormSigningDoctorId(e.target.value)}
                        disabled={isReadOnly}
                        className={`h-9 text-sm w-full sm:w-auto sm:min-w-0 sm:max-w-[7.5rem] truncate rounded-md px-1.5 bg-background ${
                          isReadOnly
                            ? 'opacity-100 bg-gray-50 text-gray-500 cursor-not-allowed border-0'
                            : !formSigningDoctorId
                              ? 'border border-rose-300 focus:border-rose-400'
                              : 'border-0'
                        }`}
                        data-testid="medical-chart-signing-doctor"
                        aria-label="담당 의사(진료의)"
                      >
                        <option value="">의사를 선택하세요</option>
                        {clinicDoctors.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                      {!isReadOnly && !formSigningDoctorId && (
                        <p className="mt-1 text-[11px] text-rose-500" data-testid="signing-doctor-warning">
                          진료의를 선택해야 저장할 수 있습니다.
                        </p>
                      )}
                      {clinicDoctors.length === 0 && (
                        <p className="mt-1 text-[11px] text-amber-600">
                          등록된 의사가 없습니다 — 설정 &gt; 병원·원장 정보에서 의사를 먼저 등록하세요.
                        </p>
                      )}
                    </div>
                  </div>
                  )}
                  {/* /진료일·담당의사 단일 행(인라인) wrapper */}
                  </div>

                  {/* T-20260611-foot-MEDCHART-2COL-LABEL-CLEANUP AC-3 row2: 진단명(좌) | 처방내역(우) 2단 grid.
                      NOTES-2COL AC-2(처방내역 진단명 직하단 stack)를 본 티켓이 supersede — 좌우 컬럼으로 분리.
                      각 컬럼은 vertical stack 유지(AC-4 진단명 / AC-5 처방내역). 좁은 폭(<sm)은 1단 자연 collapse.
                      저장경로(formDx→diagnosis, formRx→prescription_items) 무변경 — 배치만 좌우 2단. */}
                  <div className="flex flex-col sm:flex-row gap-3" data-testid="chart-dx-rx-row">
                  {/* 진단명 (좌) — T-20260606-foot-DIAGNOSIS-MASTER-MGMT (AC-2 [B] + AC-3 [C]):
                      자동완성/이력 datalist 폐지 → 폴더 탐색 드롭다운(등록 상병만 선택) + 원장별 즐겨찾기.
                      저장값=순수 상병명(formDx), medical_charts.diagnosis 저장경로 무변경.
                      AC-4: 복수 진단명은 컬럼 내 세로 stack(picker 값 자체가 줄단위 누적). */}
                  <div className="sm:flex-1 min-w-0">
                    {/* T-20260613-foot-MEDCHART-EDITSTATE-RX-POLISH AC-7: 진단명 헤더를 처방내역 헤더와
                        동일한 flex 행(min-h)으로 맞춰 두 컬럼 헤더 베이스라인/높이 통일(전체 정렬 정돈). */}
                    <div className="flex items-center mb-1 min-h-[1.125rem]">
                      <label className="text-xs font-semibold text-muted-foreground">
                        진단명
                        {/* T-20260613-foot-MEDCHART-DIAG-RX-TABLEVIEW-REFINE AC-2: 라벨 옆 폴더선택 안내
                            보조문구(span) 제거. 폴더 선택 진입 어포던스는 DiagnosisFolderPicker 트리거 버튼
                            (＋ 아이콘 + 펼침 ▾)으로 유지 — 보조 텍스트만 제거. */}
                      </label>
                    </div>
                    <DiagnosisFolderPicker
                      value={formDx}
                      onChange={setFormDx}
                      clinicId={clinicId}
                      disabled={isReadOnly}
                      data-testid="medical-chart-diagnosis"
                    />
                  </div>

                  {/* 처방내역 (우) — AC-3 row2 우측 컬럼. 우측 패널에서 선택 후 이 테이블에 반영.
                      AC-5: 복수 처방은 테이블 행(세로 stack)으로 표시.
                      T-20260613-foot-MEDCHART-DIAG-RX-TABLEVIEW-REFINE AC-4: 처방내역 폭 확대 —
                      진단명(flex-1) 대비 처방내역 컬럼을 flex-[1.5]로 넓힘(현장 '처방내역 너무 짧음').
                      T-20260613-foot-MEDCHART-EDITMODE-RXTABLE-LAYOUT-POLISH AC-5: 좌측 진단명 영역과
                      처방 내용 사이 세로 구분선 1개 추가(sm:border-l). DIAG-RX AC-4 '무거운 외곽/버튼 테두리
                      제거'는 유지하고, 컬럼 경계 얇은 세로선 1개만 덧댐(전부 복원 아님). */}
                  <div className="sm:flex-[1.5] min-w-0 sm:border-l sm:border-gray-200 sm:pl-3">
                    {/* T-20260613-foot-MEDCHART-EDITSTATE-RX-POLISH AC-7: 진단명 헤더와 동일 높이(min-h)로 베이스라인 통일.
                        T-20260614-foot-MEDREC-LAYOUT-4REFINE AC-3 (문지은 대표원장): 우측상단 안내 멘트
                        ('우측 패널에서 처방세트 선택') 제거 → 처방내역 안 미리보기(formRx 테이블/빈 상태)만 유지. */}
                    <div className="flex items-center mb-1 min-h-[1.125rem]">
                      <label className="text-xs font-semibold text-muted-foreground">처방내역</label>
                    </div>
                    {formRx.length > 0 ? (
                      /* T-20260613-foot-MEDCHART-DIAG-RX-TABLEVIEW-REFINE AC-4: 테두리 전부 제거 —
                         외곽 테두리(border) 제거 + 내부 입력칸/버튼 테두리·그림자도 전부 제거
                         (arbitrary variant [&_input]/[&_button]). 기능 동선(추가/수정/삭제·세트 반영) 무변경.
                         T-20260613-foot-MEDCHART-EDITMODE-RXTABLE-LAYOUT-POLISH AC-12 (문지은 대표원장):
                         처방제품 셀을 클릭/포커스해도 테두리(focus ring/outline/그림자)가 안 뜨게 →
                         정적 border-0만으론 shadcn Input의 focus-visible:ring-2 가 남아 클릭 시 테두리가 보였음.
                         포커스 상태 ring/offset/outline/shadow 까지 전부 0 (입력·저장 동선·편집 접근성은 유지). */
                      <div
                        className="rounded-lg bg-card overflow-hidden [&_input]:border-0 [&_input]:shadow-none [&_input]:bg-transparent [&_button]:border-0 [&_input:focus]:border-0 [&_input]:focus-visible:ring-0 [&_input]:focus-visible:ring-offset-0 [&_input]:focus-visible:outline-none [&_input:focus]:shadow-none [&_button]:focus-visible:ring-0 [&_button]:focus-visible:outline-none"
                        data-testid="prescription-items-table"
                      >
                        {/* T-20260615-foot-RXTABLE-PRESCRIPTION-ALIGN (문지은 대표원장) — 처방내역 테이블 정렬·정리 폴리시 (presentation only).
                            AC1 헤더 전부 가운데정렬 / AC2 좌측 투여경로 색상 도트 제거 / AC3 약이름(용량) 컬럼 폭 최대화(나머지 흡수) /
                            AC4 약이름 뒤 dosage(용량/소량) 라벨 표시 제거(데이터 무삭제·이 테이블에서만 숨김) /
                            AC5 용법·횟수·일수 균등 폭·가운데정렬 / AC6 셀 숫자전용(용법=rxFreqCore 코어, 횟수='회' suffix 숨김, 일수 숫자).
                            처방 데이터/필드매핑/저장/CRUD 동선 무변경. 횟수·일수 인라인 편집(RX-CHART-ENHANCE) 보존. */}
                        <table className="w-full text-xs table-fixed">
                          <thead className="text-muted-foreground/70">
                            <tr>
                              {/* AC3: 약이름(용량) 컬럼 — 폭 미지정(table-fixed에서 나머지 가용 폭 전부 흡수)
                                  T-20260620-foot-RXTABLE-ALIGN-DIVIDER-ZEBRA AC-1 (문지은 대표원장 직접지시): 약이름 헤더 좌측정렬 — 데이터 셀(td 기본 left)과 일치. (선행 RXTABLE-PRESCRIPTION-ALIGN AC1의 전체 가운데정렬을 약이름 헤더만 override) */}
                              <th className="text-left px-3 py-1 font-medium">약이름 (용량)</th>
                              {/* AC5: 용법/횟수/일수 균등 폭(동일 w-16) + AC1 가운데정렬 */}
                              <th className="text-center px-2 py-1 font-medium w-16">용법</th>
                              <th className="text-center px-2 py-1 font-medium w-16">횟수</th>
                              <th className="text-center px-2 py-1 font-medium w-16">일수</th>
                              <th className="py-1 w-6" />
                            </tr>
                          </thead>
                          <tbody>
                            {formRx.map((item, idx) => {
                              return (
                                <tr
                                  key={idx}
                                  className="border-b border-gray-200 last:border-b-0"
                                  data-testid={`prescription-row-${idx}`}
                                >
                                  {/* AC2: 좌측 색상 도트 제거 / AC4: dosage(용량·소량) 라벨 입력 제거(이 표시에서만 숨김).
                                      item.dosage 데이터는 formRx에 보존·저장 무변경. 약이름은 한 줄 우선·긴 이름 자연 래핑. */}
                                  <td className="px-3 py-1.5">
                                    {/* Part E: 처방된 약 hover → 약 정보(설명) 툴팁. 설명 SSOT=prescription_codes.description(code_id 매핑). */}
                                    <DrugInfoTooltip
                                      name={item.name}
                                      description={item.prescription_code_id ? rxDescMap?.get(item.prescription_code_id) ?? null : null}
                                      className="inline-block max-w-full"
                                      testId="rx-drug-tooltip-list"
                                    >
                                      <span className="font-medium break-words" data-testid={`rx-name-${idx}`}>{item.name}</span>
                                    </DrugInfoTooltip>
                                  </td>
                                  {/* AC6: 용법 = frequency 자유텍스트에서 숫자/범위 코어만 표시(presentation), 가운데정렬.
                                      원본 frequency 값·저장·필드매핑 무변경. 편집은 처방 작성 패널(out of scope) 소관. */}
                                  <td className="px-2 py-1 align-middle text-center" data-testid={`rx-frequency-${idx}`}>
                                    {rxFreqCore(item.frequency)}
                                  </td>
                                  {/* AC6: 횟수 = 숫자만(‘회’ suffix 숨김), 가운데정렬. 인라인 편집 보존(RxCountInput). */}
                                  <td className="px-2 py-1 align-middle">
                                    <RxCountInput
                                      value={item.count ?? null}
                                      onChange={(v) => updateRxCount(idx, v)}
                                      disabled={isReadOnly}
                                      hideSuffix
                                      className="w-full"
                                    />
                                  </td>
                                  {/* AC6: 일수 = 숫자만, 가운데정렬. 단위어/플레이스홀더 텍스트 제거. 인라인 편집 보존. */}
                                  <td className="px-2 py-1 align-middle">
                                    <Input
                                      type="number"
                                      min={0}
                                      value={item.days}
                                      onChange={(e) => updateRxItem(idx, 'days', e.target.value)}
                                      disabled={isReadOnly}
                                      className="h-7 text-xs px-1 w-full text-center disabled:opacity-100 disabled:bg-gray-50 disabled:cursor-not-allowed"
                                      placeholder=""
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
                  {/* /진단명·처방내역 2단 wrapper (AC-3 row2) */}
                  </div>

                  {/* 치료·시술 — 결제내역 자동 연동 (readonly)
                      T-20260608-foot-CHART-LAYOUT-SHIFT AC-1: 별도 fetch(loadVisitPayments) in-flight 동안
                      동일 높이 skeleton으로 자리를 미리 점유 → 결과 도착 시 pop-in 점프 제거. */}
                  {(visitPaymentsLoading || visitPayments.length > 0) && (
                    <div data-testid="visit-payments-block">
                      <label className="block text-xs font-semibold text-muted-foreground mb-1">
                        치료·시술{' '}
                        <span className="font-normal text-teal-600">(결제내역 자동 연동)</span>
                      </label>
                      {visitPaymentsLoading ? (
                        <div
                          className="rounded-lg border bg-muted/20 px-3 py-2 space-y-1.5 min-h-[2.75rem] animate-pulse"
                          data-testid="visit-payments-skeleton"
                          aria-busy="true"
                        >
                          <div className="h-3.5 w-2/3 rounded bg-muted" />
                          <div className="h-3.5 w-1/2 rounded bg-muted" />
                        </div>
                      ) : (
                        <div className="rounded-lg border bg-muted/20 px-3 py-2 space-y-1">
                          {visitPayments.map(pmt => (
                            <div key={pmt.id} className="flex items-center justify-between text-xs">
                              <span className="text-muted-foreground">{pmt.memo || '결제 항목'}</span>
                              <span className="font-medium">{formatAmount(pmt.amount)}원</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* T-20260611-foot-MEDCHART-2COL-LABEL-CLEANUP AC-3 row3: 치료사차트(좌) | 치료메모(우) 2단 grid.
                      TREATMEMO-CHART-MERGE(치료메모를 치료사차트 하단에 통합)를 본 티켓이 좌우 2단으로 재분리.
                      AC-1: '읽기전용' 텍스트/배지 미표시(라벨만). AC-2: '치료메모' 태그형 버튼(배지) 아닌 일반 라벨.
                      읽기전용 동작(formTx readOnly/disabled, treatMemos 뷰어) 무변경 — 배치만 좌우 2단.
                      좁은 폭(<sm)은 1단 자연 collapse. */}
                  <div className="flex flex-col sm:flex-row gap-3" data-testid="chart-tx-treatmemo-row">
                  {/* 치료사차트 (좌) — 읽기전용 동작 유지, 시각 라벨만 '치료사차트'.
                      T-20260614-foot-MEDREC-LAYOUT-4REFINE AC-2 (문지은 대표원장): 너비를 아래 임상경과·
                      의료진전용메모 행과 동일 비율(좌 flex-[4] : 우 flex-[1])로 정렬 — 기존 1:1 균등에서
                      치료사차트(좌·넓게)/치료메모(우·좁게)로 통일(아래 NOTES 2단과 컬럼 경계 일치). */}
                  {/* T-20260615-foot-MEDCHART-MEMO-WIDTH-25P (문지은 대표원장): 우측 치료메모 컬럼을 현재 대비
                      25% 확대 — converged grid 비율(좌 flex-[4]:우 flex-[1]=80:20) 기준 위에서 좌측을 flex-[3]로
                      낮춰 우측 메모 컬럼을 20%→25%(=+25%)로 상향. 우 flex-[1] 토큰은 무변경. */}
                  <div className="sm:flex-[3] min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <label className="text-xs font-semibold text-muted-foreground">치료사차트</label>
                    </div>
                    {/* T-20260612-foot-MEDREC-DATE-DIAG-UI-REFINE ⑨: 뷰어 모드라 내용 유무를 미리 앎 —
                        치료사차트 내용 없으면 compact(rows 2 / min-h 제거), 있으면 기존 높이 유지. */}
                    <Textarea
                      value={formTx}
                      readOnly
                      disabled
                      placeholder="치료사가 기록한 내용이 여기 표시됩니다"
                      rows={formTx ? 7 : 2}
                      className={`text-sm resize-none bg-gray-50 text-gray-500 cursor-not-allowed placeholder:text-gray-300 disabled:opacity-100 ${formTx ? 'min-h-[8rem]' : 'min-h-0'}`}
                      data-testid="medical-chart-treatment"
                    />
                  </div>

                  {/* 치료메모 (우) — AC-3 row3 우측 컬럼. 일반 라벨(태그/배지 아님, AC-2).
                      치료메모 이력 항목(내용·작성자·일시) 읽기전용 뷰어 — 표시·데이터 경로 무변경.
                      T-20260614-foot-MEDREC-LAYOUT-4REFINE AC-2: 우측 컬럼 너비를 아래 의료진전용메모와
                      동일(flex-[1])로 정렬. */}
                  <div className="sm:flex-[1] min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <label className="text-xs font-semibold text-muted-foreground">치료메모</label>
                    </div>
                    {treatMemos.length > 0 ? (
                      /* T-20260613-foot-MEDCHART-MEMO-TIMELINE-REFINE 치료메모 미니멀 리파인:
                         AC-1 항목별 '치료메모' 태그 배지(memo_type) 제거.
                         AC-2 날짜·작성자를 항목 우측 상단 한 줄로 이동(본문 아래 X).
                         AC-3 테두리/배경 박스 제거 → 좌측 경과 타임라인과 동일한 `| 텍스트`(border-l) 미니멀 통일.
                         AC-4 [중복 진단] 박민석 환자 치료메모 2건은 content가 서로 다른 별개 메모(데이터/렌더 중복 아님 —
                              diag SQL: scripts/...AC4_diag.mjs 결과). 동일 배지+박스로 '중복 오인' → AC-1/AC-3로 자연 해소.
                              단 방어적으로 byte-identical(동일 content+작성자+created_at) 행만 1건으로 축약(영속 데이터 무변경). */
                      <div className="space-y-1" data-testid="treat-memo-in-chart-section">
                        {(() => {
                          const seen = new Set<string>();
                          const uniqMemos = treatMemos.filter((m) => {
                            const sig = `${(m.content ?? '').trim()}__${m.created_by_name ?? ''}__${m.created_at ?? ''}`;
                            if (seen.has(sig)) return false;
                            seen.add(sig);
                            return true;
                          });
                          // T-20260620-foot-MEDCHART-MEMO-HISTORY-SPLIT-PRINTOMIT (문지은 대표원장):
                          //   treatMemos는 created_at DESC(최신순) → uniqMemos[0] = 현재(최신) 메모, 나머지 = 이전 이력.
                          //   AC-1 기본 표시 = 현재 메모만(이전 '(이전 기록)' 블록 접힘).
                          //   AC-2 '이전 이력 보기' 토글로 이전 메모 타임라인 노출(기본 접힘, 펼치면 MEMO-HISTORY 데이터 그대로 read).
                          //   AC-4 GUARD: 데이터·누적로직·열람 무변경(표시 기본값만) — 5/20 MEMO-HISTORY 비파괴.
                          const renderMemo = (memo: typeof uniqMemos[number]) => (
                            <div
                              key={memo.id}
                              className="border-l-2 border-blue-300 pl-2 py-0.5"
                              data-testid="treat-memo-item"
                            >
                              {/* AC-2: 우측 상단 메타 한 줄 (날짜 · 작성자) — 흐린 작은 글씨 */}
                              <div className="flex items-center justify-end gap-1 text-[9px] text-muted-foreground/60 tabular-nums">
                                <span>{fmtDateShort(memo.created_at)}</span>
                                <span data-testid="treat-memo-recorder">{memo.created_by_name ?? '알 수 없음'}</span>
                              </div>
                              {/* AC-3: 본문 — 테두리/배경 없이 텍스트만 */}
                              <p className="text-[11px] text-gray-800 whitespace-pre-wrap leading-snug break-words">{memo.content}</p>
                            </div>
                          );
                          const current = uniqMemos[0];
                          const previous = uniqMemos.slice(1);
                          return (
                            <>
                              {/* AC-1: 현재(최신) 메모만 기본 노출 */}
                              {current && renderMemo(current)}
                              {/* AC-2: 이전 이력 분리(기본 접힘 토글) — AC-3: 출력(인쇄)에선 제외(print:hidden) */}
                              {previous.length > 0 && (
                                <div className="print:hidden" data-testid="treat-memo-history-block">
                                  <button
                                    type="button"
                                    onClick={() => setTreatMemoHistoryOpen((o) => !o)}
                                    className="mt-0.5 inline-flex items-center gap-0.5 text-[9px] text-muted-foreground hover:text-foreground transition-colors"
                                    data-testid="treat-memo-history-toggle"
                                    aria-expanded={treatMemoHistoryOpen}
                                  >
                                    이전 이력 보기 ({previous.length}) {treatMemoHistoryOpen ? '접기' : ''}
                                    <ChevronDown className={`h-2.5 w-2.5 transition-transform ${treatMemoHistoryOpen ? 'rotate-180' : ''}`} />
                                  </button>
                                  {treatMemoHistoryOpen && (
                                    <div className="space-y-1 mt-1" data-testid="treat-memo-history-list">
                                      {previous.map(renderMemo)}
                                    </div>
                                  )}
                                </div>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    ) : (
                      /* ⑨ 치료메모 내용 없으면 compact — 고정 8rem 제거, 헤더+최소 padding만. */
                      <div
                        className="rounded-lg border border-dashed p-2 text-xs text-muted-foreground text-center"
                        data-testid="treat-memo-empty"
                      >
                        치료메모 없음
                      </div>
                    )}
                  </div>
                  {/* /치료사차트·치료메모 2단 wrapper (AC-3 row3) */}
                  </div>

                  {/* T-20260609-foot-MEDCHART-NOTES-2COL AC-1: 임상경과(좌·너비4) · 진료메모(우·너비1)
                      좌우 4:1 동시 노출(탭전환 X). 비원장은 진료메모 미표시 → 임상경과가 전폭. */}
                  <div className="flex flex-col sm:flex-row gap-3 items-stretch" data-testid="notes-2col-row">
                  {/* 임상경과 (좌, flex-4) — 상용구 단축어 (우측 패널로 이동, // autocomplete 유지)
                      T-20260609-foot-DOCDASH-CHART-UX item5 (AC5-1): 섹션 헤더 라벨('임상경과') 텍스트 태그 완전 제거.
                      T-20260614-foot-MEDREC-LAYOUT-4REFINE AC-1 (문지은 대표원장): 좌측 세로줄(border-l-2)
                      + 좌측 패딩(pl-3) 제거 — 소헤더 라벨로 식별, 컬럼 경계선 없이 깔끔하게. */}
                  {/* T-20260615-foot-MEDCHART-MEMO-WIDTH-25P (문지은 대표원장): 우측 의료진전용메모 컬럼을 현재
                      대비 25% 확대 — converged grid 비율(좌 flex-[4]:우 flex-[1]=80:20) 기준 위에서 좌측을 flex-[3]로
                      낮춰 우측 메모 컬럼을 20%→25%(=+25%)로 상향. 우 flex-[1] 토큰은 무변경. */}
                  <div className="sm:flex-[3] min-w-0">
                    {/* T-20260612-foot-MEDREC-DATE-DIAG-UI-REFINE ⑤: '임상경과' 소헤더 추가.
                        6번: 슬래시 단축어 안내 설명 텍스트 제거 — 기능(슬래시 트리거 핸들러·팝오버)은 무변경 유지. */}
                    <div className="flex items-center mb-1">
                      <h4 className="text-xs font-medium text-gray-700">임상경과</h4>
                    </div>

                    <div className="relative">
                      <Textarea
                        ref={clinicalRef}
                        value={formClinical}
                        onChange={handleClinicalChange}
                        onBlur={() => { setTimeout(() => setPhrasePopoverVisible(false), 200); }}
                        readOnly={isReadOnly}
                        placeholder="임상경과를 입력하세요"
                        rows={13}
                        className={`text-sm resize-y placeholder:text-gray-300 min-h-[16rem] ${isReadOnly ? 'bg-gray-50 text-gray-500 cursor-not-allowed' : ''}`}
                        data-testid="medical-chart-clinical"
                        // T-20260607-foot-SUPERPHRASE-DX-MULTISELECT-FIX AC-3a (MSG-20260607-210836-r0ww 흡수):
                        //   임상경과에서 `//` 입력 시 브라우저 네이티브 입력이력(약이름 등) 자동완성이 떠
                        //   `//` 상용구 단축어 팝오버(T-20260526-foot-PHRASE-SLASH)를 가로채는 원인.
                        //   이 textarea 한정으로 네이티브 자동완성을 끔(약이름 트리거 제거). 처방/약품 입력란은 별 컴포넌트라 보존.
                        autoComplete="off"
                        autoCorrect="off"
                        autoCapitalize="off"
                        spellCheck={false}
                        data-1p-ignore
                        data-lpignore="true"
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
                        // AC-1: 커서(caret) '라인 윗변' 좌표 기준 렌더 (textarea 전체 하단 X). 실패 시 textarea rect 폴백.
                        //   getTextareaCaretRect 반환 top = caret 라인 윗변(viewport). 아래로 띄우기는 여기서 lineH 를 더한다.
                        const taRect = ta.getBoundingClientRect();
                        let lineTop: number;
                        let anchorLeft: number;
                        let lineH = 18;
                        try {
                          const caret = getTextareaCaretRect(ta, ta.selectionStart ?? ta.value.length);
                          lineTop = caret.top;
                          anchorLeft = caret.left;
                          lineH = caret.lineHeight;
                        } catch {
                          lineTop = taRect.bottom - 18;
                          anchorLeft = taRect.left;
                        }
                        // T-20260609 폴백 가드: caret 이 스크롤로 textarea 가시영역 밖이면 경계로 클램프
                        //   (화면 0,0/엉뚱영역 금지 — AC-1). 최소 textarea 내부 라인 위치를 보장.
                        if (lineTop < taRect.top - lineH || lineTop > taRect.bottom + lineH) {
                          lineTop = Math.min(Math.max(lineTop, taRect.top), Math.max(taRect.top, taRect.bottom - lineH));
                          anchorLeft = taRect.left + 8;
                        }
                        const lineBottom = lineTop + lineH;
                        const spaceBelow = window.innerHeight - lineBottom;
                        const top = spaceBelow > POPOVER_MAX
                          ? lineBottom + 4
                          : Math.max(8, lineTop - POPOVER_MAX - 4);
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

                  {/* 진료메모 (우, flex-1) — T-20260609-foot-MEDCHART-NOTES-2COL AC-1.
                      원장 전용 미노출 (AC-3). 비원장은 미렌더 → 임상경과가 전폭 차지.
                      저장경로(formMemo→doctor_memo) 무변경, 배치만 우측 컬럼으로 이동.
                      T-20260609-foot-DOCDASH-CHART-UX item5 (AC5-1): 섹션 헤더 라벨('진료메모') 텍스트 태그 완전 제거.
                      T-20260614-foot-MEDREC-LAYOUT-4REFINE AC-1 (문지은 대표원장): 좌측 세로줄(border-l-2)
                      + 좌측 패딩(pl-3) 제거 — '의료진 전용메모' 소헤더로 식별, 컬럼 경계선 없이 깔끔하게. */}
                  {isDirector ? (
                    <div className="sm:flex-[1] min-w-0 flex flex-col" data-testid="doctor-memo-section">
                      {/* T-20260612-foot-MEDREC-DATE-DIAG-UI-REFINE ⑦: 안내문구('의료진 전용 메모입니다…') 전부 제거 →
                          '의료진 전용메모' 소헤더만. (2COL-LABEL AC6 '안내문구 표출'을 reporter 직접지시로 supersede.
                          의료진 전용 노출제한 isDirector 게이트 동작은 그대로 유지.) */}
                      <h4 className="text-xs font-medium text-gray-500 mb-1" data-testid="doctor-memo-header">의료진 전용메모</h4>
                      <Textarea
                        value={formMemo}
                        onChange={(e) => setFormMemo(e.target.value)}
                        readOnly={isReadOnly}
                        placeholder="의료진 전용 메모 — 타 스태프 미노출"
                        className={`flex-1 text-sm resize-y placeholder:text-gray-300 min-h-[16rem] ${isReadOnly ? 'bg-gray-50 text-gray-500 cursor-not-allowed' : ''}`}
                        data-testid="doctor-memo-input"
                      />
                    </div>
                  ) : (
                    /* 비원장: 진료메모 필드 미표시 (AC-4 시나리오 4) → 임상경과가 전폭 */
                    null
                  )}
                  {/* /임상경과·진료메모 4:1 wrapper */}
                  </div>

                  {/* T-20260606-foot-MEDCHART-NIGHT-REFEEDBACK AC-2: 작성자 서명 — 기록 본문 말미.
                      상단 로그인 계정 인디케이터와 구분되는 '서명' 스타일(우측 정렬, 점선 구분, 작성: {이름}). */}
                  {selectedChart && !selectedChartId?.startsWith('__dummy__') && (
                    <div className="flex flex-col items-end gap-1.5 border-t border-dashed border-gray-300 pt-2" data-testid="chart-signature-block">
                      {/* T-20260608-foot-MEDCHART-SIGN-AUDIT AC-P2-5: 진료의 직인(있으면) 또는 이름 자동 표기.
                          저장된 signing_doctor_name 기준(출력시 임의 선택 의사 아님). 레거시(미보유) 행은 라벨 표기. */}
                      {selectedChart.signing_doctor_name ? (
                        <span className="inline-flex items-center gap-2 text-xs text-muted-foreground" data-testid="chart-signing-doctor">
                          진료의{' '}
                          <span className="font-semibold not-italic text-teal-700 text-sm">
                            {selectedChart.signing_doctor_name}
                          </span>
                          {sealSignedUrl ? (
                            <img
                              src={sealSignedUrl}
                              alt="진료의 직인"
                              className="h-9 w-9 object-contain opacity-90"
                              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                              data-testid="chart-signing-doctor-seal"
                            />
                          ) : (
                            <span className="text-[10px] text-muted-foreground border border-dashed rounded px-1 py-0.5">(인)</span>
                          )}
                        </span>
                      ) : (
                        <span className="text-[11px] text-amber-600 italic" data-testid="chart-signing-doctor-legacy">
                          진료의 미보유 (레거시 기록)
                        </span>
                      )}
                      {/* 작성자(기록자) — 진료의와 구별되는 보조 표기.
                          T-20260609-foot-CHART-LEFTCOL-MINIMAL AC-3 (진료의 이름 중복 제거): 본인이 본인 차트를
                          작성한 경우 created_by_name === signing_doctor_name 이라 같은 이름이 '진료의'·'작성'
                          두 줄로 중복 노출됐다. 작성자명이 진료의명과 같으면 작성 줄을 숨겨 이름 1회만 표기
                          (진료의 줄이 canonical). 다르면(스탭 대리작성 등) 보조 표기 보존 → 작성자 정보 손실 없음. */}
                      {(() => {
                        const recName = selectedChart.created_by_name || recorderName(selectedChart.created_by);
                        if (!recName || recName === selectedChart.signing_doctor_name) return null;
                        return (
                          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground italic" data-testid="chart-recorder">
                            작성{' '}
                            <span className="font-semibold not-italic text-teal-700">
                              {recName}
                            </span>
                          </span>
                        );
                      })()}
                      {/* AC-P2-3: 진료의 변경이력(차트 단위 조회). append-only — 덮어쓰기 금지.
                          T-20260614-foot-CHARTSIGNAUDIT-ROLE-GATE: 변경이력은 원장(director)/어드민(admin)만 조회.
                          isDirector = canViewDoctorMemo(DIRECTOR_ROLES=['director','admin']) — director/admin 동시 포함 SSOT라
                          별도 isAdmin 결선 없이 (isDirector || isAdmin) 의도 충족. 일반 스태프/직원 미표시. insert 로직 무변경.
                          T-20260614-foot-MEDCHART-AUDIT-NOISE-VISIBILITY: 생성('(없음)→X') 행은 표시에서 제외(visibleSignerAudit). */}
                      {visibleSignerAudit.length > 0 && isDirector && (
                        /* T-20260620-foot-MEDCHART-MEMO-HISTORY-SPLIT-PRINTOMIT AC-3: 진료의 변경이력 블록은
                           인쇄/출력 화면에서 제외(print:hidden). 화면 열람(원장/어드민 토글)은 무변경. */
                        <div className="w-full max-w-md text-right print:hidden">
                          <button
                            type="button"
                            onClick={() => setSignerAuditOpen((v) => !v)}
                            className="text-[11px] text-muted-foreground hover:text-teal-700 underline decoration-dotted"
                            data-testid="signer-audit-toggle"
                          >
                            진료의 변경이력 {visibleSignerAudit.length}건 {signerAuditOpen ? '접기' : '보기'}
                          </button>
                          {signerAuditOpen && (
                            <ul className="mt-1 space-y-1 text-left rounded-md border bg-gray-50 p-2" data-testid="signer-audit-list">
                              {visibleSignerAudit.map((a) => (
                                <li key={a.id} className="text-[11px] text-muted-foreground">
                                  <span className="font-mono">{fmtDateShort(a.changed_at)}</span>{' · '}
                                  <span className="text-gray-600">{a.old_doctor_name ?? '(없음)'}</span>
                                  {' → '}
                                  <span className="font-semibold text-teal-700">{a.new_doctor_name ?? '(없음)'}</span>
                                  {' · '}
                                  <span>{a.changed_by_name ?? a.changed_by ?? '?'}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
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
                        수정
                      </Button>
                    ) : (
                      <Button
                        size="lg"
                        className={`flex-1 h-12 text-base ${
                          selectedChartId?.startsWith('__dummy__')
                            ? 'bg-gray-300 hover:bg-gray-300 text-gray-500 cursor-not-allowed'
                            : 'bg-neutral-800 hover:bg-neutral-900 text-white'
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
                              : '진료기록 저장'}
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              {/* ── 우측 콘텐츠 패널 — 처방세트 / 상용구 / 치료메모 / 진료내역 / 진료이미지 탭 ─
                  T-20260609-foot-PHRASE-CHECKBOX-ARROW AC6-2/6-3: 왼쪽 여백 `<` 화살표 토글 →
                  패널을 좌측으로 접어(슬라이드) 공간 절약. 접힘 시 얇은 스트립(>)만 남아 재펼침. */}
              <div
                className={`flex-shrink-0 flex flex-col bg-muted/5 relative transition-[width] duration-200 ease-in-out overflow-hidden ${rightPanelCollapsed ? 'w-7' : 'w-72'}`}
                data-testid="medical-chart-right-panel"
                data-collapsed={rightPanelCollapsed ? 'true' : 'false'}
              >
                {/* 접기/펼치기 화살표 — 패널 가장 왼쪽 여백, 미니멀 */}
                <button
                  type="button"
                  onClick={() => setRightPanelCollapsed(c => !c)}
                  className="absolute left-0 top-0 bottom-0 z-10 w-7 flex items-start justify-center pt-2 text-muted-foreground hover:text-teal-700 hover:bg-muted/40 border-r border-border/30 transition-colors"
                  data-testid="right-panel-collapse-toggle"
                  aria-expanded={!rightPanelCollapsed}
                  aria-label={rightPanelCollapsed ? '패널 펼치기' : '패널 접기'}
                  title={rightPanelCollapsed ? '패널 펼치기' : '패널 접기'}
                >
                  {rightPanelCollapsed
                    ? <ChevronRight className="h-4 w-4" />
                    : <ChevronLeft className="h-4 w-4" />}
                </button>

                {/* 패널 본문 — 접힘 시 숨김(화살표만 노출) */}
                <div className={`flex flex-col min-h-0 flex-1 pl-7 ${rightPanelCollapsed ? 'hidden' : ''}`}>
                {/* 탭 헤더 — 5개 아이콘+라벨 컴팩트 */}
                <div className="flex-none border-b">
                  {/* 상단 행: 처방세트 / 상용구 / 슈퍼상용구 (T-20260603-foot-RX-SUPER-PHRASE) */}
                  <div className="flex border-b border-border/30">
                    {([
                      { key: 'rx', label: '처방세트' },
                      { key: 'phrase', label: '상용구' },
                      { key: 'super', label: '슈퍼상용구' },
                    ] as const).map(({ key, label }) => (
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
                        {label}
                      </button>
                    ))}
                  </div>
                  {/* 하단 행: 방문이력 / 진료이미지 / 📋 상담
                      (T-20260527-foot-TREATMEMO-CHART-MERGE: 치료메모 탭 제거,
                       T-20260607-foot-MEDCHART-CONSULT-DRAWER: 📋 상담 탭 추가 — A안) */}
                  <div className="flex">
                    {([
                      { key: 'visit_hist', label: '방문이력' },
                      { key: 'images', label: '진료이미지' },
                      { key: 'consult', label: '상담' },
                    ] as const).map(({ key, label }) => (
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
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 탭 콘텐츠 */}
                <div className="flex-1 overflow-y-auto">

                  {/* 처방세트 탭 */}
                  {rightTab === 'rx' && (
                    <div className="p-3 space-y-2" data-testid="right-panel-rx-content">
                      {/* T-20260621-foot-MEDCHART-ADMIN-NAV-REMOVE: 처방세트 관리화면 지름길 버튼 제거
                          (문원장 요청 — 차트는 원장 전용, 관리화면 진입은 사이드바로만). 처방세트 선택→폼 삽입 기능은 유지. */}
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
                                    {/* DRUGINFO-MANUFACTURER: 제약사(제조사). NULL/빈값(custom)은 표기 생략 — 레이아웃 보존 */}
                                    {code.manufacturer && code.manufacturer.trim() !== '' && (
                                      <span data-testid="rx-search-result-manufacturer" className="truncate">· {code.manufacturer}</span>
                                    )}
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
                        <span className="text-[11px] font-semibold text-foreground">처방세트</span>
                      </div>
                      <DrugFolderTree onAdd={addRxFromCodes} disabled={gateChecking} />

                      {/* 묶음처방 (AC-R4: 이름+약 묶음 프리셋 = 코드 prescription_sets) */}
                      <div className="flex items-center gap-1.5 px-1 pt-2" data-testid="rx-set-section-header">
                        <span className="text-[11px] font-semibold text-foreground">묶음처방</span>
                      </div>

                      {/* T-20260605-foot-RX-SET-EXPLORER-TREE → T-20260607-foot-RXQUICK-SET-FOLDER-NAV:
                            inline 트리를 공용 <PrescriptionSetTreePicker>로 추출(동작 보존).
                            그룹핑 규칙(폴더 가나다순·'미분류' 맨 끝·내부 sort_order)·leaf=loadPrescriptionSet·
                            "폴더 기본 전체 접힘"(collapsedRxFolders controlled)·testid(rx-set-*) 모두 동일 유지. */}
                      <PrescriptionSetTreePicker
                        sets={prescriptionSets}
                        onSelect={loadPrescriptionSet}
                        disabled={gateChecking}
                        collapsedFolders={collapsedRxFolders}
                        onToggleFolder={(folderName) =>
                          setCollapsedRxFolders((prev) => {
                            const next = new Set(prev);
                            if (next.has(folderName)) next.delete(folderName);
                            else next.add(folderName);
                            return next;
                          })
                        }
                        renderLeafSubtitle={(set) =>
                          `${set.items.slice(0, 3).map((i) => i.name).join(', ')}${
                            set.items.length > 3 ? ` 외 ${set.items.length - 3}개` : ''
                          }`
                        }
                        emptyMessage={
                          <div className="rounded-lg border border-dashed p-4 text-xs text-muted-foreground text-center mt-2" data-testid="rx-set-empty">
                            등록된 처방세트 없음<br />
                            <span className="text-[10px]">위 버튼으로 추가하세요</span>
                          </div>
                        }
                      />
                    </div>
                  )}

                  {/* 상용구 탭 */}
                  {rightTab === 'phrase' && (
                    <div className="p-3 space-y-2" data-testid="right-panel-phrase-content">
                      {/* T-20260621-foot-MEDCHART-ADMIN-NAV-REMOVE: 상용구 관리화면 지름길 버튼 제거
                          (문원장 요청 — 차트는 원장 전용). 상용구 선택→임상경과 삽입 기능은 유지. */}

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
                      {/* T-20260621-foot-MEDCHART-ADMIN-NAV-REMOVE: 슈퍼상용구 관리화면 지름길 버튼 제거
                          (문원장 요청 — 차트는 원장 전용). 슈퍼상용구 클릭→일괄 적용 기능은 유지. */}

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
                      {/* T-20260608-foot-MEDCHART-PANEL-CLARITY AC-1: 좌측 '경과 타임라인'과 구분되는 설명 */}
                      <span
                        className="text-[10px] font-semibold text-muted-foreground"
                        title="방문(체크인) 단위 진료 기록을 읽기전용으로 보여줍니다. ↔ 좌측 '경과 타임라인'은 진료차트 회차 기록(편집 가능)입니다."
                      >
                        방문이력 (읽기전용)
                      </span>
                      <p className="text-[9px] text-muted-foreground/70 leading-tight -mt-1">
                        방문(체크인)별 진료 기록 · 편집 불가
                      </p>
                      {visitHistLoading ? (
                        <div className="flex justify-center py-6">
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        </div>
                      ) : visibleVisitHistory.length === 0 ? (
                        <div
                          className="rounded-lg border border-dashed p-4 text-[11px] text-muted-foreground text-center"
                          data-testid="visit-hist-empty"
                        >
                          이전 방문 기록이 없어요
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          {visibleVisitHistory.map((ci) => {
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
                                  {/* T-20260609-foot-VISITLOG-EMPTYROW-HIDE: 빈 행은 visibleVisitHistory 단계에서 제외되어 여기 도달 불가 */}
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
                      <span className="text-[10px] font-semibold text-muted-foreground">
                        진료이미지 (읽기전용)
                      </span>
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

                  {/* ── T-20260607-foot-MEDCHART-CONSULT-DRAWER: 📋 상담 탭 (A안 — 서랍에서 이식) ─────
                      check_ins 상담단계 기록 읽기전용. 탭 전환만으로 좌측 진료폼 입력은 유지된다. */}
                  {rightTab === 'consult' && (
                    <ConsultRecordTab customerId={customerId} />
                  )}
                </div>
                {/* T-20260605-foot-RX-PHRASE-CLICK-INSERT: 하단 일괄 '삽입' 버튼 제거 — 행 내 ✓ 즉시삽입으로 단일화 */}
                </div>{/* /패널 본문 (PHRASE-CHECKBOX-ARROW AC6-3 접힘 래퍼) */}
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
                className="flex-1 h-9 text-xs bg-neutral-800 hover:bg-neutral-900 text-white"
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

      {/* T-20260620-foot-MEDCHART-DELETE-SAMEDAY-POLICY AC-1: 진료차트 삭제(무효화) 확인 다이얼로그.
          soft-delete(의료법 §22-3) — 사유 입력(선택) 후 handleConfirmDelete. director/admin 한정. */}
      {deleteTarget && createPortal(
        <div
          className="fixed inset-0 z-[320] flex items-center justify-center bg-black/40 p-4"
          data-testid="chart-delete-confirm"
          onMouseDown={(e) => { if (e.target === e.currentTarget && !deleting) { setDeleteTarget(null); setDeleteReason(''); } }}
        >
          <div className="w-full max-w-sm rounded-lg bg-white p-4 shadow-xl" onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-gray-800">진료 기록 삭제</p>
            </div>
            <p className="mt-2 text-[13px] text-gray-600">
              <span className="font-medium text-gray-900">{fmtDateFull(deleteTarget.visit_date)}</span> 진료 기록을 삭제하시겠어요?
            </p>
            <p className="mt-1 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
              법적 보존을 위해 기록은 삭제되지 않고 보관되며, 목록에서만 숨겨집니다(원장/관리자만 조회 가능).
            </p>
            <div className="mt-3">
              <label className="text-[11px] font-medium text-gray-700">삭제 사유 (선택)</label>
              <Textarea
                value={deleteReason}
                onChange={(e) => setDeleteReason(e.target.value)}
                placeholder="예: 중복 입력, 오기재 등"
                rows={2}
                className="mt-1 text-xs"
                data-testid="chart-delete-reason"
              />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                disabled={deleting}
                onClick={() => { setDeleteTarget(null); setDeleteReason(''); }}
                className="rounded-md border border-input bg-background px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                data-testid="chart-delete-cancel"
              >
                취소
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={handleConfirmDelete}
                className="inline-flex items-center gap-1 rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                data-testid="chart-delete-confirm-ok"
              >
                {deleting && <Loader2 className="h-3 w-3 animate-spin" />}
                삭제
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

    </>,
    document.body,
  );
}
