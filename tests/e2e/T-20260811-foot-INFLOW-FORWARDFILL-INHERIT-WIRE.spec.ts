/**
 * E2E spec — T-20260811-foot-INFLOW-FORWARDFILL-INHERIT-WIRE (P2, forward-fill inheritance leg)
 *
 * 배경(부모 T-20260810-xcrm-INFLOW-FORWARDFILL-INHERIT-LEG · DA CONSULT-REPLY MSG-20260811-030657-trfw,
 *   §36-4-a genuine-first firewall):
 *   customers.first_inflow_channel(최초유입 canonical·immutable·first-write-wins) forward 상속률 4.9%(29/592).
 *   정본(crm) single-path 결속 shared-lineage. 풋 census 결과 = customers.first_inflow_channel 각인 write-site 2개:
 *     ① NewCheckInDialog(워크인) — 신규 customers INSERT 시 각인 = genuine-first by construction(안전, 무변경)
 *     ② createReservationCanonical(Reservations.tsx) — 예약생성 choke-point UPDATE
 *        · 구 가드 = `effectiveInflow && !existing`(=IS NULL 단독) → 기존 다-방문 고객(first_inflow=NULL 백로그)의
 *          later 예약을 최초유입으로 오각인 = attribution corruption(DA HARD REJECT).
 *
 * fix(FE-only·app-layer·no-DDL·forward-only): createReservationCanonical 의 first_inflow stamp 를
 *   genuine-first(진성 first-touch = 사전 예약 0건 AND 사전 체크인 0건) 게이트로 강화 +
 *   DB-level first-write-wins 방어(.is('first_inflow_channel', null)) + rows-affected 검증.
 *   unknown → 미각인(NULL 유지·합성 금지). NULL 백로그 무접촉(소급 없음).
 *
 * 검증(배선 정적 — 로그인 비의존, 형제 foot inflow spec 동형):
 *   시나리오1 → genuine-first 헬퍼 실재 + stamp 가 헬퍼 게이트 하에서만 발화.
 *   시나리오2 → §36 방화벽: first_inflow_* / inflow 축만 접촉. referral_source/source_system write 무접점.
 *   시나리오3 → rows-affected 검증(.select('id')) + first-write-wins DB 가드(.is null).
 *   시나리오4 → forward-only·no-DDL(db_change=false): 신규 마이그·백로그 백필 미생성.
 *
 * 티켓: T-20260811-foot-INFLOW-FORWARDFILL-INHERIT-WIRE
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const read = (p: string) => fs.readFileSync(path.resolve(ROOT, p), 'utf-8');

const RESERVATIONS = 'src/pages/Reservations.tsx';

/** 앵커 기준 블록 슬라이스(정적 배선 검증용). */
function slice(src: string, startAnchor: string, len = 1600): string {
  const i = src.indexOf(startAnchor);
  expect(i, `앵커 미발견: ${startAnchor}`).toBeGreaterThanOrEqual(0);
  return src.slice(i, i + len);
}

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오1 — genuine-first 게이트 실재 + stamp 는 게이트 하에서만
// ─────────────────────────────────────────────────────────────────────────────
test.describe('시나리오1: genuine-first firewall 배선', () => {
  test('AC1-a: isGenuineFirstTouch 헬퍼 실재 — 사전 예약 0 AND 사전 체크인 0 판별', () => {
    const src = read(RESERVATIONS);
    expect(src).toContain('async function isGenuineFirstTouch');
    const helper = slice(src, 'async function isGenuineFirstTouch', 900);
    // 두 축(reservations + check_ins) 사전건수 count 조회
    expect(helper).toMatch(/from\('reservations'\)[\s\S]*count:\s*'exact'/);
    expect(helper).toMatch(/from\('check_ins'\)[\s\S]*count:\s*'exact'/);
    // 둘 다 0일 때만 true
    expect(helper).toMatch(/===\s*0\s*&&[\s\S]*===\s*0/);
    // count 조회 실패 시 보수적(under-stamp) — first-touch 아님
    expect(helper).toMatch(/error[\s\S]*return false/);
  });

  test('AC1-b: first_inflow stamp 는 genuineFirst 게이트 하에서만 발화(IS NULL 단독 불충분)', () => {
    const src = read(RESERVATIONS);
    const block = slice(src, 'else if (effectiveInflow && !existing)', 1200);
    // genuine-first 판정 후에만 stamp
    expect(block).toContain('isGenuineFirstTouch(input.customerId)');
    expect(block).toMatch(/if\s*\(\s*genuineFirst\s*\)/);
    // stamp 대상은 canonical first_inflow_channel
    expect(block).toContain('first_inflow_channel: effectiveInflow');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오2 — §36 방화벽: inflow 축만. 금지 컬럼 write 무접점
// ─────────────────────────────────────────────────────────────────────────────
test.describe('시나리오2: §36 방화벽 — 금지축 무접점', () => {
  test('AC2-a: stamp UPDATE payload 는 first_inflow_* 만 — referral_source/source_system 미포함', () => {
    const src = read(RESERVATIONS);
    const block = slice(src, 'else if (effectiveInflow && !existing)', 1200);
    // UPDATE payload = first_inflow_channel/at/source_ref 만
    expect(block).toContain('first_inflow_at');
    expect(block).not.toMatch(/referral_source\s*:/);
    expect(block).not.toMatch(/source_system\s*:/);
    expect(block).not.toMatch(/lead_source\s*:/);
  });

  test('AC2-b: 본 티켓 배선 코멘트가 §36 방화벽/genuine-first 명시', () => {
    const src = read(RESERVATIONS);
    const parts = src.split('T-20260811-foot-INFLOW-FORWARDFILL-INHERIT-WIRE').slice(1);
    expect(parts.length, '티켓 코멘트 부재').toBeGreaterThan(0);
    const joined = parts.join('\n');
    expect(joined).toMatch(/§36|방화벽|first-touch|genuine-first/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오3 — rows-affected 검증 + DB-level first-write-wins 가드
// ─────────────────────────────────────────────────────────────────────────────
test.describe('시나리오3: rows-affected 검증 + first-write-wins DB 가드', () => {
  test('AC3-a: stamp UPDATE 는 .is(first_inflow_channel,null) 경합가드 + .select 로 rows-affected 확보', () => {
    const src = read(RESERVATIONS);
    const block = slice(src, 'else if (effectiveInflow && !existing)', 2000);
    expect(block).toMatch(/\.is\(\s*'first_inflow_channel'\s*,\s*null\s*\)/);
    expect(block).toMatch(/\.select\(\s*'id'\s*\)/);
    // 0행/에러 분기(blanket write 금지) 로깅
    expect(block).toMatch(/stamped[\s\S]*length\s*===\s*0/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오4 — forward-only · no-DDL(db_change=false) · NULL 백로그 무접촉
// ─────────────────────────────────────────────────────────────────────────────
test.describe('시나리오4: forward-only · no-DDL', () => {
  test('AC4-a: 본 티켓 신규 마이그레이션/백로그 백필 파일 미생성(db_change=false)', () => {
    const migDir = path.resolve(ROOT, 'supabase/migrations');
    const migs = fs.existsSync(migDir) ? fs.readdirSync(migDir) : [];
    const own = migs.filter(
      (m) => m.includes('FORWARDFILL') || m.includes('forwardfill') || m.includes('inflow_inherit'),
    );
    expect(own, `신규 마이그 생성됨(db_change=false 위반): ${own.join(', ')}`).toHaveLength(0);
  });
});
