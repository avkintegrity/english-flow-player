# Text and phrases in 2.1.1

Open a recording → **Text → Import text**. Select the `.eftext` made by the [Mac tool](local-ai/README.md) from the same original audio. SHA-256, size and duration are checked; filenames alone never identify a recording. SRT/VTT import English only and require explicit manual association.

Listen with EN/RU text. Tap a sentence to seek and play; use Repeat, Loop, Pause after sentence and the sentence arrows. Language modes, search and follow scrolling are in the expandable options. Manual scrolling pauses following. The pencil edits EN/RU without changing audio.

Select English words and tap the dictionary button that appears, or tap **Dictionary** on a sentence. Cached contextual meanings work offline. If a meaning is missing, the full sentence translation is shown and you can enter it manually. There is no automatic iPhone translation of arbitrary new selections.

**Save to my phrases** retains the meaning, source sentence, time and track. **Already know** hides an item; known items can be shown again. The Phrases panel switches between useful expressions and your saved items. Unsaved individual dictionary words are excluded from the useful-expression list.

**Speak US** uses only an installed local en-US voice. If unavailable, replay the original sentence. Optional model IPA is explicitly labelled and is not a verified pronunciation dictionary.

AI can produce incorrect or unnatural language. Review and edit it. Timing is segment-level. Reimport replaces the text and phrase list after confirmation: export an `.efp` first to retain an earlier revision.

Learning data is stored separately from audio and notes in IndexedDB and included in EFP v3 backups. EFP v1/v2 remain readable. Keep backups outside the PWA; browser data can be removed by clearing site data.
