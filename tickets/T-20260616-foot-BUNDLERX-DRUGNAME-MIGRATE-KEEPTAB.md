---
id: T-20260616-foot-BUNDLERX-DRUGNAME-MIGRATE-KEEPTAB
domain: foot
priority: P1
status: db-gate-pending
deploy-ready: false
build-ok: true
db-change: true
regression-risk: medium
e2e-spec: tests/e2e/T-20260616-foot-BUNDLERX-DRUGNAME-MIGRATE-KEEPTAB.spec.ts
e2e_spec_exempt_reason: null
created: 2026-06-16
assignee: dev-foot
reporter: 문지은 대표원장 (#foot C0ATE5P6JTH, thread 1781585999.455529, tiqy 직접 정정)
supersedes: T-20260614-foot-RXSET-BUNDLE-MERGE
db-gate-handoff: db-gate/T-20260616-foot-BUNDLERX-DRUGNAME-MIGRATE_dryrun.md
data-architect-consult: 비해당 (신규 컬럼/테이블/enum 0 · 백업테이블만 · code_type 텍스트값 추가는 데이터계약 비변경)
---

# T-20260616-foot-BUNDLERX-DRUGNAME-MIGRATE-KEEPTAB — 묶음처방 약 이름 → 처방세트 카탈로그+폴더 이관 (탭 보존)

문지은 대표원장 tiqy 직접 정정: 묶음처방(prescription_sets) **탭/데이터/FE 전부 보존**하고,
items[]의 **약 이름만** 처방세트 카탈로그(prescription_codes) + 폴더트리(prescription_code_folders)로 이관.
posology(dosage/route/frequency/days/notes)는 이관 제외.
→ supersedes T-20260614-foot-RXSET-BUNDLE-MERGE(folder='약' 백필 = 오방향).

## ✅ 구현
1. [DB] prescription_sets.items[] 각 약을 prescription_codes + prescription_code_folders 로 이관
   - prescription_code_id 있음 → 그 code 폴더배정 / null(자유텍스트) → name_ko 정확매칭, 없으면 신규생성
   - 배정 폴더: 기존 적합 폴더 없으면 '이관약' 신규 폴더
   - dedup: 동일 prescription_code_id 이미 폴더배정 시 SKIP (PK ON CONFLICT)
2. [보존] 묶음처방 탭/데이터/FE 전부 유지 (마이그는 prescription_sets READ-ONLY)

## DRY-RUN 결과 (2026-06-16, READ-ONLY)
- prescription_sets = 19 (전부 단독약, 전부 자유텍스트 prescription_code_id=null)
- prescription_codes 카탈로그 499개 중 **이름매칭 0건** (브랜드/상품명 → 표준청구코드 미존재)
- **신규 prescription_codes 생성 19건** (claim_code='RXMIG-'||md5 12자, code_type='이관약', classification='내복약')
- **'이관약' 폴더 신규생성 1건**
- **prescription_code_folders 매핑 19건**
- 모호(동명 다건) 0 · 이미 폴더배정(skip) 0
- 신규약 목록: 닥터로반·대웅푸루나졸정150mg·록소포펜·루마졸크림·바르토벤4ml/8ml·베타베이트연고·삼아리도멕스크림·세파클리어·스티렌·에스로반연고·오구멘토·주블리아8ml/4ml·터미졸크림·플루나코엠캡슐·하이트리크림·한미유리아크림20g/50g

## 안전장치 (risk GO_WARN — supervisor 데이터게이트 동반)
- dry-run: `scripts/T-20260616-foot-BUNDLERX-DRUGNAME-MIGRATE_dryrun.mjs` (READ-ONLY) → db-gate/*_dryrun.md
- apply: `scripts/T-20260616-foot-BUNDLERX-DRUGNAME-MIGRATE_apply.mjs` (기본 audit-only, `--apply`는 게이트 GO 후)
  - 실행 시 dry-run EXPECT(sets=19/distinct=19/new=19) 재대조 게이트 → 불일치면 중단(exit 2)
- 마이그: `supabase/migrations/20260616120000_bundlerx_drugname_migrate.sql` (BEGIN/COMMIT + 백업스냅샷 3종 + verify DO)
- 롤백: `supabase/migrations/20260616120000_bundlerx_drugname_migrate.rollback.sql` (RXMIG-% 코드 삭제 CASCADE + 이관약 폴더 삭제)
- 멱등: ON CONFLICT DO NOTHING + NOT EXISTS + 결정적 claim_code → 재실행 no-op
- 마이그 직접 apply (대시보드 수동 금지)

## ❌ 제외 (fj7h 잘못된 스펙 — 미수행)
prescription_sets DELETE / 묶음처방 탭 제거 / DoctorTreatmentPanel 불러오기 제거 / BundleRxTagBar·QuickRxButtonsTab FK 손대기 — **전부 안 함** (FE-1~4 spec 보존단언).

## E2E (12/12 PASS)
`tests/e2e/T-20260616-foot-BUNDLERX-DRUGNAME-MIGRATE-KEEPTAB.spec.ts`:
- [A] 마이그 불변식: prescription_sets READ-ONLY · 이관산출물 · 약이름만(posology 미이관) · 백업/롤백/멱등 · dry-run READ-ONLY/apply audit-only
- [B] FE 보존: 묶음처방 탭(value=prescriptions) · DoctorTreatmentPanel 불러오기 · BundleRxTagBar · QuickRxButtonsTab FK

## 다음
supervisor 데이터게이트(dry-run EXPECT 대조) GO → dev-foot `--apply` 직접 실행 → post-verify → 갤탭 실기기 현장 confirm → deploy-ready 승격.
