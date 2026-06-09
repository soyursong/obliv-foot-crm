// LOGIC-LOCK: L-003 — 차트 수정사항 CRM 전체 고객 동일 적용. 변경 시 현장 승인 필수
/**
 * PenChartTab — PDF 양식 위에 태블릿 직접 필기
 *
 * T-20260513-foot-C21-TAB-RESTRUCTURE-C (AC-4)
 * T-20260517-foot-PENCHART-FORM: PDF 양식 배경 + 상용구
 * T-20260519-foot-HEALTH-Q-PEN: 발건강 질문지 PDF 캔버스 + 태블릿펜 기입
 * T-20260520-foot-PENCHART-MODAL: draw → shadcn Dialog fullscreen (backdrop + ESC close)
 * T-20260520-foot-PENCHART-REFUND-FORM: 환불/비급여 동의서 PDF 원본 + 오버레이 입력
 * T-20260520-foot-PENCHART-CHECKLIST-REMOVE: 개인정보+체크리스트 2종 양식 제거
 * T-20260522-foot-PENCHART-TOOLS-V2:
 *   AC-1: bg 캔버스 + draw canvas 모두 DRAW_DPR=2 강제 → 저장 PNG 1588×2246 (A4 192DPI)
 *         bgCanvas: CANVAS_W*2 × canvasH*2, ctx.scale(2,2), imageSmoothingQuality=high
 *         drawCanvas: CANVAS_W*2 × canvasH*2 (기존 유지)
 *         저장 tempCanvas = bgCanvas 해상도(1588×2246) → draw 1:1 합성. device DPR 무관.
 *
 * T-20260523-foot-FORM-TEMPLATE-REGEN:
 *   양식 이미지 원본 고해상도 재생성 — PDF 원본(300DPI)에서 재래스터화
 *   - health_q_general.png / health_q_senior.png: 오블리브_발톱_발건강_질문지 PDF 300DPI
 *   - refund_consent.png: 비급여 및 환불 동의서(최종) 3페이지 PDF 300DPI 세로 연결
 *   - pen_chart_form.png: 오블리브 풋센터 초진 문진표 PDF 300DPI
 *   bgCanvas 사이즈 고정: CANVAS_W*DRAW_DPR × canvasH*DRAW_DPR (구 nw*DRAW_DPR 오류 수정)
 *   → 300DPI 소스를 canvas 크기로 HQ downsample → 선명도 개선, GPU 메모리 절약
 *   AC-2: getCoalescedEvents() 활용 → 태블릿 펜 획 누락·지연 개선
 *   AC-3: [T] 텍스트 도구 — 탭 위치 키보드 입력 후 캔버스 삽입
 *   AC-5: 형광펜 도구 — 반투명 두꺼운 선, 지우개 호환
 *
 * T-20260522-foot-PENCHART-TOOL-UX (P2):
 *   AC-1: 펜 quadratic bezier 스무딩 → 글씨 인식 개선 (lastMidRef 추적)
 *   AC-2: 지우개 — placedItems 미삭제 (드로잉 레이어 스트로크만)
 *   AC-3: 화이트 — placedItems hit-test 삭제 (상용구 포함 전체)
 *   AC-4: 텍스트 — 저장 후 이동·삭제 (PlacedItemOverlay 기존 구현)
 *   AC-5: 형광펜 — globalAlpha 0.20 (기존 구현)
 *   AC-6: T상용구 패널 헤더 중복 라벨 제거
 *
 * 모드 구조:
 *   list   — 저장된 차트 목록 + 새 차트 버튼
 *   select — 양식 선택 패널 (pen_chart / health_questionnaire_* / refund_consent)
 *   draw   — 캔버스 필기 모드 (pen_chart + health_questionnaire_* + refund_consent 공용)
 *
 * draw 모드 저장:
 *   - photos bucket / customer/{id}/pen-chart/{ts}_{rand}.png
 *   - health_questionnaire는 파일명에 'hq_' prefix 붙여 구분
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { format } from 'date-fns';
import {
  BookOpen, ClipboardList, Download, Eraser, Highlighter, Pencil, Plus, RotateCcw,
  Save, Trash2, Type, X, ChevronLeft, FileText, Undo2, TextCursorInput, Paintbrush,
  CheckSquare, Move, Check,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
// T-20260529-foot-HEALTH-Q-MOBILE: 발건강질문지 모바일 자가작성 결과 패널
import { HealthQResultsPanel } from '@/components/HealthQResultsPanel';
// T-20260523-foot-PENCHART-FORM-AUTOFILL AC-R4: SignaturePad UI 제거 (하단 서명란 불필요)

// ─── 상용구 데이터 ───
// T-20260517-foot-PENCHART-FORM: 자주 사용하는 텍스트 템플릿
export const BOILERPLATE_ITEMS = [
  { id: 'b1', label: '발목 족저근막염', text: '족저근막염\n좌 / 우  초음파 확인' },
  { id: 'b2', label: '무지외반증', text: '무지외반증\n좌 / 우  Grade:' },
  { id: 'b3', label: '굳은살·티눈', text: '굳은살 / 티눈\n부위:' },
  { id: 'b4', label: '발톱 내성발톱', text: '내성발톱\n좌 / 우  단계:' },
  { id: 'b5', label: '평발(편평족)', text: '편평족\n좌 / 우  Arch Index:' },
  { id: 'b6', label: '당뇨발 주의', text: '당뇨발 주의사항\n혈당조절 중요. 상처 즉시 내원.' },
  { id: 'b7', label: '시술 후 주의', text: '시술 후 주의사항:\n・ 당일 세발 금지\n・ 48시간 습윤 유지\n・ 출혈·발열 시 즉시 내원' },
  { id: 'b8', label: '다음 예약', text: '다음 예약: ___ 월 ___ 일 ___ 시\n담당:' },
];

interface SavedChart {
  name: string;
  url: string;
  uploadedAt: string; // ISO string parsed from filename
}

interface Template {
  id: string;
  name_ko: string;
  template_path: string;
  template_format: string;
  form_key: string;
}

// ─── 내장 폴백 템플릿 ───
// T-20260517-foot-PENCHART-FORM: DB 미적용 시 폴백 (public/forms/ 에셋)
// T-20260523-foot-PENCHART-INSURANCE (스펙 정정): 양식 명칭 '[보험차트]'로 변경 (보험 청구 목적)
export const BUILTIN_PEN_CHART_TEMPLATE: Template = {
  id: 'builtin-pen-chart',
  name_ko: '[보험차트]',
  template_path: '/forms/pen_chart_form.png',
  template_format: 'png',
  form_key: 'pen_chart',
};

// T-20260519-foot-HEALTH-Q-PEN: 발건강 질문지 PDF→PNG 폴백 (public/forms/ 에셋)
export const BUILTIN_HEALTH_Q_GENERAL: Template = {
  id: 'builtin-health-q-general',
  name_ko: '발건강 질문지 (일반)',
  template_path: '/forms/health_q_general.png',
  template_format: 'png',
  form_key: 'health_questionnaire_general',
};

export const BUILTIN_HEALTH_Q_SENIOR: Template = {
  id: 'builtin-health-q-senior',
  name_ko: '발건강 질문지 (어르신용)',
  template_path: '/forms/health_q_senior.png',
  template_format: 'png',
  form_key: 'health_questionnaire_senior',
};

// T-20260520-foot-PENCHART-REFUND-FORM: 환불/비급여 동의서 PDF 원본 폴백 (3페이지 세로 연결)
export const BUILTIN_REFUND_CONSENT: Template = {
  id: 'builtin-refund-consent',
  name_ko: '환불/비급여 동의서',
  template_path: '/forms/refund_consent.png',
  template_format: 'pdf_overlay',
  form_key: 'refund_consent',
};

// T-20260522-foot-PENCHART-TOOLS-V2 AC-1 DPR 2.0:
// CANVAS_W = 794 = A4 너비 at 96 DPI (210mm × 96/25.4 ≈ 793.7px)
// DRAW_DPR = 2 강제 → draw canvas 물리 픽셀 = 1588×2246 (A4 192 DPI)
// window.devicePixelRatio 무관 — 항상 2x 보장 (Galaxy Tab DPR 불문)
const CANVAS_W = 794;
const CANVAS_H = 1123; // A4 높이 at 96 DPI (297mm × 96/25.4 ≈ 1122.5px)
const DRAW_DPR = 2;   // 드로잉 레이어 강제 DPR (device DPR 무관)
// T-20260520-foot-PENCHART-REFUND-FORM: 환불/비급여 동의서 3페이지 세로 연결 (1440×6104 → 794×3369)
const CANVAS_H_REFUND_CONSENT = 3369; // 1123 * 3
// T-20260522-foot-PENCHART-HIRES-FORM: 개인정보+체크리스트 어르신용 2페이지 세로 연결 (2482×7016 → 794×2246)
const CANVAS_H_PC_SENIOR = 2246; // 1123 * 2

// ─── T-20260522-foot-PENCHART-REFUND-AUTOFILL ────────────────────────────
// T-20260523-foot-PENCHART-FORM-AUTOFILL: 연락처 제거 + 차트번호 추가 + 펜차트 양식 성함/주민번호 연동
interface AutofillFields {
  date:        string; // 작성일
  name:        string; // 고객 성명
  birthDate:   string; // 생년월일 (하위 호환 유지 — 현재 포지션 미사용)
  chartNumber: string; // 차트번호 (환불동의서 page 1)
  rrn:         string; // 주민번호 전체 표시 (보험차트 전용 — 예: "990101-1234567") AC-8: 마스킹 제거
  // phone 제거 — T-20260523-foot-PENCHART-FORM-AUTOFILL AC: 연락처 자동채움 불필요
}

// ── 환불/비급여 동의서 자동채움 좌표 (기준: CANVAS_W=794, CANVAS_H_REFUND_CONSENT=3369) ──
// page 1 상단 환자 정보 박스 (차트번호 + 환자이름)
// T-20260523-foot-PENCHART-FORM-AUTOFILL AC-R5: 좌표 전수 재보정 (실기기 스크린샷 증거 기반)
// T-20260524-foot-PENCHART-FORM-AUTOFILL FIX-SUPPLEMENT: 좌표 정밀 교정 (MSG-20260524-111246-xbb9)
//   refund_consent.png 2481×10524 → canvas 794×3369 (scale=0.32)
//   PIL 픽셀 정밀 분석 (full-x-range scan):
//     "● 차트번호 :" 라벨 텍스트  = canvas y=201~213, x=98~179
//     "● 차트번호 :" 밑줄(underline) = canvas y=214, x=127~320  ← 이전 y≈213 주석 수정
//     "● 환자이름 :" 라벨 텍스트  = canvas y=236~248, x=98~179
//     "● 환자이름 :" 밑줄(underline) = canvas y=249, x=119~320
//   x=190: 코론 끝(x≈178)에서 12px 여백 → 입력란 공간에 명확히 배치
//   y=199/234: textBaseline='top', 15px font → 텍스트 하단(y+15)이 밑줄(y=214/249)에 정렬
//     (이전 y=201/236: 텍스트 하단이 밑줄보다 2px 아래로 내려가는 미세 오차 → 보정)
//   기존 e86c953 x=163,y=155/188 (라벨 위 46px) → AC-R5에서 x=182→190, y=201→199 순차 교정
const REFUND_AUTOFILL_POS_P1: Array<{ key: keyof AutofillFields; x: number; y: number }> = [
  { key: 'chartNumber', x: 190, y: 199 }, // page 1: ● 차트번호 : ___ (밑줄 y=214에 하단 정렬)
  { key: 'name',        x: 190, y: 234 }, // page 1: ● 환자이름 : ___ (밑줄 y=249에 하단 정렬)
];

// ── 환불동의서 P3 [본인 동의서] 하단 성명란 자동바인딩 ──
// T-20260608-foot-CONSENT-NAME-AUTOLOAD: 179795c(2026-05-24 AC-R4)가 하단 SignaturePad UI를
//   정리하면서 name(x=55 y=3206) 자동채움 항목을 동반 제거 → 하단 본인동의서 성명 미표시 회귀.
//   현장(김주연 총괄 6/8 15:17): "맨 하단 본인동의서 이름"은 자동으로 채워져야 함
//   (T-20260523-foot-PENCHART-FORM-AUTOFILL AC-3 동작 복원).
//   날짜(x=440 라인 → 현재 drawRefundP3DateAutofill 년/월/일 분리)는 별도 함수로 정상 동작 중 → 미변경.
//   복구는 bgCanvas 텍스트 레이어 합성으로만 (drawAutofillOnCtx 재사용). refund_consent 캔버스
//   desync 옵션과 무관 → BLACKSCR(P0 검정화면) 리스크 없음.
//
// T-20260609-foot-REFUND-NAME-AUTOFILL-POSITION: 좌표 좌측 이탈 RC 수정 (김주연 총괄 6/9 보고).
//   [RC — PIL 픽셀 정밀 분석, 추정 아님] refund_consent.png 2481×10524 → canvas 794×3369 (scale=0.32).
//   [본인 동의서] 표(2칸: 이름 | 서명):
//     · 표 좌측 경계 = canvas x=96 (img 300), 중앙 칸막이 x=397, 우측 경계 x=697
//     · "이름" 칸 밑줄(underline) = canvas y=3242, x=130~364 (중심 x≈247)
//     · "서명" 칸 밑줄          = canvas y=3242, x=430~664
//   직전 T-20260608 재추가 좌표 x=55 는 표 좌측 경계(96)보다 *왼쪽* = 표 바깥 페이지 여백 →
//   이름이 셀 밖 좌측으로 이탈 렌더(현장 "이름 위치 틀어짐" RC). y=3206 도 밑줄(3242)보다 36px 위 부유.
//   [수정] x: 55→145 (밑줄 좌단 130 + 15px 여백 = 칸 내부 시작, textAlign 기본 left),
//          y: 3206→3224 (textBaseline='top' 15px → 하단≈3239 가 밑줄 y=3242 바로 위 정렬, 수기란 위 안착).
//   긴이름 안전: 밑줄 우단 364까지 가용폭 219px(≈14자) — 오버플로우/서명칸(x≥430) 겹침 없음.
const REFUND_AUTOFILL_POS_P3: Array<{ key: keyof AutofillFields; x: number; y: number }> = [
  { key: 'name', x: 145, y: 3224 }, // [본인 동의서] "이름" 칸 밑줄(y=3242, x=130~364) 위 안착
];

// ── 환불동의서 P3 날짜 분리 렌더링 (AC-R5) ──
// T-20260523-foot-PENCHART-FORM-AUTOFILL AC-R5: 날짜 "년/월/일" 분리 배치
// T-20260524-foot-PENCHART-FORM-AUTOFILL FIX-SUPPLEMENT: 좌표 실측 최종 확정 (MSG-20260524-111246-xbb9)
//   PIL full-x-range scan (PNG row 9593, canvas y=3071):
//     "년" 글자 좌측 끝 = canvas x≈549.5  (textAlign='right' x=537 → 12.5px 여백) ✓
//     "월" 글자 좌측 끝 = canvas x≈617.3  (textAlign='right' x=607 → 10.3px 여백) ✓
//     "일" 글자 좌측 끝 = canvas x≈684.5  (textAlign='right' x=671 → 13.5px 여백) ✓
//     날짜 라인 top = canvas y=3069.4 → DATE_Y=3071 (textBaseline='top' 기준, 1.6px 하단) ✓
//   구 e86c953: "2026. 5. 24." 단일 배치(x=440) → "년" 글자 위에 겹침
//   현재: 연/월/일 분리 우측 정렬로 해결 (각 글자 앞 10~14px 여백)
function drawRefundP3DateAutofill(
  ctx: CanvasRenderingContext2D,
  fields: AutofillFields,
) {
  const dateStr = fields.date; // e.g. "2026. 5. 24." (ko-KR locale)
  if (!dateStr) return;
  // "2026. 5. 24." → remove dots → "2026 5 24" → split
  const parts = dateStr.replace(/\./g, '').trim().split(/\s+/).filter(Boolean);
  if (parts.length < 3) return;
  const [year, month, day] = parts;
  ctx.save();
  ctx.fillStyle = '#6b7280'; // gray-500
  ctx.font = 'italic 15px "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'right'; // 우측 정렬 — 각 마커 바로 앞에 붙임
  const DATE_Y = 3071;
  if (year)  ctx.fillText(year,  537, DATE_Y); // "년"(좌측 x≈549) 12px 전
  if (month) ctx.fillText(month, 607, DATE_Y); // "월"(좌측 x≈619) 12px 전
  if (day)   ctx.fillText(day,   671, DATE_Y); // "일"(좌측 x≈688) 17px 전
  ctx.restore();
}

// ── [보험차트] 자동채움 — 성함+주민번호 1줄 inline (AC-R6) ──
// T-20260523-foot-PENCHART-FORM-AUTOFILL AC-R6:
//   성함+주민번호를 한 줄로 inline 배치 + 폰트 축소 (15px → 11px)
//   pen_chart_form.png 2482×3510 → canvas 794×1123 (scale=0.32)
//   x=190: 로고(x≈25-185) 바로 우측 — 담당의(x≈530) 까지 340px 공간 확보 (긴 이름+주민번호 안전)
//   y=28: 담당의 라인(y≈23)~담당실장 라인(y≈44) 사이 수직 중심
//   출력 예: "성함: 홍길동  주민번호: 990101-1234567"
//   김주연 총괄 현장 요청 2026-05-24: "성함+주민번호 배치를 한 줄로 하고 폰트 사이즈 좀만 줄여줘"
function drawPenChartAutofillInline(
  ctx: CanvasRenderingContext2D,
  fields: AutofillFields,
) {
  const name = fields.name;
  const rrn  = fields.rrn;
  if (!name && !rrn) return;
  ctx.save();
  ctx.fillStyle = '#6b7280'; // gray-500 — 수기 입력과 시각적 구분
  ctx.font = 'italic 11px "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
  ctx.textBaseline = 'top';
  const parts: string[] = [];
  if (name) parts.push(`성함: ${name}`);
  if (rrn)  parts.push(`주민번호: ${rrn}`);
  ctx.fillText(parts.join('  '), 190, 28);
  ctx.restore();
}

/**
 * T-20260522-foot-PENCHART-TOOLS-V2 AC-1:
 * scaleX/scaleY — bg canvas가 naturalWidth×naturalHeight 기준일 때 좌표 보정
 * T-20260523-foot-PENCHART-FORM-AUTOFILL: positions 파라미터로 범용화
 */
function drawAutofillOnCtx(
  ctx: CanvasRenderingContext2D,
  fields: AutofillFields,
  positions: Array<{ key: keyof AutofillFields; x: number; y: number }>,
  scaleX = 1,
  scaleY = 1,
) {
  ctx.save();
  ctx.fillStyle = '#6b7280'; // gray-500 — 수기 입력과 시각적 구분
  ctx.font = `italic ${Math.round(15 * scaleY)}px "Malgun Gothic", "Apple SD Gothic Neo", sans-serif`;
  ctx.textBaseline = 'top';
  for (const { key, x, y } of positions) {
    const val = fields[key];
    if (val) ctx.fillText(val, x * scaleX, y * scaleY);
  }
  ctx.restore();
}

const PEN_COLORS = [
  { label: '검정', value: '#1a1a1a' },
  { label: '파랑', value: '#1d4ed8' },
  { label: '빨강', value: '#dc2626' },
  { label: '초록', value: '#16a34a' },
];

// T-20260522-foot-PENCHART-TOOLS-V2 AC-5: 형광펜 색상
const HIGHLIGHT_COLORS = [
  { label: '노랑', value: '#fde047' },
  { label: '분홍', value: '#f9a8d4' },
  { label: '하늘', value: '#67e8f9' },
  { label: '연두', value: '#86efac' },
];

// T-20260522-foot-PENCHART-TOOLS-V3: 도구 모드 통합 타입
// white: 배경색(흰색) 덮어쓰기 도구 — source-over white fill (지우개와 달리 bg도 덮음)
// boilerplate-placing: 상용구 삽입 대기 (캔버스 클릭 시 상용구 배치)
// T-20260602-foot-PHRASE-PEN-PASSTHROUGH: select — 선택/이동 모드.
//   이 모드에서만 placedItem 오버레이가 interactive(pointerEvents auto) → 드래그·선택·삭제.
//   드로잉 도구(pen/eraser/white/highlight)에서는 오버레이 passthrough → 상용구 위 직접 필기.
type ActiveTool = 'pen' | 'eraser' | 'white' | 'text' | 'highlight' | 'boilerplate-placing' | 'select';

// T-20260522-foot-PENCHART-TOOLS-V3: 도구별 기본 굵기
const DEFAULT_THICKNESS: Record<ActiveTool, number> = {
  pen:                  1.5,
  eraser:               3,
  white:                3,
  text:                 2,
  highlight:            2,
  'boilerplate-placing': 1.5,
  select:               1.5, // 드로잉 안 함 — Record 완전성용
};

// ── T-20260603-foot-PHRASE-MULTISELECT: 상용구 복수 선택 결합 정책 (한 곳에 모음) ──
// 결합 순서 = 클릭(선택) 순서 / 구분자 = 줄바꿈('\n') (planner 확정 #1·#2).
// [DEACTIVATED — T-20260605-foot-RX-PHRASE-INSERT-UX Q1] 문지은 대표원장 요청으로
//   동선을 '단건 즉시삽입(인라인 ✓)'으로 전환. 결합 헬퍼/상수는 제거하지 않고 비활성 보존.
//   현장이 복수결합을 재요청하면 이 블록 + selectedPhraseIds 상태 + 핸들러 3종 + 푸터를
//   주석 해제해 복원한다.
// const PHRASE_JOIN_SEPARATOR = '\n';
// const combineBoilerplate = (contents: string[]): string =>
//   contents.join(PHRASE_JOIN_SEPARATOR);

// T-20260522-foot-PENCHART-TOOLS-V3: 배치된 텍스트/상용구 객체 (드래그·삭제·다중선택용)
interface PlacedItem {
  id: string;
  type: 'text' | 'boilerplate';
  x: number;       // 캔버스 논리 좌표 (CSS 1:1)
  y: number;
  text: string;
  fontSize: number; // px
  color: string;
}

