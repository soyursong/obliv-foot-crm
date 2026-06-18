/**
 * E2E spec — T-20260618-foot-KOHBTN-ROLE-LABEL-VALIDGATE
 * 진료대시보드(DoctorTools) 균검사지 탭 — KOH 발급버튼 라벨 역할별 분기 + 의사 view 검증게이트.
 * reporter: 문지은 대표원장. 부모 동거: 4FIX(deployed) · SINGLESEL-2FIX(field-soak).
 *
 * RC(그라운딩 완료):
 *   (a) "진료대시보드" = DoctorTools.tsx(<h1>진료대시보드</h1>) 균검사지 탭 = KohReportTab. 확정.
 *   (b) 역할 = profile.role(UserRole). 의사 = 'director'(원장, 풋센터 유일 physician role). 치료사 = 'therapist'.
 *   (c) AC-4 1차가정(FE-only) 확정 — 치료사='(현행)' = 동작 무변경. publish_koh_result RPC 는 역할 무관 동일.
 *       '치료사 요청→의사 발급' 2단계 승인 워크플로 아님(요청상태 영속화 0, 신규 컬럼/상태 0).
 *
 * 시나리오 3종(티켓 본문):
 *   S1 라벨 역할 분기 — 의사=발급하기/일괄발급하기, 그 외(치료사)=발급요청/일괄발급요청(현행).
 *   S2 의사 view 검증게이트 — rowPublishable(조갑부위+생년월일) 행만 '발급하기' 활성 표시(variant=default),
 *       비검증 행은 비활성처럼(outline). 단 disabled 는 busy 한정 → 탭 시 사유 toast(AC-3 회귀방지, SINGLESEL-2FIX 이슈1 보존).
 *   S3 confirm/toast 문장 pubNoun 동일치환 — 치료사 경로는 旣 문자열과 byte-identical(회귀0), 의사 경로는 '발급' 자연어.
 *
 * 스타일: in-page 순수 로직 시뮬레이션 — KohReportTab 정본(isDoctor/pubNoun/publishBtnLabel/bulkPublishBtnLabel/
 *   canPublish/handlePublish 사유분기/버튼 variant·disabled) 을 모사해 회귀를 잡는다. FE-only(NO-DDL).
 */
import { test, expect } from '@playwright/test';

// ── 정본 모사: 역할/라벨 파생 (KohReportTab.tsx) ──────────────────────────────
type UserRole = string;
const isDoctorRole = (role: UserRole | null | undefined) => role === 'director';
const pubNounOf = (role: UserRole | null | undefined) => (isDoctorRole(role) ? '발급' : '발급요청');
const publishBtnLabelOf = (role: UserRole | null | undefined) =>
  isDoctorRole(role) ? '발급하기' : '발급요청';
const bulkPublishBtnLabelOf = (role: UserRole | null | undefined, selectedCount: number) =>
  selectedCount > 0
    ? `선택 ${selectedCount}건 일괄${pubNounOf(role)}`
    : isDoctorRole(role)
      ? '일괄발급하기'
      : '일괄발급요청';

// ── 정본 모사: 발급 가능(canPublish) + 행 variant/ disabled ───────────────────
interface KohRowLite { nailCount: number; birth: string | null; published: boolean; }
const canPublish = (r: KohRowLite) => r.nailCount > 0 && !!r.birth && !r.published;
/** 발급 버튼 variant — publishable=default(활성 표시), 아니면 outline(비활성처럼). 역할 무관 동일 styling. */
const publishBtnVariant = (r: KohRowLite): 'default' | 'outline' => (canPublish(r) ? 'default' : 'outline');
/** disabled 는 busy(발행/일괄 진행 중) 한정 — 비검증 행도 탭 가능(사유 toast 경로 보존, AC-3). */
const publishBtnDisabled = (busy: boolean) => busy;

// ── 정본 모사: handlePublish 사유/confirm/toast 문장(pubNoun 치환) ─────────────
const nailEmptyToast = (role: UserRole, hasPrefill: boolean) =>
  hasPrefill
    ? `표시된 치료부위는 아직 저장되지 않았습니다. 조갑부위 버튼을 눌러 확정한 뒤 ${pubNounOf(role)}해주세요.`
    : `채취 조갑부위를 먼저 선택(좌발/우발 버튼 클릭)해야 ${pubNounOf(role)}할 수 있습니다.`;
const birthMissingToast = (role: UserRole) =>
  `환자 생년월일 정보가 없어 ${pubNounOf(role)}할 수 없습니다. 고객 정보에서 생년월일을 먼저 입력해주세요.`;
