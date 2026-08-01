/**
 * E2E/Unit Spec — T-20260731-foot-DOCFORM-SEALFALLBACK-VISITDAYS-ALIGN-2ND
 *
 * 서류 수정 2차(별건 분리). 정본 스펙 = 지시서 §2·§1 AC-5⑦/⑦-a·§7. 3개 AC 검증:
 *   B      의사명·직인 미지정 폴백 제거(autoBindContext) — 기관명 덮어쓰기 + 법인 인감 우회 소거.
 *   A5⑦    실통원일수(deriveVisitDays) — 하드코딩 '1' → 실제 내원 건수. ⑦-a 순수함수 산출.
 *   G1     세부산정내역(.bill-wrap) 정렬 — 일반값 좌측 / th 중앙 / 금액 우측, 타 양식 무접촉.
 *
 * NOTE: 레포 관행(SEAL-DOCTOR-MATCH/DIAGCODE-BLANK 계승) — 배선 계약=정적 소스 가드,
 *       순수 로직=재현 검증(autoBindContext 는 supabase 를 import 하므로 unit 런타임 import 회피).
 *       라이브 렌더 실측(11개 서류 육안·실통원일수 2회+ 환자 대조)은 supervisor QA + 팀장 confirm.
 *
 * 실행: npx playwright test --project=unit T-20260731-foot-DOCFORM-SEALFALLBACK-VISITDAYS-ALIGN-2ND.spec.ts
 */

import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ABC_SRC = fs.readFileSync(path.join(__dirname, '../../src/lib/autoBindContext.ts'), 'utf-8');
const TPL_SRC = fs.readFileSync(path.join(__dirname, '../../src/lib/htmlFormTemplates.ts'), 'utf-8');

// ── AC-B: 의사명·직인 미지정 폴백 제거 ─────────────────────────────────────────
test.describe('AC-B: 미지정 폴백 기관명·법인인감 우회 제거(개인명·개인직인 유지)', () => {
  test('B1: 폴백 이름란→기관명 덮어쓰기 블록 제거(doctorName←clinicData.name 없음)', () => {
    expect(ABC_SRC, '기관명 덮어쓰기 잔존(AC-B1 미적용)').not.toMatch(
      /if\s*\(institutionName\)\s*doctorName\s*=\s*institutionName/,
    );
  });

  test('B2: 개인직인→법인 인감 우회 블록 제거(seal_image_url=null 강제 없음)', () => {
    expect(ABC_SRC, '개인직인 비움 강제 잔존(AC-B2 미적용)').not.toMatch(/seal_image_url:\s*null/);
  });

  test('B3: 도장-우회 체인(shouldForceInstitutionSeal/sealFallbackToInstitution) 코드 소거', () => {
    // 주석·문자열 아닌 실제 선언/사용 소거 — 함수 선언·플래그 let 선언 부재.
    expect(ABC_SRC, 'shouldForceInstitutionSeal 함수 선언 잔존').not.toMatch(/function\s+shouldForceInstitutionSeal/);
    expect(ABC_SRC, 'sealFallbackToInstitution let 선언 잔존').not.toMatch(/let\s+sealFallbackToInstitution/);
    expect(ABC_SRC, 'forceInstitutionSeal const 잔존').not.toMatch(/const\s+forceInstitutionSeal/);
  });

  test('B3(무회귀): 대표자란 법인 인감({{institution_seal_html}}=getStampUrl) 독립 경로 유지', () => {
    expect(ABC_SRC).toMatch(/institution_seal_html/);
  });
});

// ── AC-5⑦-a: deriveVisitDays 순수함수 (재현 검증) ─────────────────────────────
// autoBindContext.deriveVisitDays 와 동형(중복접기·범위필터·폴백 '1').
function deriveVisitDays(
  visitDates: Array<string | null | undefined>,
  from: string | null | undefined,
  to: string | null | undefined,
): string {
  const toDay = (s: string | null | undefined): string | null => {
    if (!s) return null;
    const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
  };
  const lo = toDay(from);
  const hi = toDay(to);
  const uniqueDays = new Set<string>();
  for (const raw of visitDates ?? []) {
    const day = toDay(raw);
    if (!day) continue;
    if (lo && day < lo) continue;
    if (hi && day > hi) continue;
    uniqueDays.add(day);
  }
  return uniqueDays.size > 0 ? String(uniqueDays.size) : '1';
}

