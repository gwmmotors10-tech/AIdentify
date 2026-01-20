
export enum PartColor {
  HAMILTON_WHITE = 'Hamilton White',
  SUN_GOLD_BLACK = 'Sun Gold Black',
  ATLANTIS_BLUE = 'Atlantis Blue',
  AYERS_GREY = 'Ayers Grey',
  KU_GREY = 'KU Grey',
  NEBULA_GREY = 'Nebula Grey',
  INCOLOR = 'Incolor'
}

export enum PartModel {
  B01_HEV = 'B01 HEV',
  B01_PHEV19 = 'B01 PHEV19',
  B01_PHEV35 = 'B01 PHEV35',
  B03 = 'B03',
  P3012_LOW = 'P3012 LOW',
  P3012_MID = 'P3012 MID',
  P3012_HIGH = 'P3012 HIGH',
  P11 = 'P11'
}

export interface PartRecord {
  id: string;
  partNumber: string;
  partName: string;
  color: PartColor;
  workstation: string;
  models: PartModel[]; // Changed from single model to array
  imageUrls: string[];
  timestamp: number;
}

export interface SimilarityMatch {
  id: string;
  score: number;
  reason: string;
}

export interface RecognitionResult {
  matches: SimilarityMatch[];
  detectedFeatures: string;
}
