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
  GripVertical, CheckSquare,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
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
//   refund_consent.png 2481×10524 → canvas 794×3369 (scale=0.32)
//   PNG 픽셀 분석: "● 차트번호 :" 라벨 텍스트 = canvas y=201, 라벨 끝(코론 우측) = canvas x≈176
//                 "● 환자이름 :" 라벨 텍스트 = canvas y=236
//   기존 y=155/188 → 라벨(y=201/236) 위에 겹침 확인(스크린샷 110451). y 46px 상향 오류 수정.
const REFUND_AUTOFILL_POS_P1: Array<{ key: keyof AutofillFields; x: number; y: number }> = [
  { key: 'chartNumber', x: 182, y: 201 }, // page 1: ● 차트번호 : ___ (라벨 우측 빈칸, 라벨 동일 라인)
  { key: 'name',        x: 182, y: 236 }, // page 1: ● 환자이름 : ___ (라벨 동일 라인)
];

// ── 환불동의서 P3 날짜 분리 렌더링 (AC-R5) ──
// T-20260523-foot-PENCHART-FORM-AUTOFILL AC-R5: 날짜 "년/월/일" 분리 배치
//   PNG 픽셀 분석: "년" at canvas x≈544, "월" at canvas x≈614, "일" at canvas x≈678
//                 날짜 라인: canvas y≈3071
//   기존: "2026. 5. 24." 전체를 x=440 에 배치 → "2026." 우측이 "년" 와 겹침 수정
//   수정: 연/월/일 각각 우측 정렬로 해당 마커 바로 앞에 배치
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
  if (year)  ctx.fillText(year,  537, DATE_Y); // "년"(x≈544) 7px 전
  if (month) ctx.fillText(month, 607, DATE_Y); // "월"(x≈614) 7px 전
  if (day)   ctx.fillText(day,   671, DATE_Y); // "일"(x≈678) 7px 전
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
type ActiveTool = 'pen' | 'eraser' | 'white' | 'text' | 'highlight' | 'boilerplate-placing';

