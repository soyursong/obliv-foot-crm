/**
 * T-20260703-foot-STAFFPHOTO-CHART-LINK — 직원촬영 발 임상사진 차트연동 (DB/RLS/Storage 계약 검증)
 *
 * ★본 spec 은 마이그레이션 20260703170000_foot_treatment_photos_staff_capture.sql 적용 후 상태를 검증한다.
 *   (supervisor DDL-diff PHI DB-GATE 통과 → apply → 본 spec = 수용 게이트)
 *
 * 시나리오(티켓 1~3):
 *   S1. 스키마 계약: treatment_photos 테이블 존재/쿼리가능 + private 'treatment-photos' 버킷(public=false).
 *   S2. private 버킷 무인증 차단: anon 클라이언트가 테이블 SELECT(RLS)·object download 모두 차단.
 *   S3. soft-delete: deleted_at set 후 live-query(deleted_at IS NULL) 제외 + row/object 물리 보존(하드삭제 아님).
 *
 * 정리(cleanup): 본 spec 이 만든 테스트 row/object 는 service_role 로 물리 제거(테스트 픽스처 한정).
 *   운영 데이터는 절대 손대지 않는다(source='staff_capture' + note='E2E-STAFFPHOTO-TEST' 태깅으로 격리).
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY!;
const BUCKET = 'treatment-photos';
const TEST_TAG = 'E2E-STAFFPHOTO-TEST';

const service = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const anon = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// 테스트 픽스처 상태 (S3 → cleanup 공유)
let seededRowId: string | null = null;
let seededPath: string | null = null;

test.afterAll(async () => {
  // 물리 제거는 테스트 픽스처(TEST_TAG)에 한정 — service_role 이라 RLS 우회 가능하나 태그로 이중 안전.
  if (seededPath) {
    await service.storage.from(BUCKET).remove([seededPath]).catch(() => {});
  }
  await service.from('treatment_photos').delete().eq('note', TEST_TAG);
});

test.describe('T-20260703-foot-STAFFPHOTO-CHART-LINK', () => {
  // ── S1. 스키마 계약 ──────────────────────────────────────────────
  test('S1-a. treatment_photos 테이블이 존재하고 쿼리 가능', async () => {
    const { error } = await service.from('treatment_photos').select('id').limit(1);
    expect(error).toBeNull();
  });

  test('S1-b. treatment-photos 버킷이 존재하고 private(public=false)', async () => {
    const { data, error } = await service.storage.getBucket(BUCKET);
    expect(error).toBeNull();
    expect(data?.public).toBe(false);
  });

  test('S1-c. 직원촬영 구분 컬럼(source/photo_category) + soft-delete 컬럼(deleted_at) 존재', async () => {
    // select 로 컬럼 존재 확인(없으면 PostgREST 가 컬럼 에러 반환)
    const { error } = await service
      .from('treatment_photos')
      .select('id, source, photo_category, storage_bucket, deleted_at, check_in_id, clinic_id, customer_id')
      .limit(1);
    expect(error).toBeNull();
  });

  // ── 픽스처 준비: 기존 clinic/customer 1건 참조 ──────────────────
  test('S0. 시드: 기존 clinic/customer 로 임상사진 row + object 생성', async () => {
    const { data: cust } = await service
      .from('customers')
      .select('id, clinic_id')
      .limit(1)
      .maybeSingle();
    test.skip(!cust, '테스트 대상 customer 가 없어 soft-delete/anon 시나리오를 건너뜁니다.');

    const clinicId = cust!.clinic_id as string;
    const customerId = cust!.id as string;
    const objPath = `${clinicId}/${customerId}/e2e-${Date.now()}.txt`;

    // object 업로드(이미지 대체 — 계약 검증엔 바이트 내용 무관)
    const up = await service.storage
      .from(BUCKET)
      .upload(objPath, new Blob(['e2e'], { type: 'text/plain' }), { upsert: true });
    expect(up.error).toBeNull();
    seededPath = objPath;

    const { data: row, error: insErr } = await service
      .from('treatment_photos')
      .insert({
        customer_id: customerId,
        clinic_id: clinicId,
        photo_url: objPath,
        photo_type: 'progress',
        source: 'staff_capture',
        note: TEST_TAG,
      })
      .select('id')
      .single();
    expect(insErr).toBeNull();
    seededRowId = row!.id as string;
  });

  // ── S2. private 버킷/테이블 무인증 차단 ──────────────────────────
  test('S2-a. anon 클라이언트는 treatment_photos SELECT 가 RLS 로 차단(0행)', async () => {
    test.skip(!seededRowId, '시드 미생성');
    const { data, error } = await anon.from('treatment_photos').select('id');
    // RLS: authenticated-only read → anon 은 에러 또는 빈 결과. 시드된 row 가 노출되면 실패.
    const ids = (data ?? []).map((r) => (r as { id: string }).id);
    expect(ids).not.toContain(seededRowId);
    if (error) expect(error).toBeTruthy(); // 에러여도 통과(차단됨)
  });

  test('S2-b. anon 클라이언트는 private object download 차단', async () => {
    test.skip(!seededPath, '시드 미생성');
    const { data, error } = await anon.storage.from(BUCKET).download(seededPath!);
    // private 버킷 + anon 정책 없음 → 다운로드 실패(에러) 또는 data 없음.
    expect(!!error || !data).toBeTruthy();
  });

  // ── S3. soft-delete ─────────────────────────────────────────────
  test('S3-a. deleted_at set 후 live-query(deleted_at IS NULL) 에서 제외', async () => {
    test.skip(!seededRowId, '시드 미생성');
    const del = await service
      .from('treatment_photos')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', seededRowId!);
    expect(del.error).toBeNull();

    const { data: live } = await service
      .from('treatment_photos')
      .select('id')
      .is('deleted_at', null)
      .eq('id', seededRowId!);
    expect((live ?? []).length).toBe(0);
  });

  test('S3-b. soft-delete 후에도 row 물리 보존(하드삭제 아님)', async () => {
    test.skip(!seededRowId, '시드 미생성');
    const { data: still } = await service
      .from('treatment_photos')
      .select('id, deleted_at')
      .eq('id', seededRowId!)
      .maybeSingle();
    expect(still).toBeTruthy();
    expect(still?.deleted_at).toBeTruthy();
  });

  test('S3-c. soft-delete 후에도 Storage object 물리 보존(의료법 §22)', async () => {
    test.skip(!seededPath, '시드 미생성');
    // service_role 로 다운로드 가능해야 함(object 가 아직 존재).
    const { data, error } = await service.storage.from(BUCKET).download(seededPath!);
    expect(error).toBeNull();
    expect(data).toBeTruthy();
  });

  // ── S4. FE 배치 회귀 가드 (원장 진료차트 연동) ─────────────────────
  //   supervisor QA phase1 FAIL 재발 방지: TreatmentPhotoGallery 가 정의만 되고
  //   어느 화면에도 연결되지 않으면(=orphan) 요구사항(원장 차트 조회) 미충족.
  //   MedicalChartPanel(진료차트) 이 갤러리를 import 하고 readOnly 원장 조회 탭으로
  //   실제 렌더하는지 소스 계약을 결정적으로 검증한다(재-orphan 차단).
  test.describe('S4. FE 배치 회귀 가드', () => {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const chartPath = resolve(__dirname, '../../src/components/MedicalChartPanel.tsx');
    const chartSrc = readFileSync(chartPath, 'utf8');

    test('S4-a. 진료차트가 TreatmentPhotoGallery 를 import', () => {
      expect(chartSrc).toMatch(/import\s+TreatmentPhotoGallery\s+from\s+['"]@\/components\/TreatmentPhotoGallery['"]/);
    });

    test('S4-b. 임상사진 탭 키/라벨이 우측 패널에 등록', () => {
      expect(chartSrc).toContain("key: 'clinical_photos'");
      expect(chartSrc).toContain("label: '임상사진'");
    });

    test('S4-c. 원장 조회 = readOnly 로 렌더(촬영/삭제 비노출)', () => {
      // clinical_photos 탭 콘텐츠 블록에서 <TreatmentPhotoGallery ... readOnly /> 렌더 확인
      const block = chartSrc.slice(chartSrc.indexOf("rightTab === 'clinical_photos'"));
      expect(block).toMatch(/<TreatmentPhotoGallery[\s\S]*?readOnly[\s\S]*?\/>/);
      expect(block).toMatch(/customerId=\{customerId\}/);
      expect(block).toMatch(/clinicId=\{clinicId\}/);
    });
  });
});
