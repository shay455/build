import { randomUUID } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import { BOT_LIMITS, type BotIntent, type BotRequestView, type ChatSettings, type Citation } from "@bombot/shared";
import type { Env } from "../config/env.js";
import type { Repo, TgStoredMessage } from "../db/repo.js";
import { ImagePolicyError, ImageQuotaError, type ImageService } from "../images/service.js";
import type { LlmProvider } from "../llm/types.js";
import { runFactCheck, type ThreadContext } from "../orchestrator/factcheck.js";
import { SafetyFilter } from "../safety/filter.js";
import type { TelegramApi, TgMessage, TgUpdate } from "./api.js";
import { cleanRequest, hasArabic, hasHebrew, markdownToTelegramHtml, sourcesFooter, truncate, verdictHeader } from "./format.js";

export const KILL_SWITCH_KEY = "bot.enabled";

export interface TelegramHandlerDeps {
  env: Env; repo: Repo; llm: LlmProvider; tg: TelegramApi; images: ImageService; log: FastifyBaseLogger;
}

type Command = "check" | "explain" | "imagine" | "summarize" | "translate" | "ask" | "start" | "help" | "settings";

/** MENT-01..10: turns one Telegram update into (at most) one reply. Every decision is logged in bot_requests. */
export class TelegramHandler {
  private readonly safety: SafetyFilter;
  constructor(private readonly d: TelegramHandlerDeps) { this.safety = new SafetyFilter(d.llm); }

