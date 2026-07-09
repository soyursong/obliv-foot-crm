/**
 * T-20260709-foot-RESVDETAIL-NAME-FALLBACK-HARDEN
 * 예약상세 팝업 성함 방어 폴백(belt&suspenders) 정적 검증 — detail-path parity
 *
 * 배경(부모 T-20260709-foot-COMPANION-RESV-FIELD-DROP RC-FINAL 후속 FOLLOWUP MSG-20260709-104904-ub6i):
 *   ReservationDetailPopup 은 reservations.customer_name 을 직접 read → 현재 데이터엔 성함 공란 없음(정상).
 *   단 형제 list read-api(READAPI-MIRROR)는 customer_name NULL/공란 시 customer_real_name 스냅샷
 *   (cross_crm_data_contract §4-2b)으로 COALESCE 폴백 방어를 이미 보유. detail 팝업은 그 폴백 부재 = 비대칭 방어공백.
 *   본건 = detail 팝업에 동일 폴백 이식(malformed push 재발 대비 선제 보완). 현재 필드영향 0.
 *
 * ─ 검증 범위 (AC1 성함 폴백 parity / AC2 정상 무회귀) ───────────────
 *   NF-1: resvNameFallback 헬퍼 존재 — customer_name → customer_real_name COALESCE(.trim 방어)
 *   NF-2: Reservation 타입에 customer_real_name 폴백 소스 필드 선언(read-only 축)
 *   NF-3: 헤더 타이틀 성함이 폴백 헬퍼 경유(reservation.customer_name 직접 하드바인딩 제거)
 *   NF-4: 환자정보 '이름' FieldRow 가 폴백 헬퍼 경유
 *   NF-5: 취소/노쇼/복원 다이얼로그 성함도 폴백 헬퍼 경유(parity, raw customer_name 잔존 0)
 *   NF-6: AC2 무회귀 — 폴백은 customer_name 우선(값 있으면 상단), NULL/공란일 때만 real_name
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const POPUP_PATH = path.resolve(
  __dirname,
  '../../src/components/ReservationDetailPopup.tsx',
);
const TYPES_PATH = path.resolve(__dirname, '../../src/lib/types.ts');

// ── NF-1: resvNameFallback 헬퍼 존재 + COALESCE 폴백 ─────────────────
test('NF-1: resvNameFallback 헬퍼 — customer_name → customer_real_name COALESCE(.trim)', () => {
  const src = fs.readFileSync(POPUP_PATH, 'utf-8');
  expect(src).toContain('function resvNameFallback');
  const start = src.indexOf('function resvNameFallback');
  const body = src.slice(start, src.indexOf('}', start) + 1);
  // customer_name 우선, customer_real_name 폴백
  expect(body).toContain('customer_name');
  expect(body).toContain('customer_real_name');
  // NULL·공란 모두 방어(형제 read-api realName 정규화와 동일 .trim 관례)
  expect(body).toContain('.trim()');
});

// ── NF-2: Reservation 타입에 customer_real_name 폴백 소스 필드 ────────
test('NF-2: Reservation 타입에 customer_real_name 폴백 소스 필드 선언', () => {
  const src = fs.readFileSync(TYPES_PATH, 'utf-8');
  const resvBlock = src.slice(src.indexOf('export interface Reservation'), src.indexOf('export interface ReservationRegistrar'));
  expect(resvBlock).toContain('customer_real_name');
  // optional/nullable(신규 컬럼 유입 tolerant read + 기존 예약 NULL 정상)
  expect(resvBlock).toMatch(/customer_real_name\?:\s*string\s*\|\s*null/);
});

// ── NF-3: 헤더 타이틀 성함이 폴백 헬퍼 경유 ──────────────────────────
test('NF-3: 헤더 타이틀 성함 = resvNameFallback 경유(raw customer_name 하드바인딩 제거)', () => {
  const src = fs.readFileSync(POPUP_PATH, 'utf-8');
  expect(src).toContain('loadedMatch?.name ?? customer?.name ?? resvNameFallback(reservation)');
});

// ── NF-4: 환자정보 '이름' FieldRow 폴백 경유 ────────────────────────
test('NF-4: 환자정보 이름 FieldRow = resvNameFallback 경유', () => {
  const src = fs.readFileSync(POPUP_PATH, 'utf-8');
  expect(src).toContain("customer?.name ?? (resvNameFallback(reservation) || '—')");
});

// ── NF-5: 취소/노쇼/복원 다이얼로그 성함도 폴백 경유(parity) ─────────
test('NF-5: 취소/노쇼/복원 다이얼로그 성함 = resvNameFallback 경유', () => {
  const src = fs.readFileSync(POPUP_PATH, 'utf-8');
  // 노쇼 confirm
  expect(src).toContain("resvNameFallback(reservation) || '고객'}님을 노쇼");
  // 복원 confirm
  expect(src).toContain("resvNameFallback(reservation) || '고객'}님 예약을 복원");
  // 취소 다이얼로그 타이틀
  expect(src).toContain("예약 취소 — {resvNameFallback(reservation) || '고객'}");
});

// ── NF-6: AC2 무회귀 — customer_name 우선순위 상단(값 있으면 real_name 미발동) ──
test('NF-6: AC2 무회귀 — customer_name 우선, NULL/공란일 때만 real_name 폴백', () => {
  const src = fs.readFileSync(POPUP_PATH, 'utf-8');
  const start = src.indexOf('function resvNameFallback');
  const body = src.slice(start, src.indexOf('}', start) + 1);
  // customer_name 이 customer_real_name 보다 앞(|| 좌항) — 정상 데이터 우선순위 상단
  const nameIdx = body.indexOf('customer_name');
  const realIdx = body.indexOf('customer_real_name');
  expect(nameIdx).toBeGreaterThan(-1);
  expect(realIdx).toBeGreaterThan(nameIdx);
  // OR 폴백 체인(||)으로 결합 — customer_name 값 있으면 short-circuit
  expect(body).toMatch(/customer_name\?\.trim\(\)\s*\|\|\s*r\?\.customer_real_name/);
});
