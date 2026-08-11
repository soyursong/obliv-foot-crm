import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/**
 * T-20260811-foot-DASH-SEARCH-SCROLL-HIGHLIGHT
 *   — 풋센터CRM 당일 현황 대시보드 '당일 검색'(이름·전화·차트번호) 결과 선택 시 →
 *     보드 위의 매칭 고객 카드로 자동 스크롤 이동 + 시각 강조(테두리/배경 플래시).
 *     현재는 검색 결과만 뜨고 카드 위치는 수동으로 찾아야 함 → 자동 이동+강조로 개선.
 *
 * 원천: NEW-TASK MSG-20260811-171556-vmvj (planner). 요청자: 김주연 총괄(#project-doai-crm-풋확장).
 * 재사용: T-20260804-foot-RESVDEEPLINK-RESERVATIONID-HIGHLIGHT '항목 이동+하이라이트' 패턴
 *         (트리거=검색어 선택, 화면=당일 현황 대시보드).
 * flicker/재스크롤 방지 cross-ref: T-20260715-foot-DOCDASH-FLICKER
 *   → 선택(사용자 액션)당 1회만 실행, rows/렌더 상태 비의존, double rAF 정착 후 scrollIntoView.
 *
 * 거대-인라인 페이지(Dashboard) 관례 = source-integrity gating(정적 단언).
 * 실 브라우저 검색→스크롤 착지·강조 가시성은 supervisor field-soak(갤탭 실기기)로 닫음.
 * db_change=false(FE-only, DDL 0, 신규 cross-CRM 접근 0).
 */

