-- T-20260731-foot-FIRSTVISIT-MGMTRECORD-PHOTO-2SLOT-LR — 초진 관리기록지 작성 화면 발 사진 2슬롯(오른발/왼발)
--
-- ★정본 근거: data-architect CONSULT-REPLY MSG-20260731-175752-j08x.
--   SSOT=da_consult_reply_foot_firstvisit_mgmtrecord_photo_2slot_20260731.md.
--   판정: Option A GO(treatment_photos 재사용) / Option B REJECT(신규 전용테이블·form_submissions 부모 = orphan 함정).
--   결정축=이 사진의 진짜 부모 grain. 초진 방문 발 baseline 임상사진 = treatment_photos semantic 그 자체
--   (staff-capture·check_in 결속·편측). treatment_photos 는 이미 check_in_id FK 로 진짜 부모에 결속 → A는 grain이 이미 맞다.
--   대표 게이트 EXEMPT(§3.1 minor-ADDITIVE) → supervisor PHI DB-GATE(DDL-diff)만.
--
-- ★선결확인 실측(2026-07-31, mgmt API introspection):
--   · treatment_photos.source 존재 (CHECK: staff_capture/patient_upload/import/legacy_string_array) → 값집합 ADDITIVE 확장.
--   · treatment_photos.photo_category 존재(free-form). · foot_side 부재 → 신규 ADD. · deleted_at·check_in_id FK 존재.
--   · 버킷 treatment-photos public=false 확인. → 버킷/RLS/CASCADE 전부 상속(신설 0).
--
-- DA 확정 스키마 (semantic firewall — 3직교축·오버로드 금지):
--   (1) foot_side  = 어느 발(L/R, canonical, 편측 유일 authoritative). health_q_photos.foot_side 와 글자그대로 동일 계약.
--   (2) body_part  = 일반 비-편측 자유부위. 여기에 L/R laterality 인코딩 금지(2슬롯 행은 body_part 를 laterality 로 안 씀).
--   (3) source     = 어느 폼 소속(=폼 판별자). 신규값 'first_visit_mgmt_record'.
--
--   ① source CHECK 값집합 ADDITIVE 확장(신규값 'first_visit_mgmt_record'). 기존 4값 전부 유지 → 기존행 회귀0.
--   ② foot_side TEXT NULL CHECK (foot_side IS NULL OR foot_side IN ('L','R')).
--      매핑 pin: 오른발=Right='R' / 왼발=Left='L' (FE 슬롯라벨→값 상수 고정, swap 금지). 대문자 canonical.
--      NULL 허용 필수: 기존/generic 무-side 업로드 = NULL → ADDITIVE·회귀0. 2-slot 경로만 L/R set.
--   ③ (RECOMMENDED-OPTIONAL, 채택) 슬롯당 1장 DB 강제: partial UNIQUE INDEX (check_in_id, source, foot_side)
--      WHERE foot_side IS NOT NULL AND deleted_at IS NULL.
--      ★키에 source 필수 — INITCHART 등 형제폼이 동일 check_in 에 또 좌/우 담아도 (check_in_id, foot_side)만으론
--       폼간 'R' 충돌 → source 포함으로 폼별 격리. NULL(generic/legacy) 다건 무영향(partial) → 무충돌·ADDITIVE-safe.
--
-- 재조회(AC#4) = treatment_photos WHERE check_in_id=? AND source='first_visit_mgmt_record' AND deleted_at IS NULL.
--   사진은 treatment_photos authoritative → form_submissions JSONB 에 사진 안 넣음.
--
-- PHI/cross-CRM: foot_side = 비-PHI laterality 라벨(질문지·기록지 응답값/산식/매출/큐카드 downstream 무접점).
--   §2-23 PHI-image 우산·버킷(treatment-photos)/RLS/CASCADE(check_in ON DELETE SET NULL·soft-delete) 계약 무변.
--   treatment_photos = foot-로컬 신설(cross-CRM registry 미등재, derm 동명 테이블과 물리 분리) → 저촉0.
--
-- 게이트: GO+ADDITIVE → supervisor DDL-diff만(대표 게이트 EXEMPT, autonomy §3.1).
-- ★재실행 안전: DROP CONSTRAINT IF EXISTS + ADD / ADD COLUMN IF NOT EXISTS + CREATE UNIQUE INDEX IF NOT EXISTS.
--   데이터 mutation 0 (DDL only). 기존행 백필 불요(foot_side default NULL → 회귀0).
-- 롤백: 20260731210000_foot_treatment_photos_firstvisit_2slot.rollback.sql

BEGIN;

-- ────────────────────────────────────────────────────────────────
-- 1) source CHECK 값집합 ADDITIVE 확장 — 신규값 'first_visit_mgmt_record'.
--    기존 4값 전부 유지(ADDITIVE) → 기존행 전건 통과·회귀0. DROP IF EXISTS + ADD = 재실행 안전.
-- ────────────────────────────────────────────────────────────────
ALTER TABLE public.treatment_photos DROP CONSTRAINT IF EXISTS treatment_photos_source_check;
ALTER TABLE public.treatment_photos ADD CONSTRAINT treatment_photos_source_check
  CHECK (source IN ('staff_capture','patient_upload','import','legacy_string_array','first_visit_mgmt_record'));

-- ────────────────────────────────────────────────────────────────
-- 2) foot_side 컬럼 (nullable + CHECK L/R). 기존행 default NULL(백필 불요·회귀0).
--    = health_q_photos.foot_side 와 동일 계약(laterality cross-CRM canonical 2번째 인스턴스).
-- ────────────────────────────────────────────────────────────────
ALTER TABLE public.treatment_photos
  ADD COLUMN IF NOT EXISTS foot_side TEXT NULL
  CHECK (foot_side IS NULL OR foot_side IN ('L','R'));

COMMENT ON COLUMN public.treatment_photos.foot_side IS
  'T-20260731-foot-FIRSTVISIT-MGMTRECORD-PHOTO-2SLOT: 발 좌/우 laterality (오른발=R, 왼발=L). NULL=무구분(generic/legacy). 비-PHI 라벨. cross-CRM canonical 대문자 L/R.';

-- ────────────────────────────────────────────────────────────────
-- 3) (OPT, DA RECOMMENDED) 슬롯당 1장 DB 강제 — partial unique.
--    키 = (check_in_id, source, foot_side) WHERE foot_side NOT NULL AND deleted_at IS NULL.
--    ★source 필수: 형제폼(INITCHART 등)이 동일 check_in 에 또 좌/우 담아도 폼별 격리(폼간 'R' 충돌 방지).
--    NULL(generic/legacy) 다건 무영향 + soft-delete 된 행 제외 → 무충돌·ADDITIVE-safe.
-- ────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_treatment_photos_checkin_source_side
  ON public.treatment_photos (check_in_id, source, foot_side)
  WHERE foot_side IS NOT NULL AND deleted_at IS NULL;

COMMIT;
