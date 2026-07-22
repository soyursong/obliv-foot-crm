# T-20260722-foot-KIMJONGMIN-CONSULT-OWNER-CORRECT — 대상 특정 + 상태 스냅샷 (read-only)
조사시각: 2026-07-22 (KST) / prod ref rxlomoozakkjesdqjtvd
※ PHI-redaction: 환자 참조는 UUID-PK only (phi_redaction_standard §4.3). 실명·phone 미기록.

## 대상 특정 (AC-4)
- customers: 대상 고객 = customer_id=9669f2c4-a490-41f8-885b-dc89ca54b46b (chart F-4568) → 정확히 1건
- 동명이인: 없음 (name 정확일치 1건, 부분일치(LIKE)도 1건)

## 정본 상담 담당자 (AC-1) — check_ins.consultant_id
- check_in_id=c391f00b-c3ba-4860-9d15-d4a7f03bba0f (금일 초진 new, status=done, checked_in_at=2026-07-22T00:43:42Z)
- consultant_id = b311593d-9e46-4ac8-9424-6b0fa1689a06 (staff=목표 상담자, consultant, active)  ✅ 이미 목표값
- 오배정 대상 staff_id=6ab26d9f-fd10-4042-9fd7-076f277be5d4 → 정본 필드/고객 레코드 어디에도 없음

## 참고: customers staff-ref
- assigned_staff_id = b311593d (role='데스크') / assigned_consultant_id = null / designated_therapist_id = null

## assignment_actions 감사로그 (audit-only, 표시 owner 아님)
- 00:50:39 role=consult axis=TM manual to=6ab26d9f  ← 잔존(방식 라벨용). 표시 owner는 consultant_id.
- 01:14:43 role=therapy auto_assign / 01:17:49 role=therapy manual

## 결론
- AC-1(오배정 staff→목표 staff, 영속) 이미 충족. Option 1(UI 재선택) 안전경로로 기 정정된 상태로 판단.
- 정본이 이미 목표값 → 파괴적 write no-op, 미수행(회귀 0, AC-2). 롤백 대상 없음(AC-3 n/a).
- assignment_actions 감사 divergence는 상위 티켓 T-20260722-foot-CONSULT-ASSIGN-CHART-OWNER-SYNC(양방향 연동) 영역.

## staff id 매핑 (직원 식별 — 비-환자, 운영 식별 목적)
- b311593d-9e46-4ac8-9424-6b0fa1689a06 = 목표 상담자(엄경은)
- 6ab26d9f-fd10-4042-9fd7-076f277be5d4 = 오배정 상담자(강경민, 금일 휴무)
