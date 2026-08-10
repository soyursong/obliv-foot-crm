# T-20260810-foot-SELFCHECKIN-RPC-STATUS-WIDEN — prod apply evidence

- **ticket**: T-20260810-foot-SELFCHECKIN-RPC-STATUS-WIDEN (P0, db_only)
- **artifact-class**: db_only
- **prod_ref**: rxlomoozakkjesdqjtvd
- **applied_at**: 2026-08-10T04:09Z (2026-08-10 13:09 KST)
- **runner**: `scripts/apply_20260810120001_foot_selfcheckin_status_widen.mjs --apply`
- **migration**: `supabase/migrations/20260810120001_foot_selfcheckin_status_widen.sql`
- **migration sha256**: `f1ded39e70a43d1c8c40dd4dee4ed34f45c70c59d258c3888399f91cdf63e50b` (GO-token pin 일치)
- **GO-token**: v2 slot 20260810120001, key_id=supv-dbgate-2026a, sig_verify=pass, TTL 04:46:02Z (apply 시각 04:09Z < 만료 → 유효)

## apply 직전 C19-2 prosrc md5 재대조 (OOB drift 게이트)
| fn | pre md5 (baseline pin) | 대조 |
|----|----|----|
| fn_selfcheckin_reservation_banner | `321fb3cc1c15209ab0b153d7bd903fac` | == baseline → PASS |
| fn_selfcheckin_today_reservations | `0a632516a0671f820bd391fba3f029a5` | == baseline → PASS |

→ OOB drift 없음. apply 진행.

## DB-GATE A∧C 게이트
- ed25519 sig verify = **pass**
- content-binding: ticket_id / prod_ref / migration_sha256(f1ded39e..) / migration_version(20260810120001) 전건 일치
- TTL: 미만료

## POSTCHECK
### ① has_widen = true ×2
- fn_selfcheckin_reservation_banner: has_widen=**true** ✅
- fn_selfcheckin_today_reservations: has_widen=**true** ✅

### ② SECDEF / search_path / owner / ACL 불변 (array_to_json 원소 대조)
| fn | prosecdef | owner | search_path | anon EXECUTE | authenticated EXECUTE |
|----|----|----|----|----|----|
| banner | true ✅ | postgres ✅ | `search_path=public, pg_temp` ✅ | true ✅ | true ✅ |
| today  | true ✅ | postgres ✅ | `search_path=""` ✅ | true ✅ | true ✅ |

(주: 최초 러너 실행 시 today search_path 항목이 1건 FAIL 로 출력되었으나, 이는 `proconfig::text`
배열 이스케이프(`\"`)에 대한 리터럴 정규식 false-negative 였음. `array_to_json` 원소 대조로
`search_path=""` 불변을 확정 검증 — 실질 invariant 위반 아님. 러너 assertion 을 견고화하여 커밋.)

### ③ cross-clinic 누수 = 0
| clinic_id | sample date | leak | returned |
|----|----|----|----|
| 74967aea-a60b-4da3-a0e7-9c997a930bc8 | 2026-09-14 | **0** | 1 |
→ cross-clinic leak 합계 = **0** (returned>0 = 실데이터 유의미 표본). scope(clinic_id+date) 불변 실증.

### ④ ledger 20260810120001 단건 기재
```
[{"version":"20260810120001","name":"foot_selfcheckin_status_widen","created_by":"dev-foot:T-20260810-foot-SELFCHECKIN-RPC-STATUS-WIDEN"}]
```
- 20260810120001 단건 ✅ / 구 slot 20260810120000 미기재(정합) ✅

### ⑤ apply 후 신 prosrc md5 (DA C19 canonical 갱신용)
| fn | new prosrc md5 |
|----|----|
| fn_selfcheckin_reservation_banner | `ed99e7a5b6a91237c3d0525892d821a0` |
| fn_selfcheckin_today_reservations | `6c1f8a5cdc235476ebe44066a552add7` |

## 결론
prod apply 완료 · POSTCHECK 실질 전건 PASS. false-empty(체크인 전이 후 배너/명단 소실) 교정 반영.
supervisor 사후검증 + deployed 전환 + DA C19 canonical md5 갱신 통지 대기.
