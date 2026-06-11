import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/**
 * T-20260611-foot-PROGRESS-CAL-SESSION-AUTOLINK — 경과분석 캘린더 정비 3건
 * 원천: NEW-TASK MSG-20260611-183845-dqfl (김주연 총괄 요청, P2, GO_WARN).
 *
 * Surface(diff-first 확정): src/pages/Reservations.tsx 예약현황 캘린더의 경과분석 뷰(filterProgress ON).
 *   경과분석 태그/회차 배지가 존재하는 유일 surface. ClinicCalendar.tsx 는 progress 무관.
 *   부모: T-20260526-foot-PROGRESS-CHECKPOINT(AC-4 '다음날 예약현황에서 경과분석 태그 환자만 보기').
 *
 * §1 회차 명확화: 경과분석 배지에 '체크포인트' 접미 + 경과분석 뷰에서 글자 강조.
 *               회차값은 progress_check_label(plan.session_milestone 반영) 재사용 — 신설 없음.
 * §2 예약생성(+) 제거: 경과분석 뷰(조회 전용)에서 슬롯 (+) 및 상단 '새 예약' 숨김.
 *               BATCH-CHECKIN-LEAK 선례와 동일 가드. 일반 달력은 (+) 유지(유일 진입점 아님).
 * §3 자동연동: filterProgress 시 progress_check_required=TRUE 환자만 노출(AC-4 read-only 필터 재사용).
 *
 * dedupe: 본 (+)는 슬롯/페이지 버튼 — TOPBAR-RESV-BTN-REMOVE(AdminLayout 헤더 btn-header-make-reservation)와 별개.
 *
 * 거대-인라인 컴포넌트(Reservations.tsx) 관례 = source-integrity gating(소스 정적 단언).
 * 실 브라우저 렌더/토글 동작은 supervisor field-soak 로 닫음. DB 무관(FE-only).
 */

const RESV = fs.readFileSync(path.resolve('src/pages/Reservations.tsx'), 'utf-8');

// 슬롯 (+) 버튼 렌더 블록(가드 직전~버튼) 추출 헬퍼
const slotPlusGuard = (() => {
  const anchor = RESV.indexOf('data-testid={`slot-plus-${dateStr}-${time}`}');
  // 가드 조건은 버튼 바로 앞 약 400자 내에 존재
  return anchor >= 0 ? RESV.slice(Math.max(0, anchor - 400), anchor) : '';
})();

// ═══════════════════════════════════════════════════════════════════════════
// §1 — 회차 명확화 (경과분석 체크포인트 표기)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('§1 회차 명확화', () => {
  test('§1-1: 경과분석 배지에 "체크포인트" 접미 표기 추가', () => {
    expect(RESV, '경과분석 배지에 체크포인트 라벨이 없음')
      .toContain('체크포인트');
  });

  test('§1-2: 회차값은 progress_check_label 재사용 (신설 회차 계산 없음)', () => {
    // 배지는 여전히 progress_check_label 을 출력원으로 사용해야 함
    expect(RESV).toContain('r.progress_check_label ?? ');
    // 배지 testid 보존
    expect(RESV).toContain('data-testid={`progress-badge-${r.id}`}');
  });

  test('§1-3: 경과분석 뷰에서 배지 글자 강조 분기', () => {
    // filterProgress 에 따라 글자 크기/굵기 분기 (text-[10px] font-semibold)
    expect(RESV).toMatch(/filterProgress\s*\?\s*'text-\[10px\] font-semibold'/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §2 — 예약생성(+) 제거 (경과분석 뷰 조회 전용)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('§2 예약생성(+) 제거', () => {
  test('§2-1: 슬롯 (+) 버튼은 filterProgress 가드 하에만 렌더', () => {
    expect(slotPlusGuard, 'slot-plus 가드에 !filterProgress 조건이 없음')
      .toContain('!filterProgress && !full');
  });

  test('§2-2: 상단 "새 예약" 버튼도 경과분석 뷰에서 숨김', () => {
    // 새 예약 버튼 라벨(</Button> 직전) 위치를 기준으로, 그 앞에 filterProgress 가드 블록이 존재해야 함.
    const labelIdx = RESV.indexOf('새 예약\n');
    expect(labelIdx, '새 예약 버튼 라벨을 찾지 못함').toBeGreaterThan(0);
    const before = RESV.slice(Math.max(0, labelIdx - 1200), labelIdx);
    expect(before, '상단 새 예약 버튼에 filterProgress 가드가 없음')
      .toContain('!filterProgress && (');
  });

  test('§2-3: openNewSlot 로직 자체는 불변 (렌더 가드만)', () => {
    // 슬롯 생성 핸들러는 그대로 존재 (로직 삭제 아님)
    expect(RESV).toContain('openNewSlot(d, time)');
  });

  test('§2-4: dedupe — 헤더 btn-header-make-reservation 와 무관 (Reservations 에 없음)', () => {
    expect(RESV).not.toContain('btn-header-make-reservation');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §3 — 경과분석 필요 대상만 자동연동 (read-only 필터 재사용)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('§3 자동연동 표기', () => {
  test('§3-1: filterProgress 시 progress_check_required 대상만 노출', () => {
    expect(RESV).toContain('filterProgress ? list.filter(r => r.progress_check_required) : list');
  });

  test('§3-2: 경과분석 필터 토글 버튼 보존', () => {
    expect(RESV).toContain('data-testid="progress-filter-btn"');
  });
});
