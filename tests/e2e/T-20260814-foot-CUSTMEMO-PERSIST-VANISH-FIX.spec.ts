import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * T-20260814-foot-CUSTMEMO-PERSIST-VANISH-FIX
 *
 * 버그(reporter 박민석 코디): 재진(2번차트) 고객메모("고객 성향·특이사항", customers.customer_note —
 *   예약메모 customer_memo 와 별개 필드) 저장 후 창을 다시 열면 정상 표시되나, "잠시 후 다시 보면 사라짐" = 데이터 유실.
 *
 * ── Root cause (런타임 규명, 추정 아님) ─────────────────────────────────────
 *   서버측 nulling 부재 확증: prod(rxlomoozakkjesdqjtvd) customers 트리거 8종 전수(pg_trigger) + self-checkin
 *   upsert RPC(resolve_v3 등)는 customer_note 를 COALESCE-미접촉 → customer_note 를 null 로 만드는 서버 경로 0.
 *   유실 진원 = **클라이언트 통합저장의 무조건 덮어쓰기**:
 *     CustomerChartPage.handleInfoPanelSave 가 `patch.customer_note = customerNoteText.trim()||null` 을
 *     사용자가 메모를 편집하지 않았어도 항상 실었다. 2번차트에는
 *       (1) 60초 자동저장(setInterval, isDirty 시)  (2) 배포감지 flush(useUnsavedGuard)
 *     두 자동저장이 있어, 다른 필드로 isDirty=true 인 채 customerNoteText 가 stale/빈값이면
 *     (예: 다른 surface가 customer_note 를 채운 뒤에도 CUSTOMER_REFRESH 핸들러가 textarea 를 재동기 안 함)
 *     자동저장이 customer_note 를 null 로 덮어써 "잠시 후 저절로 사라짐" = 유실.
 *
 * ── Fix (버그 fix·의도 동작 복원, behavior 확장 아님 / db_change=false) ────────
 *   customerNoteBaseline(로드된 서버 정본값) 대비 **이 창에서 실제 편집된 경우에만** customer_note 를 patch 에 포함.
 *     · 미편집 저장(자동저장 포함) → customer_note 무접촉(무clobber).
 *     · 의도 편집(빈칸으로 지우기 포함) → 정상 반영.
 *   + CUSTOMER_REFRESH 핸들러가 미편집 시 textarea+baseline 재동기(타 surface 메모 반영).
 *   + 예약팝업(ReservationDetailPopup) CUSTOMER_REFRESH 구독 추가(stale-빈값 clobber 소스 제거).
 *   + customer_note write 3경로 rows-affected 검증(.select('id') — 0-row silent write-failure 은폐 금지).
 *
 * ── 핵심 AC ─────────────────────────────────────────────────────────────
 *   저장후 창재열기·시간경과·refetch 후 유실 0 · 예약메모↔고객메모 상호 덮어쓰기 금지 ·
 *   빈값 저장으로 기존메모 무단삭제 금지 · rows-affected 검증.
 *
 * 검증 = 유실 RC 의 판정 술어(diff-guard) 순수 로직 단언 + 실제 컴포넌트 가드 존재 소스 단언(회귀 방지).
 *
 * 실행:
 *   npx playwright test tests/e2e/T-20260814-foot-CUSTMEMO-PERSIST-VANISH-FIX.spec.ts --project=desktop-chrome
 */

// ── 유실 RC 술어(컴포넌트 handleInfoPanelSave 와 동일 규칙 미러) ─────────────
//   반환 = 통합저장이 customer_note 를 patch 에 포함(=DB 에 write)해야 하는가.
//   false = 미편집 → customer_note 무접촉(기존 DB 값 보존, 무clobber).
function noteChanged(customerNoteText: string, baseline: string): boolean {
  return customerNoteText.trim() !== baseline.trim();
}

// 통합저장이 실제로 DB 에 반영할 customer_note 값. undefined = patch 미포함(무접촉).
function patchedCustomerNote(customerNoteText: string, baseline: string): string | null | undefined {
  if (!noteChanged(customerNoteText, baseline)) return undefined; // 무접촉
  return customerNoteText.trim() || null;
}

// DB 상의 customer_note 를 diff-guard 통합저장으로 시뮬레이트한 최종 영속값.
function simulateSave(dbValue: string | null, customerNoteText: string, baseline: string): string | null {
  const p = patchedCustomerNote(customerNoteText, baseline);
  return p === undefined ? dbValue : p; // 미포함이면 기존 DB 값 유지
}

