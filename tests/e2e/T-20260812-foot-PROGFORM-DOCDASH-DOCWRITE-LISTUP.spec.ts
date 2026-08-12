/**
 * E2E Spec — T-20260812-foot-PROGFORM-DOCDASH-DOCWRITE-LISTUP (P2, FE-only read-linkage, §11 gate satisfied)
 *
 * 요청(김주연 총괄, C0ATE5P6JTH, MSG-20260812-131538-y023 후반부):
 *   "해당 서류 최종적으로 원장님께서 발행해주는거니 진료대시보드 → 서류작성 탭에도 리스트업 해줘"
 *   경과분석지(6배수 도래 환자 대상, SONGDO-FORM-DOWNLOAD로 생성) = 원장 최종 발행 서류 →
 *   원장 동선(진료대시보드 → 서류작성 탭)에도 발행 대상을 리스트업(발행 동선 일원화).
 *
 * §11 medical_confirm_gate: 진료대시보드=의사공간. 문지은 대표원장 컨펌(MSG-20260812-142118-tgmv,
 *   thread 1786511989.307569) → confirm_status:confirmed·게이트 satisfied → 착수.
 *
 * 구현 (분기(a) 순수 read-linkage, db_change=false — prod WRITE/DDL 0):
 *   · SSOT 재사용 — 치료테이블 §③ 경과분석의 ProgressTargetsSection 을 서류작성(opinion_doc) 탭에 그대로 렌더.
 *     서류작성 탭 목록 로직 '병렬 신설 금지'(이중구현/surface drift 회피) → 동일 컴포넌트/동일 useProgressTargets 쿼리.
 *   · 모집단 = PROGCHK 필터(progressSixMultiple.isSixMultipleTarget: 활성 패키지 & (used+1)%6==0) — by-construction 정합(AC2).
 *   · PHI 게이트(AC3) — 원장(director) + 운영권한(admin/manager)만 노출(canSeeProgressDocs). director escape 는
 *     canViewPhraseManagement/canEditClinicMgmt 동일 stopgap(has_ops_authority 미적재 동안 대표원장 lock-out 방지).
 *   · DocRequestQueue(실장→원장 발행요청 큐) + OpinionDocTab(소견서 작성) 무접촉(AC4 regression 0).
 *
 * 수용 기준:
 *   AC1 — 서류작성 탭에 경과분석지 발행 대상 리스트업(ProgressTargetsSection 렌더).
 *   AC2 — 리스트업 모집단이 PROGCHK 필터(활성 패키지 & (used+1)%6==0)와 정합(동일 SSOT 함수).
 *   AC3 — 원장/admin/manager PHI 게이트.
 *   AC4 — 서류작성 탭 기존 항목(DocRequestQueue·OpinionDocTab) regression 0.
 *   AC5 — 순수 read-linkage(DoctorTools 변경에 write/RPC/DDL 0).
 *
 * 구성:
 *   A. 순수 로직 — PROGCHK 6배수 필터(isSixMultipleTarget) 정합(시나리오 2: 6배수 도래 vs 비대상·tier0 배제).
 *   B. 정적 소스 가드 — SSOT 재사용(ProgressTargetsSection import·병렬 리스트 신설 없음) + PHI 게이트 + AC4 무접촉 + read-only.
 *
 * 실행: npx playwright test T-20260812-foot-PROGFORM-DOCDASH-DOCWRITE-LISTUP.spec.ts --project=unit
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isSixMultipleTarget } from '../../src/lib/progressSixMultiple';

const HERE = dirname(fileURLToPath(import.meta.url));
const DOCTOOLS_SRC = () =>
  readFileSync(join(HERE, '../../src/pages/DoctorTools.tsx'), 'utf-8');
const PROGSECTION_SRC = () =>
  readFileSync(join(HERE, '../../src/components/treatment/ProgressTargetsSection.tsx'), 'utf-8');

// ── A. 순수 로직 — PROGCHK 모집단 정합(AC2, 시나리오 2) ────────────────────────────────
test.describe('A. PROGCHK 6배수 필터 — 서류작성 탭 리스트업 모집단 정합(AC2)', () => {
  test('6의 배수 도래(다음 회차 6·12·18·24)만 대상 — 서류작성 탭·경과분석 탭 동일 기준', () => {
    // used+1 이 6의 배수면 대상(활성 패키지 tier>0).
    expect(isSixMultipleTarget({ usedSessions: 5, totalSessions: 12 })).toBe(true); // 다음=6
    expect(isSixMultipleTarget({ usedSessions: 11, totalSessions: 12 })).toBe(true); // 다음=12
    expect(isSixMultipleTarget({ usedSessions: 17, totalSessions: 24 })).toBe(true); // 다음=18
  });

  test('6배수 아닌 회차(예: 3회 완료→다음 4회차)는 미노출 — 시나리오 2 반례', () => {
    expect(isSixMultipleTarget({ usedSessions: 3, totalSessions: 12 })).toBe(false); // 다음=4
    expect(isSixMultipleTarget({ usedSessions: 0, totalSessions: 12 })).toBe(false); // 다음=1
    expect(isSixMultipleTarget({ usedSessions: 6, totalSessions: 12 })).toBe(false); // 다음=7
  });

  test('tier0(체험/Re:Born·total_sessions<=0) 배제 — 6배수여도 미대상', () => {
    expect(isSixMultipleTarget({ usedSessions: 5, totalSessions: 0 })).toBe(false);
    expect(isSixMultipleTarget({ usedSessions: 5, totalSessions: null })).toBe(false);
    expect(isSixMultipleTarget({ usedSessions: 5, totalSessions: undefined })).toBe(false);
  });
});

// ── B. 정적 소스 가드 — SSOT 재사용 + PHI 게이트 + AC4 무접촉 + read-only ────────────────
test.describe('B. DoctorTools 서류작성 탭 — 경과분석지 리스트업 소스 가드', () => {
  test('AC1 — 서류작성(opinion_doc) 탭에 ProgressTargetsSection 을 SSOT 재사용(병렬 리스트 신설 없음)', () => {
    const src = DOCTOOLS_SRC();
    // SSOT 컴포넌트 import + 렌더(경과분석지 발행 대상 리스트업).
    expect(src).toMatch(/import\s+ProgressTargetsSection\s+from\s+'@\/components\/treatment\/ProgressTargetsSection'/);
    expect(src).toMatch(/<ProgressTargetsSection\s+date=\{seoulISODate\(new Date\(\)\)\}\s+nameInteraction=\{nameInteraction\}/);
    // 발행 대상 섹션 마커.
    expect(src).toMatch(/data-testid="docdash-progress-form-section"/);
    // 병렬 리스트 신설 금지 — 자체 packages/package_sessions 6배수 쿼리를 DoctorTools 안에서 재구현하지 않음.
    expect(src).not.toMatch(/from\('packages'\)/);
    expect(src).not.toMatch(/from\('package_sessions'\)/);
    expect(src).not.toMatch(/isSixMultipleTarget/);
  });

  test('AC3 — PHI 게이트(원장/admin/manager)로 리스트 노출 제어', () => {
    const src = DOCTOOLS_SRC();
    // 게이트 predicate = hasOpsAuthority(admin/manager) + director escape(대표원장).
    expect(src).toMatch(/const\s+canSeeProgressDocs\s*=\s*hasOpsAuthority\(profile\)\s*\|\|\s*profile\?\.role\s*===\s*'director'/);
    // 발행 대상 섹션은 게이트 하에서만 렌더.
    expect(src).toMatch(/canSeeProgressDocs\s*&&\s*\(/);
    expect(src).toMatch(/import\s+\{\s*hasOpsAuthority\s*\}\s+from\s+'@\/lib\/permissions'/);
  });

  test('AC4 — 서류작성 탭 기존 항목(DocRequestQueue·OpinionDocTab) 무접촉(regression 0)', () => {
    const src = DOCTOOLS_SRC();
    expect(src).toMatch(/<DocRequestQueue\s*\/>/);
    expect(src).toMatch(/<OpinionDocTab\s*\/>/);
    // 4개 탭(진료 알림판/진료 환자 목록/균검사지/서류작성) 보존.
    expect(src).toMatch(/data-testid="tab-opinion-doc"/);
    expect(src).toMatch(/data-testid="tab-call-dashboard"/);
  });

  test('AC5 — 순수 read-linkage: DoctorTools 변경에 write/RPC/DDL 0 (db_change=false)', () => {
    const src = DOCTOOLS_SRC();
    expect(src).not.toMatch(/\.(insert|update|delete|upsert)\(/);
    expect(src).not.toMatch(/\.rpc\(/);
  });

  test('이름 인터랙션 — 좌클릭=2번차트 open(useChart 단일 게이트), 우클릭=no-op(preventDefault)', () => {
    const src = DOCTOOLS_SRC();
    expect(src).toMatch(/const\s*\{\s*openChart\s*\}\s*=\s*useChart\(\)/);
    expect(src).toMatch(/onLeftClick:\s*\(customerId\)\s*=>\s*\{\s*\n?\s*if\s*\(customerId\)\s*openChart\(customerId\)/);
  });

  test('모집단 SSOT — ProgressTargetsSection 은 progressSixMultiple(isSixMultipleTarget)로 6배수 판정(단일 근거)', () => {
    const src = PROGSECTION_SRC();
    // 리스트업이 재사용하는 컴포넌트가 PROGCHK SSOT 함수를 사용하는지 앵커(AC2 정합의 물리 근거).
    expect(src).toMatch(/from\s+'@\/lib\/progressSixMultiple'/);
    expect(src).toMatch(/isSixMultipleTarget\(/);
  });
});
