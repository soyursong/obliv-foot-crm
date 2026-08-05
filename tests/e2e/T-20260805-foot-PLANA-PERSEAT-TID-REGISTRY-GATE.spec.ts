/**
 * Spec — T-20260805-foot-PLANA-PERSEAT-TID-REGISTRY-GATE
 *
 * 목적: Plan-A CAT직결 per-seat TID 를 redpay_terminal_registry allowlist 로 게이트하는 하드닝을 검증.
 *   구조 갭(부모 REDPAY-INVISIBLE): per-seat localStorage(cband.terminal.config) TID 가 canonical
 *   registry allowlist 와 대조되지 않아 미등록 TID 결제가 정산 사각을 유발.
 *
 * 계약(AC):
 *   AC-1: buildRegistryTidSet predicate = tid ∪ superseded_tids — EF redpay-reconcile loadRegistryTids 와 동일.
 *   AC-2: 미등록 TID → soft-warn + 구조화 로깅(logUnregisteredTid). ★hard-block 아님(결제 흐름 무차단).
 *   AC-3: escape hatch — 관리자 override(setTidGateOverride) + override 설정/사용 로깅.
 *
 * ⚠ registry 대조(checkSeatTidRegistered)의 supabase read 는 순수영역 밖 → 여기서는 순수 predicate +
 *   소스 정합(동일 predicate 재사용·soft-warn·로깅·override·무차단)을 검증한다.
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import {
  buildRegistryTidSet, matchRegistryTid, REDPAY_REGISTRY_DOMAIN,
  type RegistryTidRow,
} from '../../src/lib/cband/tidRegistryGate';

const GATE = 'src/lib/cband/tidRegistryGate.ts';
const BTN = 'src/components/CbandPayEntryButton.tsx';
const EF = 'supabase/functions/redpay-reconcile/index.ts';

// ─── AC-1: predicate = tid ∪ superseded_tids (EF loadRegistryTids 미러) ──────────
test('AC-1: buildRegistryTidSet = tid ∪ superseded_tids (trim·drop-empty·dedup)', () => {
  const rows: RegistryTidRow[] = [
    { tid: '1047479469', superseded_tids: ['1047479470'] },   // 현 TID + 구 TID(superseded)
    { tid: ' 1047479472 ', superseded_tids: null },           // trim
    { tid: '', superseded_tids: ['', '  ', '1047479255'] },   // drop-empty
    { tid: '1047479469', superseded_tids: [] },               // dedup(중복 tid)
  ];
  const set = buildRegistryTidSet(rows);
  // 현 TID·구 TID·trim·superseded 모두 포함
  expect(set.has('1047479469')).toBe(true);
  expect(set.has('1047479470')).toBe(true);   // superseded_tids 도 allowlist(과도기 정합)
  expect(set.has('1047479472')).toBe(true);
  expect(set.has('1047479255')).toBe(true);
  // 빈값·공백은 제외
  expect(set.has('')).toBe(false);
  // dedup — 유일값만
  expect(set.size).toBe(4);
});

test('AC-1: matchRegistryTid — 등록/미등록/빈값 판정', () => {
  const set = new Set(['1047479469', '1047479472']);
  expect(matchRegistryTid('1047479469', set)).toBe(true);
  expect(matchRegistryTid(' 1047479469 ', set)).toBe(true);   // 입력 trim
  expect(matchRegistryTid('1047479470', set)).toBe(false);    // 미등록(예: 오등록 TID)
  expect(matchRegistryTid('', set)).toBe(false);
  expect(matchRegistryTid(null, set)).toBe(false);
  expect(matchRegistryTid(undefined, set)).toBe(false);
});

test('AC-1: registry 도메인 스코프 = foot 고정(EF REDPAY_DOMAIN 정합)', () => {
  expect(REDPAY_REGISTRY_DOMAIN).toBe('foot');
  const gate = fs.readFileSync(GATE, 'utf8');
  // FE 로더가 domain='foot' · active=true 로 SELECT(EF predicate 미러)
  expect(gate).toMatch(/\.eq\(['"]domain['"],\s*REDPAY_REGISTRY_DOMAIN\)/);
  expect(gate).toMatch(/\.eq\(['"]active['"],\s*true\)/);
  expect(gate).toMatch(/select\(['"]tid,superseded_tids['"]\)/);
});

test('AC-1: EF loadRegistryTids 와 동일 union-source predicate(tid ∪ superseded_tids)', () => {
  const ef = fs.readFileSync(EF, 'utf8');
  // EF 도 tid + superseded_tids union — FE 게이트가 같은 predicate 를 재사용함을 교차확인
  expect(ef).toMatch(/select\(["']tid,superseded_tids["']\)/);
  expect(ef).toMatch(/superseded_tids/);
});

// ─── AC-2: soft-warn + 구조화 로깅, hard-block 아님(무차단) ──────────────────────
test('AC-2: 미등록 TID = soft-warn + 구조화 로깅(누구/seat/TID/시각)', () => {
  const gate = fs.readFileSync(GATE, 'utf8');
  // 구조화 로깅 함수 존재 + 4축(누구/seat/TID/시각) 포함
  expect(gate).toMatch(/export function logUnregisteredTid/);
  expect(gate).toMatch(/unregistered_tid_payment/);
  for (const field of ['tid', 'seatId', 'userId', 'at']) {
    expect(gate).toContain(field);
  }
});

test('AC-2: hard-block 부재 — 결제 흐름을 막지 않는다(soft, 커밋 계속 진행)', () => {
  const btn = fs.readFileSync(BTN, 'utf8');
  // 커밋 경로에서 logUnregisteredTid(commit) 호출(구조화 로깅)
  expect(btn).toMatch(/logUnregisteredTid\(\{\s*\.\.\.actor,\s*tid:\s*activeCfg\.tid,\s*overridden:\s*tidOverridden,\s*phase:\s*'commit'\s*\}\)/);
  // ★hard-block 금지 근거: 미등록 로깅 직후 결제를 되돌리는 조기 return/throw 없이 setUi('sending') 로 진행.
  const commitLogIdx = btn.indexOf('logUnregisteredTid({ ...actor, tid: activeCfg.tid');
  const sendingIdx = btn.indexOf("setUi('sending')", commitLogIdx);
  expect(commitLogIdx).toBeGreaterThan(0);
  expect(sendingIdx).toBeGreaterThan(commitLogIdx);
  const between = btn.slice(commitLogIdx, sendingIdx);
  expect(between).not.toContain('return');
  expect(between).not.toContain('throw');
});

test('AC-2: soft-warn 배너 UI 노출(미등록 + override 미설정) — 결제 버튼은 유지', () => {
  const btn = fs.readFileSync(BTN, 'utf8');
  expect(btn).toContain('cband-tid-unregistered-warn');
  // showTidWarn = 미등록 ∧ !override
  expect(btn).toMatch(/const showTidWarn =\s*tidVerdict\?\.status === 'unregistered' && !tidOverridden/);
});

// ─── AC-3: escape hatch (관리자 override + 로깅) ─────────────────────────────────
test('AC-3: escape hatch — override 설정/조회/로깅 API 존재', () => {
  const gate = fs.readFileSync(GATE, 'utf8');
  expect(gate).toMatch(/export function isTidGateOverridden/);
  expect(gate).toMatch(/export function setTidGateOverride/);
  // override 설정/해제 모두 구조화 로깅(감사 흔적)
  expect(gate).toMatch(/tid_gate_override_set/);
  expect(gate).toMatch(/tid_gate_override_clear/);
});

test('AC-3: override 는 관리자급만 — admin/manager/director 또는 운영최고권한', () => {
  const btn = fs.readFileSync(BTN, 'utf8');
  expect(btn).toMatch(/const canOverrideTidGate =/);
  expect(btn).toContain("profile?.role === 'admin'");
  expect(btn).toContain('hasOpsAuthority(profile)');
  // override 버튼은 canOverrideTidGate 게이트 하에서만 렌더
  expect(btn).toContain('btn-cband-tid-override');
  expect(btn).toMatch(/canOverrideTidGate && \(/);
});

// ─── 불변식: read-only·no-DDL(스키마 무변경) ────────────────────────────────────
test('INV: 게이트는 registry SELECT(read-only) — 신규 컬럼/테이블/write 없음', () => {
  const gate = fs.readFileSync(GATE, 'utf8');
  // registry 는 SELECT 만(insert/update/delete/upsert 금지)
  expect(gate).not.toMatch(/\.from\(['"]redpay_terminal_registry['"]\)\s*\n?\s*\.(insert|update|delete|upsert)/);
  expect(gate).toMatch(/\.from\(['"]redpay_terminal_registry['"]\)/);
  // 미가용 시 degrade-open(unknown) — 거짓 경고 금지
  expect(gate).toMatch(/degrade-open|unknown/);
});
