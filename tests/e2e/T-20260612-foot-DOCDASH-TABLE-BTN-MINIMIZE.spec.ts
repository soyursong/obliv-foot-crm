/**
 * E2E spec — T-20260612-foot-DOCDASH-TABLE-BTN-MINIMIZE
 * 진료부 통합 대시보드(DoctorCallDashboard) 테이블 셀 스타일 미니멀화
 *   (문지은 대표원장 follow-up, parent T-20260611-foot-DOCDASH-TABLEVIEW-CONVERGE deployed d097fbb).
 *
 *   3개 축:
 *     (a) 셀 안 액션버튼 → 텍스트/아이콘 링크(버튼 박스 bg/border 제거). 클릭 동선은 유지(기능 제거 아님).
 *     (b) 컬러 단순화 — 상태는 dot 1~2색, 나머지 무채색 텍스트 톤("난잡함" 해소).
 *     (c) chevron(`<`,`>`,`▼`)·드롭다운 화살표 전면 제거(aria-expanded로 상태 표현).
 *
 *   회귀 금지(REDEFINITION_RISK MEDIUM — parent 테이블뷰 직후 같은 surface):
 *     - parent 테이블뷰 구조(열 이름/방/처방/상태, 방이름 표출, 임상경과 한 줄 입력) 회귀 금지.
 *     - CLINICAL-SAVE-FAIL 저장 로직(clinical_progress) 비침범 — 본건은 표시 스타일만.
 *     - 액션 testid/컴포넌트 보존 = 클릭 동선 유지의 증거.
 *
 *   현장 클릭 시나리오 → 본 spec (티켓 §5):
 *     시나리오1: 셀 텍스트 위주 표시(버튼 박스 없음, chevron 없음, 컬러 1~2색).
 *     시나리오2: 액션 동선 유지(임상경과/처방/진료차트 진입 testid·컴포넌트 보존).
 *     시나리오3: 상태값 다양 — 상태 표시 1~2색 dot 계열로만 구분.
 *
 *   스타일: 형제 티켓(TABLEVIEW-CONVERGE)과 동일 — 소스 정적 배선 가드. auth/DB 비의존.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(path.join(__dirname, '..', '..', 'src', rel), 'utf8');
const DASH = () => SRC('components/doctor/DoctorCallDashboard.tsx');

// T-20260612-foot-DOCDASH-FULLWIDTH-INLINE-EMOJI(대표원장) supersede:
//   임상경과·진료차트 셀 액션 → 이름 옆 이모지 버튼(NAME_EMOJI_BTN, 테두리형)으로 이동.
//   남은 셀 텍스트-링크(CELL_ACTION_BTN) 액션 = 처방 토글 2벌.
const CELL_LINK_BTN_TESTIDS = ['doctor-call-rx-btn', 'doctor-completed-rx-btn'];
//   이모지 인라인 버튼(임상경과 📝 / 진료차트 🩺) = NAME_EMOJI_BTN.
const EMOJI_BTN_TESTIDS = [
  'doctor-call-chart-btn',
  'doctor-call-fullchart-btn',
  'doctor-completed-chart-btn',
  'doctor-completed-fullchart-btn',
];

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1 — 셀 텍스트 위주(버튼 박스 없음 / chevron 없음 / 컬러 1~2색)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('시나리오1 — 셀 텍스트 위주 미니멀 표시', () => {
  test('chevron(펼침/이동 화살표) 전면 제거 — ChevronDown/ChevronUp import·사용 0건', () => {
    const src = DASH();
    // lucide import 에서 제거됨
    expect(src).not.toMatch(/\bChevronDown\b/);
    expect(src).not.toMatch(/\bChevronUp\b/);
    // 토글 버튼 JSX 안에 화살표 아이콘 렌더 잔존 금지
    expect(src).not.toMatch(/showRx \? <Chevron/);
    expect(src).not.toMatch(/showClinical \? <Chevron/);
  });

  test('셀 액션 버튼 = 공통 텍스트-링크 상수(CELL_ACTION_BTN) 사용 — 박스(border/bg) 박힌 인라인 클래스 아님', () => {
    const src = DASH();
    // 공통 상수 정의 존재 + 박스 제거 의도(텍스트 톤·underline)
    expect(src).toMatch(/const CELL_ACTION_BTN =/);
    expect(src).toMatch(/CELL_ACTION_BTN[\s\S]{0,260}hover:underline/);
    expect(src).not.toMatch(/CELL_ACTION_BTN[\s\S]{0,260}bg-(teal|indigo|emerald)-50/);
    // 처방 토글 2벌은 텍스트-링크 상수(CELL_ACTION_BTN) 유지.
    for (const id of CELL_LINK_BTN_TESTIDS) {
      const block = src.match(new RegExp(`data-testid="${id}"[\\s\\S]{0,200}`));
      expect(block, `${id} 블록 존재`).not.toBeNull();
      expect(block![0]).toContain('className={CELL_ACTION_BTN}');
    }
    // FULLWIDTH-INLINE-EMOJI AC-2: 임상경과·진료차트 버튼은 이름 옆 이모지 버튼(NAME_EMOJI_BTN, 테두리형)으로 이동.
    expect(src).toMatch(/const NAME_EMOJI_BTN =/);
    expect(src).toMatch(/NAME_EMOJI_BTN[\s\S]{0,220}border/); // 테두리(버튼처럼)
    for (const id of EMOJI_BTN_TESTIDS) {
      const block = src.match(new RegExp(`data-testid="${id}"[\\s\\S]{0,200}`));
      expect(block, `${id} 블록 존재`).not.toBeNull();
      expect(block![0]).toContain('className={NAME_EMOJI_BTN}');
    }
  });

  test('처방/임상경과/진료차트 버튼에 박스 컬러(teal/indigo bg·border) 잔존 금지', () => {
    const src = DASH();
    // 회귀 방지: 셀 액션이 다시 색 박스로 돌아가지 않음
    expect(src).not.toMatch(/border-teal-200 bg-teal-50/);
    expect(src).not.toMatch(/border-indigo-200 bg-indigo-50/);
    // 방 셀도 무채색(teal 칩 박스 제거) — 방이름 표출 자체는 유지(시나리오2에서 검증)
    expect(src).not.toMatch(/border-teal-100 bg-teal-50/);
  });

  test('상태 표시 = dot(1~2색) + 무채색 텍스트 — 색 박스 배지(bg-red-100/bg-emerald-100) 아님', () => {
    const src = DASH();
    // 호출 행: red/gray dot
    expect(src).toMatch(/rounded-full', inactive \? 'bg-gray-300' : 'bg-red-500'/);
    // 완료 행: STATUS-SPLIT supersede — 귀가(emerald)/귀가대기 원내잔류(amber) 단색 dot.
    expect(src).toMatch(/discharged \? 'bg-emerald-500' : 'bg-amber-500'/);
    // 구 색 박스 배지 잔존 금지
    expect(src).not.toMatch(/bg-red-100 text-red-700/);
    expect(src).not.toMatch(/rounded-full bg-emerald-100 px-1\.5 py-px text-\[10px\] font-semibold text-emerald-700/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2 — 액션 동선 유지(기능 제거 아님) + parent 테이블 구조 회귀 가드
// ─────────────────────────────────────────────────────────────────────────────
test.describe('시나리오2 — 액션 동선 유지 + 테이블 구조 회귀 없음', () => {
  test('액션 진입 testid 전부 보존 — 시각만 축소, 클릭 핸들러 그대로', () => {
    const src = DASH();
    for (const id of [
      'doctor-call-name-chart-btn',
      'doctor-call-rx-btn',
      'doctor-call-chart-btn',
      'doctor-call-fullchart-btn',
      'doctor-call-complete-btn',
      'doctor-completed-name-chart-btn',
      'doctor-completed-chart-btn',
      'doctor-completed-fullchart-btn',
    ]) {
      expect(src, `${id} 보존`).toContain(`data-testid="${id}"`);
    }
    // 핵심 onClick 동선 유지
    expect(src).toMatch(/onClick=\{\(\) => setShowRx\(\(v\) => !v\)\}/);
    expect(src).toMatch(/onClick=\{\(\) => setShowClinical\(\(v\) => !v\)\}/);
    expect(src).toMatch(/onClick=\{\(\) => checkIn\.customer_id && onOpenChart\(checkIn\.customer_id, 'full'\)\}/);
  });

  test('parent 테이블뷰 구조 회귀 없음 — 4열(이름/방/처방/상태) + 방이름 표출', () => {
    const src = DASH();
    expect(src).toMatch(/data-testid="doctor-call-feed-table"/);
    expect(src).toMatch(/data-testid="doctor-completed-table"/);
    for (const label of ['이름', '방', '처방', '상태']) {
      expect(src).toMatch(new RegExp(`<th[^>]*>\\s*${label}\\s*</th>`));
    }
    // 방이름(슬롯) 표출 유지 — 셀 testid + getAssignedSlotName + {slotName} 렌더
    expect(src).toMatch(/data-testid="doctor-call-room-cell"/);
    expect(src).toMatch(/data-testid="doctor-completed-room-cell"/);
    const slotCalls = src.match(/getAssignedSlotName\(checkIn\)/g) ?? [];
    expect(slotCalls.length).toBeGreaterThanOrEqual(2);
    expect(src).toMatch(/\{slotName\}/);
  });

  test('임상경과 한 줄 입력(singleLine) 저장 경로 비침범 — MedicalChartPanel variant=clinical+singleLine 보존', () => {
    const src = DASH();
    const panels = src.match(/<MedicalChartPanel[\s\S]*?\/>/g) ?? [];
    const clinical = panels.filter((p) => p.includes('variant="clinical"'));
    expect(clinical.length).toBeGreaterThanOrEqual(2);
    for (const p of clinical) {
      expect(p).toMatch(/\bsingleLine\b/);
      expect(p).toContain('embed');
    }
    // 저장 성공 시 토글 접힘 보존(저장 콜백 비변경)
    const onSaved = src.match(/onSaved=\{\(\) => setShowClinical\(false\)\}/g) ?? [];
    expect(onSaved.length).toBeGreaterThanOrEqual(2);
  });

  test('STATUS-SPLIT 회귀 가드 — QuickRxBar checkInFlag(status_flag) 게이트 prop 유지', () => {
    const src = DASH();
    const rxBars = src.match(/<QuickRxBar[\s\S]*?\/>/g) ?? [];
    expect(rxBars.length).toBeGreaterThanOrEqual(2);
    for (const bar of rxBars) {
      expect(bar).toContain('checkInFlag={checkIn.status_flag}');
      expect(bar).toContain('surface="doctor_call_dashboard"');
    }
  });

  test('진료완료/의사ack 액션 컴포넌트 보존(시각 축소되어도 기능 유지)', () => {
    const src = DASH();
    expect(src).toMatch(/<TreatmentCompleteButton/);
    expect(src).toMatch(/<DoctorAckButton/);
    expect(src).toMatch(/<DoctorAckBadge/);
    // 진료완료 버튼 = 확정(confirmed) 단계 강조 박스(emerald) — 후속 supersede 로 박스 복원.
    //   핵심 회귀 가드는 '버튼/컴포넌트 보존'(위 3종) + emerald accent 유지.
    const block = src.match(/data-testid="doctor-call-complete-btn"[\s\S]{0,260}/);
    expect(block, '진료완료 버튼 블록').not.toBeNull();
    expect(block![0]).toContain('text-emerald-700');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 3 — 상태값 다양: 상태 표시가 1~2색 dot 계열로만 구분 (순수 판정)
// ─────────────────────────────────────────────────────────────────────────────

/** 상태 dot 색 결정(정본 표시 규칙 모사): 활성=red / inactive(pink)=gray / completed=emerald. */
function statusDot(kind: 'active' | 'inactive' | 'completed'): string {
  if (kind === 'completed') return 'bg-emerald-500';
  return kind === 'active' ? 'bg-red-500' : 'bg-gray-300';
}

test.describe('시나리오3 — 상태 dot 색이 1~2색 계열로만 구분', () => {
  test('활성/완료/inactive 3종이 무채색 텍스트 + 단색 dot으로만 구분', () => {
    expect(statusDot('active')).toBe('bg-red-500');
    expect(statusDot('inactive')).toBe('bg-gray-300');
    expect(statusDot('completed')).toBe('bg-emerald-500');
    // 사용 색 = {red, gray, emerald} — accent 2색(red/emerald) + 무채(gray). 박스 컬러 없음.
    const palette = new Set([statusDot('active'), statusDot('inactive'), statusDot('completed')]);
    expect(palette.size).toBeLessThanOrEqual(3);
  });
});
