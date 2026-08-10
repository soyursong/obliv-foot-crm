// KcdDiagnosisField — 건보 청구 상병(KCD) 스태프 캡처 필드
//
// Ticket: T-20260810-foot-INS-CLAIM-DIAGLINK (B-3, NHIS 직접청구 SSOT plan_nhis_direct_claim_launch)
//   문제: insurance_claim_diagnoses=0건. 발톱은 급여 상병(KCD)을 청구에 실을 스태프 캡처면 부재
//        (차트 49건 中 KCD 4건). 유일 입력면=DiagnosisFolderPicker→의사 진료차트(§11 gate) 종속.
//   해법: check_ins.kcd_code(방문 단위, body 20260515000010 패턴 이식)에 스태프가 KCD 코드를 캡처.
//        B-2 claim 생성 시 이 값 → insurance_claim_diagnoses 로 복사(런타임 join=B-2 이후).
//
// ★ KCD 발명 금지: foot 정적 KCD 번들(kcdData.ts)에서 '검색→선택'한 코드만 저장.
//   자유 텍스트/자동 추론 저장 경로 없음(isKnownKcdCode 저장 직전 방어).
// ★ 미입력 → '상병 결핍' 표식(급여 청구 성립 불가 경고). 스태프가 대면 확인 후 입력.
// ★ 이 필드는 스태프(비의사) 수납/접수 동선용 — §11 진료대시보드/진료관리(의사 전용) 아님.
//
// 태블릿 UX: 큰 버튼·한국어·teal-emerald. 새 의존성 없음(kcdSearch dynamic import 재사용).

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, Search, X, Stethoscope } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import {
  loadKcdBundle,
  searchKcd,
  getKcdByCode,
  isKnownKcdCode,
  type KcdSearchResult,
} from '@/lib/kcd/kcdSearch';

interface Props {
  checkInId: string;
  /** 현재 저장된 KCD 코드(check_ins.kcd_code). */
  kcdCode: string | null | undefined;
  /** 급여(보험) 청구 대상 방문 여부 — 미지정 시 check_in_services 로 자체 판정한다.
   *  true 일 때만 '상병 결핍' 경고를 노출(비급여 방문 false-alarm 방지). */
  isInsuranceVisit?: boolean;
  /** 저장/삭제 후 부모 리프레시. 새 코드값(또는 null) 전달. */
  onSaved?: (next: string | null) => void;
  className?: string;
}

