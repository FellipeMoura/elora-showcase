// ID compartilhado por todos os forms de execução de relatório.
// Só 1 form fica montado por vez (1 sheet, 1 slug). O botão "Executar"
// na SheetToolbar referencia esse id via `form={REPORT_RUN_FORM_ID}`
// pra disparar o submit fora da árvore visual do <form>.

export const REPORT_RUN_FORM_ID = 'report-run-form'
