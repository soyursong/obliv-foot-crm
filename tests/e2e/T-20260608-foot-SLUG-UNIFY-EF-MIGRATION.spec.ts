/**
 * T-20260608-foot-SLUG-UNIFY-EF-MIGRATION
 * obliv-foot-crm 4 EF dual-slug 패치 정적 검증
 *
 * 배경: 도파민 신키 'jongno-foot' 통일. 1주 dual-key transition window 동안
 *       구키 'foot-jongno'·신키 'jongno-foot' 양쪽 수용. 22:00 paired 적용.
 *       paired: T-20260602-dopamine-CLINIC-SLUG-UNIFY
 *
 * ─ 검증 패턴 ──────────────────────────────────────────────────────
 *   엣지 함수는 배포·JWT 의존으로 런타임 E2E 불가 → 소스 정적 검증 컨벤션
 *   (참조: T-20260520-foot-RESERVATION-INGEST-EF.spec.ts).
 *
 * ─ 시나리오 (티켓 AC) ─────────────────────────────────────────────
 *   시나리오 1: clinic_slug=foot-jongno(구키) 푸시 → 정규화 후 예약 생성 성공 경로
 *   시나리오 2: clinic_slug=jongno-foot(신키) 푸시 → passthrough 예약 생성 성공
 *   시나리오 3: 콜백·체크인 dual-key 수용 (canonical 신키 emit)
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FN_DIR = path.resolve(__dirname, '../../supabase/functions');
const EF = {
  ingest:   path.join(FN_DIR, 'reservation-ingest-from-dopamine/index.ts'),
  readApi:  path.join(FN_DIR, 'reservations-read-api/index.ts'),
  callback: path.join(FN_DIR, 'dopamine-callback/index.ts'),
  checkin:  path.join(FN_DIR, 'checkin-visited-fire/index.ts'),
};

function read(p: string): string {
  return fs.readFileSync(p, 'utf-8');
}

// SLUG_ALIAS + normalizeSlug 표준 패턴이 존재하는지 검사 (입력형/출력형 공통)
function assertDualKeyHelper(src: string) {
  // 구키 → 신키 매핑
  expect(src).toMatch(/SLUG_ALIAS[\s\S]*?['"]foot-jongno['"]\s*:\s*['"]jongno-foot['"]/);
  // 정규화 함수: 매핑 없으면 입력값 passthrough
  expect(src).toContain('SLUG_ALIAS[slug] ?? slug');
  expect(src).toContain('normalizeSlug');
}

// ── 0. 4 EF 파일 존재 ──────────────────────────────────────────────
test('SLUG-0: 대상 4 EF 파일 존재', () => {
  for (const p of Object.values(EF)) {
    expect(fs.existsSync(p)).toBe(true);
  }
});

// ── 시나리오 1+2: reservation-ingest 입력 dual-key 정규화 ──────────
test('SLUG-1: reservation-ingest — 구키/신키 dual-key 정규화 후 clinics 조회', () => {
  const src = read(EF.ingest);
  assertDualKeyHelper(src);
  // 입력 clinic_slug를 정규화한 결과(lookupSlug)로 DB 조회
  expect(src).toContain('const lookupSlug = normalizeSlug(clinicSlug)');
  expect(src).toContain(".eq('slug', lookupSlug)");
  // 정규화 전 raw clinicSlug 로 직접 조회하던 코드는 제거됨
  expect(src).not.toContain(".eq('slug', clinicSlug)");
});

test('SLUG-2: reservations-read-api — 구키/신키 dual-key 정규화 후 clinics 조회', () => {
  const src = read(EF.readApi);
  assertDualKeyHelper(src);
  expect(src).toContain('const lookupSlug = normalizeSlug(clinicSlug)');
  expect(src).toContain(".eq('slug', lookupSlug)");
  expect(src).not.toContain(".eq('slug', clinicSlug)");
});

// ── 시나리오 3: 콜백·체크인 dual-key 수용 (canonical 신키 emit) ─────
test('SLUG-3a: dopamine-callback — canonical 신키 상수로 emit (visited/paid)', () => {
  const src = read(EF.callback);
  assertDualKeyHelper(src);
  // canonical 신키 상수 정의
  expect(src).toContain("const FOOT_CLINIC_SLUG = normalizeSlug('foot-jongno')");
  // payload는 상수로 emit (하드코딩 구키/맨 리터럴 아님)
  expect(src).toContain('clinic_slug: FOOT_CLINIC_SLUG');
  // 맨 구키 리터럴을 payload에 직접 박지 않음
  expect(src).not.toContain("clinic_slug: 'foot-jongno'");
});

test('SLUG-3b: checkin-visited-fire — canonical 신키 상수로 emit', () => {
  const src = read(EF.checkin);
  assertDualKeyHelper(src);
  expect(src).toContain("const FOOT_CLINIC_SLUG = normalizeSlug('foot-jongno')");
  expect(src).toContain('clinic_slug: FOOT_CLINIC_SLUG');
  expect(src).not.toContain("clinic_slug: 'foot-jongno'");
});

// ── 회귀: 4 EF 전체에 맨 구키 잔존 0건 (alias map·comment 외) ──────
test('SLUG-4: 4 EF에 dual-key 수용 코드 외 맨 구키 사용 0건', () => {
  for (const p of Object.values(EF)) {
    const lines = read(p).split('\n');
    for (const line of lines) {
      if (!line.includes('foot-jongno')) continue;
      const allowed =
        line.includes('SLUG_ALIAS') ||                       // 매핑 키 정의 라인
        /['"]foot-jongno['"]\s*:\s*['"]jongno-foot['"]/.test(line) || // 매핑 엔트리
        line.includes("normalizeSlug('foot-jongno')") ||     // canonical seed
        line.trimStart().startsWith('//') ||                 // 주석
        line.trimStart().startsWith('*');                    // JSDoc
      expect(allowed, `허용되지 않은 구키 사용: ${line.trim()}`).toBe(true);
    }
  }
});
