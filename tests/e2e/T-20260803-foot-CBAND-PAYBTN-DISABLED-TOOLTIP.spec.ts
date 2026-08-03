import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { cbandGateCopy, type CbandGateKind } from '../../src/lib/cband/gateCopy';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(path.join(__dirname, '..', '..', 'src', rel), 'utf8');
const ENTRY = () => SRC('components/CbandPayEntryButton.tsx');

/**
 * T-20260803-foot-CBAND-PAYBTN-DISABLED-TOOLTIP — 코밴 직결결제(BETA) 버튼: 미연결 시 숨김 → 비활성+툴팁+1줄사유
 * ────────────────────────────────────────────────────────────────────────────
 * 부모 = T-20260731-foot-CBAND-CAT-DIRECT-PAY-PLANA-BUILD / T-20260803-...-BETA-BADGE.
 * 핵심 변경: 기존 hide 로직(probe 미ok = 별도 안내박스/미노출) → 비활성 버튼 렌더 + hover 툴팁
 *   + 버튼 아래 상시 1줄 사유(AC-6, 마우스오버 없이도 "왜 못 누르는지" 노출). db_change=false.
 *
 * ★ 하네스: 6-상태 문구 SSOT(src/lib/cband/gateCopy.ts, 순수·JSX無)는 직접 import 해 결정론 검증,
 *   렌더 배선(게이트 dispatch·disabled·툴팁 래퍼)은 컴포넌트 소스를 정본으로 읽어 계약을 잠근다.
 *   probe 3분기 런타임 로직은 부모 BUILD spec §F(probeTerminal)가 커버. auth/server/page 불요, unit 전용.
 *
 * 커버(수용기준):
 *  · AC-4 6-상태 표: TID미등록/탐지중/권한대기/연결실패 = 비활성+사유 / 연결됨 = 활성 / 플래그OFF = 숨김.
 *  · AC-6 상시 1줄 사유: 툴팁(hover) 밖에 별도 reason 이 항상 렌더(마우스오버 불필요).
 *  · 시나리오1(즉시끊김→blocked): 비활성 버튼 + 툴팁(두 조치 함께) + 1줄 사유 + [다시 확인].
 *  · 시나리오1b(TID미등록): 정확 문구 "단말기 정보(TID)가 등록되지 않았습니다 … 관리자에게 문의".
 *  · 시나리오2(연결→활성): probe==='ok' 경로에서 활성 결제 버튼(btn-cband-pay-entry) 노출.
 *  · 결제/이중결제방지/전문 로직 불변(FE 렌더 조건만 전환) + 신규 npm 의존성 없음.
 */

const ALL_KINDS: CbandGateKind[] = ['tid-missing', 'probing', 'awaiting', 'blocked'];

