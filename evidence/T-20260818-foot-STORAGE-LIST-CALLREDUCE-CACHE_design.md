# T-20260818-foot-STORAGE-LIST-CALLREDUCE-CACHE — 설계안 (design-first)

owner: dev-foot · status: **DESIGN — planner 검토 대기** (구현 미착수)
근거: 부모 P0 T-20260818-foot-NEWRESV-CUSTOMER-CREATE-STATEMENT-TIMEOUT 진단서
전제: 이전 긴급조치 커밋 `1d786326` (T-...-STORAGELIST-EMERGENCY-COMPUTE-RELIEF-HOTFIX) 존재

---

## 1. photos `.list()` 호출 census (read-only·증거기반)

`grep '\.list('` src 전수 + `cachedStorageList(` 사용처 대조 결과. **photos 버킷 `.list()` 호출부 = 총 10개 site (6 파일)**.

| # | 파일:라인 | 화면 | 트리거 | 캐시 경유? |
|---|-----------|------|--------|:---:|
| 1 | CustomerChartPage.tsx:756 | 고객차트 사진섹션 A | mount/useEffect | ✅ cachedStorageList |
| 2 | CustomerChartPage.tsx:986 | 고객차트 사진섹션 B | mount/useEffect | ✅ cachedStorageList |
| 3 | CustomerChartPage.tsx:1463 | 고객차트 사진섹션 C | mount/useEffect | ✅ cachedStorageList |
| 4 | CheckInDetailSheet.tsx:315 | 체크인 상세시트 | 시트 오픈마다 | ✅ cachedStorageList |
| 5 | **MedicalChartPanel.tsx:2255** | 진료차트 사진목록 | mount/리렌더 | ❌ **직접 `.list()`** |
| 6 | **MedicalChartPanel.tsx:2285** | 진료차트 펜차트목록 | mount/리렌더 | ❌ **직접 `.list()`** |
| 7 | **PenChartTab.tsx:1345** | 펜차트탭 저장목록 | mount/탭전환 | ❌ **직접 `.list()`** |
| 8 | **PenChartTab.tsx:3436** | 펜차트 첨부목록 | stem별 조회 | ❌ **직접 `.list()`** |
| 9 | **InsuranceDocPanel.tsx:68** | 보험서류 패널(×3 prefix 인스턴스) | mount/useEffect | ❌ **직접 `.list()`** |
| 10 | **PenChartAttachPanel.tsx:108** | 펜차트 첨부 패널 | mount/useEffect | ❌ **직접 `.list()`** |
| (참고) | forms/DocumentViewer.tsx:72 | 서류뷰어 | mount | ❌ 직접 — **documents 버킷** (photos 아님, 저빈도, 대상외) |

### 핵심 발견
- **긴급 HOTFIX(`1d786326`)는 `cachedStorageList` 래퍼 + `invalidateStorageList` 무효화를 만들었으나 2개 화면(CustomerChartPage·CheckInDetailSheet)에만 배선**했다.
- **부모 진단서가 지목한 최다기여 핫패스 화면(MedicalChartPanel·PenChartTab·InsuranceDocPanel)은 여전히 직접 `.list()`로 캐시를 완전 우회** 중이다 → storage.search 잔여 폭주의 주 진원.
- 이들 화면은 태블릿에서 mount/remount·탭전환·시트 재오픈이 잦고(진단서 (b)(c) 항목), 한 차트에 여러 섹션이 동시 mount(진단서 (a)) → 잔여 폭주가 이 6개 site에 집중.
- InsuranceDocPanel은 한 화면에서 prefix가 다른 인스턴스 여러 개가 각각 `.list()` → 실측 호출 배수.

> 빈도 정량: 코드경로상 site당 **화면 mount·리렌더·탭전환·시트 재오픈마다 1회**이며 dedup/캐시 미적용. 절대 calls/min 은 구현 후 before/after 계측(AC1)으로 실측한다(추정 금지).

---

## 2. 완화 옵션 비교표

