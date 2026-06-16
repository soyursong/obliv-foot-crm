# T-20260616-foot-RXSET-DRUGFOLDER-MIGRATE — AC-1 데이터 모델 audit (READ-ONLY)

실행: dev-foot · 2026-06-16 · prod rxlomoozakkjesdqjtvd
게이트흐름 step 2 (DA CONSULT GO 이후, supervisor 데이터게이트 이전)
DA 회신: DA-20260616-FOOT-RXSET-COPY (GO, ADDITIVE, copy)

---

## ① 테이블/매핑 경로 확정 (티켓 "drug_folders" 정체)

티켓 본문의 **"drug_folders"는 어드민 탭 라우트명**(`value="drug_folders"`, data-testid `tab-drug-folders`, 현장 라벨 "처방세트")이며 **물리 테이블이 아니다.** 실제 매핑은 `src/lib/drugFolders.ts` AC-R6 주석 + `src/pages/ClinicManagement.tsx`가 SSOT:

| 현장 용어 | 어드민 탭 value | 실제 테이블 |
|-----------|----------------|------------|
| **처방세트** (약 카탈로그) | `drug_folders` | **`prescription_codes`** (name_ko/claim_code/classification/code_type/code_source) |
| 처방세트 — 폴더 트리 | `drug_folders` | **`prescription_folders`** (parent_id/name/sort_order) + **`prescription_code_folders`** (PK=code_id 매핑) |
| **묶음처방** (빠른처방 프리셋) | `prescriptions` | **`prescription_sets`** (items[] = posology 보유, 영구 보존) |

→ 이관 타깃 = `prescription_codes`(약 마스터) + `prescription_folders`('이관약' 폴더) + `prescription_code_folders`(배정). PURGE dry-run이 친 테이블이 정확.

## ② copy / move 판정 = **COPY** (move 불요)

- `prescription_sets` 19행은 **잔존**해야 함: ① 묶음처방 탭(`value=prescriptions`) 영구 보존 결정(2026-06-08 문지은 대표원장), ② 2계층 모델(BUNDLERX-BUILDER)에서 favorite posology 출처로 재활용.
- 약 "이름만" 이관이므로 source DELETE 불필요 → **move(DELETE) 경로 채택 사유 없음.** copy로 전 요구 충족.
- move 채택 시에만 발생하는 quick_rx_buttons CASCADE 파괴(→CEO 게이트, 별 티켓 8jj8 PURGE)는 본 티켓에서 **회피됨.**

## ③ quick_rx_buttons 실측 (copy 무영향 확인)

- 총 행 = **1**. `"무좀세트"`[활성] → `prescription_set_id=7` ("바르토벤 외용액 4ml(에피나코나졸)").
- FK = ON DELETE CASCADE. **copy = prescription_sets 무손상 → 버튼 보존 ✅.** dangling 0, null 참조 0.

## ④ dry-run count (멱등·ADDITIVE)

`scripts/T-20260616-foot-BUNDLERX-DRUGNAME-MIGRATE_dryrun.mjs` (2026-06-16 재실행, 안정):
```
EXPECT={"sets":19,"distinct_drugs":19,"new_codes":19,"folder_assign":19,
        "skip":0,"ambiguous":0,"migrate_folder_exists":false}
```
- 19 단독약 전부 items[0] 자유텍스트(prescription_code_id=null), 카탈로그 499개 중 이름매칭 0 → **신규 prescription_codes 19건** + '이관약' 폴더 1건 + 매핑 19건.
- 모호(동명) 0, 이미배정(skip) 0. `migrate_folder_exists:false` = apply 미실행 상태.
- 재실행 시 결정적 claim_code(`RXMIG-||md5`) + ON CONFLICT DO NOTHING → 0건 신규 (멱등).

## ⑤ NAMEDESC 백필 / 이름 출처

19 단독약 모두 set.name == items[0].name (단일약 세트라 이름 출처 일치). 이름 자리에 분류/투여경로가 뜨지 않음(시나리오1 step4 충족).

---

## ★ 핵심 발견 — 중복 트랙 (REDEFINITION, planner 판단 요청)

**본 티켓(RXSET-DRUGFOLDER-MIGRATE)과 동일한 copy 이관을 이미 구현·완료한 형제 티켓이 존재한다:**

`T-20260616-foot-BUNDLERX-DRUGNAME-MIGRATE-KEEPTAB` (status: **db-gate-pending**, build-ok, **E2E 12/12 PASS**)
- 동일 요구(약 이름만, posology 제외, prescription_sets 보존), 동일 reporter/thread(1781585999.455529), 동일 supersedes(BUNDLE-MERGE).
- 산출물 전부 존재: 마이그 `20260616120000_bundlerx_drugname_migrate.sql` + 롤백 + apply.mjs(EXPECT 재대조 게이트) + dry-run + E2E spec.
- 커밋 20e5be15 / 7c7fe37c. **supervisor 데이터게이트 GO만 대기 중.**

→ 두 티켓은 같은 작업. 본 티켓은 planner+DA가 정식 DA CONSULT 게이트를 부여한 쌍둥이. **신규 apply 패키지 중복 구축 금지** 권고.

### 권고
1. **통합**: KEEPTAB의 기존 apply 패키지를 본 티켓의 DA GO(DA-20260616-FOOT-RXSET-COPY) 권한 아래 그대로 supervisor 데이터게이트로 진행. 둘 중 하나는 dup-close.
2. **DA 4조건 vs KEEPTAB 구현 갭 2건 (게이트 전 ruling 필요):**
   - **갭1 (조건① DDL 0)**: KEEPTAB 마이그는 백업 스냅샷 3종 `CREATE TABLE ... AS SELECT` + `CREATE TEMP TABLE`(+DROP) 사용. **타깃 테이블(prescription_codes/folders/code_folders)엔 INSERT만**이나, 보조 백업/임시 테이블이 CREATE/DROP DDL. DA 조건①("CREATE/ALTER/DROP 금지")과 문리상 긴장 → DA ruling 요청: (a) 안전 백업/temp DDL은 타깃 스키마 무변경이므로 면제, 또는 (b) 마이그를 스크립트측 JSON 스냅샷(dry-run 방식)으로 전환.
   - **갭2 (조건④ 멱등 정규화)**: KEEPTAB 정규화 = `btrim`+공백collapse(`\s+→space`). DA 조건④의 **대소문자(lowercase) 미적용**. 한글 약명은 영향 거의 없으나 영문 브랜드 조각(4ml/4ML 등) 이론상 중복 여지. 저위험, 보완 권고.

verdict: **copy 경로 GO 조건 충족**(②③④⑤). 단 신규 구현 대신 KEEPTAB 통합 + DA 갭2건 ruling 후 supervisor 데이터게이트 진입 권고.
