export type MapFeatureType =
  // Settlement
  | 'capital'
  | 'megacity'
  | 'city'
  | 'town'
  | 'port'
  // Industry
  | 'factory'
  | 'steel_mill'
  | 'refinery'
  | 'shipyard'
  | 'mine'
  | 'power_plant'
  // Military
  | 'battalion'
  | 'fleet'
  | 'airbase'
  | 'naval_base'
  // Infrastructure
  | 'railway'
  | 'canal'
  | 'pipeline'
  | 'airport'
  | 'highway'
  // Political
  | 'protest'
  | 'uprising'
  | 'government'
  | 'border_dispute';

export interface MapFeature {
  id: string;
  type: MapFeatureType;
  coordinates?: [number, number]; // [lng, lat]
  regionId?: number;
  ownerId?: string;
  name?: string;
  tags: string[];
  visibleAtZoom?: number; // минимальный зум для отображения
  createdAt?: string; // для событий
  expiresAt?: string; // для временных событий
}