const DASH = fs.readFileSync(path.resolve('src/pages/Dashboard.tsx'), 'utf-8');
const CSS = fs.readFileSync(path.resolve('src/index.css'), 'utf-8');

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 1 — 검색 결과 선택 → 매칭 카드로 이동 + 강조 (핵심 AC)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('시나리오1: 당일 검색 선택 → 매칭 고객 카드 자동 스크롤 + 강조', () => {
  test('S1-1: 선택 핸들러가 매칭 카드 selector 산출 → 스크롤 타깃 설정', () => {
    const start = DASH.indexOf('const handleTodaySearchSelect');
    expect(start, 'handleTodaySearchSelect 없음').toBeGreaterThan(-1);
    const block = DASH.slice(start, start + 1400);
    // 체크인 완료 → 체크인 카드([data-checkin-id]) / 미체크인 → 예약 카드([data-resv-id])
    expect(block, '체크인 카드 selector 산출 없음').toContain('[data-checkin-id="${checkIn.id}"]');
    expect(block, '예약 카드 selector 산출 없음').toContain('[data-resv-id="${r.id}"]');
    // 스크롤 타깃 상태 설정 (nonce 포함 → 동일 카드 재선택도 재실행)
    expect(block, '스크롤 타깃(setSearchScrollTarget) 설정 없음').toContain('setSearchScrollTarget({ selector, nonce:');
  });

  test('S1-2: 스크롤 effect = scrollIntoView(center) + 강조 클래스(card-search-flash) 부착', () => {
    const start = DASH.indexOf('searchScrollTarget');
    expect(start, 'searchScrollTarget 상태 없음').toBeGreaterThan(-1);
    // effect 내 scrollIntoView 착지
    expect(DASH, 'scrollIntoView(center) 없음')
      .toContain("scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })");
    // 강조 클래스 부착/제거
    expect(DASH, '강조 클래스 부착 없음').toContain("el.classList.add('card-search-flash')");
    expect(DASH, '강조 클래스 자동 제거(타이머) 없음').toContain("el.classList.remove('card-search-flash')");
    // 재선택 시 애니메이션 재시작 위한 reflow
    expect(DASH, '재선택 reflow(offsetWidth) 없음').toContain('void el.offsetWidth');
  });

  test('S1-3: 예약 카드에 per-id 앵커(data-resv-id) 부착 — 초진/재진 박스 공통', () => {
    // box1(초진)·box2(재진) 예약 카드 루트에 data-resv-id 앵커
    const box1 = DASH.indexOf('data-testid="box1-resv-card"');
    const box2 = DASH.indexOf('data-testid="box2-resv-card"');
    expect(box1, 'box1 예약 카드 없음').toBeGreaterThan(-1);
    expect(box2, 'box2 예약 카드 없음').toBeGreaterThan(-1);
    expect(DASH.slice(box1, box1 + 120), 'box1 data-resv-id 앵커 없음').toContain('data-resv-id={reservation.id}');
    expect(DASH.slice(box2, box2 + 120), 'box2 data-resv-id 앵커 없음').toContain('data-resv-id={reservation.id}');
  });

  test('S1-4: 강조 CSS = outline 기반 flash(overflow 컨테이너 클립 회피) + 유한 종료', () => {
    // outline 기반(healer-blink 패턴 준용) — box-shadow와 달리 kanban overflow:auto 안에서도 가시
    expect(CSS, 'card-search-flash 클래스 없음').toContain('.card-search-flash');
    expect(CSS, 'flash keyframe 없음').toContain('@keyframes card-search-flash-kf');
    expect(CSS, 'outline 기반 강조 아님').toMatch(/\.card-search-flash\s*\{[^}]*outline:/);
    // 유한(1회) 애니메이션 — 무한 깜빡임 아님(flicker 방지)
    expect(CSS, '유한 1회 애니메이션 아님').toMatch(/animation:\s*card-search-flash-kf[^;]*\s1\s/);
    // 종료 상태 transparent (잔상 없음)
    expect(CSS, '종료 transparent 아님').toContain('outline-color: rgba(20, 184, 166, 0)');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 2 — flicker/재스크롤 방지 (cross-ref DOCDASH-FLICKER)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('시나리오2: 결과 렌더 정착 후 1회 실행 (무한 re-scroll 금지)', () => {
  test('S2-1: double rAF 로 렌더 정착 대기 후 scrollIntoView', () => {
    const idx = DASH.indexOf('if (!searchScrollTarget) return;');
    expect(idx, '스크롤 effect 가드 없음').toBeGreaterThan(-1);
    const block = DASH.slice(idx, idx + 900);
    // 중첩 requestAnimationFrame (드롭다운 닫힘·결과 렌더 정착 후 실행)
    const rafCount = (block.match(/requestAnimationFrame/g) ?? []).length;
    expect(rafCount, 'double rAF(2회) 아님').toBeGreaterThanOrEqual(2);
    // cleanup 에서 rAF/타이머 취소(중복 실행/leak 방지)
    expect(block, 'rAF cleanup(cancelAnimationFrame) 없음').toContain('cancelAnimationFrame(raf1)');
    expect(block, 'flash 타이머 cleanup 없음').toContain('if (flashTimer) clearTimeout(flashTimer)');
  });

  test('S2-2: effect 의존성 = searchScrollTarget 단일 (rows/렌더 상태 비의존 → 재-스크롤 루프 없음)', () => {
    const idx = DASH.indexOf('if (!searchScrollTarget) return;');
    const block = DASH.slice(idx, idx + 1400);
    // effect 종료의 deps 배열이 [searchScrollTarget] — 자동 새로고침 re-render 로 재트리거 안 함
    expect(block, 'effect deps 가 [searchScrollTarget] 단일 아님').toContain('}, [searchScrollTarget]);');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 3 — 회귀 안전 + FE-only (매칭 없음/미입력/초기화 시 무발생)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('시나리오3: 회귀 안전(무매칭/미입력/초기화 무발생) + FE-only', () => {
  test('S3-1: 미선택/초기화 상태 = searchScrollTarget null → effect early-return(무스크롤·무강조)', () => {
    // 초기값 null
    expect(DASH, 'searchScrollTarget 초기 null 없음')
      .toContain('useState<{ selector: string; nonce: number } | null>(null)');
    // null 이면 즉시 return
    expect(DASH, 'null early-return 가드 없음').toContain('if (!searchScrollTarget) return;');
    // 카드 미발견(취소·상태변경) 시 조용히 no-op
    const idx = DASH.indexOf('if (!searchScrollTarget) return;');
    const block = DASH.slice(idx, idx + 900);
    expect(block, '카드 미발견 no-op(el 없음 return) 없음').toContain('if (!el) return;');
  });

  test('S3-2: 검색 무매칭 시 결과 0 → 선택 자체 불가(doTodaySearch 결과셋 게이트 불변)', () => {
    // 무매칭이면 결과셋 빈 배열 → 드롭다운에 선택할 항목 없음(스크롤 트리거 원천 차단)
    expect(DASH, '무입력 시 결과 초기화 회귀').toContain("if (!q.trim()) { setTodaySearchResults([]); return; }");
    // 결과 렌더 게이트 유지
    expect(DASH, '무매칭 안내(일치 환자 없음) 회귀').toContain('일치하는 환자 없음');
  });

  test('S3-3: FE-only — 스크롤/강조 경로에 DB write 혼입 0 (db_change=false)', () => {
    const start = DASH.indexOf('const handleTodaySearchSelect');
    const block = DASH.slice(start, start + 2400);
    expect(block, '선택/스크롤 경로에 insert 혼입').not.toContain('.insert(');
    expect(block, '선택/스크롤 경로에 update 혼입').not.toContain('.update(');
    expect(block, '선택/스크롤 경로에 delete 혼입').not.toContain('.delete(');
  });

  test('S3-4: 기존 당일 검색 인프라 무접촉 (검색함수·닫기·범위표시 회귀 0)', () => {
    expect(DASH, '당일 검색 함수(doTodaySearch) 회귀').toContain('const doTodaySearch');
    expect(DASH, '외부클릭 닫기 회귀').toContain('setTodaySearchOpen(false)');
    expect(DASH, '검색 범위(당일 예약 한정) 표시 회귀').toContain('예약 한정');
    // E.164 전화 정규화 매칭 유지
    expect(DASH, '전화 뒷번호 매칭 회귀').toContain('digitsNoLeadingZero');
  });
});
