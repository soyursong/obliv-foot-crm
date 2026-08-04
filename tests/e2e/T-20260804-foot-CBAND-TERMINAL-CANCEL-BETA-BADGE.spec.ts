import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(path.join(__dirname, '..', '..', 'src', rel), 'utf8');

/**
 * T-20260804-foot-CBAND-TERMINAL-CANCEL-BETA-BADGE — 코밴 [단말기 취소] 버튼 'BETA' 표기
 * ────────────────────────────────────────────────────────────────────────────
 * 부모 = T-20260804-foot-CBAND-TERMINAL-CANCEL-S1-BTN(버튼 자체) / 자매 = T-20260803-foot-CBAND-DIRECTPAY-BETA-BADGE.
 * 순수 additive FE — 취소 동선·S1 전문·이중취소 가드 무접촉(db_change=false).
 *
 * ★ 하네스: 이 레포 unit 프로젝트 표준(정적 소스 가드). BETA 배지는 렌더 관심사이므로 컴포넌트 소스를
 *   정본으로 읽어 계약을 잠근다. 런타임 분기(플래그 OFF=null / 플랜A vs 수기 disabled)는 부모/자매 spec 이 커버.
 *
 * 커버(수용기준):
 *  · AC-1 [단말기 취소] 버튼(활성/플랜A)에 "BETA" 배지 부착 + 다이얼로그 제목에도 일관 표기.
 *  · AC-2 BETA = 단일 지점 토글/상수(CBAND_BETA). "안정화되면 뗀다" 대비 — 공유 컴포넌트 SSOT.
 *  · 재사용   DIRECTPAY(amber-100/amber-700) 룩앤필 계승 — 신규 배지 구현 지양.
 *  · ②(존치) 기존 [수정][취소][삭제] 버튼 미삭제(플랜A 비활성 ≠ 제거, 수기 건 존치).
 *  · 무접촉  DIRECTPAY(CbandPayEntryButton) deployed 자산 — 배지 인라인 span 그대로(리팩터 없음).
 */

const BADGE = () => SRC('components/CbandBetaBadge.tsx');
const CANCEL = () => SRC('components/CbandTerminalCancelButton.tsx');
const SHEET = () => SRC('components/CheckInDetailSheet.tsx');
const ENTRY = () => SRC('components/CbandPayEntryButton.tsx');

test.describe('AC-2 단일 지점 토글/상수 (공유 배지 SSOT)', () => {
  test('AC-2: CBAND_BETA 전역 토글 상수가 단일 지점(CbandBetaBadge)에 있다', () => {
    const src = BADGE();
    expect(src).toContain('export const CBAND_BETA = true;');
    // 토글이 OFF면 배지 자체가 사라진다(호출부 JSX 삭제 없이 원복) = 단일 지점 제거.
    expect(src).toMatch(/if \(!CBAND_BETA\) return null;/);
    // 배지 텍스트 = BETA(uppercase 표기).
    expect(src).toMatch(/>\s*BETA\s*</);
  });

  test('재사용: DIRECTPAY 룩앤필(amber-100/amber-700 · text-[10px] · uppercase) 계승 — 신규 배지 구현 지양', () => {
    const src = BADGE();
    expect(src).toContain('bg-amber-100');
    expect(src).toContain('text-amber-700');
    expect(src).toContain('text-[10px]');
    expect(src).toContain('uppercase');
  });
});