  async handle(update: TgUpdate): Promise<BotRequestView | null> {
    if (!(await this.d.repo.claimUpdate(update.update_id))) return null;
    const msg = update.message;
    if (!msg || !msg.from || msg.from.is_bot) return null;
    const chatId = String(msg.chat.id);
    const text = msg.text ?? msg.caption ?? "";

    // Remember every message we are allowed to see, so later "@bombot is this true?" has thread context.
    await this.remember(msg);
    if (msg.reply_to_message) await this.remember(msg.reply_to_message);

    const trigger = this.trigger(msg, text);
    if (!trigger) return null;

    const enabled = await this.d.repo.getState<boolean>(KILL_SWITCH_KEY, true);
    if (!enabled) return this.log(msg, "chat", text, { status: "silent", replyText: null });
    const settings = await this.d.repo.getChatSettings(chatId);
    if (!settings.enabled && trigger.command !== "settings") return this.log(msg, "chat", text, { status: "silent", replyText: null });
    if (settings.respondMode === "mention_only" && trigger.kind === "bare_command") return null;

    const he = settings.language === "he" || (settings.language === "auto" && (hasHebrew(text) || msg.from.language_code === "he"));
    const request = cleanRequest(text, this.d.env.TELEGRAM_BOT_USERNAME);

    if (trigger.command === "start" || trigger.command === "help") return this.reply(msg, "chat", text, helpText(he), []);
    if (trigger.command === "settings") return this.settings(msg, request, settings, he);

    // Rate limit per user per hour (MENT-06). Subscriptions arrive with accounts in a later phase.
    const used = await this.d.repo.countRecentRequests("telegram", String(msg.from.id), 60 * 60 * 1000);
    if (used >= BOT_LIMITS.freePerHour) {
      const t = he ? `הגעת למכסה של ${BOT_LIMITS.freePerHour} בקשות בשעה. נסו שוב מאוחר יותר.` : `You've reached the limit of ${BOT_LIMITS.freePerHour} requests per hour. Try again later.`;
      return this.reply(msg, "chat", text, t, [], { status: "rate_limited" });
    }

    const target = msg.reply_to_message ?? null;
    const targetText = target ? (target.text ?? target.caption ?? "") : "";
    const hasImage = Boolean(target?.photo?.length || msg.photo?.length);

    // Intent: explicit commands win; otherwise the fast classifier decides.
    let intent: BotIntent; let claim: string | null = null;
    if (trigger.command === "check") { intent = "fact_check"; claim = targetText || request; }
    else if (trigger.command === "explain") intent = "explain";
    else if (trigger.command === "imagine") intent = "image";
    else if (trigger.command === "summarize") intent = "summarize";
    else if (trigger.command === "translate") intent = "translate";
    else {
      const r = await this.d.llm.classifyIntent({ request, target: targetText || null, hasImage });
      intent = r.intent; claim = r.claim;
      if (!target && intent === "fact_check" && !claim) claim = request;
    }
    if (intent === "spam" || intent === "injection") return this.log(msg, intent, text, { status: "silent", replyText: null });

    if (intent === "image") return this.image(msg, request || targetText, he, text);

    // Input safety gate over everything the model will read.
    const inputCheck = await this.safety.check("input", [request, targetText].filter(Boolean).join("\n"));
    if (inputCheck.action !== "allow") {
      await this.d.repo.logSafety({ ...inputCheck, conversationId: null, messageId: null });
      return this.reply(msg, intent, text, this.safety.replacementText("input", he ? "א" : "a"), [], { status: "blocked", safety: inputCheck });
    }

    await this.d.tg.sendChatAction(msg.chat.id, "typing", msg.message_thread_id);
    const started = Date.now();
    const ctx = await this.buildContext(msg, target, request, intent, claim, settings);
    let result;
    try {
      result = await runFactCheck(this.d.llm, ctx, AbortSignal.timeout(90_000));
    } catch (err) {
      this.d.log.error({ err, chatId }, "mention bot: model call failed");
      const t = he ? "לא הצלחתי לבדוק את זה כרגע. נסו שוב בעוד דקה." : "I couldn't check this right now. Please try again in a minute.";
      return this.reply(msg, intent, text, t, [], { status: "error" });
    }
    if (!result.text.trim()) {
      const t = he ? "לא הצלחתי לאמת את זה כרגע." : "I couldn't verify this right now.";
      return this.reply(msg, intent, text, t, [], { status: "error", usage: result.usage });
    }

    // Output safety gate. Failure means a generic line, never the raw text.
    const outCheck = await this.safety.check("output", result.text);
    let body = result.text; let citations = result.citations;
    if (outCheck.action !== "allow") {
      await this.d.repo.logSafety({ ...outCheck, conversationId: null, messageId: null });
      body = this.safety.replacementText("output", he ? "א" : "a"); citations = [];
    }

    const footer = sourcesFooter(citations, he);
    const header = intent === "fact_check" && outCheck.action === "allow" ? verdictHeader(result.verdict, result.confidence, he) : "";
    const room = BOT_LIMITS.telegramReplyChars - stripTags(header).length - stripTags(footer).length;
    const html = header + markdownToTelegramHtml(truncate(body, Math.max(200, room))) + footer;

    return this.reply(msg, intent, text, html, citations, {
      status: outCheck.action === "allow" ? "answered" : "blocked",
      verdict: intent === "fact_check" ? result.verdict : null,
      confidence: intent === "fact_check" ? result.confidence : null,
      usage: result.usage, latencyMs: Date.now() - started, safety: outCheck.action === "allow" ? null : outCheck, html: true,
    });
  }

  /* ---------- helpers ---------- */

  private trigger(msg: TgMessage, text: string): { kind: "mention" | "command" | "bare_command" | "private"; command: Command | null } | null {
    const bot = this.d.env.TELEGRAM_BOT_USERNAME.toLowerCase();
    const cmd = /^\/(check|explain|imagine|summarize|translate|ask|start|help|settings)(?:@(\w+))?(?:\s|$)/i.exec(text);
    if (cmd) {
      const command = cmd[1]!.toLowerCase() as Command;
      if (cmd[2] && cmd[2].toLowerCase() !== bot) return null; // command for another bot
      const addressed = Boolean(cmd[2]) || msg.chat.type === "private";
      return { kind: addressed ? "command" : "bare_command", command };
    }
    const entities = [...(msg.entities ?? []), ...(msg.caption_entities ?? [])];
    const mentioned = entities.some((e) => e.type === "mention" && text.substr(e.offset, e.length).toLowerCase() === `@${bot}`)
      || text.toLowerCase().includes(`@${bot}`);
    if (mentioned) return { kind: "mention", command: null };
    if (msg.chat.type === "private") return { kind: "private", command: null };
    return null;
  }

