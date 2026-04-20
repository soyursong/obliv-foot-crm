export interface PackagePreset {
  label: string;
  total: number;
  heated: number;
  unheated: number;
  iv: number;
  preconditioning: number;
  suggestedPrice: number;
}

export const PACKAGE_PRESETS: Record<string, PackagePreset> = {
  package1: { label: '패키지1 (12회)', total: 12, heated: 12, unheated: 0, iv: 0, preconditioning: 0, suggestedPrice: 3600000 },
  package2: { label: '패키지2 (24회)', total: 24, heated: 12, unheated: 12, iv: 0, preconditioning: 0, suggestedPrice: 6000000 },
  blelabel: { label: '블레라벨 (36회)', total: 36, heated: 12, unheated: 12, iv: 12, preconditioning: 12, suggestedPrice: 8400000 },
  '1month': { label: '1month (4회)', total: 4, heated: 4, unheated: 0, iv: 0, preconditioning: 0, suggestedPrice: 1200000 },
  nopain: { label: 'NoPain (48회)', total: 48, heated: 12, unheated: 12, iv: 12, preconditioning: 12, suggestedPrice: 10800000 },
};
