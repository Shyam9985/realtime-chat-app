# YaapZone test cases: release 3

Covers group chats, the date of birth at sign-up, and editing your own profile. In the group cases
"Alice" creates the group and is its first admin; "Bob", "Carol" and "Dave" are members; "Eve" has
blocked Alice. Unless a case says otherwise everyone is online, and every server rule is also checked
through the API directly, not only through the app.

Each case has an id, the steps, and what must happen. The API cases are automated in
`tests/groups.test.js` and `tests/profile.test.js` (node:test against the real database, with
`GROUP_MAX_MEMBERS=5` so the limit is quick to reach); the test names carry these ids. UI cases are
run on a phone and in the web build, in light and dark themes and at the largest font size.

Database: `documents/database/migration-v3.sql` must be run before the server that needs it starts.

## 1. Creating a group

| ID | Steps | Expected |
|---|---|---|
| GR-01 | Alice: Chats, green button, New group. Pick Bob and Carol, Next, name "Trip", Create. | The chat opens. Alice is the admin, Bob and Carol are members. The first line in the chat is "You created the group “Trip”" (Bob sees "Alice created the group “Trip”"). Bob and Carol see the group in their lists at once. |
| GR-02 | Name "  Trip  " with a description. | Saved as "Trip" (trimmed) with the description; 3 members; the notice does not count as unread for Bob. |
| GR-03 | Create with no name, a blank name, or 101 characters. | Refused: "Give the group a name." / the 100-character limit. Nothing is created. |
| GR-04 | Create with nobody picked, or only yourself. | Refused: choose at least one person other than yourself. |
| GR-05 | Create with more people than the limit allows (the limit counts you). | Refused with GROUP_FULL. Nothing is created. |
| GR-06 | Create with Bob, Eve (who blocked Alice) and an id that does not exist. | Created with Bob only; the app says "Couldn’t add Eve". Without saying why. If nobody can be added, nothing is created. |
| GR-07 | Admin adds two people when there is room for one. | Refused: "This group has room for 1 more person (the limit is …)". Nobody is added. |
| GR-08 | Admin adds one person to reach the limit exactly, then one more. | The first is added; the second is refused. |
| GR-09 | UI: New group picker. | Picked people show as chips above the results; tapping a chip unpicks. People you blocked show "Blocked. Unblock them to add them." and cannot be picked. In Add members, people already in the group show "Already in the group". |

## 2. Messages and ticks in a group

| ID | Steps | Expected |
|---|---|---|
| GR-10 | Alice sends "hello all". | Bob and Carol see it with "Alice" above the bubble (once per run of messages from the same person). Alice's own bubbles show no name. |
| GR-11 | Bob's phone receives it, Carol's does not yet. | Alice still sees one tick. When Carol's phone receives it, Alice sees two grey ticks. |
| GR-12 | Bob reads it, Carol has not. | Still not blue. When Carol reads it, Alice's ticks turn blue, live. |
| GR-13 | Try to edit, delete for everyone, or forward a notice (through the API). | Refused: notices cannot be changed. In the app, a notice cannot be long-pressed. |
| GR-14 | Reply quoting a notice (through the API). | Refused. |
| GR-15 | Alice long-presses her message, Info. | "Read by" and "Delivered to" lists with each person's time, "Not delivered yet" for the rest, "Left the group before reading" for anyone who exited first. Only the sender can open it (others: refused). |
| GR-16 | Search in a group. | Finds only messages you can see (nothing from before you joined or while you were out). Notices are never search results. |
| GR-17 | Bob blocks Alice; Alice sends to the group. | Bob does not receive it, it is not in his history, and his chat list preview does not show it. Carol receives it. |
| GR-18 | Bob (who blocked Alice) sends to the group. | Alice receives it: blocking is one-way. |
| GR-19 | UI: notices. | Centred grey lines worded for the reader: "You added Noah", "Maya added you", "You left", "Noah is now an admin". They never add to the unread badge. The chat list shows them as the preview, in italics. |

## 3. Admins

| ID | Steps | Expected |
|---|---|---|
| GR-20 | Bob (a member) tries, through the API, to add, remove, promote, or rename. | Each is refused with NOT_GROUP_ADMIN (403). |
| GR-21 | UI: Bob opens Group info. | No "Add members", no pencil next to the name; tapping a member offers only Message and View profile. |
| GR-22 | Alice makes Bob an admin. | Bob shows the Admin label; notice "Alice made Bob an admin". There can be several admins. |
| GR-23 | Bob (now admin) adds Dave and Carol (already in it). | Dave is added ("Bob added Dave"); Carol is reported as already in the group. |
| GR-24 | Bob removes Carol. | Notice "Bob removed Carol", which Carol also gets; her chat turns read-only at once. |
| GR-25 | Alice adds Carol back. | Carol is a member again (role Member), the group is active in her list. |
| GR-26 | Carol, re-added, scrolls her history. | She sees what she received before she was removed and everything after she was added back, but nothing sent while she was out. |
| GR-27 | Alice changes the name to "Goa Trip" and the description. | Everyone's list and header show "Goa Trip"; notices "Alice changed the group name to “Goa Trip”" and "Alice changed the group description". |
| GR-28 | Save the same name again; save a blank name; send nothing. | Same name: no change and no notice. Blank or nothing: refused. |
| GR-29 | Carol tries the personal "Rename chat" on a group (API). Carol pins the group. | Rename refused (a group has one name for everyone). Pinning works: it is personal. |
| GR-30 | Dave, added later, opens the group. | His first line is "Bob added you"; nothing from before. When Alice edits an older message, Bob and Carol see the change; Dave is sent nothing. |

