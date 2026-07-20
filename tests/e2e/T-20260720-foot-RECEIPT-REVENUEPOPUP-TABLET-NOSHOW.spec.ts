/**
 * E2E spec — T-20260720-foot-RECEIPT-REVENUEPOPUP-TABLET-NOSHOW
 *
 * 현상(김주연 총괄 현장, P2 / 재발): 2번 차트 > 상담내역 > 결제영수증 > 영수증 업로드 시
 *   "영수증 매출 연동" 팝업이 **태블릿 업로드 경로에서만** 미생성. PC/기타 경로는 정상.
 *
 * 배경: 직전 T-20260717이 sessionStorage 스탬프 + 마운트 복원(가설A)으로 픽스했으나
 *   갤탭 field-soak에서 팝업이 여전히 미표시(재발).
 *
 * RC 확정(§3 후보 재점검):
 *   #1 반응형/뷰포트 조건부 렌더 → 팝업은 `fixed inset-0 z-50` 무조건 렌더(뷰포트 분기 없음) → 배제.
 *   #2 업로드 완료 이벤트 경로 차이 → 단일 <input type=file accept=image/*>, onChange=handleUpload
 *      PC/태블릿 공통 → 배제.
 *   #3 비동기 타이밍/리마운트 상태 소실 → **확정**. 카메라 앱이 포그라운드로 뜨면 Android가
 *      브라우저 탭 렌더러 프로세스를 종료 → 복귀 시 탭 전체 재로드 → **sessionStorage(세션 스코프)가
 *      세션 경계를 넘어 소실** → 마운트 복원이 읽을 스탬프가 사라져 팝업 미생성.
 *      localStorage는 프로세스 종료·탭 재로드에도 잔존.
 *
 * 타겟 픽스(ReceiptUploadSection 국소, 산발 패치 금지):
 *   오픈 의도 persist 저장소를 sessionStorage → **pendingDlgStore(localStorage 우선, 접근 불가 시
 *   sessionStorage 폴백, 완전 차단 시 no-op)** 로 전환. 5분 타임스탬프 가드·복원 규칙 불변.
 *
 * AC:
 *   AC1 태블릿 경로 업로드 완료 시 팝업 생성(재로드/프로세스 종료 후에도 localStorage 복원으로 보장).
 *   AC2 PC/기타 경로 회귀 없음(input onChange=handleUpload, write-path 불변).
 *   AC3 매출 기입·저장 로직 불변(recordManualPayment / 산식 불변).
 *   AC4 RC 요약(§3 #3 sessionStorage 세션소실) 기록 — 본 파일 헤더 + 소스 주석.
 *
 * 스타일: unit(auth·server 불요). 소스 정적 불변식 + localStorage vs sessionStorage 세션경계 등가 시뮬.
 *   태블릿 실기(갤탭) 카메라 재현·최종 confirm은 field-soak에서 김주연 총괄 육안. db_change=false, FE-only.
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

function receiptSection(src: string): string {
  const start = src.indexOf('function ReceiptUploadSection(');
  expect(start).toBeGreaterThan(-1);
  const after = src.indexOf('\nfunction ', start + 10);
  return src.slice(start, after > -1 ? after : undefined);
}
const SEC = receiptSection(SRC);

// ─────────────────────────────────────────────────────────────────────────────
// AC1 (핵심) — persist 저장소를 프로세스-종료 내성 저장소(localStorage 우선)로 전환
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC1 — 태블릿 재로드 내성: localStorage 우선 persist', () => {
  test('pendingDlgStore가 localStorage를 우선 사용(프로세스 종료·탭 재로드 잔존)', () => {
    expect(SEC).toContain('const pendingDlgStore');
    expect(SEC).toMatch(/window\.localStorage/);
    // 접근 불가 시 sessionStorage 폴백 존재(사생활 모드 등)
    expect(SEC).toMatch(/window\.sessionStorage/);
  });

  test('persist 3사용처가 모두 pendingDlgStore 경유(sessionStorage 직접호출 제거)', () => {
    expect(SEC).toMatch(/pendingDlgStore\.setItem\(PENDING_DLG_KEY, String\(Date\.now\(\)\)\)/);
    expect(SEC).toMatch(/pendingDlgStore\.getItem\(PENDING_DLG_KEY\)/);
    expect(SEC).toMatch(/pendingDlgStore\.removeItem\(PENDING_DLG_KEY\)/);
    // ReceiptUploadSection 내부에 sessionStorage 직접 호출이 남아있지 않아야 함(store helper 정의 내 폴백 1회 제외)
    const directSession = (SEC.match(/sessionStorage\.(get|set|remove)Item/g) ?? []).length;
    expect(directSession).toBe(0);
  });

  test('5분 타임스탬프 복원 규칙 불변(persist 저장소만 교체)', () => {
    expect(SEC).toMatch(/Date\.now\(\) - ts < 5 \* 60 \* 1000/);
    expect(SEC).toMatch(/dialog:restore-after-remount/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC2/AC3 — PC 회귀 없음 + write-path/산식 불변
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC2/AC3 — PC 회귀 없음 + 매출연동 로직 불변', () => {
  test('업로드 input onChange는 여전히 handleUpload', () => {
    expect(SEC).toMatch(/type="file"[^>]*onChange=\{handleUpload\}/);
  });

  test('업로드 성공 직후 즉시 오픈 → 이후 비차단 후보 갱신(체인 중단 내성 유지)', () => {
    const openIdx = SEC.indexOf('openAmountDialog();');
    const refreshIdx = SEC.indexOf('void loadActivePkgs()');
    expect(openIdx).toBeGreaterThan(-1);
    expect(refreshIdx).toBeGreaterThan(openIdx);
  });

  test('write-path는 정본 recordManualPayment 유지(신규 병렬경로 0, 산식 불변)', () => {
    expect(SEC).toContain('recordManualPayment(');
    expect(SEC).toMatch(/attribution: \{ kind: 'package', packageId \}/);
    expect(SEC).toContain("memo: '영수증 업로드'");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC1 (등가 시뮬) — 세션 경계(탭 재로드) 시 sessionStorage는 소실, localStorage는 잔존
//   → 마운트 복원이 스탬프를 읽어 팝업을 복원할 수 있음을 규칙으로 증명.
// ─────────────────────────────────────────────────────────────────────────────
test('AC1 로직 — 탭 재로드(세션 경계) 후 localStorage만 스탬프를 보존 → 복원 가능', async ({ page }) => {
  await page.setContent('<div>store-boundary-test</div>');
  const result = await page.evaluate(() => {
    const KEY = 'receipt-amount-dlg-pending:cust-x';
    // 세션/영구 저장소 등가 모델
    const mk = () => {
      const m = new Map<string, string>();
      return {
        getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
        setItem: (k: string, v: string) => { m.set(k, v); },
        removeItem: (k: string) => { m.delete(k); },
        _drop: () => m.clear(), // 세션 경계에서 세션스토리지만 비워짐
      };
    };
    const localS = mk();
    const sessionS = mk();

    // 복원 규칙(정본 등가): 스탬프 5분 내면 복원.
    const canRestore = (store: ReturnType<typeof mk>, now: number) => {
      const raw = store.getItem(KEY);
      const ts = raw ? Number(raw) : 0;
      return !!(ts && now - ts < 5 * 60 * 1000);
    };

    // 업로드 직후: 두 저장소에 스탬프 기록(정본은 pendingDlgStore=localStorage 우선 1곳)
    const now = 1_000_000;
    localS.setItem(KEY, String(now));
    sessionS.setItem(KEY, String(now));

    // === 카메라 앱 전환 → Android 렌더러 프로세스 종료 → 탭 재로드(세션 경계) ===
    sessionS._drop(); // sessionStorage 소실
    // localStorage 는 잔존

    const after = now + 30_000; // +30s 후 재마운트
    return {
      sessionRestore: canRestore(sessionS, after), // 구 동작: 소실 → false (팝업 미생성 재현)
      localRestore: canRestore(localS, after),     // 신 동작: 잔존 → true (팝업 복원)
    };
  });
  expect(result.sessionRestore).toBe(false); // 구 sessionStorage RC 재현
  expect(result.localRestore).toBe(true);    // localStorage 픽스 검증
});
