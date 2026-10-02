-- SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
-- SPDX-License-Identifier: Apache-2.0
--
-- Words as a 0.2 server saved them (the schema of 20261001000000_create_words), for the
-- slice 07 migration test. Timestamps are 0.2's naive "YYYY-MM-DDTHH:MM:SS".
-- Cases: a romanization that is a respelling, a Telegram lookup still pending, an NFD
-- duplicate of an NFC word, a case duplicate, blank and missing language names, empty
-- forms, forms with duplicates in other cases, and ids with gaps from 0.2's hard deletes.
INSERT INTO words (id, lang, language, native, romanization, english, english_forms, note, status, source_text, inserted_at, updated_at) VALUES
  (1, 'ru', 'Russian', 'пожалуйста', 'pazhaluysta', 'please', 'please', 'Also "you''re welcome".', 'active', 'add pozhaluysta', '2026-09-01T10:00:00', '2026-09-01T10:00:00'),
  (2, 'ru', 'Russian', 'спасибо', 'spasibo', 'thanks', 'thanks
thank you
Thanks', 'My own mnemonic', 'active', 'spasibo', '2026-09-02T11:30:15', '2026-09-03T08:00:00'),
  (3, 'ar', 'Arabic', 'شكرا', 'shukran', 'thanks', '', NULL, 'active', 'shukran', '2026-09-03T12:00:00', '2026-09-03T12:00:00'),
  (4, 'ja', 'Japanese', '犬', 'inu', 'dog', 'dog
dogs', NULL, 'active', 'dog in japanese', '2026-09-04T09:15:00', '2026-09-04T09:15:00'),
  (5, 'vi', 'Vietnamese', 'phở', 'pho', 'pho', 'pho', 'Noodle soup.', 'active', 'pho', '2026-09-05T18:00:00', '2026-09-05T18:00:00'),
  (6, 'vi', '', 'phở', NULL, 'pho soup', 'pho soup
pho', NULL, 'active', 'pho again', '2026-09-06T18:00:00', '2026-09-06T19:00:00'),
  (8, 'de', ' ', 'Hund', NULL, 'dog', 'dog', NULL, 'active', 'hund', '2026-09-07T07:00:00', '2026-09-07T07:00:00'),
  (9, 'de', 'German', 'hund', NULL, 'hound', 'hound', 'Lowercase copy.', 'pending', 'what is hund', '2026-09-08T07:00:00', '2026-09-08T07:00:00'),
  (10, 'ru', 'Russian', 'да', 'da', 'yes', 'yes', NULL, 'pending', 'what''s da', '2026-09-09T20:00:00', '2026-09-09T20:00:00'),
  (12, 'zh', NULL, ' 谢谢 ', 'xièxie', ' thanks ', '', NULL, 'active', 'xie xie', '2026-09-10T21:00:00', '2026-09-10T21:00:00'),
  (13, 'ko', 'Korean', '감사합니다', 'gamsahamnida', 'thank you', 'thank you
thanks', NULL, 'active', NULL, '2026-09-11 22:00:00', '2026-09-11 22:00:00');
-- 0.2 deleted words outright: id 14 was handed out and deleted.
UPDATE sqlite_sequence SET seq = 14 WHERE name = 'words';
