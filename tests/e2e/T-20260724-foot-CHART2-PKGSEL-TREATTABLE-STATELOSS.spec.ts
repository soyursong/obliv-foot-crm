/**
 * E2E/Unit — T-20260724-foot-CHART2-PKGSEL-TREATTABLE-STATELOSS
 *
 * ⚠ DEDUP: 본 티켓은 canonical T-20260724-foot-CHART2-PKG-TXSELECT-STATE-LOSS 와
 *   동일 thread(1784868083.758109)·reporter(김주연 총괄)·증상의 재보고(dedup) 이다.
 *   RC·FIX 는 canonical 에서 확정·구현(commit 87e476db): 2번차트 차감(치료 신청) 경로가
 *   package_sessions.check_in_id 만 걸고 check_ins.package_id 를 비워둠(NULL) → 치료테이블/
 *   접수 명단 카드가 check_ins.package_id 로 '연결됨'을 판정하므로 화면 전환·재진입 시
 *   선택(패키지)이 풀린 것처럼 보임. FIX = 차감이 '오늘 내원'에 귀속될 때 check_ins.package_id 링크
 *   (shouldLinkCheckInPackage 순수함수가 write 의 유일 게이트). no-DDL, db_change:false.
 *
 * 본 spec 은 티켓 본문 현장 클릭 시나리오 3종을 그 게이트 함수로 결정적 재현한다.
 *   S1 선택 유지(정상 동선 — 회귀 방지): 차감 시 오늘 내원에 링크 write 가 일어나야 명단 이동해도 유지.
 *   S2 재진입 복원(핵심 재현): 이력 1회 저장(=이미 링크됨) 후 재진입 시 멱등(재풀림·중복write 없음) → 유지.
 *   S3 엣지 — 선택 없이 전환: 귀속 내원 없음/현재 내원 없음 → 링크 write 없음(잔존 선택·오염 없음).
 *
 * ⛔ 순수 함수 read-only 검증. 어떤 값도 write/승격 없음.
 */
import { test, expect } from '@playwright/test';
import { shouldLinkCheckInPackage } from '../../src/lib/checkInPackageLink';

// 현장 실측 지형 재현(dev DB 증거 MSG-p5fj 기반):
//   박병문 F-4995 — customer 09f81b06…, check_in 03b76420…, package 'AF레이저' 1회권 active, package_id=NULL.
//   이춘형 F-4851 — check_in f5908690…, package '12회권' active, package_id=NULL.
const CI_TODAY = '03b76420-2143-48ae-966a-7b4e36bd9f0c'; // 오늘 내원(현재 2번차트 latestCheckIn)
const PKG_A = '09f81b06-af00-4507-0000-000000000001';    // 선택한 패키지 A(AF레이저)
const PKG_B = '09f81b06-af00-4507-0000-000000000002';    // 다른 패키지 B(같은 환자, 의도적 재선택 = 갱신)
const CI_OTHER = 'f5908690-21ca-4806-b571-f0278fe7fd99'; // 다른 환자(이춘형 F-4851)의 별개 내원

test.describe('S1 — 선택 유지(정상 동선, 회귀 방지): 차감 시 오늘 내원에 패키지 링크 write', () => {
  test('AC1: 패키지 선택 + 치료 신청(차감) → package_id NULL 상태에서 링크 write 발생 (명단 이동해도 유지)', () => {
    // 치료테이블 명단으로 전환해도 유지되려면 서버 영속(check_ins.package_id 링크)이 선행 = 차감 시 write 발생.
    expect(
      shouldLinkCheckInPackage({
        latestCheckInId: CI_TODAY,
        latestCheckInPackageId: null, // 버그 재현: 현재 NULL
        deductCheckInId: CI_TODAY,
        targetPackageId: PKG_A,
      }),
    ).toBe(true);
  });
});

test.describe('S2 — 재진입 복원(핵심 재현 케이스): 이력 1회 후 재풀림 없음', () => {
  test('AC2: 이미 같은 패키지로 링크됨 → 2번차트 재진입/재차감 시 멱등(중복 write 없음, 재풀림 종결)', () => {
    // 이력 1회 저장 = check_ins.package_id 이미 PKG_A 영속. 재진입 시 재조회하면 그대로 복원되고,
    // 게이트는 멱등 skip(false) → 반복 재풀림(현장 오후 follow-up 증상) 종결.
    expect(
      shouldLinkCheckInPackage({
        latestCheckInId: CI_TODAY,
        latestCheckInPackageId: PKG_A,
        deductCheckInId: CI_TODAY,
        targetPackageId: PKG_A,
      }),
    ).toBe(false);
  });

  test('AC3(의도적 재선택): 같은 내원에서 다른 패키지 차감 → 최신 선택으로 링크 갱신', () => {
    expect(
      shouldLinkCheckInPackage({
        latestCheckInId: CI_TODAY,
        latestCheckInPackageId: PKG_A, // 기존 A 연결
        deductCheckInId: CI_TODAY,
        targetPackageId: PKG_B, // 새로 B 차감 → 갱신(의도 reset 은 정상 반영)
      }),
    ).toBe(true);
  });

  test('AC4(무오염): 차감 귀속 내원이 現 2번차트 내원과 다르면(다른 환자) 링크 안함', () => {
    expect(
      shouldLinkCheckInPackage({
        latestCheckInId: CI_TODAY,
        latestCheckInPackageId: null,
        deductCheckInId: CI_OTHER, // 現 차트 내원과 불일치 → 다른 환자 카드 오염 금지
        targetPackageId: PKG_A,
      }),
    ).toBe(false);
  });
});

test.describe('S3 — 엣지: 선택 없이 전환(잔존 선택·오류 없음)', () => {
  test('현재 내원 없음(2번차트 latestCheckIn 없음) → 링크 write 없음 (빈 상태 정상)', () => {
    expect(
      shouldLinkCheckInPackage({
        latestCheckInId: null,
        latestCheckInPackageId: null,
        deductCheckInId: CI_TODAY,
        targetPackageId: PKG_A,
      }),
    ).toBe(false);
  });

  test('귀속 내원 없음(과거일 백데이트 등, deductCheckInId=null) → 링크 write 없음', () => {
    expect(
      shouldLinkCheckInPackage({
        latestCheckInId: CI_TODAY,
        latestCheckInPackageId: null,
        deductCheckInId: null, // computeDeductCheckInId 가 null(차감일 != 최근 내원일)
        targetPackageId: PKG_A,
      }),
    ).toBe(false);
  });
});
