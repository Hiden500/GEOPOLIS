#!/usr/bin/env python3
"""
Валидация данных карты 1946 года.
Проверяет GeoJSON и regions.json на корректность.
"""

import json
from pathlib import Path
from typing import Dict, List, Any


def load_json(file_path: Path) -> Dict[str, Any]:
    """Загрузка JSON файла."""
    with open(file_path, 'r', encoding='utf-8') as f:
        return json.load(f)


def validate_geojson(geojson: Dict[str, Any]) -> tuple[bool, List[str]]:
    """Валидация GeoJSON."""
    warnings = []
    
    if geojson.get('type') != 'FeatureCollection':
        warnings.append('Неверный тип GeoJSON')
        return False, warnings
    
    features = geojson.get('features', [])
    if not features:
        warnings.append('GeoJSON не содержит фич')
        return False, warnings
    
    for i, feature in enumerate(features):
        if feature.get('type') != 'Feature':
            warnings.append(f'Фича {i} не является Feature')
        
        geometry = feature.get('geometry')
        if not geometry:
            warnings.append(f'Фича {i} не содержит геометрии')
        
        properties = feature.get('properties', {})
        if 'id' not in properties:
            warnings.append(f'Фича {i} не содержит id')
        if 'name' not in properties:
            warnings.append(f'Фича {i} не содержит name')
    
    return True, warnings


def validate_regions(regions: List[Dict[str, Any]]) -> tuple[bool, List[str]]:
    """Валидация regions.json."""
    warnings = []
    
    if not isinstance(regions, list):
        warnings.append('regions.json не является списком')
        return False, warnings
    
    if not regions:
        warnings.append('regions.json пуст')
        return False, warnings
    
    ids = set()
    for i, region in enumerate(regions):
        if 'id' not in region:
            warnings.append(f'Регион {i} не содержит id')
        else:
            if region['id'] in ids:
                warnings.append(f'Дубликат id: {region["id"]}')
            ids.add(region['id'])
        
        if 'name' not in region:
            warnings.append(f'Регион {i} не содержит name')
        
        if 'ownerCountryId' not in region:
            warnings.append(f'Регион {i} не содержит ownerCountryId')
        
        if region.get('kind') == 'land' and 'areaSqKm' not in region:
            warnings.append(f'Сухопутный регион {i} не содержит areaSqKm')
        
        if region.get('kind') == 'land' and region.get('areaSqKm', 0) == 0:
            warnings.append(f'Сухопутный регион {region.get("id")} без площади')
    
    return True, warnings


def validate_consistency(geojson: Dict[str, Any], regions: List[Dict[str, Any]]) -> tuple[bool, List[str]]:
    """Проверка соответствия GeoJSON и regions.json."""
    warnings = []
    
    geojson_ids = {f.get('properties', {}).get('id') for f in geojson.get('features', [])}
    region_ids = {r.get('id') for r in regions}
    
    if geojson_ids != region_ids:
        missing_in_regions = geojson_ids - region_ids
        missing_in_geojson = region_ids - geojson_ids
        
        if missing_in_regions:
            warnings.append(f'ID в GeoJSON, но отсутствуют в regions: {missing_in_regions}')
        if missing_in_geojson:
            warnings.append(f'ID в regions, но отсутствуют в GeoJSON: {missing_in_geojson}')
    
    return True, warnings


def main():
    geojson_path = Path(__file__).parent.parent / 'client' / 'public' / 'world-map-1946.geojson'
    regions_path = Path(__file__).parent.parent / 'client' / 'public' / 'regions-1946.json'
    
    print('Загрузка данных...\n')
    
    geojson = load_json(geojson_path)
    regions = load_json(regions_path)
    
    print(f'Загружено:')
    print(f'- GeoJSON фич: {len(geojson.get("features", []))}')
    print(f'- Регионов: {len(regions)}')
    
    print('\n' + '=' * 50)
    print('Валидация GeoJSON...\n')
    
    geojson_valid, geojson_warnings = validate_geojson(geojson)
    
    if geojson_valid:
        print('GeoJSON валидация: УСПЕХ')
    else:
        print('GeoJSON валидация: ОШИБКА')
    
    if geojson_warnings:
        print('Предупреждения:')
        for w in geojson_warnings:
            print(f'  - {w}')
    
    print('\n' + '=' * 50)
    print('Валидация regions.json...\n')
    
    regions_valid, regions_warnings = validate_regions(regions)
    
    if regions_valid:
        print('regions.json валидация: УСПЕХ')
    else:
        print('regions.json валидация: ОШИБКА')
    
    if regions_warnings:
        print('Предупреждения:')
        for w in regions_warnings:
            print(f'  - {w}')
    
    print('\n' + '=' * 50)
    print('Проверка соответствия GeoJSON и regions.json...\n')
    
    consistency_valid, consistency_warnings = validate_consistency(geojson, regions)
    
    if consistency_valid:
        print('Соответствие GeoJSON и regions.json: УСПЕХ')
    else:
        print('Соответствие GeoJSON и regions.json: ОШИБКА')
    
    if consistency_warnings:
        print('Предупреждения:')
        for w in consistency_warnings:
            print(f'  - {w}')
    
    print('\n' + '=' * 50)
    print('\nИТОГО:')
    print(f'Ошибок: {0 if geojson_valid and regions_valid and consistency_valid else 1}')
    print(f'Предупреждений: {len(geojson_warnings) + len(regions_warnings) + len(consistency_warnings)}')
    print(f'Статус: {"УСПЕХ" if geojson_valid and regions_valid and consistency_valid else "ОШИБКА"}')
    
    if geojson_valid and regions_valid and consistency_valid:
        print('\n✓ Валидация пройдена успешно!')


if __name__ == '__main__':
    main()
