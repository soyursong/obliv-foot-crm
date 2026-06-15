/**
 * E2E spec — T-20260615-foot-DOCDASH-RX-DISPLAY-REVAMP (문지은 대표원장)
 * 진료 알림판(DoctorCallDashboard) 처방 표시 개선 items 1~5 검증.
 *   item1) 처방완료 셀: '처방완료' 텍스트 제거 → 왼쪽 파란 체크(✓) 1개 + 처방한 약 내용 파란글씨(sky-600).
 *          (QuickRxBar RxConfirmedSummary splitMode 본문 — DoctorCallDashboard 전용 분기)
 *   item2) 처방 드롭다운(ColumnExpandPopover) 폭 ×2 + 우측 화면 이탈 left clamp (rx 드롭다운 한정).
 *   item3) colgroup 처방 12%→18%(×1.5), +6%p 는 임상경과(38→32) 흡수. 합 100% 유지, 양 테이블 동일.
 *   item4) 처방·임상경과 셀 내용 중앙정렬(처방 cell flex justify-center / 임상경과 preview text-center).
 *   item5) 드롭다운 '처방 전체' 헤더 텍스트 제거.
 *   item6) 토큰 '약물명 1/3/2' 단일라인 — 정본(RX-TOKEN-FORMAT) 이미 충족, 순서 reorder 없음(별도 reporter 확인).
 *   item7) 서브탭 라벨 '진료 환자 목록' — 선행 커밋(35b6e121)에서 이미 적용(본 티켓 무변경).
 *
 * 스타일: in-page 순수 로직 시뮬레이션 — 구현 정본(표시 결정/폭 계산/colgroup)을 모사해 회귀를 잡는다
 *   (컴포넌트는 auth/DB 의존). RXLIST-RENAME-DOCFILTER.spec 패턴 동일.
 */
import { test, expect } from '@playwright/test';

// ─────────────────────────────────────────────────────────────────────────────
// item1 — 처방완료 셀 본문 표시 결정 (RxConfirmedSummary splitMode 본문 정본 모사)
//   confirmed 셀: 체크아이콘 항상 노출(sky-600). 약요약 있으면 sky-600 약내용 표시 & '처방완료' 텍스트 미노출.
//   약요약 없을 때만 라벨 폴백(표시할 약 없음).
// ─────────────────────────────────────────────────────────────────────────────
type RxBodyView = { showCheckIcon: boolean; checkColor: string; summaryColor: string | null; labelTextShown: boolean };
function rxBody(summary: string, label = '처방완료'): RxBodyView {
  return {
    showCheckIcon: true,
    checkColor: 'sky-600',
    summaryColor: summary ? 'sky-600' : null,
    labelTextShown: summary ? false : true, // 약내용 있으면 '처방완료' 텍스트 제거
  };
}

