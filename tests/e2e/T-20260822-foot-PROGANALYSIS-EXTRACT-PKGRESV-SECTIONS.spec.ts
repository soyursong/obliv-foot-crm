/**
 * Unit spec — T-20260822-foot-PROGANALYSIS-EXTRACT-PKGRESV-SECTIONS
 *
 * 경과분석 인풋 .md(progressAnalysisMd.ts) 에 ADDITIVE 섹션 2개:
 *   【8】 활성 패키지 — 패키지명 + 시술구분(비가열/가열/…)×(총/사용/잔여) 행 + 전체잔여. 없으면 "활성 패키지 없음".
 *   【9】 예약내역   — 예약 전건 최신순(예약일시 + 예약메모). 취소예약 포함(취소 명시표기). 없으면 "예약내역 없음".
 *   목적 = 6회차 가열(힐러)/비가열 판정(참고표기, 별도 필드 아님).
 *          판정우선순위: 1순위 예약메모(가열/힐러↔비가열) > 2순위 예약메모 단서없고 활성패키지 가열잔여>0 이면 일반규칙.
 *   기존 1~7섹션·파일명·배송(ZIP/개별)·권한 게이트 무접촉. read-only(db_change=false)·schema 0.
 *
 * 대상(순수 함수, auth/page/server 미사용 → playwright 'unit' 프로젝트): buildProgressAnalysisMd.
 *
 * AC(현장 시나리오 매핑):
 *   시나리오1(정상): 【8】 시술구분별 총/사용/잔여 + 전체잔여 + 【9】 예약 최신순·취소표기 + 판정(예약메모 1순위).
 *   시나리오2(판정 2순위): 예약메모 단서 없음 + 가열잔여>0 → 일반규칙 판정표기.
 *   시나리오3(엣지): 활성패키지 0 → "활성 패키지 없음" / 예약 0 → "예약내역 없음" / 가열잔여 0·단서없음 → 비가열(추정).
 *   회귀: 기존 1~7섹션 헤더 불변 + 하위호환(신규 map 미보유 envelope 도 throw 없이 '없음' 표기).
 *
 * 실기기 다운로드/현장 클릭 = supervisor 갤탭 field-soak(browser_verify).
 */
import { test, expect } from '@playwright/test';
import {
  buildProgressAnalysisMd,
  type ProgressAnalysisEnvelope,
  type ProgressAnalysisPatient,
} from '../../src/lib/progressAnalysisMd';

const CUST_ID = '88888888-9999-aaaa-bbbb-cccccccccccc';
const P: ProgressAnalysisPatient = { id: CUST_ID, name: '박정순', chart_number: 'C-2048' };

// 최소 envelope(1~7섹션은 비어도 OK) + 【8】【9】 데이터만 채움.
function baseEnvelope(over: Partial<ProgressAnalysisEnvelope> = {}): ProgressAnalysisEnvelope {
  return {
    boilerSet: new Set(),
    milestonesByCust: new Map(),
    visitCountByCust: new Map(),
    nextResvByCust: new Map(),
    memosByCust: new Map(),
    rxByCust: new Map(),
    hqByCust: new Map(),
    firstVisitByCust: new Map(),
    consultByCust: new Map(),
    chartByCust: new Map(),
    visitsByCust: new Map(),
    roomLogsByCheckIn: new Map(),
    activePkgsByCust: new Map(),
    reservationsByCust: new Map(),
    ...over,
  };
}

