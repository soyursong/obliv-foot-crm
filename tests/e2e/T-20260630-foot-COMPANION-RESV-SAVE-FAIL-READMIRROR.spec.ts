/**
 * T-20260630-dopamine-FOOT-COMPANION-RESV-SAVE-FAIL — read-half (foot mirror)
 * reservations-read-api EF 동행(companion) 리스트모드 표기 확장 정적 검증
 *
 * CONSULT(dev-dopamine → dev-foot, MSG-20260708-152126-582g) read-half:
 *   write 계약(§444/§52)으로 동행은 foot 에 customer_id=NULL + customer_real_name(동행명) 착지.
 *   read EF(reservations-read-api)가 customer 행 기준이라 동행 행은 customer.name 비어 → 미러 미표기(AC-1 미충족).
 *   본 확장: (1) null-customer 표시명 폴백(customer_real_name), (2) is_companion 응답 필드.
 *
 * ─ 검증 범위 ──────────────────────────────────────────────────────
 *   RM-1: SELECT 에 customer_id / customer_real_name 포함
 *   RM-2: is_companion 판정 로직 (customer_id NULL & 외부유입 || external_id '#companion-')
 *   RM-3: 동행 폴백 — customer_real_name → name/name_masked, 비면 '동행' 라벨
 *   RM-4: 동행 무폰 → phone_e164_last4 '****'
 *   RM-5: 응답에 is_companion 필드 노출
 *   RM-6: 진성 customer 행 경로 불변(마스킹 + include_full_pii 게이트 유지)
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EF_PATH = path.resolve(
  __dirname,
  '../../supabase/functions/reservations-read-api/index.ts',
);

// ── RM-1: SELECT 에 customer_id / customer_real_name 포함 ────────────
test('RM-1: SELECT 에 customer_id + customer_real_name 포함', () => {
  const src = fs.readFileSync(EF_PATH, 'utf-8');
  const selectBlock = src.slice(src.indexOf('.from(\'reservations\')'), src.indexOf('.order('));
  expect(selectBlock).toContain('customer_id');
  expect(selectBlock).toContain('customer_real_name');
});

// ── RM-2: is_companion 판정 로직 ────────────────────────────────────
test('RM-2: is_companion 판정 — customer_id NULL & 외부유입 || external_id #companion-', () => {
  const src = fs.readFileSync(EF_PATH, 'utf-8');
  expect(src).toContain('const isCompanion');
  // 1차: 외부유입(source_system NOT NULL) & customer_id NULL
  expect(src).toContain('srcSystem !== null && custId === null');
  // 2차: external_id composite 동행키
  expect(src).toContain("'#companion-'");
});

// ── RM-3: 동행 폴백 — customer_real_name → name, 비면 '동행' ─────────
test('RM-3: 동행 표시명 폴백 (customer_real_name → 없으면 동행 라벨)', () => {
  const src = fs.readFileSync(EF_PATH, 'utf-8');
  expect(src).toContain('customer_real_name');
  expect(src).toContain("realName || '동행'");
  expect(src).toContain("realName ? maskName(realName) : '동행'");
});

// ── RM-4: 동행 무폰 → '****' ────────────────────────────────────────
test('RM-4: 동행 무폰 last4 = ****', () => {
  const src = fs.readFileSync(EF_PATH, 'utf-8');
  const companionBlock = src.slice(src.indexOf('else if (isCompanion)'), src.indexOf('} else {'));
  expect(companionBlock).toContain("phone_e164_last4: '****'");
});

// ── RM-5: 응답에 is_companion 필드 노출 ─────────────────────────────
test('RM-5: 응답 객체에 is_companion 필드', () => {
  const src = fs.readFileSync(EF_PATH, 'utf-8');
  expect(src).toContain('is_companion:     isCompanion');
});

// ── RM-6: 진성 customer 행 경로 불변 (마스킹 + include_full_pii 게이트) ─
test('RM-6: 진성 customer 경로 — 마스킹 + include_full_pii 게이트 유지', () => {
  const src = fs.readFileSync(EF_PATH, 'utf-8');
  expect(src).toContain('if (customer) {');
  expect(src).toContain('maskName(customer[\'name\'])');
  expect(src).toContain('maskPhoneLast4(customer[\'phone\'])');
  expect(src).toContain('includeFullPii &&');
});
