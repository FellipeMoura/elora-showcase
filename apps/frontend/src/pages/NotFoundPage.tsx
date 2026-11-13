import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'

export function NotFoundPage(): React.ReactElement {
  return (
    <div className="mx-auto flex min-h-[60svh] max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Página não encontrada</h1>
      <p className="text-sm text-muted-foreground">
        O caminho acessado não existe ou foi removido.
      </p>
      <Button asChild>
        <Link to="/">Voltar pro início</Link>
      </Button>
    </div>
  )
}
