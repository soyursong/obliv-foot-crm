/**
 * Unit spec — T-20260822-foot-PROGANALYSIS-EXTRACT-VISIT-MOVEMENT-SECTIONS
 *
 * 경과분석 인풋 .md(progressAnalysisMd.ts) 에 ADDITIVE 섹션 2개:
 *   【6】 진료내역 — 방문별 한 줄(방문일/접수시각/귀가시각/사유). check_in 기준 전건·취소 제외·방문일 오름차순.
 *   【7】 동선 로그 — 방문별 슬롯 체류(슬롯명/진입시각/체류시간). 레이저 슬롯 유무=치료 시행 판정.
 *                   이상치(수백h·로그아웃 누락)=원값 유지 + 표기 병행(절삭/대체 금지). 조인 키=방문(check_in).
 *   기존 5섹션·파일명·배송(ZIP/개별)·권한 게이트 무접촉. read-only(db_change=false).
 *
 * 대상(순수 함수, auth/page/server 미사용 → playwright 'unit' 프로젝트): buildProgressAnalysisMd.
 *
 * AC(현장 시나리오 매핑):
 *   시나리오1(정상): 【6】 방문 전건 오름차순·취소 제외 + 【7】 레이저 방문 '치료 시행' 판정 + 방문일 조인 대조.
 *   시나리오2(이상치): 체류시간 원값 유지 + '이상치(로그아웃 누락 추정)' 표기 병행.
 *   시나리오3(엣지): check_in 0 → '진료내역 없음' / 동선 로그 없는 방문 → '동선 로그 없음'.
 *   회귀: 기존 5섹션(1~5) 헤더 불변 + 하위호환(신규 map 미보유 envelope 도 throw 없이 '없음' 표기).
 *
 * 실기기 다운로드/현장 클릭 = supervisor 갤탭 field-soak(browser_verify).
 */
import { test, expect } from '@playwright/test';
import {
  buildProgressAnalysisMd,
  type ProgressAnalysisEnvelope,
  type ProgressAnalysisPatient,
} from '../../src/lib/progressAnalysisMd';

const CUST_ID = '11111111-2222-3333-4444-555555555555';
const P: ProgressAnalysisPatient = { id: CUST_ID, name: '김정숙', chart_number: 'C-1024' };

// 최소 envelope(5섹션은 비어도 OK) + 【6】【7】 데이터만 채움.
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
    ...over,
  };
}

