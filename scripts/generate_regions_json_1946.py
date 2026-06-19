#!/usr/bin/env python3
"""
Генерация regions.json из GeoJSON для сценария 1946 года.
Конвертирует GeoJSON фичи в регионы с вычислением площадей, центроидов и соседей.
"""

import json
from pathlib import Path
from typing import Dict, List, Any, Tuple, Optional
from shapely.geometry import shape


def load_geojson(file_path: Path) -> Dict[str, Any]:
    """Загрузка GeoJSON."""
    with open(file_path, 'r', encoding='utf-8') as f:
        return json.load(f)


def save_regions_json(file_path: Path, regions: List[Dict[str, Any]]) -> None:
    """Сохранение regions.json."""
    with open(file_path, 'w', encoding='utf-8') as f:
        json.dump(regions, f, ensure_ascii=False, indent=2)


def calculate_area_sqkm(feature: Dict[str, Any]) -> float:
    """Вычисление площади региона в км²."""
    try:
        # Сначала проверяем, есть ли площадь в свойствах
        props = feature.get('properties', {})
        if 'areaSqKm' in props and props['areaSqKm'] > 0:
            return props['areaSqKm']
        
        geom = shape(feature.get('geometry'))
        
        # Координаты в градусах, нужно конвертировать в км²
        # Примерный коэффициент: 1 градус² ≈ 12300 км² (на экваторе)
        # Это грубая оценка, но достаточна для наших целей
        from shapely import area as shapely_area
        area_deg2 = shapely_area(geom)
        area_km2 = area_deg2 * 12300
        
        return round(area_km2)
    except Exception as e:
        print(f'Ошибка при вычислении площади: {e}')
        return 0


def calculate_centroid(feature: Dict[str, Any]) -> Optional[Tuple[float, float]]:
    """Вычисление центроида региона."""
    try:
        geom = shape(feature.get('geometry'))
        centroid = geom.centroid
        coords = centroid.coords[0]
        return [coords[0], coords[1]]
    except Exception as e:
        print(f'Ошибка при вычислении центроида: {e}')
        return None


def distance(p1: List[float], p2: List[float]) -> float:
    """Расстояние между двумя точками (упрощённая, в градусах)."""
    return ((p1[0] - p2[0])**2 + (p1[1] - p2[1])**2)**0.5


def find_neighbours(region: Dict[str, Any], all_regions: List[Dict[str, Any]]) -> List[str]:
    """Поиск соседей для региона."""
    if region.get('kind') != 'land':
        return []  # Морские регионы не имеют сухопутных соседей
    
    neighbours = []
    region_centroid = region.get('centroid')
    
    if not region_centroid:
        return neighbours
    
    # Простая эвристика: соседи это регионы в радиусе 200 км (примерно 1.8 градуса)
    for other in all_regions:
        if other['id'] == region['id']:
            continue
        if other.get('kind') != 'land':
            continue
        if not other.get('centroid'):
            continue
        
        dist = distance(region_centroid, other['centroid'])
        
        # Примерно 200 км в градусах (зависит от широты)
        if dist < 2.0:
            neighbours.append(other['id'])
    
    return neighbours


def feature_to_region(feature: Dict[str, Any]) -> Dict[str, Any]:
    """Конвертация GeoJSON фичи в Region."""
    props = feature.get('properties', {})
    
    # Определяем тип региона
    region_type = props.get('type', 'land')
    if region_type == 'marine':
        kind = 'marine'
    elif region_type == 'canal':
        kind = 'canal'
    else:
        kind = 'land'
    
    region = {
        'id': props.get('id', feature.get('id', 'unknown')),
        'name': props.get('name', 'Unknown'),
        'name_en': props.get('name_en', props.get('name', 'Unknown')),
        'ownerCountryId': props.get('owner') or props.get('ownerCountryId') or 'NONE',
        'countryIso': props.get('country_1946') or props.get('countryIso') or 'NONE',
        'macroRegion': props.get('macroRegion', props.get('id', 'unknown')),
        'kind': kind,
        'historicalYear': 1946
    }
    
    # Вычисляем площадь только для land регионов
    if region['kind'] == 'land':
        region['areaSqKm'] = calculate_area_sqkm(feature)
    
    # Вычисляем центроид
    centroid = calculate_centroid(feature)
    if centroid:
        region['centroid'] = centroid
    
    # Добавляем специальные статусы
    if props.get('naval_chokepoint'):
        region['navalChokepoint'] = True
    
    if props.get('specialStatus'):
        region['specialStatus'] = props['specialStatus']
    
    # Добавляем исходные ADM1 коды если есть
    if props.get('sourceAdm1Codes') and isinstance(props['sourceAdm1Codes'], list):
        region['sourceAdm1Codes'] = props['sourceAdm1Codes']
    
    return region


def main():
    geojson_path = Path(__file__).parent.parent / 'client' / 'src' / 'assets' / 'world-map-1946.geojson'
    output_path = Path(__file__).parent.parent / 'client' / 'src' / 'assets' / 'regions-1946.json'
    
    print('=== ГЕНЕРАЦИЯ REGIONS.JSON ===\n')
    
    if not geojson_path.exists():
        print(f'Ошибка: Файл не найден: {geojson_path}')
        print('Сначала запустите: python scripts/merge_continents.py')
        return
    
    print('Загрузка GeoJSON...')
    geojson = load_geojson(geojson_path)
    
    print('Конвертация фич в регионы...')
    regions = [feature_to_region(feature) for feature in geojson['features']]
    
    print('Поиск соседей...')
    for region in regions:
        region['neighbours'] = find_neighbours(region, regions)
    
    print('Сохранение regions.json...')
    save_regions_json(output_path, regions)
    
    # Статистика
    land_regions = [r for r in regions if r.get('kind') == 'land']
    marine_regions = [r for r in regions if r.get('kind') == 'marine']
    canal_regions = [r for r in regions if r.get('kind') == 'canal']
    special_regions = [r for r in regions if r.get('kind') == 'special']
    
    print(f'\nСтатистика:')
    print(f'Всего регионов: {len(regions)}')
    print(f'- Сухопутные: {len(land_regions)}')
    print(f'- Морские: {len(marine_regions)}')
    print(f'- Каналы: {len(canal_regions)}')
    print(f'- Специальные: {len(special_regions)}')
    
    # Статистика по странам
    country_count = len(set(r.get('ownerCountryId') for r in land_regions if r.get('ownerCountryId') != 'NONE'))
    print(f'\nКоличество стран: {country_count}')
    
    # Статистика по площади
    total_area = sum(r.get('areaSqKm', 0) for r in land_regions)
    print(f'Общая площадь сухопутных регионов: {total_area:,} км²')
    
    print('\nГотово!')


if __name__ == '__main__':
    main()
