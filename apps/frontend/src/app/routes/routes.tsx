import { Navigate, Route, Routes } from 'react-router-dom'
import { RequireAuth } from '@/components/auth/RequireAuth'
import { AppShell } from '@/app/AppShell'
import { CalendarPage } from '@/pages/appointments/CalendarPage'
import { CashierPage } from '@/pages/cashier/CashierPage'
import { ClientDetailPage } from '@/pages/clients/ClientDetailPage'
import { ClientsPage } from '@/pages/clients/ClientsPage'
import { ContractsPage } from '@/pages/contracts/ContractsPage'
import { ContractTemplatesPage } from '@/pages/contracts/ContractTemplatesPage'
import { DashboardPage } from '@/pages/DashboardPage'
import { EvaluationFormsPage } from '@/pages/evaluations/EvaluationFormsPage'
import { EvaluationsPage } from '@/pages/evaluations/EvaluationsPage'
import { EvolutionsPage } from '@/pages/evolutions/EvolutionsPage'
import { JourneyDetailPage } from '@/pages/journeys/JourneyDetailPage'
import { JourneysPage } from '@/pages/journeys/JourneysPage'
import { LeadsBoardPage } from '@/pages/leads/LeadsBoardPage'
import { LoginPage } from '@/pages/LoginPage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { SessionAttendanceSignPage } from '@/pages/public/SessionAttendanceSignPage'
import { ProceduresPage } from '@/pages/procedures/ProceduresPage'
import { QuoteDetailPage } from '@/pages/quotes/QuoteDetailPage'
import { QuotesPage } from '@/pages/quotes/QuotesPage'
import { ReportRunPage } from '@/pages/reports/ReportRunPage'
import { ReportsPage } from '@/pages/reports/ReportsPage'
import { SaleDetailPage } from '@/pages/sales/SaleDetailPage'
import { SalesPage } from '@/pages/sales/SalesPage'
import { AvailabilityPage } from '@/pages/settings/availability/AvailabilityPage'
import { EquipmentsPage } from '@/pages/settings/equipments/EquipmentsPage'
import { FormTemplateBuilderPage } from '@/pages/settings/formTemplates/FormTemplateBuilderPage'
import { FormTemplatesPage } from '@/pages/settings/formTemplates/FormTemplatesPage'
import { MenusPage } from '@/pages/settings/menus/MenusPage'
import { MessageTemplatesPage } from '@/pages/settings/messageTemplates/MessageTemplatesPage'
import { PreferencesPage } from '@/pages/settings/PreferencesPage'
import { UnitsPage } from '@/pages/settings/units/UnitsPage'
import { TenantsPage } from '@/pages/tenants/TenantsPage'
import { TreatmentDetailPage } from '@/pages/treatments/TreatmentDetailPage'
import { TreatmentsPage } from '@/pages/treatments/TreatmentsPage'
import { UsersPage } from '@/pages/settings/users/UsersPage'
import { WhatsappChannelDetailPage } from '@/pages/settings/whatsappChannels/WhatsappChannelDetailPage'
import { WhatsappChannelsPage } from '@/pages/settings/whatsappChannels/WhatsappChannelsPage'

// Definição declarativa de rotas. Pra adicionar páginas dos menus default
// (Clientes, Profissionais, etc.), basta criar a página e plugar como filha
// de <AppShell>. O path de cada rota tem que bater com `menus.path` no
// seed pra a sidebar destacar o item ativo corretamente.
//
// Chat: não tem mais rota dedicada — vive como tab da sidebar e a
// flutuante sobreposta. Click numa conversa abre a FloatingChatWindow
// (ou MobileChatSheet em <md).
export function AppRoutes(): React.ReactElement {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      {/* Pública — cliente acessa via signUrl no celular. Fora do AppShell,
          sem RequireAuth. Tenant é resolvido no backend via token. */}
      <Route
        path="/sessoes/assinar/:token"
        element={<SessionAttendanceSignPage />}
      />

      <Route
        path="/"
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="clients" element={<ClientsPage />} />
        <Route path="clients/:id" element={<ClientDetailPage />} />
        <Route path="procedures" element={<ProceduresPage />} />
        <Route path="quotes" element={<QuotesPage />} />
        <Route path="quotes/:id" element={<QuoteDetailPage />} />
        <Route path="sales" element={<SalesPage />} />
        <Route path="sales/:id" element={<SaleDetailPage />} />
        <Route path="cashier" element={<CashierPage />} />
        <Route path="contracts" element={<ContractsPage />} />
        <Route
          path="settings/contract-templates"
          element={<ContractTemplatesPage />}
        />
        <Route path="leads" element={<LeadsBoardPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="reports/:slug" element={<ReportRunPage />} />
        <Route path="journeys" element={<JourneysPage />} />
        <Route path="journeys/:id" element={<JourneyDetailPage />} />
        <Route path="agenda" element={<CalendarPage />} />
        <Route path="evolutions" element={<EvolutionsPage />} />
        <Route path="treatments" element={<TreatmentsPage />} />
        <Route path="treatments/:id" element={<TreatmentDetailPage />} />
        <Route path="evaluations" element={<EvaluationsPage />} />
        <Route
          path="evaluations/:id/forms"
          element={<EvaluationFormsPage />}
        />
        {/* /agenda-lista virou view='list' dentro de /agenda — redireciona
            qualquer link antigo. */}
        <Route path="agenda-lista" element={<Navigate to="/agenda" replace />} />

        <Route path="settings/users" element={<UsersPage />} />
        <Route path="settings/menus" element={<MenusPage />} />
        <Route path="settings/tenants" element={<TenantsPage />} />
        <Route path="settings/preferences" element={<PreferencesPage />} />
        <Route path="settings/availability" element={<AvailabilityPage />} />
        <Route path="settings/units" element={<UnitsPage />} />
        <Route path="settings/equipments" element={<EquipmentsPage />} />
        <Route
          path="settings/message-templates"
          element={<MessageTemplatesPage />}
        />
        <Route path="form-templates" element={<FormTemplatesPage />} />
        <Route
          path="form-templates/:id"
          element={<FormTemplateBuilderPage />}
        />

        <Route
          path="settings/whatsapp-channels"
          element={<WhatsappChannelsPage />}
        />
        <Route
          path="settings/whatsapp-channels/:id"
          element={<WhatsappChannelDetailPage />}
        />

        <Route path="*" element={<NotFoundPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
