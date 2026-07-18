# T-20260617-foot-RXSET-CUSTOM-DRUG-HIRA-MAP — batch16 supervisor DML 게이트 패키지

부모 §19 apply GO(2026-07-18). dev-foot = dry-run + 롤백SQL 산출까지. **PROD apply = supervisor**(dev PROD password 미보유).

## 범위 = 16종 (#3~#18) → 13 distinct official (dedup 3쌍 수렴)
- 제외: #1 플루나코엠(T-20260716 旣 PROD 적용) · #2 대웅푸루나졸(분리 DELETE 티켓, in-place 금지) · **#19 오구멘토(BLOCKER, 아래)**.
- 메커니즘 = reference-canonical(§8 (b)) — **전건 Case2**(official 미등재 → 신규 official ADDITIVE + folder reference-move + custom deprecate). claim_code in-place 교체 0 · custom hard-delete 0.
- claim_code = `HIRA-{품목기준코드9}`(§14 DA, 비급여/EDI미확정 prefix). insurance_status=NULL(급여여부 미확정 → 오청구 방지, hira_insurance_sync 배치 소관).

## ⚠ #19 오구멘토 BLOCKER (16종으로 축소한 사유)
- §16 총괄 확정 official 약명 = **오구멘틴375mg**. 그러나 2026-07-16 갱신 심평원 master 재검증 결과:
  - "오구멘틴375mg" = `글락소오구멘틴정375mg`(품목 200209643) **단 1건, 취소일 2012-04-26 = discontinued**. active 부재.
  - v3(2026-06-18) 이 매칭했던 `오구멘토정625`(품목 201907725)도 현재 master 에서 **소실**(오구멘토 0건).
- discontinued 코드를 official 매핑으로 적용 = 청구/임상 오류 → **#19 hold, planner FOLLOWUP 로 별도 라우팅**. (규격 재질의 아님 — 확정명이 discontinued 라는 신규 data-integrity 사실.)

## 산출물
| 파일 | 용도 |
|------|------|
| `supabase/migrations/20260718160000_rxset_custom_drug_hira_map_batch16_apply.sql` | **apply DML**(13 official ADDITIVE + reference-move + deprecate). 단일 txn, per-official RAISE 가드, 사후 검증 내장. |
| `..._batch16_apply.rollback.sql` | **롤백 SQL**(폴더참조 원복 + secondary membership 재삽입 + provenance 해제 + official 제거). |
| `scripts/..._batch16_audit.mjs` | **dry-run COUNT**(READ-ONLY). EXPECT/ACTUAL 게이트 = `db-gate/T-20260617-batch16_stepA_snapshot.json`. |
| `scripts/..._batch16_prefixguard.mjs` | **prefix-guard 회귀검증**(§14 판정3). |
| `scripts/..._batch16_postverify.mjs` | 적용 후 검증(READ-ONLY, supervisor apply 후 실행). |
| `scripts/..._batch16_mapping.mjs` | 매핑 SSOT(16 custom / 13 official). |
| `scripts/..._batch16_gen_sql.mjs` | SQL 결정론 생성기(손전사 오류 방지). |

## dry-run COUNT 게이트 (READ-ONLY, PROD 2026-07-18)
```
provenance_cols: true(4/4)  custom_identified: 16/16  prescription_sets_refs: 0
officials_distinct: 13  Case2: 13  Case1: 0  total_custom: 19  untouched: 3
```
= 신규 claim 충돌 0/13 · dedup 3쌍 동일폴더(secondary membership 삭제로 처리) · 코드 전건 master active 재검증. **PASS**.

## prefix-guard 회귀 (§14 판정3 supervisor 통과조건)
- 가드 = ★구조적. 배치 `claim_code = ANY($edi::text[])` 정확 동치 → HIRA-/LEGACY- prefix 는 bare EDI 와 문자열 동치 불가 → 매칭 배제(오청구 0). **가드 추가 불요.**
- 대조군 입증: bare 품목코드 적재 시 worst-case EDI 에 13/13 매칭(오청구) → prefix 가 정확히 이를 차단. 전건 PASS.

## supervisor 체크리스트
1. `node scripts/..._batch16_audit.mjs` (dry-run COUNT 재확인, PASS 기대).
2. `node scripts/..._batch16_prefixguard.mjs` (PASS 기대).
3. apply.sql PROD 적용 (단일 txn, 실패 시 자동 abort·무영속). ★Migration Dry-Run No-Persistence Protocol 준수(txn-control strip + exception-handler + post-probe).
4. `node scripts/..._batch16_postverify.mjs` (종단상태 전건 PASS 기대).
5. 이상 시 `..._batch16_apply.rollback.sql` 즉시 적용.
- surface = DrugFolderTree 1곳. FE 코드 변경 0(배지는 code_source 파생 → official 자동 무배지). 처방 핵심경로(QuickRx/진료차트) 회귀 0.
