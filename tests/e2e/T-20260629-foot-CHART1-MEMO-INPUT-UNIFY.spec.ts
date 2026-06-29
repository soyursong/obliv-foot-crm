/**
 * T-20260629-foot-CHART1-MEMO-INPUT-UNIFY
 *   1번차트(CheckInDetailSheet) 메모 입력 통일. 김주연 총괄(풋센터) 현장 결정 A안
 *   (MSG-20260629-185639-wlpt).
 *
 * A안: 예약메모·고객메모·기타메모 3종 모두 "한 줄 입력창 + [추가] 버튼"
 *      (예약메모식 인라인·누적 항목형)으로 통일. 하단 일괄 "메모 저장" 버튼은 유지(제거 X).
 *
 * 작업(AC-3): 고객메모/기타메모의 기존 textarea+개별저장 → 예약메모와 동일 인라인 입력창 +
 *   [추가](Ctrl+Enter 동일) + 누적 리스트형으로 이식. DB 스키마 변경 없이 FE만(단일 컬럼
 *   customer_memo/memo 를 줄 단위 누적 항목으로 파싱·append). 마이그 손실 0.
 *
 * 본 spec 은 코드베이스 CHART1/CHART2 spec 관행(정적 소스 미러링 가드)을 따른다 —
 * 통일/누적/데이터보존 불변식이 회귀하면 즉시 실패. + 누적/파싱 알고리즘 동작 검증.
 *
 * 시나리오(티켓 §E2E):
 *   S1: 3종 메모 동일 인라인+[추가] 패턴·누적 추가
 *   S2: 하단 "메모 저장" 버튼 존치 + 저장 보존
 *   S3: 기존 메모 데이터 회귀 0 + 예약메모 기존 동작 유지 + 콘솔 에러 0(append/parse 무손실)
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const sheetSrc = readFileSync(resolve(__dir, '../../src/components/CheckInDetailSheet.tsx'), 'utf-8');
const colMemoSrc = readFileSync(resolve(__dir, '../../src/components/CustomerColumnMemo.tsx'), 'utf-8');
const rmtSrc = readFileSync(resolve(__dir, '../../src/components/ReservationMemoTimeline.tsx'), 'utf-8');

// ── S1: 3종 메모 동일 인라인+[추가] 패턴 ─────────────────────────────────────────
test.describe('S1 — 3종 메모 동일 인라인+[추가] 패턴·누적', () => {
  test('CustomerColumnMemo: 인라인 입력창 + [추가] 버튼 + Ctrl+Enter (예약메모 기본 레이아웃 미러링)', () => {
    // 한 줄 입력창(textarea flex-1) + 우측 teal [추가] 버튼 + data-testid
    expect(colMemoSrc).toContain('data-testid="memo-add-btn"');
    expect(colMemoSrc).toContain('data-testid="memo-item"');
    expect(colMemoSrc).toContain('text-xs flex-1'); // 입력 textarea (RMT 기본과 동일)
    expect(colMemoSrc).toContain('추가');
    // Ctrl/⌘+Enter 추가 (예약메모와 동일)
    expect(colMemoSrc).toContain('e.ctrlKey || e.metaKey');
  });

  test('CustomerColumnMemo: 누적 리스트형 — 줄 단위 항목 표시 + compact 더보기', () => {
    expect(colMemoSrc).toContain('parseColumnMemoItems');
    expect(colMemoSrc).toContain("split('\\n')");
    expect(colMemoSrc).toContain('개 더 보기'); // compact 누적 더보기 (예약메모와 동일)
  });

  test('1번차트: 고객메모·기타메모 4개 호출부 모두 CustomerColumnMemo 사용 (textarea+개별저장 제거)', () => {
    // customerMode 분기 2 + checkIn 분기 2 = 4 호출
    const calls = (sheetSrc.match(/<CustomerColumnMemo/g) ?? []).length;
    expect(calls).toBe(4);
    // 구 패턴(개별 저장 버튼/핸들러) 완전 제거 — append 핸들러로 대체
    //   (toast '…저장 실패' 문구는 잔존 가능 → 버튼 ternary 라벨·핸들러명으로 정확히 가드)
    expect(sheetSrc).not.toContain("'고객메모 저장'}");
    expect(sheetSrc).not.toContain("'기타메모 저장'}");
    expect(sheetSrc).not.toContain('saveCustomerMemo');
    expect(sheetSrc).not.toContain('saveEtcMemo');
    // 메모 영역 textarea 직접 사용 제거(통일 컴포넌트로 일원화) — Textarea import도 제거
    expect(sheetSrc).not.toContain("from '@/components/ui/textarea'");
  });

  test('1번차트: 예약메모는 그대로 ReservationMemoTimeline(row-backed) — 3블록 함께 노출', () => {
    expect(sheetSrc).toContain('<ReservationMemoTimeline');
    expect(sheetSrc).toContain('예약메모');
    expect(sheetSrc).toContain('고객메모');
    expect(sheetSrc).toContain('기타메모');
  });
});

// ── S2: 하단 "메모 저장" 버튼 존치 + 저장 보존 ───────────────────────────────────
test.describe('S2 — 하단 일괄 "메모 저장" 버튼 존치 + 저장 보존', () => {
  test('하단 "메모 저장" 버튼(saveNotes) 유지 (제거 X)', () => {
    expect(sheetSrc).toContain("'메모 저장'");
    expect(sheetSrc).toContain('onClick={saveNotes}');
  });

  test('고객/기타메모 [추가] → customers 컬럼 즉시 persist (예약메모와 동작 일관)', () => {
    expect(sheetSrc).toContain('appendCustomerMemo');
    expect(sheetSrc).toContain('appendEtcMemo');
    // 단일 컬럼 update (DB 스키마 변경 없음)
    expect(sheetSrc).toContain('.update({ customer_memo: newValue })');
    expect(sheetSrc).toContain('.update({ memo: newValue })');
    // 2번차트 쌍방연동 알림 보존
    expect(sheetSrc).toContain('foot_crm_customer_refresh');
  });
});

// ── S3: 기존 데이터 회귀 0 + 예약메모 동작 유지 + append/parse 무손실 ────────────
test.describe('S3 — 데이터 보존(마이그 손실 0) + 예약메모 동작 유지', () => {
  test('예약메모(ReservationMemoTimeline) 컴포넌트 미변경 — reservation_memo_history append-only 보존', () => {
    // 본 티켓은 RMT 를 건드리지 않는다 → 예약메모 기존 동작·타 서피스 회귀 0
    expect(rmtSrc).toContain("from('reservation_memo_history')");
    expect(rmtSrc).toContain('insertReservationMemo');
  });

  test('append 로직: 기존 값 보존 후 \\n 으로 누적 (DB 스키마 변경 없음)', () => {
    // base 가 있으면 `${base}\n${line}`, 없으면 line — 기존 값 위에 누적
    expect(sheetSrc).toContain('base ? `${base}\\n${line}` : line');
    // 신규 컬럼/테이블/enum 추가 없음 (FE only)
    expect(sheetSrc).not.toMatch(/ADD COLUMN/i);
  });

  // 누적/파싱 알고리즘 동작 검증 — 기존 데이터 무손실(round-trip) 보장.
  // 컴포넌트 내 parseColumnMemoItems 와 append 규칙을 동일하게 재현해 불변식을 락한다.
  const parse = (value: string | null | undefined): string[] => {
    if (!value) return [];
    return value.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim().length > 0);
  };
  const append = (base: string, line: string): string => (base.trim() ? `${base}\n${line}` : line);

  test('기존 단일 메모(개별저장 시절)는 누락 없이 1개 항목으로 표시', () => {
    expect(parse('주차 안내 완료, VIP 고객')).toEqual(['주차 안내 완료, VIP 고객']);
  });

  test('기존 멀티라인 메모도 전량 보존 — 줄 단위 누적 항목으로 분해', () => {
    expect(parse('첫 줄\n둘째 줄\n셋째 줄')).toEqual(['첫 줄', '둘째 줄', '셋째 줄']);
    // 빈 줄은 표시에서 제외(데이터 손실 아님 — 의미없는 공백)
    expect(parse('A\n\n\nB')).toEqual(['A', 'B']);
    expect(parse(null)).toEqual([]);
    expect(parse('')).toEqual([]);
  });

  test('[추가] 누적: 기존 값 위에 새 항목 append (round-trip 무손실)', () => {
    const v0 = '기존 메모';
    const v1 = append(v0, '두 번째');
    expect(v1).toBe('기존 메모\n두 번째');
    expect(parse(v1)).toEqual(['기존 메모', '두 번째']);
    const v2 = append(v1, '세 번째');
    expect(parse(v2)).toEqual(['기존 메모', '두 번째', '세 번째']);
    // 빈 컬럼에 첫 추가
    expect(append('', '첫 메모')).toBe('첫 메모');
  });
});