test.describe('T-20260814-foot-CUSTMEMO-PERSIST-VANISH-FIX — 고객메모 유실 차단', () => {
  test('시나리오1 (유실 재현→유지 전환): 미편집 자동저장이 기존 고객메모를 null 로 덮어쓰지 않음', () => {
    // 재현 조건: DB 에는 방금 저장된 "고객 성향..."(customer_note), 그러나 이 창은 메모를 편집 안 함.
    //   창 로드시 DB 가 비어있어 customerNoteText='' , baseline='' (stale). 이후 다른 surface 가 "고객 성향..." 저장.
    //   여기서 다른 필드로 isDirty=true → 60초 자동저장/배포감지 flush 발화.
    const dbAfterOtherSurfaceSave = '고객 성향·특이사항 등';
    const customerNoteText = '';   // 이 창은 메모 미편집(stale 빈값)
    const baseline = '';           // 로드시 스냅샷(빈값)

    // [BEFORE-fix 회귀 재현] 무조건 write 였다면: '' → null 로 clobber (유실).
    const legacyPatched = customerNoteText.trim() || null; // = null
    expect(legacyPatched).toBeNull(); // 구 동작은 유실을 일으켰음을 명시

    // [AFTER-fix] diff-guard: 미편집이므로 customer_note 무접촉 → 기존 값 보존(유실 0).
    expect(noteChanged(customerNoteText, baseline)).toBe(false);
    expect(patchedCustomerNote(customerNoteText, baseline)).toBeUndefined();
    expect(simulateSave(dbAfterOtherSurfaceSave, customerNoteText, baseline)).toBe(dbAfterOtherSurfaceSave);
  });

  test('반복 자동저장(시간경과)에도 미편집 메모 유지 — refetch 후 유실 0', () => {
    let db: string | null = '고객 성향·특이사항 등';
    const baseline = '';           // 창 로드 당시 비어있던 스냅샷
    const text = '';               // 미편집
    // 60초 자동저장이 여러 번 발화해도 diff-guard 로 매번 무접촉.
    for (let i = 0; i < 5; i++) db = simulateSave(db, text, baseline);
    expect(db).toBe('고객 성향·특이사항 등'); // 유실 0
  });

  test('의도 편집은 정상 반영 (신규 입력)', () => {
    const db: string | null = null;
    const baseline = '';
    const text = '보호자 동반, 휠체어 이용';
    expect(noteChanged(text, baseline)).toBe(true);
    expect(simulateSave(db, text, baseline)).toBe('보호자 동반, 휠체어 이용');
  });

  test('의도 편집은 정상 반영 (빈칸으로 지우기) — 로드값을 사용자가 비운 경우만 삭제', () => {
    const db: string | null = '기존 메모';
    const baseline = '기존 메모';  // 사용자가 현재 값을 로드해서 봄
    const text = '';               // 사용자가 명시적으로 비움
    expect(noteChanged(text, baseline)).toBe(true);
    expect(simulateSave(db, text, baseline)).toBeNull(); // 의도된 삭제
  });

  test('예약메모↔고객메모 상호 덮어쓰기 금지: 고객메모 미편집 통합저장은 customer_note 무접촉', () => {
    // 예약메모(customer_memo)만 다뤄지고 고객메모(customer_note)는 안 건드린 저장.
    const dbNote: string | null = '고객 성향 메모';
    const baseline = '고객 성향 메모';
    const text = '고객 성향 메모'; // 미편집(동일)
    expect(patchedCustomerNote(text, baseline)).toBeUndefined();
    expect(simulateSave(dbNote, text, baseline)).toBe('고객 성향 메모');
  });

  test('공백만 변경(trim 동치)은 미편집으로 간주 — 무의미 clobber 방지', () => {
    expect(noteChanged('  고객 성향  ', '고객 성향')).toBe(false);
    expect(patchedCustomerNote('  고객 성향  ', '고객 성향')).toBeUndefined();
  });

  // ── 회귀 방지: 실제 컴포넌트가 diff-guard + rows-affected 를 사용하는지 소스 단언 ──
  test('CustomerChartPage.handleInfoPanelSave 가 diff-guard(noteChanged) + rows-affected 검증 보유', () => {
    const src = fs.readFileSync(
      path.resolve(process.cwd(), 'src/pages/CustomerChartPage.tsx'),
      'utf8',
    );
    // diff-guard: 편집 시에만 customer_note 를 patch 에 포함.
    expect(src).toMatch(/const noteChanged = customerNoteText\.trim\(\) !== customerNoteBaseline\.current\.trim\(\)/);
    expect(src).toMatch(/if \(noteChanged\) \{\s*\n\s*patch\.customer_note = customerNoteText\.trim\(\) \|\| null;/);
    // rows-affected: .select('id') + 0-row 실패 처리.
    expect(src).toMatch(/\.update\(patch\)\.eq\('id', customer\.id\)\.select\('id'\)/);
    expect(src).toMatch(/updRows\.length === 0/);
    // baseline 초기화(loadData) 존재.
    expect(src).toContain('customerNoteBaseline.current =');
  });

  test('ReservationDetailPopup 가 CUSTOMER_REFRESH 구독 + rows-affected 검증 보유(stale clobber 소스 제거)', () => {
    const src = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/ReservationDetailPopup.tsx'),
      'utf8',
    );
    expect(src).toContain("STORAGE_KEYS.CUSTOMER_REFRESH");
    expect(src).toMatch(/\.update\(\{ customer_note: customerMemo \}\)[\s\S]*\.select\('id'\)/);
    expect(src).toMatch(/updRows\.length === 0/);
  });
});
