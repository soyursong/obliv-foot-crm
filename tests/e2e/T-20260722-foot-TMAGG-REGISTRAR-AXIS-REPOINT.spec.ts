/**
 * T-20260722-foot-TMAGG-REGISTRAR-AXIS-REPOINT — TM집계 registrar_name 축 repoint E2E spec
 *
 * §963⑩(a) 집행: TmAggregateSection 이 registrar_name 을 grouping key / "TM팀만" inclusion
 * 판정축으로 read 하던 위반을 정규 귀속키(created_by 기반 tmAttributionKey)로 repoint.
 *   - grouping key = 직원명 / '도파민 등록'(도파민-출처 단일 버킷) / '미지정'. registrar_name 무접촉.
 *   - "TM팀만" = created_by → user_profiles.role='tm' 직접 판정. registrar_name 무접촉.
 *   - registrar_name = label-only — 드릴다운 '등록자(예약)' 열에서만 표시(count 무영향).
 *
 * 라이브 진단(2026-07-22, 60일 687건): 위반 시 374건 registrar_name grouping / 354건
 *   registrar_name "TM팀만" inclusion → 본 repoint 로 0.
 *
 * 검증:
 *   A. 정적 소스 불변식 — grouping/filter 축이 attrKey/isTmRes 로 repoint, registrar_name 무접촉.
 *   B. 집계-inert 수치 시뮬 — registrar_name 을 어떻게 바꿔도 grouping count 불변.
 *
 * READ-ONLY — DB 변경 없음.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

// ─────────────────────────────────────────────────────────────────────────────
// A. 정적 소스 불변식 — 축 repoint + registrar_name 무접촉
// ─────────────────────────────────────────────────────────────────────────────
test.describe('정적 소스 불변식 — TM집계 축 repoint (T-20260722)', () => {
  const comp = read('src/components/stats/TmAggregateSection.tsx');
  const stats = read('src/lib/stats.ts');

  test('A1: 정규 귀속키 tmAttributionKey 존재 — registrarName 파라미터 없음(구조적 inert)', () => {
    // 함수 시그니처에 registrarName 인자가 없어야 한다(있으면 registrar_name 을 read할 수 있는 통로).
    const sig = stats.match(/export function tmAttributionKey\(([\s\S]*?)\)\s*:/);
    expect(sig, 'tmAttributionKey 선언 존재').not.toBeNull();
    expect(sig![1]).not.toMatch(/registrar/i);
    expect(sig![1]).toMatch(/createdBy/);
    expect(sig![1]).toMatch(/sourceSystem/);
    expect(sig![1]).toMatch(/staffName/);
  });

  test('A2: 도파민-출처 단일 버킷 상수 = 도파민 등록', () => {
    expect(stats).toMatch(/TM_DOPAMINE_BUCKET\s*=\s*'도파민 등록'/);
    // tmAttributionKey 가 dopamine → 버킷, 그 외 미해소 → 미지정
    expect(stats).toMatch(/if\s*\(createdBy\s*&&\s*staffName\)\s*return\s*staffName/);
    expect(stats).toMatch(/return\s*TM_DOPAMINE_BUCKET/);
  });

  test('A3: grouping(tmStats) 축 = attrKey — labelForRes(registrar 포함) 미사용', () => {
    // tmStats 합산이 attrKeyForRes/attrKeyForCheckIn 로 이뤄진다.
    expect(comp).toMatch(/ensure\(attrKeyForRes\(r\)\)\.registered/);
    expect(comp).toMatch(/ensure\(attrKeyForRes\(r\)\)\.scheduled/);
    expect(comp).toMatch(/ensure\(attrKeyForCheckIn\(ci\)\)\.visited/);
    // 구 grouping 심볼(labelForRes/labelForCheckIn) 은 완전히 제거.
    expect(comp).not.toMatch(/labelForRes/);
    expect(comp).not.toMatch(/labelForCheckIn/);
  });

  test('A4: "TM팀만" inclusion = created_by role 직접 판정 — registrar/name-set 무접촉', () => {
    expect(comp).toMatch(/isTmRes\s*=\s*\(r: TmResRow\)[\s\S]{0,120}staffMap\[r\.created_by\]\?\.role\s*===\s*'tm'/);
    expect(comp).toMatch(/onlyTmRole \? filteredRegistered\.filter\(\(r\) => isTmRes\(r\)\)/);
    expect(comp).toMatch(/onlyTmRole \? filteredVisited\.filter\(\(ci\) => isTmCheckIn\(ci\)\)/);
    // 구 name-set 기반 필터(tmRoleNames/isTmLabel) 제거.
    expect(comp).not.toMatch(/tmRoleNames/);
    expect(comp).not.toMatch(/isTmLabel/);
  });

  test('A5: attrKey/isTm 경로는 registrar_name 을 read 하지 않는다(집계-inert)', () => {
    // 귀속키 헬퍼 정의(attrKeyForRes)에 registrar 참조 없음 — tmAttributionKey(3인자) 만 호출.
    const attrRes = comp.match(/const attrKeyForRes = \(r: TmResRow\): string =>[\s\S]*?;/);
    expect(attrRes, 'attrKeyForRes 선언 추출').not.toBeNull();
    expect(attrRes![0]).not.toMatch(/registrar/i);
    expect(attrRes![0]).toMatch(/tmAttributionKey\(r\.created_by, r\.source_system, staffMap\[r\.created_by \?\? ''\]\?\.name\)/);
    // 필터 판정 헬퍼(isTmRes)에 registrar 참조 없음 — created_by role 만.
    const isTmResDecl = comp.match(/const isTmRes =[\s\S]*?=== 'tm';/);
    expect(isTmResDecl, 'isTmRes 선언 추출').not.toBeNull();
    expect(isTmResDecl![0]).not.toMatch(/registrar/i);
  });

  test('A6: registrar_name = label-only — 드릴다운 등록자(예약) 열에서만 소비', () => {
    // registrant 라벨 헬퍼는 tmCounselorLabel(라벨 전용) 로만 파생.
    expect(comp).toMatch(/registrantLabelForRes[\s\S]{0,140}tmCounselorLabel\(/);
    // DetailRow 에 registrant(label-only) 필드 + tm(귀속) 필드 분리.
    expect(comp).toMatch(/tm:\s*attrKeyForRes\(r\)/);
    expect(comp).toMatch(/registrant:\s*registrantLabelForRes\(r\)/);
    // 드릴다운/CSV 에 '등록자(예약)' 라벨 컬럼.
    expect(comp).toMatch(/등록자\(예약\)/);
  });

  test('A7 무회귀: 세 지표 날짜축·"내 예약만"(created_by)·워크인 처리 불변', () => {
    expect(comp).toMatch(/isMyRecord\s*=\s*\(uid: string \| null\)/);
    expect(comp).toMatch(/registeredRes\.filter\(\(r\) => isMyRecord\(r\.created_by\)\)/);
    // 내원의 raw uid 귀속은 created_by (registrar 아님)
    expect(comp).toMatch(/allResMap\.get\(ci\.reservation_id\)!\.created_by \|\| UNASSIGNED/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B. 집계-inert 수치 시뮬 — SSOT(tmAttributionKey) 로직 replica 로 count 불변 증명
//    (stats.ts 는 '@/lib/supabase' 를 import 하므로 e2e 러너에서 직접 import 불가 →
//     A1/A2 로 검증된 3-branch 로직을 replica 하여 registrar_name 변주 하 count 동일성 검증)
// ─────────────────────────────────────────────────────────────────────────────
type Row = { created_by: string | null; source_system: string | null; registrar_name: string | null };
const STAFF: Record<string, { name: string; role: string }> = {
  'uid-tm': { name: '진운선', role: 'tm' },
  'uid-desk': { name: '데스크', role: 'coordinator' },
};
// replica of tmAttributionKey (검증됨: A1/A2 시그니처·분기)
const attrKey = (r: Row) => {
  const staffName = r.created_by ? STAFF[r.created_by]?.name : undefined;
  if (r.created_by && staffName) return staffName;
  if ((r.source_system ?? '').trim() === 'dopamine') return '도파민 등록';
  return '미지정';
};
const isTm = (r: Row) => !!r.created_by && STAFF[r.created_by!]?.role === 'tm';
const groupCounts = (rows: Row[]) => {
  const m = new Map<string, number>();
  rows.forEach((r) => m.set(attrKey(r), (m.get(attrKey(r)) ?? 0) + 1));
  return Object.fromEntries([...m.entries()].sort());
};

test.describe('집계-inert 수치 시뮬 (T-20260722)', () => {
  // 도파민-출처 예약(created_by=NULL) — 라이브 실측상 registrar_name=진운선/이수빈 등으로 채워짐
  const base: Row[] = [
    { created_by: null, source_system: 'dopamine', registrar_name: '진운선' },
    { created_by: null, source_system: 'dopamine', registrar_name: '이수빈' },
    { created_by: null, source_system: 'dopamine', registrar_name: '김효신' },
    { created_by: 'uid-tm', source_system: null, registrar_name: '진운선' },
    { created_by: 'uid-desk', source_system: null, registrar_name: '진운선' },
    { created_by: null, source_system: null, registrar_name: '' },
  ];

  test('B1: 도파민-출처는 registrar_name 과 무관하게 단일 버킷 도파민 등록으로 합산', () => {
    const g = groupCounts(base);
    expect(g['도파민 등록']).toBe(3); // 3건 도파민 → 한 버킷 (진운선/이수빈/김효신 분산 안 됨)
    expect(g['진운선']).toBe(1);      // created_by=uid-tm 직원귀속만 (registrar_name=진운선 도파민행은 여기 아님)
    expect(g['데스크']).toBe(1);      // created_by=uid-desk → 직원명 resolve (role 무관, 귀속은 직원)
    expect(g['미지정']).toBe(1);      // created_by=NULL & 비도파민 & registrar 무관
  });

  test('B2: registrar_name 을 어떻게 바꿔도 grouping count 불변(편집→count 불변)', () => {
    const before = groupCounts(base);
    // registrar_name 전건을 임의값으로 mutate (편집 시뮬)
    const mutated = base.map((r) => ({ ...r, registrar_name: '★임의편집★' + Math.random() }));
    const after = groupCounts(mutated);
    expect(after).toEqual(before);
  });

  test('B3: "TM팀만" inclusion 은 created_by role 로만 — registrar_name=진운선 도파민행 미포함', () => {
    const tmOnly = base.filter(isTm);
    // created_by=uid-tm 1건만 TM. registrar_name=진운선 인 도파민행(created_by=NULL)은 제외.
    expect(tmOnly.length).toBe(1);
    expect(tmOnly[0].created_by).toBe('uid-tm');
    // registrar_name mutate 해도 inclusion 불변
    const mutated = base.map((r) => ({ ...r, registrar_name: '진운선' }));
    expect(mutated.filter(isTm).length).toBe(1);
  });
});
