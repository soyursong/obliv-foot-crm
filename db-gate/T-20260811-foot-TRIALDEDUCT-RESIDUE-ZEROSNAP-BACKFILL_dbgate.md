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

## 가드 요약
- 원장(payments/purchase/service_charges) 무접점 — package_sessions.unit_price 스냅샷만.
- blanket/predicate UPDATE 금지 — freeze.json 의 explicit PK VALUES 로만.
- apply−1 re-freeze DRIFT ABORT (missing/extra 감지).
- archive-first before-image → `rollback/..._capture.csv`.
- GO-token 前 prod UPDATE 금지(apply_before_go 금지).
- under-correct ≫ over-correct.
