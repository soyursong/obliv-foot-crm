/**
 * T-20260629-foot-RRN-EDIT-WIPE-FIX
 * 2번차트 주민번호 [수정] 클릭 시 등록값이 빈칸(000000-0000000)으로 초기화되던 버그 픽스.
 *
 * 원인: [수정] onClick 에서 setRrnFront('') 로 앞 6자리(생년월일)까지 비워 등록값 소실 + 빈/부분값 덮어쓰기 위험.
 * 수정:
 *  - [수정] 진입 시 앞 6자리는 기존 마스킹값(rrnMasked = '680604-*******')의 앞자리로 prefill, 뒷자리만 빈칸.
 *  - 통합 패널 저장(handleInfoPanelSave)에서 editingRrn && rrnBack 미입력 = 실제 수정 안 함 →
 *    rrn_encrypt 미호출(빈/부분값 덮어쓰기 금지), 기존 암호값 무손상 보존.
 *  - 저장은 13자리 가드(saveRrn / 버튼 disabled <13) 유지 → 부분값 저장 불가.
 *
 * PHI: 평문 RRN 무권한 노출/로그 금지(PGSodium runbook). 본 수정은 표시/편집 UX 버그 픽스로 스키마 무변경.
 *
 * 검증(소스 권위 — RRN 평문을 테스트가 다루지 않도록 DOM 평문 입력은 배제):
 *  AC-1(값 보존): 취소/패널저장-미수정 경로에서 기존값 무손상.
 *  AC-2/4(확인 가능·prefill): 앞자리 prefill 도입, 앞자리 0 초기화 제거.
 *  AC-3(보안): rrn_decrypt/rrn_encrypt RPC 경유 유지, 평문 로깅 추가 없음.
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const SRC = fs.readFileSync(path.resolve('src/pages/CustomerChartPage.tsx'), 'utf-8');

test.describe('S1: [수정] 진입 시 앞자리 prefill (000000 초기화 제거)', () => {
  test('S1-1: [수정] onClick 이 앞 6자리를 rrnMasked 에서 prefill', () => {
    // 신규 동선: rrnMasked.split('-')[0] 로 앞자리 추출 후 setRrnFront(front)
    expect(SRC, 'rrnMasked 앞자리 prefill 누락').toContain("rrnMasked ? rrnMasked.split('-')[0]");
    expect(SRC, 'setRrnFront(front) prefill 배선 누락').toContain('setRrnFront(front); setRrnBack(\'\'); setEditingRrn(true)');
  });

  test('S1-2: 앞자리 초기화 동선은 무권한 "입력" 경로 1곳만 잔존(조회 가능 [수정]은 prefill)', () => {
    // 무권한(조회 권한 없음) "입력" 경로는 표시할 마스킹값이 없어 빈칸 입력이 정상 → 그 1곳만 허용.
    // 조회 가능 [수정] 경로는 prefill 로 전환되었으므로 옛 초기화 패턴은 최대 1회만 등장해야 함.
    const occurrences = SRC.split("setRrnFront(''); setRrnBack(''); setEditingRrn(true); setIsDirty(true); }}").length - 1;
    expect(occurrences, '조회 가능 [수정] 경로에도 옛 초기화 패턴 잔존').toBeLessThanOrEqual(1);
    // 픽스 마커 주석 존재
    expect(SRC).toContain('T-20260629-foot-RRN-EDIT-WIPE-FIX');
  });
});

test.describe('S2: 빈/부분값 덮어쓰기 방지 (값 보존 — AC-1)', () => {
  test('S2-1: 패널 저장에서 editingRrn && rrnBack 미입력 시 rrn_encrypt 미호출(보존)', () => {
    expect(SRC, '미수정 보존 가드 누락').toContain('editingRrn && rrnBack.length === 0');
  });

  test('S2-2: saveRrn 13자리 가드 유지(부분값 저장 차단)', () => {
    expect(SRC).toContain("if (digits.length !== 13) { toast.error('주민번호 13자리를 입력해주세요'); return; }");
    // 저장 버튼 disabled — 13 미만 차단
    expect(SRC).toContain('disabled={rrnFront.length + rrnBack.length < 13}');
  });

  test('S2-3: [취소]는 편집 transient state 만 비우고 표시값(rrnMasked) 미변경 → 보존', () => {
    // 취소 핸들러는 setEditingRrn(false)+input clear 뿐, setRrnMasked 호출 없음(보존)
    expect(SRC).toContain("onClick={() => { setEditingRrn(false); setRrnFront(''); setRrnBack(''); }}");
  });
});

test.describe('S3: PHI 보안 가드 (AC-3) — RPC 경유 유지, 평문 추가 노출 없음', () => {
  test('S3-1: 복호화/암호화는 기존 rrn_decrypt/rrn_encrypt RPC 경유 유지', () => {
    expect(SRC).toContain("supabase.rpc('rrn_decrypt'");
    expect(SRC).toContain("supabase.rpc('rrn_encrypt'");
  });

  test('S3-2: 본 픽스가 평문 RRN 콘솔 로깅을 추가하지 않음', () => {
    // 픽스 주석 라인 인근에 console.log(plain rrn) 류 추가가 없어야 함(전역 가드)
    expect(SRC).not.toMatch(/console\.(log|info|debug)\([^)]*rrnBack/);
    expect(SRC).not.toMatch(/console\.(log|info|debug)\([^)]*plain_rrn/);
  });
});
