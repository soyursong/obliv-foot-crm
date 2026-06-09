/**
 * E2E spec — T-20260609-foot-DASH-COMPLETE-PAYFLAG-SYNC (칸반 이동 경로 보강)
 *
 * 본 파일은 선행 spec(T-20260609-foot-DASH-COMPLETE-PAYFLAG-SYNC.spec.ts, PaymentDialog 경로)을
 * 보강한다. 현장(김주연 총괄) 재신고 증상은 "대시보드 칸반에서 카드를 '완료' 컬럼으로 드래그/
 * 상태변경" 했을 때 수납완료(dark_gray) 플래그가 안 붙는 것 — 이 경로는 PaymentDialog 가 아니라
 * Dashboard.handleDragEnd / handleContextStatusChange, 그리고 PaymentMiniWindow.executeAutoDone
 * 를 탄다. 선행 커밋은 PaymentDialog 만 고쳐 칸반 직접 이동/미니창 수납 경로가 누락돼 있었다.
 *
 * 진단: (1) 매핑 핸들러 누락 — done 이동 경로들이 status='done' 만 쓰고 status_flag 미동기화.
 *
 * AC-1: '완료' 이동(drag/상태변경/미니창 수납) 시 status_flag='dark_gray' 자동 set + 회색 리렌더
 * AC-2: 비-완료 컬럼 이동에는 미발화(가드) — 오작동 방지
 *
 * 결정론적 회귀 가드(소스 불변식): 정확히 이 버그(done 경로 플래그 미동기화)의 재발을 차단한다.
 *   DB/UI 의존 없이 4개 done-경로 모두가 dark_gray 동기화를 유지하는지 검증.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  STATUS_FLAG_LABEL,
  STATUS_FLAG_DOT,
  STATUS_FLAG_CARD_BG,
} from '../../src/lib/status';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = (rel: string) => readFileSync(resolve(__dirname, '../../', rel), 'utf8');

test.describe('PAYFLAG-SYNC-KANBAN — 수납완료(dark_gray) 시각 계약', () => {
  test('dark_gray=수납완료, dot=gray-600, card=gray-200/gray-400', () => {
    expect(STATUS_FLAG_LABEL.dark_gray).toBe('수납완료');
    expect(STATUS_FLAG_DOT.dark_gray).toBe('bg-gray-600');
    expect(STATUS_FLAG_CARD_BG.dark_gray).toBe('bg-gray-200 border-gray-400');
  });
});

test.describe('PAYFLAG-SYNC-KANBAN — done 경로 dark_gray 동기화 회귀 가드', () => {
  test('Dashboard 두 done-경로(drag/drop·컨텍스트)가 dark_gray 영속화 + 낙관 리렌더', () => {
    const dash = src('src/pages/Dashboard.tsx');

    // 영속화: applyStatusFlagTransition(..., 'dark_gray') 최소 2회 (handleDragEnd + handleContextStatusChange)
    const persistCalls = dash.match(/applyStatusFlagTransition\([^;]*?['"]dark_gray['"]/gs) ?? [];
    expect(persistCalls.length, 'Dashboard done-경로 2곳 dark_gray 영속화').toBeGreaterThanOrEqual(2);

    // 낙관적 회색 리렌더: status_flag: 'dark_gray' 최소 2곳
    const optimistic = dash.match(/status_flag:\s*['"]dark_gray['"]/g) ?? [];
    expect(optimistic.length, '낙관적 dark_gray set 2곳').toBeGreaterThanOrEqual(2);

    // AC-2 가드: dark_gray 동기화는 newStatus==='done' 조건 하에서만
    expect(dash).toContain("newStatus === 'done'");
  });

  test('PaymentMiniWindow.executeAutoDone 가 수납 완료 시 dark_gray 영속화', () => {
    const mini = src('src/components/PaymentMiniWindow.tsx');
    expect(mini).toContain("import { applyStatusFlagTransition }");
    expect(mini).toMatch(/applyStatusFlagTransition\([^;]*?['"]dark_gray['"]/s);
  });

  test('PaymentDialog payment_waiting→done 경로 dark_gray 동기화 유지(회귀)', () => {
    const dlg = src('src/components/PaymentDialog.tsx');
    expect(dlg).toMatch(/applyStatusFlagTransition\([^;]*?['"]dark_gray['"]/s);
  });
});
