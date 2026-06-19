#!/usr/bin/env python3
"""
Генерация маппинга регионов для сценария 1946 года.
Определяет правила объединения admin-1 регионов в макро-регионы.
"""

import json
import math
import random
from pathlib import Path
from typing import Dict, List, Any, Tuple


def load_geojson(file_path: Path) -> Dict[str, Any]:
    """Загрузка GeoJSON."""
    with open(file_path, 'r', encoding='utf-8') as f:
        return json.load(f)


def load_proposal(file_path: Path) -> Dict[str, Any]:
    """Загрузка proposal с целевым количеством регионов."""
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
    
    return total_area * 12300  # Конвертация в км²


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


def group_regions_by_country(geojson: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    """Группировка регионов по странам."""
    country_map: Dict[str, Dict[str, Any]] = {}
    
    for feature in geojson['features']:
        props = feature.get('properties', {})
        iso_a2 = props.get('iso_a2') or props.get('adm0_a2')
        iso_a3 = props.get('iso_a3') or props.get('adm0_a3')
        name = props.get('name', 'Unknown')
        adm1_code = props.get('adm1_code') or feature.get('id')
        
        if not iso_a2 or iso_a2 in ['-1', '-99']:
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
        
        if iso_a2 not in country_map:
            country_map[iso_a2] = {
                'isoA2': iso_a2,
                'isoA3': iso_a3 or iso_a2,
                'name': props.get('adm0name', name),
                'regions': []
            }
        
        country_map[iso_a2]['regions'].append(region_info)
    
    return country_map


def distance(p1: Tuple[float, float], p2: Tuple[float, float]) -> float:
    """Расстояние между двумя точками (упрощённая, в градусах)."""
    return math.sqrt((p1[0] - p2[0])**2 + (p1[1] - p2[1])**2)


def k_means_clustering(points: List[Tuple[float, float]], k: int) -> List[int]:
    """K-means кластеризация."""
    if len(points) <= k:
        return list(range(len(points)))
    
    # Инициализация центроидов (случайные точки)
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
        # Назначение точек к ближайшим центроидам
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
        
        # Пересчёт центроидов
        new_centroids = []
        for i in range(k):
            cluster_points = [points[j] for j, a in enumerate(assignments) if a == i]
            if cluster_points:
                sum_x = sum(p[0] for p in cluster_points)
                sum_y = sum(p[1] for p in cluster_points)
                new_centroids.append((sum_x / len(cluster_points), sum_y / len(cluster_points)))
            else:
                new_centroids.append(centroids[i])
        
        # Проверка сходимости
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
    
    # Если регионов меньше 8, оставляем все как есть (без объединения для увеличения общего количества)
    if len(regions) <= 8:
        mapping = {}
        for idx, region in enumerate(regions):
            mapping[f'Region_{idx + 1}'] = [region['adm1Code']]
        return mapping
    
    # Если целевое количество больше или равно количеству регионов
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


def generate_mapping(country_map: Dict[str, Dict[str, Any]], proposal: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    """Генерация полного маппинга с использованием только автоматической кластеризации."""
    mapping: Dict[str, Dict[str, Any]] = {}
    
    # Обработка всех стран с автоматической кластеризацией
    for iso_a2, country_regions in country_map.items():
        iso_a3 = country_regions['isoA3']
        
        # Определяем целевое количество регионов на основе площади (строго для достижения 1500-2500)
        total_area = sum(r['areaSqKm'] for r in country_regions['regions'])
        region_count = len(country_regions['regions'])
        
        if total_area > 1000000:
            target_regions = min(35, max(18, total_area // 35000))
        elif total_area > 500000:
            target_regions = min(25, max(12, total_area // 30000))
        elif total_area > 250000:
            target_regions = min(18, max(7, total_area // 25000))
        elif total_area > 100000:
            target_regions = min(12, max(4, total_area // 20000))
        elif total_area > 50000:
            target_regions = min(7, max(3, total_area // 12000))
        elif total_area > 10000:
            target_regions = min(4, max(2, total_area // 6000))
        else:
            target_regions = max(1, min(region_count, region_count))
        
        target_regions = min(target_regions, region_count)
        
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
    geojson_path = Path(__file__).parent.parent / 'client' / 'src' / 'assets' / 'game_map.json'
    proposal_path = Path(__file__).parent / 'region_detailization_proposal_1946.json'
    output_path = Path(__file__).parent / 'region_mapping_1946.json'
    
    print('Загрузка GeoJSON...')
    geojson = load_geojson(geojson_path)
    print(f'Загружено {len(geojson["features"])} регионов')
    
    print('Загрузка proposal...')
    proposal = load_proposal(proposal_path)
    
    print('Группировка регионов по странам...')
    country_map = group_regions_by_country(geojson)
    print(f'Найдено {len(country_map)} стран')
    
    print('Генерация маппинга...')
    mapping = generate_mapping(country_map, proposal)
    
    print('Сохранение маппинга...')
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(mapping, f, ensure_ascii=False, indent=2)
    print(f'Маппинг сохранён в {output_path}')
    
    # Статистика
    total_regions = sum(len(data['mapping']) for data in mapping.values())
    print(f'\nСтатистика:')
    print(f'Всего стран в маппинге: {len(mapping)}')
    print(f'Всего макро-регионов: {total_regions}')


if __name__ == '__main__':
    main()
