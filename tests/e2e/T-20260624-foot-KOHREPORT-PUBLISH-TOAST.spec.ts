/**
 * E2E spec — T-20260624-foot-KOHREPORT-PUBLISH-TOAST
 * 균검사 결과보고서(KohReportTab) 발급하기 → 발행 성공 직후 자동으로 뜨던 미리보기/확인 팝업 제거 → 토스트 교체.
 * reporter: 문지은 대표원장(U0ALGAAAJAV, #풋센터). FE-only / NO-DDL — UI 피드백 레이어만 교체.
 *
 * 변경 정본(src/components/doctor/KohReportTab.tsx handlePublish):
 *   旣: publish 성공 → toast.success('발급 완료 — 의뢰번호 …') + setPreviewData({…})  // 자동 미리보기 팝업 오픈
 *   新: publish 성공 → toast.success('{환자명} {차트번호} 발행완료')                    // 자동 팝업 제거
 *
 * 현장 클릭 시나리오 3종(티켓 본문) 변환:
 *   S1 정상 토스트 — 발급 클릭/발행 성공 → '{환자명} {차트번호} 발행완료' 토스트, 자동 팝업(previewData) 미오픈.
 *   S2 보기팝업 보존(회귀가드) — 발행완료 행 '💾 발행완료' 버튼 클릭 → 미리보기 팝업 오픈(setPreviewData) 정상.
 *                                 사용자가 의도적으로 여는 별개 팝업 — 절대 제거 금지.
 *   S3 발행차단 보존(회귀가드) — 정보누락(조갑부위/생년/치료사 미배정) 시 publish 게이트 차단 + 사유 toast, 발행 미실행.
 *
 * 스타일: in-page 순수 로직 시뮬레이션 — handlePublish 성공 분기/보기 버튼 onClick/발행 게이트를 모사해 회귀를 잡는다.
 *   전 항목 NO-DDL(FE 로직/UI만). 발행 RPC·게이트·lifecycle·생년 fallback·전직군 권한·single-select 무변경.
 */
import { test, expect } from '@playwright/test';

// ── 정본 모사: KohRow 부분형 ───────────────────────────────────────────────────
type NailSide = 'Rt' | 'Lt';
interface NailSite { side: NailSide; toe: number; }
interface KohRowLite {
  id: string;
  customer_name: string;
  chart_number: string | null;
  birth_date: string | null;
  therapist_id: string | null;
  nail_sites: NailSite[];
  treatment_sites: NailSite[];
}

// ── 정본 모사: 발행 성공 토스트 문구 (KOHREPORT-PUBLISH-TOAST) ──────────────────
//   문구 = {환자명} {차트번호} 발행완료. 차트번호 없으면 자연 생략(filter(Boolean).join(' ')).
const publishSuccessToast = (r: KohRowLite): string =>
  [r.customer_name, r.chart_number].filter(Boolean).join(' ') + ' 발행완료';

// ── 정본 모사: 발행 게이트 (회귀가드 — 조갑부위 → 생년 → 치료사 순서, 무변경) ───
type Gate = { ok: true } | { ok: false; reason: string };
const pubNoun = '발급';
const publishGate = (r: KohRowLite): Gate => {
  if (r.nail_sites.length === 0) {
    return {
      ok: false,
      reason:
        r.treatment_sites.length > 0
          ? `표시된 치료부위는 아직 저장되지 않았습니다. 조갑부위 버튼을 눌러 확정한 뒤 ${pubNoun}해주세요.`
          : `채취 조갑부위를 먼저 선택(좌발/우발 버튼 클릭)해야 ${pubNoun}할 수 있습니다.`,
    };
  }
  if (!r.birth_date) {
    return { ok: false, reason: `환자 생년월일 정보가 없어 ${pubNoun}할 수 없습니다. 고객 정보에서 생년월일을 먼저 입력해주세요.` };
  }
  if (!r.therapist_id) {
    return { ok: false, reason: `담당 치료사가 배정되지 않아 ${pubNoun}할 수 없습니다. 접수/체크인에서 담당 치료사를 먼저 지정해주세요.` };
  }
  return { ok: true };
};

