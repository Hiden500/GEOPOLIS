import json
import os
from shapely.geometry import shape, MultiPolygon
from shapely.ops import unary_union

# Paths
INPUT_PATH = "client/src/assets/game_map.json"
OUTPUT_PATH = "client/public/world-map-1946-slovenia-unioned.geojson"

def main():
    print(f"Loading {INPUT_PATH}...")
    with open(INPUT_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)

    slovenia_features = []
    other_features = []

    for feature in data["features"]:
        props = feature.get("properties", {})
        name_en = props.get("name_en", "").lower()
        name_ru = props.get("name_ru", "").lower()
        iso_a2 = props.get("iso_a2", "")

        # Criteria for Slovenia
        is_slovenia = (
            any(x in name_en for x in ["sloven", "sloveni"]) or 
            any(x in name_ru for x in ["словен", "словени"]) or 
            iso_a2 == "SI" or 
            "slovenia" in name_en
        )

        if is_slovenia:
            slovenia_features.append(feature)
        else:
            other_features.append(feature)

    print(f"Found Slovenia features: {len(slovenia_features)}")
    print(f"Other features: {len(other_features)}")

    if not slovenia_features:
        print("No Slovenia features found. Saving original map as output.")
        new_data = data
    else:
        geoms = [shape(f["geometry"]) for f in slovenia_features if f.get("geometry")]
        if geoms:
            unioned = unary_union(geoms)
            
            # Ensure output is a MultiPolygon for consistency
            if unioned.geom_type == "Polygon":
                unioned_geom = MultiPolygon([unioned])
            elif unioned.geom_type == "MultiPolygon":
                unioned_geom = unioned
            else:
                # Handle GeometryCollection or other types
                if hasattr(unioned, "geoms"):
                    unioned_geom = MultiPolygon([g for g in unioned.geoms if g.geom_type in ["Polygon", "MultiPolygon"]])
                else:
                    unioned_geom = MultiPolygon([])

            new_feature = {
                "type": "Feature",
                "id": "SVN-1946-unioned",
                "properties": {
                    "name_ru": "Словения",
                    "name_en": "Slovenia",
                    "country_1946": "Югославия",
                    "owner": "YUG",
                    "population_1946": 1450000,
                    "gdp_1946": 1200000000,
                    "gdp_per_capita_1946": 827,
                    "adm_level": "Republic",
                    "historical_notes": "1946: Union всех ADM1 на территории Словении. Часть Югославии.",
                    "is_unioned": True,
                    "iso_a2": "SI"
                },
                "geometry": unioned_geom.__geo_interface__
            }
            
            # The final collection includes all other features and the new united Slovenia
            new_data = {
                "type": "FeatureCollection",
                "features": other_features + [new_feature]
            }
            print("Successfully united Slovenia features.")
        else:
            print("No valid geometries found for Slovenia.")
            new_data = data

    # Ensure output directory exists
    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(new_data, f, ensure_ascii=False)
    
    print(f"Success: Result saved to {OUTPUT_PATH}")
    print(f"Total features in output: {len(new_data['features'])}")

if __name__ == "__main__":
    main()