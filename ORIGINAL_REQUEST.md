# Original User Request

## Initial Request — 2026-07-01T22:56:58+03:00

Implement robust Paradox-style text stretching and curved/straight placement for country labels in Geopolis map engine, following the guidelines from `docs/GEMINI_MAP_ENGINE.md` and resolving overlapping and wavy line visual defects.

Working directory: d:\PaxHistoriaLocal
Integrity mode: development

## Requirements

### R1. Web Mercator Coordinate System Conversion
- Convert all coordinate calculations for baseline measuring, layout, spacing, and interpolation from geographic degrees `[lon, lat]` to flat 2D Web Mercator projection coordinates `[x, y]`.
- Convert final letter coordinates back to `[lon, lat]` degrees for the MapLibre GeoJSON Point features.
- Avoid using spherical Turf.js math (`along`, `length`, `bearing`) inside the interpolation loop to eliminate CPU overhead and Mercator latitude scaling distortions. Use flat vector math in Web Mercator space.

### R2. Dynamic Baseline Generation (Straight vs Curved)
- For compact/round countries (where `axis.spanLongAxisDeg / axis.spanShortAxisDeg < 1.4`), build a perfectly straight baseline along the main PCA axis centered at the country's centroid.
- For elongated countries (where the axis ratio is `>= 1.4`), construct a curved baseline by grouping and smoothing region centroids along the main axis.
- Ensure the baseline coordinates always flow from left to right (if the endpoint's X in Web Mercator is less than the startpoint's X, reverse the coordinates array).

### R3. Proportional Kerning & Extrapolation
- Implement a character width factor dictionary (lookup table) to support proportional spacing for letters of different sizes (e.g. wide letters like 'W', 'M' vs narrow letters like 'I', 'l', 't' and spaces).
- Place each letter at its calculated distance along the Web Mercator baseline. 
- If the label is longer than the baseline, **extrapolate** coordinates linearly along the tangents of the start or end segments, rather than clamping (which causes letter piling).
- Compute tangent angles using `Math.atan2(-dy, dx) * 180 / Math.PI` in Web Mercator space for letter rotations.

### R4. Map Style Integration
- Update `GeometryEngine.ts` and `MapView.tsx`:
  - Split country names into letters and output them as a `FeatureCollection<Point>`.
  - Configure the style layer to render the letters using `text-rotate` and `text-keep-upright: false`.
  - Remove the static `text-letter-spacing` from styles.

## Acceptance Criteria

### Correct Layout and Rotation
- [ ] No letter overlapping or edge pile-ups in any country (e.g., Sumatra, France, Poland, Italy, Portugal).
- [ ] Round countries (e.g., France, Poland) have straight labels. Elongated countries (e.g., Soviet Union, Norway, Chile) curve smoothly following their shape without wavy/zigzag artifacts.
- [ ] Letters in curved labels align continuously without individual letters being flipped upside down.
- [ ] TypeScript compiles successfully (`npx tsc --noEmit` returns 0 errors in the client directory).
