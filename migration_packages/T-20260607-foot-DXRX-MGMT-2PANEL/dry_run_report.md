# Dry-run Report — T-20260607-foot-DXRX-MGMT-2PANEL 갈래① 상병명 3-A additive FK

- 작성: dev-foot · 2026-06-07
- 게이트: **D3 supervisor SQL 게이트** (GO 후 dev-foot 직접 실행. 대시보드 수동실행 금지)
- 승인 근거: planner D2 (MSG-20260607-141544-8dlp), db_change=true 확정
- 대상 DB(dev): `rxlomoozakkjesdqjtvd`

## 변경 요약 (ADDITIVE ONLY / 무손실)

| # | 변경 | 종류 | 무손실 |
|---|------|------|--------|
| 0 | `services.diagnosis_folder TEXT` ADD COLUMN IF NOT EXISTS (방어 보강) | additive | ✓ |
| 1 | `diagnosis_folders` 테이블 신설 (id·clinic_id·parent_id self-FK·name·sort_order·ts) | additive | ✓ |
| 2 | `services.diagnosis_folder_id uuid NULL FK` (ON DELETE SET NULL) | additive | ✓ |
| 3 | RLS: read-all authenticated / write authenticated (앱레이어 admin gate) | additive | ✓ |

- 기존 `services.diagnosis_folder` TEXT **보존**(DROP 안 함) → 안전망. TEXT↔FK 공존.
- 상병 정본 = `services.category_label='상병'` 단일 SSOT 유지. 폴더는 분류용일 뿐 상병 마스터 신설 아님.

## Dry-run 실측 (read-only, 2026-06-07)

```
category_label='상병' services 행 수 : 8
services.diagnosis_folder TEXT 컬럼   : 미존재 (선행 마이그 20260606160000 dev 미적용)
diagnosis_folders 테이블             : 미존재
→ 백필 대상(매핑) : 0건
→ 생성될 폴더 row : 0건
```

### 핵심 발견 (supervisor/planner 공유)
- 선행 TEXT 폴더 기능(20260606160000)이 **dev 미적용** 상태였음. 따라서 현 시점 백필 소스 0건.
- 의미: **마이그 리스크 매우 낮음** (이전할 폴더 데이터 없음, FK 위반 가능성 0).
- 본 마이그는 0번 `ADD COLUMN IF NOT EXISTS` 로 TEXT 컬럼을 self-sufficient 하게 보강 →
  20260606160000 적용 여부와 무관하게 단독 적용 가능 (idempotent).
- FE 2패널은 **빈 폴더 상태**에서 시작 (운영 중 폴더 신규 생성). 데이터 마이그 부담 없음.

## 적용 순서 (supervisor 실행 시)
1. `20260607200000_diagnosis_folders_fk.sql` 적용
2. `20260607200000_diagnosis_folders_fk.backfill.sql` STEP 1(dry-run NOTICE) 확인 → 현재 0건
3. (백필 대상 있을 때만) STEP 2 주석 해제 실행 → STEP 3 검증(잔여 0 기대)

## 롤백
- `20260607200000_diagnosis_folders_fk.rollback.sql`
- FK 의존성 역순 DROP. `services.diagnosis_folder` TEXT 는 **비복원**(원본 보존이므로 손실 없음).
- 롤백 후에도 TEXT 폴더명 안전망 유지 → 재백필 가능.

## idempotent / 재실행 안전성
- CREATE TABLE/INDEX/COLUMN 전부 `IF NOT EXISTS`. 정책만 rollback 후 재적용 필요.
- 백필: 폴더 `ON CONFLICT DO NOTHING`, 매핑은 `diagnosis_folder_id IS NULL` 행만 UPDATE.

## 리스크 / 블로커
- 블로커 없음. 백필 0건 + additive only + ON DELETE SET NULL(상병 항목 보존).
- 주의: RLS write 는 인증사용자 허용(앱레이어 admin gate) — prescription_folders(20260607180000)와 동일 채택 패턴. 컬럼레벨 role gate 한계 동일.