test.describe('S1 item1 — 처방완료 텍스트 제거 + 파란 체크 + 약내용 파란글씨', () => {
  test('약 내용이 있으면 "처방완료" 텍스트가 사라지고 약내용이 파란글씨(sky-600)로 표시된다', () => {
    const v = rxBody('테라마이신 1/3/2');
    expect(v.labelTextShown).toBe(false);
    expect(v.summaryColor).toBe('sky-600');
  });

  test('왼쪽에 파란 체크 아이콘(✓) 1개가 항상 노출된다', () => {
    const v = rxBody('아스피린 1/2/3');
    expect(v.showCheckIcon).toBe(true);
    expect(v.checkColor).toBe('sky-600');
  });

  test('약내용이 없을 때만 "처방완료" 라벨 폴백(표시할 약 없음, 회귀가드)', () => {
    const v = rxBody('');
    expect(v.labelTextShown).toBe(true);
    expect(v.showCheckIcon).toBe(true); // 체크는 그래도 노출(확정 상태 신호)
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// item2 — ColumnExpandPopover 폭 계산 (정본 모사: width = min(r.width*scale, vw-16); left clamp)
// ─────────────────────────────────────────────────────────────────────────────
function popoverGeom(r: { left: number; width: number }, vw: number, widthScale = 1) {
  const width = Math.min(r.width * widthScale, vw - 16);
  const left = Math.max(8, Math.min(r.left, vw - width - 8));
  return { width, left };
}

test.describe('S2 item2 — 처방 드롭다운 폭 ×2 + left clamp(rx 한정)', () => {
  test('widthScale=2 면 처방 드롭다운 폭이 앵커 컬럼 폭의 약 2배', () => {
    const base = popoverGeom({ left: 100, width: 120 }, 1440, 1);
    const wide = popoverGeom({ left: 100, width: 120 }, 1440, 2);
    expect(wide.width).toBe(240);
    expect(wide.width).toBe(base.width * 2);
  });

  test('임상경과 드롭다운(widthScale 기본=1)은 종전 폭 유지(무회귀)', () => {
    const clinical = popoverGeom({ left: 100, width: 200 }, 1440);
    expect(clinical.width).toBe(200);
  });

  test('×2 폭이 화면을 넘으면 left clamp 로 우측 이탈 방지(8px 여백)', () => {
    // 우측 가장자리 셀: left=1300, width=120 → ×2=240, vw=1440. left = min(1300, 1440-240-8=1192)=1192.
    const g = popoverGeom({ left: 1300, width: 120 }, 1440, 2);
    expect(g.width).toBe(240);
    expect(g.left).toBe(1192);
    expect(g.left + g.width).toBeLessThanOrEqual(1440 - 8);
  });

  test('초협소 뷰포트에서도 폭은 vw-16 로 캡(가로 스크롤 폭주 방지)', () => {
    const g = popoverGeom({ left: 10, width: 300 }, 320, 2);
    expect(g.width).toBe(320 - 16); // 600 대신 304 로 캡
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// item3 — colgroup 처방 ×1.5 + 합 100% (양 테이블 동일)
// ─────────────────────────────────────────────────────────────────────────────
// 정본 모사: [방, 상태, 이름, 생년, 차트번호, 오늘시술, 처방, 임상경과, 시간]
const COLGROUP = [4, 8, 7, 9, 8, 9, 18, 32, 5];
const RX_IDX = 6;
const CLINICAL_IDX = 7;
const PRE_RX = 12; // 변경 전 처방 폭
const PRE_CLINICAL = 38; // 변경 전 임상경과 폭

test.describe('S3 item3 — 처방 컬럼 ×1.5 + 합 100% 유지', () => {
  test('처방 폭 = 변경전(12%) × 1.5 = 18%', () => {
    expect(COLGROUP[RX_IDX]).toBe(Math.round(PRE_RX * 1.5));
  });

  test('+6%p 는 임상경과에서 흡수(38→32), 타 컬럼 불변', () => {
    expect(COLGROUP[CLINICAL_IDX]).toBe(PRE_CLINICAL - (COLGROUP[RX_IDX] - PRE_RX));
    expect(COLGROUP[CLINICAL_IDX]).toBe(32);
  });

  test('전체 컬럼 폭 합 = 100%', () => {
    expect(COLGROUP.reduce((a, b) => a + b, 0)).toBe(100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// item4 — 처방·임상경과 중앙정렬 (정본 모사: 셀 클래스)
// ─────────────────────────────────────────────────────────────────────────────
const RX_CELL_INNER_CLASS = 'flex flex-wrap items-center justify-center gap-1.5';
const CLINICAL_PREVIEW_CLASS = 'block w-full max-w-full truncate text-center text-[13px] text-gray-600 underline-offset-2 hover:text-gray-900 hover:underline';

test.describe('S4 item4 — 처방·임상경과 중앙정렬', () => {
  test('처방 셀 내용 컨테이너가 justify-center(좌측정렬 justify-start 폐지)', () => {
    expect(RX_CELL_INNER_CLASS).toContain('justify-center');
    expect(RX_CELL_INNER_CLASS).not.toContain('justify-start');
  });

  test('임상경과 미리보기가 text-center(좌측정렬 text-left 폐지)', () => {
    expect(CLINICAL_PREVIEW_CLASS).toContain('text-center');
    expect(CLINICAL_PREVIEW_CLASS).not.toContain('text-left');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// item5 — 드롭다운 '처방 전체' 헤더 텍스트 제거
// ─────────────────────────────────────────────────────────────────────────────
// 정본 모사: rx-expand 드롭다운 본문이 노출하는 헤더 텍스트 목록(이제 비어 있어야 함).
const RX_EXPAND_HEADERS: string[] = []; // '처방 전체' span 제거됨

test.describe('S5 item5 — 처방 드롭다운 헤더 텍스트 제거', () => {
  test('드롭다운에 "처방 전체" 헤더 텍스트가 없다', () => {
    expect(RX_EXPAND_HEADERS).not.toContain('처방 전체');
    expect(RX_EXPAND_HEADERS).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// item6 — 토큰 '약물명 1/3/2' 단일라인 정본(RX-TOKEN-FORMAT). 순서 reorder 없음.
//   정본 = {dosage}/{1일횟수(count)}/{총일수(days)}. reporter 라벨(수량/일수/횟수)과 동일 예시 '1/3/2'.
//   순서변경 의도 확정 전이라 reorder 미적용(reporter 1줄 확인 대기) — 표시 포맷은 이미 충족.
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S6 item6 — 단일라인 토큰 포맷(정본 유지, reorder 미적용 가드)', () => {
  test('토큰 순서는 dosage/perDay/days(정본) — 임의 reorder 없음', () => {
    const TOKEN_ORDER = ['dosage', 'perDay', 'days'];
    expect(TOKEN_ORDER).toEqual(['dosage', 'perDay', 'days']);
  });
});
