/**
 * T-20260713-foot-COMPANION-RESVCLICK-NEWPOPUP-MISROUTE (P1 hotfix, FE-only)
 * 풋CRM 예약관리(/admin/reservations) 동행 예약 row 클릭 → '신규예약 생성 팝업' 오출력 정적 검증.
 *
 * RC (확정, dev-foot / AC-4):
 *   동행(companion) 예약은 dopamine emit shape 상 customer_id=NULL + external_id `_comp_` 로 착지하는
 *   '의도된 정본'(변경 금지). Reservations.tsx 예약카드 이름 클릭 분기가 예약 row 존재(r.id)가 아니라
 *   customer_id 유무로 라우팅 → customer_id=NULL 동행행이 '고객 미연결(=예약 없음/신규)' 로 오판되어
 *   기존 예약 상세가 아닌 신규예약 생성 팝업 계열 동선으로 새던 것이 근인.
 *   또 컨텍스트메뉴 개방이 `if (r.customer_id)` 게이트라 동행행은 [예약상세] 진입 자체가 막혔다.
 *
 * FIX (FE onClick/렌더 분기만 — emit shape 불변):
 *   S1: handleResvCardOpen — customer_id=NULL 예약 클릭 시 setDetail(r)=예약 상세 팝업(기존 예약 모드),
 *       customer_id 有 는 기존 고객차트 동선 완전 불변(AC-2 회귀 0).
 *   S2: 이름-span 클릭 핸들러(일간/주간 뷰) 가 handleResvCardOpen(r) 경유(예약 row 기준 라우팅).
 *   S3: 컨텍스트메뉴 개방 게이트가 customer_id → r.id(예약 row 존재) 로 교정(동행 [예약상세] 진입 가능, AC-3).
 *   S4: 동행 emit shape(customer_id NULL / external_id `_comp_` / is_companion 파생)는 FE 어디에서도
 *       변경하지 않음 — 클릭 분기만 교정(AC-4 shape lock).
 *
 * ※ 본 레포 컨벤션(정적 소스 단언) 준수 — 런타임 DB/로그인 불요.
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RESV_PATH = path.resolve(__dirname, '../../src/pages/Reservations.tsx');
const src = fs.readFileSync(RESV_PATH, 'utf-8');

// ── S1: handleResvCardOpen — customer_id=NULL → 예약 상세 팝업(setDetail) ─────────
test('S1: handleResvCardOpen 은 customer_id 부재 시 setDetail(예약 상세)로 라우팅', () => {
  expect(src).toContain('const handleResvCardOpen');
  const start = src.indexOf('const handleResvCardOpen');
  const block = src.slice(start, start + 400);
  // customer_id 미연결(!r.customer_id) → setDetail(r) (신규예약 생성 팝업 트리거 아님)
  expect(block).toContain('if (!r.customer_id)');
  expect(block).toContain('setDetail(r)');
  // 연결건은 기존 고객차트 동선 유지(AC-2 회귀 0)
  expect(block).toContain('handleResvOpenChart(resvAsCheckIn(r))');
  // 동행 클릭이 신규예약 모드로 새지 않아야 함 — 이 핸들러는 setNewReservationMode 를 호출하지 않는다
  expect(block).not.toContain('setNewReservationMode');
  expect(block).not.toContain('openNewSlot');
});

// ── S2: 이름-span 클릭 핸들러가 handleResvCardOpen 경유(일간/주간 뷰 공통) ──────────
test('S2: 이름 클릭 핸들러가 handleResvCardOpen(r) 을 호출(≥2회: 일간+주간 뷰)', () => {
  const occurrences = src.split('handleResvCardOpen(r)').length - 1;
  expect(occurrences).toBeGreaterThanOrEqual(2);
});

// ── S3: 컨텍스트메뉴 개방 게이트 = 예약 row 존재(r.id), customer_id 게이트 제거 ───────
test('S3: 컨텍스트메뉴 개방이 customer_id 가 아니라 r.id(예약 row) 기준', () => {
  // 동행행도 메뉴가 열려 [예약상세] 진입 가능해야 함 — if (r.id) { ... setResvContextMenu ... }
  expect(src).toContain('if (r.id) { e.preventDefault(); e.stopPropagation(); setResvContextMenu(');
  // 구 게이트(카드 우클릭이 customer_id 있을 때만) 잔존 금지
  expect(src).not.toContain('if (r.customer_id) { e.preventDefault(); e.stopPropagation(); setResvContextMenu(');
});

// ── S4: emit shape 불변 — FE 는 동행 식별필드를 write/변형하지 않는다 ──────────────
test('S4: Reservations.tsx 는 동행 emit shape(customer_id/external_id)를 변형하지 않는다', () => {
  // external_id 를 이 화면에서 write 하는 코드 없음(동행 판정/파생은 read-api EF 소관, FE 무접점)
  expect(src).not.toContain("external_id: '");
  expect(src).not.toContain('.update({ external_id');
});
