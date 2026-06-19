#!/usr/bin/env python3
"""
Генерация маппинга для отдельного континента.
Использование: python scripts/generate_continent_mapping_1946.py <continent_name>
"""

import json
import math
import random
import sys
from pathlib import Path
from typing import Dict, List, Any, Tuple


def load_json(file_path: Path) -> Dict[str, Any]:
    """Загрузка JSON файла."""
    with open(file_path, 'r', encoding='utf-8') as f:
        return json.load(f)


def load_geojson(file_path: Path) -> Dict[str, Any]:
    """Загрузка GeoJSON."""
    with open(file_path, 'r', encoding='utf-8') as f:
        return json.load(f)


def calculate_area(feature: Dict[str, Any]) -> float:
    """Вычисление площади полигона (упрощённая)."""
    geometry = feature.get('geometry')
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

    return total_area * 12300


def get_centroid(feature: Dict[str, Any]) -> Tuple[float, float]:
    """Получение центроида полигона (упрощённая)."""
    geometry = feature.get('geometry')
    if not geometry:
        return (0.0, 0.0)

    coords = geometry.get('coordinates', [])
    geom_type = geometry.get('type')

    if geom_type == 'Polygon' and coords:
        ring = coords[0]
        sum_x = sum(p[0] for p in ring)
        sum_y = sum(p[1] for p in ring)
        return (sum_x / len(ring), sum_y / len(ring))
    elif geom_type == 'MultiPolygon' and coords:
        ring = coords[0][0]
        sum_x = sum(p[0] for p in ring)
        sum_y = sum(p[1] for p in ring)
        return (sum_x / len(ring), sum_y / len(ring))

    return (0.0, 0.0)


def distance(p1: Tuple[float, float], p2: Tuple[float, float]) -> float:
    """Расстояние между двумя точками (упрощённая, в градусах)."""
    return math.sqrt((p1[0] - p2[0])**2 + (p1[1] - p2[1])**2)


def k_means_clustering(points: List[Tuple[float, float]], k: int) -> List[int]:
    """K-means кластеризация."""
    if len(points) <= k:
        return list(range(len(points)))

    centroids = []
    indices = set()
    while len(centroids) < k and len(indices) < len(points):
        idx = random.randint(0, len(points) - 1)
        if idx not in indices:
            indices.add(idx)
            centroids.append(points[idx])

    if len(centroids) < k:
        k = len(centroids)

    assignments = []
    max_iterations = 100
    iteration = 0

    while iteration < max_iterations:
        assignments = []
        for point in points:
            min_dist = float('inf')
            closest_centroid = 0
            for idx, centroid in enumerate(centroids):
                dist = distance(point, centroid)
                if dist < min_dist:
                    min_dist = dist
                    closest_centroid = idx
            assignments.append(closest_centroid)

        new_centroids = []
        for i in range(k):
            cluster_points = [points[j] for j, a in enumerate(assignments) if a == i]
            if cluster_points:
                sum_x = sum(p[0] for p in cluster_points)
                sum_y = sum(p[1] for p in cluster_points)
                new_centroids.append((sum_x / len(cluster_points), sum_y / len(cluster_points)))
            else:
                new_centroids.append(centroids[i])

        converged = all(distance(centroids[i], new_centroids[i]) < 0.001 for i in range(k))
        centroids = new_centroids
        iteration += 1

        if converged:
            break

    return assignments


def generate_auto_mapping(regions: List[Dict[str, Any]], target_regions: int) -> Dict[str, List[str]]:
    """Генерация маппинга для страны с автоматической кластеризацией."""
    if len(regions) == 0:
        return {}
    
    target_regions = int(target_regions)
    
    if len(regions) <= 3:
        mapping = {}
        for idx, region in enumerate(regions):
            mapping[f'Region_{idx + 1}'] = [region['adm1Code']]
        return mapping
    
    if len(regions) <= target_regions:
        mapping = {}
        for idx, region in enumerate(regions):
            mapping[f'Region_{idx + 1}'] = [region['adm1Code']]
        return mapping
    
    points = [r['centroid'] for r in regions]
    assignments = k_means_clustering(points, target_regions)
    
    mapping = {}
    for i in range(target_regions):
        cluster_regions = [regions[j] for j, a in enumerate(assignments) if a == i]
        mapping[f'Region_{i + 1}'] = [r['adm1Code'] for r in cluster_regions]
    
    return mapping


