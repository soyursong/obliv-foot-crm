/**
 * T-20260623-foot-CHART2-CUSTMEMO-RENAME-ADD — 2번차트 1구역 [고객메모] 신설 + 상세 라벨 변경
 *
 * 김주연 총괄(풋센터) 요청. 충돌 해소=공간(surface) 분리.
 *   item1: 1구역 예약메모 하단에 [고객메모] 칸 신규 추가 — 직접수정·non-history(현재값 단일 유지·수정).
 *   item2: 3구역 상세 '예약메모' 항목명 → '고객메모' (표시문구만, 내부 식별자 '예약' 불변).
 *
 * RECONCILE(티켓 §3) 결정:
 *   1구역 고객메모 = 신규 단일 컬럼 customers.customer_note (직접수정·non-history).
 *   → MEMO-HISTORY(customers.customer_memo → history 전환)와 무간섭(다른 컬럼).
 *   1구역 예약메모 row(ReservationMemoTimeline)는 그대로 유지(앵커). 새 고객메모 row는 그 아래.
 *
 * 본 spec 은 코드베이스 CHART2 spec 관행(정적 소스 미러링 가드)을 따라
 * 구현/RECONCILE 불변식이 회귀하면 즉시 실패시킨다.
 * 현장 클릭 시나리오 3종(티켓 §4)을 가드로 변환.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const chartSrc = readFileSync(resolve(__dir, '../../src/pages/CustomerChartPage.tsx'), 'utf-8');
const typesSrc = readFileSync(resolve(__dir, '../../src/lib/types.ts'), 'utf-8');
const migSrc = readFileSync(
  resolve(__dir, '../../supabase/migrations/20260623170000_customers_customer_note.sql'),
  'utf-8',
);

// ── 시나리오 1·2: 1구역 고객메모 신규 입력·저장 + 수정(non-history) ─────────────
test.describe('item1 — 1구역 [고객메모] 칸 신설 (직접수정·non-history)', () => {
  test('DB: customers.customer_note 신규 컬럼 마이그레이션(ADDITIVE nullable)', () => {
    expect(migSrc).toContain('ADD COLUMN IF NOT EXISTS customer_note TEXT');
    expect(migSrc).toContain('customers'); // 대상 테이블
    // 파괴적 변경 금지 가드
    expect(migSrc).not.toContain('DROP COLUMN customer_memo');
    expect(migSrc).not.toContain('NOT NULL');
  });

  test('타입: Customer.customer_note 추가', () => {
    expect(typesSrc).toContain('customer_note');
  });

  test('상태/로드/저장 핸들러 연결', () => {
    expect(chartSrc).toContain('customerNoteText');
    expect(chartSrc).toContain('setCustomerNoteText');
    // 차트 진입 시 현재값 로드(재진입 시 보존)
    expect(chartSrc).toContain('setCustomerNoteText((custData as Customer).customer_note ?? \'\')');
    // 직접수정 저장 = 현재값 덮어쓰기(append 아님)
    expect(chartSrc).toContain('const saveCustomerNote');
    expect(chartSrc).toContain('saveCustomerField({ customer_note: customerNoteText.trim() || null })');
  });

  test('AC: 1구역 예약메모 row 아래에 고객메모 입력칸+저장버튼 렌더', () => {
    expect(chartSrc).toContain('chart-customer-note-input');
    expect(chartSrc).toContain('chart-customer-note-save-btn');
    expect(chartSrc).toContain('고객메모 저장');
    // 1구역 예약메모(ReservationMemoTimeline) 앵커 유지(제거 회귀 금지)
    expect(chartSrc).toContain('ReservationMemoTimeline');
    // 고객메모 칸이 예약메모 row(ReservationMemoTimeline) 뒤에 위치
    const memoTimelineIdx = chartSrc.indexOf('ReservationMemoTimeline\n');
    const custNoteIdx = chartSrc.indexOf('chart-customer-note-input');
    expect(memoTimelineIdx).toBeGreaterThan(-1);
    expect(custNoteIdx).toBeGreaterThan(memoTimelineIdx);
  });

  test('non-history 불변식: 1구역 고객메모는 customer_note(직접수정), customer_memo(MEMO-HISTORY)와 별개', () => {
    // 1구역 고객메모 저장은 customer_note 만 건드림 (customer_memo 덮어쓰기 금지)
    expect(chartSrc).not.toContain('saveCustomerField({ customer_memo: customerNoteText');
    expect(chartSrc).not.toContain('customer_reservation_memos.*customerNoteText');
  });
});

// ── 시나리오 3: 라벨 — 3구역 상세 '예약메모' → '고객메모' ──────────────────────
test.describe('item2 — 3구역 상세 라벨 예약메모 → 고객메모', () => {
  test('AC: 상세 탭 라벨 매핑 예약→고객메모', () => {
    expect(chartSrc).toContain("'예약': '고객메모'");
    // 내부 식별자/category 키는 불변(회귀 금지)
    expect(chartSrc).toContain("['예약', '상담', '치료메모'] as const");
  });

  test('AC: 상세 예약 탭 메모패널 라벨 고객메모로 통일', () => {
    expect(chartSrc).toContain('새 고객메모 추가');
    expect(chartSrc).toContain('고객메모 이력');
    expect(chartSrc).toContain('아직 고객메모가 없습니다');
    // 잔존 라벨 회귀 가드: 상세 탭 메모패널에 '예약메모 추가/이력' 잔존 금지
    expect(chartSrc).not.toContain('새 예약메모 추가');
    expect(chartSrc).not.toContain('예약메모 이력');
  });

  test('AC: 메모 요약 블록 라벨 고객메모', () => {
    expect(chartSrc).toContain("{ label: '고객메모', content: reservationMemoHistory.latest?.content ?? null }");
  });

  test('비대상 회귀 금지: 예약 등록/예약내역의 예약메모(booking_memo)는 라벨 유지', () => {
    // 미니 예약 등록 팝업 + 예약내역 탭은 reservation-level 메모 → '예약메모' 유지
    expect(chartSrc).toContain('예약메모'); // 잔존(예약 등록 폼 등)이 존재해야 함
  });
});
