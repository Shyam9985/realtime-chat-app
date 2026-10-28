import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as chatApi from '../services/chat.service';
import { DELETED_PLACEHOLDER, dayLabel, timeOf, isSameDay, isNotice, noticeText } from './chatFormat';

const PAGE = 100;
const MAX_MESSAGES = 10000;

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

// every message of the conversation, oldest first (the api pages newest first)
async function fetchAll(conversationId, onProgress) {
  const all = [];
  let cursor = null;
  do {
    const page = await chatApi.getHistory(conversationId, cursor, PAGE);
    all.push(...page.messages);
    onProgress?.(all.length);
    cursor = page.has_more ? page.next_cursor : null;
  } while (cursor && all.length < MAX_MESSAGES);
  return all.reverse();
}

function buildHtml({ title, messages, myId, nameOf }) {
  const first = messages[0]?.created_at;
  const last = messages[messages.length - 1]?.created_at;
  const rows = [];
  messages.forEach((m, i) => {
    if (i === 0 || !isSameDay(m.created_at, messages[i - 1].created_at)) rows.push(`<div class="day">${escapeHtml(dayLabel(m.created_at))}</div>`);
    // a group notice ("Maya added Noah") is a centred line, as in the chat
    if (isNotice(m)) { rows.push(`<div class="notice">${escapeHtml(noticeText(m, myId))}</div>`); return; }
    const mine = m.sender_id === myId;
    const labels = [m.is_forwarded && !m.is_deleted ? '<div class="label">Forwarded</div>' : ''];
    const quote = m.reply_to && !m.is_deleted
      ? `<div class="quote"><b>${escapeHtml(nameOf(m.reply_to.sender_id, m.reply_to.sender_name))}</b><br>${m.reply_to.content == null ? `<i>${escapeHtml(DELETED_PLACEHOLDER)}</i>` : escapeHtml(m.reply_to.content)}</div>` : '';
    const text = m.is_deleted ? `<i>${escapeHtml(DELETED_PLACEHOLDER)}</i>` : escapeHtml(m.content).replace(/\n/g, '<br>');
    rows.push(`<div class="row ${mine ? 'mine' : 'theirs'}"><div class="bubble">
      <div class="sender">${escapeHtml(mine ? 'You' : nameOf(m.sender_id, m.sender_name))}</div>${labels.join('')}${quote}<div class="text">${text}</div>
      <div class="meta">${m.is_edited && !m.is_deleted ? 'Edited · ' : ''}${escapeHtml(timeOf(m.created_at))}</div></div></div>`);
  });
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
    body { font-family: -apple-system, Roboto, "Segoe UI", sans-serif; color: #111B21; margin: 24px; }
    h1 { font-size: 20px; margin: 0; } .sub { color: #667781; font-size: 12px; margin: 4px 0 16px; }
    .day { text-align: center; color: #667781; font-size: 11px; margin: 14px 0 6px; }
    .notice { text-align: center; color: #667781; font-size: 11px; font-style: italic; margin: 6px 0; }
    .row { display: flex; margin: 3px 0; } .mine { justify-content: flex-end; }
    .bubble { max-width: 75%; padding: 6px 10px; border-radius: 10px; background: #FFFFFF; border: 1px solid #E9EDEF; page-break-inside: avoid; }
    .mine .bubble { background: #D9FDD3; border-color: #CDEFC6; }
    .sender { font-size: 11px; font-weight: 700; color: #128C5E; } .label { font-size: 11px; font-style: italic; color: #667781; }
    .quote { border-left: 3px solid #128C5E; background: rgba(0,0,0,0.05); padding: 4px 6px; margin: 3px 0; font-size: 12px; color: #54656F; }
    .text { font-size: 14px; white-space: pre-wrap; word-wrap: break-word; } .meta { text-align: right; font-size: 10px; color: #667781; margin-top: 2px; }
  </style></head><body>
    <h1>${escapeHtml(title)}</h1>
    <div class="sub">YaapZone chat export · ${messages.length} message${messages.length === 1 ? '' : 's'}${first ? ` · ${escapeHtml(dayLabel(first))} to ${escapeHtml(dayLabel(last))}` : ''}</div>
    ${rows.join('\n')}
  </body></html>`;
}

/*
 * Export a whole conversation as a PDF: fetch every page, lay it out like the chat, then hand the file
 * to the phone's share sheet (save to files, send by email, ...).
 */
export async function exportChatAsPdf({ conversationId, title, myId, nameOf, onProgress }) {
  const messages = await fetchAll(conversationId, onProgress);
  const html = buildHtml({ title, messages, myId, nameOf });
  const { uri } = await Print.printToFileAsync({ html });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: `Export ${title}`, UTI: 'com.adobe.pdf' });
  }
  return { count: messages.length, uri };
}
