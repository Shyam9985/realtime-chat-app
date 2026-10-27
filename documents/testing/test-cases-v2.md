# YaapZone test cases: release 2

Covers the second set of features: skeleton loading, profile layout, chat-list menu, pin, archive and
filters, and in-conversation search, PDF export, renaming, scheduled messages, editing, forwarding and
replies. "A" and "B" are two members in a one-to-one chat; "C" is a third member. Unless a case says
otherwise, both A and B are online, and every expected server rule is also checked through the API
directly, not only through the app.

Each case has an id, the steps, and what must happen. API cases are candidates for the automated
suite in `tests/` (node:test against the real database); UI cases are run on a phone and in the web
build in light and dark themes and at the largest font size.

## 1. Skeleton loading

| ID | Steps | Expected |
|---|---|---|
| SK-01 | Open the app with a slow network and go to Chats. | A chat-list skeleton (avatar circle, two text bars per row) shows until the list arrives, then the real rows replace it. No spinner. |
| SK-02 | Open a chat that is not cached. | Message-bubble skeletons on both sides; the message box stays at the bottom. |
| SK-03 | Open Profile and Contact info. | Each shows its own skeleton (photo circle, detail rows) until loaded. |
| SK-04 | Switch to dark theme and repeat SK-01..03. | Skeleton colours follow the theme; the pulse animation runs smoothly. |
| SK-05 | Load fails (server off). | The skeleton is replaced by the existing error state with "Try again", never left pulsing. |
| SK-06 | Screen reader on, open Chats while loading. | Skeleton is announced once as loading, not as many empty items. |

## 2. Profile layout

| ID | Steps | Expected |
|---|---|---|
| PR-01 | Open Profile, Appearance section. | "Theme" label and the System / Light / Dark buttons on one line; the description on the next line. Same for "Font size" and A- / A / A+. |
| PR-02 | Largest font size, narrow phone (360 px wide). | Label and buttons still fit on one line or wrap cleanly without overlapping or clipping. |

## 3. Chat list: menu and "Read all"

| ID | Steps | Expected |
|---|---|---|
| CL-01 | Tap the three-dot menu in the Chats header. | Menu opens at the top right with "Read all". |
| CL-02 | With unread chats, choose "Read all". | Centred confirmation: how many chats will be marked read, Cancel / Mark as read. |
| CL-03 | Confirm. | All unread badges disappear; the senders' latest messages turn to blue ticks on their phones, live. |
| CL-04 | Cancel. | Nothing changes. |
| CL-05 | No unread chats, choose "Read all". | Option is disabled, or the dialog says there is nothing to mark. |
| CL-06 | Archived chats have unread messages, choose "Read all". | Decide and verify one rule: archived chats are included (default) and their unread count clears too. |
| CL-07 | API: mark-all-read as A. | Only A's receipts change; B's unread counts are untouched. |

## 4. Chat list: pin and archive (long press)

| ID | Steps | Expected |
|---|---|---|
| PA-01 | Long-press a chat row. | Options sheet with "Pin" and "Archive" toggles showing the current state. |
| PA-02 | Turn Pin on. | Row moves to the top with a pin icon; stays pinned after app restart and on A's other devices. |
| PA-03 | Pin three chats in order X, Y, Z. | Pinned chats appear above the others; their order follows the agreed rule (latest pinned first), and is stable on reload. |
| PA-04 | New message arrives in an unpinned chat. | It moves to the top of the unpinned chats but stays below all pinned chats. |
| PA-05 | Turn Pin off. | Pin icon goes; row returns to its place by latest activity. |
| PA-06 | Turn Archive on. | Row leaves the list; "Archived (n)" row appears under the search field with the count. |
| PA-07 | Open "Archived". | Separate list of archived chats; long-press there offers "Unarchive". |
| PA-08 | New message arrives in an archived chat. | Chat stays archived; the Archived row shows that it has unread messages. |
| PA-09 | Archive a pinned chat. | It is unpinned and archived (one rule, documented). |
| PA-10 | B pins or archives the shared chat. | A's list is unaffected (settings are per member). |
| PA-11 | API: pin or archive a conversation A is not in. | 403 NOT_A_MEMBER; nothing changes. |
| PA-12 | Last archived chat is unarchived. | "Archived" row disappears. |

## 5. Chat list: filters with search

| ID | Steps | Expected |
|---|---|---|
| FI-01 | Tap "Unread". | Only chats with unread messages. |
| FI-02 | Tap "Pinned". | Only pinned chats. |
| FI-03 | "Unread" active, type in search. | Both apply together: unread chats matching the text. |
| FI-04 | A filter with no matches. | Empty state naming the filter, with a way back to "All". |
| FI-05 | In "Unread", open a chat and come back. | The chat, now read, leaves the filtered list. |

## 6. Conversation: search

| ID | Steps | Expected |
|---|---|---|
| CS-01 | Tap search in the chat header, type a word that appears in several messages. | Matches are highlighted; "n of m" with up and down arrows. |
| CS-02 | Search for a word only in a message older than the loaded page. | The server finds it; jumping loads the messages around it and highlights it. |
| CS-03 | Search a 1-2 character term. | Still finds matches (falls back from full-text to LIKE). |
| CS-04 | Search text that matches a deleted message's original content. | Not found: deleted text never leaves the server. |
| CS-05 | Search an edited message by old text / new text. | Found only by the current text. |
| CS-06 | API: search a conversation A is not in. | 403 NOT_A_MEMBER. |
| CS-07 | Search with special characters (`%`, `_`, quotes, emoji). | Treated as literal text; no error, no SQL injection. |

## 7. Conversation: export as PDF

