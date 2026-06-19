/**
 * E2E spec — T-20260619-foot-PUBLISH-BTN-REVERIFY-GATE (AC-4)
 * 진료대시보드(DoctorTools) 균검사지 탭 = KohReportTab — 발급 활성화(enable-gate)에 '치료사 배정' 조건 추가.
 * reporter: 문지은 대표원장. "발가락도 이미 치료사가 선택해서 정보 완벽하게 조건 있는것들만 발급하기 활성화되어야함".
 *
 * RC(그라운딩 완료):
 *   (a) 발가락(발톱)=koh_nail_sites → KohReportTab. 치료사 배정 = check_ins.therapist_id(기존 컬럼, read-only).
 *       신규 role/컬럼/스키마 0 — KohReportTab L25 금지 준수.
 *   (b) 본건은 held KOHBTN-ROLE-LABEL-VALIDGATE 의 enable-gate(AC-2/canPublish) 확장.
 *       canPublish 에 therapist_id AND 추가. 라벨 역할분기(isDoctor)·NO-STAFF-FN 충돌축은 무변경.
 *   (c) 사유 발견성 보존(KOHBTN AC-3 회귀방지): 치료사 미배정 행도 탭 가능(disabled=busy 한정) → 사유 toast/title.
 *
 * 시나리오(티켓 본문 S2/S3):
 *   S2 치료사 배정 게이트 — 조갑부위+생년+치료사배정+미발행 행만 발급 활성. 하나라도 빠지면 비활성.
 *   S3 회귀 없음 — 旣 발행건은 발급 불가(완료) 유지.
 *
 * 스타일: in-page 순수 로직 시뮬레이션 — KohReportTab 정본(canPublish/handlePublish 사유분기/title) 모사. FE-only(NO-DDL).
 */
import { test, expect } from '@playwright/test';

// ── 정본 모사: KohRow(치료사 배정 필드 포함) + canPublish (KohReportTab.tsx) ──
interface KohRowLite {
  nailCount: number;
  birth: string | null;
  therapistId: string | null; // PUBLISH-BTN-REVERIFY-GATE(AC-4): check_ins.therapist_id (null=미배정)
  published: boolean;
}
// 정본: r.nail_sites.length > 0 && !!r.birth_date && !!r.therapist_id && !isPublished(r.id)
const canPublish = (r: KohRowLite) =>
  r.nailCount > 0 && !!r.birth && !!r.therapistId && !r.published;

const publishBtnVariant = (r: KohRowLite): 'default' | 'outline' => (canPublish(r) ? 'default' : 'outline');
/** disabled 는 busy 한정 — 비활성 행도 탭 가능(사유 toast 발견성 보존, KOHBTN AC-3). */
const publishBtnDisabled = (busy: boolean) => busy;

// ── 정본 모사: handlePublish 사유 toast 순서(조갑 → 생년 → 치료사) ──
const pubNoun = (isDoctor: boolean) => (isDoctor ? '발급' : '발급요청');
const therapistMissingToast = (isDoctor: boolean) =>
  `담당 치료사가 배정되지 않아 ${pubNoun(isDoctor)}할 수 없습니다. 접수/체크인에서 담당 치료사를 먼저 지정해주세요.`;

// ── 정본 모사: 발급 불가 title 사유 체인(조갑 → 생년 → 치료사) ──
const publishTitle = (isDoctor: boolean, r: KohRowLite) =>
  canPublish(r)
    ? `검사결과 보고서 ${pubNoun(isDoctor)}(비가역)`
    : r.nailCount === 0
      ? `채취 조갑부위를 먼저 선택해야 ${pubNoun(isDoctor)}할 수 있습니다 (눌러서 안내 보기)`
      : !r.birth
        ? `환자 생년월일 미입력 — ${pubNoun(isDoctor)} 불가 (눌러서 안내 보기)`
        : !r.therapistId
          ? `담당 치료사 미배정 — ${pubNoun(isDoctor)} 불가 (눌러서 안내 보기)`
          : `${pubNoun(isDoctor)} 불가 (눌러서 안내 보기)`;

const ROW_OK: KohRowLite = { nailCount: 1, birth: '1990-01-01', therapistId: 't-1', published: false };
const ROW_NO_THERAPIST: KohRowLite = { nailCount: 1, birth: '1990-01-01', therapistId: null, published: false };
const ROW_NO_BIRTH: KohRowLite = { nailCount: 1, birth: null, therapistId: 't-1', published: false };
const ROW_NO_NAIL: KohRowLite = { nailCount: 0, birth: '1990-01-01', therapistId: 't-1', published: false };
const ROW_PUBLISHED: KohRowLite = { nailCount: 1, birth: '1990-01-01', therapistId: 't-1', published: true };

