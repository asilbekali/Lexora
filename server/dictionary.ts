/**
 * A tiny offline dictionary.
 *
 * Two jobs: it backs the demo seed list, and it keeps the app usable when the
 * AI provider is missing, rate-limited or down. Anything not in here still
 * gets a usable (if sparse) entry the learner can edit by hand.
 */

import type { CEFRLevel, VocabularyInfo } from '../shared/types.ts'

export const OFFLINE_DICTIONARY: Record<string, VocabularyInfo> = {
  ubiquitous: {
    word: 'ubiquitous',
    meaning: 'present, appearing, or found everywhere',
    simpleMeaning: 'existing everywhere',
    partOfSpeech: 'adjective',
    pronunciation: '/juːˈbɪkwɪtəs/',
    example: 'Smartphones have become ubiquitous in modern society.',
    synonyms: ['omnipresent', 'pervasive', 'universal'],
    difficulty: 'C1',
  },
  meticulous: {
    word: 'meticulous',
    meaning: 'showing great attention to detail; very careful and precise',
    simpleMeaning: 'extremely careful about small details',
    partOfSpeech: 'adjective',
    pronunciation: '/məˈtɪkjələs/',
    example: 'She kept meticulous records of every experiment.',
    synonyms: ['thorough', 'painstaking', 'scrupulous'],
    difficulty: 'C1',
  },
  inevitable: {
    word: 'inevitable',
    meaning: 'certain to happen; unavoidable',
    simpleMeaning: 'impossible to avoid',
    partOfSpeech: 'adjective',
    pronunciation: '/ɪnˈevɪtəbl/',
    example: 'With no rain for months, a drought was inevitable.',
    synonyms: ['unavoidable', 'certain', 'inescapable'],
    difficulty: 'B2',
  },
  ambiguous: {
    word: 'ambiguous',
    meaning: 'open to more than one interpretation; not having one obvious meaning',
    simpleMeaning: 'unclear because it can mean more than one thing',
    partOfSpeech: 'adjective',
    pronunciation: '/æmˈbɪɡjuəs/',
    example: 'His ambiguous reply left everyone guessing.',
    synonyms: ['unclear', 'equivocal', 'vague'],
    difficulty: 'B2',
  },
  sophisticated: {
    word: 'sophisticated',
    meaning: 'having great knowledge or experience; highly developed and complex',
    simpleMeaning: 'advanced, refined or complex',
    partOfSpeech: 'adjective',
    pronunciation: '/səˈfɪstɪkeɪtɪd/',
    example: 'The lab uses sophisticated equipment to measure air quality.',
    synonyms: ['advanced', 'refined', 'complex'],
    difficulty: 'B2',
  },
  perseverance: {
    word: 'perseverance',
    meaning: 'persistence in doing something despite difficulty or delay in achieving success',
    simpleMeaning: 'not giving up',
    partOfSpeech: 'noun',
    pronunciation: '/ˌpɜːsɪˈvɪərəns/',
    example: 'Her perseverance finally paid off when the company hired her.',
    synonyms: ['persistence', 'tenacity', 'determination'],
    difficulty: 'C1',
  },
  conscientious: {
    word: 'conscientious',
    meaning: 'wishing to do what is right; careful and thorough in your work',
    simpleMeaning: 'careful and responsible',
    partOfSpeech: 'adjective',
    pronunciation: '/ˌkɒnʃiˈenʃəs/',
    example: 'He is a conscientious student who never misses a deadline.',
    synonyms: ['diligent', 'dutiful', 'thorough'],
    difficulty: 'C1',
  },
  unprecedented: {
    word: 'unprecedented',
    meaning: 'never done or known before',
    simpleMeaning: 'happening for the first time ever',
    partOfSpeech: 'adjective',
    pronunciation: '/ʌnˈpresɪdentɪd/',
    example: 'The city saw an unprecedented level of rainfall this spring.',
    synonyms: ['unparalleled', 'unheard-of', 'novel'],
    difficulty: 'C1',
  },
  phenomenon: {
    word: 'phenomenon',
    meaning: 'a fact or situation that is observed to exist, especially one whose cause is in question',
    simpleMeaning: 'something that happens and can be observed',
    partOfSpeech: 'noun',
    pronunciation: '/fəˈnɒmɪnən/',
    example: 'Migration is a natural phenomenon studied for centuries.',
    synonyms: ['occurrence', 'event', 'marvel'],
    difficulty: 'B2',
  },
  accommodate: {
    word: 'accommodate',
    meaning: 'to provide space or lodging for; to adapt to someone else’s needs',
    simpleMeaning: 'to have room for, or to adapt for someone',
    partOfSpeech: 'verb',
    pronunciation: '/əˈkɒmədeɪt/',
    example: 'The hall can accommodate up to four hundred guests.',
    synonyms: ['house', 'hold', 'oblige'],
    difficulty: 'B2',
  },
}

export const SEED_WORDS = Object.keys(OFFLINE_DICTIONARY)

/** Rough CEFR guess from word length — only used when nothing better exists. */
function guessDifficulty(word: string): CEFRLevel {
  if (word.length <= 4) return 'A2'
  if (word.length <= 6) return 'B1'
  if (word.length <= 9) return 'B2'
  return 'C1'
}

/** A minimal, honest entry for a word we know nothing about. */
export function offlineEntry(word: string): VocabularyInfo {
  const known = OFFLINE_DICTIONARY[word.toLowerCase()]
  if (known) return { ...known, synonyms: [...known.synonyms] }

  return {
    word,
    meaning: '',
    simpleMeaning: '',
    partOfSpeech: '',
    pronunciation: '',
    example: '',
    synonyms: [],
    difficulty: guessDifficulty(word),
  }
}

/** Deterministic mnemonic used when the AI can't supply one. */
export function offlineMemoryTip(word: string, simpleMeaning: string): string {
  const chunk = word.slice(0, Math.min(4, word.length))
  const gist = simpleMeaning || 'its meaning'
  return `Break it into chunks — "${chunk}…" — say the word out loud three times, then picture a scene that shows ${gist}.`
}
