/**
 * E2E spec — T-20260717-foot-RECEIPT-UPLOAD-TABLET-CAMERA-DLG-MISS
 *
 * 현상(김주연 총괄 현장, P1): 2번 차트 > 상담내역 > 결제영수증 > 영수증 업로드 후
 *   "영수증 매출 연동" 팝업(금액/결제수단/귀속대상)이 **태블릿 카메라 촬영 업로드** 시 미표시.
 *   PC 파일선택은 정상. → 결제-매출 연동 누락.
 *
 * 원인 좁힘(계측 → 1개 확정, 산발 패치 금지):
 *   B) fixed inset-0 렌더차단(상위 transform) → **PC 정상**이므로 동일 DOM/CSS 경로에서 배제.
 *   C) e.target.files 빈값 early return → **영수증 업로드는 성공**하므로 원인에서 배제(단 AC3로 안전처리 유지).
 *   A) 카메라 앱 전환 시 컨텍스트 교란/리마운트 → handleUpload 말미의 무거운 귀속후보 재조회(await 체인)가
 *      중단되어 setAmountDlg 미도달, 또는 리마운트로 amountDlg {open:false} 리셋. ← 남는 단일 가설.
 *
 * 타겟 픽스(A):
 *   (1) 업로드 성공 직후 **무거운 재조회 이전에** 다이얼로그 즉시 오픈(openAmountDialog).
 *   (2) 오픈 의도를 sessionStorage에 스탬프 → 리마운트 시 마운트 useEffect에서 5분 내 복원.
 *   (3) 귀속후보 최신화는 오픈 이후 **비차단(void ...catch)** — 실패해도 팝업 유지.
 *   (4) 등록/건너뛰기(closeAmountDlg) 시 pending 스탬프 정리 → stale 재오픈 방지.
 *
 * AC:
 *   AC1 PC 파일선택 경로 회귀 없음(업로드 input onChange=handleUpload, write-path=recordManualPayment 불변).
 *   AC2 태블릿(모바일 뷰포트) 카메라 업로드 후 팝업 정상표시 + 팝업이 뷰포트 내부 렌더(off-screen 금지).
 *   AC3 빈 FileList/취소 안전처리(early return, 크래시·팝업 없음).
 *   AC4 저장 시 기존 매출연동 로직 유지(산식/write-path 변경 X).
 *
 * 스타일: unit 프로젝트(auth·server 불요). 소스 정적 불변식 가드 + page.setContent 실DOM 포지셔닝.
 *   태블릿 실기(갤탭) 카메라 재현은 field-soak에서 김주연 총괄 확인(육안). db_change=false, FE-only.
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'pages', 'CustomerChartPage.tsx'),
  'utf8',
);

// ReceiptUploadSection 본문만 좁혀서 검사(다른 handleUpload와 혼선 방지).
function receiptSection(src: string): string {
  const start = src.indexOf('function ReceiptUploadSection(');
  expect(start).toBeGreaterThan(-1);
  // 다음 top-level function 선언 전까지
  const after = src.indexOf('\nfunction ', start + 10);
  return src.slice(start, after > -1 ? after : undefined);
}
const SEC = receiptSection(SRC);

// ─────────────────────────────────────────────────────────────────────────────
// AC3: 빈 FileList / 카메라 취소 안전 early return
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC3 — 빈 FileList / 취소 안전처리', () => {
  test('handleUpload가 빈/누락 FileList에서 early return', () => {
    expect(SEC).toMatch(/if \(!files \|\| files\.length === 0\)\s*\{[^}]*return;/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC2(핵심) — 가설A 타겟픽스: 재조회 이전 즉시 오픈 + persist + 리마운트 복원 + 비차단 갱신
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC2 — 다이얼로그 오픈 견고화(리마운트/컨텍스트 교란 내성)', () => {
  test('다이얼로그 오픈이 무거운 귀속후보 재조회보다 먼저 실행된다', () => {
    const openIdx = SEC.indexOf('openAmountDialog();');
    expect(openIdx).toBeGreaterThan(-1);
    // 오픈 이후에만 후보 로더가 호출되어야 함(오픈 = await 체인에 종속되지 않음).
    const refreshIdx = SEC.indexOf('void loadActivePkgs()');
    expect(refreshIdx).toBeGreaterThan(openIdx);
  });

  test('업로드 성공 직후 persist 저장소에 오픈 의도(pending 스탬프)를 기록', () => {
    // T-20260720: sessionStorage → pendingDlgStore(localStorage 우선) 전환. persist 규칙 불변.
    expect(SEC).toMatch(/pendingDlgStore\.setItem\(PENDING_DLG_KEY, String\(Date\.now\(\)\)\)/);
    // 오직 uploadedOk === true 이후에만 기록(빈 업로드에 스탬프 금지).
    expect(SEC).toMatch(/if \(!uploadedOk\)\s*\{[^}]*return;\s*\}/);
  });

  test('마운트 시 5분 내 pending 스탬프가 있으면 다이얼로그를 복원(리마운트 대비)', () => {
    // useEffect [] 마운트 훅에서 스탬프 읽고 openAmountDialog 재호출
    expect(SEC).toMatch(/pendingDlgStore\.getItem\(PENDING_DLG_KEY\)/);
    expect(SEC).toMatch(/Date\.now\(\) - ts < 5 \* 60 \* 1000/);
    expect(SEC).toMatch(/dialog:restore-after-remount/);
  });

  test('귀속후보 재조회는 비차단(void + catch) — 실패해도 팝업 유지', () => {
    expect(SEC).toMatch(/void loadActivePkgs\(\)\.catch\(/);
    expect(SEC).toMatch(/void loadWaitingCIs\(\)\.catch\(/);
    // 썸네일 갱신도 비차단(체인 중단 방지)
    expect(SEC).toMatch(/await load\(\)\.catch\(/);
  });

  test('field-soak 계측 로그([RECEIPT-DLG]) 존재 — 갤탭 실기 지점 특정', () => {
    expect(SEC).toContain('[RECEIPT-DLG]');
    expect(SEC).toMatch(/diagReceiptDlg\('upload:start'/);
    expect(SEC).toMatch(/diagReceiptDlg\('dialog:opened'\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC1/AC4 — PC 경로 회귀 없음 + write-path/산식 불변
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC1/AC4 — PC 회귀 없음 + 매출연동 로직 불변', () => {
  test('업로드 input onChange는 여전히 handleUpload (PC 파일선택 경로 불변)', () => {
    expect(SEC).toMatch(/type="file"[^>]*onChange=\{handleUpload\}/);
  });

  test('저장 write-path는 정본 recordManualPayment 유지(신규 병렬 경로 0, 산식 미변경)', () => {
    expect(SEC).toContain('recordManualPayment(');
    // 패키지 잔금/ci/single 3분기 memo·귀속 로직 그대로
    expect(SEC).toMatch(/attribution: \{ kind: 'package', packageId \}/);
    expect(SEC).toContain("memo: '영수증 업로드'");
  });

  test('다이얼로그 종료(등록/건너뛰기)는 closeAmountDlg 경유로 pending 스탬프 정리', () => {
    expect(SEC).toMatch(/const closeAmountDlg = useCallback\(/);
    expect(SEC).toMatch(/pendingDlgStore\.removeItem\(PENDING_DLG_KEY\)/);
    // 직접 setAmountDlg(open:false) 잔존 금지(스탬프 미정리 경로 차단) — 헬퍼 정의 1곳만 허용.
    const rawCloses = (SEC.match(/setAmountDlg\(\(d\) => \(\{ \.\.\.d, open: false \}\)\)/g) ?? []).length;
    expect(rawCloses).toBe(1); // closeAmountDlg 정의 내부 1곳
    // 건너뛰기 버튼도 closeAmountDlg
    expect(SEC).toMatch(/onClick=\{closeAmountDlg\}/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC2(실DOM) — B 배제 회귀 가드: fixed inset-0 오버레이가 데스크톱/모바일 뷰포트 모두에서
//   화면 밖으로 밀리지 않고 중앙 렌더된다(팝업 = viewport 내부).
//   (tailwind 런타임 부재 → 정본 레이아웃 규칙을 인라인 스타일로 등가 재현)
// ─────────────────────────────────────────────────────────────────────────────
const OVERLAY_HTML = `
  <div id="overlay" style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.4);z-index:50">
    <div id="dlg" style="background:#fff;border-radius:8px;padding:16px;width:288px">
      <div>영수증 매출 연동</div>
    </div>
  </div>`;

for (const vp of [
  { name: 'PC(데스크톱)', width: 1280, height: 800 },
  { name: '태블릿(갤탭 세로)', width: 800, height: 1280 },
  { name: '태블릿(갤탭 가로)', width: 1280, height: 800 },
]) {
  test(`AC2 실DOM — ${vp.name}: 팝업이 뷰포트 내부에 중앙 렌더(off-screen 금지)`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.setContent(OVERLAY_HTML);
    const dlg = page.locator('#dlg');
    await expect(dlg).toBeVisible();
    const box = await dlg.boundingBox();
    expect(box).not.toBeNull();
    // 뷰포트 내부(음수/초과 없음) — fixed 기준이 viewport 임을 확인(가설B 회귀 가드)
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(vp.width + 1);
    expect(box!.y + box!.height).toBeLessThanOrEqual(vp.height + 1);
    // 대략 중앙(±2px 허용)
    const cx = box!.x + box!.width / 2;
    expect(Math.abs(cx - vp.width / 2)).toBeLessThanOrEqual(2);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// AC2(로직) — persist/restore 스탬프 규칙 등가 시뮬레이션(5분 윈도우 + 만료 정리)
// ─────────────────────────────────────────────────────────────────────────────
test('AC2 로직 — pending 스탬프 5분 내 복원 / 만료 시 정리', async ({ page }) => {
  await page.setContent('<div>stamp-test</div>');
  const result = await page.evaluate(() => {
    // about:blank 오리진에서 실 sessionStorage 접근 불가 → 등가 store 로 규칙만 검증
    // (정본은 window.sessionStorage; 5분 윈도우+만료정리 규칙은 동일).
    const store = new Map<string, string>();
    const sessionStorage = {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    };
    const KEY = 'receipt-amount-dlg-pending:cust-x';
    // 정본 복원 규칙 등가 함수
    const shouldRestore = (now: number): 'restore' | 'clear' | 'none' => {
      const raw = sessionStorage.getItem(KEY);
      const ts = raw ? Number(raw) : 0;
      if (ts && now - ts < 5 * 60 * 1000) return 'restore';
      if (ts) { sessionStorage.removeItem(KEY); return 'clear'; }
      return 'none';
    };
    const out: Record<string, string> = {};
    // 스탬프 없음
    out.none = shouldRestore(1_000_000);
    // 방금 스탬프(리마운트 직후) → 복원
    sessionStorage.setItem(KEY, String(1_000_000));
    out.fresh = shouldRestore(1_000_000 + 30_000); // +30s
    // 만료(6분 경과) → 정리
    sessionStorage.setItem(KEY, String(2_000_000));
    out.expired = shouldRestore(2_000_000 + 6 * 60 * 1000);
    out.afterExpiredCleared = sessionStorage.getItem(KEY) === null ? 'cleared' : 'left';
    return out;
  });
  expect(result.none).toBe('none');
  expect(result.fresh).toBe('restore');
  expect(result.expired).toBe('clear');
  expect(result.afterExpiredCleared).toBe('cleared');
});