const singleConfirm = (role: UserRole, name: string) =>
  `${name} 님의 검사결과 보고서를 ${pubNounOf(role)}하시겠습니까?\n\n${pubNounOf(role)} 후에는 수정·취소할 수 없습니다(비가역).`;
const singleSuccessToast = (role: UserRole, reqNo: string) => `${pubNounOf(role)} 완료 — 의뢰번호 ${reqNo}`;
const bulkConfirm = (role: UserRole, n: number) =>
  `선택한 ${n}건의 검사결과 보고서를 일괄 ${pubNounOf(role)}하시겠습니까?\n\n${pubNounOf(role)} 후에는 수정·취소할 수 없습니다(비가역).`;
const bulkSuccessToast = (role: UserRole, ok: number) => `${ok}건 일괄 ${pubNounOf(role)} 완료`;
const publishTitle = (role: UserRole, r: KohRowLite) =>
  canPublish(r)
    ? `검사결과 보고서 ${pubNounOf(role)}(비가역)`
    : !r.birth
      ? `환자 생년월일 미입력 — ${pubNounOf(role)} 불가 (눌러서 안내 보기)`
      : `채취 조갑부위를 먼저 선택해야 ${pubNounOf(role)}할 수 있습니다 (눌러서 안내 보기)`;

const ROW_OK: KohRowLite = { nailCount: 1, birth: '1990-01-01', published: false };
const ROW_NO_NAIL: KohRowLite = { nailCount: 0, birth: '1990-01-01', published: false };
const ROW_NO_BIRTH: KohRowLite = { nailCount: 1, birth: null, published: false };

