# T-20260720-foot-REDPAY-WHITELIST-BACKFILL-APPLY — prod `--apply` evidence

풋 레드페이 누락 백필 **prod 실적용** 증거. 부모: `T-20260720-foot-REDPAY-TID-288003-005-WHITELIST-EXPAND`.
게이트: 최필경(U05L6HE7QF6, ts=1784594244.960049) 백필 `--apply` **승인** + 추가조건 2건 위임(경계공백 A/B 판단·no-op7 경로확인).

- 실행일시: 2026-07-21 10:51 KST (UTC 01:51)
- 실행자: dev-foot
- 스크립트: `scripts/T-20260720-foot-REDPAY-WHITELIST-EXPAND_backfill.mjs --from 2026-07-13 --to 2026-07-21 --apply`
- 대상: 신규 9 merchant (VAN 5 · 유선 4), `clinic_id` slug=jongno-foot
- 원장 무접점: `payments`/`payment_reconciliation_log` 미접촉. `redpay_raw_transactions`(raw shadow)만. no-DDL.
- 멱등키: `on_conflict (external_trxid, external_status, amount) merge-duplicates`

---

## 1) window 연장 dry-run 재실측 (조건1 = OPT_A, window 7/21까지 연장)

window **2026-07-13 00:00 ~ 2026-07-21 (KST)** 재조회 실측:

| 항목 | 7/13~7/20 (원 dry-run, commit 886a9566) | **7/13~7/21 (연장 실측)** | 델타 |
|---|---|---|---|
| 총 txn | 75건 | **78건** | +3 |
| 승인(Y) | 63건 / 28,629,722원 | **65건 / 29,639,722원** | +2 |
| 취소(N/X/M) | 12건 / -4,901,722원 | **13건 / -5,901,722원** | +1 |
| **순액(net)** | 23,728,000원 | **23,738,000원** | **+10,000원** |
| 기적재(no-op) | 7건 | **10건** | +3 |
| 신규편입 예정 | 68건 | **68건** | 0 |

**델타 판정**: +3 txn / net +10,000원. 상식범위(~일일 규모) 크게 초과 아님 → **apply 전 flag 불요**.
델타 3건은 전량 **기적재(no-op)** 버킷으로 편입(신규편입은 68 불변) — OPT_A 예측 정합: live-poller(7/20 17:14~ active)가 7/20 저녁~7/21 델타를 이미 캡처 → overlap 전량 no-op(중복0).

merchant 분해(연장 실측):
```
1777285003 풋(VAN)  tid=1047479254    4건            0원
1777285005 풋(VAN)  tid=1047479268    5건       10,000원
1777285006 풋(VAN)  tid=1047479262    4건            0원
1777285007 풋(VAN)  tid=1047479263    2건            0원
1777285008 풋(VAN)  tid=1047479264    2건            0원
1777288003 풋(유선)  tid=1047479471   25건    9,978,000원
1777288005 풋(유선)  tid=1047479473   20건    9,950,000원
1777288006 풋(유선)  tid=1047479474   10건    3,800,000원
1777288008 풋(유선)  tid=1047479475    6건            0원
```

---

## 2) 기적재 no-op 건 ingest 경로 추적 (조건2 — 중복적재 아님 검증)

apply 직전 이미 적재돼 있던 **10건**의 ingest 경로를 `redpay_raw_transactions.created_at` + 폴러 로그(`~/logs/redpay_macstudio_poller.out`)로 추적:

**결론: 전량 정규 macstudio 폴러(incremental, merchant_whitelist=26) 경로. OCR-match·수기·중복write 아님.**

| created_at (UTC) | KST | 건수 | 경로 근거 |
|---|---|---|---|
| 2026-07-20T07:45:09 | 16:45:09 | **7건** | whitelist 17→26 확장 직후 **첫 26-set 폴러 사이클**. 폴러 로그: `07:45:09 가동 merchant_whitelist=26건(1차) ... 완료 fetched=17 upserted=17`. 직전 07:40 사이클(17-set)은 fetched=10 → +7 점프 = silent-drop 되던 신규 merchant 7건이 명단 확장으로 즉시 캡처. |
| 2026-07-20T09:25:47 | 18:25:47 | 1건 | 이후 정규 폴러 incremental 사이클 |
| 2026-07-20T10:16:06 | 19:16:06 | 1건 | 이후 정규 폴러 incremental 사이클 |
| 2026-07-20T10:21:08 | 19:21:08 | 1건 | 이후 정규 폴러 incremental 사이클 |

- 7건 원 no-op = **명단 확장(17→26)이 prod 반영된 첫 폴러 사이클(16:45 KST 7/20)** 에서 정상 캡처된 것. (부모 티켓 hint "288006 OPEN 7종"과 달리 실측은 288003×3·288005×2·288008×2.)
- 나머지 3건 = window 연장분(7/20 저녁 폴러 사이클) — §1 델타와 동일 건.
- 각 행은 **distinct `external_trxid`** 보유. 백필 멱등키 `(external_trxid, external_status, amount)` 기준 merge → **본 백필발 중복은 구조적으로 0**.

---

## 3) `--apply` 실행 결과 (raw shadow only, idempotent)

```
▶ APPLY — redpay_raw_transactions 멱등 upsert (원장 무접점)
  ✅ upsert 완료: 제출 78건, upserted 78, errors 0
  ── 적재 검증: before 10건 → after 78건 (증가 68, 멱등키 기준)
```

- **before 10 → after 78 (신규편입 +68)**. errors 0.
- 재실행(멱등) 검증: `--apply` 직후 재 dry-run → `기적재 78건 / 신규편입 0건` → 재실행 안전 확인.

## 4) POSTCHECK (prod introspection, 원장 무접점 확인)

```
NEW9 raw rows (redpay_raw_transactions): 78건 (Content-Range 0-77/78)
NEW9 rows with matched_payment_id: 3건  ← 하류 4-tier 매처(정규 폴러/EF match_only) 소산. 본 백필 아님.
```

- `redpay_raw_transactions` NEW9 = **78건** (= 신규편입 68 + 기적재 10). 실측 정합.
- `matched_payment_id` 3건은 live-poller 캡처분에 대해 **하류 매처가 별개로** 채운 것 — 백필은 raw shadow만 write, `payments`/`payment_reconciliation_log` 무접촉.

---

## 안전 프로파일 요약
- **원장 무접점**: `payments`/`payment_reconciliation_log` 미접촉 (raw shadow only). 매칭(4-tier)은 별개 하류.
- **idempotent**: 재실행 시 기적재분 no-op (검증 완료).
- **롤백**: raw shadow만이므로 오적재 시 window·merchant 스코프 DELETE 가능 (원장 무접촉이라 파급 없음).
  ```sql
  -- 롤백(필요 시): 백필 window·NEW9 merchant 스코프 삭제 (원장 무접점)
  DELETE FROM redpay_raw_transactions
  WHERE raw_payload->'merchant'->>'id' IN
    ('1777285003','1777285005','1777285006','1777285007','1777285008',
     '1777288003','1777288005','1777288006','1777288008')
    AND created_at >= '2026-07-13T00:00:00+09:00';
  ```
