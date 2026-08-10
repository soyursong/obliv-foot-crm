import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// playwright 는 repo 루트에서 실행 → process.cwd() = repo root (ESM 스코프라 __dirname 미정의).

/**
 * T-20260810-foot-CONSULTROOM-PAYBTN-ADD-REFUNDCOL-RENAME — AC-2 컬럼명 rename(rename-only)
 * ────────────────────────────────────────────────────────────────────────────
 * 범위(SSOT = 티켓 frontmatter): 본 티켓 = **AC-2 컬럼 rename 전용**.
 *   AC-1([결제] BETA 버튼 추가)은 canonical T-20260810-foot-CONSULTROOM-PLANA-PAY-BTN-BESIDE-CREATE 로
 *   fold(중복 제거, §13.1.A ping-pong) → 본 스펙 대상 아님.
 *
 * AC-2: 일마감 결제내역 표 컬럼 헤더 '플랜A 환불' → 'CRM 환불 BETA' 로 표기 변경.
 *   - 배경: '플랜A'는 내부 명칭이라 현장(실장) 미인지 → 'CRM 환불'이 직관적(reporter 최필경 총괄).
 *   - 버튼 내부 문구 '단말기 취소'(CbandTerminalCancelButton) = **무변경**.
 *   - 짝맞춤 판별 로직(부모 AC-3 VG-4 isPlanACardPayment) = **무변경**.
 *
 * ⚠ 순수 텍스트 rename → 실화면 렌더/태블릿 표기 = field-soak(갤탭) + browser-verify.
 *   본 스펙은 rename 이 적용됐고 인접 무변경 자산(버튼 라벨·짝맞춤 판별자)이 훼손되지 않았음을
 *   소스 불변식(deterministic source invariant)으로 고정(over-assert·live-render 강제 없음).
 */

const ROOT = process.cwd();
const closingSrc = readFileSync(resolve(ROOT, 'src/pages/Closing.tsx'), 'utf8');
const cancelBtnSrc = readFileSync(resolve(ROOT, 'src/components/CbandTerminalCancelButton.tsx'), 'utf8');

test.describe('AC-2 컬럼 rename — 일마감 결제내역 표 헤더', () => {
  test('신규 헤더 "CRM 환불 BETA" 로 렌더(<th>…</th>)', () => {
    expect(closingSrc).toContain('>CRM 환불 BETA</th>');
  });

  test('구 헤더 "플랜A 환불" 표기는 <th> 컬럼 헤더에서 제거됨(rename 완료)', () => {
    // 컬럼 헤더 표기만 대상 — <th>…플랜A 환불</th> 형태가 남아있으면 rename 미완.
    expect(closingSrc).not.toMatch(/>플랜A 환불<\/th>/);
  });
});

test.describe('무변경 불변식 — 인접 자산 훼손 방지', () => {
  test('버튼 내부 문구 "단말기 취소" 는 그대로 유지(CbandTerminalCancelButton)', () => {
    expect(cancelBtnSrc).toContain('단말기 취소');
  });

  test('짝맞춤 판별자(isPlanACardPayment) export 유지 — 부모 AC-3 VG-4 로직 무변경', () => {
    expect(cancelBtnSrc).toContain('isPlanACardPayment');
    // Closing.tsx 는 여전히 짝맞춤 판별자를 사용(플랜A vs 기존방식 환불 버튼 상호배타 강제).
    expect(closingSrc).toContain('isPlanACardPayment');
  });
});
