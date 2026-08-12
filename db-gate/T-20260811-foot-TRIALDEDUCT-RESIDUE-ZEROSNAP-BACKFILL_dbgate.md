# DB-GATE evidence — T-20260811-foot-TRIALDEDUCT-RESIDUE-ZEROSNAP-BACKFILL

**artifact-class:** `db_only` (data-correction backfill · script_only · src/supabase 무변경)
**db_change:** false (DDL 0) · **data_dml_change:** true (package_sessions.unit_price value-correction)
**change-class:** ADDITIVE data-correction (bug-0 → 권위파생 · 가역 · no destruction) — §3.1 CEO 파괴게이트 면제 YES (DA j54p)

## apply_gate (prod UPDATE 2중 하드게이트 — 미충족 시 apply ABORT)
1. **박민지 치료사 comp-transparency ack** — responder DECISION-REQUEST 경유 (agenda AG-20260812-145547). notice sent 14:55, ack pending.
2. **supervisor DB-GATE GO-token** — `db-gate/T-20260811-foot-TRIALDEDUCT-RESIDUE-ZEROSNAP-BACKFILL_GO.token.json` (decision:"GO"). 부재 시 `_apply.mjs` 즉시 ABORT.

> ①VG1 census=CLEARED(16:05 SPLIT·마감원장 DISPLAY·restatement 소거) ②SET owner ratification=CLEARED(김주연 총괄 "반영시켜줘" 2026-08-12T14:38). ③=위 apply_gate.

## dry-run 결과 (READ-ONLY freeze, write 0 — 2026-08-12 실측)
- scan: packages 637 · used package_sessions(trial|unheated_laser) 537
- **FROZEN SET: 31행** (DA-frozen 예상치와 정확 일치)
  - trial: **28행** · 재구성 매출합 **329,000원** (27×10,000 + 1×59,000[내성체험권])
  - unheated_laser: **3행** · 재구성 매출합 **710,000원** (250,000 + 240,000 + 220,000)
  - **총 재구성(차감매출 표시값 소급): 1,039,000원**
- skip: unit_price≠0 = 472 · 부모없음 = 0 · 부모단가0(heated legit-0 등) = 34
- 방화벽: nonzero-diff/strong-fingerprint(옛 nonzero) 0건 혼입 — 순수 zero-snapshot 만.
- red-box 4행(자식 CHARTEDIT 소관)은 unit_price>0 정정완료 → unit_price=0 술어에 자연 disjoint(0건 잔존).

### frozen 31행 (package_session_id | pkg | type | 0→재구성단가 | date)
```
e499bdc4 무좀체험권 trial       0→10,000  2026-07-17
eb17c230 무좀체험권 trial       0→10,000  2026-07-16
3774bdb4 무좀체험권 trial       0→10,000  2026-07-16
3817600c 무좀체험권 trial       0→10,000  2026-07-16
e5531f86 무좀체험권 trial       0→10,000  2026-07-17
654444b2 무좀체험권 trial       0→10,000  2026-07-16
7ee96f89 무좀체험권 trial       0→10,000  2026-07-17
ca6b789c 무좀체험권 trial       0→10,000  2026-07-16
1b8fd08c 무좀체험권 trial       0→10,000  2026-07-21
66deeafe 무좀체험권 trial       0→10,000  2026-07-18
102f1ddc 무좀체험권 trial       0→10,000  2026-07-20
5dcc4089 무좀체험권 trial       0→10,000  2026-07-16
98ca65d2 체험       trial       0→10,000  2026-07-15
912b0179 무좀체험권 trial       0→10,000  2026-07-16
065b2109 내성체험권 trial       0→59,000  2026-07-15
066cb842 아톰레이저 unheated_laser 0→250,000 2026-07-20
ae0d3ed5 무좀체험권 trial       0→10,000  2026-07-16
25721540 체험       trial       0→10,000  2026-07-14
93027ac5 무좀체험권 trial       0→10,000  2026-07-17
d78304d5 무좀체험권 trial       0→10,000  2026-07-14
1f9a722a 무좀체험권 trial       0→10,000  2026-07-15
25b96395 무좀체험권 trial       0→10,000  2026-07-16
7aedbd8c 무좀체험권 trial       0→10,000  2026-07-16
599ab45a 무좀체험권 trial       0→10,000  2026-07-16
b3488556 무좀체험권 trial       0→10,000  2026-07-16
d78a7702 무좀체험권 trial       0→10,000  2026-07-17
4685dab2 무좀체험권 trial       0→10,000  2026-07-21
6b2873e2 HL+NL      unheated_laser 0→240,000 2026-08-03
c7c2e589 무좀체험권 trial       0→10,000  2026-07-29
0dc185d8 24회       unheated_laser 0→220,000 2026-08-06
bbbd001d 무좀체험권 trial       0→10,000  2026-08-08
```
> 전체 PK VALUES + before-image 는 `scripts/_out/..._freeze.json`(gitignore·apply−1 재생성) 참조.

