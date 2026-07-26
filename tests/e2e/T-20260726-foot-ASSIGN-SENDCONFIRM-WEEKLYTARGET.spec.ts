/**
 * E2E spec — T-20260726-foot-ASSIGN-SENDCONFIRM-WEEKLYTARGET
 * 부모 = T-20260726-foot-CRM-ASSIGN-V1 (deployed). reporter=김주연 총괄(C0ATE5P6JTH).
 *
 * 후속 3건:
 *   변경1: 신규 실장(consultant) 등록 시 표시명 뒤 '실장' suffix 자동 부여(신규만·표시명만·staff_id 무접촉·멱등).
 *   변경2: '금일 배분 이력' [확정] 버튼 → 클릭 시에만 Slack 발송(구 실행5 즉시 자동발송 없음).
 *          건별 상태(미확정→발송됨)·재클릭 이중발송 방지(멱등)·발송완료 버튼 비활성.
 *          dependency(V1 dependency_2 상속): 실발송은 장쳰봇(C0B4HEC9SHH) 미초대로 블록 → 봇 초대 전 no-op(발송대기).
 *          게이트 골격 + '클릭 시에만 발송' 로직 선구현(발송 함수만 봇 join 시 언블록).
 *   변경3: 일일 배정 목표 = 현행 '당일 초진예약수' → '차주(다음주) 초진예약 접수' by-date 랭킹 기준 산출.
 *          랭킹 산식 = WEIGHT-B 확정 산식(computeRanking) 재사용(재발명 금지). 분배 = V1 계승(1등=꼴등 2배 2:1, 선형보간).
 *          STAFFCUMUL-REVAMP 변경2 [일일 배정 목표] 컬럼의 데이터 출처(느슨결합). 순수 파생(no-DDL).
 *          INV-1 RED LINE: 조회·파생만, customers.assigned_consultant_id 무접촉.
 *
 * 형제 foot spec 동형 — 정본 소스 정적 단언으로 불변식 인코딩.
 * 실렌더/클릭·날짜연동·실발송 값 검증은 supervisor 맥스튜디오 실브라우저(갤탭) 단계 보강(풋 done 조건).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const STAFF = 'src/pages/Staff.tsx';
const ASSIGN = 'src/pages/Assignments.tsx';
const STRATEGY = 'src/lib/assignmentStrategy.ts';
const DISPATCH = 'src/lib/assignmentDispatch.ts';

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1 — 변경1: 신규 실장 등록 시 표시명 '실장' suffix
// ─────────────────────────────────────────────────────────────────────────────
test('변경1: 신규 실장(consultant) 등록 시 표시명 뒤 "실장" suffix 부여 — 신규 CreateStaffDialog 경로', () => {
  const src = read(STAFF);
  // consultant 역할일 때만 suffix 부여(다른 역할은 원본 유지)
  expect(src).toMatch(/role === 'consultant'[\s\S]*?실장/);
  // 이미 '실장'으로 끝나면 중복 부여 방지(멱등)
  expect(src).toMatch(/!\/실장\\s\*\$\/\.test\(trimmedName\)/);
  // 접미사 부여된 표시명으로 insert (name: displayName)
  expect(src).toContain('name: displayName');
});

test('변경1: 표시명(name)만 변형 — 배정/매출귀속 내부 식별자(staff.id) 무접촉 + EditStaffDialog(기존) 소급 없음', () => {
  const src = read(STAFF);
  // CreateStaffDialog insert 에 id 를 명시 write 하지 않음(staff.id UUID = DB 생성, 접미사 로직이 id 미접촉)
  expect(src).not.toMatch(/insert\(\{[\s\S]*?id:\s*`?\$\{[\s\S]*?실장/);
  // 소급 금지: 기존 직원 수정(EditStaffDialog)의 update 에는 '실장' 접미사 로직이 없다(신규 등록분만).
  const editUpdate = src.slice(src.indexOf('.update({ name: name.trim(), role })'));
  expect(editUpdate).not.toContain('displayName');
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2 — 변경2: 금일 배분 이력 [확정] 발송 게이트 (클릭 시에만·멱등·비활성)
// ─────────────────────────────────────────────────────────────────────────────
test('변경2: [확정] 클릭 시에만 발송 — confirmDispatch 는 클릭 핸들러로만 발화(자동발송 경로 없음)', () => {
  const src = read(ASSIGN);
  // 발송 게이트 함수 존재 + [확정] 버튼 onClick 에서만 호출
  expect(src).toContain('const confirmDispatch = useCallback');
  expect(src).toMatch(/data-testid=\{`dist-confirm-btn-\$\{r\.id\}`\}[\s\S]*?onClick=\{\(\) => void confirmDispatch\(r\)\}/);
  // 발송 경계는 sendAssignmentSlack seam 경유(즉시 자동발송 배선 없음)
  expect(src).toContain("import { sendAssignmentSlack } from '@/lib/assignmentDispatch'");
  // 마운트/effect 등에서 자동 발송 호출이 없어야 함 — sendAssignmentSlack 직접 호출은 confirmDispatch 내부뿐
  const directCalls = src.match(/sendAssignmentSlack\(/g) ?? [];
  expect(directCalls.length).toBe(1);
});

test('변경2: 멱등(재클릭 이중발송 방지) + 발송완료 건 버튼 비활성(발송됨 배지)', () => {
  const src = read(ASSIGN);
  // 발송완료(dispatchedIds)·진행중(dispatchBusy) 가드 = 멱등
  expect(src).toContain('const [dispatchedIds, setDispatchedIds]');
  expect(src).toContain('const [dispatchBusy, setDispatchBusy]');
  expect(src).toMatch(/if \(dispatchedIds\.has\(row\.id\) \|\| dispatchBusy\.has\(row\.id\)\) return;/);
  // 발송완료 → 버튼 대신 '발송됨' 배지(비활성). 미발송 → [확정] 버튼(진행중이면 disabled)
  expect(src).toMatch(/dispatchedIds\.has\(r\.id\)[\s\S]*?발송됨/);
  expect(src).toMatch(/disabled=\{dispatchBusy\.has\(r\.id\)\}/);
});

test('변경2: 봇 미초대 = no-op(발송대기) seam — 봇 join 시 발송 함수만 언블록(UI/게이트 무변경)', () => {
  const src = read(DISPATCH);
  // 봇 초대 플래그 + no-op 반환(발송대기). db 무접촉(no-DDL).
  expect(src).toContain('ASSIGNMENT_SLACK_BOT_JOINED');
  expect(src).toMatch(/if \(!ASSIGNMENT_SLACK_BOT_JOINED\)[\s\S]*?noop: true/);
  expect(src).toContain('export async function sendAssignmentSlack');
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 3 — 변경3: 차주 초진예약 by-date → 일일 배정 목표 (WEIGHT-B 재사용·2:1·no-DDL·INV-1)
// ─────────────────────────────────────────────────────────────────────────────
test('변경3: 차주(다음주) 초진예약 by-date 집계 — visit_type=new, 취소/노쇼 제외, next-week 경계', () => {
  const src = read(STRATEGY);
  expect(src).toContain('export function nextWeekDatesSeoul');
  expect(src).toContain('export async function fetchNextWeekFirstVisitByDate');
  // 초진(new)만 + 다음주 날짜 범위 조회
  expect(src).toMatch(/\.eq\('visit_type', 'new'\)/);
  expect(src).toMatch(/const base = new Date\(Date\.UTC\(y, m - 1, d - backToMon \+ 7\)\)/); // 다음 주 월요일
  // 취소성(cancelled/no_show) 제외
  expect(src).toMatch(/r\.status === 'cancelled' \|\| r\.status === 'no_show'/);
});

test('변경3: 랭킹 산식 = WEIGHT-B computeRanking 재사용(재발명 금지) + 2:1 분배(interpolateDailyTargets 계승)', () => {
  const strat = read(STRATEGY);
  const assign = read(ASSIGN);
  // computeDailyAssignTargets 는 랭킹을 새로 만들지 않고 interpolateDailyTargets(V1) 로 2:1 분배
  expect(strat).toContain('export function computeDailyAssignTargets');
  expect(strat).toMatch(/return interpolateDailyTargets\(rankedIds, Math\.round\(top\), Math\.round\(bottom\)\)/);
  expect(strat).toMatch(/const bottom = Math\.max\(1, dailyVolume \/ \(1\.5 \* n\)\)/); // 2:1 역산
  expect(strat).toMatch(/const top = bottom \* 2/);
  // 소비측: computeRanking(WEIGHT-B 산식) → computeDailyAssignTargets 로 목표 산출
  expect(assign).toMatch(/const ranked = computeRanking\(consultantIds, consultMetrics, rankingWeights\)/);
  expect(assign).toMatch(/return computeDailyAssignTargets\(ranked, nextWeekFirstVisit\)/);
});

test('변경3: [일일 배정 목표] 컬럼 값 = dailyTargetOf 주입점(STAFFCUMUL 느슨결합) + 실시간 온디맨드 재조회', () => {
  const src = read(ASSIGN);
  // 느슨결합 주입점: dailyTargetOf 가 dailyTargetMap 소비(상수 null 제거됨)
  expect(src).toMatch(/const dailyTargetOf = useCallback\([\s\S]*?dailyTargetMap\.get\(st\.staff\.id\) \?\? null/);
  expect(src).not.toMatch(/const dailyTargetOf = useCallback\(\(_st: StaffStat\): number \| null => \{\s*return null;/);
  // 온디맨드+lazy: 진입/클리닉/탭/기준일 변동 시 차주 초진예약·지표 재조회 → 예약 변동 반영
  expect(src).toMatch(/fetchNextWeekFirstVisitByDate\(clinic\.id, todayIso\)/);
  expect(src).toMatch(/\}, \[clinic, activeTab, selectedDate\]\);/);
});

test('변경3: INV-1 RED LINE — 조회·파생만, customers.assigned_consultant_id 무접촉', () => {
  const strat = read(STRATEGY);
  const assign = read(ASSIGN);
  // 신규 by-date 조회 함수 영역: reservations read-only select 뿐(write 계열 없음) + assigned_consultant_id 미접촉
  const fnStart = strat.indexOf('export async function fetchNextWeekFirstVisitByDate');
  const fnEnd = strat.indexOf('export function computeDailyAssignTargets');
  const region = strat.slice(fnStart, fnEnd);
  expect(region).toContain(".from('reservations')");
  expect(region).not.toMatch(/\.update\(|\.insert\(|\.upsert\(|\.delete\(/);
  expect(region).not.toContain('assigned_consultant_id');
  // 소비측(Assignments 변경3 배선)도 assigned_consultant_id write 없음(read-only 파생)
  expect(assign).not.toMatch(/assigned_consultant_id.*=|update\([^)]*assigned_consultant_id/);
});
