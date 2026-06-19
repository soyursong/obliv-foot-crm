# T-20260619-foot-CLINICMGMT-ACCESS-DUALROLE-FINAL — AC-1 착수 전 enumerate (read-only)

조사일: 2026-06-19 / dev-foot / prod DB rxlomoozakkjesdqjtvd (read-only) + 소스 정독.
판정: **코드 미변경 + planner 회신(narrow 재확인)**. 티켓 명시 escalation 게이트(★) 2조건 모두 발동.

## AC-1 ① 실제 라우트 (확정)

- 진료관리 canon = `/admin/clinic-management` → `<ClinicManagement>` (App.tsx L226). **존재 확정.**
- `/admin/doctor-tools` = **"진료 대시보드"**(DoctorTools, App.tsx L229 / AdminLayout L98). 현장초안 "doctor-tools"는 미검증 추정이 아니라 **실재**하며 의사영역 대시보드. → 티켓 "진료대시보드도 의사영역이면 동일 게이트" 대상.
- 진료관리 top-level 메뉴는 제거됨(AdminLayout L100-102) → Services.tsx 서브탭 + App.tsx 직접 라우트 2경로로 도달.

### 현재 게이트 5곳 (라이브 canon)
| # | 위치 | 현재 값 |
|---|------|---------|
| 1 | App.tsx L226 `/admin/clinic-management` RoleGuard | `['admin','manager','director','consultant','coordinator','therapist']` |
| 2 | App.tsx L229 `/admin/doctor-tools` RoleGuard | `['admin','manager','director','therapist','technician','part_lead','consultant','coordinator']` |
| 3 | Services.tsx L239 `canViewClinicMgmt` | `!!profile?.role` (전직원, STAFF-OPEN 7fed414) |
| 4 | AdminLayout L98 '진료 대시보드' 메뉴 roles | `['admin','manager','director','consultant','coordinator','therapist']` |
| 5 | ClinicManagement.tsx L44 `isAdmin`(금기증 편집) | `role==='admin'` |

## AC-1 ② role 스키마 (확정: single-role)

- `UserRole`(types.ts:78) = 단일 enum 10종: `admin·manager·director·part_lead·consultant·coordinator·therapist·technician·tm·staff`.
- `RoleGuard`(ProtectedRoute.tsx:34) = `roles.includes(profile.role)` — **profile.role은 단일 값**.
- `profile.role` 출처 = `user_profiles.role`(auth.tsx:32 `from('user_profiles')`). staff.role은 듀티로스터/autoAssign용으로 auth 무관.
- **결론: 'director(원장) AND admin(어드민) 동시보유'는 single-role 스키마상 한 유저로 표현 불가.**

## AC-1 ③ 현재 role 분포 (prod 실측, 41 profiles)

```
admin: 12,  manager: 1,  director: 0,  therapist: 12,
consultant: 4,  coordinator: 7,  tm: 3,  staff: 2
```

- **director 보유자 = 0명** (user_profiles 전체에 director 없음).
- **admin 보유자 = 12명**: 백승민·김다인·**김주연(총괄)**·정용현·이광현·정혜인·테스트관리자·dev-foot-test·오세빈·박민지·**김승현(대표)**·**문지은(mne@yonsei.ac.kr)**.
- **문지은 = role `admin`** (director 아님). access_tier=admin. user_profiles.id `d343769a-493a-49c9-b718-4c92c6f5db9a`.
- **총괄 김주연 = role `admin`** (manager 아님!). 유일한 manager = "QA테스트" 계정.

## 핵심 모순 (티켓 전제 vs 실측)

| 티켓 전제 | 실측 | 영향 |
|-----------|------|------|
| 문지은 = doctor AND admin 동시보유 | 문지은 = admin 단일(12인 중 1) / director 0명 | director 요구 predicate = **0명 매칭 → 문지은 본인 lock-out(AC-4 치명)** |
| 총괄 = manager → admin-gate로 차단 | 총괄 김주연 = **admin** | admin-gate로 총괄 **차단 불가**(차단 모호 ★) |
| 대상 = {문지은 1인} | admin = 12인(총괄·대표·devs·test 포함) | admin-only gate = 12인 over-grant, "그 외 전원 차단" 미충족 |

→ **single-role profile.role 위 어떤 predicate도 {문지은 1인}을 정확히 산출 불가.**
- `director && admin` → 항상 false → 전원(문지은 포함) lock-out.
- `director` → 0명 → 전원 lock-out.
- `admin` → 12명 → 총괄·대표·devs 포함 over-grant.

