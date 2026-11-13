import axios from 'axios'
import { coreApi } from '@/api/client'
import { env } from '@/config/env'

// =====================================================================
// API client do módulo de presença assinada (procedure_session_attendances).
//
// Duas superfícies:
//   1. Autenticada (`coreApi` — cookie de sessão) — operador gera link
//      no popover da agenda.
//   2. Pública (`publicAttendanceApi` — sem cookies, sem withCredentials)
//      — usada exclusivamente pela página /sessoes/assinar/:token.
//      Browser do cliente NÃO está logado nem necessariamente no
//      mesmo subdomínio.
// =====================================================================

export interface CoveredSession {
  id: string
  procedureName: string
  scheduledAt: string
  professionalName: string | null
  appointmentId: string
}

export interface SessionAttendanceLink {
  token: string
  signUrl: string
  expiresAt: string
  attendanceDate: string
  coveredSessions: CoveredSession[]
  reused: boolean
}

export async function generateAttendanceLink(
  appointmentId: string,
): Promise<SessionAttendanceLink> {
  const res = await coreApi.post<SessionAttendanceLink>(
    `/appointments/${appointmentId}/attendance/link`,
  )
  return res.data
}

// Detalhes da assinatura registrada (foto + assinatura) — espelha
// AttendanceDetailsResult do backend. Usado pela "Ver assinatura" no
// popover quando appointment já foi atendido.
export interface AttendanceDetails {
  attendanceId: string
  signedAt: string
  attendanceDate: string
  signatureSvg: string
  photoDataUrl: string
  signedFromIp: string | null
  signedUserAgent: string | null
  cpfConfirmed: boolean
  birthDateConfirmed: boolean
  coveredSessions: CoveredSession[]
}

export async function fetchAppointmentAttendance(
  appointmentId: string,
): Promise<AttendanceDetails> {
  const res = await coreApi.get<AttendanceDetails>(
    `/appointments/${appointmentId}/attendance`,
  )
  return res.data
}

// --------- API pública (sem cookies) ---------

// Cliente axios separado pra rotas públicas — sem `withCredentials` (não
// faz sentido enviar cookie em rota anônima e o backend espera ausência).
// `timeout` maior porque o sign carrega payload com foto (~50-300KB).
const publicAttendanceApi = axios.create({
  baseURL: env.api.core,
  withCredentials: false,
  timeout: 30000,
})

export interface PublicAttendancePreview {
  clientFirstName: string
  clientLastInitial: string
  clinicName: string
  attendanceDate: string
  procedures: Array<{
    name: string
    scheduledAt: string
    professionalName: string | null
  }>
  expiresAt: string
}

export async function fetchPublicAttendancePreview(
  token: string,
): Promise<PublicAttendancePreview> {
  const res = await publicAttendanceApi.get<PublicAttendancePreview>(
    `/public/session-attendance/${token}`,
  )
  return res.data
}

export interface VerifyAttendanceResponse {
  verifyToken: string
  expiresAt: string
}

export async function verifyAttendance(
  token: string,
  input: { document: string; birthDate: string },
): Promise<VerifyAttendanceResponse> {
  const res = await publicAttendanceApi.post<VerifyAttendanceResponse>(
    `/public/session-attendance/${token}/verify`,
    input,
  )
  return res.data
}

export interface SignAttendanceResponse {
  attendanceId: string
  signedAt: string
  coveredSessionIds: string[]
}

export async function signAttendance(
  token: string,
  verifyToken: string,
  input: { signatureSvg: string; photoDataUrl: string },
): Promise<SignAttendanceResponse> {
  const res = await publicAttendanceApi.post<SignAttendanceResponse>(
    `/public/session-attendance/${token}/sign`,
    input,
    { headers: { 'X-Verify-Token': verifyToken } },
  )
  return res.data
}
