import type { EquipmentProfile, Library } from "../domain/models";
import { validateCombos, validateExercises, validateTechniques } from "../domain/content";
import combos from "./combos.json";
import equipmentProfiles from "./equipment-profiles.json";
import exercises from "./exercises.json";
import techniques from "./techniques.json";

export function loadLibrary(): Library {
  const library = {
    techniques,
    combos,
    exercises,
  } as Library;
  validateTechniques(library.techniques);
  validateCombos(library.combos, library.techniques);
  validateExercises(library.exercises);
  return library;
}

export const DEFAULT_EQUIPMENT_PROFILES = equipmentProfiles as EquipmentProfile[];
