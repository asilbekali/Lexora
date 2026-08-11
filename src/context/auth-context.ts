import { createContext } from 'react'

import type { User } from '../../shared/types.ts'

export interface AuthState {
  user: User | null
  status: 'loading' | 'authenticated' | 'anonymous'
  error: string | null
  login: (username: string, password: string) => Promise<void>
  register: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

export const AuthContext = createContext<AuthState | null>(null)
