import { retrieveLaunchParams } from '@telegram-apps/sdk-react';

let cachedInitData: string | null | undefined;
let hasLoggedInitData = false;

function logInitData(source: string, value: string | null): void {
  if (hasLoggedInitData) {
    return;
  }
  hasLoggedInitData = true;
  const preview = typeof value === 'string' ? value.slice(0, 120) : value;
  console.log('[telegram] init data snapshot', {
    source,
    preview,
    length: typeof value === 'string' ? value.length : null,
  });
}

function normalizeInitData(source: string, raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (!trimmed.includes('hash=')) {
    console.warn('[telegram] init data missing hash parameter', {
      source,
      preview: trimmed.slice(0, 120),
    });
    return null;
  }
  return trimmed;
}

export function getTelegramInitData(): string | null {
  if (cachedInitData !== undefined) {
    return cachedInitData;
  }

  const telegram = (window as typeof window & { Telegram?: { WebApp?: { initData?: string } } }).Telegram;
  const fromTelegram = telegram?.WebApp?.initData;
  const normalizedFromTelegram = normalizeInitData('webapp', fromTelegram);
  if (normalizedFromTelegram) {
    cachedInitData = normalizedFromTelegram;
    logInitData('webapp', cachedInitData);
    return cachedInitData;
  }

  try {
    const params = retrieveLaunchParams();
    const data = params.tgWebAppData as unknown;
    if (typeof data === 'string') {
      const normalized = normalizeInitData('launch-params-string', data);
      if (normalized) {
        cachedInitData = normalized;
        logInitData('launch-params-string', cachedInitData);
        return cachedInitData;
      }
    } else if (data && typeof (data as URLSearchParams).toString === 'function') {
      const normalized = normalizeInitData(
        'launch-params-search-params',
        (data as URLSearchParams).toString(),
      );
      if (normalized) {
        cachedInitData = normalized;
        logInitData('launch-params-search-params', cachedInitData);
        return cachedInitData;
      }
    }
  } catch {
    // ignore errors; fall back to null
  }

  cachedInitData = null;
  logInitData('fallback-null', cachedInitData);
  return cachedInitData;
}

export type InvoiceOutcome = 'paid' | 'cancelled' | 'failed' | 'external';

export async function openTelegramInvoice(invoiceLink: string): Promise<InvoiceOutcome> {
  const telegram = (window as typeof window & {
    Telegram?: { WebApp?: { openInvoice?: (link: string, callback?: (status: string) => void) => unknown } };
  }).Telegram;
  const webApp = telegram?.WebApp;

  if (!webApp || typeof webApp.openInvoice !== 'function') {
    window.open(invoiceLink, '_blank', 'noopener,noreferrer');
    return 'external';
  }

  const openInvoiceFn = webApp.openInvoice as (link: string, callback?: (status: string) => void) => unknown;

  return new Promise<InvoiceOutcome>((resolve) => {
    try {
      const maybePromise = openInvoiceFn.call(webApp, invoiceLink, (status: string) => {
        if (status === 'paid' || status === 'cancelled' || status === 'failed') {
          resolve(status);
        } else {
          resolve('failed');
        }
      });

      if (maybePromise && typeof (maybePromise as Promise<unknown>).then === 'function') {
        (maybePromise as Promise<unknown>)
          .then(() => {
            // callback already handled outcome
          })
          .catch(() => {
            resolve('failed');
          });
      }
    } catch {
      window.open(invoiceLink, '_blank', 'noopener,noreferrer');
      resolve('external');
    }
  });
}
