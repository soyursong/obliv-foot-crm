// ProgressTargetsSection.tsx — 치료테이블 §③ '경과분석' (당일 대상자 리스트)
// Ticket: T-20260629-foot-PROGRESSANALYSIS-RELOCATE-TREATBL [변경2]
//   배경: 예약관리에 붙어 있던 '경과분석 ON/OFF 필터'를 회수하고([변경1]), '오늘 경과분석 대상자를 한눈에 보는 동선'을
//         치료테이블 전용 탭으로 재배치. 같은 reporter(김주연 총괄)·같은 스레드 결정.
//   AC-5: 당일(부모 공통 날짜선택기 기준, 기본=오늘) 경과분석 대상 환자 '리스트'(테이블). 캘린더·일간보기 형태 금지.
//     데이터 = reservations.progress_check_required=TRUE(체크포인트 회차) read-only 집계.
//       progress_check_required/label 은 T-PROGRESS-CHECKPOINT 트리거/플랜(PKGTYPE-DB-BIND, done)이 자동 마킹한 SSOT.
//       본 탭은 그 마킹을 read-only 소비만 — 신규 스키마/트리거 0(db_change=false).
//     컬럼: 환자(이름+차트번호) / 회차(progress_check_label) / 예약시간 / 담당자(registrar_name). 정렬=예약시각 오름차순(치료 흐름순).
//   이름 인터랙션: 좌클릭=2번차트(부모 nameInteraction.onLeftClick→useChart), 우클릭=CRM 컨텍스트 메뉴(부모 onContextMenu) — ExamTargetsSection 과 동일 재사용.
//   방어성: progress_check_required/label 미적용 prod(42703/PGRST204) → 빈 목록 폴백(섹션 무파손). ExamTargetsSection 선례 동일.

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import { supabase } from '@/lib/supabase';
import { useClinic } from '@/hooks/useClinic';
import { useAuth } from '@/lib/auth';
import { hasOpsAuthority, canIssueProgressDocs } from '@/lib/permissions';
import { chartNoBadge, seoulISODate } from '@/lib/format';
import { Loader2, TrendingUp, CalendarDays, CalendarCheck, FileUp, ListChecks, Download, FileText, FileDown, FolderArchive } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/lib/toast';
import { parseFootSites, formatFootSites } from '@/components/FootSiteSelector';
import {
  downloadProgressCsv,
  progressCsvFilename,
  sessionTypeLabel,
  healerCell,
  logProgressCsvExport,
  type ProgressCsvRow,
} from '@/lib/progressTreatmentCsv';
// T-20260811-foot-SONGDO-FORM-DOWNLOAD: 경과분석 대상자 '날짜별 치료이력 txt 다운로드'(예약/접수메모 그대로 출력·소스 A).
//   per-row '치료이력 다운로드' 버튼 → 해당 환자의 예약(방문)별 메모/담당자/룸을 txt로 반출. admin/manager 게이트(CSV와 동일).
import {
  buildProgressTxt,
  progressTxtFilename,
  downloadProgressTxt,
  logProgressTxtExport,
  treatmentTypeMemoLines,
  type ProgressTxtVisit,
} from '@/lib/progressTreatmentTxt';
import type { NameInteraction } from '@/pages/TreatmentTable';
// T-20260701-foot-PROGRESS-DOCISSUE-BTN [Phase 1]: 경과분석 리스트에 발행 관련 버튼 2종 UI 배치.
//   ① 개별 '발행하기'(row별) ② 상단 '일괄처리' + row 체크박스(다건 선택·전체선택·선택개수).
//   Phase 1 = UI/선택상태 관리까지. 실제 서류 발행 로직/문서 생성은 Phase 2(문원장님 서류양식 수령 후).
//   클릭 동작은 placeholder(준비 중 안내 toast). DB 변경 0(DDL0) — 발행 이력/상태 컬럼 미추가.
// T-20260630-foot-TXTABLE-PROGRESS-TAB-WIDGETS: 경과분석 탭 상단 위젯 3종(요약 카드/회차 분포/최근 추이).
//   당일 코호트 rows 를 read-only 로 재사용 + 자체 최근 14일 추이 집계. 기존 대상자 리스트는 그대로(4번째 섹션).
import ProgressAnalyticsWidgets, { parseProgressSession } from '@/components/treatment/ProgressAnalyticsWidgets';
// T-20260702-foot-PROGRESS-CSV-BULKRESULT: 외부분석 결과이미지 일괄업로드→환자 자동매칭·첨부(반대편 반쪽).
//   CSV-export(위)로 내보낸 뒤 외부에서 분석한 결과이미지를 되받아 차트번호 단독조인으로 자동첨부.
//   admin/manager(운영권한, canExportCsv 동일 게이트)에서만 노출. DA-20260718-...-AUTOMATCH 계약.
import ProgressResultBulkUploadDialog from '@/components/treatment/ProgressResultBulkUploadDialog';
// T-20260821-foot-PROGANALYSIS-EXTRACT-PHASE1: 경과분석 인풋 .md 추출(행별) + 전체선택 ZIP.
//   추출·조립 로직 = TXMEMO-3VISIT-MD-ZIP 계보(6MULTIPLE-PROGRESS-MD-ZIP 스크립트) 그대로 이식(재가공 금지).
//   ZIP = 무의존 STORE 조립(새 npm 미추가). read-only 조회만(db_change=false).
import {
  fetchProgressAnalysisData,
  buildProgressAnalysisMd,
  progressAnalysisMdBasename,
  logProgressMdExport,
  downloadMd,
  type ProgressAnalysisPatient,
} from '@/lib/progressAnalysisMd';
import { createStoreZip, downloadZip, type ZipEntry } from '@/lib/progressAnalysisZip';
// T-20260821-foot-PROGANALYSIS-BATCH-EXTRACT-LINK-DIRECTIVE (Phase-2 §4/§5): 경과분석 슬립 상태머신.
//   추출 시점에 [추출대상] 슬립 멱등 생성(reservation_id 1:1 결속키) + 리스트에 상태 컬럼 표시.
//   결과 이미지 연결(§4)은 업로드 다이얼로그에서 슬립 → [업로드대기] 전이. §6 노쇼 자동폐기 트리거는 범위 밖.
import {
  ensureSlip,
  fetchSlipStatesByReservation,
  slipStateLabel,
  slipStateBadgeClass,
  type SlipState,
} from '@/lib/progressSlips';
// T-20260812-foot-PROGCHK-6MULTIPLE-LIST-FILTER: 나열 기준(6배수 도래) 순수 로직 — 필터/라벨/정렬 결정.
import {
  isSixMultipleTarget,
  anticipatedSession,
  sessionCheckpointLabel,
  compareProgressTargets,
  filterD1Targets,
  chunkIds,
  IN_CHUNK_SIZE,
} from '@/lib/progressSixMultiple';

// T-20260701-foot-PROGRESS-LIST-ICON-LABEL-CLEAN: 경과분석 리스트 '회차' 표시 정리(FE-only, DDL0).
//   회차 숫자는 기존 label(progress_check_label) 그대로 매핑 — 표시 문자열만 '{N}회차'로 통일.
//   "N회 중간 경과분석" 등 부가 텍스트 제거. 숫자 추출 실패(레거시/비정형 label) 시 원본 label 폴백(무손실).
function formatSessionLabel(label: string | null | undefined): string {
  const n = parseProgressSession(label);
  if (n != null) return `${n}회차`;
  // 숫자 추출 실패: 비어있지 않은 원본은 그대로, 빈/공백/누락은 '경과분석' 폴백.
  return label && label.trim() ? label : '경과분석';
}

// T-20260814-foot-TREATTABLE-PROGRESSANALYSIS-ERROR: '조회 중 오류가 발생했습니다. Bad Request'(PostgREST 400) 근본원인 수정.
//   T-20260812 나열기준 변경으로 '활성 패키지 전건'을 조회 → package_sessions/customers/reservations 의 .in(...) 목록이
//   운영 누적(수백~수천 pkg/customer)에서 URL 길이 한계를 초과 → 400 Bad Request(list 쿼리 throw → 섹션 전체 오류표시).
//   해결: .in() 을 chunkIds(IN_CHUNK_SIZE) 단위로 분할 조회(선례 visitRecency.ts CHUNK=200 동일).
//   신규 스키마/트리거/write 0(db_change=false).

