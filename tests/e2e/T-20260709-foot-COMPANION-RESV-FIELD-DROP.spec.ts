/**
 * T-20260709-foot-COMPANION-RESV-FIELD-DROP — 동행 예약상세 성함 폴백(foot-side 재분기)
 *
 * RC 확정(dev-dopamine yb3m, 티켓 §2): detail 폼 매핑 gap. 동행(customer_id=NULL) 예약은
 *   customers JOIN 결과가 NULL → 예약상세 폼이 live customer.name 을 못 얻는다.
 *   기존 코드는 customer_name 까지만 폴백 → customer_name 결측 시 성함 공란.
 *   ⇒ AC2: customer_real_name 스냅샷(cross_crm_data_contract §4-2b)까지 COALESCE 폴백 추가 = foot read 몫.
 *
 * ★ 스코프 경계(ground-truth RC): 예약경로(visit_route)·예약등록자(registrar_name)·예약메모(timeline) 3필드는
 *   기존 source_system==='dopamine' 표시 경로(FOOTPUSH-ROUTE-TM-REGISTRANT)로 이미 렌더 → 본 티켓 코드변경 대상 아님.
 *   간략메모(brief_note)=dopamine 013691e emit fix 몫(배포 후 신규 동행부터). 본 spec 은 성함 폴백(AC2)만 정적 검증.
 *
 * ─ 검증 범위 ──────────────────────────────────────────────────────
 *   NF-1: Reservation 타입에 customer_real_name(read-only 스냅샷) 필드 존재
 *   NF-2: 예약상세 헤더 고객명 바인딩이 customer_real_name 까지 폴백
 *   NF-3: 환자정보 '이름' FieldRow 가 customer_real_name 까지 폴백
 *   NF-4: 폴백 순서 = customer(live) → customer_name → customer_real_name (스냅샷 최후순)
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TYPES_PATH = path.resolve(__dirname, '../../src/lib/types.ts');
const POPUP_PATH = path.resolve(__dirname, '../../src/components/ReservationDetailPopup.tsx');

// ── NF-1: Reservation 타입에 customer_real_name 필드 ────────────────
test('NF-1: Reservation 타입에 customer_real_name(read-only 스냅샷) 필드 존재', () => {
  const src = fs.readFileSync(TYPES_PATH, 'utf-8');
  const ifaceStart = src.indexOf('export interface Reservation {');
  expect(ifaceStart).toBeGreaterThan(-1);
  // Reservation 인터페이스 본문(다음 최상위 선언 전까지)만 슬라이스 — 파일 앞쪽 다른 인터페이스의 동명 필드 오검출 방지.
  const ifaceBody = src.slice(ifaceStart, src.indexOf('\n}', ifaceStart));
  expect(ifaceBody).toContain('customer_real_name');
});

// ── NF-2: 헤더 고객명 바인딩 폴백 ───────────────────────────────────
test('NF-2: 예약상세 헤더 고객명이 customer_real_name 까지 폴백', () => {
  const src = fs.readFileSync(POPUP_PATH, 'utf-8');
  // <span>{ ... reservation.customer_name ?? reservation.customer_real_name}</span>
  expect(src).toMatch(/loadedMatch\?\.name \?\? customer\?\.name \?\? reservation\.customer_name \?\? reservation\.customer_real_name/);
});

// ── NF-3: '이름' FieldRow 폴백 ──────────────────────────────────────
test('NF-3: 환자정보 이름 FieldRow 가 customer_real_name 까지 폴백', () => {
  const src = fs.readFileSync(POPUP_PATH, 'utf-8');
  expect(src).toMatch(/label="이름"\s+value=\{customer\?\.name \?\? reservation\.customer_name \?\? reservation\.customer_real_name \?\? '—'\}/);
});

// ── NF-4: 폴백 순서(스냅샷 최후순) — customer_real_name 이 customer_name 뒤 ─
test('NF-4: 폴백 순서 = customer_name → customer_real_name (스냅샷 최후순, live 우선 보존)', () => {
  const src = fs.readFileSync(POPUP_PATH, 'utf-8');
  const idxName = src.indexOf('reservation.customer_name ?? reservation.customer_real_name');
  expect(idxName).toBeGreaterThan(-1);
  // customer_real_name 단독(잘못된 우선) 이 name 앞에 오지 않는지: real_name ?? customer_name 역순 부재
  expect(src).not.toContain('reservation.customer_real_name ?? reservation.customer_name');
});
