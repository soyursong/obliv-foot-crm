/**
 * E2E spec — T-20260803-foot-RXSET-HIRA-NAME-INDEX-AC8
 *
 * HIRA 명칭 인덱스(외부 참조 유니버스) 코퍼스 적재 — 신규 전용 테이블 + GIN trigram.
 * DA CONSULT-REPLY: DA-20260803-foot-RXSET-HIRA-NAME-INDEX-AC8 (GO / Option A / ADDITIVE).
 *
 * 검증 대상:
 *   정규화 권위 — normalizeHiraDrugName(write/read 동형): trim+연속공백1칸+소문자fold, 용량표기 보존.
 *   코드축(VG-2) — item_std_code = 품목기준코드9, cross-ref = 'HIRA-'||code(EDI 혼용 금지).
 *   row 빌더 — 부적격(코드/명칭 부재) skip, name_normalized 산출 정합.
 *   마이그레이션(§4/§5) — 신규 테이블+trigram GIN+RLS(authenticated SELECT)+FK無(VG-3)+ADDITIVE.
 *   VG-4 — computeDrugVerifyVerdict 무변경(partial 활성화 안 함·코퍼스만 적재).
 *
 * 형제 RXSET-* spec 동형 — 순수 단위검증 + 정본 소스 정적 단언(데이터/로그인 비의존).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  normalizeHiraDrugName,
  normalizeItemStdCode,
  toHiraClaimCode,
  fromHiraClaimCode,
  buildHiraDrugNameIndexRow,
  HIRA_CLAIM_CODE_PREFIX,
} from '../../src/lib/hiraDrugNameIndex';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const UTIL = 'src/lib/hiraDrugNameIndex.ts';
const VERDICT = 'src/lib/drugVerification.ts';
const MIGRATION = 'supabase/migrations/20260803220000_hira_drug_name_index.sql';
const ROLLBACK = 'supabase/migrations/20260803220000_hira_drug_name_index.rollback.sql';
const DRYRUN = 'supabase/migrations/20260803220000_hira_drug_name_index.dryrun.sql';

// ─────────────────────────────────────────────────────────────────────────────
// normalizeHiraDrugName — write/read 동형 정규화 권위
// ─────────────────────────────────────────────────────────────────────────────
test('정규화: trim + 연속공백 1칸 + 소문자 fold', () => {
  expect(normalizeHiraDrugName('  테르비나핀정   250MG ')).toBe('테르비나핀정 250mg');
  expect(normalizeHiraDrugName('Lamisil  Tab')).toBe('lamisil tab');
});

test('정규화: 결정적 — 동일 입력 → 동일 결과(write/read 정합 근거)', () => {
  const a = normalizeHiraDrugName(' 이트라코나졸 100mg ');
  const b = normalizeHiraDrugName('이트라코나졸   100mg');
  expect(a).toBe(b);
});

test('정규화 canon: 용량표기 보존 — auto-merge 금지(다른 용량=다른 표기)', () => {
  expect(normalizeHiraDrugName('아모롤핀 5%')).not.toBe(normalizeHiraDrugName('아모롤핀'));
  expect(normalizeHiraDrugName('테르비나핀 250mg')).not.toBe(normalizeHiraDrugName('테르비나핀 125mg'));
});

test('정규화: 빈/누락 → 빈 문자열(throw 없음)', () => {
  expect(normalizeHiraDrugName(null)).toBe('');
  expect(normalizeHiraDrugName(undefined)).toBe('');
  expect(normalizeHiraDrugName('   ')).toBe('');
});

// ─────────────────────────────────────────────────────────────────────────────
// 코드축(VG-2) — 품목기준코드9 namespace, cross-ref = 'HIRA-'||code
// ─────────────────────────────────────────────────────────────────────────────
test('VG-2: item_std_code 정규화 = trim, 빈값 → null', () => {
  expect(normalizeItemStdCode('  201403310 ')).toBe('201403310');
  expect(normalizeItemStdCode('')).toBeNull();
  expect(normalizeItemStdCode(null)).toBeNull();
});

test('VG-2: cross-ref 왕복 — toHiraClaimCode / fromHiraClaimCode 정합', () => {
  expect(toHiraClaimCode('201403310')).toBe('HIRA-201403310');
  expect(HIRA_CLAIM_CODE_PREFIX).toBe('HIRA-');
  expect(fromHiraClaimCode('HIRA-201403310')).toBe('201403310');
  // 접두 없는 코드는 그대로(EDI 등 비대상은 호출측 책임)
  expect(fromHiraClaimCode('201403310')).toBe('201403310');
  expect(toHiraClaimCode('')).toBeNull();
});

// ─────────────────────────────────────────────────────────────────────────────
// buildHiraDrugNameIndexRow — 적재 행 빌드(정규화 산출 정합·부적격 skip)
// ─────────────────────────────────────────────────────────────────────────────
test('row: 적격 행 → name_normalized 는 normalizeHiraDrugName 산출과 일치', () => {
  const row = buildHiraDrugNameIndexRow(
    { item_std_code: ' 201403310 ', name_ko: '  플루코엠캡슐 50mg ', ingredient_code: 'A11', ingredient_name: '플루코나졸' },
    'data.go.kr:15067462',
  );
  expect(row).not.toBeNull();
  expect(row!.item_std_code).toBe('201403310');
  expect(row!.name_ko).toBe('플루코엠캡슐 50mg');
  expect(row!.name_normalized).toBe(normalizeHiraDrugName('플루코엠캡슐 50mg'));
  expect(row!.ingredient_code).toBe('A11');
  expect(row!.source_ref).toBe('data.go.kr:15067462');
});

test('row: 부적격(코드/명칭 부재) → null(skip 대상)', () => {
  expect(buildHiraDrugNameIndexRow({ item_std_code: '', name_ko: '약' }, 'src')).toBeNull();
  expect(buildHiraDrugNameIndexRow({ item_std_code: '123', name_ko: '  ' }, 'src')).toBeNull();
  expect(buildHiraDrugNameIndexRow({}, 'src')).toBeNull();
});

test('row: 선택 필드 부재 → null 로 정규화(빈 문자열 아님)', () => {
  const row = buildHiraDrugNameIndexRow({ item_std_code: '123456789', name_ko: '약품A' }, 'src');
  expect(row!.ingredient_code).toBeNull();
  expect(row!.ingredient_name).toBeNull();
});

// ─────────────────────────────────────────────────────────────────────────────
// 마이그레이션 정적 단언 — ADDITIVE 안전성 + VG 준수
// ─────────────────────────────────────────────────────────────────────────────
test('§2: 신규 전용 테이블 + name_normalized 위 GIN trigram(pg_trgm)', () => {
  const sql = read(MIGRATION);
  expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.hira_drug_name_index/i);
  expect(sql).toMatch(/CREATE EXTENSION IF NOT EXISTS pg_trgm/i);
  expect(sql).toMatch(/USING gin \(name_normalized gin_trgm_ops\)/i);
  expect(sql).toContain('item_std_code');
  expect(sql).toContain('name_normalized');
});

test('VG-3: FK 無 — prescription_codes 참조 결합 없음(reference-lookup만)', () => {
  const sql = read(MIGRATION);
  expect(sql).not.toMatch(/\bREFERENCES\b/i);
  expect(sql).not.toMatch(/FOREIGN KEY/i);
});

test('§5: RLS = authenticated SELECT-only(anon 신규 surface 0)', () => {
  const sql = read(MIGRATION);
  expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/i);
  expect(sql).toMatch(/FOR SELECT\s+TO authenticated/i);
  expect(sql).not.toMatch(/TO anon/i);
  // write 정책 없음(service_role import 만) → INSERT/UPDATE/DELETE 정책 부재
  expect(sql).not.toMatch(/FOR (INSERT|UPDATE|DELETE)/i);
});

test('§4: rollback = DROP TABLE(greenfield 완전 가역) + dryrun 무영속(COMMIT 없음)', () => {
  const rb = read(ROLLBACK);
  expect(rb).toMatch(/DROP TABLE IF EXISTS public\.hira_drug_name_index/i);
  const dr = read(DRYRUN);
  expect(dr).not.toMatch(/^\s*COMMIT\s*;/im); // no-persistence 프로토콜
  expect(dr).toContain('DRYRUN_ROLLBACK_SENTINEL'); // exception-handler 무영속 실행검증
});

// ─────────────────────────────────────────────────────────────────────────────
// VG-4 — 이중거버넌스 회피: 판정 로직 무변경(코퍼스만 적재)
// ─────────────────────────────────────────────────────────────────────────────
test('VG-4: computeDrugVerifyVerdict 무변경 — partial 활성화 안 함(코퍼스만)', () => {
  const src = read(VERDICT);
  // AC-8 은 판정 로직을 건드리지 않는다 — partial 은 여전히 코드축 로직에서 직접 산출되지 않음.
  expect(src).toContain('computeDrugVerifyVerdict');
  // 유틸 모듈은 판정 경로에 wiring 하지 않음(정규화·코드축만) — drugVerification import 부재
  const util = read(UTIL);
  expect(util).not.toMatch(/from\s+['"][^'"]*drugVerification/); // 판정 모듈 import 없음
  expect(util).not.toMatch(/\bfunction\s+computeDrugVerifyVerdict/); // 판정 함수 재정의 없음
  expect(util).toMatch(/VG-4/); // 범위 경계 주석 존재
});