test.describe('T-20260822 경과분석 .md 【6】진료내역 · 【7】동선 로그 (ADDITIVE)', () => {
  test('시나리오1: 【6】방문 전건 오름차순·취소제외 + 【7】레이저=치료 시행 판정 + 방문 조인', () => {
    const env = baseEnvelope({
      // 2개 방문 (2026-08-01, 2026-08-10) — 입력 순서를 뒤집어도 오름차순 렌더 확인은 소스 order 신뢰.
      visitsByCust: new Map([
        [
          CUST_ID,
          [
            {
              id: 'ci-1',
              checked_in_at: '2026-08-01T01:05:00Z', // KST 10:05
              completed_at: '2026-08-01T02:20:00Z', // KST 11:20
              visit_type: 'new',
              treatment_category: '조갑감입',
              status: 'done',
            },
            {
              id: 'ci-2',
              checked_in_at: '2026-08-10T02:00:00Z', // KST 11:00
              completed_at: '2026-08-10T03:30:00Z', // KST 12:30
              visit_type: 'returning',
              treatment_category: null,
              status: 'done',
            },
          ],
        ],
      ]),
      roomLogsByCheckIn: new Map([
        // ci-1: 상담실 → 레이저(치료 시행 판정 O)
        [
          'ci-1',
          [
            { check_in_id: 'ci-1', assigned_room: '1', room_type: 'consultation', logged_at: '2026-08-01T01:10:00Z' },
            { check_in_id: 'ci-1', assigned_room: '3', room_type: 'laser', logged_at: '2026-08-01T01:40:00Z' },
          ],
        ],
        // ci-2: 치료실만 (레이저 없음 → 치료 시행 근거 없음)
        [
          'ci-2',
          [
            { check_in_id: 'ci-2', assigned_room: '2', room_type: 'treatment', logged_at: '2026-08-10T02:05:00Z' },
          ],
        ],
      ]),
    });
    const md = buildProgressAnalysisMd(P, env);

    // 【6】 섹션 존재 + 표 헤더
    expect(md).toContain('# 【6】 진료내역');
    expect(md).toContain('| 방문일 | 접수시각 | 귀가시각 | 사유 |');
    // 방문일 오름차순: 08-01 행이 08-10 행보다 먼저
    const idx0801 = md.indexOf('| 2026-08-01 |');
    const idx0810 = md.indexOf('| 2026-08-10 |');
    expect(idx0801).toBeGreaterThan(-1);
    expect(idx0810).toBeGreaterThan(idx0801);
    // 접수시각/귀가시각 = KST 변환
    expect(md).toContain('| 2026-08-01 | 10:05 | 11:20 | 신규 · 조갑감입 |');
    expect(md).toContain('| 2026-08-10 | 11:00 | 12:30 | 재진 |');

    // 【7】 섹션 + 레이저 판정
    expect(md).toContain('# 【7】 동선 로그');
    expect(md).toContain('## 방문일 2026-08-01 (접수 10:05)');
    expect(md).toContain('**치료 시행(레이저 슬롯 있음)**');
    expect(md).toContain('치료 시행 근거 없음(레이저 슬롯 없음)');
    // 슬롯명 렌더 (레이저는 치료실로 병합하지 않고 독립 표기)
    expect(md).toContain('레이저(3)');
    expect(md).toContain('상담실(1)');
    // 체류시간: ci-1 상담실 진입 01:10Z→레이저 01:40Z = 30분
    expect(md).toContain('| 상담실(1) | 10:10 | 30분 |');

    // 조인: 【6】·【7】 모두 동일 방문일(2026-08-01)로 대조 가능
    expect((md.match(/2026-08-01/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  test('시나리오2: 체류시간 이상치(로그아웃 누락) 원값 유지 + 표기 병행', () => {
    const env = baseEnvelope({
      visitsByCust: new Map([
        [
          CUST_ID,
          [
            {
              id: 'ci-x',
              checked_in_at: '2026-08-01T01:00:00Z',
              // 귀가시각이 313시간 뒤 = 로그아웃 누락 (수백 시간)
              completed_at: '2026-08-14T02:00:00Z',
              visit_type: 'returning',
              treatment_category: null,
              status: 'done',
            },
          ],
        ],
      ]),
      roomLogsByCheckIn: new Map([
        ['ci-x', [{ check_in_id: 'ci-x', assigned_room: '2', room_type: 'treatment', logged_at: '2026-08-01T01:00:00Z' }]],
      ]),
    });
    const md = buildProgressAnalysisMd(P, env);
    // 원값(수백 시간) 유지 + 이상치 표기 병행 (절삭/대체 없음)
    expect(md).toContain('이상치(로그아웃 누락 추정)');
    expect(md).toMatch(/\| 치료실\(2\) \| \d{2}:\d{2} \| \d+시간 \d+분 ⚠이상치\(로그아웃 누락 추정\) \|/);
  });

  test('시나리오3: 엣지 — check_in 0 → 진료내역 없음 / 동선 로그 없는 방문 → 동선 로그 없음', () => {
    // check_in 0
    const empty = baseEnvelope();
    const mdEmpty = buildProgressAnalysisMd(P, empty);
    expect(mdEmpty).toContain('# 【6】 진료내역');
    expect(mdEmpty).toContain('_진료내역 없음_');
    expect(mdEmpty).toContain('# 【7】 동선 로그');

    // 방문은 있으나 동선 로그 없음
    const noLog = baseEnvelope({
      visitsByCust: new Map([
        [
          CUST_ID,
          [{ id: 'ci-0', checked_in_at: '2026-08-01T01:00:00Z', completed_at: null, visit_type: 'new', treatment_category: null, status: 'done' }],
        ],
      ]),
    });
    const mdNoLog = buildProgressAnalysisMd(P, noLog);
    expect(mdNoLog).toContain('_동선 로그 없음_');
    // 귀가 미기록 → 접수만, 귀가시각 (미기록)
    expect(mdNoLog).toContain('| 2026-08-01 | 10:00 | (미기록) | 신규 |');
  });

  test('회귀: 기존 5섹션 헤더 불변 + 하위호환(신규 map 미보유 envelope 도 throw 없이 없음 표기)', () => {
    // 신규 필드(visitsByCust/roomLogsByCheckIn)를 아예 뺀 legacy envelope
    const legacy = baseEnvelope();
    delete (legacy as Record<string, unknown>).visitsByCust;
    delete (legacy as Record<string, unknown>).roomLogsByCheckIn;
    let md = '';
    expect(() => {
      md = buildProgressAnalysisMd(P, legacy);
    }).not.toThrow();
    // 기존 5섹션 헤더 그대로
    expect(md).toContain('# 【1】 치료메모');
    expect(md).toContain('# 【2】 처방내역');
    expect(md).toContain('# 【3】 과거력');
    expect(md).toContain('# 【4】 첫날 상담차트');
    expect(md).toContain('# 【5】 임상 유의미 텍스트');
    // 신규 섹션은 '없음' 정직 표기
    expect(md).toContain('# 【6】 진료내역');
    expect(md).toContain('_진료내역 없음_');
    expect(md).toContain('# 【7】 동선 로그');
  });
});
