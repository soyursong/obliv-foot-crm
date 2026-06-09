/**
 * E2E spec — T-20260609-foot-QUICKRX-DROPDOWN-LIST-REDESIGN
 * 빠른처방 클릭/확정 UX 전면 재정의 (문지은 대표원장):
 *   AC-1 선택지 = 우측 드롭다운 목록형(버튼 아님), 파란글씨/흰배경/테두리 없음.
 *   AC-2 항목 클릭 확정 → "처방완료" + 옆에 약물리스트 검은글씨 `{name} {freq} *` (items 배열 전체·다중약).
 *   AC-3 hover 미리보기 우측·비방해 — 13c1770 QuickRxButton portal 재사용(회귀 없이 유지).
 *   AC-4 별도 취소버튼 폐지 → "처방완료" 재클릭 → "취소하시겠습니까?" → useCancelConfirmedRx clean 원복.
 *   AC-5 취소 권한 = DOCTOR_ROLES.
 *   AC-6 db_change=false. 확정/취소 내부로직·rxUndo·invalidateRxQueries 변경금지. 신규 npm 0.
 *
 * 본 spec 은 구현 정본 순수 모듈(src/lib/rxTooltip · src/lib/rxUndo)을 직접 import 해 회귀를 잡는다.
 * 약물리스트 포맷(AC-2)은 formatRxConfirmedSummary 단일 출처, 취소 원복(AC-4)은 rxUndo 단일 출처.
 * 의존: QUICKRX-MULTI-DRUG — items 배열 기준(단일 약 가정 금지).
 */
import { test, expect } from '@playwright/test';
import { formatRxConfirmedSummary } from '../../src/lib/rxTooltip';
import { captureRxSnapshot, buildUndoPatch } from '../../src/lib/rxUndo';

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 1 — AC-2 약물리스트 포맷: `{name} {freq} *` (단일/다중)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('S1 처방완료 약물리스트 포맷 — name freq *', () => {
  test('단일 약 → "이름 용법 *"', () => {
    expect(formatRxConfirmedSummary([{ name: '소염제', frequency: '1/3/2' }])).toBe('소염제 1/3/2 *');
  });

  test('다중 약 → 약마다 " * " 종결·연결 (티켓 예시 형태)', () => {
    const out = formatRxConfirmedSummary([
      { name: '항생제', frequency: '1/3/2' },
      { name: '위장약', frequency: '1/1/1' },
    ]);
    expect(out).toBe('항생제 1/3/2 * 위장약 1/1/1 *');
  });

  test('3개 이상도 전부 나열 (slice 절단 없음 — 다중약 전체)', () => {
    const out = formatRxConfirmedSummary([
      { name: 'A', frequency: '1/0/0' },
      { name: 'B', frequency: '0/1/0' },
      { name: 'C', frequency: '0/0/1' },
      { name: 'D', frequency: '1/1/1' },
    ]);
    expect(out).toBe('A 1/0/0 * B 0/1/0 * C 0/0/1 * D 1/1/1 *');
    expect(out.split('*').filter((s) => s.trim()).length).toBe(4); // 4개 모두 노출
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 2 — AC-2 결측 방어: 용법/이름 결측 시 댕글링 없음
// ═══════════════════════════════════════════════════════════════════════════
test.describe('S2 결측 방어', () => {
  test('용법 결측 → "이름 *" (댕글링 공백 없음)', () => {
    expect(formatRxConfirmedSummary([{ name: '연고', frequency: '' }])).toBe('연고 *');
    expect(formatRxConfirmedSummary([{ name: '연고' }])).toBe('연고 *');
  });

  test('이름 결측 → "(이름 미입력) *" 폴백(빈 토큰 방지)', () => {
    expect(formatRxConfirmedSummary([{ name: '', frequency: '1/1/1' }])).toBe('(이름 미입력) 1/1/1 *');
  });

  test('빈/비배열 → 빈 문자열(요약 미렌더)', () => {
    expect(formatRxConfirmedSummary([])).toBe('');
    expect(formatRxConfirmedSummary(null)).toBe('');
    expect(formatRxConfirmedSummary(undefined)).toBe('');
    // 단일 약 가정 금지 — 비배열(객체) 입력도 안전하게 빈 문자열.
    expect(formatRxConfirmedSummary({ name: 'x' } as unknown as never)).toBe('');
  });

  test('순수 함수 — 입력 불변(렌더만, 부수효과 없음)', () => {
    const items = [{ name: '약', frequency: '1/1/1' }];
    const snap = JSON.stringify(items);
    formatRxConfirmedSummary(items);
    expect(JSON.stringify(items)).toBe(snap);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 3 — AC-4 "처방완료" 재클릭 취소 = rxUndo clean 원복(내부로직 변경금지)
//   AC-6 guard: 취소 패치는 종전과 동일하게 4개 처방필드만 clean(none) 으로 원복.
// ═══════════════════════════════════════════════════════════════════════════
test.describe('S3 처방완료 재클릭 → clean 원복 (rxUndo 단일 출처·불변)', () => {
  test('취소 패치 = none/false/null 정규화(4개 처방필드 전부 비움)', () => {
    const patch = buildUndoPatch(captureRxSnapshot(undefined));
    expect(patch.prescription_items).toBeNull();
    expect(patch.prescription_status).toBe('none');
    expect(patch.doctor_confirm_prescription).toBe(false);
    expect(patch.doctor_confirmed_at).toBeNull();
  });

  test('취소 패치는 4개 처방필드만 — 인접 필드 불간섭, INSERT 없음', () => {
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
// 시나리오 4 — AC-4 취소 멱등성: 반복 취소해도 동일 결과(이중적용·유령행 없음)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('S4 취소 멱등성', () => {
  test('취소 → 취소 반복해도 동일 clean 패치(멱등)', () => {
    const first = buildUndoPatch(captureRxSnapshot(undefined));
    const afterRow = {
      prescription_items: first.prescription_items,
      prescription_status: first.prescription_status,
      doctor_confirm_prescription: first.doctor_confirm_prescription,
      doctor_confirmed_at: first.doctor_confirmed_at,
    };
    const second = buildUndoPatch(captureRxSnapshot(afterRow));
    expect(second).toEqual(first);
  });
});