| 축 | (A) 클라 캐시 잔여배선 완결 | (B) DB manifest (storage.objects 미러) | (C) 혼합 |
|----|----|----|----|
| 방식 | 기존 `cachedStorageList`/`invalidateStorageList`를 미배선 6개 site에 확장 | photos 객체를 미러하는 조회테이블/뷰 신설, `.list()` API 자체 제거 | 핫패스만 manifest, 나머지 캐시 |
| storage.search 부하감축 | **큼** (30s TTL 창 내 중복·동시 mount collapse). 잔여 폭주 6 site 제거 시 대부분 해소 | **최대** (list API 상시 미호출). 단 미러 동기화 트리거가 별도 write 부하 유발 | 큼~최대 |
| 구현비용 | **낮음** — 이미 검증된 래퍼 재사용. site당 import 교체 + upload/delete 경로 `invalidateStorageList` 배선 | **높음** — 신규 테이블/뷰 + storage.objects→미러 동기화(트리거/RPC) + FE 조회소스 전환 + signed URL 발급경로 재정합 | 중~높음 |
| db_change | **없음 (db_change=false 유지)** | **있음 → MIG-GATE** (mig_* 4필드 + dry-run + 롤백 + DA CONSULT + supervisor DB-GATE GO-token) | 있음 (B 부분 포함) |
| 회귀리스크 | **낮음** — 동일 시맨틱(`{data:files}` 보존), 사진 표시 behavior 불변. 30s TTL로 신규분 지연은 upload 후 invalidate로 해소 | **중~높음** — 조회소스 전환 = 사진 표시 behavior 변경. 미러 stale·동기화 누락 시 사진 누락/유령 위험 | 중 |
| 신규업로드 즉시반영(AC3) | invalidate 배선으로 확보(기존 2화면 검증됨) | 미러 동기화 지연 설계 필요(트리거 즉시성) | 혼재 |
| 착수 게이트 | 낮음 (단, MedicalChartPanel = 의사영역 → §3 참조) | 높음 (MIG-GATE + DA CONSULT) | 높음 |

---

## 3. dev-foot 권고 + 게이트 플래그

### 권고: **(A) 클라 캐시 잔여배선 완결** 우선 채택
- 근거: 긴급 HOTFIX가 이미 (A) 메커니즘을 채택·검증했고, **잔여 폭주는 "래퍼 미배선 6개 site" 라는 구조적 미완결에서 발생**. (A) 완결만으로 AC1(호출 유의감소)·AC2(회귀0)·AC3(즉시반영)을 db_change 없이 저위험으로 달성 가능.
- (B) DB manifest는 상시부하 최저이나 회귀리스크·구현비용·MIG-GATE 부담이 크고, (A) 완결 후 before/after 실측에서 잔여 폭주가 여전히 유의하면 그때 (C) 혼합으로 핫패스만 승격하는 **단계적 접근**을 제안. (A) 선행 → 재측정 → (필요시) B/C.

### ⚠ 게이트 플래그 — planner 판단 요청 (착수 전 필수)
- **MedicalChartPanel.tsx (site #5·#6) = 진료차트 = 의사 전용 영역**(프롬프트 §11 / §11.1). 본 티켓 frontmatter에 `medical_confirm_gate` 필드가 **없음**.
- (A) 완결은 진료차트 화면의 `.list()` 를 캐시 래퍼로 교체 = MedicalChartPanel 코드 touch. 순수 read-path 성능 래퍼(behavior 보존)이나, §11 규정상 **"게이트 필드 없는데 진료관리 코드를 건드리면 추정 착수 금지"**.
- **요청**: (a) MedicalChartPanel 2개 site를 본 티켓 scope에서 제외하고 별도 게이트 티켓으로 분리할지, 또는 (b) 본 티켓에 `medical_confirm_gate: required` 부여 후 문원장 confirm 경유할지 planner가 결정. 나머지 4개 site(PenChartTab·InsuranceDocPanel·PenChartAttachPanel)는 비의료 영역 → 게이트 무관, 즉시 진행 가능.

---

## 4. 구현 계획 (planner 옵션 택1·게이트 해소 후)

(A) 채택 시 site별 작업:
1. `import { cachedStorageList, invalidateStorageList } from '@/lib/photoUrl'` 추가
2. `supabase.storage.from('photos').list(path, opts)` → `cachedStorageList('photos', path, opts)` 교체 (`{data:files}` → `files` 시맨틱 정합)
3. 각 화면의 upload/delete 경로에 `invalidateStorageList('photos', path)` 배선 (AC3)
4. 대상: PenChartTab ×2, InsuranceDocPanel, PenChartAttachPanel (+ 게이트 해소 시 MedicalChartPanel ×2)

## 5. 검증 (AC)
- **AC1**: storage.search calls/avg-ms before(3.5M 기준)/after 재측정 — 배포 후 pg_stat_statements 실측 evidence
- **AC2**: 전 대상 화면 사진 목록·썸네일 렌더 회귀0 — E2E `tests/e2e/T-20260818-foot-STORAGE-LIST-CALLREDUCE-CACHE.spec.ts` (시나리오1)
- **AC3**: 신규 업로드 직후 목록 즉시반영(invalidate 정상) + 사진0장 빈목록 정상 (시나리오2)
- **AC4**: (B/C 채택 시에만) db_change=true 전환 + DA CONSULT + MIG-GATE
