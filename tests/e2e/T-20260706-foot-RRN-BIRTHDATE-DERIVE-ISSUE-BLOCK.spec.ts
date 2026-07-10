/**
 * E2E spec — T-20260706-foot-RRN-BIRTHDATE-DERIVE-ISSUE-BLOCK
 * RRN version-aware 복호(Option B) 활성화 — v2(신키) 복호불가로 인한 발급 차단 + 신규 등록 자가검증
 * 실패 해소.
 *
 * RC(prod 실측 2026-07-10): 활성 복호경로가 단일키(app.rrn_key→구키 'obliv_foot_rrn_key_2026')만
 *   사용 → 06-25 rotation 이후 rrn_encryption_version=2(신키 Vault 'foot_rrn_key_v2') 47명 전원 복호
 *   실패("Wrong key"). 발급(균검사·피검사)·RRN표시·실손PDF·신규등록 자가검증 전부 차단.
 * FIX: rrn_decrypt / fn_customer_birthdates 를 rrn_encryption_version 기준 version-aware 다중키로
 *   전환(v1→구키 fallback / v2→Vault 신키). DB 함수 CREATE OR REPLACE, FE 무변경.
 *   migration 20260710170000_rrn_decrypt_version_aware_multikey.sql.
 *
 * prod 실측 evidence (적용 전→후):
 *   · v1 구키 복호: 23/23 성공(무회귀).  · v2 Vault 신키 복호: 47/47 성공(적용전 0).
 *   · fn_customer_birthdates 파생(발급 게이트 실입력): v2 empty-birth cohort 0/47 → 46/47.
 *     (미파생 1건 = RRN 내부 MMDD가 유효날짜 아님 = 데이터품질, AC2 수기입력 가드로 정상 처리.)
 *
 * 검증(AC 1:1) — 정본(migration SQL) fs 직독 결선 가드. version-aware 회귀를 DB 없이 차단:
 *   AC1 : rrn_encryption_version 분기 존재 + v2 → Vault 'foot_rrn_key_v2' 경로.
 *   AC3 : PHI 무회귀 — rrn_decrypt 의 (a) A2 역할게이트 (b) clinic 격리게이트 (c) phi_access_log
 *         audit(예외격리) ★전부 유지★. 신규 복호 surface·GRANT·RLS 변경 없음.
 *   AC4 : 세기코드(1/2/5/6→1900s, 3/4/7/8→2000s, 9/0→1800s) 파생 규칙 유지.
 *   fail-safe: v2 Vault 키 결측 시 구키 fallback 금지(오복호 방지) → RETURN NULL.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIG = resolve(
  __dirname,
  '../../supabase/migrations/20260710170000_rrn_decrypt_version_aware_multikey.sql',
);

function sql(): string {
  return readFileSync(MIG, 'utf8');
}

// rrn_decrypt 함수 본문만 절취(fn_customer_birthdates 오염 방지)
function rrnDecryptBody(src: string): string {
  const start = src.indexOf('FUNCTION public.rrn_decrypt');
  const end = src.indexOf('FUNCTION public.fn_customer_birthdates');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

test.describe('T-20260706 RRN version-aware 복호 (Option B)', () => {
  test('AC1 — version-aware 분기 + v2 Vault 신키 경로', () => {
    const src = sql();
    // 두 복호함수 모두 rrn_encryption_version 으로 분기
    expect(src).toMatch(/rrn_encryption_version/);
    // v2 는 Vault secret 'foot_rrn_key_v2' 조회
    expect(src).toMatch(/vault\.decrypted_secrets/);
    expect(src).toMatch(/foot_rrn_key_v2/);
    // v1 legacy 는 기존 구키 fallback 유지
    expect(src).toMatch(/obliv_foot_rrn_key_2026/);
    // 함수 2종 모두 재정의
    expect(src).toMatch(/FUNCTION public\.rrn_decrypt/);
    expect(src).toMatch(/FUNCTION public\.fn_customer_birthdates/);
  });

  test('AC3 — PHI 무회귀: 역할·clinic 게이트 + phi_access_log audit 유지', () => {
    const body = rrnDecryptBody(sql());
    // 게이트1: A2 역할(관리자군 + consultant/coordinator/therapist)
    expect(body).toMatch(/is_admin_or_manager/);
    expect(body).toMatch(/consultant/);
    expect(body).toMatch(/coordinator/);
    expect(body).toMatch(/therapist/);
    // 게이트2: 테넌트 clinic 격리
    expect(body).toMatch(/current_user_clinic_id\(\)/);
    // audit: phi_access_log append (예외격리)
    expect(body).toMatch(/INSERT INTO public\.phi_access_log/);
    // 신규 GRANT 확대 없음 — rrn_decrypt 에 authenticated 신규 부여 라인 없음(기존 유지)
    expect(body).not.toMatch(/GRANT[\s\S]*rrn_decrypt[\s\S]*anon/i);
  });

  test('AC3 fail-safe — v2 키 결측 시 구키 fallback 금지(오복호 방지)', () => {
    const body = rrnDecryptBody(sql());
    // v2 분기 안에서 키 결측 시 RETURN NULL (구키로 재시도 금지)
    expect(body).toMatch(/v_version\s*=\s*2/);
    expect(body).toMatch(/RETURN NULL/);
  });

  test('AC4 — 세기코드 파생 규칙 유지', () => {
    const src = sql();
    expect(src).toMatch(/1900 \+ v_yy/);
    expect(src).toMatch(/2000 \+ v_yy/);
    expect(src).toMatch(/1800 \+ v_yy/);
  });

  test('무회귀 — RLS 정책 변경/신규 복호 surface 없음', () => {
    const src = sql();
    // RLS 정책(CREATE POLICY / ALTER ... ENABLE ROW LEVEL SECURITY) 손대지 않음
    expect(src).not.toMatch(/CREATE POLICY/i);
    expect(src).not.toMatch(/DISABLE ROW LEVEL SECURITY/i);
    // 신규 복호 함수 없음 — rrn_decrypt/fn_customer_birthdates 2종만 REPLACE
    const createFns = src.match(/CREATE OR REPLACE FUNCTION/g) ?? [];
    expect(createFns.length).toBe(2);
  });
});

// ── 잔여 갭 클로징 마이그(180000): prod 미착지한 fn_customer_birthdates 만 forward 재수렴 ──
// 배경: 170000 은 rrn_decrypt 만 prod 착지, fn_customer_birthdates 블록은 미착지(divergence,
//   supervisor 2026-07-10 실측). 180000 이 fn 만 정본 기준 version-aware 로 재수렴 →
//   실제 prod 에 랜딩되는 fn_customer_birthdates 의 권위 아티팩트. 회귀 가드는 이 파일을 직독.
const MIG_FN = resolve(
  __dirname,
  '../../supabase/migrations/20260710180000_fn_customer_birthdates_version_aware_vault.sql',
);
const MIG_FN_RB = resolve(
  __dirname,
  '../../supabase/migrations/20260710180000_fn_customer_birthdates_version_aware_vault.rollback.sql',
);
function fnSql(): string {
  return readFileSync(MIG_FN, 'utf8');
}

test.describe('T-20260706 fn_customer_birthdates version-aware Vault dual-key (180000 잔여 갭)', () => {
  test('AC1 — v2 Vault 신키 경로 + version 분기 + v1 GUC fallback 유지', () => {
    const src = fnSql();
    // v2: Vault secret 'foot_rrn_key_v2' 직접 READ (별도 키값 불요)
    expect(src).toMatch(/vault\.decrypted_secrets/);
    expect(src).toMatch(/foot_rrn_key_v2/);
    // 행별 version 분기
    expect(src).toMatch(/rrn_encryption_version/);
    expect(src).toMatch(/CASE WHEN r\.ver = 2 THEN v_key_v2 ELSE v_key_v1 END/);
    // v1/legacy: 기존 GUC → 구키 fallback 유지(무회귀)
    expect(src).toMatch(/current_setting\('app\.rrn_key'\)/);
    expect(src).toMatch(/obliv_foot_rrn_key_2026/);
  });

  test('AC3 — 시그니처/GRANT/PHI 무회귀 · rrn_decrypt 무접점 · 신규 surface 0', () => {
    const src = fnSql();
    // TABLE 시그니처 유지 (birth_date_display 만 반환 — rrn 평문/뒷자리 미노출)
    expect(src).toMatch(/RETURNS TABLE \(customer_id uuid, birth_date_display text\)/);
    // 이 마이그는 fn_customer_birthdates 1종만 REPLACE (rrn_decrypt 무접점)
    const createFns = src.match(/CREATE OR REPLACE FUNCTION/g) ?? [];
    expect(createFns.length).toBe(1);
    expect(src).toMatch(/FUNCTION public\.fn_customer_birthdates/);
    expect(src).not.toMatch(/FUNCTION public\.rrn_decrypt/);
    // GRANT 무변경(authenticated 만), RLS 미변경
    expect(src).toMatch(/GRANT EXECUTE ON FUNCTION public\.fn_customer_birthdates\(uuid, uuid\[\]\) TO authenticated/);
    expect(src).not.toMatch(/CREATE POLICY/i);
    expect(src).not.toMatch(/DISABLE ROW LEVEL SECURITY/i);
    // anon/public 은 REVOKE 만 — 실제 GRANT 문이 anon/public 에 EXECUTE 를 부여하지 않음
    expect(src).not.toMatch(/GRANT\s+EXECUTE[\s\S]*?TO\s+(anon|public)\b/i);
  });

  test('AC3 fail-safe — v2 키 결측 시 해당 행 파생 NULL(구키 오복호 금지)', () => {
    const src = fnSql();
    // v2 Vault 조회 실패 시 v_key_v2 := NULL → v_key NULL/'' 이면 복호 skip
    expect(src).toMatch(/v_key_v2 := NULL/);
    expect(src).toMatch(/v_key IS NOT NULL AND v_key <> ''/);
  });

  test('AC4 — 세기코드 파생 규칙 유지', () => {
    const src = fnSql();
    expect(src).toMatch(/1900 \+ v_yy/);
    expect(src).toMatch(/2000 \+ v_yy/);
    expect(src).toMatch(/1800 \+ v_yy/);
  });

  test('멱등 self-test 가드 + 롤백(20260613120000 GUC-only 원복) 동봉', () => {
    const src = fnSql();
    // apply 시점 인-트랜잭션 $verify$ 가드 존재
    expect(src).toMatch(/\$verify\$/);
    expect(src).toMatch(/version-aware self-test 통과/);
    // 롤백 파일: GUC-only 원복 + 시그니처 유지
    const rb = readFileSync(MIG_FN_RB, 'utf8');
    expect(rb).toMatch(/CREATE OR REPLACE FUNCTION public\.fn_customer_birthdates/);
    expect(rb).toMatch(/current_setting\('app\.rrn_key'\)/);
    expect(rb).not.toMatch(/foot_rrn_key_v2/);
  });
});
