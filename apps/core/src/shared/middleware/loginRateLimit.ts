import rateLimit from 'express-rate-limit';

// 10 tentativas por IP a cada 15 minutos. Números conservadores pra começar;
// ajustar com base em métricas reais quando entrar em produção.
export const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  message: { message: 'Muitas tentativas de login. Tente novamente em alguns minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
});
