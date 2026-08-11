import { AuthProvider } from './context/AuthProvider.tsx'
import { ThemeProvider } from './context/ThemeProvider.tsx'
import { useAuth } from './hooks/useAuth.ts'
import { AuthScreen } from './components/AuthScreen.tsx'
import { Trainer } from './components/Trainer.tsx'
import { Logo } from './components/Logo.tsx'

/** Routes between the login screen and the trainer based on session state. */
function Root() {
  const { status } = useAuth()

  if (status === 'loading') {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4">
        <Logo className="size-11 animate-pulse" />
        <p className="text-sm text-ink-3">Restoring your session…</p>
      </div>
    )
  }

  return status === 'authenticated' ? <Trainer /> : <AuthScreen />
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <Root />
      </AuthProvider>
    </ThemeProvider>
  )
}
