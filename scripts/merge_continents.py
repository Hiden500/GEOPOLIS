#!/usr/bin/env python3
"""
Объединение континентальных GeoJSON в один файл.
Использование: python scripts/merge_continents.py
"""

import json
import sys
from pathlib import Path
from typing import Dict, List, Any


def load_json(file_path: Path) -> Dict[str, Any]:
    """Загрузка JSON файла."""
    with open(file_path, 'r', encoding='utf-8') as f:
        return json.load(f)


def create_marine_regions() -> List[Dict[str, Any]]:
    """Создание морских регионов."""
    marine_regions = [
        # Океаны
        {
            'type': 'Feature',
            'geometry': {
                'type': 'Polygon',
                'coordinates': [[
                    [-180, -60], [0, -60], [0, 0], [-180, 0], [-180, -60]
                ]]
            },
            'properties': {
                'id': 'MARINE-ATLANTIC-SOUTH',
                'name': 'Южная Атлантика',
                'name_en': 'South Atlantic Ocean',
                'type': 'marine',
                'owner': None,
                'country_1946': None,
                'continent': 'Ocean'
            }
        },
        {
            'type': 'Feature',
            'geometry': {
                'type': 'Polygon',
                'coordinates': [[
                    [-180, 0], [0, 0], [0, 60], [-180, 60], [-180, 0]
                ]]
            },
            'properties': {
                'id': 'MARINE-ATLANTIC-NORTH',
                'name': 'Северная Атлантика',
                'name_en': 'North Atlantic Ocean',
                'type': 'marine',
                'owner': None,
                'country_1946': None,
                'continent': 'Ocean'
            }
        },
        {
            'type': 'Feature',
            'geometry': {
                'type': 'Polygon',
                'coordinates': [[
                    [0, -60], [180, -60], [180, 0], [0, 0], [0, -60]
                ]]
            },
            'properties': {
                'id': 'MARINE-INDIAN',
                'name': 'Индийский океан',
                'name_en': 'Indian Ocean',
                'type': 'marine',
                'owner': None,
                'country_1946': None,
                'continent': 'Ocean'
            }
        },
        {
            'type': 'Feature',
            'geometry': {
                'type': 'Polygon',
                'coordinates': [[
                    [0, 0], [180, 0], [180, 60], [0, 60], [0, 0]
                ]]
            },
            'properties': {
                'id': 'MARINE-PACIFIC-NORTH',
                'name': 'Северная часть Тихого океана',
                'name_en': 'North Pacific Ocean',
                'type': 'marine',
                'owner': None,
                'country_1946': None,
                'continent': 'Ocean'
            }
        },
        {
            'type': 'Feature',
            'geometry': {
                'type': 'Polygon',
                'coordinates': [[
                    [0, -60], [180, -60], [180, 0], [0, 0], [0, -60]
                ]]
            },
            'properties': {
                'id': 'MARINE-PACIFIC-SOUTH',
                'name': 'Южная часть Тихого океана',
                'name_en': 'South Pacific Ocean',
                'type': 'marine',
                'owner': None,
                'country_1946': None,
                'continent': 'Ocean'
            }
        },
        {
            'type': 'Feature',
            'geometry': {
                'type': 'Polygon',
                'coordinates': [[
                    [-180, 60], [180, 60], [180, 90], [-180, 90], [-180, 60]
                ]]
            },
            'properties': {
                'id': 'MARINE-ARCTIC',
                'name': 'Северный Ледовитый океан',
                'name_en': 'Arctic Ocean',
                'type': 'marine',
                'owner': None,
                'country_1946': None,
                'continent': 'Ocean'
            }
        },
        # Стратегические моря
        {
            'type': 'Feature',
            'geometry': {
                'type': 'Polygon',
                'coordinates': [[
                    [-10, 35], [40, 35], [40, 45], [-10, 45], [-10, 35]
                ]]
            },
            'properties': {
                'id': 'MARINE-MEDITERRANEAN-WEST',
                'name': 'Западное Средиземноморье',
                'name_en': 'Western Mediterranean',
                'type': 'marine',
                'owner': None,
                'country_1946': None,
                'continent': 'Ocean'
            }
        },
        {
            'type': 'Feature',
            'geometry': {
                'type': 'Polygon',
                'coordinates': [[
                    [10, 30], [40, 30], [40, 42], [10, 42], [10, 30]
                ]]
            },
            'properties': {
                'id': 'MARINE-MEDITERRANEAN-EAST',
                'name': 'Восточное Средиземноморье',
                'name_en': 'Eastern Mediterranean',
                'type': 'marine',
                'owner': None,
                'country_1946': None,
                'continent': 'Ocean'
            }
        },
        {
            'type': 'Feature',
            'geometry': {
                'type': 'Polygon',
                'coordinates': [[
                    [120, 20], [150, 20], [150, 35], [120, 35], [120, 20]
                ]]
            },
            'properties': {
                'id': 'MARINE-SEA-OF-JAPAN',
                'name': 'Японское море',
                'name_en': 'Sea of Japan',
                'type': 'marine',
                'owner': None,
                'country_1946': None,
                'continent': 'Ocean'
            }
        },
        {
            'type': 'Feature',
            'geometry': {
                'type': 'Polygon',
                'coordinates': [[
                    [-80, 10], [-60, 10], [-60, 25], [-80, 25], [-80, 10]
                ]]
            },
            'properties': {
                'id': 'MARINE-CARIBBEAN',
                'name': 'Карибское море',
                'name_en': 'Caribbean Sea',
                'type': 'marine',
                'owner': None,
                'country_1946': None,
                'continent': 'Ocean'
            }
        },
        {
            'type': 'Feature',
            'geometry': {
                'type': 'Polygon',
                'coordinates': [[
                    [-10, 50], [10, 50], [10, 60], [-10, 60], [-10, 50]
                ]]
            },
            'properties': {
                'id': 'MARINE-NORTH-SEA',
                'name': 'Северное море',
                'name_en': 'North Sea',
                'type': 'marine',
                'owner': None,
                'country_1946': None,
                'continent': 'Ocean'
            }
        },
        {
            'type': 'Feature',
            'geometry': {
                'type': 'Polygon',
                'coordinates': [[
                    [15, 55], [30, 55], [30, 65], [15, 65], [15, 55]
                ]]
            },
            'properties': {
                'id': 'MARINE-BALTIC-SEA',
                'name': 'Балтийское море',
                'name_en': 'Baltic Sea',
                'type': 'marine',
                'owner': None,
                'country_1946': None,
                'continent': 'Ocean'
            }
        },
        {
            'type': 'Feature',
            'geometry': {
                'type': 'Polygon',
                'coordinates': [[
                    [130, 0], [150, 0], [150, 15], [130, 15], [130, 0]
                ]]
            },
            'properties': {
                'id': 'MARINE-SOUTH-CHINA-SEA',
                'name': 'Южно-Китайское море',
                'name_en': 'South China Sea',
                'type': 'marine',
                'owner': None,
                'country_1946': None,
                'continent': 'Ocean'
            }
        },
        {
            'type': 'Feature',
            'geometry': {
                'type': 'Polygon',
                'coordinates': [[
                    [35, 20], [55, 20], [55, 30], [35, 30], [35, 20]
                ]]
            },
            'properties': {
                'id': 'MARINE-ARABIAN-SEA',
                'name': 'Аравийское море',
                'name_en': 'Arabian Sea',
                'type': 'marine',
                'owner': None,
                'country_1946': None,
                'continent': 'Ocean'
            }
        },
        {
            'type': 'Feature',
            'geometry': {
                'type': 'Polygon',
                'coordinates': [[
                    [95, 5], [105, 5], [105, 15], [95, 15], [95, 5]
                ]]
            },
            'properties': {
                'id': 'MARINE-BAY-OF-BENGAL',
                'name': 'Бенгальский залив',
                'name_en': 'Bay of Bengal',
                'type': 'marine',
                'owner': None,
                'country_1946': None,
                'continent': 'Ocean'
            }
        },
        {
            'type': 'Feature',
            'geometry': {
                'type': 'Polygon',
                'coordinates': [[
                    [-170, 50], [-130, 50], [-130, 65], [-170, 65], [-170, 50]
                ]]
            },
            'properties': {
                'id': 'MARINE-BERING-SEA',
                'name': 'Берингово море',
                'name_en': 'Bering Sea',
                'type': 'marine',
                'owner': None,
                'country_1946': None,
                'continent': 'Ocean'
            }
        },
        {
            'type': 'Feature',
            'geometry': {
                'type': 'Polygon',
                'coordinates': [[
                    [-40, -50], [-20, -50], [-20, -30], [-40, -30], [-40, -50]
                ]]
            },
            'properties': {
                'id': 'MARINE-SOUTH-ATLANTIC',
                'name': 'Южная Атлантика (южнее)',
                'name_en': 'South Atlantic (Southern)',
                'type': 'marine',
                'owner': None,
                'country_1946': None,
                'continent': 'Ocean'
            }
        },
        {
            'type': 'Feature',
            'geometry': {
                'type': 'Polygon',
                'coordinates': [[
                    [100, -50], [150, -50], [150, -30], [100, -30], [100, -50]
                ]]
            },
            'properties': {
                'id': 'MARINE-SOUTHERN-OCEAN',
                'name': 'Южный океан',
                'name_en': 'Southern Ocean',
                'type': 'marine',
                'owner': None,
                'country_1946': None,
                'continent': 'Ocean'
            }
        },
        {
            'type': 'Feature',
            'geometry': {
                'type': 'Polygon',
                'coordinates': [[
                    [25, 35], [45, 35], [45, 42], [25, 42], [25, 35]
                ]]
            },
            'properties': {
                'id': 'MARINE-BLACK-SEA',
                'name': 'Чёрное море',
                'name_en': 'Black Sea',
                'type': 'marine',
                'owner': None,
                'country_1946': None,
                'continent': 'Ocean'
            }
        },
        {
            'type': 'Feature',
            'geometry': {
                'type': 'Polygon',
                'coordinates': [[
                    [45, 35], [55, 35], [55, 42], [45, 42], [45, 35]
                ]]
            },
            'properties': {
                'id': 'MARINE-CASPIAN-SEA',
                'name': 'Каспийское море',
                'name_en': 'Caspian Sea',
                'type': 'marine',
                'owner': None,
                'country_1946': None,
                'continent': 'Ocean'
            }
        }
    ]
    
    return marine_regions


