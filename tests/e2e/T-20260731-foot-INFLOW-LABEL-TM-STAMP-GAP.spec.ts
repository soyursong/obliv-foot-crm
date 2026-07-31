/**
 * E2E spec — T-20260731-foot-INFLOW-LABEL-TM-STAMP-GAP (P2, 확정 경로 A)
 *
 * 증상: 07-14 seed 배포 이전 등록된 도파민(TM) 출처 고객(예: 조현수)은 customers.visit_route/lead_source 가
 *       둘 다 비어 상담대기 알림 [유입경로]가 '미지정'으로 오표기. B-forward seed(visit_route='TM')는 이미 배포됐으나
 *       과거 코호트 미소급 → 라벨 갭.
 *
 * 확정 경로 A (DA CONSULT-REPLY MSG-20260731-163417-vvc3 / SSOT da_decision_foot_inflow_label_tm_stamp_gap_20260731):
 *   순서형 파생 규칙에 event-provenance 폴백 1단 추가(ADDITIVE·no-DDL·no-backfill):
 *     returning                                    → '재진'      (최우선)
 *     visit_route (비공백·非머신마커)               → 그 값
 *     lead_source (비공백·"dopamine_" prefix 아님)  → 그 값        (머신마커 억제)
 *     source_system == 'dopamine'                  → 'TM'        (★NEW)
 *     그 외                                        → '미지정'
 *
 * 검증(순수 함수 + 배선 정적 — 데이터/로그인 비의존, 형제 foot spec 동형):
 *   시나리오1  TM(도파민)출처 예약(고객선언 비었음) + source_system='dopamine' → 라벨 'TM'.
 *   시나리오2  무회귀: visit_route 실값→원문 / returning→'재진' / 셋 다 빈값→'미지정'.
 *   HARD-1     source_system 리터럴 'dopamine' 만 → 'TM'. NULL/'manual'/'워크인'/'도파민'(개념라벨) → 폴백 무발동 '미지정'.
 *   HARD-2     고객선언 우선 — source_system='dopamine' 이라도 visit_route/lead_source 실값이 있으면 그 실값(TM 폴백 억제).
 *   HARD-4     머신마커 억제 — visit_route/lead_source 의 'dopamine_*' 값은 표시상 공백 → 다음 폴백 진행.
 *   RED LINE   배정축(deriveConsultAxis/CONSULT_AXES/autoAssign) 무접촉 + 매출축 어휘('광고'/'오가닉') 라벨 미노출 + source_system read-only.
 *   배선       Assignments.tsx inflow 바인딩이 3번째 인자(source_system)를 monthResvSourceSystem 맵에서 공급.
 *   no-DDL     본 티켓 마이그레이션 신규 생성 없음.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { deriveConsultAxis } from '../../src/lib/autoAssign';
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
const AUTOASSIGN = 'src/lib/autoAssign.ts';
const LABEL = 'src/lib/consultInflowLabel.ts';

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오1 — TM(도파민)출처 예약 + 고객선언 비었음 → 라벨 'TM'
// ─────────────────────────────────────────────────────────────────────────────
test('시나리오1: 고객선언 비었고 source_system="dopamine" → 라벨 "TM"(더 이상 미지정 아님)', () => {
  expect(INFLOW_TM_LABEL).toBe('TM');
  // 조현수 재현: visit_route/lead_source NULL(seed 배포 이전 등록) + 예약 provenance=dopamine.
  expect(consultInflowLabel('워크인', { visit_route: null, lead_source: null }, 'dopamine')).toBe('TM');
  expect(consultInflowLabel('워크인', { visit_route: '', lead_source: '' }, 'dopamine')).toBe('TM');
  expect(consultInflowLabel('워크인', null, 'dopamine')).toBe('TM');
  // 공백 방어(trim).
  expect(consultInflowLabel('워크인', {}, '  dopamine  ')).toBe('TM');
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오2 — 무회귀 (visit_route 실값 / returning / 셋 다 빈값)
// ─────────────────────────────────────────────────────────────────────────────
test('시나리오2 무회귀: visit_route 실값→원문 / returning→"재진" / 셋 다 빈값→"미지정"', () => {
  // visit_route 실값은 원문 그대로 — source_system 무관.
  expect(consultInflowLabel('워크인', { visit_route: '네이버' }, 'dopamine')).toBe('네이버');
  expect(consultInflowLabel('워크인', { visit_route: '워크인' }, null)).toBe('워크인');
  // 재진 축 → 유입경로 대신 '재진'(route·source_system 무관).
  expect(consultInflowLabel('returning', { visit_route: '네이버' }, 'dopamine')).toBe(INFLOW_RETURNING_LABEL);
  // 고객선언·provenance 모두 없음 → '미지정'.
  expect(consultInflowLabel('워크인', { visit_route: null, lead_source: null }, null)).toBe(INFLOW_UNSPECIFIED_LABEL);
  expect(consultInflowLabel('워크인', null, undefined)).toBe(INFLOW_UNSPECIFIED_LABEL);
  // lead_source 폴백 무회귀(2번째 소스).
  expect(consultInflowLabel('워크인', { visit_route: null, lead_source: '지인소개' }, null)).toBe('지인소개');
});

// ─────────────────────────────────────────────────────────────────────────────
// HARD-1 — 리터럴 'dopamine' 만 → 'TM'. 다른 값은 폴백 무발동 → '미지정'
// ─────────────────────────────────────────────────────────────────────────────
test('HARD-1: source_system 은 리터럴 "dopamine" 만 TM 매핑 — NULL/manual/워크인/"도파민" 은 무발동', () => {
  const empty = { visit_route: null, lead_source: null };
  // 폴백 무발동 → '미지정'.
  for (const ss of [null, undefined, '', 'manual', '워크인', '도파민', 'DOPAMINE', 'walkin', 'naver']) {
    expect(consultInflowLabel('워크인', empty, ss)).toBe(INFLOW_UNSPECIFIED_LABEL);
  }
  // 리터럴 'dopamine' 만 발동.
  expect(consultInflowLabel('워크인', empty, 'dopamine')).toBe('TM');
});

// ─────────────────────────────────────────────────────────────────────────────
// HARD-2 — 고객선언 우선: dopamine 예약이라도 visit_route/lead_source 실값이 있으면 실값(TM 폴백 억제)
// ─────────────────────────────────────────────────────────────────────────────
test('HARD-2: 고객선언(visit_route/lead_source 실값) 우선 — dopamine 이어도 TM 폴백 억제', () => {
  // 오가닉으로 처음 온 뒤 TM 재예약: 고객선언 '네이버'가 event provenance 보다 우선.
  expect(consultInflowLabel('워크인', { visit_route: '네이버' }, 'dopamine')).toBe('네이버');
  expect(consultInflowLabel('워크인', { visit_route: null, lead_source: '공홈' }, 'dopamine')).toBe('공홈');
});

// ─────────────────────────────────────────────────────────────────────────────
// HARD-4 — 머신마커 억제: 'dopamine_*' visit_route/lead_source 는 표시상 공백 → 다음 폴백 진행
// ─────────────────────────────────────────────────────────────────────────────
test('HARD-4: 머신마커(dopamine_*) 억제 — 표시 누수 봉인 후 다음 폴백으로 진행', () => {
  // lead_source='dopamine_tm' 머신마커 → 라벨로 노출 금지. source_system='dopamine' 폴백으로 'TM'.
  expect(consultInflowLabel('워크인', { visit_route: null, lead_source: 'dopamine_tm' }, 'dopamine')).toBe('TM');
  // 머신마커 + provenance 도 없음 → '미지정'(누수 아님).
  expect(consultInflowLabel('워크인', { visit_route: null, lead_source: 'dopamine_tm' }, null)).toBe(INFLOW_UNSPECIFIED_LABEL);
  // visit_route 가 머신마커면 억제 후 lead_source 실값으로 진행.
  expect(consultInflowLabel('워크인', { visit_route: 'dopamine_lead', lead_source: '네이버' }, null)).toBe('네이버');
  // 대소문자 무시 방어.
  expect(consultInflowLabel('워크인', { visit_route: 'DOPAMINE_TM' }, null)).toBe(INFLOW_UNSPECIFIED_LABEL);
  // ★ 사람이 고른 'TM'(머신마커 아님)은 억제되지 않고 그대로 표시(무회귀).
  expect(consultInflowLabel('워크인', { visit_route: 'TM' }, null)).toBe('TM');
});

// ─────────────────────────────────────────────────────────────────────────────
// RED LINE — 배정축 무접촉 + 매출축 어휘 미노출 + source_system read-only
// ─────────────────────────────────────────────────────────────────────────────
test('RED LINE: deriveConsultAxis/CONSULT_AXES/autoAssign 무접촉(런타임+정적)', () => {
  // 런타임: source_system 도입이 배정 축 파생에 영향 없음 — 네이버/지인소개/공홈 여전히 '워크인' 버킷.
  for (const v of ['네이버', '지인소개', '공홈']) {
    expect(deriveConsultAxis({ visit_type: 'new', visit_route: v })).toBe('워크인');
  }
  // 정적: 배정 축 정의 불변(3종) — 라벨 티켓이 CONSULT_AXES 를 건드리지 않음.
  const aa = read(AUTOASSIGN);
  expect(aa).toMatch(/const CONSULT_AXES = \['TM', '인바운드', '워크인'\] as const;/);
  // 라벨 SSOT 는 autoAssign 을 import 하지 않는다(순수/무의존 — returning 판정만 인라인).
  expect(read(LABEL)).not.toMatch(/from '.*autoAssign'/);
});

test('RED LINE: 매출축 어휘("광고"/"오가닉") 라벨 미노출 + source_system read-only(write 0)', () => {
  const label = read(LABEL);
  // 주석 제거(블록/라인) 후 코드 본문만 검사 — JSDoc 은 금지 규칙을 명시적으로 문서화하므로 어휘가 등장함.
  const code = label.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  // 코드 본문(파생 로직·리턴·상수)에는 매출축 어휘를 절대 노출하지 않음.
  expect(code).not.toContain('광고');
  expect(code).not.toContain('오가닉');
  // 런타임 이중검증: 어떤 입력 조합도 매출축 어휘를 라벨로 반환하지 않는다.
  for (const ss of ['dopamine', 'organic', null, 'manual']) {
    for (const cust of [null, { visit_route: null, lead_source: null }, { visit_route: 'TM' }]) {
      const out = consultInflowLabel('워크인', cust, ss);
      expect(out).not.toBe('광고');
      expect(out).not.toBe('오가닉');
    }
  }
  // source_system 은 read-only 참조 — 라벨 SSOT 는 DB/write 무접촉(순수 함수).
  expect(label).not.toContain('supabase');
  expect(label).not.toMatch(/\.update\(|\.insert\(|\.upsert\(/);
  // Assignments 의 reservation source_system fetch 는 select 만(write 없음).
  const asg = read(ASSIGNMENTS);
  expect(asg).toMatch(/from\('reservations'\)\s*\.select\('id, source_system'\)/);
  expect(asg).not.toMatch(/from\('reservations'\)[\s\S]{0,80}\.(update|insert|upsert)\(/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 배선 — Assignments.tsx inflow 바인딩이 source_system(3번째 인자)를 공급
// ─────────────────────────────────────────────────────────────────────────────
test('배선: consultInflowLabel 3번째 인자로 예약 source_system 공급(monthResvSourceSystem)', () => {
  const src = read(ASSIGNMENTS);
  // reservation_id → source_system 맵 상태 + 공급 배선.
  expect(src).toContain('monthResvSourceSystem');
  expect(src).toMatch(/consultInflowLabel\(\s*axisOf\(ci, 'consult'\),\s*cust,\s*ci\.reservation_id \? monthResvSourceSystem\.get\(ci\.reservation_id\) : null,?\s*\)/);
  // useMemo 의존성에 맵 포함(신선도).
  expect(src).toMatch(/monthCustomers, monthResvSourceSystem, axisOf\]/);
});

// ─────────────────────────────────────────────────────────────────────────────
// no-DDL — 본 티켓 마이그레이션 신규 생성 없음
// ─────────────────────────────────────────────────────────────────────────────
test('no-DDL: 본 티켓 마이그레이션/DDL 신규 생성 없음(db_change:false)', () => {
  const migDir = path.resolve(ROOT, 'supabase/migrations');
  const mig = fs.existsSync(migDir) ? fs.readdirSync(migDir) : [];
  expect(mig.some((f) => f.includes('INFLOW-LABEL-TM') || f.includes('inflow_label_tm'))).toBe(false);
});