test.describe('AC-1 [단말기 취소] 버튼 BETA 표기', () => {
  test('AC-1: [단말기 취소] 활성 버튼 라벨 옆에 공유 <CbandBetaBadge/> 부착', () => {
    const src = CANCEL();
    // 공유 배지 컴포넌트 임포트(신규 배지 구현 아님).
    expect(src).toContain("import { CbandBetaBadge } from '@/components/CbandBetaBadge';");
    // 활성 [단말기 취소] 버튼(btn-terminal-cancel-*) 라벨 '단말기 취소' 직후에 배지가 온다.
    const btnIdx = src.indexOf('data-testid={`btn-terminal-cancel-${payment.id}`}');
    expect(btnIdx).toBeGreaterThan(-1);
    const btnBlock = src.slice(btnIdx, btnIdx + 500);
    expect(btnBlock).toContain('단말기 취소');
    expect(btnBlock).toContain('cband-beta-badge-terminal-cancel-');
    // 라벨이 배지보다 앞(라벨 옆 위치 규칙).
    expect(btnBlock.indexOf('단말기 취소')).toBeLessThan(btnBlock.indexOf('cband-beta-badge-terminal-cancel-'));
  });

  test('AC-1(보강): 취소 다이얼로그 제목에도 BETA 배지가 일관 표기된다', () => {
    const src = CANCEL();
    expect(src).toContain('cband-beta-badge-terminal-cancel-dialog');
    // 다이얼로그 제목('카드 단말기 취소') 블록 안에 배지가 있다.
    const titleIdx = src.indexOf('카드 단말기 취소');
    expect(titleIdx).toBeGreaterThan(-1);
    expect(src.slice(titleIdx, titleIdx + 300)).toContain('cband-beta-badge-terminal-cancel-dialog');
  });

  test('배지는 수기 건(AC-8 disabled/비적용) 경로가 아니라 활성 경로에 부착된다', () => {
    const src = CANCEL();
    // 수기 건 disabled 조기 return(!planA) 이 배지 부착부(btn-terminal-cancel-${payment.id})보다 앞.
    const manualIdx = src.indexOf('if (!planA) {');
    const activeBadgeIdx = src.indexOf('cband-beta-badge-terminal-cancel-${payment.id}');
    expect(manualIdx).toBeGreaterThan(-1);
    expect(activeBadgeIdx).toBeGreaterThan(-1);
    expect(manualIdx).toBeLessThan(activeBadgeIdx);
    // 수기 disabled 버튼(btn-terminal-cancel-disabled-*)에는 BETA 배지 미부착(도입 중 표기는 실사용 활성 액션에만).
    const disabledIdx = src.indexOf('btn-terminal-cancel-disabled-');
    const disabledBlock = src.slice(disabledIdx, disabledIdx + 700);
    expect(disabledBlock).not.toContain('CbandBetaBadge');
  });
});

test.describe('② 기존 [수정][취소][삭제] 존치 (삭제·대체 금지)', () => {
  test('②: [수정][취소][삭제] 버튼 라벨이 시트에 그대로 존재한다', () => {
    const src = SHEET();
    // 3버튼 훅 + 라벨 존치(플랜A 비활성 ≠ 제거).
    expect(src).toContain('data-testid={`btn-edit-payment-${p.id}`}');
    expect(src).toContain('data-testid={`btn-cancel-payment-${p.id}`}');
    expect(src).toContain('data-testid={`btn-delete-payment-${p.id}`}');
    expect(src).toContain('>수정</button>');
    expect(src).toContain('>취소</button>');
    expect(src).toContain('>삭제</button>');
  });

  test('②: 플랜A 는 비활성(disabled)이지 제거 아님 — 수기 건은 활성 존치', () => {
    const src = SHEET();
    // 플랜A 판별(isPlanA) → disabled 결선(비활성). 수기(비-플랜A)는 disabled 아님 = 존치.
    expect(src).toContain('const isPlanA =');
    expect(src).toContain('disabled={isPlanA}');
  });
});

test.describe('무접촉: DIRECTPAY(deployed) 배지 인라인 유지', () => {
  test('DIRECTPAY 자매 배지(cband-beta-badge) 는 인라인 span 그대로 — 공유 컴포넌트로 리팩터하지 않음', () => {
    const src = ENTRY();
    // 자매 티켓 계약(자기 spec 소유) 회귀 보호: 기존 testid 유지 + 이 티켓 공유 컴포넌트로 미교체.
    expect(src).toContain('data-testid="cband-beta-badge"');
    expect(src).toContain('data-testid="cband-beta-badge-dialog"');
    expect(src).not.toContain('CbandBetaBadge');
  });
});
