import { Info } from 'lucide-react'
import { SheetBody, SheetContainer } from '@/components/layout/SheetContainer'
import { SheetToolbar } from '@/components/layout/SheetToolbar'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { useGroups } from '@/hooks/useGroups'

interface GroupsSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

// Visualizador read-only do catálogo global de grupos. Tenants veem aqui
// quais perfis estão disponíveis pra atribuir aos seus users (via
// UserFormSheet). CRUD é restrito à equipe Elora (gate de plataforma no
// backend), então não há ações de edição aqui.
export function GroupsSheet({
  open,
  onOpenChange,
}: GroupsSheetProps): React.ReactElement {
  const { data: groups, isLoading, isError, refetch } = useGroups()

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        hideCloseButton
        className="w-full sm:max-w-md"
      >
        <SheetContainer>
          <SheetToolbar srTitle="Grupos disponíveis" />

          <SheetBody>
            <div className="mb-3 flex items-start gap-2 rounded-md border border-info/30 bg-info/10 p-3 text-xs text-foreground">
              <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
              <p>
                Os grupos são gerenciados pela equipe Elora. Pra solicitar
                mudanças, fale com o suporte.
              </p>
            </div>

            {isLoading ? (
              <p className="text-sm text-muted-foreground">Carregando grupos…</p>
            ) : isError ? (
              <div className="flex flex-col gap-2 text-sm">
                <p className="text-error">Erro ao carregar grupos.</p>
                <button
                  type="button"
                  onClick={() => refetch()}
                  className="self-start rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
                >
                  Tentar novamente
                </button>
              </div>
            ) : (groups ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhum grupo cadastrado.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {(groups ?? []).map((g) => (
                  <li
                    key={g.id}
                    className="rounded-md border border-border bg-background p-3"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-medium">{g.name}</span>
                      <span className="rounded bg-tertiary px-1.5 py-0.5 font-mono text-xs text-tertiary-foreground">
                        {g.roleCode}
                      </span>
                    </div>
                    {g.description && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {g.description}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </SheetBody>
        </SheetContainer>
      </SheetContent>
    </Sheet>
  )
}