test.describe('AC-4 6-상태 문구 SSOT (gateCopy)', () => {
  test('4개 비활성 상태 모두 사유·툴팁·testid 가 비어있지 않다', () => {
    for (const kind of ALL_KINDS) {
      const c = cbandGateCopy(kind);
      expect(c.reason.trim().length, `${kind}.reason`).toBeGreaterThan(0);
      expect(c.tooltip.trim().length, `${kind}.tooltip`).toBeGreaterThan(0);
      expect(c.testid, `${kind}.testid`).toContain('cband-gate-');
    }
  });

  test('재시도 정책: 권한대기·연결실패=재시도 가능 / TID미등록·탐지중=재시도 무의미(false)', () => {
    expect(cbandGateCopy('awaiting').retryable).toBe(true);
    expect(cbandGateCopy('blocked').retryable).toBe(true);
    expect(cbandGateCopy('tid-missing').retryable).toBe(false);
    expect(cbandGateCopy('probing').retryable).toBe(false);
  });

  test('상태별 testid 는 서로 겹치지 않는다(6-상태 구분)', () => {
    const ids = ALL_KINDS.map((k) => cbandGateCopy(k).testid);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

test.describe('시나리오1b — TID 미등록(seat_config TID 없음)', () => {
  test('정확 문구: 단말기 정보(TID) 미등록 + 관리자 문의', () => {
    const c = cbandGateCopy('tid-missing');
    expect(c.reason).toContain('단말기 정보(TID)');
    expect(c.reason).toContain('등록되지 않았습니다');
    expect(c.reason).toContain('관리자에게 문의');
    expect(c.retryable).toBe(false); // 스태프가 재탐지해도 소용없음 → [다시 확인] 미노출
  });

  // ★ CONFLICT#1 reconcile (T-20260803-foot-CBAND-TIDCOM-POPUP-PLACEMENT ② §8):
  //   'TID 미등록(!hasCfg)'은 더 이상 비활성 게이트가 아니라 '활성' 진입 버튼 + Dialog(창 안 TID/COM 입력)로
  //   분리됐다(chicken-egg 방지). tid-missing gateCopy 문구 SSOT 는 유지하되 컴포넌트 dispatch 만 바뀐다.
  test('컴포넌트: cfg==null(!hasCfg) → (reconcile) tid-missing 비활성 게이트 대신 활성 진입+Dialog', () => {
    const src = ENTRY();
    // 비활성 tid-missing 게이트 dispatch 는 제거됨.
    expect(src).not.toMatch(/if \(!hasCfg\) return <CbandGateButton kind="tid-missing"/);
    // 대신 !hasCfg 는 활성 진입+Dialog(entryAndDialog)로 분리.
    expect(src).toMatch(/if \(!hasCfg\) return entryAndDialog;/);
  });
});

test.describe('시나리오1 — 즉시끊김(연결 실패, blocked)', () => {
  test('툴팁은 권한차단·데몬미실행 두 조치를 함께 안내(1006 코드 구분 불가)', () => {
    const c = cbandGateCopy('blocked');
    // 두 원인 모두 언급
    expect(c.tooltip).toContain('차단');
    expect(c.tooltip).toContain('단말 프로그램');
    // 두 조치(해제 / 켜기) 모두 언급
    expect(c.tooltip).toMatch(/해제/);
    expect(c.tooltip).toMatch(/켠/);
    // 1줄 사유도 두 조치를 함축
    expect(c.reason).toContain('연결하지 못했습니다');
    expect(c.retryable).toBe(true);
  });

  test('컴포넌트: probe==="blocked" → blocked 게이트로 dispatch', () => {
    const src = ENTRY();
    expect(src).toMatch(/if \(probe === 'blocked'\) return <CbandGateButton kind="blocked"/);
  });
});

test.describe('시나리오2 — 연결됨(ok) → 활성 결제 버튼', () => {
  test('probe==="ok" 경로에서 활성 결제 버튼(btn-cband-pay-entry) 노출', () => {
    const src = ENTRY();
    // ★reconcile: 진입 버튼+Dialog 는 entryAndDialog 로 공용화(활성 상태 = !hasCfg / probe ok).
    expect(src).toContain('data-testid="btn-cband-pay-entry"');
    // 활성 버튼은 disabled 하드코딩이 아니라 조건부(!customerId || prechecking)만.
    expect(src).toContain('disabled={!customerId || prechecking}');
    // ok 경로는 활성 진입+Dialog 반환.
    expect(src).toMatch(/\/\/ probe === 'ok'[^\n]*\n\s*return entryAndDialog;/);
  });

  test('비활성 게이트(probing/awaiting/blocked) dispatch 는 ok 경로(활성 버튼)보다 앞에 위치', () => {
    const src = ENTRY();
    // ★reconcile: tid-missing 은 게이트가 아니라 활성 분리 → 비활성 게이트는 3종만 남는다.
    const gateIdx = src.indexOf("if (probe === null) return <CbandGateButton");
    const okIdx = src.indexOf("// probe === 'ok'");
    expect(gateIdx).toBeGreaterThan(-1);
    expect(gateIdx).toBeLessThan(okIdx);
    for (const k of ['probing', 'awaiting', 'blocked']) {
      expect(src).toContain(`kind="${k}"`);
    }
    // tid-missing 은 컴포넌트 dispatch 에서 제거(활성 분리).
    expect(src).not.toContain('kind="tid-missing"');
  });
});

test.describe('AC-6 상시 1줄 사유 + 비활성 렌더 + 툴팁 래퍼', () => {
  test('CbandGateButton: 비활성 버튼(disabled) + 상시 사유(cband-gate-reason) + 툴팁(role=tooltip)', () => {
    const src = ENTRY();
    // 비활성 버튼 렌더
    expect(src).toContain('data-testid="btn-cband-pay-entry-disabled"');
    expect(src).toMatch(/disabled\s*\n\s*data-testid="btn-cband-pay-entry-disabled"/);
    // ★AC-6: 상시 1줄 사유(reason)는 별도 노드로 렌더(툴팁 hover 밖)
    expect(src).toContain('data-testid="cband-gate-reason"');
    // 마우스오버 툴팁
    expect(src).toContain('data-testid="cband-gate-tooltip"');
    expect(src).toContain('role="tooltip"');
    // group-hover / focus 로 툴팁 노출(경량 CSS)
    expect(src).toMatch(/group-hover:opacity-100/);
  });

  test('reason 노드는 group-hover 툴팁 노드와 분리(항상 보임) — reason 은 opacity-0 hover 게이트가 아님', () => {
    const src = ENTRY();
    const reasonIdx = src.indexOf('data-testid="cband-gate-reason"');
    const tooltipIdx = src.indexOf('data-testid="cband-gate-tooltip"');
    expect(reasonIdx).toBeGreaterThan(-1);
    expect(tooltipIdx).toBeGreaterThan(-1);
    // 사유 노드는 툴팁 노드와 다른 위치(별도 렌더)
    expect(reasonIdx).not.toBe(tooltipIdx);
    // reason span 자체 클래스에 opacity-0(hover 게이트)이 섞이지 않음
    const reasonTag = src.slice(reasonIdx - 60, reasonIdx);
    expect(reasonTag).not.toContain('opacity-0');
  });

  test('disabled 버튼 hover 미발생 대비: 래퍼 span 에 title/aria-label(툴팁 텍스트) 부여', () => {
    const src = ENTRY();
    expect(src).toMatch(/aria-label=\{copy\.tooltip\}\s+title=\{copy\.tooltip\}/);
  });
});

test.describe('불변식 — 렌더 조건만 전환(로직/의존성 무변경)', () => {
  test('플래그 OFF(!enabled)는 여전히 완전 숨김(return null) — 미연결과 구분', () => {
    const src = ENTRY();
    expect(src).toContain('if (!enabled) return null;');
    // enabled 는 이제 플래그만(cfg 결합 해제) → TID 미등록은 숨김 아님
    expect(src).toContain('const enabled = isCbandPayEnabled();');
    expect(src).toContain('const hasCfg = cfg != null;');
  });

  test('신규 npm 의존성 없음: 툴팁은 @radix-ui/react-tooltip 등 외부 툴팁 라이브러리 미사용', () => {
    const src = ENTRY();
    expect(src).not.toContain('@radix-ui/react-tooltip');
    expect(src).not.toMatch(/from ['"]react-tooltip['"]/);
  });

  test('결제/이중결제방지 진입점(approve·precheckConcurrentPayment)·전문 로직 배선 불변', () => {
    const src = ENTRY();
    expect(src).toContain('precheckConcurrentPayment');
    expect(src).toContain('await approve(');
    // insert-first(이중결제 방지)로 이어지는 store 주입 유지
    expect(src).toContain('supabaseAttemptStore');
  });
});
