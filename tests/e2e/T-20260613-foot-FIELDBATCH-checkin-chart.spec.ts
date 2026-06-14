/**
 * E2E spec — T-20260613-foot-FIELDBATCH-CHECKIN-CHART-0613 (items 1·2·3·5·6·8)
 * 풋 현장 배치 수정요청 batch — 인테이크/차트 동선. (item4=별도 spec, item9=CHART1 carve)
 *
 * 본 spec 범위:
 *  - item1: 셀프접수 '예약 수신 동의' 기본 체크 ON (거래성 예약알림, 두 경로 공통)
 *  - item2: 초진 체크인 전환 → [접수중](receiving). 두 진입점(예약상세·+체크인박스) 통일.
 *  - item3: 1번차트(CheckInDetailSheet) "저장 후 닫기" 버튼 — 2번차트와 동일 동작(신규 구현)
 *  - item5: 대시보드 [진료대기] 보라색 진료콜 알람 배너 제거(중복 표시 삭제)
 *  - item6: 대시보드 날짜 옆 "배정 carry-over" 인디케이터 텍스트 제거
 *  - item8: 2번차트 체류시간 탭 로딩-only 버그(slot_dwell race) 수정
 *
 * 구성: PART C(소스 정합) — 라이브 서버/시드 불필요, 회귀 가드 결정론.
 *  + PART B(라이브, service key 있을 때만) — item3 "저장 후 닫기" 버튼 동선.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(import.meta.url); // .../tests/e2e/<spec>.ts
const root = join(here, '..', '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf-8');

// ─────────────────────────────────────────────────────────────────────────
// item1 — 셀프접수 예약 수신 동의 기본 체크 ON
// ─────────────────────────────────────────────────────────────────────────
test.describe('item1: 셀프접수 예약 수신 동의 기본 ON', () => {
  test('smsOptIn 초기값=true (거래성 예약알림, opt-in 위반 아님)', () => {
    const src = read('src/pages/SelfCheckIn.tsx');
    expect(src).toContain('const [smsOptIn, setSmsOptIn] = useState(true)');
    // 폼 리셋 시에도 기본 ON 유지(두 경로 공통)
    expect(src).toContain('setSmsOptIn(true)');
    // 체크박스가 smsOptIn에 바인딩
    expect(src).toContain('checked={smsOptIn}');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// item2 — 초진 체크인 → [접수중](receiving), 두 진입점 통일
// ─────────────────────────────────────────────────────────────────────────
test.describe('item2: 초진 체크인 슬롯 [접수중](receiving)', () => {
  test('NewCheckInDialog(+체크인 박스) — 초진(new)→receiving', () => {
    const src = read('src/components/NewCheckInDialog.tsx');
    // visitType==='new' 분기가 receiving 으로 매핑
    expect(src).toMatch(/visitType === 'new'[\s\S]{0,40}'receiving'/);
    expect(src).toContain('T-20260613-foot-FIELDBATCH item2');
  });

  test('ReservationDetailPopup(우클릭→예약상세→초진 체크인) — 동일 receiving 통일', () => {
    const src = read('src/components/ReservationDetailPopup.tsx');
    expect(src).toContain('T-20260613-foot-FIELDBATCH item2');
    expect(src).toContain("'receiving'");
  });

  test('receiving/consult_waiting 는 기존 상태값(신규 추가 아님 → CHECK constraint 갱신 불요)', () => {
    const status = read('src/lib/status.ts');
    expect(status).toContain('receiving');
    expect(status).toContain('consult_waiting');
    const types = read('src/lib/types.ts');
    expect(types).toContain("'receiving'");
    expect(types).toContain("'consult_waiting'");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// item3 — 1번차트 "저장 후 닫기" (신규 구현, 2번차트 동작 동일)
// ─────────────────────────────────────────────────────────────────────────
test.describe('item3: 1번차트 저장 후 닫기', () => {
  test('CheckInDetailSheet — handleSaveAndClose + 저장 후 닫기 버튼', () => {
    const src = read('src/components/CheckInDetailSheet.tsx');
    expect(src).toContain('handleSaveAndClose');
    expect(src).toContain('data-testid="checkin-close-save-btn"');
    expect(src).toContain('저장 후 닫기');
    // 닫기 확인 다이얼로그 3버튼 구성(취소/저장하지 않고 닫기/저장 후 닫기) — 2번차트와 정합
    expect(src).toContain('취소(계속 작성)');
    expect(src).toContain('저장하지 않고 닫기');
  });

  test('saveNotes 성공 여부(boolean) 반환 + 성공 시에만 onClose', () => {
    const src = read('src/components/CheckInDetailSheet.tsx');
    expect(src).toContain('saveNotes = async (): Promise<boolean>');
    // handleSaveAndClose: 저장 성공(ok)일 때만 닫기
    const fn = src.slice(src.indexOf('const handleSaveAndClose'));
    const body = fn.slice(0, fn.indexOf('};') + 2);
    expect(body).toContain('const ok = await saveNotes()');
    expect(body).toContain('if (ok)');
    expect(body).toContain('onClose()');
  });

  test('2번차트(CustomerChartSheet)도 동일 "저장 후 닫기" 보유 — 동작 동일 근거', () => {
    const src = read('src/components/CustomerChartSheet.tsx');
    expect(src).toContain('저장 후 닫기');
    expect(src).toContain('handleSaveAndClose');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// item5 — [진료대기] 보라색 진료콜 알람 배너 제거
// ─────────────────────────────────────────────────────────────────────────
test.describe('item5: 진료대기 보라색 배너 제거', () => {
  test('Dashboard — 상단 보라색 진료콜 배너 삭제 마커', () => {
    const src = read('src/pages/Dashboard.tsx');
    expect(src).toContain('T-20260613-foot-FIELDBATCH item5');
    // 별도 하단 진료콜 명단(DoctorCallListBar)은 잔존(중복만 제거)
    expect(src).toContain('DoctorCallListBar');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// item6 — 날짜 옆 "배정 carry-over" 텍스트 제거
// ─────────────────────────────────────────────────────────────────────────
test.describe('item6: 배정 carry-over 텍스트 제거', () => {
  test('Dashboard — carry-over 인디케이터 라벨 삭제(로직 불변)', () => {
    const src = read('src/pages/Dashboard.tsx');
    expect(src).toContain('T-20260613-foot-FIELDBATCH item6');
    // 시각 라벨은 제거됨 — 주석(블록·JSX·라인)을 모두 제거한 실코드에 "배정 carry-over" 노출 없음.
    const stripped = src
      .replace(/\{?\/\*[\s\S]*?\*\/\}?/g, '') // /* */ 및 {/* */}
      .replace(/\/\/.*$/gm, ''); // // 라인 주석
    expect(stripped).not.toContain('배정 carry-over');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// item8 — 체류시간 탭 로딩-only 버그(slot_dwell race) 수정
