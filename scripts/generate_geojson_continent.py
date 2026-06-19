#!/usr/bin/env python3
"""
Генерация GeoJSON для отдельного континента.
Использование: python scripts/generate_geojson_continent.py <continent_name>
"""

import json
import sys
from pathlib import Path
from typing import Dict, List, Any

try:
    from shapely.geometry import shape
    from shapely.ops import unary_union
    from shapely.geometry import mapping as geojson_mapping
except ImportError:
    print("Ошибка: Требуется библиотека shapely")
    print("Установите: pip install shapely")
    sys.exit(1)


def load_json(file_path: Path) -> Dict[str, Any]:
    """Загрузка JSON файла."""
    with open(file_path, 'r', encoding='utf-8') as f:
        return json.load(f)


def load_geojson(file_path: Path) -> Dict[str, Any]:
    """Загрузка GeoJSON."""
    with open(file_path, 'r', encoding='utf-8') as f:
        return json.load(f)


def translate_name_to_russian(name: str, iso_a2: str) -> str:
    """Перевод названий на русский для 1946 года."""
    # Базовый словарь переводов для 1946 года
    translations = {
        # Европа
        'Albania': 'Албания',
        'Andorra': 'Андорра',
        'Austria': 'Австрия',
        'Belgium': 'Бельгия',
        'Bulgaria': 'Болгария',
        'Belarus': 'Белоруссия',
        'Bosnia and Herzegovina': 'Босния и Герцеговина',
        'Switzerland': 'Швейцария',
        'Cyprus': 'Кипр',
        'Czech Republic': 'Чехословакия',
        'Czechia': 'Чехословакия',
        'Germany': 'Германия',
        'Denmark': 'Дания',
        'Spain': 'Испания',
        'Estonia': 'Эстония',
        'Finland': 'Финляндия',
        'France': 'Франция',
        'United Kingdom': 'Великобритания',
        'Greece': 'Греция',
        'Croatia': 'Хорватия',
        'Hungary': 'Венгрия',
        'Ireland': 'Ирландия',
        'Iceland': 'Исландия',
        'Italy': 'Италия',
        'Lithuania': 'Литва',
        'Luxembourg': 'Люксембург',
        'Latvia': 'Латвия',
        'Moldova': 'Молдавия',
        'North Macedonia': 'Македония',
        'Malta': 'Мальта',
        'Montenegro': 'Черногория',
        'Netherlands': 'Нидерланды',
        'Norway': 'Норвегия',
        'Poland': 'Польша',
        'Portugal': 'Португалия',
        'Romania': 'Румыния',
        'Russia': 'СССР',
        'Serbia': 'Сербия',
        'Slovakia': 'Словакия',
        'Slovenia': 'Словения',
        'Sweden': 'Швеция',
        'Ukraine': 'Украина',
        'Vatican': 'Ватикан',
        
        # Азия
        'Afghanistan': 'Афганистан',
        'Armenia': 'Армения',
        'Azerbaijan': 'Азербайджан',
        'Bangladesh': 'Восточный Пакистан',
        'Bahrain': 'Бахрейн',
        'Brunei': 'Бруней',
        'Bhutan': 'Бутан',
        'China': 'Китай',
        'Georgia': 'Грузия',
        'India': 'Индия',
        'Indonesia': 'Индонезия',
        'Iran': 'Иран',
        'Iraq': 'Ирак',
        'Israel': 'Израиль',
        'Jordan': 'Иордания',
        'Japan': 'Япония',
        'Kazakhstan': 'Казахстан',
        'Kyrgyzstan': 'Киргизия',
        'Cambodia': 'Камбоджа',
        'South Korea': 'Южная Корея',
        'Kuwait': 'Кувейт',
        'Laos': 'Лаос',
        'Lebanon': 'Ливан',
        'Sri Lanka': 'Шри-Ланка',
        'Malaysia': 'Малайзия',
        'Myanmar': 'Бирма',
        'Mongolia': 'Монголия',
        'Nepal': 'Непал',
        'Oman': 'Оман',
        'Pakistan': 'Пакистан',
        'Philippines': 'Филиппины',
        'North Korea': 'Северная Корея',
        'Qatar': 'Катар',
        'Saudi Arabia': 'Саудовская Аравия',
        'Singapore': 'Сингапур',
        'Syria': 'Сирия',
        'Thailand': 'Таиланд',
        'Tajikistan': 'Таджикистан',
        'East Timor': 'Восточный Тимор',
        'Turkey': 'Турция',
        'Turkmenistan': 'Туркменистан',
        'United Arab Emirates': 'ОАЭ',
        'Uzbekistan': 'Узбекистан',
        'Vietnam': 'Вьетнам',
        'Yemen': 'Йемен',
        
        # Северная Америка
        'Aruba': 'Аруба',
        'Antigua and Barbuda': 'Антигуа и Барбуда',
        'Bahamas': 'Багамы',
        'Belize': 'Белиз',
        'Canada': 'Канада',
        'Costa Rica': 'Коста-Рика',
        'Cuba': 'Куба',
        'Dominica': 'Доминика',
        'Dominican Republic': 'Доминиканская Республика',
        'Grenada': 'Гренада',
        'Guatemala': 'Гватемала',
        'Honduras': 'Гондурас',
        'Haiti': 'Гаити',
        'Jamaica': 'Ямайка',
        'Mexico': 'Мексика',
        'Nicaragua': 'Никарагуа',
        'Panama': 'Панама',
        'El Salvador': 'Сальвадор',
        'Trinidad and Tobago': 'Тринидад и Тобаго',
        'United States': 'США',
        
        # Южная Америка
        'Argentina': 'Аргентина',
        'Bolivia': 'Боливия',
        'Brazil': 'Бразилия',
        'Chile': 'Чили',
        'Colombia': 'Колумбия',
        'Ecuador': 'Эквадор',
        'Guyana': 'Гайана',
        'Peru': 'Перу',
        'Paraguay': 'Парагвай',
        'Suriname': 'Суринам',
        'Uruguay': 'Уругвай',
        'Venezuela': 'Венесуэла',
        
        # Африка
        'Angola': 'Ангола',
        'Benin': 'Дагомея',
        'Burkina Faso': 'Верхняя Вольта',
        'Botswana': 'Ботсвана',
        'Central African Republic': 'ЦАР',
        'Cameroon': 'Камерун',
        'DR Congo': 'Конго',
        'Congo': 'Конго',
        'Côte d\'Ivoire': 'Кот-д\'Ивуар',
        'Djibouti': 'Джибути',
        'Egypt': 'Египет',
        'Eritrea': 'Эритрея',
        'Ethiopia': 'Эфиопия',
        'Gabon': 'Габон',
        'Ghana': 'Гана',
        'Guinea': 'Гвинея',
        'Guinea-Bissau': 'Гвинея-Бисау',
        'Equatorial Guinea': 'Экваториальная Гвинея',
        'Kenya': 'Кения',
        'Liberia': 'Либерия',
        'Lesotho': 'Лесото',
        'Morocco': 'Марокко',
        'Madagascar': 'Мадагаскар',
        'Mali': 'Мали',
        'Mozambique': 'Мозамбик',
        'Mauritania': 'Мавритания',
        'Mauritius': 'Маврикий',
        'Malawi': 'Малави',
        'Namibia': 'Намибия',
        'Niger': 'Нигер',
        'Nigeria': 'Нигерия',
        'Rwanda': 'Руанда',
        'Sudan': 'Судан',
        'Senegal': 'Сенегал',
        'Sierra Leone': 'Сьерра-Леоне',
        'Somalia': 'Сомали',
        'South Sudan': 'Южный Судан',
        'São Tomé and Príncipe': 'Сан-Томе и Принсипи',
        'Eswatini': 'Свазиленд',
        'Chad': 'Чад',
        'Togo': 'Того',
        'Tunisia': 'Тунис',
        'Tanzania': 'Танзания',
        'Uganda': 'Уганда',
        'South Africa': 'ЮАР',
        'Zambia': 'Замбия',
        'Zimbabwe': 'Родезия',
        
        # Океания
        'Australia': 'Австралия',
        'Fiji': 'Фиджи',
        'Kiribati': 'Кирибати',
        'Marshall Islands': 'Маршалловы Острова',
        'Micronesia': 'Микронезия',
        'Nauru': 'Науру',
        'New Zealand': 'Новая Зеландия',
        'Palau': 'Палау',
        'Papua New Guinea': 'Папуа-Новая Гвинея',
        'Solomon Islands': 'Соломоновы Острова',
        'Tonga': 'Тонга',
        'Tuvalu': 'Тувалу',
        'Vanuatu': 'Вануату',
        'Samoa': 'Самоа',
    }
    
    return translations.get(name, name)