def group_regions_by_country(geojson: Dict[str, Any], continent_countries: List[str]) -> Dict[str, Dict[str, Any]]:
    """Группировка регионов по странам для указанного континента."""
    country_map: Dict[str, Dict[str, Any]] = {}
    
    for feature in geojson['features']:
        props = feature.get('properties', {})
        iso_a2 = props.get('iso_a2') or props.get('adm0_a2')
        iso_a3 = props.get('iso_a3') or props.get('adm0_a3')
        name = props.get('name', 'Unknown')
        adm1_code = props.get('adm1_code') or feature.get('id')
        
        if not iso_a2 or iso_a2 in ['-1', '-99']:
            continue
        
        # Проверяем, принадлежит ли страна континенту
        if iso_a2 not in continent_countries and iso_a3 not in continent_countries:
            continue
        
        region_info = {
            'id': feature.get('id', adm1_code or 'unknown'),
            'name': name,
            'areaSqKm': calculate_area(feature),
            'centroid': get_centroid(feature),
            'isoA2': iso_a2,
            'isoA3': iso_a3 or iso_a2,
            'adm1Code': adm1_code or 'unknown'
        }
        
        country_key = iso_a3 or iso_a2
        if country_key not in country_map:
            country_map[country_key] = {
                'isoA2': iso_a2,
                'isoA3': iso_a3 or iso_a2,
                'name': props.get('adm0name', name),
                'regions': []
            }
        
        country_map[country_key]['regions'].append(region_info)
    
    return country_map


def generate_continent_mapping(country_map: Dict[str, Dict[str, Any]], target_total_regions: int) -> Dict[str, Dict[str, Any]]:
    """Генерация маппинга для континента с учётом общей цели."""
    mapping: Dict[str, Dict[str, Any]] = {}
    
    # Вычисляем общее количество регионов во всех странах
    total_regions = sum(len(cr['regions']) for cr in country_map.values())
    
    for iso_a3, country_regions in country_map.items():
        region_count = len(country_regions['regions'])
        
        # Распределяем пропорционально количеству регионов в стране
        proportion = region_count / total_regions
        target_regions = int(proportion * target_total_regions)
        
        # Минимум 1 регион, максимум - все регионы страны
        target_regions = max(1, min(target_regions, region_count))
        
        # Для очень маленьких стран оставляем все регионы
        if region_count <= 3:
            target_regions = region_count
        
        auto_mapping = generate_auto_mapping(
            country_regions['regions'],
            target_regions
        )
        mapping[iso_a3] = {
            'targetRegions': target_regions,
            'mapping': auto_mapping
        }
    
    return mapping


def main():
    if len(sys.argv) < 2:
        print('Использование: python scripts/generate_continent_mapping_1946.py <continent_name>')
        print('Доступные континенты: Europe, Asia, NorthAmerica, SouthAmerica, Africa, Oceania')
        sys.exit(1)
    
    continent_name = sys.argv[1]
    
    geojson_path = Path(__file__).parent.parent / 'client' / 'src' / 'assets' / 'game_map.json'
    continents_path = Path(__file__).parent / 'continents_1946.json'
    output_path = Path(__file__).parent / f'{continent_name}_mapping_1946.json'
    
    print(f'=== ГЕНЕРАЦИЯ МАППИНГА ДЛЯ КОНТИНЕНТА: {continent_name} ===\n')
    
    # Загрузка данных
    print('Загрузка GeoJSON...')
    geojson = load_geojson(geojson_path)
    print(f'Загружено {len(geojson["features"])} регионов')
    
    print('Загрузка данных о континентах...')
    continents = load_json(continents_path)
    
    if continent_name not in continents['continents']:
        print(f'Континент {continent_name} не найден')
        print(f'Доступные континенты: {list(continents["continents"].keys())}')
        sys.exit(1)
    
    continent_data = continents['continents'][continent_name]
    continent_countries = continent_data['countries']
    target_regions = continent_data['targetRegions']
    
    print(f'Страны в континенте: {len(continent_countries)}')
    print(f'Целевое количество регионов: {target_regions}')
    
    # Группировка регионов по странам
    print('\nГруппировка регионов по странам...')
    country_map = group_regions_by_country(geojson, continent_countries)
    print(f'Найдено {len(country_map)} стран в континенте')
    
    # Генерация маппинга
    print('\nГенерация маппинга...')
    mapping = generate_continent_mapping(country_map, target_regions)
    
    # Сохранение
    print(f'Сохранение маппинга в {output_path}...')
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(mapping, f, ensure_ascii=False, indent=2)
    
    # Статистика
    total_regions = sum(len(data['mapping']) for data in mapping.values())
    print(f'\nСтатистика:')
    print(f'Всего стран в маппинге: {len(mapping)}')
    print(f'Всего макро-регионов: {total_regions}')
    print(f'Целевое количество: {target_regions}')
    
    print(f'\nСтраны в континенте:')
    for iso_a3, data in mapping.items():
        print(f'  {iso_a3}: {len(data["mapping"])} регионов (цель: {data["targetRegions"]})')


if __name__ == '__main__':
    main()
