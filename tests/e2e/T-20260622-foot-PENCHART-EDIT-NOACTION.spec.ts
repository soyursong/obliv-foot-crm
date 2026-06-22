/**
 * T-20260622-foot-PENCHART-EDIT-NOACTION
 * 펜차트 '수정' 버튼 클릭 시 실제 편집 미동작 — 369a2945 후속 버그 RC 수정 검증
 *
 * [근본원인 / AC-0 분기 확정 = (c) save-path via CORS taint, gate-free storage PNG]
 *   1. 리스트/미리보기 <img src={chart.url}> 가 signed URL 을 crossOrigin 없이 먼저 로드
 *      → 브라우저 HTTP 캐시에 non-CORS 응답 적재(캐시 오염).
 *   2. '수정' 클릭 → 배경 로더가 동일 URL 을 crossOrigin='anonymous' 로 재요청 → 갤탭 WebView 가
 *      오염 캐시를 재사용하면 bgCanvas 가 CORS-taint(화면엔 기존 내용이 보임 → 증상 b 는 정상처럼 보임).
 *   3. 저장 시 tempCanvas.drawImage(bgCanvas) → toDataURL() 이 SecurityError 를 던지는데
 *      handleDrawSave 에 catch 가 없어(try/finally) 업로드·목록갱신·모드복귀가 모두 스킵 + 토스트 없음
 *      → 사용자에겐 "수정이 안 됨"(편집 후 저장 무반응).
 *
 * [수정]
 *   FIX A: 수정 배경 로더가 editingChart.url 에 cb 쿼리를 덧붙여 캐시 키를 분리 → 항상 CORS-clean
 *          응답을 받아 taint 원천 차단(서명 URL 토큰엔 무영향).
 *   FIX B: 리스트/미리보기 <img> 에 crossOrigin='anonymous' → 캐시 오염 자체를 제거(배경 로더와 동일 파티션).
 *   FIX C: handleDrawSave 에 catch 추가 → 잔존 예외(SecurityError 등)를 토스트로 노출, silent-fail 제거.
 *
 * NOTE: 기존 penchart spec 관례(순수 로직 시뮬)를 따른다. 실기기 렌더/현장 confirm 은 supervisor field-soak.
 */
import { test, expect } from '@playwright/test';

// ── FIX A: 수정 배경 URL 캐시 키 분리 (CORS taint 차단) ───────────────────────
test.describe('EDIT-NOACTION FIX A: 수정 배경 로더 cache-bust', () => {

  // 코드(PenChartTab L1318~)의 editingChart 분기 bgUrl 결정 로직과 동일.
  const resolveEditBgUrl = (editingChartUrl: string, now: number) =>
    `${editingChartUrl}${editingChartUrl.includes('?') ? '&' : '?'}cb=edit${now}`;

  test('FIX A: 토큰 쿼리가 있는 서명 URL 에는 & 로 cb 를 덧붙인다', () => {
    const signed = 'https://x.supabase.co/storage/v1/object/sign/photos/c/p.png?token=abc';
    const bg = resolveEditBgUrl(signed, 1750000000000);
    expect(bg.startsWith(signed)).toBe(true);
    expect(bg).toContain('&cb=edit1750000000000');
    // 원 토큰은 보존(서명 검증 유지)
    expect(bg).toContain('token=abc');
  });

  test('FIX A: 쿼리 없는 URL 에는 ? 로 cb 를 덧붙인다', () => {
    const plain = 'https://x.supabase.co/photos/c/p.png';
    const bg = resolveEditBgUrl(plain, 1750000000001);
    expect(bg).toBe('https://x.supabase.co/photos/c/p.png?cb=edit1750000000001');
  });

  test('FIX A: 수정 배경 URL 은 리스트 <img> URL 과 캐시 키가 다르다 (오염 캐시 재사용 차단)', () => {
    const listImgUrl = 'https://x.supabase.co/object/sign/photos/c/p.png?token=abc';
    const editBgUrl = resolveEditBgUrl(listImgUrl, Date.now());
    // 두 URL 이 달라야 crossOrigin 캐시 파티션 충돌(non-CORS 재사용→taint)을 회피
    expect(editBgUrl).not.toBe(listImgUrl);
    expect(editBgUrl.length).toBeGreaterThan(listImgUrl.length);
  });
});

// ── FIX C: 저장 예외 → 사용자 토스트 노출 (silent-fail 제거) ───────────────────
test.describe('EDIT-NOACTION FIX C: handleDrawSave 예외 노출', () => {

  // 코드(PenChartTab catch 블록)의 메시지 분기와 동일.
  const buildSaveErrorMessage = (saveErr: unknown): string => {
    const isSecErr = saveErr instanceof Error && saveErr.name === 'SecurityError';
    return isSecErr
      ? '저장 실패: 배경 이미지 보안(CORS) 오류로 캔버스를 내보낼 수 없습니다. 화면 새로고침 후 다시 시도해주세요.'
      : `저장 실패: ${saveErr instanceof Error ? saveErr.message : '알 수 없는 오류'}`;
  };

  test('FIX C: SecurityError(canvas taint) → CORS 안내 토스트', () => {
    const secErr = new Error('Tainted canvases may not be exported.');
    secErr.name = 'SecurityError';
    const msg = buildSaveErrorMessage(secErr);
    expect(msg).toContain('보안(CORS)');
    expect(msg).toContain('새로고침');
  });

  test('FIX C: 일반 예외 → 메시지를 포함한 저장 실패 토스트', () => {
    const msg = buildSaveErrorMessage(new Error('network down'));
    expect(msg).toBe('저장 실패: network down');
  });

  test('FIX C: Error 가 아닌 throw → 알 수 없는 오류로 안전 폴백', () => {
    expect(buildSaveErrorMessage('boom')).toBe('저장 실패: 알 수 없는 오류');
    expect(buildSaveErrorMessage(undefined)).toBe('저장 실패: 알 수 없는 오류');
  });

  test('FIX C: 예외 발생 시에도 모든 경로가 토스트를 반환 (무반응=빈 메시지 금지)', () => {
    for (const e of [new Error('x'), 'str', null, undefined, 42]) {
      expect(buildSaveErrorMessage(e).length).toBeGreaterThan(0);
    }
  });
});

// ── 회귀: edit-save 는 form_submissions 를 건드리지 않는다 (supervisor DB게이트 불필요 근거) ──
test.describe('EDIT-NOACTION 회귀: edit-save 는 DB(form_submissions) 비관여', () => {
  test('수정 저장(editTarget 존재)은 form_submissions insert/UPDATE 경로를 타지 않는다', () => {
    // 코드: if ((isPC||isHQ||isPCL) && activeDrawTemplate && !editTarget) { ...insert }
    const willTouchFormSubmissions = (
      isFormType: boolean, hasTemplate: boolean, editTarget: object | null,
    ) => isFormType && hasTemplate && !editTarget;

    // 수정 저장은 form 양식이어도 DB 비관여 → 본 수정은 순수 FE/스토리지 = supervisor DB게이트 불필요
    expect(willTouchFormSubmissions(true, true, { name: 'hq_1_a.png' })).toBe(false);
    expect(willTouchFormSubmissions(true, true, { name: '1_a.png' })).toBe(false);
    // (신규 양식 저장만 insert — 본 티켓 범위 밖)
    expect(willTouchFormSubmissions(true, true, null)).toBe(true);
  });
});
