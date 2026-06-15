import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/**
 * T-20260613-foot-RESVCAL-FOLLOWUP-5FIX — 예약 캘린더 5FIX 후속
 * MQ: MSG-20260613-232101-yr9a (planner NEW-TASK, P1, deadline 2026-06-17).
 *
 * 본 spec 구현 범위 = AC1(완료·회귀) + AC2(신규, FE-only, DB 무변경):
 *   AC1-a 힐러 총인원 합산 포함 — REDEFINITION (a) 확정 (완료, 회귀 고정).
 *     날짜 헤더 총건수 = 초진+재진+힐러(c.n + c.r + c.h). nji4 'HL 제외' supersede.
 *     HL 칩(HL N)은 별도 유지 — 합산+별도표기 병존.
 *   AC2 시간대별 초/재/힐러 카운트 위치 이동 (본 커밋):
 *     슬롯 '고객 박스 위'(RESVCAL item2, slot-kind-count) → 좌측 시간축 라벨(resv-time-col-cell) 이동.
 *     시간축 셀은 행당 1개 → 보이는 날짜(주간 weekDays 6일 / 일간 선택일 1일)의 해당 시간대 활성 예약 합산.
 *     집계 로직·데이터 불변(취소 제외 가드 + resvKind 분류 = 기존 슬롯 칩 동일 시맨틱). 표시 위치만 이동.
 *     '현장 클릭 시나리오 1' 변환: ① 시간축 라벨에 초/재/힐러 카운트 표시 ② 기존 고객 박스 위 카운트 제거
 *     ③ 예약 카드 클릭/우클릭 동선 회귀 0.
 *   ※ AC1-b(슬롯 'HL N' 칩 미표기 = healer_flag 데이터 시맨틱)는 본 5FIX out-of-scope로 분리 이관
 *     → T-20260614-foot-HEALER-RESV-CLASSIFY-DEF(blocked/human_pending). AC2로 슬롯 칩 자체가 제거되어
 *     기존 AC1-b 슬롯 칩 회귀 테스트는 폐기(카운트가 시간축으로 이동).
 *
 * 보류(이번 커밋 제외, planner FOLLOWUP):
 *   AC3 '내 예약 ▼' 드롭 — 블로커 재확인. MQ 1차 검증 게이트 발동:
 *     · reservation_registrars(registrar_id/registrar_name)는 자유선택 마스터명
 *       (마이그 20260610110000 L14/L56-57: "staff 계정과 분리된 운영 명단, 동일 인명도 staff FK 아님").
 *       로그인 신원(auth.uid)과 무연계 → '본인 예약' 필터 의미 성립 불가.
 *     · MQ가 지칭한 `reservation_registrars.registrant` 컬럼은 스키마에 부재.
 *     · reservations.created_by(진짜 로그인 신원 앵커)는 insert 경로 미적재
 *       (RESVCAL-DISPLAY-REWORK item7 보일러플레이트 기 문서화).
 *     → 추정 구현 금지, planner FOLLOWUP. 데이터소스 확정 후 별도 착수.
 *
 * 거대 인라인(Reservations.tsx) 관례 = source-integrity gating. 실 렌더는 supervisor field-soak.
 * DB 무관(FE-only).
 */

const RESV_PAGE = fs.readFileSync(path.resolve('src/pages/Reservations.tsx'), 'utf-8');