def main():
    scripts_path = Path(__file__).parent
    output_path = scripts_path.parent / 'client' / 'src' / 'assets' / 'world-map-1946.geojson'
    
    print('=== ОБЪЕДИНЕНИЕ КОНТИНЕНТОВ ===\n')
    
    # Список континентов для объединения
    continents = ['Europe', 'Asia', 'NorthAmerica', 'SouthAmerica', 'Africa']
    
    all_features = []
    
    # Загружаем и объединяем континенты
    for continent in continents:
        geojson_path = scripts_path / f'world-map-{continent.lower()}-1946.geojson'
        
        if not geojson_path.exists():
            print(f'Предупреждение: Файл {geojson_path} не найден, пропускаем')
            continue
        
        print(f'Загрузка {continent}...')
        geojson = load_json(geojson_path)
        features = geojson.get('features', [])
        all_features.extend(features)
        print(f'  Добавлено {len(features)} регионов')
    
    # Добавляем морские регионы
    print('\nДобавление морских регионов...')
    marine_regions = create_marine_regions()
    all_features.extend(marine_regions)
    print(f'  Добавлено {len(marine_regions)} морских регионов')
    
    # Создаём итоговый GeoJSON
    merged_geojson = {
        'type': 'FeatureCollection',
        'features': all_features
    }
    
    # Сохранение
    print(f'\nСохранение объединённого GeoJSON в {output_path}...')
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(merged_geojson, f, ensure_ascii=False, indent=2)
    
    # Статистика
    land_count = sum(1 for f in all_features if f.get('properties', {}).get('type') == 'land')
    marine_count = sum(1 for f in all_features if f.get('properties', {}).get('type') == 'marine')
    canal_count = sum(1 for f in all_features if f.get('properties', {}).get('type') == 'canal')
    
    print(f'\nСтатистика итогового файла:')
    print(f'Всего регионов: {len(all_features)}')
    print(f'  Земельных регионов: {land_count}')
    print(f'  Морских регионов: {marine_count}')
    print(f'  Канальных регионов: {canal_count}')
    
    # Валидация
    print('\nВалидация...')
    ids = set()
    duplicates = []
    for feature in all_features:
        fid = feature.get('properties', {}).get('id')
        if fid in ids:
            duplicates.append(fid)
        ids.add(fid)
    
    if duplicates:
        print(f'Предупреждение: Найдены дубликаты ID: {set(duplicates)}')
    else:
        print('  Дубликатов ID не найдено')
    
    print('\nГотово!')


if __name__ == '__main__':
    main()