## 재구성 규칙 (SSOT)
각 행 correct unit_price = 부모 package type-matched `<session_type>_unit_price`.
= `sessionTypeUnitPrice()`(CustomerChartPage.tsx L711) + `fn_fill_session_unit_price` 트리거 parity. 합성/하드코딩 0.

## 스크립트 세트 (Data-Correction Backfill SOP 준수)
| 스크립트 | 역할 | write |
|---|---|---|
| `scripts/..._freeze.mjs` | G-gate READ-ONLY freeze/dry-run · PK VALUES 확정 | 0 |
| `scripts/..._apply.mjs` | GATED apply — GO-token 게이트 + DRIFT re-freeze ABORT + archive-first + per-row PK UPDATE + materiality + rows-affected 검증 | package_sessions.unit_price only (GO-token 有 & APPLY_CONFIRM=1 시) |
| `scripts/..._postcheck.mjs` | READ-ONLY 정합검증(전건 정정 + residue 0 + 대사) | 0 |
| `rollback/..._rollback.sql` | 가역 롤백(대상 PK → unit_price=0 복원) | 되돌림 |

## DA H8 + H3 CENSUS 증적 (supervisor GO-token 선결 2·3조건 · READ-ONLY, write 0 · 2026-08-12 실측)
> 러너: `scripts/T-20260811-...-RESIDUE-ZEROSNAP-BACKFILL_census_h8h3.mjs` (SELECT only). seal = a224c81d authored 2026-08-08 21:55:52 +0900, deploy ~21:57 KST(=2026-08-08T12:57:00Z).

### H8 — source-closure (각 행 record **created_at 실측** vs seal · session_date 아님)
- **freeze 31행 전건 PRE-SEAL** (created_at < 2026-08-08 21:57 KST). **post-seal(BLOCK)=0 · ambiguous(commit~deploy)=0** → re-contamination 0건, freeze 축소 불요(31행 유지).
- supervisor 플래그 3행(session_date 08-03/08-06/08-08) 실측 created_at:
  - `6b2873e2` (unheated_laser, HL+NL, sd 08-03) — created **2026-08-03 10:35:38 KST** = seal −5일 → **PRE(편입 OK)**
  - `0dc185d8` (unheated_laser, 24회, sd 08-06) — created **2026-08-06 18:40:03 KST** = seal −2일 → **PRE(편입 OK)**
  - `bbbd001d` (trial, 무좀체험권, F-5787, sd 08-08) — created **2026-08-08 18:44:04 KST** = seal −3h13m → **PRE(편입 OK)**
  - ※ 3행 모두 session_date 는 seal 근방이나 record created_at 은 seal 이전 = forward-fix 이전 저장된 legacy 오염(재오염 아님). ∴ 편입 정당.

### H3 — discriminant-validity (`unit_price=0 ∧ pkg.<type>_unit_price>0` = 오직 snapshot 버그 기원 확증)
- **H3-a (구조)**: `package_sessions` 금액축 = `unit_price`(스냅샷) + `surcharge`(가산). **comp/discount/free/reason 컬럼 부재** → unit_price=0 을 '정당하게' 세팅하는 구조적 경로(플래그·사유) 없음. 0 = insert-time 미채움(버그) 단일 기원.
- **H3-b (post-seal 재오염 전수조사, freeze 밖 포함)**: seal 이후 생성된 trial|unheated 세션 **92건 중 unit_price>0(부모>0)=89(forward-fix positive control) · unit_price=0∧부모>0=0**. → forward-fix seal = 유일 0-생성원 봉인 확증(재오염 0).
- **H3-c (memo 스캔)**: freeze 31행 memo/surcharge_memo 非공백 **0/31**, 무상·서비스·할인 등 정당-0-의도 텍스트 **0건**.
- **H3-d (술어집합 재대조)**: 현 술어집합(used·부모>0·unit_price=0) = **31행 == freeze 31행 정확 일치** (extra 0 · missing/DRIFT 0).
- **결론**: 정당 comp/무상/할인 0-경로 부재 확증 → EXCLUDE 대상 0건. 31행 전건 진성 snapshot-버그 잔여.

> **CENSUS 종합**: H8·H3 전건 PASS → freeze **31행 / 1,039,000원 불변**(축소 없음). apply−1 최종 re-freeze(4조건④)는 GO-token 후 _apply.mjs 가 재검증(DRIFT ABORT + rows-affected==31). ★본 census 는 READ-ONLY 증적 — prod UPDATE 미실행(GO-token 前 apply 금지 유지).

## 가드 요약
- 원장(payments/purchase/service_charges) 무접점 — package_sessions.unit_price 스냅샷만.
- blanket/predicate UPDATE 금지 — freeze.json 의 explicit PK VALUES 로만.
- apply−1 re-freeze DRIFT ABORT (missing/extra 감지).
- archive-first before-image → `rollback/..._capture.csv`.
- GO-token 前 prod UPDATE 금지(apply_before_go 금지).
- under-correct ≫ over-correct.
