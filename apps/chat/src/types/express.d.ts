declare global {
  namespace Express {
    interface Request {
      tenantId?: string;
      userId?: string;
      // Preenchido por loadUserRoles (roles dos grupos do usuário no tenant).
      roleCodes?: import('../shared/permissions/permissions.js').RoleCode[];
      // Body bruto preservado por express.json({ verify }) — disponível pra
      // futuros adapters de WhatsApp que precisem verificar HMAC. Evolution
      // (atual) usa Bearer simples e Mock não autentica, mas o campo fica.
      rawBody?: Buffer;
    }
  }
}

export {};
