#!/usr/bin/env bash
# Medimade default AWS credential profile.
#
# If AWS_PROFILE is already set, do nothing.
# Otherwise, if any argument is --profile or --profile=name, do nothing (caller / AWS CLI will use it).
# Otherwise export AWS_PROFILE=mm.
#
# Usage (from other bash scripts):
#   SCRIPT_LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")/lib" && pwd)"
#   # shellcheck source=default-aws-profile.sh
#   source "$SCRIPT_LIB/default-aws-profile.sh"
#   medimade_default_aws_profile "$@"
medimade_default_aws_profile() {
  if [[ -n "${AWS_PROFILE:-}" ]]; then
    return 0
  fi
  local i
  for ((i = 1; i <= $#; i++)); do
    local a="${!i}"
    if [[ "$a" == "--profile" ]]; then
      return 0
    fi
    if [[ "$a" == --profile=* ]]; then
      return 0
    fi
  done
  export AWS_PROFILE=mm
}