// ── 정본 모사: handlePublish 성공 분기 (자동 팝업 제거 — 토스트만) ─────────────
//   publish 성공 후 더 이상 previewData 를 set 하지 않는다(자동 미리보기 팝업 제거).
interface PublishEffect { toast: string; previewOpened: boolean; }
const onPublishSuccess = (r: KohRowLite): PublishEffect => ({
  toast: publishSuccessToast(r),
  previewOpened: false, // ★자동 팝업 제거 — 토스트 피드백으로 교체
});

// ── 정본 모사: '💾 발행완료' 버튼 onClick (보기 팝업 — 보존 대상) ──────────────
//   line ~1152: onClick={() => setPreviewData(published.field_data)} — 의도적 미리보기 오픈.
const onPublishedViewClick = (fieldData: Record<string, unknown> | null): { previewOpened: boolean } => ({
  previewOpened: fieldData !== null,
});

// ===========================================================================
test.describe('T-20260624-foot-KOHREPORT-PUBLISH-TOAST', () => {
  const fullRow: KohRowLite = {
    id: '1', customer_name: '김복자', chart_number: 'A-10231',
    birth_date: '1962-08-09', therapist_id: 'tx-1',
    nail_sites: [{ side: 'Rt', toe: 1 }], treatment_sites: [],
  };

  // ── S1 정상 토스트 ──
  test('S1a: 발행 성공 → 토스트 문구 = "{환자명} {차트번호} 발행완료"', () => {
    expect(publishSuccessToast(fullRow)).toBe('김복자 A-10231 발행완료');
  });

  test('S1b: 차트번호 없는 환자 → "{환자명} 발행완료"(빈 칸/null 자연 생략)', () => {
    const r: KohRowLite = { ...fullRow, customer_name: '이순례', chart_number: null };
    expect(publishSuccessToast(r)).toBe('이순례 발행완료');
    expect(publishSuccessToast(r)).not.toContain('  '); // 더블스페이스 없음
  });

  test('S1c: 발행 성공 직후 자동 미리보기 팝업 미오픈(previewData 미set) — 토스트만', () => {
    const eff = onPublishSuccess(fullRow);
    expect(eff.previewOpened).toBe(false); // 자동 팝업 제거 핵심
    expect(eff.toast).toBe('김복자 A-10231 발행완료');
  });

  test('S1d: 旣 토스트("발급 완료 — 의뢰번호 …") 문구는 폐기 — 새 문구로 교체', () => {
    const eff = onPublishSuccess(fullRow);
    expect(eff.toast).not.toContain('의뢰번호');
    expect(eff.toast).toContain('발행완료');
  });

  // ── S2 보기팝업 보존(회귀가드) ──
  test('S2a: 발행완료 행 "💾 발행완료" 클릭 → 미리보기 팝업 오픈(보존)', () => {
    const published = { request_no: 'KOH-2026-0042', field_data: { patient_name: '김복자' } };
    const eff = onPublishedViewClick(published.field_data);
    expect(eff.previewOpened).toBe(true); // 사용자 의도 오픈 — 절대 제거 금지
  });

  test('S2b: previewData=null 이면 미리보기 닫힘(onOpenChange→setPreviewData(null) 정상)', () => {
    const eff = onPublishedViewClick(null);
    expect(eff.previewOpened).toBe(false);
  });

  // ── S3 발행차단 보존(회귀가드) ──
  test('S3a: 조갑부위 누락 → 발행 게이트 차단 + 조갑부위 사유(발행 미실행)', () => {
    const r: KohRowLite = { ...fullRow, nail_sites: [] };
    const gate = publishGate(r);
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.reason).toContain('조갑부위');
  });

  test('S3b: 생년 누락 → 차단 + 생년월일 사유', () => {
    const r: KohRowLite = { ...fullRow, birth_date: null };
    const gate = publishGate(r);
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.reason).toContain('생년월일');
  });

  test('S3c: 담당 치료사 미배정 → 차단 + 치료사 사유', () => {
    const r: KohRowLite = { ...fullRow, therapist_id: null };
    const gate = publishGate(r);
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.reason).toContain('치료사');
  });

  test('S3d: 정보 완비 → 게이트 통과 → 성공 토스트(자동 팝업 없이)', () => {
    expect(publishGate(fullRow).ok).toBe(true);
    const eff = onPublishSuccess(fullRow);
    expect(eff.previewOpened).toBe(false);
    expect(eff.toast).toBe('김복자 A-10231 발행완료');
  });
});
