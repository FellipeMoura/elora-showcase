import { eq, users, type Tx } from '@elora/db';
import { AppError } from '../errors/AppError.js';

// Gate ortogonal ao role-based PERMISSIONS map. "Quem aplica/avalia" é flag
// no `users` (canEvaluate / canApplyProcedures), independente do papel.
// Reusado por AppointmentsService (criação/reagendamento) e por
// ProcedureSessionsService (registrar evolução clínica).
export async function assertProfessionalCapability(
  tx: Tx,
  professionalId: string,
  kind: 'evaluation' | 'procedure'
): Promise<void> {
  const [user] = await tx
    .select({
      name: users.name,
      canEvaluate: users.canEvaluate,
      canApplyProcedures: users.canApplyProcedures,
    })
    .from(users)
    .where(eq(users.id, professionalId))
    .limit(1);
  if (!user) throw new AppError('Profissional não encontrado', 404);
  if (kind === 'evaluation' && !user.canEvaluate) {
    throw new AppError(
      `Profissional ${user.name} não está habilitado(a) como avaliador(a)`,
      409
    );
  }
  if (kind === 'procedure' && !user.canApplyProcedures) {
    throw new AppError(
      `Profissional ${user.name} não está habilitado(a) como aplicador(a)`,
      409
    );
  }
}
