import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(path.join(__dirname, '..', '..', 'src', rel), 'utf8');

/**
 * T-20260803-foot-CBAND-DIRECTPAY-BETA-BADGE — 코밴 CAT 직결결제 버튼 'BETA' 표기
 * ────────────────────────────────────────────────────────────────────────────
 * 부모 = T-20260731-foot-CBAND-CAT-DIRECT-PAY-PLANA-BUILD (deployed, DARK flag OFF).
 * 순수 FE 라벨 ADDITIVE — 결제·수납·이중결제방지 로직 무변경.
 *
 * ★ 하네스: 이 레포 unit 프로젝트 표준(정적 소스 가드 + 결정론 로직). BETA 뱃지는 렌더
 *   관심사이므로 컴포넌트 소스를 정본으로 읽어 계약을 잠근다. 플래그/probe 게이트 런타임
 *   분기(플래그 OFF=null / probe 3분기)는 부모 BUILD spec §F(probe 3분기) 가 이미 커버 →
 *   여기서는 BETA 뱃지가 '결제 버튼 노출 경로(probe==="ok")' 안에 있음을 구조로 보증한다.
 *
 * 커버(수용기준):
 *  · AC-1 코밴 직결결제 버튼(VITE_CBAND_PAY 노출)에 "BETA" 표기.
 *  · AC-2 기존 [결제 등록] 버튼 존치(삭제·숨김 금지) — 플래그 무관 무조건 렌더.
 *  · AC-3 잠금(직결결제 활성) ON 후에도 [결제 등록] 병존 — 두 버튼이 같은 결제 컨테이너.
 *  · 시나리오3(플래그 OFF 회귀): 게이트 ①②(!enabled → null)에서 BETA 뱃지 미노출.
 */

const ENTRY = () => SRC('components/CbandPayEntryButton.tsx');
const SHEET = () => SRC('components/CheckInDetailSheet.tsx');

test.describe('AC-1 코밴 직결결제 버튼 BETA 표기', () => {
  test('AC-1: 직결결제 진입 버튼에 "BETA" 뱃지(data-testid=cband-beta-badge)가 있다', () => {
    const src = ENTRY();
    expect(src).toContain('data-testid="cband-beta-badge"');
    // 뱃지 텍스트 = BETA (uppercase 표기)
    const badge = src.slice(src.indexOf('data-testid="cband-beta-badge"'));
    expect(badge.slice(0, 200)).toMatch(/>\s*BETA\s*</);
  });

  test('AC-1: BETA 뱃지는 결제 버튼(probe==="ok") 노출 경로 안에만 있다 — 게이트/awaiting/blocked 분기 밖', () => {
    const src = ENTRY();
    // 결제 버튼 진입점 마커(btn-cband-pay-entry)와 BETA 뱃지가 동일 렌더 블록(probe==="ok" return)에 있음.
    const okReturnIdx = src.indexOf('// probe === \'ok\'');
    expect(okReturnIdx).toBeGreaterThan(-1);
    const tail = src.slice(okReturnIdx);
    expect(tail).toContain('data-testid="btn-cband-pay-entry"');
    expect(tail).toContain('data-testid="cband-beta-badge"');
    // 게이트 ①② 조기 return(!enabled → null)은 BETA 뱃지보다 앞(=미노출 경로엔 뱃지 없음).
    const nullGateIdx = src.indexOf('if (!enabled) return null;');
    expect(nullGateIdx).toBeGreaterThan(-1);
    expect(nullGateIdx).toBeLessThan(src.indexOf('data-testid="cband-beta-badge"'));
  });

  test('AC-1(보강): 결제 다이얼로그 제목에도 BETA 뱃지가 일관 표기된다', () => {
    const src = ENTRY();
    expect(src).toContain('data-testid="cband-beta-badge-dialog"');
  });
});

test.describe('AC-2/AC-3 기존 [결제 등록] 버튼 존치(삭제·숨김 금지)', () => {
  test('AC-2: [결제 등록] 버튼 라벨이 시트에 그대로 존재한다', () => {
    const src = SHEET();
    expect(src).toContain('결제 등록');
    // ★T-20260803-foot-CBAND-DIRECTPAY-PREDEPLOY-5FIX ① 로 supersede: 코밴 직결결제 버튼은 이 시트에서
    //   '결제 미니창 맨 아래 [수납] 옆'(PaymentMiniWindow)으로 이관됨. [결제 등록] 존치 계약(삭제·숨김 금지)은
    //   유지되며(위 라벨 존재), 코밴 버튼의 시트내 병존 계약은 5FIX ① 가 대체한다(더 이상 시트에 없음).
    expect(src).not.toContain('CbandPayEntryButton');
  });

  test('AC-3: [결제 등록] 버튼은 VITE_CBAND_PAY(직결결제 플래그)로 게이팅되지 않는다 — 잠금 ON 후에도 존치', () => {
    const src = SHEET();
    // '결제 등록' 라벨 버튼은 코밴 플래그(VITE_CBAND_PAY/isCbandPayEnabled)와 결선되지 않음.
    //   → 직결결제 활성(잠금) 여부와 무관하게 항상 노출(우회 경로 보장).
    const label = '결제 등록';
    const labelIdx = src.indexOf(`<CreditCard className="h-3.5 w-3.5" /> ${label}`);
    expect(labelIdx).toBeGreaterThan(-1);
    // 버튼을 감싼 인접 창(±600자)에 코밴 플래그 조건이 결선돼 있지 않음.
    const around = src.slice(Math.max(0, labelIdx - 600), labelIdx);
    expect(around).not.toContain('VITE_CBAND_PAY');
    expect(around).not.toContain('isCbandPayEnabled');
  });
});

test.describe('시나리오3 플래그 OFF 회귀 — 게이트 구조 보존', () => {
  // ★T-20260803-foot-CBAND-PAYBTN-DISABLED-TOOLTIP: enabled 에서 cfg 결합 분리(TID 미등록은 숨김이 아니라
  //   비활성+툴팁+1줄사유로 처리). 단, '플래그 OFF = 완전 숨김(return null)' 회귀 계약은 그대로 유지된다.
  test('플래그 OFF면 컴포넌트 null(완전 숨김) — enabled=플래그만(cfg 결합 분리)', () => {
    const src = ENTRY();
    // enabled 는 이제 기능플래그만. TID 미등록(cfg==null)은 6-상태 표의 비활성 상태로 별도 처리.
    expect(src).toContain('const enabled = isCbandPayEnabled();');
    expect(src).not.toContain('const enabled = isCbandPayEnabled() && cfg != null;');
    // 플래그 OFF 완전 숨김 계약은 유지.
    expect(src).toContain('if (!enabled) return null;');
  });
});
