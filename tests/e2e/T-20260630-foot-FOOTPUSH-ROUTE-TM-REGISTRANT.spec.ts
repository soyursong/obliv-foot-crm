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
import { resolveVisitRouteDisplay } from '../../src/lib/types';

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
