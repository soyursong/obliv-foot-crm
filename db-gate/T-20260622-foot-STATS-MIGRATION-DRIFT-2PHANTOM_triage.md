# T-20260622-foot-STATS-MIGRATION-DRIFT-2PHANTOM — AC1 트리아지 결론

DB: rxlomoozakkjesdqjtvd (obliv-foot-crm)
작성: dev-foot / 2026-06-23

## 진단 (scripts/..._diag.mjs, LIVE 실측)

LIVE `foot_stats_therapist_summary` 현재 정의:
- 반환 **7컬럼** (therapist_id, name, treatment_count, avg_treatment_minutes, experience_total, experience_converted, conversion_rate) — designated 3종 **없음**.
- 측정창 종료 = `to_status='laser'` (레이저 진입). `from_status='preconditioning'`(치료실 퇴실) **아님**.
- 명단 출처 = `roster`(staff role='therapist' AND active) anchor **있음**.

∴ 현재 LIVE = **`20260622120000_..._staff_source_filter`** (STATS-THERAPIST-LOAD-STAFFFILTER, deployed 18393c76) 정의가 베이스.
FE(`src/lib/stats.ts` TherapistSummaryRow, `TherapistStatsSection.tsx` §지표3)는 **10컬럼**(designated_count/total_checkin_count/designated_rate)을 참조 → 현재 지표3 빈값(undefined) 확정.

## phantom 2건의 본질

두 파일 모두 timestamp가 staff_source_filter(20260622120000)보다 **이르고**, **roster 도입 이전(check_ins DISTINCT 기반)** 정의다.
즉 파일을 그대로 forward-apply하면 **현 LIVE의 AC3/AC4(roster 단일소스·재직 치료사 한정)를 회귀**시킨다. → 파일 원형 재적용은 금지.

| phantom | 설계 의도 | 파일 상태 | 결정 |
|---------|----------|----------|------|
| `20260609220000_designated_ratio` (10컬럼, laser-end, **pre-roster**) | 지표3 지정치료사 비율(옵션B, 김주연 2026-06-09 확정). FE가 여전히 참조 | 의도 유효 / 파일 stale(roster 없음) | **forward-apply(기능 유지)** — 단 stale 파일 원형이 아니라 **현 roster 정의 위에 designated 3컬럼을 재구성한 신규 마이그**로 적용. stale 파일은 `.SUPERSEDED`로 무력화 |
| `20260612130000_treatment_exit` (10컬럼, **치료실 퇴실 종료**, pre-roster) | 측정창 종료를 레이저진입→치료실퇴실로 정정(김주연 2026-06-12 의도). 미적용 | 의도 미결 / 파일 stale(roster 없음·정밀매칭 누락 → 회귀 위험) | **이번 티켓 미적용(게이트 보류)** — 측정창 변경=**집계 숫자 이동**(비즈로직). data-architect CONSULT + supervisor DDL-diff + 필드(김주연) 사전고지 게이트 필요. stale 파일은 `.GATE_HOLD`로 무력화 + 별도 게이트 티켓 FOLLOWUP |

## 적용안 (AC2 — designated)

신규 마이그 `20260623120000_foot_therapist_stats_designated_on_roster.sql`:
- 현 LIVE(staff_source_filter) summary 정의를 그대로 베이스 — **roster anchor·laser-end 측정창·check_in_id 정밀매칭+근사 fallback·체험전환율 전부 보존(회귀 0)**.
- `desig_agg` CTE 추가: 분모=roster-filtered base의 전체 check_in, 분자=`c.designated_therapist_id = b.therapist_id` 일치 (옵션B, 김주연 2026-06-09 확정 산식 동일). base가 이미 roster JOIN이므로 designated도 AC4(재직 치료사) 자동 준수.
- 반환 10컬럼 = FE 계약과 정확히 일치. 컬럼 추가 → `DROP FUNCTION` 선행 후 `CREATE`.
- `services` RPC는 **건드리지 않음**(6컬럼, 이미 정상 — split-brain 방지).
- ADDITIVE(read-only 컬럼 추가, 데이터·측정창 무변경) → 숫자 이동 없음 → 필드 사전고지 불요, 대표게이트 면제(autonomy §3.1).

## AC3 — treatment_exit
이번 티켓에서 **미적용**. 별도 게이트 티켓으로 분리(planner FOLLOWUP). stale 파일은 `.GATE_HOLD` 처리.

## AC4 — drift 0
- 적용 후 LIVE summary = 10컬럼 roster laser-end = 신규 마이그 = FE 계약 일치.
- phantom 0: 0609 → `.SUPERSEDED`(신규 마이그가 기능 흡수), 0612 → `.GATE_HOLD`(게이트 대기). 둘 다 applied-set에서 제외 → 차기 fresh replay/배포가 LIVE를 덮어쓰지 않음.