## MUNJIEUN-ROLE-DIRECTOR 의존성 (AC-4)

문지은을 director로 만드는 선행 티켓 `T-20260619-foot-STAFF-MOONJIEUN-ROLE-DIRECTOR` = **status: blocked**.
- publish_opinion_doc RPC prod 미배포 + admin→director 전환 시 8개 admin기능 회귀(직원등록·CSV·고객삭제·패키지·서비스·클리닉편집·설정·예약). → 단순 role 치환 금지 판정됨.
- 즉 "role 인식 안정화" 선행 미충족 → director 기반 게이트 적용 시 문지은 본인 lock-out 위험 현실.

## 판정 & 권고안 (planner 결정 요청)

티켓 ★게이트("스키마상 의도 안전 표현 불가 **또는** 총괄 admin 보유로 차단 모호") **2조건 모두 충족** → Phase A 즉시 적용 금지, narrow 재확인 회신.

- **A안 (FE-only, 즉시 가능 / 권고 — '1인' 의도 정확)**: `/admin/clinic-management`·`/admin/doctor-tools` 접근을 **유저 신원 allowlist**(user_profiles.id `d343769a-493a-49c9-b718-4c92c6f5db9a` 또는 email `mne@yonsei.ac.kr`)로 게이트. DB 미접촉, {문지은 1인} 정확 달성. 단 role 기반 아닌 신원 기반 — 인사이동 시 코드 수정 필요. 신원 canon 확정 필요.
- **B안 (role 정합, 무거움)**: MUNJIEUN-ROLE-DIRECTOR B안(마이그 배포 + admin 8게이트 director-parity + 문지은→director) 선행 후 director 게이트. blocked 티켓 해소·E2E·supervisor 게이트 필요 → P1 즉시 불가.
- **C안 (스키마 확장)**: is_doctor/is_admin 다중 플래그 도입 → data-architect CONSULT·DDL. P1 범위 초과.

**dev-foot 권고: A안(신원 allowlist) 또는 B안 중 planner 택1 + 문지은 canonical 신원 확정.** ★코드 미변경 상태 유지 — 추정 패치 시 문지은 lock-out 또는 12인 over-grant 둘 중 하나 확정 사고.

---

# AC-1 #2 (★핵심★) — 진료관리 콘텐츠 분류 (PUSH MSG-20260619-184052-ewqg 응답)

조사일: 2026-06-19 / dev-foot / 소스 정독(ClinicManagement.tsx·DoctorTools.tsx·Services.tsx) + STAFF-OPEN 티켓.
판정: **AC-2 게이트 코드 HOLD 준수(미변경). 본 분류는 분류 게이트 입력값.**

## #1 라우트/컴포넌트 구성 (clinic-management vs doctor-tools 별개 확정)

| surface | route | 컴포넌트 | PHI 포함? | 성격 |
|---------|-------|----------|----------|------|
| **진료관리** | `/admin/clinic-management` | `ClinicManagement` | **없음** | 의료 마스터/템플릿 **설정** 12탭. 환자 행 0. |
| **진료대시보드** | `/admin/doctor-tools` | `DoctorTools`(내부 `DoctorCallDashboard` 등) | **있음** | 실 환자 진료 동선 4탭. |

→ **별개의 두 화면**. `DoctorCallDashboard`는 doctor-tools(진료대시보드) 안 컴포넌트이지 clinic-management가 아님. 티켓 전제 "진료대시보드도 의사영역이면 동일 게이트"는 doctor-tools를 가리킴.

## #2 ★ 진료관리(ClinicManagement) 12탭 (가)의료 vs (나)비의료운영 분류

> **결정적 발견: 진료관리 12탭은 전부 "의료 도메인 마스터/템플릿 설정"이며 PHI 행이 없다. 예약·접수·카테고리·직원 같은 비의료 운영 config는 이 화면에 존재하지 않음** — 이미 서비스목록/상용구관리/직원관리/예약관리 등 다른 surface로 분리 이전됨(PHRASEMGMT-SUBTAB-SPLIT로 일반상용구·수가세트·고객차트상용구 → 상용구관리, 카테고리/서비스 → 서비스목록).