export function KcdDiagnosisField({
  checkInId,
  kcdCode,
  isInsuranceVisit,
  onSaved,
  className,
}: Props) {
  // 급여 방문 자체 판정(prop 미지정 시) — 이 방문에 보험 급여 서비스가 하나라도 있으면 true.
  const [detectedInsurance, setDetectedInsurance] = useState(false);
  useEffect(() => {
    if (isInsuranceVisit !== undefined) return; // 부모가 명시 → 자체판정 skip
    let alive = true;
    (async () => {
      const { data } = await supabase
        .from('check_in_services')
        .select('service_id, services!inner(is_insurance_covered)')
        .eq('check_in_id', checkInId)
        .eq('services.is_insurance_covered', true)
        .limit(1);
      if (alive) setDetectedInsurance((data?.length ?? 0) > 0);
    })();
    return () => {
      alive = false;
    };
  }, [checkInId, isInsuranceVisit]);
  const insuranceVisit = isInsuranceVisit ?? detectedInsurance;

  const [bundleReady, setBundleReady] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<KcdSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  // 정적 KCD 번들 로드(멱등·코드스플릿). mount 시 1회.
  useEffect(() => {
    let alive = true;
    loadKcdBundle()
      .then(() => alive && setBundleReady(true))
      .catch(() => alive && setBundleReady(false));
    return () => {
      alive = false;
    };
  }, []);

  // 현재 코드의 표시명(번들 대조). 미상 코드면 코드만 표기.
  const currentEntry = useMemo(
    () => (bundleReady ? getKcdByCode(kcdCode) : null),
    [bundleReady, kcdCode],
  );

  // 검색어 → 결과(번들 로드 후에만).
  useEffect(() => {
    if (!open || !bundleReady) return;
    setResults(searchKcd(query, 30));
  }, [query, open, bundleReady]);

  // click-outside 닫기(새 의존성 없이).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const persist = async (nextCode: string | null) => {
    // ★ 발명 금지 방어: null(삭제) 또는 번들 실재 코드만 저장 허용.
    if (nextCode !== null && !isKnownKcdCode(nextCode)) {
      toast.error('KCD 번들에 없는 코드는 저장할 수 없습니다 (검색 후 선택하세요)');
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from('check_ins')
      .update({ kcd_code: nextCode })
      .eq('id', checkInId);
    setSaving(false);
    if (error) {
      toast.error(`상병코드 저장 실패: ${error.message}`);
      return;
    }
    toast.success(nextCode ? `상병 저장: ${nextCode}` : '상병 삭제됨');
    setOpen(false);
    setQuery('');
    onSaved?.(nextCode);
  };

  const showDeficiency = insuranceVisit && !kcdCode;

  return (
    <div ref={boxRef} className={cn('relative space-y-2', className)}>
      <div className="flex items-center gap-2">
        <Stethoscope className="h-4 w-4 text-teal-600" />
        <span className="text-sm font-medium text-gray-700">청구 상병 (KCD)</span>
        {currentEntry && (
          <span className="inline-flex items-center gap-1 rounded-md bg-teal-50 px-2 py-0.5 text-xs font-semibold text-teal-700">
            <Check className="h-3 w-3" /> 입력됨
          </span>
        )}
      </div>

      {/* 현재값 or 결핍 표식 */}
      {kcdCode ? (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-teal-200 bg-teal-50/60 px-3 py-2">
          <div className="min-w-0">
            <span className="font-mono text-base font-bold text-teal-800">{kcdCode}</span>
            {currentEntry && (
              <span className="ml-2 truncate text-sm text-gray-700">{currentEntry.name}</span>
            )}
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={() => persist(null)}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-gray-500 hover:bg-white hover:text-red-600 disabled:opacity-50"
            aria-label="상병 삭제"
          >
            <X className="h-4 w-4" /> 삭제
          </button>
        </div>
      ) : (
        showDeficiency && (
          <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            상병 미입력 — 건강보험 청구가 성립하지 않습니다. 진단 상병코드를 입력하세요.
          </div>
        )
      )}

      {/* 검색-선택 */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-teal-300 bg-white text-sm font-semibold text-teal-700 transition hover:bg-teal-50 active:scale-[0.99]"
      >
        <Search className="h-4 w-4" />
        {kcdCode ? '상병 변경' : '상병 검색·선택'}
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg">
          <div className="border-b border-gray-100 p-2">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={bundleReady ? '코드(M72.2) 또는 상병명(족저근막염)' : 'KCD 데이터 로딩…'}
              disabled={!bundleReady}
              className="h-11 w-full rounded-md border border-gray-200 px-3 text-sm outline-none focus:border-teal-400"
            />
          </div>
          <div className="max-h-72 overflow-auto py-1">
            {bundleReady && query.trim() && results.length === 0 && (
              <div className="px-3 py-4 text-center text-sm text-gray-400">일치하는 KCD 상병 없음</div>
            )}
            {results.map((r) => (
              <button
                key={r.code}
                type="button"
                disabled={saving}
                onClick={() => persist(r.code)}
                className="flex w-full items-baseline gap-2 px-3 py-2.5 text-left hover:bg-teal-50 disabled:opacity-50"
              >
                <span className="font-mono text-sm font-bold text-teal-700">{r.code}</span>
                <span className="truncate text-sm text-gray-700">{r.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
