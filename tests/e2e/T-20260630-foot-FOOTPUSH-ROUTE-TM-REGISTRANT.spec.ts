/**
 * T-20260630-foot-FOOTPUSH-ROUTE-TM-REGISTRANT (AC-1)
 * 도파민→풋 ingest 예약의 풋 예약상세 '예약경로' = 'TM' 표시 갭 보강.
 *
 * ─ 증상 ───────────────────────────────────────────────────────────
 *   도파민 TM 이 만든 풋 예약을 풋 예약상세 팝업에서 열면 예약경로가 '미지정'/'—'.
 *   (신규 EF ingest 는 visit_route='TM' 착지하지만, visit_route 미수신/legacy 인입 건은
 *    reservations.visit_route=NULL → 표시 갭.)
 *
 * ─ 수정 ───────────────────────────────────────────────────────────
 *   순수 display 매핑 resolveVisitRouteDisplay(visit_route, source_system):
 *   visit_route 가 비어 있고 source_system='dopamine' 이면 'TM' 표시.
 *
 * ─ 구현 가드(티켓 §AC-1) ─────────────────────────────────────────
 *   · reservations.source_system 값 'dopamine'→'TM' 직접 write 금지
 *     (형제 CUSTNAME-NULL-FIX backfill 의 source_system='dopamine' key 의존 +
 *      Revenue Source Split SSOT 의 source_system='TM' 광고 마커 오귀속 위험).
 *   · visit_route 도 매핑에서 파생 write 하지 않는다(직교 독립축). 순수 표시.
 *
 * 스펙: MQ MSG-20260630-110421-lzxf / 티켓 AC-1
 * (AC-2 예약등록자 계정매칭 = DA CONSULT 종속 → 본 스펙 범위 외)
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { resolveVisitRouteDisplay, resolveRegistrarDisplay } from '../../src/lib/types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const POPUP_PATH = path.resolve(
  __dirname,
  '../../src/components/ReservationDetailPopup.tsx',
);
const TYPES_PATH = path.resolve(__dirname, '../../src/lib/types.ts');

function readFile(p: string): string {
  return fs.readFileSync(p, 'utf-8');
}

// ── AC-1 (resolver 순수함수): 도파민 예약은 visit_route 비어도 'TM' ──
test('AC-1: source_system=dopamine + visit_route 빈값 → "TM" 표시', () => {
  expect(resolveVisitRouteDisplay(null, 'dopamine')).toBe('TM');
  expect(resolveVisitRouteDisplay('', 'dopamine')).toBe('TM');
  expect(resolveVisitRouteDisplay(undefined, 'dopamine')).toBe('TM');
  expect(resolveVisitRouteDisplay('   ', 'dopamine')).toBe('TM');
});

// ── AC-1: 명시 visit_route 가 있으면 그 값 우선(매핑이 덮어쓰지 않음) ──
test('AC-1: visit_route 명시값이 source_system 보다 우선', () => {
  // 도파민이 visit_route='TM' 운반해 EF 가 착지한 정상 경로
  expect(resolveVisitRouteDisplay('TM', 'dopamine')).toBe('TM');
  // 비-도파민 명시값은 그대로 보존
  expect(resolveVisitRouteDisplay('네이버', null)).toBe('네이버');
  expect(resolveVisitRouteDisplay('워크인', 'foot-walkin')).toBe('워크인');
  expect(resolveVisitRouteDisplay('인바운드', 'dopamine')).toBe('인바운드');
});

// ── AC-1: 비-도파민·미지정은 '' (caller 가 '—'/'미지정' graceful) ──
test('AC-1: 비-도파민 + 미지정 → 빈 문자열(graceful)', () => {
  expect(resolveVisitRouteDisplay(null, null)).toBe('');
  expect(resolveVisitRouteDisplay('', '')).toBe('');
  expect(resolveVisitRouteDisplay(null, 'foot-walkin')).toBe('');
  expect(resolveVisitRouteDisplay(undefined, undefined)).toBe('');
});

// ── 구현 가드: resolver 는 순수함수(부수효과·write 없음) ───────────
test('GUARD: resolveVisitRouteDisplay 는 입력만 읽는 순수 매핑(쓰기 0)', () => {
  const src = readFile(TYPES_PATH);
  const start = src.indexOf('export function resolveVisitRouteDisplay(');
  const end = src.indexOf('\n}', start);
  expect(start).toBeGreaterThan(-1);
  const body = src.slice(start, end);
  // DB write / supabase 호출 / 컬럼 mutate 흔적 없음
  expect(body).not.toMatch(/\.update\(|\.insert\(|\.upsert\(|supabase|from\(/);
  // source_system 을 'TM' 으로 치환하는 코드가 없어야 함(가드: source_system write 금지)
  expect(body).not.toMatch(/source_system\s*=/);
});

// ── 와이어링: 예약상세 팝업(편집 Select + 읽기 FieldRow) 이 resolver 경유 ──
test('AC-1: ReservationDetailPopup 가 resolveVisitRouteDisplay 로 예약경로 표시', () => {
  const src = readFile(POPUP_PATH);
  // import 존재
  expect(src).toMatch(/import\s*\{[^}]*resolveVisitRouteDisplay[^}]*\}\s*from\s*'@\/lib\/types'/);
  // 편집 Select value 가 resolver 경유 (anchor 예약, source_system 마커)
  expect(src).toMatch(
    /value=\{resolveVisitRouteDisplay\(visitRoute,\s*reservation\.source_system\)\s*\|\|\s*'__none__'\}/,
  );
  // 읽기 FieldRow(다른 예약) 도 resolver 경유
  expect(src).toMatch(
    /resolveVisitRouteDisplay\(selectedResv\.visit_route,\s*selectedResv\.source_system\)/,
  );
});

// ── 가드: 팝업/EF 어디에서도 source_system 을 'TM' 으로 덮어쓰지 않음 ──
test('GUARD: 팝업이 source_system 을 write/overwrite 하지 않음', () => {
  const src = readFile(POPUP_PATH);
  // visit_route 저장 payload 는 존치하되 source_system 키 write 는 없어야 함
  expect(src).not.toMatch(/source_system\s*:/);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-2: 예약등록자 provenance 표시 (도파민 신원 → 풋 staff-master write 0)
//   DA-20260630-FOOTPUSH-COUNSELOR-ATTRIBUTION = NO-SCHEMA-CHANGE_GO.
//   가드: 도파민 TM 신원을 풋 staff/registrar 마스터에 매핑/스탬프 금지 — 순수 표시 라벨만.
// ─────────────────────────────────────────────────────────────────────────────

// ── AC-2 (resolver 순수함수): registrar_name(EF 착지 라벨) 우선 표시 ──
test('AC-2: registrar_name(provenance 라벨) 이 있으면 그대로 표시', () => {
  // EF (b) 무매칭 → '[도파민TM] {name}' provenance 라벨 그대로
  expect(resolveRegistrarDisplay('[도파민TM] 김상담', 'dopamine')).toBe('[도파민TM] 김상담');
  // EF (b) 매칭 → 마스터 스냅샷 이름 그대로
  expect(resolveRegistrarDisplay('TM - 박상담', 'dopamine')).toBe('TM - 박상담');
  // 비-도파민이라도 이름이 있으면 표시(공란 금지)
  expect(resolveRegistrarDisplay('홍길동', null)).toBe('홍길동');
});

// ── AC-2: registrar_name 미보유 + 도파민 → '도파민 등록' 안전 폴백 ──
test('AC-2: 라벨 미보유 + source_system=dopamine → "도파민 등록" 폴백(공란/오귀속 금지)', () => {
  expect(resolveRegistrarDisplay(null, 'dopamine')).toBe('도파민 등록');
  expect(resolveRegistrarDisplay('', 'dopamine')).toBe('도파민 등록');
  expect(resolveRegistrarDisplay('   ', 'dopamine')).toBe('도파민 등록');
  expect(resolveRegistrarDisplay(undefined, 'dopamine')).toBe('도파민 등록');
});

// ── AC-2: 비-도파민 + 미보유는 '' (caller 가 '—'/편집 Select graceful) ──
test('AC-2: 비-도파민 + 라벨 미보유 → 빈 문자열(graceful, 회귀 0)', () => {
  expect(resolveRegistrarDisplay(null, null)).toBe('');
  expect(resolveRegistrarDisplay('', '')).toBe('');
  expect(resolveRegistrarDisplay(undefined, undefined)).toBe('');
  expect(resolveRegistrarDisplay(null, 'foot-walkin')).toBe('');
});

// ── 구현 가드: resolver 는 순수함수(부수효과·write·staff 매칭 없음) ──
test('GUARD: resolveRegistrarDisplay 는 입력만 읽는 순수 매핑(DB/staff write 0)', () => {
  const src = readFile(TYPES_PATH);
  const start = src.indexOf('export function resolveRegistrarDisplay(');
  const end = src.indexOf('\n}', start);
  expect(start).toBeGreaterThan(-1);
  const body = src.slice(start, end);
  // DB write / supabase 호출 흔적 없음
  expect(body).not.toMatch(/\.update\(|\.insert\(|\.upsert\(|supabase|from\(/);
  // staff / registrar_id 마스터 write·파생 흔적 없음(★급소: 인센티브 분모 오염 방지)
  expect(body).not.toMatch(/staff|registrar_id\s*=/);
});

// ── 와이어링: anchor 예약등록자 = 도파민 무매칭 시 읽기전용 provenance 라벨 ──
test('AC-2: ReservationDetailPopup anchor 예약등록자 가 도파민 무매칭 시 provenance 읽기전용', () => {
  const src = readFile(POPUP_PATH);
  // import 존재
  expect(src).toMatch(/import\s*\{[^}]*resolveRegistrarDisplay[^}]*\}\s*from\s*'@\/lib\/types'/);
  // source_system='dopamine' && !registrarId 분기로 읽기전용 표시
  expect(src).toMatch(/reservation\.source_system\s*===\s*'dopamine'\s*&&\s*!registrarId/);
  // provenance 라벨 read-only span(편집 Select 대신)
  expect(src).toMatch(/data-testid="popup-registrar-provenance"/);
  expect(src).toMatch(
    /resolveRegistrarDisplay\(reservation\.registrar_name,\s*reservation\.source_system\)/,
  );
  // 읽기 FieldRow(다른 예약) 도 resolver 경유(공란 대신 provenance 폴백)
  expect(src).toMatch(
    /resolveRegistrarDisplay\(selectedResv\.registrar_name,\s*selectedResv\.source_system\)/,
  );
});

// ── 가드: 팝업이 도파민 registrar 를 풋 staff/registrar 마스터로 write 하지 않음 ──
test('GUARD: 팝업이 도파민 provenance 를 registrar_id/staff 로 영속하지 않음(순수 표시)', () => {
  const src = readFile(POPUP_PATH);
  // provenance 분기는 표시 전용 — 저장 payload(registrar_id) 파생 write 없음.
  //   anchor Select 저장경로는 사용자 명시 선택(registrarId state)만 영속하며
  //   도파민 분기에서는 Select 자체가 렌더되지 않음(읽기전용 span).
  const start = src.indexOf('data-testid="popup-registrar-provenance"');
  expect(start).toBeGreaterThan(-1);
  // provenance span 영역 근처에 insert/update/registrar_id= 대입 없음
  const around = src.slice(start - 400, start + 400);
  expect(around).not.toMatch(/\.update\(|\.insert\(|\.upsert\(/);
});