## 4. Exiting and being removed

| ID | Steps | Expected |
|---|---|---|
| GR-31 | Dave (not an admin): ⋮, Exit group, Exit. | Allowed. The chat stays in his list, read-only. |
| GR-32 | The others watch the chat. | "Dave left" appears live; the header member list and Group info update. |
| GR-33 | Alice sends; Bob reads it; Dave exits without reading. | Alice's ticks turn blue: nobody who left is waited for. |
| GR-34 | Dave had a message scheduled in the group; he exits; he tries to exit again. | The scheduled message is cancelled. Exiting twice is refused. He can still read the chat. |
| GR-35 | The only admin tries to dismiss themselves. | Refused with LAST_ADMIN: make someone else admin first, or exit. |
| GR-36 | An admin tries to remove themselves. | Refused: use Exit group. |
| GR-37 | The only admin exits. | The member who has been in the group longest becomes admin; notice "Fay is now an admin". Exit confirmation says so beforehand. |
| GR-38 | The last member exits. | Allowed; nobody is promoted; the group has no members left. |
| GR-39 | Two admins remove each other at the same moment. | Exactly one succeeds; the other is refused; one admin remains. |
| GR-40 | Carol (removed) tries to send. | Refused with NOT_A_MEMBER. |
| GR-41 | Carol (removed) reads the group. | She keeps what she received; nothing new appears; her chat list preview stays at "Bob removed you". |
| GR-42 | Carol (removed) opens Group info. | No member list; "You’re no longer a member" and Delete group. |
| GR-43 | Dave (exited) forwards a group message. | Not into the group he left (refused per target); into his other chats it works. The group is not offered on the Forward screen. |
| GR-44 | Delete group: Dave (exited) deletes it; Bob (still a member) tries; anyone tries on a one-to-one chat. | Dave: gone from his list on all his devices. Bob and the one-to-one chat: refused. |
| GR-45 | Dave opens the deleted group's history (API). | Refused. |
| GR-46 | UI after exiting. | The message box is replaced by "You can’t send messages to this group because you’re no longer a member."; the header says "You’re no longer a member"; long press offers no reply, edit or delete; ⋮ offers Group info, Export chat, Delete group. |

## 5. Date of birth

| ID | Steps | Expected |
|---|---|---|
| BD-01 | Sign up without a date of birth. | Refused: "Date of birth is required." |
| BD-02 | Sign up with "15-05-1995" or "2001-02-30". | Refused: not a date like 1995-08-21 / not a real date. |
| BD-03 | Sign up with a date in the future, one day short of 13 years ago, exactly 13 years ago today, and over 120 years ago. | Future, under 13 and over 120: refused ("You must be at least 13 years old to use YaapZone."). Exactly 13 today: allowed. The age comes from `SIGNUP_MIN_AGE` (default 13). |
| BD-04 | Open Profile after signing up. | Birthday shows exactly the day entered (no time zone moves it). |
| BD-05 | UI: the field. | A calendar on the phone, a date field in the browser; the error shows under the field; the form keeps the other values. |
| BD-06 | Another member views your profile or a group member list. | Your date of birth is never shown to anyone else. |

## 6. Editing your profile

| ID | Steps | Expected |
|---|---|---|
| PE-01 | Profile, Edit profile: change first name, last name, mobile, date of birth; Save. | "Profile updated."; the header name and Details show the new values. |
| PE-02 | Clear the last name and mobile; Save. | Both are cleared; the first name and date of birth are unchanged. |
| PE-03 | Blank first name, letters and digits in a name, a 5-digit mobile, a blank or under-13 date of birth, an email change (API), or nothing changed. | Each is refused with the reason under the field (the email is the sign-in and cannot be changed here). |
| PE-04 | Alice renames herself; Bob has a one-to-one chat with her that he never renamed. | Bob's chat title changes to the new name, live. |
| PE-05 | Bob had renamed that chat "Bestie"; Alice renames herself again. | Bob's chat stays "Bestie". |
| PE-06 | UI: Cancel while editing. | Nothing is saved; the details show the old values. |

## 7. Regression

| ID | Steps | Expected |
|---|---|---|
| RG-01 | `npm test`. | Every suite passes: chat, release 2, groups, profile. |
| RG-02 | One-to-one chats: send, ticks, block, edit, delete, reply, forward, schedule. | Unchanged from release 2. |
