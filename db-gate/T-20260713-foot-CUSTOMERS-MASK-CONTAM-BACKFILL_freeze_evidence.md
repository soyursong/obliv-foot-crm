# T-20260713-foot-CUSTOMERS-MASK-CONTAM-BACKFILL — FREEZE 지문 재확정 증거

> READ-ONLY prod 스캔 (`scripts/T-20260713-foot-CUSTOMERS-MASK-CONTAM-BACKFILL_freeze_dryrun.mjs`)
> 실행: 2026-07-13 (dev-foot). UPDATE/DELETE 0. PHI 위생(§4): 이름=마스킹형/길이, phone=tail 4자리만.
> ★ 실 정정(착수)은 data-architect CONSULT-REPLY GO + 사람 confirm 후에만. 본 문서는 freeze 스냅샷 전용.

## 지문 (WS-A 가드 코드 `20260713120000_selfcheckin_writepath_harden_masked_reject.sql` 와 동일 SSOT)
- name masked = name 에 `*` 포함 (예: 최***트)
- phone masked = phone 에 `*` 포함 OR phone 유효자릿수 1~7 (tail-only, 예: 5453)
- 버그윈도우(KST): `2026-07-11T00:00:00` (147b3417 서버측 마스킹 배포) ~ `2026-07-13T13:05:00` (WS-A write-path 가드 live)

## FREEZE 결과

### (A) customers 마스킹오염행 — 7건 (전부 clinic 74967aea, 전부 버그윈도우 내)
| id(8) | name | phone_tail | created_at | updated_at | override? | raw 1:1? | ref check_ins |
|---|---|---|---|---|---|---|---|
| 0356b229 | \<len3\> | 9089 | 07-11 04:09 | 07-11 07:14 | Y | 1건 | 1 |
| 512998d0 | \<MASKED*\> | 5453 | 07-13 00:32 | 07-13 00:42 | Y | 1건 | 1 |
| 67ea1793 | \<MASKED*\> | 0011 | 07-13 05:01 | 07-13 09:00 | Y | 1건 | 1 |
| bd307dfe | \<MASKED*\> | 2200 | 07-13 05:02 | 07-13 05:03 | Y | 1건 | 1 |
| 44a6a076 | \<MASKED*\> | 1122 | 07-13 05:02 | 07-13 05:02 | N | 1건 | 2 |
| 2dc21d1c | \<MASKED*\> | 0101 | 07-13 05:17 | 07-13 06:05 | Y | 1건 | 1 |
| **02594dfa** | \<len4\> | 0000 | 07-13 09:04 | 07-13 10:44 | Y | **3+건** | 1 |

- **원본 raw 1:1 매칭(정정 후보): 6건** — 각 마스킹행은 동일 clinic + phone tail 일치 + non-masked 원본 raw customer 1건과 대응.
- **원본 raw 0/2+ (§2-F per-row 폴백): 1건** — `02594dfa` (phone tail 0000, 후보 3+건 → 자동 매칭 불가, 사람검토 필수).

### (B) check_ins 마스킹-name 잔존 — 10건 hit 중 **버그윈도우 내 7건**
| id(8) | customer_id(8) | name | phone_tail | created_at | in_window |
|---|---|---|---|---|---|
| 4e760772 | 0356b229 | \<len3\> | 9089 | 07-11 04:09 | ✅ |
| 3585c9fb | 512998d0 | \<MASKED*\> | 5453 | 07-13 00:32 | ✅ |
| 3ac02464 | 67ea1793 | \<MASKED*\> | 0011 | 07-13 05:01 | ✅ |
| e3189149 | bd307dfe | \<MASKED*\> | 2200 | 07-13 05:02 | ✅ |
| b7929905 | 44a6a076 | \<MASKED*\> | 1122 | 07-13 05:02 | ✅ |
| f65fa43e | 2dc21d1c | \<MASKED*\> | 0101 | 07-13 05:17 | ✅ |
| dbca2465 | 44a6a076 | \<MASKED*\> | 1122 | 07-13 07:32 | ✅ |
| d8d804b8 | d330baa7 | \<len6\> | 0 | 07-01 03:21 | ❌ 제외 |
| 34cc3427 | ce00c1af | \<len6\> | 000 | 07-02 10:04 | ❌ 제외 |
| 62ea5da7 | d330baa7 | \<len6\> | 0 | 07-03 01:28 | ❌ 제외 |

- **버그윈도우 내 7건** = UNAUTH-CHANGE 잔류 (customer_id 가 (A)의 마스킹 phantom customers 를 가리킴).
- **윈도우 밖 3건 제외** — 07-01~03 은 147b3417(07-11) 이전 = 마스킹 함수 존재 前. len6 name + phone digit 1~3자리 = **dummy 짧은번호 false-positive**(1~7자리 heuristic trip), UNAUTH-CHANGE 오염 아님. **flip 금지(§2 경계 케이스: 레거시/미기록)**.

## 실환자 여부
- 전부 clinic `74967aea` 단일. 포렌식(20260713120000 SQL 주석) 근거 + 이름 마스킹형/DUMMY 패턴(tail 0000/0101/1122 등) → **실환자 0, 전부 test/DUMMY 추정.** DA 최종 판정 필요.

## 미해결 = DA CONSULT 대상 (recovery rule)
각 phantom 마스킹 customer 는 별도 raw 원본과 1:1 대응 + check_ins 가 phantom customer_id 를 참조.
→ 정정 방식이 **두 SOP 갈림**:
- **옵션 R (rename-in-place)**: phantom customers.name/phone 을 raw 로 UPDATE → **mutable-UPDATE SOP**(본 SOP). 단 원본과 중복행 잔존 → merge 별도.
- **옵션 D (relink + archive)**: check_ins.customer_id → raw customer 재링크 후 phantom customers archive/삭제 → **destructive → Orphan-Row Archive-First Cleanup SOP** 관할.
→ 어느 쪽인지 = 데이터아키텍처 판정. **DA CONSULT-REPLY GO 전 착수 금지.**
