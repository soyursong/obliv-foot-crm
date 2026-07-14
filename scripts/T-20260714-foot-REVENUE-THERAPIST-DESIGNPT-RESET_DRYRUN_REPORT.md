# T-20260714-foot-REVENUE-THERAPIST-DESIGNPT-RESET — AC-1 DRY-RUN REPORT

- captured_by: agent-fdd-dev-foot
- target: `customers.designated_therapist_id IS NOT NULL` → `NULL`
- **dry-run count (변경 대상 row): 13건**
- distinct 치료사(지정 보유): 7명
- customers 전체: 358건 (UPDATE 후 총건수 불변 예정 — DELETE 아님, SET NULL)
- clinic_id 분포: {"74967aea-a60b-4da3-a0e7-9c997a930bc8":13}
- 스냅샷(롤백근거): scripts/T-20260714-foot-REVENUE-THERAPIST-DESIGNPT-RESET_snapshot.json (13 rows)

## 치료사별 현재 지정환자수 (초기화 시 전원 0)
| 치료사 | role | active | 지정환자수 |
|--------|------|--------|-----------|
| 김규리 | therapist | true | 3 |
| 임별 | therapist | true | 2 |
| 박소예 | therapist | true | 2 |
| 최민지 | therapist | true | 2 |
| 서은정 | therapist | true | 2 |
| 최다혜 | therapist | true | 1 |
| 조선미 | therapist | true | 1 |

## 실행 계획 (AC-3, confirm 후)
```sql
UPDATE customers SET designated_therapist_id = NULL WHERE designated_therapist_id IS NOT NULL;
-- expected affected rows = 13
```

## 롤백 SQL (스냅샷 기반 복원)
```sql
-- snapshot.json rows 각각에 대해:
-- UPDATE customers SET designated_therapist_id = '<orig>' WHERE id = '<id>';
-- (apply 스크립트가 스냅샷에서 자동 생성)
```
