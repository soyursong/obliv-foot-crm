/**
 * E2E spec — T-20260819-foot-CONSULT-INFLOW-AXIS-REVERT (P2, 우선순위 재정렬)
 *
 * 배경/RC: 72b5904a(08-18 15:09, T-20260818-SLACK-NULL)가 canonical(customers.first_inflow_channel)을
 *          consultInflowLabel 파생 사슬의 1순위로 올렸다. 그 결과 현장이 2번차트(visit_route)에 입력·수정한
 *          방문경로가 상담배정 [확정] 슬랙 발송에 반영되지 않고 canonical 이 이겨 63명中18명 불일치 발생.
 *
 * 조치(display-only · no-DDL · no-write): 파생 우선순위를 재정렬한다.
 *   1) 재진 축 → '재진'
 *   2) 2번차트(visit_route → lead_source) ← 최우선
 *   3) canonical first_inflow_channel(11코드 → resolveInflowLabel) ← 폴백으로 강등(72b5904a 되돌리기 아님·존치)
 *   4) source_system='dopamine' → 'TM'
 *   5) '미지정'
 *
 * 제약: 72b5904a 되돌리기 금지(미지정 재발 방지 — canonical 폴백 존치). system_codes 무수정.
 *       두 축 어휘 통일은 별건(INFLOW-VOCAB-UNIFY). db_change 없음.
 *
 * DoD 검증:
 *   DoD-1  2번차트 방문경로 '공홈' → 슬랙 '공홈'(canonical 공존해도 2번차트 우선).
 *   DoD-2  2번차트 수정 → 다음 발송 라벨에 그대로 반영.
 *   DoD-3  visit_route 빈값 + first_inflow_channel 만 있는 고객 → canonical 라벨(미지정 아님).
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { consultInflowLabel, INFLOW_UNSPECIFIED_LABEL, INFLOW_TM_LABEL } from '../../src/lib/consultInflowLabel';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const read = (p: string) => fs.readFileSync(path.resolve(ROOT, p), 'utf-8');
const LABEL = 'src/lib/consultInflowLabel.ts';

// system_codes(inflow_channel) 표시라벨 SSOT 를 흉내내는 테스트용 resolver.
const CODE_LABEL: Record<string, string> = {
  'inbound.naver_place': '네이버',
  'inbound.referral': '지인 소개',
  'internal.walk_in': '워크인',
};
const resolver = (code: string): string | null => CODE_LABEL[code] ?? null;

// DoD-1 — 2번차트(visit_route)='공홈' → '공홈'. canonical 이 공존해도 2번차트가 이긴다.
test('DoD-1: 2번차트 방문경로 "공홈" → 라벨 "공홈"(canonical 공존해도 2번차트 우선)', () => {
  const cust = { visit_route: '공홈', lead_source: null, first_inflow_channel: 'inbound.naver_place' };
  expect(consultInflowLabel('워크인', cust, null, resolver)).toBe('공홈');
});

// DoD-2 — 2번차트 수정 → 다음 발송 라벨에 반영.
test('DoD-2: 2번차트 수정(공홈→네이버) → 다음 발송 라벨에 반영', () => {
  const canonical = 'inbound.referral'; // = '지인 소개' (변하지 않는 canonical)
  const before = { visit_route: '공홈', lead_source: null, first_inflow_channel: canonical };
  expect(consultInflowLabel('워크인', before, null, resolver)).toBe('공홈');
  // 스태프가 2번차트 방문경로를 '네이버'로 수정(first_inflow_channel 은 동시갱신하지 않음 — 별건).
  const after = { ...before, visit_route: '네이버' };
  expect(consultInflowLabel('워크인', after, null, resolver)).toBe('네이버');
});

// DoD-3 — visit_route 빈값 + first_inflow_channel 만 → canonical 라벨(미지정 아님, 72b5904a 존치 효과).
test('DoD-3: 2번차트 빈값 + first_inflow_channel 만 있는 고객 → canonical 라벨(미지정 아님)', () => {
  const cust = { visit_route: null, lead_source: null, first_inflow_channel: 'inbound.naver_place' };
  const label = consultInflowLabel('워크인', cust, null, resolver);
  expect(label).toBe('네이버');
  expect(label).not.toBe(INFLOW_UNSPECIFIED_LABEL);
});

// 폴백 순서 종합 — 2번차트 > canonical > TM provenance > 미지정.
test('폴백 순서 종합: 2번차트 > canonical > TM > 미지정', () => {
  // 2번차트 없음 + canonical 없음 + 도파민 예약 → TM
  expect(consultInflowLabel('워크인', { visit_route: null, lead_source: null, first_inflow_channel: null }, 'dopamine', resolver)).toBe(INFLOW_TM_LABEL);
  // 전부 없음 → 미지정
  expect(consultInflowLabel('워크인', { visit_route: null, lead_source: null, first_inflow_channel: null }, null, resolver)).toBe(INFLOW_UNSPECIFIED_LABEL);
  // lead_source 는 visit_route 다음, canonical 앞
  expect(consultInflowLabel('워크인', { visit_route: null, lead_source: '인콜', first_inflow_channel: 'inbound.naver_place' }, null, resolver)).toBe('인콜');
});

// no-DDL / no-write 가드 — 라벨 SSOT 는 순수 함수(DB 무접촉).
test('제약: db_change 없음 — consultInflowLabel 은 supabase 미접촉(순수 함수)', () => {
  expect(read(LABEL)).not.toContain('supabase');
});
