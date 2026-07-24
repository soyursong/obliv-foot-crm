/**
 * E2E spec — T-20260724-foot-TREATTABLE-CHARTNO-CHART2-LINK (P2/foot)
 * (dedup canonical of T-20260724-foot-TREATTABLE-CHARTNUM-NAMECLICK-CHART2, closed/superseded)
 *
 * 현장 요청(김주연 총괄, 채널 C0ATE5P6JTH):
 *   치료테이블 고객 성함 옆에 차트번호가 항상 세트로 표시되어야 하고([성함][차트번호]),
 *   성함 클릭 시 그 고객의 2번차트로 이동해야 한다(「금일 배분 이력」 ASSIGNHIST-CHARTNO-CHART2-LINK 동선 계승).
 *   - AC-1: 치료테이블 각 탭 고객 성함 셀에 차트번호 병기(chartNoBadge). 미발번=#미발번(형제 탭 관례 준용).
 *   - AC-2: 성함 클릭 → 2번차트 오픈. 부모 TreatmentTable.nameInteraction.onLeftClick → useChart 단일 게이트(모든 탭 공유).
 *   - AC-3: 정렬/필터/타 컬럼/우클릭 CRM 메뉴 회귀 없음.
 *
 * 구현 핵심(델타 = 이 티켓이 실제로 바꾼 것):
 *   치료테이블 탭 중 진료(DoctorHistory)/균검사(Exam)/경과분석(ProgressTargets) 세 탭은 이미
 *   chartNoBadge 병기 + nameInteraction 성함클릭이 배선됨(T-20260622 ADDON D). 유일 누락 탭이
 *   소견서·진단서(DiagDocSection) — 성함클릭(2번차트)은 있었으나 차트번호 병기가 없었음.
 *   본건은 DiagDocSection 에 차트번호 병기를 형제 탭과 동일 스타일로 추가해 "항상 세트"를 완성한다.
 *   chartNo 는 OpinionRequestRow.chartNo(field_data.chart_no) 상속 — 신규 조회 0(단일 소스 유지), db_change=false.
 *
 * ※ 배포 정본(origin/main) 기준 치료테이블 구조에 맞춤. 형제 티켓(LABTAB-SPLIT-BLOODLIST/TAB-ORDER-RENAME)이
 *    아직 정본에 미반영 → 본 spec 은 정본에 존재하는 탭(history/exam/progress/diagdoc)만 단언.
 *
 * 정본 소스 정적 단언(데이터/로그인 비의존) — 형제 foot spec 동형.
 * 실렌더(차트번호 표기/클릭 2번차트 오픈/동명이인 식별)는 supervisor 맥스튜디오 실브라우저(갤탭) 단계 보강.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const PARENT = 'src/pages/TreatmentTable.tsx';
const DIAGDOC = 'src/components/treatment/DiagDocSection.tsx';
const DOCHIST = 'src/components/treatment/DoctorHistorySection.tsx';
const EXAM = 'src/components/treatment/ExamTargetsSection.tsx';
const PROGRESS = 'src/components/treatment/ProgressTargetsSection.tsx';

// 성함클릭(2번차트) + chartNoBadge 병기가 이미 배선된 형제 탭(정본 기준).
const SIBLINGS = [DOCHIST, EXAM, PROGRESS];

// ─────────────────────────────────────────────────────────────────────────────
// AC-2 (배선 SSOT): 부모 TreatmentTable 이 성함 좌클릭 → 2번차트(useChart) 단일 게이트를 소유하고
//   각 섹션 탭에 nameInteraction 으로 위임한다(동명이인 오라우팅 방지 = customerId PK 전달).
// ─────────────────────────────────────────────────────────────────────────────
test('AC-2: 부모가 좌클릭→2번차트(useChart.openChart) 게이트를 소유하고 nameInteraction 로 위임', () => {
  const src = read(PARENT);
  // useChart 단일 게이트
  expect(src).toMatch(/const \{ openChart \} = useChart\(\);/);
  // onLeftClick = customerId(PK) 로 2번차트 오픈
  expect(src).toMatch(/onLeftClick: \(customerId\) => \{\s*if \(customerId\) openChart\(customerId\);/);
  // 성함 인터랙션 섹션 탭(진료/균검사/경과분석/소견서·진단서)에 nameInteraction 전달
  const passes = src.match(/nameInteraction=\{nameInteraction\}/g);
  expect(passes).not.toBeNull();
  expect(passes!.length).toBeGreaterThanOrEqual(4);
  // DiagDocSection 도 위임 대상(델타 탭)
  expect(src).toMatch(/<DiagDocSection[^>]*nameInteraction=\{nameInteraction\}/);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-1 (델타): DiagDocSection 에 차트번호 병기 추가 — 형제 탭과 동일 chartNoBadge 스타일.
// ─────────────────────────────────────────────────────────────────────────────
test('AC-1(델타): DiagDocSection 이 chartNoBadge 를 import 하고 성함 옆에 병기', () => {
  const src = read(DIAGDOC);
  // format 헬퍼 재사용(신규 스타일 창작 금지)
  expect(src).toMatch(/import \{[^}]*chartNoBadge[^}]*\} from '@\/lib\/format';/);
  // 성함 셀 = 이름 span + 차트번호 badge span(형제 탭 DoctorHistory/Exam 동일 클래스)
  expect(src).toContain('<span>{r.patientName}</span>');
  expect(src).toMatch(/font-mono text-\[11px\] font-normal text-muted-foreground\/70/);
  expect(src).toMatch(/chartNoBadge\(r\.chartNo\)/);
});

test('AC-1(델타): DiagDocRow 가 chartNo 를 보유하고 buildDiagDocRows 가 OpinionRequestRow 에서 상속(신규 조회 0)', () => {
  const src = read(DIAGDOC);
  // 타입 필드
  expect(src).toMatch(/chartNo: string \| null;/);
  // 두 경로(발행완료 + 미발행) 모두 chartNo 채움 = 단일 소스 상속
  const fills = src.match(/chartNo: r\.chartNo,/g);
  expect(fills).not.toBeNull();
  expect(fills!.length).toBe(2);
  // 별도 customers 조회 없음(db_change=false, 단일 소스) — DiagDocSection 은 opinionRequest 훅만 사용
  expect(src).not.toMatch(/from\('customers'\)/);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-1 (회귀 유지): 형제 탭은 이미 chartNoBadge 병기 + 성함클릭 배선됨(무회귀).
// ─────────────────────────────────────────────────────────────────────────────
test('AC-1(유지): 진료/균검사/경과분석 형제 탭 chartNoBadge 병기 유지', () => {
  for (const p of SIBLINGS) expect(read(p)).toMatch(/chartNoBadge\(/);
});

test('AC-2(유지): 형제 탭 + DiagDoc 성함 셀이 nameInteraction.onLeftClick(2번차트) 배선 유지', () => {
  for (const p of [...SIBLINGS, DIAGDOC]) {
    expect(read(p)).toMatch(/nameInteraction\.onLeftClick\(r\.customerId\)/);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-3 (회귀): DiagDocSection 정렬/필터/발행여부/발행본 뷰어/우클릭 CRM 메뉴 무변경.
// ─────────────────────────────────────────────────────────────────────────────
test('AC-3: DiagDocSection 정렬/발행여부/발행본 뷰어/우클릭 메뉴 회귀 없음', () => {
  const src = read(DIAGDOC);
  // 신청시각 역순 정렬 유지
  expect(src).toMatch(/\.sort\(\(a, b\) => \(b\.requestedAt \?\? ''\)\.localeCompare\(a\.requestedAt \?\? ''\)\)/);
  // 발행완료 서류명 클릭 열람 유지
  expect(src).toContain('data-testid="diagdoc-docname-view"');
  // 성함 우클릭 CRM 컨텍스트 메뉴 위임 유지
  expect(src).toMatch(/nameInteraction\.onContextMenu\(e, \{/);
  // 발행/미발행 배지 유지
  expect(src).toContain('data-testid="diagdoc-publish-badge"');
});
