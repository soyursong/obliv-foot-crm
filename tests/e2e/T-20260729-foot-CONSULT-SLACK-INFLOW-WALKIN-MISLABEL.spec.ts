/**
 * E2E spec — T-20260729-foot-CONSULT-SLACK-INFLOW-WALKIN-MISLABEL (P1 hotfix, RC-FOLD diagnosis→fix)
 *
 * 증상: 권선제(차트 #F-5294, 실제 유입 "네이버")가 상담대기방(C0B4HEC9SHH) [확정] 발송에서 "워크인"으로 안내.
 * RC(확정, 가설 B — 데이터 오염 아님):
 *   · autoAssign.ts deriveConsultAxis 는 CONSULT_AXES(TM/인바운드/워크인) 밖 값을 '워크인'으로 접는 구조적 폴백.
 *   · Assignments.tsx 가 이 균등 버킷 축을 '유입경로' 표시/발송 라벨로 전용(轉用) → 네이버·지인소개·공홈 소실.
 *
 * planner 수정 결정 = 라벨↔배정축 DECOUPLE (★HARD):
 *   · 표시/발송 라벨을 고객 실제 visit_route(원문)로 노출(consultInflowLabel SSOT). 재진은 '재진'.
 *   · ★ CONSULT_AXES 에 '네이버' 추가 채택 금지 — 자동배정 균등 카운트/랭킹 분배는 반드시 불변.
 *
 * 검증(순수 함수 + 배선 정적 — 데이터/로그인 비의존, 형제 foot spec 동형):
 *   AC-확정1  네이버→워크인 폴백이 RC 임을 deriveConsultAxis 로 코드 재확인.
 *   AC-fix1   visit_route='네이버' → 라벨='네이버'.
 *   AC-fix2   TM/인바운드/워크인 무회귀.
 *   AC-fix3   CONSULT_AXES 외 모든 값(지인소개·인콜·공홈 등) 실제 값 표시.
 *   AC-fix4   ★자동배정 균등 카운트/랭킹 분배 불변 — deriveConsultAxis/CONSULT_AXES 폴백 미변경.
 *   AC-fix5   DB 변경 없음(마이그레이션 파일 미생성).
 *   AC-fix6   빈값(null/공란) → '미지정' 플레이스홀더(거짓 '워크인' 금지, planner MSG-9ljf(b) 신설).
 *   배선      Assignments.tsx inflow 바인딩이 consultInflowLabel 로 교정(deriveConsultAxis 직결 라벨 제거).
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { deriveConsultAxis, isReturningAxis } from '../../src/lib/autoAssign';
import {
  consultInflowLabel,
  INFLOW_RETURNING_LABEL,
  INFLOW_UNSPECIFIED_LABEL,
} from '../../src/lib/consultInflowLabel';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const read = (p: string) => fs.readFileSync(path.resolve(ROOT, p), 'utf-8');

const ASSIGNMENTS = 'src/pages/Assignments.tsx';
const AUTOASSIGN = 'src/lib/autoAssign.ts';
const LABEL = 'src/lib/consultInflowLabel.ts';

// ─────────────────────────────────────────────────────────────────────────────
// AC-확정1 — 네이버→워크인 폴백이 RC 임을 deriveConsultAxis 로 코드 재확인
// ─────────────────────────────────────────────────────────────────────────────
test('AC-확정1: deriveConsultAxis 가 네이버를 균등 버킷 폴백 "워크인"으로 접는다(RC 재현)', () => {
  // F-5294 재현: 초진 판정(new) + visit_route=네이버 → 축='워크인'(RC L140 폴백).
  expect(deriveConsultAxis({ visit_type: 'new', visit_route: '네이버' })).toBe('워크인');
  expect(deriveConsultAxis({ visit_type: 'new', visit_route: '지인소개' })).toBe('워크인');
  expect(deriveConsultAxis({ visit_type: 'new', visit_route: '공홈' })).toBe('워크인');
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-fix1 — visit_route='네이버' → 라벨='네이버'
// ─────────────────────────────────────────────────────────────────────────────
test('AC-fix1: 초진 네이버 → 라벨 "네이버"(더 이상 워크인 아님)', () => {
  const axis = deriveConsultAxis({ visit_type: 'new', visit_route: '네이버' }); // '워크인'(버킷) — 불변
  expect(consultInflowLabel(axis, { visit_route: '네이버' })).toBe('네이버');
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-fix2 — TM/인바운드/워크인 무회귀
// ─────────────────────────────────────────────────────────────────────────────
test('AC-fix2: TM/인바운드/워크인 라벨 무회귀', () => {
  for (const v of ['TM', '인바운드', '워크인']) {
    const axis = deriveConsultAxis({ visit_type: 'new', visit_route: v });
    expect(consultInflowLabel(axis, { visit_route: v })).toBe(v);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-fix3 — CONSULT_AXES 외 모든 값(지인소개·인콜·공홈 등) 실제 값 표시
// ─────────────────────────────────────────────────────────────────────────────
test('AC-fix3: CONSULT_AXES 밖 실값(지인소개·인콜·공홈)이 원문 그대로 표시', () => {
  for (const v of ['지인소개', '인콜', '공홈']) {
    const axis = deriveConsultAxis({ visit_type: 'new', visit_route: v }); // 전부 '워크인' 버킷 — 불변
    expect(axis).toBe('워크인');
    expect(consultInflowLabel(axis, { visit_route: v })).toBe(v); // 라벨은 실값
  }
});

test('AC-fix3: lead_source 폴백 + 재진 경계', () => {
  // visit_route 없으면 lead_source 원문.
  expect(consultInflowLabel('워크인', { visit_route: null, lead_source: '네이버' })).toBe('네이버');
  // 재진 축 → 유입경로 대신 '재진'(route 값 무관, 기존 동작 보존).
  expect(consultInflowLabel('returning', { visit_route: '네이버' })).toBe(INFLOW_RETURNING_LABEL);
  expect(isReturningAxis('returning')).toBe(true);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-fix6 — 빈값(null/공란) visit_route → '미지정' 플레이스홀더 (거짓 '워크인' 금지)
//   planner MSG-9ljf(b) 명시 신설. 빈 visit_route 117건이 '워크인'으로 오표기되던 경로 차단.
// ─────────────────────────────────────────────────────────────────────────────
test('AC-fix6: 둘 다 빈값(공란/null) → "미지정"(거짓 워크인 아님)', () => {
  expect(INFLOW_UNSPECIFIED_LABEL).toBe('미지정');
  // 공란 문자열 / null / 미조회(cust=null) 전부 '미지정' — 더 이상 '워크인'으로 폴백하지 않음.
  expect(consultInflowLabel('워크인', { visit_route: '', lead_source: null })).toBe(INFLOW_UNSPECIFIED_LABEL);
  expect(consultInflowLabel('워크인', { visit_route: null, lead_source: '' })).toBe(INFLOW_UNSPECIFIED_LABEL);
  expect(consultInflowLabel('워크인', { visit_route: '   ', lead_source: null })).toBe(INFLOW_UNSPECIFIED_LABEL);
  expect(consultInflowLabel('워크인', null)).toBe(INFLOW_UNSPECIFIED_LABEL);
  expect(consultInflowLabel('워크인', undefined)).toBe(INFLOW_UNSPECIFIED_LABEL);
  // ★ 실값 '워크인'(라벨=원문)과 빈값 폴백 구분 — 실제 visit_route='워크인'은 '워크인' 유지.
  expect(consultInflowLabel('워크인', { visit_route: '워크인' })).toBe('워크인');
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-fix4 — ★ 자동배정 균등 카운트/랭킹 분배 불변 (deriveConsultAxis/CONSULT_AXES 폴백 미변경)
// ─────────────────────────────────────────────────────────────────────────────
test('AC-fix4: CONSULT_AXES 에 네이버 미추가 — 배정 축 폴백 로직 불변', () => {
  const src = read(AUTOASSIGN);
  // CONSULT_AXES 정의는 정확히 3종만 — 네이버/지인소개/공홈 등 신규 축 추가 없음.
  expect(src).toMatch(/const CONSULT_AXES = \['TM', '인바운드', '워크인'\] as const;/);
  expect(src).not.toContain("'네이버'");
  // '워크인' 폴백 return 보존(균등 버킷 수렴).
  expect(src).toMatch(/return '워크인';/);
  // 런타임 재확인: 네이버/지인소개/공홈 전부 여전히 '워크인' 버킷으로 배정(별도 풀 분리 없음).
  for (const v of ['네이버', '지인소개', '공홈']) {
    expect(deriveConsultAxis({ visit_type: 'new', visit_route: v })).toBe('워크인');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 배선 — Assignments.tsx inflow 바인딩 교정 (deriveConsultAxis 직결 라벨 제거)
// ─────────────────────────────────────────────────────────────────────────────
test('배선: inflow 바인딩이 consultInflowLabel SSOT 로 교정됨', () => {
  const src = read(ASSIGNMENTS);
  expect(src).toContain("import { consultInflowLabel } from '@/lib/consultInflowLabel'");
  // 신규 바인딩: consultInflowLabel(axisOf(...), cust)
  expect(src).toMatch(/inflow: role === 'consult' \? consultInflowLabel\(axisOf\(ci, 'consult'\), cust\) : ''/);
  // 구 버그 바인딩(AXIS_KO[axisOf(...)] 를 그대로 라벨로) 제거 확인.
  expect(src).not.toMatch(/inflow: role === 'consult' \? \(AXIS_KO\[axisOf\(ci, 'consult'\)\]/);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-fix5 — DB 변경 없음
// ─────────────────────────────────────────────────────────────────────────────
test('AC-fix5: 마이그레이션/DDL 신규 생성 없음(db_change:false)', () => {
  const migDir = path.resolve(ROOT, 'supabase/migrations');
  const mig = fs.existsSync(migDir) ? fs.readdirSync(migDir) : [];
  expect(mig.some((f) => f.includes('CONSULT-SLACK-INFLOW') || f.includes('inflow_walkin'))).toBe(false);
  // 라벨 SSOT 는 순수 함수(DB 무접촉) — supabase import 없음.
  expect(read(LABEL)).not.toContain('supabase');
});
