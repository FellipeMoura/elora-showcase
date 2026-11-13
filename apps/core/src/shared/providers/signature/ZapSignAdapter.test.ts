import { describe, it, expect } from 'vitest';
import { ZapSignAdapter, type ZapSignConfig } from './ZapSignAdapter.js';

// Adapter instanciado direto com config fake — `normalizeWebhook` e
// `verifyWebhook` são puros (sem rede): traduzem payload/headers sem tocar
// na API HTTP do ZapSign.
const SANDBOX = 'https://sandbox.api.zapsign.com.br/api/v1';

function makeAdapter(overrides: Partial<ZapSignConfig> = {}): ZapSignAdapter {
  return new ZapSignAdapter({
    apiToken: null,
    apiBaseUrl: SANDBOX,
    webhookToken: null,
    ...overrides,
  });
}

describe('ZapSignAdapter.normalizeWebhook', () => {
  it('doc_signed → document.signed com signedPdfUrl e signedAt do payload', () => {
    const ev = makeAdapter().normalizeWebhook({
      event_type: 'doc_signed',
      token: 'tok123',
      signed_file: 'https://files.zapsign/y.pdf',
      signed_at: '2026-06-03T10:00:00Z',
    });
    expect(ev.kind).toBe('document.signed');
    if (ev.kind !== 'document.signed') throw new Error('narrowing');
    expect(ev.externalDocumentId).toBe('tok123');
    expect(ev.signedPdfUrl).toBe('https://files.zapsign/y.pdf');
    expect(ev.signedAt.toISOString()).toBe('2026-06-03T10:00:00.000Z');
  });

  it('doc_signed sem signed_at usa fallback Date atual (não quebra)', () => {
    const ev = makeAdapter().normalizeWebhook({ event_type: 'doc_signed', token: 'tok123' });
    expect(ev.kind).toBe('document.signed');
    if (ev.kind !== 'document.signed') throw new Error('narrowing');
    expect(ev.signedAt).toBeInstanceOf(Date);
    // signed_file ausente → null (caller cai no fallback de download via provider).
    expect(ev.signedPdfUrl).toBeNull();
  });

  it('auto_reject E doc_refused mapeiam ambos para document.declined', () => {
    const a = makeAdapter().normalizeWebhook({ event_type: 'auto_reject', token: 'tok', status: 'rejected' });
    const b = makeAdapter().normalizeWebhook({ event_type: 'doc_refused', token: 'tok', status: 'refused' });
    expect(a.kind).toBe('document.declined');
    expect(b.kind).toBe('document.declined');
    if (a.kind === 'document.declined') expect(a.reason).toBe('rejected');
  });

  it('email_link_viewed → document.viewed', () => {
    const ev = makeAdapter().normalizeWebhook({ event_type: 'email_link_viewed', token: 'tok' });
    expect(ev.kind).toBe('document.viewed');
  });

  it('event_type desconhecido → unknown, mas preserva externalDocumentId', () => {
    const ev = makeAdapter().normalizeWebhook({ event_type: 'doc_deleted', token: 'tok999' });
    expect(ev.kind).toBe('unknown');
    if (ev.kind !== 'unknown') throw new Error('narrowing');
    expect(ev.externalDocumentId).toBe('tok999');
    expect(ev.rawEvent).toBe('doc_deleted');
  });

  it('payload sem token → unknown com externalDocumentId null (webhook malformado não derruba nada)', () => {
    const ev = makeAdapter().normalizeWebhook({ event_type: 'doc_signed' });
    expect(ev.kind).toBe('unknown');
    if (ev.kind !== 'unknown') throw new Error('narrowing');
    expect(ev.externalDocumentId).toBeNull();
  });

  it('payload null/undefined não lança — degrada para unknown', () => {
    expect(() => makeAdapter().normalizeWebhook(null)).not.toThrow();
    expect(makeAdapter().normalizeWebhook(undefined).kind).toBe('unknown');
  });
});

describe('ZapSignAdapter.verifyWebhook', () => {
  it('sem webhookToken configurado → aceita qualquer payload (modo dev)', () => {
    const ok = makeAdapter({ webhookToken: null }).verifyWebhook({ headers: {}, body: {} });
    expect(ok).toBe(true);
  });

  it('com token, header correto → true', () => {
    const adapter = makeAdapter({ webhookToken: 'secret' });
    const ok = adapter.verifyWebhook({ headers: { 'x-elora-webhook-token': 'secret' }, body: {} });
    expect(ok).toBe(true);
  });

  it('com token, header errado ou ausente → false', () => {
    const adapter = makeAdapter({ webhookToken: 'secret' });
    expect(adapter.verifyWebhook({ headers: { 'x-elora-webhook-token': 'wrong' }, body: {} })).toBe(false);
    expect(adapter.verifyWebhook({ headers: {}, body: {} })).toBe(false);
  });

  it('header repetido (array) usa o primeiro valor', () => {
    const adapter = makeAdapter({ webhookToken: 'secret' });
    const ok = adapter.verifyWebhook({ headers: { 'x-elora-webhook-token': ['secret', 'other'] }, body: {} });
    expect(ok).toBe(true);
  });
});

describe('ZapSignAdapter — derivações de ambiente', () => {
  it('detecta sandbox pelo subdomínio e expõe panelUrl de sandbox', () => {
    const adapter = makeAdapter({ apiBaseUrl: SANDBOX });
    expect(adapter.isSandbox).toBe(true);
    expect(adapter.panelUrl).toContain('sandbox.app.zapsign.com.br');
  });

  it('base URL de produção → não-sandbox e panelUrl de produção', () => {
    const adapter = makeAdapter({ apiBaseUrl: 'https://api.zapsign.com.br/api/v1' });
    expect(adapter.isSandbox).toBe(false);
    expect(adapter.panelUrl).toBe('https://app.zapsign.com.br/conta/modelos');
  });

  it('isConfigured reflete presença do apiToken', () => {
    expect(makeAdapter({ apiToken: null }).isConfigured).toBe(false);
    expect(makeAdapter({ apiToken: 'tok' }).isConfigured).toBe(true);
  });
});