  private async remember(m: TgMessage) {
    const photo = m.photo?.length ? m.photo[m.photo.length - 1] : undefined;
    await this.d.repo.rememberTgMessage({
      chatId: String(m.chat.id), messageId: m.message_id, threadId: m.message_thread_id ?? null,
      replyToMessageId: m.reply_to_message?.message_id ?? null, userId: m.from ? String(m.from.id) : null,
      userName: m.from ? displayName(m.from) : null, text: m.text ?? m.caption ?? "", hasPhoto: Boolean(photo),
      photoFileId: photo?.file_id ?? null, sentAt: new Date(m.date * 1000).toISOString(),
    });
  }

  private async buildContext(msg: TgMessage, target: TgMessage | null, request: string, intent: Exclude<BotIntent, "image" | "spam" | "injection">, claim: string | null, settings: ChatSettings): Promise<ThreadContext> {
    const recentRows = await this.d.repo.recentTgMessages(String(msg.chat.id), msg.message_thread_id ?? null, 21);
    const recent = recentRows.filter((r) => r.messageId !== msg.message_id && r.messageId !== target?.message_id && r.text)
      .map((r: TgStoredMessage) => ({ author: r.userName, text: r.text.slice(0, 600) }));
    let image: { mimeType: string; data: Buffer } | undefined;
    const photoSource = target?.photo?.length ? target : msg.photo?.length ? msg : null;
    if (photoSource?.photo?.length) {
      try { image = await this.d.tg.downloadFile(photoSource.photo[photoSource.photo.length - 1]!.file_id); }
      catch (err) { this.d.log.warn({ err }, "photo download failed"); }
    }
    return {
      target: target ? { author: target.from ? displayName(target.from) : null, text: target.text ?? target.caption ?? "", image } : (image ? { author: null, text: "", image } : null),
      recent, request, intent, claim, language: settings.language, maxChars: BOT_LIMITS.telegramReplyChars - 250,
    };
  }

  private async image(msg: TgMessage, prompt: string, he: boolean, raw: string): Promise<BotRequestView> {
    if (!prompt.trim()) return this.reply(msg, "image", raw, he ? "כתבו מה לצייר, למשל: /imagine חתול אסטרונאוט על הירח" : "Tell me what to draw, e.g. /imagine an astronaut cat on the moon", []);
    await this.d.tg.sendChatAction(msg.chat.id, "upload_photo", msg.message_thread_id);
    const started = Date.now();
    try {
      const img = await this.d.images.generate({ prompt, ownerKey: `telegram:${msg.from!.id}`, signal: AbortSignal.timeout(60_000) });
      const sent = await this.d.tg.sendPhoto({ chat_id: msg.chat.id, photo: img.url, caption: "Bombot AI", reply_to_message_id: msg.message_id, message_thread_id: msg.message_thread_id });
      return this.log(msg, "image", raw, { status: "answered", replyText: img.url, replyMessageId: String(sent.message_id), latencyMs: Date.now() - started });
    } catch (err) {
      if (err instanceof ImagePolicyError) return this.reply(msg, "image", raw, he ? "אני לא יוצר תמונות של אנשים אמיתיים או תוכן פוגעני. נסו רעיון אחר." : "I don't generate images of real people or harmful content. Try another idea.", [], { status: "blocked" });
      if (err instanceof ImageQuotaError) return this.reply(msg, "image", raw, he ? `הגעת למכסה היומית של ${BOT_LIMITS.imagesPerDayFree} תמונות.` : `You've reached the daily limit of ${BOT_LIMITS.imagesPerDayFree} images.`, [], { status: "rate_limited" });
      this.d.log.error({ err }, "image generation failed");
      return this.reply(msg, "image", raw, he ? "יצירת התמונה נכשלה כרגע. נסו שוב מאוחר יותר." : "Image generation failed right now. Try again later.", [], { status: "error" });
    }
  }

