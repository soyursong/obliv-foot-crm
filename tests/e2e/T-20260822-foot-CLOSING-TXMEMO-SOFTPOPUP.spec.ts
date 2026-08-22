/**
 * E2E spec — T-20260822-foot-CLOSING-TXMEMO-SOFTPOPUP
 *
 * 회차 차감 버튼 클릭 시 당일 특이사항(치료메모) 미입력이면 노출하는 **소프트 팝업(비강제)**.
 * 부모 T-20260822-foot-CLOSING-TXMEMO-MISSING-ALERT 의 AC3(기능A) 를 (b)분리한 후속.
 * 김주연 총괄 fuller-spec(k3tm) → planner FOLLOWUP(MSG-20260822-122604-agmq) 판정 v2 반영:
 *   [1] 착지 site 4곳 = CheckInDetailSheet::SessionUseInSheetDialog / Packages::UseSessionDialog /
 *       CustomerChartPage::saveC22Deduct / CustomerChartPage::saveUseSession(UseSessionDialog).
 *   [2] money-path gap = 제안(절충·AC4 준수·write-path 0)안 채택 / (b)inline-write REJECT.
 *
 * 검증 대상(AC v2):
 *   AC1 (소프트 팝업 노출)  — 4곳 차감 핸들러가 hasTodayTreatmentMemo(read-only) 판정 후 미입력이면 팝업.
 *   AC2 (분기 동작)        — CustomerChartPage=[지금 쓸게요](in-place composer 포커스) /
 *                            CheckInDetail·Packages=[입력하러 가기](/chart 이동, 차감 없이) / 공통 [나중에]=차감.
 *   AC3 (비강제·무회귀)     — onLater 는 항상 performConsume/proceed(원 consume 흐름)를 재개. hard-block 0.
 *   AC4 (범위·write-path 0) — txMemoGate 는 SELECT(존재여부 count)만. INSERT/UPDATE/UPSERT/DELETE 신설 0.
 *
 * 스타일: 정본 소스 정적 가드(readFileSync) + 판정 헬퍼 로직 1:1 모사. auth/DB 비의존 순수 검증
 *   (money-adjacent 변경이라 실 consume 미호출 = 무회귀 안전. 부모 티켓 컨벤션 정합).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const GATE_LIB = 'src/lib/txMemoGate.ts';
const POPUP = 'src/components/TxMemoSoftPopup.tsx';
const CHECKIN = 'src/components/CheckInDetailSheet.tsx';
const PACKAGES = 'src/pages/Packages.tsx';
const CHART = 'src/pages/CustomerChartPage.tsx';

// ── 정본 모사: hasTodayTreatmentMemo 판정 로직 (txMemoGate.ts) ─────────────────
//   fail-open: customerId 부재 / 조회 오류 → true(=존재 간주) 로 팝업 억제(무회귀 우선).
function mirrorHasTodayTreatmentMemo(
  customerId: string | null | undefined,
  count: number | null,
  error: boolean,
): boolean {
  if (!customerId) return true;
  if (error) return true;
  return (count ?? 0) > 0;
}

test.describe('AC0/AC4 — 판정 헬퍼 read-only·fail-open (txMemoGate.ts)', () => {
  test('S1 — canonical 소스=customer_treatment_memos 존재여부만 read(count/head)', () => {
    const src = read(GATE_LIB);
    expect(src).toContain("from('customer_treatment_memos')");
    // 존재여부 판정 = count exact + head(내용 미read).
    expect(src).toMatch(/count:\s*'exact'/);
    expect(src).toMatch(/head:\s*true/);
    // memo_type 판정범위 상수 = [치료메모, 특이사항] (진료메모=의사측 제외).
    expect(src).toMatch(/TXMEMO_GATE_MEMO_TYPES\s*=\s*\[\s*'치료메모',\s*'특이사항'\s*\]/);
    // 판정 상수 배열에 진료메모(의사측) 미포함.
    expect(src).not.toMatch(/TXMEMO_GATE_MEMO_TYPES\s*=\s*\[[^\]]*진료메모/);
  });

  test('S2 — AC4 write-path 0: INSERT/UPDATE/UPSERT/DELETE 신설 없음', () => {
    const src = read(GATE_LIB);
    expect(src).not.toMatch(/\.insert\(/);
    expect(src).not.toMatch(/\.update\(/);
    expect(src).not.toMatch(/\.upsert\(/);
    expect(src).not.toMatch(/\.delete\(/);
    // read-only = SELECT 만.
    expect(src).toMatch(/\.select\(/);
  });

  test('S3 — fail-open: customerId 부재/조회 오류 = 팝업 억제(무회귀 우선)', () => {
    // customerId 부재 → true(팝업 억제).
    expect(mirrorHasTodayTreatmentMemo(null, 0, false)).toBe(true);
    expect(mirrorHasTodayTreatmentMemo(undefined, 0, false)).toBe(true);
    // 조회 오류 → true(팝업 억제).
    expect(mirrorHasTodayTreatmentMemo('c1', null, true)).toBe(true);
    // 정상 + 메모 있음 → true(팝업 미노출).
    expect(mirrorHasTodayTreatmentMemo('c1', 2, false)).toBe(true);
    // 정상 + 메모 없음 → false(팝업 노출).
    expect(mirrorHasTodayTreatmentMemo('c1', 0, false)).toBe(false);
    expect(mirrorHasTodayTreatmentMemo('c1', null, false)).toBe(false);
  });

  test('S4 — 소스 가드: fail-open 주석·조기반환 배선 존재', () => {
    const src = read(GATE_LIB);
    // customerId 부재 조기반환.
    expect(src).toMatch(/if\s*\(!customerId\)\s*return true/);
    // error 조기반환.
    expect(src).toMatch(/if\s*\(error\)\s*return true/);
  });
});

test.describe('AC1/AC2/AC3 — 소프트 팝업 컴포넌트 (TxMemoSoftPopup.tsx)', () => {
  test('S5 — 비강제 3버튼 계약: primaryLabel/onPrimary/onLater props', () => {
    const src = read(POPUP);
    expect(src).toContain('primaryLabel');
    expect(src).toContain('onPrimary');
    expect(src).toContain('onLater');
    // [나중에] 버튼 = onLater 배선.
    expect(src).toMatch(/onClick=\{onLater\}/);
    // primary 버튼 = onPrimary 배선 + 동적 라벨.
    expect(src).toMatch(/onClick=\{onPrimary\}/);
    expect(src).toContain('{primaryLabel}');
  });

  test('S6 — 문구: "특이사항이 없어요 / 지금 입력할까요?" + [나중에] 라벨', () => {
    const src = read(POPUP);
    expect(src).toContain('특이사항이 없어요');
    expect(src).toContain('지금 입력할까요');
    expect(src).toContain('나중에');
  });

  test('S7 — 태블릿 UX: 큰 버튼(h-12)', () => {
    const src = read(POPUP);
    expect(src).toMatch(/h-12/);
  });

  test('S8 — hard-block 부재: 팝업 자체에 consume/강제저장 로직 없음', () => {
    const src = read(POPUP);
    expect(src).not.toContain('consume_one_session');
    expect(src).not.toContain('consumeOneSession');
    expect(src).not.toMatch(/\.insert\(/);
  });
});

test.describe('AC1/AC2/AC3 — CheckInDetailSheet::SessionUseInSheetDialog (site 1)', () => {
  const src = read(CHECKIN);
  test('S9 — 차감 전 판정: save() 가 hasTodayTreatmentMemo 후 미입력이면 팝업', () => {
    expect(src).toContain("import { hasTodayTreatmentMemo }");
    expect(src).toContain('TxMemoSoftPopup');
    // save 에서 판정 → 미입력 시 setMemoPopupOpen(true) + return(차감 보류), 존재 시 performConsume.
    expect(src).toMatch(/const hasMemo = await hasTodayTreatmentMemo\(/);
    expect(src).toMatch(/if\s*\(!hasMemo\)\s*\{\s*setMemoPopupOpen\(true\);\s*return;/);
  });
  test('S10 — AC2: primaryLabel="입력하러 가기" + onPrimary=차감없이 chart 이동', () => {
    expect(src).toMatch(/primaryLabel="입력하러 가기"/);
    // onPrimary = openChartNo(차트 이동), performConsume 미호출.
    expect(src).toMatch(/onPrimary=\{[^}]*openChartNo\(/);
  });
  test('S11 — AC3: onLater=performConsume(원 consume 흐름 재개, 무회귀)', () => {
    expect(src).toMatch(/onLater=\{[^}]*performConsume\(\)/);
    // performConsume 는 기존 consume 로직(consumeOneSession)을 그대로 보유.
    expect(src).toMatch(/const performConsume = async/);
  });
});

test.describe('AC1/AC2/AC3 — Packages::UseSessionDialog (site 2)', () => {
  const src = read(PACKAGES);
  test('S12 — 차감 전 판정 + performConsume 분리', () => {
    expect(src).toContain("import { hasTodayTreatmentMemo }");
    expect(src).toContain('TxMemoSoftPopup');
    expect(src).toMatch(/const hasMemo = await hasTodayTreatmentMemo\(/);
    expect(src).toMatch(/if\s*\(!hasMemo\)\s*\{\s*setMemoPopupOpen\(true\);\s*return;/);
    expect(src).toMatch(/const performConsume = async/);
  });
  test('S13 — AC2: [입력하러 가기] chart 이동 / AC3: [나중에]=performConsume', () => {
    expect(src).toMatch(/primaryLabel="입력하러 가기"/);
    expect(src).toMatch(/onPrimary=\{[^}]*openChartNo\(/);
    expect(src).toMatch(/onLater=\{[^}]*performConsume\(\)/);
  });
});

test.describe('AC1/AC2/AC3 — CustomerChartPage::saveC22Deduct + saveUseSession (site 3·4)', () => {
  const src = read(CHART);
  test('S14 — 두 경로 모두 차감 전 판정 → txMemoGate proceed 큐잉', () => {
    expect(src).toContain("import { hasTodayTreatmentMemo }");
    expect(src).toContain('TxMemoSoftPopup');
    // saveC22Deduct 경로: runC22Deduct 재개.
    expect(src).toMatch(/setTxMemoGate\(\{\s*proceed:\s*\(\)\s*=>\s*\{\s*void runC22Deduct\(/);
    // saveUseSession 경로: runUseSession 재개.
    expect(src).toMatch(/setTxMemoGate\(\{\s*proceed:\s*\(\)\s*=>\s*\{\s*void runUseSession\(/);
    // 실제 consume 로직 분리 배선.
    expect(src).toMatch(/const runC22Deduct = async/);
    expect(src).toMatch(/const runUseSession = async/);
  });
  test('S15 — AC2: [지금 쓸게요]=in-place composer 포커스(차감 미실행)', () => {
    expect(src).toMatch(/primaryLabel="지금 쓸게요"/);
    expect(src).toMatch(/onPrimary=\{[^}]*focusTxMemoComposer\(\)/);
    // focusTxMemoComposer = 치료메모 탭 열고 TreatmentMemoComposer 스크롤/포커스.
    expect(src).toMatch(/const focusTxMemoComposer =/);
    expect(src).toContain('txMemoComposerRef');
    expect(src).toMatch(/scrollIntoView/);
  });
  test('S16 — AC3: [나중에]=proceed()(원 consume 흐름 재개, 무회귀)', () => {
    // onLater 는 큐잉된 proceed(runC22Deduct/runUseSession) 를 그대로 실행.
    expect(src).toMatch(/onLater=\{[^}]*txMemoGate\?\.proceed[^}]*\}/);
  });
  test('S17 — TreatmentMemoComposer 앵커 ref 부착(포커스 대상)', () => {
    expect(src).toMatch(/<div ref=\{txMemoComposerRef\}>/);
  });
});

test.describe('AC3 무회귀 — 4곳 공통 hard-block 부재', () => {
  test('S18 — 어느 사이트도 "메모 없으면 차감 차단" 강제로직 미도입', () => {
    // 판정 실패/미입력 시 항상 재개 경로(performConsume / proceed)가 존재해야 함.
    // hard-block = 미입력이면 return 만 하고 재개 경로 없음 → 아래 재개 배선 존재로 반증.
    expect(read(CHECKIN)).toMatch(/onLater=\{[^}]*performConsume\(\)/);
    expect(read(PACKAGES)).toMatch(/onLater=\{[^}]*performConsume\(\)/);
    expect(read(CHART)).toMatch(/onLater=\{[^}]*proceed/);
  });
});
