// Provided at runtime by Node ≥ 19 and browsers. React Native (Hermes) needs polyfills
// (e.g. expo-crypto / core-js structuredClone) before sub-project 4 calls these functions.
declare global {
  var crypto: { randomUUID(): string };
  function structuredClone<T>(value: T): T;
}
export {};
