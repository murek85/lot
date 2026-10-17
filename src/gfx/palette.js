// Paleta (albedo liniowe) wspólna dla terenu i drzew 3D.
import { vec3 } from 'three/tsl';

// Koniec czerwca na Pomorzu.
export const COL = {
	pineOld: vec3(0.030, 0.052, 0.018),
	pineYoung: vec3(0.046, 0.080, 0.022),
	leafy: vec3(0.058, 0.100, 0.026),
	gap: vec3(0.016, 0.024, 0.010),
	forestFloor: vec3(0.10, 0.09, 0.05),
	sand: vec3(0.40, 0.33, 0.20),
	meadowA: vec3(0.085, 0.150, 0.040),
	meadowB: vec3(0.125, 0.160, 0.055),
	rapeseed: vec3(0.150, 0.170, 0.065), // rzepak w łuszczynach (koniec czerwca),
	cerealGreen: vec3(0.110, 0.190, 0.050),
	wheatBlue: vec3(0.140, 0.185, 0.090),
	ripening: vec3(0.220, 0.190, 0.075),
	soil: vec3(0.120, 0.098, 0.074),
	maize: vec3(0.085, 0.100, 0.045),
	roofRed: vec3(0.240, 0.070, 0.040),
	roofBrown: vec3(0.120, 0.075, 0.055),
	roofGrey: vec3(0.150, 0.150, 0.155),
	asphalt: vec3(0.060, 0.060, 0.065),
	garden: vec3(0.070, 0.120, 0.040),
	wetland: vec3(0.070, 0.095, 0.045),
	waterDeep: vec3(0.0025, 0.007, 0.008),
	waterShallow: vec3(0.012, 0.020, 0.013),
};
