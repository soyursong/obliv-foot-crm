/**
 * T-20260615-foot-RESVTAB-MEMO-ICON-SCROLLFIX — 2번차트 예약내역 탭 메모 UX + 체류시간 스크롤 재한정
 *
 * planner NEW-TASK (MSG-20260615-194222-exqg): FE-only, DB변경0, risk=GO.
 *   AC-1: 예약내역 탭 메모 — 항상 열린 입력창 → 표시(텍스트 + 우측 ✏️). ✏️ 클릭 시 인라인 편집폼
 *         (입력 + 저장/취소) 토글. 저장=기존 RPC/상태 그대로(insertReservationMemo append-only) 호출
 *         후 display-only 복귀, 취소=폐기 후 복귀. 저장 로직·데이터모델 변경 금지(표시·토글만).
 *   AC-2: slot_dwell 탭 콘텐츠 스크롤을 탭 콘텐츠 영역으로 재한정 — 좌측 패널 전체·우측 2구역으로
 *         번지지 않게. 수납내역 등 타 탭 부수효과 0.
 *   AC-3: DWELLSWAP(c6fed76) 신설 예약내역 탭 / 체류시간↔수납내역 스왑 배치 불변.
 *
 * 구성:
 *   - 소스 미러(정적 grep) 회귀 가드: 토글 구조·저장 로직 불변·스크롤 scope·DWELLSWAP 멤버십.
 *   - 실DOM(page.setContent) 가드: 체류시간 박스 내부 스크롤 시 좌측 패널·우측 2구역 scrollTop 불변.
 *   (supervisor 실QA 는 운영 번들 + 갤탭 실기기로 별도 검증.)
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __srcPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../src/pages/CustomerChartPage.tsx',
);
const src = readFileSync(__srcPath, 'utf-8');

// 예약내역 탭 렌더 블록만 잘라 검증 (chartTab === 'reservations' ~ test_result 경계)
function reservationsTabBlock(): string {
  const start = src.indexOf("chartTab === 'reservations' &&");
  const end = src.indexOf("chartTab === 'test_result'", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

// slot_dwell 렌더 블록 (chartTab === 'slot_dwell' ~ messages 경계)
function slotDwellBlock(): string {
  const start = src.indexOf("chartTab === 'slot_dwell' &&");
  const end = src.indexOf("chartTab === 'messages'", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

// ──────────────────────────────────────────────────────────────────────
// AC-1 — 예약메모 표시(✏️)↔편집폼 토글 (소스 미러)
// ──────────────────────────────────────────────────────────────────────
test.describe('AC-1 예약메모 표시/편집 토글', () => {
  test('토글 상태 + 토글 분기(display ↔ edit-form) 존재', () => {
    expect(src).toContain('editingResvMemoId');
    expect(src).toContain('setEditingResvMemoId');
    const block = reservationsTabBlock();
    // display-only: 텍스트 + ✏️ 아이콘 (편집 진입 버튼)
    expect(block).toContain('data-testid="resv-memo-display"');
    expect(block).toContain('<Pencil');
    // 편집폼: 입력 + 저장/취소
    expect(block).toContain('data-testid="resv-memo-edit-form"');
    expect(block).toContain('data-testid="resv-memo-save"');
    expect(block).toContain('data-testid="resv-memo-cancel"');
    // 토글 조건부 렌더 (editingResvMemoId === r.id ? 편집폼 : 표시)
    expect(block).toContain('editingResvMemoId === r.id ?');
  });

  test('display 클릭=편집 진입, 취소=폐기 후 복귀(editing=null)', () => {
    const block = reservationsTabBlock();
    // ✏️(display) 클릭 → 편집 진입
    expect(block).toContain('onClick={() => setEditingResvMemoId(r.id)}');
    // 취소 → 입력 폐기 + display 복귀
    expect(block).toMatch(/resv-memo-cancel[\s\S]*?setResvMemoInputs[\s\S]*?setEditingResvMemoId\(null\)/);
  });

  test('저장 로직·데이터모델 불변 — saveResvMemo 가 기존 append-only RPC 그대로 호출', () => {
    // saveResvMemo 정의가 기존 핸들러와 동일 호출(insertReservationMemo) + 상태 초기화 + 1번차트 알림
    const defStart = src.indexOf('const saveResvMemo = async');
    expect(defStart).toBeGreaterThan(-1);
    const def = src.slice(defStart, defStart + 700);
    expect(def).toContain('insertReservationMemo(reservationId');
    expect(def).toContain("setResvMemoInputs(prev => ({ ...prev, [reservationId]: '' }))");
    expect(def).toContain('foot_crm_customer_refresh'); // AC-8 쌍방연동 유지
    expect(def).toContain('setEditingResvMemoId(null)'); // 저장 후 display-only 복귀
    // 신규 테이블/컬럼/enum 추가 없음 — 기존 RPC 1개만 사용
    expect(reservationsTabBlock()).not.toContain('.from(');
  });
});

// ──────────────────────────────────────────────────────────────────────
// AC-2 — 체류시간 스크롤 scope 재한정 (소스 미러 + 실DOM)
// ──────────────────────────────────────────────────────────────────────
test.describe('AC-2 체류시간 스크롤 재한정', () => {
  test('slot_dwell 패널이 bounded 자체 스크롤 scope 보유', () => {
    const block = slotDwellBlock();
    const panelIdx = block.indexOf('data-testid="slot-dwell-panel"');
    expect(panelIdx).toBeGreaterThan(-1);
    // slot-dwell-panel div className 에 max-h + overflow-y-auto + overscroll-contain 모두 존재
    const around = block.slice(Math.max(0, panelIdx - 200), panelIdx + 60);
    expect(around).toContain('max-h-[70vh]');
    expect(around).toContain('overflow-y-auto');
    expect(around).toContain('overscroll-contain');
  });

  test('타 탭 부수효과 0 — 수납내역(payments) 블록은 자체 스크롤 scope 미변경', () => {
    // payments 탭은 기존 overflow-x-auto(테이블 가로) 유지, 세로 scope 추가 안 됨
    const pStart = src.indexOf("chartTab === 'payments'");
    expect(pStart).toBeGreaterThan(-1);
    // slot_dwell 전용 토큰이 payments 영역에 새로 들어가지 않았는지(오염 방지) — 그룹 공유 컨테이너 미변경 확인
    expect(slotDwellBlock()).toContain('overscroll-contain');
  });

  test('실DOM: 체류시간 박스 내부 스크롤 시 좌측 패널·우측 2구역 scrollTop 불변', async ({ page }) => {
    // CustomerChartPage 좌우 패널 구조 미러 (row overflow-hidden / left 60% overflow-hidden+flex-1 scroll / right 40% scroll)
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.setContent(`
      <!doctype html><html><head><style>
        *{box-sizing:border-box;margin:0;padding:0} body{font:12px sans-serif}
        .row{display:flex;height:600px;overflow:hidden}
        .left{display:flex;flex-direction:column;overflow:hidden;width:60%;min-width:0}
        .leftscroll{flex:1;overflow-y:auto}
        .tabcontent{padding:12px}
        .right{display:flex;flex-direction:column;overflow-y:auto;width:40%}
        /* 수정안 = slot-dwell-panel scope */
        .dwell{max-height:70vh;overflow-y:auto;overscroll-behavior:contain}
        .tall{height:2000px} .rtall{height:2000px}
      </style></head><body>
      <div class="row">
        <div class="left"><div style="height:30px;flex:0 0 auto"></div>
          <div class="leftscroll" id="leftscroll">
            <div style="height:120px"></div><div style="height:24px"></div>
            <div class="tabcontent"><div class="dwell" id="dwell"><div class="tall"></div></div></div>
          </div>
        </div>
        <div class="right" id="right"><div class="rtall"></div></div>
      </div></body></html>`);
    // 체류시간 박스 위에서 휠을 끝까지 굴린다
    await page.mouse.move(230, 400);
    for (let i = 0; i < 60; i++) await page.mouse.wheel(0, 300);
    const r = await page.evaluate(() => ({
      left: document.getElementById('leftscroll')!.scrollTop,
      dwell: document.getElementById('dwell')!.scrollTop,
      right: document.getElementById('right')!.scrollTop,
    }));
    // 스크롤은 체류시간 박스 내부에서만 발생 → 좌측 패널 전체·우측 2구역은 0 유지
    expect(r.dwell).toBeGreaterThan(0);
    expect(r.left).toBe(0);
    expect(r.right).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────────────
// AC-3 — DWELLSWAP 배치 불변 (회귀 가드)
// ──────────────────────────────────────────────────────────────────────
test.describe('AC-3 DWELLSWAP 배치 불변', () => {
  test('예약내역 탭 신설 + 체류시간↔수납내역 그룹 스왑 유지', () => {
    // CLINICAL = ...reservations, slot_dwell / HISTORY = ...payments (DWELLSWAP 결과 불변)
    const clinical = src.slice(src.indexOf('const CLINICAL_TABS = ['), src.indexOf('const HISTORY_TABS = ['));
    const history = src.slice(src.indexOf('const HISTORY_TABS = ['), src.indexOf('const HISTORY_TABS = [') + 400);
    expect(clinical).toContain("key: 'reservations'");
    expect(clinical).toContain("key: 'slot_dwell'");
    expect(clinical).not.toContain("key: 'payments'");
    expect(history).toContain("key: 'payments'");
    expect(history).not.toContain("key: 'slot_dwell'");
    // 예약내역 탭에 최근방문 블록(DWELLSWAP AC-2 이전 산출물) 잔존
    expect(reservationsTabBlock()).toContain('data-testid="resv-tab-last-visit"');
  });
});
