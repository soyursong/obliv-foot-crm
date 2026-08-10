/**
 * E2E spec — T-20260810-foot-INFLOW-RESV-COVERAGE-COMPLETE (P1, coverage-complete)
 *
 * 배경(DA 재실측 2026-08-10, MSG-20260810-212022-q293):
 *   08-03 RESVFORM-DROPDOWN-WIRING(deployed) 가 사전예약 접수 폼(Reservations.tsx / ReservationDetailPopup)에
 *   유입경로 드롭다운을 배선해 reservations.inflow_channel 채움률 0%→21% 로 회복시켰으나 DoD ≥95% 미달.
 *   STEP1 READ-ONLY census(scripts/T-20260810-...COVERAGE-COMPLETE_census.mjs) 로 잔여 미배선
 *   reservations INSERT 주면을 전수 식별.
 *
 * fix(STEP2, FE-only·no-DDL·forward-only): 잔여 staff 예약생성 주면에 유입경로 canonical 상속(first-write-wins)을
 *   uniform 배선. 재진/복사 동선은 재입력 없이 고객 최초유입(customers.first_inflow_channel) 또는 원본행 값을 승계.
 *     · Dashboard.tsx 빠른예약추가(handleSave)       — 연결고객 first_inflow 상속
 *     · CustomerChartPage.tsx saveResvMini(재진)     — 고객 first_inflow 상속 (fetchCustomerFirstInflow)
 *     · CustomerChartPage.tsx saveInlineResv(재진)   — 고객 first_inflow 상속 (fetchCustomerFirstInflow)
 *     · Reservations.tsx 키보드 복사(Ctrl+V copy)    — 원본행 inflow_channel 승계
 *
 * ★ 알려진 한계(FOLLOWUP 반송): 채움률 분모 지배축 = dopamine/TM 예약(source_system=dopamine, created_via=dopamine).
 *   census C2/C5 = dopamine 66% / 0% 채움. 이는 reservation-ingest-from-dopamine EF(server-side, §36 축)이며
 *   TM auto-stamp 는 DA 정책 판정(canonical TM 코드) 사안이다. 구 lead_source→11코드 매핑/치환 = §36 Q3 방화벽 NO-GO.
 *   → 본 FE 배선만으로 aggregate ≥95% 도달 불가. dopamine leg 는 별도 DA CONSULT 게이트.
 *
 * 검증(배선 정적 — 로그인 비의존, 형제 foot spec 동형):
 *   시나리오1 → 4개 잔여 주면에 inflow_channel 상속 write 배선 실재.
 *   시나리오2 → §36 방화벽: 신규 배선은 inflow 축만 접촉. referral_source/source_system/lead_source 로의 write 무접점.
 *   시나리오3 → forward-only·no-DDL: 신규 마이그레이션 파일 미생성(db_change=false).
 *
 * 티켓: T-20260810-foot-INFLOW-RESV-COVERAGE-COMPLETE
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const read = (p: string) => fs.readFileSync(path.resolve(ROOT, p), 'utf-8');

const DASHBOARD = 'src/pages/Dashboard.tsx';
const CHART = 'src/pages/CustomerChartPage.tsx';
const RESERVATIONS = 'src/pages/Reservations.tsx';

/** 특정 함수/블록 본문을 앵커 기준으로 슬라이스(정적 배선 검증용). */
function slice(src: string, startAnchor: string, len = 1400): string {
  const i = src.indexOf(startAnchor);
  expect(i, `앵커 미발견: ${startAnchor}`).toBeGreaterThanOrEqual(0);
  return src.slice(i, i + len);
}

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오1 — 4개 잔여 주면 inflow_channel 상속 write 배선 실재
// ─────────────────────────────────────────────────────────────────────────────
test.describe('시나리오1: 잔여 예약생성 주면 유입경로 canonical 상속 배선', () => {
  test('AC1-a: Dashboard 빠른예약추가 — 연결고객 first_inflow 상속 후 inflow_channel write', () => {
    const src = read(DASHBOARD);
    const block = slice(src, 'let inheritedInflowQuick', 900);
    // 상속 read (customers.first_inflow_channel) + 예약행 write
    expect(block).toContain("first_inflow_channel");
    expect(block).toMatch(/inflow_channel:\s*inheritedInflowQuick/);
    expect(src).toContain('T-20260810-foot-INFLOW-RESV-COVERAGE-COMPLETE');
  });

  test('AC1-b: CustomerChartPage saveResvMini(재진) — 고객 first_inflow 상속 write', () => {
    const src = read(CHART);
    // 헬퍼 실재
    expect(src).toContain('async function fetchCustomerFirstInflow');
    const block = slice(src, 'const inheritedInflowMini', 700);
    expect(block).toContain('fetchCustomerFirstInflow(customer.id)');
    expect(block).toMatch(/inflow_channel:\s*inheritedInflowMini/);
  });

  test('AC1-c: CustomerChartPage saveInlineResv(재진) — 고객 first_inflow 상속 write', () => {
    const src = read(CHART);
    const block = slice(src, 'const inheritedInflowInline', 700);
    expect(block).toContain('fetchCustomerFirstInflow(customer.id)');
    expect(block).toMatch(/inflow_channel:\s*inheritedInflowInline/);
  });

  test('AC1-d: Reservations 키보드 복사(Ctrl+V copy) — 원본행 inflow_channel 승계', () => {
    const src = read(RESERVATIONS);
    // copy insert 블록: srcRow 승계
    const block = slice(src, "cb.mode === 'copy'", 1600);
    expect(block).toMatch(/inflow_channel:\s*srcRow\.inflow_channel\s*\?\?\s*null/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오2 — §36 방화벽: 신규 배선은 inflow 축만. 금지 컬럼 write 무접점
// ─────────────────────────────────────────────────────────────────────────────
test.describe('시나리오2: §36 방화벽 — 신규 배선 금지축 무접점', () => {
  const fetchInflowHelper = () => {
    const src = read(CHART);
    return slice(src, 'async function fetchCustomerFirstInflow', 600);
  };

  test('AC2-a: 상속 헬퍼는 first_inflow_channel(inflow 축)만 read — 금지 컬럼 미참조', () => {
    const helper = fetchInflowHelper();
    expect(helper).toContain('first_inflow_channel');
    // referral_source / source_system / lead_source 로의 read/write 무접점
    expect(helper).not.toMatch(/referral_source/);
    expect(helper).not.toMatch(/source_system/);
    expect(helper).not.toMatch(/lead_source/);
  });

  test('AC2-b: 신규 상속 배선 코멘트가 §36 방화벽(referral_source/source_system 무저촉) 명시', () => {
    for (const f of [DASHBOARD, CHART, RESERVATIONS]) {
      const src = read(f);
      // 본 티켓 코멘트 라인에 §36 방화벽 언급 실재
      const ticketBlocks = src.split('T-20260810-foot-INFLOW-RESV-COVERAGE-COMPLETE').slice(1);
      expect(ticketBlocks.length, `${f}: 티켓 코멘트 부재`).toBeGreaterThan(0);
      const joined = ticketBlocks.join('\n');
      expect(joined).toMatch(/§36|방화벽|referral_source/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오3 — forward-only · no-DDL(db_change=false)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('시나리오3: forward-only · no-DDL', () => {
  test('AC3-a: 본 티켓 신규 마이그레이션 파일 미생성(db_change=false)', () => {
    const migDir = path.resolve(ROOT, 'supabase/migrations');
    const migs = fs.existsSync(migDir) ? fs.readdirSync(migDir) : [];
    const own = migs.filter((m) => m.includes('INFLOW-RESV-COVERAGE-COMPLETE') || m.includes('inflow_resv_coverage_complete'));
    expect(own, `신규 마이그 생성됨(db_change=false 위반): ${own.join(', ')}`).toHaveLength(0);
  });
});
