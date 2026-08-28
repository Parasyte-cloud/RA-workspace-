#!/bin/sh

export PATH="/workspace/.home/.local/bin:$PATH"

if [ -n "${BASH_VERSION:-}" ]; then
  PS1='\[\033[38;2;255;153;0m\]ParAsYtE\[\033[0m\]:\[\033[38;2;94;234;212m\]\w\[\033[0m\]$ '
fi
