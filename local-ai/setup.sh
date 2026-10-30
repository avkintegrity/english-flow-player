#!/bin/sh
# Optional, isolated installation. Downloads public tools/models, never user audio.
set -eu
PLAYER_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$PLAYER_ROOT"
command -v ollama >/dev/null || { echo 'Install Ollama from https://ollama.com first.'; exit 1; }
mkdir -p .local-ai/models .local-ai/ollama .ai-work
[ -x .local-ai/venv/bin/python ] || python3 -m venv .local-ai/venv
.local-ai/venv/bin/python -m pip install --no-cache-dir cmake==3.31.10
if [ ! -f .local-ai/whisper-v1.9.5.tar.gz ]; then
 curl -fL https://github.com/ggml-org/whisper.cpp/archive/refs/tags/v1.9.5.tar.gz -o .local-ai/whisper-v1.9.5.tar.gz.part
 mv .local-ai/whisper-v1.9.5.tar.gz.part .local-ai/whisper-v1.9.5.tar.gz
fi
printf '%s\n' 'ff1a9053feb509ff9d7729703355541ae9690073a6b1c40eb692c962e0dc1720  .local-ai/whisper-v1.9.5.tar.gz' | shasum -a 256 -c -
[ -d .local-ai/whisper.cpp-1.9.5 ] || tar -xzf .local-ai/whisper-v1.9.5.tar.gz -C .local-ai
PLAYER_SDK=$(xcrun --show-sdk-path)
# Existing SDK 15.4 avoids the incompatible SDK 27 stubs on the tested Mac.
[ ! -d /Library/Developer/CommandLineTools/SDKs/MacOSX15.4.sdk ] || PLAYER_SDK=/Library/Developer/CommandLineTools/SDKs/MacOSX15.4.sdk
.local-ai/venv/bin/cmake -S .local-ai/whisper.cpp-1.9.5 -B .local-ai/whisper-build -DCMAKE_OSX_SYSROOT="$PLAYER_SDK" -DCMAKE_OSX_DEPLOYMENT_TARGET=15.0 -DCMAKE_BUILD_TYPE=Release -DGGML_METAL=ON -DWHISPER_BUILD_TESTS=OFF
.local-ai/venv/bin/cmake --build .local-ai/whisper-build -j 8 --config Release
if [ ! -f .local-ai/models/ggml-base.en.bin ]; then
 curl -fL https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin -o .local-ai/models/ggml-base.en.bin.part
 mv .local-ai/models/ggml-base.en.bin.part .local-ai/models/ggml-base.en.bin
fi
printf '%s\n' 'a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002  .local-ai/models/ggml-base.en.bin' | shasum -a 256 -c -
PYTHONDONTWRITEBYTECODE=1 python3 local-ai/setup_model.py
