/**
 * State management patterns for Plan Mode extension
 * Proper mutable state with type safety
 */

export interface Mutable<T> {
  value: T;
}

export function createMutable<T>(initialValue: T): Mutable<T> {
  return { value: initialValue };
}

export function updateMutable<T>(state: Mutable<T>, newValue: T): void {
  state.value = newValue;
}

export function toggleMutable(state: Mutable<boolean>): void {
  state.value = !state.value;
}

export function resetMutable<T>(state: Mutable<T>, initialValue: T): void {
  state.value = initialValue;
}
