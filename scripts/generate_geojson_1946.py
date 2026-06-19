#!/usr/bin/env python3
"""
Генерация GeoJSON для сценария 1946 года.
Объединяет полигоны согласно маппингу, создаёт канальные и морские регионы.
"""

import json
from pathlib import Path
from typing import Dict, List, Any, Optional
from shapely.geometry import shape, mapping
from shapely.ops import unary_union


def load_geojson(file_path: Path) -> Dict[str, Any]:
    """Загрузка GeoJSON."""
    with open(file_path, 'r', encoding='utf-8') as f:
        return json.load(f)


def load_mapping(file_path: Path) -> Dict[str, Dict[str, Any]]:
    """Загрузка маппинга."""
    with open(file_path, 'r', encoding='utf-8') as f:
        return json.load(f)


def create_adm1_to_feature_map(geojson: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    """Создание карты ADM1 кодов в фичи."""
    adm1_map = {}
    for feature in geojson['features']:
        adm1_code = feature.get('properties', {}).get('adm1_code') or feature.get('id')
        if adm1_code:
            adm1_map[adm1_code] = feature
    return adm1_map


def union_features(features: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Объединение фич в один полигон с сохранением геометрии."""
    if not features:
        return None
    if len(features) == 1:
        return features[0]
    
    try:
        geometries = []
        for feature in features:
            geom = shape(feature.get('geometry'))
            if geom and not geom.is_empty:
                # Буферизация для исправления небольших ошибок топологии
                if not geom.is_valid:
                    geom = geom.buffer(0)
                if geom and not geom.is_empty:
                    geometries.append(geom)
        
        if not geometries:
            return features[0]
        
        # Используем unary_union с обработкой ошибок
        try:
            unioned = unary_union(geometries)
            if unioned.is_empty:
                return features[0]
            
            # Проверяем валидность результата
            if not unioned.is_valid:
                unioned = unioned.buffer(0)
            
            return {
                'type': 'Feature',
                'geometry': mapping(unioned),
                'properties': {}
            }
        except Exception as e:
            print(f'Ошибка при unary_union: {e}')
            # Если union не сработал, возвращаем MultiPolygon с отдельными геометриями
            return {
                'type': 'Feature',
                'geometry': {
                    'type': 'MultiPolygon',
                    'coordinates': [geom.coordinates for geom in geometries if geom.geom_type == 'Polygon'] + 
                                   [list(geom.coordinates) for geom in geometries if geom.geom_type == 'MultiPolygon']
                },
                'properties': {}
            }
    except Exception as e:
        print(f'Ошибка при объединении полигонов: {e}')
        return features[0]


def is_valid_polygon(feature: Dict[str, Any]) -> bool:
    """Проверка валидности полигона."""
    try:
        geom = shape(feature.get('geometry'))
        return geom.is_valid
    except:
        return False


# Перевод названий на русский (упрощённый словарь)
RUSSIAN_NAMES = {
    'USA': 'США',
    'United States': 'Соединённые Штаты Америки',
    'USSR': 'СССР',
    'Russia': 'Россия',
    'China': 'Китай',
    'Canada': 'Канада',
    'Australia': 'Австралия',
    'India': 'Индия',
    'Brazil': 'Бразилия',
    'Argentina': 'Аргентина',
    'Germany': 'Германия',
    'France': 'Франция',
    'United Kingdom': 'Великобритания',
    'Italy': 'Италия',
    'Japan': 'Япония',
    'Mexico': 'Мексика',
    'Saudi Arabia': 'Саудовская Аравия',
    'Indonesia': 'Индонезия',
    'Turkey': 'Турция',
    'Iran': 'Иран',
    'Egypt': 'Египет',
    'South Africa': 'ЮАР',
    'Poland': 'Польша',
    'Ukraine': 'Украина',
    'Belarus': 'Беларусь',
    'Kazakhstan': 'Казахстан',
    'Uzbekistan': 'Узбекистан',
    'Pakistan': 'Пакистан',
    'Vietnam': 'Вьетнам',
    'Thailand': 'Таиланд',
    'Myanmar': 'Мьянма',
    'Afghanistan': 'Афганистан',
    'Iraq': 'Ирак',
    'Syria': 'Сирия',
    'Yemen': 'Йемен',
    'Oman': 'Оман',
    'Jordan': 'Иордания',
    'Lebanon': 'Ливан',
    'Israel': 'Израиль',
    'Morocco': 'Марокко',
    'Algeria': 'Алжир',
    'Tunisia': 'Тунис',
    'Libya': 'Ливия',
    'Sudan': 'Судан',
    'Ethiopia': 'Эфиопия',
    'Kenya': 'Кения',
    'Tanzania': 'Танзания',
    'Uganda': 'Уганда',
    'Nigeria': 'Нигерия',
    'Ghana': 'Гана',
    'Senegal': 'Сенегал',
    'Mali': 'Мали',
    'Burkina Faso': 'Буркина-Фасо',
    'Niger': 'Нигер',
    'Chad': 'Чад',
    'Cameroon': 'Камерун',
    'Congo': 'Конго',
    'Angola': 'Ангола',
    'Zambia': 'Замбия',
    'Zimbabwe': 'Зимбабве',
    'Botswana': 'Ботсвана',
    'Namibia': 'Намибия',
    'Madagascar': 'Мадагаскар',
    'Sweden': 'Швеция',
    'Norway': 'Норвегия',
    'Finland': 'Финляндия',
    'Denmark': 'Дания',
    'Ireland': 'Ирландия',
    'Portugal': 'Португалия',
    'Spain': 'Испания',
    'Belgium': 'Бельгия',
    'Netherlands': 'Нидерланды',
    'Luxembourg': 'Люксембург',
    'Switzerland': 'Швейцария',
    'Austria': 'Австрия',
    'Czech Republic': 'Чехия',
    'Slovakia': 'Словакия',
    'Lithuania': 'Литва',
    'Latvia': 'Латвия',
    'Estonia': 'Эстония',
    'Moldova': 'Молдавия',
    'Romania': 'Румыния',
    'Bulgaria': 'Болгария',
    'Greece': 'Греция',
    'Albania': 'Албания',
    'Serbia': 'Сербия',
    'Croatia': 'Хорватия',
    'Slovenia': 'Словения',
    'Cyprus': 'Кипр',
    'Georgia': 'Грузия',
    'Armenia': 'Армения',
    'Azerbaijan': 'Азербайджан',
    'Turkmenistan': 'Туркменистан',
    'Kyrgyzstan': 'Киргизия',
    'Tajikistan': 'Таджикистан',
    'Nepal': 'Непал',
    'Bhutan': 'Бутан',
    'Bangladesh': 'Бангладеш',
    'Sri Lanka': 'Шри-Ланка',
    'Laos': 'Лаос',
    'Cambodia': 'Камбоджа',
    'Malaysia': 'Малайзия',
    'Singapore': 'Сингапур',
    'Philippines': 'Филиппины',
    'Taiwan': 'Тайвань',
    'Mongolia': 'Монголия',
    'North Korea': 'КНДР',
    'South Korea': 'РК'
}


def translate_to_russian(name: str) -> str:
    """Перевод названия на русский."""
    return RUSSIAN_NAMES.get(name, name)


# Исторические владельцы для 1946 года
HISTORICAL_OWNERS_1946 = {
    'DEU': 'DEU_USSR',  # Германия будет разделена на 4 зоны
    'IDN': 'NLD',  # Нидерландская Ост-Индия
    'VNM': 'FRA',  # Французский Индокитай
    'LAO': 'FRA',
    'KHM': 'FRA',
    'IND': 'GBR',  # Британская Индия
    'PAK': 'GBR',
    'MMR': 'GBR',  # Бирма
    'EGY': 'GBR',  # Британский протекторат
    'LBY': 'GBR',  # Британская администрация
    'SDN': 'GBR',  # Англо-египетский Судан
    'MAR': 'FRA',  # Французский протекторат
    'TUN': 'FRA',
    'DZA': 'FRA',  # Французский департамент
    'MUS': 'GBR',  # Британская колония
    'SGP': 'GBR',
    'HKG': 'GBR',
    'MAC': 'PRT',  # Португальская колония
}


def generate_geojson(
    geojson: Dict[str, Any],
    mapping: Dict[str, Dict[str, Any]]
) -> Dict[str, Any]:
    """Генерация GeoJSON с объединёнными полигонами."""
    adm1_to_feature_map = create_adm1_to_feature_map(geojson)
    new_features = []
    
    for country_iso, country_mapping in mapping.items():
        for macro_region_name, adm1_codes in country_mapping['mapping'].items():
            features = []
            
            for adm1_code in adm1_codes:
                feature = adm1_to_feature_map.get(adm1_code)
                if feature:
                    features.append(feature)
            
            if not features:
                print(f'Не найдены фичи для {country_iso}/{macro_region_name}')
                continue
            
            # Если только одна фича, используем её напрямую
            if len(features) == 1:
                final_feature = features[0]
            else:
                unioned_feature = union_features(features)
                if not unioned_feature:
                    print(f'Не удалось объединить фичи для {country_iso}/{macro_region_name}, используем первую')
                    final_feature = features[0]
                elif not is_valid_polygon(unioned_feature):
                    print(f'Невалидный полигон для {country_iso}/{macro_region_name}, используем первую')
                    final_feature = features[0]
                else:
                    final_feature = unioned_feature
            
            # Определяем владельца для 1946 года
            owner_country_id = country_iso
            if country_iso == 'DEU':
                # Германия будет обработана отдельно
                continue
            if country_iso in HISTORICAL_OWNERS_1946:
                owner_country_id = HISTORICAL_OWNERS_1946[country_iso]
            
            # Получаем название из первой фичи
            original_name = features[0].get('properties', {}).get('name', macro_region_name)
            russian_name = translate_to_russian(original_name)
            
            new_features.append({
                'type': 'Feature',
                'geometry': final_feature.get('geometry'),
                'properties': {
                    'id': f'{country_iso}-{macro_region_name}',
                    'name': russian_name,
                    'name_en': original_name,
                    'ownerCountryId': owner_country_id,
                    'countryIso': country_iso,
                    'macroRegion': macro_region_name,
                    'sourceAdm1Codes': adm1_codes,
                    'historicalYear': 1946,
                    'kind': 'land'
                }
            })
    
    return {
        'type': 'FeatureCollection',
        'features': new_features
    }


def main():
    geojson_path = Path(__file__).parent.parent / 'client' / 'src' / 'assets' / 'game_map.json'
    mapping_path = Path(__file__).parent / 'region_mapping_1946.json'
    output_path = Path(__file__).parent.parent / 'client' / 'public' / 'world-map-1946.geojson'
    
    print('Загрузка GeoJSON...')
    geojson = load_geojson(geojson_path)
    print(f'Загружено {len(geojson["features"])} регионов')
    
    print('Загрузка маппинга...')
    mapping = load_mapping(mapping_path)
    
    print('Генерация GeoJSON с union полигонами...')
    new_geojson = generate_geojson(geojson, mapping)
    
    print('Сохранение GeoJSON...')
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(new_geojson, f, ensure_ascii=False, indent=2)
    print(f'GeoJSON сохранён в {output_path}')
    
    print(f'\nСтатистика:')
    print(f'Всего макро-регионов: {len(new_geojson["features"])}')


if __name__ == '__main__':
    main()
