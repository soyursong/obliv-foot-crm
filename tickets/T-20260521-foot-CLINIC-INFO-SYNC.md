---
ticket_id: T-20260521-foot-CLINIC-INFO-SYNC
title: 병원정보 DB 동기화 + 서류 출력 데이터 바인딩 수정
status: deploy-ready
priority: P0
domain: foot
deploy_ready: true
db_changed: true
build_status: pass
e2e_spec: n/a
commit: 825d9be
created_at: 2026-05-21
completed_at: 2026-05-21
---

## 배경

김주연 총괄 현장 보고: 1번차트에서 서류 5종 전부 재출력했으나 이전 배포(PRINT-FORM-BIND 3cd5c8d) 적용 안 됨. 서류 출력 시 병원정보(병원명·전화·팩스·사업자번호) 전부 공백.

P2→P0 hotfix 승격 (MSG-20260521-200215-027r).

## 근본 원인 분석

### 문제 1 (핵심): DB 컬럼 누락
- `20260520120000_clinics_nhis_fax` migration이 DB schema_migrations에 미등록 상태
- `clinics.fax` / `clinics.nhis_code` 컬럼 부재
- DocumentPrintPanel.tsx의 clinics 쿼리 (`.select('name, address, phone, fax, nhis_code, ...')`) PostgREST 400 에러 반환
- `maybeSingle()` → `clinicData = null` → 모든 병원 바인딩 필드 빈 문자열

### 문제 2: 도장 이미지
- `src/assets/forms/stamps/jongno-foot-stamp.png` 이미 존재 ✅
- `getStampUrl()` 구현 완료 ✅ — 별도 조치 불필요

### 문제 3: 고객 정보 바인딩
- `customers` 테이블 필요 컬럼 (address, address_detail, birth_date, chart_number, gender) 모두 존재 ✅
- `rrn_decrypt` RPC 존재 ✅
- `customers_staff_select` RLS 정책 존재 ✅ (supervisor가 20260520000090 수동 적용)
- 바인딩 코드 로직 정상 — 데이터 부재가 아닌 clinic 쿼리 실패가 문제

### 추가 발견: formatPhone 서울번호 버그
- 기존: `02-6956-3438` → `026-956-3438` (잘못된 3-3-4 포맷)
- 수정: `02-6956-3438` → `02-6956-3438` (올바른 2-4-4 포맷)

## 적용 내용

### DB 변경 (supabase db query --linked 직접 실행)

```sql
-- 1. 컬럼 추가
ALTER TABLE clinics
  ADD COLUMN IF NOT EXISTS nhis_code TEXT,
  ADD COLUMN IF NOT EXISTS fax       TEXT;

-- 2. 병원 데이터 UPDATE
UPDATE clinics
SET name = '오블리브의원 서울 오리진점',
    phone = '02-6956-3438',
    fax = '02-6956-3439'
WHERE id = '74967aea-a60b-4da3-a0e7-9c997a930bc8';

-- 3. migration 이력 등록
INSERT INTO supabase_migrations.schema_migrations (version, name, created_by)
VALUES ('20260520120000', '20260520120000_clinics_nhis_fax', 'dev-foot-agent-p0-fix')
ON CONFLICT (version) DO NOTHING;
```

### DB 최종 상태 (검증 완료)

| 필드 | 값 |
|------|-----|
| name | 오블리브의원 서울 오리진점 |
| phone | 02-6956-3438 |
| fax | 02-6956-3439 |
| business_no | 511-60-00988 |
| nhis_code | NULL (추후 입력 필요) |

### 코드 변경

**`src/lib/format.ts`** — `formatPhone()` 서울(02) 지역번호 케이스 추가:
- 10자리 `02XXXXXXXX` → `02-XXXX-XXXX`
- 9자리 `02XXXXXXX` → `02-XXX-XXXX`

## AC 체크리스트

- [x] AC-1: clinics.fax / clinics.nhis_code 컬럼 추가 → 쿼리 성공
- [x] AC-2: clinic row fax = '02-6956-3439' UPDATE 완료
- [x] AC-3: 병원명/대표번호/사업자번호 이미 올바름 확인
- [x] AC-4: formatPhone 서울번호 02-XXXX-XXXX 올바른 포맷
- [x] AC-5: 빌드 PASS (3.13s)
- [x] AC-6: git push main → Vercel auto-deploy 트리거
- [x] 문제 2 (도장): 파일 존재 확인, 조치 불필요

## 검증 쿼리

```sql
SELECT id, name, phone, fax, nhis_code, business_no 
FROM clinics 
WHERE id = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
-- 기대: fax='02-6956-3439', business_no='511-60-00988'
```
