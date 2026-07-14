# T-20260713-foot-NAME-ALIAS-BACKFILL — INDEPENDENT READ-BACK evidence (AC-B5, supervisor QA)

> **독립 read-back 증빙.** supervisor FIX-REQUEST(MSG-20260714-210711-usiw, qa_fail=insufficient_verification) 대응.
> apply.mjs 와 **독립된 fresh 쿼리**(`scripts/T-20260713-foot-NAME-ALIAS-BACKFILL_readback.mjs`)로 prod 현재상태 재조회.
> READ-ONLY (UPDATE/DDL 0). PHI 위생: name=성1자+길이 마스킹(콘솔 원문 미출력, 실명 미커밋).

## 실행 정보
- **프로젝트**: `rxlomoozakkjesdqjtvd` (foot prod) — URL `https://rxlomoozakkjesdqjtvd.supabase.co`
- **실행시각(UTC)**: 2026-07-14T14:57:24Z (= KST 07-14 23:57)
- **러너**: `scripts/T-20260713-foot-NAME-ALIAS-BACKFILL_readback.mjs` (신규, apply 스크립트와 분리된 독립 조회 경로)
- **인증**: `SUPABASE_CRM_FOOT_SERVICE` (foot service role) — apply 시점과 무관하게 재조회.

## [1] customers 복원 대상 (id=ac65896b) — ✅ 본명 반영 확인
| 필드 | 값 (마스킹) | 판정 |
|---|---|---|
| `name` | **임○○ (3자)** | ✅ 별칭 `Ok`(ascii 2자) → 본명(한글 3자) 복원 확인 |
| `phone` tail | 4470 | 앵커 일치 |
| `lead_source` | NULL | 불변 ✅ (AC-F4 앵커 주의 정합) |
| `is_simulation` | false | 불변 ✅ |
| `created_at` | 2026-07-08T03:01:06.456668+00:00 | 불변 ✅ (7/8) |
| `updated_at` | 2026-07-14T10:23:52.982939+00:00 | 정정시각 상승 ✅ (= deployed_at 실측) |

**판정: ✅ 본명 복원됨 (name≠`Ok`, 3자).**

## [2] reservations 트리거 캐스케이드 (customer_id=ac65896b, 1건) — ✅ 자동 동기화 확인
| | reservation id(8) | `customer_name` | synced(==customers.name) | source_system | status |
|---|---|---|---|---|---|
| ★앵커 | **7ceffb46** | **임○○ (3자)** | ✅ | dopamine | confirmed |

- **앵커 `7ceffb46` 존재 = ✅**, `customer_name`이 customers.name과 **동기화 = ✅**.
- 트리거 `fn_sync_customer_name` 재캐스케이드로 예약 `customer_name`이 별칭→본명 자동 정상화 확인.

## [3] check_ins 캐스케이드 대상 — ✅ 0건 (freeze 정합)
- `check_ins` where `customer_id=ac65896b` → **0건**. 캐스케이드 대상 없음(freeze 스냅샷과 정합).

## [4] apply 제외 2행 (AC-B4 no-action) — ✅ 불변 확인
| phone tail | id(8) | `name` (마스킹) | 처리 |
|---|---|---|---|
| 2932 | 5bcf3bd9 | D○…(13자, 외국인 2-token 실명) | **미교정 확정 그대로** — 불변 ✅ |
| 0180 | 151fc672 | K○…(13자, 외국인 2-token 실명) | **미교정 확정 그대로** — 불변 ✅ |

> 현장(박민지 TM팀장) "그대로" 확정 → no-action 종결. 별칭 아님, UPDATE 0.

## 결론
- **AC-B5 독립 read-back = PASS.** `customers.ac65896b.name` 및 `reservations.7ceffb46.customer_name` 모두 본명(임○○, 3자)으로 반영됨을 apply 경로와 독립된 fresh 쿼리로 재확인.
- 무손상(lead_source/is_simulation/created_at/source_system/status 불변, updated_at만 정정시각 상승), 제외 2행 불변, check_ins 0건, 원장 무접점 확인.
- 재현: `SUPABASE_SERVICE_ROLE_KEY=<foot service> node scripts/T-20260713-foot-NAME-ALIAS-BACKFILL_readback.mjs` (READ-ONLY, supervisor 독립 재실행 가능).
