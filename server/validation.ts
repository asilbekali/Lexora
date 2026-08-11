/**
 * Request validation and input sanitising.
 *
 * Nothing reaches the store or the AI provider without passing through here.
 */

import { z } from 'zod'
import type { NextFunction, Request, Response } from 'express'

/** Strips control characters and collapses runs of whitespace. */
export function sanitizeText(value: string, maxLength = 400): string {
  return value
    // eslint-disable-next-line no-control-regex -- stripping control chars is the point
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

const text = (max: number) =>
  z.string().max(max * 2).transform((value) => sanitizeText(value, max))

/** Letters plus the punctuation that legitimately appears inside words. */
const WORD_PATTERN = /^\p{L}[\p{L}\-' ]*$/u

export const wordSchema = z
  .string()
  .transform((value) => sanitizeText(value, 64).toLowerCase())
  .refine((value) => value.length >= 1, { message: 'Enter a word.' })
  .refine((value) => value.length <= 64, { message: 'That word is too long.' })
  .refine((value) => WORD_PATTERN.test(value), {
    message: 'Use letters only (hyphens and apostrophes are fine).',
  })

export const loginSchema = z.object({
  username: z.string().min(1).max(64).transform((value) => sanitizeText(value, 64)),
  password: z.string().min(1).max(256),
})

export const addVocabularySchema = z.object({
  word: wordSchema,
})

export const updateVocabularySchema = z
  .object({
    word: wordSchema.optional(),
    meaning: text(400).optional(),
    simpleMeaning: text(200).optional(),
    partOfSpeech: text(40).optional(),
    pronunciation: text(80).optional(),
    example: text(300).optional(),
    synonyms: z.array(text(40)).max(8).optional(),
    difficulty: z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']).optional(),
    memoryTip: text(280).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update.' })

export const attemptSchema = z.object({
  vocabularyId: z.string().min(1).max(64),
  answer: z.string().max(128).transform((value) => sanitizeText(value, 128)),
  revealed: z.boolean().optional(),
})

export const memoryTipSchema = z.object({
  vocabularyId: z.string().min(1).max(64),
})

export const explainSchema = z.object({
  vocabularyId: z.string().min(1).max(64),
})

/** Validates `req.body`, replacing it with the parsed value. */
export function validate<T>(schema: z.ZodType<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body)
    if (!result.success) {
      res.status(400).json({
        error: result.error.issues[0]?.message ?? 'Invalid request.',
        code: 'invalid_request',
      })
      return
    }
    req.body = result.data
    next()
  }
}