  private async settings(msg: TgMessage, args: string, current: ChatSettings, he: boolean): Promise<BotRequestView> {
    if (msg.chat.type !== "private") {
      const status = await this.d.tg.getChatMemberStatus(msg.chat.id, msg.from!.id).catch(() => "member");
      if (status !== "administrator" && status !== "creator") return this.reply(msg, "chat", args, he ? "רק מנהלי הקבוצה יכולים לשנות הגדרות." : "Only group admins can change settings.", []);
    }
    const next = { ...current };
    for (const tok of args.toLowerCase().split(/\s+/)) {
      if (tok === "mention" || tok === "mention_only") next.respondMode = "mention_only";
      else if (tok === "commands" || tok === "commands_too") next.respondMode = "commands_too";
      else if (["he", "en", "ar", "auto"].includes(tok)) next.language = tok as ChatSettings["language"];
      else if (tok === "off") next.enabled = false;
      else if (tok === "on") next.enabled = true;
      else if (tok.startsWith("block:")) next.blockedTopics = tok.slice(6).split(",").filter(Boolean);
    }
    await this.d.repo.saveChatSettings(next);
    const t = he
      ? `הגדרות הקבוצה:\nמצב תגובה: ${next.respondMode === "mention_only" ? "רק בתיוג" : "גם פקודות"}\nשפה: ${next.language}\nפעיל: ${next.enabled ? "כן" : "לא"}\n\nשינוי: /settings@${this.d.env.TELEGRAM_BOT_USERNAME} mention|commands he|en|ar|auto on|off`
      : `Chat settings:\nRespond: ${next.respondMode}\nLanguage: ${next.language}\nEnabled: ${next.enabled}\n\nChange: /settings@${this.d.env.TELEGRAM_BOT_USERNAME} mention|commands he|en|ar|auto on|off`;
    return this.reply(msg, "chat", args, t, []);
  }

  private async reply(msg: TgMessage, intent: BotIntent, requestText: string, text: string, citations: Citation[], extra: Partial<BotRequestView> & { html?: boolean } = {}): Promise<BotRequestView> {
    let replyMessageId: string | null = null;
    try {
      const sent = await this.d.tg.sendMessage({
        chat_id: msg.chat.id, text: extra.html ? text : escapeForTelegram(text), reply_to_message_id: msg.message_id,
        message_thread_id: msg.message_thread_id, parse_mode: "HTML", disable_web_page_preview: true,
      });
      replyMessageId = String(sent.message_id);
    } catch (err) {
      this.d.log.error({ err }, "telegram sendMessage failed");
      return this.log(msg, intent, requestText, { ...extra, status: "error", replyText: text, citations });
    }
    const { html: _h, ...rest } = extra;
    return this.log(msg, intent, requestText, { status: "answered", ...rest, replyText: text, replyMessageId, citations });
  }

  private log(msg: TgMessage, intent: BotIntent, requestText: string, extra: Partial<BotRequestView>): Promise<BotRequestView> {
    return this.d.repo.insertBotRequest({
      id: randomUUID(), platform: "telegram", chatId: String(msg.chat.id), chatTitle: msg.chat.title ?? null,
      userId: String(msg.from?.id ?? "unknown"), userName: msg.from ? displayName(msg.from) : null, intent, requestText: requestText.slice(0, 4000),
      replyText: null, replyMessageId: null, verdict: null, confidence: null, citations: [], safety: null, usage: null, latencyMs: null, status: "answered",
      ...extra,
    });
  }
}

const displayName = (u: { first_name: string; last_name?: string; username?: string }) => [u.first_name, u.last_name].filter(Boolean).join(" ") || (u.username ?? "");
const stripTags = (s: string) => s.replace(/<[^>]+>/g, "");
const escapeForTelegram = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function helpText(he: boolean): string {
  return he
    ? "אני Bombot. תייגו אותי בתגובה להודעה ושאלו \"זה נכון?\" ואבדוק עם מקורות.\n\nפקודות:\n/check בתגובה להודעה: אימות עובדות\n/explain בתגובה: הקשר ורקע\n/summarize בתגובה: סיכום\n/translate בתגובה: תרגום\n/imagine תיאור: יצירת תמונה\n/settings (מנהלים): הגדרות הקבוצה"
    : "I'm Bombot. Tag me in a reply and ask \"is this true?\" and I'll check it with sources.\n\nCommands:\n/check as a reply: fact check\n/explain as a reply: context and background\n/summarize as a reply: summary\n/translate as a reply: translation\n/imagine description: generate an image\n/settings (admins): chat settings";
}
