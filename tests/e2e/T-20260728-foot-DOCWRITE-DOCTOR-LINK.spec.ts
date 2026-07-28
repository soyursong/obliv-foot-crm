/**
 * E2E spec — T-20260728-foot-DOCWRITE-DOCTOR-LINK
 * 진료 대시보드 [서류작성] 탭 — 담당 진료의 표시 + 서류 작성 시 진료의 자동 연동(pre-populate).
 *   (현장 종로풋센터 2026-07-28 김주연 총괄 U0ATDB587PV · §11 의사공간 컨펌 문지은 대표원장 confirmed
 *    2026-07-28T23:51 — "표시 + 폼 기본값 자동입력 ADDITIVE" 방식. db_change=false, no-DDL.)
 *
 * RC(diagnose-first):
 *   담당 진료의 SSOT = check_ins.treating_doctor_id → clinic_doctors.name (TreatingDoctorSelect write 단일경로,
 *   치료테이블 [진료] 표시·서류 출력 바인딩(loadAutoBindContext)·발행자 seed(useVisitTreatingDoctor) 공유 소스).
 *   버그① [서류작성] 큐 조회(useOpinionRequestQueue)가 진료의를 전혀 읽지 않고 표시 컬럼도 없었다(미표시).
 *   버그② 작성창(OpinionEditorDialog) 진료의 seed 는 있으나, 비동기 도착 스냅이 '서명의'만 갱신 →
 *          치료테이블 지정 진료의(담당 진료의)가 레이스에서 유실/덮임(pre-populate 안 됨).
 *
 * FIX(ADDITIVE, 재사용):
 *   ① useQueueTreatingDoctors(checkInId 앵커 → treating_doctor_id → clinic_doctors.name) read-only 조회 신설 +
 *      DocRequestQueue 에 '담당 진료의' 컬럼(docreq-cell-doctor) 추가. 치료테이블 [진료]와 동일 값.
 *   ② OpinionEditorDialog 비동기 진료의 스냅 우선순위를 defaultDoctorId 와 동일(치료테이블 지정 진료의 우선)로
 *      정합 → 작성 진입 시 서류 양식 진료의 필드에 담당 진료의 자동 채움.
 *
 * REDEFINITION_RISK 가드: DOCPRINT-RX/DIAGNOSIS-DOCTOR-BIND(둘 다 done) 출력 바인딩 재사용/무회귀.
 *   발행/저장/귀속 로직 무접촉. 신규 컬럼/테이블/enum/RLS = 0.
 *
 * 검증 방식: 현장 계정 PHI → 인증 우회 불가. 정적 코드 구조 검증 + 앱 로드(HTTP 200) + 회귀 가드.
 *   실브라우저 클릭 시나리오는 하단 체크리스트(갤탭 실기기 현장 confirm 대상).
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const root = path.join(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

const queue = () => read('src/components/doctor/DocRequestQueue.tsx');
const lib = () => read('src/lib/opinionRequest.ts');
const opinionTab = () => read('src/components/doctor/OpinionDocTab.tsx');
const autoBind = () => read('src/lib/autoBindContext.ts');

test.describe('T-20260728-foot-DOCWRITE-DOCTOR-LINK — [서류작성] 담당 진료의 표시 + 작성 pre-populate', () => {

  // 회귀 가드: 앱 정상 로드
  test('앱 정상 로드 — HTTP 200', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);
  });

  // ── 데이터층: 담당 진료의 조회 훅(치료테이블 [진료]와 동일 SSOT) ─────────────────
  test('데이터: useQueueTreatingDoctors — check_ins.treating_doctor_id → clinic_doctors.name 해석', () => {
    const l = lib();
    expect(l).toContain('export function useQueueTreatingDoctors');
    // SSOT 소스: check_ins.treating_doctor_id (치료테이블 [진료]·서류 출력 바인딩과 동일 필드).
    expect(l).toContain('treating_doctor_id');
    // 이름 해석 = clinic_doctors.name.
    expect(l).toContain("from('clinic_doctors')");
    expect(l).toMatch(/from\('check_ins'\)/);
    // read-only: 신규 write/insert/update/upsert 없음(조회 전용).
    expect(l).not.toMatch(/useQueueTreatingDoctors[\s\S]*?\.insert\(/);
    // graceful 폴백(빈 맵) — 큐 무붕괴.
    expect(l).toMatch(/catch\s*\{[\s\S]*?return\s*\{\}/);
  });

  // ── 시나리오 1: [서류작성] 큐 각 행에 담당 진료의 표시 ────────────────────────
  test('시나리오1: 담당 진료의 컬럼 + 셀(docreq-cell-doctor) 렌더, checkInId 앵커로 해석', () => {
    const q = queue();
    // 헤더 컬럼 추가.
    expect(q).toContain('담당 진료의');
    // 셀 testid.
    expect(q).toContain('data-testid="docreq-cell-doctor"');
    // 훅 사용 + checkInId 앵커로 조회.
    expect(q).toContain('useQueueTreatingDoctors');
    expect(q).toContain('checkInIds');
    expect(q).toContain('r.checkInId');
    // 미지정/내원없음 → graceful '미지정' 표기(크래시·빈 렌더 없음, AC 시나리오3).
    expect(q).toContain('미지정');
  });

  test('시나리오1: 기존 9칼럼 회귀 가드(추가 컬럼이 기존 표시를 밀어내지 않음)', () => {
    const q = queue();
    for (const col of ['이름', '생년', '차트번호', '오늘시술', '처방내역', '임상경과', '서류종류', '해당항목', '발행']) {
      expect(q).toContain(col);
    }
    // 작업 대상 + 완료 그룹 두 테이블 모두에 진료의 resolver 전달(양쪽 표시).
    expect(q.match(/doctorNameForRow=/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  // ── 시나리오 2: 서류 작성 시 진료의 pre-populate ───────────────────────────────
  test('시나리오2: 작성창 진료의 비동기 스냅 = 치료테이블 지정 진료의 우선(pre-populate)', () => {
    const t = opinionTab();
    // seed 소스 = 그 내원 치료테이블 지정 진료의(useVisitTreatingDoctor, checkInId=visitor.id).
    expect(t).toContain('useVisitTreatingDoctor');
    // 비동기 스냅 effect 가 treatingDoctorId 를 우선 타겟으로 사용(서명의보다 우선).
    expect(t).toMatch(/if\s*\(treatingDoctorId\s*&&\s*doctors\.some\(\(d\)\s*=>\s*d\.id\s*===\s*treatingDoctorId\)\)/);
    // 스냅 effect deps 에 treatingDoctorId 포함(비동기 도착 반영).
    expect(t).toMatch(/\[open,\s*doctorTouched,\s*doctors,\s*visitSigning,\s*treatingDoctorId\]/);
    // ADDITIVE seed 경계: doctorTouched(사용자 수동변경) 시 스냅 중단(override 보존).
    expect(t).toContain('if (!open || doctorTouched) return;');
  });

  // ── REDEFINITION_RISK / 회귀 가드: 출력 바인딩(DOCPRINT-*) 무접촉 ───────────────
  test('회귀: DOCPRINT-RX/DIAGNOSIS-DOCTOR-BIND 출력 진료의 바인딩 무회귀', () => {
    const a = autoBind();
    // 처방전 처방의료인 + 진단서 의사 성명 전용 토큰 유지(무삭제).
    expect(a).toContain('prescriber_name');
    expect(a).toContain('attending_doctor_name');
    // 발행/저장 로직 무변경: 요청큐 훅에 신규 write 미도입.
    const l = lib();
    expect(l).toContain('useOpinionRequestQueue'); // 기존 큐 조회 훅 보존
    expect(l).toContain('mapPublishedRequestRow'); // 발행완료 매핑 단일 소스 보존
  });
});

/**
 * ── 갤탭 실기기 현장 confirm 체크리스트(§dev-foot: green build·spec PASS 는 종결 근거 아님) ──
 * [ ] 시나리오1: 진료 대시보드 → [서류작성] → 담당 진료의 지정된 행에 진료의 이름 표시됨.
 * [ ] 시나리오1: 같은 고객 치료테이블 [진료]와 동일한 진료의 값인지 대조 일치.
 * [ ] 시나리오2: 담당 진료의 있는 고객 "서류 작성하기" → 진료의 필드에 담당 진료의 자동 채워짐.
 * [ ] 시나리오2: 저장/발행 시 pre-populate 된 진료의 정상 반영(발행 로직 무회귀).
 * [ ] 시나리오3: 진료의 미지정 고객 행 → '미지정' 표기, 크래시·빈 렌더 없음.
 * [ ] 시나리오3: 미지정 고객 "서류 작성하기" → 진료의 필드 공란/기존 폴백 graceful 진입.
 * [ ] 회귀: 기존 서류 출력(처방전·진단서) 진료의·도장 바인딩 정상(DOCPRINT-* 무회귀).
 */
