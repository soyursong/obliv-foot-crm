/**
 * E2E spec — T-20260629-foot-BACTCHECK-PUBLISH-THERAPIST
 * 진료대시보드(DoctorTools) 균검사지(KOH) 탭 = KohReportTab — 발행 게이트에서 '담당 치료사 배정' 조건 제거.
 *
 * 결정: 문지은 대표원장 A안(2026-06-29 20:22 KST, slack ts 1782731020.431179, MSG-20260629-200449-hbxs).
 *   생년월일 + 검사(조갑) 부위만 입력되어 있으면 담당 치료사 미배정 상태에서도 즉시 발행 가능.
 *   박민석 환자류(접수/체크인 치료사 미배정) 케이스 해소.
 *
 * 정책 supersede:
 *   T-20260619-foot-PUBLISH-BTN-REVERIFY-GATE AC-4(치료사 필수 게이트, 文 지시로 추가됐던 825dc2be)를
 *   정책 owner(문지은 대표원장) 본인이 명시적으로 철회. 같은 surface이므로 BACTCHECK가 현행 정본.
 *
 * 변경(코드 RC에서 위치 특정):
 *   (AC-1) canPublish(L733): `&& !!r.therapist_id` 제거 → nail_sites>0 && birth && !published.
 *   (AC-2) handlePublish(L757-758): therapist_id 미배정 차단 toast 분기 제거.
 *   (부수) 발행불가 title 체인·안내문에서 '치료사 미배정' 사유 제거(거짓 안내 방지).
 *
 * 스키마 변경 없음(read-only therapist_id 조건 삭제만).
 * 스타일: in-page 순수 로직 시뮬레이션 — KohReportTab 정본(canPublish/handlePublish 사유분기/title) 모사. FE-only(NO-DDL).
 */
import { test, expect } from '@playwright/test';

// ── 정본 모사: KohRow + canPublish (BACTCHECK 이후 — therapist_id 게이트 제거) ──
interface KohRowLite {
  nailCount: number;
  birth: string | null;
  therapistId: string | null; // read-only(check_ins.therapist_id). BACTCHECK 이후 게이트 아님.
  published: boolean;
}
// 정본(BACTCHECK AC-1): r.nail_sites.length > 0 && !!effectiveBirth(r) && !isPublished(r.id)
const canPublish = (r: KohRowLite) => r.nailCount > 0 && !!r.birth && !r.published;

const publishBtnVariant = (r: KohRowLite): 'default' | 'outline' => (canPublish(r) ? 'default' : 'outline');
/** disabled 는 busy 한정 — 비활성 행도 탭 가능(사유 toast 발견성 보존, KOHBTN AC-3). */
const publishBtnDisabled = (busy: boolean) => busy;

// ── 정본 모사: handlePublish 사유 toast(조갑 → 생년). 치료사 분기는 제거됨. ──
const pubNoun = (isDoctor: boolean) => (isDoctor ? '발급' : '발급요청');
const nailMissingToast = (isDoctor: boolean) =>
  `채취 조갑부위를 먼저 선택(좌발/우발 버튼 클릭)해야 ${pubNoun(isDoctor)}할 수 있습니다.`;
const birthMissingToast = (isDoctor: boolean) =>
  `환자 생년월일 정보가 없어 ${pubNoun(isDoctor)}할 수 없습니다. 고객 정보에서 생년월일을 먼저 입력해주세요.`;

// ── 정본 모사: 발급 불가 title 사유 체인(조갑 → 생년). 치료사 분기 제거됨. ──
const publishTitle = (isDoctor: boolean, r: KohRowLite) =>
  canPublish(r)
    ? `검사결과 보고서 ${pubNoun(isDoctor)}(비가역)`
    : r.nailCount === 0
      ? `채취 조갑부위를 먼저 선택해야 ${pubNoun(isDoctor)}할 수 있습니다 (눌러서 안내 보기)`
      : !r.birth
        ? `환자 생년월일 미입력 — ${pubNoun(isDoctor)} 불가 (눌러서 안내 보기)`
        : `${pubNoun(isDoctor)} 불가 (눌러서 안내 보기)`;

// 박민석류: 치료사 미배정 + 조갑·생년 완비.
const ROW_NO_THERAPIST: KohRowLite = { nailCount: 1, birth: '1990-01-01', therapistId: null, published: false };
const ROW_WITH_THERAPIST: KohRowLite = { nailCount: 1, birth: '1990-01-01', therapistId: 't-1', published: false };
const ROW_NO_BIRTH: KohRowLite = { nailCount: 1, birth: null, therapistId: null, published: false };
const ROW_NO_NAIL: KohRowLite = { nailCount: 0, birth: '1990-01-01', therapistId: 't-1', published: false };
const ROW_PUBLISHED: KohRowLite = { nailCount: 1, birth: '1990-01-01', therapistId: 't-1', published: true };

