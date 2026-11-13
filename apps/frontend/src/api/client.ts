import axios from 'axios'
import { env } from '@/config/env'
import { installInterceptors } from './interceptors'

// withCredentials: true é obrigatório pra o browser enviar/receber cookies
// httpOnly (`elora_token`) em requests cross-origin. Sem isso, o cookie
// não viaja entre frontend (porta 5500) e backend (porta 5501) em dev.
//
// O backend complementa com cors({ credentials: true, origin: <reflect> })
// — o reflect é necessário porque Access-Control-Allow-Origin não pode
// ser `*` quando credentials está ligado.

export const coreApi = axios.create({
  baseURL: env.api.core,
  withCredentials: true,
  timeout: 15000,
})

export const chatApi = axios.create({
  baseURL: env.api.chat,
  withCredentials: true,
  timeout: 15000,
})

installInterceptors(coreApi)
installInterceptors(chatApi)
