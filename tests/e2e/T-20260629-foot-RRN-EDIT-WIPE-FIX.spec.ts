/**
 * T-20260629-foot-RRN-EDIT-WIPE-FIX  (REOPEN P0 — 데이터 유실 차단)
 * 2번차트 주민번호 [수정] 클릭 시 뒷자리(7자리)가 사라지던 버그 + 빈/부분값 저장 시 암호화 backhalf 덮어쓰기 차단.
 *
 * ── 진단(prod read-only, 복호 없음) ────────────────────────────────────────────
 *  · rrn_enc(암호문)은 13자리 rrn_encrypt RPC 로만 write — NULL/빈값 write 경로 부재(일괄 patch 에 rrn 없음).
 *    prod 감사: 존재 27건 전부 79바이트(정상)·짧은 암호문 0건 → ★실데이터 유실 0건(AC-6 충족)★.
 *  · FE RRN_VIEW_ROLES(A2) ↔ prod rrn_decrypt 게이트1(A2) 정합 — coordinator 포함. READ-gate 확대 아님(DA CONSULT 비대상).
 *  · 잔존 증상 = 조회권한자 [수정] 진입 시 backhalf 미prefill → "뒷자리 사라짐" 표시 결함(데이터 손실 아님).
 *
 * ── 수정(FE-only, 스키마 무변경) ──────────────────────────────────────────────
 *  - [수정] 진입: 조회권한자는 세션 보유 복호값(rrnFull)으로 앞6+뒷7 모두 prefill(뒷자리=password input 점마스킹).
 *    복호값 없음(rrnFull null: 게이트2 clinic 불일치 등) → 앞자리(rrnMasked)만 prefill·뒷자리 빈칸 fallback.
 *  - 저장 no-op 보존(AC-1' 전 role): saveRrn / handleInfoPanelSave 모두 (a)뒷자리 미입력 또는
 *    (b)기존 등록값(rrnFull)과 동일 → rrn_encrypt 미호출. 13자리 가드(부분값 차단) 유지.
 *
 * PHI: 평문 RRN 무권한 노출/로그 금지(PGSodium runbook). rrnFull 은 조회권한자 세션 내 기존 보유값 — 신규 평문 노출 없음.
 *
 * 검증(소스 권위 — RRN 평문을 테스트가 다루지 않도록 DOM 평문 입력은 배제).
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const SRC = fs.readFileSync(path.resolve('src/pages/CustomerChartPage.tsx'), 'utf-8');

test.describe('S1: [수정] 진입 prefill — 앞자리 0초기화 제거 + 뒷자리 복호값 prefill(AC-5)', () => {
  test('S1-1: 조회권한자 [수정] 은 rrnFull 로 앞6+뒷7 모두 prefill', () => {
    // 복호값(rrnFull) 보유 시 13자리에서 앞6/뒷7 분리하여 둘 다 채움
    expect(SRC, 'rrnFull prefill 분기 누락').toMatch(/if \(rrnFull && \/\^\\d\{6\}-\?\\d\{7\}\$\/\.test/);
    expect(SRC, '앞6자리 prefill 누락').toContain('setRrnFront(d.slice(0, 6))');
    expect(SRC, '뒷7자리 prefill 누락').toContain('setRrnBack(d.slice(6, 13))');
  });

  test('S1-2: 복호값 없을 때(fallback) 앞자리만 rrnMasked 에서 prefill(뒷자리 빈칸)', () => {
    expect(SRC, 'rrnMasked fallback prefill 누락').toContain("rrnMasked ? rrnMasked.split('-')[0]");
    // 앞자리까지 0 초기화하던 옛 동선(조회권한 [수정])은 제거 — 무권한 "입력" 경로 1곳만 잔존
    const occ = SRC.split("setRrnFront(''); setRrnBack(''); setEditingRrn(true); setIsDirty(true); }}").length - 1;
    expect(occ, '조회 가능 [수정] 경로에도 옛 0초기화 패턴 잔존').toBeLessThanOrEqual(1);
    expect(SRC).toContain('T-20260629-foot-RRN-EDIT-WIPE-FIX');
  });
});

test.describe('S2: 데이터 유실 차단 — 빈/부분/미수정 저장 시 backhalf 무손상(AC-1′ 전 role)', () => {
  test('S2-1: handleInfoPanelSave — 뒷자리 미입력 OR 기존값과 동일 시 rrn_encrypt 미호출(no-op)', () => {
    // (a) 미입력 가드 유지 + (b) 동일값 가드 신설 — 둘 중 하나면 보존 분기
    expect(SRC, 'no-op 보존 가드 누락').toContain('rrnBack.length === 0 || (origRrnDigits && curRrnDigits === origRrnDigits)');
    expect(SRC, '기존 등록값 비교 기준(rrnFull) 누락').toContain("rrnFull ? rrnFull.replace(/\\D/g, '') : ''");
  });

  test('S2-2: saveRrn — 기존 등록값과 동일하면 재암호화 생략(no-op 보존)', () => {
    expect(SRC).toContain('if (origDigits && digits === origDigits)');
    // 13자리 가드(부분값 저장 차단) 유지
    expect(SRC).toContain("if (digits.length !== 13) { toast.error('주민번호 13자리를 입력해주세요'); return; }");
    expect(SRC).toContain('disabled={rrnFront.length + rrnBack.length < 13}');
  });

  test('S2-3: [취소]는 편집 transient state 만 비우고 표시값(rrnMasked) 미변경 → 보존', () => {
    expect(SRC).toContain("onClick={() => { setEditingRrn(false); setRrnFront(''); setRrnBack(''); }}");
    // 취소·저장 어느 경로도 setRrnMasked(null/'') 로 표시값을 지우지 않음
    expect(SRC).not.toMatch(/setRrnMasked\(\s*''\s*\)/);
  });

  test('S2-4: rrn_enc write 는 13자리 rrn_encrypt RPC 로만 — 일괄 patch 에 rrn 컬럼 없음', () => {
    // 통합 저장의 customers.update(patch) 에 rrn/rrn_enc 가 섞이지 않아야 함(우발적 NULL 덮어쓰기 차단)
    const patchBlock = SRC.slice(SRC.indexOf('const patch: Partial<Customer>'), SRC.indexOf("from('customers').update(patch)"));
    expect(patchBlock).not.toMatch(/patch\.rrn/);
  });
});

test.describe('S3: PHI 보안 가드(AC-3) — RPC 경유 유지, 평문 추가 노출 없음', () => {
  test('S3-1: 복호화/암호화는 기존 rrn_decrypt/rrn_encrypt RPC 경유 유지', () => {
    expect(SRC).toContain("supabase.rpc('rrn_decrypt'");
    expect(SRC).toContain("supabase.rpc('rrn_encrypt'");
  });

  test('S3-2: 본 픽스가 평문 RRN 콘솔 로깅을 추가하지 않음', () => {
    expect(SRC).not.toMatch(/console\.(log|info|debug)\([^)]*rrnBack/);
    expect(SRC).not.toMatch(/console\.(log|info|debug)\([^)]*rrnFull/);
    expect(SRC).not.toMatch(/console\.(log|info|debug)\([^)]*plain_rrn/);
  });
});
