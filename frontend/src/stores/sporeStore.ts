import { createStore } from 'zustand/vanilla'
import type { SporePrint } from '@/types'
import { db, syncAll, syncDelete, syncPut } from '@/hooks/usePersistentStore'
import { compareByRegisteredDesc } from '@/utils/spore'

export interface SporeState {
  spores: SporePrint[]
  loaded: boolean
  hydrate: () => Promise<void>
  save: (spore: SporePrint) => Promise<void>
  remove: (id: string) => Promise<void>
  removeMany: (ids: string[]) => Promise<void>
  removeByRecord: (recordId: string) => Promise<void>
}

export const sporeStore = createStore<SporeState>((set, get) => ({
  spores: [],
  loaded: false,
  hydrate: async () => {
    const spores = await syncAll<SporePrint>(db.spores)
    spores.sort(compareByRegisteredDesc)
    set({ spores, loaded: true })
  },
  save: async (spore) => {
    await syncPut<SporePrint>(db.spores, spore)
    await get().hydrate()
  },
  remove: async (id) => {
    await syncDelete<SporePrint>(db.spores, id)
    await get().hydrate()
  },
  removeMany: async (ids) => {
    await Promise.all(ids.map((id) => syncDelete<SporePrint>(db.spores, id)))
    await get().hydrate()
  },
  removeByRecord: async (recordId) => {
    const targets = get().spores.filter((item) => item.recordId === recordId)
    await Promise.all(targets.map((item) => syncDelete<SporePrint>(db.spores, item.id)))
    await get().hydrate()
  }
}))
