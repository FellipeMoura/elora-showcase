import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import {
  ArrowLeft,
  Ban,
  GripVertical,
  Pencil,
  Plus,
  Trash2,
  Undo2,
} from 'lucide-react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Button } from '@/components/ui/button'
import { PageContainer } from '@/components/layout/PageContainer'
import { useConfirm } from '@/components/ui/confirm-context'
import {
  useActivateFormTemplate,
  useDeactivateFormTemplate,
  useDeleteFormQuestion,
  useFormQuestions,
  useFormTemplate,
  useUpdateFormQuestion,
} from '@/hooks/useFormTemplates'
import {
  QUESTION_TYPE_LABELS,
  optionsAsStringArray,
  type FormQuestion,
} from '@/api/formTemplates'
import { cn } from '@/lib/utils'
import { FormTemplateFormSheet } from './FormTemplateFormSheet'
import { FormQuestionFormSheet } from './FormQuestionFormSheet'

// =====================================================================
// Detalhe do template + builder de perguntas. Aqui o admin do tenant
// monta o questionário tipado que os clientes vão responder.
//
// Reordenação: drag-and-drop via @dnd-kit. DnD acontece DENTRO de cada
// section (incluindo "sem seção"). Pra mover pergunta entre sections,
// editar a pergunta — evita mistura de fluxos de UX.
//
// Algoritmo de position: positions são globais no template (não por
// section). Quando reordena dentro de uma section, pegamos o conjunto
// dos positions atuais das perguntas afetadas e reatribuímos na nova
// ordem. Preserva o ordering geral; só mexe nas linhas que mudaram.
// =====================================================================

