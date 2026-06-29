/**
 * T-20260629-foot-CHART1-FORMAT-UNIFY
 *   1번차트(CheckInDetailSheet) 전면 통일. 김주연 총괄(풋센터) 확정 지시
 *   (MSG-20260629-170324-ows1, thread 1782719067.945099).
 *
 * 대시보드 1번차트(checkIn 모드) ↔ 고객관리 1번차트(customerMode) 양 패널을 통일:
 *   AC-1: 상단 고객정보 영역 통일 — 대시보드(checkIn) 패널에도 생년월일(YYYY-MM-DD) 표기 추가.
 *         데이터=기존 RRN 파생 RPC(fn_customer_birthdates) 재사용(T-20260613-BIRTHDATE-FROM-RRN), 신규 DDL 0.
 *   AC-2: 고객차트/진료차트 버튼 구성 통일 — 고객관리(customerMode) 헤더 단독 [고객차트(2번)]
 *         → 대시보드 기준 [고객차트][진료차트] 2버튼 행(동일 outline teal/sage 구성). 기능 회귀 0.
 *   AC-3: 노란색 완전 제거 → 쿨그레이 모노톤 통일 — 예약메모/고객메모/기타메모의 amber 배경을
 *         기존 모노톤 토큰(border-border bg-card / text-muted-foreground)으로 교체. 신규 팔레트 0.
 *
 * 본 spec 은 코드베이스 CHART1/CHART2 spec 관행(정적 소스 미러링 가드)을 따른다 —
 * 통일/생년월일/노란색-제거 불변식이 회귀하면 즉시 실패.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const sheetSrc = readFileSync(resolve(__dir, '../../src/components/CheckInDetailSheet.tsx'), 'utf-8');
const colMemoSrc = readFileSync(resolve(__dir, '../../src/components/CustomerColumnMemo.tsx'), 'utf-8');
const rmtSrc = readFileSync(resolve(__dir, '../../src/components/ReservationMemoTimeline.tsx'), 'utf-8');
const resvPopupSrc = readFileSync(resolve(__dir, '../../src/components/ReservationDetailPopup.tsx'), 'utf-8');
const custChartSrc = readFileSync(resolve(__dir, '../../src/pages/CustomerChartPage.tsx'), 'utf-8');

// ── AC-1: 생년월일 통일 ───────────────────────────────────────────────────────
test.describe('AC-1 — 상단 고객정보 영역 통일(생년월일 추가)', () => {
  test('대시보드(checkIn) + 고객관리(customerMode) 양쪽 1번차트가 생년월일 row 표기', () => {
    // data-testid는 화면당 2회 이상 노출(양 모드 공유) — customerMode 1회 + checkIn 1회
    const occurrences = (sheetSrc.match(/data-testid="cust-detail-birthdate"/g) ?? []).length;
    expect(occurrences).toBeGreaterThanOrEqual(2);
    // 미등록 폴백 문구 통일
    expect(sheetSrc).toContain("생년월일 미등록");
  });

  test('생년월일 데이터는 서버 RPC 파생값만(PHI: rrn 평문/뒷자리 미노출) — 신규 컬럼/DDL 없음', () => {
    // checkIn 모드도 동일 RPC(fn_customer_birthdates)로 birth_date_display 파생
    expect(sheetSrc).toContain('fn_customer_birthdates');
    expect(sheetSrc).toContain('birth_date_display');
    // checkIn 모드 fetch 분기 추가 확인 (customerMode 외 1곳 이상)
    const rpcCalls = (sheetSrc.match(/rpc\('fn_customer_birthdates'/g) ?? []).length;
    expect(rpcCalls).toBeGreaterThanOrEqual(2);
  });
});

// ── AC-2: 버튼 구성 통일 ──────────────────────────────────────────────────────
test.describe('AC-2 — 고객차트/진료차트 버튼 구성 통일(대시보드 기준)', () => {
  test('양 모드 모두 [고객차트] outline-teal 버튼 보유', () => {
    expect(sheetSrc).toContain('border-teal-400 text-teal-700 hover:bg-teal-50');
    // "고객차트" 라벨 (헤더 (2번) 단독 표기 제거 — 본문 2버튼 행으로 통일)
    expect(sheetSrc).toContain('고객차트');
    // 구 헤더 단독 버튼 라벨 제거
    expect(sheetSrc).not.toContain('고객차트(2번)');
  });

  test('양 모드 모두 [진료차트] outline-sage 버튼 보유(onOpenMedicalChart 연동, 단순 제거 아님)', () => {
    const medBtns = (sheetSrc.match(/border-sage-400 text-sage-700 hover:bg-sage-50/g) ?? []).length;
    expect(medBtns).toBeGreaterThanOrEqual(2); // checkIn + customerMode
    expect(sheetSrc).toContain('진료차트');
    // customerMode도 onOpenMedicalChart로 진료차트 연결
    expect(sheetSrc).toContain('onOpenMedicalChart(customerMode.customerId)');
  });
});

// ── AC-3: 노란색 완전 제거 → 쿨그레이 모노톤 ──────────────────────────────────
test.describe('AC-3 — 노란색 완전 제거 → 쿨그레이 모노톤 통일', () => {
  test('예약메모(ReservationMemoTimeline): 비고정 메모 amber 배경 제거 → border-border bg-card 모노톤', () => {
    expect(rmtSrc).not.toContain('bg-amber-50');
    expect(rmtSrc).not.toContain('border-amber-200');
    expect(rmtSrc).not.toContain('text-amber-600');
    // tone prop(amber/neutral 분기) 자체 폐지 — 단일 모노톤
    expect(rmtSrc).not.toContain("tone?: 'amber' | 'neutral'");
    expect(rmtSrc).toContain('border-border bg-card');
  });

  test('고객/기타메모(CustomerColumnMemo): amber 카드 → border-border bg-card 모노톤', () => {
    expect(colMemoSrc).not.toContain('bg-amber-50');
    expect(colMemoSrc).not.toContain('border-amber-200');
    expect(colMemoSrc).toContain('border-border bg-card');
  });

  test('tone="neutral" 전달 호출부 정리(prop 제거 회귀 가드) — 빌드 무결', () => {
    expect(resvPopupSrc).not.toContain('tone="neutral"');
    expect(custChartSrc).not.toContain('tone="neutral"');
  });
});

// ── 회귀 가드: 메모 기능/고정(pin) 보존 ───────────────────────────────────────
test.describe('회귀 가드 — 메모 동작·고정 보존', () => {
  test('예약메모 고정(pin) 카드는 teal 톤 유지(노란색 제거가 pin 기능을 깨지 않음)', () => {
    expect(rmtSrc).toContain('border-teal-300 bg-teal-50');
  });

  test('메모 입력/추가 동작(data-testid) 보존', () => {
    expect(colMemoSrc).toContain('data-testid="memo-add-btn"');
    expect(rmtSrc).toContain("data-testid={item.is_pinned ? 'memo-pinned' : 'memo-item'}");
  });
});
