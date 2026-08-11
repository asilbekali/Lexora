import { useEffect, useRef, useState, type ReactNode } from 'react'

import { api, errorMessage } from '../lib/api.ts'
import { Button } from './ui/Button.tsx'
import { Badge } from './ui/Badge.tsx'
import { Alert } from './ui/Alert.tsx'
import type { Vocabulary, WordImage } from '../../shared/types.ts'

interface FlashcardProps {
  entry: Vocabulary
  onRemember: () => void
  /** Caches a fetched mnemonic onto the word, in the list and in the session. */
  onTipLoaded: (id: string, tip: string) => void
  /** Caches a fetched illustration the same way. */
  onImageLoaded: (id: string, image: WordImage | null) => void
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-medium tracking-wide text-ink-3 uppercase">{label}</dt>
      <dd className="mt-1 text-[15px] leading-relaxed text-ink">{children}</dd>
    </div>
  )
}

/**
 * Shown when the learner can't recall a word: everything needed to commit it
 * to memory, ending in a single "Remember it" action back to practice.
 *
 * The mnemonic and the illustration are fetched on first view and then cached
 * on the word. Both fetches are guarded by a ref keyed to the word id, so a
 * re-render can never turn them into a request loop.
 */
export function Flashcard({ entry, onRemember, onTipLoaded, onImageLoaded }: FlashcardProps) {
  const [fetchedTip, setFetchedTip] = useState<string | null>(null)
  const [tipError, setTipError] = useState<string | null>(null)
  const [retryToken, setRetryToken] = useState(0)

  const [fetchedImage, setFetchedImage] = useState<WordImage | null>(null)
  const [imageDone, setImageDone] = useState(entry.imageSearched)

  const [explanation, setExplanation] = useState<string | null>(null)
  const [explaining, setExplaining] = useState(false)

  const tip = entry.memoryTip ?? fetchedTip
  const tipLoading = !tip && !tipError
  const image = entry.image ?? fetchedImage

  // "Have we already asked for this word?" — the loop guard.
  const tipRequested = useRef<string | null>(null)
  const imageRequested = useRef<string | null>(null)

  // The ref guard — not a cleanup flag — is what prevents duplicate requests.
  // A cleanup flag would break under StrictMode's double-invoked effects: the
  // first pass would start the only fetch, the cleanup would discard it, and
  // the second pass would skip fetching because the guard was already set.
  // The card is keyed by word id, so these refs reset with every new word.
  useEffect(() => {
    if (entry.memoryTip) return
    const token = `${entry.id}:${retryToken}`
    if (tipRequested.current === token) return
    tipRequested.current = token

    api.ai
      .memoryTip(entry.id)
      .then(({ memoryTip }) => {
        setFetchedTip(memoryTip)
        onTipLoaded(entry.id, memoryTip)
      })
      .catch((cause: unknown) => setTipError(errorMessage(cause)))
  }, [entry.id, entry.memoryTip, onTipLoaded, retryToken])

  useEffect(() => {
    if (entry.imageSearched || entry.image) return
    if (imageRequested.current === entry.id) return
    imageRequested.current = entry.id

    api.vocabulary
      .image(entry.id)
      .then((response) => {
        setFetchedImage(response.image)
        setImageDone(true)
        onImageLoaded(entry.id, response.image)
      })
      // A missing picture is cosmetic — never surface it as an error.
      .catch(() => setImageDone(true))
  }, [entry.id, entry.image, entry.imageSearched, onImageLoaded])

  async function explain() {
    setExplaining(true)
    try {
      const { explanation: text } = await api.ai.explain(entry.id)
      setExplanation(text)
    } catch (cause) {
      setExplanation(errorMessage(cause))
    } finally {
      setExplaining(false)
    }
  }

  return (
    <div className="animate-pop">
      <div className="overflow-hidden rounded-2xl border border-line bg-surface-2">
        {/* Illustration — a visual hook for the word. */}
        {(image || !imageDone) && (
          <figure className="relative border-b border-line bg-surface-3">
            {image ? (
              <>
                <img
                  src={image.thumbnail}
                  alt={`Illustration for “${entry.word}”: ${image.title}`}
                  loading="lazy"
                  className="h-40 w-full object-cover sm:h-52"
                  onError={() => {
                    setFetchedImage(null)
                    setImageDone(true)
                  }}
                />
                <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-3 pt-6 pb-1.5 text-[10px] text-white/80">
                  <a
                    href={image.sourceUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="underline-offset-2 hover:underline"
                  >
                    {image.title}
                  </a>
                  {' · '}
                  {image.creator}
                  {' · '}
                  <a
                    href={image.licenseUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="underline-offset-2 hover:underline"
                  >
                    {image.license}
                  </a>
                </figcaption>
              </>
            ) : (
              <div className="flex h-40 w-full items-center justify-center sm:h-52">
                <span className="text-xs text-ink-3">Looking for a picture…</span>
              </div>
            )}
          </figure>
        )}

        <div className="p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h3 className="text-3xl font-semibold tracking-tight sm:text-4xl">{entry.word}</h3>
            {entry.pronunciation && (
              <span className="font-mono text-sm text-ink-3">{entry.pronunciation}</span>
            )}
            {entry.partOfSpeech && (
              <Badge className="bg-surface-3 text-ink-2">{entry.partOfSpeech}</Badge>
            )}
            <Badge className="bg-accent-soft text-accent">{entry.difficulty}</Badge>
          </div>

          <dl className="mt-5 grid gap-4">
            {entry.meaning && <Field label="Meaning">{entry.meaning}</Field>}
            {entry.simpleMeaning && (
              <Field label="In simple words">{entry.simpleMeaning}</Field>
            )}
            {entry.example && (
              <Field label="Example">
                <em className="text-ink-2">“{entry.example}”</em>
              </Field>
            )}
            {entry.synonyms.length > 0 && (
              <Field label="Synonyms">
                <span className="flex flex-wrap gap-1.5">
                  {entry.synonyms.map((synonym) => (
                    <Badge key={synonym} className="bg-surface-3 text-ink-2">
                      {synonym}
                    </Badge>
                  ))}
                </span>
              </Field>
            )}

            <Field label="Memory tip">
              {tipError ? (
                <Alert
                  tone="warning"
                  onRetry={() => {
                    setTipError(null)
                    setRetryToken((token) => token + 1)
                  }}
                >
                  {tipError}
                </Alert>
              ) : tipLoading ? (
                <span className="text-ink-3">Thinking of one…</span>
              ) : (
                tip
              )}
            </Field>

            {explanation && <Field label="More detail">{explanation}</Field>}
          </dl>

          {/* Spell it out letter by letter — this is a spelling trainer. */}
          <div className="mt-5 flex flex-wrap gap-1 border-t border-line pt-4">
            {[...entry.word].map((letter, index) => (
              <span
                key={`${letter}-${index}`}
                className="flex size-8 items-center justify-center rounded-md bg-surface font-mono text-base text-ink"
              >
                {letter}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
        <Button variant="ghost" onClick={() => void explain()} loading={explaining}>
          Explain more
        </Button>
        <Button size="lg" onClick={onRemember} className="sm:ml-auto sm:min-w-44">
          Remember it
        </Button>
      </div>
    </div>
  )
}