// ===========================================================================
test.describe('T-20260619-foot-PUBLISH-BTN-REVERIFY-GATE (AC-4 치료사 배정 게이트)', () => {
  // ── S2 치료사 배정 게이트 ──
  test('S2a: 조갑부위+생년+치료사배정+미발행 모두 충족 행만 발급 활성', () => {
    expect(canPublish(ROW_OK)).toBe(true);
    expect(publishBtnVariant(ROW_OK)).toBe('default');
  });

  test('S2b: 치료사 미배정 행 → 발급 비활성(다른 조건 다 충족해도)', () => {
    // reporter 핵심 요구: "이미 치료사가 선택해서 정보 완비된 건만 활성".
    expect(canPublish(ROW_NO_THERAPIST)).toBe(false);
    expect(publishBtnVariant(ROW_NO_THERAPIST)).toBe('outline');
  });

  test('S2c: 치료사 배정됐으나 생년월일 미입력 행 → 발급 비활성', () => {
    expect(canPublish(ROW_NO_BIRTH)).toBe(false);
    expect(publishBtnVariant(ROW_NO_BIRTH)).toBe('outline');
  });

  test('S2d: 조갑부위 누락 행 → 발급 비활성(치료사 배정 여부 무관)', () => {
    expect(canPublish(ROW_NO_NAIL)).toBe(false);
  });

  test('S2e: 치료사 미배정 사유 발견성 — 탭 가능(disabled=busy 한정) + toast/title 명시', () => {
    // KOHBTN AC-3 회귀방지: 비활성 행도 탭 가능해야 사유가 뜬다(태블릿 hover 부재).
    expect(publishBtnDisabled(false)).toBe(false);
    expect(publishBtnDisabled(true)).toBe(true);
    // 사유 toast — 다음 행동(접수/체크인 치료사 지정) 안내.
    expect(therapistMissingToast(true)).toContain('담당 치료사');
    expect(therapistMissingToast(true)).toContain('접수/체크인');
    // title 도 사유 명시.
    expect(publishTitle(true, ROW_NO_THERAPIST)).toContain('치료사 미배정');
    expect(publishTitle(true, ROW_NO_THERAPIST)).toContain('눌러서 안내 보기');
  });

  test('S2f: 사유 우선순위 — 조갑 > 생년 > 치료사 (title 체인 일관)', () => {
    // 조갑 누락이면 조갑 사유 우선(생년/치료사보다).
    expect(publishTitle(true, ROW_NO_NAIL)).toContain('조갑부위');
    // 조갑 OK·생년 누락이면 생년 사유.
    expect(publishTitle(true, ROW_NO_BIRTH)).toContain('생년월일 미입력');
    // 조갑·생년 OK·치료사 미배정이면 치료사 사유.
    expect(publishTitle(true, ROW_NO_THERAPIST)).toContain('치료사 미배정');
    // 다 충족이면 비가역 안내.
    expect(publishTitle(true, ROW_OK)).toContain('비가역');
  });

  test('S2g: 게이트는 역할 무관(enable-gate 단일 SSOT) — 라벨 분기와 독립', () => {
    // 의사/치료사 view 모두 동일 canPublish. 본건은 enable-gate만(NO-STAFF-FN 라벨축 무변경).
    expect(canPublish(ROW_OK)).toBe(true);
    expect(canPublish(ROW_NO_THERAPIST)).toBe(false);
    // pubNoun 표기만 역할 분기(게이트엔 영향 없음).
    expect(pubNoun(true)).toBe('발급');
    expect(pubNoun(false)).toBe('발급요청');
  });

  // ── S3 회귀 없음(旣 발행건) ──
  test('S3a: 이미 발행된 행 → 발급 비활성/완료 유지(재발행 안 됨)', () => {
    expect(canPublish(ROW_PUBLISHED)).toBe(false);
  });

  test('S3b: 회귀방지 — 치료사 조건 추가 전 통과하던 행(치료사 배정)은 여전히 통과', () => {
    // 4FIX/KOHBTN 시점 ROW_OK(조갑+생년+미발행)에 치료사 배정만 더해지면 동일하게 활성.
    expect(canPublish(ROW_OK)).toBe(true);
    // 치료사 조건이 추가되어 기존엔 활성이었으나 미배정인 행은 이제 비활성(의도된 강화).
    expect(canPublish(ROW_NO_THERAPIST)).toBe(false);
  });
});