// ═══════════════════════════════════════════════════════════════════════════
// AC1 — 날짜 헤더 총건수에 힐러(HL) 합산 포함 (REDEFINITION (a))
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC1: 힐러 총인원 합산 포함', () => {
  test('AC1-1: 날짜 헤더 총건수 = 초진+재진+힐러 (c.n + c.r + c.h)', () => {
    expect(RESV_PAGE, '총건수 합산 수식이 c.n + c.r + c.h 아님 (HL 미포함)')
      .toContain('총 {c.n + c.r + c.h}');
    expect(RESV_PAGE, '구(舊) HL 제외 수식 잔존 (총 {c.n + c.r})')
      .not.toContain('총 {c.n + c.r}<');
  });

  test('AC1-2: HL 칩(HL N)은 별도 유지 — 합산+별도표기 병존', () => {
    // 합산에 포함되더라도 노란 HL 칩은 별도 렌더(c.h > 0 조건)되어야 함.
    expect(RESV_PAGE, 'HL 별도 칩 렌더 누락 (병존 위반)')
      .toMatch(/c\.h > 0 &&[\s\S]*?HL \{c\.h\}/);
    expect(RESV_PAGE, 'HL 칩 노란색(yellow) 스타일 누락')
      .toMatch(/c\.h > 0 &&[\s\S]*?bg-yellow-100[\s\S]*?HL \{c\.h\}/);
  });

  test('AC1-3: dayKindCounts가 힐러 카운트(h)를 집계 (수식의 데이터 소스)', () => {
    const m = RESV_PAGE.match(/const dayKindCounts = useMemo\(\(\) => \{([\s\S]*?)\}, \[rows\]\);/);
    expect(m, 'dayKindCounts useMemo 파싱 실패').toBeTruthy();
    const body = m![1];
    expect(body, '힐러 카운트(cur.h) 증가 분기 누락').toContain("kind === 'healer') cur.h += 1");
    expect(body, '취소 예약 제외 가드 누락(회귀)').toContain("row.status === 'cancelled') continue");
  });

  test('AC1-4: REDEFINITION supersede 주석으로 의도 명시', () => {
    expect(RESV_PAGE, 'AC1 supersede 주석 누락 (의도 추적 불가)')
      .toMatch(/RESVCAL-FOLLOWUP-5FIX AC1[\s\S]*?HL[\s\S]*?포함/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC2 [SUPERSEDED by T-20260615-foot-RESVMGMT-REFIX-8 AC4] — 시간대 카운트
//   5FIX AC2(좌측 시간축 '날짜 합산' time-axis-kind-count)는 현장 확정(옵션2 '일자×시간 매트릭스')으로
//   REFIX-8 AC4 가 supersede. 카운트 표기는 좌측 시간축(날짜 합산) → 각 (날짜×시간) 셀 per-cell 로 이동.
//   본 describe 는 그 supersede 반영 — REFIX-8.spec.ts AC4 가 신규 per-cell 매트릭스를 정식 검증한다.
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC2 [SUPERSEDED→REFIX-8 AC4]: 시간 카운트 per-cell 매트릭스 이동', () => {
  test('AC2-SUP-1: 좌측 시간축 날짜 합산(time-axis-kind-count) 제거 — supersede 반영', () => {
    expect(RESV_PAGE, 'time-axis-kind-count 잔존 — REFIX-8 AC4 supersede 미반영(중복 표시 위험)')
      .not.toContain('time-axis-kind-count-${time}');
    // 시간축 셀 자체는 시간 라벨로 보존(회귀 가드)
    expect(RESV_PAGE, '시간축 셀 testid(resv-time-col-cell) 소실(회귀)')
      .toContain('data-testid="resv-time-col-cell"');
  });

  test('AC2-SUP-2: per-cell 매트릭스 카운트로 대체 신설 (REFIX-8 AC4)', () => {
    expect(RESV_PAGE, 'per-cell 카운트(cell-kind-count) 누락 — AC4 매트릭스 미반영')
      .toContain('data-testid={`cell-kind-count-${dateStr}-${time}`}');
  });

  test('AC2-SUP-3: 기존 고객 박스 위 슬롯 카운트(slot-kind-count) 잔존 0', () => {
    expect(RESV_PAGE, '슬롯 고객 박스 위 카운트(slot-kind-count) 잔존(중복 표시)')
      .not.toContain('slot-kind-count-${dateStr}-${time}');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC2 회귀 — 예약 카드 클릭/우클릭/표시 동선 무파괴 (시나리오 1-4)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC2 회귀: 예약 카드 동선 무파괴', () => {
  test('REG-A2-1: 예약 카드 렌더 + 단/더블 클릭 핸들러 유지', () => {
    expect(RESV_PAGE, '예약 카드 testid 소실').toContain('data-testid={`resv-card-${r.id}`}');
    expect(RESV_PAGE, '더블클릭 → 예약수정(openEdit) 동선 소실').toContain('openEdit(r)');
  });

  test('REG-A2-2: 카드 우클릭 컨텍스트 메뉴 동선 유지', () => {
    expect(RESV_PAGE, '우클릭 컨텍스트 메뉴(setResvContextMenu) 소실')
      .toContain('setResvContextMenu({ resv: r');
  });

  test('REG-A2-3: 카드 유형색 코딩(KIND_CARD_STYLE) 유지 — 시간축 이동과 무관', () => {
    expect(RESV_PAGE, 'KIND_CARD_STYLE 적용 소실').toContain('KIND_CARD_STYLE[resvKind(r)]');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 회귀 — RESVCAL-DISPLAY-REWORK · WEEKCAL-HEADER-CARD-REDESIGN 동선 무파괴
// ═══════════════════════════════════════════════════════════════════════════
test.describe('회귀: 기 배포 캘린더 동선 무파괴', () => {
  test('REG-1: 초/재 칩 카운트 표기 유지 (DISPLAY-REWORK item1)', () => {
    expect(RESV_PAGE, '초진 칩(초 N) 누락').toMatch(/초 \{c\.n\}/);
    expect(RESV_PAGE, '재진 칩(재 N) 누락').toMatch(/재 \{c\.r\}/);
  });

  test('REG-2: 날짜 요약 testid 유지 (field-soak/회귀 셀렉터 안정)', () => {
    expect(RESV_PAGE, 'day-summary testid 누락')
      .toContain('data-testid={`day-summary-${format(d, \'yyyy-MM-dd\')}`}');
  });

  test('REG-3: 전건 0(초+재+힐러) 시 요약 null 렌더 가드 유지', () => {
    expect(RESV_PAGE, '전건 0 null 가드 누락')
      .toContain('if (!c || (c.n === 0 && c.r === 0 && c.h === 0)) return null');
  });

  test('REG-4: 카드 유형색 코딩(초진=emerald/재진=blue/힐러=yellow) 유지', () => {
    const m = RESV_PAGE.match(/const KIND_CARD_STYLE: Record<ResvKind, string> = \{([\s\S]*?)\};/);
    expect(m, 'KIND_CARD_STYLE 소실(회귀)').toBeTruthy();
    const body = m![1];
    expect(body).toMatch(/new:\s*'[^']*emerald/);
    expect(body).toMatch(/returning:\s*'[^']*blue/);
    expect(body).toMatch(/healer:\s*'[^']*yellow/);
  });
});
