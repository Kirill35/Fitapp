import { useEffect, useMemo, useRef, useState } from 'react'
import { describeVoice, parseVoice, type VoiceCandidate, type VoiceResult } from '../domain/voice'
import type { Program } from '../domain/types'

type Recognition = {
  lang: string
  interimResults: boolean
  continuous: boolean
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
}

function makeRecognition(): Recognition | null {
  const w = window as unknown as Record<string, new () => Recognition>
  const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition
  return SR ? new SR() : null
}

const unitWord = { reps: 'reps', sec: 's', m: 'm', min: 'min' } as const

export default function VoiceSheet({
  program,
  exerciseIds,
  fallbackId,
  onApply,
  onClose,
}: {
  program: Program
  exerciseIds: string[]
  fallbackId?: string
  onApply(id: string, r: VoiceResult): void
  onClose(): void
}) {
  const [text, setText] = useState('')
  const [listening, setListening] = useState(false)
  const [micError, setMicError] = useState<string | null>(null)
  const [pick, setPick] = useState<string | undefined>(undefined)
  const rec = useRef<Recognition | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const candidates: VoiceCandidate[] = useMemo(
    () =>
      exerciseIds.map((id) => {
        const ex = program.exercises[id]
        return { id, name: ex.name, aliases: ex.aliases, hasLoad: ex.load !== 'none' }
      }),
    [program, exerciseIds],
  )
  const parsed = text.trim() ? parseVoice(text, candidates, fallbackId) : null
  const id = pick ?? parsed?.exerciseId
  const ex = id ? program.exercises[id] : null
  const summary = parsed && ex ? describeVoice(parsed, unitWord[ex.measure]) : ''

  const listen = () => {
    const r = makeRecognition()
    if (!r) {
      setMicError('Voice recognition is not available here. Tap the box and use the 🎤 on your keyboard.')
      inputRef.current?.focus()
      return
    }
    rec.current = r
    r.lang = 'en-US'
    r.interimResults = true
    r.continuous = false
    r.onresult = (e) => setText(Array.from(e.results, (x) => x[0].transcript).join(' '))
    r.onerror = (e) => {
      setListening(false)
      setMicError(
        e.error === 'not-allowed' || e.error === 'service-not-allowed'
          ? 'Microphone is blocked here. Tap the box and use the 🎤 on your keyboard.'
          : e.error === 'no-speech'
            ? 'Didn’t hear anything. Tap the mic and try again.'
            : `Voice input stopped (${e.error}).`,
      )
    }
    r.onend = () => setListening(false)
    try {
      setMicError(null)
      setText('')
      r.start()
      setListening(true)
    } catch {
      setMicError('Voice input could not start. Tap the box and use the 🎤 on your keyboard.')
    }
  }

  useEffect(() => {
    listen()
    return () => rec.current?.stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="fixed inset-0 z-30 flex flex-col justify-end bg-black/60" onClick={onClose}>
      <div
        className="pb-safe mx-auto w-full max-w-lg rounded-t-3xl border-t border-line bg-panel px-4 pt-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">Say a set</h2>
          <button onClick={onClose} className="h-10 rounded-xl px-3 text-muted">
            Close
          </button>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => (listening ? rec.current?.stop() : listen())}
            aria-label={listening ? 'Stop listening' : 'Start listening'}
            className={`grid size-16 shrink-0 place-items-center rounded-full ${
              listening ? 'animate-pulse bg-hard text-bg' : 'bg-plate text-bg'
            }`}
          >
            <svg viewBox="0 0 24 24" className="size-7" aria-hidden="true">
              <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
              <path d="M6 11a6 6 0 0 0 12 0M12 17v4" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
            </svg>
          </button>
          <input
            id="voice-text"
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={listening ? 'Listening…' : 'bench 3 sets 85 kg 5 reps easy'}
            className="h-14 min-w-0 flex-1 rounded-xl border border-line bg-bg px-3 text-[17px]"
          />
        </div>
        {micError && <p className="mt-2 text-sm text-muted">{micError}</p>}

        <div className="mt-4 min-h-24 rounded-2xl bg-bg px-4 py-3">
          {!parsed ? (
            <div className="text-sm text-muted">
              <p>Say the exercise, sets, weight, reps and how it felt:</p>
              <p className="mt-1 text-chalk">“Deadlift 110 kilos 5 5 5 right”</p>
              <p className="text-chalk">“Pull-ups plus 10, 3 sets of 5”</p>
              <p className="mt-1">Without a set count it fills the next set: “85 kilos 5”.</p>
            </div>
          ) : (
            <>
              <select
                id="voice-exercise"
                value={id ?? ''}
                onChange={(e) => setPick(e.target.value || undefined)}
                className={`w-full bg-transparent text-lg font-semibold ${ex ? '' : 'text-hard'}`}
              >
                <option value="">Which exercise?</option>
                {exerciseIds.map((x) => (
                  <option key={x} value={x}>
                    {program.exercises[x].name}
                  </option>
                ))}
              </select>
              <div className="num mt-1 text-[17px] text-plate">{summary || 'No numbers heard yet'}</div>
            </>
          )}
        </div>

        <button
          disabled={!id || !summary}
          onClick={() => {
            onApply(id!, parsed!)
            onClose()
          }}
          className="mt-4 mb-1 h-14 w-full rounded-2xl bg-plate text-lg font-bold text-bg disabled:bg-panel-2 disabled:text-muted"
        >
          Fill in
        </button>
      </div>
    </div>
  )
}

export function MicButton({ onClick, label = 'Voice' }: { onClick(): void; label?: string }) {
  return (
    <button
      onClick={onClick}
      aria-label="Log by voice"
      className="flex h-14 shrink-0 items-center gap-2 rounded-2xl border border-line bg-panel px-4 font-semibold"
    >
      <svg viewBox="0 0 24 24" className="size-5 text-plate" aria-hidden="true">
        <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
        <path d="M6 11a6 6 0 0 0 12 0M12 17v4" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
      </svg>
      {label}
    </button>
  )
}
