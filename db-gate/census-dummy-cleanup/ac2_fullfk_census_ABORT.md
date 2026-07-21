# AC-2 §4-B — FULL-FK §2-0 CENSUS → ABORT (net-loss divergence from DA POSTCHECK)

Ticket: T-20260721-foot-TEST-DUMMY-CLEANUP (AC-2, db_change) · Branch: `db-gate/T-20260721-foot-TEST-DUMMY-CLEANUP-C2-CLEAR`
Trigger: planner NEW-TASK MSG-20260721-150330-u0wr (§4-B 경량 apply, dry-run 무영속 착수). POSTCHECK 하드요구 = 순소실 9 cust + 6 ci + 7 status_transitions.
Author: dev-foot · 2026-07-21 KST · **READ-ONLY (실 DELETE·dry-run trial 미실행). prod 무변경.**

---

## 결론: ABORT + 재보고 (planner POSTCHECK 하드요구 위반 사전 검출)

§4-B dry-run 무영속 apply 착수 전, **Orphan-Archive SOP §2-0(자식 FK 손열거 금지, 카탈로그 기계열거 필수)** 에 따라
`customers`·`check_ins` 를 참조하는 **전 FK 를 pg_constraint 기계열거**하여 freeze-scope 자식 census 를 전수했다.

그 결과, **DA 선언 순소실(9/6/7)·off-git 스냅샷에 미포함된 CASCADE 자식 2종**이 발견됨:

| child.col | freeze-매칭 행 | confdeltype | DA net-loss 포함? | 스냅샷 포함? |
|---|---|---|---|---|
| `check_ins.customer_id` | 6 | a (NO ACTION) | ✅ (freeze 대상 자체) | ✅ |
| `status_transitions.check_in_id` | 7 | **c (CASCADE)** | ✅ | ✅ |
| **`assignment_actions.check_in_id`** | **7** | **c (CASCADE)** | ❌ **미포함** | ❌ **미포함** |
| **`check_in_room_logs.check_in_id`** | **1** | **c (CASCADE)** | ❌ **미포함** | ❌ **미포함** |

전 FK 스캔 상 위 4개 외 freeze-매칭 자식은 **0행**(RESTRICT `r`·SET NULL `n`·CASCADE `c`·NO ACTION `a` 전체 확인).
`assignment_actions`·`check_in_room_logs`·`status_transitions` 를 참조하는 **손자 FK 는 0**(전이 CASCADE closure 종결).

## 실제 전-cascade 순소실 (기계열거 기준)

```
9  customers
6  check_ins
7  status_transitions        (CASCADE)
7  assignment_actions        (CASCADE) ← DA net-loss 미포함
1  check_in_room_logs        (CASCADE) ← DA net-loss 미포함
────
30 rows (DA 선언 22 = 9+6+7 대비 +8)
```

`DELETE FROM check_ins` 실행 시 위 CASCADE 8행이 **조용히 동반 삭제**된다(§2-0-b: CASCADE = silent 순소실 유발자).
→ planner POSTCHECK 하드요구(순소실 정확히 9/6/7)와 **어긋남 → 착수 지침대로 abort**.
→ 추가로, 8행이 **off-git 스냅샷에 부재** = `no-snapshot-no-delete`(§4-B 통제①) 위반 = 복원성 결손.

## 8행 = 픽스처 부산물 확증 (실데이터 아님)

READ-ONLY 실측 (off-git `snapshot_cascade_collateral_2026-07-21.json` 동봉):
- `assignment_actions` 7행: `action_type` 대부분 `auto_assign`(칸반 단계이동 자동배정) + `manual` 1건. `created_at` 2026-07-13~07-20 야간 ~18:00 UTC(=03:00 KST cron) window = nightly kanban-drag 픽스처와 동일 상관.
- `check_in_room_logs` 1행: `assigned_room=C1`, 픽스처 check_in `cc1842dc` 링크, `logged_at` 07-14 06:44(동일 픽스처 manual 배정 시각과 일치).
- → 임상가치 0·실환자 무관. **freeze 셋에 포함되어 함께 정리되는 것이 옳음**(잔류 시 대시보드 부산물 재발 소지). 단 그 결정·net-loss 재선언은 DA 소관.

## 왜 사전 preflight 가 놓쳤나 (재발 방지)

기존 preflight(commit 3e519b96)는 자식 census 를 **7개 테이블 손열거**(payments/service_charges/package_payments/insurance_claims/form_submissions/medical_charts/reservations)로 수행 → `assignment_actions`·`check_in_room_logs` **누락**.
이는 §2-0 이 명시적으로 금지하는 **손열거 undercount** 사고(선례 WS-C: 손열거 2종 vs 실측 6 FK 8행)의 재현이며, 본 full-FK 기계열거가 이를 검출.
→ 교훈: 자식 census 는 **항상 pg_constraint 전 FK 기계열거**. 신규 dry-run 러너에 동적 census(전 FK loop) 배선 완료(본 커밋).

## 권고 (DA 재adjudication 요청 — planner 경유)

1. **freeze/net-loss 확장**: 순소실을 **9 cust + 6 ci + 7 st + 7 assignment_actions + 1 check_in_room_logs = 30** 으로 재선언.
   - off-git 스냅샷은 **이미 8행 추가 확보 완료**(READ-ONLY, `snapshot_cascade_collateral_2026-07-21.json`) → no-snapshot-no-delete 재충족 준비됨.
   - 재-GO 시 dry-run 러너는 동적 full-FK census + net-loss 30 assertion 으로 즉시 진행 가능.
2. 확장 net-loss 확정 후에만 §4-B dry-run 무영속 apply 재착수.

**실 DELETE·파괴적 dry-run trial 미실행. prod 무변경. deploy-ready 미마킹. supervisor QA 미인계.**