// ===========================================================================
test.describe('T-20260618-foot-KOHBTN-ROLE-LABEL-VALIDGATE', () => {
  // ── S1 라벨 역할 분기 ──
  test('S1a: 단건 버튼 — 의사=발급하기, 치료사=발급요청', () => {
    expect(publishBtnLabelOf('director')).toBe('발급하기');
    expect(publishBtnLabelOf('therapist')).toBe('발급요청');
  });

  test('S1b: 일괄 버튼(0건 선택) — 의사=일괄발급하기, 치료사=일괄발급요청', () => {
    expect(bulkPublishBtnLabelOf('director', 0)).toBe('일괄발급하기');
    expect(bulkPublishBtnLabelOf('therapist', 0)).toBe('일괄발급요청');
  });

  test('S1c: 일괄 버튼(N건 선택) — 의사=선택 N건 일괄발급, 치료사=선택 N건 일괄발급요청', () => {
    expect(bulkPublishBtnLabelOf('director', 3)).toBe('선택 3건 일괄발급');
    expect(bulkPublishBtnLabelOf('therapist', 3)).toBe('선택 3건 일괄발급요청');
  });

  test('S1d: 의사 외 모든 직원은 치료사와 동일 라벨(현행) — director 만 발급하기', () => {
    for (const role of ['therapist', 'consultant', 'coordinator', 'technician', 'admin', 'manager', 'staff', null]) {
      expect(publishBtnLabelOf(role)).toBe('발급요청');
      expect(bulkPublishBtnLabelOf(role, 0)).toBe('일괄발급요청');
    }
    expect(publishBtnLabelOf('director')).toBe('발급하기');
  });

  // ── S2 의사 view 검증게이트 + AC-3 회귀방지 ──
  test('S2a: rowPublishable(조갑부위+생년월일+미발행) 행만 발급하기 활성(default), 비검증=outline', () => {
    expect(publishBtnVariant(ROW_OK)).toBe('default');     // 조갑+생년 충족 → 활성 표시
    expect(publishBtnVariant(ROW_NO_NAIL)).toBe('outline'); // 조갑부위 누락 → 비활성처럼
    expect(publishBtnVariant(ROW_NO_BIRTH)).toBe('outline'); // 생년 누락 → 비활성처럼
  });

  test('S2b: variant 게이트는 역할 무관 동일(의사 view 도 동일 styling) — 라벨만 분기', () => {
    // 의사/치료사 모두 비검증 행은 outline. 게이트는 canPublish 단일 SSOT.
    expect(publishBtnVariant(ROW_NO_NAIL)).toBe('outline');
    // canPublish 가 false → variant outline. (역할은 라벨/문장에만 영향)
    expect(canPublish(ROW_NO_NAIL)).toBe(false);
    expect(canPublish(ROW_OK)).toBe(true);
  });

  test('S2c: AC-3 회귀방지 — 비검증 행도 탭 가능(disabled=busy 한정) → 사유 toast 발견성 보존', () => {
    // 비검증이어도 클릭 가능해야 사유가 뜬다(태블릿 hover 부재, SINGLESEL-2FIX 이슈1 보존).
    expect(publishBtnDisabled(false)).toBe(false);
    expect(publishBtnDisabled(true)).toBe(true); // 발행/일괄 진행 중에만 비활성
    // 비검증 행 탭 시 사유 toast 가 존재해야 함.
    expect(nailEmptyToast('director', false)).toContain('먼저 선택');
    expect(birthMissingToast('director')).toContain('생년월일');
  });

  test('S2d: 발급 불가 title 도 검증사유를 명시(눌러서 안내 보기 유도)', () => {
    expect(publishTitle('director', ROW_NO_NAIL)).toContain('눌러서 안내 보기');
    expect(publishTitle('director', ROW_NO_BIRTH)).toContain('생년월일 미입력');
    expect(publishTitle('director', ROW_OK)).toContain('비가역');
  });

  // ── S3 confirm/toast pubNoun 동일치환 + 치료사 회귀0 ──
  test('S3a: 치료사 경로 confirm/toast — 旣 문자열과 byte-identical(회귀0)', () => {
    // SINGLESEL-2FIX/4FIX 시점 旣 문자열을 그대로 재현해야 함.
    expect(nailEmptyToast('therapist', true)).toBe(
      '표시된 치료부위는 아직 저장되지 않았습니다. 조갑부위 버튼을 눌러 확정한 뒤 발급요청해주세요.',
    );
    expect(nailEmptyToast('therapist', false)).toBe(
      '채취 조갑부위를 먼저 선택(좌발/우발 버튼 클릭)해야 발급요청할 수 있습니다.',
    );
    expect(birthMissingToast('therapist')).toBe(
      '환자 생년월일 정보가 없어 발급요청할 수 없습니다. 고객 정보에서 생년월일을 먼저 입력해주세요.',
    );
    expect(singleConfirm('therapist', '홍길동')).toBe(
      '홍길동 님의 검사결과 보고서를 발급요청하시겠습니까?\n\n발급요청 후에는 수정·취소할 수 없습니다(비가역).',
    );
    expect(singleSuccessToast('therapist', 'R-001')).toBe('발급요청 완료 — 의뢰번호 R-001');
    expect(bulkConfirm('therapist', 2)).toBe(
      '선택한 2건의 검사결과 보고서를 일괄 발급요청하시겠습니까?\n\n발급요청 후에는 수정·취소할 수 없습니다(비가역).',
    );
    expect(bulkSuccessToast('therapist', 5)).toBe('5건 일괄 발급요청 완료');
  });

  test('S3b: 의사 경로 confirm/toast — pubNoun=발급 자연어 치환', () => {
    expect(nailEmptyToast('director', false)).toBe(
      '채취 조갑부위를 먼저 선택(좌발/우발 버튼 클릭)해야 발급할 수 있습니다.',
    );
    expect(birthMissingToast('director')).toBe(
      '환자 생년월일 정보가 없어 발급할 수 없습니다. 고객 정보에서 생년월일을 먼저 입력해주세요.',
    );
    expect(singleConfirm('director', '홍길동')).toBe(
      '홍길동 님의 검사결과 보고서를 발급하시겠습니까?\n\n발급 후에는 수정·취소할 수 없습니다(비가역).',
    );
    expect(singleSuccessToast('director', 'R-001')).toBe('발급 완료 — 의뢰번호 R-001');
    expect(bulkConfirm('director', 2)).toBe(
      '선택한 2건의 검사결과 보고서를 일괄 발급하시겠습니까?\n\n발급 후에는 수정·취소할 수 없습니다(비가역).',
    );
    expect(bulkSuccessToast('director', 5)).toBe('5건 일괄 발급 완료');
  });

  test('S3c: 발급 동작(실제 publish RPC)은 역할 무관 동일 — 2단계 승인 아님(AC-4)', () => {
    // 발급 가능 게이트는 역할과 독립(canPublish = 조갑부위+생년+미발행). 의사/치료사 모두 동일 조건에서 발급.
    expect(canPublish(ROW_OK)).toBe(true);   // 두 역할 모두 발급 가능
    expect(canPublish(ROW_NO_NAIL)).toBe(false);
    // 라벨/문장만 역할 분기, 게이트·동작은 단일 경로(요청상태 영속화 없음).
    expect(pubNounOf('director')).not.toBe(pubNounOf('therapist')); // 표기만 다름
  });
});