test.describe('T-20260822 경과분석 .md 【8】활성패키지 · 【9】예약내역 (ADDITIVE)', () => {
  test('시나리오1: 【8】시술구분별 총/사용/잔여+전체잔여 + 【9】예약 최신순·취소표기 + 판정(예약메모 1순위)', () => {
    const env = baseEnvelope({
      activePkgsByCust: new Map([
        [
          CUST_ID,
          [
            {
              package_name: '발톱무좀 12회 패키지',
              package_type: 'foot',
              rows: [
                { label: '비가열', total: 11, used: 5, remaining: 6 },
                { label: '가열', total: 1, used: 0, remaining: 1 },
              ],
              totalRemaining: 7,
            },
          ],
        ],
      ]),
      reservationsByCust: new Map([
        [
          CUST_ID,
          [
            // 입력 순서 = 소스 order(최신순). 08-25(가열 예약메모) → 08-20(취소) 순.
            {
              reservation_date: '2026-08-25',
              reservation_time: '14:30',
              status: 'confirmed',
              booking_memo: '가열 레이저 예정 (힐러)',
              memo: null,
              brief_note: null,
              registrar_name: '이실장',
            },
            {
              reservation_date: '2026-08-20',
              reservation_time: '10:00',
              status: 'cancelled',
              booking_memo: '개인사정 취소',
              memo: null,
              brief_note: null,
              registrar_name: null,
            },
          ],
        ],
      ]),
    });
    const md = buildProgressAnalysisMd(P, env);

    // 【8】 섹션 + 패키지명 + 표 + 시술구분 행 + 전체잔여
    expect(md).toContain('# 【8】 활성 패키지');
    expect(md).toContain('## 패키지 1: 발톱무좀 12회 패키지 (foot)');
    expect(md).toContain('| 시술구분 | 총 | 사용 | 잔여 |');
    expect(md).toContain('| 비가열 | 11회 | 5회 | 6회 |');
    expect(md).toContain('| 가열 | 1회 | 0회 | 1회 |');
    expect(md).toContain('| **전체잔여** |  |  | **7회** |');

    // 【9】 섹션 + 예약 최신순 + 취소 명시표기 + 예약메모
    expect(md).toContain('# 【9】 예약내역');
    const idx0825 = md.indexOf('2026-08-25 14:30');
    const idx0820 = md.indexOf('2026-08-20 10:00');
    expect(idx0825).toBeGreaterThan(-1);
    expect(idx0820).toBeGreaterThan(idx0825); // 최신(08-25)이 먼저
    expect(md).toContain('## 2026-08-25 14:30 [예약확정] · 등록 이실장');
    expect(md).toContain('- 예약메모: 가열 레이저 예정 (힐러)');
    expect(md).toContain('## 2026-08-20 10:00 [취소]');
    expect(md).toContain('- 예약메모: 개인사정 취소');

    // 판정: 1순위 예약메모 = 가열(힐러). 취소예약(08-20)은 판정 스캔 제외 → 08-25 가열 채택.
    expect(md).toContain('### 참고: 6회차 가열(힐러)/비가열 판정');
    expect(md).toContain('**판정(1순위·예약메모): 가열(힐러)**');
    expect(md).toContain('2026-08-25 14:30');
  });

  test('시나리오1-b: 예약메모 비가열 단서 → 비가열 판정 (부분문자열 오분류 방지: 비가열 우선)', () => {
    const env = baseEnvelope({
      reservationsByCust: new Map([
        [
          CUST_ID,
          [
            {
              reservation_date: '2026-08-26',
              reservation_time: '11:00',
              status: 'confirmed',
              booking_memo: '비가열 진행 예정',
              memo: null,
              brief_note: null,
              registrar_name: null,
            },
          ],
        ],
      ]),
    });
    const md = buildProgressAnalysisMd(P, env);
    // '비가열'은 '가열'을 부분포함 → 비가열로 정확 판정되어야 함
    expect(md).toContain('**판정(1순위·예약메모): 비가열**');
    expect(md).not.toContain('**판정(1순위·예약메모): 가열(힐러)**');
  });

  test('시나리오2: 예약메모 단서 없음 + 활성패키지 가열잔여>0 → 일반규칙(2순위) 판정', () => {
    const env = baseEnvelope({
      activePkgsByCust: new Map([
        [
          CUST_ID,
          [
            {
              package_name: '재진 회차권',
              package_type: null,
              rows: [
                { label: '비가열', total: 6, used: 3, remaining: 3 },
                { label: '가열', total: 2, used: 0, remaining: 2 },
              ],
              totalRemaining: 5,
            },
          ],
        ],
      ]),
      reservationsByCust: new Map([
        [
          CUST_ID,
          [
            {
              reservation_date: '2026-08-24',
              reservation_time: '15:00',
              status: 'confirmed',
              booking_memo: '재진 예약', // 가열/비가열 단서 없음
              memo: null,
              brief_note: null,
              registrar_name: null,
            },
          ],
        ],
      ]),
    });
    const md = buildProgressAnalysisMd(P, env);
    expect(md).toContain('**판정(2순위·활성패키지): 가열 가능**');
    expect(md).toContain('활성패키지 가열잔여 2회');
    expect(md).toContain('예약 우선 원칙상 실제 가열은 뒤 회차로 밀릴 수 있음');
  });

  test('시나리오3: 엣지 — 활성패키지 0/예약 0 없음표기 + 가열잔여0·단서없음 → 비가열(추정)', () => {
    // 활성패키지 0 + 예약 0
    const empty = baseEnvelope();
    const mdEmpty = buildProgressAnalysisMd(P, empty);
    expect(mdEmpty).toContain('# 【8】 활성 패키지');
    expect(mdEmpty).toContain('_활성 패키지 없음_');
    expect(mdEmpty).toContain('# 【9】 예약내역');
    expect(mdEmpty).toContain('_예약내역 없음_');
    // 단서 없음 + 가열잔여 없음 → 비가열(추정)
    expect(mdEmpty).toContain('**판정: 비가열(추정)**');

    // 예약메모 3필드 모두 비어있는 예약 → "예약메모 없음"
    const noMemo = baseEnvelope({
      reservationsByCust: new Map([
        [
          CUST_ID,
          [
            {
              reservation_date: '2026-08-27',
              reservation_time: null,
              status: 'confirmed',
              booking_memo: null,
              memo: null,
              brief_note: null,
              registrar_name: null,
            },
          ],
        ],
      ]),
    });
    const mdNoMemo = buildProgressAnalysisMd(P, noMemo);
    expect(mdNoMemo).toContain('## 2026-08-27 [예약확정]');
    expect(mdNoMemo).toContain('- _예약메모 없음_');
  });

  test('회귀: 기존 1~7섹션 헤더 불변 + 하위호환(신규 map 미보유 envelope 도 throw 없이 없음 표기)', () => {
    // 신규 필드(activePkgsByCust/reservationsByCust)를 아예 뺀 legacy envelope
    const legacy = baseEnvelope();
    delete (legacy as Record<string, unknown>).activePkgsByCust;
    delete (legacy as Record<string, unknown>).reservationsByCust;
    let md = '';
    expect(() => {
      md = buildProgressAnalysisMd(P, legacy);
    }).not.toThrow();
    // 기존 1~7섹션 헤더 그대로
    expect(md).toContain('# 【1】 치료메모');
    expect(md).toContain('# 【2】 처방내역');
    expect(md).toContain('# 【3】 과거력');
    expect(md).toContain('# 【4】 첫날 상담차트');
    expect(md).toContain('# 【5】 임상 유의미 텍스트');
    expect(md).toContain('# 【6】 진료내역');
    expect(md).toContain('# 【7】 동선 로그');
    // 신규 섹션은 '없음' 정직 표기
    expect(md).toContain('# 【8】 활성 패키지');
    expect(md).toContain('_활성 패키지 없음_');
    expect(md).toContain('# 【9】 예약내역');
    expect(md).toContain('_예약내역 없음_');
  });
});
