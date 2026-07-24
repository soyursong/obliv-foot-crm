/**
 * E2E/Unit — T-20260724-foot-CHART2-PKG-TXSELECT-STATE-LOSS
 *
 * 현장 증상: 2번 차트 > 패키지 > '치료 신청'(회차 차감) 선택 후 치료테이블 명단으로 이동하면
 *            선택 내역(패키지)이 매번 초기화·소실. 이력 1회 남아도 재진입 시 계속 풀림.
 *
 * RC(DB증거 MSG-p5fj): 2번차트 차감 경로가 package_sessions.check_in_id 만 걸고
 *   check_ins.package_id 를 비워둠(NULL). 치료테이블/접수 명단 카드(CheckInDetailSheet 등)는
 *   check_ins.package_id 로 '연결됨'을 판정 → 화면 전환·재진입 시 선택이 풀린 것처럼 보임.
 *   박병문 F-4995 / 이춘형 F-4851 둘 다 check_ins.package_id=NULL 확인.
 *
 * FIX: PaymentDialog(결제 시 link)와 대칭으로, 차감이 '오늘 내원'에 귀속될 때 check_ins.package_id 링크.
 *   링크 write 의 유일 게이트 = shouldLinkCheckInPackage(순수 함수). 본 spec 이 그 판정을
 *   현장 클릭 시나리오(AC-1~4)로 결정적 검증. no-DDL(기존 컬럼 재사용), db_change:false.
 *
 * ⛔ 순수 함수 read-only 검증. 어떤 값도 write/승격 없음.
 */
import { test, expect } from '@playwright/test';
import { shouldLinkCheckInPackage } from '../../src/lib/checkInPackageLink';

// 현장 실측 지형 재현(dev DB 증거 기반):
//   박병문 F-4995 — customer 09f81b06…, check_in 03b76420…, package 'AF레이저' 1회권 active.
const CI_TODAY = '03b76420-2143-48ae-966a-7b4e36bd9f0c'; // 오늘 내원(현재 2번차트 latestCheckIn)
const PKG_A = '09f81b06-af00-4507-0000-000000000001';    // 선택한 패키지 A(AF레이저)
const PKG_B = '09f81b06-af00-4507-0000-000000000002';    // 다른 패키지 B(같은 환자, AC-3 갱신)
const CI_OTHER = 'f5908690-21ca-4806-b571-f0278fe7fd99'; // 다른 환자(이춘형 F-4851)의 별개 내원

test.describe('T-20260724 AC-1/2/4 — 차감(치료 신청) 시 오늘 내원에 패키지 링크(선택 유지)', () => {
  test('AC-1: 최초 차감(package_id NULL) → 오늘 내원에 링크 write 발생', () => {
    // 명단 이동해도 유지되려면 서버 영속이 선행 = 차감 시 링크 write 가 일어나야 한다.
    expect(
      shouldLinkCheckInPackage({
        latestCheckInId: CI_TODAY,
        latestCheckInPackageId: null, // 버그 재현: 현재 NULL
        deductCheckInId: CI_TODAY,
        targetPackageId: PKG_A,
      }),
    ).toBe(true);
  });

  test('AC-2/AC-4: 이미 같은 패키지로 링크됨 → 재차감/재진입 시 멱등(중복 write 없음)', () => {
    // 서버에 이미 package_id=PKG_A 로 영속됨 → 재진입해도 write 재발 없이 유지(반복 재풀림 종결).
    expect(
      shouldLinkCheckInPackage({
        latestCheckInId: CI_TODAY,
        latestCheckInPackageId: PKG_A,
        deductCheckInId: CI_TODAY,
        targetPackageId: PKG_A,
      }),
    ).toBe(false);
  });
});

test.describe('T-20260724 AC-3 — 의도적 재선택은 갱신, 다른 환자는 오염 없음', () => {
  test('AC-3(갱신): 같은 내원에서 다른 패키지 차감 → 최신 선택으로 링크 갱신', () => {
    expect(
      shouldLinkCheckInPackage({
        latestCheckInId: CI_TODAY,
        latestCheckInPackageId: PKG_A, // 기존 A 연결
        deductCheckInId: CI_TODAY,
        targetPackageId: PKG_B, // 새로 B 차감 → 갱신
      }),
    ).toBe(true);
  });

  test('AC-3(무오염): 차감 귀속 내원이 現 2번차트 내원과 다르면 링크 안함', () => {
    // 다른 환자/다른 내원 카드 상태를 現 차트가 덮어쓰지 않음(상태 오염 금지).
    expect(
      shouldLinkCheckInPackage({
        latestCheckInId: CI_TODAY,
        latestCheckInPackageId: null,
        deductCheckInId: CI_OTHER, // 現 차트 내원과 불일치
        targetPackageId: PKG_A,
      }),
    ).toBe(false);
  });
});

test.describe('T-20260724 가드 — 오늘 내원 귀속 차감만 링크', () => {
  test('과거일 백데이트 차감(deductCheckInId=null) → 특정 내원 귀속 불가 → 링크 안함', () => {
    expect(
      shouldLinkCheckInPackage({
        latestCheckInId: CI_TODAY,
        latestCheckInPackageId: null,
        deductCheckInId: null, // computeDeductCheckInId 가 null (차감일 != 최근 내원일)
        targetPackageId: PKG_A,
      }),
    ).toBe(false);
  });

  test('현재 내원 없음(2번차트에 latestCheckIn 없음) → 링크 안함', () => {
    expect(
      shouldLinkCheckInPackage({
        latestCheckInId: null,
        latestCheckInPackageId: null,
        deductCheckInId: CI_TODAY,
        targetPackageId: PKG_A,
      }),
    ).toBe(false);
  });
});
