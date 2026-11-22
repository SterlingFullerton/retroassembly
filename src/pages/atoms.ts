import { atom } from 'jotai'
import type { ResolvedPreference } from '#@/constants/preference.ts'

export const preferenceAtom = atom<ResolvedPreference>()

/** Whether the last change to the settings failed to save: said in the settings, until one saves */
export const preferenceSaveFailedAtom = atom(false)

/** A short message about something that just failed, shown over the page for a few seconds */
export const noticeAtom = atom<{ id: number; message: string }>()
