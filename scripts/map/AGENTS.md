# Map/data pipeline rules

Применяется к `scripts/map/` и генерируемым scenario data вместе с корневым
`AGENTS.md`.

- `make_1946.py` — оркестратор; builders/validators и `paths.py` определяют
  фактический pipeline. Не запускай полный rebuild без проверки inputs,
  dependencies и ожидаемых generated outputs.
- Исторические числа не выдумывай: фиксируй source, confidence и assumption по
  `docs/HISTORICAL_ACCURACY.md`.
- Сохраняй валидную геометрию, стабильные IDs и согласованность TS/Python
  resource catalog. Не редактируй generated output как единственный источник.
- Полный rebuild требует `pyproj`, Shapely и PyShp; dependency manifest пока
  отсутствует — это известный reproducibility gap.

Минимальные проверки из корня:

```text
python scripts/map/validate_region_economy_1946.py
python scripts/map/test_validate_region_economy_1946.py
```

Отчёт всегда разделяет validator pass и непроверенный full rebuild.
