/**
 * E2E spec — T-20260818-foot-CONSULT-INFLOW-SLACK-NULL (P1 버그 fix)
 *
 * 증상: 2번차트에 유입경로(=customers.first_inflow_channel canonical 11코드)가 정상 저장돼 있으나,
 *       상담 배정 [확정] 자동 슬랙 메시지에서만 '미지정'(INFLOW_UNSPECIFIED_LABEL) 오출력.
 *
 * 근본원인(RC, 택1 확정 = (a) 잘못된 컬럼/키 참조):
 *   consultInflowLabel 이 canonical inflow 축(§36 축① = customers.first_inflow_channel, 11코드)을
 *   참조하지 않고 legacy visit_route/lead_source 만 읽었다. T-20260801 INFLOW-CHANNEL-INTAKE-LANE 이후
 *   접수/예약 동선은 유입경로를 first_inflow_channel 로만 적재 → 신규 코호트에서 visit_route/lead_source 는
 *   빈값 → 최종 폴백 '미지정' 도달. (조인 누락으로 null read (b) 아님 · 코드→라벨 매핑 실패 (c) 아님 —
 *   소스 컬럼 자체를 안 읽던 것.)
 *
 * 교정(display-only · no-DDL · no-write):
 *   consultInflowLabel 파생 사슬 최상위(재진 다음)에 canonical first_inflow_channel 을 1단 추가하고,
 *   11코드는 표시라벨 resolver(system_codes/useInflowChannels SSOT)로 변환. resolver 미가용/미매핑이면
 *   canonical 단계를 건너뛰고 기존 legacy 사슬로 graceful fall-through(배포순서 무중단·무회귀).
 *
 * 검증(순수 함수 + 배선 정적 — 데이터/로그인 비의존, 형제 foot spec 동형):
 *   AC-1  first_inflow_channel(canonical) 저장 케이스 → 슬랙 라벨 = 매핑된 표시라벨('미지정' 아님).
 *   AC-2  first_inflow_channel·visit_route·lead_source 모두 빈값 → '미지정' fallback 유지(회귀 금지).
 *   AC-3  canonical 11코드 → 표시라벨 매핑이 resolver 로 올바르게 적용.
 *   AC-graceful  first_inflow_channel 있으나 resolver 미가용/미매핑 → legacy 사슬로 fall-through(무중단).
 *   AC-무회귀  legacy visit_route/lead_source·재진·TM provenance 기존 동작 불변.
 *   배선  Assignments.tsx 가 first_inflow_channel select + resolveInflowLabel 을 consultInflowLabel 에 전달.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  consultInflowLabel,
  INFLOW_RETURNING_LABEL,
  INFLOW_UNSPECIFIED_LABEL,
  INFLOW_TM_LABEL,
} from '../../src/lib/consultInflowLabel';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const read = (p: string) => fs.readFileSync(path.resolve(ROOT, p), 'utf-8');

const ASSIGNMENTS = 'src/pages/Assignments.tsx';

// system_codes(code_type='inflow_channel') 표시라벨 SSOT 를 흉내내는 테스트용 resolver.
//   (실런타임은 useInflowChannels RPC → options[{code,label}]. 여기선 대표 11코드 일부만.)
const CODE_LABEL: Record<string, string> = {
  'inbound.naver_place': '네이버',
  'inbound.referral': '지인 소개',
  'inbound.instagram': '인스타그램',
  'partner.dopamine': '도파민',
  'internal.walk_in': '워크인',
};
const resolver = (code: string): string | null => CODE_LABEL[code] ?? null;

// ─────────────────────────────────────────────────────────────────────────────
// AC-1 / AC-3 — canonical first_inflow_channel 저장 케이스 → 표시라벨(미지정 아님)
// ─────────────────────────────────────────────────────────────────────────────
test('AC-1/AC-3: first_inflow_channel(canonical 11코드) → 슬랙 라벨=매핑된 표시라벨(미지정 아님)', () => {
  // 2번차트에 유입경로가 first_inflow_channel 로만 저장된 신규 코호트(legacy 컬럼 빈값)를 재현.
  const cust = { first_inflow_channel: 'inbound.naver_place', visit_route: null, lead_source: null };
  const label = consultInflowLabel('워크인', cust, null, resolver);
  expect(label).toBe('네이버');
  expect(label).not.toBe(INFLOW_UNSPECIFIED_LABEL); // 버그 재발 방지: 더 이상 '미지정' 아님
});

test('AC-3: 여러 canonical 코드가 각각 올바른 표시라벨로 매핑', () => {
  expect(consultInflowLabel('워크인', { first_inflow_channel: 'inbound.referral' }, null, resolver)).toBe('지인 소개');
  expect(consultInflowLabel('워크인', { first_inflow_channel: 'inbound.instagram' }, null, resolver)).toBe('인스타그램');
  expect(consultInflowLabel('워크인', { first_inflow_channel: 'partner.dopamine' }, null, resolver)).toBe('도파민');
});

test('AC-1[의도변경 T-20260819-AXIS-REVERT]: 2번차트(visit_route) 가 canonical 보다 우선', () => {
  // ★의도변경(T-20260819-foot-CONSULT-INFLOW-AXIS-REVERT): 72b5904a(08-18)는 canonical(first_inflow_channel)을
  //   1순위로 뒀으나, 현장 2번차트에 입력한 방문경로가 슬랙에 미반영(63명中18명 불일치)되어 우선순위를 재정렬.
  //   두 소스가 공존하면 이제 2번차트(visit_route→lead_source)가 이기고, canonical 은 폴백이다.
  //   (구 기대값 '네이버' → 신 기대값 '지인소개' = visit_route 우선. 단언 삭제 아님·기대값만 반전.)
  const cust = { first_inflow_channel: 'inbound.naver_place', visit_route: '지인소개', lead_source: '공홈' };
  expect(consultInflowLabel('워크인', cust, null, resolver)).toBe('지인소개');
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-2 — 실제 미입력/null 케이스 → '미지정' fallback 유지(회귀 금지)
// ─────────────────────────────────────────────────────────────────────────────
test('AC-2: 모든 소스 빈값 → 미지정 fallback 유지(거짓 워크인/공란 금지)', () => {
  expect(consultInflowLabel('워크인', { first_inflow_channel: null, visit_route: null, lead_source: null }, null, resolver))
    .toBe(INFLOW_UNSPECIFIED_LABEL);
  expect(consultInflowLabel('워크인', { first_inflow_channel: '', visit_route: '', lead_source: '' }, null, resolver))
    .toBe(INFLOW_UNSPECIFIED_LABEL);
  expect(consultInflowLabel('워크인', null, null, resolver)).toBe(INFLOW_UNSPECIFIED_LABEL);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-graceful — first_inflow_channel 있으나 resolver 미가용/미매핑 → legacy 사슬로 fall-through
// ─────────────────────────────────────────────────────────────────────────────
test('AC-graceful: resolver 미제공(RPC 미로드) → visit_route(2번차트) 사용', () => {
  // T-20260819-AXIS-REVERT 이후 visit_route 는 최우선이므로 resolver 유무와 무관하게 2번차트 값이 노출된다.
  const cust = { first_inflow_channel: 'inbound.naver_place', visit_route: '지인소개', lead_source: null };
  // resolver 인자 자체를 넘기지 않음(배포순서 초기 RPC 미로드 재현) — 어차피 visit_route 가 먼저 이긴다.
  expect(consultInflowLabel('워크인', cust)).toBe('지인소개');
});

test('AC-graceful: resolver 는 있으나 미매핑 코드 → legacy fall-through(미지정으로 조기종결 금지)', () => {
  const cust = { first_inflow_channel: 'code.unknown.999', visit_route: '네이버', lead_source: null };
  expect(consultInflowLabel('워크인', cust, null, resolver)).toBe('네이버');
});

test('AC-graceful: 미매핑 canonical + legacy 도 빈값 → 최종 미지정', () => {
  const cust = { first_inflow_channel: 'code.unknown.999', visit_route: null, lead_source: null };
  expect(consultInflowLabel('워크인', cust, null, resolver)).toBe(INFLOW_UNSPECIFIED_LABEL);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-무회귀 — 기존 legacy/재진/TM 동작 불변 (2-arg 레거시 호출 포함)
// ─────────────────────────────────────────────────────────────────────────────
test('AC-무회귀: 재진 축 → 재진 라벨(불변)', () => {
  expect(consultInflowLabel('returning', { first_inflow_channel: 'inbound.naver_place' }, null, resolver))
    .toBe(INFLOW_RETURNING_LABEL);
});

test('AC-무회귀: legacy visit_route/lead_source 원문 노출 불변(canonical 없을 때)', () => {
  expect(consultInflowLabel('워크인', { visit_route: '네이버' })).toBe('네이버');
  expect(consultInflowLabel('워크인', { visit_route: null, lead_source: '공홈' })).toBe('공홈');
});

test('AC-무회귀: TM event-provenance 폴백 불변(고객선언 비었고 예약이 도파민)', () => {
  expect(consultInflowLabel('워크인', { first_inflow_channel: null, visit_route: null, lead_source: null }, 'dopamine', resolver))
    .toBe(INFLOW_TM_LABEL);
});

test('AC-무회귀: 머신마커(dopamine_*) legacy 값은 표시 억제(canonical 미존재 시)', () => {
  expect(consultInflowLabel('워크인', { visit_route: 'dopamine_tm', lead_source: null }, null, resolver))
    .toBe(INFLOW_UNSPECIFIED_LABEL);
});

// ─────────────────────────────────────────────────────────────────────────────
// 배선 — Assignments.tsx 가 canonical 소스 + resolver 를 발송 라벨에 전달
// ─────────────────────────────────────────────────────────────────────────────
test('배선: Assignments.tsx 가 first_inflow_channel select + resolveInflowLabel 전달', () => {
  const src = read(ASSIGNMENTS);
  // 두 customers select 모두 first_inflow_channel 포함(오늘분 + 당월분).
  const selectCount = (src.match(/first_inflow_channel/g) ?? []).length;
  expect(selectCount).toBeGreaterThanOrEqual(3); // 인터페이스 + 2 select (+ 주석)
  // useInflowChannels 로 resolver 구성 + consultInflowLabel 4번째 인자로 전달.
  expect(src).toContain("import { useInflowChannels }");
  expect(src).toContain('resolveInflowLabel');
  // consultInflowLabel 호출에 resolveInflowLabel 전달 배선 확인.
  expect(/consultInflowLabel\([\s\S]*?resolveInflowLabel[\s\S]*?\)/.test(src)).toBe(true);
});
