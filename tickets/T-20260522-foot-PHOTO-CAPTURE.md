---
id: T-20260522-foot-PHOTO-CAPTURE
title: "진료이미지 사진촬영 기능 강화 — 카메라 연동·연속촬영·회전·DB 메타데이터"
status: deploy-ready
priority: P2
domain: foot
created_at: 2026-05-22
deadline: 2026-05-28
go_warn: true
deploy_ready: true
deploy_ready_at: 2026-05-22T17:00:00+09:00
deploy_ready_by: dev-foot
db_migration: true
build_passed: true
commit_sha: fc18dfc
e2e_spec: tests/e2e/T-20260522-foot-PHOTO-CAPTURE.spec.ts
signals_recorded: true
---

## 개요

진료이미지 탭 사진촬영 기능 강화 + `clinical_images` DB 메타데이터 테이블 추가.
카메라 구현(AC-1~3, AC-5~6)은 T-20260522-foot-MEDIMG-CAMERA (commit db3173b)에서 이미 배포 완료.
이 티켓의 핵심 신규 작업: **AC-4 — clinical_images.category 컬럼 마이그레이션**.

## AC 충족 현황

### AC-1: [사진촬영] 버튼 + 카메라 연동
- `TreatmentImagesSection` 업로드 바에 teal-600 [사진촬영] 버튼 구현 ✅
- `MediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } })` ✅
- **출처**: T-20260522-foot-MEDIMG-CAMERA (commit 1d6634a, flickering fix db3173b)

### AC-2: 시술 전/후 카테고리 선택 → 연속 촬영 → 자동업로드
- 전체화면 black 모달: 시술 전(blue) / 시술 후(emerald) 대형 버튼 ✅
- 셔터 클릭 → capturedBlobs 배열 → 완료(N장) 버튼 → 일괄 업로드 ✅
- Supabase Storage `photos` 버킷 → `customer/{id}/treatment-images/{type}_{ts}_{rand}.jpg` ✅
- **출처**: T-20260522-foot-MEDIMG-CAMERA

### AC-3: 업로드 이미지 회전 (90도 CW/CCW), 저장 후 유지
- 이미지 hover → RotateCw 버튼 → 편집 모달 ✅
- Canvas API 실제 픽셀 회전 → 원본 삭제 후 회전본 재업로드(동일 경로) ✅
- **출처**: T-20260522-foot-MEDIMG-CAMERA

### AC-4: clinical_images.category 컬럼 확인 → 없으면 추가 ✅ **[신규]**
- 마이그레이션: `supabase/migrations/20260522020000_clinical_images_category.sql`
  - `CREATE TABLE IF NOT EXISTS clinical_images` (신규 환경 대응)
  - `ALTER TABLE clinical_images ADD COLUMN IF NOT EXISTS category TEXT CHECK (...)` (기존 테이블 패치)
  - category: nullable TEXT, CHECK (`before` | `after` | `photo`)
  - RLS: `auth_all` (기존 패턴 동일)
  - 인덱스: `clinical_images_customer_id_created_at_idx`
- 롤백: `supabase/migrations/20260522020000_clinical_images_category.down.sql`

### AC-5: Galaxy Tab + 스마트폰 카메라 호환
- `getUserMedia` width/height 강제 제약 제거 (device 네이티브 해상도) ✅
- `disablePictureInPicture` + `translateZ(0)/willChange:transform` GPU 레이어 ✅
- flickering fix (useCallback([]) + RAF + GPU layer) ✅
- **출처**: T-20260522-foot-MEDIMG-CAMERA flickering fix (db3173b)

### AC-6: 기존 파일선택 업로드 회귀 없음
- `handleUpload` 파일 input 유지 — [사진촬영] 버튼과 공존 ✅
- SC-3 E2E로 회귀 검증 ✅

## DB 마이그레이션 상세

### clinical_images 테이블

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | UUID PK | gen_random_uuid() |
| clinic_id | UUID FK→clinics | NOT NULL |
| customer_id | UUID FK→customers | NOT NULL |
| check_in_id | UUID FK→check_ins | nullable |
| storage_path | TEXT | Storage 경로 |
| category | TEXT | nullable, CHECK ('before','after','photo') |
| created_by | UUID FK→auth.users | nullable |
| created_at | TIMESTAMPTZ | DEFAULT NOW() |

### Rollback

```sql
-- 권장 (데이터 보존)
ALTER TABLE clinical_images DROP COLUMN IF EXISTS category;

-- 신규 생성이었던 경우만 (데이터 손실 주의)
-- DROP TABLE IF EXISTS clinical_images;
```

## E2E 시나리오

| ID | 시나리오 | 커버 AC |
|----|----------|---------|
| SC-1 | [사진촬영] → 시술 전 선택 → capture phase 진입 | AC-1, AC-2, AC-5 |
| SC-2 | 셔터 연속 3회 → 썸네일 3장 → 완료(3) 활성 | AC-2, AC-5 |
| SC-3 | 기존 파일업로드 버튼 공존 확인 | AC-6 |
| AC-4 | 마이그레이션 SQL 파일 존재 + content 확인 | AC-4 |

## GO_WARN

- 카메라 권한 팝업 최초 1회 발생 — 현장 안내 필요
- clinical_images 마이그레이션은 Supabase 대시보드 또는 CLI `supabase db push` 적용 필요