// T-20260522-foot-PENCHART-TOOLS-V3: 도구별 기본 굵기
const DEFAULT_THICKNESS: Record<ActiveTool, number> = {
  pen:                  1.5,
  eraser:               3,
  white:                3,
  text:                 2,
  highlight:            2,
  'boilerplate-placing': 1.5,
};

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
  item, isSelected, approxH, onSelect, onMove, onDelete,
}: {
  item: PlacedItem;
  isSelected: boolean;
  approxH: number;
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
        cursor: 'grab',
        userSelect: 'none',
        zIndex: 20,
        border: isSelected ? '1.5px dashed #7c3aed' : '1px dashed transparent',
        borderRadius: 4,
        padding: '2px 4px',
        background: isSelected ? 'rgba(124,58,237,0.04)' : 'transparent',
        boxSizing: 'border-box',
        touchAction: 'none',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
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
      {/* 아이템 우상단 — 삭제 버튼 (선택 시 표시) */}
      {isSelected && (
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
      {/* 드래그 핸들 힌트 (선택 시 표시) */}
      {isSelected && (
        <div style={{
          position: 'absolute',
          top: -10,
          left: -2,
          color: '#7c3aed',
          fontSize: 9,
          pointerEvents: 'none',
        }}>
          <GripVertical style={{ width: 10, height: 10 }} />
        </div>
      )}
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
  const [mode, setMode] = useState<TabMode>('list');
  /** draw 모드에서 현재 활성 양식 (pen_chart | health_questionnaire_* | refund_consent) */
  const [activeDrawTemplate, setActiveDrawTemplate] = useState<Template | null>(null);
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
  // T-20260523-foot-PENCHART-PEN-SLOW Fix-3: getBoundingClientRect 캐싱 — 획 동안 재사용, onPointerMove마다 강제 레이아웃 제거
  const strokeRectRef = useRef<DOMRect | null>(null);
  // T-20260523-foot-PENCHART-PEN-SLOW Fix-4: white 도구 획 경로 — onPointerUp에서 한 번만 hit-test
  const whiteStrokePathRef = useRef<Array<{ x: number; y: number }>>([]);

  // T-20260519-foot-PENCHART-FORM-ADD (FIX): Undo 10단계
  const undoStackRef = useRef<ImageData[]>([]);
  const UNDO_LIMIT = 10;
  // T-20260524-foot-PENCHART-PEN-SLOW Fix-5: async pre-capture — getImageData를 획 시작(hot path) 밖으로 이동
  // 매 onPointerUp 후 rAF에서 캡처 → onPointerDown 시 이미 준비된 ImageData를 stack에 적재 (sync 없음)
  const pendingUndoDataRef = useRef<ImageData | null>(null);
  const pendingUndoRafRef  = useRef<number | null>(null);

  // T-20260523-foot-PENCHART-FORM-AUTOFILL AC-R4: 서명 캡처 UI 제거 — signature_base64 항상 null

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

  // ── 캔버스 초기화 ─────────────────────────────────────────────────────
  // 2-layer canvas 구조:
  //   bgCanvasRef (아래) — 양식 배경 이미지 전용. 지우개 미적용.
  //   canvasRef   (위)   — 드로잉 전용 (투명 배경). clearRect 지우개 → bgCanvas 노출.
  //
  // T-20260522-foot-PENCHART-TOOLS-V2 AC-1 / T-20260523-foot-FORM-TEMPLATE-REGEN:
  //   bgCanvas = CANVAS_W*DRAW_DPR × canvasH*DRAW_DPR 고정 (= 1588×2246)
  //   소스 300DPI 이미지 → HQ downsample → bgCanvas. drawCanvas와 1:1 합성 보장.

  /** 배경 레이어 초기화: 300DPI 원본을 CANVAS_W×canvasH 논리 크기로 다운샘플
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
    if (!ctx) return;
    const canvasH = getCanvasHeightForForm(activeDrawTemplate?.form_key);

    // T-20260523-foot-PENCHART-PEN-SLOW Fix-1:
    //   최종 물리 해상도(CANVAS_W*DRAW_DPR × canvasH*DRAW_DPR)로 즉시 확정 →
    //   img.onload 시 canvas.width 재할당(= 레이아웃 강제 재계산) 없음
    canvas.width  = CANVAS_W * DRAW_DPR;
    canvas.height = canvasH  * DRAW_DPR;
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

    if (bgUrl) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        // T-20260523-foot-PENCHART-PEN-SLOW Fix-1:
        //   canvas.width/height 재할당 없음 — 이미 CANVAS_W*DRAW_DPR × canvasH*DRAW_DPR 확정.
        //   ctx transform도 이미 scale(DRAW_DPR, DRAW_DPR) 적용됨 — 리셋 없이 redraw만 수행.
        //
        // T-20260523-foot-FORM-TEMPLATE-REGEN: 300DPI 소스(2481×3508) → 논리 CANVAS_W×canvasH 다운샘플
        //   imageSmoothingQuality=high (Lanczos-equivalent) → 선명도 보장
        ctx.clearRect(0, 0, CANVAS_W, canvasH);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, CANVAS_W, canvasH);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, CANVAS_W, canvasH);
        // T-20260523-foot-PENCHART-FORM-AUTOFILL: positions 기반 범용 자동채움
        // bgCanvas가 CANVAS_W×canvasH 논리이므로 scaleX/scaleY=1 (CSS 좌표 그대로)
        if (autofillDataRef.current) {
          const fk = activeDrawTemplate?.form_key ?? '';
          if (isRefundConsentKey(fk)) {
            // 환불동의서: page 1 (차트번호·환자이름) + page 3 (날짜 분리 배치)
            // AC-R5: P1 좌표 재보정 + P3 날짜 년/월/일 분리 우측정렬
            drawAutofillOnCtx(ctx, autofillDataRef.current, REFUND_AUTOFILL_POS_P1);
            drawRefundP3DateAutofill(ctx, autofillDataRef.current);
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
    // T-20260523-foot-PENCHART-PEN-SLOW: desynchronized=true → compositor와 독립 업데이트 → 펜 지연 감소
    const ctx = canvas.getContext('2d', { desynchronized: true });
    if (!ctx) return;
    // T-20260523-foot-PENCHART-PEN-SLOW Fix-2: ctx 캐싱 → onPointerMove마다 getContext 불필요
    drawCtxRef.current = ctx;
    const dpr = DRAW_DPR; // 강제 2x — device DPR 무관
    const canvasH = getCanvasHeightForForm(activeDrawTemplate?.form_key);

    canvas.width = CANVAS_W * dpr;
    canvas.height = canvasH * dpr;
    canvas.style.width = `${CANVAS_W}px`;
    canvas.style.height = `${canvasH}px`;
    ctx.scale(dpr, dpr);
    // 드로잉 레이어는 투명으로 시작 — fillRect 없음
  }, [activeDrawTemplate]);

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
    initBgCanvas();
    initDrawCanvas();
    emptyRef.current = true;
    hasDrawingRef.current = false; // T-20260523-foot-PENCHART-PEN-SLOW
    setHasDrawing(false);
    setActiveTool('pen');
    setPenSize(DEFAULT_THICKNESS.pen);
    setPendingBoilerplate('');

    setShowPhrasePanel(false);
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

  useEffect(() => {
    if (mode === 'draw') {
      const t = setTimeout(initCanvas, 50);
      return () => clearTimeout(t);
    }
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
    const dpr = DRAW_DPR; // 강제 2x — initDrawCanvas와 동일
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
    if (e.pointerType === 'touch') return;
    e.preventDefault();
    e.stopPropagation();
    const canvas = canvasRef.current;
    if (!canvas) return;
    // T-20260524-foot-PENCHART-PEN-SLOW Fix-6: rect 먼저 캐싱 → getPos가 재사용 (getBoundingClientRect 1회만)
    strokeRectRef.current = canvas.getBoundingClientRect();
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

  // T-20260522-foot-PENCHART-TOOLS-V2 AC-2: getCoalescedEvents() 활용
  // 프레임 사이 중간 포인터 위치를 모두 수집 → 빠른 펜 동작에서 획 누락 방지
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'touch') return;
    if (activeTool === 'text' || activeTool === 'boilerplate-placing') return;
    if (!drawingRef.current) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    // T-20260523-foot-PENCHART-PEN-SLOW Fix-2: 캐싱된 ctx 사용 → getContext 반복 호출 제거
    const ctx = drawCtxRef.current ?? canvas.getContext('2d');
    if (!ctx) return;

    // T-20260523-foot-PENCHART-PEN-SLOW Fix-3: strokeRectRef 캐시 사용 → getBoundingClientRect 강제 레이아웃 제거
    // strokeRectRef는 onPointerDown에서 한 번 계산 → 획 동안 재사용
    const rect = strokeRectRef.current ?? canvas.getBoundingClientRect();
    // T-20260522-foot-PENCHART-TOOLS-V2 AC-1: DRAW_DPR=2 강제 (device DPR 무관)
    const dpr = DRAW_DPR;
    const scaleX = (canvas.width / dpr) / rect.width;
    const scaleY = (canvas.height / dpr) / rect.height;
    const toLogical = (ev: PointerEvent) => ({
      x: (ev.clientX - rect.left) * scaleX,
      y: (ev.clientY - rect.top)  * scaleY,
    });

    // AC-2: coalesced events — 중간 좌표 모두 처리
    const events: PointerEvent[] = (e.nativeEvent as any).getCoalescedEvents?.() ?? [e.nativeEvent];

    for (const evt of events) {
      const pos = toLogical(evt);
      const last = lastPosRef.current ?? pos;

      if (activeTool === 'eraser') {
        // V3 AC-3: 드로잉 레이어만 clearRect → bg(상용구 템플릿) 보존, placedItems 미삭제
        const sz = penSize * 4;
        ctx.clearRect(pos.x - sz, pos.y - sz, sz * 2, sz * 2);
      } else if (activeTool === 'white') {
        // T-20260522-foot-PENCHART-TOOL-UX AC-3: 화이트 — source-over 흰색 선
        ctx.save();
        ctx.globalCompositeOperation = 'source-over';
        ctx.beginPath();
        ctx.moveTo(last.x, last.y);
        ctx.lineTo(pos.x, pos.y);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = penSize * 8;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
        ctx.restore();
        emptyRef.current = false;
        // T-20260523-foot-PENCHART-PEN-SLOW: 첫 획 전환 시에만 setHasDrawing → React 재렌더 최소화
        if (!hasDrawingRef.current) { hasDrawingRef.current = true; setHasDrawing(true); }
        // T-20260523-foot-PENCHART-PEN-SLOW Fix-4: placedItems hit-test를 onPointerMove에서 제거 →
        //   onPointerMove마다 setPlacedItems(React re-render) 없음. 포인트만 누적 → onPointerUp에서 1회 처리.
        whiteStrokePathRef.current.push(pos);
      } else if (activeTool === 'highlight') {
        // V3 AC-10~11: 투명도 35%→20%
        ctx.beginPath();
        ctx.moveTo(last.x, last.y);
        ctx.lineTo(pos.x, pos.y);
        ctx.globalAlpha = 0.20;
        ctx.strokeStyle = highlightColor;
        ctx.lineWidth = penSize * 6 + 6;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
        ctx.globalAlpha = 1;
        emptyRef.current = false;
        // T-20260523-foot-PENCHART-PEN-SLOW: 첫 획 전환 시에만 setHasDrawing → React 재렌더 최소화
        if (!hasDrawingRef.current) { hasDrawingRef.current = true; setHasDrawing(true); }
      } else {
        // T-20260522-foot-PENCHART-TOOL-UX AC-1: 펜 — quadratic bezier 스무딩 (글씨 인식 개선)
        // midpoint bezier: 연속 획 사이를 곡선으로 연결 → 자연스러운 글씨체
        const mid = { x: (last.x + pos.x) / 2, y: (last.y + pos.y) / 2 };
        ctx.beginPath();
        if (lastMidRef.current) {
          // 이전 midpoint에서 현재 midpoint까지 — last를 bezier 제어점으로 사용
          ctx.moveTo(lastMidRef.current.x, lastMidRef.current.y);
          ctx.quadraticCurveTo(last.x, last.y, mid.x, mid.y);
        } else {
          // 첫 세그먼트는 직선
          ctx.moveTo(last.x, last.y);
          ctx.lineTo(mid.x, mid.y);
        }
        ctx.globalAlpha = 1;
        ctx.strokeStyle = penColor;
        ctx.lineWidth = penSize;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
        lastMidRef.current = mid; // 다음 세그먼트 시작점 = 현재 midpoint
        emptyRef.current = false;
        // T-20260523-foot-PENCHART-PEN-SLOW: 첫 획 전환 시에만 setHasDrawing → React 재렌더 최소화
        if (!hasDrawingRef.current) { hasDrawingRef.current = true; setHasDrawing(true); }
      }
      lastPosRef.current = pos;
    }
  };

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

  // ── 양식 선택 ─────────────────────────────────────────────────────────
  const handleSelectTemplate = (tpl: Template) => {
    setActiveDrawTemplate(tpl);
    setMode('draw');
  };

  // ─────────────────────────────────────────────────────────────────────
  // 렌더: select 모드 (양식 선택 패널)
  // ─────────────────────────────────────────────────────────────────────
  if (mode === 'select') {
    return (
      <FullscreenFormWrapper
        open={true}
        onOpenChange={(open) => { if (!open) setMode('list'); }}
      >
        <div className="h-full overflow-auto p-4 bg-white">
        <div className="max-w-lg mx-auto space-y-3">
        <div className="rounded-lg border bg-white p-3">
          <div className="flex items-center gap-2 mb-3">
            <button
              onClick={() => setMode('list')}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="h-3.5 w-3.5" /> 목록으로
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
      </FullscreenFormWrapper>
    );
  }

  // ─────────────────────────────────────────────────────────────────────
  // 렌더: draw 모드 (캔버스 필기)
  // ─────────────────────────────────────────────────────────────────────
  if (mode === 'draw') {
    const canvasH = getCanvasHeightForForm(activeDrawTemplate?.form_key);
    const isEraser    = activeTool === 'eraser';
    const isWhite     = activeTool === 'white';
    const isHighlight = activeTool === 'highlight';
    const isTextTool  = activeTool === 'text';
    const isBoilerplatePlacing = activeTool === 'boilerplate-placing';
    const hasSelectedItems = selectedIds.size > 0;

    return (
      <FullscreenFormWrapper
        open={true}
        onOpenChange={(open) => {
          if (!open) {
            if (hasDrawing && !window.confirm('작성 중인 내용이 사라집니다. 취소하시겠습니까?')) return;
            setActiveDrawTemplate(null);
            setMode('list');
          }
        }}
      >
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
                className="absolute top-8 left-0 z-20 w-64 rounded-lg border bg-white shadow-lg overflow-hidden"
                data-testid="phrase-library-panel"
              >
                {/* T-20260522-foot-PENCHART-TOOL-UX AC-6: 패널 헤더 중복 라벨 제거 (버튼에 이미 "상용구" 표시됨) */}
                <div className="flex items-center justify-end px-2 py-1 bg-teal-50 border-b">
                  <button
                    onClick={() => setShowPhrasePanel(false)}
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
                          onClick={() => setPhraseCategory(key)}
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

                  {/* 우: 상용구 목록 */}
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
                        .map((phrase) => (
                          <button
                            key={phrase.id}
                            onClick={() => {
                              handleBoilerplateSelect(phrase.content);
                              setShowPhrasePanel(false);
                            }}
                            className="w-full text-left px-2.5 py-1.5 text-[11px] hover:bg-teal-50 border-b border-gray-100 last:border-0 transition"
                            data-testid={`phrase-item-${phrase.id}`}
                          >
                            <div className="font-medium text-gray-800 truncate">{phrase.name}</div>
                            <div className="text-gray-400 mt-0.5 text-[10px] truncate">
                              {phrase.content.split('\n')[0]}
                            </div>
                          </button>
                        ))
                    )}
                  </div>
                </div>
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

          {/* V3: 배치된 아이템 다중선택 삭제 */}
          {hasSelectedItems && (
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

        {/* 스크롤 콘텐츠 */}
        <div className="flex-1 overflow-auto p-4 space-y-4">

        {/* 캔버스 — 2-layer 스택 */}
        <div className="rounded-lg border bg-white p-2 overflow-x-auto">
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
                touchAction: 'pan-y',
                cursor: isBoilerplatePlacing ? 'text' : isTextTool ? 'text' : isEraser ? 'cell' : isHighlight ? 'crosshair' : 'crosshair',
                display: 'block',
                // T-20260523-foot-PENCHART-PEN-SLOW: GPU 레이어 승격 → 펜 획 합성 지연 감소
                willChange: 'transform',
              }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={onPointerUp}
              onPointerCancel={onPointerUp}
            />

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
            펜차트 — 양식 작성
          </span>
          <Button
            size="sm"
            className="h-7 text-[11px] px-3 bg-purple-600 hover:bg-purple-700"
            onClick={() => setMode('select')}
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
    </div>
  );
}
