import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

// Campos de formulário: página nunca monta `<Label>` + primitivo cru.
// Todo campo com rótulo passa pelo kit `components/form/` (TextField,
// TextArea, SelectField, ComboboxField, MaskedField, MoneyField) — ver
// docs/frontend-design-system.md §"Campos de formulário". Primitivo em
// filtro de toolbar ou input compacto em linha de tabela continua
// permitido, mas exige `eslint-disable-next-line` com justificativa.
const FORM_FIELD_MSG =
  'Em form use o kit components/form (TextField/TextArea/SelectField/ComboboxField). ' +
  'Filtro de toolbar ou input compacto em tabela: eslint-disable-next-line com justificativa.'

// Todo input de valor monetário usa MoneyField (máscara em centavos, sem
// ambiguidade de vírgula/ponto) — nunca TextField/Input numérico. A
// detecção é heurística (rótulo ou step de centavos): se o campo NÃO for
// dinheiro, desabilite a regra na linha dizendo o que ele é.
const MONEY_FIELD_MSG =
  'Valor monetário usa <MoneyField> de components/form (RHF: control+name; useState: value+onValueChange). Não é dinheiro? Desabilite na linha com o motivo.'

// Overlays (Sheet/Dialog/confirm): regras do docs/frontend-design-system.md
// §"Padrão de form em sheet", §"Padrão de dialog" e §"Camadas (z-index)".
const NATIVE_DIALOG_MSG =
  'Não use window.confirm/alert/prompt (bloqueiam a thread, sem tema, inacessíveis). ' +
  'Confirmação: useConfirm (components/ui/confirm-context). Aviso não-bloqueante: toast (sonner).'
const SHEET_HEADER_MSG =
  'Sheet de form não usa SheetHeader/SheetTitle/SheetDescription visíveis: use <SheetToolbar srTitle="…"> e mova a descrição pra helperText do campo.'
const SHEET_CLOSE_MSG =
  '<SheetContent> de form/detalhe leva hideCloseButton — o X já vem do <SheetToolbar>.'
const SHEET_SCROLL_MSG =
  'Não coloque overflow-y-auto no <SheetContent>: o scroll é do <SheetBody> (double scroll).'
const SHEET_TOOLBAR_MSG =
  '<SheetToolbar> só funciona dentro de <SheetContainer> (fica sticky pela cascata flex dele) — arquivo sem SheetContainer.'
const DIALOG_LAYOUT_MSG =
  'Dimensionamento ad-hoc no <DialogContent>: largura via max-w-md|lg|2xl|3xl; conteúdo longo dentro de <DialogBody> (único scroll). Sem vh/vw, p-0 ou overflow-hidden.'
const SHEET_IN_DIALOG_MSG =
  'Dialog sempre tem prioridade sobre Sheet (z-dialog > z-sheet): não abra <Sheet> de dentro de <DialogContent>. Use Dialog aninhado ou reestruture o fluxo.'
const VH_MSG =
  'Sem vh/calc(100vh…) em altura de elemento interno — a cascata flex resolve (mobile corta vh). Em dialog use <DialogBody>.'
const Z_MSG =
  'Camada global (z-40+) usa os tokens de index.css: z-shell | z-sheet | z-dialog | z-alert | z-popover. z-0…z-30 locais (sticky/relative) são livres.'

