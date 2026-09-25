# data/

What Jev reads when it answers on its own, without a scribe. There are two kinds of files, one of each per
language.

## Phrasebooks

`phrasebook-es.txt` and `phrasebook-en.txt` hold the spirit's answers to open questions, the ones with no
factual answer (who is watching me, when will I die, what is in the attic). They're written the way the phrases
are said, with accents and all ("Tu cuñado", "Where you never look"), one per line, under a `# TOPIC` header
with the topic they answer:

- `WHO`: people and beings.
- `WHERE`: places.
- `WHEN`: times and moments.
- `WHY_HOW`: reasons and ways.
- `WHAT`: anything else (what will happen, what to do, what the spirit wants, things).

Jev reads the phrases on the question's topic first, and the rest only if none answers. On loading, they become
board text (TU CUÑADO, WHERE YOU NEVER LOOK), and a header that isn't one of those topics stops the server. The
tests check that every topic has phrases, that none is longer than 20 characters (spelling takes about a second a
letter) and that none is YES, NO or GOODBYE, or their translations, which have their own spots on the board.

There are no dodges on purpose (maybe, who knows, time will tell): they fit every question, so Jev picks them
for every question.

They were written for this project and are under its MIT license.

## Word lists

`words-es.txt` and `words-en.txt` are where Jev looks for everything else: the 8,000 most frequent words of
spoken Spanish and English, from most to least frequent. Jev reads them in batches of 249 (the first 2,000, then
the rest if it needs to) and picks the word that answers.

They derive from Hermit Dave's [FrequencyWords](https://github.com/hermitdave/FrequencyWords) (the `es_50k` and
`en_50k` lists, built from the [OpenSubtitles](https://www.opensubtitles.org/) 2018 subtitles), which are
distributed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Changes: words uppercased and
without accents (keeping the Ñ), 3 to 12 letters long only, without slurs, swear words and a few words too dark
even for a Ouija board (see `scripts/blocklist.js`), the Spanish list without the untranslated English that
sneaks into subtitles, and both trimmed to 8,000.

That's why **the word lists are distributed under CC BY-SA 4.0**, not under the MIT license of the rest of the
project.

To rebuild them: `npm run build:words -- es_50k.txt en_50k.txt` (see `scripts/build-wordlist.js`).