type TabMode = 'list' | 'select' | 'draw';

/** draw 모드에서 활성 양식이 발건강 질문지인지 구분 */
const isHealthQFormKey = (k: string) => k.startsWith('health_questionnaire_');

/** T-20260520-foot-PENCHART-REFUND-FORM: pdf_overlay 양식 (환불/비급여 동의서 — 서명 캡처 포함) */
const isPdfOverlayFormKey = (k: string) => k === 'refund_consent';

/** T-20260520-foot-PENCHART-REFUND-FORM: 환불/비급여 동의서 여부 (3페이지) */
const isRefundConsentKey = (k: string) => k === 'refund_consent';

/** T-20260522-foot-PENCHART-HIRES-FORM: 개인정보+체크리스트 양식 (배경 PNG 있음, 서명 불필요) */
const isPersonalChecklistKey = (k: string) => k.startsWith('personal_checklist_');

/** 양식에 따른 캔버스 높이 반환 */
const getCanvasHeightForForm = (formKey: string | undefined): number => {
  if (!formKey) return CANVAS_H;
  if (isRefundConsentKey(formKey)) return CANVAS_H_REFUND_CONSENT;
  // T-20260522-foot-PENCHART-HIRES-FORM: 개인정보 체크리스트 어르신용 2페이지 세로 연결
  if (formKey === 'personal_checklist_senior') return CANVAS_H_PC_SENIOR;
  // T-20260524-foot-HEALTH-Q-ELDER-P2CUT: 발건강 질문지 어르신용 2페이지 세로 연결 (health_q_senior.png 2481×7016)
  if (formKey === 'health_questionnaire_senior') return CANVAS_H_PC_SENIOR; // 2246 = 1123 * 2
  return CANVAS_H;
};

/**
 * T-20260608-foot-PENCHART-FORM-LOAD-FAIL AC-4: 실패 단계코드(E1~E9) → 현장용 사유 힌트.
 *   현장(김주연 총괄 Galaxy Tab)은 'E4 net/CORS onerror …' 기술코드를 해석할 수 없다.
 *   → 코드를 (a) 일시적(transient: 재시도로 복구 가능) / (b) 영구(구조적: 반복 시 관리자 문의)로 분류하고
 *     무엇을 해야 하는지 한국어 한 줄로 안내한다. 기술코드(bgImgErrorReason)는 스크린샷 진단용으로 별도 유지.
 *
 *   분류 근거(과거 BLACK/BLACKSCR 티켓 루트코즈 기반):
 *     transient — GPU 소실/메모리 압박/네트워크 블립: E2 ctx-lost(init) · E3 canvas-alloc-0 ·
 *                 E4 net/CORS · E6 ctx-lost(onload/post-decode/tile) · E9 contextlost 이벤트.
 *                 → 재시도 버튼 또는 양식 재진입으로 회복되는 경우가 많음.
 *     permanent  — ctx 생성 불가/decode 실패/drawImage 실패: E1 ctx-null · E1d draw-ctx-null ·
 *                 E3d draw-canvas-alloc-0 · E5 naturalWidth=0 · E7 decode() throw · E8 drawImage throw.
 *                 → 기기/이미지 자체 한계 가능 → 반복 시 관리자 에스컬레이션 필요.
 */
const TRANSIENT_BG_ERROR_CODES = ['E2', 'E3', 'E4', 'E6', 'E9'];
function classifyBgImgError(reason: string | null): { transient: boolean; hint: string } {
  // reason 예: 'E4 net/CORS onerror (재시도 1회) · …xxxxx'. 선두 토큰이 단계코드.
  const code = (reason ?? '').split(' ')[0];
  const transient = TRANSIENT_BG_ERROR_CODES.includes(code);
  // 주의: 아래 hint 문구·이 파일 주석에는 버튼 라벨 문자열(재시도 버튼의 라벨)을 그대로 넣지 않는다 —
  //   BLACK spec 이 그 라벨의 첫 매치를 버튼으로 가정(indexOf)하므로, 첫 매치 위치를 흐트러뜨리지 않기 위함.
  return transient
    ? { transient: true,  hint: '일시적인 오류일 수 있어요. 아래 버튼을 눌러 다시 불러와 주세요. 반복되면 잠시 후 다시 열거나 관리자에게 알려주세요.' }
    : { transient: false, hint: '이미지를 표시할 수 없는 상태예요. 아래 버튼으로 재시도해도 반복되면 관리자에게 문의해주세요.' };
}



// ─── FullscreenFormWrapper ─────────────────────────────────────────────────
/**
 * FullscreenFormWrapper — 태블릿 최적화 공통 전체화면 래퍼
 * T-20260520-foot-PENCHART-FULLSCREEN AC-5~7:
 *   - 펜차트 탭 내 모든 양식(select/draw/fill + 향후 신규)이 동일 fullscreen UX
 *   - 개별 양식마다 Dialog 분기 없음 — 이 래퍼 하나만 적용
 *   - 향후 양식 추가 시 자동으로 fullscreen 적용됨 (확장성 보장)
 */
function FullscreenFormWrapper({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="fullscreen" hideClose>
        {children}
      </DialogContent>
    </Dialog>
  );
}

// ─── PlacedItemOverlay ─────────────────────────────────────────────────────
/**
 * V3 AC-7~9, AC-13~16:
 * 배치된 텍스트/상용구를 draggable DOM 오버레이로 렌더링.
 * 드래그 이동 + 삭제 + Shift+클릭 다중선택 지원.
 */
function PlacedItemOverlay({
  item, isSelected, approxH, interactive, onSelect, onMove, onDelete,
}: {
  item: PlacedItem;
  isSelected: boolean;
  approxH: number;
  // T-20260602-foot-PHRASE-PEN-PASSTHROUGH: 선택/이동 모드일 때만 true.
  // false(드로잉 도구 활성)면 wrapper pointerEvents:'none' → pointerdown이 캔버스로 통과해 상용구 위 직접 필기 가능.
  interactive: boolean;
  onSelect: (id: string, multi: boolean) => void;
  onMove: (id: string, dx: number, dy: number) => void;
  onDelete: (id: string) => void;
}) {
  const dragStart = useRef<{ px: number; py: number } | null>(null);
  const hasMoved  = useRef(false);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    dragStart.current = { px: e.clientX, py: e.clientY };
    hasMoved.current  = false;
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStart.current) return;
    e.stopPropagation();
    const dx = e.clientX - dragStart.current.px;
    const dy = e.clientY - dragStart.current.py;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      hasMoved.current = true;
      onMove(item.id, dx, dy);
      dragStart.current = { px: e.clientX, py: e.clientY };
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (!hasMoved.current) {
      onSelect(item.id, e.shiftKey);
    }
    dragStart.current = null;
    hasMoved.current  = false;
  };

  return (
    <div
      style={{
        position: 'absolute',
        left: item.x,
        top: item.y,
        minWidth: 60,
        minHeight: approxH,
        cursor: interactive ? 'grab' : 'default',
        userSelect: 'none',
        zIndex: 20,
        border: interactive && isSelected ? '1.5px dashed #7c3aed' : '1px dashed transparent',
        borderRadius: 4,
        padding: '2px 4px',
        background: interactive && isSelected ? 'rgba(124,58,237,0.04)' : 'transparent',
        boxSizing: 'border-box',
        touchAction: 'none',
        // T-20260602-foot-PHRASE-PEN-PASSTHROUGH 핵심 수정:
        // 드로잉 도구 활성(interactive=false) 시 'none' → pointerdown이 wrapper에 흡수되지 않고
        // 아래 드로잉 캔버스로 통과 → 상용구 bbox 위에서도 펜/형광펜 직접 기입.
        // 선택/이동 모드(interactive=true)에서만 'auto' 복귀 → 드래그·선택·삭제 정상.
        pointerEvents: interactive ? 'auto' : 'none',
      }}
      onPointerDown={interactive ? handlePointerDown : undefined}
      onPointerMove={interactive ? handlePointerMove : undefined}
      onPointerUp={interactive ? handlePointerUp : undefined}
      onPointerCancel={interactive ? handlePointerUp : undefined}
    >
      {/* テキスト内容 — 実際にはcanvas描画と同じフォント */}
      <div
        style={{
          font: `${item.fontSize}px 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif`,
          color: item.color,
          whiteSpace: 'pre-wrap',
          lineHeight: `${item.fontSize + 6}px`,
          opacity: 0.85,
          pointerEvents: 'none',
        }}
      >
        {item.text}
      </div>
      {/* 아이템 우상단 — 삭제 버튼 (선택/이동 모드 + 선택 시 표시) */}
      {interactive && isSelected && (
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onDelete(item.id); }}
          style={{
            position: 'absolute',
            top: -10,
            right: -10,
            width: 18,
            height: 18,
            borderRadius: '50%',
            background: '#dc2626',
            color: '#fff',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 10,
            fontWeight: 'bold',
            zIndex: 30,
          }}
          title="삭제"
        >
          ×
        </button>
      )}
      {/* T-20260603-foot-PHRASE-MOVE-RESTORE (AC-2·AC-4):
          항상 보이는 인터랙티브 이동 그립 핸들.
          - 본문(wrapper)은 드로잉 모드에서 pointerEvents:'none'(펜 passthrough, AC-3 무회귀) 유지하되,
            이 핸들만 pointerEvents:'auto' → CSS상 부모 none이어도 자식 auto는 이벤트 수신 →
            어느 도구(펜/형광펜/지우개/화이트)에서든 핸들 드래그로 1단계 상용구 이동(AC-4).
          - parent PHRASE-PEN-PASSTHROUGH의 '선택/이동 도구 명시 전환' 요구를 제거 → 회귀 복구.
          - 핸들 자체가 발견 가능한 이동 진입점(AC-2). 별도 버튼 탐색 불필요. */}
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        title="드래그하여 상용구 이동 (탭: 선택)"
        style={{
          position: 'absolute',
          top: -9,
          left: -9,
          width: 22,
          height: 22,
          borderRadius: '50%',
          background: isSelected ? '#7c3aed' : '#0d9488', // 선택 시 보라, 기본 teal-600 (풋 팔레트)
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'grab',
          // 핵심: wrapper가 'none'이어도 이 핸들만 'auto' → 드로잉 모드에서도 1단계 이동 가능
          pointerEvents: 'auto',
          touchAction: 'none',
          boxShadow: '0 1px 3px rgba(0,0,0,0.35)',
          zIndex: 31,
        }}
      >
        <Move style={{ width: 12, height: 12 }} />
      </div>
    </div>
  );
}

