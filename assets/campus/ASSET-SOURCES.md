# Imported 3D vehicle assets

## Realistic Car Pack — Nov 2018

Source archive supplied with this migration. The included `License.txt` states that the Quaternius models are released under CC0 1.0 Universal (Public Domain Dedication).

Imported runtime asset:
- `assets/campus/cars/NormalCar1.glb.gz.b64`
- Converted from `OBJ/NormalCar1.obj`
- Geometry was centered on X/Z and grounded at Y=0 before GLB export.
- The packed asset is gzip-compressed + base64 encoded so the static GitHub Pages site can ship it without adding a binary build step.

## Public Transport Pack — Feb 2017

Source archive supplied with this migration. No standalone license file was present in the supplied archive, so no additional license terms are asserted here.

Imported runtime assets:
- `assets/campus/transit/Bus.glb.gz.b64`
- `assets/campus/transit/SchoolBus.glb.gz.b64`
- Converted from the corresponding OBJ files.
- Geometry was centered on X/Z and grounded at Y=0 before GLB export.
- Both models are oriented so their local length axis is rotated onto the campus road direction.

## Integration reference

The supplied `raycast-vehicle-main` repository was reviewed for GLB loading, wheel/vehicle binding, dynamic lights, skid marks/smoke, and chase-camera structure. The School Center twin keeps its existing Rapier physics and lightweight rendering architecture rather than importing that repository as a dependency.