### (가) 의료 콘텐츠 — 의사/의료권한이 정의 (의사전용 차단 무리없음) — 11탭
| 탭(value) | 라벨 | 근거 | 현재 추가게이트 |
|-----------|------|------|----------------|
| diagnosis_names | 상병명 관리 | 진단명 마스터(services '상병' SSOT 공유) | 전직원 |
| diagnosis_sets | 묶음상병 | 진료차트 일괄적용 진단세트 | 전직원 |
| drug_folders | 처방세트(+급여여부) | 약품분류·처방 마스터·HIRA | 전직원 |
| prescriptions | 묶음처방 | posology 보유 처방 묶음 | 전직원 |
| quick_rx | 빠른처방 | 처방 단축버튼 | 전직원 |
| contraindications | 금기증 관리 | 임상 금기 마스터 | **admin only(기존)** |
| treatment_sets | 진료세트 | 진료 항목 세트 | 전직원 |
| progress_plans | 경과분석 플랜 | 임상 경과 추적 플랜 | 전직원 |
| medchart_phrases | 상용구(진료차트) | phrase_type=medical_chart 임상경과 입력. 소스주석 "진료관리는 의사 전용 공간(문지은 대표원장 동의)" | 전직원 |
| opinion_phrases | 소견서 상용구 | 소견서 자동삽입 멘트 | **admin/manager only(기존)** |
| documents | 서류 템플릿 | 소견서/진단서 등 의료문서 템플릿 | 전직원 |

### (나) 비의료 운영 — 비의료직원이 운영상 편집/참조 — 0~1탭(경계)
| 탭(value) | 라벨 | 판정 |
|-----------|------|------|
| super_phrases | 슈퍼상용구 | **★경계★** — 라벨상 범용 텍스트 숏컷 성격이나 진료관리 surface 내 위치. 비의료직원 운영 사용 여부 = **대표원장/현장 확인 필요**. 이것만 (나) 가능성. |

→ **진료관리 = 사실상 12/12 의료 콘텐츠**. "진료관리 전체 의사전용 차단" 시 비의료 운영 동선 단절 리스크는 **낮음**(예약/접수/카테고리/직원 config가 이 화면에 없음). 단 2개만 확인 필요:
- (a) 슈퍼상용구가 비의료직원 운영 텍스트 숏컷인지.
- (b) 비의료직원(접수/코디/치료사)이 위 의료 마스터를 **read(참조)**하는 운영 동선이 있는지(편집 아닌 조회). STAFF-OPEN 티켓상 "직원 진입 후 일부 패널 RLS로 비어보여도 무파손 OK"였던 점 → 데이터 RLS가 이미 staff SELECT를 막고 있을 가능성 높음(=read 동선도 실질 없음). prod RLS 실측은 후속 검증 권고.

## #3 진료대시보드(DoctorTools) 4탭 분류 — PHI 있음

| 탭(value) | 라벨 | 분류 |
|-----------|------|------|
| call_dashboard | 진료 알림판 | **PHI + 운영 호출동선 혼재** — 호출/처방/차팅/진료완료 통합. 소스주석 "전체 공개 운영 화면". ★치료사/코디가 호출 흐름에 관여할 수 있어 전면차단 시 호출동선 영향 확인 필요. |
| patient_list | 진료 환자 목록 | PHI — 진료콜 명단 고객 처방현황 |
| koh_report | 균검사지(KOH) | PHI — 환자 검사 명단 |
| opinion_doc | 소견서 | PHI — 금일 내방객 + 소견서 작성 |

→ 진료대시보드는 (가)PHI 화면. 단 **진료 알림판(call_dashboard)** 만은 임상 호출 운영동선이 섞여 있어, 의사전용 전면차단 시 치료사/코디 호출 흐름 영향을 대표원장께 확인 필요.

## 대표원장 정밀 확인 질문 입력값 (planner/supervisor용 요약)

1. **진료관리(12탭)**: 전부 의료 마스터 → "진료관리 전체를 원장님 전용으로" 무리 적음. 단 슈퍼상용구·비의료 read 동선 2건만 확인.
2. **진료대시보드(4탭)**: PHI 화면 → 의사전용 적합. 단 **진료 알림판**은 호출 운영동선 혼재 → "알림판까지 막을지 / 알림판은 운영용 열어둘지" 분기 확인.
3. 게이트 predicate 한계는 위 §AC-1 ①②③ 그대로(single-role상 {문지은 1인} 정확 산출 불가 → A안 신원 allowlist or B안 role정합 선행).

★ App.tsx RoleGuard / Services.tsx canViewClinicMgmt / AdminLayout 메뉴 게이트 **코드 미변경 유지**. prod 베이스라인 35bc7ee8(read-open + write=director|admin) resting state 보존. 확정 predicate + 알림판 분기 회신 후 Phase A 착수.
