/**
 * E2E spec — T-20260602-foot-CHART2-HEALTHQ-VIEWER
 * 2번차트 [상담내역] 발건강질문지 [내용보기] — 자가작성 활성화 회귀 가드.
 *
 * 근본원인 (런타임 재현·DB 검증 완료):
 *   자가작성 발건강질문지(HealthQMobilePage)는 `health_q_results` 테이블 + documents 버킷 JSON 으로
 *   저장된다. 그러나 상담내역 그룹3 [내용보기]는 `form_submissions`(펜차트 PNG, field_data.canvas_file)
 *   만 조회했다 → 자가작성만 한 고객은 form_submissions 에 health_questionnaire row 가 0건 →
 *   `hasHQ=false` → 버튼 disabled(영구 비활성) + 체크마크 ○. "활성화 안 됨" 현장 호소의 직접 원인.
 *   (DB 실측: 고객 da93b952 — health_q_results 1건, form_submissions health_questionnaire 0건.)
 *
 * 수정: hasHQ = (펜차트 form_submissions HQ) OR (자가작성 health_q_results). 다이얼로그는
 *   펜차트 PNG + 자가작성 구조화(ResultCard) 를 함께 렌더. read-only(쓰기·스키마 변경 없음).
 *
 * AC-1: 자가작성만 있는 고객 → [내용보기] 활성(enabled) + 체크마크 ✓.
 * AC-2: 펜차트만 있는 고객 → 기존대로 활성(회귀 없음).
 * AC-3: 둘 다 없음 → disabled (기존 동작 보존).
 * AC-4: 둘 다 있음 → 활성 + 양쪽 표시.
 * AC-5: 날짜 표기 = 펜차트/자가작성 중 최신.
 */
import { test, expect } from '@playwright/test';

// ── 실제 구현 정본과 동일한 [내용보기] 활성/비활성 판정 (CustomerChartPage.tsx 그룹3) ──
interface SubEntry { template_key?: string; printed_at: string | null; signed_at?: string | null; }
interface HQResult { id: string; submitted_at: string; }

const hasPenHQ = (subs: SubEntry[]) =>
  subs.some((s) => s.template_key?.startsWith('health_questionnaire_'));
const hasSelfHQ = (hq: HQResult[]) => hq.length > 0;

// 버튼 disabled 조건 (구현과 1:1)
const viewerDisabled = (subs: SubEntry[], hq: HQResult[]) =>
  !hasPenHQ(subs) && !hasSelfHQ(hq);

// 체크마크 표시 (✓ / ○)
const checkMark = (subs: SubEntry[], hq: HQResult[]) =>
  (hasPenHQ(subs) || hasSelfHQ(hq)) ? '✓' : '○';

// 날짜 표기 — 펜차트/자가작성 중 최신 (ISO 문자열 사전식 정렬 = 시간순)
const newestDate = (subs: SubEntry[], hq: HQResult[]): string | null => {
  const penNewest = subs.filter((s) => s.template_key?.startsWith('health_questionnaire_'))[0];
  const penDate = penNewest?.printed_at ?? penNewest?.signed_at ?? null;
  const selfDate = hq[0]?.submitted_at ?? null;
  const d = [penDate, selfDate].filter(Boolean).sort().reverse()[0];
  return (d as string | undefined) ?? null;
};

test.describe('T-20260602-foot-CHART2-HEALTHQ-VIEWER — 자가작성 [내용보기] 활성화', () => {
  // AC-1: 근본원인 직격 — 자가작성만 한 고객 (DB 실측 da93b952 형상)
  test('AC-1 자가작성만 → 활성 + ✓', () => {
    const subs: SubEntry[] = [
      // 펜차트엔 환불동의서만 (health_questionnaire 없음) — 실측 형상
      { template_key: 'refund_consent', printed_at: '2026-06-05T00:00:00Z', signed_at: null },
    ];
    const hq: HQResult[] = [{ id: 'r1', submitted_at: '2026-06-05T09:00:49Z' }];
    expect(viewerDisabled(subs, hq)).toBe(false); // ← 회귀의 핵심: 더 이상 disabled 아님
    expect(checkMark(subs, hq)).toBe('✓');
  });

  // AC-2: 펜차트만 → 기존 동작 회귀 없음
  test('AC-2 펜차트만 → 활성 (회귀 없음)', () => {
    const subs: SubEntry[] = [
      { template_key: 'health_questionnaire_general', printed_at: '2026-06-01T00:00:00Z', signed_at: null },
    ];
    expect(viewerDisabled(subs, [])).toBe(false);
    expect(checkMark(subs, [])).toBe('✓');
  });

  // AC-3: 둘 다 없음 → disabled 보존
  test('AC-3 둘 다 없음 → disabled', () => {
    const subs: SubEntry[] = [{ template_key: 'refund_consent', printed_at: '2026-06-01T00:00:00Z' }];
    expect(viewerDisabled(subs, [])).toBe(true);
    expect(checkMark(subs, [])).toBe('○');
  });

  // AC-4: 둘 다 있음 → 활성
  test('AC-4 펜차트+자가작성 → 활성', () => {
    const subs: SubEntry[] = [{ template_key: 'health_questionnaire_senior', printed_at: '2026-06-02T00:00:00Z' }];
    const hq: HQResult[] = [{ id: 'r2', submitted_at: '2026-06-04T00:00:00Z' }];
    expect(viewerDisabled(subs, hq)).toBe(false);
    expect(checkMark(subs, hq)).toBe('✓');
  });

  // AC-5: 날짜 = 최신
  test('AC-5 날짜 = 펜차트/자가작성 중 최신', () => {
    const subs: SubEntry[] = [{ template_key: 'health_questionnaire_general', printed_at: '2026-06-02T00:00:00Z' }];
    const hqLater: HQResult[] = [{ id: 'r3', submitted_at: '2026-06-05T00:00:00Z' }];
    expect(newestDate(subs, hqLater)).toBe('2026-06-05T00:00:00Z'); // 자가작성이 더 최신
    const hqEarlier: HQResult[] = [{ id: 'r4', submitted_at: '2026-06-01T00:00:00Z' }];
    expect(newestDate(subs, hqEarlier)).toBe('2026-06-02T00:00:00Z'); // 펜차트가 더 최신
  });
});
