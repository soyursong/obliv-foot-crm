/**
 * T-20260819-foot-MEDIMG-UPLOAD-PROGRESS-LOCK  (= T-20260819-foot-ASYNC-UIFLAG-STUCK-LOCK)
 *
 * [RC] 비동기 함수가 UI 게이팅 플래그(busy/uploadProgress/saving/uploading …)를 켠 뒤
 *   `await supabase…` 가 연결끊김·중단으로 **throw** 하면 플래그 해제 라인에 도달하지 못한다.
 *   - storage-js dist/index.mjs:441-448 : StorageError 아닌 예외(TypeError: Failed to fetch)는 재-throw
 *   - postgrest-js dist/index.mjs:268-278 : insert/update/delete/rpc(비-RETRYABLE)는 즉시 throw
 *   → `disabled={busy}` / `{busy && (…)}` 게이팅이 영구 잠김 → 버튼·카메라·오버레이 고착.
 *     복구 수단이 새로고침뿐이 되는 현장 증상("사진촬영·저장 계속 튕김", 08-19 10:52 김주연 총괄).
 *
 * [처방] 게이팅 플래그를 켜는 33곳 전수(§3-A storage 6 · §3-B DB쓰기 25 · §3-C 미식별 2)를
 *   try/catch/finally 로 감싸 **어떤 경로로든 플래그 해제를 보장**한다. 가드 자체는 유지(재진입 방지).
 *
 * [본 spec = DoD-6 정적 회귀 가드]
 *   "UI 를 게이팅하는 플래그를 켜는 비동기 함수는 finally 해제를 가져야 한다."
 *   각 대상 함수 본문(중괄호 균형 추출)에 `finally { … 해제 … }` 존재를 정적 단언.
 *   🔴 수정 전 코드(146c92b7)에서 RED(다수) / 수정 후 GREEN 0.  이 계열 재발(4차)의 종결 조건.
 *
 * project=unit (순수 fs-grep 정적 단언 — auth/DB/server 불요·결정론). db_change=false.
 * 선례 스타일: tests/e2e/T-20260818-foot-STORAGE-LIST-CALLREDUCE-CACHE.spec.ts
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(process.cwd(), 'src');
const read = (rel: string) => readFileSync(path.join(SRC, rel), 'utf8');

/** anchor(함수 선언 문자열) 이후 첫 '{' 부터 중괄호 균형이 맞는 지점까지 = 함수 본문. occ=몇 번째 출현. */
function funcBody(src: string, anchor: string, occ = 0): string | null {
  let from = 0;
  for (let n = 0; n <= occ; n++) {
    const i = src.indexOf(anchor, from);
    if (i < 0) return null;
    if (n < occ) { from = i + anchor.length; continue; }
    const open = src.indexOf('{', i);
    if (open < 0) return null;
    let depth = 0;
    for (let k = open; k < src.length; k++) {
      const c = src[k];
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) return src.slice(i, k + 1); }
    }
  }
  return null;
}

