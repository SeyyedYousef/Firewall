const BOT_TOKEN = process.env.BOT_TOKEN;
const TELEGRAM_API_BASE = `https://api.telegram.org`;

if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN environment variable is required to call the Telegram Bot API");
}

type TelegramApiRequestOptions = {
  method: string;
  payload?: Record<string, unknown>;
};

type TelegramApiResponse<T> = {
  ok: boolean;
  result?: T;
  description?: string;
};

function callTelegramApi<T>(options: TelegramApiRequestOptions): Promise<T> {
  const method = options.method.trim();
  const url = new URL(`${TELEGRAM_API_BASE}/bot${BOT_TOKEN}/${method}`);
  const body = options.payload ? JSON.stringify(options.payload) : "";

  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body,
  })
    .then(async (res) => {
      const raw = await res.text();
      if (!res.ok) {
        throw new Error(`Telegram API responded with HTTP ${res.status}: ${raw}`);
      }
      const parsed = JSON.parse(raw) as TelegramApiResponse<T>;
      if (!parsed.ok || parsed.result === undefined) {
        const message = parsed.description ?? `Telegram API method ${method} failed`;
        throw new Error(message);
      }
      return parsed.result;
    });
}

export type InvoicePrice = {
  label: string;
  amount: number;
};

export type CreateInvoiceLinkOptions = {
  title: string;
  description: string;
  payload: string;
  currency: string;
  prices: InvoicePrice[];
  photoUrl?: string;
  maxTipAmount?: number;
  suggestedTipAmounts?: number[];
  providerData?: Record<string, unknown>;
};

export async function createInvoiceLink(options: CreateInvoiceLinkOptions): Promise<string> {
  const result = await callTelegramApi<string>({
    method: "createInvoiceLink",
    payload: {
      title: options.title,
      description: options.description,
      payload: options.payload,
      currency: options.currency,
      prices: options.prices.map((item) => ({
        label: item.label,
        amount: item.amount,
      })),
      photo_url: options.photoUrl,
      max_tip_amount: options.maxTipAmount,
      suggested_tip_amounts: options.suggestedTipAmounts,
      provider_data: options.providerData ? JSON.stringify(options.providerData) : undefined,
    },
  });
  return result;
}

export async function refundStarsPayment(options: { userId: number; telegramPaymentChargeId: string }): Promise<boolean> {
  const result = await callTelegramApi<boolean>({
    method: "refundStarPayment",
    payload: {
      user_id: options.userId,
      telegram_payment_charge_id: options.telegramPaymentChargeId,
    },
  });
  return result;
}

type SendMessageOptions = {
  chatId: number | string;
  text: string;
  parseMode?: "Markdown" | "MarkdownV2" | "HTML";
  disableWebPagePreview?: boolean;
};

export async function sendTelegramMessage(options: SendMessageOptions): Promise<void> {
  await callTelegramApi({
    method: "sendMessage",
    payload: {
      chat_id: options.chatId,
      text: options.text,
      parse_mode: options.parseMode,
      disable_web_page_preview: options.disableWebPagePreview ?? true,
    },
  });
}

type TelegramFileResponse = {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  file_path?: string;
};

export type TelegramFileInfo = {
  fileId: string;
  fileUniqueId: string;
  filePath: string;
  fileSize?: number;
};

export async function getTelegramFile(fileId: string): Promise<TelegramFileInfo> {
  const result = await callTelegramApi<TelegramFileResponse>({
    method: "getFile",
    payload: {
      file_id: fileId,
    },
  });
  if (!result.file_path) {
    throw new Error("Telegram did not return a file_path for the requested file");
  }
  return {
    fileId: result.file_id,
    fileUniqueId: result.file_unique_id,
    filePath: result.file_path,
    fileSize: result.file_size,
  };
}

export function buildTelegramFileUrl(filePath: string): string {
  const normalized = filePath.startsWith("/") ? filePath.slice(1) : filePath;
  return `${TELEGRAM_API_BASE}/file/bot${BOT_TOKEN}/${normalized}`;
}

export async function downloadTelegramFile(filePath: string): Promise<ArrayBuffer> {
  const url = buildTelegramFileUrl(filePath);
  const response = await fetch(url);
  if (!response.ok) {
    const message = await response.text().catch(() => response.statusText);
    throw new Error(`Failed to download Telegram file: ${response.status} ${message}`);
  }
  return response.arrayBuffer();
}
