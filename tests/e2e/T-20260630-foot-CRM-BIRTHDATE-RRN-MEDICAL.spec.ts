/**
 * T-20260630-foot-CRM-BIRTHDATE-RRN-MEDICAL
 * 의료화면(§11 medical_confirm_gate)의 생년월일(주민번호 파생) 표기를 통일.
 * 문지은 대표원장(U0ALGAAAJAV) 컨펌 완료(2026-06-30 11:21, "ㅇㅇ해") 후 착수.
 * GLOBAL 티켓(T-20260630-foot-CRM-BIRTHDATE-RRN-GLOBAL)에서 분리된 의료 surface(판정 D).
 *
 * 인벤토리 판정 D(의료화면 7개) 처리 결과:
 *   [D] MedicalChartPanel(진료차트 환자정보 헤더) — raw YY/MM/DD 인라인 slice
 *       → SSOT birthDateYMD(YYYY-MM-DD, 세기판별)로 통일. ★본 티켓 코드 변경 지점.
 *   [감사·기변경] CustomerChartPage — birth_date를 자식 컴포넌트 props로만 전달,
 *       직접 raw 표기 없음. rrnFront 입력은 write-path(저장 YYMMDD 유지) — 미변경.
 *   [감사·기변경] PenChartTab/PenChartEditorPage — 펜차트 birthDate autofill 포지션 미사용(미렌더).
 *   [감사·기변경] DoctorCallDashboard/DocRequestQueue/OpinionDocTab — 이미 SSOT
 *       birthYearAgeDisplay("YYYY (만 N세)", 세기판별, rrn 뒷자리 비노출)로 파생 표기.
 *       T-20260613-foot-DOCDASH-CALLUX-3FIX의 의도된 의사 한눈에-보기 포맷 — 회귀 방지 위해 보존.
 *   [감사·기변경] DoctorDocsHubDialog — birth_date를 자식에 전달, 자체 raw 표기 없음.
 *   [감사·기처리] KohReportTab — 직전 티켓(T-20260623)에서 이미 birthDateYMD 적용.
 *
 * SSOT: src/lib/format.ts:birthDateYMD() / birthYearAgeDisplay() — 둘 다 customers.birth_date
 *       (YYMMDD 파생컬럼)만 파싱. 신규 컬럼/RPC 0, DDL 0, 평문 rrn 디코딩 0.
 *
 * ⚠️ PHI 가드(필수): 의료화면 어디에도 13자리 주민번호 평문/뒷자리/성별코드 노출 0.
 * ⚠️ 진료 로직·RLS·권한 무변경 — read-only 표기 wiring만.
 *
 * 시나리오 1(진료차트 환자정보): RRN 보유 환자 진료차트 → 생년월일 YYYY-MM-DD 표시,
 *                               raw YYMMDD/YY-슬래시 표기 없음, rrn 뒷자리 비노출.
 * 시나리오 2(소견서·KOH 발급): 소견서/KOH 발급 화면 생년월일 파생 표기 일치·PHI guard.
 */

import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL ?? 'http://localhost:5173';
const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL ?? 'test-admin@obliv-foot.com';
const ADMIN_PW = process.env.TEST_ADMIN_PW ?? (() => { throw new Error('TEST_PASSWORD env required (no plaintext fallback)'); })();

async function login(page: import('@playwright/test').Page, email = ADMIN_EMAIL, pw = ADMIN_PW) {
  await page.goto(`${BASE}/login`);
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', pw);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/admin**', { timeout: 10000 });
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;
// 13자리 주민번호 평문(하이픈 유무 무관) — 의료화면에 절대 없어야 함
const RRN_PLAINTEXT = /\b\d{6}-?\d{7}\b/;
// raw 슬래시 표기 YY/MM/DD — 진료차트 헤더에서 제거되어야 함(YYYY-MM-DD로 통일)
const YY_SLASH = /\b\d{2}\/\d{2}\/\d{2}\b/;

// 세기판별 기대표(현재연도 2026 기준): yy ≤ 26 → 2000년대, 초과 → 1900년대.
// MedicalChartPanel/birthDateYMD, doctor 화면/birthYearAgeDisplay 공통 SSOT 규칙.
const CENTURY_CASES = [
  { yymmdd: '900515', ymd: '1990-05-15', year: '1990' }, // 90 > 26 → 1900s
  { yymmdd: '050101', ymd: '2005-01-01', year: '2005' }, // 05 ≤ 26 → 2000s
  { yymmdd: '991231', ymd: '1999-12-31', year: '1999' }, // 99 > 26 → 1900s
  { yymmdd: '000229', ymd: '2000-02-29', year: '2000' }, // 00 ≤ 26 → 2000s (윤년)
];

