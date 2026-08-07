import type { FeatureCollection, Feature, GeoJsonProperties, LineString, Polygon, MultiPolygon } from 'geojson';


export interface SharedEdgeProperties {
  id: number;
  leftRegionId: number;
  rightRegionId: number;
  isCoast: boolean;
}

export type SharedEdgeFeature = Feature<LineString, SharedEdgeProperties>;

interface Segment {
  p1: [number, number];
  p2: [number, number];
  regionId: number;
}

/**
 * Округляет координаты до 5 знаков после запятой для устранения субпиксельных разрывов.
 */
function roundCoord(c: number): number {
  return Math.round(c * 100000) / 100000;
}

/**
 * Создает уникальный строковый ключ для ненаправленного отрезка.
 */
function getSegmentKey(p1: [number, number], p2: [number, number]): string {
  const x1 = roundCoord(p1[0]);
  const y1 = roundCoord(p1[1]);
  const x2 = roundCoord(p2[0]);
  const y2 = roundCoord(p2[1]);
  
  if (x1 < x2 || (x1 === x2 && y1 < y2)) {
    return `${x1},${y1}_${x2},${y2}`;
  }
  return `${x2},${y2}_${x1},${y1}`;
}

/**
 * Строит граф общих границ (Shared Edges) между регионами.
 * На выходе возвращает FeatureCollection из LineString, которые представляют собой
 * границы раздела между государствами и береговые линии.
 */
export function buildTopologyEdges(
  geojson: FeatureCollection<Polygon | MultiPolygon, GeoJsonProperties>
): {
  edges: FeatureCollection<LineString, SharedEdgeProperties>;
  regionNeighbours: Map<number, Set<number>>;
  regionEdges: Map<number, number[]>; // regionId -> список edgeId
} {
  const segmentMap = new Map<string, Segment[]>();
  
  // 1. Извлекаем все отрезки из геометрии полигонов
  for (const feature of geojson.features) {
    const props = feature.properties;
    if (!props || props.type !== 'region' || props.regionId == null) {
      continue;
    }
    const regionId = props.regionId as number;
    const geom = feature.geometry;
    if (!geom) continue;

    const processRing = (ring: [number, number][]) => {
      for (let i = 0; i < ring.length - 1; i++) {
        const p1 = ring[i];
        const p2 = ring[i + 1];
        const key = getSegmentKey(p1, p2);
        
        const list = segmentMap.get(key) || [];
        list.push({ p1, p2, regionId });
        segmentMap.set(key, list);
      }
    };

    if (geom.type === 'Polygon') {
      for (const ring of geom.coordinates) {
        processRing(ring as [number, number][]);
      }
    } else if (geom.type === 'MultiPolygon') {
      for (const poly of geom.coordinates) {
        for (const ring of poly) {
          processRing(ring as [number, number][]);
        }
      }
    }
  }

  // 2. Группируем отрезки по смежности регионов
  // Ключ: "regA_regB" (где regA < regB), значение: массив отрезков
  const boundaryGroups = new Map<string, { p1: [number, number]; p2: [number, number] }[]>();
  
  for (const segments of segmentMap.values()) {
    if (segments.length === 0) continue;
    
    // Берем первые два уникальных региона (в нормальной топологии сегмент разделяет не более 2 регионов)
    const uniqueRegs = Array.from(new Set(segments.map(s => s.regionId))).sort((a, b) => a - b);
    
    if (uniqueRegs.length === 1) {
      // Граничит с океаном / краем карты
      const regId = uniqueRegs[0];
      const key = `${regId}_-1`;
      const list = boundaryGroups.get(key) || [];
      list.push({ p1: segments[0].p1, p2: segments[0].p2 });
      boundaryGroups.set(key, list);
    } else if (uniqueRegs.length >= 2) {
      // Граница между двумя регионами
      const regA = uniqueRegs[0];
      const regB = uniqueRegs[1];
      const key = `${regA}_${regB}`;
      const list = boundaryGroups.get(key) || [];
      list.push({ p1: segments[0].p1, p2: segments[0].p2 });
      boundaryGroups.set(key, list);
    }
  }

  // 3. Собираем отрезки каждой группы в непрерывные LineString
  const edgeFeatures: SharedEdgeFeature[] = [];
  const regionNeighbours = new Map<number, Set<number>>();
  const regionEdges = new Map<number, number[]>();
  let nextEdgeId = 1;

  const addEdgeToRegion = (regId: number, edgeId: number) => {
    const list = regionEdges.get(regId) || [];
    list.push(edgeId);
    regionEdges.set(regId, list);
  };

  const addNeighbour = (regA: number, regB: number) => {
    if (regB === -1) return;
    const setA = regionNeighbours.get(regA) || new Set<number>();
    setA.add(regB);
    regionNeighbours.set(regA, setA);

    const setB = regionNeighbours.get(regB) || new Set<number>();
    setB.add(regA);
    regionNeighbours.set(regB, setB);
  };

  for (const [key, segments] of boundaryGroups.entries()) {
    const [regA, regB] = key.split('_').map(Number);
    const isCoast = regB === -1;
    
    addNeighbour(regA, regB);

    // Собираем отрезки в цепочки (LineString)
    const chains = buildChainsFromSegments(segments);
    
    for (const chain of chains) {
      if (chain.length < 2) continue;
      const edgeId = nextEdgeId++;
      
      addEdgeToRegion(regA, edgeId);
      if (!isCoast) {
        addEdgeToRegion(regB, edgeId);
      }

      edgeFeatures.push({
        type: 'Feature',
        id: edgeId,
        geometry: {
          type: 'LineString',
          coordinates: chain
        },
        properties: {
          id: edgeId,
          leftRegionId: regA,
          rightRegionId: regB,
          isCoast
        }
      });
    }
  }

  return {
    edges: {
      type: 'FeatureCollection',
      features: edgeFeatures
    },
    regionNeighbours,
    regionEdges
  };
}

