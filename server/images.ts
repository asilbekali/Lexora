/**
 * Flashcard illustrations.
 *
 * Looks up a freely-licensed picture for a word. Two sources, both keyless and
 * free to use:
 *
 *   1. Openverse  — Creative Commons search across Flickr, Wikimedia and more.
 *                   Restricted to licences that permit commercial use and
 *                   modification (BY, BY-SA, CC0, public domain).
 *   2. Wikimedia Commons — fallback when Openverse finds nothing.
 *
 * Attribution data travels with the image so the UI can credit the creator,
 * which BY and BY-SA require.
 */

import { config } from './env.ts'
import type { WordImage } from '../shared/types.ts'

const USER_AGENT = 'Lexora/1.0 (vocabulary learning app)'

/** Licences that are safe to display and redistribute. */
const ALLOWED_LICENCES = 'by,by-sa,cc0,pdm'

async function getJson(url: string): Promise<unknown | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), config.images.timeoutMs)

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    })
    if (!response.ok) return null
    return await response.json()
  } catch {
    // A missing picture is never worth failing a request over.
    return null
  } finally {
    clearTimeout(timeout)
  }
}

// ---------------------------------------------------------------------------
// Openverse
// ---------------------------------------------------------------------------

interface OpenverseResult {
  title?: string
  url?: string
  thumbnail?: string
  creator?: string
  license?: string
  license_version?: string
  license_url?: string
  foreign_landing_url?: string
  provider?: string
}

async function searchOpenverse(query: string): Promise<WordImage | null> {
  const url =
    'https://api.openverse.org/v1/images/' +
    `?q=${encodeURIComponent(query)}` +
    `&license=${ALLOWED_LICENCES}` +
    '&page_size=5&mature=false&aspect_ratio=wide'

  const payload = (await getJson(url)) as { results?: OpenverseResult[] } | null
  const hit = payload?.results?.find((result) => result.thumbnail && result.url)
  if (!hit) return null

  return {
    url: hit.url ?? '',
    thumbnail: hit.thumbnail ?? hit.url ?? '',
    title: (hit.title ?? query).slice(0, 120),
    creator: (hit.creator ?? 'Unknown').slice(0, 80),
    license: `CC ${(hit.license ?? '').toUpperCase()} ${hit.license_version ?? ''}`.trim(),
    licenseUrl: hit.license_url ?? 'https://creativecommons.org/',
    sourceUrl: hit.foreign_landing_url ?? hit.url ?? '',
    provider: hit.provider ?? 'openverse',
  }
}

// ---------------------------------------------------------------------------
// Wikimedia Commons
// ---------------------------------------------------------------------------

interface CommonsPage {
  title?: string
  imageinfo?: {
    thumburl?: string
    url?: string
    descriptionurl?: string
    extmetadata?: {
      Artist?: { value?: string }
      LicenseShortName?: { value?: string }
      LicenseUrl?: { value?: string }
    }
  }[]
}

/** Strips the HTML Commons puts in its attribution fields. */
function stripHtml(value: string): string {
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

async function searchCommons(query: string): Promise<WordImage | null> {
  const url =
    'https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*' +
    `&generator=search&gsrsearch=${encodeURIComponent(`filetype:bitmap ${query}`)}` +
    '&gsrlimit=5&gsrnamespace=6&prop=imageinfo' +
    '&iiprop=url|extmetadata&iiurlwidth=640'

  const payload = (await getJson(url)) as { query?: { pages?: Record<string, CommonsPage> } } | null
  const pages = Object.values(payload?.query?.pages ?? {})
  const hit = pages.find((page) => page.imageinfo?.[0]?.thumburl)
  const info = hit?.imageinfo?.[0]
  if (!info?.thumburl) return null

  const meta = info.extmetadata ?? {}
  return {
    url: info.url ?? info.thumburl,
    thumbnail: info.thumburl,
    title: (hit?.title ?? '').replace(/^File:/, '').slice(0, 120),
    creator: stripHtml(meta.Artist?.value ?? 'Wikimedia Commons').slice(0, 80),
    license: stripHtml(meta.LicenseShortName?.value ?? 'See source'),
    licenseUrl: meta.LicenseUrl?.value ?? 'https://commons.wikimedia.org/',
    sourceUrl: info.descriptionurl ?? info.url ?? '',
    provider: 'wikimedia',
  }
}

// ---------------------------------------------------------------------------

/**
 * Finds an illustration for a word.
 *
 * Abstract words rarely have a literal picture, so we try the word itself
 * first and then a more concrete phrase built from its plain-English meaning.
 * Returns null when nothing suitable exists — the flashcard simply omits the
 * image in that case.
 */
export async function findWordImage(
  word: string,
  simpleMeaning = '',
): Promise<WordImage | null> {
  if (!config.images.enabled) return null

  // Meaning words tend to be more photographable than the headword itself.
  const meaningQuery = simpleMeaning
    .replace(/[^\p{L}\s]/gu, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 3)
    .slice(0, 3)
    .join(' ')

  const queries = [word, meaningQuery].filter(Boolean)

  for (const query of queries) {
    const found = (await searchOpenverse(query)) ?? (await searchCommons(query))
    if (found) return found
  }
  return null
}
