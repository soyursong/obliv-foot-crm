/**
 * T-20260622-foot-CHART2-UICLEAN-4FIX — 2번차트 UI 정리 4건 (저위험 fast-track)
 *
 * 김주연 총괄(풋센터) 요청. 부모 T-20260622-foot-CHART2-11FIX-MEMO-INSURANCE item5·6 이관 + item7·8.
 *   요청5: 펜차트 발건강질문지 자가작성 — 하단 '셀프접수 QR 다시보기' 섹션 제거(상단 'QR 보기'와 중복).
 *   요청6: 진료내역 탭(방문이력) — 메모유형 필터버튼 3개(치료메모/진료메모/특이사항) 제거, '전체 펼치기'만 유지.
 *   요청7: 검사결과 탭 — 상단 '1번↔2번차트 쌍방연동' 안내문구 제거.
 *   요청8: 예약내역 탭 — (a) 변경이력 0건이면 칸 숨김, (b) '예약메모 추가' 고정칸 제거 → 연필 클릭 시에만 입력칸.
 *
 * 4건 모두 순수 FE 제거/숨김/인터랙션 변경(DDL·데이터 무변경). 본 spec 은 소스 구조를
 * 미러링해 회귀 시 즉시 실패시키는 정적 가드(코드베이스 CHART2 spec 관행).
 * ⚠ 회귀 금지: 요청6 surface 는 TREATTABLE 날짜필터(별도 TreatmentTable.tsx)와 무관 — 전체펼치기 유지 검증.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const chartSrc = readFileSync(resolve(__dir, '../../src/pages/CustomerChartPage.tsx'), 'utf-8');
const healthQSrc = readFileSync(resolve(__dir, '../../src/components/HealthQResultsPanel.tsx'), 'utf-8');
const auditSrc = readFileSync(resolve(__dir, '../../src/components/ReservationAuditLogPanel.tsx'), 'utf-8');

// ── 요청5: 발건강질문지 자가작성 QR 중복 제거 ────────────────────────────────
test.describe('요청5 — 셀프접수 QR 다시보기 섹션 제거 (HealthQResultsPanel)', () => {
  test('AC-5: 하단 "셀프접수 QR 다시보기" 섹션·버튼·상태가 모두 제거됨', () => {
    expect(healthQSrc).not.toContain('셀프접수 QR 다시보기');
    expect(healthQSrc).not.toContain('healthq-reopen-section');
    expect(healthQSrc).not.toContain('healthq-reopen-qr-btn');
    expect(healthQSrc).not.toContain('healthq-reopen-status');
    expect(healthQSrc).not.toContain('reopenTok');
    expect(healthQSrc).not.toContain('loadReopenToken');
    expect(healthQSrc).not.toContain('health_q_tokens'); // 다시보기용 read 쿼리 제거
  });

  test('AC-5: 상단 "QR 보기" 진입점은 1개만 유지(회귀 없음)', () => {
    expect(healthQSrc).toContain('healthq-qr-view-btn');
    expect(healthQSrc).toContain('QR 보기');
    // 링크 발급·복사·미리보기 회귀 0
    expect(healthQSrc).toContain('링크 생성');
    expect(healthQSrc).toContain('fn_health_q_create_token');
  });
});

// ── 요청6: 진료내역(방문이력) 메모유형 필터버튼 제거 ──────────────────────────
test.describe('요청6 — 진료내역 탭 메모유형 필터버튼 3개 제거', () => {
  // 방문이력 패널 = chartTabGroup === 'history' && chartTab === 'treatments'
  const start = chartSrc.indexOf("chartTab === 'treatments' && (() =>");
  const end = chartSrc.indexOf("chartTab === 'test_result'", start > -1 ? start : 0);
  const panel = start > -1 && end > start ? chartSrc.slice(start, end) : '';

  test('패널 블록 추출 성공', () => {
    expect(start).toBeGreaterThan(-1);
    expect(panel.length).toBeGreaterThan(0);
  });

  test('AC-6: 메모유형 필터칩(치료메모/진료메모/특이사항)·전체해제·카운트 제거', () => {
    expect(panel).not.toContain('visit-hist-filter-'); // 필터칩 testid 제거
    expect(panel).not.toContain('visit-hist-filter-clear');
    expect(panel).not.toContain("['치료메모', '진료메모', '특이사항'] as const"); // 칩 렌더 배열 제거
  });

  test('AC-6: 필터 state(visitHistFilters)도 완전 제거', () => {
    expect(chartSrc).not.toContain('visitHistFilters');
    expect(chartSrc).not.toContain('setVisitHistFilters');
  });

  test('AC-6 회귀: "전체 펼치기" 토글은 유지', () => {
    expect(panel).toContain('visit-hist-fold-all-btn');
    expect(panel).toContain('전체 펼치기');
    expect(panel).toContain('전체 접기');
  });
});

// ── 요청7: 검사결과 탭 상단 안내문구 제거 ────────────────────────────────────
test.describe('요청7 — 검사결과 탭 "1번↔2번차트 쌍방연동" 문구 제거', () => {
  const start = chartSrc.indexOf("chartTab === 'test_result' && (");
  const end = chartSrc.indexOf("chartTab === 'pen_chart' && (", start > -1 ? start : 0);
  const block = start > -1 && end > start ? chartSrc.slice(start, end) : '';

  test('검사결과 탭 블록 추출 성공', () => {
    expect(start).toBeGreaterThan(-1);
    expect(block.length).toBeGreaterThan(0);
  });

  test('AC-7: 검사결과 탭 내 "1번↔2번차트 쌍방연동" 문구 미노출', () => {
    expect(block).not.toContain('1번↔2번차트 쌍방연동');
    // 검사결과 본기능(KOH균검사 업로드·발행결과)은 유지
    expect(block).toContain('KOH균검사');
    expect(block).toContain('KohPublishedResults');
  });
});

// ── 요청8: 예약내역 탭 간소화 ────────────────────────────────────────────────
test.describe('요청8 — 예약내역 탭 변경이력 숨김 + 예약메모 고정칸 제거', () => {
  const start = chartSrc.indexOf("chartTab === 'reservations' && (");
  const end = chartSrc.indexOf("chartTab === 'test_result'", start > -1 ? start : 0);
  const tab = start > -1 && end > start ? chartSrc.slice(start, end) : '';

  test('예약내역 탭 블록 추출 성공', () => {
    expect(start).toBeGreaterThan(-1);
    expect(tab.length).toBeGreaterThan(0);
  });

  test('AC-8a: ReservationAuditLogPanel 이 hideWhenEmpty 로 호출됨', () => {
    expect(tab).toContain('ReservationAuditLogPanel');
    expect(tab).toContain('hideWhenEmpty');
  });

  test('AC-8a: 공유 컴포넌트가 hideWhenEmpty=true 시 빈 이력에서 null 반환', () => {
    expect(auditSrc).toContain('hideWhenEmpty');
    // loading + 빈 displayLogs 두 분기에서 hideWhenEmpty 시 return null
    const nullReturns = auditSrc.split('if (hideWhenEmpty) return null;').length - 1;
    expect(nullReturns).toBe(2);
  });

  test('AC-8b: "예약메모 추가" 고정 입력칸(placeholder display) 제거 → 연필 add 아이콘만', () => {
    // 빈 메모 시 더 이상 "예약메모 추가" placeholder 텍스트 행을 노출하지 않음
    expect(tab).not.toContain("r.booking_memo || '예약메모 추가'");
    // 메모 없을 때 연필(수정) 아이콘 add 진입점
    expect(tab).toContain('resv-memo-add-icon');
    // 클릭 시 편집 진입(setEditingResvMemoId) — 입력칸 생성
    expect(tab).toContain('setEditingResvMemoId(r.id)');
  });

  test('AC-8b 회귀: 메모 있을 때 표시·저장·편집 폼 경로는 유지', () => {
    expect(tab).toContain('resv-memo-display'); // 메모 텍스트 표시
    expect(tab).toContain('resv-memo-edit-form'); // 편집 입력폼
    expect(tab).toContain('resv-memo-save'); // 저장
    expect(tab).toContain('saveResvMemo(r.id)');
  });
});
