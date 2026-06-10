/**
 * T-20260610-foot-PENCHART-PERF-BADGE-HIDE (P2)
 * 펜차트 PEN PERF 진단 배지 현장 노출 제거 — 프로파일러 게이트 기본 ON → opt-in 환원.
 *
 * 배경: P0 T-20260606-foot-PENCHART-REFUND-LATENCY REOPEN#3이 blind-fix 차단용으로 프로파일러를
 *       *기본 ON*(line: `enabled = !/penchart_perf=off/.test(_search)`)으로 임시 배포 → 현장(김주연 총괄)이
 *       우상단 PEN PERF HUD를 영구 노출로 오인, 모든 양식에서 "빨간박스 창" 보고.
 *       refund_consent 대형양식 telemetry 회수 완료(coa/move 5.67 >1 → EMPTY-COALESCE 기각,
 *       frameGap 54.9ms jank → RC=렌더/합성 병목 확정, supervisor court GO) → 배지 유지 명분 소멸.
 *       처방: 원래 opt-in 게이트(?penchart_perf 명시 시에만 활성)로 환원 → 현장 비노출.
 *
 * AC-1: PenChartTab 프로파일러 게이트 = opt-in(?penchart_perf present 시에만 enabled).
 *       구 기본-ON 게이트(`= !/penchart_perf=off/.test(_search)` 단독 대입) 제거.
 * AC-4: ?penchart_perf=off 킬스위치 잔존(기본 OFF가 되어 무의미하나 회귀 안전).
 * AC-3(무회귀): draw-path·drawDprRef 좌표 스케일·desync OFF·빈배열가드·STROKE-LAG touch-action·
 *       localStorage 영속화 전부 불변. 배지 표시 게이트 플래그 1줄만 변경.
 *
 * 구조 검증(코드증거) — 게이트 환원 + 무회귀 차단 게이트. 현장 비노출 체감은 field-soak로 닫음.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';

const SRC = 'src/components/PenChartTab.tsx';

test.describe('T-20260610-foot-PENCHART-PERF-BADGE-HIDE', () => {

  // ── 시나리오 1: 기본 비노출 — 게이트 opt-in 환원 ──────────────────────────────
  //   URL 파라미터 없음 → 몇 획 긋기 → 우상단 PEN PERF 배지 미표시(회귀 전: 기본 ON으로 표시됨).
  test('AC-1/시나리오1: 프로파일러 게이트 = opt-in(?penchart_perf 명시 시에만 enabled) — 기본 비노출', () => {
    const src: string = fs.readFileSync(SRC, 'utf-8');

    // 새 게이트: penchart_perf 명시 AND not =off → opt-in. 파라미터 없으면 enabled=false(미표시).
    expect(
      src,
      'opt-in 게이트(/penchart_perf/.test && !=off) 없음 — 기본 비노출 미보장',
    ).toContain('/penchart_perf/.test(_search) && !/penchart_perf=off/.test(_search)');

    // 구 기본-ON 게이트(=off 단독 옵트아웃 = 사실상 항상 ON) 잔존 금지.
    expect(
      src,
      '구 기본-ON 게이트(enabled = !/penchart_perf=off/.test(_search) 단독)가 남아있음 — 현장 영구 노출 재발',
    ).not.toContain('perfRef.current.enabled = !/penchart_perf=off/.test(_search);');
  });

  // ── 시나리오 2: opt-in 시 표시(개발자 재수집 경로 보존) ───────────────────────
  //   /penchart-editor?penchart_perf → 몇 획 → 배지 표시. 배지 렌더 경로·계측 인프라는 보존.
  test('AC-2/시나리오2: ?penchart_perf opt-in 재수집 경로 보존 — 배지 JSX·계측 ref 불변', () => {
    const src: string = fs.readFileSync(SRC, 'utf-8');

    // 배지 JSX(testid + perfDisplay 조건부 렌더) 보존 — opt-in 시 표시 경로.
    expect(src, '배지 testid 제거됨 — opt-in 재수집 불가').toContain('data-testid="penchart-perf-badge"');
    expect(src, '배지 게이트(perfDisplay 조건부) 제거됨').toMatch(/\{perfDisplay && \(/);

    // 프로파일러 ref/계측 인프라 보존(opt-in 시 동작).
    expect(src, 'perfRef 계측 ref 제거됨').toContain('const perfRef = useRef');
    expect(src, 'perfDisplay state 제거됨').toContain('const [perfDisplay, setPerfDisplay] = useState');
    expect(src, 'PERF 요약 로그 제거됨').toContain('[PenChartTab PERF]');
  });

  // ── AC-4: 킬스위치 회귀 안전 ────────────────────────────────────────────────
  test('AC-4: ?penchart_perf=off 킬스위치 잔존(회귀 안전)', () => {
    const src: string = fs.readFileSync(SRC, 'utf-8');
    expect(src, 'penchart_perf=off 킬스위치 제거됨').toContain('penchart_perf=off');
  });

  // ── AC-2: 데이터 백업채널 — localStorage 영속화 유지 ───────────────────────────
  test('AC-2: penchart_perf_last localStorage 영속화 유지(백업 회수채널)', () => {
    const src: string = fs.readFileSync(SRC, 'utf-8');
    expect(src, 'localStorage 영속 백업채널 제거됨').toContain("localStorage.setItem('penchart_perf_last'");
  });

  // ── AC-3(무회귀): draw-path·좌표·desync·빈배열가드·touch-action 전부 불변 ──────
  test('AC-3: 무회귀 — draw-path/drawDprRef 좌표/desync OFF/빈배열가드/touch-action 불변', () => {
    const src: string = fs.readFileSync(SRC, 'utf-8');

    // 빈 coalesced 배열 가드(선빠짐 차단) 불변
    expect(src, 'empty-coalesce 가드 변형됨(회귀 위험)').toContain('(_coa && _coa.length > 0) ? _coa : [e]');

    // 좌표 스케일 단일소스(drawDprRef) 불변
    expect(src, 'drawDprRef 좌표 단일소스 변형됨').toContain('const drawDprRef = useRef<number>(DRAW_DPR)');

    // desync 전 기기 OFF 통일 + 킬스위치 불변(검정화면 비재발)
    expect(src, 'desync getContext 전달 변형됨').toContain('desynchronized: useDesync');
    expect(src, 'penchart_no_desync 킬스위치 변형됨').toContain('penchart_no_desync');

    // STROKE-LAG touch-action 불변
    expect(src, 'STROKE-LAG touch-action 제거됨').toMatch(/touchAction/);

    // 펜 배칭(단일 path stroke) 불변
    expect(src, '펜 단일 path 배칭(quadraticCurveTo) 변형됨').toContain('ctx.quadraticCurveTo(');
  });
});