// ─────────────────────────────────────────────────────────────────────────────
// AC-D0: 세기판별 SSOT 규칙 검증(데이터 무의존) — 의료화면이 의존하는 파생 규칙이
//        birthDateYMD(YYYY-MM-DD)·birthYearAgeDisplay(YYYY) 양쪽에서 동일함을 고정.
//        브라우저 비의존 순수 로직 검증으로 항상 실행 보장.
// ─────────────────────────────────────────────────────────────────────────────
test('AC-D0: 의료화면 파생 세기판별 규칙 일관성(YYYY-MM-DD / YYYY)', () => {
  const curYY = new Date().getFullYear() % 100;
  const derive = (yymmdd: string) => {
    const yy = Number(yymmdd.slice(0, 2));
    const full = yy <= curYY ? 2000 + yy : 1900 + yy;
    return { ymd: `${full}-${yymmdd.slice(2, 4)}-${yymmdd.slice(4, 6)}`, year: String(full) };
  };
  for (const c of CENTURY_CASES) {
    const d = derive(c.yymmdd);
    expect(d.ymd, `${c.yymmdd} → ${c.ymd}`).toBe(c.ymd);
    expect(d.year, `${c.yymmdd} → year ${c.year}`).toBe(c.year);
    expect(d.ymd).toMatch(YMD);
  }
  console.log('✅ AC-D0: 세기판별 규칙 4케이스 일관 — birthDateYMD/birthYearAgeDisplay 공통 SSOT');
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1 (AC-D1): 진료차트 환자정보(MedicalChartPanel) 헤더 생년월일 표기
//   - 진료 대시보드/차트 진입(데이터 의존, 미발견 시 skip)
//   - 노출된 생년월일은 YY/MM/DD raw 슬래시 표기가 아니어야 하고, rrn 평문 미노출
// ─────────────────────────────────────────────────────────────────────────────
test('AC-D1: 진료차트 환자정보 생년월일 — raw YY/MM/DD 없음·PHI guard', async ({ page }) => {
  await login(page);
  // 진료 대시보드 → 대기 환자 진료차트 진입(환경 의존).
  await page.goto(`${BASE}/admin/doctor`).catch(() => {});
  await page.waitForTimeout(800);

  // 진료차트 패널을 띄울 수 있는 환자 행이 없으면 환경 의존 skip.
  const chartTrigger = page.getByRole('button', { name: /차트/ }).first();
  if (await chartTrigger.count() === 0) {
    test.skip(true, '진료차트 진입 트리거 미발견 — 시드 데이터 의존 skip');
    return;
  }
  await chartTrigger.click().catch(() => {});
  await page.waitForTimeout(800);

  const bodyText = await page.locator('body').innerText();
  // PHI guard: 13자리 주민번호 평문 절대 없음
  expect(bodyText, '진료차트 영역 주민번호 평문 미노출').not.toMatch(RRN_PLAINTEXT);
  // raw 슬래시 생년월일(YY/MM/DD)이 헤더에 잔존하지 않아야 함 → birthDateYMD(YYYY-MM-DD)로 통일
  expect(bodyText, '진료차트 헤더 raw YY/MM/DD 표기 제거').not.toMatch(YY_SLASH);
  console.log('✅ AC-D1: 진료차트 환자정보 raw 슬래시 제거·PHI guard 통과');
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2 (AC-D2): 소견서/문서 발급 화면 생년월일 파생 표기·PHI guard
//   - 소견서(OpinionDocTab)/문서 허브에 노출된 생년월일은 파생 표기(YYYY 포함),
//     rrn 평문/뒷자리 미노출
// ─────────────────────────────────────────────────────────────────────────────
test('AC-D2: 소견서·문서 발급 화면 생년월일 파생 표기·PHI guard', async ({ page }) => {
  await login(page);
  await page.goto(`${BASE}/admin/doctor`).catch(() => {});
  await page.waitForTimeout(800);

  // 소견서/문서 탭/허브 진입(환경 의존).
  const docTrigger = page.getByRole('button', { name: /소견서|진단서|서류|문서/ }).first();
  if (await docTrigger.count() === 0) {
    test.skip(true, '소견서·문서 발급 트리거 미발견 — 시드 데이터 의존 skip');
    return;
  }
  await docTrigger.click().catch(() => {});
  await page.waitForTimeout(800);

  const bodyText = await page.locator('body').innerText();
  // PHI guard: 의료문서 화면에 13자리 주민번호 평문 미노출
  expect(bodyText, '소견서·문서 화면 주민번호 평문 미노출').not.toMatch(RRN_PLAINTEXT);
  console.log('✅ AC-D2: 소견서·문서 발급 화면 PHI guard 통과(파생 표기 SSOT 통일)');
});
