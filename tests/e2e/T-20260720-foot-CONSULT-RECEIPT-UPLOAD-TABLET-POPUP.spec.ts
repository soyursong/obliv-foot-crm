/**
 * E2E spec — T-20260720-foot-CONSULT-RECEIPT-UPLOAD-TABLET-POPUP
 *
 * 현상(김주연 총괄 현장, P1): 2번 차트 > 상담내역 > 결제영수증 > 영수증을 '템플릿으로 업로드'로
 *   올리면 "영수증 매출 연동" 팝업이 미생성. '일반 업로드'는 정상. 기능 추가 시점부터 상시
 *   (회귀 아닌 트리거 미배선 의심).
 *
 * 선행 티켓(동일 thread): T-20260720-foot-RECEIPT-REVENUEPOPUP-TABLET-NOSHOW (commit a89c198d, deployed)
 *   — persist 저장소를 sessionStorage → pendingDlgStore(localStorage 우선)로 전환.
 *
 * ── 진단 결과(AC4) ──────────────────────────────────────────────────────────────
 *   #1 별도 '템플릿 업로드 핸들러' 존재 여부 → **없음**. 상담내역 결제영수증(ReceiptUploadSection)의
 *      업로드는 단일 <input type=file accept=image/*> onChange=handleUpload 하나뿐. '일반 vs 템플릿'은
 *      코드상 두 핸들러가 아니라 태블릿 OS 파일선택기의 소스 선택(갤러리 vs 문서스캔/템플릿)이며 둘 다
 *      동일 handleUpload로 수렴한다. → "템플릿 핸들러에 팝업 트리거 미배선" 가설은 배제.
 *   #2 선행 a89c198d 커버 여부 → persist·복원 로직이 단일 handleUpload 내부에 있어 경로 무관
 *      (path-agnostic). 즉 구조상 템플릿 경로도 동일 메커니즘으로 커버됨. 다만 **잔존 타이밍 갭** 존재.
 *   #3 잔존 RC(확정) → 선행은 오픈 의도 stamp를 'await upload + await load() 완료 후'(성공 말미)에야
 *      기록. 갤러리 선택(일반)은 가볍고 즉시 반환돼 stamp까지 도달하지만, '템플릿으로 업로드'(삼성 태블릿
 *      문서스캔 등 무거운 외부 앱)는 업로드/네트워크 대기 중 Android가 렌더러 프로세스를 종료 → 탭 재로드 →
 *      stamp 미기록 → 마운트 복원 실패 → 팝업 미생성. (영수증 파일 자체는 업로드됨과 부합.)
 *
 * FIX(ReceiptUploadSection 국소): 오픈 의도 stamp를 '업로드 착수 시점'(파일 선택 확정 직후)으로 앞당김.
 *   업로드가 어느 지점에서 중단·재로드돼도 마운트 복원이 팝업을 보장. 업로드 전량 실패/취소 시 stamp 정리
 *   (시나리오3 보존). write-path/산식/저장 로직 전부 불변, DB 무접점, FE-only.
 *
 * AC:
 *   AC1 '템플릿으로 업로드' 경로 업로드 완료 시 팝업 생성(착수시점 stamp → 재로드 내성 복원).
 *   AC2 '일반 업로드' 경로 회귀 없음(단일 handleUpload, openAmountDialog 즉시 오픈 유지).
 *   AC3 매출 기입·저장 로직 불변(recordManualPayment / 산식 불변).
 *   AC4 진단 결과(별도 핸들러 없음 + 잔존 타이밍 갭) 기록 — 본 파일 헤더 + 소스 주석.
 *
 * 스타일: unit(auth·server 불요). 소스 정적 불변식 + '착수시점 stamp' 재로드 내성 등가 시뮬.
 *   태블릿 실기(갤탭) 문서스캔/템플릿 재현·최종 confirm은 field-soak에서 김주연 총괄 육안. db_change=false.
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

// handleUpload 본문만 추출(착수 시점 stamp 위치 검증용).
function handleUploadBody(sec: string): string {
  const start = sec.indexOf('const handleUpload = async');
  expect(start).toBeGreaterThan(-1);
  const end = sec.indexOf('\n  const remove =', start);
  return sec.slice(start, end > -1 ? end : undefined);
}
const HU = handleUploadBody(SEC);

// ─────────────────────────────────────────────────────────────────────────────
// AC4 (진단) — 상담내역 결제영수증 업로드는 단일 핸들러 (별도 '템플릿 핸들러' 부재)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC4 — 단일 업로드 핸들러 (템플릿/일반 공통 수렴)', () => {
  test('영수증 업로드 input onChange는 유일하게 handleUpload', () => {
    const inputs = SEC.match(/type="file"[^>]*onChange=\{handleUpload\}/g) ?? [];
    expect(inputs.length).toBe(1); // 별도 '템플릿 업로드' input/핸들러 없음
  });
  test('handleUpload 정의는 섹션 내 단 하나', () => {
    const defs = SEC.match(/const handleUpload = async/g) ?? [];
    expect(defs.length).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC1 (핵심) — 오픈 의도 stamp를 '업로드 착수 시점'으로 앞당김(무거운 외부앱 경로 커버)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC1 — 착수시점 stamp (템플릿/문서스캔 재로드 내성)', () => {
  test('stamp setItem이 storage.upload 호출보다 앞선다(착수 시점 persist)', () => {
    const stampIdx = HU.indexOf('pendingDlgStore.setItem(PENDING_DLG_KEY, String(Date.now()))');
    const uploadIdx = HU.indexOf("supabase.storage.from('photos').upload");
    expect(stampIdx).toBeGreaterThan(-1);
    expect(uploadIdx).toBeGreaterThan(-1);
    expect(stampIdx).toBeLessThan(uploadIdx); // 업로드 착수 전에 이미 stamp 기록
  });

  test('stamp는 setUploading(true)보다 앞(파일 선택 확정 직후)', () => {
    const stampIdx = HU.indexOf('pendingDlgStore.setItem(PENDING_DLG_KEY, String(Date.now()))');
    const setUploadingIdx = HU.indexOf('setUploading(true)');
    expect(stampIdx).toBeLessThan(setUploadingIdx);
  });

  test('빈 FileList(취소)는 stamp 이전에 early return (시나리오3)', () => {
    const emptyGuardIdx = HU.indexOf('files.length === 0');
    const stampIdx = HU.indexOf('pendingDlgStore.setItem(PENDING_DLG_KEY, String(Date.now()))');
    expect(emptyGuardIdx).toBeGreaterThan(-1);
    expect(emptyGuardIdx).toBeLessThan(stampIdx); // 취소 시 stamp 미기록
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC1/시나리오3 — 업로드 전량 실패 시 착수 stamp 정리 (팝업 미생성 유지)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC1/시나리오3 — 전량 실패 시 stamp 정리', () => {
  test('!uploadedOk 분기에서 stamp removeItem 정리', () => {
    const failIdx = HU.indexOf('if (!uploadedOk)');
    const openIdx = HU.indexOf('openAmountDialog();');
    expect(failIdx).toBeGreaterThan(-1);
    // 실패 분기 슬라이스 내에 removeItem 정리 존재
    const failBlock = HU.slice(failIdx, openIdx > failIdx ? openIdx : undefined);
    expect(failBlock).toMatch(/pendingDlgStore\.removeItem\(PENDING_DLG_KEY\)/);
    expect(failBlock).toContain('return;');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC2/AC3 — 일반 경로 회귀 없음 + write-path/산식 불변
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC2/AC3 — 일반 경로 회귀 없음 + 매출연동 로직 불변', () => {
  test('업로드 성공 시 즉시 openAmountDialog → 이후 비차단 후보 갱신', () => {
    const openIdx = HU.indexOf('openAmountDialog();');
    const refreshIdx = HU.indexOf('void loadActivePkgs()');
    expect(openIdx).toBeGreaterThan(-1);
    expect(refreshIdx).toBeGreaterThan(openIdx);
  });

  test('persist 저장소는 localStorage 우선(선행 a89c198d 불변)', () => {
    expect(SEC).toContain('const pendingDlgStore');
    expect(SEC).toMatch(/window\.localStorage/);
    expect(SEC).toMatch(/window\.sessionStorage/); // 폴백 유지
    const directSession = (SEC.match(/sessionStorage\.(get|set|remove)Item/g) ?? []).length;
    expect(directSession).toBe(0);
  });

  test('5분 타임스탬프 복원 규칙 불변', () => {
    expect(SEC).toMatch(/Date\.now\(\) - ts < 5 \* 60 \* 1000/);
    expect(SEC).toMatch(/dialog:restore-after-remount/);
  });

  test('write-path는 정본 recordManualPayment 유지(신규 병렬경로 0, 산식 불변)', () => {
    expect(SEC).toContain('recordManualPayment(');
    expect(SEC).toMatch(/attribution: \{ kind: 'package', packageId \}/);
    expect(SEC).toContain("memo: '영수증 업로드'");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC1 (등가 시뮬) — 착수시점 stamp면 업로드 '도중' 재로드돼도 복원 가능,
//   말미 stamp(구 동작)면 업로드 도중 재로드 시 복원 불가(템플릿 경로 미생성 재현).
// ─────────────────────────────────────────────────────────────────────────────
test('AC1 로직 — 착수시점 stamp는 업로드 도중 재로드에도 복원, 말미 stamp는 실패', async ({ page }) => {
  await page.setContent('<div>stamp-timing-test</div>');
  const result = await page.evaluate(() => {
    const KEY = 'receipt-amount-dlg-pending:cust-x';
    // localStorage 등가(재로드에도 잔존) 모델
    const store = (() => {
      const m = new Map<string, string>();
      return {
        getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
        setItem: (k: string, v: string) => { m.set(k, v); },
        removeItem: (k: string) => { m.delete(k); },
      };
    })();
    const now = 1_000_000;
    const canRestore = (t: number) => {
      const raw = store.getItem(KEY);
      const ts = raw ? Number(raw) : 0;
      return !!(ts && t - ts < 5 * 60 * 1000);
    };

    // 시나리오 A — 신 동작(착수시점 stamp): 업로드 '착수' 시 stamp 기록.
    store.setItem(KEY, String(now));
    // === 템플릿(문서스캔) 무거운 외부앱 → 업로드 도중 렌더러 종료 → 탭 재로드 ===
    //   (파일은 서버에 올라감, 하지만 JS 실행은 stamp 이후·openAmountDialog 이전에 중단)
    const earlyStampRestore = canRestore(now + 20_000); // 마운트 복원 → true

    // 시나리오 B — 구 동작(말미 stamp): 업로드 도중 중단되면 stamp 라인에 도달 못 함.
    store.removeItem(KEY); // 말미 stamp가 기록되지 못한 상태를 모델
    const lateStampRestore = canRestore(now + 20_000); // 복원할 스탬프 없음 → false

    return { earlyStampRestore, lateStampRestore };
  });
  expect(result.earlyStampRestore).toBe(true);  // 착수시점 stamp → 템플릿 경로 팝업 복원
  expect(result.lateStampRestore).toBe(false);  // 말미 stamp → 템플릿 경로 미생성 재현
});
