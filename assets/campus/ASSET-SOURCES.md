# Imported 3D vehicle assets

## Realistic Car Pack — Nov 2018

Source archive supplied with this migration. The included `License.txt` states that the Quaternius models are released under CC0 1.0 Universal (Public Domain Dedication).

Authoritative runtime source:
- `assets/campus/cars/Realistic Car Pack - Nov 2018/OBJ/NormalCar1.obj`
- `assets/campus/cars/Realistic Car Pack - Nov 2018/OBJ/NormalCar1.mtl`
- Loaded at runtime with Three.js `OBJLoader` + `MTLLoader`; the original indexed OBJ geometry and material groups are preserved.
- Material groups found: `Blue`, `Grey`, `Black`, `Windows`, `Headlights`, `TailLights`.
- The OBJ contains legitimate object groups for `NormalCar1_BackWheels_Cube.011`, `NormalCar1_FrontLeftWheel_Cube.007`, and `NormalCar1_FrontRightWheel_Cube.008`. The rear group contains both rear wheels and is animated as one shared rolling assembly; the two front groups are independently steerable and rolling.

## Public Transport Pack — Feb 2017

Source archive supplied with this migration. No standalone license file was present in the supplied archive, so no additional license terms are asserted here.

Authoritative runtime sources:
- `assets/campus/transit/Public Transport Pack - Feb 2017/OBJ/Bus.obj` + `Bus.mtl`
- `assets/campus/transit/Public Transport Pack - Feb 2017/OBJ/SchoolBus.obj` + `SchoolBus.mtl`
- Loaded at runtime with Three.js `OBJLoader` + `MTLLoader`; original geometry and material groups are preserved.
- Bus groups include `Bottom`, `Bumper`, `Details`, `Lights`, `Material`, `Top`, `Windows`.
- School bus groups include `Bumper`, `Details`, `Lights`, `Wheel`, `Windows`, `Yellow`.
- Source bus length is along local X and is rotated onto the campus Z corridor at placement time.

## Integration reference

The supplied `raycast-vehicle-main` repository was reviewed for GLB loading, wheel/vehicle binding, dynamic lights, skid marks, and chase-camera structure. The School Center twin keeps its existing Rapier physics and static-site architecture rather than importing that repository as a dependency. Its Cannon `RaycastVehicle` remains a behavior reference; the current twin's existing Rapier drive body is retained to avoid introducing another runtime dependency.
