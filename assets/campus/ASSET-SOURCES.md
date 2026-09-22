# Imported 3D vehicle assets

## Realistic Car Pack — Nov 2018

Source archive supplied with this migration. The included `License.txt` states that the Quaternius models are released under CC0 1.0 Universal (Public Domain Dedication).

Imported runtime asset:
- `assets/campus/cars/NormalCar1.json.gz.b64`
- Converted from `OBJ/NormalCar1.obj`
- Geometry was centered on X/Z and grounded at Y=0 before the lightweight mesh payload was generated.
- Source materials preserved: Blue, Grey, Black, Windows, Headlights, TailLights.
- The runtime payload is a gzip-compressed + base64 encoded JSON mesh representation derived directly from the supplied OBJ. It is intentionally reduced to convex-hull silhouette geometry by material, preserving the recognizable vehicle shape/livery while keeping GitHub Pages delivery small and avoiding a binary build step.

## Public Transport Pack — Feb 2017

Source archive supplied with this migration. No standalone license file was present in the supplied archive, so no additional license terms are asserted here.

Imported runtime assets:
- `assets/campus/transit/Bus.json.gz.b64`
- `assets/campus/transit/SchoolBus.json.gz.b64`
- Converted from the corresponding OBJ files.
- Geometry was centered on X/Z and grounded at Y=0 before the lightweight mesh payload was generated.
- The bus payloads preserve the source material groups used for the pack colors/details.
- Both models are oriented so their local length axis is rotated onto the campus road direction.

## Integration reference

The supplied `raycast-vehicle-main` repository was reviewed for GLB loading, wheel/vehicle binding, dynamic lights, skid marks/smoke, and chase-camera structure. The School Center twin keeps its existing Rapier physics and lightweight rendering architecture rather than importing that repository as a dependency.