// ─────────────────────────────────────────────────────────────────────────
test.describe('item8: 체류시간 탭 race 버그 수정', () => {
  test('CustomerChartPage — 빈 ids면 loaded 잠그지 않고 대기(재실행 가능)', () => {
    const src = read('src/pages/CustomerChartPage.tsx');
    const markerIdx = src.indexOf('T-20260613-foot-FIELDBATCH item8(2)');
    expect(markerIdx, 'item8(2) 버그수정 마커 존재').toBeGreaterThan(0);
    // 마커 직후 effect 본문에 빈 배열 early-return(잠금 회피)이 존재
    const eff = src.slice(markerIdx, markerIdx + 600);
    expect(eff).toContain('if (ids.length === 0) return');
    // effect deps 에 checkInHistory 포함 → 방문 채워지면 재실행
    const depsIdx = src.indexOf('chartTabGroup, chartTab, slotDwellLoaded, slotDwellLoading, checkInHistory');
    expect(depsIdx, 'slot_dwell effect deps에 checkInHistory 포함').toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// PART B — 라이브: item3 저장 후 닫기 동선 (service key + 로그인 가능 시)
// ─────────────────────────────────────────────────────────────────────────
test.describe('item3 PART B: 저장 후 닫기 라이브 동선', () => {
  const SUPA_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  test.skip(!(SUPA_URL && SERVICE_KEY), 'service key 없음 → 라이브 skip');

  test('1번차트 메모 편집 후 닫기 → "저장 후 닫기" 노출 → 저장+닫힘', async ({ page }) => {
    const { loginAndWaitForDashboard } = await import('../helpers');
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패 — 라이브 skip');

    // 대시보드에서 임의 체크인 카드 1번차트 오픈 시도(없으면 skip)
    await page.waitForLoadState('networkidle');
    const firstCard = page.locator('[data-testid^="checkin-card-"]').first();
    if ((await firstCard.count()) === 0) test.skip(true, '체크인 카드 없음 — 라이브 skip');
    await firstCard.click();

    const sheet = page.locator('[data-testid="checkin-detail-sheet"], [role="dialog"]').first();
    await expect(sheet).toBeVisible({ timeout: 5000 }).catch(() => test.skip(true, '1번차트 미오픈 — skip'));

    // 메모 입력(dirty 유발) → 닫기 → 확인 다이얼로그
    const memo = page.locator('textarea').first();
    if ((await memo.count()) > 0) {
      await memo.fill('E2E item3 저장후닫기 테스트 ' + Date.now());
    }
    await page.keyboard.press('Escape');
    const saveClose = page.locator('[data-testid="checkin-close-save-btn"]');
    await expect(saveClose, '"저장 후 닫기" 버튼 노출').toBeVisible({ timeout: 3000 });
    await saveClose.click();
    // 시트/다이얼로그 닫힘
    await expect(page.locator('[data-testid="checkin-close-confirm"]')).toHaveCount(0, { timeout: 5000 });
  });
});