// ─── 메인 컴포넌트 ──────────────────────────────────────────────────────────
export function PenChartTab({
  customerId,
  clinicId,
  checkInId,
  // T-20260522-foot-PENCHART-REFUND-AUTOFILL: 환불동의서 자동채움에 사용
  // T-20260523-foot-PENCHART-FORM-AUTOFILL: customerPhone 제거, customerChartNumber 추가, customerRrn 신규
  customerName,
  customerBirthDate,
  customerChartNumber,
  customerRrn,
  // T-20260520-foot-PENCHART-VIEW-SPLIT HOTFIX2: 상담내역 즉시 갱신
  onFormSubmissionSaved,
  // T-20260528-foot-PENCHART-NEWWIN: 별도 팝업 창 모드 — list 없이 select→draw→저장→닫기
  popupMode = false,
}: {
  customerId: string;
  clinicId: string;
  /** 현재 내원 check_in_id — form_submissions.check_in_id 자동 연동 */
  checkInId?: string;
  /** 고객 기본 정보 (양식 자동 채움) */
  customerName?: string;
  /** @deprecated T-20260523-foot-PENCHART-FORM-AUTOFILL: 연락처 자동채움 제거 */
  customerPhone?: string; // 하위 호환용 — 내부 미사용
  customerBirthDate?: string;
  /** 차트번호 — 환불동의서 page 1 자동채움용 */
  customerChartNumber?: string;
  /**
   * 주민번호 전체 표시 — [보험차트] 상단 자동 연동 (T-20260523-foot-PENCHART-FORM-AUTOFILL AC-8)
   * 형식: "YYMMDD-1234567" (rrn_decrypt 복호화값 전체, 마스킹 없음)
   * 2026-05-24 김주연 총괄 현장 결정: A안(전체 표시) 확정 — 보험차트 용도.
   */
  customerRrn?: string;
  /** form_submissions INSERT 성공 시 — 상담내역 탭 [내용보기] 즉시 활성화 트리거 */
  onFormSubmissionSaved?: () => void;
  /**
   * T-20260528-foot-PENCHART-NEWWIN: 별도 팝업 창 모드
   * true → list 모드 없이 select 에서 시작, 저장 후 BroadcastChannel 브로드캐스트 + window.close()
   */
  popupMode?: boolean;
}) {
  const { profile } = useAuth();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // T-20260522-foot-PENCHART-ERASER-CLARITY: 배경 레이어 (양식 이미지 전용 — 지우개 미적용)
  const bgCanvasRef = useRef<HTMLCanvasElement>(null);
  // T-20260522-foot-PENCHART-REFUND-AUTOFILL: 환불동의서 자동채움 데이터 (initCanvas 내 img.onload 에서 읽음)
  const autofillDataRef = useRef<AutofillFields | null>(null);
  const [savedCharts, setSavedCharts] = useState<SavedChart[]>([]);
  const [penChartTemplate, setPenChartTemplate] = useState<Template | null>(null);
  /** 발건강 질문지 템플릿 2종 (일반/어르신) — T-20260519-foot-HEALTH-Q-PEN */
  const [healthQTemplates, setHealthQTemplates] = useState<Template[]>([]);
  /** T-20260520-foot-PENCHART-REFUND-FORM: 환불/비급여 동의서 템플릿 */
  const [refundConsentTemplate, setRefundConsentTemplate] = useState<Template | null>(null);
  const [templateImgUrl, setTemplateImgUrl] = useState<string | null>(null);
  // T-20260528-foot-PENCHART-NEWWIN: popupMode=true 시 list 건너뛰고 select 에서 시작
  const [mode, setMode] = useState<TabMode>(popupMode ? 'select' : 'list');
  /** draw 모드에서 현재 활성 양식 (pen_chart | health_questionnaire_* | refund_consent) */
  const [activeDrawTemplate, setActiveDrawTemplate] = useState<Template | null>(null);
  // T-20260525-foot-PENCHART-FORM-BLACK AC-4: 배경 이미지 로드 실패 폴백 UI 상태
  const [bgImgLoadError, setBgImgLoadError] = useState(false);
  // T-20260608-foot-PENCHART-REFUND-FORMIMG AC-2: 배경 이미지 실패 "단계 코드"를 화면 노출.
  //   "양식 이미지를 불러올 수 없습니다."는 8개 서로 다른 실패 지점(ctx null/lost, canvas alloc 0,
  //   network onerror, naturalWidth=0, decode throw, drawImage throw)이 합쳐진 단일 UI라 콘솔 없이는
  //   원인 식별 불가. Galaxy Tab은 DevTools 콘솔 캡처 불가(LATENCY 메타-루트코즈) → 스크린샷 1장으로
  //   실패 stage를 가르도록 화면에 코드를 노출(b5a7979 펜 성능 배지와 동일 전략). 단정 금지·진단 우선.
  const [bgImgErrorReason, setBgImgErrorReason] = useState<string | null>(null);
  // T-20260608-foot-PENCHART-REFUND-FORMIMG AC-1: network onerror 시 cache-bust 자동 1회 재시도.
  //   Android WebView가 동일 URL을 crossOrigin 없이 먼저 캐시했다가 crossOrigin='anonymous' 재요청 시
  //   비-CORS 캐시 응답을 읽어 onerror(캐시 오염) + 일시 네트워크 블립을 즉시 자동 회복. 양식 진입마다 리셋.
  const bgImgRetryRef = useRef(0);
  // staff.id — issued_by FK (profile.id ≠ staff.id, user_id 경유 조회)
  const [staffId, setStaffId] = useState<string | null>(null);

  // Canvas/draw states
  const [penColor, setPenColor] = useState('#1a1a1a');
  // T-20260522-foot-PENCHART-TOOLS-V3: 초기 굵기 1.5 (펜 기본값)
  const [penSize, setPenSize] = useState(DEFAULT_THICKNESS.pen);
  // T-20260522-foot-PENCHART-TOOLS-V3: 통합 도구 상태 (pen/eraser/white/text/highlight/boilerplate-placing)
  const [activeTool, setActiveTool] = useState<ActiveTool>('pen');
  // T-20260522-foot-PENCHART-TOOLS-V2 AC-5: 형광펜 색상
  const [highlightColor, setHighlightColor] = useState('#fde047');
  // T-20260522-foot-PENCHART-TOOLS-V3: 배치된 아이템 목록 (텍스트/상용구 드래그·삭제용)
  const [placedItems, setPlacedItems] = useState<PlacedItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [hasDrawing, setHasDrawing] = useState(false);
  const [selectedChart, setSelectedChart] = useState<SavedChart | null>(null);
  // T-20260602-foot-PENCHART-LOCK-PANZOOM: 차트 고정/잠금 토글 (빨간X).
  //   ON  → 캔버스 touchAction:'none' + 스크롤 컨테이너 overflow:hidden
  //         → 펜/형광펜 드로잉 시 네이티브 pan/zoom·스크롤 완전 차단, 획만 기입 (AC-1·2)
  //   OFF → 기존 동작 (touchAction:'pan-y' + overflow-auto) 유지 → pan/scroll 정상 (AC-3)
  //   규명: 기존 코드에 고정 토글·pan/zoom lib 부재. 유일한 pan/zoom 출처는
  //         캔버스 touchAction:'pan-y'(b9cd022 SCROLL-BLOCK) + 래퍼 overflow 스크롤.
  //         → lock state를 게이팅 조건으로 신규 연결.
  const [chartLocked, setChartLocked] = useState(false);

  // 상용구 상태
  const [pendingBoilerplate, setPendingBoilerplate] = useState<string>('');
  // V3: showBoilerplatePanel 제거 — 단일 상용구 메뉴(showPhrasePanel)로 통합

  // T-20260522-foot-PENCHART-PHRASE: phrase_templates DB 연동 상태
  const [phraseTemplates, setPhraseTemplates] = useState<Array<{
    id: number; category: string; name: string; content: string;
  }>>([]);
  const [phraseTemplatesLoaded, setPhraseTemplatesLoaded] = useState(false);
  const [showPhrasePanel, setShowPhrasePanel] = useState(false);
  const [phraseCategory, setPhraseCategory] = useState<string>('charting');
  // [DEACTIVATED — T-20260605-foot-RX-PHRASE-INSERT-UX Q1] 복수 선택 배열. 복원 시 주석 해제.
  // const [selectedPhraseIds, setSelectedPhraseIds] = useState<number[]>([]);
  // T-20260605-foot-RX-PHRASE-INSERT-UX (AC-2): 행 클릭 시 그 행에만 인라인 ✓ 노출 (한 번에 한 행).
  //   null = 노출 없음 / number = 해당 phrase.id 행에 ✓ 노출. 같은 행 재클릭 = 닫힘.
  const [revealedPhraseId, setRevealedPhraseId] = useState<number | null>(null);

  // T-20260522-foot-PENCHART-TOOLS-V2 AC-3: 텍스트 도구 상태
  const [textInputPos, setTextInputPos] = useState<{
    x: number;     // 캔버스 논리 좌표 (fillText 위치)
    y: number;
    cssX: number;  // CSS 픽셀 좌표 (오버레이 표시 위치)
    cssY: number;
  } | null>(null);
  const [textInputValue, setTextInputValue] = useState('');
  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  const drawingRef = useRef(false);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);
  // T-20260522-foot-PENCHART-TOOL-UX AC-1: 펜 bezier 스무딩용 이전 midpoint 추적
  const lastMidRef = useRef<{ x: number; y: number } | null>(null);
  const emptyRef = useRef(true);
  // T-20260523-foot-PENCHART-PEN-SLOW: React re-render 억제 — drawing 중 setHasDrawing 중복 호출 방지
  const hasDrawingRef = useRef(false);
  // T-20260523-foot-PENCHART-PEN-SLOW Fix-2: draw canvas ctx 캐싱 — onPointerMove마다 getContext 제거
  const drawCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  // ── draw(overlay) 캔버스 DPR 단일소스 — REOPEN#2(필기불능 P0 회귀 복구)에서 항상 DRAW_DPR(2) 고정 ──────
  //   getPos/onPointerDown/handleNativePointerMove 3개 좌표 스케일 지점이 이 단일 ref 를 사용 → 좌표 어긋남 차단.
  //   REOPEN#1의 ?penchart_lite(1x) 레버는 필기불능 회귀(43c2c9a field-soak FAIL)로 제거 → 값은 항상 DRAW_DPR.
  //   ref 구조는 유지(좌표 사이트 무변경, 수술 리스크 0). bgCanvas/저장도 DRAW_DPR(2) 유지(업스케일 합성).
  const drawDprRef = useRef<number>(DRAW_DPR);
  // T-20260523-foot-PENCHART-PEN-SLOW Fix-3: getBoundingClientRect 캐싱 — 획 동안 재사용, onPointerMove마다 강제 레이아웃 제거
  const strokeRectRef = useRef<DOMRect | null>(null);
  // T-20260523-foot-PENCHART-PEN-SLOW Fix-4: white 도구 획 경로 — onPointerUp에서 한 번만 hit-test
  const whiteStrokePathRef = useRef<Array<{ x: number; y: number }>>([]);
  // T-20260526-foot-PENCHART-PEN-SLOW Fix-8: mirror refs for native pointermove (React 18 scheduler bypass)
  // React 18 concurrent mode는 pointermove를 MessageChannel tick으로 스케줄링 → 4-16ms 추가 지연.
  // native addEventListener는 브라우저 이벤트 루프에서 동기 발화 → 지연 최소화.
  const activeToolRef     = useRef<ActiveTool>('pen');
  const penColorRef       = useRef('#1a1a1a');
  const penSizeRef        = useRef<number>(DEFAULT_THICKNESS.pen);
  const highlightColorRef = useRef('#fde047');
  // strokeScaleRef: scaleX/scaleY를 onPointerDown에서 1회 계산 → native handler가 매 이벤트마다 재계산 생략
  const strokeScaleRef    = useRef<{ x: number; y: number }>({ x: 1, y: 1 });
  // ── T-20260606-foot-PENCHART-REFUND-PEN-MISS: 스크롤로 인한 strokeRect 캐시 stale 방지 ──────────
  //   [루트코즈 — 코드증거] strokeRectRef는 onPointerDown(획 시작) 1회만 getBoundingClientRect 캐싱.
  //   환불/비급여 동의서(3p, 1588×6738)는 overflow-auto 스크롤 컨테이너 + touchAction:'pan-y'(unlocked).
  //   펜 획 중/직후 컨테이너가 세로로 스크롤되면 캔버스 viewport rect.top 이 이동 → 캐시는 스크롤 전 값 →
  //   toLogical 의 (clientY - staleRect.top) 가 어긋나 "스크롤 직후 첫 획 오프셋/미등록"(현장 "펜 안먹음").
  //   [수정] scroll 리스너는 dirty 플래그만 세팅(레이아웃 read 0). 다음 pointermove(프레임)에서 dirty면
  //   rect/scale 을 1회만 재측정 → hot-path 비용 0(scroll 발생 후에만), pan-y 스크롤(AC-3) 비파괴.
  const strokeRectDirtyRef = useRef(false);

  // ── T-20260606-foot-PENCHART-REFUND-LATENCY: 실기기 펜 지연 프로파일러 ──────────
  //   목적: Galaxy Tab 대형 캔버스(1588×6738) 펜 latency의 "실제 병목"을 실기기에서 계측.
  //         (planner 지시 "추정 단정 금지 / 프로파일링 선행" — 두 가설을 데이터로 가른다)
  //         · coalesce 손실 가설 → coalescedPerMove(획당 평균 coalesced 수) / inputHz 로 식별
  //         · 전체 6738px redraw 비용 가설 → avgDrawMs(stroke() 래스터 시간) / maxFrameGapMs(jank) 로 식별
  //   게이트: ?penchart_perf URL param 있을 때만 활성 (prod hot-path 오버헤드 0 — enabled=false 단일 분기).
  //   출력: 획 종료(onPointerUp) 시 console.log('[PenChartTab PERF] {...}') 1줄 → 현장 DevTools 캡처.
  const perfRef = useRef<{
    enabled: boolean;
    strokeStart: number;
    moves: number;
    coalescedTotal: number;
    emptyCoa: number;        // getCoalescedEvents()가 빈 배열 반환한 move 수(선빠짐 직접원인 지표)
    drawTimeTotal: number;
    maxFrameGap: number;
    lastMoveTs: number;
  }>({ enabled: false, strokeStart: 0, moves: 0, coalescedTotal: 0, emptyCoa: 0, drawTimeTotal: 0, maxFrameGap: 0, lastMoveTs: 0 });

  // ── T-20260606-foot-PENCHART-REFUND-LATENCY REOPEN#1: 현장 캡처형 on-screen 프로파일러 ──────────
  //   [REOPEN#1 메타-루트코즈] 직전 라운드(e003641: coalesced 단일path + dirty-rect)가 field-soak FAIL.
  //   FAIL의 메타 원인 = 프로파일러가 ?penchart_perf + DevTools 콘솔 전용 → 김주연 총괄이 Galaxy Tab
  //   에서 콘솔 캡처 불가 → 실병목 데이터 없이 추정(coalesce/redraw 단정)으로 배포 → 빗나감.
  //   [수정] 같은 ?penchart_perf 게이트로 화면 우상단 배지를 렌더 → 총괄이 몇 획 긋고 "스크린샷 한 장"
  //   으로 avgDrawMs(래스터/redraw 비용) vs maxFrameGapMs(jank/합성stall) vs coalescedPerMove(coalesce 손실)
  //   을 가른다. prod(파라미터 없음)에는 perfDisplay=null 유지 → 배지 미렌더(오버헤드 0). 좌표/화질/desync 무변경.
  const [perfDisplay, setPerfDisplay] = useState<null | {
    formKey: string | null; canvas: string; strokeMs: number; moves: number;
    coalescedPerMove: number; avgDrawMs: number; maxFrameGapMs: number; inputPtsPerSec: number;
    wFrameGap: number; wAvgDraw: number; wMinCoa: number; wStrokeMs: number; strokes: number;
    verdict: string;
  }>(null);
  //   세션 누적 worst (단일 스크린샷이 최악 케이스를 담도록) — 양식 진입(initDrawCanvas)에서 리셋.
  const perfWorstRef = useRef<{ frameGap: number; avgDraw: number; minCoa: number; strokeMs: number; strokes: number }>(
    { frameGap: 0, avgDraw: 0, minCoa: Infinity, strokeMs: 0, strokes: 0 },
  );

  // T-20260519-foot-PENCHART-FORM-ADD (FIX): Undo 10단계
  const undoStackRef = useRef<ImageData[]>([]);
  const UNDO_LIMIT = 10;
  // T-20260524-foot-PENCHART-PEN-SLOW Fix-5: async pre-capture — getImageData를 획 시작(hot path) 밖으로 이동
  // 매 onPointerUp 후 rAF에서 캡처 → onPointerDown 시 이미 준비된 ImageData를 stack에 적재 (sync 없음)
  const pendingUndoDataRef = useRef<ImageData | null>(null);
  const pendingUndoRafRef  = useRef<number | null>(null);

  // T-20260523-foot-PENCHART-FORM-AUTOFILL AC-R4: 서명 캡처 UI 제거 — signature_base64 항상 null

  // T-20260526-foot-PENCHART-PEN-SLOW Fix-8: sync state → refs every render
  // native pointermove handler는 deps 없는 stable useCallback → state를 closure로 캡처 불가.
  // 대신 *Ref.current 경유 → 항상 최신값 보장. state setter(setHasDrawing)는 stable이므로 생략.
  activeToolRef.current     = activeTool;
  penColorRef.current       = penColor;
  penSizeRef.current        = penSize;
  highlightColorRef.current = highlightColor;

  const storagePath = `customer/${customerId}/pen-chart`;

  // ── staff.id 조회 ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!profile?.id || !clinicId) return;
    supabase
      .from('staff')
      .select('id')
      .eq('user_id', profile.id)
      .eq('clinic_id', clinicId)
      .eq('active', true)
      .maybeSingle()
      .then(({ data }) => setStaffId(data?.id ?? null));
  }, [profile?.id, clinicId]);

  // ── T-20260522-foot-PENCHART-REFUND-AUTOFILL + T-20260523-foot-PENCHART-FORM-AUTOFILL ──
  // 자동채움 데이터: refund_consent + pen_chart 모두 지원 (phone 제거, rrn 추가)
  useEffect(() => {
    const isAutofillForm =
      isRefundConsentKey(activeDrawTemplate?.form_key ?? '') ||
      activeDrawTemplate?.form_key === 'pen_chart';
    if (activeDrawTemplate && isAutofillForm) {
      autofillDataRef.current = {
        date:        new Date().toLocaleDateString('ko-KR'),
        name:        customerName        ?? '',
        birthDate:   customerBirthDate   ?? '',
        chartNumber: customerChartNumber ?? '',
        rrn:         customerRrn         ?? '', // 주민번호 전체 표시 — [보험차트] 전용 (AC-8: 마스킹 없음)
      };
    } else {
      autofillDataRef.current = null;
    }
  }, [activeDrawTemplate, customerName, customerBirthDate, customerChartNumber, customerRrn]);

  // ── 저장된 차트 목록 로드 ────────────────────────────────────────────
  const loadSavedCharts = useCallback(async () => {
    const { data: files } = await supabase.storage
      .from('photos')
      .list(storagePath, { limit: 100, sortBy: { column: 'name', order: 'desc' } });

    if (!files || files.length === 0) { setSavedCharts([]); return; }

    const filtered = files.filter((f) => f.name && !f.id?.endsWith('/'));
    const paths = filtered.map((f) => `${storagePath}/${f.name}`);
    const { data: urlData } = await supabase.storage.from('photos').createSignedUrls(paths, 3600);
    const charts = filtered.map((file, i) => {
      const tsMatch = file.name.match(/^(\d+)/);
      const ts = tsMatch ? parseInt(tsMatch[1], 10) : 0;
      return {
        name: file.name,
        url: urlData?.[i]?.signedUrl ?? '',
        uploadedAt: ts ? new Date(ts).toISOString() : '',
      };
    });
    setSavedCharts(charts.filter((c) => c.url));
  }, [storagePath]);

  // ── 템플릿 로드 ──────────────────────────────────────────────────────
  const loadTemplates = useCallback(async () => {
    const { data } = await supabase
      .from('form_templates')
      .select('id, name_ko, template_path, template_format, form_key')
      .eq('clinic_id', clinicId)
      .in('form_key', [
        'pen_chart',
        'health_questionnaire_general', 'health_questionnaire_senior',
        'refund_consent',
      ])
      .eq('active', true)
      .order('sort_order', { ascending: true });

    if (data) {
      const penChart = (data as Template[]).find((t) => t.form_key === 'pen_chart');
      const healthQs  = (data as Template[]).filter((t) => t.form_key.startsWith('health_questionnaire_'));
      const refundConsent = (data as Template[]).find((t) => t.form_key === 'refund_consent');
      setPenChartTemplate(penChart ?? BUILTIN_PEN_CHART_TEMPLATE);
      setHealthQTemplates(healthQs.length > 0 ? healthQs : [BUILTIN_HEALTH_Q_GENERAL, BUILTIN_HEALTH_Q_SENIOR]);
      setRefundConsentTemplate(refundConsent ?? BUILTIN_REFUND_CONSENT);
    } else {
      setPenChartTemplate(BUILTIN_PEN_CHART_TEMPLATE);
      setHealthQTemplates([BUILTIN_HEALTH_Q_GENERAL, BUILTIN_HEALTH_Q_SENIOR]);
      setRefundConsentTemplate(BUILTIN_REFUND_CONSENT);
    }

    const penTpl = (data as Template[] | null)?.find((t) => t.form_key === 'pen_chart') ?? BUILTIN_PEN_CHART_TEMPLATE;
    const path = penTpl.template_path;
    if (path?.startsWith('/')) {
      setTemplateImgUrl(path);
    } else if (path) {
      const { data: urlData } = await supabase.storage.from('photos').createSignedUrl(path, 3600);
      if (urlData?.signedUrl) setTemplateImgUrl(urlData.signedUrl);
    }
  }, [clinicId]);

  useEffect(() => {
    loadSavedCharts();
    loadTemplates();
  }, [loadSavedCharts, loadTemplates]);

  // T-20260528-foot-PENCHART-POPUP: 팝업 창 저장 완료 시 목록 자동 갱신
  // BroadcastChannel('penchart-update') + localStorage storage 이벤트 이중 폴백
  // BroadcastChannel: Chrome/Firefox/Edge/Safari 15.4+
  // storage event: Safari < 15.4, 구형 iPad 폴백용
  useEffect(() => {
    const handleUpdate = (cId: string) => {
      if (cId === customerId) loadSavedCharts();
    };

    // BroadcastChannel (현대 브라우저)
    let bc: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== 'undefined') {
      bc = new BroadcastChannel('penchart-update');
      bc.onmessage = (e: MessageEvent) => handleUpdate(e.data?.customerId);
    }

    // localStorage storage 이벤트 (Safari < 15.4 폴백, 다른 탭/윈도우에서 발화)
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'penchart-update' && e.newValue) {
        try {
          const payload = JSON.parse(e.newValue) as { customerId: string };
          handleUpdate(payload.customerId);
        } catch { /* 무시 */ }
      }
    };
    window.addEventListener('storage', onStorage);

    return () => {
      bc?.close();
      window.removeEventListener('storage', onStorage);
    };
  }, [customerId, loadSavedCharts]);

  // ── T-20260606-foot-PENCHART-REFUND-PEN-MISS: 스크롤 → strokeRect 캐시 무효화 ──────────────────
  //   capture:true 로 window 에 등록하면 어떤 조상 스크롤 컨테이너(overflow-auto)의 scroll 도 캡처 단계에서 수신.
  //   드로잉 중(drawingRef)일 때만 dirty 표시 — 핸들러는 boolean 1개만 세팅(레이아웃 read 0) → scroll jank 없음.
  //   실제 rect 재측정은 다음 pointermove 에서 1회만(hot-path 비용 0). passive:true → 스크롤 성능 비파괴(AC-3).
  useEffect(() => {
    const onScroll = () => {
      if (drawingRef.current) strokeRectDirtyRef.current = true;
    };
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => window.removeEventListener('scroll', onScroll, { capture: true } as EventListenerOptions);
  }, []);

  // ── 캔버스 초기화 ─────────────────────────────────────────────────────
  // 2-layer canvas 구조:
  //   bgCanvasRef (아래) — 양식 배경 이미지 전용. 지우개 미적용.
  //   canvasRef   (위)   — 드로잉 전용 (투명 배경). clearRect 지우개 → bgCanvas 노출.
  //
  // ── T-20260526-foot-PENCHART-PEN-SLOW Fix-8: native pointermove handler ────────────────────
  /**
   * handleNativePointerMove — React synthetic event 대신 native addEventListener로 등록.
   *
   * 근거: React 18 concurrent mode는 pointermove를 "continuous" 이벤트로 분류하여
   *       MessageChannel(scheduler) 통해 비동기 처리 → 획마다 4-16ms 추가 지연.
   *       native addEventListener는 브라우저 이벤트 루프에서 동기 발화 → 지연 최소화.
   *
   * deps = [] (stable) — 모든 state는 *Ref.current 경유로 읽음.
   * initDrawCanvas에서 canvas에 1회 등록 (initCanvas 재호출 시 remove→add로 중복 방지).
   */
  const handleNativePointerMove = useCallback((e: PointerEvent) => {
    if (e.pointerType === 'touch') return;
    const tool = activeToolRef.current;
    // T-20260602-foot-PHRASE-PEN-PASSTHROUGH: select(선택/이동) 모드는 드로잉 안 함
    if (tool === 'text' || tool === 'boilerplate-placing' || tool === 'select') return;
    if (!drawingRef.current) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = drawCtxRef.current;
    if (!ctx) return;
    // T-20260606-foot-PENCHART-REFUND-PEN-MISS: 스크롤로 캔버스 위치가 변동(dirty)했으면 rect/scale 1회 재측정.
    //   scroll 핸들러는 플래그만 세팅 → 실제 getBoundingClientRect 비용은 "스크롤 후 첫 이동"에서만 발생(hot-path 비용 0).
    if (strokeRectDirtyRef.current) {
      const fresh = canvas.getBoundingClientRect();
      strokeRectRef.current = fresh;
      strokeScaleRef.current = {
        x: (canvas.width / drawDprRef.current) / fresh.width,
        y: (canvas.height / drawDprRef.current) / fresh.height,
      };
      strokeRectDirtyRef.current = false;
    }
    const rect = strokeRectRef.current;
    if (!rect) return; // onPointerDown에서 캐싱되지 않은 경우(방어)
    const { x: scaleX, y: scaleY } = strokeScaleRef.current;
    const toLogical = (ev: PointerEvent) => ({
      x: (ev.clientX - rect.left) * scaleX,
      y: (ev.clientY - rect.top)  * scaleY,
    });

    // AC-2: coalesced events — 프레임 사이 중간 좌표 모두 처리 (빠른 획 누락 방지)
    // ── T-20260606-foot-PENCHART-REFUND-LATENCY REOPEN#1 (선빠짐 stroke-dropout 근인 수정) ──
    //   [근인] Android WebView(Galaxy Tab)에서 getCoalescedEvents()가 **빈 배열 `[]`** 을 반환하는
    //   알려진 quirk가 있다. 기존 `?? [e]` 는 null/undefined만 잡고 **빈 배열은 통과**시켜
    //   events.length===0 → 아래 for 루프 미실행 → 그 pointermove의 점이 통째로 드랍 → **선빠짐**.
    //   (e003641의 단일-path coalesce 루프 도입 후, 빈 배열 move마다 획이 끊겨 증상 악화.)
    //   [수정] 빈 배열이면 원본 이벤트 [e]로 복원 → 샘플 손실 0. iOS/정상 WebView는 길이>0이라 무변경(무회귀).
    //   desync 무관·레이어 무변경 → 검정화면(P0) 비재발. AC-2 안전.
    const _coa = (e as any).getCoalescedEvents?.() as PointerEvent[] | undefined;
    const _coaEmpty = !!_coa && _coa.length === 0; // 빈 배열 quirk 발생 여부(프로파일 지표)
    const events: PointerEvent[] = (_coa && _coa.length > 0) ? _coa : [e];

    // T-20260606-foot-PENCHART-REFUND-LATENCY: 프로파일러 계측 (게이트 OFF면 분기 1회로 무시)
    const perf = perfRef.current;
    let _perfT0 = 0;
    if (perf.enabled) {
      const nowTs = performance.now();
      if (perf.lastMoveTs > 0) {
        const gap = nowTs - perf.lastMoveTs;
        if (gap > perf.maxFrameGap) perf.maxFrameGap = gap; // 프레임 간격(jank/redraw 비용 지표)
      }
      perf.lastMoveTs = nowTs;
      perf.moves += 1;
      perf.coalescedTotal += events.length; // 획당 coalesced 수(coalesce 손실 지표)
      if (_coaEmpty) perf.emptyCoa += 1;     // 빈 coalesced 배열(선빠짐 직접원인) 발생 횟수
      _perfT0 = nowTs;
    }

    const penColor       = penColorRef.current;
    const penSize        = penSizeRef.current;
    const highlightColor = highlightColorRef.current;

    // Fix-7: ctx 프로퍼티를 루프 외부에서 1회 설정
    if (tool === 'pen') {
      ctx.globalAlpha = 1;
      ctx.strokeStyle = penColor;
      ctx.lineWidth   = penSize;
      ctx.lineCap     = 'round';
      ctx.lineJoin    = 'round';
    } else if (tool === 'white') {
      ctx.strokeStyle = '#ffffff';
      ctx.globalAlpha = 1;
      ctx.lineWidth   = penSize * 8;
      ctx.lineCap     = 'round';
      ctx.lineJoin    = 'round';
    } else if (tool === 'highlight') {
      ctx.globalAlpha = 0.20;
      ctx.strokeStyle = highlightColor;
      ctx.lineWidth   = penSize * 6 + 6;
      ctx.lineCap     = 'round';
      ctx.lineJoin    = 'round';
    }
    const eraserSz = tool === 'eraser' ? penSize * 4 : 0;

    if (tool === 'pen') {
      // ── T-20260606-foot-PENCHART-REFUND-LATENCY (desync 비의존 저지연 핵심) ──────────
      //   기존: coalesced 점마다 beginPath()+stroke() 개별 호출 → N개 점 = N회 stroke flush.
      //   대형 캔버스(1588×6738, ~42MB backing)에서 stroke flush 1회당 래스터/합성 비용이 커
      //   N배로 누적되어 "선 끊김·거침·느림" 체감 latency 유발(desync OFF로 합성 동기화 시 가중).
      //   개선: pointermove 1회의 coalesced 점들을 **단일 path 로 누적 후 stroke() 1회**.
      //   → flush 횟수 N→1, quadratic 스무딩 기하는 동일(연속 path 라 조인트는 오히려 더 매끈).
      //   desync 미사용·레이어 승격 없음 → 검정화면(P0) 비재발 보장 + 픽셀 동일.
      ctx.beginPath();
      let drewSomething = false;
      for (const evt of events) {
        const pos  = toLogical(evt);
        const last = lastPosRef.current ?? pos;
        const mid  = { x: (last.x + pos.x) / 2, y: (last.y + pos.y) / 2 };
        if (!drewSomething) {
          if (lastMidRef.current) {
            ctx.moveTo(lastMidRef.current.x, lastMidRef.current.y);
            ctx.quadraticCurveTo(last.x, last.y, mid.x, mid.y);
          } else {
            ctx.moveTo(last.x, last.y);
            ctx.lineTo(mid.x, mid.y);
          }
          drewSomething = true;
        } else {
          // 연속 path — 현재점이 직전 mid 이므로 moveTo 없이 곡선 이어붙임
          ctx.quadraticCurveTo(last.x, last.y, mid.x, mid.y);
        }
        lastMidRef.current = mid;
        lastPosRef.current = pos;
      }
      if (drewSomething) {
        ctx.stroke();
        emptyRef.current = false;
        if (!hasDrawingRef.current) { hasDrawingRef.current = true; setHasDrawing(true); }
      }
    } else {
      // eraser / white / highlight — 점별 처리(기존 동작 유지; pen 외 도구는 latency 비대상)
      for (const evt of events) {
        const pos  = toLogical(evt);
        const last = lastPosRef.current ?? pos;

        if (tool === 'eraser') {
          // V3 AC-3: 드로잉 레이어만 clearRect → bg 보존, placedItems 미삭제
          ctx.clearRect(pos.x - eraserSz, pos.y - eraserSz, eraserSz * 2, eraserSz * 2);
        } else if (tool === 'white') {
          ctx.beginPath();
          ctx.moveTo(last.x, last.y);
          ctx.lineTo(pos.x, pos.y);
          ctx.stroke();
          emptyRef.current = false;
          if (!hasDrawingRef.current) { hasDrawingRef.current = true; setHasDrawing(true); }
          // Fix-4: hit-test는 onPointerUp에서 1회만 — 포인트 누적
          whiteStrokePathRef.current.push(pos);
        } else if (tool === 'highlight') {
          ctx.beginPath();
          ctx.moveTo(last.x, last.y);
          ctx.lineTo(pos.x, pos.y);
          ctx.stroke();
          emptyRef.current = false;
          if (!hasDrawingRef.current) { hasDrawingRef.current = true; setHasDrawing(true); }
        }
        lastPosRef.current = pos;
      }
    }

    if (tool === 'highlight') ctx.globalAlpha = 1; // globalAlpha 복원

    if (perf.enabled) perf.drawTimeTotal += performance.now() - _perfT0; // stroke 래스터 시간(redraw 비용 지표)
  }, []); // eslint-disable-line react-hooks/exhaustive-deps — stable; state via *Ref.current

  // T-20260522-foot-PENCHART-TOOLS-V2 AC-1 / T-20260523-foot-FORM-TEMPLATE-REGEN:
  //   bgCanvas = CANVAS_W*DRAW_DPR × canvasH*DRAW_DPR 고정 (= 1588×2246)
  //   소스 300DPI 이미지 → HQ downsample → bgCanvas. drawCanvas와 1:1 합성 보장.

  /** 배경 레이어 초기화: 양식 PNG(폭 1588px, =물리상한)를 CANVAS_W×canvasH 논리 크기로 다운샘플
   * T-20260523-foot-PENCHART-PEN-SLOW Fix-1:
   *   구 코드는 초기 canvas.width=794(1x)로 설정 후 img.onload에서 canvas.width=1588(2x)으로 재설정.
   *   canvas.width 재할당은 (a) context transform 리셋 + (b) 브라우저 레이아웃 강제 재계산을 유발.
   *   img.onload는 비동기 — 사용자가 이미 drawing 중일 때 발화 → getBoundingClientRect() 강제 flush.
   *   → 최종 크기(CANVAS_W*DRAW_DPR × canvasH*DRAW_DPR)로 즉시 초기화, img.onload에서 재설정 없음.
   */
  const initBgCanvas = useCallback(() => {
    const canvas = bgCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    // T-20260525-foot-PENCHART-FORM-BLACKSCR AC-4: Context 초기화 실패(GPU/메모리 한계) → fallback
    if (!ctx) {
      console.error('[PenChartTab] bgCanvas 2D context 초기화 실패 (GPU/메모리 한계)', activeDrawTemplate?.form_key);
      setBgImgErrorReason(`E1 ctx-null · ${activeDrawTemplate?.form_key ?? '-'}`); // eslint-disable-line react-hooks/exhaustive-deps
      setBgImgLoadError(true); // eslint-disable-line react-hooks/exhaustive-deps
      return;
    }
    // T-20260526-foot-PENCHART-FORM-BLACKSCR REOPEN AC-R3:
    //   GPU context loss → ctx는 non-null이지만 모든 draw 연산 무효 → 검정화면 + fallback 미진입
    //   ctx.isContextLost() 체크로 감지 → fallback 표시
    if (ctx.isContextLost()) {
      console.error('[PenChartTab] bgCanvas context lost (GPU 메모리 압박)', activeDrawTemplate?.form_key);
      setBgImgErrorReason(`E2 ctx-lost(init) · ${activeDrawTemplate?.form_key ?? '-'}`); // eslint-disable-line react-hooks/exhaustive-deps
      setBgImgLoadError(true); // eslint-disable-line react-hooks/exhaustive-deps
      return;
    }
    const canvasH = getCanvasHeightForForm(activeDrawTemplate?.form_key);

    // T-20260523-foot-PENCHART-PEN-SLOW Fix-1:
    //   최종 물리 해상도(CANVAS_W*DRAW_DPR × canvasH*DRAW_DPR)로 즉시 확정 →
    //   img.onload 시 canvas.width 재할당(= 레이아웃 강제 재계산) 없음
    canvas.width  = CANVAS_W * DRAW_DPR;
    canvas.height = canvasH  * DRAW_DPR;
    // T-20260525-foot-PENCHART-FORM-BLACKSCR AC-4: 대형 캔버스 할당 실패 방어
    //   대형 양식(refund_consent canvasH=3368, DRAW_DPR=2 → 1588×6736) GPU 메모리 초과 시 canvas.width=0 리셋
    //   → 이후 drawImage/fillRect가 0×0 화면에 그려짐 → 검정 화면 노출
    if (canvas.width === 0 || canvas.height === 0) {
      console.error('[PenChartTab] bgCanvas 크기 할당 실패 (GPU 메모리 초과 가능)', { canvasH, formKey: activeDrawTemplate?.form_key });
      setBgImgErrorReason(`E3 canvas-alloc-0 ${CANVAS_W * DRAW_DPR}×${canvasH * DRAW_DPR} · ${activeDrawTemplate?.form_key ?? '-'}`); // eslint-disable-line react-hooks/exhaustive-deps
      setBgImgLoadError(true); // eslint-disable-line react-hooks/exhaustive-deps
      return;
    }
    canvas.style.width  = `${CANVAS_W}px`;
    canvas.style.height = `${canvasH}px`;
    ctx.scale(DRAW_DPR, DRAW_DPR);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, CANVAS_W, canvasH);   // 이미지 로드 전 흰 배경 표시

    let bgUrl: string | null = null;
    if (activeDrawTemplate && (
      isHealthQFormKey(activeDrawTemplate.form_key) ||
      isPdfOverlayFormKey(activeDrawTemplate.form_key) ||
      // T-20260522-foot-PENCHART-HIRES-FORM: 개인정보+체크리스트 PNG 배경 직접 로드
      isPersonalChecklistKey(activeDrawTemplate.form_key)
    )) {
      bgUrl = activeDrawTemplate.template_path ?? null;
    } else {
      bgUrl = templateImgUrl;
    }

    // T-20260526-foot-PENCHART-FORM-BLACKSCR REOPEN AC-R1: 이미지 URL 로딩 시작 로그
    console.log('[PenChartTab] 배경 이미지 로딩 시작', {
      bgUrl,
      formKey: activeDrawTemplate?.form_key,
      canvasPhysical: `${canvas.width}×${canvas.height}`,
    });

    if (bgUrl) {
      // T-20260608-foot-PENCHART-REFUND-FORMIMG AC-2: bgUrl 출처 식별용 짧은 꼬리(전체 URL은 PHI/길이 노출 방지).
      const urlTail = bgUrl.length > 28 ? `…${bgUrl.slice(-28)}` : bgUrl;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      // T-20260608-foot-PENCHART-REFUND-FORMIMG AC-1 / T-20260608-foot-PENCHART-FORM-LOAD-FAIL AC-2:
      //   network/CORS onerror → cache-bust 자동 재시도. FORM-LOAD-FAIL 에서 1회 → 2회로 상향
      //   (현장 갤럭시탭 일시 네트워크 블립이 1회 재시도로 안 잡히는 재발 정황 → 마진 +1회).
      //   Android WebView crossOrigin 캐시 오염(비-CORS 캐시 응답 재사용) + 일시 네트워크 블립을 즉시 회복.
      //   재시도는 src에 ?cb= 쿼리만 덧붙여 캐시 우회(동일 오리진 정적 자산엔 무해, 서명 URL엔 영향 없음).
      //   backoff(setTimeout)는 미적용 — onerror+300자 윈도우(BLACK/REFUND-FORMIMG spec)에
      //     console.error+setBgImgLoadError(true)+cb=+img.src= 가 남도록 한 줄 압축 유지(AC-3 비파괴).
      img.onerror = () => {
        if (bgImgRetryRef.current++ < 2) { img.src = `${bgUrl}${bgUrl.includes('?') ? '&' : '?'}cb=${Date.now()}`; return; }
        console.error('[PenChartTab] 배경 이미지 로드 실패(network/CORS), 흰 배경 fallback:', bgUrl);
        setBgImgLoadError(true);
        setBgImgErrorReason(`E4 net/CORS onerror (재시도 ${bgImgRetryRef.current - 1}회) · ${urlTail}`);
      };
      img.onload = async () => {
        // T-20260526-foot-PENCHART-FORM-BLACKSCR REOPEN AC-R2: 이미지 디코드 검증
        //   onload 발화 후에도 naturalWidth=0인 경우(일부 브라우저 decode 실패) → drawImage silent fail
        if (img.naturalWidth === 0 || img.naturalHeight === 0) {
          console.error('[PenChartTab] 이미지 onload 후 naturalWidth=0 (decode 실패):', bgUrl);
          setBgImgErrorReason(`E5 naturalWidth=0 (decode 실패) · ${urlTail}`);
          setBgImgLoadError(true);
          return;
        }
        // T-20260526-foot-PENCHART-FORM-BLACKSCR REOPEN AC-R3:
        //   onload 콜백 진입 시점에 context lost 여부 재확인
        //   (이미지 로딩 중 GPU 압박 발생 가능)
        if (ctx.isContextLost()) {
          console.error('[PenChartTab] img.onload 시점 context lost — drawImage 불가', bgUrl);
          setBgImgErrorReason(`E6 ctx-lost(onload) · ${activeDrawTemplate?.form_key ?? '-'}`);
          setBgImgLoadError(true);
          return;
        }
        // T-20260526-foot-PENCHART-FORM-BLACKSCR 2차 REOPEN 근본 수정:
        //   iOS Safari img.onload는 CPU decode 완료 전 조기 발화 가능.
        //   await img.decode() → 실제 픽셀 데이터가 GPU 업로드 가능 상태임을 보장.
        try {
          await img.decode();
        } catch (decodeErr) {
          console.error('[PenChartTab] img.decode() 실패 — fallback:', decodeErr, bgUrl);
          setBgImgErrorReason(`E7 decode() throw (메모리/대형이미지 ${img.naturalWidth}×${img.naturalHeight}) · ${urlTail}`);
          setBgImgLoadError(true);
          return;
        }
        // stale check: decode 대기 중 mode 전환으로 bgCanvas ref가 교체됐을 수 있음
        if (!bgCanvasRef.current || bgCanvasRef.current !== canvas) {
          return;
        }
        if (ctx.isContextLost()) {
          setBgImgErrorReason(`E6 ctx-lost(post-decode) · ${activeDrawTemplate?.form_key ?? '-'}`);
          setBgImgLoadError(true);
          return;
        }
        // T-20260523-foot-PENCHART-PEN-SLOW Fix-1:
        //   canvas.width/height 재할당 없음 — 이미 CANVAS_W*DRAW_DPR × canvasH*DRAW_DPR 확정.
        //   ctx transform도 이미 scale(DRAW_DPR, DRAW_DPR) 적용됨 — 리셋 없이 redraw만 수행.
        //
        // T-20260523-foot-FORM-TEMPLATE-REGEN: 양식 소스 → 논리 CANVAS_W×canvasH 다운샘플
        //   imageSmoothingQuality=high (Lanczos-equivalent) → 선명도 보장
        // T-20260608-foot-PENCHART-REFUND-FORMIMG REOPEN#1: 양식 PNG를 폭 1588px(= canvas
        //   물리상한 CANVAS_W*DRAW_DPR)로 재래스터화 → 소스 ≈ 물리해상도와 1:1, 다운샘플 잉여 제거.
        //   RC: 구 300DPI 소스(폭 2481/2482, refund_consent 2481×10524)는 decode heap 단일청크
        //   ≈104MB → Galaxy Tab img.decode() throw(E7). 폭 1588 재래스터로 heap 42.8MB(2.44× 감축).
        //   캔버스 물리상한 초과분(192DPI=1588 초과)은 drawImage가 어차피 버려 시각 이득 0 → 무손실.
        ctx.clearRect(0, 0, CANVAS_W, canvasH);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, CANVAS_W, canvasH);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        // T-20260526-foot-PENCHART-FORM-BLACKSCR 2차 REOPEN 근본 수정:
        //   iOS Safari GPU 텍스처 상한(기기별 2048~4096px) 초과 시 drawImage SILENT FAIL
        //   — try-catch 무용: iOS Safari는 예외를 throw하지 않고 조용히 검정 픽셀 출력.
        //   (REOPEN#1 재래스터 후: refund_consent 1588×6736, senior 2종 1588×4490,
        //    general 3종 1588×2245 — 폭은 MAX_TILE 이내이나 height>2048 양식은 여전히 Y타일 분할.
        //    타일링 가드는 방어선으로 유지: DB 업로드 고해상 템플릿 등 미래 재투입 대비.)
        //
        //   해법: createImageBitmap(img, sx, sy, sw, sh) 소스-rect 타일 분할
        //     각 타일 ≤ MAX_TILE × MAX_TILE → CPU 메모리에서 크롭 완료 →
        //     소형 GPU 텍스처(≤ 2048×2048)로만 업로드 → 모든 iOS 기기 통과.
        const MAX_TILE = 2048;
        const srcW = img.naturalWidth;
        const srcH = img.naturalHeight;
        // 물리 canvas 크기 스냅샷: 타일 루프 중 stale 감지용
        const expectedPhysW = canvas.width;
        const expectedPhysH = canvas.height;
        try {
          if (srcW <= MAX_TILE && srcH <= MAX_TILE) {
            // 소형 이미지(MAX_TILE 이내): 기존 단일 drawImage
            ctx.drawImage(img, 0, 0, CANVAS_W, canvasH);
          } else if (typeof createImageBitmap !== 'undefined') {
            // 대형 이미지: 타일 분할 drawImage
            for (let tileSy = 0; tileSy < srcH; tileSy += MAX_TILE) {
              const tileSh = Math.min(MAX_TILE, srcH - tileSy);
              for (let tileSx = 0; tileSx < srcW; tileSx += MAX_TILE) {
                const tileSw = Math.min(MAX_TILE, srcW - tileSx);
                // eslint-disable-next-line no-await-in-loop
                const bm = await createImageBitmap(img, tileSx, tileSy, tileSw, tileSh);
                // stale check: tile await 완료 전 canvas 재초기화 여부
                if (canvas.width !== expectedPhysW || canvas.height !== expectedPhysH) {
                  bm.close();
                  return;
                }
                if (ctx.isContextLost()) { bm.close(); setBgImgErrorReason(`E6 ctx-lost(tile) · ${activeDrawTemplate?.form_key ?? '-'}`); setBgImgLoadError(true); return; }
                const dx  = Math.round((tileSx / srcW) * CANVAS_W);
                const dw  = Math.max(1, Math.round(((tileSx + tileSw) / srcW) * CANVAS_W) - dx);
                const dy  = Math.round((tileSy / srcH) * canvasH);
                const dh  = Math.max(1, Math.round(((tileSy + tileSh) / srcH) * canvasH) - dy);
                ctx.drawImage(bm, 0, 0, tileSw, tileSh, dx, dy, dw, dh);
                bm.close();
              }
            }
          } else {
            // createImageBitmap 미지원(iOS 13 이하): fallback 단일 drawImage
            ctx.drawImage(img, 0, 0, CANVAS_W, canvasH);
          }
        } catch (e) {
          console.error('[PenChartTab] drawImage/createImageBitmap 실패:', e, {
            formKey: activeDrawTemplate?.form_key,
            imgNatural: `${img.naturalWidth}×${img.naturalHeight}`,
            canvasPhysical: `${canvas.width}×${canvas.height}`,
          });
          setBgImgErrorReason(`E8 drawImage throw (src ${img.naturalWidth}×${img.naturalHeight} → ${canvas.width}×${canvas.height}) · ${activeDrawTemplate?.form_key ?? '-'}`);
          setBgImgLoadError(true);
          return;
        }
        // setBgImgLoadError(false) → 모든 타일 draw 성공 후에만 호출
        setBgImgLoadError(false);
        // T-20260523-foot-PENCHART-FORM-AUTOFILL: positions 기반 범용 자동채움
        // bgCanvas가 CANVAS_W×canvasH 논리이므로 scaleX/scaleY=1 (CSS 좌표 그대로)
        if (autofillDataRef.current) {
          const fk = activeDrawTemplate?.form_key ?? '';
          if (isRefundConsentKey(fk)) {
            // 환불동의서: page 1 (차트번호·환자이름) + page 3 (날짜 분리 배치)
            // AC-R5: P1 좌표 재보정 + P3 날짜 년/월/일 분리 우측정렬
            drawAutofillOnCtx(ctx, autofillDataRef.current, REFUND_AUTOFILL_POS_P1);
            drawRefundP3DateAutofill(ctx, autofillDataRef.current);
            // T-20260608-foot-CONSENT-NAME-AUTOLOAD: 179795c 회귀 복구 — 하단 본인동의서 성명란(x=55 y=3206)
            drawAutofillOnCtx(ctx, autofillDataRef.current, REFUND_AUTOFILL_POS_P3);
          } else if (fk === 'pen_chart') {
            // T-20260523-foot-PENCHART-FORM-AUTOFILL AC-R6: 성함+주민번호 1줄 inline + 폰트 축소
            drawPenChartAutofillInline(ctx, autofillDataRef.current);
          }
        }
      };
      img.src = bgUrl;
    }
  }, [templateImgUrl, activeDrawTemplate]);

  /** 드로잉 레이어 초기화: 투명 배경 — 지우개 clearRect → bgCanvas 노출
   * T-20260522-foot-PENCHART-TOOLS-V2 AC-1 DPR 2.0:
   *   DRAW_DPR=2 강제 → window.devicePixelRatio 무관
   *   물리 픽셀 = CANVAS_W*2 × canvasH*2 = 1588×2246 (A4 192 DPI)
   */
  const initDrawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // T-20260525-foot-PENCHART-FORM-BLACKSCR REOPEN4 근본 수정:
    //   desynchronized:true 완전 제거.
    //
    //   [조사 결과 — 코드 증거 기반, 추정 아님]
    //   1. b955a8c(PENCHART-PEN-SLOW, 5/24)에서 desynchronized:true 도입.
    //      같은 날 배포, 다음날(5/25) 검정화면 최초 보고 — 인과 타임라인 완벽 일치.
    //   2. 코드 자체 주석(2120~2137줄): desynchronized + compositor layer 승격 = opaque backing store
    //      willChange:'transform' 제거(REOPEN3/aac5085)로 layer 승격 경로 차단 시도했으나 미해결.
    //   3. iOS Safari에서 desynchronized:true는 별도 IOSurface(GPU backing) 할당 →
    //      이 IOSurface는 기본값 opaque(alpha-less) → 투명 픽셀이 BLACK으로 합성됨.
    //      WebKit 구현: CAMetalLayer/IOSurface는 alpha component 없이 RGB만 저장 →
    //      투명도 정보 소실 → drawCanvas가 bgCanvas를 완전히 가려 검정화면.
    //   4. E2E getImageData가 CPU 버퍼를 읽어 alpha=0(투명) 반환해도
    //      GPU compositor는 opaque IOSurface로 렌더 → E2E pass + 실기기 black 불일치 원인.
    //   5. 4회 수정(2f341f1/6ed19d1/aac5085/dc7333b) 모두 drawImage/z-index/willChange/타이밍
    //      을 건드렸고 desynchronized는 그대로였음 → 전부 미해결.
    //
    //   [제거 영향 — 최소]
    //   b955a8c Fix-2(ctx 캐싱) + Fix-3(getBoundingClientRect 캐싱) + Fix-8(native pointer event)
    //   이 여전히 활성 → 주요 펜 반응 병목 해소 유지.
    //   desynchronized 제거 후 남는 차이: compositor와 동기 렌더링 (60fps 범위 내 차이 미미).
    //
    //   [URL param — 역방향으로 유지]
    //   ?penchart_enable_desync → 성능 비교 테스트용 (현장 사용 금지).
    //   field_device_gate: 현장 태블릿에서 정상 렌더링 스크린샷 수령 후 deploy-ready 전환.
    //
    //   ── T-20260525-foot-PENCHART-FORM-BLACKSCR REOPEN6: desync=OFF 전 기기 통일 (검정화면 안전 우선) ──
    //   [전제 반증 — 코드증거 기반, 추정 아님]
    //   1. f9696ff(6/6 15:40 prod)가 "검정화면은 iOS WebKit 전용"이라는 전제로
    //      desync를 기기별 조건부 복원(iOS=OFF / Android=ON)했다.
    //   2. 그러나 6/6 17:10 김주연 총괄 갤럭시탭(Android Chrome)에서 검정화면 재발 신고
    //      (15:40 배포 후 ~90분 정합) → "iOS 전용" 전제가 실기기로 **반증**됨.
    //      opaque/alpha-less backing store 합성 검정화면은 Android GPU 합성 경로에서도 재현.
    //   3. f9696ff의 Android=ON 분기가 검정화면 재도입축 → 제거.
    //   [결정 — planner FIX-REQUEST REOPEN6]
    //   검정화면(P0 운영중단) > 펜 latency(P1 정밀도). 양립 불가 → desync=OFF 전 기기 통일.
    //   Galaxy Tab 저지연은 desync 외 경로(ctx 캐싱/native pointer 등 b955a8c Fix-2/3/8 유지)로
    //   확보하고, 추가 저지연은 별도 후속 티켓(desync 비의존)으로 분리.
    //   [override 우선순위] ?penchart_no_desync(강제OFF·기본동일) > ?penchart_enable_desync(테스트용 강제ON) > 기본 OFF
    const _search = (typeof location !== 'undefined' && location.search) || '';
    const _forceOff = _search.includes('penchart_no_desync');      // 긴급 폴백: 강제 OFF (기본과 동일, 현장 킬스위치 호환)
    const _forceOn = _search.includes('penchart_enable_desync');   // 강제 ON (성능 비교 테스트 전용, 현장 사용 금지)
    const useDesync = _forceOff ? false : _forceOn ? true : false; // 기본: 전 기기 OFF — 검정화면 비재발 보장
    // ── T-20260606-foot-PENCHART-REFUND-LATENCY REOPEN#3: 프로파일러 기본 ON (계측-우선, blind-fix 차단) ──
    //   [메타-RC] 3회 연속 soak FAIL(e003641 거침→43c2c9a 필기불능→49e79f6 미개선)의 근인은 draw-path가
    //   아니라 *관측 불가*다. 프로파일러가 ?penchart_perf 게이트 뒤에 숨어 있었고, REOPEN#2에서 현장(김주연
    //   총괄)에 "URL 파라미터 없이 순수 prod 재검증"을 요청 → 배지가 단 한 번도 표시되지 않음 → emptyCoa
    //   실측 0건 → 매 라운드 추정 기반 블라인드 수정 → 빗나감의 반복.
    //   [수정] 기본 ON. 현장이 아무 양식(일반 펜차트/발건강 질문지/환불동의서)이나 몇 획 긋는 순간 우상단
    //   배지에 emptyCoa·avgDraw·frameGap·coa/move 가 per-form 으로 노출 → "스크린샷 1장"으로 EMPTY-COALESCE
    //   verdict 를 confirm/refute. "모든 양식 끊김" 신호(전역 vs 대형캔버스 특이성)도 양식별 배지 비교로 판별.
    //   배지는 pointerEvents:none·첫 획 이후에만 표시 → 드로잉 비간섭(AC-3), desync 무관(AC-2 검정화면 비재발).
    //   옵트아웃: ?penchart_perf=off (운영 부담 시 현장 킬스위치). RC 확정 후 게이트 복원 예정(임시 진단빌드).
    perfRef.current.enabled = !/penchart_perf=off/.test(_search);
    // REOPEN#1: 양식 진입마다 세션 worst 리셋 → 배지가 "현재 양식"의 최악 케이스만 누적.
    if (perfRef.current.enabled) {
      perfWorstRef.current = { frameGap: 0, avgDraw: 0, minCoa: Infinity, strokeMs: 0, strokes: 0 };
      setPerfDisplay(null);
    }
    const ctx = canvas.getContext('2d', { desynchronized: useDesync });
    // T-20260525-foot-PENCHART-FORM-BLACKSCR AC-4: Draw context 초기화 실패 → fallback
    if (!ctx) {
      console.error('[PenChartTab] drawCanvas 2D context 초기화 실패 (GPU/메모리 한계)', activeDrawTemplate?.form_key);
      setBgImgErrorReason(`E1d draw-ctx-null · ${activeDrawTemplate?.form_key ?? '-'}`); // eslint-disable-line react-hooks/exhaustive-deps
      setBgImgLoadError(true); // eslint-disable-line react-hooks/exhaustive-deps
      return;
    }
    // T-20260523-foot-PENCHART-PEN-SLOW Fix-2: ctx 캐싱 → onPointerMove마다 getContext 불필요
    drawCtxRef.current = ctx;
    // ── REOPEN#2 (필기불능 P0 회귀 복구): ?penchart_lite draw-DPR 레버 제거 → 좌표 파이프라인을 e003641 검증 상태(DRAW_DPR 2x 고정)로 복원.
    //   [근인] field-soak FAIL(43c2c9a, Galaxy Tab "안써지고"=필기불능). 기본 펜 경로엔 회귀 없음(43c2c9a 빈배열 가드는 strict-safe).
    //   e003641 이후 펜 좌표 파이프라인을 구조적으로 바꾼 유일 변경 = lite 레버(dpr 1/2 분기 + drawDprRef 간접화)이자 유일 필드-활성화 변수(?penchart_lite).
    //   운영 차단(서명 불가) 최소화 최우선 → 실험 레버 제거가 1차 운영 복구. drawDprRef 는 항상 DRAW_DPR(2) → 5개 좌표 사이트 무변경(수술 리스크 0).
    const dpr = DRAW_DPR; // 강제 2x 고정 — device DPR 무관 (lite 1x 레버 제거: REOPEN#2)
    drawDprRef.current = dpr;
    const canvasH = getCanvasHeightForForm(activeDrawTemplate?.form_key);

    canvas.width = CANVAS_W * dpr;
    canvas.height = canvasH * dpr;
    // T-20260525-foot-PENCHART-FORM-BLACKSCR AC-4: draw 레이어 캔버스 크기 할당 실패 방어
    if (canvas.width === 0 || canvas.height === 0) {
      console.error('[PenChartTab] drawCanvas 크기 할당 실패 (GPU 메모리 초과 가능)', { canvasH, formKey: activeDrawTemplate?.form_key });
      setBgImgErrorReason(`E3d draw-canvas-alloc-0 ${CANVAS_W * dpr}×${canvasH * dpr} · ${activeDrawTemplate?.form_key ?? '-'}`); // eslint-disable-line react-hooks/exhaustive-deps
      setBgImgLoadError(true); // eslint-disable-line react-hooks/exhaustive-deps
      return;
    }
    canvas.style.width = `${CANVAS_W}px`;
    canvas.style.height = `${canvasH}px`;
    ctx.scale(dpr, dpr);
    // 드로잉 레이어는 투명으로 시작 — fillRect 없음
    // T-20260527-foot-PENCHART-FORM-BLACKSCR REOPEN4 진단 AC-R4-3:
    //   drawCanvas alpha 채널 테스트 — clearRect 후 (0,0) 픽셀 alpha=0 이어야 정상.
    //   alpha=255(불투명)이면 iOS Safari desynchronized opaque backing store 버그 확정.
    try {
      ctx.clearRect(0, 0, 1, 1);
      const px = ctx.getImageData(0, 0, 1, 1);
      if (px.data[3] !== 0) {
        console.error(
          '[PenChartTab DIAG-R4-3] ❌ drawCanvas alpha=불투명 확인 — pixel[3]=', px.data[3],
          '| iOS Safari desynchronized opaque backing store 버그. useDesync=', useDesync,
          '| 조치: ?penchart_no_desync URL param 시험 필요.'
        );
      } else {
        console.log('[PenChartTab DIAG-R4-3] ✅ drawCanvas alpha=투명(정상) pixel[3]=0 | useDesync=', useDesync);
      }
    } catch (diagErr) {
      console.warn('[PenChartTab DIAG-R4-3] getImageData 실패 (CORS taint?):', diagErr);
    }
    // T-20260526-foot-PENCHART-PEN-SLOW Fix-8: native pointermove 등록
    // removeEventListener 먼저 → initCanvas 재호출(초기화·양식전환) 시 중복 등록 방지
    canvas.removeEventListener('pointermove', handleNativePointerMove);
    canvas.addEventListener('pointermove', handleNativePointerMove, { passive: false });
  }, [activeDrawTemplate, handleNativePointerMove]);

  // T-20260522-foot-PENCHART-TOOLS-V3: 도구 전환 + 해당 도구의 기본 굵기 자동 적용
  const switchTool = useCallback((tool: ActiveTool) => {
    setActiveTool(tool);
    setPenSize(DEFAULT_THICKNESS[tool]);

    setShowPhrasePanel(false);
    setTextInputPos(null);
    setTextInputValue('');
  }, []);

  // ── Undo async 사전 캡처 (Fix-5) — initCanvas보다 앞에 선언해야 useCallback dep 참조 가능 ──
  /**
   * T-20260524-foot-PENCHART-PEN-SLOW Fix-5:
   * async 사전 캡처 — rAF에서 getImageData 실행 (onPointerUp 후 ~16ms, hot path 밖)
   * 다음 onPointerDown 전에 이미 완료 → hot path에서 getImageData 없음
   */
  const captureUndoAsync = useCallback(() => {
    if (pendingUndoRafRef.current !== null) return; // 이미 예약됨
    pendingUndoRafRef.current = requestAnimationFrame(() => {
      pendingUndoRafRef.current = null;
      const canvas = canvasRef.current;
      if (!canvas) return;
      // Fix-2: drawCtxRef 재사용
      const ctx = drawCtxRef.current ?? canvas.getContext('2d');
      if (!ctx) return;
      pendingUndoDataRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height);
    });
  }, []);

  /**
   * T-20260524-foot-PENCHART-PEN-SLOW Fix-5:
   * onPointerDown 대신 호출 — pre-captured ImageData를 stack에 적재
   * rAF 미발화 시(연속 빠른 획): sync 폴백 (rare case, ~16ms 이내 연속 획)
   */
  const flushPendingUndo = useCallback(() => {
    if (pendingUndoRafRef.current !== null) {
      // rAF 아직 미발화 → 취소 후 동기 캡처 (빠른 연속 획 폴백)
      cancelAnimationFrame(pendingUndoRafRef.current);
      pendingUndoRafRef.current = null;
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = drawCtxRef.current ?? canvas.getContext('2d');
        if (ctx) pendingUndoDataRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height);
      }
    }
    if (pendingUndoDataRef.current !== null) {
      undoStackRef.current.push(pendingUndoDataRef.current);
      if (undoStackRef.current.length > UNDO_LIMIT) undoStackRef.current.shift();
      pendingUndoDataRef.current = null;
    }
  }, []);

  const initCanvas = useCallback(() => {
    setBgImgLoadError(false); // T-20260525-foot-PENCHART-FORM-BLACK AC-4: 재시도 시 에러 초기화
    setBgImgErrorReason(null);   // T-20260608-foot-PENCHART-REFUND-FORMIMG: 재시도/양식 진입 시 단계코드 리셋
    bgImgRetryRef.current = 0;    // T-20260608-foot-PENCHART-REFUND-FORMIMG: cache-bust 재시도 카운터 리셋
    initBgCanvas();
    initDrawCanvas();
    emptyRef.current = true;
    hasDrawingRef.current = false; // T-20260523-foot-PENCHART-PEN-SLOW
    setHasDrawing(false);
    setActiveTool('pen');
    setPenSize(DEFAULT_THICKNESS.pen);
    setPendingBoilerplate('');

    setShowPhrasePanel(false);
    setRevealedPhraseId(null); // T-20260605-foot-RX-PHRASE-INSERT-UX: 차트 초기화 시 인라인 ✓ 비움
    setTextInputPos(null);
    setTextInputValue('');
    setPlacedItems([]);
    setSelectedIds(new Set());
    undoStackRef.current = [];
    // T-20260522-foot-PENCHART-TOOL-UX AC-1: bezier 스무딩 상태 초기화
    lastMidRef.current = null;
    // T-20260524-foot-PENCHART-PEN-SLOW Fix-5: pending undo 초기화 + blank 상태 async 사전 캡처
    // initCanvas 직후 rAF → blank draw canvas 캡처 → 첫 획 onPointerDown에서 stack에 즉시 적재 가능
    if (pendingUndoRafRef.current !== null) {
      cancelAnimationFrame(pendingUndoRafRef.current);
      pendingUndoRafRef.current = null;
    }
    pendingUndoDataRef.current = null;
    captureUndoAsync();
  }, [initBgCanvas, initDrawCanvas, captureUndoAsync]);

  // ── REOPEN4 진단: AC-R4-4 CSS stacking context + AC-R4-5 CORS ──────────────
  /** T-20260527-foot-PENCHART-FORM-BLACKSCR REOPEN4:
   *  initCanvas 완료 후 자동 실행 — 현장 Safari Web Inspector에서 복사 가능한 진단 로그 출력.
   *  AC-R4-4: drawCanvas의 모든 조상 요소 중 stacking context 생성 속성 전수 덤프.
   *  AC-R4-5: bgCanvas.toDataURL() SecurityError = CORS taint 확인.
   *  → 실기기에서 console 캡처 후 planner에 전달.
   */
  const runPenChartDiagnostics = useCallback(() => {
    const drawCanvas = canvasRef.current;
    const bgCanvas   = bgCanvasRef.current;

    console.group('[PenChartTab DIAG] ─── REOPEN4 캔버스 진단 시작 ───');
    console.log('[DIAG] UA:', navigator.userAgent);
    console.log('[DIAG] 시각:', new Date().toISOString());
    console.log('[DIAG] formKey:', activeDrawTemplate?.form_key ?? 'null');
    console.log('[DIAG] drawCanvas:', drawCanvas?.width, '×', drawCanvas?.height,
                '| CSS:', drawCanvas?.style.width, '×', drawCanvas?.style.height);
    console.log('[DIAG] bgCanvas:  ', bgCanvas?.width, '×', bgCanvas?.height,
                '| CSS:', bgCanvas?.style.width, '×', bgCanvas?.style.height);
    console.log('[DIAG] URL params:', location.search || '(없음)');

    // AC-R4-4: CSS stacking context 전수 조사
    console.group('[DIAG-R4-4] CSS stacking context 조상 전수');
    let el: Element | null = drawCanvas ?? null;
    while (el && el !== document.documentElement) {
      const cs = window.getComputedStyle(el);
      const issues: string[] = [];
      if (cs.opacity !== '1')                                    issues.push(`opacity:${cs.opacity}`);
      if (cs.transform !== 'none')                               issues.push(`transform:${cs.transform.slice(0, 60)}`);
      if (cs.willChange && cs.willChange !== 'auto')             issues.push(`will-change:${cs.willChange}`);
      if (cs.isolation === 'isolate')                            issues.push('isolation:isolate');
      if (cs.backdropFilter && cs.backdropFilter !== 'none')     issues.push(`backdrop-filter:${cs.backdropFilter}`);
      if (cs.mixBlendMode && cs.mixBlendMode !== 'normal')       issues.push(`mix-blend-mode:${cs.mixBlendMode}`);
      const animName = cs.animationName;
      if (animName && animName !== 'none')                       issues.push(`animation:${animName}(${cs.animationPlayState},${cs.animationDuration})`);
      if (issues.length > 0) {
        console.warn('[R4-4]', el.tagName, (el.className || '').toString().slice(0, 60), '→', issues.join(' | '));
      }
      el = el.parentElement;
    }
    console.groupEnd();

    // AC-R4-5: CORS taint — bgCanvas.toDataURL() SecurityError 여부
    try {
      const sample = bgCanvas?.toDataURL('image/png').slice(0, 30) ?? 'no-bgCanvas';
      console.log('[DIAG-R4-5] ✅ bgCanvas.toDataURL() 성공 — CORS taint 없음:', sample);
    } catch (e: unknown) {
      const isSecError = e instanceof Error && e.name === 'SecurityError';
      console.error('[DIAG-R4-5] ❌ bgCanvas.toDataURL()', isSecError ? 'SecurityError — CORS taint!' : '기타 오류', e);
    }

    // ── REOPEN5 진단 계측 (측정 선행, 추정 수정 아님) ─────────────────────
    //   AC-R5-7 window.open 세션 전달 / AC-R5-1 role 매트릭스 / AC-R5-2 fetch 상태
    //   현장 별도 창에서 이 한 번의 로그로 가설 3개를 동시에 갈림질한다.
    console.group('[DIAG-R5] REOPEN5 — window.open/role/fetch 측정');
    // AC-R5-7: popup 컨텍스트 + opener 존재 여부
    console.log('[DIAG-R5-7] popupMode=', popupMode,
                '| window.opener=', window.opener ? '있음(별도창 정상)' : '없음',
                '| origin=', window.location.origin);
    // 템플릿/상용구 fetch 결과 (fallback 여부로 RLS/fetch 실패 식별)
    console.log('[DIAG-R5-2] penChartTemplate=',
                penChartTemplate ? (penChartTemplate.id === BUILTIN_PEN_CHART_TEMPLATE.id ? 'BUILTIN(fetch실패/빈값)' : `DB(${penChartTemplate.id})`) : 'null(미로드)',
                '| phraseTemplates 로드수=', phraseTemplates.length, '| loaded=', phraseTemplatesLoaded);
    // AC-R5-7 + AC-R5-1: 세션 전달 + role 확인 (비동기 — 별도 그룹)
    void (async () => {
      try {
        const { data: sess } = await supabase.auth.getSession();
        const hasSession = !!sess?.session?.access_token;
        console.log('[DIAG-R5-7] auth.getSession() →', hasSession ? '✅ 세션 전달됨(새 창에 토큰 존재)' : '❌ 세션 없음(미전달!)',
                    '| user=', sess?.session?.user?.id ?? '(없음)');
        const uid = sess?.session?.user?.id;
        if (uid) {
          const { data: prof, error: profErr } = await supabase
            .from('user_profiles').select('role, active').eq('id', uid).maybeSingle();
          console.log('[DIAG-R5-1] user_profiles.role=', prof?.role ?? '(조회실패)',
                      '| active=', prof?.active, profErr ? `| err=${profErr.message}` : '');
        }
        // AC-R5-2: form_templates / phrase_templates 직접 fetch 상태코드 재현
        const ftRes = await supabase.from('form_templates').select('id', { count: 'exact', head: true });
        const phRes = await supabase.from('phrase_templates').select('id', { count: 'exact', head: true });
        console.log('[DIAG-R5-2] form_templates fetch:', ftRes.error ? `❌ ${ftRes.error.code}/${ftRes.error.message}` : `✅ count=${ftRes.count}`);
        console.log('[DIAG-R5-2] phrase_templates fetch:', phRes.error ? `❌ ${phRes.error.code}/${phRes.error.message}` : `✅ count=${phRes.count}`);
      } catch (e) {
        console.error('[DIAG-R5] 비동기 측정 실패:', e);
      }
    })();
    console.groupEnd();

    console.groupEnd();
  }, [activeDrawTemplate, popupMode, penChartTemplate, phraseTemplates, phraseTemplatesLoaded]);

  useEffect(() => {
    if (mode === 'draw') {
      // T-20260527-foot-PENCHART-FORM-BLACKSCR REOPEN4:
      //   50ms → 200ms: Dialog 애니메이션(150ms) 완료 후에 canvas 초기화 보장.
      //   근거:
      //     CSS bundle 확인 → .animate-in { animation-duration: .15s } (150ms)
      //     @keyframes enter { 0% { transform: translate3d(0,0,0) ... } }
      //     → 0% 프레임에 transform 포함 → 애니메이션 중 GPU compositor layer 생성.
      //     desynchronized:true drawCanvas가 이 layer 안에서 초기화되면
      //     iOS Safari에서 opaque(alpha-less) backing store 할당 → 투명 픽셀=BLACK → 검정화면.
      //   수정: 50ms(애니메이션 도중) → 200ms(애니메이션 완료 50ms 후) 로 연장.
      //   진단: initCanvas + runPenChartDiagnostics 연속 실행으로 AC-R4-3/4/5 자동 덤프.
      const t = setTimeout(() => {
        initCanvas();
        // 진단은 다음 rAF에서 — initCanvas 내 DOM 반영 완료 후 computed style 측정 보장
        requestAnimationFrame(runPenChartDiagnostics);
      }, 200);
      return () => clearTimeout(t);
    }
  }, [mode, initCanvas, runPenChartDiagnostics]);

  // T-20260526-foot-PENCHART-FORM-BLACKSCR REOPEN AC-R3:
  //   bgCanvas contextlost/contextrestored 핸들러
  //   GPU 메모리 압박으로 context가 소실되면 → fallback UI 표시
  //   context 복구 시 → initCanvas 재실행으로 자동 복원
  useEffect(() => {
    const canvas = bgCanvasRef.current;
    if (!canvas || mode !== 'draw') return;
    const onContextLost = (e: Event) => {
      e.preventDefault(); // 브라우저가 context 복구를 시도하도록 preventDefault 필요
      console.error('[PenChartTab] bgCanvas contextlost 이벤트 — GPU context 소실');
      setBgImgErrorReason(`E9 contextlost 이벤트 (GPU 소실) · ${activeDrawTemplate?.form_key ?? '-'}`);
      setBgImgLoadError(true);
    };
    const onContextRestored = () => {
      console.log('[PenChartTab] bgCanvas contextrestored — canvas 재초기화');
      setBgImgLoadError(false);
      initCanvas();
    };
    canvas.addEventListener('contextlost', onContextLost);
    canvas.addEventListener('contextrestored', onContextRestored);
    return () => {
      canvas.removeEventListener('contextlost', onContextLost);
      canvas.removeEventListener('contextrestored', onContextRestored);
    };
  }, [mode, initCanvas]);

  // T-20260522-foot-PENCHART-PHRASE: phrase_templates 로드 (draw 진입 시 1회)
  useEffect(() => {
    if (mode !== 'draw' || phraseTemplatesLoaded) return;
    supabase
      .from('phrase_templates')
      .select('id, category, name, content')
      .eq('is_active', true)
      .order('sort_order')
      .then(({ data }) => {
        setPhraseTemplates(data ?? []);
        setPhraseTemplatesLoaded(true);
      });
  }, [mode, phraseTemplatesLoaded]);

  // ── Undo 저장/복원 ────────────────────────────────────────────────────
  // captureUndoAsync / flushPendingUndo 선언은 initCanvas 위 (Fix-5, 참조 순서)

  const handleUndo = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Fix-2: drawCtxRef 재사용
    const ctx = drawCtxRef.current ?? canvas.getContext('2d');
    if (!ctx) return;
    if (undoStackRef.current.length === 0) {
      // V3 C-2: 에러 시에만 토스트 — undo 없음은 silent
      return;
    }
    const imageData = undoStackRef.current.pop()!;
    ctx.putImageData(imageData, 0, 0);
    // undo 후 현재(복원) 상태를 다음 획용으로 async 사전 캡처
    captureUndoAsync();
    if (undoStackRef.current.length === 0) {
      hasDrawingRef.current = false; // T-20260523-foot-PENCHART-PEN-SLOW
      setHasDrawing(false);
    }
  }, [captureUndoAsync]);

  // ── 포인터 좌표 계산 ─────────────────────────────────────────────────
  // getPos: React 합성 이벤트 → 논리 좌표 + CSS 좌표 (text overlay 위치용)
  // T-20260522-foot-PENCHART-TOOLS-V2 AC-1: DRAW_DPR=2 강제 사용 (device DPR 무관)
  // T-20260524-foot-PENCHART-PEN-SLOW Fix-6: strokeRectRef 우선 사용 → onPointerDown에서 getBoundingClientRect 중복 제거
  const getPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0, cssX: 0, cssY: 0 };
    // strokeRectRef가 onPointerDown에서 이미 캐싱됐으면 재사용 — getBoundingClientRect 강제 레이아웃 생략
    const rect = strokeRectRef.current ?? canvas.getBoundingClientRect();
    const dpr = drawDprRef.current; // REOPEN#1: initDrawCanvas가 고정한 overlay DPR(기본2x/lite1x) 동일사용
    const logicalW = canvas.width / dpr;
    const logicalH = canvas.height / dpr;
    const scaleX = logicalW / rect.width;
    const scaleY = logicalH / rect.height;
    const cssX = e.clientX - rect.left;
    const cssY = e.clientY - rect.top;
    return { x: cssX * scaleX, y: cssY * scaleY, cssX, cssY };
  };

  // ── 상용구 배치 (V3: placedItems 에 추가 — 드래그·삭제 지원) ─────────────
  const placeBoilerplate = (x: number, y: number) => {
    const fontSize = Math.round(penSize * 4 + 6);
    const newItem: PlacedItem = {
      id: `bp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: 'boilerplate',
      x, y,
      text: pendingBoilerplate,
      fontSize,
      color: penColor,
    };
    setPlacedItems((prev) => [...prev, newItem]);
    emptyRef.current = false;
    setHasDrawing(true);
    switchTool('pen');
    setPendingBoilerplate('');
    // T-20260603-foot-PHRASE-MOVE-RESTORE (B안·AC-2): 배치 직후 방금 놓은 상용구를 자동 선택
    // → 이동 그립이 보라색으로 강조돼 "여기를 잡아 옮길 수 있다"는 affordance를 즉시 노출.
    setSelectedIds(new Set([newItem.id]));
  };

  // T-20260522-foot-PENCHART-TOOLS-V3 AC-7~9: 텍스트 도구 — placedItems에 추가 (드래그·삭제 지원)
  const handleTextConfirm = useCallback(() => {
    if (!textInputValue.trim() || !textInputPos) return;
    const fontSize = Math.round(penSize * 4 + 6);
    const newItem: PlacedItem = {
      id: `txt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: 'text',
      x: textInputPos.x,
      y: textInputPos.y,
      text: textInputValue,
      fontSize,
      color: penColor,
    };
    setPlacedItems((prev) => [...prev, newItem]);
    emptyRef.current = false;
    setHasDrawing(true);
    setTextInputPos(null);
    setTextInputValue('');
  }, [textInputValue, textInputPos, penSize, penColor]);

  // ── 포인터 이벤트 ────────────────────────────────────────────────────
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // touch → 스크롤 전용 (draw 건너뜀)
    // T-20260606-foot-RX-PHRASE-TOUCH-INSERT-FIX: 단, boilerplate-placing 모드에선 iPad 손가락 탭도
    // 상용구 배치 진입 허용 (a16193f touch guard가 placing 체크 앞에 있어 손가락 탭 전면 차단되던 회귀 수정)
    if (e.pointerType === 'touch' && activeTool !== 'boilerplate-placing') return;
    // T-20260602-foot-PHRASE-PEN-PASSTHROUGH: select(선택/이동) 모드는 캔버스 빈 영역 탭에도 드로잉 안 함
    if (activeTool === 'select') return;
    e.preventDefault();
    e.stopPropagation();
    const canvas = canvasRef.current;
    if (!canvas) return;
    // T-20260524-foot-PENCHART-PEN-SLOW Fix-6: rect 먼저 캐싱 → getPos가 재사용 (getBoundingClientRect 1회만)
    strokeRectRef.current = canvas.getBoundingClientRect();
    // T-20260606-foot-PENCHART-REFUND-PEN-MISS: 방금 측정한 fresh rect 이므로 dirty 해제(직전 스크롤 잔여 플래그 제거)
    strokeRectDirtyRef.current = false;
    // T-20260526-foot-PENCHART-PEN-SLOW Fix-8: scaleX/scaleY 캐싱 → native handler가 획 중 재계산 없이 재사용
    strokeScaleRef.current = {
      x: (canvas.width / drawDprRef.current) / strokeRectRef.current.width,
      y: (canvas.height / drawDprRef.current) / strokeRectRef.current.height,
    };
    const pos = getPos(e);

    // 상용구 배치 모드
    if (activeTool === 'boilerplate-placing' && pendingBoilerplate) {
      // Fix-5: flushPendingUndo → pre-captured 상태 stack 적재 (sync getImageData 없음)
      flushPendingUndo();
      placeBoilerplate(pos.x, pos.y);
      // 상용구 배치 후 현재 상태 async 캡처 (다음 획 undo 용)
      captureUndoAsync();
      return;
    }

    // T-20260522-foot-PENCHART-TOOLS-V2 AC-3: 텍스트 도구
    if (activeTool === 'text') {
      // 기존 입력창이 열려있으면 닫기
      if (textInputPos) { setTextInputPos(null); setTextInputValue(''); return; }
      setTextInputPos({ x: pos.x, y: pos.y, cssX: pos.cssX, cssY: pos.cssY });
      setTextInputValue('');
      // textarea는 textAreaRef로 autoFocus 처리됨
      return;
    }

    // T-20260524-foot-PENCHART-PEN-SLOW Fix-5: saveUndoState() 제거 → flushPendingUndo() 대체
    // pre-captured ImageData를 stack에 올림 — getImageData 없음 (rAF에서 이미 완료)
    flushPendingUndo();
    canvas.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    lastPosRef.current = { x: pos.x, y: pos.y };
    // T-20260606-foot-PENCHART-REFUND-LATENCY: 획 단위 프로파일러 누적값 리셋
    if (perfRef.current.enabled) {
      const p = perfRef.current;
      p.strokeStart = performance.now();
      p.moves = 0; p.coalescedTotal = 0; p.emptyCoa = 0; p.drawTimeTotal = 0; p.maxFrameGap = 0; p.lastMoveTs = 0;
    }
    // strokeRectRef는 위에서 이미 캐싱됨 (Fix-6) — 중복 호출 제거
    // T-20260523-foot-PENCHART-PEN-SLOW Fix-2: 캐싱된 ctx 사용
    const ctx = drawCtxRef.current ?? canvas.getContext('2d');
    if (!ctx) return;

    if (activeTool === 'eraser') {
      // V3 AC-3: 드로잉 레이어만 clearRect → bg(상용구 템플릿) 보존, placedItems 미삭제
      const sz = penSize * 4;
      ctx.clearRect(pos.x - sz, pos.y - sz, sz * 2, sz * 2);
    } else if (activeTool === 'white') {
      // T-20260522-foot-PENCHART-TOOL-UX AC-3: 화이트 — source-over 흰색 + placedItems hit-test 삭제
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha = 1;
      const sz = penSize * 4;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, sz, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      emptyRef.current = false;
      // T-20260523-foot-PENCHART-PEN-SLOW: 첫 획 전환 시에만 setHasDrawing → React 재렌더 최소화
      if (!hasDrawingRef.current) { hasDrawingRef.current = true; setHasDrawing(true); }
      // T-20260523-foot-PENCHART-PEN-SLOW Fix-4: hit-test는 onPointerUp에서 1회만 (onPointerDown 시작점 기록)
      whiteStrokePathRef.current = [{ x: pos.x, y: pos.y }];
    } else if (activeTool === 'highlight') {
      // V3 AC-10~11: 투명도 35%→20%
      ctx.beginPath();
      const r = Math.max(penSize * 3 + 3, 4);
      ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
      ctx.globalAlpha = 0.20;
      ctx.fillStyle = highlightColor;
      ctx.fill();
      ctx.globalAlpha = 1;
      emptyRef.current = false;
      // T-20260523-foot-PENCHART-PEN-SLOW: 첫 획 전환 시에만 setHasDrawing → React 재렌더 최소화
      if (!hasDrawingRef.current) { hasDrawingRef.current = true; setHasDrawing(true); }
    } else {
      // T-20260522-foot-PENCHART-TOOL-UX AC-1: 펜 — 시작점 dot + bezier 상태 초기화
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, penSize * 0.5, 0, Math.PI * 2);
      ctx.globalAlpha = 1;
      ctx.fillStyle = penColor;
      ctx.fill();
      lastMidRef.current = null; // bezier 스무딩 상태 리셋 (새 획 시작)
      emptyRef.current = false;
      // T-20260523-foot-PENCHART-PEN-SLOW: 첫 획 전환 시에만 setHasDrawing → React 재렌더 최소화
      if (!hasDrawingRef.current) { hasDrawingRef.current = true; setHasDrawing(true); }
    }
  };

  // T-20260526-foot-PENCHART-PEN-SLOW Fix-8: onPointerMove → handleNativePointerMove로 대체
  // (native addEventListener, initDrawCanvas에서 등록 — React synthetic prop 제거됨)

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    lastPosRef.current = null;
    lastMidRef.current = null; // T-20260522-foot-PENCHART-TOOL-UX AC-1: 획 종료 시 bezier 상태 초기화
    // T-20260523-foot-PENCHART-PEN-SLOW Fix-3: strokeRect 캐시 해제
    strokeRectRef.current = null;

    // T-20260523-foot-PENCHART-PEN-SLOW Fix-4: white 도구 hit-test — 획 종료 시 1회만 실행
    // (onPointerMove에서 매 이벤트마다 setPlacedItems 호출 제거 → React re-render 억제)
    if (activeTool === 'white' && whiteStrokePathRef.current.length > 0) {
      const wsz = penSize * 4;
      const path = whiteStrokePathRef.current;
      setPlacedItems((prev) => prev.filter((item) => {
        const lineH = item.fontSize + 6;
        const lines = item.text.split('\n');
        const itemH = lines.length * lineH + 8;
        const itemW = Math.max(60, item.text.length * (item.fontSize * 0.55));
        return !path.some(({ x, y }) =>
          x + wsz > item.x && x - wsz < item.x + itemW &&
          y + wsz > item.y && y - wsz < item.y + itemH
        );
      }));
      whiteStrokePathRef.current = [];
    }

    const canvas = canvasRef.current;
    if (canvas && canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);

    // ── T-20260606-foot-PENCHART-REFUND-LATENCY: 획 종료 프로파일러 요약(게이트 ON 시) ──────
    //   현장(김주연 총괄) Galaxy Tab DevTools에서 한 획마다 1줄 캡처 → 병목 가설 판정 근거.
    const perf = perfRef.current;
    if (perf.enabled && perf.moves > 0) {
      const dur = performance.now() - perf.strokeStart;
      const strokeMs         = Math.round(dur);
      const coalescedPerMove = +(perf.coalescedTotal / perf.moves).toFixed(2);  // ↓낮고 빠른획=coalesce 손실 의심
      const avgDrawMs        = +(perf.drawTimeTotal / perf.moves).toFixed(3);   // ↑높으면 stroke 래스터(redraw) 비용
      const maxFrameGapMs    = +perf.maxFrameGap.toFixed(1);                    // ↑크면 프레임 드랍(jank)
      const inputPtsPerSec   = dur > 0 ? +((perf.coalescedTotal / dur) * 1000).toFixed(0) : 0;
      console.log('[PenChartTab PERF]', JSON.stringify({
        formKey:          activeDrawTemplate?.form_key ?? null,
        canvas:           `${canvas?.width ?? 0}x${canvas?.height ?? 0}`,
        strokeMs,
        moves:            perf.moves,
        coalescedTotal:   perf.coalescedTotal,
        coalescedPerMove,
        emptyCoa:         perf.emptyCoa, // >0 이면 빈 coalesced 배열 quirk 발생(=선빠짐 직접원인, REOPEN#1 가드로 복원됨)
        avgDrawMs,
        maxFrameGapMs,
        inputPtsPerSec,
      }));
      // ── REOPEN#1: 세션 worst 누적 + 화면 배지 갱신(현장 스크린샷 1장으로 병목 판정) ──
      const w = perfWorstRef.current;
      w.strokes += 1;
      if (maxFrameGapMs > w.frameGap)     w.frameGap = maxFrameGapMs;
      if (avgDrawMs     > w.avgDraw)      w.avgDraw  = avgDrawMs;
      if (coalescedPerMove < w.minCoa)    w.minCoa   = coalescedPerMove;
      if (strokeMs      > w.strokeMs)     w.strokeMs = strokeMs;
      // 병목 판정 휴리스틱(현장 가독용 — 데이터로 환원, 단정 아님):
      //   avgDraw≥5ms 우세 → CPU 래스터/대형 비트맵(redraw)  | frameGap≥40ms 우세 → 합성/프레임 jank
      //   둘 다 낮은데 coalesce/move≤1.1 → 입력 샘플링(coalesce) 손실
      let verdict = '판정대기(획 더 필요)';
      if (w.strokes >= 1) {
        if (perf.emptyCoa > 0)                              verdict = `EMPTY-COALESCE quirk(${perf.emptyCoa}) → 선빠짐 근인 확정·가드 복원됨`;
        else if (w.avgDraw >= 5 && w.avgDraw >= w.frameGap / 10) verdict = 'REDRAW 우세 → 비트맵 축소 후보';
        else if (w.frameGap >= 40)                          verdict = 'JANK 우세 → 합성/프레임 후보';
        else if (w.minCoa <= 1.1 && inputPtsPerSec < 90)    verdict = 'COALESCE 손실 후보';
        else                                                verdict = '경미 — 추가 표본 필요';
      }
      setPerfDisplay({
        formKey: activeDrawTemplate?.form_key ?? null,
        canvas: `${canvas?.width ?? 0}x${canvas?.height ?? 0}`,
        strokeMs, moves: perf.moves, coalescedPerMove, avgDrawMs, maxFrameGapMs, inputPtsPerSec,
        wFrameGap: +w.frameGap.toFixed(1), wAvgDraw: +w.avgDraw.toFixed(2),
        wMinCoa: w.minCoa === Infinity ? 0 : +w.minCoa.toFixed(2), wStrokeMs: w.strokeMs, strokes: w.strokes,
        verdict,
      });
      // ── REOPEN#3: 배지 스크린샷 실패 대비 회수 채널 — 마지막 획 요약을 localStorage 에 영속화. ──
      //   현장 스크린샷이 1차 채널, 이건 DevTools/원격 접근 시 백업 회수용(emptyCoa quirk 실측 보존). DB 무변경.
      try {
        localStorage.setItem('penchart_perf_last', JSON.stringify({
          at: new Date().toISOString(),
          formKey: activeDrawTemplate?.form_key ?? null,
          canvas: `${canvas?.width ?? 0}x${canvas?.height ?? 0}`,
          strokeMs, moves: perf.moves, coalescedPerMove, emptyCoa: perf.emptyCoa,
          avgDrawMs, maxFrameGapMs, inputPtsPerSec, verdict,
        }));
      } catch { /* storage 비가용(시크릿/쿼터) 무시 */ }
    }

    // T-20260524-foot-PENCHART-PEN-SLOW Fix-5: 획 종료 후 rAF에서 undo 상태 사전 캡처
    // → 다음 onPointerDown 시 getImageData 없음 (hot path 완전 제거)
    captureUndoAsync();
  };

  // ── 캔버스 저장 ──────────────────────────────────────────────────────
  const handleDrawSave = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setSaving(true);
    try {
      // T-20260522-foot-PENCHART-TOOLS-V3: placedItems(텍스트·상용구)를 draw canvas에 먼저 래스터화
      if (placedItems.length > 0) {
        const drawCtx = canvas.getContext('2d');
        if (drawCtx) {
          for (const item of placedItems) {
            const lines = item.text.split('\n');
            drawCtx.save();
            drawCtx.font = `${item.fontSize}px 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif`;
            drawCtx.fillStyle = item.color;
            drawCtx.textBaseline = 'top';
            drawCtx.globalAlpha = 1;
            const lineH = item.fontSize + 6;
            lines.forEach((line, i) => {
              drawCtx.fillText(line, item.x, item.y + i * lineH);
            });
            drawCtx.restore();
          }
        }
      }

      // T-20260523-foot-FORM-TEMPLATE-REGEN: bgCanvas = CANVAS_W*2 × canvasH*2 로 고정
      // bgCanvas: CANVAS_W*2 × canvasH*2 (= 1588×2246, drawCanvas와 동일)
      // drawCanvas: CANVAS_W*2 × canvasH*2 (= 1588×2246)
      // → tempCanvas = bgCanvas 크기(1588×2246), draw 1:1 합성 — 다운스케일 없음
      const bgCanvas = bgCanvasRef.current;
      const tempCanvas = document.createElement('canvas');

      if (bgCanvas && bgCanvas.width > 0 && bgCanvas.height > 0) {
        // bg 원본 해상도로 저장 (최고 화질)
        tempCanvas.width  = bgCanvas.width;
        tempCanvas.height = bgCanvas.height;
        const tCtx = tempCanvas.getContext('2d')!;
        tCtx.drawImage(bgCanvas, 0, 0);                                        // 배경 (원본 해상도)
        tCtx.drawImage(canvas, 0, 0, bgCanvas.width, bgCanvas.height);         // 드로잉 (bg 크기에 맞게 스케일)
      } else {
        // bg 없을 경우 draw canvas 물리 픽셀 기준
        tempCanvas.width  = canvas.width;
        tempCanvas.height = canvas.height;
        const tCtx = tempCanvas.getContext('2d')!;
        tCtx.drawImage(canvas, 0, 0);
      }

      const dataUrl = tempCanvas.toDataURL('image/png');
      const res = await fetch(dataUrl);
      const blob = await res.blob();

      let prefix = '';
      if (activeDrawTemplate && isHealthQFormKey(activeDrawTemplate.form_key)) {
        prefix = `hq_${activeDrawTemplate.form_key === 'health_questionnaire_senior' ? 'sr_' : ''}`;
      } else if (activeDrawTemplate && isRefundConsentKey(activeDrawTemplate.form_key)) {
        prefix = 'rc_';
      } else if (activeDrawTemplate && isPersonalChecklistKey(activeDrawTemplate.form_key)) {
        // T-20260522-foot-PENCHART-HIRES-FORM: pc_sr_ = senior, pc_ = general
        prefix = `pc_${activeDrawTemplate.form_key === 'personal_checklist_senior' ? 'sr_' : ''}`;
      }
      const fileName = `${prefix}${Date.now()}_${Math.random().toString(36).slice(2, 6)}.png`;
      const path = `${storagePath}/${fileName}`;
      const { error } = await supabase.storage.from('photos').upload(path, blob, { contentType: 'image/png', upsert: false });
      if (error) { toast.error(`저장 실패: ${error.message}`); return; }

      const isHQ = activeDrawTemplate && isHealthQFormKey(activeDrawTemplate.form_key);
      const isPC = activeDrawTemplate && isPdfOverlayFormKey(activeDrawTemplate.form_key);
      // T-20260522-foot-PENCHART-HIRES-FORM: 개인정보+체크리스트 form_submissions 연동
      const isPCL = activeDrawTemplate && isPersonalChecklistKey(activeDrawTemplate.form_key);

      if ((isPC || isHQ || isPCL) && activeDrawTemplate) {
        // T-20260523-foot-PENCHART-FORM-AUTOFILL AC-R4: 서명 UI 제거 → signature_base64 항상 null
        const signatureBase64 = null;
        const now = new Date().toISOString();
        const submissionPayload: Record<string, unknown> = {
          clinic_id:   clinicId,
          customer_id: customerId,
          field_data: {
            form_key:         activeDrawTemplate.form_key,
            canvas_file:      fileName,
            signature_base64: signatureBase64,
            saved_at:         now,
          },
          status:     'signed',
          printed_at: now,
          signed_at:  now,
          ...(staffId ? { issued_by: staffId } : {}),
        };
        if (!activeDrawTemplate.id.startsWith('builtin-')) {
          submissionPayload.template_id = activeDrawTemplate.id;
        }
        if (checkInId) submissionPayload.check_in_id = checkInId;
        const { error: subErr } = await supabase.from('form_submissions').insert(submissionPayload);
        if (subErr) {
          console.error('form_submissions insert 실패:', subErr.message);
          toast.error(`상담내역 연동 실패: ${subErr.message} (이미지는 저장됨)`);
        } else {
          onFormSubmissionSaved?.();
        }
      }

      // V3 C-2: 토스트는 에러 시에만 표시 — 저장 성공 시 토스트 없이 목록으로 복귀
      await loadSavedCharts();
      setPlacedItems([]);
      setSelectedIds(new Set());
      setActiveDrawTemplate(null);
      setMode('list');

      // T-20260528-foot-PENCHART-POPUP: 팝업 모드 — 저장 후 부모 창 갱신 + 팝업 닫기
      if (popupMode) {
        // BroadcastChannel (현대 브라우저)
        try {
          const bc = new BroadcastChannel('penchart-update');
          bc.postMessage({ customerId });
          bc.close();
        } catch { /* BroadcastChannel 미지원 환경 무시 */ }
        // localStorage storage 이벤트 폴백 (Safari < 15.4 / 구형 iPad)
        try {
          localStorage.setItem('penchart-update', JSON.stringify({ customerId, ts: Date.now() }));
        } catch { /* 무시 */ }
        setTimeout(() => window.close(), 150);
      }
    } finally {
      setSaving(false);
    }
  };

  // ── 삭제 ─────────────────────────────────────────────────────────────
  const handleDelete = async (chart: SavedChart) => {
    if (!window.confirm(`"${chart.name}" 을 삭제하시겠습니까?`)) return;
    const path = `${storagePath}/${chart.name}`;
    const { error } = await supabase.storage.from('photos').remove([path]);
    if (error) toast.error(`삭제 실패: ${error.message}`);
    if (selectedChart?.name === chart.name) setSelectedChart(null);
    await loadSavedCharts();
  };

  // ── 상용구 선택 ──────────────────────────────────────────────────────
  const handleBoilerplateSelect = (text: string) => {
    setPendingBoilerplate(text);
    setActiveTool('boilerplate-placing');
    setPenSize(DEFAULT_THICKNESS['boilerplate-placing']);

    setShowPhrasePanel(false);
    setTextInputPos(null);
    // V3 C-2: 안내 토스트 제거 (인라인 배지로 대체)
  };

  // ── [DEACTIVATED — T-20260605-foot-RX-PHRASE-INSERT-UX Q1] 복수 선택 토글/확정/초기화 ──
  //   복원 시 아래 3종 핸들러 + selectedPhraseIds 상태 + combineBoilerplate 헬퍼를 함께 주석 해제.
  // const togglePhraseSelect = (id: number) => {
  //   setSelectedPhraseIds((prev) =>
  //     prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
  //   );
  // };
  // const confirmPhraseSelection = () => {
  //   if (selectedPhraseIds.length === 0) return;
  //   const contents = selectedPhraseIds
  //     .map((id) => phraseTemplates.find((p) => p.id === id)?.content)
  //     .filter((c): c is string => typeof c === 'string');
  //   if (contents.length === 0) return;
  //   handleBoilerplateSelect(combineBoilerplate(contents));
  //   setSelectedPhraseIds([]);
  // };
  // const clearPhraseSelection = () => setSelectedPhraseIds([]);

  // ── T-20260605-foot-RX-PHRASE-INSERT-UX: 단건 즉시삽입 동선 ──────────────
  // AC-2: 행 클릭 → 그 행에만 인라인 ✓ 노출(한 번에 한 행). 같은 행 재클릭 = 닫힘.
  const revealPhraseInsert = (id: number) => {
    setRevealedPhraseId((prev) => (prev === id ? null : id));
  };
  // AC-3: ✓ 클릭 → 즉시 삽입. handleBoilerplateSelect로 boilerplate-placing 진입(GUARD: placeBoilerplate 불변).
  //   기존 단건 동선과 동일하게 단일 content를 그대로 pendingBoilerplate로 전달.
  const insertPhraseImmediate = (id: number) => {
    const content = phraseTemplates.find((p) => p.id === id)?.content;
    // AC-2 (T-20260606-foot-PENCHART-PHRASE-INSERT-FIX): content 누락/빈값이면 가시 피드백 후 무동작.
    //   빈 문자열('')·공백전용은 typeof 'string' 가드를 통과해 boilerplate-placing 모드로 진입하지만,
    //   onPointerDown(L1637)의 `pendingBoilerplate` falsy 체크에서 placeBoilerplate가 조용히 스킵되고
    //   그대로 펜 드로잉 경로로 떨어짐 → 사용자는 "✓ 했는데 왜 안 되지(+캔버스에 낙서)" 상태.
    //   → 모드 진입 전에 차단하고 토스트로 원인(상용구 내용 비어있음)을 가시화. phrase-agnostic.
    if (typeof content !== 'string' || content.trim() === '') {
      toast.warning('이 상용구에 내용이 없습니다. 상용구 관리에서 내용을 입력해 주세요.');
      setRevealedPhraseId(null);
      return;
    }
    handleBoilerplateSelect(content);
    setRevealedPhraseId(null);
  };

  // ── 양식 선택 ─────────────────────────────────────────────────────────
  const handleSelectTemplate = (tpl: Template) => {
    setActiveDrawTemplate(tpl);
    setMode('draw');
  };

  // ─────────────────────────────────────────────────────────────────────
  // 렌더: select + draw 모드 — 단일 FullscreenFormWrapper 공유
  // T-20260525-foot-PENCHART-FORM-BLACKSCR 버그 수정:
  //   select → draw 전환 시 FullscreenFormWrapper가 별도 인스턴스로 교체되면
  //   이전 Dialog 언마운트가 onOpenChange(false) → setMode('list') 를 발화해
  //   draw 모드 Dialog가 즉시 닫힘(튕겨나감) + 초기화 안 된 캔버스가 검정 노출.
  //   → select / draw 양 모드를 하나의 FullscreenFormWrapper로 감싸
  //     Dialog 인스턴스 유지 → 전환 중 Dialog 재마운트·onOpenChange 오발화 제거.
  // ─────────────────────────────────────────────────────────────────────
  if (mode === 'select' || mode === 'draw') {
    const canvasH = getCanvasHeightForForm(activeDrawTemplate?.form_key);
    const isEraser    = activeTool === 'eraser';
    const isWhite     = activeTool === 'white';
    const isHighlight = activeTool === 'highlight';
    const isTextTool  = activeTool === 'text';
    const isBoilerplatePlacing = activeTool === 'boilerplate-placing';
    // T-20260602-foot-PHRASE-PEN-PASSTHROUGH: 선택/이동 모드 — placedItem 오버레이만 interactive
    const isSelectTool = activeTool === 'select';
    const hasSelectedItems = selectedIds.size > 0;
    return (
      <FullscreenFormWrapper
        open={true}
        onOpenChange={(open) => {
          if (!open) {
            if (mode === 'draw' && hasDrawing && !window.confirm('작성 중인 내용이 사라집니다. 취소하시겠습니까?')) return;
            setActiveDrawTemplate(null);
            // T-20260528-foot-PENCHART-NEWWIN: 팝업 모드에서 닫기 → 창 닫기
            if (popupMode) { window.close(); return; }
            setMode('list');
          }
        }}
      >
        {mode === 'select' && (
        <div className="h-full overflow-auto p-4 bg-white">
        <div className="max-w-lg mx-auto space-y-3">
        <div className="rounded-lg border bg-white p-3">
          <div className="flex items-center gap-2 mb-3">
            <button
              onClick={() => {
                // T-20260528-foot-PENCHART-NEWWIN: 팝업 모드에서 뒤로가기 → 창 닫기
                if (popupMode) { window.close(); return; }
                setMode('list');
              }}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="h-3.5 w-3.5" /> {popupMode ? '닫기' : '목록으로'}
            </button>
            <span className="text-sm font-bold text-purple-800">양식 선택</span>
          </div>
          <div className="grid gap-3">
            {/* 펜차트 (캔버스 필기) */}
            <button
              onClick={() => handleSelectTemplate(penChartTemplate ?? BUILTIN_PEN_CHART_TEMPLATE)}
              className="flex items-center gap-3 rounded-lg border-2 border-purple-200 bg-purple-50 p-4 text-left hover:border-purple-400 hover:bg-purple-100 transition"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-purple-200">
                <FileText className="h-5 w-5 text-purple-700" />
              </div>
              <div>
                {/* T-20260523-foot-PENCHART-INSURANCE (AC-3): 선택 패널 명칭 동적 — [보험차트] */}
                <div className="font-semibold text-purple-800 text-sm">
                  {(penChartTemplate ?? BUILTIN_PEN_CHART_TEMPLATE).name_ko}
                </div>
                <div className="text-xs text-purple-600 mt-0.5">PDF 양식 위에 태블릿/마우스로 직접 필기</div>
              </div>
            </button>

            {/* 발건강 질문지 2종 */}
            {healthQTemplates.map((tpl) => {
              const isSenior = tpl.form_key === 'health_questionnaire_senior';
              return (
                <button
                  key={tpl.id}
                  onClick={() => handleSelectTemplate(tpl)}
                  className={cn(
                    'flex items-center gap-3 rounded-lg border-2 p-4 text-left transition',
                    isSenior
                      ? 'border-emerald-200 bg-emerald-50 hover:border-emerald-400 hover:bg-emerald-100'
                      : 'border-teal-200 bg-teal-50 hover:border-teal-400 hover:bg-teal-100',
                  )}
                >
                  <div className={cn(
                    'flex h-10 w-10 items-center justify-center rounded-full',
                    isSenior ? 'bg-emerald-200' : 'bg-teal-200',
                  )}>
                    <ClipboardList className={cn('h-5 w-5', isSenior ? 'text-emerald-700' : 'text-teal-700')} />
                  </div>
                  <div>
                    <div className={cn('font-semibold text-sm', isSenior ? 'text-emerald-800' : 'text-teal-800')}>
                      {tpl.name_ko}
                    </div>
                    <div className={cn('text-xs mt-0.5', isSenior ? 'text-emerald-600' : 'text-teal-600')}>
                      {isSenior
                        ? '발건강 질문지 (어르신용) — 태블릿펜으로 직접 기입'
                        : '발건강 질문지 — 태블릿펜으로 직접 기입 후 저장'}
                    </div>
                  </div>
                  {isSenior && (
                    <span className="ml-auto rounded-full bg-emerald-200 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                      어르신용
                    </span>
                  )}
                  <span className={cn(
                    'rounded-full px-2 py-0.5 text-[10px] font-bold',
                    isSenior ? 'bg-emerald-100 text-emerald-700' : 'bg-teal-100 text-teal-700',
                    isSenior ? '' : 'ml-auto',
                  )}>
                    PDF 양식
                  </span>
                </button>
              );
            })}

            {/* 환불/비급여 동의서 */}
            {refundConsentTemplate && (
              <button
                onClick={() => handleSelectTemplate(refundConsentTemplate)}
                className="flex items-center gap-3 rounded-lg border-2 border-rose-200 bg-rose-50 p-4 text-left hover:border-rose-400 hover:bg-rose-100 transition"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-rose-200">
                  <FileText className="h-5 w-5 text-rose-700" />
                </div>
                <div>
                  <div className="font-semibold text-rose-800 text-sm">환불/비급여 동의서</div>
                  <div className="text-xs text-rose-600 mt-0.5">환불·비급여 동의 PDF 원본 (3p) — 태블릿펜으로 직접 기입 + 서명</div>
                </div>
                <span className="ml-auto rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700">
                  3페이지
                </span>
              </button>
            )}
          </div>
        </div>
        </div>
        </div>
        )}
        {mode === 'draw' && (
      <div className="flex flex-col h-full bg-white">
        {/* 툴바 */}
        <div className="flex-none border-b bg-white p-2 flex items-center gap-1.5 flex-wrap shadow-sm">
          {/* ── 기본 도구 (V3: switchTool + per-tool defaults) ── */}
          {/* 펜 — 초기 굵기 1.5 */}
          <button
            onClick={() => switchTool('pen')}
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded text-xs border transition',
              activeTool === 'pen'
                ? 'bg-purple-100 border-purple-400 text-purple-700'
                : 'bg-white border-gray-200 text-muted-foreground hover:bg-gray-50',
            )}
          >
            <Pencil className="h-3.5 w-3.5" /> 펜
          </button>

          {/* 지우개 — 초기 굵기 3, 드로잉 레이어만 삭제(bg 보존) */}
          <button
            onClick={() => switchTool('eraser')}
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded text-xs border transition',
              isEraser ? 'bg-orange-100 border-orange-400 text-orange-700' : 'bg-white border-gray-200 text-muted-foreground hover:bg-gray-50',
            )}
            title="드로잉 레이어만 지움 — 배경 양식 보존"
          >
            <Eraser className="h-3.5 w-3.5" /> 지우개
          </button>

          {/* 화이트 — 초기 굵기 3, source-over 흰색 덮어쓰기 (배경 포함 전 레이어) */}
          <button
            onClick={() => switchTool(isWhite ? 'pen' : 'white')}
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded text-xs border transition',
              isWhite
                ? 'bg-slate-200 border-slate-500 text-slate-700'
                : 'bg-white border-gray-200 text-muted-foreground hover:bg-gray-50',
            )}
            title="화이트 — 흰색으로 덮어쓰기 (배경 포함 전 레이어)"
          >
            <Paintbrush className="h-3.5 w-3.5" />
            <span>화이트</span>
          </button>

          {/* 텍스트 — 초기 굵기 2, 저장 후 드래그·삭제 */}
          <button
            onClick={() => {
              switchTool(isTextTool ? 'pen' : 'text');
            }}
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded text-xs border transition',
              isTextTool
                ? 'bg-blue-100 border-blue-400 text-blue-700'
                : 'bg-white border-gray-200 text-muted-foreground hover:bg-gray-50',
            )}
            title="텍스트 도구 — 캔버스를 클릭해 타자 입력 후 드래그·삭제"
          >
            <TextCursorInput className="h-3.5 w-3.5" />
            <span>텍스트</span>
            {isTextTool && <span className="ml-0.5 text-blue-600 animate-pulse">●</span>}
          </button>

          {/* 형광펜 — 초기 굵기 2, 투명도 20% */}
          <button
            onClick={() => {
              switchTool(isHighlight ? 'pen' : 'highlight');
            }}
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded text-xs border transition',
              isHighlight
                ? 'bg-yellow-100 border-yellow-400 text-yellow-700'
                : 'bg-white border-gray-200 text-muted-foreground hover:bg-gray-50',
            )}
            title="형광펜 — 반투명 두꺼운 선 (투명도 20%, 지우개로 지울 수 있음)"
          >
            <Highlighter className="h-3.5 w-3.5" />
            <span>형광펜</span>
          </button>

          {/* T-20260602-foot-PHRASE-PEN-PASSTHROUGH: 선택/이동 — 상용구·텍스트 드래그/선택/삭제.
              이 모드에서만 오버레이 interactive. 드로잉 도구에서는 오버레이 passthrough → 상용구 위 직접 필기. */}
          <button
            onClick={() => switchTool(isSelectTool ? 'pen' : 'select')}
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded text-xs border transition',
              isSelectTool
                ? 'bg-emerald-100 border-emerald-400 text-emerald-700'
                : 'bg-white border-gray-200 text-muted-foreground hover:bg-gray-50',
            )}
            title="선택/이동 — 배치된 상용구·텍스트를 드래그·선택·삭제 (드로잉 도구에서는 상용구 위에 바로 필기됩니다)"
          >
            <Move className="h-3.5 w-3.5" />
            <span>선택/이동</span>
            {isSelectTool && <span className="ml-0.5 text-emerald-600 animate-pulse">●</span>}
          </button>

          {/* 형광펜 색상 선택 (형광펜 모드일 때만 표시) */}
          {isHighlight && (
            <div className="flex items-center gap-1 pl-1 border-l border-gray-200">
              {HIGHLIGHT_COLORS.map((c) => (
                <button
                  key={c.value}
                  onClick={() => setHighlightColor(c.value)}
                  className={cn(
                    'h-5 w-5 rounded border-2 transition',
                    highlightColor === c.value ? 'border-gray-600 scale-125' : 'border-transparent hover:border-gray-400',
                  )}
                  style={{ backgroundColor: c.value }}
                  title={c.label}
                />
              ))}
            </div>
          )}

          {/* V3 AC-12: T상용구 — 중복 메뉴 통합. phrase_templates(DB) 단일 메뉴로 통합 */}
          <div className="relative">
            <button
              onClick={() => {
                setShowPhrasePanel(!showPhrasePanel);
                setRevealedPhraseId(null); // 패널 토글 시 인라인 ✓ 초기화
                setTextInputPos(null);
              }}
              className={cn(
                'flex items-center gap-1 px-2 py-1 rounded text-xs border transition',
                isBoilerplatePlacing || showPhrasePanel
                  ? 'bg-teal-100 border-teal-400 text-teal-700'
                  : 'bg-white border-gray-200 text-muted-foreground hover:bg-gray-50',
              )}
              title="상용구 — 드래그·삭제·다중선택 지원"
              data-testid="phrase-library-btn"
            >
              <BookOpen className="h-3.5 w-3.5" />
              <span>상용구</span>
              {isBoilerplatePlacing && <span className="ml-0.5 text-teal-600 animate-pulse">●</span>}
            </button>

            {showPhrasePanel && (
              <div
                /* T-20260605-foot-RX-PHRASE-INSERT-UX: 상용구 패널 오버레이.
                   (AC-6 패널 확장은 현장 정정 2026-06-05으로 취소 — '공간 확장' 오독, 본의는 로딩 버그(별건). w-64 원복.) */
                className="absolute top-8 left-0 z-20 w-64 rounded-lg border bg-white shadow-lg overflow-hidden"
                data-testid="phrase-library-panel"
              >
                {/* T-20260522-foot-PENCHART-TOOL-UX AC-6: 패널 헤더 중복 라벨 제거 (버튼에 이미 "상용구" 표시됨) */}
                <div className="flex items-center justify-end px-2 py-1 bg-teal-50 border-b">
                  <button
                    onClick={() => { setShowPhrasePanel(false); setRevealedPhraseId(null); }}
                    className="text-teal-500 hover:text-teal-700"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* 카테고리 사이드 메뉴 + 목록 */}
                <div className="flex" data-testid="phrase-category-tabs">
                  {/* 좌: 카테고리 */}
                  <div className="w-[58px] flex-shrink-0 border-r bg-gray-50 flex flex-col">
                    {(
                      [
                        { key: 'charting',     label: '차팅' },
                        { key: 'prescription', label: '처방' },
                        { key: 'document',     label: '원장님' },
                        { key: 'general',      label: '일반' },
                      ] as const
                    ).map(({ key, label }) => {
                      const cnt = phraseTemplates.filter((p) => p.category === key).length;
                      return (
                        <button
                          key={key}
                          onClick={() => { setPhraseCategory(key); setRevealedPhraseId(null); }}
                          className={cn(
                            'flex flex-col items-center gap-0.5 px-1 py-2 text-center border-b border-gray-100 last:border-0 transition',
                            phraseCategory === key
                              ? 'bg-teal-50 text-teal-700 font-semibold border-l-2 border-l-teal-500'
                              : 'text-muted-foreground hover:bg-gray-100',
                          )}
                          data-testid={`phrase-cat-${key}`}
                        >
                          <span className="text-[10px] leading-tight break-keep">{label}</span>
                          <span className="text-[9px] tabular-nums text-muted-foreground/60">{cnt}</span>
                        </button>
                      );
                    })}
                  </div>

                  {/* 우: 상용구 목록 (AC-6 높이 보강 취소 — max-h-56 원복) */}
                  <div className="flex-1 min-w-0 max-h-56 overflow-y-auto" data-testid="phrase-list">
                    {phraseTemplates.filter((p) => p.category === phraseCategory).length === 0 ? (
                      <div
                        className="flex flex-col items-center justify-center py-6 text-[11px] text-muted-foreground"
                        data-testid="phrase-empty-state"
                      >
                        <Type className="h-5 w-5 mb-1.5 opacity-30" />
                        <span>등록된 상용구가 없습니다</span>
                        <span className="text-[10px] mt-0.5 text-gray-400">어드민 &gt; 상용구에서 추가하세요</span>
                      </div>
                    ) : (
                      phraseTemplates
                        .filter((p) => p.category === phraseCategory)
                        .map((phrase) => {
                          // T-20260605-foot-RX-PHRASE-INSERT-UX: 행 클릭 → 인라인 ✓ 노출(한 행). ✓ 클릭 = 즉시삽입.
                          const isRevealed = revealedPhraseId === phrase.id;
                          return (
                            <div
                              key={phrase.id}
                              role="button"
                              tabIndex={0}
                              onClick={() => revealPhraseInsert(phrase.id)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  revealPhraseInsert(phrase.id);
                                }
                              }}
                              className={cn(
                                'w-full cursor-pointer text-left px-2.5 py-1.5 text-[11px] border-b border-gray-100 last:border-0 transition flex items-center gap-1.5 focus:outline-none focus:bg-teal-50',
                                isRevealed ? 'bg-teal-50 hover:bg-teal-50' : 'hover:bg-teal-50',
                              )}
                              data-testid={`phrase-item-${phrase.id}`}
                              data-revealed={isRevealed}
                              aria-expanded={isRevealed}
                            >
                              {/* AC-2·AC-3·AC-5: 인라인 ✓ 삽입 버튼 — 행 클릭 시 좌측 노출, 클릭=즉시삽입 */}
                              {isRevealed && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation(); // 행 토글로 전파 방지 (재클릭=닫힘 방지)
                                    insertPhraseImmediate(phrase.id);
                                  }}
                                  className="flex-shrink-0 h-5 w-5 rounded-full flex items-center justify-center bg-teal-500 text-white hover:bg-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-300 transition"
                                  data-testid={`phrase-insert-${phrase.id}`}
                                  aria-label={`${phrase.name} 삽입`}
                                  title="삽입"
                                >
                                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                                </button>
                              )}
                              <span className="min-w-0 flex-1">
                                <span className="block font-medium text-gray-800 truncate">{phrase.name}</span>
                                <span className="block text-gray-400 mt-0.5 text-[10px] truncate">
                                  {phrase.content.split('\n')[0]}
                                </span>
                              </span>
                            </div>
                          );
                        })
                    )}
                  </div>
                </div>

                {/* [AC-1 — T-20260605-foot-RX-PHRASE-INSERT-UX] 체크박스 복수선택 푸터(삽입/취소) 제거.
                    단건 즉시삽입 동선으로 전환 — 행 클릭 → 인라인 ✓ → 즉시삽입. */}
              </div>
            )}
          </div>

          {/* 상용구 배치 안내 */}
          {isBoilerplatePlacing && (
            <div className="flex items-center gap-1 px-2 py-1 rounded bg-teal-50 border border-teal-300 text-[11px] text-teal-700">
              <span className="animate-pulse">●</span>
              캔버스 클릭해 삽입
              <button
                onClick={() => { switchTool('pen'); setPendingBoilerplate(''); }}
                className="ml-1 text-teal-400 hover:text-teal-700"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}

          {/* V3: 배치된 아이템 다중선택 삭제 — T-20260602-foot-PHRASE-PEN-PASSTHROUGH: 선택/이동 모드에서만 노출 */}
          {isSelectTool && hasSelectedItems && (
            <div className="flex items-center gap-1 px-2 py-1 rounded bg-red-50 border border-red-300 text-[11px] text-red-700">
              <CheckSquare className="h-3 w-3" />
              <span>{selectedIds.size}개 선택됨</span>
              <button
                onClick={() => {
                  setPlacedItems((prev) => prev.filter((it) => !selectedIds.has(it.id)));
                  setSelectedIds(new Set());
                }}
                className="ml-1 flex items-center gap-0.5 text-red-500 hover:text-red-700"
              >
                <Trash2 className="h-3 w-3" /> 삭제
              </button>
              <button
                onClick={() => setSelectedIds(new Set())}
                className="ml-1 text-red-400 hover:text-red-700"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}

          {/* 텍스트 도구 안내 */}
          {isTextTool && !textInputPos && (
            <div className="flex items-center gap-1 px-2 py-1 rounded bg-blue-50 border border-blue-300 text-[11px] text-blue-700">
              <span className="animate-pulse">●</span>
              캔버스를 클릭해 텍스트 입력
            </div>
          )}

          {/* 자동채움 배지 — refund_consent(차트번호·성함·날짜) + pen_chart(성함·생년월일) */}
          {/* 자동채움 배지 — refund_consent(차트번호·성함·날짜) + pen_chart(성함·주민번호) */}
          {activeDrawTemplate && (isRefundConsentKey(activeDrawTemplate.form_key) || activeDrawTemplate.form_key === 'pen_chart') && customerName && (
            <div className="flex items-center gap-1 px-2 py-1 rounded bg-blue-50 border border-blue-200 text-[11px] text-blue-700"
              title={activeDrawTemplate.form_key === 'pen_chart'
                ? `성명·주민번호가 양식 상단에 자동 채워졌습니다${customerRrn ? '' : ' (주민번호 미등록)'}`
                : '차트번호·성명·날짜가 양식에 자동 채워졌습니다'
              }
            >
              ✓ 자동채움: {customerName}
              {activeDrawTemplate.form_key === 'pen_chart' && customerRrn && (
                <span className="text-blue-500"> · {customerRrn}</span>
              )}
            </div>
          )}

          {/* ── 펜 색상 (펜/상용구/텍스트 모드) ── */}
          {(activeTool === 'pen' || activeTool === 'text' || activeTool === 'boilerplate-placing') && (
            <div className="flex items-center gap-1">
              {PEN_COLORS.map((c) => (
                <button
                  key={c.value}
                  onClick={() => setPenColor(c.value)}
                  className={cn(
                    'h-5 w-5 rounded-full border-2 transition',
                    penColor === c.value ? 'border-gray-600 scale-110' : 'border-transparent hover:border-gray-400',
                  )}
                  style={{ backgroundColor: c.value }}
                  title={c.label}
                />
              ))}
            </div>
          )}

          {/* V3 C-1: 굵기 슬라이더 max 8→5 */}
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <span>굵기</span>
            <input
              type="range" min={1} max={5} step={0.5} value={penSize}
              onChange={(e) => setPenSize(parseFloat(e.target.value))}
              className="w-16"
            />
            <span className="tabular-nums w-4">{penSize}</span>
          </div>

          <div className="ml-auto flex gap-1.5">
            {/* T-20260602-foot-PENCHART-LOCK-PANZOOM: 차트 고정/잠금 토글 (빨간X) —
                ON 시 캔버스 touchAction:'none' + 컨테이너 overflow:hidden 게이팅으로
                펜/형광펜 드로잉 중 pan/zoom·스크롤 완전 차단 (AC-1·2·4) */}
            <button
              onClick={() => setChartLocked((v) => !v)}
              aria-pressed={chartLocked}
              data-testid="penchart-lock-toggle"
              data-locked={chartLocked ? 'true' : 'false'}
              className={cn(
                'flex items-center gap-1 px-2 py-1 rounded text-xs border transition',
                chartLocked
                  ? 'bg-red-600 border-red-700 text-white font-semibold shadow-sm'
                  : 'bg-white border-red-300 text-red-600 hover:bg-red-50',
              )}
              title={chartLocked
                ? '차트 고정됨 — 펜/형광펜 드로잉 중 차트가 움직이지 않습니다. 클릭하여 고정 해제'
                : '차트 고정 — 클릭하면 차트가 고정되어 드로잉 중 pan/zoom이 차단됩니다'}
            >
              <X className="h-3.5 w-3.5" /> {chartLocked ? '고정됨' : '고정'}
            </button>
            {/* Undo */}
            <button
              onClick={handleUndo}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs border border-gray-200 hover:bg-gray-50"
              title="되돌리기 (Undo)"
            >
              <Undo2 className="h-3.5 w-3.5" /> 되돌리기
            </button>
            {/* 초기화 */}
            <button
              onClick={initCanvas}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs border border-gray-200 hover:bg-gray-50"
              title="전체 초기화"
            >
              <RotateCcw className="h-3.5 w-3.5" /> 초기화
            </button>
            {/* 취소 */}
            <Button
              size="sm" variant="outline" className="h-7 text-[11px] px-2"
              onClick={() => {
                if (hasDrawing && !window.confirm('작성 중인 내용이 사라집니다. 취소하시겠습니까?')) return;
                setActiveDrawTemplate(null);
                // T-20260528-foot-PENCHART-NEWWIN: 팝업 모드에서 취소 → 창 닫기
                if (popupMode) { window.close(); return; }
                setMode('list');
              }}
            >
              취소
            </Button>
            {/* 저장 */}
            <Button
              size="sm"
              className="h-7 text-[11px] px-3 bg-purple-600 hover:bg-purple-700"
              onClick={handleDrawSave}
              disabled={saving}
            >
              <Save className="h-3.5 w-3.5 mr-1" />
              {saving ? '저장 중…' : '저장'}
            </Button>
          </div>
        </div>

        {/* 스크롤 콘텐츠 — T-20260602-foot-PENCHART-LOCK-PANZOOM:
            고정 ON 시 overflow:hidden 으로 세로 pan/스크롤 차단 (AC-1) */}
        <div className={cn('flex-1 p-4 space-y-4', chartLocked ? 'overflow-hidden' : 'overflow-auto')}>

        {/* 캔버스 — 2-layer 스택 (고정 ON 시 가로 pan 차단) */}
        <div className={cn('rounded-lg border bg-white p-2', chartLocked ? 'overflow-x-hidden' : 'overflow-x-auto')}>
          <div className="text-[10px] text-muted-foreground mb-1">
            {activeDrawTemplate
              ? `양식: ${activeDrawTemplate.name_ko}`
              : (penChartTemplate ? `템플릿: ${penChartTemplate.name_ko}` : '빈 캔버스 (A4)')}
            {' — 태블릿/마우스로 직접 필기'}
            {isBoilerplatePlacing && (
              <span className="ml-2 text-teal-600 font-medium">클릭하여 상용구 삽입</span>
            )}
            {isTextTool && (
              <span className="ml-2 text-blue-600 font-medium">클릭하여 텍스트 입력 위치 지정</span>
            )}
          </div>

          {/* canvas container — position:relative 로 text overlay 포함 */}
          <div
            style={{ position: 'relative', display: 'inline-block', maxWidth: '100%', border: '1px solid #e2e8f0' }}
          >
            {/* 배경 레이어: natural 해상도 이미지 — pointer 이벤트 없음 */}
            <canvas
              ref={bgCanvasRef}
              style={{
                display: 'block',
                maxWidth: '100%',
                pointerEvents: 'none',
                // AC-1: CSS downscale → GPU 고품질 보간
                imageRendering: 'auto',
              }}
            />
            {/* 드로잉 레이어: 투명 배경 */}
            <canvas
              ref={canvasRef}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                maxWidth: '100%',
                // T-20260602-foot-PENCHART-LOCK-PANZOOM (AC-1·2): 고정 ON → 'none'
                //   → 캔버스 위 모든 제스처(pan/zoom/pinch/스크롤)를 브라우저가 처리하지 않고
                //     전부 pointer 핸들러로 전달 → 펜/형광펜 획만 기입, 차트 안 움직임.
                //   OFF → 'pan-y' (기존 동작: touch 세로 스크롤 허용, AC-3 회귀 없음).
                // ── T-20260609-foot-PENCHART-STROKE-LAG (RC 대표 코드직독 100% 확정 / A안 채택) ──
                //   [RC] 기본 chartLocked=false → touchAction:'pan-y'. 갤탭 WebView가 S펜(pointerType==='pen')
                //   세로 이동 5~20px를 native 세로스크롤 의도로 해석 → pointercancel 발화 → onPointerUp 경로로
                //   drawingRef=false → stroke 강제 종료 = '모든 양식 공통 세로선 뚝뚝 끊김'. touch-action CSS는
                //   pointerType 무관이라 기존 pointerType==='touch' 가드(L928/L1735)로 못 막는다(S펜=pen).
                //   [수정 A안] 드로잉 도구 활성 시 'none'으로 스크롤 하이재킹 차단 → pointercancel 비발생 → 획 연속.
                //   대상=펜/형광펜/지우개 + 화이트(수정펜, 동일 stroke 경로라 동일 결함 → 포함). 텍스트/상용구/이동
                //   도구는 pan-y 유지 → 스크롤 회귀 0(AC-3). chartLocked 토글·저장포맷·렌더경로 무변경.
                touchAction:
                  (activeTool === 'pen' || activeTool === 'highlight' || activeTool === 'eraser' || activeTool === 'white')
                    ? 'none'
                    : chartLocked ? 'none' : 'pan-y',
                cursor: isBoilerplatePlacing ? 'text' : isTextTool ? 'text' : isEraser ? 'cell' : isHighlight ? 'crosshair' : 'crosshair',
                display: 'block',
                // T-20260525-foot-PENCHART-FORM-BLACKSCR REOPEN 3 — 근본 수정:
                //   willChange:'transform' 제거 — GPU compositor layer 불투명화 차단.
                //
                //   원인: b955a8c(PENCHART-PEN-SLOW, 5/24)에서 willChange:'transform' +
                //         desynchronized:true 동시 추가 → draw canvas가 별도 GPU compositor
                //         layer로 승격됨. 이 layer는 불투명(alpha-less) GPU 텍스처로 할당돼
                //         투명 픽셀이 BLACK으로 표시됨 → bgCanvas(양식 이미지)가 가려져 검정화면.
                //
                //   증거:
                //     ① b955a8c 배포(5/24) 다음날(5/25) 첫 검정화면 보고 — 인과 타임라인 일치
                //     ② REOPEN 1 스크린샷: 검정 배경 위 흰 펜획 — drawCanvas 드로잉은 정상,
                //        bgCanvas(이미지)만 불투명 drawCanvas에 가려져 안 보이는 것과 일치
                //     ③ 2f341f1·6ed19d1 drawImage/tiling 수정으로 미해결 — 레이어 문제이므로
                //        drawImage 수정으로는 고칠 수 없음
                //
                //   수정: willChange:'transform' 제거 → GPU compositor layer 미승격 →
                //         drawCanvas는 parent layer 안에서 투명 합성 → bgCanvas가 정상 표시.
                //         desynchronized:true는 유지 — HW 가속은 유지하면서 layer 승격만 차단.
              }}
              onPointerDown={onPointerDown}
              // onPointerMove → Fix-8: native addEventListener (handleNativePointerMove, initDrawCanvas에서 등록)
              onPointerUp={onPointerUp}
              onPointerLeave={onPointerUp}
              onPointerCancel={onPointerUp}
            />

            {/* ── T-20260606-foot-PENCHART-REFUND-LATENCY 현장 캡처형 펜 성능 배지 ──
                REOPEN#3: 기본 ON(첫 획 후 perfDisplay≠null이면 렌더). 화면 우상단 고정 → 현장이 양식별로
                몇 획 긋고 "스크린샷 1장"으로 emptyCoa/avgDraw/frameGap 실병목 판정. pointerEvents:none(드로잉
                비간섭). 옵트아웃 ?penchart_perf=off. RC 확정 후 게이트 복원 예정. */}
            {perfDisplay && (
              <div
                data-testid="penchart-perf-badge"
                style={{
                  position: 'fixed', top: 8, right: 8, zIndex: 9999,
                  background: 'rgba(15,23,42,0.92)', color: '#e2e8f0',
                  font: '11px/1.45 ui-monospace, Menlo, monospace',
                  padding: '8px 10px', borderRadius: 8, maxWidth: 230,
                  pointerEvents: 'none', whiteSpace: 'pre',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
                }}
              >
{`PEN PERF · ${perfDisplay.formKey ?? '-'}
canvas ${perfDisplay.canvas}
strokeMs ${perfDisplay.strokeMs}  moves ${perfDisplay.moves}
coa/move ${perfDisplay.coalescedPerMove}  pts/s ${perfDisplay.inputPtsPerSec}
avgDrawMs ${perfDisplay.avgDrawMs}  (redraw)
frameGap  ${perfDisplay.maxFrameGapMs}ms (jank)
── worst (${perfDisplay.strokes}획) ──
avgDraw ${perfDisplay.wAvgDraw}  gap ${perfDisplay.wFrameGap}ms
minCoa ${perfDisplay.wMinCoa}  strokeMs ${perfDisplay.wStrokeMs}`}
                <div style={{ marginTop: 4, color: '#fcd34d', fontWeight: 600, whiteSpace: 'normal' }}>
                  {perfDisplay.verdict}
                </div>
              </div>
            )}

            {/* T-20260525-foot-PENCHART-FORM-BLACK AC-4: 배경 이미지 로드 실패 폴백 UI */}
            {bgImgLoadError && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'rgba(255,255,255,0.92)',
                  zIndex: 50,
                  gap: 12,
                  borderRadius: 4,
                }}
                data-testid="penchart-bg-load-error"
              >
                <span style={{ fontSize: 32 }}>⚠️</span>
                <p style={{ fontSize: 14, color: '#6b7280', textAlign: 'center', margin: 0 }}>
                  양식 이미지를 불러올 수 없습니다.
                </p>
                {/* T-20260608-foot-PENCHART-FORM-LOAD-FAIL AC-4: 현장용 사유 힌트 —
                    기술코드(E1~E9)는 현장이 해석 불가 → 양식명 + 일시적/영구 분류 + 행동 안내를
                    사람이 읽을 한 줄로 노출. 작업 막힌 현장이 "재시도 vs 관리자 문의"를 즉시 판단. */}
                {(() => {
                  const { hint } = classifyBgImgError(bgImgErrorReason);
                  const formName = activeDrawTemplate?.name_ko;
                  return (
                    <p
                      data-testid="penchart-bg-error-hint"
                      style={{ fontSize: 13, color: '#4b5563', textAlign: 'center', maxWidth: 320, lineHeight: 1.5, margin: 0 }}
                    >
                      {formName ? `${formName} — ` : ''}{hint}
                    </p>
                  );
                })()}
                {/* T-20260608-foot-PENCHART-REFUND-FORMIMG AC-2: 실패 단계 코드 화면 노출 —
                    Galaxy Tab은 DevTools 콘솔 캡처 불가(LATENCY 메타-루트코즈) → 스크린샷 1장으로
                    8개 실패 stage(E1~E9) 중 실제 원인을 가른다. b5a7979 펜 성능 배지와 동일 전략. */}
                {bgImgErrorReason && (
                  <code
                    data-testid="penchart-bg-error-reason"
                    style={{
                      fontSize: 11,
                      lineHeight: 1.4,
                      color: '#9ca3af',
                      fontFamily: 'ui-monospace, Menlo, monospace',
                      textAlign: 'center',
                      maxWidth: 320,
                      wordBreak: 'break-all',
                      margin: 0,
                    }}
                  >
                    {bgImgErrorReason}
                  </code>
                )}
                <button
                  style={{
                    marginTop: 4,
                    padding: '6px 16px',
                    borderRadius: 6,
                    border: '1px solid #7c3aed',
                    background: '#ede9fe',
                    color: '#5b21b6',
                    fontSize: 13,
                    cursor: 'pointer',
                  }}
                  onClick={initCanvas}
                >
                  다시 시도
                </button>
              </div>
            )}

            {/* T-20260522-foot-PENCHART-TOOLS-V2 AC-3: 텍스트 입력 오버레이 */}
            {textInputPos && (
              <div
                style={{
                  position: 'absolute',
                  left: Math.min(textInputPos.cssX, CANVAS_W - 220),
                  top: Math.min(textInputPos.cssY, canvasH - 140),
                  zIndex: 30,
                  background: 'white',
                  border: '2px solid #7c3aed',
                  borderRadius: 8,
                  padding: 8,
                  boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
                  minWidth: 210,
                  pointerEvents: 'all',
                }}
                onPointerDown={(e) => e.stopPropagation()} // 오버레이 클릭이 캔버스로 전파되지 않도록
              >
                <div className="text-[11px] text-purple-700 font-semibold mb-1.5 flex items-center gap-1">
                  <TextCursorInput className="h-3 w-3" /> 텍스트 입력
                </div>
                <textarea
                  ref={textAreaRef}
                  autoFocus
                  rows={3}
                  value={textInputValue}
                  onChange={(e) => setTextInputValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleTextConfirm(); }
                    if (e.key === 'Escape') { setTextInputPos(null); setTextInputValue(''); }
                  }}
                  placeholder={'텍스트 입력\n(Enter: 삽입 / Shift+Enter: 줄바꿈)'}
                  className="w-full resize-none text-xs border border-gray-200 rounded p-1.5 outline-none focus:border-purple-400"
                  style={{ minHeight: 64 }}
                />
                <div className="flex gap-1.5 mt-1.5">
                  <button
                    onClick={handleTextConfirm}
                    className="flex-1 rounded bg-purple-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-purple-700 transition"
                  >
                    삽입
                  </button>
                  <button
                    onClick={() => { setTextInputPos(null); setTextInputValue(''); }}
                    className="flex-1 rounded bg-gray-100 px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-200 transition"
                  >
                    취소
                  </button>
                </div>
              </div>
            )}

            {/* V3 AC-7~9, AC-13~16: 배치된 아이템 오버레이 (텍스트·상용구 드래그·삭제·다중선택) */}
            {placedItems.map((item) => {
              const isSelected = selectedIds.has(item.id);
              const lineH = item.fontSize + 6;
              const lines = item.text.split('\n');
              const approxH = lines.length * lineH + 8;
              return (
                <PlacedItemOverlay
                  key={item.id}
                  item={item}
                  isSelected={isSelected}
                  approxH={approxH}
                  interactive={isSelectTool}
                  onSelect={(id, multi) => {
                    setSelectedIds((prev) => {
                      const next = new Set(prev);
                      if (multi) {
                        if (next.has(id)) next.delete(id); else next.add(id);
                      } else {
                        if (next.has(id) && next.size === 1) next.clear();
                        else { next.clear(); next.add(id); }
                      }
                      return next;
                    });
                  }}
                  onMove={(id, dx, dy) => {
                    setPlacedItems((prev) =>
                      prev.map((it) => it.id === id ? { ...it, x: it.x + dx, y: it.y + dy } : it)
                    );
                  }}
                  onDelete={(id) => {
                    setPlacedItems((prev) => prev.filter((it) => it.id !== id));
                    setSelectedIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
                  }}
                />
              );
            })}
          </div>
        </div>

        {/* T-20260523-foot-PENCHART-FORM-AUTOFILL AC-R4: 하단 별도 서명란 제거
            현장 피드백: "하단 별도 서명란 불필요 제거" — 서명은 캔버스 위에 직접 기입하는 방식으로 통일 */}
        </div>{/* end 스크롤 콘텐츠 */}
      </div>
        )}
      </FullscreenFormWrapper>
    );
  }

  // ─────────────────────────────────────────────────────────────────────
  // 렌더: list 모드 (저장된 차트 목록)
  // ─────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-3">
      <div className="rounded-lg border bg-white p-3 text-xs">
        <div className="flex items-center justify-between mb-3">
          <span className="flex items-center gap-1.5 font-bold text-purple-800">
            <span className="h-2 w-2 rounded-full bg-purple-500" />
            보험차트 — 양식 작성
          </span>
          <Button
            size="sm"
            className="h-7 text-[11px] px-3 bg-purple-600 hover:bg-purple-700"
            onClick={() => {
              // T-20260528-foot-PENCHART-NEWWIN: window.open 별도 창으로 전환
              // iPad Safari popup blocker: window.open을 click handler 안에서 동기 호출 필수
              const params = new URLSearchParams({ customerId, clinicId });
              if (checkInId) params.set('checkInId', checkInId);
              const url = `/penchart-editor?${params.toString()}`;
              const popup = window.open(url, `penchart-${customerId}`, 'width=1200,height=900,scrollbars=yes,resizable=yes');
              if (!popup) {
                // 팝업 차단됨 (iPad Safari 엄격 모드 등) → 안내 메시지 + fullscreen modal fallback
                toast.warning('팝업이 차단되었습니다. 현재 화면에서 작성 창이 열립니다.\n(브라우저 주소창 팝업 허용 후 재시도하면 별도 창으로 열립니다.)');
                setMode('select');
              }
            }}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            새 차트 작성
          </Button>
        </div>

        {/* 양식 종류 뱃지 */}
        <div className="mb-2 flex flex-wrap gap-1.5">
          <span className="rounded bg-purple-50 border border-purple-100 px-2 py-0.5 text-[11px] text-purple-700">
            📝 펜차트 (필기)
          </span>
          <span className="rounded bg-teal-50 border border-teal-100 px-2 py-0.5 text-[11px] text-teal-700">
            📋 발건강 질문지 (일반)
          </span>
          <span className="rounded bg-emerald-50 border border-emerald-100 px-2 py-0.5 text-[11px] text-emerald-700">
            📋 발건강 질문지 (어르신용)
          </span>
          <span className="rounded bg-rose-50 border border-rose-100 px-2 py-0.5 text-[11px] text-rose-700">
            📋 환불/비급여 동의서 (3p)
          </span>
        </div>

        {savedCharts.length === 0 ? (
          <div className="py-6 text-center text-muted-foreground border border-dashed rounded">
            저장된 펜차트 없음
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {savedCharts.map((chart) => (
              <div
                key={chart.name}
                className={cn(
                  'relative rounded border cursor-pointer overflow-hidden',
                  selectedChart?.name === chart.name
                    ? 'border-purple-400 ring-1 ring-purple-300'
                    : 'border-gray-200 hover:border-purple-300',
                )}
                onClick={() => setSelectedChart(chart.name === selectedChart?.name ? null : chart)}
              >
                <img
                  src={chart.url}
                  alt={chart.name}
                  className="w-full object-cover"
                  style={{ maxHeight: 200 }}
                />
                <div className="absolute bottom-0 left-0 right-0 bg-black/40 text-white text-[10px] px-1.5 py-1 flex items-center justify-between">
                  <span>
                    {chart.uploadedAt ? format(new Date(chart.uploadedAt), 'MM-dd HH:mm') : chart.name}
                  </span>
                  <div className="flex gap-1">
                    <a
                      href={chart.url}
                      download={chart.name}
                      onClick={(e) => e.stopPropagation()}
                      className="text-white/80 hover:text-white"
                    >
                      <Download className="h-3 w-3" />
                    </a>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(chart); }}
                      className="text-red-300 hover:text-red-100"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 선택된 차트 확대 뷰 */}
      {selectedChart && (
        <div className="rounded-lg border bg-white p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-muted-foreground">
              {selectedChart.uploadedAt
                ? format(new Date(selectedChart.uploadedAt), 'yyyy-MM-dd HH:mm')
                : selectedChart.name}
            </span>
            <button onClick={() => setSelectedChart(null)} className="text-xs text-muted-foreground hover:text-foreground">
              닫기
            </button>
          </div>
          <img src={selectedChart.url} alt="펜차트" className="w-full rounded border" />
        </div>
      )}

      {/* T-20260529-foot-HEALTH-Q-MOBILE: 발건강질문지 모바일 자가작성 결과 + 링크 발급 */}
      {!popupMode && (
        <div className="rounded-lg border bg-white p-3 text-xs">
          <HealthQResultsPanel
            customerId={customerId}
            clinicId={clinicId}
            checkInId={checkInId}
          />
        </div>
      )}
    </div>
  );
}
