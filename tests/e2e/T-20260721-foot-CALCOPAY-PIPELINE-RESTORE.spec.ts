/**
 * E2E spec — T-20260721-foot-CALCOPAY-PIPELINE-RESTORE (우산 BILLING-REMAINING-WORK §2)
 *
 * RCA(prod 실측): service_charges 총 2행(수기 v1, 6/6 최종)·insurance_claims 0 — 명세(본인/공단 split)
 *   grain 이 라이브 파이프라인으로 적재된 적이 없다. 진찰료(consultation) 외 급여 시술엔 명세 write-path
 *   부재 → 라이브 covered 체크아웃이 payments 만 남기고 service_charges 는 안 남김.
 *
 * 복구: PMW.executeAutoDone 결제 확정 후 snapshotCoveredServiceCharges 로 covered 시술을
 *   server 단일권위 RPC로 스냅샷 INSERT 해 명세 grain 재활성. 원칙 정적 가드:
 *   - forward-only (기존행 UPDATE/소급 없음)
 *   - best-effort (never throw — 결제 커밋 후 try/catch)
 *   - idempotent (이 방문 기존 service_charge service_id skip = consult write-path/재시도 중복 방지)
 *   - charge-only (payments 무접촉 = 이중수납 방지)
 *   - no-fabricate (calc data_incomplete skip)
 *   - no-DDL (기존 service_charges·server copay RPC 재사용, 신규 컬럼 0)
 *
 * [T-20260819-foot-COPAY-VISIT-GRAIN 델타] design A(DA GO) supersede:
 *   per-item calc_copayment 루프 합산의 방문-grain 결함(의급 N×1000·노인 항목별 구간)을 해소하기 위해
 *   snapshotCoveredServiceCharges 의 server 단일권위를 calc_copayment → calc_visit_copayment(방문 1회 pool)로
 *   정당 교체하고 engine 버전을 pmw_checkout_snapshot_v1 → _v2 로 bump. 아래 §2-2/§2-7 는 구 mechanism
 *   하드코딩을 visit-grain assertion 으로 갱신하되 원 INTENT(단일 server AUTHORITY·병렬 divergent 산출경로
 *   신설 금지 / PMW 내 신규 DDL 참조 부재)는 그대로 보존한다. 행위 불변식(§2-1/3/4/5/6)은 전건 무변경.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const PMW = fs.readFileSync(path.join(ROOT, 'src/components/PaymentMiniWindow.tsx'), 'utf-8');

test('§2-1 스냅샷 헬퍼가 정의되고 executeAutoDone 결제 확정 후 호출된다', () => {
  expect(PMW).toContain('const snapshotCoveredServiceCharges = async');
  // executeAutoDone 내부에서 호출 (결제 커밋 뒤)
  expect(PMW).toContain('await snapshotCoveredServiceCharges(visitDate)');
});

test('§2-2 server 단일권위 copay RPC 재사용 — 병렬 divergent 산출경로 신설 금지', () => {
  // [T-20260819 델타] visit-grain(calc_visit_copayment, 방문 1회 pool)로 단일권위 이동.
  //   INTENT 보존: 헬퍼는 단일 server AUTHORITY 만 호출하고, 클라이언트에 병렬 divergent 산출경로를
  //   신설하지 않는다(calc_visit_copayment 도 copayFromBase 동일 formula·발산0).
  const helper = PMW.slice(
    PMW.indexOf('const snapshotCoveredServiceCharges'),
    PMW.indexOf('// ── executeAutoDone'),
  );
  // 방문 grain 단일권위 RPC 사용
  expect(helper).toContain(".rpc('calc_visit_copayment'");
  // 병렬 산출경로 신설 금지: 헬퍼 내에 구 per-item calc_copayment RPC 병렬 호출 부재
  expect(helper).not.toContain(".rpc('calc_copayment'");
});

test('§2-3 best-effort: 결제 흐름을 롤백하지 않음(try/catch 래핑, never throw)', () => {
  // 호출부가 try/catch 로 감싸져 결제 완료 후 스냅샷 실패가 결제를 롤백하지 않음
  const callIdx = PMW.indexOf('await snapshotCoveredServiceCharges(visitDate)');
  const window = PMW.slice(callIdx - 200, callIdx + 200);
  expect(window).toContain('try {');
  expect(window).toContain('catch');
  // 헬퍼 내부 INSERT 실패도 throw 없이 console.warn (best-effort)
  const helper = PMW.slice(PMW.indexOf('const snapshotCoveredServiceCharges'));
  expect(helper).toContain('service_charges 스냅샷 INSERT 실패');
});

test('§2-4 idempotent: 이 방문 기존 명세(service_id) skip — consult write-path/재시도 중복 방지', () => {
  const helper = PMW.slice(PMW.indexOf('const snapshotCoveredServiceCharges'));
  expect(helper).toContain(".from('service_charges')");
  expect(helper).toContain("'check_in_id', checkIn.id");
  expect(helper).toContain('already.has(svc.id)');
});

test('§2-5 no-fabricate: calc data_incomplete 은 스냅샷 skip (금액 날조 금지)', () => {
  const helper = PMW.slice(PMW.indexOf('const snapshotCoveredServiceCharges'));
  expect(helper).toMatch(/if \(r\.data_incomplete\) continue/);
});

test('§2-6 charge-only: 헬퍼는 payments 를 INSERT 하지 않는다(이중수납 방지)', () => {
  const helper = PMW.slice(
    PMW.indexOf('const snapshotCoveredServiceCharges'),
    PMW.indexOf('// ── executeAutoDone'),
  );
  expect(helper).not.toContain(".from('payments')");
  // 스냅샷 대상은 covered(급여) 시술 한정
  expect(helper).toContain('service.is_insurance_covered === true');
});

test('§2-7 no-DDL: 신규 마이그레이션 없음 — 기존 service_charges·server copay RPC 재사용', () => {
  // [T-20260819 델타] engine 버전 pmw_checkout_snapshot_v1 → _v2 bump(방문 grain).
  //   INTENT 보존: engine 버전 태깅만 갱신(기존 calculation_engine_version 컬럼) — PMW 내 신규 DDL 참조 부재.
  const helper = PMW.slice(PMW.indexOf('const snapshotCoveredServiceCharges'));
  expect(helper).toContain("calculation_engine_version: 'pmw_checkout_snapshot_v2'");
});