// z-index numérico ≥ 40 em className (`z-50`, `z-[70]`) — só nos tokens.
// Cuidado com regex em selector esquery: \d/\s viram "d"/"s" numa string JS
// e ']' solto encerra o atributo — por isso [0-9], espaço literal e [\]].
const Z_RE = '(^| |:)z-[[]?([4-9][0-9]|[1-9][0-9][0-9]+)[\\]]?( |$)'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // Marker components (PageToolbar.Search, SheetToolbar.Action…) precisam
      // declarar o tipo dos props sem consumi-los — quem lê é o root, via
      // child.props. O prefixo `_` marca essa intenção.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      // window.confirm/alert/prompt proibidos em todo o src (ver NATIVE_DIALOG_MSG).
      'no-restricted-globals': [
        'error',
        { name: 'confirm', message: NATIVE_DIALOG_MSG },
        { name: 'alert', message: NATIVE_DIALOG_MSG },
        { name: 'prompt', message: NATIVE_DIALOG_MSG },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'window', property: 'confirm', message: NATIVE_DIALOG_MSG },
        { object: 'window', property: 'alert', message: NATIVE_DIALOG_MSG },
        { object: 'window', property: 'prompt', message: NATIVE_DIALOG_MSG },
      ],
    },
  },
  {
    files: ['src/pages/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: '@/components/ui/input', message: FORM_FIELD_MSG },
            { name: '@/components/ui/select', message: FORM_FIELD_MSG },
            { name: '@/components/ui/combobox', message: FORM_FIELD_MSG },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXOpeningElement[name.name='textarea']",
          message: 'Use <TextArea> de components/form.',
        },
        {
          selector: "JSXOpeningElement[name.name='select']",
          message: 'Use <SelectField> de components/form.',
        },
        {
          // <input> cru só pra tipos sem equivalente no kit.
          selector:
            "JSXOpeningElement[name.name='input']:not(:has(JSXAttribute[name.name='type'] > Literal[value=/^(checkbox|radio|color|file|hidden|range)$/]))",
          message: FORM_FIELD_MSG,
        },
        {
          // Dinheiro pelo rótulo: campo comum com label/aria-label/placeholder
          // monetário. Rótulo com "%" fica de fora (percentual não é valor).
          selector:
            "JSXOpeningElement[name.name=/^(TextField|Input|input)$/]:has(JSXAttribute[name.name=/^(label|aria-label|placeholder)$/] > Literal[value=/(pre[çc]o|valor|custo|desconto|frete|sal[áa]rio|R[$])/i]):not(:has(JSXAttribute[name.name=/^(label|aria-label|placeholder)$/] > Literal[value=/%/]))",
          message: MONEY_FIELD_MSG,
        },
        {
          // Dinheiro pelo formato: step de centavos. Percentual e medida em
          // metros (rótulo com "%" ou "(m)") também usam 0.01 — ficam de fora.
          selector:
            "JSXOpeningElement[name.name=/^(TextField|Input|input)$/]:has(JSXAttribute[name.name='step'] > Literal[value='0.01']):not(:has(JSXAttribute[name.name='label'] > Literal[value=/%|[(]m[)]/]))",
          message: MONEY_FIELD_MSG,
        },
        // ── Sheets ─────────────────────────────────────────────────────
        {
          selector: 'JSXOpeningElement[name.name=/^Sheet(Header|Title|Description)$/]',
          message: SHEET_HEADER_MSG,
        },
        {
          selector:
            "JSXOpeningElement[name.name='SheetContent']:not(:has(JSXAttribute[name.name='hideCloseButton']))",
          message: SHEET_CLOSE_MSG,
        },
        {
          selector:
            "JSXOpeningElement[name.name='SheetContent'] JSXAttribute[name.name='className'] Literal[value=/overflow-y-(auto|scroll)/]",
          message: SHEET_SCROLL_MSG,
        },
        {
          selector:
            "Program:not(:has(JSXOpeningElement[name.name='SheetContainer'])) JSXOpeningElement[name.name='SheetToolbar']",
          message: SHEET_TOOLBAR_MSG,
        },
        // ── Dialogs ────────────────────────────────────────────────────
        {
          selector:
            "JSXOpeningElement[name.name='DialogContent'] JSXAttribute[name.name='className'] Literal[value=/([0-9]v[hw]|(^| )p-0( |$)|overflow-hidden)/]",
          message: DIALOG_LAYOUT_MSG,
        },
        {
          selector:
            "JSXElement[openingElement.name.name='DialogContent'] JSXElement[openingElement.name.name='Sheet']",
          message: SHEET_IN_DIALOG_MSG,
        },
        // ── Altura e camadas ───────────────────────────────────────────
        {
          selector:
            "JSXAttribute[name.name='className'] Literal[value=/(^| |:)(max-|min-)?h-[[].*[0-9]vh/]",
          message: VH_MSG,
        },
        {
          selector: `JSXAttribute[name.name='className'] Literal[value=/${Z_RE}/]`,
          message: Z_MSG,
        },
        {
          selector: `JSXAttribute[name.name='className'] TemplateElement[value.raw=/${Z_RE}/]`,
          message: Z_MSG,
        },
      ],
    },
  },
])
