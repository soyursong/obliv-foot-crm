import { useEffect, useState } from 'react';
import { getClinic } from '@/lib/clinic';
import type { Clinic } from '@/lib/types';

/**
 * 클리닉 정보를 가져오는 공용 훅.
 * 8개+ 페이지에서 반복되던 useState + useEffect + getClinic() 보일러플레이트를 통합.
 */
export function useClinic(): Clinic | null {
  const [clinic, setClinic] = useState<Clinic | null>(null);

  useEffect(() => {
    getClinic().then(setClinic).catch(() => setClinic(null));
  }, []);

  return clinic;
}
