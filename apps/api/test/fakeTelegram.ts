import type { TelegramApi, TgMessage, TgUpdate, TgUser } from "../src/telegram/api.js";

/** In-memory Telegram API that records calls. */
export class FakeTelegram implements TelegramApi {
  sent: { chat_id: number | string; text: string; reply_to_message_id?: number; parse_mode?: string }[] = [];
  photos: { chat_id: number | string; photo: string; caption?: string }[] = [];
  deleted: { chatId: number | string; messageId: number }[] = [];
  memberStatus = "member";
  private nextId = 1000;
  async sendMessage(p: { chat_id: number | string; text: string; reply_to_message_id?: number; parse_mode?: "HTML" }) { this.sent.push(p); return { message_id: this.nextId++ }; }
  async sendPhoto(p: { chat_id: number | string; photo: string; caption?: string }) { this.photos.push(p); return { message_id: this.nextId++ }; }
  async sendChatAction() {}
  async deleteMessage(chatId: number | string, messageId: number) { this.deleted.push({ chatId, messageId }); return true; }
  async downloadFile() { return { data: Buffer.from("fake"), mimeType: "image/jpeg" }; }
  async getChatMemberStatus() { return this.memberStatus; }
  async setWebhook() { return true; }
}

let updateId = 1;
let messageId = 1;
export const alice: TgUser = { id: 111, is_bot: false, first_name: "Alice", language_code: "he" };
export const bob: TgUser = { id: 222, is_bot: false, first_name: "Bob" };
const group = { id: -100123, type: "supergroup" as const, title: "חדשות" };

export function groupMessage(from: TgUser, text: string, opts: { replyTo?: TgMessage; entities?: boolean; private?: boolean } = {}): TgMessage {
  const m: TgMessage = { message_id: messageId++, date: Math.floor(Date.now() / 1000), chat: opts.private ? { id: from.id, type: "private" } : group, from, text };
  if (opts.entities !== false) {
    const i = text.indexOf("@bombot");
    if (i >= 0) m.entities = [{ type: "mention", offset: i, length: "@bombot".length }];
  }
  if (opts.replyTo) m.reply_to_message = opts.replyTo;
  return m;
}
export const update = (message: TgMessage): TgUpdate => ({ update_id: updateId++, message });