def get_owner_1946(iso_a2: str, iso_a3: str) -> str:
    """Определение владельца региона для 1946 года."""
    # Особые случаи для 1946 года
    special_owners = {
        'DEU': 'DEU_UK',  # Германия под британской оккупацией (по умолчанию)
        'KOR': 'USA',     # Корея под американской оккупацией
        'JPN': 'USA',     # Япония под американской оккупацией
    }
    
    if iso_a2 in special_owners:
        return special_owners[iso_a2]
    if iso_a3 in special_owners:
        return special_owners[iso_a3]
    
    return iso_a3 or iso_a2


def create_canal_regions() -> List[Dict[str, Any]]:
    """Создание канальных регионов."""
    canals = [
        {
            'type': 'Feature',
            'geometry': {
                'type': 'Polygon',
                'coordinates': [[
                    [32.5, 29.9], [32.6, 29.9], [32.6, 30.1], [32.5, 30.1], [32.5, 29.9]
                ]]
            },
            'properties': {
                'id': 'CANAL-SUEZ',
                'name': 'Суэцкий канал',
                'name_en': 'Suez Canal',
                'type': 'canal',
                'owner': 'GBR',
                'country_1946': 'GBR',
                'naval_chokepoint': True,
                'continent': 'Africa'
            }
        },
        {
            'type': 'Feature',
            'geometry': {
                'type': 'Polygon',
                'coordinates': [[
                    [-79.7, 9.0], [-79.6, 9.0], [-79.6, 9.2], [-79.7, 9.2], [-79.7, 9.0]
                ]]
            },
            'properties': {
                'id': 'CANAL-PANAMA',
                'name': 'Панамский канал',
                'name_en': 'Panama Canal',
                'type': 'canal',
                'owner': 'USA',
                'country_1946': 'USA',
                'naval_chokepoint': True,
                'continent': 'NorthAmerica'
            }
        },
        {
            'type': 'Feature',
            'geometry': {
                'type': 'Polygon',
                'coordinates': [[
                    [9.0, 54.3], [9.2, 54.3], [9.2, 54.5], [9.0, 54.5], [9.0, 54.3]
                ]]
            },
            'properties': {
                'id': 'CANAL-KIEL',
                'name': 'Кильский канал',
                'name_en': 'Kiel Canal',
                'type': 'canal',
                'owner': 'DEU_UK',
                'country_1946': 'DEU_UK',
                'naval_chokepoint': True,
                'continent': 'Europe'
            }
        }
    ]
    
    return canals