interface ProgressTargetRow {
  rowKey: string;                     // 고유 행 키(=packageId). 예약 grain 아님(선택·다운로드용 식별자).
  packageId: string;
  customerId: string | null;
  customerName: string;
  chartNumber: string | null;
  phone: string | null;
  label: string | null;              // 회차 (anticipatedSession 기반, 예: "6회 경과분석")
  anticipatedSession: number;        // used_sessions + 1 (6의 배수)
  nextReservationDate: string | null; // 다음 예약일 yyyy-MM-dd (오늘 이후 미취소 최이른). 미예약=null.
  nextReservationTime: string | null; // HH:mm
  nextReservationId: string | null;   // 다음 예약 id — 경과분석 슬립(§4/§5) reservation_id 1:1 결속키.
  registrarName: string | null;       // 다음 예약 등록자 스냅샷
}

// T-20260812-foot-PROGCHK-6MULTIPLE-LIST-FILTER: 나열 기준 변경.
//   FROM: reservations(progress_check_required=true, 예약일=오늘) → 당일 대상자.
//   TO:   활성 패키지 보유 + (used_sessions + 1) % 6 == 0 인 환자 전부 (오늘 예약 여부 무관·미예약 포함).
//   판정 로직 기존 그대로(Reservations.tsx anticipatedSession = used_sessions + 1; 6배수: % 6 == 0).
//   자매 SONGDO-FORM-DOWNLOAD(deployed) 다운로드 버튼 트리거 모집단과 동일 모집단(정합).
//   read-only 조회만 — 신규 스키마/트리거/write 0 (db_change=false).
function useProgressTargets(clinicId: string | null | undefined) {
  return useQuery<ProgressTargetRow[]>({
    queryKey: ['progress_targets_6multiple', clinicId],
    enabled: !!clinicId,
    queryFn: async () => {
      if (!clinicId) return [];

      // 1) 활성 패키지 (경과분석 대상 tier = total_sessions>0; 체험/Re:Born tier 0 배제 — 기존 진행판정 가드 동일).
      const { data: pkgData, error: pkgErr } = await supabase
        .from('packages')
        .select('id, customer_id, total_sessions')
        .eq('clinic_id', clinicId)
        .eq('status', 'active');
      if (pkgErr) throw pkgErr;
      const packages = ((pkgData ?? []) as Array<{ id: string; customer_id: string | null; total_sessions: number | null }>)
        .filter((p) => p.id && p.customer_id && (p.total_sessions ?? 0) > 0);
      if (packages.length === 0) return [];

      // 2) 사용 세션 수(status='used') per package — Reservations.tsx anticipatedSession 카운트 로직과 동일.
      //   T-20260814: pkgIds 다건(활성 패키지 전건) → .in() URL 한계 회피 위해 CHUNK 분할 조회.
      const pkgIds = packages.map((p) => p.id);
      const usedMap = new Map<string, number>();
      for (const slice of chunkIds(pkgIds, IN_CHUNK_SIZE)) {
        const { data: sessData, error: sessErr } = await supabase
          .from('package_sessions')
          .select('package_id')
          .in('package_id', slice)
          .eq('status', 'used');
        if (sessErr) throw sessErr;
        for (const s of (sessData ?? []) as Array<{ package_id: string }>) {
          usedMap.set(s.package_id, (usedMap.get(s.package_id) ?? 0) + 1);
        }
      }

      // 3) 6배수 도래 필터: anticipatedSession = used + 1, anticipatedSession % 6 == 0 (tier 0 배제).
      const targets = packages
        .map((p) => {
          const used = usedMap.get(p.id) ?? 0;
          return {
            packageId: p.id,
            customerId: p.customer_id as string,
            usedSessions: used,
            totalSessions: p.total_sessions,
            anticipatedSession: anticipatedSession(used),
          };
        })
        .filter((t) => isSixMultipleTarget({ usedSessions: t.usedSessions, totalSessions: t.totalSessions }));
      if (targets.length === 0) return [];

      // 4) 고객 메타(이름·차트번호·연락처) 보강(read-only).
      const customerIds = [...new Set(targets.map((t) => t.customerId))];
      const custMap = new Map<string, { name: string; chart: string | null; phone: string | null }>();
      try {
        // T-20260814: customerIds 다건 → .in() CHUNK 분할(URL 한계 회피).
        for (const slice of chunkIds(customerIds, IN_CHUNK_SIZE)) {
          const { data: custs } = await supabase
            .from('customers')
            .select('id, name, chart_number, phone')
            .in('id', slice);
          for (const c of (custs ?? []) as Array<{ id: string; name: string | null; chart_number: string | null; phone: string | null }>) {
            if (c.id) custMap.set(c.id, { name: c.name ?? '—', chart: c.chart_number ?? null, phone: c.phone ?? null });
          }
        }
      } catch {
        // 보강 실패 — 무시(회차/식별자는 정상 표시).
      }

      // 5) 다음 예약(오늘 이후 미취소 최이른) per customer — 정렬/표시용(미예약=null). read-only.
      const today = seoulISODate(new Date());
      const nextResvMap = new Map<string, { id: string | null; date: string; time: string | null; registrar: string | null }>();
      try {
        // T-20260814: customerIds 다건 → .in() CHUNK 분할(URL 한계 회피). 청크별 정렬은 유지되며,
        //   맵은 (customer당) 첫 매칭만 기록하되 더 이른 날짜/시간이 오면 갱신 → 청크 경계 무관 최이른 보장.
        // T-20260821-...-BATCH-EXTRACT-LINK §4/§5: reservation id 도 함께 확보(경과분석 슬립 1:1 결속키).
        for (const slice of chunkIds(customerIds, IN_CHUNK_SIZE)) {
          const { data: resvs } = await supabase
            .from('reservations')
            .select('id, customer_id, reservation_date, reservation_time, registrar_name, status')
            .eq('clinic_id', clinicId)
            .in('customer_id', slice)
            .gte('reservation_date', today)
            .neq('status', 'cancelled')
            .order('reservation_date', { ascending: true })
            .order('reservation_time', { ascending: true });
          for (const rv of (resvs ?? []) as Array<Record<string, unknown>>) {
            const cid = rv['customer_id'] ? String(rv['customer_id']) : '';
            if (!cid) continue;
            const d = String(rv['reservation_date'] ?? '');
            const t = rv['reservation_time'] ? String(rv['reservation_time']).slice(0, 5) : null;
            const prev = nextResvMap.get(cid);
            // 최이른(날짜→시간) 비교. 미기록이거나 더 이른 예약이면 갱신(청크 경계 넘어도 안전).
            if (prev) {
              const prevKey = `${prev.date} ${prev.time ?? ''}`;
              const curKey = `${d} ${t ?? ''}`;
              if (curKey >= prevKey) continue;
            }
            nextResvMap.set(cid, {
              id: rv['id'] ? String(rv['id']) : null,
              date: d,
              time: t,
              registrar: rv['registrar_name'] ? String(rv['registrar_name']) : null,
            });
          }
        }
      } catch {
        // 다음 예약 보강 실패 — 미예약 취급(목록은 유지).
      }

      // 6) row 조립.
      const rows: ProgressTargetRow[] = targets.map((t) => {
        const meta = custMap.get(t.customerId);
        const nr = nextResvMap.get(t.customerId);
        return {
          rowKey: t.packageId,
          packageId: t.packageId,
          customerId: t.customerId,
          customerName: meta?.name ?? '—',
          chartNumber: meta?.chart ?? null,
          phone: meta?.phone ?? null,
          label: sessionCheckpointLabel(t.anticipatedSession),
          anticipatedSession: t.anticipatedSession,
          nextReservationDate: nr?.date ?? null,
          nextReservationTime: nr?.time ?? null,
          nextReservationId: nr?.id ?? null,
          registrarName: nr?.registrar ?? null,
        };
      });

      // 7) 정렬: 다음 예약일 오름차순(NULLS LAST) → 이름순(가나다).
      rows.sort(compareProgressTargets);

      return rows;
    },
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}

function dateLabel(d: string) {
  return format(new Date(d + 'T12:00:00'), 'M월 d일 (EEE)', { locale: ko });
}

interface Props {
  date: string;
  nameInteraction: NameInteraction;
}

export default function ProgressTargetsSection({ date, nameInteraction }: Props) {
  const clinic = useClinic();
  const { profile } = useAuth();
  // T-20260812-foot-PROGCHK-6MULTIPLE-LIST-FILTER: 나열 기준이 예약일(date) 독립으로 변경(활성 패키지 6배수 도래 전부).
  //   date prop 은 하단 위젯(ProgressAnalyticsWidgets)에만 전달 — 리스트 모집단에는 미사용.
  const { data: rows = [], isLoading, isError, error } = useProgressTargets(clinic?.id);

  // T-20260821-foot-PROGANALYSIS-BATCH-EXTRACT-LINK-DIRECTIVE §1 (B안 additive): '내일(D-1)' 필터 토글.
  //   기본뷰 = 배포 canon(예약무관 6배수 도래자 전체) 그대로 유지(축소 아님). 토글 ON 시에만
  //   '다음 예약이 내일'인 대상자로 좁혀 표시 — "전날(D-1) 미리 준비" 동선용. 순수 클라이언트 필터(DB 무관).
  const [d1Only, setD1Only] = useState(false);
  const tomorrowSeoul = useMemo(() => seoulISODate(Date.now() + 86_400_000), []);
  const displayRows = useMemo(
    () => (d1Only ? filterD1Targets(rows, tomorrowSeoul) : rows),
    [d1Only, rows, tomorrowSeoul],
  );
  // 내일 예약 도래 대상 수(토글 배지 표시용) — canon 모집단(rows)에서 파생.
  const d1Count = useMemo(() => filterD1Targets(rows, tomorrowSeoul).length, [rows, tomorrowSeoul]);

  // T-20260702-foot-PROGRESS-CSV-EXPORT: PHI 반출 게이트 — admin/manager(운영권한, 대표원장 포함)만 노출/동작.
  //   경과분석 탭 열람권과 동일 계층. 치료사/일반직원에게는 CSV 버튼 미노출.
  const canExportCsv = hasOpsAuthority(profile);
  // T-20260812-foot-PROGFORM-DOCDASH-DOCWRITE-LISTUP (A안, read/write split): 경과분석지 '발행(write)' 게이트.
  //   발행(개별 발행하기·일괄처리) = 원장(director)+admin/manager 만. 코디/상담/치료사(read-only)에는 미노출.
  //   ★두 surface(치료테이블 경과분석 · 진료대시보드 서류작성 탭)가 동일 컴포넌트를 재사용 → 여기서 게이트 = surface drift 0.
  const canIssue = canIssueProgressDocs(profile);
  // T-20260822-foot-PROGANALYSIS-EXTRACT-DIRECTOR-GATE-FIX: 경과분석 인풋 .md/ZIP 추출 노출 게이트.
  //   추출(.md/ZIP)은 대표원장 본인 문서작업의 read-only 반출(발행 canIssue 와 동일 계층)이며,
  //   대상 데이터는 경과분석 명단에서 이미 열람 중인 것 → 신규 PHI 노출 아님.
  //   ★버그: canExportCsv=hasOpsAuthority(admin/manager only, director 배제)로만 게이트되어
  //     대표원장(문지은, role='director', has_ops_authority 컬럼 미적재)이 '자기요청' 기능을
  //     본인 화면에서 볼 수 없었음(발행 버튼은 canIssue로 노출, 추출만 미노출 = 비대칭).
  //   → 발행 tier(원장+admin/manager)로 확장. 전역 hasOpsAuthority(매출/통계/계정)는 무변경.
  const canExtractProgress = canExportCsv || canIssue;
  // 선택(체크박스)·발행 열은 발행 또는 CSV 반출 권한이 있을 때만 노출. 순수 read 역할(코디/상담/치료사)은 read-only 명단.
  const canSelect = canIssue || canExportCsv;
  const [csvBusy, setCsvBusy] = useState(false);
  // T-20260811-foot-SONGDO-FORM-DOWNLOAD: per-row txt 다운로드 진행 상태(현재 처리 중인 reservationId).
  const [txtBusyId, setTxtBusyId] = useState<string | null>(null);
  // T-20260702-foot-PROGRESS-CSV-BULKRESULT: 결과이미지 일괄업로드 다이얼로그 open 상태.
  const [bulkUploadOpen, setBulkUploadOpen] = useState(false);
  // T-20260821-foot-PROGANALYSIS-EXTRACT-PHASE1: 경과분석 .md 추출 진행상태(행별 rowKey / ZIP).
  const [mdBusyId, setMdBusyId] = useState<string | null>(null);
  const [zipBusy, setZipBusy] = useState(false);
  // T-20260822-foot-PROGANALYSIS-EXTRACT-INDIVIDUAL-MD-BATCH: 선택 전원의 .md 를 ZIP 없이 개별 파일로 일괄 다운로드하는 진행상태.
  const [individualBusy, setIndividualBusy] = useState(false);

  // T-20260821-foot-PROGANALYSIS-BATCH-EXTRACT-LINK-DIRECTIVE (Phase-2 §5): 경과분석 슬립 상태(추출대상/업로드대기/확정).
  //   현재 rows 의 다음 예약 id 로 슬립 상태 배치 조회(reservation_id → state). 슬립 미존재 = '준비 전'.
  const queryClient = useQueryClient();
  const resvIdsForSlips = useMemo(
    () => rows.map((r) => r.nextReservationId).filter(Boolean) as string[],
    [rows],
  );
  const { data: slipStates } = useQuery<Map<string, SlipState>>({
    queryKey: ['progress_slip_states', clinic?.id, [...resvIdsForSlips].sort().join(',')],
    enabled: !!clinic?.id && resvIdsForSlips.length > 0 && (canIssue || canExportCsv),
    queryFn: () => fetchSlipStatesByReservation(supabase, clinic!.id, resvIdsForSlips),
    staleTime: 10_000,
    refetchInterval: 30_000,
  });
  const refreshSlipStates = () => {
    queryClient.invalidateQueries({ queryKey: ['progress_slip_states'] });
  };
  // 추출대상 슬립 멱등 생성(§5) — 인풋 추출 시점('경과분석지 준비')에 호출. best-effort(추출 자체는 무관).
  const ensureSlipForRow = async (r: ProgressTargetRow) => {
    if (!clinic?.id || !r.customerId || !r.nextReservationId || !r.nextReservationDate) return;
    await ensureSlip(supabase, {
      clinicId: clinic.id,
      customerId: r.customerId,
      reservationId: r.nextReservationId,
      chartNo: r.chartNumber,
      sessionOrdinal: r.anticipatedSession,
      visitDate: r.nextReservationDate,
      actorId: profile?.id ?? null,
    });
  };

  // T-20260701-foot-PROGRESS-DOCISSUE-BTN [Phase 1]: 일괄처리 다건 선택 상태.
  //   selectedIds = 현재 리스트에서 체크된 예약 id 집합. 표시된 rows 기준으로만 유효(날짜/코호트 변경 시 교차 정리).
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // 선택/전체선택은 현재 화면에 보이는 행(displayRows) 기준 — D-1 필터 ON 시 보이는 대상만 선택.
  const rowIds = useMemo(() => displayRows.map((r) => r.rowKey), [displayRows]);
  // 현재 rows 에 존재하는 선택만 유효 개수로 카운트(코호트 변경 후 stale 선택 제외).
  const selectedCount = useMemo(
    () => rowIds.filter((id) => selectedIds.has(id)).length,
    [rowIds, selectedIds],
  );
  const allSelected = rowIds.length > 0 && selectedCount === rowIds.length;

  const toggleRow = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      // 전부 선택돼 있으면 해제, 아니면 현재 rows 전체 선택.
      if (rowIds.length > 0 && rowIds.every((id) => prev.has(id))) return new Set();
      return new Set(rowIds);
    });
  };

  // Phase 1 placeholder — 실제 발행 로직은 Phase 2(서류양식 pending). 클릭 시 준비 중 안내만.
  const handleIssueOne = (row: ProgressTargetRow) => {
    toast.confirm(`'${row.customerName}' 발행 기능은 준비 중입니다. (서류 양식 준비 후 제공)`);
  };

  const handleBulkIssue = () => {
    if (selectedCount === 0) {
      toast.warning('먼저 발행할 환자를 선택해 주세요.');
      return;
    }
    toast.confirm(`선택한 ${selectedCount}명 일괄 발행 기능은 준비 중입니다. (서류 양식 준비 후 제공)`);
  };

  // T-20260702-foot-PROGRESS-CSV-EXPORT: 선택 환자 1~N명 → 시술기록 전체 단일 CSV.
  //   grain=환자×방문(시술일)×시술타입 → package_sessions(used) 1건=1행(같은날 병행타입 자동 2행 분리).
  //   각 row 는 자기 package_id FK 로만 join(오매핑 0). 스키마/비즈로직 무변경 read-only 조회.
  const handleCsvExport = async () => {
    if (!canExportCsv) return; // 방어(버튼 미노출이지만 이중 가드).
    // 현재 리스트에서 선택된 예약 row → 대상 고객 id 집합(유효 선택만).
    const selectedRows = rows.filter((r) => selectedIds.has(r.rowKey) && r.customerId);
    const customerIds = [...new Set(selectedRows.map((r) => r.customerId as string))];
    if (customerIds.length === 0) {
      toast.warning('먼저 CSV로 내보낼 환자를 선택해 주세요.');
      return;
    }
    setCsvBusy(true);
    try {
      // 1) 대상 고객의 패키지(총회차·고객 매핑).
      const { data: pkgData, error: pkgErr } = await supabase
        .from('packages')
        .select('id, customer_id, total_sessions')
        .in('customer_id', customerIds);
      if (pkgErr) throw pkgErr;
      const packages = (pkgData ?? []) as Array<{ id: string; customer_id: string; total_sessions: number | null }>;
      const pkgById = new Map(packages.map((p) => [p.id, p]));
      const pkgIds = packages.map((p) => p.id);

      // 2) 시술기록(package_sessions) — used·미삭제만. 각 row=1 시술타입(방문×타입 grain).
      let sessions: Array<Record<string, unknown>> = [];
      if (pkgIds.length > 0) {
        const { data: sData, error: sErr } = await supabase
          .from('package_sessions')
          .select('id, package_id, check_in_id, session_number, session_type, session_date, status, deleted_at')
          .in('package_id', pkgIds)
          .eq('status', 'used')
          .is('deleted_at', null);
        if (sErr) throw sErr;
        sessions = (sData ?? []) as Array<Record<string, unknown>>;
      }

      // 3) 고객 메타(차트번호·이름).
      const { data: custData } = await supabase
        .from('customers')
        .select('id, chart_number, name')
        .in('id', customerIds);
      const custById = new Map(
        ((custData ?? []) as Array<{ id: string; chart_number: string | null; name: string | null }>).map((c) => [c.id, c]),
      );

      // 4) 시술부위(check_ins.treatment_memo.foot_sites) + 힐러(reservations.is_healer_intent) — FK 연결분만.
      const checkInIds = [...new Set(sessions.map((s) => s['check_in_id']).filter(Boolean) as string[])];
      const ciById = new Map<string, { treatment_memo: unknown; reservation_id: string | null }>();
      if (checkInIds.length > 0) {
        const { data: ciData } = await supabase
          .from('check_ins')
          .select('id, treatment_memo, reservation_id')
          .in('id', checkInIds);
        for (const c of (ciData ?? []) as Array<{ id: string; treatment_memo: unknown; reservation_id: string | null }>) {
          ciById.set(c.id, { treatment_memo: c.treatment_memo, reservation_id: c.reservation_id });
        }
      }
      const resvIds = [...new Set([...ciById.values()].map((c) => c.reservation_id).filter(Boolean) as string[])];
      const healerByResv = new Map<string, boolean>();
      if (resvIds.length > 0) {
        const { data: rData } = await supabase
          .from('reservations')
          .select('id, is_healer_intent')
          .in('id', resvIds);
        for (const rv of (rData ?? []) as Array<{ id: string; is_healer_intent: boolean | null }>) {
          healerByResv.set(rv.id, rv.is_healer_intent === true);
        }
      }

      // 5) row 조립.
      const footSitesFromMemo = (memo: unknown): string => {
        try {
          const m = typeof memo === 'string' ? JSON.parse(memo) : memo;
          const obj = (m ?? {}) as Record<string, unknown>;
          // 다중선택(foot_sites 배열) 우선, 없으면 단일(foot_site) 폴백.
          const raw = obj['foot_sites'] ?? (obj['foot_site'] ? [obj['foot_site']] : null);
          return formatFootSites(parseFootSites(raw));
        } catch {
          return '';
        }
      };

      const csvRows: ProgressCsvRow[] = sessions.map((s) => {
        const pkg = pkgById.get(String(s['package_id'] ?? ''));
        const cust = pkg ? custById.get(pkg.customer_id) : undefined;
        const sessionType = s['session_type'] ? String(s['session_type']) : '';
        const sessionDate = s['session_date'] ? String(s['session_date']) : '';
        const ci = s['check_in_id'] ? ciById.get(String(s['check_in_id'])) : undefined;
        const isHealer = ci?.reservation_id ? (healerByResv.get(ci.reservation_id) ?? false) : null;
        return {
          차트번호: cust?.chart_number ?? '',
          환자명: cust?.name ?? '',
          시술일: sessionDate,
          시술타입: sessionTypeLabel(sessionType),
          세션번호: typeof s['session_number'] === 'number' ? (s['session_number'] as number) : '',
          총회차: pkg?.total_sessions ?? '',
          시술부위: ci ? footSitesFromMemo(ci.treatment_memo) : '',
          힐러적용여부: healerCell(sessionType, sessionDate, isHealer),
        };
      });

      // 정렬: 차트번호 → 시술일 → 세션번호(치료 흐름·환자 묶음 가독성).
      csvRows.sort((a, b) => {
        const c = String(a.차트번호).localeCompare(String(b.차트번호));
        if (c !== 0) return c;
        const d = String(a.시술일).localeCompare(String(b.시술일));
        if (d !== 0) return d;
        return Number(a.세션번호 || 0) - Number(b.세션번호 || 0);
      });

      if (csvRows.length === 0) {
        toast.warning('선택한 환자의 시술기록이 없습니다.');
        return;
      }

      // PHI 반출 감사로그(필수 AC) — 다운로드 직전 기록.
      logProgressCsvExport({
        actor: profile?.email ?? profile?.id ?? null,
        actorRole: profile?.role ?? null,
        clinicId: clinic?.id ?? null,
        patientCount: customerIds.length,
        rowCount: csvRows.length,
        chartNumbers: csvRows.map((r) => (r.차트번호 ? String(r.차트번호) : null)),
      });

      downloadProgressCsv(csvRows, progressCsvFilename());
      toast.confirm(`선택 ${customerIds.length}명 · 시술기록 ${csvRows.length}건 CSV를 내려받았습니다.`);
    } catch (e) {
      toast.error(`CSV 내보내기 실패: ${(e as Error)?.message ?? '알 수 없는 오류'}`);
    } finally {
      setCsvBusy(false);
    }
  };

  // T-20260811-foot-SONGDO-FORM-DOWNLOAD: 단일 환자의 날짜별 치료이력(예약/접수메모 그대로) → txt 다운로드.
  //   소스 (A) 확정 — 예약(reservations)·접수(check_ins) 메모 텍스트를 파싱없이 원문 나열. read-only 조회만(DDL0).
  const handleTxtExport = async (row: ProgressTargetRow) => {
    if (!canExportCsv) return; // 방어(버튼 미노출이지만 이중 가드).
    if (!row.customerId) {
      toast.warning('고객 정보가 없어 치료이력을 내려받을 수 없습니다.');
      return;
    }
    if (!clinic?.id) return;
    setTxtBusyId(row.rowKey);
    try {
      // 1) 고객 메타(차트번호·이름) — 헤더/파일명용. 실패 시 리스트 스냅샷 폴백.
      let chartNumber = row.chartNumber;
      let name = row.customerName;
      try {
        const { data: cust } = await supabase
          .from('customers')
          .select('id, chart_number, name')
          .eq('id', row.customerId)
          .maybeSingle();
        if (cust) {
          chartNumber = (cust as { chart_number: string | null }).chart_number ?? chartNumber;
          name = (cust as { name: string | null }).name ?? name;
        }
      } catch {
        // 메타 보강 실패 — 리스트 스냅샷 유지.
      }

      // 2) 예약(방문) 이력 — 취소 제외, 날짜/시간 오름차순. ADDITIVE 메모 컬럼 미적용 prod 폴백.
      const FULL_SEL =
        'id, reservation_date, reservation_time, registrar_name, memo, booking_memo, brief_note';
      const CORE_SEL = 'id, reservation_date, reservation_time, registrar_name';
      const runResvQuery = (sel: string) =>
        supabase
          .from('reservations')
          .select(sel)
          .eq('clinic_id', clinic.id)
          .eq('customer_id', row.customerId!)
          .neq('status', 'cancelled')
          .order('reservation_date', { ascending: true })
          .order('reservation_time', { ascending: true });
      let resvRows: Array<Record<string, unknown>> = [];
      {
        const { data, error } = await runResvQuery(FULL_SEL);
        if (error) {
          if (/booking_memo|brief_note|memo|registrar_name|42703|PGRST204/.test(error.message ?? '')) {
            const retry = await runResvQuery(CORE_SEL);
            if (retry.error) throw retry.error;
            resvRows = (retry.data ?? []) as unknown as Array<Record<string, unknown>>;
          } else {
            throw error;
          }
        } else {
          resvRows = (data ?? []) as unknown as Array<Record<string, unknown>>;
        }
      }

      // 3) 접수(check_ins) — 룸 + 접수/시술 메모. reservation_id FK 연결분만(read-only).
      //   T-20260817-foot-TREATHIST-DOWNLOAD-MISSING-FIELDS: 신규 필드(치료종류·PC유무) 소스 보강.
      //     · id                  = package_sessions.check_in_id 조인 키(치료종류 소스).
      //     · preconditioning_done = 방문 단위 PC(프리컨디셔닝) boolean(펜차트 자동기록 필드) — PC유무 OR-병합.
      //   ADDITIVE 컬럼(preconditioning_done) 미적용 prod → id/메모는 유지하는 폴백(예약 메모 쿼리와 동일 방어).
      const resvIds = resvRows.map((r) => String(r['id'] ?? '')).filter(Boolean);
      const ciByResv = new Map<string, Record<string, unknown>>();
      const checkInIds: string[] = [];
      if (resvIds.length > 0) {
        const CI_FULL =
          'id, reservation_id, treatment_room, laser_room, consultation_room, examination_room, ' +
          'treatment_memo, notes, treatment_kind, treatment_contents, preconditioning_done';
        const CI_CORE =
          'id, reservation_id, treatment_room, laser_room, consultation_room, examination_room, ' +
          'treatment_memo, notes, treatment_kind, treatment_contents';
        const runCiQuery = (sel: string) =>
          supabase.from('check_ins').select(sel).in('reservation_id', resvIds);
        try {
          let ciData: Array<Record<string, unknown>> = [];
          const { data, error } = await runCiQuery(CI_FULL);
          if (error) {
            if (/preconditioning_done|42703|PGRST204/.test(error.message ?? '')) {
              const retry = await runCiQuery(CI_CORE);
              if (retry.error) throw retry.error;
              ciData = (retry.data ?? []) as unknown as Array<Record<string, unknown>>;
            } else {
              throw error;
            }
          } else {
            ciData = (data ?? []) as unknown as Array<Record<string, unknown>>;
          }
          for (const c of ciData) {
            const rid = c['reservation_id'] ? String(c['reservation_id']) : '';
            if (rid) ciByResv.set(rid, c);
            const cid = c['id'] ? String(c['id']) : '';
            if (cid) checkInIds.push(cid);
          }
        } catch {
          // 접수 보강 실패 — 예약 메모만으로 계속.
        }
      }

      // 3b) 펜차트 자동기록 시술타입(package_sessions.session_type) — check_in FK 연결·used·미삭제만(read-only).
      //   치료종류(비가열/가열/포돌로게 등) + PC(프리컨디셔닝) 유무 파생 canonical 소스.
      //   CSV export(progressTreatmentCsv)와 동일 소스·라벨(SESSION_TYPE_LABEL) 재사용 → 두 다운로드 정합.
      const sessionTypesByCheckIn = new Map<string, string[]>();
      const uniqueCheckInIds = [...new Set(checkInIds)];
      if (uniqueCheckInIds.length > 0) {
        try {
          const { data: psData } = await supabase
            .from('package_sessions')
            .select('check_in_id, session_type, status, deleted_at')
            .in('check_in_id', uniqueCheckInIds)
            .eq('status', 'used')
            .is('deleted_at', null);
          for (const p of (psData ?? []) as Array<Record<string, unknown>>) {
            const cid = p['check_in_id'] ? String(p['check_in_id']) : '';
            const st = p['session_type'] ? String(p['session_type']) : '';
            if (!cid || !st) continue;
            const arr = sessionTypesByCheckIn.get(cid) ?? [];
            arr.push(st);
            sessionTypesByCheckIn.set(cid, arr);
          }
        } catch {
          // 시술타입 보강 실패 — 치료종류/PC 필드만 생략(기존 메모/포맷은 유지).
        }
      }

      // 3c) T-20260817-foot-PRECON-ALLNONE-BUG: PC(프리컨디셔닝) 유무 canonical 소스 = 프리컨디셔닝 스테이지 경유.
      //   부모 배포(0c4307df)는 PC를 session_type='preconditioning'(prod 0건) + preconditioning_done(전건 false·미사용)
      //   에서만 읽어 전 row '없음' 회귀. 실 시행 신호 = status_transitions.to_status='preconditioning' 존재(방문이 프리컨 거침).
      //   read-only. 실패 시 기존 두 축(무데이터) 폴백 — 필드만 '없음', 기존 메모/포맷 무변.
      const preconditionedCheckInIds = new Set<string>();
      if (uniqueCheckInIds.length > 0) {
        try {
          const { data: stData } = await supabase
            .from('status_transitions')
            .select('check_in_id, to_status')
            .in('check_in_id', uniqueCheckInIds)
            .eq('to_status', 'preconditioning');
          for (const s of (stData ?? []) as Array<Record<string, unknown>>) {
            const cid = s['check_in_id'] ? String(s['check_in_id']) : '';
            if (cid) preconditionedCheckInIds.add(cid);
          }
        } catch {
          // 프리컨 스테이지 보강 실패 — PC 필드만 기존 축 폴백.
        }
      }

      // 4) 방문 블록 조립 — 예약/접수 메모를 라벨과 함께 '그대로' 나열.
      const textOf = (v: unknown): string => (v == null ? '' : String(v).trim());
      const pushMemo = (lines: string[], label: string, value: unknown) => {
        const t = textOf(value);
        if (t) lines.push(`${label}: ${t}`);
      };
      const visits: ProgressTxtVisit[] = resvRows.map((r) => {
        const rid = String(r['id'] ?? '');
        const ci = ciByResv.get(rid);
        const room =
          textOf(ci?.['treatment_room']) ||
          textOf(ci?.['laser_room']) ||
          textOf(ci?.['consultation_room']) ||
          textOf(ci?.['examination_room']) ||
          null;

        const memoLines: string[] = [];
        // 예약 메모 3종(그대로).
        pushMemo(memoLines, '예약메모', r['booking_memo']);
        pushMemo(memoLines, '메모', r['memo']);
        pushMemo(memoLines, '간략메모', r['brief_note']);
        // 접수/시술 메모.
        if (ci) {
          const tm = ci['treatment_memo'];
          let tmDetails: unknown = null;
          try {
            const parsed = typeof tm === 'string' ? JSON.parse(tm) : tm;
            tmDetails = (parsed as { details?: unknown } | null)?.details ?? null;
          } catch {
            tmDetails = null;
          }
          pushMemo(memoLines, '접수메모', tmDetails);
          const notes = ci['notes'];
          let notesText: unknown = null;
          try {
            const parsed = typeof notes === 'string' ? JSON.parse(notes) : notes;
            notesText = (parsed as { text?: unknown } | null)?.text ?? null;
          } catch {
            notesText = null;
          }
          pushMemo(memoLines, '접수노트', notesText);
          pushMemo(memoLines, '진료종류', ci['treatment_kind']);
          const contents = ci['treatment_contents'];
          if (Array.isArray(contents) && contents.length > 0) {
            pushMemo(memoLines, '진료내용', contents.map((c) => textOf(c)).filter(Boolean).join(', '));
          }
        }

        // T-20260817-foot-TREATHIST-DOWNLOAD-MISSING-FIELDS: 날짜별 치료종류 + PC(프리컨디셔닝) 유무(신규 필드).
        //   소스=package_sessions.session_type(check_in FK) + check_ins.preconditioning_done. 파생=순수 lib 함수.
        const ciId = ci?.['id'] ? String(ci['id']) : '';
        const sessTypes = ciId ? (sessionTypesByCheckIn.get(ciId) ?? []) : [];
        const pcDone = ci ? ci['preconditioning_done'] === true : undefined;
        // PC 유무 canonical 축 = 프리컨디셔닝 스테이지 경유(status_transitions).
        const pcViaStage = ciId ? preconditionedCheckInIds.has(ciId) : false;
        for (const line of treatmentTypeMemoLines(sessTypes, pcDone, !!ci, pcViaStage)) {
          memoLines.push(line);
        }

        return {
          date: String(r['reservation_date'] ?? ''),
          time: String(r['reservation_time'] ?? '').slice(0, 5),
          registrarName: r['registrar_name'] ? String(r['registrar_name']) : null,
          room,
          memoLines,
        };
      });

      if (visits.length === 0) {
        toast.warning('해당 환자의 치료이력(예약)이 없습니다.');
        return;
      }

      // PHI 반출 감사로그(필수 AC) — 다운로드 직전 기록.
      logProgressTxtExport({
        actor: profile?.email ?? profile?.id ?? null,
        actorRole: profile?.role ?? null,
        clinicId: clinic.id,
        chartNumber: chartNumber ?? null,
        visitCount: visits.length,
      });

      const content = buildProgressTxt({ chartNumber: chartNumber ?? null, name: name ?? null }, visits);
      downloadProgressTxt(content, progressTxtFilename(chartNumber, name));
      toast.confirm(`'${name}' 치료이력 ${visits.length}건을 txt로 내려받았습니다.`);
    } catch (e) {
      toast.error(`치료이력 다운로드 실패: ${(e as Error)?.message ?? '알 수 없는 오류'}`);
    } finally {
      setTxtBusyId(null);
    }
  };

  // T-20260821-foot-PROGANALYSIS-EXTRACT-PHASE1: 행별 경과분석 인풋 .md 다운로드.
  //   내용 = 6MULTIPLE-PROGRESS-MD-ZIP 스크립트 5섹션 로직 그대로(재가공 금지) + 헤더 6배수 예정 회차·예약일.
  //   read-only 조회만. PHI 반출 게이트 = canExtractProgress(원장+admin/manager) + 감사로그.
  const handleMdDownloadRow = async (row: ProgressTargetRow) => {
    if (!canExtractProgress) return; // 방어(버튼 미노출이지만 이중 가드).
    if (!row.customerId) {
      toast.warning('고객 정보가 없어 경과분석 자료를 내려받을 수 없습니다.');
      return;
    }
    if (!clinic?.id) return;
    setMdBusyId(row.rowKey);
    try {
      const today = seoulISODate(new Date());
      const env = await fetchProgressAnalysisData(supabase, clinic.id, [row.customerId], today);
      const patient: ProgressAnalysisPatient = {
        id: row.customerId,
        name: row.customerName,
        chart_number: row.chartNumber,
      };
      const content = buildProgressAnalysisMd(patient, env);
      logProgressMdExport({
        actor: profile?.email ?? profile?.id ?? null,
        actorRole: profile?.role ?? null,
        clinicId: clinic.id,
        patientCount: 1,
        chartNumbers: [row.chartNumber ?? null],
        mode: 'row',
      });
      downloadMd(content, progressAnalysisMdBasename(patient));
      // §5: 인풋 추출 = [추출대상] 슬립 멱등 생성(예약 있는 행만). best-effort.
      await ensureSlipForRow(row);
      refreshSlipStates();
      toast.confirm(`'${row.customerName}' 경과분석 자료(.md)를 내려받았습니다.`);
    } catch (e) {
      toast.error(`경과분석 자료 다운로드 실패: ${(e as Error)?.message ?? '알 수 없는 오류'}`);
    } finally {
      setMdBusyId(null);
    }
  };

  // T-20260821-foot-PROGANALYSIS-EXTRACT-PHASE1: 선택 전원의 경과분석 .md 를 zip 1개로 다운로드.
  //   전체선택/부분선택 = 기존 selectedIds 재사용. 아무도 선택 안 하면 안내(다운로드 미발생).
  const handleZipDownload = async () => {
    if (!canExtractProgress) return; // 방어.
    if (!clinic?.id) return;
    // 현재 rows 에 존재하는 유효 선택만(고객 단위 dedupe — 같은 고객 다중 패키지 행 방지).
    const selectedRows = rows.filter((r) => selectedIds.has(r.rowKey) && r.customerId);
    const seenCust = new Set<string>();
    const patients: ProgressAnalysisPatient[] = [];
    for (const r of selectedRows) {
      const cid = r.customerId as string;
      if (seenCust.has(cid)) continue;
      seenCust.add(cid);
      patients.push({ id: cid, name: r.customerName, chart_number: r.chartNumber });
    }
    if (patients.length === 0) {
      toast.warning('선택된 환자가 없습니다. 먼저 환자를 선택해 주세요.');
      return;
    }
    setZipBusy(true);
    try {
      const today = seoulISODate(new Date());
      const env = await fetchProgressAnalysisData(
        supabase,
        clinic.id,
        patients.map((p) => p.id),
        today,
      );
      // 파일명 dedupe(스크립트 usedNames 규칙 준용) — 동일 {차트}_{이름} 충돌 시 _n 접미.
      const usedNames = new Map<string, number>();
      const entries: ZipEntry[] = patients.map((p) => {
        let base = progressAnalysisMdBasename(p);
        if (usedNames.has(base)) {
          const n = (usedNames.get(base) ?? 1) + 1;
          usedNames.set(base, n);
          base = `${base}_${n}`;
        } else {
          usedNames.set(base, 1);
        }
        return { name: `${base}.md`, content: buildProgressAnalysisMd(p, env) };
      });
      logProgressMdExport({
        actor: profile?.email ?? profile?.id ?? null,
        actorRole: profile?.role ?? null,
        clinicId: clinic.id,
        patientCount: patients.length,
        chartNumbers: patients.map((p) => p.chart_number ?? null),
        mode: 'zip',
      });
      const blob = createStoreZip(entries);
      const zipName = `foot_경과분석_${seoulISODate(new Date()).replace(/-/g, '')}_${patients.length}명`;
      downloadZip(blob, zipName);
      // §5: 추출한 선택 행 전원 [추출대상] 슬립 멱등 생성(예약 있는 행만). best-effort.
      await Promise.all(selectedRows.map((r) => ensureSlipForRow(r)));
      refreshSlipStates();
      toast.confirm(`선택 ${patients.length}명 경과분석 자료를 zip 1개로 내려받았습니다.`);
    } catch (e) {
      toast.error(`ZIP 다운로드 실패: ${(e as Error)?.message ?? '알 수 없는 오류'}`);
    } finally {
      setZipBusy(false);
    }
  };

  // T-20260822-foot-PROGANALYSIS-EXTRACT-INDIVIDUAL-MD-BATCH: 선택 전원의 경과분석 .md 를 ZIP 묶음 없이 각 파일 개별로 일괄 다운로드.
  //   원장 요청("zip 말고 개별 마크다운저장 — zip 풀린형태로 모든 마크다운 일괄다운") = ZIP 대안 채널.
  //   추출/조립 로직·파일명 규칙({차트번호}_{이름}.md) = handleZipDownload 와 완전 동일 재사용(재가공 금지).
  //   차이점: createStoreZip 대신 각 환자 .md 를 순차 downloadMd() 트리거. 브라우저 다중 다운로드 차단 회피를 위해 짧은 간격.
  const handleIndividualDownload = async () => {
    if (!canExtractProgress) return; // 방어(버튼 미노출이지만 이중 가드).
    if (!clinic?.id) return;
    // 현재 rows 에 존재하는 유효 선택만(고객 단위 dedupe — 같은 고객 다중 패키지 행 방지). handleZipDownload 와 동일.
    const selectedRows = rows.filter((r) => selectedIds.has(r.rowKey) && r.customerId);
    const seenCust = new Set<string>();
    const patients: ProgressAnalysisPatient[] = [];
    for (const r of selectedRows) {
      const cid = r.customerId as string;
      if (seenCust.has(cid)) continue;
      seenCust.add(cid);
      patients.push({ id: cid, name: r.customerName, chart_number: r.chartNumber });
    }
    if (patients.length === 0) {
      toast.warning('선택된 환자가 없습니다. 먼저 환자를 선택해 주세요.');
      return;
    }
    setIndividualBusy(true);
    try {
      const today = seoulISODate(new Date());
      const env = await fetchProgressAnalysisData(
        supabase,
        clinic.id,
        patients.map((p) => p.id),
        today,
      );
      // 파일명 dedupe(handleZipDownload 와 동일 규칙) — 동일 {차트}_{이름} 충돌 시 _n 접미. downloadMd 는 .md 를 자동 부착.
      const usedNames = new Map<string, number>();
      logProgressMdExport({
        actor: profile?.email ?? profile?.id ?? null,
        actorRole: profile?.role ?? null,
        clinicId: clinic.id,
        patientCount: patients.length,
        chartNumbers: patients.map((p) => p.chart_number ?? null),
        mode: 'individual',
      });
      for (let i = 0; i < patients.length; i++) {
        const p = patients[i];
        let base = progressAnalysisMdBasename(p);
        if (usedNames.has(base)) {
          const n = (usedNames.get(base) ?? 1) + 1;
          usedNames.set(base, n);
          base = `${base}_${n}`;
        } else {
          usedNames.set(base, 1);
        }
        const content = buildProgressAnalysisMd(p, env);
        downloadMd(content, base);
        // 브라우저 다중 순차 다운로드 차단 회피 — 마지막 파일 제외 짧은 간격.
        if (i < patients.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }
      // §5: 추출한 선택 행 전원 [추출대상] 슬립 멱등 생성(예약 있는 행만). best-effort.
      await Promise.all(selectedRows.map((r) => ensureSlipForRow(r)));
      refreshSlipStates();
      toast.confirm(`선택 ${patients.length}명 경과분석 자료(.md)를 개별 파일로 내려받았습니다.`);
    } catch (e) {
      toast.error(`개별 저장 실패: ${(e as Error)?.message ?? '알 수 없는 오류'}`);
    } finally {
      setIndividualBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4" data-testid="progress-targets-section">
      {/* T-20260701-foot-PROGRESSLIST-TOP-REORDER: 경과분석 대상자 '리스트'를 화면 최상단으로 이동(위젯보다 위).
          위젯/표 섹션(ProgressAnalyticsWidgets)은 제거하지 않고 리스트 아래에 그대로 유지. 순수 렌더 순서 변경(DDL 0). */}
      <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <TrendingUp className="h-4 w-4 text-teal-600" />
            경과분석
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            활성 패키지 보유 환자 중 <span className="font-medium text-foreground">다음 회차가 6의 배수(6·12·18·24…)</span>에
            도래하는 환자 전부를 보여줍니다. 오늘 예약 여부와 무관하며, 미예약 환자도 포함됩니다.
            {d1Only && <span className="ml-1 font-medium text-teal-700">지금은 내일(D-1) 예약 도래자만 표시 중입니다.</span>}
          </p>
        </div>
        {(canExportCsv || rows.length > 0) && (
          <div className="flex shrink-0 items-center gap-2">
            {/* T-20260821-foot-PROGANALYSIS-BATCH-EXTRACT-LINK-DIRECTIVE §1: '내일(D-1)' 필터 토글(additive).
                기본뷰(예약무관 6배수 전체 canon)는 불변 — 토글 ON 시에만 다음 예약이 내일인 대상만 표시. */}
            <Button
              type="button"
              size="sm"
              variant={d1Only ? 'default' : 'outline'}
              onClick={() => setD1Only((v) => !v)}
              title={d1Only ? '전체(예약무관 6배수 도래자) 보기로 전환' : '내일(D-1) 예약 도래자만 보기'}
              aria-pressed={d1Only}
              data-testid="progress-d1-toggle-btn"
            >
              <CalendarCheck className="h-3.5 w-3.5" />
              내일(D-1){d1Count > 0 && <span className="ml-0.5 tabular-nums">{d1Count}</span>}
            </Button>
            {/* T-20260702-foot-PROGRESS-CSV-BULKRESULT: 결과이미지 일괄업로드→자동매칭. 오늘 대상자 유무와 무관하게
                항상 노출(결과지는 방문일과 다른 날 되받을 수 있음). admin/manager(운영권한)만. */}
            {canExportCsv && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setBulkUploadOpen(true)}
                data-testid="progress-result-bulk-open-btn"
              >
                <FileUp className="h-3.5 w-3.5" />
                결과 업로드
              </Button>
            )}
            {/* T-20260701-foot-PROGRESS-DOCISSUE-BTN [Phase 1]: 상단 일괄처리 툴바(선택 개수 + 일괄처리 버튼). */}
            {rows.length > 0 && (
              <>
                {canSelect && selectedCount > 0 && (
                  <span
                    className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-semibold text-neutral-700"
                    data-testid="progress-bulk-selected-count"
                  >
                    선택 {selectedCount}명
                  </span>
                )}
                {/* T-20260812-...-DOCWRITE-LISTUP (A안): 일괄처리(발행 write) = 원장+admin/manager 만. */}
                {canIssue && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleBulkIssue}
                    disabled={selectedCount === 0}
                    data-testid="progress-bulk-action-btn"
                  >
                    <ListChecks className="h-3.5 w-3.5" />
                    일괄처리
                  </Button>
                )}
                {/* T-20260702-foot-PROGRESS-CSV-EXPORT: 선택 환자 시술기록 전체 CSV 다운로드. admin/manager(운영권한)만 노출(PHI 가드). */}
                {canExportCsv && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleCsvExport}
                    disabled={selectedCount === 0 || csvBusy}
                    data-testid="progress-csv-export-btn"
                  >
                    {csvBusy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Download className="h-3.5 w-3.5" />
                    )}
                    CSV 다운로드
                  </Button>
                )}
                {/* T-20260821-foot-PROGANALYSIS-EXTRACT-PHASE1: 우측 상단 전체선택 + ZIP 다운로드(경과분석 인풋 .md).
                    T-20260822-foot-PROGANALYSIS-EXTRACT-DIRECTOR-GATE-FIX: 게이트 = canExtractProgress(원장+admin/manager).
                    대표원장(director) 자기요청 기능 미노출 버그 수정 — 발행 tier 와 동일 계층으로 확장. */}
                {canExtractProgress && (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={toggleSelectAll}
                      data-testid="progress-selectall-btn"
                    >
                      <ListChecks className="h-3.5 w-3.5" />
                      {allSelected ? '선택해제' : '전체선택'}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={handleZipDownload}
                      disabled={selectedCount === 0 || zipBusy}
                      title="선택한 환자의 경과분석 인풋(.md)을 zip 1개로 내려받기"
                      data-testid="progress-md-zip-btn"
                    >
                      {zipBusy ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <FolderArchive className="h-3.5 w-3.5" />
                      )}
                      ZIP 다운로드
                    </Button>
                    {/* T-20260822-foot-PROGANALYSIS-EXTRACT-INDIVIDUAL-MD-BATCH: ZIP 대안 — 선택 전원의 .md 를
                        ZIP 없이 각 파일 개별 다운로드. 게이트/추출 로직/파일명 규칙 = ZIP 버튼과 동일 재사용. */}
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={handleIndividualDownload}
                      disabled={selectedCount === 0 || individualBusy}
                      title="선택한 환자의 경과분석 인풋(.md)을 ZIP 없이 각 파일로 개별 내려받기"
                      data-testid="progress-md-individual-btn"
                    >
                      {individualBusy ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <FileDown className="h-3.5 w-3.5" />
                      )}
                      개별 저장
                    </Button>
                  </>
                )}
                <span
                  className="rounded-full bg-teal-50 px-2.5 py-1 text-xs font-semibold text-teal-700"
                  data-testid="progress-targets-count"
                >
                  {d1Only ? `내일 ${displayRows.length}명 / 전체 ${rows.length}명` : `대상 ${rows.length}명`}
                </span>
              </>
            )}
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : isError ? (
        <div className="rounded-lg border border-dashed border-red-200 bg-red-50/40 p-4 text-center text-sm text-red-600">
          조회 중 오류가 발생했습니다. {(error as Error)?.message ?? ''}
        </div>
      ) : displayRows.length === 0 ? (
        <div
          className="flex flex-col items-center gap-1.5 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground"
          data-testid="progress-targets-empty"
        >
          <TrendingUp className="h-5 w-5 text-muted-foreground/40" />
          {d1Only
            ? '내일(D-1) 6의 배수 예약 도래자가 없습니다.'
            : '6의 배수 회차 도래 경과분석 대상자가 없습니다.'}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-background">
          <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-2.5 py-1.5">
            <span className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
              <CalendarDays className="h-3.5 w-3.5 text-teal-600" />
              {d1Only ? '내일(D-1) 6배수 예약 도래자' : '6배수 회차 도래 대상자'}
            </span>
            <span className="text-[11px] font-medium text-muted-foreground" data-testid="progress-targets-group-count">
              {displayRows.length}명
            </span>
          </div>
          <div className="overflow-x-auto" data-testid="progress-targets-table">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b bg-muted/20 text-left text-[11px] font-semibold text-muted-foreground">
                  {/* T-20260701-foot-PROGRESS-DOCISSUE-BTN [Phase 1]: 전체선택 체크박스
                      T-20260812-...-DOCWRITE-LISTUP (A안): 발행/반출 권한 있을 때만 선택 열 노출(read-only 역할 미노출). */}
                  {canSelect && (
                    <th className="px-2 py-1 whitespace-nowrap">
                      <input
                        type="checkbox"
                        className="h-4 w-4 cursor-pointer accent-teal-600 align-middle"
                        checked={allSelected}
                        onChange={toggleSelectAll}
                        aria-label="전체선택"
                        data-testid="progress-selectall-checkbox"
                      />
                    </th>
                  )}
                  <th className="px-2 py-1 whitespace-nowrap">#</th>
                  <th className="px-2 py-1 whitespace-nowrap">환자</th>
                  <th className="px-2 py-1 whitespace-nowrap">회차</th>
                  <th className="px-2 py-1 whitespace-nowrap">다음 예약</th>
                  <th className="px-2 py-1 whitespace-nowrap">담당자</th>
                  {/* T-20260821-foot-PROGANALYSIS-BATCH-EXTRACT-LINK-DIRECTIVE §5: 경과분석 슬립 상태(추출대상/업로드대기/확정). */}
                  {canSelect && <th className="px-2 py-1 whitespace-nowrap">상태</th>}
                  {/* T-20260701-foot-PROGRESS-DOCISSUE-BTN [Phase 1]: 개별 발행 열 (발행/반출 권한자만) */}
                  {canSelect && <th className="px-2 py-1 whitespace-nowrap text-right">발행</th>}
                </tr>
              </thead>
              <tbody>
                {displayRows.map((r, idx) => (
                  <tr
                    key={r.rowKey}
                    className="border-b last:border-0 transition-colors hover:bg-muted/30"
                    data-testid="progress-targets-row"
                  >
                    {/* T-20260701-foot-PROGRESS-DOCISSUE-BTN [Phase 1]: row 선택 체크박스
                        T-20260812-...-DOCWRITE-LISTUP (A안): 발행/반출 권한자만 선택 셀 노출. */}
                    {canSelect && (
                      <td className="px-2 py-1">
                        <input
                          type="checkbox"
                          className="h-4 w-4 cursor-pointer accent-teal-600 align-middle"
                          checked={selectedIds.has(r.rowKey)}
                          onChange={() => toggleRow(r.rowKey)}
                          aria-label={`${r.customerName} 선택`}
                          data-testid="progress-row-checkbox"
                        />
                      </td>
                    )}
                    <td className="px-2 py-1 text-[11px] tabular-nums text-muted-foreground">{idx + 1}</td>
                    <td className="px-2 py-1 font-medium whitespace-nowrap">
                      {/* 좌클릭=2번차트 / 우클릭=CRM 컨텍스트 메뉴 (부모 nameInteraction 재사용) */}
                      <button
                        type="button"
                        className="inline-flex items-center gap-1.5 rounded px-1 -mx-1 text-left hover:text-teal-700 hover:underline disabled:cursor-default disabled:no-underline disabled:hover:text-inherit"
                        data-testid="progress-name-clickable"
                        disabled={!r.customerId}
                        onClick={() => nameInteraction.onLeftClick(r.customerId)}
                        onContextMenu={(e) => {
                          if (!r.customerId) return;
                          nameInteraction.onContextMenu(e, {
                            id: r.customerId,
                            name: r.customerName,
                            phone: r.phone,
                          });
                        }}
                      >
                        <span>{r.customerName}</span>
                        <span className="font-mono text-[11px] font-normal text-muted-foreground/70">
                          {chartNoBadge(r.chartNumber)}
                        </span>
                      </button>
                    </td>
                    {/* T-20260701-foot-PROGRESS-LIST-ICON-LABEL-CLEAN: 항목 앞 아이콘(TrendingUp) 제거 + 레이블 '{N}회차' 통일. */}
                    <td className="px-2 py-1 whitespace-nowrap" data-testid="progress-label-cell">
                      <span className="inline-flex items-center rounded border border-teal-300 bg-teal-100 px-1.5 py-0.5 text-[11px] font-medium text-teal-800 leading-none">
                        {formatSessionLabel(r.label)}
                      </span>
                    </td>
                    {/* T-20260812-foot-PROGCHK-6MULTIPLE-LIST-FILTER: '예약시간' → '다음 예약(오늘 이후 최이른)'.
                        미예약(다음 예약 없음) 환자는 '미예약' 배지로 표시(정렬상 하단). */}
                    <td className="px-2 py-1 whitespace-nowrap" data-testid="progress-nextresv-cell">
                      {r.nextReservationDate ? (
                        <span className="tabular-nums">
                          {dateLabel(r.nextReservationDate)}
                          {r.nextReservationTime && (
                            <span className="ml-1 text-[11px] text-muted-foreground">{r.nextReservationTime}</span>
                          )}
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] font-medium text-neutral-500">
                          미예약
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1 whitespace-nowrap text-muted-foreground" data-testid="progress-registrar-cell">
                      {r.registrarName ? `@${r.registrarName}` : '—'}
                    </td>
                    {/* T-20260821-foot-PROGANALYSIS-BATCH-EXTRACT-LINK-DIRECTIVE §5: 슬립 상태 배지(예약 있는 행만 결속). */}
                    {canSelect && (
                      <td className="px-2 py-1 whitespace-nowrap" data-testid="progress-slip-state-cell">
                        {(() => {
                          const st = r.nextReservationId ? slipStates?.get(r.nextReservationId) : undefined;
                          return (
                            <span
                              className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium leading-none ${slipStateBadgeClass(st)}`}
                              data-slip-state={st ?? 'none'}
                            >
                              {slipStateLabel(st)}
                            </span>
                          );
                        })()}
                      </td>
                    )}
                    {/* T-20260701-foot-PROGRESS-DOCISSUE-BTN [Phase 1]: 개별 발행하기 버튼(placeholder).
                        T-20260812-...-DOCWRITE-LISTUP (A안): 발행 열은 발행/반출 권한자만(read-only 역할 미노출). */}
                    {canSelect && (
                      <td className="px-2 py-1 whitespace-nowrap text-right">
                        <div className="inline-flex items-center gap-1.5">
                          {/* T-20260811-foot-SONGDO-FORM-DOWNLOAD: 개별 '치료이력 다운로드'(txt) — admin/manager(운영권한)만 노출(PHI 가드). */}
                          {canExportCsv && (
                            <Button
                              type="button"
                              size="xs"
                              variant="outline"
                              onClick={() => handleTxtExport(r)}
                              disabled={txtBusyId === r.rowKey || !r.customerId}
                              title="날짜별 치료이력(예약/접수메모)을 txt 파일로 내려받기"
                              data-testid="progress-txt-download-btn"
                            >
                              {txtBusyId === r.rowKey ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <FileText className="h-3 w-3" />
                              )}
                              치료이력
                            </Button>
                          )}
                          {/* T-20260821-foot-PROGANALYSIS-EXTRACT-PHASE1: 행별 경과분석 인풋 .md 다운로드.
                              T-20260822-foot-PROGANALYSIS-EXTRACT-DIRECTOR-GATE-FIX: 게이트 = canExtractProgress
                              (원장+admin/manager). 대표원장(director) 미노출 버그 수정. 내용=확정 추출로직 그대로 + 6배수 예정일 헤더. */}
                          {canExtractProgress && (
                            <Button
                              type="button"
                              size="xs"
                              variant="outline"
                              onClick={() => handleMdDownloadRow(r)}
                              disabled={mdBusyId === r.rowKey || !r.customerId}
                              title="이 환자의 경과분석 인풋(.md)을 내려받기"
                              data-testid="progress-md-download-btn"
                            >
                              {mdBusyId === r.rowKey ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <FileDown className="h-3 w-3" />
                              )}
                              경과분석
                            </Button>
                          )}
                          {/* 발행(write) = 원장+admin/manager 만. 코디/상담/치료사에는 미노출(A안 read/write split). */}
                          {canIssue && (
                            <Button
                              type="button"
                              size="xs"
                              variant="outline"
                              onClick={() => handleIssueOne(r)}
                              data-testid="progress-issue-btn"
                            >
                              <FileUp className="h-3 w-3" />
                              발행하기
                            </Button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      </div>

      {/* T-20260630-foot-TXTABLE-PROGRESS-TAB-WIDGETS: 상단 위젯 3종(요약 카드/회차 분포/최근 추이) — read-only 집계.
          T-20260701-foot-PROGRESSLIST-TOP-REORDER: 리스트 최상단화에 따라 위젯/표는 리스트 아래로 이동(제거 아님, 순서만). */}
      <ProgressAnalyticsWidgets
        date={date}
        clinicId={clinic?.id}
        cohortRows={rows}
        cohortLoading={isLoading}
      />

      {/* T-20260702-foot-PROGRESS-CSV-BULKRESULT: 결과이미지 일괄업로드→자동매칭 다이얼로그. admin/manager만. */}
      {canExportCsv && (
        <ProgressResultBulkUploadDialog
          open={bulkUploadOpen}
          onOpenChange={setBulkUploadOpen}
          onApplied={refreshSlipStates}
        />
      )}
    </div>
  );
}
