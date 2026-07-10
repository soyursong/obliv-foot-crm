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
