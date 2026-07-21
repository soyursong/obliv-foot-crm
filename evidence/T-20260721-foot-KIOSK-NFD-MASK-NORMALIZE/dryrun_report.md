# DRY-RUN evidence — T-20260721-foot-KIOSK-NFD-MASK-NORMALIZE

- 대상 prod: rxlomoozakkjesdqjtvd (obliv-foot-crm)
- 실행: `node scripts/T-20260721-foot-KIOSK-NFD-MASK-NORMALIZE_dryrun.mjs` (read-only, Management API /database/query)
- 무영속: prod 함수정의/데이터 mutation **0** (CREATE/UPDATE 미실행 — read-only SELECT만).
- No-Persistence Protocol: 실 apply+rollback within-tx recipe 는 `*.dryrun.sql` PART B/C(txn-control strip + post-probe) 에 동봉 → supervisor DB-GATE 에서 prod 재현.

## PART A — 마스킹 산식 NFD→NFC 회귀 (핵심 교정 증거)

| label | raw_len | nfc_len | masked_before(수정 전) | masked_after(수정 후) |
|---|---|---|---|---|
| NFC-정상 강승은 | 3 | 3 | 강*은 | 강*은 |
| **NFD-깨짐 강승은** | **9** | 3 | **ᄀ\*\*\*\*\*\*\*ᆫ (깨짐)** | **강\*은 (교정)** |
| NFC 홍길동 | 3 | 3 | 홍*동 | 홍*동 |
| NFC 이영 | 2 | 2 | 이* | 이* |
| NFC 박 | 1 | 1 | 박 | 박 |
| NULL | null | null | null | null |

→ NFD 저장값(raw_len=9)이 `ᄀ*******ᆫ`로 깨지던 것을 `normalize(nm, NFC)` 래핑으로 `강*은` 교정.
  기존 정상(NFC) 이름은 before==after → **회귀 0**. (AC-2 충족)

## PART B — 현 prod 함수 baseline (적용 전)

```json
{ "proname": "fn_selfcheckin_today_reservations", "prosecdef": true,
  "proconfig": ["search_path=\"\""], "owner": "postgres",
  "args": "p_clinic_id uuid, p_date date", "has_nfc_wrap": false }
```

→ 적용 전 상태 확인: SECDEF=true, search_path='' 핀, owner=postgres, 시그니처(uuid,date) 불변, normalize wrap 아직 없음.
  up 마이그는 이 위에 nm 파생만 `normalize(...,NFC)` 래핑 (ADDITIVE). (AC-1/AC-3)

## PART C — EXECUTE 권한 (불변 대상)

```json
{ "anon_exec": true, "auth_exec": true }
```

→ anon/authenticated EXECUTE 유지(셀프체크인 공개흐름). CREATE OR REPLACE 시그니처 동일 → ACL 보존 + 안전차 GRANT 재부여.

## 결론
- 데이터 mutation 0, 스키마 diff = pg_proc 함수 body 1개(nm 파생 normalize 래핑)만.
- AC-1/2/3/4 dev-side 충족. supervisor DDL-diff DB-GATE + pg_proc PREFLIGHT(C10) + MIG-GATE 4필드로 최종 게이트.
