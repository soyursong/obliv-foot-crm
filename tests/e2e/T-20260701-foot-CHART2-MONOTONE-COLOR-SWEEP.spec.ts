/**
 * T-20260701-foot-CHART2-MONOTONE-COLOR-SWEEP
 *   2번차트 장식성 컬러(브라운/초록/베이지) → 앱 primary 다크(neutral-800)·다크그레이·라이트그레이 모노톤 통일.
 *   순수 표시 CSS만. 기능·레이아웃·DB 무변경.
 *
 * 확정 4지점:
 *   ②-1 선택된 금기증/진단서 옵션 버튼(OpinionRequestBox)  브라운(bg-teal-600) → neutral-800
 *   ②-2 '발행 요청' 버튼(OpinionRequestBox)               브라운 → neutral-800(저장 버튼=Button default 톤)
 *   ①-1 '수동 입력' 등 확인방법 selected(InsuranceGradeSelect) 초록(emerald) → 무채색 그레이
 *   ①-2 '⚠ 등급 미확인' 경고 박스(Chart2InsuranceCalcPanel) 베이지(amber) → 라이트그레이+다크그레이(⚠ 유지)
 *
 * 의미색 보존(무채색화 오적용 0): 건보부담 emerald(녹색 완료)·마케팅동의 emerald·파랑 수치·빨강 오류.
 *
 * 검증 방식(레포 dominant 패턴): 정적 소스 SSOT 불변식 — 대상 클래스 문자열이 무채색(neutral-*)이고
 *   장식성 브라운(bg/border/text-teal-600·700·800)·초록(emerald selected)·베이지(bg-amber) 잔존 0,
 *   의미색(emerald 건보/마케팅)은 그대로 존재함을 코드 계약으로 고정한다. (라이브 env·인증·시드 비의존)
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = (p: string) => resolve(__dirname, '../../', p);
const read = (p: string) => readFileSync(root(p), 'utf8');
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const OPINION = stripComments(read('src/components/consult/OpinionRequestBox.tsx'));
const GRADE = stripComments(read('src/components/insurance/InsuranceGradeSelect.tsx'));
const CALC = stripComments(read('src/components/insurance/Chart2InsuranceCalcPanel.tsx'));
const SHEET = stripComments(read('src/components/CustomerChartSheet.tsx'));
const BUTTON = stripComments(read('src/components/ui/button.tsx'));

// ── 시나리오 1: 화면② 소견서·진단서 요청 — 선택 버튼·발행 버튼 모노톤 (AC1/AC2) ──────────
test.describe('시나리오1 — 화면② OpinionRequestBox 선택·발행 모노톤', () => {
  test('AC1 선택된 금기증/진단서 옵션 버튼 active = neutral-800 (브라운 bg-teal-600 잔존 0)', () => {
    // active(selected) 강조 = 다크 모노톤
    expect(OPINION).toContain('border-neutral-800 bg-neutral-800 text-white shadow-sm');
    // 브라운(리맵된 teal-600) selected 잔존 0
    expect(OPINION).not.toContain('bg-teal-600');
    expect(OPINION).not.toContain('border-teal-600');
  });

  test('AC1 서류종류(소견서/진단서) 토글 active = neutral-800 (브라운 잔존 0)', () => {
    expect(OPINION).toContain("docType === t.value ? 'bg-neutral-800 text-white shadow-sm'");
  });

  test('AC2 발행 요청 버튼 = neutral-800/hover neutral-900 (화면① 저장=Button default 동일 톤)', () => {
    expect(OPINION).toContain('bg-neutral-800 px-3 text-[11px] text-white hover:bg-neutral-900');
    expect(OPINION).not.toContain('hover:bg-teal-700');
    // 저장 버튼 톤 참조: Button default variant 이 동일한 neutral-800/neutral-900 이어야 '동일 톤' 성립
    expect(BUTTON).toContain('bg-neutral-800 text-white hover:bg-neutral-900');
  });

  test('AC6 기능 무변경 — 선택 토글/발행 로직 시그니처 유지(회귀 0)', () => {
    // 단일배타 XOR 복수선택 엔진·제출 핸들러 불변
    expect(OPINION).toContain('const handleOptionClick = (key: string) =>');
    expect(OPINION).toContain('const handleRequest = async () =>');
    expect(OPINION).toContain('createMut.mutateAsync');
    // testid(현장 클릭 대상) 불변
    expect(OPINION).toContain('data-testid="opinion-req-submit"');
    expect(OPINION).toContain('data-testid={`opinion-req-opt-${opt.key}`}');
  });

  test('OpinionRequestBox 대기 배지/목록 브라운 텍스트(text-teal-700/800) 잔존 0', () => {
    expect(OPINION).not.toContain('text-teal-700');
    expect(OPINION).not.toContain('text-teal-800');
    expect(OPINION).not.toContain('bg-teal-50');
  });
});

// ── 시나리오 2: 화면① 건강보험 — 수동입력·경고박스 모노톤 (AC3/AC4) ─────────────────────
test.describe('시나리오2 — 화면① 수동입력·경고박스 모노톤', () => {
  test('AC3 확인방법 selected(수동입력 포함) = 무채색 그레이 (초록 emerald 잔존 0)', () => {
    // grade·source selected 강조가 동일 무채색 클래스 재사용
    expect(GRADE).toContain('border-neutral-400 bg-neutral-100 text-neutral-800');
    expect(GRADE).not.toContain('border-emerald-600 bg-emerald-100 text-emerald-800');
    expect(GRADE).not.toContain('emerald');
  });

  test('AC3 자격등급 selected = 무채색 그레이 (브라운 teal 잔존 0), 선택 시인성 유지', () => {
    expect(GRADE).not.toContain('border-teal-600 bg-teal-100 text-teal-800');
    expect(GRADE).not.toMatch(/teal-600|teal-800/);
  });

  test('AC4 ⚠ 등급 미확인 경고 박스 = 라이트그레이+다크그레이 (베이지 amber 잔존 0), ⚠·문구 유지', () => {
    expect(CALC).toContain('bg-neutral-100 px-2 py-1 text-[10px] text-neutral-700');
    // ⚠ 아이콘·경고 문구·강조(30%) 보존
    expect(CALC).toContain('⚠ 등급 미확인 — <strong>일반(30%)</strong> 기본 적용');
    // 베이지/노랑(amber) 잔존 0
    expect(CALC).not.toContain('bg-amber-50');
    expect(CALC).not.toContain('text-amber-800');
    expect(CALC).not.toContain('text-amber-600');
  });

  test('AC4 급여 자동산정 헤더 브라운(text-teal-600/800) → 무채색', () => {
    expect(CALC).toContain('text-neutral-600 shrink-0'); // ShieldCheck 아이콘
    expect(CALC).toContain('text-[10px] font-semibold text-neutral-700'); // 타이틀
    expect(CALC).not.toContain('text-teal-800');
    expect(CALC).not.toContain('text-teal-600');
  });

  test('본인 부담 금액 브라운(text-teal-700) → 무채색 다크(neutral-800), 금액 로직 불변', () => {
    expect(CALC).toContain('font-semibold text-neutral-800');
    expect(CALC).toContain('tabular-nums text-neutral-800');
    expect(CALC).not.toContain('text-teal-700');
    // 금액 산출 로직(불변): formatAmount 바인딩 유지
    expect(CALC).toContain('formatAmount(r.copayment_amount)');
    expect(CALC).toContain('formatAmount(totals.copay)');
  });

  test('CustomerChartSheet 저장 후 닫기 버튼 브라운(bg-teal-600) → neutral-800', () => {
    expect(SHEET).toContain('bg-neutral-800 hover:bg-neutral-900');
    expect(SHEET).not.toContain('bg-teal-600');
  });
});

// ── 시나리오 3: 의미색 보존 (음성 검증 — 무채색화 오적용 0) ────────────────────────────
test.describe('시나리오3 — 의미색 보존(오적용 0)', () => {
  test('건보 부담 emerald(녹색 완료 의미색)은 그대로 존재 — 무채색화 금지', () => {
    expect(CALC).toContain('tabular-nums text-emerald-700');
  });

  test('상병코드 파랑/보라 수치강조 등 의미색 토큰 보존(purple 상병)', () => {
    // 상병 배지(수치·코드 강조)는 장식 sweep 대상 아님 → 그대로 존재
    expect(CALC).toContain('text-purple-700');
  });

  test('AC6 기능 무변경 — 등급 저장 핸들러/testid 불변(회귀 0)', () => {
    expect(GRADE).toContain('const save = async () =>');
    expect(GRADE).toContain('updateInsuranceGrade(customerId, draftGrade, draftSource');
  });
});

// ── AC5 전수: 2번차트 확정 surface 장식 브라운/베이지/초록 selected 잔존 0 (스캔 근거) ──────
test.describe('AC5 전수 — 확정 surface 장식색 잔존 0', () => {
  test('OpinionRequestBox / InsuranceGradeSelect / Chart2InsuranceCalcPanel — 장식 브라운(teal-600/700/800)·베이지(amber) 잔존 0', () => {
    for (const src of [OPINION, GRADE, CALC]) {
      expect(src).not.toMatch(/teal-600|teal-700|teal-800/);
      expect(src).not.toMatch(/bg-amber-50|text-amber-\d00/);
    }
    // 단, 의미색(emerald 건보) carve-out은 CALC에 존재해야 함(오적용 0 반대급부)
    expect(CALC).toMatch(/emerald-700/);
  });
});
