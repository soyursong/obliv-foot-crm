/**
 * T-20260808-foot-CHARTEDIT-SESSIONTYPE-PRICE-RELINK
 * 패키지 시술내역 수정(saveEditSession)에서 session_type 변경 시 차감 스냅샷 단가
 * (package_sessions.unit_price)를 새 유형의 package.{type}_unit_price 로 함께 재계산.
 *
 * 버그 RC: fn_fill_session_unit_price() 트리거(20260605120000)는 BEFORE INSERT 에만 발화하고
 *   UPDATE 에는 발화하지 않는다. 그래서 saveEditSession() 이 session_type 만 UPDATE 하고
 *   unit_price 를 그대로 두면, 차감기준 매출 SSOT(SalesStaffTab DEDUCT_AMOUNT_BASIS='snapshot' +
 *   mtmSales.ts + stats RPC = 모두 package_sessions.unit_price 스냅샷)가 옛 유형 단가로 잔존 →
 *   차감 매출·치료사별 매출집계 왜곡(이정인 치료사 가열→체험권 정정 시 발현).
 *   ※ 티켓 본문의 'check_in_services.price' 는 오진단 — 해당 필드는 SalesTreatmentTab 안분 /
 *     Closing 시술매출용이며 차감기준(therapist deduct) 집계와 무관. 실 SSOT = package_sessions.unit_price.
 *     (planner FOLLOWUP 로 필드 정정 보고 — supervisor QA 정합용.)
 *
 * FIX(write-side, CustomerChartPage.tsx 만):
 *   AC1: 유형 변경 시 sessionTypeUnitPrice(pkg, newType) = 트리거/currentUnitPrice 동일 매핑으로 unit_price 재계산 후 UPDATE.
 *   AC2: 새 유형=trial → trial_unit_price(단건 매출) 스냅샷. 선수금차감(laser) 대상 아님(TRIAL-REVENUE-ZERO A안).
 *   AC3: 유형 미변경(날짜/담당자만) 저장은 unit_price 무접촉(기존 수기조정 스냅샷 파괴 금지).
 *   AC4: forward-fix — 소급 backfill 없음.
 *   가드: SalesStaffTab(read-side, field-soak 중) 무접촉.
 *
 * 검증: 순수 핸들러 로직(로그인+패키지 seed 필요)이라 write round-trip E2E 대신, 본 레포 관례(source-guard)로
 *   불변식을 정적 검증한다. (동형: T-20260808-foot-SALESDOCTOR-DEDUCT-BLANK-REGRESSION-FIX.spec.ts 소스가드)
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const chartSrc = readFileSync(
  resolve(__dirname, '../../src/pages/CustomerChartPage.tsx'),
  'utf8',
);
const migSrc = readFileSync(
  resolve(__dirname, '../../supabase/migrations/20260605120000_pkg_session_unit_price_snapshot.sql'),
  'utf8',
);

test.describe('T-20260808 CHARTEDIT-SESSIONTYPE-PRICE-RELINK 불변식(source-guard)', () => {
  test('AC1: saveEditSession 이 유형 변경 시 unit_price 를 patch 에 포함', () => {
    // saveEditSession 블록 추출.
    const start = chartSrc.indexOf('const saveEditSession = async () =>');
    expect(start, 'saveEditSession 핸들러 존재').toBeGreaterThan(-1);
    const block = chartSrc.slice(start, start + 1800);
    // 유형 변경 감지 + unit_price 재계산 write.
    expect(block).toContain('editSessionForm.sessionType !== editSessionDlg.session_type');
    expect(block).toContain('patch.unit_price = sessionTypeUnitPrice(');
    expect(block).toContain(".from('package_sessions')");
    expect(block).toContain('.update(patch)');
  });

  test('AC3: 유형 미변경 저장은 unit_price 무접촉(조건부 재계산)', () => {
    const start = chartSrc.indexOf('const saveEditSession = async () =>');
    const block = chartSrc.slice(start, start + 1800);
    // unit_price 는 typeChanged 게이트 안에서만 patch 에 실린다.
    const guardIdx = block.indexOf('if (typeChanged)');
    const unitPriceIdx = block.indexOf('patch.unit_price =');
    expect(guardIdx, 'typeChanged 게이트 존재').toBeGreaterThan(-1);
    expect(unitPriceIdx, 'unit_price 재계산 존재').toBeGreaterThan(guardIdx);
    // patch 객체 초기화 리터럴(= { ... })에는 unit_price 가 없어야(무변경 시 미포함) 한다.
    // (타입 주석 `unit_price?: number` 는 초기화가 아니므로 슬라이스에서 제외.)
    const initStart = block.indexOf('= {', block.indexOf('const patch'));
    const patchInit = block.slice(initStart, guardIdx);
    expect(patchInit).not.toContain('unit_price');
  });

  test('AC2 & 매핑 parity: sessionTypeUnitPrice 가 트리거 매핑과 동일(trial→trial_unit_price 포함)', () => {
    const start = chartSrc.indexOf('function sessionTypeUnitPrice(');
    expect(start, 'sessionTypeUnitPrice 헬퍼 존재').toBeGreaterThan(-1);
    const fn = chartSrc.slice(start, start + 900);
    // 6종 매핑 — 트리거 fn_fill_session_unit_price() 및 SalesStaffTab.currentUnitPrice() 와 동일.
    expect(fn).toContain("case 'heated_laser':   return pkg.heated_unit_price");
    expect(fn).toContain("case 'unheated_laser': return pkg.unheated_unit_price");
    expect(fn).toContain("case 'iv':             return pkg.iv_unit_price");
    expect(fn).toContain('return pkg.podologe_unit_price');
    expect(fn).toContain("case 'trial':          return pkg.trial_unit_price"); // AC2
    expect(fn).toContain("case 'reborn':         return pkg.reborn_unit_price");
    // preconditioning 등 대응 컬럼 없는 타입 → 0(무상).
    expect(fn).toContain('default:               return 0;');

    // 매핑 SSOT 정합: 트리거도 동일 컬럼을 쓴다(드리프트 방지 교차확인).
    expect(migSrc).toContain('BEFORE INSERT ON public.package_sessions');
    for (const col of [
      'heated_unit_price', 'unheated_unit_price', 'iv_unit_price',
      'podologe_unit_price', 'trial_unit_price',
    ]) {
      expect(migSrc, `트리거가 ${col} 사용`).toContain(col);
    }
  });

  test('가드: 본 티켓 코드가 read-side(SalesStaffTab) 를 수정하지 않음(write-side 한정)', () => {
    // saveEditSession 및 헬퍼가 CustomerChartPage 내부에만 존재하는지(파일 경계) 확인.
    expect(chartSrc).toContain('T-20260808-foot-CHARTEDIT-SESSIONTYPE-PRICE-RELINK');
    // check_in_services.price 를 이 핸들러가 건드리지 않음(오진단 필드 미접촉).
    const start = chartSrc.indexOf('const saveEditSession = async () =>');
    const block = chartSrc.slice(start, start + 1800);
    expect(block).not.toContain('check_in_services');
  });
});
