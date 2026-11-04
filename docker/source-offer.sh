#!/bin/sh
# Prints an image's SOURCE-OFFER.md: every Alpine package installed, at its exact version and
# license, with where its source is, and a written offer of that source, as GPL-2.0 §3(b)
# asks of whoever distributes BusyBox and the other GPL packages. Reads apk's package
# database, so it runs in the base stage both images share, which installs nothing after.
#
# The offer is osieka.dev's, for the images it publishes to GHCR. Anyone publishing their
# own images replaces it with their own.
set -eu

release=$(cat /etc/alpine-release)
branch=v$(echo "$release" | cut -d. -f1,2)

cat <<EOF
# Source offer

This image is built on Alpine Linux $release and holds the Alpine packages below, unmodified,
at these exact versions. Some are under licenses that require their source to be available,
such as GPL-2.0 for BusyBox.

A package's complete corresponding source is its build recipe in Alpine's aports repository,
at the commit the package was built from (linked below), together with the upstream source
archives the recipe lists, which Alpine mirrors at
<https://distfiles.alpinelinux.org/distfiles/$branch/>.

## Written offer

For at least three years after last distributing this image, Rafał Osieka (osieka.dev), who
publishes it as \`ghcr.io/rafalosieka/owe-yeah\` and \`ghcr.io/rafalosieka/owe-yeah-migrator\`,
will give anyone who asks a complete machine-readable copy of the corresponding source of
every package below, for no more than the cost of providing it. Ask at owe-yeah@osieka.dev
or in an issue at <https://github.com/RafalOsieka/osi.owe.yeah/issues>, naming the image and
its \`org.opencontainers.image.revision\` label.

## Packages

| Package | Version | License | Source |
| ------- | ------- | ------- | ------ |
EOF

# One record per package; P: name, V: version, L: license, o: origin (the aport), c: the
# aports commit it was built from.
awk '
  function row() {
    if (p != "") printf "| %s | %s | %s | [aports `main/%s` at `%s`](https://gitlab.alpinelinux.org/alpine/aports/-/tree/%s/main/%s) |\n", p, v, l, o, substr(c, 1, 12), c, o
  }
  /^P:/ { row(); p = substr($0, 3) }
  /^V:/ { v = substr($0, 3) }
  /^L:/ { l = substr($0, 3) }
  /^o:/ { o = substr($0, 3) }
  /^c:/ { c = substr($0, 3) }
  END { row() }
' /lib/apk/db/installed | sort