def generate_continent_geojson(
    geojson: Dict[str, Any],
    mapping: Dict[str, Any],
    continent_name: str
) -> Dict[str, Any]:
    """Генерация GeoJSON для континента на основе маппинга."""
    
    # Создаём словарь ADM1 кодов для быстрого поиска
    adm1_to_feature = {}
    for feature in geojson['features']:
        props = feature.get('properties', {})
        adm1_code = props.get('adm1_code') or feature.get('id')
        if adm1_code:
            adm1_to_feature[adm1_code] = feature
    
    features = []
    
    # Обрабатываем каждую страну в маппинге
    for iso_a3, country_data in mapping.items():
        country_mapping = country_data.get('mapping', {})
        
        for region_id, adm1_codes in country_mapping.items():
            # Собираем все полигоны для региона
            geometries = []
            region_props = {
                'id': f'{iso_a3}-{region_id}',
                'name': region_id,
                'type': 'land',
                'owner': iso_a3,
                'country_1946': get_owner_1946(iso_a3, iso_a3),
                'continent': continent_name
            }
            
            for adm1_code in adm1_codes:
                if adm1_code in adm1_to_feature:
                    feature = adm1_to_feature[adm1_code]
                    geom = feature.get('geometry')
                    if geom:
                        try:
                            shapely_geom = shape(geom)
                            geometries.append(shapely_geom)
                            
                            # Сохраняем оригинальные свойства
                            props = feature.get('properties', {})
                            if 'name' not in region_props or region_props['name'] == region_id:
                                region_props['name'] = translate_name_to_russian(
                                    props.get('name', region_id),
                                    props.get('iso_a2', '')
                                )
                            region_props['name_en'] = props.get('name', region_id)
                        except Exception as e:
                            print(f"  Ошибка при обработке геометрии {adm1_code}: {e}")
            
            # Объединяем геометрии
            if geometries:
                try:
                    unioned = unary_union(geometries)
                    geojson_geom = geojson_mapping(unioned)
                    
                    feature = {
                        'type': 'Feature',
                        'geometry': geojson_geom,
                        'properties': region_props
                    }
                    features.append(feature)
                except Exception as e:
                    print(f"  Ошибка при объединении геометрий для {region_id}: {e}")
    
    # Добавляем канальные регионы для соответствующих континентов
    if continent_name in ['Africa', 'NorthAmerica', 'Europe']:
        canal_regions = create_canal_regions()
        for canal in canal_regions:
            if canal['properties']['continent'] == continent_name:
                features.append(canal)
    
    return {
        'type': 'FeatureCollection',
        'features': features
    }


