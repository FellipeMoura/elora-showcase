import { describe, expect, it } from 'vitest';
import {
  PUSH_PREVIEW_MAX,
  buildChatPushPayload,
  conversationTopic,
  type ChatPushSource,
} from './chatPushPayload.js';
import { isAllowedPushEndpoint } from './PushSubscriptionsTypes.js';

const CONV_ID = '3f2b8c1e-5d4a-4e7b-9c6d-1a2b3c4d5e6f';

function source(overrides: Partial<ChatPushSource> = {}): ChatPushSource {
  return {
    conversationId: CONV_ID,
    isNewLead: false,
    receivedAt: '2026-11-04T12:00:00.000Z',
    clientName: 'Sorveteria Polo Norte LTDA',
    clientTradeName: 'Polo Norte',
    contactProfileName: 'Zé',
    contactPhoneE164: '+5511987654321',
    messageBody: 'Quero 10 fardos amanhã',
    messageKind: 'text',
    messageMediaType: null,
    ...overrides,
  };
}

describe('buildChatPushPayload — título', () => {
  it('usa o nome fantasia do cliente', () => {
    expect(buildChatPushPayload(source()).title).toBe('Polo Norte');
  });

  it('cai na razão social sem nome fantasia', () => {
    expect(buildChatPushPayload(source({ clientTradeName: '  ' })).title).toBe(
      'Sorveteria Polo Norte LTDA'
    );
  });

  it('sem cliente, usa o nome do perfil do WhatsApp', () => {
    const p = buildChatPushPayload(source({ clientName: null, clientTradeName: null }));
    expect(p.title).toBe('Zé');
  });

  it('nome placeholder (= telefone) cai no perfil do WhatsApp', () => {
    const p = buildChatPushPayload(
      source({ clientName: '+5511987654321', clientTradeName: null })
    );
    expect(p.title).toBe('Zé');
  });

  it('sem cliente nem perfil, usa o telefone formatado', () => {
    const p = buildChatPushPayload(
      source({ clientName: null, clientTradeName: null, contactProfileName: null })
    );
    expect(p.title).toBe('+55 (11) 98765-4321');
  });

  it('número novo ganha o prefixo "Novo lead"', () => {
    const p = buildChatPushPayload(
      source({ isNewLead: true, clientName: null, clientTradeName: null })
    );
    expect(p.title).toBe('Novo lead: Zé');
    expect(p.isNewLead).toBe(true);
  });
});

describe('buildChatPushPayload — corpo', () => {
  it('texto vai como veio, numa linha', () => {
    expect(buildChatPushPayload(source({ messageBody: 'oi\n\ntudo bem?' })).body).toBe(
      'oi tudo bem?'
    );
  });

  it('texto longo é cortado com reticências', () => {
    const body = buildChatPushPayload(source({ messageBody: 'a'.repeat(500) })).body;
    expect(body).toHaveLength(PUSH_PREVIEW_MAX);
    expect(body.endsWith('…')).toBe(true);
  });

  it('foto sem legenda vira rótulo', () => {
    const p = buildChatPushPayload(
      source({ messageKind: 'media', messageMediaType: 'image', messageBody: null })
    );
    expect(p.body).toBe('📷 Foto');
  });

  it('foto com legenda junta rótulo e legenda', () => {
    const p = buildChatPushPayload(
      source({ messageKind: 'media', messageMediaType: 'image', messageBody: 'nota' })
    );
    expect(p.body).toBe('📷 Foto: nota');
  });

  it('áudio', () => {
    const p = buildChatPushPayload(
      source({ messageKind: 'media', messageMediaType: 'audio', messageBody: null })
    );
    expect(p.body).toBe('🎤 Áudio');
  });

  it('chamada', () => {
    const p = buildChatPushPayload(source({ messageKind: 'call', messageBody: null }));
    expect(p.body).toBe('📞 Chamada');
  });
});

describe('buildChatPushPayload — roteamento', () => {
  it('tag e url apontam pra conversa', () => {
    const p = buildChatPushPayload(source());
    expect(p.tag).toBe(`conversation:${CONV_ID}`);
    expect(p.url).toBe(`/?conversation=${CONV_ID}`);
    expect(p.timestamp).toBe(Date.parse('2026-11-04T12:00:00.000Z'));
  });

  it('topic cabe no limite de 32 chars do Web Push', () => {
    const topic = conversationTopic(CONV_ID);
    expect(topic).toHaveLength(32);
    expect(topic).toMatch(/^[0-9a-f]+$/);
  });
});

describe('isAllowedPushEndpoint', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/abc',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://web.push.apple.com/abc',
    'https://wns2-by3p.notify.windows.com/w/?token=abc',
  ])('aceita %s', (endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(true);
  });

  it.each([
    'http://fcm.googleapis.com/fcm/send/abc',
    'https://127.0.0.1:5702/webhook',
    'https://localhost/x',
    'https://evilfcm.googleapis.com.attacker.io/x',
    'https://notfcm.googleapis.com.evil/x',
    'não é url',
  ])('recusa %s', (endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(false);
  });
});
