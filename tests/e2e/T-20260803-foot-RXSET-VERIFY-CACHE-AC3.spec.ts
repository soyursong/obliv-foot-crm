/**
 * E2E spec — T-20260803-foot-RXSET-VERIFY-CACHE-AC3
 *
 * AC-3 검증결과 영속 캐시 — read-side staleness 가드 + 읽기 폴백(J2/J3).
 * DA CONSULT-REPLY: DA-20260803-foot-RXSET-VERIFY-CACHE-AC3 (GO/ADDITIVE 조건부).
 *
 * 검증 대상:
 *   J2 SSOT 방화벽 — resolveVerifyVerdict 는 캐시를 유일진실로 신뢰하지 않고 항상 recompute 폴백 가능.
 *   J3 staleness 가드 — verify_input_hash(입력3필드 지문) 또는 verify_model_version 불일치 → 캐시 MISS.
 *   J4 컬럼표준 — 마이그레이션이 verify_* 6컬럼 ADDITIVE(NULL·CHECK無·FK無·verified_at=timestamptz).
 *
 * 형제 RXSET-* spec 동형 — 순수 판정 단위검증 + 정본 소스 정적 단언(데이터/로그인 비의존).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  VERIFY_MODEL_VERSION,
  computeVerifyInputHash,
  pickVerifyMatchedCode,
  isVerifyCacheFresh,
  resolveVerifyVerdict,
  buildVerifyCacheWrite,
  computeDrugVerifyVerdict,
  type DrugVerifyInput,
  type DrugVerifyCacheRow,
} from '../../src/lib/drugVerification';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const MODEL = 'src/lib/drugVerification.ts';
const MIGRATION = 'supabase/migrations/20260803210000_prescription_codes_verify_cache.sql';
const ROLLBACK = 'supabase/migrations/20260803210000_prescription_codes_verify_cache.rollback.sql';
const DRYRUN = 'supabase/migrations/20260803210000_prescription_codes_verify_cache.dryrun.sql';

// 신선한 캐시 row 를 입력으로부터 만든다(verified_at 은 read-side 무관).
function freshCache(input: DrugVerifyInput, ingredient?: 'matched' | 'mismatch' | 'unverified'): DrugVerifyCacheRow {
  const w = buildVerifyCacheWrite(input, ingredient ?? null);
  return {
    verify_status: w.verify_status,
    verify_ingredient: w.verify_ingredient,
    verify_matched_code: w.verify_matched_code,
    verify_input_hash: w.verify_input_hash,
    verify_model_version: w.verify_model_version,
    verified_at: '2026-08-03T12:00:00Z',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// computeVerifyInputHash — 판정영향 3입력의 canonical 지문(정규화 정합)
// ─────────────────────────────────────────────────────────────────────────────
test('J3: 지문은 결정적 — 동일 입력 → 동일 hash', () => {
  const inp: DrugVerifyInput = { claim_code: 'A11A', code_source: 'official', insurance_status_source: 'hira' };
  expect(computeVerifyInputHash(inp)).toBe(computeVerifyInputHash({ ...inp }));
});

test('J3: 정규화 정합 — code_source/insurance_status_source 는 trim+lower 흡수', () => {
  const a = computeVerifyInputHash({ claim_code: 'A11A', code_source: 'Official', insurance_status_source: ' HIRA ' });
  const b = computeVerifyInputHash({ claim_code: 'A11A', code_source: 'official', insurance_status_source: 'hira' });
  expect(a).toBe(b);
});

test('J3: 입력(약품코드 정정) 변경 → hash 변경(=stale 감지 근거)', () => {
  const a = computeVerifyInputHash({ claim_code: 'A11A', code_source: 'official', insurance_status_source: null });
  const b = computeVerifyInputHash({ claim_code: 'A11B', code_source: 'official', insurance_status_source: null });
  expect(a).not.toBe(b);
});

test('J3: 빈/누락 입력 → 안정적 hash(throw 없음)', () => {
  expect(computeVerifyInputHash(null)).toBe(computeVerifyInputHash({}));
  expect(typeof computeVerifyInputHash({})).toBe('string');
});

// ─────────────────────────────────────────────────────────────────────────────
// pickVerifyMatchedCode — HIRA claim_code 스냅샷(placeholder 제외)
// ─────────────────────────────────────────────────────────────────────────────
test('J4: matched_code = 실 외부코드만 — placeholder(LEGACY-/HIRA-STD-/HIRA-) 제외', () => {
  expect(pickVerifyMatchedCode({ claim_code: '642901820' })).toBe('642901820');
  expect(pickVerifyMatchedCode({ claim_code: 'LEGACY-abc' })).toBeNull();
  expect(pickVerifyMatchedCode({ claim_code: 'HIRA-STD-1' })).toBeNull();
  expect(pickVerifyMatchedCode({ claim_code: 'HIRA-9' })).toBeNull();
  expect(pickVerifyMatchedCode({ claim_code: '  ' })).toBeNull();
  expect(pickVerifyMatchedCode({})).toBeNull();
});

// ─────────────────────────────────────────────────────────────────────────────
// isVerifyCacheFresh — J3 신선도 판정
// ─────────────────────────────────────────────────────────────────────────────
test('J3: 신선한 캐시(hash+version 일치) → HIT', () => {
  const inp: DrugVerifyInput = { claim_code: 'A11A', code_source: 'official', insurance_status_source: 'hira' };
  expect(isVerifyCacheFresh(freshCache(inp), inp)).toBe(true);
});

test('J3: 입력이 바뀐 뒤(캐시는 옛 hash) → stale MISS', () => {
  const oldInp: DrugVerifyInput = { claim_code: 'A11A', code_source: 'official', insurance_status_source: 'hira' };
  const cache = freshCache(oldInp);
  const newInp: DrugVerifyInput = { claim_code: 'A11B', code_source: 'official', insurance_status_source: 'hira' };
  expect(isVerifyCacheFresh(cache, newInp)).toBe(false);
});

test('J3: model_version 불일치(로직 개정) → MISS(self-healing)', () => {
  const inp: DrugVerifyInput = { claim_code: 'A11A', code_source: 'official', insurance_status_source: 'hira' };
  const cache = { ...freshCache(inp), verify_model_version: 'v0-OLD' };
  expect(isVerifyCacheFresh(cache, inp)).toBe(false);
});

test('J3: null 캐시/메타 누락 → MISS', () => {
  const inp: DrugVerifyInput = { claim_code: 'A11A', code_source: 'official' };
  expect(isVerifyCacheFresh(null, inp)).toBe(false);
  expect(isVerifyCacheFresh({ verify_status: 'verified' }, inp)).toBe(false); // hash/version 누락
});

// ─────────────────────────────────────────────────────────────────────────────
// resolveVerifyVerdict — J2 방화벽(항상 recompute 폴백, 캐시 비신뢰)
// ─────────────────────────────────────────────────────────────────────────────
test('J2: 신선 캐시 → source=cache, 판정은 recompute 와 동일(정합)', () => {
  const inp: DrugVerifyInput = { claim_code: 'A11A', code_source: 'official', insurance_status_source: 'hira' };
  const r = resolveVerifyVerdict(freshCache(inp), inp);
  expect(r.source).toBe('cache');
  expect(r.verdict?.status).toBe(computeDrugVerifyVerdict(inp)?.status);
});

test('J2: stale 캐시 → source=recompute, 절대 stale 서빙 안 함', () => {
  const oldInp: DrugVerifyInput = { claim_code: 'A11A', code_source: 'official', insurance_status_source: 'hira' };
  const stale = freshCache(oldInp); // status verified 로 캐시됨
  // 입력이 custom 자체약으로 바뀜 → 실제 판정은 unverified 여야 하고 캐시는 stale.
  const newInp: DrugVerifyInput = { claim_code: 'LEGACY-x', code_source: 'custom', insurance_status_source: null };
  const r = resolveVerifyVerdict(stale, newInp);
  expect(r.source).toBe('recompute');
  expect(r.verdict?.status).toBe('unverified');
  expect(r.verdict?.status).not.toBe(stale.verify_status); // stale 값(verified)을 서빙하지 않음
});

test('J2: 캐시 부재(컬럼 미적용/warm-up 전) → recompute 폴백(deploy-tolerant)', () => {
  const inp: DrugVerifyInput = { claim_code: 'A11A', code_source: 'official' };
  const r = resolveVerifyVerdict(null, inp);
  expect(r.source).toBe('recompute');
  expect(r.verdict?.status).toBe('verified');
});

test('J2: 캐시 status 가 알 수 없는 값 → 신뢰 금지, recompute 폴백', () => {
  const inp: DrugVerifyInput = { claim_code: 'A11A', code_source: 'official', insurance_status_source: 'hira' };
  const cache = { ...freshCache(inp), verify_status: 'GARBAGE' };
  const r = resolveVerifyVerdict(cache, inp);
  expect(r.source).toBe('recompute');
  expect(r.verdict?.status).toBe('verified');
});

test('J2: 성분축 캐시 반영 — matched 는 배지 보조표기 유지, unverified 는 접힘', () => {
  const inp: DrugVerifyInput = { claim_code: 'A11A', code_source: 'official', insurance_status_source: 'hira' };
  expect(resolveVerifyVerdict(freshCache(inp, 'matched'), inp).verdict?.ingredient).toBe('matched');
  expect(resolveVerifyVerdict(freshCache(inp, 'unverified'), inp).verdict?.ingredient).toBeUndefined();
});

// ─────────────────────────────────────────────────────────────────────────────
// buildVerifyCacheWrite — populate 값(write) 정합
// ─────────────────────────────────────────────────────────────────────────────
test('populate: write 값이 hash/version/status/matched_code 정합', () => {
  const inp: DrugVerifyInput = { claim_code: '642901820', code_source: 'official', insurance_status_source: 'hira' };
  const w = buildVerifyCacheWrite(inp, 'matched');
  expect(w.verify_status).toBe('verified');
  expect(w.verify_ingredient).toBe('matched');
  expect(w.verify_matched_code).toBe('642901820');
  expect(w.verify_input_hash).toBe(computeVerifyInputHash(inp));
  expect(w.verify_model_version).toBe(VERIFY_MODEL_VERSION);
});

// ─────────────────────────────────────────────────────────────────────────────
// 정본 소스 정적 단언 — 마이그레이션 ADDITIVE 안전성(J4)
// ─────────────────────────────────────────────────────────────────────────────
test('J4: 마이그레이션 = ADD COLUMN IF NOT EXISTS 6개, CHECK/FK 無', () => {
  const sql = read(MIGRATION);
  for (const col of ['verify_status', 'verify_ingredient', 'verify_matched_code', 'verified_at', 'verify_input_hash', 'verify_model_version']) {
    expect(sql).toContain(`ADD COLUMN IF NOT EXISTS ${col}`);
  }
  expect(sql).toContain('verified_at          timestamptz'); // naive 금지
  expect(sql).not.toMatch(/\bCHECK\s*\(/i); // 값 진화 시 비-ADDITIVE 회피(app-enforced)
  expect(sql).not.toMatch(/\bREFERENCES\b/i); // matched_code = 스냅샷, FK 아님
});

test('J4: rollback = DROP COLUMN IF EXISTS 6개(완전 가역) + dryrun 무영속(COMMIT 없음)', () => {
  const rb = read(ROLLBACK);
  for (const col of ['verify_status', 'verify_ingredient', 'verify_matched_code', 'verified_at', 'verify_input_hash', 'verify_model_version']) {
    expect(rb).toContain(`DROP COLUMN IF EXISTS ${col}`);
  }
  const dr = read(DRYRUN);
  expect(dr).not.toMatch(/^\s*COMMIT\s*;/im); // no-persistence 프로토콜
});

test('FE 모델은 캐시를 비-권위로 명시(J2 방화벽 주석)', () => {
  const src = read(MODEL);
  expect(src).toContain('VERIFY_MODEL_VERSION');
  expect(src).toContain('resolveVerifyVerdict');
  expect(src).toMatch(/비-권위|유일진실/); // 방화벽 주석 존재
});
