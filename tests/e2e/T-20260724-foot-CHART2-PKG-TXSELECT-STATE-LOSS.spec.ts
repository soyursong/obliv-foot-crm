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

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 3 — AC-4(신설): "이력 1회 저장 후 여러 번 재진입해도 유지"(재풀림 반복 종결)
//   follow-up(김주연 총괄, MSG-20260724-144549): "이력이 한 번 남았는데도 2번차트에서 계속 풀리는 거 같음".
//
//   read-only RC 재확인(코드증거): package_id: null 은 全 4곳(Dashboard 6277 / TreatmentTable 110 /
//     Customers 246 / Reservations 1768) 모두 신규 check_in INSERT 의 기본 payload 일 뿐, 기존 행을
//     mount/재진입 시 NULL 로 되돌리는 UPDATE 경로는 없음. 즉 foot 의 RC 는 body 형제
//     (T-20260707-body-CHARTDEDUCT-PKGSELECT-MISSING)의 "mount 재조회 미적용(client stale)"이 아니라
//     "차감 write 가 check_ins.package_id 를 안 걸던 server write-gap". 재조회 축은 이미 건재:
//       (1) 2번차트 재진입 = CustomerChartPage mount → check_ins select('*') 최신 재조회(package_id 포함),
//       (2) 치료테이블/명단 = Dashboard check_ins realtime(postgres_changes '*') + debounce refetch.
//     따라서 서버에 1회 링크되면 이후 어떤 재진입에서도 그 값이 재조회되고, 링크 write 는 멱등으로 재발 안함.
//
//   본 시나리오는 그 "재풀림 종결" 불변식을 결정적으로 고정: 서버 package_id=PKG_A 영속 상태에서
//   재진입을 N회 반복해도 shouldLinkCheckInPackage 는 매번 false(=재write 없음, 재리셋 없음).
test.describe('T-20260724 시나리오3 · AC-4 — 이력 1회 저장 후 여러 번 재진입해도 유지(재풀림 종결)', () => {
  test('서버 package_id=PKG_A 영속 → 재진입 10회 반복해도 매번 링크 write 없음(멱등·무리셋)', () => {
    // 재진입마다 mount 가 최신 check_in(package_id=PKG_A)을 재조회 → 게이트 입력이 동일 → 항상 false.
    for (let reentry = 1; reentry <= 10; reentry += 1) {
      expect(
        shouldLinkCheckInPackage({
          latestCheckInId: CI_TODAY,
          latestCheckInPackageId: PKG_A, // 서버가 이미 보유(1회 저장분) — 재조회로 매번 이 값이 들어옴
          deductCheckInId: CI_TODAY,
          targetPackageId: PKG_A,
        }),
      ).toBe(false);
    }
  });

  test('재진입 시 빈값(NULL)으로 리셋되어 들어오면 즉시 재링크(방어) — 단 정상 경로에선 발생 안함', () => {
    // 가정상 mount 재조회가 어떤 이유로 NULL 을 반환하더라도(회귀 방어), 게이트는 재링크(true)를 지시해
    // '풀린 상태로 방치'가 아니라 '다시 연결'로 수렴 → 현장 체감 재풀림이 누적되지 않음.
    expect(
      shouldLinkCheckInPackage({
        latestCheckInId: CI_TODAY,
        latestCheckInPackageId: null,
        deductCheckInId: CI_TODAY,
        targetPackageId: PKG_A,
      }),
    ).toBe(true);
  });
});
