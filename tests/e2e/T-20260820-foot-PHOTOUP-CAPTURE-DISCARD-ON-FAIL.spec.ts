/**
 * T-20260820-foot-PHOTOUP-CAPTURE-DISCARD-ON-FAIL  (재발 3차)
 *
 * [RC-A] uploadCaptured(CustomerChartPage.tsx) 가 업로드가 한 건이라도 실패하면 capturedBlobs 를
 *   전량 삭제(setCapturedBlobs([])) + 모달 닫힘(setCameraOpen(false)) → 캡처가 사라진다.
 *   실패분 previewUrl 까지 즉시 revoke + 루프 뒤 일괄 revoke → 미리보기가 깨진 채 유실.
 *   현장은 이를 "저장 안 됨/튕김"으로 겪고 환자 발을 처음부터 재촬영한다(1·2차가 놓친 유실 축).
 *
 * [FIX-1] 성공분만 소비, 실패분은 remaining 으로 보존.
 *   - 성공: URL.revokeObjectURL(item.previewUrl) — 성공분만 preview 해제
 *   - 실패: remaining.push(item) — revoke 하지 않음(미리보기 유지)
 *   - remaining.length === 0 (전건 성공): 현행대로 stopStream·setCapturedBlobs([])·setCameraOpen(false)
 *   - remaining.length > 0 (부분/전건 실패): setCapturedBlobs(remaining) + 카메라 유지
 *     (stopStream·setCameraOpen(false) 호출하지 않음)
 *   - 완료 버튼(:2709 기존 배선)이 그대로 재시도로 동작 → 라벨만 lastUploadFailed ? '재시도' : '완료'
 *   - 토스트: 재촬영 지시 금지 → "N장 저장 실패 — 사진은 그대로 있습니다. [재시도] 를 눌러주세요"
 *   - finally { setUploadProgress(null) } 는 08-19 P0 불변식 — 보존.
 *
 * [본 spec] DoD-1~5 = FIX-1 구조 불변식(source-static 단언) + DoD-6 = 음성-안전 불변식.
 *   카메라 흐름은 getUserMedia(하드웨어) 의존 → headless 행위 재현 불가. 선례
 *   T-20260819-foot-MEDIMG-UPLOAD-PROGRESS-LOCK.spec.ts 와 동일하게 소스 구조 단언으로 DoD 를 봉인한다.
 *   🔴 수정 전(b6136362)에서 RED / 수정 후 GREEN. 재발 3차의 종결 조건(유실 축).
 *   FIX-2 positive(/object/list·sign 재시도 편입) 는 P2 잠복 → 별건. 본 spec 은 그 음성-안전만 가드.
 *
 * project=unit (순수 fs-grep 정적 단언 — auth/DB/server 불요·결정론). db_change=false.
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

const CHART = 'pages/CustomerChartPage.tsx';

test.describe('PHOTOUP-CAPTURE-DISCARD-ON-FAIL — FIX-1 유실0 구조 불변식', () => {
  test('uploadCaptured 함수 본문 추출', () => {
    const body = funcBody(read(CHART), 'const uploadCaptured =', 0);
    expect(body, 'uploadCaptured anchor 없음').not.toBeNull();
  });

  // ── DoD-3 / RC-A 핵심: 실패분을 remaining 으로 보존(폐기 금지) ──────────────
  test('DoD-3: 실패분은 remaining 에 보존하고 previewUrl 을 revoke 하지 않는다', () => {
    const body = funcBody(read(CHART), 'const uploadCaptured =', 0)!;
    // remaining 축적 배열 존재
    expect(body).toContain('const remaining');
    // 실패(error)일 때 remaining.push(item) — 실패분 보존
    expect(body).toMatch(/if\s*\(\s*error\s*\)\s*\{[^}]*remaining\.push\(item\)/);
    // 성공(else)일 때만 previewUrl revoke — 성공분만 소비
    expect(body).toMatch(/else\s*\{\s*URL\.revokeObjectURL\(item\.previewUrl\)/);
  });

  // ── §4-② 함정: 루프 뒤 일괄 revoke 제거(남긴 blob 미리보기 파괴 방지) ────────
  test('§4-②: 루프 뒤 capturedBlobs 전체 일괄 revokeObjectURL 이 없다(함정 제거)', () => {
    const body = funcBody(read(CHART), 'const uploadCaptured =', 0)!;
    // 현행 함정 코드: capturedBlobs.forEach((b) => URL.revokeObjectURL(b.previewUrl))
    expect(body).not.toMatch(/capturedBlobs\.forEach\([^)]*revokeObjectURL/);
  });

  // ── DoD-1: 부분/전건 실패 시 카메라 유지(닫지 않음) + 실패분만 남김 ──────────
  test('DoD-1: remaining>0 이면 setCapturedBlobs(remaining) 만 하고 setCameraOpen(false)·stopStream 는 그 분기에서 호출하지 않는다', () => {
    const body = funcBody(read(CHART), 'const uploadCaptured =', 0)!;
    // 전건 성공 분기(remaining.length === 0) 에서만 닫힘 처리
    expect(body).toMatch(/remaining\.length\s*===\s*0/);
    // 실패 분기에서 실패분 보존
    expect(body).toContain('setCapturedBlobs(remaining)');
    // else(실패) 분기 텍스트를 분리해 setCameraOpen(false)/stopStream 미포함 확인
    const elseIdx = body.indexOf('setCapturedBlobs(remaining)');
    const elseBlock = body.slice(elseIdx);
    expect(elseBlock).not.toContain('setCameraOpen(false)');
    expect(elseBlock).not.toContain('stopStream()');
  });

  // ── DoD-2 / DoD-4: 전건 성공 경로는 현행 정리·모달 닫힘 유지 ──────────────
  test('DoD-2·4: remaining===0 분기는 stopStream·setCapturedBlobs([])·setCameraOpen(false) 로 정리한다', () => {
    const body = funcBody(read(CHART), 'const uploadCaptured =', 0)!;
    const okIdx = body.indexOf('remaining.length === 0');
    // 성공 분기 ~ else 전까지 슬라이스
    const elseAt = body.indexOf('} else {', okIdx);
    const okBlock = body.slice(okIdx, elseAt > 0 ? elseAt : undefined);
    expect(okBlock).toContain('stopStream()');
    expect(okBlock).toContain('setCapturedBlobs([])');
    expect(okBlock).toContain('setCameraOpen(false)');
  });

  test('DoD-4: 전건 성공 완료 토스트(N장 저장 완료) 유지 + 재촬영 지시 문구 제거', () => {
    const body = funcBody(read(CHART), 'const uploadCaptured =', 0)!;
    expect(body).toMatch(/failed\s*===\s*0.*저장 완료/s);
    // 재촬영 지시 금지(§5): "다시 촬영" 문구가 uploadCaptured 안에 없어야 한다
    expect(body).not.toContain('다시 촬영');
    // 재시도 안내 토스트 존재
    expect(body).toContain('사진은 그대로 있습니다');
  });

  // ── DoD-5: 08-19 P0 불변식 — finally { setUploadProgress(null) } 보존 ────────
  test('DoD-5: finally 블록에서 setUploadProgress(null) 해제 유지(08-19 P0 회귀 0)', () => {
    const body = funcBody(read(CHART), 'const uploadCaptured =', 0)!;
    const fi = body.indexOf('finally');
    expect(fi, 'finally 블록 없음').toBeGreaterThan(-1);
    expect(body.indexOf('setUploadProgress(null)', fi)).toBeGreaterThan(-1);
  });

  // ── 완료 버튼: 신설 없이 기존 배선 재사용 + 라벨만 재시도 전환 ──────────────
  test('완료 버튼 라벨: lastUploadFailed 이면 재시도, 아니면 완료 (기존 uploadCaptured 배선 유지)', () => {
    const src = read(CHART);
    expect(src).toMatch(/lastUploadFailed\s*\?\s*'재시도'\s*:\s*'완료'/);
    // 기존 완료 버튼 onClick 이 uploadCaptured 그대로(자동 재시도로 동작)
    expect(src).toMatch(/onClick=\{uploadCaptured\}/);
    // lastUploadFailed 상태 선언 존재
    expect(src).toContain('const [lastUploadFailed, setLastUploadFailed]');
  });

  test('closeCamera(취소)는 lastUploadFailed 를 리셋한다(다음 세션 완료 라벨 복원)', () => {
    const body = funcBody(read(CHART), 'const closeCamera =', 0)!;
    expect(body).toContain('setLastUploadFailed(false)');
  });
});

test.describe('PHOTOUP-CAPTURE-DISCARD-ON-FAIL — DoD-6 음성-안전(부수효과 write 재시도 금지)', () => {
  // FIX-2(/object/list·sign 재시도 편입) 는 P2 잠복·별건.
  // 본 spec 은 그 안전 불변식만 봉인: 부수효과 있는 storage write 는 어떤 화이트리스트에도 없어야 한다.
  test('resilientFetch: /object/upload·remove·move·copy 재시도 화이트리스트 부재(부수효과 write 재시도 금지)', () => {
    const src = read('lib/resilience/resilientFetch.ts');
    for (const op of ['/object/upload', '/object/remove', '/object/move', '/object/copy']) {
      expect(src, `부수효과 write ${op} 가 재시도 대상에 편입되면 중복쓰기 위험`).not.toContain(op);
    }
  });

  test('refresh401.isSafeMethod 시그니처 불변(순수 코어는 URL 비의존)', () => {
    const src = read('lib/resilience/refresh401.ts');
    // isSafeMethod 는 method: string 단일 인자 유지(FIX-2 시에도 확장은 resilientFetch 층)
    expect(src).toMatch(/export function isSafeMethod\(method:\s*string\)/);
  });
});