/**
 * Вспомогательный алгоритм для сборки цепочек из хаотичного набора отрезков.
 * Строит граф вершин и обходит его для создания связных путей LineString.
 */
function buildChainsFromSegments(
  segments: { p1: [number, number]; p2: [number, number] }[]
): [number, number][][] {
  // Строим граф вершин. Ключ: "x,y", значение: список смежных вершин
  const adj = new Map<string, { pt: [number, number]; key: string }[]>();
  const vertexMap = new Map<string, [number, number]>();

  const getVertexKey = (p: [number, number]): string => {
    return `${roundCoord(p[0])},${roundCoord(p[1])}`;
  };

  for (const seg of segments) {
    const k1 = getVertexKey(seg.p1);
    const k2 = getVertexKey(seg.p2);
    
    vertexMap.set(k1, seg.p1);
    vertexMap.set(k2, seg.p2);

    const list1 = adj.get(k1) || [];
    list1.push({ pt: seg.p2, key: k2 });
    adj.set(k1, list1);

    const list2 = adj.get(k2) || [];
    list2.push({ pt: seg.p1, key: k1 });
    adj.set(k2, list2);
  }

  const visited = new Set<string>();
  const chains: [number, number][][] = [];

  // 1. Сначала ищем вершины с нечетной степенью (степень 1), так как они являются концами цепочек
  for (const [startKey, edges] of adj.entries()) {
    if (edges.length === 1 && !visited.has(startKey)) {
      const chain: [number, number][] = [vertexMap.get(startKey)!];
      visited.add(startKey);
      
      let next = edges[0];

      // Отдельная currentKey здесь не нужна: в этой ветке она нигде не читается
      // после цикла (в отличие от обхода замкнутых циклов ниже, где ею
      // проверяется смыкание с началом), а внутри цикла всегда равна next.key.
      while (next && !visited.has(next.key)) {
        chain.push(vertexMap.get(next.key)!);
        visited.add(next.key);

        const nextEdges = adj.get(next.key) || [];
        const unvisitedNeighbours = nextEdges.filter(e => !visited.has(e.key));
        next = unvisitedNeighbours[0];
      }
      chains.push(chain);
    }
  }

  // 2. Затем обходим оставшиеся замкнутые циклы (вершины со степенью 2)
  for (const [startKey, edges] of adj.entries()) {
    if (!visited.has(startKey)) {
      const chain: [number, number][] = [vertexMap.get(startKey)!];
      visited.add(startKey);
      
      let currentKey = startKey;
      let next = edges.find(e => !visited.has(e.key));
      
      while (next && !visited.has(next.key)) {
        chain.push(vertexMap.get(next.key)!);
        visited.add(next.key);
        currentKey = next.key;
        
        const nextEdges = adj.get(currentKey) || [];
        next = nextEdges.find(e => !visited.has(e.key));
      }
      
      // Замыкаем цикл, если он соединен с началом
      const startEdges = adj.get(startKey) || [];
      if (startEdges.some(e => e.key === currentKey)) {
        chain.push(chain[0]);
      }
      chains.push(chain);
    }
  }

  return chains;
}