test.describe('AC-5⑦-a: deriveVisitDays 순수함수', () => {
  test('2회+ 통원 = 실제 내원 건수(1 고정 아님)', () => {
    const days = ['2026-07-01', '2026-07-08', '2026-07-15'];
    expect(deriveVisitDays(days, '2026-07-01', '2026-07-15')).toBe('3');
  });

  test('같은 날 중복 내원은 1일로 접는다', () => {
    const days = ['2026-07-01T09:00:00Z', '2026-07-01T15:30:00Z', '2026-07-08T10:00:00Z'];
    expect(deriveVisitDays(days, '2026-07-01', '2026-07-08')).toBe('2');
  });

  test("빈 배열 → '1' 폴백(공란 금지)", () => {
    expect(deriveVisitDays([], '2026-07-01', '2026-07-08')).toBe('1');
  });

  test("파싱 실패·null 혼재 → 유효분만 카운트, 전량 무효면 '1' 폴백", () => {
    expect(deriveVisitDays([null, 'bad', undefined], '2026-07-01', '2026-07-08')).toBe('1');
    expect(deriveVisitDays([null, '2026-07-02', 'bad', '2026-07-05'], '2026-07-01', '2026-07-08')).toBe('2');
  });

  test('상한(발행 기준일) 초과 미래 방문은 제외', () => {
    const days = ['2026-07-01', '2026-07-08', '2026-07-20'];
    // 발행 기준일 2026-07-08 → 07-20 방문 제외 = 2일
    expect(deriveVisitDays(days, '2026-07-01', '2026-07-08')).toBe('2');
  });

  test('하한 이전 방문은 제외', () => {
    const days = ['2026-06-25', '2026-07-01', '2026-07-08'];
    expect(deriveVisitDays(days, '2026-07-01', '2026-07-08')).toBe('2');
  });

  test('단일 방문 → 1', () => {
    expect(deriveVisitDays(['2026-07-08'], '2026-07-08', '2026-07-08')).toBe('1');
  });
});

// ── AC-5⑦ 배선: 실통원일수 소스 가드 ──────────────────────────────────────────
test.describe('AC-5⑦ 배선: deriveVisitDays 산출 → visit_days 바인딩', () => {
  test('deriveVisitDays 순수함수 export 존재', () => {
    expect(ABC_SRC).toMatch(/export\s+function\s+deriveVisitDays/);
  });

  test('loadAutoBindContext check_ins 신규 조회 → deriveVisitDays 호출 → visit_days=ctx.visitDays', () => {
    expect(ABC_SRC, 'check_ins.checked_in_at 신규 조회 누락').toMatch(
      /from\(['"]check_ins['"]\)[\s\S]{0,120}select\(['"]checked_in_at['"]\)/,
    );
    expect(ABC_SRC, 'deriveVisitDays 호출 누락').toMatch(/deriveVisitDays\(/);
    expect(ABC_SRC, 'visit_days 하드코딩 잔존').toMatch(/visit_days:\s*ctx\.visitDays\s*\?\?\s*['"]1['"]/);
    expect(ABC_SRC, "visit_days '1' 하드코딩 재발").not.toMatch(/visit_days:\s*['"]1['"]/);
  });

  test('통원확인서: 라벨 실통원일수 + 값 {{visit_days}}(진료확인서 통원일자 무접촉)', () => {
    expect(TPL_SRC, '실통원일수 라벨 누락').toMatch(/실통원일수/);
    // 실통원일수 라벨 셀 바로 뒤 값 셀이 {{visit_days}} 인지.
    expect(TPL_SRC).toMatch(/실통원일수<\/td>\s*<td[^>]*>\{\{visit_days\}\}<\/td>/);
    // 진료확인서 통원일자 라벨(→ visit_date)은 그대로 존재(무접촉).
    expect(TPL_SRC, '진료확인서 통원일자 라벨 소실(스코프 초과)').toMatch(/통원일자<\/td>\s*<td[^>]*>\{\{visit_date\}\}<\/td>/);
  });
});

// ── AC-G1: 세부산정내역(.bill-wrap) 정렬 ──────────────────────────────────────
test.describe('AC-G1: .bill-wrap 일반값 좌측 / th 중앙 / 금액 우측 (타 양식 무접촉)', () => {
  test('.bill-wrap td 기본 좌측 + th 중앙 명시', () => {
    expect(TPL_SRC).toMatch(/\.bill-wrap\s+td\s*\{\s*text-align:\s*left;\s*\}/);
    expect(TPL_SRC).toMatch(/\.bill-wrap\s+th\s*\{\s*text-align:\s*center;\s*\}/);
  });

  test('.bill-wrap td.num-cell 우측(0,2,1 > .bill-wrap td) → 금액 우측 보장', () => {
    expect(TPL_SRC).toMatch(/\.bill-wrap\s+td\.num-cell\s*\{\s*text-align:\s*right;\s*\}/);
  });

  test('공유 td/th 규칙에서 text-align:center 제거(값 셀 중앙 강제 해제)', () => {
    // .bill-wrap td, .bill-wrap th { ... } 블록 내부에 text-align:center 가 없어야 함.
    const m = TPL_SRC.match(/\.bill-wrap\s+td,\s*\.bill-wrap\s+th\s*\{([\s\S]*?)\}/);
    expect(m, '.bill-wrap td, th 공유 규칙 블록 없음').not.toBeNull();
    expect(m![1], '공유 규칙에 text-align 잔존(값 셀 중앙 강제)').not.toMatch(/text-align/);
  });

  test('전역 .num-cell 무접촉 + 타 양식(.rx-wrap/.br-wrap) 정렬 확대 없음', () => {
    expect(TPL_SRC, '전역 num-cell 우측 정의 유지').toMatch(/\.num-cell\s*\{\s*text-align:\s*right;/);
    expect(TPL_SRC, 'AC-G1 확대: rx-wrap td 좌측 강제 금지').not.toMatch(/\.rx-wrap\s+td\s*\{\s*text-align:\s*left;/);
    expect(TPL_SRC, 'AC-G1 확대: br-wrap td 좌측 강제 금지').not.toMatch(/\.br-wrap\s+td\s*\{\s*text-align:\s*left;/);
  });
});
