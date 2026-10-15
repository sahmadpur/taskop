// Image assets imported by screens (the sign-in mark). Metro bundles them; Jest maps them through jest-expo's asset transformer.
declare module '*.png' {
  const source: number;
  export default source;
}
