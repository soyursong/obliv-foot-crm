/**
 * E2E spec — T-20260629-foot-STAFF-ROTATION-DEFAULT-ORDER
 *
 * 현장(김주연 총괄): 자동배정 상담(7)/치료(9) 기본 순번(round-robin) 등록 + 휴무/임시off skip +
 *   admin 직접 순번 변경("웅 직접 변경 가능하도록 해줘~!" — admin 편집 1급 확정).
 *
 * ── 설계(dev-foot 판단, 비파괴 확장) ──
 *   Q1 연동 = Option B. 기존 월균등(AUTOASSIGN-BALANCE-TOSS) primary 유지,
 *     기본순번은 pickLeastLoaded 3순위 tie-break(기존 random → 4순위 강등). 월초 0건 동률 시 순번 1번부터.
 *   Q2 영속 = staff.assign_sort_order 단일 ADDITIVE 컬럼(신규 테이블/enum/제약 없음). DA CONSULT(ADDITIVE) 게이트.
 *   Q3 skip = base 후보 풀(출근 ∩ 역할 − 임시off) 재사용 → off 직원은 candidates 에서 이미 제외 → 다음 순번 자동.
 *
 * 본 spec = 3 현장 시나리오(round-robin / skip / admin변경)의 정적·행동 단언.
 *   - 행동: pickLeastLoaded 를 직접 import 해 순번 tie-break·skip 동작을 결정적으로 검증.
 *   - 정적: 마이그/엔진/UI 소스 구조 단언.
 * 실렌더(갤탭 실브라우저 admin 편집→저장→재배정 반영)는 supervisor 맥스튜디오 실브라우저에서 보강.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pickLeastLoaded, type LoadCounts } from '../../src/lib/autoAssign';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const PAGE = 'src/pages/Assignments.tsx';
const ENGINE = 'src/lib/autoAssign.ts';
const TYPES = 'src/lib/types.ts';
const MIG = 'supabase/migrations/20260629120000_staff_assign_sort_order.sql';
const ROLLBACK = 'supabase/migrations/20260629120000_staff_assign_sort_order.rollback.sql';

const emptyLoad = (): LoadCounts => ({
  monthlyByAxis: new Map(),
  todayNet: new Map(),
  tossGiven: new Map(),
  pullCount: new Map(),
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1 — 기본 순번 round-robin (월초 동률 → 순번 1번부터)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S1 — 기본 순번 round-robin', () => {
  test('동률(월·일 0건)일 때 기본순번(assign_sort_order)이 가장 빠른 후보 선택', () => {
    const candidates = ['c', 'a', 'b']; // 순번 a<b<c 이지만 입력 순서는 섞임
    const order = new Map([['a', 1], ['b', 2], ['c', 3]]);
    // 100회 반복해도 항상 1번(a) — 랜덤이 아닌 결정적 순번 tie-break 증명
    for (let i = 0; i < 100; i++) {
      expect(pickLeastLoaded(candidates, emptyLoad(), order)).toBe('a');
    }
  });

  test('월 누적이 오르면 다음 순번으로 순환 = round-robin (이미 받은 1번 제침)', () => {
    const candidates = ['a', 'b', 'c'];
    const order = new Map([['a', 1], ['b', 2], ['c', 3]]);
    const load = emptyLoad();
    load.monthlyByAxis.set('a', 1); // 1번이 이미 1건 받음 → 2번(b) 차례
    expect(pickLeastLoaded(candidates, load, order)).toBe('b');
    load.monthlyByAxis.set('b', 1); // 2번도 받음 → 3번(c)
    expect(pickLeastLoaded(candidates, load, order)).toBe('c');
  });

  test('엔진: maybeAutoAssign 이 fetchAssignSortOrder 로드 후 pickLeastLoaded(pool, load, order) 호출', () => {
    const src = read(ENGINE);
    expect(src).toMatch(/const order = await fetchAssignSortOrder\(checkIn\.clinic_id\)/);
    expect(src).toMatch(/chosen = pickLeastLoaded\(pool, load, order\)/);
  });

  test('마이그 seed: 상담 7명 순번 = 김수린→송지현→엄경은→정연주→김지윤→이승은→김주연', () => {
    const sql = read(MIG);
    const consult = ['김수린', '송지현', '엄경은', '정연주', '김지윤', '이승은', '김주연'];
    consult.forEach((nm, i) => expect(sql).toContain(`('${nm}', ${i + 1})`));
    expect(sql).toMatch(/role = 'consultant'/);
  });

  test('마이그 seed: 치료 9명 순번 = 김규리→임별→조선미→윤시하→서은정→최민지→강혜인→박소예→김유리', () => {
    const sql = read(MIG);
    const therapy = ['김규리', '임별', '조선미', '윤시하', '서은정', '최민지', '강혜인', '박소예', '김유리'];
    therapy.forEach((nm, i) => expect(sql).toContain(`('${nm}', ${i + 1})`));
    expect(sql).toMatch(/role = 'therapist'/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2 — 휴무/임시 off skip (후보 풀에서 제외된 직원은 건너뛰고 다음 순번)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S2 — 휴무/off skip', () => {
  test('off 직원이 candidates 에서 빠지면 자동으로 다음 순번 선택(=skip)', () => {
    const order = new Map([['a', 1], ['b', 2], ['c', 3]]);
    // 1번(a)이 휴무/임시off → 후보 풀에서 제외됨 → 남은 후보 중 가장 빠른 순번 = 2번(b)
    const poolWithoutA = ['b', 'c'];
    for (let i = 0; i < 50; i++) {
      expect(pickLeastLoaded(poolWithoutA, emptyLoad(), order)).toBe('b');
    }
  });

  test('엔진: 후보 풀 = 출근 ∩ 역할 − 임시off (skip 데이터소스 = base 풀 재사용)', () => {
    const src = read(ENGINE);
    // 휴무(workingIds 미포함)·임시off(tempOff) 직원은 pool 단계에서 이미 제외 → 순번 skip 효과
    expect(src).toMatch(/role === targetRole && workingIds\.has\(s\.id\) && !tempOff\.has\(s\.id\)/);
  });

  test('순번 미지정(NULL) 직원은 후순위(NO_ORDER) — 신규 입사자 자동 포함', () => {
    const order = new Map([['a', 1]]); // b 는 순번 미지정
    const load = emptyLoad();
    load.monthlyByAxis.set('a', 5); // 1번이 이미 많이 받음 → 미지정 b 라도 선택될 수 있어야(공정)
    expect(pickLeastLoaded(['a', 'b'], load, order)).toBe('b');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 3 — admin 순번 변경 (편집 → 저장 → 즉시 반영, admin 권한 가드)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S3 — admin 순번 변경', () => {
  test('편집 권한 = admin/manager/director (그 외 버튼 비노출 + save 가드)', () => {
    const src = read(PAGE);
    expect(src).toMatch(/const canEditRotation =\s*[\s\S]*?role === 'admin'[\s\S]*?'manager'[\s\S]*?'director'/);
    // 버튼은 canEditRotation 일 때만 렌더
    expect(src).toMatch(/canEditRotation && \(\s*<Button[\s\S]*?rotation-order-open-btn/);
    // save 함수 내부 권한 재가드
    expect(src).toMatch(/if \(!canEdit\) return;/);
  });

  test('순번 편집 UI: 상담/치료 파트별 ↑/↓ 정렬 + 저장 버튼', () => {
    const src = read(PAGE);
    expect(src).toContain('data-testid="rotation-order-dialog"');
    expect(src).toContain('data-testid="rotation-save-btn"');
    expect(src).toMatch(/rotation-part-\$\{testid\}/); // 파트별 컨테이너 testid(consult/therapy 인자로 렌더)
    expect(src).toMatch(/renderList\('상담 파트', consult, setConsult, 'consult'\)/);
    expect(src).toMatch(/renderList\('치료 파트', therapy, setTherapy, 'therapy'\)/);
    expect(src).toMatch(/rotation-up-\$\{testid\}/);
    expect(src).toMatch(/rotation-down-\$\{testid\}/);
  });

  test('저장 = staff.assign_sort_order 위치(1-based) 일괄 UPDATE (즉시 반영, 기배정 소급X)', () => {
    const src = read(PAGE);
    expect(src).toMatch(/\.from\('staff'\)\.update\(\{ assign_sort_order: o\.ord \}\)\.eq\('id', o\.id\)/);
    expect(src).toMatch(/ord: i \+ 1/); // 위치 → 1-based 순번
  });

  test('인원수 하드코딩 금지 — active staff(role) 동적 로드(입·퇴사 자동반영)', () => {
    const src = read(PAGE);
    expect(src).toMatch(/\.eq\('active', true\)/);
    expect(src).toMatch(/\.in\('role', \['consultant', 'therapist'\]\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 스키마/안전 — ADDITIVE 단일 컬럼 + 사고방지(컬럼 미적용 시 graceful)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('SCHEMA — ADDITIVE + graceful', () => {
  test('마이그 = staff.assign_sort_order ADDITIVE (IF NOT EXISTS · nullable · 신규 테이블/enum 없음)', () => {
    const sql = read(MIG);
    expect(sql).toMatch(/ALTER TABLE staff ADD COLUMN IF NOT EXISTS assign_sort_order INTEGER/);
    expect(sql).not.toMatch(/CREATE TABLE/);
    expect(sql).not.toMatch(/CREATE TYPE/);
    expect(sql).not.toMatch(/NOT NULL/); // 컬럼은 nullable
  });

  test('롤백 = DROP COLUMN IF EXISTS', () => {
    expect(read(ROLLBACK)).toMatch(/ALTER TABLE staff DROP COLUMN IF EXISTS assign_sort_order/);
  });

  test('사고방지: fetchAssignSortOrder 는 메인 staff select 와 분리 + 오류 시 빈 맵(graceful)', () => {
    const src = read(ENGINE);
    expect(src).toMatch(/export async function fetchAssignSortOrder/);
    expect(src).toMatch(/if \(error\) return new Map\(\)/); // 42703 등 → 빈 맵
    // 메인 fetchActiveStaff 의 select 에는 신규 컬럼 미포함(staff=[] 사고 재발 방지)
    const fetchActive = src.slice(src.indexOf('export async function fetchActiveStaff'));
    expect(fetchActive.slice(0, 400)).not.toMatch(/assign_sort_order/);
  });

  test('pickLeastLoaded: order 미전달(빈 맵) 시 기존 random tie-break 로 하위호환', () => {
    // order 없이 호출해도 동작(타입·런타임) — 컬럼 미적용/구경로 안전
    const r = pickLeastLoaded(['a', 'b'], emptyLoad());
    expect(['a', 'b']).toContain(r);
  });

  test('타입: Staff.assign_sort_order?: number | null 추가', () => {
    expect(read(TYPES)).toMatch(/assign_sort_order\?: number \| null/);
  });
});
