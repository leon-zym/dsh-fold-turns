declare module '*.module.css' {
  const classes: Record<string, string>
  /** Remove only the style epoch created by this evaluated CSS module. */
  export const disposeStyles: () => void
  export default classes
}
