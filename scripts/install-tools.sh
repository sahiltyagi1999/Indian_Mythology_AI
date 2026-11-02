#!/usr/bin/env bash
# Downloads official MongoDB Community and Qdrant binaries into ./.tools (macOS/Linux, x64/arm64).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; T="$ROOT/.tools"; mkdir -p "$T"
OS="$(uname -s)"; ARCH="$(uname -m)"
MONGO_VERSION="${MONGO_VERSION:-9.0.4}"; QDRANT_VERSION="${QDRANT_VERSION:-v1.20.0}"
if [ ! -x "$T/mongodb/bin/mongod" ]; then
  case "$OS-$ARCH" in
    Darwin-arm64) M="osx/mongodb-macos-arm64-$MONGO_VERSION.tgz" ;;
    Darwin-x86_64) M="osx/mongodb-macos-x86_64-$MONGO_VERSION.tgz" ;;
    Linux-x86_64) M="linux/mongodb-linux-x86_64-ubuntu2404-$MONGO_VERSION.tgz" ;;
    Linux-aarch64) M="linux/mongodb-linux-aarch64-ubuntu2404-$MONGO_VERSION.tgz" ;;
    *) echo "Unsupported platform $OS-$ARCH; install MongoDB manually"; exit 1 ;;
  esac
  mkdir -p "$T/mongodb"; curl -fsSL "https://fastdl.mongodb.org/$M" | tar xz -C "$T/mongodb" --strip-components=1
fi
if [ ! -x "$T/qdrant/qdrant" ]; then
  case "$OS-$ARCH" in
    Darwin-arm64) Q="qdrant-aarch64-apple-darwin.tar.gz" ;;
    Darwin-x86_64) Q="qdrant-x86_64-apple-darwin.tar.gz" ;;
    Linux-x86_64) Q="qdrant-x86_64-unknown-linux-gnu.tar.gz" ;;
    *) echo "Unsupported platform $OS-$ARCH; install Qdrant manually"; exit 1 ;;
  esac
  mkdir -p "$T/qdrant"; curl -fsSL "https://github.com/qdrant/qdrant/releases/download/$QDRANT_VERSION/$Q" | tar xz -C "$T/qdrant"
fi
echo "mongod: $("$T/mongodb/bin/mongod" --version | head -1)"
echo "qdrant: $("$T/qdrant/qdrant" --version 2>/dev/null | tail -1)"
