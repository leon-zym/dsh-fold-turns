import { en } from './en.ts'
import { zh } from './zh.ts'

export { en, zh }

/** Fold-turn locale dictionary key union. */
export type FoldTurnsLocaleKey = keyof typeof zh
