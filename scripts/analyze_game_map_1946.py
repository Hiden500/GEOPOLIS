#!/usr/bin/env python3
"""
Анализ game_map.json для сценария 1946 года.
Вычисляет площади регионов и статистику по странам.
"""

import json
import math
from pathlib import Path
from typing import Dict, List, Any


def calculate_area(geometry: Dict[str, Any]) -> float:
    """Вычисление площади полигона (упрощённая)."""
    if not geometry:
        return 0.0
    
    total_area = 0.0
    geom_type = geometry.get('type')
    coords = geometry.get('coordinates', [])
    
    def process_coordinates(coordinates):
        nonlocal total_area
        if geom_type == 'Polygon':
            ring = coordinates[0]
            area = 0.0
            for i in range(len(ring)):
                j = (i + 1) % len(ring)
                area += ring[i][0] * ring[j][1]
                area -= ring[j][0] * ring[i][1]
            total_area += abs(area / 2)
        elif geom_type == 'MultiPolygon':
            for polygon in coordinates:
                ring = polygon[0]
                area = 0.0
                for i in range(len(ring)):
                    j = (i + 1) % len(ring)
                    area += ring[i][0] * ring[j][1]
                    area -= ring[j][0] * ring[i][1]
                total_area += abs(area / 2)
    
    if geom_type == 'Polygon':
        process_coordinates(coords)
    elif geom_type == 'MultiPolygon':
        process_coordinates(coords)
    
    # Конвертация из квадратных градусов в примерные км² (очень грубая оценка)
    return total_area * 12300


def main():
    geojson_path = Path(__file__).parent.parent / 'client' / 'src' / 'assets' / 'game_map.json'
    output_path = Path(__file__).parent / 'game_map_analysis_1946.json'
    
    print('=== АНАЛИЗ GAME_MAP.JSON ДЛЯ СЦЕНАРИЯ 1946 ===\n')
    
    # Загрузка GeoJSON
    with open(geojson_path, 'r', encoding='utf-8') as f:
        geojson = json.load(f)
    
    # Структура для статистики по странам
    country_stats: Dict[str, Dict[str, Any]] = {}
    
    # Анализ каждого региона
    for feature in geojson['features']:
        props = feature.get('properties', {})
        iso_a3 = props.get('adm0_a3', props.get('iso_a3', 'UNKNOWN'))
        name = props.get('name', 'Unknown')
        adm1_code = props.get('adm1_code', f"{iso_a3}-{hash(str(feature)) % 10000:04d}")
        area_sqkm = props.get('area_sqkm', 0)
        scalerank = props.get('scalerank', 5)
        
        if iso_a3 not in country_stats:
            country_stats[iso_a3] = {
                'isoA3': iso_a3,
                'name': props.get('adm0name', name),
                'regionCount': 0,
                'totalAreaSqKm': 0.0,
                'regions': []
            }
        
        # Используем area_sqkm из свойств, если есть, иначе вычисляем
        region_area = area_sqkm if area_sqkm and area_sqkm > 0 else calculate_area(feature.get('geometry'))
        
        country_stats[iso_a3]['regionCount'] += 1
        country_stats[iso_a3]['totalAreaSqKm'] += region_area
        country_stats[iso_a3]['regions'].append({
            'id': adm1_code,
            'name': name,
            'areaSqKm': region_area,
            'scalerank': scalerank
        })
    
    # Сортировка стран по количеству регионов
    sorted_countries = sorted(country_stats.values(), key=lambda x: x['regionCount'], reverse=True)
    
    print(f'Всего стран: {len(sorted_countries)}')
    print(f'Всего регионов: {len(geojson["features"])}\n')
    
    print('=== СТАТИСТИКА ПО СТРАНАМ ===\n')
    print('ISO | Регионы | Площадь (км²) | Название')
    print('----|---------|---------------|-----------')
    
    for country in sorted_countries:
        iso = country['isoA3'].ljust(4)
        count = str(country['regionCount']).rjust(7)
        area = str(round(country['totalAreaSqKm'])).rjust(13)
        name = country['name']
        print(f'{iso} | {count} | {area} | {name}')
    
    print('\n=== АНОМАЛИИ (более 100 регионов при площади < 100,000 км²) ===\n')
    for country in sorted_countries:
        if country['regionCount'] > 100 and country['totalAreaSqKm'] < 100000:
            print(f"{country['isoA3']}: {country['regionCount']} регионов, {round(country['totalAreaSqKm'])} км² - {country['name']}")
    
    print('\n=== КРУПНЫЕ СТРАНЫ (более 1,000,000 км²) ===\n')
    for country in sorted_countries:
        if country['totalAreaSqKm'] > 1000000:
            print(f"{country['isoA3']}: {country['regionCount']} регионов, {round(country['totalAreaSqKm'])} км² - {country['name']}")
    
    print('\n=== СРЕДНИЕ СТРАНЫ (250,000–1,000,000 км²) ===\n')
    for country in sorted_countries:
        if 250000 <= country['totalAreaSqKm'] <= 1000000:
            print(f"{country['isoA3']}: {country['regionCount']} регионов, {round(country['totalAreaSqKm'])} км² - {country['name']}")
    
    print('\n=== МАЛЫЕ СТРАНЫ (< 100,000 км²) ===\n')
    for country in sorted_countries:
        if country['totalAreaSqKm'] < 100000:
            print(f"{country['isoA3']}: {country['regionCount']} регионов, {round(country['totalAreaSqKm'])} км² - {country['name']}")
    
    # Сохранение детальной статистики в JSON
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(country_stats, f, ensure_ascii=False, indent=2)
    
    print(f'\nДетальная статистика сохранена в: {output_path}')


if __name__ == '__main__':
    main()
