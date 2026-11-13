import { useMutation, useQuery } from '@tanstack/react-query'
import {
  fetchAppointmentAttendance,
  fetchPublicAttendancePreview,
  generateAttendanceLink,
  signAttendance,
  verifyAttendance,
  type AttendanceDetails,
  type PublicAttendancePreview,
  type SessionAttendanceLink,
  type SignAttendanceResponse,
  type VerifyAttendanceResponse,
} from '@/api/sessionAttendances'

export const SESSION_ATTENDANCE_QUERY_KEY = ['sessionAttendance'] as const

export function publicAttendancePreviewKey(token: string) {
  return [...SESSION_ATTENDANCE_QUERY_KEY, 'public-preview', token] as const
}

export function appointmentAttendanceKey(appointmentId: string) {
  return [...SESSION_ATTENDANCE_QUERY_KEY, 'appointment', appointmentId] as const
}

// Usado pelo SessionAttendanceSheet — gera (ou reutiliza) link a partir
// de um appointment id. POST porque é uma ação com side-effect (cria token).
export function useGenerateAttendanceLink() {
  return useMutation<SessionAttendanceLink, Error, string>({
    mutationFn: (appointmentId) => generateAttendanceLink(appointmentId),
  })
}

// Detalhes da assinatura — usado pelo SignatureViewSheet. Cache longo
// (5min) porque assinatura é imutável depois de criada (uma vez signed,
// não muda).
export function useAppointmentAttendance(
  appointmentId: string | undefined,
  enabled = true,
) {
  return useQuery<AttendanceDetails, Error>({
    queryKey: appointmentAttendanceKey(appointmentId ?? ''),
    queryFn: () => fetchAppointmentAttendance(appointmentId as string),
    enabled: Boolean(appointmentId) && enabled,
    staleTime: 5 * 60 * 1000,
    retry: false,
  })
}

// Página pública usa esses 3 hooks. Não fazem invalidate em caches do app
// autenticado (estamos numa rota sem login).

export function usePublicAttendancePreview(
  token: string | undefined,
  enabled = true,
) {
  return useQuery<PublicAttendancePreview, Error>({
    queryKey: publicAttendancePreviewKey(token ?? ''),
    queryFn: () => fetchPublicAttendancePreview(token as string),
    enabled: Boolean(token) && enabled,
    retry: false,
    staleTime: 60 * 1000,
  })
}

export function useVerifyAttendance(token: string | undefined) {
  return useMutation<
    VerifyAttendanceResponse,
    Error,
    { document: string; birthDate: string }
  >({
    mutationFn: (input) => verifyAttendance(token as string, input),
  })
}

export function useSignAttendance(token: string | undefined) {
  return useMutation<
    SignAttendanceResponse,
    Error,
    { verifyToken: string; signatureSvg: string; photoDataUrl: string }
  >({
    mutationFn: ({ verifyToken, signatureSvg, photoDataUrl }) =>
      signAttendance(token as string, verifyToken, {
        signatureSvg,
        photoDataUrl,
      }),
    // Sem invalidate do preview: a tela de sucesso assume o controle e
    // não depende mais da query. Se o cliente recarregar a página depois
    // do sign, o GET fresco bate 410 — comportamento correto. Invalidar
    // aqui causava race entre `step='success'` e o early-return de erro,
    // mostrando "Link já foi utilizado" em vez do parabéns.
  })
}
