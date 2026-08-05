/**
 * Spec — T-20260805-foot-TERM-BIZNO-VERIFY-UX
 *
 * 목적: 단말 등록/설정(AdminSettings ⑧ 카드 단말기 설정) 시 사업자번호 검증 UX 를 검증.
 *   구조 갭(부모 REDPAY-INVISIBLE ④): 단말이 구 사업자번호(511-60-00988)를 물고 등록되면
 *   RedPay 가 빈 번호로 취급 → 전 기간 정산 조회 0건. 등록 시점에 방어선을 세운다.
 *
 * 계약(AC):
 *   AC-1: 단말 등록/변경 화면에 사업자번호 확인 가이드 표기 —
 *         "[특수]→시스템→910115→가맹점정보조회로 사업자번호가 457-23-00938 인지 확인" 안내.
 *   AC-2: 입력 TID 가 registry allowlist 와 불일치/미등록이면 저장 전 soft 경고 + 로깅.
 *         ★자매 REGISTRY-GATE 와 tidRegistryGate 로직 공유(중복 구현 회피).
 *   AC-3: 현장 가이드 문구는 responder 경유 최필경 검수 후 확정(문구 상수 존재만 검증).
 *
 * ⚠ registry 대조(checkSeatTidRegistered)의 supabase read 는 순수영역 밖 →
 *   여기서는 소스 정합(가이드 문구·공유 게이트 재사용·soft-warn·로깅·무차단)을 검증한다.
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import {
  checkSeatTidRegistered,
  buildRegistryTidSet,
  matchRegistryTid,
  type RegistryTidRow,
} from '../../src/lib/cband/tidRegistryGate';

const ADMIN = 'src/pages/AdminSettings.tsx';
const GATE = 'src/lib/cband/tidRegistryGate.ts';

const EXPECTED_BIZNO = '457-23-00938';
const STALE_BIZNO = '511-60-00988';

function readAdmin(): string {
  return fs.readFileSync(ADMIN, 'utf8');
}

// ─── AC-1: 사업자번호 확인 가이드 표기 ───────────────────────────────────────────
test('AC-1: 단말 설정 화면에 기대 사업자번호(457-23-00938) 가이드가 있다', () => {
  const src = readAdmin();
  expect(src.includes(EXPECTED_BIZNO)).toBe(true);
  // 가이드 배너 앵커 + 현장 조회 경로 문구.
  expect(src.includes('terminal-bizno-guide')).toBe(true);
  expect(src).toMatch(/910115/);
  expect(src).toMatch(/가맹점정보조회/);
  expect(src).toMatch(/특수/);
});

test('AC-1: 구 사업자번호(511-60-00988)를 대비 예시로 함께 노출한다', () => {
  const src = readAdmin();
  // 옛 번호를 예시로 보여 현장이 무엇과 헷갈리지 말아야 하는지 각인.
  expect(src.includes(STALE_BIZNO)).toBe(true);
});

// ─── AC-2: registry 공유 게이트 재사용 + soft-warn + 로깅 + 무차단 ────────────────
test('AC-2: REGISTRY-GATE 공유 로직(tidRegistryGate)을 재사용한다(중복 구현 회피)', () => {
  const src = readAdmin();
  expect(src).toMatch(/from '@\/lib\/cband\/tidRegistryGate'/);
  expect(src.includes('checkSeatTidRegistered')).toBe(true);
  expect(src.includes('logUnregisteredTid')).toBe(true);
});

test('AC-2: 미등록 판정 시 soft 경고 배너 + 로깅 — 저장을 막지 않는다(hard-block 아님)', () => {
  const src = readAdmin();
  // 미등록 경고 배너 앵커.
  expect(src.includes('terminal-tid-unregistered-warn')).toBe(true);
  // unregistered 분기 처리 존재.
  expect(src).toMatch(/status === 'unregistered'/);
  // ★저장(saveTerminalConfig)이 unregistered 분기 return 으로 중단되지 않음:
  //   SectionTerminal 의 handleSave 안에서 unregistered 분기 → 저장 순서(soft) 검증.
  const section = src.slice(src.indexOf('function SectionTerminal()'));
  const handleStart = section.indexOf('const handleSave');
  const handleBody = section.slice(handleStart, section.indexOf('return (', handleStart));
  // handleSave 본문에 registry 대조·로깅·저장이 모두 포함(대조가 저장을 대체하지 않음).
  expect(handleBody.includes('checkSeatTidRegistered')).toBe(true);
  expect(handleBody.includes('logUnregisteredTid')).toBe(true);
  expect(handleBody.includes('saveTerminalConfig')).toBe(true);
  // unregistered 블록이 return; 으로 저장을 건너뛰지 않아야 함(soft-warn 원칙).
  expect(handleBody).not.toMatch(/unregistered'\)\s*\{[\s\S]*?return;[\s\S]*?\}/);
});

// ─── AC-2 predicate 정합: 등록/미등록 판정 로직 재사용 확인 ────────────────────────
test('AC-2: 공유 predicate — registry allowlist 대조로 등록/미등록 판정', () => {
  const rows: RegistryTidRow[] = [
    { tid: '1047479469', superseded_tids: ['1047479470'] },
  ];
  const set = buildRegistryTidSet(rows);
  expect(matchRegistryTid('1047479469', set)).toBe(true);   // 등록
  expect(matchRegistryTid('1047479470', set)).toBe(true);   // superseded 도 등록으로 인정
  expect(matchRegistryTid('9999999999', set)).toBe(false);  // 미등록
});

test('AC-2: 빈 TID 는 unknown(미판정) — 거짓 경고 안 함(degrade-open)', async () => {
  const v = await checkSeatTidRegistered('');
  expect(v.status).toBe('unknown');
  expect(v.checked).toBe(false);
});

// ─── AC-3: 가이드 문구 상수 존재(검수 후 확정 대상) ───────────────────────────────
test('AC-3: 기대/구 사업자번호가 상수로 분리되어 문구 검수·교체가 용이하다', () => {
  const src = readAdmin();
  expect(src).toMatch(/EXPECTED_FOOT_BIZNO\s*=\s*'457-23-00938'/);
  expect(src).toMatch(/STALE_FOOT_BIZNO\s*=\s*'511-60-00988'/);
});
