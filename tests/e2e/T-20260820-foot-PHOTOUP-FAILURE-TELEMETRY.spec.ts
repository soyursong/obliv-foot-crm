/**
 * E2E / static-regression spec — T-20260820-foot-PHOTOUP-FAILURE-TELEMETRY
 *
 * RC 판정서 FIX-C: storage.upload 실패의 원인을 PHI-free 로 계측하는 photo_upload_failures 신설 +
 * FE 공용 헬퍼(logPhotoUploadFailure) + 핵심 사진 업로드 4경로 배선.
 *
 * ★ 배포 게이트(deploy_hold=true·db_change=true·prod apply=GO-token 대기)로 live-DB 왕복 E2E 불가.
 *   → 본 spec 은 (1) 헬퍼 PHI-free 로직 회귀가드 + (2) 마이그레이션 불변식 + (3) 4경로 배선 정적가드.
 *   DoD-1(실제 실패 1건 적재)·DoD-2(PHI-free 실증)는 apply 후 주입테스트 evidence 로 별도 캡처.
 *
 * 시나리오 1 (logic): derivePathPrefix — full path 의 1st 세그먼트까지만(customer_id 절삭) PHI-free.
 * 시나리오 2 (migration static): 테이블 컬럼 PHI-free + RLS(insert/select/anon-deny) + REVOKE anon.
 * 시나리오 3 (wiring static): 4경로(useTreatmentPhotos/useDocumentUpload/FirstVisitFootPhotoSlots/PenChartAttachPanel).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const rd = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

const MIG = 'supabase/migrations/20260820140000_foot_photo_upload_failures_telemetry.sql';
const MIG_ROLLBACK = 'supabase/migrations/20260820140000_foot_photo_upload_failures_telemetry.rollback.sql';
const MIG_DRYRUN = 'supabase/migrations/20260820140000_foot_photo_upload_failures_telemetry.dryrun.sql';
const HELPER = 'src/lib/photoUploadTelemetry.ts';

// ── 시나리오 1: derivePathPrefix PHI-free 로직 (헬퍼 소스에서 실제 규칙 검증) ────────────
// 헬퍼는 supabase 클라이언트에 의존(경로 alias) → node 직접 import 대신, 동일 규칙을 재현해
// 실제 소스가 "1st 세그먼트만 남기는" 규칙을 유지하는지 회귀가드한다.
function derivePathPrefixMirror(bucket: string, path?: string | null): string {
  if (!path) return bucket;
  const first = path.replace(/^\/+/, '').split('/')[0] ?? '';
  return first ? `${bucket}/${first}` : bucket;
}

test.describe('T-20260820-foot-PHOTOUP-FAILURE-TELEMETRY', () => {
  test('시나리오1: path_prefix 는 버킷/폴더 수준까지만 (customer_id·파일명 절삭·PHI-free)', () => {
    // treatment-photos: {clinic_id}/{customer_id}/{uuid}.jpg → treatment-photos/{clinic_id} (customer_id 절삭)
    expect(derivePathPrefixMirror('treatment-photos', 'clinic-abc/cust-XYZ/uuid-1.jpg'))
      .toBe('treatment-photos/clinic-abc');
    // documents: customer/{customer_id}/... → documents/customer (정적 폴더만)
    expect(derivePathPrefixMirror('documents', 'customer/cust-XYZ/consent_123.pdf'))
      .toBe('documents/customer');
    // 절삭 결과에 하위(환자 식별) 세그먼트가 포함되면 안 됨
    const prefix = derivePathPrefixMirror('treatment-photos', 'clinic-abc/cust-SECRET/uuid.jpg');
    expect(prefix).not.toContain('cust-SECRET');
    // path 없음 → 버킷명만
    expect(derivePathPrefixMirror('message-images', null)).toBe('message-images');

    // 실제 헬퍼 소스가 동일 "split('/')[0]" 규칙을 유지하는지 회귀가드
    const helper = rd(HELPER);
    expect(helper).toContain("split('/')[0]");
    expect(helper).toContain('export function derivePathPrefix');
  });

  test('시나리오1b: 헬퍼는 raw message 미적재 + non-fatal(throw 안 함)', () => {
    const helper = rd(HELPER);
    // error_code 추출은 name/code/statusCode 만 — .message 를 적재축으로 쓰지 않는다(경로/PHI 누수 방어)
    expect(helper).not.toMatch(/error_code:\s*[^\n]*\.message/);
    // insert row 객체에 message/customer_id/원본 path 를 담지 않음
    expect(helper).not.toMatch(/customer_id\s*:/);
    // non-fatal: insert 를 try/catch 로 감싸 삼킨다
    expect(helper).toMatch(/try\s*{[\s\S]*photo_upload_failures[\s\S]*}\s*catch/);
    expect(helper).toContain("from('photo_upload_failures').insert");
  });

  test('시나리오2: 마이그레이션 — 테이블 PHI-free + RLS + anon 봉인 + 가역', () => {
    const mig = rd(MIG);
    // 신규 테이블 (ADDITIVE)
    expect(mig).toContain('CREATE TABLE IF NOT EXISTS public.photo_upload_failures');
    // 계측 6필드 존재
    for (const col of ['created_at', 'path_prefix', 'file_size_bytes', 'http_status', 'duration_ms', 'retry_attempt']) {
      expect(mig).toContain(col);
    }
    // PHI/식별 컬럼 부재 (스키마에 환자 식별자 없음)
    for (const phi of ['customer_id', 'patient_id', 'customer_name', 'chart_number', 'original_filename', 'file_name']) {
      expect(mig).not.toMatch(new RegExp(`^\\s*${phi}\\s`, 'm'));
    }
    // RLS enable + 3정책 + anon-deny RESTRICTIVE
    expect(mig).toContain('ENABLE ROW LEVEL SECURITY');
    expect(mig).toContain('photo_upload_failures_insert');
    expect(mig).toContain('photo_upload_failures_select');
    expect(mig).toMatch(/photo_upload_failures_anon_deny[\s\S]*AS RESTRICTIVE FOR ALL TO anon/);
    // write=스태프 인증만: anon REVOKE + authenticated GRANT
    expect(mig).toContain('REVOKE ALL ON public.photo_upload_failures FROM anon');
    expect(mig).toContain('GRANT SELECT, INSERT ON public.photo_upload_failures TO authenticated');
    // 트랜잭션 + 검증
    expect(mig).toContain('BEGIN;');
    expect(mig).toContain('COMMIT;');
    expect(mig).toContain('VERIFY_FAIL');
  });

  test('시나리오2b: 롤백/드라이런 존재 + 무영속(BEGIN..ROLLBACK)', () => {
    const rollback = rd(MIG_ROLLBACK);
    expect(rollback).toContain('DROP TABLE IF EXISTS public.photo_upload_failures');
    const dryrun = rd(MIG_DRYRUN);
    expect(dryrun).toContain('ROLLBACK;');
    expect(dryrun).not.toContain('COMMIT;'); // 무영속 보장 (No-Persistence Protocol)
    expect(dryrun).toContain('DRYRUN-FAIL');
    // dryrun PHI-free 스키마 가드
    expect(dryrun).toMatch(/PHI[\s\S]*column_name IN \(/);
  });

  test('시나리오3: 4개 사진 업로드 경로에 실패 계측 배선', () => {
    const sites = [
      'src/hooks/useTreatmentPhotos.ts',
      'src/hooks/useDocumentUpload.ts',
      'src/components/FirstVisitFootPhotoSlots.tsx',
      'src/components/PenChartAttachPanel.tsx',
    ];
    for (const s of sites) {
      const src = rd(s);
      expect(src, `${s} imports helper`).toContain("from '@/lib/photoUploadTelemetry'");
      expect(src, `${s} calls logPhotoUploadFailure`).toContain('logPhotoUploadFailure(');
    }
  });
});
