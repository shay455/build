/** Minimal Telegram Bot API client. Only the methods Bombot uses; injectable for tests. */
export interface TgUser { id: number; is_bot: boolean; first_name: string; last_name?: string; username?: string; language_code?: string }
export interface TgChat { id: number; type: "private" | "group" | "supergroup" | "channel"; title?: string; is_forum?: boolean }
export interface TgEntity { type: string; offset: number; length: number; user?: TgUser }
export interface TgPhotoSize { file_id: string; width: number; height: number; file_size?: number }
export interface TgMessage {
  message_id: number; date: number; chat: TgChat; from?: TgUser; text?: string; caption?: string;
  entities?: TgEntity[]; caption_entities?: TgEntity[]; reply_to_message?: TgMessage; photo?: TgPhotoSize[];
  message_thread_id?: number; is_topic_message?: boolean; video?: { file_id: string }; forward_origin?: unknown;
}
export interface TgUpdate { update_id: number; message?: TgMessage; edited_message?: TgMessage }

export interface SendMessageParams {
  chat_id: number | string; text: string; reply_to_message_id?: number; message_thread_id?: number;
  parse_mode?: "HTML"; disable_web_page_preview?: boolean;
}

export interface TelegramApi {
  sendMessage(p: SendMessageParams): Promise<{ message_id: number }>;
  sendPhoto(p: { chat_id: number | string; photo: string; caption?: string; reply_to_message_id?: number; message_thread_id?: number; parse_mode?: "HTML" }): Promise<{ message_id: number }>;
  sendChatAction(chatId: number | string, action: "typing" | "upload_photo", threadId?: number): Promise<void>;
  deleteMessage(chatId: number | string, messageId: number): Promise<boolean>;
  downloadFile(fileId: string): Promise<{ data: Buffer; mimeType: string }>;
  getChatMemberStatus(chatId: number | string, userId: number): Promise<string>;
  setWebhook(url: string, secret: string): Promise<boolean>;
}

export class TelegramHttpApi implements TelegramApi {
  constructor(private readonly token: string, private readonly fetchImpl: typeof fetch = fetch) {}

  private async call<T>(method: string, body: Record<string, unknown>): Promise<T> {
    const r = await this.fetchImpl(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    const j = (await r.json()) as { ok: boolean; result: T; description?: string; error_code?: number };
    if (!j.ok) throw new TelegramError(j.error_code ?? r.status, j.description ?? "telegram error");
    return j.result;
  }

  sendMessage(p: SendMessageParams) { return this.call<{ message_id: number }>("sendMessage", { ...p }); }
  sendPhoto(p: Parameters<TelegramApi["sendPhoto"]>[0]) { return this.call<{ message_id: number }>("sendPhoto", { ...p }); }
  async sendChatAction(chat_id: number | string, action: "typing" | "upload_photo", message_thread_id?: number) {
    await this.call("sendChatAction", { chat_id, action, message_thread_id }).catch(() => undefined);
  }
  deleteMessage(chat_id: number | string, message_id: number) { return this.call<boolean>("deleteMessage", { chat_id, message_id }); }
  async getChatMemberStatus(chat_id: number | string, user_id: number) {
    const m = await this.call<{ status: string }>("getChatMember", { chat_id, user_id });
    return m.status;
  }
  async downloadFile(file_id: string) {
    const f = await this.call<{ file_path: string }>("getFile", { file_id });
    const r = await this.fetchImpl(`https://api.telegram.org/file/bot${this.token}/${f.file_path}`);
    const data = Buffer.from(await r.arrayBuffer());
    const ext = f.file_path.split(".").pop()?.toLowerCase();
    const mimeType = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    return { data, mimeType };
  }
  setWebhook(url: string, secret_token: string) {
    return this.call<boolean>("setWebhook", { url, secret_token, allowed_updates: ["message"], drop_pending_updates: true });
  }
}

export class TelegramError extends Error {
  constructor(public readonly code: number, message: string) { super(message); this.name = "TelegramError"; }
}