| ID | Steps | Expected |
|---|---|---|
| EX-01 | Menu, "Export chat" on a short chat. | PDF with the chat name, date range, and every message with sender, date and time; share sheet opens. |
| EX-02 | Chat with several hundred messages. | All pages fetched; PDF complete and in order; progress shown while it builds. |
| EX-03 | Chat with deleted, edited, forwarded and reply messages. | Deleted show the placeholder; edited show "Edited"; forwarded show "Forwarded"; replies show the quoted text. |
| EX-04 | Emoji and non-Latin text. | Rendered correctly in the PDF. |
| EX-05 | Export while offline. | Clear error; no partial file is shared. |

## 8. Conversation: name (title)

| ID | Steps | Expected |
|---|---|---|
| TI-01 | A starts a new chat with B. | A's chat is named after B, and B's chat is named after A (each member's own title). |
| TI-02 | A renames the chat to "Bestie". | A's list, header and contact info show "Bestie"; B still sees A's name. |
| TI-03 | Rename to an empty name, or more than 100 characters. | Empty restores the default name; over 100 is refused with a message. |
| TI-04 | After the migration, existing chats. | Each member's title is filled with the other person's name. |
| TI-05 | Search the chat list by the new name. | Found. |
| TI-06 | API: rename a conversation A is not in. | 403 NOT_A_MEMBER. |

## 9. Conversation: scheduled messages

| ID | Steps | Expected |
|---|---|---|
| SC-01 | Long-press Send, pick a date and time 2 minutes ahead, confirm. | Message appears in the "Scheduled" strip with its date and time; nothing is sent yet. |
| SC-02 | Wait for the time. | Within a minute after it, the message is sent as A's normal message, B receives it live, ticks work. |
| SC-03 | Pick a time in the past or less than 1 minute ahead. | Refused with a clear message. |
| SC-04 | Edit a scheduled message's text and time before it is due. | The new text is sent at the new time. |
| SC-05 | Cancel a scheduled message. | It is never sent; status CANCELLED. |
| SC-06 | B blocks A before the send time. | Not sent; status FAILED with the reason; A is told in the strip. |
| SC-07 | Server asleep or restarted at the send time (Render free plan). | Sent when the server is next up, late but exactly once. |
| SC-08 | Two server instances or a retry run the same due row. | Sent once only (row locked and status checked in one transaction). |
| SC-09 | Phone time zone differs from the server's. | Sent at the moment A chose, in A's local time. |
| SC-10 | API: schedule into a conversation A is not in, or empty / over-length text. | Refused with the same validation as a normal send. |

## 10. Conversation: edit a message

| ID | Steps | Expected |
|---|---|---|
| ED-01 | A long-presses their own message within 15 minutes, chooses Edit, changes the text, saves. | Bubble shows the new text and "Edited"; B's screen updates live, whatever the ticks were. |
| ED-02 | Edit after 15 minutes (server clock). | Refused: "too late", even if the phone's clock says otherwise. |
| ED-03 | Edit twice. | `message_edits_t` holds two rows with the two earlier texts in order; `messages_lst_t` holds the latest. |
| ED-04 | Edit to empty or over-length text, or unchanged text. | Refused (empty, too long) or ignored (unchanged, no history row). |
| ED-05 | B tries to edit A's message (API). | 403. |
| ED-06 | Edit a deleted message. | Refused. |
| ED-07 | The chat list's last message was edited. | The list preview shows the new text. |
| ED-08 | A message that is quoted in a reply is edited. | The quote in the reply shows the new text. |
| ED-09 | B offline during the edit, then reconnects. | B sees the edited text and label when the chat loads. |

## 11. Conversation: forward

| ID | Steps | Expected |
|---|---|---|
| FW-01 | Long-press any message (sent or received). | Selection header appears at the top with a Forward icon. |
| FW-02 | Tap Forward, pick two chats, send. | Each chat gets a new message from A with the same text and a "Forwarded" label. |
| FW-03 | Forward into a chat where the other person blocked A. | That one is refused and reported; the others are sent. |
| FW-04 | Forward a deleted message. | Not offered / refused. |
| FW-05 | Forward a message, then the original sender deletes the original. | The forwarded copy keeps its text (it is its own message). |
| FW-06 | API: forward a message from a conversation A is not in. | 403; the source content never leaks. |
| FW-07 | Recipient of a forward inspects the message through the API. | Sees `is_forwarded: true` but not the source message id or conversation. |
| FW-08 | Forward a forwarded message. | Still labelled "Forwarded"; maps to the message it was copied from. |

## 12. Conversation: reply by swipe

| ID | Steps | Expected |
|---|---|---|
| RP-01 | Swipe right on a received message. | Quote of it appears above the message box, with the sender's name; the phone gives light feedback. |
| RP-02 | Swipe right on A's own message. | Same, labelled "You". |
| RP-03 | Send the reply. | Bubble shows the quote above the new text, for A and B, live. |
| RP-04 | Tap the quote in a reply. | Chat scrolls to the original and highlights it, loading older messages if needed. |
| RP-05 | Original is deleted later. | Quote shows "This message was deleted". |
| RP-06 | Cancel the quote (X) before sending. | Plain message is sent. |
| RP-07 | Swipe on a deleted or failed message. | No reply offered. |
| RP-08 | API: reply_to a message from another conversation. | Refused. |
| RP-09 | Vertical scrolling through the chat. | Never triggers a reply by accident. |

## 13. Regression

Run the existing suite (`npm test`, 24 cases) after each step, and re-check by hand: sending and
ticks (sent, delivered, read live and after reconnect), delete for everyone, block / unblock, message
info, theme and font size, keyboard on every input screen, and the tab bar above the phone's gesture
bar.
