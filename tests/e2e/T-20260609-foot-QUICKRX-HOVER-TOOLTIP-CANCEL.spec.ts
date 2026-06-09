/**
 * E2E spec — T-20260609-foot-QUICKRX-HOVER-TOOLTIP-CANCEL
 * 진료부대시보드 빠른처방 2건 (문지은 대표원장 신고):
 *   ① 버튼 hover 시 약 정보 툴팁(약 이름/횟수/투여일/용법) — 무DB, items 배열 map(다중 약).
 *   ② 의사 확정 후 '취소' 버튼 — rxUndo 메커니즘 재노출(토스트 휘발 X), invalidateRxQueries 정합.
 *
 * 그라운딩(planner): db_change=false. 신규 npm 패키지 0(경량 인라인 portal popover).
 * 의존: QUICKRX-MULTI-DRUG — 툴팁은 items 배열 기준(단일 약 가정 금지).
 *
 * 본 spec 은 구현 정본 순수 모듈(src/lib/rxTooltip · src/lib/rxUndo)을 직접 import 해 회귀를 잡는다.
 * 컴포넌트 배선(QuickRxBar.QuickRxButton hover / RxCancelButton)은 이 두 모듈을 단일 출처로 경유한다.
 */
import { test, expect } from '@playwright/test';
import {
  rxItemTooltipLine,
  rxItemsTooltipLines,
  type RxTooltipItemLike,
} from '../../src/lib/rxTooltip';
import { captureRxSnapshot, buildUndoPatch } from '../../src/lib/rxUndo';

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 1 — ① 단일 약 hover 툴팁: 약 이름/횟수/투여일/용법 전부 노출
// ═══════════════════════════════════════════════════════════════════════════
test.describe('S1 단일 약 툴팁 — 4개 필드 포맷', () => {
  test('이름 + 메타(횟수 · 투여일 · 용법) 정확 조합', () => {
    const line = rxItemTooltipLine({
      name: '타이레놀',
      count: 3,
      days: 5,
      frequency: '1일 3회',
    });
    expect(line.name).toBe('타이레놀');
    expect(line.meta).toBe('3회 · 5일 · 1일 3회'); // 횟수 · 투여일 · 용법 순
  });

  test('메타 구분자는 " · " — 댕글링/중복 구분자 없음', () => {
    const { meta } = rxItemTooltipLine({ name: '소염제', count: 1, days: 3, frequency: '1일 2회' });
    expect(meta).not.toMatch(/^\s*·/); // 선두 구분자 없음
    expect(meta).not.toMatch(/·\s*$/); // 후미 구분자 없음
    expect(meta).not.toContain('··');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 2 — ① 결측 필드 방어 + 다중 약(items 배열 map, MULTI-DRUG 정합)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('S2 결측 방어 + 다중 약', () => {
  test('횟수/투여일/용법 일부 결측 → 있는 것만, 댕글링 구분자 없음', () => {
    expect(rxItemTooltipLine({ name: '연고', count: null, days: 7, frequency: '' }).meta).toBe('7일');
    expect(rxItemTooltipLine({ name: '연고', count: 2, days: null, frequency: null }).meta).toBe('2회');
    expect(rxItemTooltipLine({ name: '연고', frequency: '아침 1회' }).meta).toBe('아침 1회');
  });

  test('전부 결측 → meta 빈문자열(이름만 표시)', () => {
    const { name, meta } = rxItemTooltipLine({ name: '바셀린' });
    expect(name).toBe('바셀린');
    expect(meta).toBe('');
  });

  test('이름 결측 → "(이름 미입력)" 폴백(빈 줄 방지)', () => {
    expect(rxItemTooltipLine({ name: '', count: 1 }).name).toBe('(이름 미입력)');
    expect(rxItemTooltipLine(null).name).toBe('(이름 미입력)');
    expect(rxItemTooltipLine(undefined).name).toBe('(이름 미입력)');
  });

  test('다중 약(items 배열) → 줄마다 1:1 map (단일 약 가정 금지)', () => {
    const items: RxTooltipItemLike[] = [
      { name: '항생제', count: 3, days: 5, frequency: '1일 3회' },
      { name: '소염제', count: 2, days: 3, frequency: '1일 2회' },
      { name: '위장약', days: 5, frequency: '식후' },
    ];
    const lines = rxItemsTooltipLines(items);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toEqual({ name: '항생제', meta: '3회 · 5일 · 1일 3회' });
    expect(lines[1]).toEqual({ name: '소염제', meta: '2회 · 3일 · 1일 2회' });
    expect(lines[2]).toEqual({ name: '위장약', meta: '5일 · 식후' }); // 횟수 결측 생략
  });

  test('빈 세트(items=[]·null·undefined) → 빈 배열(렌더 없음)', () => {
    expect(rxItemsTooltipLines([])).toEqual([]);
    expect(rxItemsTooltipLines(null)).toEqual([]);
    expect(rxItemsTooltipLines(undefined)).toEqual([]);
  });

  test('순수 함수 — 입력 불변(렌더만, 부수효과 없음)', () => {
    const item: RxTooltipItemLike = { name: '약', count: 1, days: 2, frequency: '1일 1회' };
    const snap = JSON.stringify(item);
    rxItemTooltipLine(item);
    rxItemsTooltipLines([item]);
    expect(JSON.stringify(item)).toBe(snap);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 3 — ② 확정 취소: rxUndo 재사용으로 clean(none) 상태 원복
//   취소 = 빠른처방 적용 전(clean) 상태 = captureRxSnapshot(undefined) → buildUndoPatch.
//   토스트 휘발과 무관하게 상시 동일 패치를 생성(결정적).
// ═══════════════════════════════════════════════════════════════════════════
test.describe('S3 확정 취소 — clean 원복(rxUndo 재사용)', () => {
  test('취소 패치 = none/false/null 정규화(4개 처방필드 전부 비움)', () => {
    const patch = buildUndoPatch(captureRxSnapshot(undefined));
    expect(patch.prescription_items).toBeNull();
    expect(patch.prescription_status).toBe('none');
    expect(patch.doctor_confirm_prescription).toBe(false);
    expect(patch.doctor_confirmed_at).toBeNull();
  });

  test('확정(confirmed) 상태에서 취소해도 패치는 clean(none) — 토스트 비의존·결정적', () => {
    // 현재 행이 confirmed 라도, 취소는 적용 전 clean 스냅샷으로 원복(상시 재현 가능).
    const cleanPatch = buildUndoPatch(captureRxSnapshot(undefined));
    expect(cleanPatch.prescription_status).toBe('none');
    expect(cleanPatch.doctor_confirm_prescription).toBe(false);
  });

  test('취소 패치는 4개 처방필드만 — 인접 필드(차팅/문서) 불간섭, INSERT 없음', () => {
    const patch = buildUndoPatch(captureRxSnapshot(undefined));
    expect(Object.keys(patch).sort()).toEqual(
      [
        'doctor_confirm_prescription',
        'doctor_confirmed_at',
        'prescription_items',
        'prescription_status',
      ].sort(),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 4 — ② 멱등성: 취소 반복해도 동일 결과(이중적용·유령행 없음)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('S4 취소 멱등성', () => {
  test('취소 → 취소(이미 none) 반복해도 패치 동일(멱등)', () => {
    const first = buildUndoPatch(captureRxSnapshot(undefined));
    // 취소 후 행은 none 상태 → 다시 취소해도 같은 clean 패치.
    const afterRow = {
      prescription_items: first.prescription_items,
      prescription_status: first.prescription_status,
      doctor_confirm_prescription: first.doctor_confirm_prescription,
      doctor_confirmed_at: first.doctor_confirmed_at,
    };
    const second = buildUndoPatch(captureRxSnapshot(afterRow));
    expect(second).toEqual(first);
  });

  test('captureRxSnapshot ∘ buildUndoPatch 는 clean 상태를 보존(idempotent)', () => {
    const snap1 = captureRxSnapshot(undefined);
    const snap2 = captureRxSnapshot(buildUndoPatch(snap1));
    expect(snap2).toEqual(snap1);
  });
});
