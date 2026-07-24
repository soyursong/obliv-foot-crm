# T-20260724-foot-ASSIGN-KIMJUYEON-TODAY-TESTDATA-DEL — RE-DRY-RUN + FREEZE 리포트

- 생성: 2026-07-24 (재-dry-run, 아침 stale 스냅샷 폐기)
- 모드: **READ-ONLY (WRITE 0)** — hard-DELETE 미실행. planner 승인 게이트 대기.
- 스코프 확정 근거: 김주연 총괄 회신 thread reply_ts=1784890087.134809
- clinic: 오블리브의원 서울오리진점 (74967aea-a60b-4da3-a0e7-9c997a930bc8)
- 김주연 staff id: 10eacaa8-fa6b-4615-8bf1-02b4f49cb6ed (consultant)
- KST 경계: 2026-07-24 00:00 ~ 23:59 (+09:00)

## (A) 박민석 취소 배정 — freeze 8건 (ledger 무접점, 삭제 clean)
차트 F-4790, 전부 status=cancelled, visit_type=new.

| check_in_id | assignment_action_id(auto_assign→김주연) | 시각(UTC) |
|---|---|---|
| 9fa4be59-2b48-47f7-beed-561d5483377d | 13bd2631-a8c1-4596-9264-e5ba923677d7 | 02:14 |
| 32c1431c-23e9-465b-8575-164f8a763ee3 | 920baee0-fe0a-4413-bebf-183ea00742a8 | 02:41 |
| 4c0f40b6-e674-473d-bb48-0f5bb7757ad9 | 90610d28-62f3-4fb0-9894-45a393bcf911 | 03:51 |
| 4a406e80-16f4-428e-8f8e-6fa08e0bdc9a | 213e46e4-7455-4596-a2ee-71d27f092634 | 05:29 |

payments/service_charges/package_sessions = 0 (probe 확인). → 원장 무접점.

## (B) 서류테스트2 완료건 — FULL FK 폐포 (★스코프 초과 발견)
차트 F-5113, check_in 7f3f8b79-eb3d-45f2-afab-205d52bc4a70, status=done.

| 종류 | 건수 | id | 비고 |
|---|---|---|---|
| check_ins | 1 | 7f3f8b79 | 완료건 본체 |
| payments | 4 | 3fc1f13f, 69090734(각 payment) / a7343e08, 6319a7bc(각 refund) | 각 8,800 card, 합계 35,200원 (net 0: 결제2·환불2) — **planner 명시 스코프** |
| service_charges | 2 | 6ffa7bf5, 3b972fa1 | ★매출 명세 원장. base 18,840 + 10,535, copay 5,600+3,100. is_insurance_covered=true |
| package_sessions | 1 | 88040473 | ★패키지 회차 (session#1 unheated_laser, used, unit 300,000) |
| assignment_actions | 2 | 914fb71f(consult→김주연), 0627a6b3(therapy→치료사 5fb3e3b1) | consult 1 + therapy 1 |
| 연결 package | 1 | 01ddef31 | "AF레이저", **memo="테스트용 환불예정"**, paid_amount=0, status=active. 이 회차 삭제 시 회차0 orphan |

## (C) KEEP — 삭제 금지 (freeze 에서 명시 제외, disjoint 검증 ✅)
김주연 → 김지윤(c23d4491)·강경민(6ab26d9f) 인계 audit + 해당 실환자(민병수·이효숙·백흥기) 기록.
정상 담당자변경 이력이므로 무접점. (오늘자 KEEP 상담사 관련 assignment_actions 10건 전량 제외)

## ★ 스코프 결정 필요 (planner 승인 게이트)
planner 확정 스코프는 (B)에 대해 **"완료건 + 연결 payments 4건"** 만 명시 열거함.
그러나 "완료건"(check_in) 을 FK-safe 하게 삭제하려면 아래도 동반 삭제 필요:
1. **service_charges 2건** (매출 명세 원장 — payments 와 별개 grain)
2. **package_sessions 1건** + 그로 인해 **회차0 orphan 되는 test package 01ddef31 "AF레이저 테스트용 환불예정"**
3. assignment_actions 2건 (therapy role 포함 — 아침 스냅샷은 consult 1건만 인지)

→ 전량 서류테스트2 테스트 데이터(패키지 memo="테스트용 환불예정")로 판단되나, **매출 명세 원장 + 패키지(foot 1급)** 접촉이므로 dev 임의 확대 금지. planner 확인 후 진행.

## FK-safe 삭제 순서 (승인 시 Phase 2)
payments → service_charges → package_sessions → assignment_actions → check_ins → (orphan package 01ddef31, 승인 시)
각 단계 rows-affected = freeze count 정확 일치 검증. freeze-set(id 명시)으로만 DELETE, 필터 재실행 금지.

## 산출물
- FREEZE: scripts/..._FREEZE.json (freeze셋 + 원값 + decision_flags)
- ARCHIVE: scripts/..._ARCHIVE.json (before-snapshot 전체 원값 — 복구경로)
- 이 리포트: scripts/..._DRYRUN_REPORT.md
