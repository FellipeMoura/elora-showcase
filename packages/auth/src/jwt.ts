import jwt from 'jsonwebtoken';

export interface TokenPayload {
  userId: string;
  tenantId: string;
  username: string;
}

export function signToken(payload: TokenPayload, secret: string, expiresIn = '7d'): string {
  return jwt.sign(payload, secret, { expiresIn } as jwt.SignOptions);
}

export function verifyToken(token: string, secret: string): TokenPayload {
  return jwt.verify(token, secret) as TokenPayload;
}

// Decodifica o token (sem verificar assinatura) só pra extrair o `exp`.
// Útil pra alinhar maxAge de cookie com a expiração efetiva do token.
export function getTokenExpiration(token: string): Date | null {
  const decoded = jwt.decode(token);
  if (!decoded || typeof decoded === 'string' || typeof decoded.exp !== 'number') {
    return null;
  }
  return new Date(decoded.exp * 1000);
}