/** 대상 33곳: [파일, 함수 anchor, occ(다중출현시), 해제-표현식, 섹션] */
type Spot = [string, string, number, string, string];
const SPOTS: Spot[] = [
  // ── §3-A Storage (6) ─────────────────────────────────────────────
  ['pages/CustomerChartPage.tsx', 'const uploadCaptured =', 0, 'setUploadProgress(null)', '3A'],
  ['pages/CustomerChartPage.tsx', 'const handleUpload =', 0, 'setUploading(false)', '3A'],
  ['pages/CustomerChartPage.tsx', 'const handleUpload =', 2, 'setUploading(false)', '3A'],
  ['components/CheckInDetailSheet.tsx', 'const handleUpload =', 0, 'setUploading(false)', '3A'],
  ['components/InsuranceDocPanel.tsx', 'const handleUpload =', 0, 'setUploading(false)', '3A'],
  ['components/DocumentPrintPanel.tsx', 'const handleSave =', 0, 'setSaving(false)', '3A'],
  // ── §3-B DB 쓰기 (25 = 23 함수 + dupDeduct 2차플래그 2) ──────────
  ['pages/CustomerChartPage.tsx', 'const saveCertNo =', 0, 'setSavingCertNo(false)', '3B'],
  ['pages/CustomerChartPage.tsx', 'const saveUseSession =', 0, 'setSavingSession(false)', '3B'],
  ['pages/CustomerChartPage.tsx', 'const saveEditSession =', 0, 'setSavingEditSession(false)', '3B'],
  ['pages/CustomerChartPage.tsx', 'const saveEditPkg =', 0, 'setSavingEditPkg(false)', '3B'],
  ['pages/CustomerChartPage.tsx', 'const softDeletePkg =', 0, 'setDeletingPkg(false)', '3B'],
  ['pages/CustomerChartPage.tsx', 'const saveResvMini =', 0, 'setSavingResvMini(false)', '3B'],
  ['pages/CustomerChartPage.tsx', 'const saveResvDetail =', 0, 'setSavingResvDetail(false)', '3B'],
  ['pages/CustomerChartPage.tsx', 'const saveAlt =', 0, 'setSavingAlt(false)', '3B'],
  ['pages/CustomerChartPage.tsx', 'const saveNewTreatmentMemo =', 0, 'setSavingNewMemo(false)', '3B'],
  ['pages/CustomerChartPage.tsx', 'const saveC22Deduct =', 0, 'setSavingC22Deduct(false)', '3B'],
  ['pages/CustomerChartPage.tsx', 'const handleDupChangeTherapistOnly =', 0, 'setDupDeductBusy(false)', '3B'],
  ['pages/CustomerChartPage.tsx', 'const handleDupAddSession =', 0, 'setDupDeductBusy(false)', '3B'],
  ['pages/CustomerChartPage.tsx', 'const saveDesignatedTherapist =', 0, 'setSavingDesignatedTherapist(false)', '3B'],
  ['pages/CustomerChartPage.tsx', 'const handleHealerDeduct =', 0, 'setSavingHealerDeduct(false)', '3B'],
  ['pages/CustomerChartPage.tsx', 'const saveEditResv =', 0, 'setSavingEditResv(false)', '3B'],
  ['pages/CustomerChartPage.tsx', 'const saveInlineResv =', 0, 'setSavingInlineResv(false)', '3B'],
  ['pages/CustomerChartPage.tsx', 'const submit =', 0, 'setSubmitting(false)', '3B'],
  ['pages/CustomerChartPage.tsx', 'const submitWithTemplate =', 0, 'setSubmitting(false)', '3B'],
  ['pages/CustomerChartPage.tsx', 'const submit =', 1, 'setSubmitting(false)', '3B'],
  ['components/CheckInDetailSheet.tsx', 'const saveNotes =', 0, 'setSaving(false)', '3B'],
  ['components/CheckInDetailSheet.tsx', 'const handleLinkCustomer =', 0, 'setLinkSaving(false)', '3B'],
  ['components/CheckInDetailSheet.tsx', 'const save =', 0, 'setSubmitting(false)', '3B'],
  ['components/DocumentPrintPanel.tsx', 'const handlePrint =', 0, 'setSaving(false)', '3B'],
  // §3-B 2차 플래그(같은 함수 내 dupDeductModal 게이팅) — 잠금 기전은 busy 플래그이나 모달축도 함께 락
  ['pages/CustomerChartPage.tsx', 'const saveC22Deduct =', 0, 'finally', '3B'],
  ['pages/CustomerChartPage.tsx', 'const handleHealerDeduct =', 0, 'finally', '3B'],
  // ── §3-C throw원 미식별 2 (JS 예외로도 동일 잠김) ────────────────
  ['pages/CustomerChartPage.tsx', 'const handleVisitConfirm =', 0, 'setConfirmingVisit(false)', '3C'],
  ['components/CheckInDetailSheet.tsx', 'const handleLinkSearch =', 0, 'setLinkSearching(false)', '3C'],
];

test.describe('MEDIMG-UPLOAD-PROGRESS-LOCK — DoD-6 정적 회귀 가드(게이팅 async 는 finally 해제)', () => {
  test('대상 33곳 전수: 함수 anchor 존재 + finally 블록에서 게이팅 플래그 해제', () => {
    const failures: string[] = [];
    for (const [rel, anchor, occ, release, sec] of SPOTS) {
      const src = read(rel);
      const body = funcBody(src, anchor, occ);
      if (!body) { failures.push(`[${sec}] ANCHOR 없음: ${rel} :: ${anchor} (occ ${occ})`); continue; }
      const fi = body.indexOf('finally');
      if (fi < 0) { failures.push(`[${sec}] finally 없음: ${anchor} (occ ${occ})`); continue; }
      // 해제 표현식이 finally 이후(= finally 블록 안쪽)에 존재해야 한다.
      if (release !== 'finally' && body.indexOf(release, fi) < 0) {
        failures.push(`[${sec}] finally 내 해제 없음: ${anchor} (expect ${release})`);
      }
    }
    expect(failures, `RED spots:\n${failures.join('\n')}`).toEqual([]);
  });

  test('전수 개수 불변 = 33 (스캐너 그물 축소 방지)', () => {
    expect(SPOTS.length).toBe(33);
  });
});
