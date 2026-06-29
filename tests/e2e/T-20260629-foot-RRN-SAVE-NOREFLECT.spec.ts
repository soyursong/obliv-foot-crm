/**
 * T-20260629-foot-RRN-SAVE-NOREFLECT
 * 2번 고객차트(환자 정보) 주민번호 저장 후 화면 즉시 미반영 (김진화 케이스).
 *
 * 진단(코드 권위): 기존 코드는 rrn_encrypt 성공 시 입력값으로 낙관적 setRrnMasked 후 setEditingRrn(false)
 *   → 저장 성공이면 새로고침 없이 이미 반영되는 구조. 따라서 "순수 표시 버그"는 현 코드에서 재현 불가 →
 *   증상은 (a) 저장 자체 미영속(silent/errored) 또는 (b) 영속됐으나 권위값과 표시값 괴리 가능성에 더 부합.
 *
 * 수정(서버 권위값 재조회로 즉시 반영 — planner 가이드 "쿼리 invalidate/상태 갱신"):
 *  - 저장 성공 직후 confirmRrnSaved() 가 조회권한 사용자에게 rrn_decrypt 재조회 → DB 실제값으로
 *    rrnMasked/rrnFull 세팅(낙관적 입력기반 표시 제거). 13자리 미회신 = 미영속 → 명시적 에러 토스트(AC-1).
 *  - 신분증 자동확인(markIdVerified)은 영속 확인(true) 시에만 진행.
 *  - 조회권한 없는 staff 는 decrypt 항상 null(정책) → 세션 낙관 마스킹 유지(STAFF-CHART2-RRN-NOSAVE 보존).
 *
 * PHI: 평문 RRN 을 테스트가 DOM 으로 다루지 않도록 소스 권위(SRC 문자열) 검증.
 *      rrn 평문 콘솔 로깅/노출 추가 없음(PGSodium runbook 준수, 스키마 무변경).
 *
 * AC:
 *  AC-1(진단/유실차단): 미영속이면 "저장된 듯" 표시 대신 에러 토스트.
 *  AC-2(즉시 반영): 저장 성공 시 서버 권위 마스킹값을 새로고침 없이 즉시 표시.
 *  AC-3(보안): rrn_encrypt/rrn_decrypt RPC 경유 유지, 평문 로깅 추가 없음.
 *  AC-4(회귀): 13자리 가드·취소 보존·WIPE-FIX 미수정-보존 동선 무영향.
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const SRC = fs.readFileSync(path.resolve('src/pages/CustomerChartPage.tsx'), 'utf-8');

test.describe('S1: 저장 성공 → 서버 권위값 재조회로 즉시 반영 (AC-2)', () => {
  test('S1-1: confirmRrnSaved 헬퍼가 rrn_decrypt 재조회로 권위 마스킹값을 세팅', () => {
    expect(SRC, 'confirmRrnSaved 헬퍼 누락').toContain('const confirmRrnSaved = useCallback(');
    // 조회권한 사용자: 저장 직후 rrn_decrypt 재조회
    expect(SRC).toMatch(/confirmRrnSaved[\s\S]*?userCanViewRrn[\s\S]*?supabase\.rpc\('rrn_decrypt'/);
    // 권위값 13자리 → 서버값으로 마스킹/전체값 세팅
    expect(SRC).toContain("setRrnMasked(s.slice(0, 6) + '-*******')");
  });

  test('S1-2: 저장 성공 경로가 낙관적 입력기반 setRrnMasked 대신 confirmRrnSaved 호출', () => {
    // saveRrn / handleInfoPanelSave 성공 경로에서 confirmRrnSaved 사용 (3 경로: 메인+재시도+패널)
    const calls = SRC.split('await confirmRrnSaved(rrnFront, rrnBack)').length - 1;
    expect(calls, 'confirmRrnSaved 호출 경로 누락').toBeGreaterThanOrEqual(3);
    // 옛 낙관적 입력기반 표시(setRrnMasked(rrnFront + ...)) 제거됨
    expect(SRC, '낙관적 입력기반 setRrnMasked 잔존').not.toContain("setRrnMasked(rrnFront + '-' + '*'.repeat(7))");
  });
});

test.describe('S2: 미영속 silent-fail 차단 + 자동확인 게이팅 (AC-1)', () => {
  test('S2-1: decrypt 13자리 미회신 시 명시적 에러 토스트(데이터 유실 신호)', () => {
    expect(SRC).toContain("toast.error('주민번호가 저장되지 않았습니다. 다시 시도해주세요.')");
  });

  test('S2-2: 신분증 자동확인은 영속 확인(persisted=true) 시에만 진행', () => {
    // markIdVerified 가 무조건 호출이 아니라 영속 결과 가드 뒤에서만 호출
    expect(SRC).toMatch(/if \(persisted\) await markIdVerified\(\)/);
    expect(SRC).toMatch(/if \(rrnPersisted\) await markIdVerified\(\)/);
  });
});

test.describe('S3: PHI 보안 가드 (AC-3)', () => {
  test('S3-1: 복호/암호는 기존 rrn_decrypt/rrn_encrypt RPC 경유 유지', () => {
    expect(SRC).toContain("supabase.rpc('rrn_decrypt'");
    expect(SRC).toContain("supabase.rpc('rrn_encrypt'");
  });

  test('S3-2: 본 수정이 평문 RRN 콘솔 로깅을 추가하지 않음', () => {
    expect(SRC).not.toMatch(/console\.(log|info|debug)\([^)]*rrnBack/);
    expect(SRC).not.toMatch(/console\.(log|info|debug)\([^)]*plain_rrn/);
    expect(SRC).not.toMatch(/console\.(log|info|debug)\([^)]*frontDigits/);
  });
});

test.describe('S4: 회귀 — 기존 입력/마스킹/보존 동선 무영향 (AC-4)', () => {
  test('S4-1: 13자리 저장 가드 유지', () => {
    expect(SRC).toContain("if (digits.length !== 13) { toast.error('주민번호 13자리를 입력해주세요'); return; }");
    expect(SRC).toContain('disabled={rrnFront.length + rrnBack.length < 13}');
  });

  test('S4-2: [취소]는 편집 transient state 만 비우고 표시값(rrnMasked) 미변경 → 보존', () => {
    expect(SRC).toContain("onClick={() => { setEditingRrn(false); setRrnFront(''); setRrnBack(''); }}");
  });

  test('S4-3: WIPE-FIX 미수정-보존 가드(rrnBack 미입력 시 rrn_encrypt 미호출) 유지', () => {
    expect(SRC).toContain('editingRrn && rrnBack.length === 0');
  });

  test('S4-4: 로드 시 권위 복호(rrn_decrypt) → 마스킹 표시 경로 유지(회귀 락)', () => {
    expect(SRC).toContain("const { data } = await supabase.rpc('rrn_decrypt', { customer_uuid: customer.id });");
  });
});
