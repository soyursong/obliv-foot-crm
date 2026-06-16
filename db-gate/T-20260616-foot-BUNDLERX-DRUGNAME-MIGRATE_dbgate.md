# T-20260616-foot-BUNDLERX-DRUGNAME-MIGRATE-KEEPTAB — DB게이트 핸드오프

작성: dev-foot · 2026-06-16 · repo: obliv-foot-crm · commit 20e5be15
상태: **DB-GATE-PENDING — supervisor 데이터게이트 GO 대기** (dry-run 완료·마이그 패키지 커밋, prod apply 미실행)
risk: **GO_WARN** (데이터게이트 동반)

---

## 0. 요청 요약 (문지은 대표원장 tiqy 직접정정)
묶음처방(prescription_sets) **탭/데이터/FE 전부 보존** + items[]의 **약 이름만** 처방세트 카탈로그
(prescription_codes) + 폴더트리(prescription_code_folders)로 이관. posology 미이관.
→ supersedes T-20260614-foot-RXSET-BUNDLE-MERGE (folder='약' 백필 = 오방향).

## 1. DRY-RUN 결과 (READ-ONLY, scripts/T-20260616-foot-BUNDLERX-DRUGNAME-MIGRATE_dryrun.mjs)

| 지표 | 값 |
|------|----|
| prescription_sets | **19** (전부 단독약, 전부 자유텍스트 prescription_code_id=null) |
| prescription_codes 카탈로그 | 499 |
| 이름매칭(name_ko 정확) | **0** (브랜드 상품명 → 표준청구코드 미존재. 퍼지검색도 무의미 매칭만) |
| 신규 prescription_codes 생성 | **19** (claim_code='RXMIG-'\|\|md5 12자, code_type='이관약', classification='내복약') |
| '이관약' 폴더 신규생성 | **1** |
| prescription_code_folders 매핑 | **19** |
| 모호(동명 다건) | 0 |
| 이미 폴더배정(skip) | 0 |

신규약 19종: 닥터로반·대웅푸루나졸정150mg·록소포펜·루마졸크림·바르토벤4ml·바르토벤8ml·베타베이트연고·삼아리도멕스크림·세파클리어·스티렌·에스로반연고·오구멘토·주블리아8ml·주블리아4ml·터미졸크림·플루나코엠캡슐·하이트리크림·한미유리아크림20g·한미유리아크림50g

## 2. 마이그 패키지 (커밋됨)
- `supabase/migrations/20260616120000_bundlerx_drugname_migrate.sql` — 백업스냅샷 3종 + 폴더보장 + 코드INSERT + 매핑INSERT + verify DO
- `supabase/migrations/20260616120000_bundlerx_drugname_migrate.rollback.sql` — RXMIG-% 코드삭제(CASCADE) + 이관약 폴더삭제
- `scripts/T-20260616-foot-BUNDLERX-DRUGNAME-MIGRATE_apply.mjs` — gated apply (기본 audit-only, `--apply`는 GO 후)

### 안전 속성
- **prescription_sets READ-ONLY** — 묶음처방 탭/데이터/FE 무손상 (write 0, jsonb_array_elements 읽기만). [spec A-2]
- **"약 이름만"** — posology(dosage/route/frequency/days/notes) 이관 안 함. items->>'name' 만 추출. [spec A-4]
- **결정적 claim_code** RXMIG-||md5(name)12 → 멱등 + 롤백 surgical 식별.
- **멱등**: ON CONFLICT(claim_code/code_id) DO NOTHING + NOT EXISTS(폴더) → 재실행 no-op.
- **트랜잭션 + 백업스냅샷 3종 + verify DO** (미해소/누락/폴더수 이상 시 RAISE EXCEPTION, fail-closed).
- code_type='이관약' = **CHECK 제약 없음 + FE 미사용** → 안전(순수 출처마커).
- data-architect CONSULT **비해당** (신규 컬럼/테이블/enum 0, 백업테이블만, 데이터계약 비변경).

## 3. supervisor 데이터게이트 요청
1. apply 스크립트가 실행 시 dry-run EXPECT(**sets=19 / distinct=19 / new_codes=19**)를 prod에서 재대조 → 불일치 시 자동 중단(exit 2).
2. GO 시 dev-foot: `node scripts/T-20260616-foot-BUNDLERX-DRUGNAME-MIGRATE_apply.mjs --apply` (대시보드 수동 금지 — dev-foot 직접실행 정책).
3. post-verify: RXMIG 코드 19 / 이관약 폴더 1 / 매핑 ≥19 / prescription_sets 19(무변경).
4. 이상 시 rollback.sql 즉시 실행.

## 4. FE / E2E
- **FE 코드 변경 없음** — 약은 기존 prescription_codes 폴더트리 인프라에서 '이관약' 폴더로 자동 표시.
- E2E: `tests/e2e/T-20260616-foot-BUNDLERX-DRUGNAME-MIGRATE-KEEPTAB.spec.ts` (**12/12 PASS**) — 마이그 불변식 + FE 보존 4종.
- 빌드 OK.

## 5. 결정 요청
- **supervisor**: dry-run EXPECT 대조(19/19/19) → GO/NO-GO. GO 후 apply → post-verify → 갤탭 실기기 현장 confirm → deploy-ready 승격.
- 분류(classification='내복약') 단순화 주의: 신규약 다수가 외용제이나 posology 미이관·색상매핑 cosmetic이라 v1 기본값 사용(가역). 현장 요청 시 후속 정정.
