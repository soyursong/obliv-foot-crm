/**
 * T-20260713-foot-INGEST-NAME-OVERWRITE-GUARD (P0/hotfix, bleed-stop FIRST)
 * reservation-ingest-from-dopamine EF — customers.name write-path 계약 정적 검증
 *
 * ─ 진원 ───────────────────────────────────────────────────────────
 *   旣존 UPDATE 브랜치가 payload customer.name 을 가드 없이 customers.name 에
 *   무조건 override → 현장에서 정정한 본명이 도파민 push 별칭('ok' 등)으로 재오염(bleed).
 *
 * ─ write-path 계약 (DA-20260713-CRM-INGEST-NAME-OVERWRITE-BAN, verdict=GO) ──
 *   ① create-only     : 신규 고객(customers 행 부재)만 push 명 → customers.name 초기값.
 *   ② never-downgrade  : 기존 non-empty customers.name 은 절대 미터치(no-touch).
 *                        push 명은 reservations.customer_real_name 스냅샷으로 착지(유실 방지).
 *   ③ preserve-on-NULL : customers.name = COALESCE(NULLIF(btrim(push),''), customers.name).
 *   ④ 트리거 trg_sync_customer_name 미접촉(정식 mirror). DDL 0.
 *
 * 회귀 방어: 단순 `name,` 무조건 UPDATE 패턴이 재등장하지 않도록 소스 계약 고정.
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EF_PATH = path.resolve(
  __dirname,
  '../../supabase/functions/reservation-ingest-from-dopamine/index.ts',
);

function readEf(): string {
  return fs.readFileSync(EF_PATH, 'utf-8');
}

// ── 0. 소스 존재 ──────────────────────────────────────────────────
test('GUARD-0: EF 소스 존재', () => {
  expect(fs.existsSync(EF_PATH)).toBe(true);
});

// ── 1. 기존 name 동반 조회 (never-downgrade 판정 근거) ─────────────
test('GUARD-1: 고객 lookup 이 name 을 동반 조회한다 (id 단독 아님)', () => {
  const src = readEf();
  expect(src).toContain(".select('id, name')");
});

// ── 2. never-downgrade / no-touch: 무조건 name override 제거 ───────
test('GUARD-2: UPDATE 브랜치에 무조건 name override 패턴이 없다', () => {
  const src = readEf();
  // UPDATE 블록 추출 (customers.update( ... ).eq('id', customerId))
  const updIdx = src.indexOf('.update({');
  expect(updIdx).toBeGreaterThan(-1);
  const updBlock = src.slice(updIdx, updIdx + 600);
  // 旣존 진원 = 첫 필드가 무조건 `name,` (조건부 아님) 였음 → 재등장 금지.
  expect(updBlock).not.toMatch(/\.update\(\{\s*\n\s*name,/);
});

// ── 3. preserve-on-NULL: 공란일 때만 채움 ─────────────────────────
test('GUARD-3: name 은 shouldFillName(공란 채움) 조건부로만 UPDATE 된다', () => {
  const src = readEf();
  // 계약 ③ 를 구현하는 조건 (기존 공란 + push non-empty).
  expect(src).toContain("existingName === '' && pushName !== ''");
  expect(src).toContain('shouldFillName ? { name: pushName } : {}');
});

// ── 4. no-touch push 명 스냅샷 → reservations.customer_real_name ──
test('GUARD-4: 기존 non-empty name 보존 시 push 명을 customer_real_name 스냅샷으로 착지', () => {
  const src = readEf();
  // pushNameSnapshot 캐리어 존재 + 기존 non-empty & 상이값 조건에서만 세팅.
  expect(src).toContain('pushNameSnapshot');
  expect(src).toMatch(/existingName !== ''\s*&&\s*pushName !== ''\s*&&\s*pushName !== existingName/);
  // rsvPayload 에서 customerRealName 우선, 없으면 pushNameSnapshot 폴백.
  expect(src).toContain('customerRealName ?? pushNameSnapshot');
});

// ── 5. create-only: 신규 고객 INSERT 경로는 여전히 name 초기값 적재 ─
test('GUARD-5: 신규 고객 INSERT 경로는 name 초기값을 적재한다(create-only)', () => {
  const src = readEf();
  // else 브랜치(신규 생성)의 insertPayload 에 name 존재.
  const insIdx = src.indexOf('const insertPayload');
  expect(insIdx).toBeGreaterThan(-1);
  const insBlock = src.slice(insIdx, insIdx + 400);
  expect(insBlock).toContain('name,');
});

// ── 6. 티켓/계약 트레이서빌리티 주석 고정 ─────────────────────────
test('GUARD-6: 티켓 ID 트레이서빌리티 주석 존재', () => {
  const src = readEf();
  expect(src).toContain('T-20260713-foot-INGEST-NAME-OVERWRITE-GUARD');
  expect(src).toContain('DA-20260713-CRM-INGEST-NAME-OVERWRITE-BAN');
});
