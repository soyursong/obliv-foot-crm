/**
 * E2E spec — T-20260717-foot-CANCELREQ-DASH-BTN-MISALIGN
 * 진료대시보드 → 소견서·진단서 처리대기 큐. 발행 컬럼의 '요청 취소' 버튼에서
 *   ⊗ 아이콘 + "요청 취소" 텍스트가 버튼 경계를 벗어나 overflow/wrap 되는 정렬 결함 수정.
 *   (red 색박스 주석 스크린샷 근거 / planner MSG-20260717-133406-7103)
 *
 * ★근본원인: shadcn Button base = `inline-flex items-center justify-center`.
 *   취소 버튼이 `block` 유틸을 추가 → tailwind-merge 로 base 의 `inline-flex` 를 덮어써
 *   display:block 이 됨. flex 정렬(items-center/justify-center)이 무력화되면서
 *   고정 높이(h-6) 안에 icon+text 가 세로 중앙정렬되지 못하고 경계 밖으로 overflow.
 *   형제 '작성하기' 버튼은 `block` 을 쓰지 않아 base flex 유지 → 정상 렌더.
 * ★수정: `block` → `flex`(+ 명시적 items-center/justify-center/leading-none).
 *   w-full(전폭) 유지, 취소 로직·핸들러·onClick 무변경(순수 정렬 CSS).
 *
 * 검증 방식: 현장 계정 PHI → 인증 우회 불가. 정적 코드 구조 검증 + 앱 로드(HTTP 200) + 회귀 가드.
 *   실브라우저 렌더 확인은 하단 체크리스트(갤탭 실기기 현장 confirm 대상).
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const root = path.join(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

const queue = () => read('src/components/doctor/DocRequestQueue.tsx');

// 취소 버튼 className 을 정확히 추출(data-testid="docreq-cancel-btn" 버튼의 className 문자열).
function cancelBtnClass(): string {
  const q = queue();
  // 취소 버튼 블록 = <Button ... className="..." ... data-testid="docreq-cancel-btn">
  const m = q.match(/className="([^"]*)"\s*\n\s*onClick=\{\(\) => onCancel\(r\)\}/);
  expect(m, '취소 버튼 className 추출 실패').not.toBeNull();
  return m![1];
}

test.describe('T-20260717-foot-CANCELREQ-DASH-BTN-MISALIGN — 요청취소 버튼 정렬 overflow 수정', () => {

  // 회귀 가드: 앱 정상 로드
  test('앱 정상 로드 — HTTP 200', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);
  });

  // ── AC-1: overflow/wrap 해소 — flex 정렬 복원, block 제거 ──────────────────
  test('AC-1: 취소 버튼은 flex 정렬(icon+text 경계 내 중앙정렬) — block 제거', () => {
    const cls = cancelBtnClass();
    // 결함 원인이던 `block`(base inline-flex 덮어씀) 제거.
    expect(cls.split(/\s+/)).not.toContain('block');
    // flex 컨테이너로 base 정렬 복원(전폭 유지).
    expect(cls).toContain('flex');
    expect(cls).toContain('items-center');
    expect(cls).toContain('justify-center');
    expect(cls).toContain('w-full');
  });

  test('AC-1: 고정 높이(h-6) 유지 + leading-none 로 텍스트 세로 overflow 차단', () => {
    const cls = cancelBtnClass();
    expect(cls).toContain('h-6');
    // line-height 팽창으로 h-6 를 넘지 않도록 leading-none.
    expect(cls).toContain('leading-none');
  });

  // ── AC-2: 취소요청 동작 무회귀(로직·핸들러·onClick 미접촉) ─────────────────
  test('AC-2: 취소 핸들러/mutation 경로 무회귀(정렬 CSS 외 미변경)', () => {
    const q = queue();
    // 버튼 식별자·라벨·onClick 경로 보존.
    expect(q).toContain('data-testid="docreq-cancel-btn"');
    expect(q).toContain('요청 취소');
    expect(q).toContain('onClick={() => onCancel(r)}');
    expect(q).toContain('variant="outline"');
    // 확인 다이얼로그 → 기존 mutation 재사용 경로 그대로.
    expect(q).toContain('handleCancelConfirm');
    expect(q).toContain("reason: 'cancelled'");
    expect(q).toContain('resolveMut.mutateAsync');
    // 취소 버튼은 pending 그룹에만(done 미표시) — authoring 경계 유지.
    expect(q).toContain('{onCancel && (');
  });

  // ── AC-3: 형제 '작성하기' 버튼과 정렬 일관 + 기존 surface 회귀 없음 ────────
  test('AC-3: 형제 작성하기 버튼 회귀 없음(flex 정렬 일관 기준)', () => {
    const q = queue();
    expect(q).toContain('data-testid="docreq-write-btn"');
    expect(q).toContain('작성하기');
    // 작성하기 반짝효과 보존.
    expect(q).toContain('animate-ping');
  });

  test('AC-3: TABLEVIEW 9칼럼·완료 그룹 등 기존 surface 회귀 없음', () => {
    const q = queue();
    expect(q).toContain('data-testid="docreq-table"');
    for (const col of ['이름', '생년', '차트번호', '오늘시술', '처방내역', '임상경과', '서류종류', '해당항목', '발행']) {
      expect(q).toContain(col);
    }
    expect(q).toContain('data-testid="docreq-completed-section"');
    expect(q).toContain('data-testid="docreq-done-badge"');
  });
});

/**
 * 현장 렌더 확인 시나리오 (갤탭 실기기 현장 confirm 체크리스트):
 *
 * [시나리오1] 요청취소 버튼 정상 렌더
 *   1. 로그인(원장 계정) → 진료대시보드 → 소견서·진단서 처리대기 목록
 *   2. 각 행 '발행' 컬럼의 '작성하기' 아래 '요청 취소' 버튼 확인
 *   Expected: ⊗ 아이콘 + "요청 취소" 텍스트가 버튼 경계(테두리) 안에 한 줄로 중앙정렬,
 *     overflow/wrap 없음. 형제 '작성하기' 버튼과 정렬·톤 일관.
 *
 * [시나리오2] 주요 뷰포트 레이아웃
 *   1. 태블릿 실사용 폭(갤탭) 포함 주요 뷰포트에서 처리대기 목록 확인
 *   Expected: 버튼·컬럼 레이아웃 깨짐 없음, 취소 버튼 전폭(작성하기 아래) 정상 정렬.
 *
 * [시나리오3] 취소 동작 무회귀
 *   1. '요청 취소' 클릭 → 확인 다이얼로그 → '요청 취소' 확정
 *   Expected: 해당 draft 요청 회수(큐에서 제거) — 기존 동작 그대로.
 *
 * 비고: 순수 FE/CSS(정렬). block → flex 치환으로 shadcn Button base 의 inline-flex 정렬 복원.
 *   DB 변경 0. 취소 로직/핸들러/mutation 미접촉.
 */