export function FormTemplateBuilderPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const confirm = useConfirm()

  const template = useFormTemplate(id)
  const questions = useFormQuestions(id)

  const [editMetadataOpen, setEditMetadataOpen] = useState(false)
  const [questionSheetOpen, setQuestionSheetOpen] = useState(false)
  const [editingQuestion, setEditingQuestion] = useState<FormQuestion | null>(
    null,
  )

  const updateQuestion = useUpdateFormQuestion()
  const deleteQuestion = useDeleteFormQuestion()
  const deactivateTemplate = useDeactivateFormTemplate()
  const activateTemplate = useActivateFormTemplate()

  // PointerSensor com distance > 0 evita disparar drag em click acidental
  // nos botões internos da row (editar/excluir).
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const sorted = useMemo(() => {
    return [...(questions.data?.items ?? [])].sort((a, b) => {
      if (a.position !== b.position) return a.position - b.position
      return a.createdAt.localeCompare(b.createdAt)
    })
  }, [questions.data])

  // Agrupa perguntas por section (null = "Sem seção"). Mantém ordem de
  // first-appearance pra não bagunçar quando admin renomeia seção.
  const grouped = useMemo(() => {
    const groups = new Map<string, FormQuestion[]>()
    for (const q of sorted) {
      const key = q.section ?? '__no_section__'
      const list = groups.get(key) ?? []
      list.push(q)
      groups.set(key, list)
    }
    return Array.from(groups.entries()).map(([key, items]) => ({
      section: key === '__no_section__' ? null : key,
      items,
    }))
  }, [sorted])

  const openCreateQuestion = (): void => {
    setEditingQuestion(null)
    setQuestionSheetOpen(true)
  }

  const openEditQuestion = (q: FormQuestion): void => {
    setEditingQuestion(q)
    setQuestionSheetOpen(true)
  }

  const handleDragEnd = async (event: DragEndEvent): Promise<void> => {
    if (!id) return
    const { active, over } = event
    if (!over || active.id === over.id) return

    // Identifica a section onde o drop aconteceu via active (caller). DnD
    // entre sections é no-op porque cada SortableContext tem seu próprio
    // ids; over.id só vai resolver pra um id da mesma lista.
    const activeQuestion = sorted.find((q) => q.id === active.id)
    const overQuestion = sorted.find((q) => q.id === over.id)
    if (!activeQuestion || !overQuestion) return
    if (activeQuestion.section !== overQuestion.section) return

    const sectionItems = sorted.filter(
      (q) => q.section === activeQuestion.section,
    )
    const oldIndex = sectionItems.findIndex((q) => q.id === active.id)
    const newIndex = sectionItems.findIndex((q) => q.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return

    // Constrói nova ordem da section + reatribui os mesmos positions atuais
    // pra cada slot. Apenas as perguntas cujo position mudou geram update.
    const reordered = [...sectionItems]
    const [moved] = reordered.splice(oldIndex, 1)
    if (!moved) return
    reordered.splice(newIndex, 0, moved)

    const positions = sectionItems.map((q) => q.position)
    const updates = reordered
      .map((q, idx) => ({ q, newPosition: positions[idx]! }))
      .filter(({ q, newPosition }) => q.position !== newPosition)

    if (updates.length === 0) return

    try {
      await Promise.all(
        updates.map(({ q, newPosition }) =>
          updateQuestion.mutateAsync({
            templateId: id,
            questionId: q.id,
            input: { position: newPosition },
          }),
        ),
      )
    } catch {
      toast.error('Erro ao reordenar pergunta')
    }
  }

  const handleDeleteQuestion = async (q: FormQuestion): Promise<void> => {
    if (!id) return
    const ok = await confirm({
      title: 'Excluir pergunta?',
      description: `"${q.prompt}" será removida do template. Respostas já registradas pra essa pergunta nas fichas dos clientes também serão apagadas.`,
      confirmLabel: 'Excluir',
      variant: 'destructive',
    })
    if (!ok) return

    try {
      await deleteQuestion.mutateAsync({ templateId: id, questionId: q.id })
      toast.success('Pergunta excluída')
    } catch {
      toast.error('Erro ao excluir pergunta')
    }
  }

  const handleToggleActive = async (): Promise<void> => {
    if (!template.data) return
    const t = template.data
    const ok = await confirm({
      title: t.active ? 'Desativar template?' : 'Reativar template?',
      description: t.active
        ? `"${t.name}" deixa de aparecer ao criar novas fichas. Fichas já preenchidas continuam acessíveis.`
        : `"${t.name}" volta a aparecer ao criar novas fichas.`,
      confirmLabel: t.active ? 'Desativar' : 'Reativar',
      variant: t.active ? 'destructive' : 'primary',
    })
    if (!ok) return

    try {
      if (t.active) {
        await deactivateTemplate.mutateAsync(t.id)
        toast.success('Template desativado')
      } else {
        await activateTemplate.mutateAsync(t.id)
        toast.success('Template reativado')
      }
    } catch {
      toast.error('Erro ao alterar status do template')
    }
  }

  if (!id) return <></>

  if (template.isLoading) {
    return (
      <PageContainer>
        <div className="flex h-full items-center justify-center text-muted-foreground">
          Carregando template…
        </div>
      </PageContainer>
    )
  }

  if (template.isError || !template.data) {
    return (
      <PageContainer>
        <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
          <p>Erro ao carregar template.</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate('/form-templates')}
          >
            Voltar
          </Button>
        </div>
      </PageContainer>
    )
  }

  const t = template.data

  return (
    <PageContainer>
      <div className="flex h-full flex-col gap-3 overflow-y-auto">
        <header className="flex flex-wrap items-center gap-2 rounded-md border bg-background p-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/form-templates')}
            aria-label="Voltar"
          >
            <ArrowLeft className="size-4" />
          </Button>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-lg font-semibold">{t.name}</h1>
              {t.active ? (
                <span className="rounded bg-success/15 px-1.5 py-0.5 text-xs font-medium text-success">
                  Ativo
                </span>
              ) : (
                <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
                  Inativo
                </span>
              )}
              {t.requiredForEvaluation && (
                <span className="rounded bg-warning/15 px-1.5 py-0.5 text-xs font-medium text-warning">
                  Obrigatório p/ avaliação
                </span>
              )}
            </div>
            {t.description && (
              <p className="text-sm text-muted-foreground">{t.description}</p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditMetadataOpen(true)}
            >
              <Pencil className="mr-1 size-4" />
              Editar
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleToggleActive}
              className={t.active ? 'text-error hover:bg-error/10' : undefined}
            >
              {t.active ? (
                <>
                  <Ban className="mr-1 size-4" />
                  Desativar
                </>
              ) : (
                <>
                  <Undo2 className="mr-1 size-4" />
                  Reativar
                </>
              )}
            </Button>
          </div>
        </header>

        <section className="flex flex-col gap-3 rounded-md border bg-background p-4">
          <header className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="flex flex-col gap-0.5">
              <h2 className="text-sm font-semibold">Perguntas</h2>
              <p className="text-xs text-muted-foreground">
                Arraste pelo ícone <GripVertical className="inline size-3" /> pra
                reordenar dentro da seção. Pra mover entre seções, edite a
                pergunta.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={openCreateQuestion}>
              <Plus className="mr-1 size-4" />
              Nova pergunta
            </Button>
          </header>

          {questions.isLoading && (
            <p className="text-sm text-muted-foreground">Carregando perguntas…</p>
          )}
          {questions.isError && (
            <p className="text-sm text-error">Erro ao carregar perguntas.</p>
          )}
          {!questions.isLoading && sorted.length === 0 && (
            <div className="flex flex-col items-center gap-2 rounded-md border border-dashed p-8 text-center">
              <p className="text-sm text-muted-foreground">
                Nenhuma pergunta cadastrada.
              </p>
              <Button variant="outline" size="sm" onClick={openCreateQuestion}>
                <Plus className="mr-1 size-4" />
                Adicionar primeira pergunta
              </Button>
            </div>
          )}

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            {grouped.map((group, gIdx) => (
              <div
                key={group.section ?? '__no_section__'}
                className="flex flex-col gap-2"
              >
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {group.section ?? 'Sem seção'}
                </h3>
                <SortableContext
                  items={group.items.map((q) => q.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <ul className="flex flex-col gap-2">
                    {group.items.map((q) => (
                      <SortableQuestionRow
                        key={q.id}
                        question={q}
                        onEdit={() => openEditQuestion(q)}
                        onDelete={() => handleDeleteQuestion(q)}
                      />
                    ))}
                  </ul>
                </SortableContext>
                {gIdx < grouped.length - 1 && <div className="h-px bg-border" />}
              </div>
            ))}
          </DndContext>
        </section>
      </div>

      <FormTemplateFormSheet
        open={editMetadataOpen}
        template={t}
        onOpenChange={setEditMetadataOpen}
      />

      <FormQuestionFormSheet
        open={questionSheetOpen}
        templateId={id}
        question={editingQuestion}
        // Próximo position = max + 1 (não-contíguo é ok).
        suggestedPosition={
          sorted.length === 0
            ? 0
            : Math.max(...sorted.map((x) => x.position)) + 1
        }
        existingSections={Array.from(
          new Set(sorted.map((x) => x.section).filter((s): s is string => !!s)),
        )}
        onOpenChange={setQuestionSheetOpen}
      />
    </PageContainer>
  )
}

// =====================================================================
// SortableQuestionRow — row arrastável. Drag handle isolado pra que
// cliques nos botões internos não disparem o drag (PointerSensor
// `distance:6` ajuda, mas separar o handle é defesa adicional).
// =====================================================================

function SortableQuestionRow({
  question,
  onEdit,
  onDelete,
}: {
  question: FormQuestion
  onEdit: () => void
  onDelete: () => void
}): React.ReactElement {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: question.id })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  const options = optionsAsStringArray(question.options)

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex flex-col gap-2 rounded-md border bg-muted/20 p-3',
        !question.active && 'opacity-60',
        isDragging && 'z-10 shadow-lg ring-2 ring-primary/40',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <button
            type="button"
            {...attributes}
            {...listeners}
            aria-label="Arrastar pra reordenar"
            className={cn(
              'mt-0.5 inline-flex h-7 w-5 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground hover:text-foreground',
              isDragging && 'cursor-grabbing',
            )}
          >
            <GripVertical className="size-4" />
          </button>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-sm font-medium">{question.prompt}</span>
              {question.required && (
                <span className="rounded bg-error/15 px-1.5 py-0.5 text-xs font-medium text-error">
                  Obrigatória
                </span>
              )}
              <span className="rounded bg-info/15 px-1.5 py-0.5 text-xs font-medium text-info">
                {QUESTION_TYPE_LABELS[question.questionType]}
              </span>
            </div>
            {options.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {options.map((opt) => (
                  <span
                    key={opt}
                    className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
                  >
                    {opt}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={onEdit}
            aria-label="Editar"
            className="h-8 w-8"
          >
            <Pencil className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onDelete}
            aria-label="Excluir"
            className="h-8 w-8 text-error hover:bg-error/10"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>
    </li>
  )
}
