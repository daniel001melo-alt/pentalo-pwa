import { kcal449, round2 } from '../import/normalize';
import type { Food, FoodServing, Macronutrients, MealItem } from './schemas';

/** Porção do mesmo alimento em outra quantidade, proporcional à medida-base (consulta). */
export function scaleFood(f: Food, quantity: number): FoodServing | null {
  const base = f.baseMeasure.value;
  if (!base || base <= 0 || !Number.isFinite(quantity)) return null;
  const k = quantity / base;
  const p = f.protein.value === null ? null : round2(f.protein.value * k);
  const c = f.carbs.value === null ? null : round2(f.carbs.value * k);
  const g = f.fat.value === null ? null : round2(f.fat.value * k);
  return { foodId: f.id, quantity, unit: f.unit, macros: { protein: p, carbs: c, fat: g, kcal: kcal449(p, c, g) }, derived: quantity !== base };
}

export function macroDelta(a: Macronutrients, b: Macronutrients): Macronutrients {
  const d = (x: number | null, y: number | null) => (x === null || y === null ? null : round2(y - x));
  return { protein: d(a.protein, b.protein), carbs: d(a.carbs, b.carbs), fat: d(a.fat, b.fat), kcal: d(a.kcal, b.kcal) };
}

export function sumItems(items: MealItem[]): Macronutrients {
  const s = (sel: (m: Macronutrients) => number | null) => round2(items.reduce((a, i) => a + (sel(i.macros) ?? 0), 0));
  return { protein: s((m) => m.protein), carbs: s((m) => m.carbs), fat: s((m) => m.fat), kcal: s((m) => m.kcal) };
}

export function perKg(v: number | null, weightKg: number | null): number | null {
  if (v === null || !weightKg) return null;
  return round2(v / weightKg);
}
