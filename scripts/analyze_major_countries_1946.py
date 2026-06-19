#!/usr/bin/env python3
"""
Анализ ADM1 кодов крупных стран для создания правильного маппинга 1946.
"""

import json
from pathlib import Path
from typing import Dict, List


def load_geojson(file_path: Path) -> Dict:
    """Загрузка GeoJSON."""
    with open(file_path, 'r', encoding='utf-8') as f:
        return json.load(f)


def main():
    geojson_path = Path(__file__).parent.parent / 'client' / 'src' / 'assets' / 'game_map.json'
    
    print('Загрузка GeoJSON...')
    geojson = load_geojson(geojson_path)
    
    # Крупные страны для анализа
    major_countries = ['RUS', 'USA', 'CHN', 'CAN', 'AUS', 'IND', 'BRA', 'ARG', 'DEU', 'GBR', 'FRA', 'JPN']
    
    country_regions: Dict[str, List[Dict]] = {}
    
    for feature in geojson['features']:
        props = feature.get('properties', {})
        adm0_a3 = props.get('adm0_a3') or props.get('iso_a3')
        if adm0_a3 in major_countries:
            if adm0_a3 not in country_regions:
                country_regions[adm0_a3] = []
            country_regions[adm0_a3].append({
                'name': props.get('name'),
                'adm1_code': props.get('adm1_code'),
                'iso_a2': props.get('iso_a2')
            })
    
    print('\n=== АНАЛИЗ КРУПНЫХ СТРАН ===\n')
    
    for country in major_countries:
        if country in country_regions:
            regions = country_regions[country]
            print(f'{country}: {len(regions)} регионов')
            print(f'  ADM1 коды: {[r["adm1_code"] for r in regions[:10]]}...')
            print()
        else:
            print(f'{country}: 0 регионов')
            print()
    
    # Сохранение детальной информации
    output_path = Path(__file__).parent / 'major_countries_adm1_codes.json'
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(country_regions, f, ensure_ascii=False, indent=2)
    
    print(f'Детальная информация сохранена в: {output_path}')


if __name__ == '__main__':
    main()