// ===========================================================================
test.describe('T-20260629-foot-BACTCHECK-PUBLISH-THERAPIST (치료사 게이트 제거)', () => {
  // ── 시나리오 1: 치료사 미배정 + 필수정보 완비 → 즉시 발행 (핵심, AC-3) ──
  test('S1a: 박민석류(치료사 미배정 + 조갑·생년 완비) → 발급 활성', () => {
    // 결정 A: 생년월일 + 검사부위만 있으면 치료사 미배정도 발행 가능.
    expect(canPublish(ROW_NO_THERAPIST)).toBe(true);
    expect(publishBtnVariant(ROW_NO_THERAPIST)).toBe('default');
  });

  test('S1b: 치료사 미배정 행에 발급불가 차단 toast가 더 이상 뜨지 않음', () => {
    // AC-2: handlePublish 의 therapist 차단 분기 제거 → 조갑·생년 충족 시 차단 사유 없음.
    expect(canPublish(ROW_NO_THERAPIST)).toBe(true);
    // title 도 '치료사 미배정' 사유를 노출하지 않음(비가역 안내로 진입).
    expect(publishTitle(true, ROW_NO_THERAPIST)).toContain('비가역');
    expect(publishTitle(true, ROW_NO_THERAPIST)).not.toContain('치료사');
  });

  // ── 시나리오 2: 회귀 — 치료사 배정 건 정상 (AC-4) ──
  test('S2: 담당 치료사 배정 건도 종전처럼 정상 발행 유지', () => {
    expect(canPublish(ROW_WITH_THERAPIST)).toBe(true);
    expect(publishBtnVariant(ROW_WITH_THERAPIST)).toBe('default');
  });

  // ── 시나리오 3: 엣지 — 필수정보 누락 시 여전히 차단 (AC-4) ──
  test('S3a: 생년월일 누락 → 발급 비활성 + 생년 사유 안내(치료사 무관)', () => {
    expect(canPublish(ROW_NO_BIRTH)).toBe(false);
    expect(publishBtnVariant(ROW_NO_BIRTH)).toBe('outline');
    expect(birthMissingToast(true)).toContain('생년월일');
    expect(publishTitle(true, ROW_NO_BIRTH)).toContain('생년월일 미입력');
  });

  test('S3b: 검사(조갑) 부위 누락 → 발급 비활성 + 조갑 사유 안내', () => {
    expect(canPublish(ROW_NO_NAIL)).toBe(false);
    expect(nailMissingToast(true)).toContain('조갑부위');
    expect(publishTitle(true, ROW_NO_NAIL)).toContain('조갑부위');
  });

  test('S3c: 사유 우선순위 — 조갑 > 생년 (치료사는 더 이상 사유 체인에 없음)', () => {
    // 조갑 누락이면 조갑 우선(생년보다).
    expect(publishTitle(true, ROW_NO_NAIL)).toContain('조갑부위');
    // 조갑 OK·생년 누락이면 생년 사유. (치료사 사유 분기 부재)
    expect(publishTitle(true, ROW_NO_BIRTH)).toContain('생년월일 미입력');
    // title 체인 어디에도 '치료사' 사유는 없음.
    expect(publishTitle(true, ROW_NO_THERAPIST)).not.toContain('치료사');
    expect(publishTitle(true, ROW_NO_NAIL)).not.toContain('치료사');
  });

  // ── 회귀: 발행 완료건 / 게이트 발견성 ──
  test('R1: 이미 발행된 행 → 발급 비활성/완료 유지(재발행 안 됨)', () => {
    expect(canPublish(ROW_PUBLISHED)).toBe(false);
  });

  test('R2: 비활성 행도 탭 가능(disabled=busy 한정) — 사유 발견성 보존(KOHBTN AC-3)', () => {
    expect(publishBtnDisabled(false)).toBe(false);
    expect(publishBtnDisabled(true)).toBe(true);
  });

  test('R3: supersede 확인 — 치료사 게이트 제거 전 비활성이던 박민석류가 이제 활성', () => {
    // PUBLISH-BTN-REVERIFY-GATE AC-4 시점엔 ROW_NO_THERAPIST=false 였음 → 철회 후 true.
    expect(canPublish(ROW_NO_THERAPIST)).toBe(true);
    // 게이트는 nail + birth 둘만. 치료사 값(t-1/null) 차이가 결과를 바꾸지 않음.
    expect(canPublish(ROW_NO_THERAPIST)).toBe(canPublish(ROW_WITH_THERAPIST));
  });
});
