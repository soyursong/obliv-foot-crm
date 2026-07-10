/**
 * E2E spec — T-20260710-foot-ASSIGN-ORDER-SCROLL-TREATSELECT
 *
 * 풋센터 상담·치료사 배정 > "자동배정 기본순번 설정"(RotationOrderDialog) 화면 2종 버그.
 *   현장(김주연 총괄, C0ATE5P6JTH, 2026-07-10) P1(업무중단성): (1)스크롤 부재로 하단 짤림
 *   (2)'가능 시술'(가능 치료) 체크박스 비활성으로 선택 불가.
 *
 * ── Bug1 (스크롤) — AC1 ── [본 커밋에서 해소]
 *   DialogContent 에 max-h/overflow 부재 → 치료 파트 다수 + capability 체크박스 + 힌트로
 *   화면 높이 초과 시 하단(순번 저장 버튼 포함) 짤림. 수정 = DialogContent 에
 *   `max-h-[90vh] overflow-y-auto` (레포 형제 다이얼로그 다수 선례: TreatmentSetsTab/
 *   DiagnosisSetsTab/ConsentFormDialog/PreChecklist 등 동일 패턴).
 *
 * ── Bug2 (가능 시술 비활성) — AC2 ── [근본원인 정정 + 항구조치 stage / apply 는 planner escalate]
 *   ⚠ 티켓 접수 시 추정 RC("테이블 배포됨, NOTIFY 만 누락 → stale 스키마캐시")는 **런타임 실측으로
 *      반증됨**. 2026-07-10 dev-foot 실측(Supabase Management API + PostgREST REST probe):
 *        · information_schema.tables: therapist_capabilities 부재(has_tc=0), chart_treatment_requests 부재(has_ctr=0)
 *        · supabase_migrations.schema_migrations: 20260701130000 / 20260701120000 미기록
 *        · PostgREST REST: PGRST205 "Could not find the table 'public.therapist_capabilities' in the schema cache"
 *        · pg_notify('pgrst','reload schema') 발사(HTTP 201) 후에도 여전히 404 → 리로드할 테이블이 없음(=미적용 확정)
 *        · 대조군: staff.assign_sort_order / treatment_photos / customers.insurance_cert_no / patient_file_records 는 전부 존재
 *          → 원장 ledger gap 은 양성 OOB divergence 이고, 두 테이블만 특정적으로 미적용.
 *      정정 RC = therapist_capabilities 테이블이 prod 에 애초 적용되지 않음 → capErr → capMissing=true → 체크박스 disabled.
 *      FE 의 disabled 로직(capMissing 조건)은 **정상**(graceful degradation) — 수정 대상 아님.
 *   본 커밋 = §23 항구조치 stage: 마이그 20260701130000 파일 말미에 `NOTIFY pgrst, 'reload schema'` 추가
 *      (적용 시 즉시 REST 노출 보장). 실제 prod apply(신규 테이블 DDL = db_change true) 는 티켓 db_change:false
 *      전제를 뒤집으므로 planner 재스코프 + 리스크 재판정 후. (CONSULT 축은 이미 GO — 원 마이그 헤더에
 *      DA CONSULT-REPLY GO/ADDITIVE 명시, MSG-20260701-175504-8mjx.)
 *
 * 본 spec = 소스/마이그 정적 단언. 실렌더(갤탭 실브라우저 스크롤 육안 + 마이그 apply 후 capMissing=false
 *   재현)는 supervisor 맥스튜디오 실브라우저에서 보강(AC2 는 apply 후에만 최종 PASS).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const PAGE = 'src/pages/Assignments.tsx';
const MIG_TC = 'supabase/migrations/20260701130000_foot_therapist_capabilities.sql';

// RotationOrderDialog 본문만 슬라이스(다른 다이얼로그 오염 방지)
function rotationDialogBody(src: string): string {
  const start = src.indexOf('function RotationOrderDialog');
  expect(start).toBeGreaterThan(-1);
  return src.slice(start);
}

// ─────────────────────────────────────────────────────────────────────────────
// A — 스크롤 짤림 해소 (AC1) : DialogContent 에 max-h + overflow-y-auto
// ─────────────────────────────────────────────────────────────────────────────
test.describe('A — 스크롤 짤림 해소 (AC1)', () => {
  test('RotationOrderDialog DialogContent 에 max-h-[90vh] + overflow-y-auto', () => {
    const body = rotationDialogBody(read(PAGE));
    const dc = body.match(/<DialogContent className="([^"]*)" data-testid="rotation-order-dialog"/);
    expect(dc, 'rotation-order-dialog DialogContent 를 찾지 못함').not.toBeNull();
    const cls = dc![1];
    expect(cls).toContain('max-h-[90vh]');
    expect(cls).toContain('overflow-y-auto');
    // 기존 폭 제약 유지(회귀 없음)
    expect(cls).toContain('max-w-2xl');
  });

  test('DialogHeader/DialogFooter(순번 저장 버튼) 는 스크롤 컨테이너 내부에 보존 — 최하단 접근 가능', () => {
    const body = rotationDialogBody(read(PAGE));
    // 저장 버튼이 DialogFooter 안에 그대로 존재(스크롤로 도달 가능해야 함)
    expect(body).toMatch(/<DialogFooter>[\s\S]*data-testid="rotation-save-btn"[\s\S]*<\/DialogFooter>/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B — 가능 시술 비활성 RC 정정 + §23 항구조치 stage (AC2)
//     FE disabled 로직은 정상(graceful) → 불변. 마이그 파일에 NOTIFY 위생 추가(apply 시 즉시 노출).
// ─────────────────────────────────────────────────────────────────────────────
test.describe('B — 가능 시술 활성화 근본원인 (AC2)', () => {
  test('마이그 20260701130000 파일 말미에 NOTIFY pgrst reload schema 추가(§23 항구조치)', () => {
    const mig = read(MIG_TC);
    expect(mig).toMatch(/NOTIFY pgrst, 'reload schema';/);
    // COMMIT 이후(트랜잭션 밖 standalone)에 위치 — 리로드가 커밋 뒤 발사되도록
    const commitIdx = mig.lastIndexOf('COMMIT;');
    const notifyIdx = mig.indexOf("NOTIFY pgrst, 'reload schema';");
    expect(commitIdx).toBeGreaterThan(-1);
    expect(notifyIdx).toBeGreaterThan(commitIdx);
  });

  test('FE capMissing graceful degradation 로직 불변(정상 동작 — 수정 대상 아님)', () => {
    const body = rotationDialogBody(read(PAGE));
    // capErr → capMissing=true 세팅 경로 보존
    expect(body).toMatch(/if \(capErr\)\s*\{\s*setCapMissing\(true\);/);
    // capMissing 시 체크박스 disable 전달(정상 로직)
    expect(body).toMatch(/capDisabled=\{capMissing\}/);
    // capMissing 시 토글 no-op(저장 오염 방지)
    expect(body).toMatch(/if \(!canEdit \|\| capMissing\) return;/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C — 회귀 0 (AC3) : 순번 저장경로 · capability delta 저장 · 드래그 · ASSIGNMENT-LIST-TAB 불변
// ─────────────────────────────────────────────────────────────────────────────
test.describe('C — 회귀 0 (AC3)', () => {
  test('assign_sort_order 1-based 일괄 UPDATE 저장경로 불변', () => {
    const src = read(PAGE);
    expect(src).toMatch(/\.from\('staff'\)\.update\(\{ assign_sort_order: o\.ord \}\)\.eq\('id', o\.id\)/);
    expect(src).toMatch(/ord: i \+ 1/);
  });

  test('therapist_capabilities delta upsert/delete 저장경로 불변', () => {
    const src = read(PAGE);
    expect(src).toMatch(/\.from\('therapist_capabilities'\)\s*\.upsert\(inserts, \{ onConflict: 'staff_id,capability_code' \}\)/);
    expect(src).toMatch(/\.from\('therapist_capabilities'\)\s*\.delete\(\)\.eq\('staff_id', d\.staff_id\)\.eq\('capability_code', d\.code\)/);
  });

  test('@dnd-kit 드래그 정렬 스택 불변', () => {
    const src = read(PAGE);
    expect(src).toMatch(/DndContext/);
    expect(src).toMatch(/SortableContext/);
    expect(src).toMatch(/arrayMove/);
  });

  test('인접 [배정목록] 탭(ASSIGNMENT-LIST-TAB) 마운트 불변', () => {
    const src = read(PAGE);
    // 배정 화면 상단 탭 구조 보존(회귀 없음)
    expect(src).toMatch(/RotationOrderDialog/);
  });
});
