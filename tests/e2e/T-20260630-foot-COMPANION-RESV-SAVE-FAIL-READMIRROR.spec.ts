/**
 * T-20260708-foot-COMPANION-READAPI-MIRROR-DISPLAY (부모 T-20260630-dopamine-FOOT-COMPANION-RESV-SAVE-FAIL AC-1)
 * reservations-read-api EF 동행(companion) 리스트모드 표기 확장 정적 검증 — read-half (foot mirror)
 *
 * CONSULT(dev-dopamine → dev-foot, MSG-20260708-152126-582g / dedicated 2k4l Q3) read-half:
 *   write 계약(§444/§52)으로 동행은 foot 에 customer_id=NULL + customer_real_name(동행명) 착지.
 *   read EF(reservations-read-api)가 customer 행 기준이라 동행 행은 customer.name 비어 → 미러 미표기(AC-1 미충족).
 *   본 확장: (1) null-customer 표시명 폴백(customer_real_name), (2) is_companion 응답 필드.
 *
 * ★AC-4 (2k4l Q3 shape lock): is_companion 은 composite external_id 패턴('_comp_'/'#companion-') 결정적 파생.
 *   customer_id=NULL 휴리스틱 금지 — prod 126건 legacy customer_id=NULL 비동행을 동행으로 오분류 방지.
 *
 * ─ 검증 범위 ──────────────────────────────────────────────────────
 *   RM-1: SELECT 에 customer_id / customer_real_name 포함
 *   RM-2: is_companion 판정 = external_id comp 패턴('_comp_'/'#companion-') 결정적 파생
 *   RM-3: 동행 폴백 — customer_real_name → name/name_masked, 비면 '동행' 라벨
 *   RM-4: 동행 무폰 → phone_e164_last4 '****'
 *   RM-5: 응답에 is_companion 필드 노출
 *   RM-6: 진성 customer 행 경로 불변(마스킹 + include_full_pii 게이트 유지)
 *   RM-7: ★AC-4 — is_companion 판정에 customer_id=NULL 휴리스틱 미사용(legacy NULL 무오인)
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

// ── RM-2: is_companion 판정 로직 — external_id comp 패턴 결정적 파생 ──
test('RM-2: is_companion 판정 = external_id comp 패턴(_comp_ / #companion-) 파생', () => {
  const src = fs.readFileSync(EF_PATH, 'utf-8');
  expect(src).toContain('const isCompanion');
  // dopamine write 실 델리미터 '_comp_' (권위) — 이게 없으면 실데이터 동행 0건 검출(AC-1 실패)
  expect(src).toContain("extId.includes('_comp_')");
  // 설계문서 변형 '#companion-' 도 수용(향후 통일 대비)
  expect(src).toContain("extId.includes('#companion-')");
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

// ── RM-7: ★AC-4 — is_companion 판정에 customer_id=NULL 휴리스틱 미사용 ──
//   §444 게이트: prod 126건 legacy customer_id=NULL 비동행 행 오분류 방지.
//   isCompanion 대입식은 external_id 패턴만 사용, customer_id/custId 조건을 포함하면 안 됨.
test('RM-7: AC-4 — isCompanion 대입식에 customer_id=NULL 휴리스틱 부재', () => {
  const src = fs.readFileSync(EF_PATH, 'utf-8');
  const start = src.indexOf('const isCompanion');
  expect(start).toBeGreaterThan(-1);
  // 대입식 종료(세미콜론)까지 슬라이스
  const assignExpr = src.slice(start, src.indexOf(';', start));
  expect(assignExpr).not.toContain('custId');
  expect(assignExpr).not.toContain('customer_id');
  // 외부유입 단독(source_system) 도 판정식에 쓰지 않음
  expect(assignExpr).not.toContain('srcSystem');
});