def main():
    if len(sys.argv) < 2:
        print('Использование: python scripts/generate_geojson_continent.py <continent_name>')
        print('Доступные континенты: Europe, Asia, NorthAmerica, SouthAmerica, Africa, Oceania')
        sys.exit(1)
    
    continent_name = sys.argv[1]
    
    geojson_path = Path(__file__).parent.parent / 'client' / 'src' / 'assets' / 'game_map.json'
    continents_path = Path(__file__).parent / 'continents_1946.json'
    mapping_path = Path(__file__).parent / f'{continent_name}_mapping_1946.json'
    output_path = Path(__file__).parent / f'world-map-{continent_name.lower()}-1946.geojson'
    
    print(f'=== ГЕНЕРАЦИЯ GEOJSON ДЛЯ КОНТИНЕНТА: {continent_name} ===\n')
    
    # Загрузка данных
    print('Загрузка GeoJSON...')
    geojson = load_geojson(geojson_path)
    print(f'Загружено {len(geojson["features"])} регионов')
    
    print('Загрузка маппинга...')
    if not mapping_path.exists():
        print(f'Ошибка: Файл маппинга не найден: {mapping_path}')
        print(f'Сначала запустите: python scripts/generate_continent_mapping_1946.py {continent_name}')
        sys.exit(1)
    
    mapping = load_json(mapping_path)
    print(f'Загружен маппинг для {len(mapping)} стран')
    
    # Генерация GeoJSON
    print('\nГенерация GeoJSON...')
    continent_geojson = generate_continent_geojson(geojson, mapping, continent_name)
    
    # Сохранение
    print(f'Сохранение GeoJSON в {output_path}...')
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(continent_geojson, f, ensure_ascii=False, indent=2)
    
    # Статистика
    print(f'\nСтатистика:')
    print(f'Всего регионов в GeoJSON: {len(continent_geojson["features"])}')
    
    canal_count = sum(1 for f in continent_geojson['features'] if f.get('properties', {}).get('type') == 'canal')
    if canal_count > 0:
        print(f'Канальных регионов: {canal_count}')


if __name__ == '__main__':
    main()
