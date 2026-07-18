/**
 * E2E spec: T-20260718-foot-STORAGE-EGRESS-THUMBNAIL-TRANSFORM
 * 펜차트/차트 사진 원본 반복다운로드 → transform 썸네일 + cacheControl 전환 (Egress 최대 원인 절감)
 *
 * [배경] 조직 전체 Supabase Egress 455% 초과(1,138GB/250GB) 사고의 최대 원인 =
 *   crm-obliv-foot 펜차트·차트 화면이 photos 버킷 원본(장당 평균 780KB, 2,355장/1.8GB)을
 *   그리드/목록 렌더마다 원본 그대로 반복 다운로드. Image Transformation 0/100(미사용).
 *
 * AC-1 (썸네일): 그리드/목록 <img> 는 transform(width/quality) 썸네일 URL 로 서빙 — 원본 픽셀 다운로드 금지.
 * AC-2 (cacheControl): 신규 업로드 경로에 cacheControl 부여(브라우저/CDN 캐시 창).
 * AC-3 (원본은 확대 시): 원본 signed URL 은 확대/열기/편집/다운로드 시점에만 발급.
 * AC-4 (list 감축): 목록 list 호출은 마운트당 1회(렌더마다 재호출 루프 없음) — 확인.
 * AC-5 (교차도메인 관측): derm/body 동일 패턴은 dev-foot 관측→planner 파생 티켓(본 티켓 직접 수정 금지).
 *
 * 인증 우회 불가(로그인 게이트) → 그리드 렌더 실측은 현장 클릭 시나리오(하단)로 검증하고,
 * 여기서는 서빙 전략(썸네일/원본 분리·cacheControl·URL 캐시)을 정적 코드로 회귀 락한다.
 * ⚠ Egress 402 우산: 라이브 렌더 확인은 빌링 리셋(7/19) 이후 또는 spend cap 해제 상태에서 수행.
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const read = (rel: string) => fs.readFileSync(path.join(__dirname, '../../', rel), 'utf8');

test.describe('STORAGE-EGRESS-THUMBNAIL-TRANSFORM: 사진 서빙 최적화', () => {
  // 앱 정상 로드 (빌드/런타임 회귀 없음)
  test('앱 정상 로드 — HTTP 200', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);
  });

  // 공용 유틸 존재 + 3축 API 노출
  test('photoUrl 공용 유틸 — 썸네일/원본/cacheControl/캐시 API 노출', () => {
    const u = read('src/lib/photoUrl.ts');
    // AC-1: 썸네일 발급 API (transform width/quality)
    expect(u).toContain('export function signedThumbUrl');
    expect(u).toContain('export function signedThumbUrls');
    expect(u).toMatch(/PHOTO_THUMB[^\n]*width/);
    expect(u).toContain('transform');
    // AC-3: 원본 발급 API (확대/편집/다운로드 전용)
    expect(u).toContain('export function signedOriginalUrl');
    // AC-2: 업로드 cacheControl
    expect(u).toContain('UPLOAD_CACHE_CONTROL');
    expect(u).toContain('PHOTO_UPLOAD_OPTS');
    expect(u).toContain('cacheControl');
    // URL 안정화 캐시(브라우저 캐시 HIT + 재서명 감축) + 교체 무효화
    expect(u).toContain('export function invalidatePhotoPath');
  });

  // AC-1/3: 고객차트 사진/영수증/치료이미지 그리드 = 썸네일, 확대 = 원본
  test('CustomerChartPage — 그리드 썸네일 + 원본은 클릭 lazy 발급', () => {
    const c = read('src/pages/CustomerChartPage.tsx');
    expect(c).toContain("from '@/lib/photoUrl'");
    // 그리드는 원본 signedUrls 배치 발급을 하지 않는다(썸네일 사용)
    expect(c).toContain('signedThumbUrls');
    // 원본은 클릭 시점에만 lazy 발급
    expect(c).toContain('openOriginalPhoto');
    expect(c).toContain('signedOriginalUrl');
    // 그리드 <img> 가 thumbUrl 을 쓰는지(원본 signedUrl 직접 렌더 아님)
    expect(c).toContain('src={img.thumbUrl}');
    // 업로드 cacheControl
    expect(c).toContain('PHOTO_UPLOAD_OPTS');
  });

  // AC-1/3: 펜차트 목록 프리뷰 = 썸네일, 편집·확대·다운로드 = 원본
  test('PenChartTab — 목록 썸네일(thumbUrl) + 편집/확대 원본(url)', () => {
    const p = read('src/components/PenChartTab.tsx');
    expect(p).toContain("from '@/lib/photoUrl'");
    expect(p).toContain('signedThumbUrls');
    expect(p).toContain('signedOriginalUrl');
    // 목록 <img> 는 thumbUrl (원본 A4 PNG 반복 다운로드 제거)
    expect(p).toContain('src={chart.thumbUrl}');
    // 편집(덮어쓰기) 시 stale 캐시 무효화
    expect(p).toContain('invalidatePhotoPath');
    expect(p).toContain('PHOTO_UPLOAD_OPTS');
  });

  // AC-1/3: 실손보험 문서 그리드 = 썸네일(이미지) / PDF 등은 원본 폴백
  test('InsuranceDocPanel — 이미지 썸네일 + 비이미지 원본 폴백', () => {
    const i = read('src/components/InsuranceDocPanel.tsx');
    expect(i).toContain("from '@/lib/photoUrl'");
    expect(i).toContain('signedThumbUrl');
    // PDF 등 transform 불가 파일은 원본 폴백
    expect(i).toContain('IMG_EXT');
    expect(i).toContain('src={img.thumbUrl}');
    expect(i).toContain('PHOTO_UPLOAD_OPTS');
  });

  // AC-1/3: 체크인 상세 시트 치료이미지 그리드 = 썸네일, 확대 = 원본
  test('CheckInDetailSheet — Chart1 치료이미지 그리드 썸네일 + 확대 원본', () => {
    const s = read('src/components/CheckInDetailSheet.tsx');
    expect(s).toContain("from '@/lib/photoUrl'");
    expect(s).toContain('signedThumbUrl');
    expect(s).toContain('signedOriginalUrl');
    // 그리드 <img> 썸네일, 클릭 확대는 원본
    expect(s).toContain('src={img.thumbUrl || img.signedUrl}');
    expect(s).toContain('PHOTO_UPLOAD_OPTS');
  });

  // §11 gate 회귀 락: 의사 전용 진료관리(MedicalChartPanel) 는 medical_confirm_gate 없이 미수정.
  // 본 티켓 frontmatter 에 게이트 필드 없음 → 진료관리/진료대시보드 사진경로는 손대지 않았다.
  test('§11 gate — 진료관리(MedicalChartPanel) 사진경로는 본 티켓에서 미수정', () => {
    const m = read('src/components/MedicalChartPanel.tsx');
    // MedicalChartPanel 은 photoUrl 유틸을 도입하지 않는다(게이트 대상, 별도 컨펌 티켓 필요).
    expect(m).not.toContain("from '@/lib/photoUrl'");
  });
});

/**
 * 현장 클릭 시나리오 (수동/라이브 검증용 — 빌링 리셋 7/19 이후 또는 spend cap 해제 상태에서):
 *
 * [시나리오1] 정상 동선 (썸네일 → 원본)
 *   1. 로그인 → foot CRM admin
 *   2. 환자 차트 열기 → 사진/치료이미지 섹션
 *   3. 그리드에 사진 썸네일이 빠르게 표시됨 확인 (작게 줄인 미리보기, 수십 KB)
 *   4. 사진 한 장 클릭 → 원본(고화질) 새 창/확대 표시 확인
 *   5. 목록으로 돌아가 다른 사진 스크롤 → 썸네일만 로드(원본 재다운로드 없음) 확인
 *   6. 펜차트 탭 → 저장된 차트 목록 프리뷰(썸네일) 표시, 편집 진입 시 원본 배경 로드 확인
 *
 * [시나리오2] 엣지 케이스
 *   1. 사진 없는 환자 차트 → 빈 상태 정상 표시(에러 없음)
 *   2. 신규 사진 업로드 → 업로드 후 즉시 썸네일 표시 + cacheControl 부여(네트워크 탭 Cache-Control 헤더)
 *   3. 사진 회전/펜차트 덮어쓰기 → 옛 이미지 재표시 없이 갱신본 표시(캐시 무효화)
 *
 * [계측] 7/19 빌링 리셋 후 대시보드 Usage > Egress 프로젝트별 breakdown 으로
 *        crm-obliv-foot 비중 감소 확인. Image Transformation 사용량이 0/100 에서 증가하는지 확인.
 */
