# Local Mac processing (optional, separate from the PWA)

Only this folder's scripts and documentation belong in Git. `.local-ai/` contains tools/models; `.ai-work/` contains private input copies, transcripts, model outputs and logs. Both are ignored. Never upload either folder.

The iPhone app does not run these models and does not contact this server. Transfer the resulting `.eftext` yourself using AirDrop/Files. Import it into the exact original audio in Player → Text → Import text. File hash, byte size and duration are verified. No second audio copy is added.

## This Mac is prepared

From Terminal:

```sh
cd ~/Projects/english-flow-player
python3 local-ai/process.py "/full/path/to/your/audio.m4a"
```

The final line prints the `.eftext` path. Processing stays on this Mac. Keep the original audio file unchanged. Send the same original audio and the generated `.eftext` to iPhone. Models require a one-time download; subsequent processing works without an internet connection. A free port 11435 is required. The script starts its own local server and stops it when done. It refuses to use a pre-existing server.

For separate, inspectable stages:

```sh
python3 local-ai/process.py "/full/path/audio.wav" --asr-only
python3 local-ai/process.py "/full/path/audio.wav" --from-asr "/path/english.eftext"
```

Each private run directory retains `english.eftext`, raw ASR, individual translation/phrase/word responses, `translated.eftext`, and metrics. `--output /path/new.eftext` selects a destination; an existing output is never overwritten. Ctrl+C stops the run. If translation fails, the English result remains importable; if phrase extraction fails, `translated.eftext` remains importable.

## Installation on another compatible Mac

Requires Python 3, Apple command-line developer tools and an existing [Ollama installation](https://ollama.com). No Homebrew, global pip packages or global Git configuration changes:

```sh
sh local-ai/setup.sh
```

The script downloads CMake 3.31.10 into an isolated venv, [whisper.cpp v1.9.5](https://github.com/ggml-org/whisper.cpp), the 142 MiB base.en model and [Qwen2.5 7B Q4_K_M](https://ollama.com/library/qwen2.5:7b), about 4.7 GB. Model downloads contain no user audio. Source/model checksums are verified; Ollama verifies its model layers. Tool/model licenses remain those of their upstream authors; no weights are distributed with this repository.

Whisper uses Apple Metal. macOS `afconvert` converts supported input formats to 16 kHz mono PCM. WAV and M4A were exercised. Other formats depend on the installed system decoder; unsupported/corrupt input fails explicitly. The PCM reader supports both classic WAVE and WAVE_FORMAT_EXTENSIBLE produced from M4A on this Mac.

Ollama uses a separate `127.0.0.1:11435` process, `OLLAMA_MODELS` inside Player, and `OLLAMA_NO_CLOUD=1`. It does not use another project's server or models. No system-wide environment settings are changed. The default port 11434 is never contacted. [Official isolation/cloud configuration](https://docs.ollama.com/faq).

## Quality and limits

English ASR and Russian translation are distinct steps. Times are approximate Whisper segment boundaries, not promised word alignment. Short fragments can be joined using their real boundaries. Speech may be misrecognized, particularly names, noise and accents. Russian may be awkward or inaccurate: review and correct it in Player. The editable `glossary.json` guides common front-desk and trucking terms; it is not a substitute for review.

Only expressions quoted from their actual source segment are accepted. Content-word meanings are cached separately; useful phrases are shown in the learning list. The pipeline caps imported entries at 2,000 and prepares individual words for up to 1,000 candidates. Uncached words/expressions can be entered manually in Player, with their original sentence translation shown. There is no cloud fallback or automatic on-device translation for an arbitrary new selection.

US IPA is optional model output, not a verified pronunciation dictionary. Player labels this and uses only locally installed en-US speech voices. Replay of the original sentence remains available.

On the tested M5 Max / 128 GiB Mac, a **9.484 s synthetic spoken WAV** produced 3 English segments and 13 phrase/word entries in **7.297 s** with warmed tools: conversion 0.016 s, ASR 0.202 s, translation 1.646 s, phrases/words 5.134 s. This tiny clean sample is not a long-recording performance or accuracy guarantee. The first Metal compilation took longer. ASR preserved every word (nine became 9); one of three Russian sentences needed stylistic/grammatical correction. M4A conversion + ASR also passed.

Qwen3 4B and 8B were evaluated but did not improve translation enough on this sample; 4B thinking mode also exhausted its output budget during phrase extraction. Qwen2.5 7B is the chosen practical baseline, not a claim of perfect translation. [Argos Translate](https://github.com/argosopentech/argos-translate) was assessed from its documentation: it is an offline translation alternative, but would add a separate translation stack and would not provide the contextual phrase-selection stage. It was not installed or quality-benchmarked.

Run script tests with `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s local-ai -p 'test_*.py'`. Physical iPhone, noisy/long recordings and arbitrary codecs: NOT TESTED.
