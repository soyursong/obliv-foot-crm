# T-20260623-foot-STATS-TREATMENT-EXIT-WINDOW — AC3 dry-run 검증 증거

- **DB**: rxlomoozakkjesdqjtvd (obliv-foot-crm PROD), dry-run = BEGIN→apply→ROLLBACK (PROD 쓰기 0건)
- **마이그**: `20260623130000_foot_therapist_stats_treatment_exit_window.sql(.GATE_HOLD)`
- **스크립트**: `scripts/T-20260623-foot-STATS-TREATMENT-EXIT-WINDOW_apply.mjs`
- **실측 시각**: 2026-06-23
- **베이스**: summary=20260623120000(roster·designated 10컬럼), services=20260622120000(roster×4종 grid 6컬럼). 측정창 종료 `to_status='laser'` → `from_status='preconditioning'` 한 줄만 정정(원형 0612 재적용 아님).

## dry-run 결과 (전 클리닉, 2026-01-01~today)

| 단계 | summary treat | summary avg_min | designated | services rows | services linked |
|------|--------------|-----------------|-----------|--------------|-----------------|
| 적용 전 (laser-end) | 11 | 9.9 | 12/168 | 44 | 11 |
| dry-run (치료실퇴실) | 14 | 43.9 | 12/168 | 44 | 14 |
| 롤백 후 (laser-end 원복) | 11 | 9.9 | 12/168 | 44 | 11 |

## 검증 판정
- ✅ **시그니처 불변**: summary 10컬럼·services 6컬럼 유지(CREATE OR REPLACE, DROP 불요).
- ✅ **숫자 이동 확인**: treatment_count +3(11→14), 평균치료시간 9.9→43.9분(coverage 14.7→37.3 방향·배율 일치 — 측정창·표본 차이로 절대치만 상이). → AC5 현장 사전고지 필수성 확인.
- ✅ **2PHANTOM 회귀 0**: designated 12/168 불변(roster·designated·정밀매칭 lineage 보존). services grid 44행 불변.
- ✅ **무결성**: designated_count ≤ total_checkin_count 전행 통과(integ_bad=0).
- ✅ **롤백 정합**: ROLLBACK 후 laser-end 수치(11/9.9/11) 정확 원복 → rollback.sql 신뢰.

## 게이트 상태 (티켓 L59-64, "4개 모두 통과 후에만 적용")
- AC1 product(김주연 B) — ✅ RESOLVED, status approved (NEW-TASK MSG-20260623-083433-dijv, confirm MSG-20260623-082814-wrfs)
- AC2 DA CONSULT — ✅ 사전 종결 MSG-20260623-032609-hs8z
- AC3 구현+dry-run — ✅ 본 증거 (B 확정 후 2026-06-23 재검증: 11→14 / 9.9→43.9 / desig 12·168 불변 동일 재현, PROD 미적용 .GATE_HOLD 유지)
- AC4 supervisor DDL-diff — ▶ 자료 준비 완료 (`_ac4_ddldiff.md`), supervisor 검증 대기
- AC5 필드 숫자변동 사전고지(responder→김주연, 적용일·"평균치료시간 약 4배↑=치료실 전체 체류 포착, 정의 개선" 문구) — ⏳ planner 핸드오프 (사전고지 트리거 요청)
- → AC4+AC5 통과 후 dev-foot가 `.GATE_HOLD` 제거 → `--apply` → 커밋 → status:deployed. supervisor AC4 drift 0 검증.

## ★ AC5 PROD apply HARD GATE
실제 PROD COMMIT 직전 김주연 총괄 confirm 필수. **사전고지 confirm 전 PROD COMMIT 금지.**
숫자변동 고지값(dry-run 실측): 평균치료시간 9.9→43.9분(약 4.4배↑), treatment_count +3(11→14), windowable↑.
(coverage 실측치 14.7→37.3분과 절대값 상이 = 측정창·표본 범위 차이. 현장 고지는 "약 4배 수준↑, 정의 개선(치료실 전체 체류 포착)"으로.)
