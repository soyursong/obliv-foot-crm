/**
 * T-20260625-foot-WORKSTATUS-DETAIL-MEMO-TEXTAREA-25X
 *   작업현황(체크인/치료 진행 현황) 상세 — 상담/치료메모 기입칸 2.5배 확장.
 *   김주연 총괄(풋센터) 현장 요청. 직전 T-20260624-foot-CHART2-RESVMEMO-UNIFY-MEMO-UI(2번차트 2.5배)의 후속.
 *
 * 그라운딩: "작업현황 상세" = 대시보드 칸반 카드 클릭 → CheckInDetailSheet(1번차트) 상세 sheet.
 *   이 상세에 실제로 노출되는 메모 기입칸 = 고객메모(customers.customer_memo) / 기타메모(customers.memo).
 *   (상담/치료 진료기록 textarea는 CHART1-TRIM에서 제거됨 → 현장이 '상담/치료메모'로 부르는 대상은 위 메모칸.)
 *
 * AC-1 — 고객메모/기타메모 textarea 2.5배 확장 (rows 2 → 8, 직전 2번차트 inputRows={8}와 시각 일관)
 *   customerMode 블록 + 일반 체크인 블록 양쪽 모두 적용 (총 4개 textarea).
 * AC-2 — 비파괴: 저장/조회 핸들러(saveCustomerMemo/saveEtcMemo) 유지, rows={2} 잔존 0.
 *
 * 코드베이스 spec 관행(정적 소스 미러링 가드)을 따른다 — 확장 불변식이 회귀(rows={2} 복귀)하면 즉시 실패.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const sheetSrc = readFileSync(
  resolve(__dir, '../../src/components/CheckInDetailSheet.tsx'),
  'utf-8',
);

// ── AC-1: 고객메모/기타메모 textarea 2.5배(rows=8) 확장 ──────────────────────────
test.describe('AC-1 — 작업현황 상세 메모 textarea 2.5배 확장', () => {
  test('고객메모 textarea: rows={8} (customerMode + 체크인 블록 양쪽)', () => {
    const customerMemoBlocks = sheetSrc.split('value={customerMemo}');
    // value={customerMemo} 바인딩은 정확히 2곳(customerMode 블록 + 일반 체크인 블록)
    expect(customerMemoBlocks.length - 1).toBe(2);
    for (let i = 1; i < customerMemoBlocks.length; i++) {
      // 각 바인딩 직후 props 영역에 rows={8} 존재, rows={2} 부재
      const propsArea = customerMemoBlocks[i].slice(0, 220);
      expect(propsArea).toContain('rows={8}');
      expect(propsArea).not.toContain('rows={2}');
    }
  });

  test('기타메모 textarea: rows={8} (customerMode + 체크인 블록 양쪽)', () => {
    const etcMemoBlocks = sheetSrc.split('value={etcMemo}');
    expect(etcMemoBlocks.length - 1).toBe(2);
    for (let i = 1; i < etcMemoBlocks.length; i++) {
      const propsArea = etcMemoBlocks[i].slice(0, 220);
      expect(propsArea).toContain('rows={8}');
      expect(propsArea).not.toContain('rows={2}');
    }
  });

  test('직전 2번차트(inputRows={8})와 동일 확장값 사용 — rows={8} 4개', () => {
    const count = (sheetSrc.match(/rows=\{8\}/g) ?? []).length;
    expect(count).toBe(4); // 고객메모 x2 + 기타메모 x2
  });
});

// ── AC-2: 비파괴 (저장/조회 핸들러 유지, rows={2} 잔존 0) ──────────────────────────
test.describe('AC-2 — 비파괴: 저장 동선 유지 + 작은 칸 회귀 없음', () => {
  test('메모 저장 핸들러(saveCustomerMemo/saveEtcMemo) 그대로 유지', () => {
    expect(sheetSrc).toContain('onClick={saveCustomerMemo}');
    expect(sheetSrc).toContain('onClick={saveEtcMemo}');
  });

  test('메모 textarea에 rows={2} 잔존 없음 (확장 누락 가드)', () => {
    // customerMemo / etcMemo 바인딩 인접 props에 rows={2} 가 남지 않아야 함
    for (const anchor of ['value={customerMemo}', 'value={etcMemo}']) {
      let idx = sheetSrc.indexOf(anchor);
      while (idx !== -1) {
        const propsArea = sheetSrc.slice(idx, idx + 220);
        expect(propsArea).not.toContain('rows={2}');
        idx = sheetSrc.indexOf(anchor, idx + 1);
      }
    }
  });
});
